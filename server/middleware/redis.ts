/**
 * RemitFlow — Redis Client (Production v79)
 * Uses ioredis with graceful degradation when Redis unavailable.
 */
import Redis from "ioredis";
import { logger } from '../_core/logger';

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
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

// ── Redis Client ──────────────────────────────────────────────────────────────
let _redis: Redis | null = null;
let _connectionFailed = false;

export function getRedisClient(): Redis | null {
  if (_connectionFailed) return null;
  if (_redis && _redis.status === "ready") return _redis;
  try {
    const opts: Record<string, unknown> = {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times: number) => times > 3 ? null : Math.min(times * 100, 2000),
    };
    if (REDIS_PASSWORD) opts.password = REDIS_PASSWORD;
    _redis = new Redis(REDIS_URL, opts);
    _redis.on("connect", () => logger.info({ data: REDIS_URL }, '[Redis] Connected to'));
    _redis.on("error", (err) => {
      if (!_connectionFailed) {
        _connectionFailed = true;
        logger.warn({ data: err.message }, '[Redis] Connection failed — degraded mode:');
      }
    });
    _redis.on("ready", () => { _connectionFailed = false; });
    _redis.connect().catch(() => { _connectionFailed = true; });
    return _redis;
  } catch (err) {
    _connectionFailed = true;
    logger.warn("[Redis] Init failed:", (err as Error).message);
    return null;
  }
}

// ── Cache Operations ──────────────────────────────────────────────────────────
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

// ── Rate Limiting ─────────────────────────────────────────────────────────────
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

// ── Idempotency ───────────────────────────────────────────────────────────────
export async function setIdempotencyKey(key: string, result: unknown, ttlSeconds = 86400): Promise<void> {
  await cacheSet(REDIS_KEYS.IDEMPOTENCY(key), result, ttlSeconds);
}

export async function getIdempotencyKey(key: string): Promise<unknown | null> {
  return cacheGet(REDIS_KEYS.IDEMPOTENCY(key));
}

export async function disconnectRedis(): Promise<void> {
  if (_redis) { await _redis.quit(); _redis = null; }
}
