/**
 * RemitFlow — Hand-rolled Temporal ↔ OpenTelemetry Interceptors (W11-C2)
 * ══════════════════════════════════════════════════════════════════════════════
 * WORKER/CLIENT SIDE ONLY. This module runs in the plain Node.js worker /
 * client processes. It must NEVER be imported from workflow definition files
 * (workflows.ts, apApprovalWorkflow.ts, arAgingWorkflow.ts) — those execute
 * inside Temporal's sandboxed V8 isolate and may only import
 * `@temporalio/workflow` at top level. Interceptors are wired in:
 *   - server/temporal/worker.ts        (all 3 workers, activity inbound)
 *   - server/temporal/client.ts       (workflow start/signal client)
 *   - server/temporal/temporalClient.ts (fund-flow workflow start client)
 *
 * Why hand-rolled: @temporalio/interceptors-opentelemetry is NOT an allowed
 * dependency, so context propagation is implemented directly on
 * @opentelemetry/api (propagation.inject / propagation.extract) plus the
 * @temporalio/worker 1.16 / @temporalio/client 1.16 interceptor interfaces.
 *
 * Propagation format: W3C traceparent (+ tracestate) and x-tenant-id are
 * encoded into Temporal message headers as json/plain Payloads:
 *   { metadata: { encoding: "json/plain" }, data: TextEncoder(JSON.stringify(value)) }
 * The same codec is used on inject (client) and extract (worker) sides.
 *
 * FAIL-SOFT: a telemetry failure must never break a workflow start, signal,
 * or activity execution. If span setup/injection throws, we debug-log and
 * run the underlying call uninstrumented. Absence of headers is honest —
 * activities simply start a root span; tenant.id is omitted when unknown.
 */

import {
  trace,
  context as otelContext,
  propagation,
  defaultTextMapSetter,
  defaultTextMapGetter,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import type { Context as OtelContext, Span } from "@opentelemetry/api";
import type {
  ActivityInterceptors,
  ActivityInterceptorsFactory,
  ActivityExecuteInput,
  ActivityInboundCallsInterceptor,
  Next as WorkerNext,
} from "@temporalio/worker";
import type {
  WorkflowClientInterceptor,
  WorkflowStartInput,
  WorkflowSignalInput,
  WorkflowSignalWithStartInput,
  Next as ClientNext,
} from "@temporalio/client";
import { activityInfo } from "@temporalio/activity";
import { logger } from "../_core/logger";
import { getRequestTenantContext } from "../_core/tenantGuc";

const TRACER_NAME = "remitflow-temporal";
const TRACER_VERSION = "1.0.0";
const TENANT_HEADER = "x-tenant-id";

// ── Header codec (Temporal Payload ↔ string) ──────────────────────────────────
// Minimal structural view of temporal.api.common.v1.IPayload — avoids importing
// @temporalio/common (transitive dep) while staying wire-compatible.

interface PayloadLike {
  metadata?: Record<string, Uint8Array | string> | null;
  data?: Uint8Array | string | null;
}

type TemporalHeaders = Record<string, PayloadLike>;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function encodeHeader(value: string): PayloadLike {
  return {
    metadata: { encoding: "json/plain" },
    data: textEncoder.encode(JSON.stringify(value)),
  };
}

function decodeHeader(payload: PayloadLike | undefined): string | undefined {
  try {
    if (!payload || payload.data === undefined || payload.data === null) return undefined;
    const raw = typeof payload.data === "string" ? payload.data : textDecoder.decode(payload.data);
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    if (parsed === null || parsed === undefined) return undefined;
    return String(parsed);
  } catch {
    return undefined;
  }
}

// ── Trace context inject / extract ────────────────────────────────────────────

/** Inject W3C traceparent/tracestate (+ optional extra headers) into Temporal headers. */
function injectTraceHeaders(headers: TemporalHeaders, extra?: Record<string, string>): void {
  const carrier: Record<string, string> = {};
  propagation.inject(otelContext.active(), carrier, defaultTextMapSetter);
  for (const [key, value] of Object.entries(carrier)) {
    headers[key] = encodeHeader(value);
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value) headers[key] = encodeHeader(value);
    }
  }
}

/** Extract the remote trace context from Temporal headers (active context if absent). */
function extractTraceContext(headers: TemporalHeaders): OtelContext {
  const carrier: Record<string, string> = {};
  for (const key of ["traceparent", "tracestate"]) {
    const value = decodeHeader(headers[key]);
    if (value) carrier[key] = value;
  }
  return propagation.extract(otelContext.active(), carrier, defaultTextMapGetter);
}

/** Read tenant.id from Temporal headers (omitted — not faked — when absent). */
function extractTenantId(headers: TemporalHeaders): string | undefined {
  return decodeHeader(headers[TENANT_HEADER]);
}

/** Current request's tenant id from the tRPC AsyncLocalStorage context (client side). */
function currentRequestTenantId(): string | undefined {
  try {
    const reqTenant = getRequestTenantContext();
    return reqTenant?.tenantId ?? undefined;
  } catch {
    return undefined;
  }
}

// ── Client interceptor (workflow start / signal) ──────────────────────────────

interface StartSpanResult {
  span: Span;
  ctx: OtelContext;
}

function startClientSpan(
  name: string,
  attributes: Record<string, string>,
): StartSpanResult {
  const tracer = trace.getTracer(TRACER_NAME, TRACER_VERSION);
  const ctx = otelContext.active();
  const span = tracer.startSpan(name, { kind: SpanKind.CLIENT, attributes }, ctx);
  return { span, ctx: trace.setSpan(ctx, span) };
}

async function runInSpan<T>(sr: StartSpanResult, fn: () => Promise<T>): Promise<T> {
  try {
    const result = await otelContext.with(sr.ctx, fn);
    sr.span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    sr.span.recordException(error);
    sr.span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    throw err;
  } finally {
    sr.span.end();
  }
}

/**
 * Client-side interceptor: starts a CLIENT span per workflow start/signal and
 * injects the active trace context + tenant.id into the workflow headers so
 * the worker side can continue the trace.
 *
 * All methods are fail-soft: any telemetry error downgrades to a plain
 * pass-through of the original call.
 */
export class TemporalOtelWorkflowClientInterceptor implements WorkflowClientInterceptor {
  async start(
    input: WorkflowStartInput,
    next: ClientNext<WorkflowClientInterceptor, "start">,
  ): Promise<string> {
    const prepared = this.prepareStart(`temporal.workflow.start/${input.workflowType}`, {
      "temporal.workflow_type": input.workflowType,
      "temporal.workflow_id": String(input.options.workflowId ?? ""),
      "temporal.task_queue": String(input.options.taskQueue ?? ""),
    }, input.headers as TemporalHeaders);
    if (!prepared) return next(input); // telemetry setup failed — plain pass-through
    return runInSpan(prepared.sr, () =>
      next({ ...input, headers: prepared.headers as WorkflowStartInput["headers"] }));
  }

  async startWithDetails(
    input: WorkflowStartInput,
    next: ClientNext<WorkflowClientInterceptor, "startWithDetails">,
  ) {
    const prepared = this.prepareStart(`temporal.workflow.start/${input.workflowType}`, {
      "temporal.workflow_type": input.workflowType,
      "temporal.workflow_id": String(input.options.workflowId ?? ""),
      "temporal.task_queue": String(input.options.taskQueue ?? ""),
    }, input.headers as TemporalHeaders);
    if (!prepared) return next(input);
    return runInSpan(prepared.sr, () =>
      next({ ...input, headers: prepared.headers as WorkflowStartInput["headers"] }));
  }

  async signal(
    input: WorkflowSignalInput,
    next: ClientNext<WorkflowClientInterceptor, "signal">,
  ): Promise<void> {
    const prepared = this.prepareStart(`temporal.workflow.signal/${input.signalName}`, {
      "temporal.signal_name": input.signalName,
      "temporal.workflow_id": input.workflowExecution.workflowId,
      "temporal.run_id": input.workflowExecution.runId ?? "",
    }, input.headers as TemporalHeaders);
    if (!prepared) return next(input);
    return runInSpan(prepared.sr, () =>
      next({ ...input, headers: prepared.headers as WorkflowSignalInput["headers"] }));
  }

  async signalWithStart(
    input: WorkflowSignalWithStartInput,
    next: ClientNext<WorkflowClientInterceptor, "signalWithStart">,
  ): Promise<string> {
    const prepared = this.prepareStart(`temporal.workflow.signalWithStart/${input.workflowType}`, {
      "temporal.workflow_type": input.workflowType,
      "temporal.signal_name": input.signalName,
      "temporal.workflow_id": String(input.options.workflowId ?? ""),
      "temporal.task_queue": String(input.options.taskQueue ?? ""),
    }, input.headers as TemporalHeaders);
    if (!prepared) return next(input);
    return runInSpan(prepared.sr, () =>
      next({ ...input, headers: prepared.headers as WorkflowSignalWithStartInput["headers"] }));
  }

  /**
   * Telemetry setup only (span + header injection). Returns null on failure —
   * the caller then runs the underlying Temporal call uninstrumented.
   * Errors from `next` are NEVER caught here: they propagate to the caller
   * unchanged, so a workflow start/signal can never be silently retried or
   * double-invoked by this interceptor.
   */
  private prepareStart(
    spanName: string,
    attributes: Record<string, string>,
    inputHeaders: TemporalHeaders,
  ): { sr: StartSpanResult; headers: TemporalHeaders } | null {
    try {
      const tenantId = currentRequestTenantId();
      if (tenantId) attributes["tenant.id"] = tenantId;
      const span = startClientSpan(spanName, attributes);
      const headers: TemporalHeaders = { ...inputHeaders };
      injectTraceHeaders(headers, tenantId ? { [TENANT_HEADER]: tenantId } : undefined);
      return { sr: span, headers };
    } catch (err) {
      logger.debug({ err }, `[telemetry] temporal client interceptor setup failed for '${spanName}' — running uninstrumented`);
      return null;
    }
  }

}

// ── Worker activity inbound interceptor ───────────────────────────────────────

class TemporalOtelActivityInbound implements ActivityInboundCallsInterceptor {
  async execute(
    input: ActivityExecuteInput,
    next: WorkerNext<ActivityInboundCallsInterceptor, "execute">,
  ): Promise<unknown> {
    // ── Telemetry setup (fail-soft): any error here downgrades to plain execution
    let span: Span;
    let spanCtx: OtelContext;
    try {
      // activityInfo() only works inside the activity async context — execute
      // runs within it on the worker. Defensive: fall back to bare attributes.
      let info: {
        activityType?: string;
        taskQueue?: string;
        workflowType?: string;
        workflowExecution?: { workflowId?: string; runId?: string };
      } = {};
      try {
        info = activityInfo() as typeof info;
      } catch {
        /* outside activity context (tests) — continue with what we have */
      }

      const headers = (input.headers ?? {}) as TemporalHeaders;
      const parentCtx = extractTraceContext(headers);
      const tenantId = extractTenantId(headers);

      const attributes: Record<string, string> = {
        "temporal.activity_type": String(info.activityType ?? "unknown"),
        "temporal.workflow_id": String(info.workflowExecution?.workflowId ?? ""),
        "temporal.run_id": String(info.workflowExecution?.runId ?? ""),
        "temporal.task_queue": String(info.taskQueue ?? ""),
        "temporal.workflow_type": String(info.workflowType ?? ""),
      };
      if (tenantId) attributes["tenant.id"] = tenantId;

      const tracer = trace.getTracer(TRACER_NAME, TRACER_VERSION);
      span = tracer.startSpan(
        `temporal.activity/${String(info.activityType ?? "unknown")}`,
        { kind: SpanKind.SERVER, attributes },
        parentCtx,
      );
      spanCtx = trace.setSpan(parentCtx, span);
    } catch (err) {
      logger.debug({ err }, "[telemetry] temporal activity span setup failed — running uninstrumented");
      return next(input);
    }

    // ── Instrumented execution: activity errors are recorded, then rethrown
    try {
      const result = await otelContext.with(spanCtx, () => next(input));
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw err;
    } finally {
      span.end();
    }
  }
}

/**
 * Worker-side factory (WorkerInterceptors.activity, @temporalio/worker 1.16).
 * One interceptor instance per activity execution is not required — the
 * factory may return a shared instance; state lives on the span, not `this`.
 */
const sharedInbound = new TemporalOtelActivityInbound();

export function makeTemporalOtelActivityInterceptors(): ActivityInterceptorsFactory {
  return (): ActivityInterceptors => ({ inbound: sharedInbound });
}
