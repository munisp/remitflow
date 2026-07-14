import crypto from "crypto";

const MAX_RATE_DEVIATION_PCT = 0.5;
const RATE_LOCK_TTL_MS = 60_000; // 60 seconds

interface RateLock {
  userId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  expiresAt: number;
}

const rateLocks = new Map<string, RateLock>();

export function createRateLock(
  userId: string,
  fromCurrency: string,
  toCurrency: string,
  rate: number
): string {
  const token = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + RATE_LOCK_TTL_MS;

  rateLocks.set(token, { userId, fromCurrency, toCurrency, rate, expiresAt });

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
    return { valid: false, reason: `FX rate moved ${rateDiff.toFixed(2)}% since quote.`, code: "rate_deviation_exceeded" };
  }

  // Consume the lock (single-use)
  rateLocks.delete(token);
  return { valid: true };
}
