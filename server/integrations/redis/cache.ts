/**
 * RemitFlow — Redis Cache Integration
 * ─────────────────────────────────────
 * Type-safe Redis cache helpers for all hot-path lookups.
 *
 * Cache namespaces:
 *   - fx:rate:{from}:{to}         — FX rates (TTL: 60s)
 *   - session:{userId}            — User sessions (TTL: 3600s)
 *   - kyc:status:{userId}         — KYC status (TTL: 300s)
 *   - wallet:{userId}:{currency}  — Wallet balance (TTL: 30s)
 *   - idempotency:{key}           — Idempotency keys (TTL: 86400s)
 *   - compliance:{userId}         — Compliance status (TTL: 600s)
 *   - rate_limit:{ip}:{endpoint}  — Rate limit counters (TTL: 60s)
 *   - permify:{subject}:{entity}:{permission} — Authorization cache (TTL: 300s)
 *   - tb:balance:{accountId}      — TigerBeetle balance cache (TTL: 10s)
 */
import { logger } from "../../_core/logger";

// ─── Cache Key Builders ───────────────────────────────────────────────────────
export const CACHE_KEYS = {
  FX_RATE: (from: string, to: string) => `fx:rate:${from}:${to}`,
  SESSION: (userId: number) => `session:${userId}`,
  KYC_STATUS: (userId: number) => `kyc:status:${userId}`,
  WALLET: (userId: number, currency: string) => `wallet:${userId}:${currency}`,
  IDEMPOTENCY: (key: string) => `idempotency:${key}`,
  COMPLIANCE: (userId: number) => `compliance:${userId}`,
  RATE_LIMIT: (ip: string, endpoint: string) => `rate_limit:${ip}:${endpoint}`,
  PERMIFY: (subject: string, entity: string, permission: string) => `permify:${subject}:${entity}:${permission}`,
  TB_BALANCE: (accountId: string) => `tb:balance:${accountId}`,
  USER_PROFILE: (userId: number) => `user:profile:${userId}`,
  FX_ALERT: (userId: number) => `fx:alerts:${userId}`,
} as const;

// ─── TTL Constants ────────────────────────────────────────────────────────────
export const CACHE_TTL = {
  FX_RATE: 60,
  SESSION: 3600,
  KYC_STATUS: 300,
  WALLET: 30,
  IDEMPOTENCY: 86400,
  COMPLIANCE: 600,
  RATE_LIMIT: 60,
  PERMIFY: 300,
  TB_BALANCE: 10,
  USER_PROFILE: 300,
  FX_ALERT: 120,
} as const;

// ─── Redis Client Accessor ────────────────────────────────────────────────────
async function getClient() {
  try {
    const { getRedisClient } = await import("../../middleware/redis");
    return getRedisClient();
  } catch {
    return null;
  }
}

// ─── Generic Cache Operations ─────────────────────────────────────────────────
export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = await getClient();
  if (!client) return null;

  try {
    const value = await client.get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch (err) {
    logger.warn({ err, key }, "[Redis] Cache get failed");
    return null;
  }
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const client = await getClient();
  if (!client) return;

  try {
    await client.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    logger.warn({ err, key }, "[Redis] Cache set failed");
  }
}

export async function cacheDel(key: string): Promise<void> {
  const client = await getClient();
  if (!client) return;

  try {
    await client.del(key);
  } catch (err) {
    logger.warn({ err, key }, "[Redis] Cache del failed");
  }
}

export async function cacheDelPattern(pattern: string): Promise<void> {
  const client = await getClient();
  if (!client) return;

  try {
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(...keys);
      logger.debug({ pattern, count: keys.length }, "[Redis] Cache pattern deleted");
    }
  } catch (err) {
    logger.warn({ err, pattern }, "[Redis] Cache pattern del failed");
  }
}

// ─── Cache-Aside Pattern ──────────────────────────────────────────────────────
export async function cacheAside<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;

  const value = await fetcher();
  await cacheSet(key, value, ttlSeconds);
  return value;
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────
export async function incrementRateLimit(ip: string, endpoint: string, limit: number): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const client = await getClient();
  if (!client) return { allowed: true, remaining: limit, resetAt: Date.now() + 60000 };

  const key = CACHE_KEYS.RATE_LIMIT(ip, endpoint);

  try {
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, CACHE_TTL.RATE_LIMIT);
    }
    const ttl = await client.ttl(key);
    const remaining = Math.max(0, limit - count);
    return {
      allowed: count <= limit,
      remaining,
      resetAt: Date.now() + ttl * 1000,
    };
  } catch (err) {
    logger.warn({ err, ip, endpoint }, "[Redis] Rate limit check failed");
    return { allowed: true, remaining: limit, resetAt: Date.now() + 60000 };
  }
}

// ─── Typed Cache Helpers ──────────────────────────────────────────────────────
export const remitflowCache = {
  getFxRate: (from: string, to: string) =>
    cacheGet<{ rate: string; timestamp: string }>(CACHE_KEYS.FX_RATE(from, to)),

  setFxRate: (from: string, to: string, rate: string) =>
    cacheSet(CACHE_KEYS.FX_RATE(from, to), { rate, timestamp: new Date().toISOString() }, CACHE_TTL.FX_RATE),

  getKycStatus: (userId: number) =>
    cacheGet<{ tier: string; status: string }>(CACHE_KEYS.KYC_STATUS(userId)),

  setKycStatus: (userId: number, tier: string, status: string) =>
    cacheSet(CACHE_KEYS.KYC_STATUS(userId), { tier, status }, CACHE_TTL.KYC_STATUS),

  invalidateKycStatus: (userId: number) =>
    cacheDel(CACHE_KEYS.KYC_STATUS(userId)),

  getWalletBalance: (userId: number, currency: string) =>
    cacheGet<{ balance: string; lockedBalance: string }>(CACHE_KEYS.WALLET(userId, currency)),

  setWalletBalance: (userId: number, currency: string, balance: string, lockedBalance: string) =>
    cacheSet(CACHE_KEYS.WALLET(userId, currency), { balance, lockedBalance }, CACHE_TTL.WALLET),

  invalidateWallet: (userId: number, currency?: string) =>
    currency
      ? cacheDel(CACHE_KEYS.WALLET(userId, currency))
      : cacheDelPattern(`wallet:${userId}:*`),

  getPermifyDecision: (subject: string, entity: string, permission: string) =>
    cacheGet<boolean>(CACHE_KEYS.PERMIFY(subject, entity, permission)),

  setPermifyDecision: (subject: string, entity: string, permission: string, allowed: boolean) =>
    cacheSet(CACHE_KEYS.PERMIFY(subject, entity, permission), allowed, CACHE_TTL.PERMIFY),

  invalidatePermify: (subject: string) =>
    cacheDelPattern(`permify:${subject}:*`),

  getTbBalance: (accountId: string) =>
    cacheGet<{ debits: string; credits: string }>(CACHE_KEYS.TB_BALANCE(accountId)),

  setTbBalance: (accountId: string, debits: string, credits: string) =>
    cacheSet(CACHE_KEYS.TB_BALANCE(accountId), { debits, credits }, CACHE_TTL.TB_BALANCE),

  getUserProfile: (userId: number) =>
    cacheAside(CACHE_KEYS.USER_PROFILE(userId), CACHE_TTL.USER_PROFILE, async () => {
      // Fetcher is injected at call site
      return null as unknown as Record<string, unknown>;
    }),
};
