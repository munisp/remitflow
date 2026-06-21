/**
 * fxRateLock.ts — FX rate locking and staleness detection
 *
 * Prevents stale FX rates from being used in transfer execution.
 * When a user sees a rate quote, the rate is locked with a TTL.
 * At execution time, the locked rate is compared to the live rate.
 * If the deviation exceeds the threshold, the transfer is rejected
 * with a prompt to re-quote.
 */

import { createHash, randomBytes } from "crypto";

/** Maximum allowed FX rate deviation before requiring re-quote (0.5%) */
const MAX_RATE_DEVIATION_PCT = 0.5;

/** Rate lock TTL in milliseconds (60 seconds) */
const RATE_LOCK_TTL_MS = 60_000;

/** In-memory rate lock store (production: use Redis with TTL) */
const rateLocks = new Map<string, {
  userId: number;
  fromCurrency: string;
  toCurrency: string;
  lockedRate: number;
  lockedAt: number;
  expiresAt: number;
}>();

/**
 * Create a rate lock when user views a transfer quote.
 * Returns a lock token that must be passed during transfer execution.
 */
export function createRateLock(
  userId: number,
  fromCurrency: string,
  toCurrency: string,
  rate: number,
): string {
  const token = randomBytes(16).toString("hex");
  const now = Date.now();
  rateLocks.set(token, {
    userId,
    fromCurrency,
    toCurrency,
    lockedRate: rate,
    lockedAt: now,
    expiresAt: now + RATE_LOCK_TTL_MS,
  });
  return token;
}

export interface RateLockValidation {
  valid: boolean;
  reason?: string;
  lockedRate?: number;
  liveRate: number;
  deviationPct?: number;
}

/**
 * Validate a rate lock at transfer execution time.
 * Checks: (1) lock exists, (2) not expired, (3) rate deviation within threshold.
 * Returns validation result with details.
 */
export function validateRateLock(
  token: string | undefined,
  userId: number,
  fromCurrency: string,
  toCurrency: string,
  liveRate: number,
): RateLockValidation {
  // If no token provided, allow the transfer but flag the deviation
  if (!token) {
    return { valid: true, liveRate, reason: "no_lock_token" };
  }

  const lock = rateLocks.get(token);
  if (!lock) {
    return { valid: true, liveRate, reason: "lock_not_found" };
  }

  // Verify ownership
  if (lock.userId !== userId) {
    return { valid: false, liveRate, reason: "lock_owner_mismatch" };
  }

  // Verify currency pair
  if (lock.fromCurrency !== fromCurrency || lock.toCurrency !== toCurrency) {
    return { valid: false, liveRate, reason: "currency_pair_mismatch" };
  }

  // Check expiry
  if (Date.now() > lock.expiresAt) {
    rateLocks.delete(token);
    return {
      valid: false,
      liveRate,
      lockedRate: lock.lockedRate,
      reason: "rate_lock_expired",
    };
  }

  // Check rate deviation
  const deviationPct = Math.abs(liveRate - lock.lockedRate) / lock.lockedRate * 100;
  if (deviationPct > MAX_RATE_DEVIATION_PCT) {
    rateLocks.delete(token);
    return {
      valid: false,
      liveRate,
      lockedRate: lock.lockedRate,
      deviationPct: Math.round(deviationPct * 100) / 100,
      reason: `Rate moved ${deviationPct.toFixed(2)}% (max ${MAX_RATE_DEVIATION_PCT}%). Please re-quote.`,
    };
  }

  // Valid — consume the lock
  rateLocks.delete(token);
  return {
    valid: true,
    liveRate,
    lockedRate: lock.lockedRate,
    deviationPct: Math.round(deviationPct * 100) / 100,
  };
}

// Clean up expired locks every 5 minutes
setInterval(() => {
  const now = Date.now();
  rateLocks.forEach((lock, token) => {
    if (now > lock.expiresAt) rateLocks.delete(token);
  });
}, 300_000);
