/**
 * RemitFlow Investment Feed Client
 * Typed HTTP client for the Go investment price-feed microservice
 * (services/go-investment-feed).
 *
 * REAL contract (the old :8087 /prices /quote /watchlist client targeted a
 * phantom service that never existed):
 *   GET  /health   — liveness probe (unauthenticated)
 *   GET  /metrics  — Prometheus counters (unauthenticated)
 *   POST /refresh  — pull the upstream NGX feed, validate, forward to the TS
 *                    ingest endpoint. Guarded by X-Internal-Key
 *                    (INTERNAL_SERVICE_KEY, constant-time compared).
 *
 * The feed serves NO price data to callers — prices land in the database via
 * the ingest path (ngxStocks.ingestPrices) and are read from there. This
 * client therefore exposes only health() and refresh().
 */

const INVESTMENT_FEED_BASE = process.env.INVESTMENT_FEED_URL ?? "http://localhost:8080";

const TIMEOUT_MS = 15_000;

export interface FeedHealthResponse {
  status: string;
  service?: string;
  version?: string;
  uptime_seconds?: number;
}

/** Mirrors refreshResult in services/go-investment-feed/main.go */
export interface FeedRefreshResponse {
  updated: number;
  rejected: number;
  errors: string[];
}

async function feedFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${INVESTMENT_FEED_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Investment feed error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const investmentFeedClient = {
  /** Health check — GET /health (unauthenticated). */
  health: (): Promise<FeedHealthResponse> => feedFetch("/health"),

  /**
   * Trigger a feed refresh — POST /refresh with the internal service key.
   * FAIL CLOSED: throws when INTERNAL_SERVICE_KEY is not configured rather
   * than falling back to a well-known default credential (the Go service
   * boots fail-closed on the same variable; a default here would only work
   * against a misconfigured peer).
   */
  refresh: (): Promise<FeedRefreshResponse> => {
    const internalKey = process.env.INTERNAL_SERVICE_KEY;
    if (!internalKey) {
      throw new Error("INTERNAL_SERVICE_KEY is not configured — cannot call go-investment-feed /refresh");
    }
    return feedFetch<FeedRefreshResponse>("/refresh", {
      method: "POST",
      headers: { "X-Internal-Key": internalKey },
    });
  },
};
