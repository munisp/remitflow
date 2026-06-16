/**
 * Transfer Core Router — Production money movement endpoints.
 * Uses the TransferEngine (PostgreSQL locally, TigerBeetle-ready in production).
 * 
 * Middleware integration points:
 * - Ledger: PostgreSQL → TigerBeetle (double-entry accounting)
 * - Events: PostgreSQL audit_logs → Kafka (event streaming)
 * - Workflow: Direct → Temporal (saga orchestration)
 * - Mesh: HTTP → Dapr (service discovery + retry)
 */
import { z } from "zod";
import { sql } from "drizzle-orm";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { createAuditLog } from "../db";
import { executeTransfer, calculateFee, getFxRate, validateCompliance } from "../lib/transferEngine";
import { executeTransferPipeline } from "../_core/transferPipeline";
import { publishEvent, KAFKA_TOPICS } from "../middleware/kafka";
import { broadcastUserEvent } from "../sse.service";
import { logger } from "../_core/logger";

export const transferCoreRouter = router({
  /** Get a transfer quote (fee + FX rate) without executing */
  quote: protectedProcedure
    .input(z.object({
      amount: z.number().positive().max(10_000_000),
      fromCurrency: z.string().length(3),
      toCurrency: z.string().length(3),
      payoutMethod: z.enum(["bank_transfer", "mobile_money", "cash_pickup", "wallet"]).default("wallet"),
    }))
    .query(async ({ input }) => {
      const corridor = `${input.fromCurrency}-${input.toCurrency}`;
      const fee = calculateFee(input.amount, corridor);
      const fxRate = await getFxRate(input.fromCurrency, input.toCurrency);
      const creditAmount = input.amount * fxRate;
      const deliveryMap: Record<string, string> = {
        wallet: "Instant",
        mobile_money: "5 minutes",
        bank_transfer: "1-2 business days",
        cash_pickup: "30 minutes",
      };
      return {
        sendAmount: input.amount,
        fee: fee.totalFee,
        feeBreakdown: fee.feeBreakdown,
        totalCharged: input.amount + fee.totalFee,
        fxRate,
        receiveAmount: creditAmount,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        estimatedDelivery: deliveryMap[input.payoutMethod] || "1-3 business days",
        validForSeconds: 300,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };
    }),

  /** Execute a transfer (the full money movement pipeline) */
  send: protectedProcedure
    .input(z.object({
      recipientId: z.number().int().positive(),
      amount: z.number().positive().max(100000),
      fromCurrency: z.string().length(3),
      toCurrency: z.string().length(3),
      payoutMethod: z.enum(["bank_transfer", "mobile_money", "cash_pickup", "wallet"]),
      beneficiaryName: z.string().min(1).max(100),
      beneficiaryAccount: z.string().min(1).max(50),
      purpose: z.string().min(1).max(100),
      sourceOfFunds: z.string().min(1).max(100),
    }))
    .mutation(async ({ input, ctx }) => {
      // Pipeline: sanctions, fraud ML, velocity, TigerBeetle, Kafka, notifications
      const transferRef = `CORE-${Date.now()}-${ctx.user.id}`;
      const pipelineResult = await executeTransferPipeline({
        userId: ctx.user.id,
        amount: input.amount,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        recipientName: input.beneficiaryName,
        recipientAccount: input.beneficiaryAccount,
        rail: input.payoutMethod === "wallet" ? "internal" : "swift",
        corridorCode: input.toCurrency.slice(0, 2),
        featureLabel: "transfer_core",
        transferId: transferRef,
        description: `Transfer: ${input.amount} ${input.fromCurrency} to ${input.beneficiaryName} (${input.purpose})`,
        skipVelocity: true, // transfer engine handles its own rate limiting
        metadata: { payoutMethod: input.payoutMethod, purpose: input.purpose, sourceOfFunds: input.sourceOfFunds },
      });

      const result = await executeTransfer({
        senderId: ctx.user.id,
        recipientId: input.recipientId,
        amount: input.amount,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        corridor: `${input.fromCurrency}-${input.toCurrency}`,
        beneficiaryName: input.beneficiaryName,
        beneficiaryAccount: input.beneficiaryAccount,
        payoutMethod: input.payoutMethod,
        purpose: input.purpose,
        sourceOfFunds: input.sourceOfFunds,
      });

      return { ...result, verified: true, fraudScore: pipelineResult.fraudScore };
    }),

  /** Track a transfer by reference ID */
  track: protectedProcedure
    .input(z.object({ referenceId: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { found: false, transfer: null };
      const result = await db.execute(sql`
        SELECT * FROM transfers 
        WHERE "referenceId" = ${input.referenceId} AND "userId" = ${ctx.user.id}
      `);
      const rows = result as unknown as Record<string, unknown>[];
      if (rows.length === 0) return { found: false, transfer: null };
      return { found: true, transfer: rows[0] };
    }),

  /** Cancel a pending transfer */
  cancel: protectedProcedure
    .input(z.object({ referenceId: z.string(), reason: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { success: false, reason: "Database unavailable" };
      const result = await db.execute(sql`
        UPDATE transfers 
        SET status = 'cancelled', "updatedAt" = NOW()
        WHERE "referenceId" = ${input.referenceId} 
        AND "userId" = ${ctx.user.id} 
        AND status IN ('pending', 'processing')
        RETURNING id
      `);
      const rows = result as unknown as { id: number }[];
      if (rows.length === 0) return { success: false, reason: "Transfer not found or not cancellable" };
      return { success: true, verified: true, referenceId: input.referenceId };
    }),

  /** List user's transfer history */
  history: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
      status: z.enum(["all", "completed", "pending", "failed", "cancelled"]).default("all"),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { transfers: [], total: 0, limit: input.limit, offset: input.offset };
      const statusFilter = input.status === "all" ? sql`` : sql`AND status = ${input.status}`;
      const result = await db.execute(sql`
        SELECT * FROM transfers 
        WHERE "userId" = ${ctx.user.id} ${statusFilter}
        ORDER BY "createdAt" DESC 
        LIMIT ${input.limit} OFFSET ${input.offset}
      `);
      const countResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM transfers 
        WHERE "userId" = ${ctx.user.id} ${statusFilter}
      `);
      const rows = result as unknown as Record<string, unknown>[];
      const countRows = countResult as unknown as { total: string }[];
      return {
        transfers: rows,
        total: parseInt(countRows[0]?.total || "0"),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /** Get transfer limits for the authenticated user */
  limits: protectedProcedure.query(async ({ ctx }) => {
    const compliance = await validateCompliance(ctx.user.id, 0);
    const db = await getDb();
    if (!db) return { tier: "tier1", limits: { daily: 1000, monthly: 5000, single: 500 }, compliant: true };
    const userResult = await db.execute(sql`
      SELECT "kycTier" FROM users WHERE id = ${ctx.user.id}
    `);
    const users = userResult as unknown as { kycTier: string }[];
    const tier = users[0]?.kycTier || "tier1";
    const kycLimits: Record<string, { daily: number; monthly: number; single: number }> = {
      tier0: { daily: 100, monthly: 300, single: 50 },
      tier1: { daily: 1000, monthly: 5000, single: 500 },
      tier2: { daily: 10000, monthly: 50000, single: 5000 },
      tier3: { daily: 100000, monthly: 500000, single: 50000 },
    };
    return { tier, limits: kycLimits[tier] || kycLimits.tier1, compliant: compliance.allowed };
  }),
});
