/**
 * RemitFlow — OpenTelemetry SDK Instrumentation
 * ══════════════════════════════════════════════════════════════════════════════
 * Bootstraps distributed tracing, metrics, and logging correlation for the
 * Node.js API server. Must be imported BEFORE any other server module.
 *
 * Exports:
 *   - tracer       : OpenTelemetry Tracer instance
 *   - meter        : OpenTelemetry Meter instance
 *   - withSpan()   : Helper to wrap async operations in a span
 *   - recordMetric(): Helper to record custom metrics
 *
 * Configuration via environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  — OTLP collector endpoint (default: http://localhost:4318)
 *   OTEL_SERVICE_NAME            — Service name (default: remitflow-api)
 *   OTEL_SERVICE_VERSION         — Service version (default: 1.0.0)
 *   OTEL_TRACES_SAMPLER          — Sampler type (default: parentbased_traceidratio)
 *   OTEL_TRACES_SAMPLER_ARG      — Sample rate 0.0–1.0 (default: 0.1 in prod, 1.0 in dev)
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { Resource } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { trace, metrics, context, SpanStatusCode, SpanKind } from "@opentelemetry/api";
import type { Span, Tracer, Meter } from "@opentelemetry/api";
import { logger } from "../_core/logger";

// ── Configuration ─────────────────────────────────────────────────────────────

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? "remitflow-api";
const SERVICE_VERSION = process.env.OTEL_SERVICE_VERSION ?? "1.0.0";
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SAMPLE_RATE = IS_PRODUCTION ? 0.1 : 1.0;

// ── Resource ─────────────────────────────────────────────────────────────────

const resource = new Resource({
  [SEMRESATTRS_SERVICE_NAME]: SERVICE_NAME,
  [SEMRESATTRS_SERVICE_VERSION]: SERVICE_VERSION,
  [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV ?? "development",
  "remitflow.component": "api-server",
  "remitflow.region": process.env.DEPLOYMENT_REGION ?? "local",
});

// ── Exporters ─────────────────────────────────────────────────────────────────

const traceExporter = new OTLPTraceExporter({
  url: `${OTLP_ENDPOINT}/v1/traces`,
  headers: {
    "x-service-name": SERVICE_NAME,
  },
});

const metricExporter = new OTLPMetricExporter({
  url: `${OTLP_ENDPOINT}/v1/metrics`,
});

// ── SDK Initialization ────────────────────────────────────────────────────────

let sdk: NodeSDK | null = null;

export function initTelemetry(): void {
  if (sdk) return;

  const spanProcessors = IS_PRODUCTION
    ? [new BatchSpanProcessor(traceExporter)]
    : [new SimpleSpanProcessor(new ConsoleSpanExporter()), new BatchSpanProcessor(traceExporter)];

  sdk = new NodeSDK({
    resource,
    spanProcessors,
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 30_000,
    }),
  });

  try {
    sdk.start();
    logger.info({ service: SERVICE_NAME, endpoint: OTLP_ENDPOINT, sampleRate: SAMPLE_RATE }, "OpenTelemetry SDK initialized");
  } catch (err) {
    logger.warn({ err }, "OpenTelemetry SDK failed to start — continuing without telemetry");
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      logger.info("OpenTelemetry SDK shut down cleanly");
    } catch (err) {
      logger.warn({ err }, "OpenTelemetry SDK shutdown error");
    }
  }
}

// ── Tracer & Meter Accessors ──────────────────────────────────────────────────

export function getTracer(name: string = SERVICE_NAME): Tracer {
  return trace.getTracer(name, SERVICE_VERSION);
}

export function getMeter(name: string = SERVICE_NAME): Meter {
  return metrics.getMeter(name, SERVICE_VERSION);
}

// ── Span Helpers ──────────────────────────────────────────────────────────────

/**
 * Wraps an async operation in an OpenTelemetry span.
 * Automatically records errors and sets span status.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options: {
    kind?: SpanKind;
    attributes?: Record<string, string | number | boolean>;
  } = {}
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(
    name,
    { kind: options.kind ?? SpanKind.INTERNAL, attributes: options.attributes },
    async (span) => {
      try {
        const result = await fn(span);
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
  );
}

// ── Metric Helpers ────────────────────────────────────────────────────────────

const _meter = () => getMeter();

/** Record a transfer event metric */
export function recordTransferMetric(
  status: "initiated" | "completed" | "failed" | "cancelled",
  corridor: string,
  amountUsd: number
): void {
  const counter = _meter().createCounter("remitflow.transfers.total", {
    description: "Total number of transfer events",
    unit: "1",
  });
  const histogram = _meter().createHistogram("remitflow.transfers.amount_usd", {
    description: "Transfer amounts in USD",
    unit: "USD",
  });
  counter.add(1, { status, corridor });
  histogram.record(amountUsd, { status, corridor });
}

/** Record KYC event metric */
export function recordKycMetric(
  event: "submitted" | "approved" | "rejected" | "escalated",
  tier: string
): void {
  const counter = _meter().createCounter("remitflow.kyc.events.total", {
    description: "Total KYC lifecycle events",
    unit: "1",
  });
  counter.add(1, { event, tier });
}

/** Record API latency */
export function recordApiLatency(
  route: string,
  method: string,
  statusCode: number,
  durationMs: number
): void {
  const histogram = _meter().createHistogram("remitflow.api.request.duration_ms", {
    description: "API request duration in milliseconds",
    unit: "ms",
  });
  histogram.record(durationMs, {
    route,
    method,
    status_code: String(statusCode),
  });
}

/** Record middleware health metric */
export function recordMiddlewareHealth(
  service: string,
  healthy: boolean,
  latencyMs: number
): void {
  const gauge = _meter().createObservableGauge("remitflow.middleware.health", {
    description: "Middleware service health status (1=healthy, 0=unhealthy)",
    unit: "1",
  });
  gauge.addCallback((result) => {
    result.observe(healthy ? 1 : 0, { service });
  });

  const histogram = _meter().createHistogram("remitflow.middleware.latency_ms", {
    description: "Middleware service health check latency",
    unit: "ms",
  });
  histogram.record(latencyMs, { service });
}

// ── Express Middleware for Request Tracing ────────────────────────────────────

import type { Request, Response, NextFunction } from "express";

export function otelRequestMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const tracer = getTracer();

  tracer.startActiveSpan(
    `${req.method} ${req.path}`,
    { kind: SpanKind.SERVER },
    (span) => {
      span.setAttributes({
        "http.method": req.method,
        "http.url": req.url,
        "http.route": req.path,
        "http.user_agent": req.headers["user-agent"] ?? "",
        "http.request_id": (req.headers["x-request-id"] as string) ?? "",
        "net.peer.ip": req.ip ?? "",
      });

      // Propagate trace context to response headers
      const traceId = span.spanContext().traceId;
      res.setHeader("x-trace-id", traceId);

      res.on("finish", () => {
        const durationMs = Date.now() - startTime;
        span.setAttributes({
          "http.status_code": res.statusCode,
          "http.response_time_ms": durationMs,
        });

        if (res.statusCode >= 500) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${res.statusCode}` });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }

        span.end();
        recordApiLatency(req.path, req.method, res.statusCode, durationMs);
      });

      next();
    }
  );
}
