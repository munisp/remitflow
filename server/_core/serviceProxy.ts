/**
 * serviceProxy.ts — lightweight HTTP client for internal microservice calls.
 * Wraps fetch with retry logic, timeout, and structured error handling.
 */

import { context as otelContext, propagation, defaultTextMapSetter } from "@opentelemetry/api";
import { getRequestTenantContext } from "./tenantGuc";

// ── W3C trace-context + tenant propagation (W12-F) ────────────────────────────
// Inject traceparent/tracestate + X-Tenant-Id on every outbound internal
// service call so downstream receivers can continue the trace and attribute
// the tenant. Same mechanism as server/middleware/kafka.ts injectTraceContext.
// FAIL-SOFT: never throws; headers are omitted when no span/tenant is active.
function telemetryHeaders(): Record<string, string> {
  try {
    const carrier: Record<string, string> = {};
    propagation.inject(otelContext.active(), carrier, defaultTextMapSetter);
    const tenantId = getRequestTenantContext()?.tenantId;
    if (tenantId) carrier["X-Tenant-Id"] = tenantId;
    return carrier;
  } catch {
    return {};
  }
}

export interface ServiceCallOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

export class ServiceCallError extends Error {
  constructor(
    public readonly service: string,
    public readonly status: number,
    message: string
  ) {
    super(`[${service}] HTTP ${status}: ${message}`);
    this.name = "ServiceCallError";
  }
}

/**
 * Call an internal microservice endpoint.
 *
 * @param serviceUrl  Full URL of the target service endpoint
 * @param options     Optional method, body, headers, timeout, retries
 * @returns           Parsed JSON response body
 */
export async function callService<T = unknown>(
  serviceUrl: string,
  options: ServiceCallOptions = {}
): Promise<T> {
  const {
    method = "GET",
    body,
    headers = {},
    timeoutMs = 10_000,
    retries = 2,
  } = options;

  const defaultHeaders: Record<string, string> = {
    // W12-F: trace/tenant propagation first — caller headers win on conflict.
    ...telemetryHeaders(),
    "Content-Type": "application/json",
    "X-Internal-Service": "remitflow-api",
    ...headers,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    // W14-C1: timeout is per-attempt — the previous single AbortController was
    // cleared after the first response, so retries ran with NO timeout at all.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(serviceUrl, {
        method,
        headers: defaultHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ServiceCallError(serviceUrl, res.status, text);
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        return (await res.json()) as T;
      }
      return (await res.text()) as unknown as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // W14-C1: never retry a 4xx — the service understood and REJECTED the
      // request; replaying it returns the same verdict and only adds load
      // (and, on money-adjacent endpoints, duplicate-work risk). Retries are
      // reserved for network failures, timeouts/aborts, and 5xx.
      if (err instanceof ServiceCallError && err.status >= 400 && err.status < 500) {
        break;
      }
      if (attempt < retries) {
        // Exponential back-off with jitter: base 200ms, 400ms, ... ×(0.5–1.5)
        const base = 200 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, base * (0.5 + Math.random())));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`callService failed: ${serviceUrl}`);
}
