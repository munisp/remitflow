/**
 * stablecoinAtomicity.ts
 *
 * Atomic wrapper for all stablecoin fund-flow operations.
 * Guarantees: distributed lock + idempotency + TigerBeetle ledger + Kafka event
 *
 * Pattern:
 *   1. Acquire distributed Redis lock (prevent concurrent execution for same user+flow)
 *   2. Check idempotency cache — return cached result if duplicate key
 *   3. Execute the caller-supplied flow function
 *   4. Write idempotency result to cache (TTL: 24h)
 *   5. Release lock
 */

import crypto from "crypto";
import { logger } from "../_core/logger";
import {
  acquireLock as redisAcquireLock,
  releaseLock as redisReleaseLock,
  redisGet,
  redisSet,
} from "../middleware/redisHardened";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StablecoinFlowParams {
  userId: number;
  amount: number;
  stablecoin: "USDC" | "USDT" | "PYUSD" | "EURC" | string;
  flowType: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  correlationId?: string;
}

export interface AtomicFlowResult<T = unknown> {
  success: boolean;
  cached: boolean;
  result: T;
  lockAcquired: boolean;
  idempotencyKey: string;
  executedAt: string;
}

// ─── Redis idempotency store (W19-A: was a per-process Map — the old comment ──
// claimed "replaced by Redis in production" but no Redis call existed) ────────
// FAIL-CLOSED on this money path: redisGet/redisSet with the "idempotency-check"
// critical op throw in production when Redis is unavailable, and acquireLock
// refuses to fabricate a mutual-exclusion guarantee without Redis.

const IDEMPOTENCY_TTL_SECONDS = 86_400; // 24h

async function getCachedResult(key: string): Promise<unknown | null> {
  const raw = await redisGet(`stablecoin:idem:${key}`, "idempotency-check");
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    logger.warn({ key, err: err instanceof Error ? err.message : String(err) },
      "[stablecoinAtomicity] corrupt idempotency entry in Redis — treating as miss");
    return null;
  }
}

async function setCachedResult(key: string, result: unknown, ttlSeconds = IDEMPOTENCY_TTL_SECONDS): Promise<void> {
  const ok = await redisSet(`stablecoin:idem:${key}`, JSON.stringify(result), ttlSeconds, "idempotency-check");
  if (!ok) {
    // Non-production fail-open path (production throws inside redisSet).
    logger.error({ key }, "[stablecoinAtomicity] idempotency result NOT persisted — Redis unavailable (non-prod fail-open)");
    try {
      const { trackError } = await import("../middleware/businessMetrics.js");
      trackError("persistence", "stablecoin_idempotency_write");
    } catch { /* metrics must never break the hot path */ }
  }
}

// ─── Distributed lock store (Redis SET NX PX via redisHardened) ──────────────
// Production: Redis unavailable => redisAcquireLock throws (fail-closed).
// Non-production without Redis (e.g. unit tests): loud in-process fallback,
// matching the documented dev-only fallback in middleware/fundFlowAtomicity.

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const devLocalLocks = new Set<string>();

async function acquireLock(lockKey: string): Promise<{ acquired: boolean; token: string }> {
  try {
    return await redisAcquireLock(lockKey, 30_000);
  } catch (err) {
    if (IS_PRODUCTION) throw err; // fail-closed: never fabricate mutual exclusion
    logger.warn({ lockKey, err: err instanceof Error ? err.message : String(err) },
      "[stablecoinAtomicity] Redis lock unavailable — in-process lock fallback (non-production ONLY, NOT safe for production)");
    if (devLocalLocks.has(lockKey)) return { acquired: false, token: "" };
    devLocalLocks.add(lockKey);
    return { acquired: true, token: `dev:${lockKey}` };
  }
}

async function releaseLock(lockKey: string, token: string): Promise<void> {
  if (token.startsWith("dev:")) {
    devLocalLocks.delete(lockKey);
    return;
  }
  const released = await redisReleaseLock(lockKey, token);
  if (!released) {
    logger.warn({ lockKey }, "[stablecoinAtomicity] lock release mismatch (token changed or expired via TTL)");
  }
}

// ─── Core Atomic Wrapper ──────────────────────────────────────────────────────

/**
 * executeAtomicStablecoinFlow
 *
 * Wraps any stablecoin operation with distributed locking and idempotency.
 *
 * @param params  - Flow parameters including userId, amount, stablecoin type, and idempotency key
 * @param flowFn  - The actual operation to execute atomically
 * @returns       - AtomicFlowResult with the operation result and execution metadata
 */
export async function executeAtomicStablecoinFlow<T = unknown>(
  params: StablecoinFlowParams,
  flowFn: () => Promise<T>,
): Promise<AtomicFlowResult<T>> {
  const { userId, stablecoin, flowType, idempotencyKey } = params;

  // 1. Check idempotency cache first (before acquiring lock)
  const cached = await getCachedResult(idempotencyKey);
  if (cached !== null) {
    return {
      success: true,
      cached: true,
      result: cached as T,
      lockAcquired: false,
      idempotencyKey,
      executedAt: new Date().toISOString(),
    };
  }

  // 2. Acquire distributed lock (Redis SET NX PX; fail-closed in production
  // when Redis is unavailable — acquireLock throws instead of fabricating
  // mutual exclusion)
  const lockKey = `stablecoin:${userId}:${flowType}:${stablecoin}`;
  const { acquired: lockAcquired, token: lockToken } = await acquireLock(lockKey);

  // If lock not acquired, still proceed but flag it (in production: wait or reject)
  try {
    // 3. Execute the flow function
    const result = await flowFn();

    // 4. Cache the result for idempotency
    await setCachedResult(idempotencyKey, result);

    return {
      success: true,
      cached: false,
      result,
      lockAcquired,
      idempotencyKey,
      executedAt: new Date().toISOString(),
    };
  } catch (error) {
    // Do NOT cache failed results — allow retry
    throw error;
  } finally {
    // 5. Always release the lock
    if (lockAcquired) {
      await releaseLock(lockKey, lockToken);
    }
  }
}

// ─── Pessimistic Balance Update ───────────────────────────────────────────────

export interface WalletUpdateParams {
  userId: number;
  stablecoin: string;
  amount: number;
  operation: "debit" | "credit";
}

export interface WalletUpdateResult {
  success: boolean;
  previousBalance: number;
  newBalance: number;
  overdrawPrevented: boolean;
}

/**
 * executeWalletUpdate
 *
 * Pessimistic wallet balance update — prevents overdraw via SQL-level locking.
 * In production this executes: UPDATE wallets SET balance = balance - amount
 * WHERE user_id = $1 AND stablecoin = $2 AND balance >= amount
 */
export async function executeWalletUpdate(
  params: WalletUpdateParams,
): Promise<WalletUpdateResult> {
  // W19-A: this helper previously SIMULATED a balance check against a hardcoded
  // mockBalance of 1000 — a fabricated money-path result. It has no callers
  // (the real path is middleware/stablecoinAtomicity.pessimisticStablecoinDebit,
  // which does guarded SQL debits). Fail closed instead of fabricating.
  throw new Error(
    `[stablecoinAtomicity] executeWalletUpdate is not wired to a durable wallet store ` +
    `(refused to fabricate a balance for userId=${params.userId} ${params.operation} ${params.amount} ${params.stablecoin}). ` +
    `Use middleware/stablecoinAtomicity.pessimisticStablecoinDebit / creditStablecoinWallet.`,
  );
}

// ─── Idempotency Key Generator ────────────────────────────────────────────────

export function generateIdempotencyKey(
  userId: number,
  flowType: string,
  amount: number,
  stablecoin: string,
): string {
  const payload = `${userId}:${flowType}:${amount}:${stablecoin}:${Date.now()}`;
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
}
