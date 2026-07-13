/**
 * serviceProxy.ts — lightweight HTTP client for internal microservice calls.
 * Wraps fetch with retry logic, timeout, and structured error handling.
 */

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const defaultHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Internal-Service": "remitflow-api",
    ...headers,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(serviceUrl, {
        method,
        headers: defaultHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

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
      if (attempt < retries) {
        // Exponential back-off: 200ms, 400ms
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
      }
    }
  }

  clearTimeout(timer);
  throw lastError ?? new Error(`callService failed: ${serviceUrl}`);
}
