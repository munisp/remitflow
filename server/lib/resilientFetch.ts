/**
 * RemitFlow — Resilient HTTP Client
 *
 * Wraps fetch with:
 *  - Exponential backoff retries with jitter
 *  - Circuit breaker integration
 *  - Request timeout via AbortSignal
 *  - JWT inter-service authentication
 *  - Structured logging
 *
 * Usage:
 *   const data = await resilientFetch("fraud-ml", "http://fraud:8104/score", {
 *     method: "POST",
 *     body: JSON.stringify(payload),
 *   });
 */
import { logger } from "../_core/logger";
import { executeWithCircuitBreaker } from "../middleware/circuitBreaker";

// ── Config ───────────────────────────────────────────────────────────────────

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: Set<number>;
  retryableErrors: Set<string>;
}

interface ResilientFetchOptions extends RequestInit {
  timeoutMs?: number;
  retry?: Partial<RetryConfig>;
  circuitBreaker?: boolean;
  serviceName?: string;
  skipAuth?: boolean;
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  retryableStatuses: new Set([429, 502, 503, 504]),
  retryableErrors: new Set(["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "UND_ERR_CONNECT_TIMEOUT", "fetch failed"]),
};

const DEFAULT_TIMEOUT_MS = 15_000;

// ── Inter-service JWT ────────────────────────────────────────────────────────

const SERVICE_JWT_SECRET = process.env.INTER_SERVICE_JWT_SECRET || process.env.JWT_SECRET || "";

function generateServiceToken(): string {
  if (!SERVICE_JWT_SECRET) return "";
  // Lightweight HMAC-based service token (no full JWT library needed)
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "remitflow-api",
    sub: "internal-service",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300, // 5 min
    scope: "inter-service",
  })).toString("base64url");

  const { createHmac } = require("crypto");
  const signature = createHmac("sha256", SERVICE_JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function retryDelay(attempt: number, config: RetryConfig): number {
  const delay = Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs);
  const jitter = delay * 0.3 * (Math.random() * 2 - 1);
  return Math.max(50, delay + jitter);
}

function isRetryable(error: unknown, config: RetryConfig): boolean {
  if (error instanceof Error) {
    const msg = error.message || "";
    const codes = Array.from(config.retryableErrors);
    for (const code of codes) {
      if (msg.includes(code)) return true;
    }
  }
  return false;
}

// ── Main Export ──────────────────────────────────────────────────────────────

export async function resilientFetch<T = unknown>(
  serviceName: string,
  url: string,
  options: ResilientFetchOptions = {},
): Promise<{ data: T; status: number; latencyMs: number }> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retry: retryOverrides,
    circuitBreaker = true,
    skipAuth = false,
    ...fetchOpts
  } = options;

  const retryConfig: RetryConfig = {
    ...DEFAULT_RETRY,
    ...retryOverrides,
    retryableStatuses: retryOverrides?.retryableStatuses
      ? new Set(retryOverrides.retryableStatuses)
      : DEFAULT_RETRY.retryableStatuses,
    retryableErrors: retryOverrides?.retryableErrors
      ? new Set(retryOverrides.retryableErrors)
      : DEFAULT_RETRY.retryableErrors,
  };

  // Add inter-service auth header
  const headers = new Headers(fetchOpts.headers as HeadersInit | undefined);
  if (!skipAuth && SERVICE_JWT_SECRET) {
    headers.set("Authorization", `Bearer ${generateServiceToken()}`);
  }
  headers.set("X-Service-Name", "remitflow-api");
  if (!headers.has("Content-Type") && fetchOpts.body) {
    headers.set("Content-Type", "application/json");
  }

  const doFetch = async (): Promise<{ data: T; status: number; latencyMs: number }> => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = retryDelay(attempt - 1, retryConfig);
        logger.debug({ service: serviceName, attempt, delayMs: delay }, "[resilientFetch] retrying");
        await new Promise((r) => setTimeout(r, delay));
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const start = Date.now();

      try {
        const res = await fetch(url, {
          ...fetchOpts,
          headers,
          signal: controller.signal,
        });
        clearTimeout(timer);
        const latencyMs = Date.now() - start;

        if (retryConfig.retryableStatuses.has(res.status) && attempt < retryConfig.maxRetries) {
          lastError = new Error(`HTTP ${res.status} from ${serviceName}`);
          logger.warn({ service: serviceName, status: res.status, attempt }, "[resilientFetch] retryable status");
          continue;
        }

        const text = await res.text();
        let data: T;
        try {
          data = JSON.parse(text) as T;
        } catch {
          data = text as unknown as T;
        }

        if (!res.ok) {
          throw Object.assign(new Error(`${serviceName} returned ${res.status}: ${text.slice(0, 200)}`), {
            status: res.status,
            service: serviceName,
          });
        }

        return { data, status: res.status, latencyMs };
      } catch (err) {
        clearTimeout(timer);
        lastError = err instanceof Error ? err : new Error(String(err));

        if (!isRetryable(err, retryConfig) || attempt >= retryConfig.maxRetries) {
          throw lastError;
        }
      }
    }

    throw lastError || new Error(`${serviceName} failed after ${retryConfig.maxRetries} retries`);
  };

  if (circuitBreaker) {
    return executeWithCircuitBreaker(serviceName, doFetch);
  }
  return doFetch();
}

/**
 * Fire-and-forget HTTP call with resilience (for webhooks, audit logs, etc.)
 */
export function resilientFetchFireAndForget(
  serviceName: string,
  url: string,
  options: ResilientFetchOptions = {},
): void {
  resilientFetch(serviceName, url, { ...options, retry: { maxRetries: 1 } }).catch((err) => {
    logger.warn({ service: serviceName, error: (err as Error).message }, "[resilientFetch] fire-and-forget failed");
  });
}
