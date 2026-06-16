/**
 * Distributed tracing — P1 Observability 7.4
 * OpenTelemetry-compatible tracing for cross-service request tracking.
 */

interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: number;
}

interface Span {
  context: SpanContext;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, string | number | boolean>;
  events: Array<{ name: string; timestamp: number; attributes?: Record<string, string | number> }>;
  status: "OK" | "ERROR" | "UNSET";
}

const activeSpans = new Map<string, Span>();
const completedSpans: Span[] = [];
const MAX_COMPLETED = 10000;

function generateId(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function startSpan(name: string, parentContext?: SpanContext): Span {
  const span: Span = {
    context: {
      traceId: parentContext?.traceId ?? generateId(16),
      spanId: generateId(8),
      parentSpanId: parentContext?.spanId,
      traceFlags: 1,
    },
    name,
    startTime: Date.now(),
    attributes: {},
    events: [],
    status: "UNSET",
  };

  activeSpans.set(span.context.spanId, span);
  return span;
}

export function endSpan(span: Span, status: "OK" | "ERROR" = "OK"): void {
  span.endTime = Date.now();
  span.status = status;
  activeSpans.delete(span.context.spanId);
  completedSpans.push(span);
  if (completedSpans.length > MAX_COMPLETED) {
    completedSpans.splice(0, completedSpans.length - MAX_COMPLETED / 2);
  }

  exportSpan(span);
}

export function addSpanAttribute(span: Span, key: string, value: string | number | boolean): void {
  span.attributes[key] = value;
}

export function addSpanEvent(span: Span, name: string, attributes?: Record<string, string | number>): void {
  span.events.push({ name, timestamp: Date.now(), attributes });
}

export function extractTraceContext(headers: Record<string, string | undefined>): SpanContext | undefined {
  const traceparent = headers["traceparent"];
  if (!traceparent) return undefined;

  const parts = traceparent.split("-");
  if (parts.length !== 4) return undefined;

  return {
    traceId: parts[1],
    spanId: parts[2],
    traceFlags: parseInt(parts[3], 16),
  };
}

export function injectTraceContext(span: Span): Record<string, string> {
  return {
    traceparent: `00-${span.context.traceId}-${span.context.spanId}-${span.context.traceFlags.toString(16).padStart(2, "0")}`,
  };
}

async function exportSpan(span: Span): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  try {
    await fetch(`${endpoint}/v1/traces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: "remitflow-api" } },
                { key: "service.version", value: { stringValue: process.env.APP_VERSION ?? "2.0.0" } },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: span.context.traceId,
                    spanId: span.context.spanId,
                    parentSpanId: span.context.parentSpanId ?? "",
                    name: span.name,
                    startTimeUnixNano: span.startTime * 1_000_000,
                    endTimeUnixNano: (span.endTime ?? Date.now()) * 1_000_000,
                    attributes: Object.entries(span.attributes).map(([key, value]) => ({
                      key,
                      value: typeof value === "string" ? { stringValue: value } : { intValue: value },
                    })),
                    status: { code: span.status === "OK" ? 1 : span.status === "ERROR" ? 2 : 0 },
                  },
                ],
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // silently fail — don't let tracing errors affect the app
  }
}

export function tracingMiddleware(operationName: string) {
  return async function <T>(fn: (span: Span) => Promise<T>, parentContext?: SpanContext): Promise<T> {
    const span = startSpan(operationName, parentContext);
    try {
      const result = await fn(span);
      endSpan(span, "OK");
      return result;
    } catch (error) {
      addSpanAttribute(span, "error", true);
      addSpanAttribute(span, "error.message", error instanceof Error ? error.message : String(error));
      endSpan(span, "ERROR");
      throw error;
    }
  };
}

export function getTraceStats(): {
  activeSpans: number;
  completedSpans: number;
  avgDurationMs: number;
  errorRate: number;
} {
  const completed = completedSpans.slice(-1000);
  const durations = completed
    .filter((s) => s.endTime)
    .map((s) => (s.endTime ?? 0) - s.startTime);
  const errors = completed.filter((s) => s.status === "ERROR").length;

  return {
    activeSpans: activeSpans.size,
    completedSpans: completedSpans.length,
    avgDurationMs: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    errorRate: completed.length > 0 ? errors / completed.length : 0,
  };
}
