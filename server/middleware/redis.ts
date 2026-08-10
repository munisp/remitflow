/**
 * RemitFlow — Redis Cache Facade (signature-compatible shim)
 *
 * Consolidation note: this module NO LONGER owns a Redis connection. All
 * connectivity lives in ./redisHardened (the single implementation:
 * standalone | sentinel | cluster). This facade preserves the historical
 * call signatures used by ~15 routers/middleware so importers keep working.
 *
 * Failure semantics (see redisHardened.ts for the full policy):
 *   - cacheGet/cacheSet/cacheDel/cacheIncr — BEST-EFFORT cache operations.
 *     On Redis outage they return null/false/0 and callers fall back to the
 *     primary store. Documented trade-off: cache unavailability must not
 *     take down reads.
 *   - setIdempotencyKey/getIdempotencyKey — FINANCIAL ops: FAIL-CLOSED in
 *     production via the hardened client's "idempotency-check" critical op.
 */
import type Redis from "ioredis";
import { logger } from '../_core/logger';
import {
  getRedisClientSync,
  redisGet,
  redisSet,
  disconnectRedis as disconnectHardened,
} from "./redisHardened";

const DEFAULT_TTL = 300; // 5 minutes

// ── Key Namespaces ────────────────────────────────────────────────────────────
export const REDIS_KEYS = {
  FX_RATE: (base: string, quote: string) => `fx:rate:${base}:${quote}`,
  FX_RATES_ALL: "fx:rates:all",
  USER_SESSION: (userId: string | number) => `session:${userId}`,
  USER_PROFILE: (userId: string | number) => `user:profile:${userId}`,
  RATE_LIMIT: (key: string) => `ratelimit:${key}`,
  IDEMPOTENCY: (key: string) => `idempotency:${key}`,
  RISK_SCORE: (txId: string | number) => `risk:score:${txId}`,
  LOCKED_RATE: (lockId: string) => `fx:lock:${lockId}`,
  KYC_STATUS: (userId: string | number) => `kyc:status:${userId}`,
  TRANSFER_LIMIT: (userId: string | number) => `limit:transfer:${userId}`,
  COMPLIANCE_CACHE: (userId: string | number) => `compliance:${userId}`,
  LEADERBOARD: "referral:leaderboard",
  ACTIVE_SESSIONS: "sessions:active",
} as const;

// ── Redis Client (delegates to the hardened singleton) ───────────────────────

export function getRedisClient(): Redis | null {
  return getRedisClientSync() as Redis | null;
}

export function requireRedisClient(): Redis {
  const client = getRedisClient();
  if (!client) throw new Error("Redis is unavailable for this operation");
  return client;
}

// ── Cache Operations (best-effort; see header for failure semantics) ─────────
export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedisClient();
  if (!r) return null;
  try {
    const val = await r.get(key);
    return val ? JSON.parse(val) as T : null;
  } catch { return null; }
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds = DEFAULT_TTL): Promise<boolean> {
  const r = getRedisClient();
  if (!r) return false;
  try {
    await r.setex(key, ttlSeconds, JSON.stringify(value));
    return true;
  } catch { return false; }
}

export async function cacheDel(key: string): Promise<boolean> {
  const r = getRedisClient();
  if (!r) return false;
  try { await r.del(key); return true; } catch { return false; }
}

export async function cacheIncr(key: string, ttlSeconds?: number): Promise<number> {
  const r = getRedisClient();
  if (!r) return 0;
  try {
    const val = await r.incr(key);
    if (ttlSeconds && val === 1) await r.expire(key, ttlSeconds);
    return val;
  } catch { return 0; }
}

// ── FX Rate Cache ─────────────────────────────────────────────────────────────
export async function cacheFxRate(base: string, quote: string, rate: number): Promise<void> {
  await cacheSet(REDIS_KEYS.FX_RATE(base, quote), { rate, cachedAt: Date.now() }, 60);
}

export async function getCachedFxRate(base: string, quote: string): Promise<number | null> {
  const cached = await cacheGet<{ rate: number }>(REDIS_KEYS.FX_RATE(base, quote));
  return cached?.rate ?? null;
}

// ── Rate Locking ──────────────────────────────────────────────────────────────
export async function storeLockRate(lockId: string, data: {
  fromCurrency: string; toCurrency: string; rate: number; expiresAt: number;
}): Promise<void> {
  const ttl = Math.max(1, Math.floor((data.expiresAt - Date.now()) / 1000));
  await cacheSet(REDIS_KEYS.LOCKED_RATE(lockId), data, ttl);
}

export async function getLockRate(lockId: string): Promise<{
  fromCurrency: string; toCurrency: string; rate: number; expiresAt: number;
} | null> {
  return cacheGet(REDIS_KEYS.LOCKED_RATE(lockId));
}

// ── Rate Limiting (fixed-window counter, best-effort) ────────────────────────
// NOTE: When Redis is unavailable this fails OPEN (allowed=true) because
// cacheIncr degrades to 0. Route-level abuse protection must therefore also
// rely on the go-rate-limiter sidecar; this is a secondary guard only.
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<{
  allowed: boolean; remaining: number; resetAt: number;
}> {
  const count = await cacheIncr(REDIS_KEYS.RATE_LIMIT(key), windowSeconds);
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt: Date.now() + windowSeconds * 1000,
  };
}

// ── Idempotency (financial op — fail-closed in production) ────────────────────
export async function setIdempotencyKey(key: string, result: unknown, ttlSeconds = 86400): Promise<void> {
  const ok = await redisSet(REDIS_KEYS.IDEMPOTENCY(key), JSON.stringify(result), ttlSeconds, "idempotency-check");
  if (!ok) {
    logger.warn({ key }, "[Redis] Idempotency result NOT persisted (dev best-effort; would fail-closed in production)");
  }
}

export async function getIdempotencyKey(key: string): Promise<unknown | null> {
  const raw = await redisGet(REDIS_KEYS.IDEMPOTENCY(key), "idempotency-check");
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

export async function disconnectRedis(): Promise<void> {
  await disconnectHardened();
}
