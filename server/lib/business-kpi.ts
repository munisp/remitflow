/**
 * Business KPI Dashboard — real-time metrics aggregation.
 * Tracks: DAT, transfer volume, conversion funnels, FX margins, corridor SLAs.
 */
import { z } from "zod";
import { getDb } from "../db";
import { transactions, users, wallets, kycDocuments } from "../../drizzle/schema";
import { sql, eq, gte, lte, count, sum, and, desc } from "drizzle-orm";
import { router, adminProcedure } from "../_core/trpc";

export const businessKpiRouter = router({
  dailyActiveTransactors: adminProcedure.query(async () => {
    const db = await getDb();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = await db
      .select({ count: sql<number>`COUNT(DISTINCT ${transactions.userId})` })
      .from(transactions)
      .where(gte(transactions.createdAt, today));
    return { date: today.toISOString(), activeTransactors: result[0]?.count ?? 0 };
  }),

  transferVolume: adminProcedure
    .input(z.object({ days: z.number().min(1).max(365).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      const since = new Date(Date.now() - input.days * 86400000);
      const result = await db
        .select({
          date: sql<string>`DATE(${transactions.createdAt})`,
          totalAmount: sql<number>`COALESCE(SUM(${transactions.fromAmount}), 0)`,
          txCount: count(),
        })
        .from(transactions)
        .where(gte(transactions.createdAt, since))
        .groupBy(sql`DATE(${transactions.createdAt})`)
        .orderBy(sql`DATE(${transactions.createdAt})`);
      return result;
    }),

  corridorBreakdown: adminProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      const since = new Date(Date.now() - input.days * 86400000);
      const result = await db
        .select({
          fromCurrency: transactions.fromCurrency,
          toCurrency: transactions.toCurrency,
          volume: sql<number>`COALESCE(SUM(${transactions.fromAmount}), 0)`,
          txCount: count(),
          avgAmount: sql<number>`COALESCE(AVG(${transactions.fromAmount}), 0)`,
        })
        .from(transactions)
        .where(gte(transactions.createdAt, since))
        .groupBy(transactions.fromCurrency, transactions.toCurrency)
        .orderBy(desc(sql`SUM(${transactions.fromAmount})`))
        .limit(20);
      return result;
    }),

  conversionFunnel: adminProcedure.query(async () => {
    const db = await getDb();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const [signups] = await db
      .select({ count: count() })
      .from(users)
      .where(gte(users.createdAt, thirtyDaysAgo));
    const [kycStarted] = await db
      .select({ count: sql<number>`COUNT(DISTINCT ${kycDocuments.userId})` })
      .from(kycDocuments)
      .where(gte(kycDocuments.createdAt, thirtyDaysAgo));
    const [firstTransfer] = await db
      .select({ count: sql<number>`COUNT(DISTINCT ${transactions.userId})` })
      .from(transactions)
      .where(gte(transactions.createdAt, thirtyDaysAgo));
    return {
      period: "30d",
      signups: signups?.count ?? 0,
      kycStarted: kycStarted?.count ?? 0,
      firstTransfer: firstTransfer?.count ?? 0,
      signupToKycRate: signups?.count ? ((kycStarted?.count ?? 0) / signups.count * 100).toFixed(1) : "0",
      kycToTransferRate: kycStarted?.count ? ((firstTransfer?.count ?? 0) / (kycStarted?.count ?? 1) * 100).toFixed(1) : "0",
    };
  }),

  revenueMetrics: adminProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      const since = new Date(Date.now() - input.days * 86400000);
      const result = await db
        .select({
          totalFees: sql<number>`COALESCE(SUM(${transactions.fee}), 0)`,
          totalVolume: sql<number>`COALESCE(SUM(${transactions.fromAmount}), 0)`,
          txCount: count(),
        })
        .from(transactions)
        .where(gte(transactions.createdAt, since));
      const row = result[0];
      return {
        totalFees: row?.totalFees ?? 0,
        totalVolume: row?.totalVolume ?? 0,
        txCount: row?.txCount ?? 0,
        avgFeeRate: row?.totalVolume ? ((row.totalFees / row.totalVolume) * 100).toFixed(3) : "0",
        avgTxSize: row?.txCount ? Math.round(row.totalVolume / row.txCount) : 0,
      };
    }),

  kycTierDistribution: adminProcedure.query(async () => {
    const db = await getDb();
    const result = await db
      .select({
        kycTier: users.kycTier,
        count: count(),
      })
      .from(users)
      .groupBy(users.kycTier);
    return result;
  }),

  platformHealth: adminProcedure.query(async () => {
    const db = await getDb();
    const oneHourAgo = new Date(Date.now() - 3600000);
    const [recentTx] = await db
      .select({ count: count() })
      .from(transactions)
      .where(gte(transactions.createdAt, oneHourAgo));
    const [totalUsers] = await db.select({ count: count() }).from(users);
    const [totalWallets] = await db.select({ count: count() }).from(wallets);
    return {
      transactionsLastHour: recentTx?.count ?? 0,
      totalUsers: totalUsers?.count ?? 0,
      totalWallets: totalWallets?.count ?? 0,
      timestamp: new Date().toISOString(),
    };
  }),
});
