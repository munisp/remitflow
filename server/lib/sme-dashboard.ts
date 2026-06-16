/**
 * Unified SME Dashboard — cash flow, payables, receivables, multi-user accounts.
 */
import { z } from "zod";
import { getDb } from "../db";
import { transactions, wallets, users } from "../../drizzle/schema";
import { sql, eq, gte, and, desc, count, sum } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";

export const smeDashboardRouter = router({
  cashFlowOverview: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const userId = ctx.user!.id;
      const since = new Date(Date.now() - input.days * 86400000);

      const [inflow] = await db
        .select({ total: sql<number>`COALESCE(SUM(${transactions.fromAmount}), 0)` })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), gte(transactions.createdAt, since)));
      const [outflow] = await db
        .select({ total: sql<number>`COALESCE(SUM(${transactions.fromAmount}), 0)` })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), gte(transactions.createdAt, since)));

      const walletBalances = await db
        .select({ currency: wallets.currency, balance: wallets.balance })
        .from(wallets)
        .where(eq(wallets.userId, userId));

      return {
        period: `${input.days}d`,
        inflow: inflow?.total ?? 0,
        outflow: outflow?.total ?? 0,
        netCashFlow: (inflow?.total ?? 0) - (outflow?.total ?? 0),
        walletBalances,
        burnRate: input.days > 0 ? Math.round((outflow?.total ?? 0) / input.days) : 0,
        runwayDays: (outflow?.total ?? 0) > 0
          ? Math.round(walletBalances.reduce((s: number, w: { balance: string | null }) => s + Number(w.balance), 0) / ((outflow?.total ?? 0) / input.days))
          : 999,
      };
    }),

  payablesReceivables: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const userId = ctx.user!.id;
    const [payables] = await db
      .select({ total: sql<number>`COALESCE(SUM(${transactions.fromAmount}), 0)`, count: count() })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.status, "pending")));
    const [receivables] = await db
      .select({ total: sql<number>`COALESCE(SUM(${transactions.fromAmount}), 0)`, count: count() })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.status, "pending")));
    return {
      payables: { amount: payables?.total ?? 0, count: payables?.count ?? 0 },
      receivables: { amount: receivables?.total ?? 0, count: receivables?.count ?? 0 },
      netPosition: (receivables?.total ?? 0) - (payables?.total ?? 0),
    };
  }),

  fxExposure: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const userId = ctx.user!.id;
    const balances = await db
      .select({ currency: wallets.currency, balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.userId, userId));
    const total = balances.reduce((s: number, b: { balance: string | null }) => s + Number(b.balance), 0);
    return {
      currencies: balances.map((b: { currency: string; balance: string | null }) => ({
        currency: b.currency,
        balance: Number(b.balance),
        percentage: total > 0 ? ((Number(b.balance) / total) * 100).toFixed(1) : "0",
      })),
      totalEquivalent: total,
      dominantCurrency: balances.sort((a: { balance: string | null }, b: { balance: string | null }) => Number(b.balance) - Number(a.balance))[0]?.currency ?? "NGN",
      diversificationScore: Math.min(10, balances.length * 2),
    };
  }),

  businessAccountRoles: protectedProcedure.query(async () => {
    return {
      roles: [
        { role: "owner", permissions: ["all"], description: "Full access to all features" },
        { role: "finance_manager", permissions: ["transfers", "reports", "wallets", "reconciliation"], description: "Manage finances and reporting" },
        { role: "payroll_admin", permissions: ["payroll", "contractor_payments"], description: "Process payroll and contractor payments" },
        { role: "viewer", permissions: ["read_only"], description: "View-only access to dashboards" },
      ],
    };
  }),

  exportStatement: protectedProcedure
    .input(
      z.object({
        fromDate: z.string(),
        toDate: z.string(),
        format: z.enum(["csv", "pdf", "xero", "quickbooks"]).default("csv"),
        currency: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const userId = ctx.user!.id;
      const txs = await db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            gte(transactions.createdAt, new Date(input.fromDate)),
          )
        )
        .orderBy(desc(transactions.createdAt))
        .limit(1000);
      return {
        format: input.format,
        transactionCount: txs.length,
        dateRange: { from: input.fromDate, to: input.toDate },
        downloadUrl: `/api/export/statement?format=${input.format}`,
      };
    }),
});
