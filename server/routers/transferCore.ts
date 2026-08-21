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
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { createAuditLog } from "../db";
import { executeTransfer, calculateFee, getFxRate, validateCompliance } from "../lib/transferEngine";
import { executeTransferPipeline, settleTransferHold, compensateFailedTransfer } from "../_core/transferPipeline";
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

      // FF-001 settlement wiring: the pipeline created a TB pending hold under
      // transferRef. On success, settle it — post the TB hold in full AND debit
      // the PG wallet atomically (journaled in settlement_journal, replay-safe).
      // On failure, compensate — void the hold (state-aware, no blind refunds).
      if (result.status === "completed") {
        if (pipelineResult.tigerBeetleRecorded) {
          await settleTransferHold({
            transferId: transferRef,
            userId: ctx.user.id,
            amount: input.amount,
            currency: input.fromCurrency,
          });
        } else {
          // No TB hold (dev/no-ledger mode): PG-only guarded debit.
          const db = await getDb();
          if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
          const debitAmount = input.amount.toFixed(2);
          const debitRows = (await db.execute(sql`
            UPDATE wallets
            SET balance = CAST(balance AS NUMERIC) - ${debitAmount}, "updatedAt" = NOW()
            WHERE "userId" = ${ctx.user.id}
              AND currency = ${input.fromCurrency}
              AND CAST(balance AS NUMERIC) >= ${debitAmount}
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (debitRows.length === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient wallet balance" });
          }
        }
      } else if (pipelineResult.tigerBeetleRecorded) {
        const compensation = await compensateFailedTransfer({
          transferId: transferRef,
          userId: ctx.user.id,
          amount: input.amount,
          currency: input.fromCurrency,
          reason: "Transfer engine rejected the transfer",
          stage: "settlement",
        });
        if (!compensation.compensated) {
          logger.error({ transferRef }, "[TransferCore] Compensation failed — manual reconciliation required");
        }
      }

      return { ...result, verified: true, fraudScore: pipelineResult.fraudScore };
    }),

  /** Track a transfer by reference ID */
  track: protectedProcedure
    .input(z.object({ referenceId: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { found: false, transfer: null };
      // Check transfers table first (exact referenceId match)
      const transferResult = await db.execute(sql`
        SELECT * FROM transfers 
        WHERE "referenceId" = ${input.referenceId} AND "userId" = ${ctx.user.id}
      `);
      const transferRows = transferResult as unknown as Record<string, unknown>[];
      if (transferRows.length > 0) return { found: true, transfer: transferRows[0] };
      // Fall back to transactions table (reference may have suffix like -debit/-credit)
      const txResult = await db.execute(sql`
        SELECT * FROM transactions 
        WHERE (reference = ${input.referenceId} OR reference LIKE ${input.referenceId + '-%'})
          AND "userId" = ${ctx.user.id}
        LIMIT 1
      `);
      const txRows = txResult as unknown as Record<string, unknown>[];
      if (txRows.length === 0) return { found: false, transfer: null };
      return { found: true, transfer: txRows[0] };
    }),

  /** Cancel a pending transfer */
  cancel: protectedProcedure
    .input(z.object({ referenceId: z.string(), reason: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { success: false, reason: "Database unavailable" };
      const result = await db.execute(sql`
        UPDATE transactions 
        SET status = 'cancelled', "updatedAt" = NOW()
        WHERE reference = ${input.referenceId} 
        AND "userId" = ${ctx.user.id} 
        AND status IN ('pending', 'processing')
        RETURNING id, amount, currency
      `);
      const rows = result as unknown as { id: number; amount: string; currency: string }[];
      if (rows.length === 0) return { success: false, reason: "Transfer not found or not cancellable" };
      // FF-001: release any TigerBeetle hold created for this reference.
      // State-aware: no-op when no hold exists; never blind-refunds.
      const txAmount = Number(rows[0].amount);
      if (txAmount > 0 && rows[0].currency) {
        try {
          await compensateFailedTransfer({
            transferId: input.referenceId,
            userId: ctx.user.id,
            amount: Math.abs(txAmount),
            currency: rows[0].currency,
            reason: input.reason ?? "Transfer cancelled by user",
            stage: "settlement",
          });
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err), referenceId: input.referenceId },
            "[TransferCore] Hold release on cancel failed — reaper/recon will reconcile");
        }
      }
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
        SELECT * FROM transactions 
        WHERE "userId" = ${ctx.user.id} ${statusFilter}
        ORDER BY "createdAt" DESC 
        LIMIT ${input.limit} OFFSET ${input.offset}
      `);
      const countResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM transactions 
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

  /**
   * Settlement callback (rail confirmation): posts the TigerBeetle pending
   * hold in full and debits the sender's PG wallet atomically. Idempotent —
   * replaying with the same referenceId returns the recorded settlement.
   * Restricted: only the transfer owner can settle their own reference; rails
   * call this from their confirmation webhooks.
   */
  settle: protectedProcedure
    .input(z.object({
      referenceId: z.string().min(1).max(128),
      amount: z.number().positive().max(10_000_000),
      currency: z.string().length(3),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await settleTransferHold({
        transferId: input.referenceId,
        userId: ctx.user.id,
        amount: input.amount,
        currency: input.currency,
      });
      return { ...result, verified: true };
    }),
});
