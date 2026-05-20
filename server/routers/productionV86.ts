/**
 * RemitFlow v86 — Production Routers
 * Features:
 *  - promoCodesAdmin: Full CRUD for admin-defined promo codes
 *  - promoValidate: User-facing promo code validation + redemption
 *  - volumeWidget: Dashboard daily transaction volume chart data
 *  - fxCalculator: Live FX conversion calculator with fee preview
 *  - notifPrefs: User notification preferences CRUD
 *  - scheduledTransfers: Scheduled/recurring transfer management
 *  - rateAlerts: Exchange rate alert management
 */
import { z } from "zod";
import { router, protectedProcedure, publicProcedure ,
  auditedProcedure, rateLimitedProcedure
} from "../_core/trpc";
import { getDb } from "../db";
import { sql, eq, and, gte, lte, desc, or, ilike } from "drizzle-orm";
import {
  promoCodes, promoRedemptions, dailyVolumeSnapshots,
  userNotifPrefs, scheduledTransfers, exchangeRateAlerts,
  transactions, users, beneficiaries,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { fetchLiveRates } from "../fx-rates.service";

async function getLiveRates(base = "USD"): Promise<Record<string, number>> {
  const FALLBACK: Record<string, number> = {
    USD: 1, NGN: 1538.46, GBP: 0.7925, EUR: 0.9215, KES: 130.5, GHS: 12.4,
    ZAR: 18.7, TZS: 2580, UGX: 3750, RWF: 1285, XOF: 605, XAF: 605,
    EGP: 30.9, MAD: 10.1, SAR: 3.75, AED: 3.67, CNY: 7.24, INR: 83.1,
    JPY: 149.5, CAD: 1.36, AUD: 1.53, CHF: 0.895, BRL: 4.97, MXN: 17.2,
    SGD: 1.34, HKD: 7.82, SEK: 10.4, NOK: 10.6, DKK: 6.88, PLN: 3.97,
    TRY: 30.5, PKR: 279, BDT: 110, THB: 35.1, MYR: 4.72, PHP: 56.2,
  };
  try {
    const { rates } = await fetchLiveRates(base);
    return rates;
  } catch {
    return FALLBACK;
  }
}

// ─── Helper: calculate fee with optional promo ────────────────────────────────
async function calcFeeWithPromo(db: Awaited<ReturnType<typeof getDb>>, amount: number, currency: string, promoCodeStr?: string) {
  const baseFeeRate = 0.005; // 0.5%
  const baseFee = Math.round(amount * baseFeeRate * 100) / 100;
  let discount = 0;
  let promoApplied: { code: string; discountType: string; discountValue: number } | null = null;

  if (promoCodeStr && db) {
    const [promo] = await db.select().from(promoCodes)
      .where(and(
        eq(promoCodes.code, promoCodeStr.toUpperCase()),
        eq(promoCodes.isActive, true),
        or(sql`${promoCodes.validUntil} IS NULL`, gte(promoCodes.validUntil, new Date())),
      )).limit(1);

    if (promo) {
      const minAmt = Number(promo.minTransferAmount ?? 0);
      if (amount >= minAmt) {
        if (promo.discountType === "percentage") {
          discount = Math.round(baseFee * Number(promo.discountValue) / 100 * 100) / 100;
        } else {
          discount = Math.min(Number(promo.discountValue), baseFee);
        }
        if (promo.maxDiscountAmount) {
          discount = Math.min(discount, Number(promo.maxDiscountAmount));
        }
        promoApplied = { code: promo.code, discountType: promo.discountType, discountValue: Number(promo.discountValue) };
      }
    }
  }

  return { baseFee, discount, finalFee: Math.max(0, baseFee - discount), promoApplied };
}

// ─── Promo Codes Admin Router ─────────────────────────────────────────────────
export const promoCodesAdminRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      activeOnly: z.boolean().optional(),
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const offset = (input.page - 1) * input.limit;
      const conditions = [];
      if (input.activeOnly) conditions.push(eq(promoCodes.isActive, true));
      if (input.search) conditions.push(or(
        ilike(promoCodes.code, `%${input.search}%`),
        ilike(promoCodes.description, `%${input.search}%`),
      ));
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const [items, [{ count }]] = await Promise.all([
        db.select().from(promoCodes).where(where).orderBy(desc(promoCodes.createdAt)).limit(input.limit).offset(offset),
        db.select({ count: sql<string>`COUNT(*)` }).from(promoCodes).where(where),
      ]);
      return { items, total: Number(count) };
    }),

  create: protectedProcedure
    .input(z.object({
      code: z.string().min(3).max(50).toUpperCase(),
      description: z.string().max(500).optional(),
      discountType: z.enum(["percentage", "fixed"]).default("percentage"),
      discountValue: z.number().min(0.01).max(100),
      minTransferAmount: z.number().min(0).default(0),
      maxDiscountAmount: z.number().min(0).optional(),
      usageLimit: z.number().min(1).optional(),
      perUserLimit: z.number().min(1).default(1),
      validFrom: z.string().optional(),
      validUntil: z.string().optional(),
      corridors: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [existing] = await db.select({ id: promoCodes.id }).from(promoCodes).where(eq(promoCodes.code, input.code)).limit(1);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Promo code already exists" });
      const [created] = await db.insert(promoCodes).values({
        code: input.code,
        description: input.description,
        discountType: input.discountType,
        discountValue: String(input.discountValue),
        minTransferAmount: String(input.minTransferAmount),
        maxDiscountAmount: input.maxDiscountAmount ? String(input.maxDiscountAmount) : undefined,
        usageLimit: input.usageLimit,
        perUserLimit: input.perUserLimit,
        validFrom: input.validFrom ? new Date(input.validFrom) : new Date(),
        validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
        corridors: input.corridors ? JSON.stringify(input.corridors) : undefined,
        createdBy: ctx.user.id,
      }).returning();
      return created;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      description: z.string().max(500).optional(),
      discountType: z.enum(["percentage", "fixed"]).optional(),
      discountValue: z.number().min(0.01).max(100).optional(),
      minTransferAmount: z.number().min(0).optional(),
      maxDiscountAmount: z.number().min(0).optional(),
      usageLimit: z.number().min(1).optional(),
      perUserLimit: z.number().min(1).optional(),
      validUntil: z.string().optional(),
      corridors: z.array(z.string()).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...updates } = input;
      const updateData: Record<string, unknown> = {};
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.discountType !== undefined) updateData.discountType = updates.discountType;
      if (updates.discountValue !== undefined) updateData.discountValue = String(updates.discountValue);
      if (updates.minTransferAmount !== undefined) updateData.minTransferAmount = String(updates.minTransferAmount);
      if (updates.maxDiscountAmount !== undefined) updateData.maxDiscountAmount = String(updates.maxDiscountAmount);
      if (updates.usageLimit !== undefined) updateData.usageLimit = updates.usageLimit;
      if (updates.perUserLimit !== undefined) updateData.perUserLimit = updates.perUserLimit;
      if (updates.validUntil !== undefined) updateData.validUntil = new Date(updates.validUntil);
      if (updates.corridors !== undefined) updateData.corridors = JSON.stringify(updates.corridors);
      if (updates.isActive !== undefined) updateData.isActive = updates.isActive;
      const [updated] = await db.update(promoCodes).set(updateData).where(eq(promoCodes.id, id)).returning();
      return updated;
    }),

  delete: auditedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(promoCodes).where(eq(promoCodes.id, input.id));
      return { success: true };
    }),

  redemptions: protectedProcedure
    .input(z.object({ promoCodeId: z.number(), limit: z.number().default(50) }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) return [];
      return db.select({
        id: promoRedemptions.id,
        userId: promoRedemptions.userId,
        discountApplied: promoRedemptions.discountApplied,
        currency: promoRedemptions.currency,
        redeemedAt: promoRedemptions.redeemedAt,
        userName: users.name,
        userEmail: users.email,
      }).from(promoRedemptions)
        .leftJoin(users, eq(promoRedemptions.userId, users.id))
        .where(eq(promoRedemptions.promoCodeId, input.promoCodeId))
        .orderBy(desc(promoRedemptions.redeemedAt))
        .limit(input.limit);
    }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    const db = await getDb();
    if (!db) return { total: 0, active: 0, totalRedemptions: 0, totalDiscountUsd: 0 };
    const [[totals], [active], [redemptionStats]] = await Promise.all([
      db.select({ total: sql<string>`COUNT(*)` }).from(promoCodes),
      db.select({ count: sql<string>`COUNT(*)` }).from(promoCodes).where(eq(promoCodes.isActive, true)),
      db.select({
        count: sql<string>`COUNT(*)`,
        totalDiscount: sql<string>`COALESCE(SUM(discount_applied), 0)`,
      }).from(promoRedemptions),
    ]);
    return {
      total: Number(totals.total),
      active: Number(active.count),
      totalRedemptions: Number(redemptionStats.count),
      totalDiscountUsd: Number(redemptionStats.totalDiscount),
    };
  }),
});

// ─── Promo Validate Router (user-facing) ──────────────────────────────────────
export const promoValidateRouter = router({
  validate: protectedProcedure
    .input(z.object({
      code: z.string().min(1).max(50),
      amount: z.number().min(0.01),
      fromCurrency: z.string().length(3),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [promo] = await db.select().from(promoCodes)
        .where(and(
          eq(promoCodes.code, input.code.toUpperCase()),
          eq(promoCodes.isActive, true),
          or(sql`${promoCodes.validUntil} IS NULL`, gte(promoCodes.validUntil, new Date())),
        )).limit(1);
      if (!promo) return { valid: false, message: "Invalid or expired promo code" };
      if (promo.usageLimit && promo.usageCount >= promo.usageLimit) {
        return { valid: false, message: "Promo code usage limit reached" };
      }
      const minAmt = Number(promo.minTransferAmount ?? 0);
      if (input.amount < minAmt) {
        return { valid: false, message: `Minimum transfer amount for this code is ${minAmt} ${input.fromCurrency}` };
      }
      // Check per-user limit
      const [userUsage] = await db.select({ count: sql<string>`COUNT(*)` })
        .from(promoRedemptions)
        .where(and(eq(promoRedemptions.promoCodeId, promo.id), eq(promoRedemptions.userId, ctx.user.id)));
      if (promo.perUserLimit && Number(userUsage.count) >= promo.perUserLimit) {
        return { valid: false, message: "You have already used this promo code" };
      }
      const feeInfo = await calcFeeWithPromo(db, input.amount, input.fromCurrency, input.code);
      return {
        valid: true,
        code: promo.code,
        description: promo.description,
        discountType: promo.discountType,
        discountValue: Number(promo.discountValue),
        baseFee: feeInfo.baseFee,
        discount: feeInfo.discount,
        finalFee: feeInfo.finalFee,
        savingsAmount: feeInfo.discount,
        message: `Code applied! You save ${feeInfo.discount.toFixed(2)} ${input.fromCurrency} on fees`,
      };
    }),
});

// ─── Volume Widget Router ─────────────────────────────────────────────────────
export const volumeWidgetRouter = router({
  daily: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { data: [], summary: { totalVolume: 0, totalTxns: 0, avgDailyVolume: 0, peakDay: null } };

      // Try to get from snapshots first, fall back to live query
      const cutoff = new Date(Date.now() - input.days * 86400000);
      const snapshots = await db.select().from(dailyVolumeSnapshots)
        .where(gte(dailyVolumeSnapshots.createdAt, cutoff))
        .orderBy(desc(dailyVolumeSnapshots.snapshotDate))
        .limit(input.days);

      if (snapshots.length >= Math.min(input.days, 7)) {
        const data = snapshots.reverse().map(s => ({
          date: s.snapshotDate,
          transactions: s.totalTransactions,
          volumeUsd: Number(s.totalVolumeUsd),
          feesUsd: Number(s.totalFeesUsd),
          uniqueSenders: s.uniqueSenders,
          topCorridor: s.topCorridor,
        }));
        const totalVolume = data.reduce((sum, d) => sum + d.volumeUsd, 0);
        const totalTxns = data.reduce((sum, d) => sum + d.transactions, 0);
        const peakDay = data.reduce((max, d) => d.volumeUsd > (max?.volumeUsd ?? 0) ? d : max, data[0] ?? null);
        return { data, summary: { totalVolume, totalTxns, avgDailyVolume: totalVolume / data.length, peakDay } };
      }

      // Live query from transactions table
      const data = [];
      for (let i = input.days - 1; i >= 0; i--) {
        const dayStart = new Date(Date.now() - i * 86400000);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);
        const dateStr = dayStart.toISOString().split("T")[0];
        try {
          const [row] = await db.select({
            count: sql<string>`COUNT(*)`,
            volume: sql<string>`COALESCE(SUM(from_amount), 0)`,
          }).from(transactions)
            .where(and(
              gte(transactions.createdAt, dayStart),
              lte(transactions.createdAt, dayEnd),
              eq(transactions.status, "completed"),
            ));
          data.push({
            date: dateStr,
            transactions: Number(row.count),
            volumeUsd: Math.round(Number(row.volume) * 100) / 100,
            feesUsd: Math.round(Number(row.volume) * 0.005 * 100) / 100,
            uniqueSenders: 0,
            topCorridor: null,
          });
        } catch {
          data.push({ date: dateStr, transactions: 0, volumeUsd: 0, feesUsd: 0, uniqueSenders: 0, topCorridor: null });
        }
      }
      const totalVolume = data.reduce((sum, d) => sum + d.volumeUsd, 0);
      const totalTxns = data.reduce((sum, d) => sum + d.transactions, 0);
      const peakDay = data.reduce((max, d) => d.volumeUsd > (max?.volumeUsd ?? 0) ? d : max, data[0] ?? null);
      return { data, summary: { totalVolume, totalTxns, avgDailyVolume: totalVolume / data.length, peakDay } };
    }),

  adminDaily: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) return { data: [] };
      const data = [];
      for (let i = input.days - 1; i >= 0; i--) {
        const dayStart = new Date(Date.now() - i * 86400000);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);
        const dateStr = dayStart.toISOString().split("T")[0];
        try {
          const [row] = await db.select({
            count: sql<string>`COUNT(*)`,
            volume: sql<string>`COALESCE(SUM(from_amount), 0)`,
            uniqueUsers: sql<string>`COUNT(DISTINCT user_id)`,
          }).from(transactions)
            .where(and(gte(transactions.createdAt, dayStart), lte(transactions.createdAt, dayEnd)));
          data.push({
            date: dateStr,
            transactions: Number(row.count),
            volumeUsd: Math.round(Number(row.volume) * 100) / 100,
            uniqueUsers: Number(row.uniqueUsers),
          });
        } catch {
          data.push({ date: dateStr, transactions: 0, volumeUsd: 0, uniqueUsers: 0 });
        }
      }
      return { data };
    }),
});

// ─── FX Calculator Router ─────────────────────────────────────────────────────
export const fxCalculatorRouter = router({
  convert: publicProcedure
    .input(z.object({
      amount: z.number().min(0.01),
      fromCurrency: z.string().length(3),
      toCurrency: z.string().length(3),
      promoCode: z.string().max(50).optional(),
    }))
    .query(async ({ input }) => {
      const rates = await getLiveRates(input.fromCurrency);
      const rate = rates[input.toCurrency];
      if (!rate) throw new TRPCError({ code: "BAD_REQUEST", message: `Unsupported currency pair: ${input.fromCurrency}/${input.toCurrency}` });

      const db = await getDb();
      const feeInfo = await calcFeeWithPromo(db, input.amount, input.fromCurrency, input.promoCode);
      const amountAfterFee = input.amount - feeInfo.finalFee;
      const convertedAmount = Math.round(amountAfterFee * rate * 100) / 100;
      const midMarketAmount = Math.round(input.amount * rate * 100) / 100;

      return {
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        amount: input.amount,
        rate,
        midMarketRate: rate,
        convertedAmount,
        midMarketAmount,
        baseFee: feeInfo.baseFee,
        discount: feeInfo.discount,
        finalFee: feeInfo.finalFee,
        promoApplied: feeInfo.promoApplied,
        totalDeducted: input.amount,
        rateTimestamp: new Date().toISOString(),
        estimatedArrival: "1-2 business days",
      };
    }),

  supportedPairs: publicProcedure.query(async () => {
    const rates = await getLiveRates("USD");
    const currencies = Object.keys(rates).slice(0, 50);
    return { currencies, baseCurrency: "USD", count: currencies.length };
  }),
});

// ─── Notification Preferences Router ─────────────────────────────────────────
export const notifPrefsRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;
    const [prefs] = await db.select().from(userNotifPrefs)
      .where(eq(userNotifPrefs.userId, ctx.user.id)).limit(1);
    return prefs ?? {
      emailTransactions: true, emailMarketing: false, emailSecurity: true,
      pushTransactions: true, pushMarketing: false, smsTransactions: false,
      fxAlertEnabled: false, fxAlertThreshold: null, fxAlertCurrency: null,
    };
  }),

  update: protectedProcedure
    .input(z.object({
      emailTransactions: z.boolean().optional(),
      emailMarketing: z.boolean().optional(),
      emailSecurity: z.boolean().optional(),
      pushTransactions: z.boolean().optional(),
      pushMarketing: z.boolean().optional(),
      smsTransactions: z.boolean().optional(),
      fxAlertEnabled: z.boolean().optional(),
      fxAlertThreshold: z.number().optional(),
      fxAlertCurrency: z.string().length(3).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      Object.entries(input).forEach(([k, v]) => { if (v !== undefined) updateData[k] = v; });
      const [existing] = await db.select({ id: userNotifPrefs.id })
        .from(userNotifPrefs).where(eq(userNotifPrefs.userId, ctx.user.id)).limit(1);
      if (existing) {
        await db.update(userNotifPrefs).set(updateData).where(eq(userNotifPrefs.userId, ctx.user.id));
      } else {
        await db.insert(userNotifPrefs).values({ userId: ctx.user.id, ...updateData });
      }
      return { success: true };
    }),
});

// ─── Scheduled Transfers Router ───────────────────────────────────────────────
export const scheduledTransfersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select({
      id: scheduledTransfers.id,
      fromCurrency: scheduledTransfers.fromCurrency,
      toCurrency: scheduledTransfers.toCurrency,
      amount: scheduledTransfers.amount,
      frequency: scheduledTransfers.frequency,
      nextRunAt: scheduledTransfers.nextRunAt,
      lastRunAt: scheduledTransfers.lastRunAt,
      runCount: scheduledTransfers.runCount,
      maxRuns: scheduledTransfers.maxRuns,
      status: scheduledTransfers.status,
      description: scheduledTransfers.description,
      promoCode: scheduledTransfers.promoCode,
      createdAt: scheduledTransfers.createdAt,
      beneficiaryName: beneficiaries.name,
    }).from(scheduledTransfers)
      .leftJoin(beneficiaries, eq(scheduledTransfers.beneficiaryId, beneficiaries.id))
      .where(eq(scheduledTransfers.userId, ctx.user.id))
      .orderBy(desc(scheduledTransfers.createdAt));
  }),

  create: protectedProcedure
    .input(z.object({
      beneficiaryId: z.number().optional(),
      fromCurrency: z.string().length(3),
      toCurrency: z.string().length(3),
      amount: z.number().min(1),
      frequency: z.enum(["once", "daily", "weekly", "monthly"]),
      startDate: z.string(),
      maxRuns: z.number().min(1).optional(),
      description: z.string().max(500).optional(),
      promoCode: z.string().max(50).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [created] = await db.insert(scheduledTransfers).values({
        userId: ctx.user.id,
        beneficiaryId: input.beneficiaryId,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        amount: String(input.amount),
        frequency: input.frequency,
        nextRunAt: new Date(input.startDate),
        maxRuns: input.maxRuns,
        description: input.description,
        promoCode: input.promoCode,
      }).returning();
      return created;
    }),

  pause: auditedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(scheduledTransfers).set({ status: "paused" })
        .where(and(eq(scheduledTransfers.id, input.id), eq(scheduledTransfers.userId, ctx.user.id)));
      return { success: true };
    }),

  resume: auditedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(scheduledTransfers).set({ status: "active" })
        .where(and(eq(scheduledTransfers.id, input.id), eq(scheduledTransfers.userId, ctx.user.id)));
      return { success: true };
    }),

  cancel: auditedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(scheduledTransfers).set({ status: "cancelled" })
        .where(and(eq(scheduledTransfers.id, input.id), eq(scheduledTransfers.userId, ctx.user.id)));
      return { success: true };
    }),
});

// ─── Exchange Rate Alerts Router ──────────────────────────────────────────────
export const rateAlertsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(exchangeRateAlerts)
      .where(eq(exchangeRateAlerts.userId, ctx.user.id))
      .orderBy(desc(exchangeRateAlerts.createdAt));
  }),

  create: protectedProcedure
    .input(z.object({
      fromCurrency: z.string().length(3),
      toCurrency: z.string().length(3),
      targetRate: z.number().min(0.000001),
      direction: z.enum(["above", "below"]).default("above"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [created] = await db.insert(exchangeRateAlerts).values({
        userId: ctx.user.id,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        targetRate: String(input.targetRate),
        direction: input.direction,
      }).returning();
      return created;
    }),

  delete: auditedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(exchangeRateAlerts)
        .where(and(eq(exchangeRateAlerts.id, input.id), eq(exchangeRateAlerts.userId, ctx.user.id)));
      return { success: true };
    }),

  currentRates: publicProcedure
    .input(z.object({ pairs: z.array(z.object({ from: z.string(), to: z.string() })).max(20) }))
    .query(async ({ input }) => {
      const results: { from: string; to: string; rate: number }[] = [];
      for (const pair of input.pairs) {
        const rates = await getLiveRates(pair.from);
        results.push({ from: pair.from, to: pair.to, rate: rates[pair.to] ?? 0 });
      }
      return results;
    }),
});
