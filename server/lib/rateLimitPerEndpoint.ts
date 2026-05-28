/**
 * Per-endpoint rate limiting — P1 Security 5.4
 * Different limits for auth, transfers, queries, admin.
 */
import { BoundedCache, registerCache } from "./boundedCache";

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

const ENDPOINT_LIMITS: Record<string, RateLimitConfig> = {
  "auth.login": { windowMs: 60_000, maxRequests: 5, keyPrefix: "rl:auth" },
  "auth.register": { windowMs: 300_000, maxRequests: 3, keyPrefix: "rl:register" },
  "auth.refresh": { windowMs: 60_000, maxRequests: 10, keyPrefix: "rl:refresh" },
  "transfer.send": { windowMs: 60_000, maxRequests: 20, keyPrefix: "rl:transfer" },
  "transfer.confirm": { windowMs: 60_000, maxRequests: 10, keyPrefix: "rl:transfer_confirm" },
  "fx.convert": { windowMs: 60_000, maxRequests: 30, keyPrefix: "rl:fx" },
  "kyc.submit": { windowMs: 300_000, maxRequests: 5, keyPrefix: "rl:kyc" },
  "admin.*": { windowMs: 60_000, maxRequests: 100, keyPrefix: "rl:admin" },
  default: { windowMs: 60_000, maxRequests: 100, keyPrefix: "rl:default" },
};

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new BoundedCache<string, RateLimitEntry>({
  maxSize: 50_000,
  defaultTtlMs: 300_000, // 5 minutes max window
  name: "rate-limit-per-endpoint",
});
registerCache(store as unknown as BoundedCache<unknown, unknown>);

export function checkRateLimit(
  endpoint: string,
  clientKey: string
): { allowed: boolean; remaining: number; resetAt: number; limit: number } {
  const config =
    ENDPOINT_LIMITS[endpoint] ??
    Object.entries(ENDPOINT_LIMITS).find(([pattern]) => {
      if (pattern.endsWith(".*")) {
        return endpoint.startsWith(pattern.slice(0, -2));
      }
      return false;
    })?.[1] ??
    ENDPOINT_LIMITS.default;

  const key = `${config.keyPrefix}:${clientKey}`;
  const now = Date.now();
  let entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 1, resetAt: now + config.windowMs };
    store.set(key, entry, config.windowMs);
  } else {
    entry = { count: entry.count + 1, resetAt: entry.resetAt };
    store.set(key, entry, entry.resetAt - now);
  }

  return {
    allowed: entry.count <= config.maxRequests,
    remaining: Math.max(0, config.maxRequests - entry.count),
    resetAt: entry.resetAt,
    limit: config.maxRequests,
  };
}

export function getRateLimitHeaders(result: ReturnType<typeof checkRateLimit>): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": new Date(result.resetAt).toUTCString(),
  };
}

export function compoundKey(ip: string, userId?: string | number): string {
  return userId ? `${ip}:${userId}` : ip;
}
