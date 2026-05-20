/**
 * OpenTelemetry Instrumentation for RemitFlow
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Provides distributed tracing, metrics, and context propagation across:
 *   - Express HTTP requests
 *   - tRPC procedure calls
 *   - PostgreSQL queries (via pg instrumentation)
 *   - Redis operations
 *   - Fetch/HTTP outbound calls (to microservices, payment rails)
 *   - Kafka producer/consumer
 *   - Temporal workflow activities
 *
 * Configure via environment variables:
 *   OTEL_SERVICE_NAME         = remitflow-api (default)
 *   OTEL_EXPORTER_OTLP_ENDPOINT = http://localhost:4318 (default, OTLP/HTTP)
 *   OTEL_EXPORTER_TYPE        = otlp | console | none
 *   OTEL_TRACES_SAMPLER       = parentbased_traceidratio
 *   OTEL_TRACES_SAMPLER_ARG   = 1.0 (sample 100% in dev, lower in prod)
 *
 * This file MUST be imported before any other modules (use --require or top of entrypoint).
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { Resource } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from "@opentelemetry/semantic-conventions";
import { diag, DiagConsoleLogger, DiagLogLevel, SpanStatusCode, trace, context, propagation } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";

// ─── Configuration ───────────────────────────────────────────────────────────

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? "remitflow-api";
const SERVICE_VERSION = process.env.npm_package_version ?? "2.0.0";
const ENVIRONMENT = process.env.NODE_ENV ?? "development";
const EXPORTER_TYPE = process.env.OTEL_EXPORTER_TYPE ?? "otlp";
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

// Enable OTel debug logging in development
if (ENVIRONMENT !== "production") {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
}

// ─── Resource ────────────────────────────────────────────────────────────────

const resource = new Resource({
  [ATTR_SERVICE_NAME]: SERVICE_NAME,
  [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
  [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: ENVIRONMENT,
  "service.namespace": "remitflow",
  "service.instance.id": process.env.HOSTNAME ?? `${SERVICE_NAME}-${process.pid}`,
});

// ─── Trace Exporter ──────────────────────────────────────────────────────────

function createTraceExporter() {
  switch (EXPORTER_TYPE) {
    case "console":
      return new ConsoleSpanExporter();
    case "none":
      return undefined;
    case "otlp":
    default:
      return new OTLPTraceExporter({
        url: `${OTLP_ENDPOINT}/v1/traces`,
        headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
          ? Object.fromEntries(
              process.env.OTEL_EXPORTER_OTLP_HEADERS.split(",").map((h) => {
                const [k, ...v] = h.split("=");
                return [k.trim(), v.join("=").trim()];
              })
            )
          : undefined,
      });
  }
}

// ─── Metric Exporter ─────────────────────────────────────────────────────────

function createMetricReader() {
  if (EXPORTER_TYPE === "none") return undefined;
  if (EXPORTER_TYPE === "console") return undefined;

  return new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${OTLP_ENDPOINT}/v1/metrics`,
    }),
    exportIntervalMillis: 15000,
  });
}

// ─── SDK Setup ───────────────────────────────────────────────────────────────

const sdk = new NodeSDK({
  resource,
  traceExporter: createTraceExporter(),
  metricReader: createMetricReader(),
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-http": {
        ignoreIncomingPaths: [/\/health$/, /\/metrics$/, /\/favicon\.ico$/],
        requestHook: (span, request) => {
          // Add RemitFlow-specific attributes
          if ("headers" in request && request.headers) {
            const reqId = (request.headers as Record<string, string | string[] | undefined>)["x-request-id"];
            if (reqId) span.setAttribute("remitflow.request_id", String(reqId));
          }
        },
      },
      "@opentelemetry/instrumentation-express": {
        enabled: true,
      },
      "@opentelemetry/instrumentation-pg": {
        enhancedDatabaseReporting: true,
      },
      "@opentelemetry/instrumentation-redis-4": {
        enabled: true,
      },
      "@opentelemetry/instrumentation-fetch": {
        enabled: true,
      },
      // Disable noisy filesystem instrumentation
      "@opentelemetry/instrumentation-fs": {
        enabled: false,
      },
    }),
  ],
  textMapPropagator: new W3CTraceContextPropagator(),
});

// ─── Start SDK ───────────────────────────────────────────────────────────────

try {
  sdk.start();
  console.log(`[OpenTelemetry] Initialized: service=${SERVICE_NAME} env=${ENVIRONMENT} exporter=${EXPORTER_TYPE} endpoint=${OTLP_ENDPOINT}`);
} catch (err) {
  console.error("[OpenTelemetry] Failed to initialize:", err);
}

// Graceful shutdown
const shutdown = async () => {
  try {
    await sdk.shutdown();
    console.log("[OpenTelemetry] Shut down successfully");
  } catch (err) {
    console.error("[OpenTelemetry] Shutdown error:", err);
  }
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// ─── Helpers for manual span creation ────────────────────────────────────────

const tracer = trace.getTracer(SERVICE_NAME, SERVICE_VERSION);

/**
 * Wrap an async function with an OpenTelemetry span.
 * Use for business-critical paths (transfer execution, compliance checks, etc.)
 */
export function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean> = {},
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      for (const [k, v] of Object.entries(attributes)) {
        span.setAttribute(k, v);
      }
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Create a span for payment rail operations with standard attributes.
 */
export function withPaymentSpan<T>(
  rail: string,
  operation: string,
  transferId: string,
  amount: number,
  currency: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan(
    `payment.${rail}.${operation}`,
    {
      "payment.rail": rail,
      "payment.operation": operation,
      "payment.transfer_id": transferId,
      "payment.amount": amount,
      "payment.currency": currency,
    },
    fn,
  );
}

/**
 * Create a span for compliance operations.
 */
export function withComplianceSpan<T>(
  operation: string,
  transferId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withSpan(
    `compliance.${operation}`,
    {
      "compliance.operation": operation,
      "compliance.transfer_id": transferId,
    },
    fn,
  );
}

export { tracer, trace, context, propagation, SpanStatusCode };
