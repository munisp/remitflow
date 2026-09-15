/**
 * BDC sourcing.ts (B2) — NFEM FX sourcing, position monitoring, EOD close
 * (SPEC-bdc §3.5).
 *
 * Funds-flow discipline (SPEC §0.5):
 *   - Entitlement consumption is an atomic guarded UPDATE
 *     (`used_usd + :amt <= cap_usd`, version-bumped, single-winner) inside a
 *     db.transaction with the batch insert — no entitlement drift.
 *   - The FXBT adapter is HONEST (SPEC §0.4): sandbox returns
 *     { simulated:true, fxbtReference:'SIM-FXBT-...' }; production without
 *     credentials → UNAVAILABLE. An unavailable adapter is NOT a failure of
 *     requestNfemPurchase — no money has moved; the batch stays 'requested'
 *     until confirmNfemFunding (admin) books the TigerBeetle legs.
 *   - requireTotpStepUp on requestNfemPurchase / confirmNfemFunding /
 *     markBatchLiquidated / markBatchReturned / eodClose.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, auditedProcedure, auditedAdminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  bdcNfemEntitlements,
  bdcNfemPurchaseBatches,
  bdcPositionSnapshots,
  bdcTransactions,
} from "../../../drizzle/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { claimIdempotency, storeIdempotency, releaseIdempotencyClaim } from "../../middleware/coreAtomicity";
import { requireTotpStepUp } from "../../_core/totpStepUp";
import { resolveTenantContext } from "../../tenantMiddleware";
import { callService } from "../../_core/serviceProxy";
import { getRate } from "../../_core/liveFxRates";
import { logger } from "../../_core/logger";
import { toCents, getBdcProfile, weekStartUTC } from "./_shared";
import { postNfemPurchase, postNfemReturn, mirrorLegsToPg, getBdcPositionBalances } from "./_ledger";

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

function centsToMajor(cents: number | bigint): string {
  const v = BigInt(cents);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

const moneyAmount = z.union([z.number().positive(), z.string().regex(/^\d+(\.\d{1,2})?$/)]);

// ─── FXBT adapter (honest — SPEC §0.4) ────────────────────────────────────────

const NFEM_TREASURY_URL = process.env.NFEM_TREASURY_URL ?? "http://localhost:8090";

interface FxbtResponse {
  simulated?: boolean;
  fxbtReference?: string;
  reason?: string;
}

/**
 * Call the go-nfem-treasury FXBT adapter. Never fabricates success:
 *   - service unreachable / 503 (production, no creds) → { available:false }
 *   - sandbox response passes through with its simulated marker.
 * The caller decides what to persist; a batch is NEVER marked funded here.
 *
 * Wire contract (services/go-nfem-treasury/main.go fxbtRequest): MAJOR units
 * — amountUsd float64 (dollars), rate float64 (naira per 1 USD). Sending
 * minor-unit strings makes Go decode both as 0 → "amountUsd must be > 0"
 * 400 → the adapter would NEVER execute (F6).
 */
async function requestFxbtPurchase(params: {
  tenantId: number;
  bankCode: string;
  amountUsd: number; // MAJOR units (dollars)
  rate: number; // MAJOR units (naira per 1 USD)
}): Promise<{ available: boolean; simulated: boolean; fxbtReference: string | null }> {
  try {
    const res = await callService<FxbtResponse>(`${NFEM_TREASURY_URL}/nfem/fxbt/request`, {
      method: "POST",
      body: params,
      timeoutMs: 5_000,
      retries: 0,
    });
    return {
      available: true,
      simulated: res?.simulated === true,
      fxbtReference: res?.fxbtReference ?? null,
    };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), bankCode: params.bankCode, amountUsd: params.amountUsd },
      "[BDC sourcing] FXBT adapter UNAVAILABLE — batch stays 'requested' (no money moved)",
    );
    return { available: false, simulated: false, fxbtReference: null };
  }
}

// ─── Position computation (shared by positionNow / eodClose) ──────────────────

interface PositionBreach {
  metric: "nop" | "borrowing";
  valueUsd: string;
  pct: number;
  capPct: number;
  severity: "warning" | "critical";
}

/**
 * computePosition — TB-balance position vs profile caps. Exported for the
 * bdcScheduler EOD cron (server/services/bdcScheduler.ts) so the cron path
 * computes positions identically to positionNow/eodClose — never estimates.
 */
export async function computePosition(db: Awaited<ReturnType<typeof requireDb>>, tenantId: number) {
  const profile = await getBdcProfile(db, tenantId);
  // Distinct FX currencies this tenant has dealt in (drives which TB
  // FX_INVENTORY accounts to read).
  const ccyRows = (await db.execute(sql`
    SELECT DISTINCT currency FROM bdc_transactions WHERE tenant_id = ${tenantId} AND currency IS NOT NULL
  `)) as unknown as Array<{ currency: string }>;
  const currencies = Array.from(new Set([...ccyRows.map((r) => r.currency), "USD"]));

  // TB balances — queried synchronously via the bridge: staleness ≤1s.
  const balances = await getBdcPositionBalances(tenantId, currencies);

  // Convert each FX inventory net to USD. getRate falls back to cached/default
  // rates (flagged via rateSource/stale) but never fabricates TB balances.
  let nopUsdMinor = 0n;
  let rateStale = false;
  const perCurrency: Array<{ currency: string; netMinor: string; usdMinor: string }> = [];
  for (const [currency, netMinor] of Object.entries(balances.fxInventoryMinor)) {
    let usdMinor = netMinor;
    if (currency !== "USD" && netMinor !== 0n) {
      const fx = await getRate(currency, "USD");
      rateStale = rateStale || fx.stale;
      // minor * rate (4dp of precision retained via scaled integer math).
      usdMinor = (netMinor * BigInt(Math.round(fx.rate * 10_000))) / 10_000n;
    }
    nopUsdMinor += usdMinor;
    perCurrency.push({ currency, netMinor: netMinor.toString(), usdMinor: usdMinor.toString() });
  }
  let borrowingUsdMinor = 0n;
  if (balances.borrowingNgnMinor > 0n) {
    const fx = await getRate("NGN", "USD");
    rateStale = rateStale || fx.stale;
    borrowingUsdMinor = (balances.borrowingNgnMinor * BigInt(Math.round(fx.rate * 10_000))) / 10_000n;
  }

  const fundsCents = BigInt(toCents(profile.shareholdersFunds ?? "0"));
  // Percent of shareholders' funds (M18): the snapshot columns are
  // numeric(6,2) (max 9999.99) and a ratio can exceed 100% — store the
  // PERCENT (v/funds × 100), clamped to 0..100.00. Breach detail above the
  // clamp is still reported exactly via the breaches payload (valueUsd).
  const clampPct = (pct: number): number => Math.min(100, Math.max(0, Math.round(pct * 100) / 100));
  const pctOf = (v: bigint): number =>
    fundsCents > 0n
      ? clampPct(Number((v * 10_000n) / fundsCents) / 100)
      : v > 0n
        ? 100
        : 0;
  const nopPct = pctOf(nopUsdMinor);
  const borrowingPct = pctOf(borrowingUsdMinor);

  const breaches: PositionBreach[] = [];
  const pushBreach = (metric: PositionBreach["metric"], v: bigint, pct: number, capPct: number) => {
    if (pct > capPct) {
      breaches.push({
        metric,
        valueUsd: centsToMajor(v),
        pct,
        capPct,
        severity: pct >= capPct * 1.25 ? "critical" : "warning",
      });
    }
  };
  pushBreach("nop", nopUsdMinor, nopPct, profile.nopLimitPct);
  pushBreach("borrowing", borrowingUsdMinor, borrowingPct, profile.borrowingLimitPct);

  return {
    nopUsdMinor,
    nopPct,
    borrowingUsdMinor,
    borrowingPct,
    breaches,
    perCurrency,
    stalenessLabel: "≤1s" as const,
    rateStale,
    profile,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const bdcSourcingRouter = router({
  /**
   * requestNfemPurchase (dealer) — consume weekly entitlement (atomic guarded
   * UPDATE, upsert-then-retry race-safe), insert a 'requested' batch, then
   * call the FXBT adapter honestly. No money moves at this stage.
   */
  requestNfemPurchase: auditedProcedure
    .input(
      z.object({
        bankCode: z.string().min(2).max(16),
        amountUsd: moneyAmount,
        rate: moneyAmount, // naira per 1 USD
        idempotencyKey: z.string().min(8).max(64),
        totpCode: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "NFEM purchase request");
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const profile = await getBdcProfile(db, tenantId);

      const usdCents = toCents(input.amountUsd);
      if (usdCents <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "amountUsd must be positive" });
      const rateKobo = toCents(input.rate);
      if (rateKobo <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "rate must be positive" });
      const nairaKobo = (BigInt(usdCents) * BigInt(rateKobo) + 50n) / 100n;

      const weekStart = weekStartUTC(new Date());
      const capMajor = profile.weeklyNfemEntitlementUsd;
      const amtMajor = centsToMajor(usdCents);

      // Tenant-scoped claim: idempotencyKey is client-supplied (F2).
      const claimKey = `BDC-NFEM-${tenantId}-${input.idempotencyKey}`;
      const claim = await claimIdempotency(claimKey);
      if (claim.cached) return claim.result;

      try {
      const batch = await db.transaction(async (tx) => {
        // 1. Ensure the week row exists (race-safe upsert).
        await tx.execute(sql`
          INSERT INTO bdc_nfem_entitlements (tenant_id, bank_code, week_start, cap_usd, used_usd, version)
          VALUES (${tenantId}, ${input.bankCode}, ${weekStart}::date, ${capMajor}::numeric, '0.00', 0)
          ON CONFLICT (tenant_id, bank_code, week_start) DO NOTHING
        `);

        // 2. Atomic guarded entitlement consumption (single-winner). One retry
        //    covers the upsert race where the row appeared between statements.
        let consumed: Array<{ id: number }> = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          consumed = (await tx.execute(sql`
            UPDATE bdc_nfem_entitlements
            SET used_usd = used_usd + ${amtMajor}::numeric, version = version + 1, updated_at = NOW()
            WHERE tenant_id = ${tenantId}
              AND bank_code = ${input.bankCode}
              AND week_start = ${weekStart}::date
              AND used_usd + ${amtMajor}::numeric <= cap_usd
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (consumed.length === 1) break;
          // 0 rows: either OVER_ENTITLEMENT or the upsert lost a race — re-run
          // the upsert once, then distinguish via an existence probe.
          if (attempt === 0) {
            const exists = (await tx.execute(sql`
              SELECT id FROM bdc_nfem_entitlements
              WHERE tenant_id = ${tenantId} AND bank_code = ${input.bankCode} AND week_start = ${weekStart}::date
            `)) as unknown as Array<{ id: number }>;
            if (exists.length === 0) {
              await tx.execute(sql`
                INSERT INTO bdc_nfem_entitlements (tenant_id, bank_code, week_start, cap_usd, used_usd, version)
                VALUES (${tenantId}, ${input.bankCode}, ${weekStart}::date, ${capMajor}::numeric, '0.00', 0)
                ON CONFLICT (tenant_id, bank_code, week_start) DO NOTHING
              `);
            } else {
              break; // row exists → genuinely over entitlement
            }
          }
        }
        if (consumed.length !== 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `OVER_ENTITLEMENT: weekly NFEM entitlement exceeded for bank ${input.bankCode} (week ${weekStart}, cap ${capMajor} USD)`,
          });
        }

        // 3. Batch row — honest 'requested'; funded only by confirmNfemFunding.
        const [row] = await tx
          .insert(bdcNfemPurchaseBatches)
          .values({
            tenantId,
            entitlementId: consumed[0].id,
            amountUsd: amtMajor,
            rate: centsToMajor(rateKobo),
            nairaPaid: centsToMajor(nairaKobo),
            status: "requested",
          })
          .returning();
        return row;
      });

      // 4. FXBT adapter — OUTSIDE the db transaction (no money moved). An
      //    unavailable adapter is logged, not an error (SPEC §0.4/§3.5).
      const fxbt = await requestFxbtPurchase({
        tenantId,
        bankCode: input.bankCode,
        amountUsd: usdCents / 100, // major units (F6 — Go fxbtRequest float64)
        rate: rateKobo / 100, // major units, naira per 1 USD
      });
      if (fxbt.fxbtReference) {
        await db
          .update(bdcNfemPurchaseBatches)
          .set({ fxbtReference: fxbt.fxbtReference, updatedAt: new Date() })
          .where(eq(bdcNfemPurchaseBatches.id, batch.id));
      }

      const result = {
        status: "requested" as const,
        batchId: batch.id,
        fxbtReference: fxbt.fxbtReference,
        adapter: { available: fxbt.available, simulated: fxbt.simulated },
      };
      storeIdempotency(claimKey, result);
      return result;
      } catch (err) {
        await releaseIdempotencyClaim(claimKey);
        throw err;
      }
    }),

  /**
   * confirmNfemFunding (admin) — single-winner flip requested→funded→'selling'
   * after the bank confirms the FXBT funding; sets purchasedAt/deadlineAt(+24h)
   * and books TB DR FX_INVENTORY_USD / CR BANK_NGN (posted — money moved).
   */
  confirmNfemFunding: auditedAdminProcedure
    .input(
      z.object({
        batchId: z.number().int().positive(),
        fxbtReference: z.string().max(64).optional(),
        // wave12 G5: actual amount the bank disbursed (major units). Absent →
        // full disbursement (unchanged path). Present and < requested →
        // partial fill: entitlement is consumed by the ACTUAL amount, the
        // residual is returned (postNfemReturn legs, nfem-residual key) and
        // the batch closes as 'part_filled'. Must be ≤ the requested amount
        // (validated against the batch row inside the transaction — a refine
        // cannot see the persisted requested amount).
        actualDisbursedUsd: z.number().positive().optional(),
        totpCode: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "NFEM funding confirmation");
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);

      const claimKey = `BDC-NFEM-FUND-${tenantId}-${input.batchId}`;
      const claim = await claimIdempotency(claimKey);
      if (claim.cached) return claim.result;

      try {
      const result = await db.transaction(async (tx) => {
        // 1. Single-winner flips requested → funded → selling (each guarded;
        //    both must hit exactly one row).
        const funded = (await tx.execute(sql`
          UPDATE bdc_nfem_purchase_batches
          SET status = 'funded', purchased_at = NOW(), deadline_at = NOW() + INTERVAL '24 hours',
              fxbt_reference = COALESCE(${input.fxbtReference ?? null}, fxbt_reference), updated_at = NOW()
          WHERE id = ${input.batchId} AND tenant_id = ${tenantId} AND status = 'requested'
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        // Re-read via drizzle for camelCase mapping (raw RETURNING is snake_case).
        const [batchRow] = await tx
          .select()
          .from(bdcNfemPurchaseBatches)
          .where(and(eq(bdcNfemPurchaseBatches.id, input.batchId), eq(bdcNfemPurchaseBatches.tenantId, tenantId)))
          .limit(1);
        if (funded.length !== 1) {
          if (!batchRow) throw new TRPCError({ code: "NOT_FOUND", message: "NFEM batch not found" });
          throw new TRPCError({
            code: "CONFLICT",
            message: `Batch is '${batchRow.status}' — only 'requested' batches can be funding-confirmed`,
          });
        }
        const batch = batchRow;

        // wave12 G5 partial disbursement: actual < requested → the batch
        // closes as 'part_filled' (11 chars — fits the varchar(12) status
        // column) with the residual marked returned. actual == requested (or
        // absent) keeps the full 'selling' path unchanged.
        const requestedCents = toCents(batch.amountUsd);
        const actualCents = input.actualDisbursedUsd !== undefined ? toCents(input.actualDisbursedUsd) : requestedCents;
        if (actualCents > requestedCents) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `actualDisbursedUsd (${input.actualDisbursedUsd}) exceeds the requested batch amount (${batch.amountUsd})`,
          });
        }
        const residualCents = requestedCents - actualCents;
        const isPartial = residualCents > 0;

        if (isPartial) {
          const flipped = (await tx.execute(sql`
            UPDATE bdc_nfem_purchase_batches
            SET status = 'part_filled', actual_disbursed_usd = ${centsToMajor(actualCents)}::numeric,
                residual_handling = 'returned', updated_at = NOW()
            WHERE id = ${input.batchId} AND tenant_id = ${tenantId} AND status = 'funded'
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (flipped.length !== 1) {
            throw new TRPCError({ code: "CONFLICT", message: "NFEM funding flip failed — retry" });
          }

          // Entitlement consumption = ACTUAL amount: requestNfemPurchase
          // consumed the requested amount via the guarded UPDATE, so release
          // the residual here (guarded: used_usd can never go below 0).
          if (batch.entitlementId != null) {
            const released = (await tx.execute(sql`
              UPDATE bdc_nfem_entitlements
              SET used_usd = used_usd - ${centsToMajor(residualCents)}::numeric, version = version + 1, updated_at = NOW()
              WHERE id = ${batch.entitlementId}
                AND tenant_id = ${tenantId}
                AND used_usd - ${centsToMajor(residualCents)}::numeric >= 0
              RETURNING id
            `)) as unknown as Array<{ id: number }>;
            if (released.length !== 1) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Entitlement residual release failed (used_usd guard) — retry",
              });
            }
          }
        } else {
          const selling = (await tx.execute(sql`
            UPDATE bdc_nfem_purchase_batches
            SET status = 'selling', updated_at = NOW()
            WHERE id = ${input.batchId} AND tenant_id = ${tenantId} AND status = 'funded'
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (selling.length !== 1) {
            throw new TRPCError({ code: "CONFLICT", message: "NFEM funding flip failed — retry" });
          }
        }

        // 2. TB posting: DR FX_INVENTORY_USD / CR BANK_NGN (posted legs).
        //    Tenant-scoped deterministic key (F2) — batch ids are identity
        //    PKs, but the key also namespaces the derived TB transfer ids.
        const tbKey = `NFEM-BATCH-${tenantId}-${batch.id}`;
        const legs = await postNfemPurchase({
          tenantId,
          idempotencyKey: tbKey,
          amountUsdMinor: BigInt(toCents(batch.amountUsd)),
          nairaPaidMinor: BigInt(toCents(batch.nairaPaid)),
        });

        // 3. Ledger transaction row (nfem_purchase) carrying the TB legs.
        const [txn] = await tx
          .insert(bdcTransactions)
          .values({
            tenantId,
            branchId: null,
            txnType: "nfem_purchase",
            currency: "USD",
            fxAmount: batch.amountUsd,
            nairaAmount: batch.nairaPaid,
            rate: batch.rate,
            purposeCode: null,
            evidenceRefs: batch.fxbtReference ? [`fxbt:${batch.fxbtReference}`] : [],
            customerId: null,
            paymentLeg: { method: "nip_transfer", reference: batch.fxbtReference ?? null },
            cashPortion: "0.00",
            idempotencyKey: `BDC-${tbKey}`,
            tbTransferIds: legs as unknown as Record<string, unknown>[],
            status: "settled",
            makerId: ctx.user.id,
          })
          .returning();

        // 4. PG mirror in the SAME transaction.
        await mirrorLegsToPg(tx, legs, {
          reference: `BDC-${tbKey}`,
          type: "bdc_nfem_purchase",
          tenantId,
          bdcTransactionId: txn.id,
        });

        // 5. wave12 G5: residual return legs for a partial fill. The purchase
        //    legs above booked the full requested amount (the naira was paid
        //    in full at request time); the bank disbursed only the actual
        //    amount, so the residual USD leaves inventory and the residual
        //    naira returns via postNfemReturn — deterministic key
        //    `nfem-residual:${tenantId}:${batchId}` (replay-safe; distinct
        //    from markBatchReturned's `nfem-return:` key). Fail-closed like
        //    the purchase legs: a TB failure rolls this transaction back and
        //    the whole confirmation can be retried idempotently.
        let residualLegs: Awaited<ReturnType<typeof postNfemReturn>> = [];
        let residualKey: string | null = null;
        if (isPartial) {
          residualKey = `nfem-residual:${tenantId}:${batch.id}`;
          const rateKobo = BigInt(toCents(batch.rate));
          const residualNairaKobo = (BigInt(residualCents) * rateKobo + 50n) / 100n;
          residualLegs = await postNfemReturn({
            tenantId,
            idempotencyKey: residualKey,
            amountUsdMinor: BigInt(residualCents),
            nairaReturnedMinor: residualNairaKobo,
          });
          // PG mirror for the residual legs in the SAME transaction.
          await mirrorLegsToPg(tx, residualLegs, {
            reference: residualKey,
            type: "bdc_nfem_residual_return",
            tenantId,
            bdcTransactionId: txn.id,
          });
        }

        // Start the 24h lifecycle workflow AFTER the money transaction commits.
        // Fail-soft: a Temporal outage never blocks funding confirmation — the
        // eodClose sweep is the safety net for expired batches (honest WARN).
        // Partial fills do NOT enter 'selling' — no lifecycle workflow is
        // started for them (the residual is already returned; the status is
        // the honest terminal 'part_filled').
        const result = {
          status: (isPartial ? "part_filled" : "selling") as "part_filled" | "selling",
          batchId: batch.id,
          deadlineAt: batch.deadlineAt,
          actualDisbursedUsd: isPartial ? centsToMajor(actualCents) : null as string | null,
          residualUsd: isPartial ? centsToMajor(residualCents) : null as string | null,
          tbTransferIds: legs,
          residualTbTransferIds: residualLegs,
          temporalWorkflowId: null as string | null,
        };
        return result;
      });

      // wave12 G5: only 'selling' batches get the 24h lifecycle workflow —
      // a 'part_filled' batch is terminal (residual returned), nothing sweeps it.
      if (result.status === "selling") try {
        const { startBdcNfemBatchLifecycle } = await import("../../temporal/workflows-bdc.js");
        const started = await startBdcNfemBatchLifecycle(result.batchId);
        if (started) {
          result.temporalWorkflowId = `bdc-nfem-batch-${result.batchId}`;
          const db2 = await requireDb();
          await db2
            .update(bdcNfemPurchaseBatches)
            .set({ temporalWorkflowId: result.temporalWorkflowId })
            .where(eq(bdcNfemPurchaseBatches.id, result.batchId));
        }
      } catch (wfErr) {
        logger.warn({ err: wfErr, batchId: result.batchId }, "[BDC sourcing] Temporal unavailable — 24h lifecycle workflow not started; eodClose sweep remains the enforcement net");
      }

      storeIdempotency(claimKey, result);
      return result;
      } catch (err) {
        await releaseIdempotencyClaim(claimKey);
        throw err;
      }
    }),

  /** markBatchLiquidated (dealer) — guarded flip selling → liquidated. */
  markBatchLiquidated: auditedProcedure
    .input(z.object({ batchId: z.number().int().positive(), totpCode: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "NFEM batch liquidation");
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const flipped = (await db.execute(sql`
        UPDATE bdc_nfem_purchase_batches
        SET status = 'liquidated', liquidated_at = NOW(), updated_at = NOW()
        WHERE id = ${input.batchId} AND tenant_id = ${tenantId} AND status = 'selling'
        RETURNING id
      `)) as unknown as Array<{ id: number }>;
      if (flipped.length !== 1) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Batch is not in 'selling' status — cannot mark liquidated",
        });
      }
      return { status: "liquidated" as const, batchId: input.batchId };
    }),

  /**
   * markBatchReturned (dealer) — guarded flip selling → returned; the naira
   * return leg reference is mandatory and recorded on an 'nfem_return'
   * transaction row (paymentLeg payload).
   */
  markBatchReturned: auditedProcedure
    .input(
      z.object({
        batchId: z.number().int().positive(),
        nairaReturnReference: z.string().min(4).max(96),
        totpCode: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "NFEM batch return");
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);

      const result = await db.transaction(async (tx) => {
        const flipped = (await tx.execute(sql`
          UPDATE bdc_nfem_purchase_batches
          SET status = 'returned', updated_at = NOW()
          WHERE id = ${input.batchId} AND tenant_id = ${tenantId} AND status = 'selling'
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        // Re-read via drizzle for camelCase mapping (raw RETURNING is snake_case).
        const [batch] = await tx
          .select()
          .from(bdcNfemPurchaseBatches)
          .where(and(eq(bdcNfemPurchaseBatches.id, input.batchId), eq(bdcNfemPurchaseBatches.tenantId, tenantId)))
          .limit(1);
        if (flipped.length !== 1) {
          if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "NFEM batch not found" });
          // M28: idempotent replay — a batch already 'returned' returns the
          // batch row instead of an undefined/empty result.
          if (batch.status === "returned") {
            return {
              status: "returned" as const,
              batchId: batch.id,
              nairaReturnReference: null as string | null,
              replay: true,
              batch,
            };
          }
          throw new TRPCError({
            code: "CONFLICT",
            message: "Batch is not in 'selling' status — cannot mark returned",
          });
        }
        if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "NFEM batch not found" });

        // F11: TB return legs for the unsold NFEM funds — inverse of the
        // purchase posting (DR CUSTOMER_PAYABLE_usd CR FX_INVENTORY_USD /
        // DR BANK_NGN CR CUSTOMER_PAYABLE_ngn), deterministic key
        // `nfem-return:{tenantId}:{batchId}` (replay-safe). Fail-soft per the
        // returns-file style: the bank-side return already happened, so a TB
        // outage must not block the honest status flip — it is logged loudly
        // and annotated on the return transaction for recon.
        let returnLegs: Awaited<ReturnType<typeof postNfemReturn>> = [];
        let tbNote: string | null = null;
        const returnKey = `nfem-return:${tenantId}:${batch.id}`;
        try {
          returnLegs = await postNfemReturn({
            tenantId,
            idempotencyKey: returnKey,
            amountUsdMinor: BigInt(toCents(batch.amountUsd)),
            nairaReturnedMinor: BigInt(toCents(batch.nairaPaid)),
          });
        } catch (tbErr) {
          tbNote = `TB return legs NOT booked (${tbErr instanceof Error ? tbErr.message : String(tbErr)}) — recon must replay postNfemReturn(${returnKey})`;
          logger.error(
            { err: tbErr instanceof Error ? tbErr.message : String(tbErr), batchId: batch.id, tenantId, returnKey },
            "[BDC sourcing] NFEM return TB legs failed — batch still marked 'returned' (fail-soft, recon required)",
          );
        }

        // Record the naira return leg (payload) on an nfem_return transaction.
        const [returnTxn] = await tx.insert(bdcTransactions).values({
          tenantId,
          branchId: null,
          txnType: "nfem_return",
          currency: "USD",
          fxAmount: batch.amountUsd,
          nairaAmount: batch.nairaPaid,
          rate: batch.rate,
          purposeCode: null,
          evidenceRefs: [],
          customerId: null,
          paymentLeg: { method: "nip_transfer", reference: input.nairaReturnReference },
          cashPortion: "0.00",
          idempotencyKey: `BDC-NFEM-RETURN-${tenantId}-${batch.id}`,
          tbTransferIds: returnLegs as unknown as Record<string, unknown>[],
          status: "settled",
          makerId: ctx.user.id,
          failureReason: tbNote,
        }).returning({ id: bdcTransactions.id });

        if (returnLegs.length > 0) {
          await mirrorLegsToPg(tx, returnLegs, {
            reference: returnKey,
            type: "bdc_nfem_return",
            tenantId,
            bdcTransactionId: returnTxn.id,
          });
        }
        return { status: "returned" as const, batchId: batch.id, nairaReturnReference: input.nairaReturnReference, replay: false, batch };
      });
      return result;
    }),

  /** entitlementStatus — current-week entitlement rows + remaining headroom. */
  entitlementStatus: auditedProcedure
    .input(z.object({ bankCode: z.string().max(16).optional() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const weekStart = weekStartUTC(new Date());
      const conditions = [eq(bdcNfemEntitlements.tenantId, tenantId), eq(bdcNfemEntitlements.weekStart, weekStart)];
      if (input.bankCode) conditions.push(eq(bdcNfemEntitlements.bankCode, input.bankCode));
      const rows = await db
        .select()
        .from(bdcNfemEntitlements)
        .where(and(...conditions))
        .orderBy(desc(bdcNfemEntitlements.updatedAt));
      return {
        weekStart,
        entitlements: rows.map((r) => ({
          ...r,
          remainingUsd: centsToMajor(BigInt(toCents(r.capUsd)) - BigInt(toCents(r.usedUsd))),
        })),
      };
    }),

  /**
   * positionNow — live NOP + borrowing vs prudential caps. Balances come from
   * TigerBeetle lookups (stalenessLabel '≤1s'); USD conversion uses the live
   * rate service (rateStale flags fallback rates).
   */
  positionNow: auditedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const tenantId = await requireTenantId(ctx.user.id);
    const pos = await computePosition(db, tenantId);
    return {
      nopUsd: centsToMajor(pos.nopUsdMinor),
      nopPct: pos.nopPct,
      borrowingUsd: centsToMajor(pos.borrowingUsdMinor),
      borrowingPct: pos.borrowingPct,
      breaches: pos.breaches,
      perCurrency: pos.perCurrency,
      stalenessLabel: pos.stalenessLabel,
      rateStale: pos.rateStale,
    };
  }),

  /**
   * eodClose (manager) — record-then-report: ALWAYS inserts a
   * bdc_position_snapshots row, sweeps expired batches (deadline passed, still
   * 'selling') to 'expired' with an alerts payload, then reports breaches
   * (hard-fail style response body — the snapshot is already recorded).
   */
  eodClose: auditedProcedure
    .input(z.object({ totpCode: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC end-of-day close");
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);

      const pos = await computePosition(db, tenantId);

      // 1. Snapshot is recorded unconditionally (record-then-report).
      const [snapshot] = await db
        .insert(bdcPositionSnapshots)
        .values({
          tenantId,
          nopUsd: centsToMajor(pos.nopUsdMinor),
          nopPct: pos.nopPct.toFixed(2),
          borrowing: centsToMajor(pos.borrowingUsdMinor),
          borrowingPct: pos.borrowingPct.toFixed(2),
          breachFlags: pos.breaches as unknown as Record<string, unknown>[],
        })
        .returning();

      // 2. Sweep expired batches → 'expired' + alert payload.
      const expired = (await db.execute(sql`
        UPDATE bdc_nfem_purchase_batches
        SET status = 'expired', updated_at = NOW()
        WHERE tenant_id = ${tenantId} AND status = 'selling' AND deadline_at IS NOT NULL AND deadline_at < NOW()
        RETURNING id, amount_usd, deadline_at
      `)) as unknown as Array<{ id: number; amount_usd: string; deadline_at: string }>;
      const alerts = expired.map((b) => ({
        type: "NFEM_BATCH_EXPIRED",
        batchId: b.id,
        amountUsd: b.amount_usd,
        deadlineAt: b.deadline_at,
        message: `NFEM batch ${b.id} exceeded its 24h liquidation deadline — force liquidation required`,
      }));
      if (alerts.length > 0) {
        logger.warn({ tenantId, alerts }, "[BDC sourcing] EOD sweep expired NFEM batches");
      }

      return {
        closed: true,
        snapshotId: snapshot.id,
        nopUsd: centsToMajor(pos.nopUsdMinor),
        nopPct: pos.nopPct,
        borrowingUsd: centsToMajor(pos.borrowingUsdMinor),
        borrowingPct: pos.borrowingPct,
        breaches: pos.breaches,
        expiredBatchIds: expired.map((b) => b.id),
        alerts,
        stalenessLabel: pos.stalenessLabel,
        rateStale: pos.rateStale,
      };
    }),

  /** Dealer desk: list NFEM purchase batches (24h countdown source for the UI). */
  listBatches: auditedProcedure
    .input(z.object({
      status: z.enum(["requested", "funded", "selling", "liquidated", "returned", "expired"]).optional(),
      cursor: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const rows = await db
        .select()
        .from(bdcNfemPurchaseBatches)
        .where(and(
          eq(bdcNfemPurchaseBatches.tenantId, tenantId),
          input.status ? eq(bdcNfemPurchaseBatches.status, input.status) : undefined,
          input.cursor ? sql`${bdcNfemPurchaseBatches.id} < ${input.cursor}` : undefined,
        ))
        .orderBy(desc(bdcNfemPurchaseBatches.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const batches = hasMore ? rows.slice(0, input.limit) : rows;
      return { batches, nextCursor: hasMore ? batches[batches.length - 1]?.id ?? null : null };
    }),
});
