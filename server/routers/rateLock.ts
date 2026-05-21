/**
 * Rate Lock Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Allows users to lock an FX rate for a configurable duration before executing
 * a transfer. Prevents rate slippage between quote and execution.
 *
 * Features:
 * - Lock rate for 30s, 60s, or 5m (configurable)
 * - One active lock per user per corridor
 * - Auto-expire stale locks
 * - Rate lock audit trail
 */

import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { randomBytes } from "crypto";
import { logger } from "../_core/logger";

interface RateLock {
  id: string;
  userId: number;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  amount: number;
  lockedAt: number;
  expiresAt: number;
  used: boolean;
}

// In-memory store (production: Redis with TTL)
const rateLocks = new Map<string, RateLock>();

// Cleanup expired locks periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, lock] of Array.from(rateLocks.entries())) {
    if (lock.expiresAt < now) {
      rateLocks.delete(id);
    }
  }
}, 10_000);

export const rateLockRouter = router({
  // Lock a rate for a transfer
  lockRate: publicProcedure
    .input(z.object({
      fromCurrency: z.string().length(3),
      toCurrency: z.string().length(3),
      amount: z.number().positive(),
      rate: z.number().positive(),
      durationSeconds: z.number().min(15).max(300).default(60),
    }))
    .mutation(({ input, ctx }) => {
      const userId = (ctx as any).user?.id ?? 0;

      // Check for existing lock on same corridor
      for (const [id, lock] of Array.from(rateLocks.entries())) {
        if (
          lock.userId === userId &&
          lock.fromCurrency === input.fromCurrency &&
          lock.toCurrency === input.toCurrency &&
          lock.expiresAt > Date.now() &&
          !lock.used
        ) {
          return {
            lockId: lock.id,
            rate: lock.rate,
            expiresAt: new Date(lock.expiresAt).toISOString(),
            existingLock: true,
          };
        }
      }

      const lockId = `rl_${randomBytes(8).toString("hex")}`;
      const now = Date.now();

      const lock: RateLock = {
        id: lockId,
        userId,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        rate: input.rate,
        amount: input.amount,
        lockedAt: now,
        expiresAt: now + input.durationSeconds * 1000,
        used: false,
      };

      rateLocks.set(lockId, lock);
      logger.info({ lockId, userId, pair: `${input.fromCurrency}/${input.toCurrency}`, rate: input.rate }, "Rate locked");

      return {
        lockId,
        rate: lock.rate,
        expiresAt: new Date(lock.expiresAt).toISOString(),
        existingLock: false,
      };
    }),

  // Use a locked rate (during transfer)
  useRateLock: publicProcedure
    .input(z.object({
      lockId: z.string(),
    }))
    .mutation(({ input }) => {
      const lock = rateLocks.get(input.lockId);
      if (!lock) {
        return { valid: false, reason: "Lock not found" };
      }
      if (lock.used) {
        return { valid: false, reason: "Lock already used" };
      }
      if (lock.expiresAt < Date.now()) {
        rateLocks.delete(input.lockId);
        return { valid: false, reason: "Lock expired" };
      }

      lock.used = true;
      return {
        valid: true,
        rate: lock.rate,
        amount: lock.amount,
        fromCurrency: lock.fromCurrency,
        toCurrency: lock.toCurrency,
      };
    }),

  // Check lock status
  getLock: publicProcedure
    .input(z.object({ lockId: z.string() }))
    .query(({ input }) => {
      const lock = rateLocks.get(input.lockId);
      if (!lock) {
        return { found: false };
      }
      return {
        found: true,
        lockId: lock.id,
        rate: lock.rate,
        fromCurrency: lock.fromCurrency,
        toCurrency: lock.toCurrency,
        amount: lock.amount,
        expiresAt: new Date(lock.expiresAt).toISOString(),
        expired: lock.expiresAt < Date.now(),
        used: lock.used,
        remainingSeconds: Math.max(0, Math.floor((lock.expiresAt - Date.now()) / 1000)),
      };
    }),
});
