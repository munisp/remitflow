/**
 * Per-endpoint rate limiting — P1 Security 5.4
 * Redis-backed sliding window rate limiter for multi-instance deployment.
 * Falls back to in-memory BoundedCache if Redis is unavailable.
 */
import { createClient, type RedisClientType } from "redis";
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

// Redis client — lazy initialized
let redisClient: RedisClientType | null = null;
let redisAvailable = false;

async function getRedis(): Promise<RedisClientType | null> {
  if (redisClient && redisAvailable) return redisClient;
  if (redisClient === null) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    try {
      redisClient = createClient({ url }) as RedisClientType;
      redisClient.on("error", () => { redisAvailable = false; });
      redisClient.on("connect", () => { redisAvailable = true; });
      await redisClient.connect();
      redisAvailable = true;
      return redisClient;
    } catch {
      redisAvailable = false;
      return null;
    }
  }
  return redisAvailable ? redisClient : null;
}

// In-memory fallback (for single-instance or when Redis is down)
const memStore = new BoundedCache<string, RateLimitEntry>({
  maxSize: 50_000,
  defaultTtlMs: 300_000,
  name: "rate-limit-per-endpoint",
});
registerCache(memStore as unknown as BoundedCache<unknown, unknown>);

function resolveConfig(endpoint: string): RateLimitConfig {
  return (
    ENDPOINT_LIMITS[endpoint] ??
    Object.entries(ENDPOINT_LIMITS).find(([pattern]) => {
      if (pattern.endsWith(".*")) {
        return endpoint.startsWith(pattern.slice(0, -2));
      }
      return false;
    })?.[1] ??
    ENDPOINT_LIMITS.default
  );
}

/**
 * Redis-backed sliding window rate limit check.
 * Uses INCR + PEXPIRE for atomic window management.
 */
export async function checkRateLimitAsync(
  endpoint: string,
  clientKey: string
): Promise<{ allowed: boolean; remaining: number; resetAt: number; limit: number }> {
  const config = resolveConfig(endpoint);
  const key = `${config.keyPrefix}:${clientKey}`;
  const now = Date.now();

  const redis = await getRedis();
  if (redis) {
    try {
      const redisKey = `ratelimit:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) {
        await redis.pExpire(redisKey, config.windowMs);
      }
      const ttl = await redis.pTTL(redisKey);
      const resetAt = now + Math.max(ttl, 0);

      return {
        allowed: count <= config.maxRequests,
        remaining: Math.max(0, config.maxRequests - count),
        resetAt,
        limit: config.maxRequests,
      };
    } catch {
      // Fall through to in-memory
    }
  }

  // In-memory fallback
  return checkRateLimit(endpoint, clientKey);
}

/** Synchronous in-memory rate limit check (fallback) */
export function checkRateLimit(
  endpoint: string,
  clientKey: string
): { allowed: boolean; remaining: number; resetAt: number; limit: number } {
  const config = resolveConfig(endpoint);
  const key = `${config.keyPrefix}:${clientKey}`;
  const now = Date.now();
  let entry = memStore.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 1, resetAt: now + config.windowMs };
    memStore.set(key, entry, config.windowMs);
  } else {
    entry = { count: entry.count + 1, resetAt: entry.resetAt };
    memStore.set(key, entry, entry.resetAt - now);
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
