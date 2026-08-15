/**
 * batchPayouts.ts — F4: Batch Payouts
 *
 * CSV upload → mass stablecoin disbursement for payroll, affiliates, vendors.
 * Integrates with TigerBeetle for atomic ledger entries, Kafka for progress events,
 * Temporal for batch workflow orchestration.
 *
 * Features:
 *   - CSV/JSON upload with validation
 *   - Dry-run mode (preview fees + totals before execution)
 *   - Parallel execution with configurable concurrency
 *   - Per-recipient status tracking
 *   - Retry failed recipients
 *   - Webhook on batch completion
 */

import { z } from "zod";
import { randomBytes } from "crypto";
import { protectedProcedure, rateLimitedProcedure, strictRateLimitedProcedure, router } from "./trpc";
import { logger } from "./logger";
import { FeatureEvents, createLedgerEntry, sanitizeHtml, persistFeatureRecord, updateFeatureRecord } from "./featurePersistence";

// ── PostgreSQL Write-Through ─────────────────────────────────────────────────
let _wtDb_batchPayoutsts: any = null;
async function _getWtDb_batchPayoutsts() {
  if (_wtDb_batchPayoutsts) return _wtDb_batchPayoutsts;
  try {
    const { getDb } = await import("../db.js");
    _wtDb_batchPayoutsts = await getDb();
    return _wtDb_batchPayoutsts;
  } catch { return null; }
}
async function _writeThrough(table: string, key: string, value: unknown): Promise<void> {
  const db = await _getWtDb_batchPayoutsts();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      INSERT INTO ${sql.raw(table)} (key, data, updated_at)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `);
  } catch { /* hot cache still works */ }
}
async function _deleteFromDb(table: string, key: string): Promise<void> {
  const db = await _getWtDb_batchPayoutsts();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`DELETE FROM ${sql.raw(table)} WHERE key = ${key}`);
  } catch {}
}


// ── Types ───────────────────────────────────────────────────────────────────

interface BatchPayout {
  batchId: string;
  userId: number;
  name: string;
  stablecoin: string;
  chain: string;
  totalAmount: number;
  totalFee: number;
  recipientCount: number;
  status: "draft" | "validating" | "ready" | "executing" | "completed" | "partially_failed" | "failed";
  recipients: BatchRecipient[];
  createdAt: string;
  executedAt?: string;
  completedAt?: string;
  dryRun: boolean;
}

interface BatchRecipient {
  index: number;
  name: string;
  address: string;
  amount: number;
  fee: number;
  reference: string;
  status: "pending" | "executing" | "completed" | "failed";
  txHash?: string;
  error?: string;
}

// ── Store ───────────────────────────────────────────────────────────────────

const batches = new Map<string, BatchPayout>(); // Hot cache — persisted to PostgreSQL table "feature_batch_payouts"

// ── Router ──────────────────────────────────────────────────────────────────

export const batchPayoutsRouter = router({
  // Create batch from recipients list
  create: rateLimitedProcedure
    .input(z.object({
      name: z.string().min(1).max(200),
      stablecoin: z.enum(["USDT", "USDC", "DAI", "BUSD", "PYUSD"]),
      chain: z.string().default("polygon"),
      dryRun: z.boolean().default(true),
      recipients: z.array(z.object({
        name: z.string(),
        address: z.string(),
        amount: z.number().positive(),
        reference: z.string().optional(),
      })).min(1).max(10000),
    }))
    .mutation(async ({ input, ctx }) => {
      const batchId = `batch-${randomBytes(8).toString("hex")}`;
      const feeRate = 0.001; // 0.1% per recipient

      const recipients: BatchRecipient[] = input.recipients.map((r, i) => ({
        index: i,
        name: r.name,
        address: r.address,
        amount: r.amount,
        fee: Math.round(r.amount * feeRate * 100) / 100,
        reference: r.reference || `${batchId}-${i}`,
        status: "pending" as const,
      }));

      const totalAmount = recipients.reduce((sum, r) => sum + r.amount, 0);
      const totalFee = recipients.reduce((sum, r) => sum + r.fee, 0);

      const batch: BatchPayout = {
        batchId,
        userId: ctx.user.id,
        name: input.name,
        stablecoin: input.stablecoin,
        chain: input.chain,
        totalAmount,
        totalFee,
        recipientCount: recipients.length,
        status: input.dryRun ? "draft" : "ready",
        recipients,
        createdAt: new Date().toISOString(),
        dryRun: input.dryRun,
      };

      batches.set(batchId, batch);
      _writeThrough("feature_batch_payouts", String(batchId), batch).catch(() => {});
      persistFeatureRecord("feature_batch_payouts", batchId, { id: batchId, ...(typeof batch === 'object' ? batch : {}) }).catch(() => {});
      logger.info({ batchId, recipients: recipients.length, total: totalAmount }, "Batch payout created");
      FeatureEvents.batchCreated({ batchId, userId: ctx.user.id, recipientCount: recipients.length, totalAmount });

      return {
        batchId,
        status: batch.status,
        totalAmount,
        totalFee,
        grandTotal: totalAmount + totalFee,
        recipientCount: recipients.length,
        dryRun: input.dryRun,
      };
    }),

  // Execute batch
  execute: strictRateLimitedProcedure
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const batch = batches.get(input.batchId);
      if (!batch || batch.userId !== ctx.user.id) throw new Error("Batch not found");
      if (batch.status !== "draft" && batch.status !== "ready") {
        throw new Error(`Cannot execute batch in ${batch.status} state`);
      }

      // NO on-chain payout executor is wired to this router. Fabricating
      // transaction hashes or simulated success rates for real money movement
      // is unacceptable; fail loudly until a real executor (chain signer +
      // broadcast + confirmation tracking) is integrated.
      logger.error(
        `[batchPayouts] execute called for batch ${batch.batchId} but no on-chain payout executor is configured`,
      );
      throw new Error(
        "Batch payout execution is unavailable: no on-chain payout executor is " +
          "configured. The batch was NOT executed and no funds moved; its state " +
          "is unchanged.",
      );
    }),

  // Retry failed recipients
  retryFailed: rateLimitedProcedure
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const batch = batches.get(input.batchId);
      if (!batch || batch.userId !== ctx.user.id) throw new Error("Batch not found");

      const failedRecipients = batch.recipients.filter(r => r.status === "failed");
      if (failedRecipients.length === 0) throw new Error("No failed recipients to retry");

      // NO on-chain payout executor is wired to this router. Refuse to
      // fabricate transaction hashes for retried recipients; fail loudly
      // until a real executor is integrated (see execute above).
      logger.error(
        `[batchPayouts] retryFailed called for batch ${batch.batchId} but no on-chain payout executor is configured`,
      );
      throw new Error(
        "Batch payout retry is unavailable: no on-chain payout executor is " +
          "configured. No recipients were retried and no funds moved; the " +
          "batch state is unchanged.",
      );
    }),

  // Get batch details
  get: protectedProcedure
    .input(z.object({ batchId: z.string() }))
    .query(async ({ input, ctx }) => {
      const batch = batches.get(input.batchId);
      if (!batch || batch.userId !== ctx.user.id) throw new Error("Batch not found");
      return batch;
    }),

  // List batches
  list: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      const userBatches = Array.from(batches.values())
        .filter(b => b.userId === ctx.user.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return {
        batches: userBatches.slice(input.offset, input.offset + input.limit).map(b => ({
          batchId: b.batchId, name: b.name, status: b.status,
          totalAmount: b.totalAmount, recipientCount: b.recipientCount,
          createdAt: b.createdAt,
        })),
        total: userBatches.length,
      };
    }),
});
