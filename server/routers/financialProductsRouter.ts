import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gte, sql, sum } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { router, protectedProcedure } from "../_core/trpc";
import { logger } from "../_core/logger";
import { getDb } from "../db";
import {
  autosaveRules,
  bnplPlans,
  investmentCatalogProducts,
  savingsGoals,
  savingsRoundupPreferences,
  savingsStreaks,
  transactions,
  users,
} from "../../drizzle/schema";
import { KAFKA_TOPICS, publishEvent } from "../middleware/kafka";
import { ollamaChat } from "../ollama.service";

const instalmentSchema = z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(6), z.literal(12)]);
const roundUpSchema = z.union([z.literal(1), z.literal(5), z.literal(10)]);

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

async function publishFinancialEvent(key: string, payload: Record<string, unknown>): Promise<void> {
  const accepted = await publishEvent(KAFKA_TOPICS.PAYMENT_INITIATED, key, {
    paymentId: key,
    userId: payload.userId,
    amount: payload.amount,
    fromCurrency: payload.currency,
    status: "pending",
    timestamp: new Date().toISOString(),
    ...payload,
  });
  if (!accepted) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Kafka did not accept the financial-product event." });
}

async function computeBnplCreditScore(userId: number): Promise<{
  score: number;
  tier: "poor" | "fair" | "good" | "excellent";
  maxLimit: number;
  factors: Record<string, number>;
}> {
  const db = await requireDb();
  const [dbUser] = await db.select({ kycTier: users.kycTier, createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (!dbUser) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const metrics = await db.select({ txCount: count(), totalVolume: sum(transactions.fromAmount) }).from(transactions).where(and(eq(transactions.userId, userId), gte(transactions.createdAt, since)));
  const plans = await db.select({ status: bnplPlans.status }).from(bnplPlans).where(eq(bnplPlans.userId, userId));
  const completed = (plans as Array<{ status: string | null }>).filter((plan) => plan.status === "completed").length;
  const defaulted = (plans as Array<{ status: string | null }>).filter((plan) => plan.status === "defaulted").length;
  const kycScore = dbUser.kycTier === "tier3" ? 300 : dbUser.kycTier === "tier2" ? 200 : dbUser.kycTier === "tier1" ? 100 : 0;
  const frequencyScore = Math.min(200, Number(metrics[0]?.txCount ?? 0) * 5);
  const volumeScore = Math.min(200, Math.floor(Number(metrics[0]?.totalVolume ?? 0) / 100));
  const accountAgeDays = dbUser.createdAt ? Math.max(0, Math.floor((Date.now() - dbUser.createdAt.getTime()) / 86_400_000)) : 0;
  const ageScore = Math.min(150, Math.floor(accountAgeDays / 10));
  const repaymentScore = Math.max(-200, completed * 30 - defaulted * 100);
  const score = Math.max(0, Math.min(1000, kycScore + frequencyScore + volumeScore + ageScore + repaymentScore));
  const tier = score >= 750 ? "excellent" : score >= 600 ? "good" : score >= 400 ? "fair" : "poor";
  const maxLimit = tier === "excellent" ? 5000 : tier === "good" ? 2000 : tier === "fair" ? 500 : 0;
  return { score, tier, maxLimit, factors: { kycScore, frequencyScore, volumeScore, ageScore, repaymentScore } };
}

function nextExecution(frequency: "daily" | "weekly" | "monthly", start: Date): Date {
  const next = new Date(start);
  if (frequency === "daily") next.setDate(next.getDate() + 1);
  else if (frequency === "weekly") next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

export const financialProductsRouter = router({
  getBnplEligibility: protectedProcedure.query(async ({ ctx }) => computeBnplCreditScore(ctx.user.id)),

  createBnplPlan: protectedProcedure.input(z.object({
    amount: z.number().positive().max(5000),
    currency: z.string().length(3),
    merchant: z.string().min(1).max(200),
    description: z.string().max(500).optional(),
    instalments: instalmentSchema,
  })).mutation(async ({ ctx, input }) => {
    const eligibility = await computeBnplCreditScore(ctx.user.id);
    if (eligibility.tier === "poor" || input.amount > eligibility.maxLimit) {
      throw new TRPCError({ code: "FORBIDDEN", message: "The requested BNPL amount is not eligible for this account." });
    }
    const interestRate = eligibility.tier === "excellent" ? 0 : eligibility.tier === "good" ? 1.5 : 3.5;
    const totalAmount = input.amount * (1 + interestRate / 100);
    const installmentAmount = totalAmount / input.instalments;
    const firstDue = nextExecution("monthly", new Date());
    const db = await requireDb();
    const [plan] = await db.insert(bnplPlans).values({
      userId: ctx.user.id,
      merchant: input.merchant,
      description: input.description ?? null,
      totalAmount: totalAmount.toFixed(2),
      paidAmount: "0.00",
      currency: input.currency,
      installments: input.instalments,
      installmentAmount: installmentAmount.toFixed(2),
      interestRate: interestRate.toFixed(2),
      status: "active",
      nextDueDate: firstDue,
    }).returning();
    if (!plan) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unable to persist BNPL plan." });
    await publishFinancialEvent(`bnpl:${plan.id}`, { userId: ctx.user.id, amount: input.amount, currency: input.currency, planId: plan.id, installments: input.instalments });
    return { planId: plan.id, totalAmount, installmentAmount, interestRate, nextDueDate: firstDue.toISOString(), status: plan.status };
  }),

  explainCreditDecision: protectedProcedure.query(async ({ ctx }) => {
    const model = process.env.OLLAMA_FINANCIAL_MODEL?.trim();
    if (!model) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "OLLAMA_FINANCIAL_MODEL must be configured." });
    const eligibility = await computeBnplCreditScore(ctx.user.id);
    const response = await ollamaChat([
      { role: "system", content: "Explain a BNPL eligibility decision accurately and concisely. Do not promise approval or financial outcomes." },
      { role: "user", content: JSON.stringify(eligibility) },
    ], model, { temperature: 0.2, maxTokens: 180 });
    return { ...eligibility, explanation: response.content, model: response.model };
  }),

  configureRoundUpSavings: protectedProcedure.input(z.object({
    enabled: z.boolean(), roundUpTo: roundUpSchema, savingsGoalId: z.number().int().positive().optional(), currency: z.string().length(3),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    if (input.savingsGoalId) {
      const [goal] = await db.select({ id: savingsGoals.id }).from(savingsGoals).where(and(eq(savingsGoals.id, input.savingsGoalId), eq(savingsGoals.userId, ctx.user.id))).limit(1);
      if (!goal) throw new TRPCError({ code: "NOT_FOUND", message: "Savings goal not found." });
    }
    await db.insert(savingsRoundupPreferences).values({ userId: ctx.user.id, enabled: input.enabled, roundUpTo: input.roundUpTo, savingsGoalId: input.savingsGoalId, currency: input.currency, updatedAt: new Date() }).onConflictDoUpdate({ target: savingsRoundupPreferences.userId, set: { enabled: input.enabled, roundUpTo: input.roundUpTo, savingsGoalId: input.savingsGoalId, currency: input.currency, updatedAt: new Date() } });
    await publishFinancialEvent(`savings-roundup:${ctx.user.id}`, { userId: ctx.user.id, amount: 0, currency: input.currency, enabled: input.enabled, roundUpTo: input.roundUpTo });
    return { enabled: input.enabled, roundUpTo: input.roundUpTo, savingsGoalId: input.savingsGoalId, currency: input.currency };
  }),

  createAutoSaveRule: protectedProcedure.input(z.object({
    amount: z.number().positive().max(10000), currency: z.string().length(3), frequency: z.enum(["daily", "weekly", "monthly"]), savingsGoalId: z.number().int().positive().optional(), startDate: z.string().datetime().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    if (input.savingsGoalId) {
      const [goal] = await db.select({ id: savingsGoals.id }).from(savingsGoals).where(and(eq(savingsGoals.id, input.savingsGoalId), eq(savingsGoals.userId, ctx.user.id))).limit(1);
      if (!goal) throw new TRPCError({ code: "NOT_FOUND", message: "Savings goal not found." });
    }
    const start = input.startDate ? new Date(input.startDate) : new Date();
    const id = createId();
    const next = nextExecution(input.frequency, start);
    const [rule] = await db.insert(autosaveRules).values({ id, userId: ctx.user.id, savingsGoalId: input.savingsGoalId, amount: input.amount.toFixed(2), currency: input.currency, frequency: input.frequency, startDate: start, status: "active", nextExecutionAt: next }).returning();
    if (!rule) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unable to persist auto-save rule." });
    await publishFinancialEvent(`autosave:${rule.id}`, { userId: ctx.user.id, amount: input.amount, currency: input.currency, ruleId: rule.id, frequency: input.frequency });
    return { ruleId: rule.id, nextExecutionAt: rule.nextExecutionAt.toISOString(), status: rule.status };
  }),

  getSavingsStreak: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const [streak] = await db.select().from(savingsStreaks).where(eq(savingsStreaks.userId, ctx.user.id)).limit(1);
    const goals = await db.select().from(savingsGoals).where(eq(savingsGoals.userId, ctx.user.id)).orderBy(desc(savingsGoals.createdAt));
    const typedGoals = goals as Array<{ id: number; name: string; currentAmount: string | null; targetAmount: string; status: string | null; targetDate: Date | null }>;
    const activeGoals = typedGoals.filter((goal) => goal.status === "active");
    const totalSaved = typedGoals.reduce((total, goal) => total + Number(goal.currentAmount ?? 0), 0);
    return {
      activeGoals: activeGoals.length,
      completedGoals: typedGoals.filter((goal) => goal.status === "completed").length,
      totalSaved,
      currentStreak: streak?.currentStreak ?? 0,
      longestStreak: streak?.longestStreak ?? 0,
      lastSaveDate: streak?.lastSaveDate?.toISOString() ?? null,
      goals: activeGoals.map((goal) => ({ id: goal.id, name: goal.name, currentAmount: Number(goal.currentAmount ?? 0), targetAmount: Number(goal.targetAmount), status: goal.status, targetDate: goal.targetDate?.toISOString() ?? null })),
    };
  }),

  getInvestmentProducts: protectedProcedure.input(z.object({ currency: z.string().length(3) })).query(async ({ input }) => {
    const db = await requireDb();
    return db.select().from(investmentCatalogProducts).where(and(eq(investmentCatalogProducts.currency, input.currency), eq(investmentCatalogProducts.status, "active"))).orderBy(desc(investmentCatalogProducts.sourceUpdatedAt));
  }),
});
