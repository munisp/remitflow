/**
 * Agent Network Intelligence — demand heatmaps, dynamic float, performance scoring.
 * Uses agentAccounts joined with transactions via userId to compute agent metrics.
 */
import { z } from "zod";
import { getDb } from "../db";
import { agentAccounts, transactions } from "../../drizzle/schema";
import { sql, eq, gte, desc, count, and } from "drizzle-orm";
import { router, adminProcedure } from "../_core/trpc";

export const agentIntelligenceRouter = router({
  demandHeatmap: adminProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(7) }))
    .query(async ({ input }) => {
      const db = await getDb();
      const since = new Date(Date.now() - input.days * 86400000);
      const result = await db
        .select({
          userId: transactions.userId,
          txCount: count(),
          totalVolume: sql<number>`COALESCE(SUM(CAST(${transactions.fromAmount} AS numeric)), 0)`,
        })
        .from(transactions)
        .where(and(eq(transactions.channel, "agent"), gte(transactions.createdAt, since)))
        .groupBy(transactions.userId)
        .orderBy(desc(count()));
      return {
        period: `${input.days}d`,
        hotspots: result.map((r: { userId: number; txCount: number; totalVolume: number }) => ({
          agentId: `AGENT-${r.userId}`,
          transactionCount: r.txCount,
          volume: r.totalVolume,
          intensity: r.txCount > 100 ? "critical" : r.txCount > 50 ? "high" : r.txCount > 20 ? "medium" : "low",
        })),
      };
    }),

  dynamicFloat: adminProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const agentUserId = parseInt(input.agentId.replace("AGENT-", ""), 10) || 0;
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
      const stats = await db
        .select({
          total: sql<number>`COALESCE(SUM(CAST(${transactions.fromAmount} AS numeric)), 0)`,
          txCount: count(),
        })
        .from(transactions)
        .where(and(eq(transactions.userId, agentUserId), gte(transactions.createdAt, sevenDaysAgo)));
      const avgDaily = (stats[0]?.total ?? 0) / 7;
      const recommended = Math.ceil(avgDaily * 1.3);
      return {
        agentId: input.agentId,
        averageDailyVolume: Math.round(avgDaily),
        recommendedFloat: recommended,
        bufferPercentage: 30,
        totalTransactions7d: stats[0]?.txCount ?? 0,
      };
    }),

  performanceScoring: adminProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      const since = new Date(Date.now() - input.days * 86400000);
      const agents = await db
        .select({
          userId: transactions.userId,
          txCount: count(),
          totalVolume: sql<number>`COALESCE(SUM(CAST(${transactions.fromAmount} AS numeric)), 0)`,
        })
        .from(transactions)
        .where(and(eq(transactions.channel, "agent"), gte(transactions.createdAt, since)))
        .groupBy(transactions.userId)
        .orderBy(desc(sql`SUM(CAST(${transactions.fromAmount} AS numeric))`))
        .limit(50);

      let rank = 0;
      return agents.map((a: { userId: number; txCount: number; totalVolume: number }) => {
        rank++;
        const volumeScore = Math.min(10, (a.totalVolume / 1000000) * 2);
        const activityScore = Math.min(10, (a.txCount / (input.days * 5)) * 10);
        const overall = ((volumeScore + activityScore) / 2).toFixed(1);
        return {
          rank,
          agentId: `AGENT-${a.userId}`,
          transactionCount: a.txCount,
          totalVolume: a.totalVolume,
          overallScore: Number(overall),
          tier: Number(overall) > 8 ? "platinum" : Number(overall) > 6 ? "gold" : Number(overall) > 4 ? "silver" : "bronze",
        };
      });
    }),

  floatTransferRequest: adminProcedure
    .input(z.object({ fromAgentId: z.string(), toAgentId: z.string(), amount: z.number().positive(), currency: z.string().length(3).default("NGN") }))
    .mutation(async ({ input }) => {
      return { success: true, transferId: `FLT-${Date.now()}`, from: input.fromAgentId, to: input.toAgentId, amount: input.amount, currency: input.currency, status: "pending_approval" };
    }),
});
