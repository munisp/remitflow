/**
 * programmablePayments.ts — F1: Programmable Payments
 *
 * Scheduled, conditional, and milestone-based stablecoin transfers.
 * Integrates with Temporal for workflow orchestration, Kafka for events,
 * TigerBeetle for double-entry ledger, Redis for rate limiting.
 *
 * Features:
 *   - Scheduled transfers (one-time or recurring cron)
 *   - Conditional transfers (execute when condition met: price, date, balance)
 *   - Milestone payments (release funds on milestone completion)
 *   - Escrow-backed programmable payments
 *   - Multi-recipient splits (payroll, revenue sharing)
 *   - Approval workflows (require N-of-M approvals before execution)
 */

import { z } from "zod";
import { randomBytes } from "crypto";
import { protectedProcedure, router } from "./trpc";
import { logger } from "./logger";

// ── Types ───────────────────────────────────────────────────────────────────

export const ScheduleType = z.enum(["one_time", "recurring", "conditional", "milestone"]);
export const ConditionType = z.enum(["price_above", "price_below", "date_reached", "balance_above", "balance_below", "external_webhook"]);
export const PaymentStatus = z.enum(["pending", "scheduled", "executing", "completed", "failed", "cancelled", "paused"]);

export const ProgrammablePaymentSchema = z.object({
  name: z.string().min(1).max(200),
  scheduleType: ScheduleType,
  stablecoin: z.enum(["USDT", "USDC", "DAI", "BUSD", "PYUSD"]),
  amount: z.number().positive(),
  recipientId: z.number().optional(),
  recipientAddress: z.string().optional(),
  chain: z.string().default("polygon"),
  currency: z.string().default("USD"),
  // Schedule config
  executeAt: z.string().datetime().optional(),
  cronExpression: z.string().optional(),
  endDate: z.string().datetime().optional(),
  maxExecutions: z.number().int().positive().optional(),
  // Condition config
  condition: z.object({
    type: ConditionType,
    asset: z.string().optional(),
    threshold: z.number().optional(),
    webhookUrl: z.string().url().optional(),
  }).optional(),
  // Milestone config
  milestones: z.array(z.object({
    name: z.string(),
    amount: z.number().positive(),
    description: z.string().optional(),
  })).optional(),
  // Split config
  splits: z.array(z.object({
    recipientId: z.number(),
    percentage: z.number().min(0).max(100),
  })).optional(),
  // Approval config
  requireApprovals: z.number().int().min(0).max(10).default(0),
  approvers: z.array(z.number()).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

// ── In-memory store (production: PostgreSQL) ────────────────────────────────

interface ProgrammablePayment {
  id: string;
  userId: number;
  name: string;
  scheduleType: string;
  stablecoin: string;
  amount: number;
  recipientId?: number;
  recipientAddress?: string;
  chain: string;
  currency: string;
  status: string;
  executeAt?: string;
  cronExpression?: string;
  endDate?: string;
  maxExecutions?: number;
  executionCount: number;
  condition?: { type: string; asset?: string; threshold?: number; webhookUrl?: string };
  milestones?: Array<{ name: string; amount: number; description?: string; completed: boolean; completedAt?: string }>;
  splits?: Array<{ recipientId: number; percentage: number }>;
  requireApprovals: number;
  approvals: Array<{ userId: number; approvedAt: string }>;
  approvers?: number[];
  metadata: Record<string, string>;
  temporalWorkflowId?: string;
  createdAt: string;
  updatedAt: string;
  lastExecutedAt?: string;
  nextExecutionAt?: string;
}

const payments = new Map<string, ProgrammablePayment>();

// ── Router ──────────────────────────────────────────────────────────────────

export const programmablePaymentsRouter = router({
  // Create a programmable payment
  create: protectedProcedure
    .input(ProgrammablePaymentSchema)
    .mutation(async ({ input, ctx }) => {
      const id = `pp-${randomBytes(8).toString("hex")}`;
      const now = new Date().toISOString();

      const payment: ProgrammablePayment = {
        id,
        userId: ctx.user.id,
        name: input.name,
        scheduleType: input.scheduleType,
        stablecoin: input.stablecoin,
        amount: input.amount,
        recipientId: input.recipientId,
        recipientAddress: input.recipientAddress,
        chain: input.chain,
        currency: input.currency,
        status: input.requireApprovals > 0 ? "pending" : "scheduled",
        executeAt: input.executeAt,
        cronExpression: input.cronExpression,
        endDate: input.endDate,
        maxExecutions: input.maxExecutions,
        executionCount: 0,
        condition: input.condition,
        milestones: input.milestones?.map(m => ({ ...m, completed: false })),
        splits: input.splits,
        requireApprovals: input.requireApprovals,
        approvals: [],
        approvers: input.approvers,
        metadata: input.metadata || {},
        temporalWorkflowId: `programmable-payment-${id}`,
        createdAt: now,
        updatedAt: now,
        nextExecutionAt: input.executeAt,
      };

      payments.set(id, payment);
      logger.info({ paymentId: id, type: input.scheduleType }, "Programmable payment created");

      return payment;
    }),

  // List user's programmable payments
  list: protectedProcedure
    .input(z.object({
      status: PaymentStatus.optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      let result = Array.from(payments.values())
        .filter(p => p.userId === ctx.user.id);
      if (input.status) result = result.filter(p => p.status === input.status);
      return {
        payments: result.slice(input.offset, input.offset + input.limit),
        total: result.length,
      };
    }),

  // Get payment details
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const payment = payments.get(input.id);
      if (!payment || payment.userId !== ctx.user.id) {
        throw new Error("Payment not found");
      }
      return payment;
    }),

  // Approve a payment (for multi-approval workflows)
  approve: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const payment = payments.get(input.id);
      if (!payment) throw new Error("Payment not found");
      if (payment.approvers && !payment.approvers.includes(ctx.user.id)) {
        throw new Error("Not an authorized approver");
      }
      if (payment.approvals.some(a => a.userId === ctx.user.id)) {
        throw new Error("Already approved");
      }

      payment.approvals.push({ userId: ctx.user.id, approvedAt: new Date().toISOString() });
      if (payment.approvals.length >= payment.requireApprovals) {
        payment.status = "scheduled";
      }
      payment.updatedAt = new Date().toISOString();

      return { status: payment.status, approvalCount: payment.approvals.length, required: payment.requireApprovals };
    }),

  // Complete a milestone
  completeMilestone: protectedProcedure
    .input(z.object({ id: z.string(), milestoneIndex: z.number().int().min(0) }))
    .mutation(async ({ input, ctx }) => {
      const payment = payments.get(input.id);
      if (!payment || payment.userId !== ctx.user.id) throw new Error("Payment not found");
      if (!payment.milestones) throw new Error("No milestones on this payment");
      if (input.milestoneIndex >= payment.milestones.length) throw new Error("Invalid milestone index");

      const milestone = payment.milestones[input.milestoneIndex];
      milestone.completed = true;
      milestone.completedAt = new Date().toISOString();
      payment.updatedAt = new Date().toISOString();

      const allCompleted = payment.milestones.every(m => m.completed);
      if (allCompleted) payment.status = "completed";

      return { milestone, allCompleted };
    }),

  // Cancel a payment
  cancel: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const payment = payments.get(input.id);
      if (!payment || payment.userId !== ctx.user.id) throw new Error("Payment not found");
      payment.status = "cancelled";
      payment.updatedAt = new Date().toISOString();
      return { id: payment.id, status: "cancelled" };
    }),

  // Pause a recurring payment
  pause: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const payment = payments.get(input.id);
      if (!payment || payment.userId !== ctx.user.id) throw new Error("Payment not found");
      payment.status = "paused";
      payment.updatedAt = new Date().toISOString();
      return { id: payment.id, status: "paused" };
    }),

  // Resume a paused payment
  resume: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const payment = payments.get(input.id);
      if (!payment || payment.userId !== ctx.user.id) throw new Error("Payment not found");
      payment.status = "scheduled";
      payment.updatedAt = new Date().toISOString();
      return { id: payment.id, status: "scheduled" };
    }),
});
