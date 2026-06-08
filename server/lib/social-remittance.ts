/**
 * Social Remittance Network — circles, lending groups (ajo/esusu/chama), community pooling.
 */
import { z } from "zod";
import { getDb } from "../db";
import { users, transactions, wallets } from "../../drizzle/schema";
import { sql, eq, gte, and, desc, count, sum } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

export const socialRemittanceRouter = router({
  createCircle: protectedProcedure
    .input(
      z.object({
        name: z.string().min(3).max(100),
        type: z.enum(["savings_circle", "community_pool", "lending_group"]),
        targetAmount: z.number().positive(),
        currency: z.string().length(3).default("NGN"),
        maxMembers: z.number().min(2).max(50).default(10),
        contributionFrequency: z.enum(["weekly", "biweekly", "monthly"]).default("monthly"),
        description: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return {
        circleId: `CIR-${Date.now()}`,
        name: input.name,
        type: input.type,
        targetAmount: input.targetAmount,
        currency: input.currency,
        maxMembers: input.maxMembers,
        contributionFrequency: input.contributionFrequency,
        creator: ctx.user!.id,
        members: [{ userId: ctx.user!.id, role: "admin", joinedAt: new Date().toISOString() }],
        currentAmount: 0,
        status: "active",
        createdAt: new Date().toISOString(),
      };
    }),

  joinCircle: protectedProcedure
    .input(z.object({ circleId: z.string(), inviteCode: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      return {
        success: true,
        circleId: input.circleId,
        role: "member",
        joinedAt: new Date().toISOString(),
      };
    }),

  contribute: protectedProcedure
    .input(
      z.object({
        circleId: z.string(),
        amount: z.number().positive(),
        currency: z.string().length(3).default("NGN"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return {
        contributionId: `CON-${Date.now()}`,
        circleId: input.circleId,
        userId: ctx.user!.id,
        amount: input.amount,
        currency: input.currency,
        status: "confirmed",
        timestamp: new Date().toISOString(),
      };
    }),

  getMyCircles: protectedProcedure.query(async ({ ctx }) => {
    return {
      circles: [],
      totalContributed: 0,
      totalReceived: 0,
    };
  }),

  getCircleDetails: protectedProcedure
    .input(z.object({ circleId: z.string() }))
    .query(async ({ input }) => {
      return {
        circleId: input.circleId,
        name: "Circle",
        type: "savings_circle",
        members: [],
        currentAmount: 0,
        targetAmount: 0,
        progress: 0,
        nextPayoutDate: null,
        contributions: [],
        payouts: [],
      };
    }),

  lendingGroupPayoutSchedule: protectedProcedure
    .input(z.object({ circleId: z.string() }))
    .query(async ({ input }) => {
      return {
        circleId: input.circleId,
        schedule: [],
        currentRound: 0,
        totalRounds: 0,
      };
    }),

  giftTransfer: protectedProcedure
    .input(
      z.object({
        beneficiaryId: z.string(),
        amount: z.number().positive(),
        currency: z.string().length(3),
        occasion: z.enum(["birthday", "holiday", "wedding", "graduation", "new_baby", "other"]),
        message: z.string().max(200).optional(),
        cardDesign: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return {
        giftId: `GIFT-${Date.now()}`,
        status: "sent",
        occasion: input.occasion,
        message: input.message,
        cardUrl: `/gifts/${input.cardDesign ?? "default"}`,
      };
    }),

  milestones: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const userId = ctx.user!.id;
    const [stats] = await db
      .select({ total: sql<number>`COALESCE(SUM(${transactions.fromAmount}), 0)`, count: count() })
      .from(transactions)
      .where(eq(transactions.userId, userId));
    const totalSent = stats?.total ?? 0;
    const milestoneThresholds = [
      { amount: 100000, badge: "Starter", emoji: "🌱" },
      { amount: 500000, badge: "Regular Sender", emoji: "⭐" },
      { amount: 1000000, badge: "Gold Sender", emoji: "🥇" },
      { amount: 5000000, badge: "Platinum Sender", emoji: "💎" },
      { amount: 10000000, badge: "Diamond Sender", emoji: "👑" },
    ];
    const achieved = milestoneThresholds.filter((m) => totalSent >= m.amount);
    const next = milestoneThresholds.find((m) => totalSent < m.amount);
    return {
      totalLifetimeSent: totalSent,
      transferCount: stats?.count ?? 0,
      achievedMilestones: achieved,
      nextMilestone: next ? { ...next, progress: ((totalSent / next.amount) * 100).toFixed(1) } : null,
      currentBadge: achieved.length > 0 ? achieved[achieved.length - 1] : null,
    };
  }),
});
