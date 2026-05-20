/**
 * Rate Lock / Forward Contract Router
 * Allows users to lock in a current FX rate for a future transfer (up to 30 days).
 */
import { router, protectedProcedure, rateLimitedProcedure } from "../_core/trpc.js";
import { z } from "zod";
import { getDb } from "../db.js";
import { rateLocks } from "../../drizzle/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { sendEmail } from "../email.service.js";
import { TRPCError } from "@trpc/server";

/** Simulate a live FX rate lookup (replace with real provider in production) */
async function getLiveRate(from: string, to: string): Promise<number> {
  // Fallback rates for common corridors (production: call Wise/OFX/Currencybeacon API)
  const rates: Record<string, number> = {
    "USD_NGN": 1580, "USD_GHS": 15.8, "USD_KES": 128, "USD_ZAR": 18.5,
    "USD_UGX": 3750, "USD_TZS": 2580, "USD_XOF": 610, "USD_XAF": 610,
    "GBP_NGN": 2010, "GBP_GHS": 20.1, "GBP_KES": 163, "EUR_NGN": 1720,
    "EUR_GHS": 17.2, "EUR_KES": 138, "CAD_NGN": 1160, "AUD_NGN": 1040,
  };
  const key = `${from}_${to}`;
  const reverseKey = `${to}_${from}`;
  if (rates[key]) return rates[key];
  if (rates[reverseKey]) return 1 / rates[reverseKey];
  // Default: 1:1 for unknown pairs
  return 1.0;
}

export const rateLockRouter = router({
  /** Lock the current FX rate for a future transfer */
  lock: rateLimitedProcedure
    .input(
      z.object({
        fromCurrency: z.string().length(3),
        toCurrency: z.string().length(3),
        amount: z.number().positive(),
        lockDays: z.number().int().min(1).max(30).default(7),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const rate = await getLiveRate(input.fromCurrency, input.toCurrency);
      const expiresAt = new Date(Date.now() + input.lockDays * 86_400_000);

      const [row] = await db
        .insert(rateLocks)
        .values({
          userId: ctx.user.id,
          fromCurrency: input.fromCurrency,
          toCurrency: input.toCurrency,
          lockedRate: rate.toFixed(8),
          amount: input.amount.toString(),
          expiresAt,
          status: "active",
        })
        .returning();

      // Send confirmation email
      const user = ctx.user as { email?: string; name?: string };
      if (user.email) {
        await sendEmail({
          to: user.email,
          subject: `Rate Locked: ${input.fromCurrency}/${input.toCurrency} @ ${rate.toFixed(4)}`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:auto">
              <h2 style="color:#1a56db">Rate Lock Confirmed</h2>
              <p>Hi ${user.name ?? "there"},</p>
              <p>Your exchange rate has been locked:</p>
              <table style="width:100%;border-collapse:collapse">
                <tr><td style="padding:8px;border:1px solid #e5e7eb">Pair</td><td style="padding:8px;border:1px solid #e5e7eb"><strong>${input.fromCurrency} → ${input.toCurrency}</strong></td></tr>
                <tr><td style="padding:8px;border:1px solid #e5e7eb">Locked Rate</td><td style="padding:8px;border:1px solid #e5e7eb"><strong>${rate.toFixed(4)}</strong></td></tr>
                <tr><td style="padding:8px;border:1px solid #e5e7eb">Amount</td><td style="padding:8px;border:1px solid #e5e7eb"><strong>${input.fromCurrency} ${input.amount.toFixed(2)}</strong></td></tr>
                <tr><td style="padding:8px;border:1px solid #e5e7eb">Expires</td><td style="padding:8px;border:1px solid #e5e7eb"><strong>${expiresAt.toLocaleDateString()}</strong></td></tr>
              </table>
              <p style="color:#6b7280;font-size:0.85rem">Use this rate within ${input.lockDays} days to complete your transfer.</p>
            </div>`,
          text: `Rate Lock: ${input.fromCurrency}/${input.toCurrency} @ ${rate.toFixed(4)}. Expires: ${expiresAt.toLocaleDateString()}.`,
        });
      }

      return row;
    }),

  /** List all rate locks for the current user */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    // Auto-expire stale locks
    await db
      .update(rateLocks)
      .set({ status: "expired" })
      .where(
        and(
          eq(rateLocks.userId, ctx.user.id),
          eq(rateLocks.status, "active")
        )
      );
    return db
      .select()
      .from(rateLocks)
      .where(eq(rateLocks.userId, ctx.user.id))
      .orderBy(desc(rateLocks.createdAt))
      .limit(50);
  }),

  /** Cancel / expire a rate lock */
  cancel: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [row] = await db
        .update(rateLocks)
        .set({ status: "expired" })
        .where(and(eq(rateLocks.id, input.id), eq(rateLocks.userId, ctx.user.id)))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  /** Use a rate lock (mark as used when initiating a transfer) */
  use: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [existing] = await db
        .select()
        .from(rateLocks)
        .where(and(eq(rateLocks.id, input.id), eq(rateLocks.userId, ctx.user.id)));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "Rate lock is not active" });
      if (existing.expiresAt && new Date(existing.expiresAt) < new Date()) {
        await db.update(rateLocks).set({ status: "expired" }).where(eq(rateLocks.id, input.id));
        throw new TRPCError({ code: "BAD_REQUEST", message: "Rate lock has expired" });
      }
      const [row] = await db
        .update(rateLocks)
        .set({ status: "used" })
        .where(eq(rateLocks.id, input.id))
        .returning();
      return row;
    }),

  /** Get current live rate preview (no lock) */
  preview: protectedProcedure
    .input(z.object({ fromCurrency: z.string().length(3), toCurrency: z.string().length(3), amount: z.number().positive() }))
    .query(async ({ input }) => {
      const rate = await getLiveRate(input.fromCurrency, input.toCurrency);
      const toAmount = input.amount * rate;
      return {
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        rate,
        fromAmount: input.amount,
        toAmount,
        fee: input.amount * 0.005, // 0.5% fee
        netToAmount: toAmount,
        rateValidUntil: new Date(Date.now() + 60_000), // 1 minute
      };
    }),
});
