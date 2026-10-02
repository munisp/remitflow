import crypto from "crypto";
import { getRedisClient } from "../middleware/redis";
import { isFundFlowStrictMode } from "../middleware/redisHardened";
import { logger } from "../_core/logger";
import { reportWriteThroughFailure } from "./writeThroughTelemetry";

const MAX_RATE_DEVIATION_PCT = 0.5;
const RATE_LOCK_TTL_MS = 60_000; // 60 seconds

interface RateLock {
  userId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  expiresAt: number;
}

/**
 * W19-B: rate locks are now write-through to Redis
 * (`fx:ratelock:<token>`, SET PX 60s) so they are visible across replicas
 * and survive restarts.
 *
 * DEVIATION (approved by lead): the exported `createRateLock` /
 * `validateRateLock` keep their SYNC signatures because server/routers.ts
 * (:1625, :1856 — owned by another lane this wave) calls them synchronously.
 * The local Map therefore remains the synchronous read path, mirrored to
 * Redis. New callers MUST use the async Redis-atomic variants below
 * (`createRateLockAsync` / `validateRateLockAsync`), which make single-use
 * consumption atomic via GETDEL. A future wave should migrate routers.ts to
 * the async variants and delete the sync facade.
 */
const rateLocks = new Map<string, RateLock>();

const lockRedisKey = (token: string) => `fx:ratelock:${token}`;

export function createRateLock(
  userId: string,
  fromCurrency: string,
  toCurrency: string,
  rate: number
): string {
  const token = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + RATE_LOCK_TTL_MS;
  const lock: RateLock = { userId, fromCurrency, toCurrency, rate, expiresAt };

  rateLocks.set(token, lock);

  // Write-through to Redis (fail-open emit: the sync caller already has the
  // token; a failed mirror write is logged + counted, never silent).
  const redis = getRedisClient();
  if (redis) {
    redis
      .set(lockRedisKey(token), JSON.stringify(lock), "PX", RATE_LOCK_TTL_MS)
      .catch((err) => reportWriteThroughFailure("fx_rate_lock", err, "error"));
  } else {
    reportWriteThroughFailure("fx_rate_lock", new Error("Redis client unavailable — rate lock is process-local only"), "error");
  }

  return token;
}

export function validateRateLock(
  token: string,
  userId: string,
  fromCurrency: string,
  toCurrency: string,
  currentRate: number
): { valid: boolean; reason?: string; code?: string } {
  const lock = rateLocks.get(token);

  if (!lock) {
    return { valid: false, reason: "Rate lock token not found.", code: "rate_lock_expired" };
  }

  if (Date.now() > lock.expiresAt) {
    rateLocks.delete(token);
    return { valid: false, reason: "Rate lock token has expired.", code: "rate_lock_expired" };
  }

  if (lock.userId !== userId) {
    return { valid: false, reason: "Rate lock token does not match user.", code: "rate_lock_user_mismatch" };
  }

  if (lock.fromCurrency !== fromCurrency || lock.toCurrency !== toCurrency) {
    return { valid: false, reason: "Currency pair does not match rate lock.", code: "currency_pair_mismatch" };
  }

  // Check if rate moved more than MAX_RATE_DEVIATION_PCT
  const rateDiff = Math.abs(currentRate - lock.rate) / lock.rate * 100;
  if (rateDiff > MAX_RATE_DEVIATION_PCT) {
    rateLocks.delete(token);
    redisDeleteMirror(token);
    return { valid: false, reason: `FX rate moved ${rateDiff.toFixed(2)}% since quote.`, code: "rate_deviation_exceeded" };
  }

  // Consume the lock (single-use)
  rateLocks.delete(token);
  redisDeleteMirror(token);
  return { valid: true };
}

function redisDeleteMirror(token: string): void {
  const redis = getRedisClient();
  if (!redis) return;
  redis.del(lockRedisKey(token)).catch((err) => reportWriteThroughFailure("fx_rate_lock", err));
}

// ─── Async Redis-atomic variants (preferred — use for all new callers) ──────

export async function createRateLockAsync(
  userId: string,
  fromCurrency: string,
  toCurrency: string,
  rate: number
): Promise<string> {
  const token = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + RATE_LOCK_TTL_MS;
  const lock: RateLock = { userId, fromCurrency, toCurrency, rate, expiresAt };
  const redis = getRedisClient();
  if (!redis) {
    if (isFundFlowStrictMode()) {
      logger.error({ fromCurrency, toCurrency }, "[fxRateLock] Redis unavailable in strict mode — refusing to issue rate lock");
      throw new Error("[fxRateLock] Redis unavailable — cannot issue a replica-safe rate lock (fail-closed)");
    }
    logger.warn("[fxRateLock] Redis unavailable — rate lock will be process-local (dev only)");
    rateLocks.set(token, lock);
    return token;
  }
  try {
    await redis.set(lockRedisKey(token), JSON.stringify(lock), "PX", RATE_LOCK_TTL_MS);
  } catch (err) {
    reportWriteThroughFailure("fx_rate_lock", err, "error");
    if (isFundFlowStrictMode()) {
      throw new Error("[fxRateLock] Redis write failed — cannot issue a replica-safe rate lock (fail-closed)");
    }
    rateLocks.set(token, lock);
  }
  return token;
}

export async function validateRateLockAsync(
  token: string,
  userId: string,
  fromCurrency: string,
  toCurrency: string,
  currentRate: number
): Promise<{ valid: boolean; reason?: string; code?: string }> {
  const redis = getRedisClient();
  if (!redis) {
    if (isFundFlowStrictMode()) {
      logger.error({ token }, "[fxRateLock] Redis unavailable in strict mode — denying rate lock validation");
      return { valid: false, reason: "Rate lock service unavailable.", code: "rate_lock_unavailable" };
    }
    // Dev fallback: delegate to the process-local sync path.
    return validateRateLock(token, userId, fromCurrency, toCurrency, currentRate);
  }

  let raw: string | null;
  try {
    // GETDEL = atomic read + single-use consumption (no replay across replicas)
    raw = await (redis as any).getdel(lockRedisKey(token));
  } catch (err) {
    reportWriteThroughFailure("fx_rate_lock", err, "error");
    if (isFundFlowStrictMode()) {
      return { valid: false, reason: "Rate lock service unavailable.", code: "rate_lock_unavailable" };
    }
    return validateRateLock(token, userId, fromCurrency, toCurrency, currentRate);
  }
  if (!raw) {
    // Mirror-miss on the local map too (same-process tokens created via the
    // sync facade are mirrored; if Redis lost the write we still honor the
    // local copy exactly once).
    const local = rateLocks.get(token);
    if (local) return validateRateLock(token, userId, fromCurrency, toCurrency, currentRate);
    return { valid: false, reason: "Rate lock token not found.", code: "rate_lock_expired" };
  }

  const lock = JSON.parse(raw) as RateLock;
  if (Date.now() > lock.expiresAt) {
    return { valid: false, reason: "Rate lock token has expired.", code: "rate_lock_expired" };
  }
  if (lock.userId !== userId) {
    return { valid: false, reason: "Rate lock token does not match user.", code: "rate_lock_user_mismatch" };
  }
  if (lock.fromCurrency !== fromCurrency || lock.toCurrency !== toCurrency) {
    return { valid: false, reason: "Currency pair does not match rate lock.", code: "currency_pair_mismatch" };
  }
  const rateDiff = Math.abs(currentRate - lock.rate) / lock.rate * 100;
  if (rateDiff > MAX_RATE_DEVIATION_PCT) {
    return { valid: false, reason: `FX rate moved ${rateDiff.toFixed(2)}% since quote.`, code: "rate_deviation_exceeded" };
  }
  return { valid: true };
}
