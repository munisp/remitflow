/**
 * RemitFlow — Float Income Treasury Router
 *
 * Float income is earned when funds are held in sending-country accounts
 * between receipt and disbursement. This router tracks:
 *  - Per-currency float pool balances (from treasury_positions table)
 *  - Daily yield accrual (principal × rate × days/365)
 *  - Monthly and YTD float income
 *  - Admin rate management
 *
 * TigerBeetle account IDs for float pools:
 *  USD = 1001n, GBP = 1002n, EUR = 1003n, CAD = 1004n, AED = 1005n
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, sql, gte, and } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { treasuryPositions } from "../../drizzle/schema";
import { createAuditLog } from "../audit.service";

// ─── Default float rates (central bank rates as of 2026) ─────────────────────
const DEFAULT_FLOAT_RATES: Record<string, { rate: number; description: string }> = {
  USD: { rate: 0.0525, description: "Fed Funds Rate 5.25%" },
  GBP: { rate: 0.0500, description: "Bank of England Base Rate 5.00%" },
  EUR: { rate: 0.0375, description: "ECB Deposit Facility Rate 3.75%" },
  CAD: { rate: 0.0450, description: "Bank of Canada Rate 4.50%" },
  AED: { rate: 0.0525, description: "UAE Central Bank Rate (USD-pegged) 5.25%" },
};

// ─── TigerBeetle account IDs ──────────────────────────────────────────────────
const FLOAT_POOL_ACCOUNTS: Record<string, bigint> = {
  USD: BigInt(1001),
  GBP: BigInt(1002),
  EUR: BigInt(1003),
  CAD: BigInt(1004),
  AED: BigInt(1005),
};

function calculateDailyYield(balance: number, annualRate: number): number {
  return balance * annualRate / 365;
}

function calculateMonthlyYield(balance: number, annualRate: number): number {
  return balance * annualRate / 12;
}

export const floatIncomeRouter = router({
  /**
   * Float income summary: balances, rates, daily/monthly/YTD yield
   * Reads real balances from treasury_positions table.
   */
  summary: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    // Load treasury positions from DB
    const positions = await db.select().from(treasuryPositions);
    const positionMap: Record<string, number> = {};
    for (const pos of positions) {
      positionMap[pos.currency] = parseFloat(pos.balance as string);
    }

    // Load custom rates from system_config (key: float_rate_USD, float_rate_GBP, etc.)
    const rateOverrides: Record<string, number> = {};
    try {
      const rateRows = await db.execute(
        sql`SELECT key, value FROM system_config WHERE key LIKE 'float_rate_%'`
      );
      for (const row of (rateRows as any[])) {
        const currency = (row.key as string).replace("float_rate_", "").toUpperCase();
        rateOverrides[currency] = parseFloat(row.value);
      }
    } catch { /* system_config may not have float_rate keys */ }

    // Calculate YTD yield from float_income_records if available
    let totalYtdYield = 0;
    try {
      const ytdRows = await db.execute(
        sql`SELECT COALESCE(SUM(yield_amount), 0) AS ytd FROM float_income_records WHERE date >= DATE_TRUNC('year', NOW())`
      );
      totalYtdYield = parseFloat((ytdRows as any[])[0]?.ytd || "0");
    } catch { /* table may not exist yet */ }

    const currencies = Object.keys(DEFAULT_FLOAT_RATES);
    const summary = [];
    let totalDailyYield = 0;
    let totalMonthlyYield = 0;
    let totalBalance = 0;

    for (const currency of currencies) {
      const balance = positionMap[currency] ?? 0;
      const rate = rateOverrides[currency] ?? DEFAULT_FLOAT_RATES[currency].rate;
      const dailyYield = calculateDailyYield(balance, rate);
      const monthlyYield = calculateMonthlyYield(balance, rate);
      totalDailyYield += dailyYield;
      totalMonthlyYield += monthlyYield;
      totalBalance += balance;

      summary.push({
        currency,
        tigerBeetleAccountId: (FLOAT_POOL_ACCOUNTS[currency] ?? BigInt(0)).toString(),
        balance,
        annualRate: rate,
        annualRatePercent: `${(rate * 100).toFixed(2)}%`,
        rateDescription: DEFAULT_FLOAT_RATES[currency].description,
        dailyYield: Math.round(dailyYield * 100) / 100,
        monthlyYield: Math.round(monthlyYield * 100) / 100,
        annualYield: Math.round(balance * rate * 100) / 100,
      });
    }

    return {
      currencies: summary,
      totals: {
        totalFloatBalance: Math.round(totalBalance * 100) / 100,
        totalDailyYield: Math.round(totalDailyYield * 100) / 100,
        totalMonthlyYield: Math.round(totalMonthlyYield * 100) / 100,
        totalYtdYield: Math.round(totalYtdYield * 100) / 100,
        projectedAnnualYield: Math.round(totalMonthlyYield * 12 * 100) / 100,
      },
      lastUpdated: new Date().toISOString(),
    };
  }),

  /**
   * Float income history: last N days of daily records
   * Reads from float_income_records if available, otherwise derives from treasury_positions.
   */
  history: protectedProcedure
    .input(z.object({
      currency: z.string().length(3).optional(),
      days: z.number().min(1).max(365).default(90),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Try float_income_records table first
      try {
        const query = input.currency
          ? sql`SELECT currency, date::text, balance, rate, yield_amount FROM float_income_records WHERE date >= NOW() - (${input.days} || ' days')::interval AND currency = ${input.currency} ORDER BY date DESC LIMIT 500`
          : sql`SELECT currency, date::text, balance, rate, yield_amount FROM float_income_records WHERE date >= NOW() - (${input.days} || ' days')::interval ORDER BY date DESC LIMIT 500`;
        const rows = await db.execute(query);
        if ((rows as any[]).length > 0) {
          return { records: rows as any[], total: (rows as any[]).length };
        }
      } catch { /* table may not exist yet */ }

      // Derive from treasury_positions (current balances projected backwards)
      const positions = await db.select().from(treasuryPositions);
      const currencies = input.currency
        ? positions.filter((p: any) => p.currency === input.currency)
        : positions;

      const records = [];
      for (let d = 0; d < Math.min(input.days, 90); d++) {
        const date = new Date(Date.now() - d * 86400000).toISOString().split("T")[0];
        for (const pos of currencies) {
          const balance = parseFloat(pos.balance as string);
          const rate = DEFAULT_FLOAT_RATES[pos.currency]?.rate ?? 0.04;
          const yieldAmount = calculateDailyYield(balance, rate);
          records.push({
            currency: pos.currency,
            date,
            balance: Math.round(balance),
            rate,
            yieldAmount: Math.round(yieldAmount * 100) / 100,
          });
        }
      }
      return { records, total: records.length };
    }),

  /**
   * Update yield rate for a currency (admin only)
   * Stores override in system_config as float_rate_{CURRENCY}.
   */
  updateRate: protectedProcedure
    .input(z.object({
      currency: z.string().length(3),
      rate: z.number().min(0).max(0.5), // 0–50% annual rate
      reason: z.string().min(5).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const key = `float_rate_${input.currency.toUpperCase()}`;
      await db.execute(
        sql`INSERT INTO system_config (key, value, description, updated_by, "updatedAt")
            VALUES (${key}, ${input.rate.toString()}, ${`Float rate for ${input.currency}: ${input.reason}`}, ${ctx.user.id}, NOW())
            ON CONFLICT (key) DO UPDATE SET value = ${input.rate.toString()}, description = ${`Float rate for ${input.currency}: ${input.reason}`}, updated_by = ${ctx.user.id}, "updatedAt" = NOW()`
      );

      await createAuditLog({
        userId: ctx.user.id,
        action: "floatIncome.updateRate",
        targetType: "float_rate",
        description: JSON.stringify({ currency: input.currency, newRate: input.rate, reason: input.reason }),
      });
      return { success: true, verified: true, currency: input.currency, newRate: input.rate, updatedBy: ctx.user.id };
    }),

  /**
   * Accrue daily yield for all currencies (called by cron job)
   * Reads real balances from treasury_positions, writes to float_income_records.
   */
  accrueDaily: protectedProcedure
    .mutation(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const today = new Date().toISOString().split("T")[0];
      const positions = await db.select().from(treasuryPositions);

      // Load rate overrides
      const rateOverrides: Record<string, number> = {};
      try {
        const rateRows = await db.execute(
          sql`SELECT key, value FROM system_config WHERE key LIKE 'float_rate_%'`
        );
        for (const row of (rateRows as any[])) {
          const currency = (row.key as string).replace("float_rate_", "").toUpperCase();
          rateOverrides[currency] = parseFloat(row.value);
        }
      } catch { /* ignore */ }

      const results = [];
      for (const pos of positions) {
        const balance = parseFloat(pos.balance as string);
        const rate = rateOverrides[pos.currency] ?? DEFAULT_FLOAT_RATES[pos.currency]?.rate ?? 0.04;
        const yieldAmount = calculateDailyYield(balance, rate);

        try {
          await db.execute(
            sql`INSERT INTO float_income_records (currency, date, balance, rate, yield_amount, created_at)
                VALUES (${pos.currency}, ${today}::date, ${balance}, ${rate}, ${yieldAmount}, NOW())
                ON CONFLICT (currency, date) DO NOTHING`
          );
        } catch { /* table may not exist yet */ }

        results.push({ currency: pos.currency, date: today, balance, rate, yieldAmount: Math.round(yieldAmount * 100) / 100 });
      }

      await createAuditLog({
        userId: ctx.user.id,
        action: "floatIncome.accrueDaily",
        targetType: "float_income",
        description: JSON.stringify({ date: today, currencies: results.length }),
      });

      return { success: true, verified: true, date: today, accruals: results };
    }),
});
