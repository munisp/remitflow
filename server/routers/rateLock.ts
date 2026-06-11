/**
 * Rate Lock Router — DB-backed
 * ─────────────────────────────────────────────────────────────────────────────
 * Allows users to lock an FX rate for a configurable duration before executing
 * a transfer. Prevents rate slippage between quote and execution.
 *
 * Uses the `rate_locks` table in PostgreSQL via Drizzle ORM — no in-memory state.
 * - Lock rate for 30s, 60s, or 5m (configurable)
 * - One active lock per user per corridor
 * - Auto-expire stale locks via SQL WHERE clause
 * - Rate lock audit trail
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { randomBytes } from "crypto";
import { logger } from "../_core/logger";
import { getDb, createAuditLog } from "../db";
import { rateLocks } from "../../drizzle/schema";
import { eq, and, gt, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const rateLockRouter = router({
  lock: protectedProcedure
    .input(z.object({
      fromCurrency: z.string().length(3),
      toCurrency: z.string().length(3),
      amount: z.number().positive().max(10_000_000),
      rate: z.number().positive(),
      durationSeconds: z.number().min(15).max(300).default(60),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Check for existing active lock on same corridor
      const existing = await db.select().from(rateLocks)
        .where(and(
          eq(rateLocks.userId, ctx.user.id),
          eq(rateLocks.fromCurrency, input.fromCurrency),
          eq(rateLocks.toCurrency, input.toCurrency),
          eq(rateLocks.status, "active"),
          gt(rateLocks.expiresAt, new Date()),
        ))
        .limit(1);

      if (existing.length > 0) {
        const lock = existing[0];
        return {
          lockId: lock.id,
          rate: Number(lock.lockedRate),
          expiresAt: lock.expiresAt?.toISOString() ?? "",
          existingLock: true,
        };
      }

      const expiresAt = new Date(Date.now() + input.durationSeconds * 1000);
      const [row] = await db.insert(rateLocks).values({
        userId: ctx.user.id,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        lockedRate: input.rate.toString(),
        amount: input.amount.toString(),
        expiresAt,
        status: "active",
      }).returning();

      logger.info({ lockId: row.id, userId: ctx.user.id, pair: `${input.fromCurrency}/${input.toCurrency}`, rate: input.rate }, "Rate locked");
      await createAuditLog({ userId: ctx.user.id, action: "RATE_LOCK_CREATED", metadata: { lockId: row.id, rate: input.rate, corridor: `${input.fromCurrency}/${input.toCurrency}` } });

      return {
        lockId: row.id,
        rate: Number(row.lockedRate),
        expiresAt: row.expiresAt?.toISOString() ?? "",
        existingLock: false,
      };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const now = new Date();
    const rows = await db.select().from(rateLocks)
      .where(and(
        eq(rateLocks.userId, ctx.user.id),
        eq(rateLocks.status, "active"),
        gt(rateLocks.expiresAt, now),
      ));
    return rows.map((l: typeof rows[number]) => ({
      lockId: l.id,
      rate: Number(l.lockedRate),
      fromCurrency: l.fromCurrency,
      toCurrency: l.toCurrency,
      amount: Number(l.amount),
      expiresAt: l.expiresAt?.toISOString() ?? "",
      remainingSeconds: Math.max(0, Math.floor(((l.expiresAt?.getTime() ?? 0) - now.getTime()) / 1000)),
    }));
  }),

  cancel: protectedProcedure
    .input(z.object({ lockId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [updated] = await db.update(rateLocks)
        .set({ status: "expired" })
        .where(and(eq(rateLocks.id, input.lockId), eq(rateLocks.userId, ctx.user.id)))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Lock not found" });
      return { lockId: updated.id, status: "cancelled" };
    }),

  preview: protectedProcedure
    .input(z.object({
      fromCurrency: z.string().length(3),
      toCurrency: z.string().length(3),
      amount: z.number().positive().max(10_000_000),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      // Fetch the latest rate from fxRateCache if available
      let rate = 1.0;
      if (db) {
        const rateRows = await db.execute(
          sql`SELECT rate FROM "fxRateCache" WHERE "fromCurrency" = ${input.fromCurrency} AND "toCurrency" = ${input.toCurrency} ORDER BY "updatedAt" DESC LIMIT 1`
        );
        const rateRow = (rateRows as unknown as Array<Record<string, unknown>>)[0];
        if (rateRow?.rate) rate = Number(rateRow.rate);
      }
      return {
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        amount: input.amount,
        indicativeRate: rate,
        convertedAmount: input.amount * rate,
        validFor: 60,
      };
    }),

  lockRate: protectedProcedure
    .input(z.object({
      fromCurrency: z.string().length(3),
      toCurrency: z.string().length(3),
      amount: z.number().positive().max(10_000_000),
      rate: z.number().positive(),
      durationSeconds: z.number().min(15).max(300).default(60),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Reuse existing active lock on same corridor
      const existing = await db.select().from(rateLocks)
        .where(and(
          eq(rateLocks.userId, ctx.user.id),
          eq(rateLocks.fromCurrency, input.fromCurrency),
          eq(rateLocks.toCurrency, input.toCurrency),
          eq(rateLocks.status, "active"),
          gt(rateLocks.expiresAt, new Date()),
        ))
        .limit(1);

      if (existing.length > 0) {
        return { lockId: existing[0].id, rate: Number(existing[0].lockedRate), expiresAt: existing[0].expiresAt?.toISOString() ?? "", existingLock: true };
      }

      const expiresAt = new Date(Date.now() + input.durationSeconds * 1000);
      const [row] = await db.insert(rateLocks).values({
        userId: ctx.user.id,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        lockedRate: input.rate.toString(),
        amount: input.amount.toString(),
        expiresAt,
        status: "active",
      }).returning();

      logger.info({ lockId: row.id, userId: ctx.user.id, pair: `${input.fromCurrency}/${input.toCurrency}` }, "Rate locked");
      return { lockId: row.id, rate: Number(row.lockedRate), expiresAt: row.expiresAt?.toISOString() ?? "", existingLock: false };
    }),

  useRateLock: protectedProcedure
    .input(z.object({ lockId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db.select().from(rateLocks).where(eq(rateLocks.id, input.lockId)).limit(1);
      const lock = rows[0];
      if (!lock) return { valid: false, reason: "Lock not found" };
      if (lock.status !== "active") return { valid: false, reason: "Lock already used or expired" };
      if (lock.expiresAt && lock.expiresAt < new Date()) {
        await db.update(rateLocks).set({ status: "expired" }).where(eq(rateLocks.id, input.lockId)).returning();
        return { valid: false, reason: "Lock expired" };
      }
      await db.update(rateLocks).set({ status: "used" as typeof lock.status }).where(eq(rateLocks.id, input.lockId)).returning();
      await createAuditLog({ userId: ctx.user.id, action: "RATE_LOCK_USED", metadata: { lockId: input.lockId, rate: Number(lock.lockedRate) } });
      return {
        valid: true,
        rate: Number(lock.lockedRate),
        amount: Number(lock.amount),
        fromCurrency: lock.fromCurrency,
        toCurrency: lock.toCurrency,
      };
    }),

  getLock: protectedProcedure
    .input(z.object({ lockId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db.select().from(rateLocks).where(eq(rateLocks.id, input.lockId)).limit(1);
      const lock = rows[0];
      if (!lock) return { found: false };
      const now = new Date();
      return {
        found: true,
        lockId: lock.id,
        rate: Number(lock.lockedRate),
        fromCurrency: lock.fromCurrency,
        toCurrency: lock.toCurrency,
        amount: Number(lock.amount),
        expiresAt: lock.expiresAt?.toISOString() ?? "",
        expired: lock.expiresAt ? lock.expiresAt < now : true,
        used: lock.status !== "active",
        remainingSeconds: lock.expiresAt ? Math.max(0, Math.floor((lock.expiresAt.getTime() - now.getTime()) / 1000)) : 0,
      };
    }),
});
