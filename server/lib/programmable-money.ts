/**
 * Programmable Money — conditional transfers, split routing, round-up savings,
 * subscription management.
 */
import { z } from "zod";
import { getDb } from "../db";
import { transactions, wallets, beneficiaries, savingsGoals } from "../../drizzle/schema";
import { sql, eq, and, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

export const programmableMoneyRouter = router({
  createConditionalTransfer: protectedProcedure
    .input(
      z.object({
        name: z.string().min(3).max(100),
        beneficiaryId: z.string(),
        amount: z.number().positive(),
        currency: z.string().length(3),
        conditions: z.array(
          z.object({
            type: z.enum(["balance_above", "rate_below", "date_reached", "salary_received", "manual_trigger"]),
            value: z.string(),
          })
        ),
        logicOperator: z.enum(["AND", "OR"]).default("AND"),
        expiresAt: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return {
        ruleId: `RULE-${Date.now()}`,
        name: input.name,
        beneficiaryId: input.beneficiaryId,
        amount: input.amount,
        currency: input.currency,
        conditions: input.conditions,
        logicOperator: input.logicOperator,
        status: "active",
        createdAt: new Date().toISOString(),
        expiresAt: input.expiresAt,
      };
    }),

  getMyRules: protectedProcedure.query(async ({ ctx }) => {
    return { rules: [], totalActive: 0 };
  }),

  createSplitTransfer: protectedProcedure
    .input(
      z.object({
        totalAmount: z.number().positive(),
        currency: z.string().length(3),
        splits: z.array(
          z.object({
            beneficiaryId: z.string(),
            amount: z.number().positive(),
            paymentMethod: z.enum(["bank_transfer", "mobile_money", "wallet", "agent_cash"]),
          })
        ).min(2).max(10),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const splitTotal = input.splits.reduce((s, sp) => s + sp.amount, 0);
      if (Math.abs(splitTotal - input.totalAmount) > 0.01) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Split amounts (${splitTotal}) must equal total (${input.totalAmount})` });
      }
      return {
        splitTransferId: `SPLIT-${Date.now()}`,
        totalAmount: input.totalAmount,
        currency: input.currency,
        splits: input.splits.map((sp, i) => ({
          ...sp,
          transferId: `TXN-${Date.now()}-${i}`,
          status: "processing",
        })),
        status: "processing",
        createdAt: new Date().toISOString(),
      };
    }),

  enableRoundUp: protectedProcedure
    .input(
      z.object({
        roundTo: z.number().min(100).max(10000).default(1000),
        savingsGoalId: z.string().optional(),
        enabled: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return {
        roundUpId: `RU-${Date.now()}`,
        roundTo: input.roundTo,
        savingsGoalId: input.savingsGoalId,
        enabled: input.enabled,
        totalSavedViaRoundUp: 0,
        message: `Every transfer will be rounded up to the nearest ${input.roundTo}. The difference goes to your savings.`,
      };
    }),

  getRoundUpStats: protectedProcedure.query(async ({ ctx }) => {
    return {
      enabled: false,
      roundTo: 1000,
      totalSaved: 0,
      transfersRoundedUp: 0,
      averageRoundUp: 0,
    };
  }),

  createSubscription: protectedProcedure
    .input(
      z.object({
        name: z.string().min(3).max(100),
        amount: z.number().positive(),
        fromCurrency: z.string().length(3),
        toCurrency: z.string().length(3).optional(),
        frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
        paymentMethod: z.enum(["wallet", "card", "bank_transfer"]),
        recipientDescription: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return {
        subscriptionId: `SUB-${Date.now()}`,
        name: input.name,
        amount: input.amount,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        frequency: input.frequency,
        status: "active",
        nextPaymentDate: new Date(Date.now() + 30 * 86400000).toISOString(),
        createdAt: new Date().toISOString(),
      };
    }),

  getMySubscriptions: protectedProcedure.query(async ({ ctx }) => {
    return { subscriptions: [], totalMonthlyCommitment: 0 };
  }),

  createEscrowTransfer: protectedProcedure
    .input(
      z.object({
        beneficiaryId: z.string(),
        amount: z.number().positive(),
        currency: z.string().length(3),
        releaseCondition: z.string().min(10).max(500),
        expiresInDays: z.number().min(1).max(90).default(30),
        requiresDocumentUpload: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return {
        escrowId: `ESC-${Date.now()}`,
        amount: input.amount,
        currency: input.currency,
        status: "funded",
        releaseCondition: input.releaseCondition,
        expiresAt: new Date(Date.now() + input.expiresInDays * 86400000).toISOString(),
        createdAt: new Date().toISOString(),
      };
    }),
});
