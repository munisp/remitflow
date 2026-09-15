/**
 * BDC reversals.ts (wave12 G1 — SPEC-wave12 §4.1, B4-owned) — settled-payout
 * reversal/recall engine.
 *
 * Settled BDC transactions cannot be reversed by sales.reverseTransaction
 * (which covers pending/posted). They require a maker-checker reversal record
 * in bdc_reversals:
 *
 *   1. requestReversal  — TOTP; txn must be tenant-scoped + 'settled';
 *      inserts bdc_reversals ('manual', 'requested') under idempotency claim
 *      `bdc:reversal:${tenantId}:${transactionId}`; Kafka event (fail-soft).
 *   2. approveReversal  — TOTP; maker≠checker (requested_by ≠ approver);
 *      guarded flip requested→approved, then executeApprovedReversal.
 *   3. executeApprovedReversal(reversalId, actorId) — shared execution path
 *      also used by sales.reverseTransaction (settled branch) and the
 *      rail-return webhooks (G8): ONE db.transaction wrapping
 *        a. reversePost(txn.idempotencyKey, legs) inside try — TB failure →
 *           guarded flip reversal approved→failed with failure_reason and the
 *           money path rolls back (txn honestly stays 'settled');
 *        b. compensating drawer-inventory restore (F9 pattern copied from
 *           sales.reverseTransaction — version-guarded mutation, guarded
 *           against insufficient stock);
 *        c. guarded single-winner txn flip settled→reversed;
 *        d. PG mirror of the reversal legs;
 *        e. guarded single-winner reversal flip approved→posted (+tbReversalIds).
 *      Idempotent replay: reversal already 'posted' → existing state returned.
 *
 * Funds-flow discipline (SPEC §0): claimIdempotency before money moves,
 * guarded UPDATE ... WHERE status=:prev single-winner flips, TOTP step-up on
 * every mutation, telemetry (Kafka) fail-soft and never blocking money paths.
 *
 * DELIBERATE CARVE-OUT (adversarial-verify LOW-1): this router resolves the
 * tenant via requireTenantId only and intentionally does NOT pass through
 * getBdcProfile/assertTenantActive. Reversals are an unwind path — a tenant
 * whose offboarding has COMPLETED must still be able to reverse settled
 * payouts (e.g. a rail return arriving after offboarding) so funds are never
 * stranded. All other BDC procedures inherit the tenant-active choke point.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, auditedProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import { bdcReversals, bdcTransactions } from "../../../drizzle/schema";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { claimIdempotency, storeIdempotency, releaseIdempotencyClaim } from "../../middleware/coreAtomicity";
import { requireTotpStepUp } from "../../_core/totpStepUp";
import { resolveTenantContext } from "../../tenantMiddleware";
import { logger } from "../../_core/logger";
import { publishEvent } from "../../middleware/kafka";
import { toCents } from "./_shared";
import { reversePost, mirrorLegsToPg, type TbLegRecord } from "./_ledger";

// ORCH adds constant: KAFKA_TOPICS.BDC_REVERSALS = "remitflow.bdc.reversals" (SPEC-wave12 §7).
const BDC_REVERSALS_TOPIC = "remitflow.bdc.reversals";

// ─── Local helpers ────────────────────────────────────────────────────────────

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

async function requireTenantId(userId: number): Promise<number> {
  const session = await resolveTenantContext(userId);
  if (session.tenantId == null) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No tenant membership — BDC operations unavailable" });
  }
  return session.tenantId;
}

/** Integer cents → exact "major.minor" string for numeric(18,2) columns. */
function centsToMajor(cents: number | bigint): string {
  const v = BigInt(cents);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/**
 * Version-guarded denomination inventory mutation — the F9 compensating
 * pattern from sales.reverseTransaction, duplicated here so this module does
 * not import from sales.ts (B5 co-owns sales.ts; keeping the helper local
 * avoids a cross-owner import).
 *   direction 'credit' → notes back in; 'debit' → notes back out, guarded by
 *   note_count >= n (0 rows → INSUFFICIENT_STOCK, honest failure).
 */
async function mutateInventory(
  tx: { execute: (q: unknown) => Promise<unknown> },
  params: {
    tenantId: number;
    locationType: "drawer" | "vault";
    locationId: number;
    currency: string;
    items: Array<{ denomination: number | string; noteCount: number }>;
    direction: "credit" | "debit";
  },
): Promise<void> {
  for (const item of params.items) {
    const denomStr = centsToMajor(toCents(item.denomination));
    if (params.direction === "credit") {
      const rows = (await tx.execute(sql`
        INSERT INTO bdc_denomination_inventory
          (tenant_id, location_type, location_id, currency, denomination, note_count, version, updated_at)
        VALUES
          (${params.tenantId}, ${params.locationType}, ${params.locationId}, ${params.currency}, ${denomStr}::numeric, ${item.noteCount}, 1, NOW())
        ON CONFLICT (tenant_id, location_type, location_id, currency, denomination)
        DO UPDATE SET note_count = bdc_denomination_inventory.note_count + ${item.noteCount},
                      version = bdc_denomination_inventory.version + 1,
                      updated_at = NOW()
        RETURNING id
      `)) as unknown as Array<{ id: number }>;
      if (rows.length !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "Inventory increment failed — retry" });
      }
    } else {
      const rows = (await tx.execute(sql`
        UPDATE bdc_denomination_inventory
        SET note_count = note_count - ${item.noteCount},
            version = version + 1,
            updated_at = NOW()
        WHERE tenant_id = ${params.tenantId}
          AND location_type = ${params.locationType}
          AND location_id = ${params.locationId}
          AND currency = ${params.currency}
          AND denomination = ${denomStr}::numeric
          AND note_count >= ${item.noteCount}
        RETURNING id
      `)) as unknown as Array<{ id: number }>;
      if (rows.length !== 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `INSUFFICIENT_STOCK: not enough ${params.currency} ${denomStr} notes in the drawer to complete the reversal`,
        });
      }
    }
  }
}

/** Fail-soft Kafka publish — telemetry never blocks the money path (SPEC §0.5). */
async function publishReversalEvent(key: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await publishEvent(BDC_REVERSALS_TOPIC, key, {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), key },
      "[BDC reversals] Kafka publish failed (non-blocking; DB state is authoritative)",
    );
  }
}

export interface ReversalExecutionResult {
  status: "reversed" | "failed" | "already_posted";
  transactionId: number;
  reversalId: number;
  tbTransferIds?: TbLegRecord[];
  failureReason?: string;
}

/**
 * Shared settled-reversal execution path (SPEC-wave12 §4.1). Loads the
 * reversal + its transaction and runs the compensating money flow in ONE
 * db.transaction. Callers: bdc.reversals.approveReversal,
 * bdc.sales.reverseTransaction (settled branch), rail-return webhooks (G8).
 *
 * actorId is the approver (or PLATFORM_SYSTEM_USER_ID for rail returns) and
 * is stamped as the txn checker.
 */
export async function executeApprovedReversal(
  reversalId: number,
  actorId: number,
): Promise<ReversalExecutionResult> {
  const db = await requireDb();

  const [reversal] = await db
    .select()
    .from(bdcReversals)
    .where(eq(bdcReversals.id, reversalId))
    .limit(1);
  if (!reversal) throw new TRPCError({ code: "NOT_FOUND", message: "BDC reversal not found" });

  // Idempotent replay: already executed — return the recorded state.
  if (reversal.status === "posted") {
    return {
      status: "already_posted",
      transactionId: reversal.txnId,
      reversalId: reversal.id,
      tbTransferIds: (reversal.tbReversalIds ?? []) as unknown as TbLegRecord[],
    };
  }
  if (reversal.status !== "approved") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Reversal is '${reversal.status}' — only 'approved' reversals can be executed`,
    });
  }

  const [txn] = await db
    .select()
    .from(bdcTransactions)
    .where(and(eq(bdcTransactions.id, reversal.txnId), eq(bdcTransactions.tenantId, reversal.tenantId)))
    .limit(1);
  if (!txn) throw new TRPCError({ code: "NOT_FOUND", message: "BDC transaction for reversal not found" });

  const tenantId = reversal.tenantId;
  const legs = (txn.tbTransferIds ?? []) as unknown as TbLegRecord[];

  return db.transaction(async (tx) => {
    // 1. Reverse the TB legs INSIDE a try. On TB failure: guarded flip
    //    reversal approved→failed with the honest reason and let the rest of
    //    the money path roll back — the txn stays 'settled', nothing is
    //    fabricated. Deterministic TB ids make a later manual replay safe.
    let reversedLegs: TbLegRecord[];
    try {
      reversedLegs = await reversePost(txn.idempotencyKey, legs);
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
      await tx.execute(sql`
        UPDATE bdc_reversals
        SET status = 'failed', failure_reason = ${msg}, updated_at = NOW()
        WHERE id = ${reversal.id} AND status = 'approved'
      `);
      logger.error(
        { reversalId: reversal.id, transactionId: txn.id, err: msg },
        "[BDC reversals] TB reversal FAILED — reversal marked 'failed', txn stays 'settled' (rollback)",
      );
      return { status: "failed", transactionId: txn.id, reversalId: reversal.id, failureReason: msg };
    }

    // 2. Compensating drawer-inventory restore (F9): mirror of the original
    //    sale's recorded inventory footprint, direction inverted. Guarded —
    //    if the notes are no longer in the drawer the whole reversal fails
    //    honestly instead of fabricating stock.
    const invFootprint = (txn.paymentLeg as Record<string, unknown> | null)?.inventory as
      | { drawerId?: number; items?: Array<{ denomination: number | string; noteCount: number }>; direction?: "credit" | "debit" }
      | undefined;
    if (invFootprint?.drawerId && Array.isArray(invFootprint.items) && invFootprint.items.length > 0 && invFootprint.direction) {
      await mutateInventory(tx, {
        tenantId,
        locationType: "drawer",
        locationId: invFootprint.drawerId,
        currency: txn.currency ?? "USD",
        items: invFootprint.items,
        direction: invFootprint.direction === "debit" ? "credit" : "debit",
      });
      logger.info(
        { reversalId: reversal.id, transactionId: txn.id, drawerId: invFootprint.drawerId },
        "[BDC reversals] SALE_REVERSAL inventory compensation applied",
      );
    }

    // 3. Guarded single-winner txn flip settled → reversed.
    const flipped = (await tx.execute(sql`
      UPDATE bdc_transactions
      SET status = 'reversed', checker_id = ${actorId}, tb_transfer_ids = ${JSON.stringify(reversedLegs)}::jsonb, updated_at = NOW()
      WHERE id = ${txn.id} AND tenant_id = ${tenantId} AND status = 'settled'
      RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (flipped.length !== 1) {
      // Rollback. Reversal honestly stays 'approved' — either a concurrent
      // executor won (its commit flips this reversal to 'posted') or the txn
      // left 'settled' state; the watchdog alerts on approved-stuck > 24h.
      throw new TRPCError({
        code: "CONFLICT",
        message: `Transaction ${txn.id} is no longer 'settled' — reversal rolled back, retry or escalate`,
      });
    }

    // 4. Mirror the reversal transfers (void + reversing entries) into
    //    ledger_entries inside the same transaction (deterministic ids,
    //    conflict-safe on replay).
    const reversalEntries = reversedLegs.filter((l) => l.phase === "reversal");
    if (reversalEntries.length > 0) {
      await mirrorLegsToPg(tx, reversalEntries, {
        reference: txn.idempotencyKey,
        type: `bdc_${txn.txnType}_settled_reversal`,
        tenantId,
        bdcTransactionId: txn.id,
      });
    }

    // 5. Guarded single-winner reversal flip approved → posted (+TB legs).
    const posted = (await tx.execute(sql`
      UPDATE bdc_reversals
      SET status = 'posted', tb_reversal_ids = ${JSON.stringify(reversedLegs)}::jsonb, updated_at = NOW()
      WHERE id = ${reversal.id} AND status = 'approved'
      RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (posted.length !== 1) {
      throw new TRPCError({ code: "CONFLICT", message: "Reversal status changed concurrently — retry" });
    }

    logger.info(
      { reversalId: reversal.id, transactionId: txn.id, actorId, reversalType: reversal.reversalType },
      "[BDC reversals] Settled transaction reversed (posted)",
    );
    return { status: "reversed", transactionId: txn.id, reversalId: reversal.id, tbTransferIds: reversedLegs };
  });
}

// ─── Router (ORCH mounts in the bdc barrel as `reversals`) ───────────────────

export const bdcReversalsRouter = router({
  /**
   * requestReversal — maker side of the settled-reversal maker-checker flow.
   * The transaction must be tenant-scoped and 'settled' (pending/posted stay
   * on sales.reverseTransaction). Idempotency-claimed per (tenant, txn).
   */
  requestReversal: auditedProcedure
    .input(
      z.object({
        transactionId: z.number().int().positive(),
        reason: z.string().min(4).max(500),
        totpCode: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC reversal");
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);

      const [txn] = await db
        .select()
        .from(bdcTransactions)
        .where(and(eq(bdcTransactions.id, input.transactionId), eq(bdcTransactions.tenantId, tenantId)))
        .limit(1);
      if (!txn) throw new TRPCError({ code: "NOT_FOUND", message: "BDC transaction not found" });
      if (txn.status !== "settled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            txn.status === "pending" || txn.status === "posted"
              ? `Transaction is '${txn.status}' — use bdc.sales.reverseTransaction for unsettled transactions`
              : `Transaction is already '${txn.status}' — nothing to reverse`,
        });
      }

      const claimKey = `bdc:reversal:${tenantId}:${input.transactionId}`;
      const claim = await claimIdempotency(claimKey);
      if (claim.cached) return claim.result;

      try {
        // One open reversal per transaction — the guarded insert below plus
        // this pre-check keep duplicate requests honest across claim TTLs.
        const [open] = await db
          .select({ id: bdcReversals.id, status: bdcReversals.status })
          .from(bdcReversals)
          .where(
            and(
              eq(bdcReversals.tenantId, tenantId),
              eq(bdcReversals.txnId, input.transactionId),
              sql`${bdcReversals.status} IN ('requested', 'approved')`,
            ),
          )
          .limit(1);
        if (open) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `An open reversal (#${open.id}, '${open.status}') already exists for this transaction`,
          });
        }

        const [row] = await db
          .insert(bdcReversals)
          .values({
            tenantId,
            txnId: input.transactionId,
            reversalType: "manual",
            status: "requested",
            reason: input.reason,
            requestedBy: ctx.user.id,
          })
          .returning();

        await publishReversalEvent(`bdc-reversal:${tenantId}:${row.id}:requested`, {
          eventType: "bdc.reversal.requested",
          reversalId: row.id,
          tenantId,
          transactionId: input.transactionId,
          reversalType: "manual",
          requestedBy: ctx.user.id,
          reason: input.reason,
        });

        const result = { status: "requested" as const, reversalId: row.id, transactionId: input.transactionId };
        storeIdempotency(claimKey, result);
        return result;
      } catch (err) {
        await releaseIdempotencyClaim(claimKey);
        throw err;
      }
    }),

  /**
   * approveReversal — checker side. Maker≠checker enforced against
   * requested_by; guarded requested→approved flip; then executes the shared
   * compensating money path. Idempotent: an already-'posted' reversal returns
   * its recorded state.
   */
  approveReversal: auditedProcedure
    .input(
      z.object({
        reversalId: z.number().int().positive(),
        totpCode: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC reversal approval");
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);

      const [reversal] = await db
        .select()
        .from(bdcReversals)
        .where(and(eq(bdcReversals.id, input.reversalId), eq(bdcReversals.tenantId, tenantId)))
        .limit(1);
      if (!reversal) throw new TRPCError({ code: "NOT_FOUND", message: "BDC reversal not found" });

      // Idempotent replay — return the recorded terminal state.
      if (reversal.status === "posted") {
        return {
          status: "already_posted" as const,
          reversalId: reversal.id,
          transactionId: reversal.txnId,
          tbTransferIds: (reversal.tbReversalIds ?? []) as unknown as TbLegRecord[],
        };
      }
      if (reversal.status !== "requested") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Reversal is '${reversal.status}' — only 'requested' reversals can be approved`,
        });
      }
      if (reversal.requestedBy === ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Maker-checker violation: the requester cannot approve their own reversal",
        });
      }

      // Guarded single-winner flip requested → approved.
      const approved = (await db.execute(sql`
        UPDATE bdc_reversals
        SET status = 'approved', approved_by = ${ctx.user.id}, updated_at = NOW()
        WHERE id = ${input.reversalId} AND tenant_id = ${tenantId} AND status = 'requested'
        RETURNING id
      `)) as unknown as Array<{ id: number }>;
      if (approved.length !== 1) {
        throw new TRPCError({ code: "CONFLICT", message: "Reversal status changed concurrently — retry" });
      }

      await publishReversalEvent(`bdc-reversal:${tenantId}:${reversal.id}:approved`, {
        eventType: "bdc.reversal.approved",
        reversalId: reversal.id,
        tenantId,
        transactionId: reversal.txnId,
        approvedBy: ctx.user.id,
      });

      // Execute the compensating money path (shared with sales + webhooks).
      const execution = await executeApprovedReversal(reversal.id, ctx.user.id);

      await publishReversalEvent(`bdc-reversal:${tenantId}:${reversal.id}:${execution.status}`, {
        eventType:
          execution.status === "reversed" || execution.status === "already_posted"
            ? "bdc.reversal.posted"
            : "bdc.reversal.failed",
        reversalId: reversal.id,
        tenantId,
        transactionId: reversal.txnId,
        executedBy: ctx.user.id,
        failureReason: execution.failureReason ?? null,
      });

      return execution;
    }),

  /** listReversals — tenant-scoped, cursor pagination (id desc, repo convention). */
  listReversals: auditedProcedure
    .input(
      z.object({
        status: z.enum(["requested", "approved", "posted", "failed", "rejected"]).optional(),
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const conditions = [eq(bdcReversals.tenantId, tenantId)];
      if (input.status) conditions.push(eq(bdcReversals.status, input.status));
      if (input.cursor) conditions.push(lt(bdcReversals.id, input.cursor));

      const rows = await db
        .select()
        .from(bdcReversals)
        .where(and(...conditions))
        .orderBy(desc(bdcReversals.id))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
    }),

  /** getReversal — tenant-scoped single fetch. */
  getReversal: auditedProcedure
    .input(z.object({ reversalId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const [reversal] = await db
        .select()
        .from(bdcReversals)
        .where(and(eq(bdcReversals.id, input.reversalId), eq(bdcReversals.tenantId, tenantId)))
        .limit(1);
      if (!reversal) throw new TRPCError({ code: "NOT_FOUND", message: "BDC reversal not found" });
      return reversal;
    }),
});
