/**
 * RemitFlow — Per-Tenant OpenTelemetry Enrichment (W11-C2)
 * ══════════════════════════════════════════════════════════════════════════════
 * Helpers that stamp tenant.id / enduser.id onto the CURRENT ACTIVE span and
 * record per-request counter/histogram metrics carrying the tenant.id attribute.
 *
 * FAIL-SOFT POSTURE (hard rule):
 *   Telemetry must NEVER block or break a money path. Every helper in this
 *   module is wrapped — any OpenTelemetry failure is debug-logged and becomes
 *   a no-op. Absence of telemetry is logged, never faked: when there is no
 *   active span, no tenant, or the SDK failed to start, we simply emit nothing
 *   (no synthetic "unknown" tenant values are invented).
 *
 * Attribute conventions:
 *   tenant.id    — RemitFlow tenant primary key (string), OMITTED when the
 *                  caller has no tenant (public routes, pre-tenant users).
 *   enduser.id   — authenticated user id (semantic conventions).
 *
 * Metrics:
 *   remitflow_requests_total         (counter)   attrs: rpc.method, rpc.type, ok, tenant.id?
 *   remitflow_request_duration_ms    (histogram) attrs: rpc.method, rpc.type, ok, tenant.id?
 */

import { trace, metrics } from "@opentelemetry/api";
import { logger } from "../_core/logger";

// ── Instruments ───────────────────────────────────────────────────────────────
// Created against the global meter provider. If the SDK has not started yet
// (or failed to start) these are no-op proxies — safe by construction.

const meter = metrics.getMeter("remitflow-tenant", "1.0.0");

const requestsTotal = meter.createCounter("remitflow_requests_total", {
  description: "Total tRPC requests, tagged with tenant.id when resolvable",
  unit: "1",
});

const requestDurationMs = meter.createHistogram("remitflow_request_duration_ms", {
  description: "tRPC request duration in milliseconds, tagged with tenant.id when resolvable",
  unit: "ms",
});

// ── Span enrichment ───────────────────────────────────────────────────────────

/**
 * Set tenant.id + enduser.id on the CURRENT ACTIVE span.
 * - tenantId null/undefined → attribute omitted (honest: public route or
 *   tenant-less user), never a placeholder value.
 * - No active span → silent no-op (e.g. sampled-out or non-request context).
 * - Never throws.
 */
export function setTenantSpanAttributes(
  tenantId: string | number | null | undefined,
  endUserId?: string | number | null,
): void {
  try {
    const span = trace.getActiveSpan();
    if (!span) return;
    if (tenantId !== null && tenantId !== undefined && tenantId !== "") {
      span.setAttribute("tenant.id", String(tenantId));
    }
    if (endUserId !== null && endUserId !== undefined && endUserId !== "") {
      span.setAttribute("enduser.id", String(endUserId));
    }
  } catch (err) {
    logger.debug({ err }, "[telemetry] setTenantSpanAttributes failed — skipped");
  }
}

// ── Request metrics ───────────────────────────────────────────────────────────

export interface TenantRequestMetric {
  /** tRPC procedure path, e.g. "transfer.create" */
  path: string;
  /** tRPC call type: query | mutation | subscription */
  type: string;
  /** End-to-end procedure duration in milliseconds */
  durationMs: number;
  /** Whether the procedure completed without throwing */
  ok: boolean;
  /** Tenant id; omitted from attributes when absent */
  tenantId?: string | number | null;
}

/**
 * Record remitflow_requests_total + remitflow_request_duration_ms for one
 * request. tenant.id is added to the attribute set ONLY when present — we do
 * not emit "unknown"/"" buckets that would distort per-tenant dashboards.
 * Never throws.
 */
export function recordTenantRequest(metric: TenantRequestMetric): void {
  try {
    const attrs: Record<string, string> = {
      "rpc.system": "trpc",
      "rpc.method": metric.path,
      "rpc.type": metric.type,
      ok: String(metric.ok),
    };
    if (metric.tenantId !== null && metric.tenantId !== undefined && metric.tenantId !== "") {
      attrs["tenant.id"] = String(metric.tenantId);
    }
    requestsTotal.add(1, attrs);
    requestDurationMs.record(metric.durationMs, attrs);
  } catch (err) {
    logger.debug({ err }, "[telemetry] recordTenantRequest failed — skipped");
  }
}
