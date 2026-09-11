/**
 * W10-FIX-B (audit H6/C2/H3) — Payout Settlement Sweeper.
 *
 * Async rails (Mojaloop RESERVED/UNCERTAIN, Circle non-terminal states) and
 * parked post-commit TB failures can never settle inside the request path —
 * and the 1h TigerBeetle hold timeout would otherwise auto-void while funds
 * may have disbursed. This sweeper is the ONLY component that resolves those
 * rows, honestly:
 *
 *   partner_payout_requests in `executing` (bounded batch of 50):
 *     - mojaloop: getTransferStatus(settleRef)
 *         COMMITTED → postHold (retry-safe; deterministic EPP-SETTLE id,
 *         TB exists(46) = idempotent success) → guarded flip to `settled`.
 *         ABORTED   → voidHold + guarded flip to `failed` — UNLESS the row's
 *                     RECON marker says railCommitted (conflicting signals →
 *                     CRITICAL manual-recon, never void a committed payout).
 *         else      → leave; if the TB hold is gone/expired (lookup, else
 *                     age > 55min heuristic) log CRITICAL manual-recon with
 *                     {holdExpiredUnresolved:true} — never forced.
 *     - stablecoin: circleClient.getTransfer(settleRef), status normalized
 *         toUpperCase (H6a — circleClient does no normalization):
 *         COMPLETE → post + settled; FAILED/DENIED/CANCELLED → void + failed;
 *         else leave (same hold-expiry handling).
 *     - RECON marker {tbPostFailed:true} (audit C2: rail committed, TB post
 *       failed in the request path) → retry the post, then settle.
 *
 *   vendor_bills in `paying` with metadata.railUncertain === true (audit H3):
 *         COMMITTED → post TB hold (retry on metadata.tbPostFailed) + the paid
 *                     flip mirroring vendorBills.ts executePayment (:787-812).
 *         ABORTED   → the existing guarded refund path (void hold, wallet
 *                     refund, float-fee reversal, failed flip, tx rows).
 *         else      → leave; age > 55min → {holdExpiredUnresolved:true}
 *                     CRITICAL manual-recon.
 *
 *   p2p_transfers in `settling` with failure_reason LIKE 'RECON:%' (round-2
 *   audit M2 — p2pInstant parks UNCERTAIN cross-border settlements there):
 *         COMMITTED → guarded completed flip + success side effects mirroring
 *                     p2pInstant.ts:771-787 (+notifications);
 *         ABORTED   → guarded single-winner claim+credit compensation
 *                     mirroring p2pInstant.ts:795-825 (atomic: claim rolls
 *                     back if the sender credit fails);
 *         else      → leave parked; age > 55min → one-time
 *                     {unresolvedEscalated:true} CRITICAL escalation.
 *
 *   Round-2 M3: an aborted payout flips to `failed` ONLY when its prefund
 *   hold was actually released (void succeeded / hold already gone); a failed
 *   void leaves the row executing with a one-time {voidFailed:true} marker.
 *
 *   card_funding_intents in `executing` older than 10 minutes (round-2 audit
 *   M4 + round-3 C-R3-1/C-R3-2/M1 — execute claimed the intent but no
 *   terminal write landed; batch 25): resolved via FIX-C's
 *   describeIntentExecutionState (direct side-effect probes as a pre-merge
 *   fallback, same round-5 contract: invoice landed := keyed/legacy
 *   attribution match, vendor_bill landed := bill 'paid' AND payment-evidence
 *   corroboration (paymentRef PI / CF marker — never the queue flag)): landed → guarded executed flip +
 *   funding event; not_landed → Stripe-PI-verified terminal: captured →
 *   sweeper-issued refund + guarded refunded flip (refund failure → stay
 *   executing + CRITICAL); uncaptured/canceled → guarded failed flip; unknown
 *   → parked + CRITICAL manual-recon, escalating after 24h. A failed flip is
 *   NEVER taken while a captured PI remains unrefunded (M1).
 *
 * Every transition is a guarded single-winner UPDATE; every unresolvable
 * state is logged, never forced. Registration mirrors
 * stablecoinScheduler.ts: an exported idempotent start function (node-cron,
 * every 2 minutes, overlap-guarded, crash-safe per-row try/catch). The
 * orchestrator boot-registers it in server/_core/index.ts.
 */
import cron, { type ScheduledTask } from "node-cron";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { transactions } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { tigerBeetle } from "../middleware/middlewareIntegration";
import {
  PLATFORM_SYSTEM_USER_ID,
  TB_LEDGERS,
  postPendingTransfer,
  toMinorUnits,
  voidPendingTransfer,
} from "../_core/tigerBeetle";
import { pendingTransferIdFor } from "../_core/transferPipeline";
import { publishEvent, KAFKA_TOPICS } from "../middleware/kafka";
import { speedTierFee, type SpeedTier } from "../_core/speedTiers";
import {
  decodePayoutRecon,
  deliverPartnerWebhooks,
  encodePayoutRecon,
  type PayoutReconMarker,
} from "../routers/embeddedPayouts";
// Round-2 M4: namespace import so the sweeper bundles and runs even before
// FIX-C's describeIntentExecutionState export lands (w10-fix2-c) — absence is
// detected at runtime and handled with direct side-effect probes.
import * as cardFunding from "../routers/cardFunding.js";

const SWEEP_BATCH = 50;
/** TB holds are created with timeoutSeconds=3600 — flag unresolved holds past 55min. */
const HOLD_EXPIRY_GRACE_MS = 55 * 60 * 1000;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

// ─── Shared helpers ───────────────────────────────────────────────────────────

function ageMs(iso: unknown, fallback: unknown): number {
  const raw = iso ?? fallback;
  const t = raw instanceof Date ? raw.getTime() : Date.parse(String(raw ?? ""));
  return Number.isFinite(t) ? Date.now() - t : 0;
}

/** TB result "exists"/"already_posted" = idempotent replay of our deterministic id. */
function isBenignIdempotentReplay(msg: string): boolean {
  return /\bexists\b/i.test(msg) || /already_posted/i.test(msg);
}

// ─── Embedded payouts (partner_payout_requests) ──────────────────────────────

interface PayoutRow {
  id: number;
  partnerTenantId: number;
  rail: string;
  currency: string;
  amount: string;
  corridor: string;
  settleRef: string | null;
  failureReason: string | null;
  tbHoldId: string | null;
  idempotencyKey: string;
  updatedAt: string;
}

async function payoutPostHold(row: PayoutRow, holdId: bigint, ledger: number): Promise<void> {
  await tigerBeetle.postPendingTransfer({
    id: pendingTransferIdFor(`EPP-SETTLE-${row.id}`),
    pendingId: holdId,
    ledger,
    code: 1,
  });
}

async function payoutVoidHold(row: PayoutRow, holdId: bigint, ledger: number): Promise<void> {
  await tigerBeetle.voidPendingTransfer({
    id: pendingTransferIdFor(`EPP-VOID-${row.id}`),
    pendingId: holdId,
    ledger,
    code: 1,
  });
}

async function flipPayout(db: Db, row: PayoutRow, to: "settled" | "failed", extra: { settleRef?: string | null; failureReason?: string | null }): Promise<boolean> {
  const flip = (await db.execute(sql`
    UPDATE partner_payout_requests
    SET status = ${to},
        settle_ref = COALESCE(${extra.settleRef ?? null}, settle_ref),
        failure_reason = ${extra.failureReason ?? null},
        updated_at = NOW()
    WHERE id = ${row.id} AND partner_tenant_id = ${row.partnerTenantId} AND status = 'executing'
    RETURNING id
  `)) as unknown as Array<{ id: number }>;
  if (flip.length === 0) {
    logger.warn({ payoutId: row.id, to }, "[PayoutSweeper] Guarded flip matched 0 rows — concurrent transition won; leaving as-is");
    return false;
  }
  publishEvent("remitflow.embedded-payouts", String(row.id), {
    type: `payout.${to}`, tenantId: row.partnerTenantId, id: row.id, status: to,
    rail: row.rail, amount: row.amount, currency: row.currency, corridor: row.corridor,
    timestamp: new Date().toISOString(),
  }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[PayoutSweeper] Kafka publish failed (degraded-open)"));
  await deliverPartnerWebhooks(row.partnerTenantId, `payout.${to}`, {
    id: row.id, status: to, rail: row.rail, amount: row.amount,
    currency: row.currency, corridor: row.corridor, failureReason: extra.failureReason ?? null,
    settleRef: extra.settleRef ?? row.settleRef, idempotencyKey: row.idempotencyKey,
  }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err), payoutId: row.id }, "[PayoutSweeper] Partner webhook delivery failed (degraded-open)"));
  return true;
}

/**
 * Hold-expiry honesty check for rows the rail could not resolve. Flags once
 * (RECON marker holdExpiredUnresolved) + CRITICAL manual-recon log. The TB
 * client exposes lookupTransfers, so a live pending transfer suppresses the
 * age heuristic; when the lookup itself fails we fall back to age > 55min.
 */
async function checkPayoutHoldExpired(row: PayoutRow, recon: PayoutReconMarker | null, holdId: bigint | null): Promise<void> {
  if (recon?.holdExpiredUnresolved) return; // already flagged — do not spam
  let expired = ageMs(recon?.detectedAt, row.updatedAt) > HOLD_EXPIRY_GRACE_MS;
  if (expired && holdId != null) {
    try {
      const transfers = await tigerBeetle.lookupTransfers([holdId]);
      // flags bit 2 = TransferFlags.pending — a live pending hold is NOT expired.
      if (transfers.length > 0 && (Number(transfers[0].flags) & 2) !== 0) expired = false;
    } catch {
      // Lookup unavailable — keep the age heuristic (per finding).
    }
  }
  if (!expired) return;
  const marker = encodePayoutRecon({
    ...(recon ?? {}),
    holdExpiredUnresolved: true,
    detectedAt: recon?.detectedAt ?? new Date().toISOString(),
    holdExpiredDetectedAt: new Date().toISOString(),
  });
  const db = await getDb();
  if (db) {
    await db.execute(sql`
      UPDATE partner_payout_requests SET failure_reason = ${marker}, updated_at = NOW()
      WHERE id = ${row.id} AND partner_tenant_id = ${row.partnerTenantId} AND status = 'executing'
    `).catch(() => {});
  }
  logger.error(
    { payoutId: row.id, rail: row.rail, settleRef: row.settleRef, tbHoldId: row.tbHoldId },
    "[PayoutSweeper] CRITICAL: TB hold expired/auto-voided while the rail outcome is UNRESOLVED — prefund may be released while funds may have disbursed; MANUAL RECONCILIATION REQUIRED",
  );
}

async function sweepPayoutRow(db: Db, row: PayoutRow): Promise<void> {
  const recon = decodePayoutRecon(row.failureReason);
  const ledger = TB_LEDGERS[row.currency];
  const holdId = row.tbHoldId ? BigInt(row.tbHoldId) : null;
  if (!ledger || holdId == null) {
    logger.error({ payoutId: row.id, rail: row.rail, currency: row.currency, tbHoldId: row.tbHoldId },
      "[PayoutSweeper] CRITICAL: executing payout missing ledger/hold id — cannot reconcile; MANUAL RECONCILIATION REQUIRED");
    return;
  }

  // ── Resolve the rail outcome ─────────────────────────────────────────────
  let outcome: "committed" | "aborted" | "pending" = "pending";
  let abortReason = "rail aborted";
  if (row.rail === "mojaloop") {
    const transferId = row.settleRef ?? (typeof recon?.transferId === "string" ? recon.transferId : null);
    if (!transferId) {
      // Rail call still in flight or the row pre-dates ref persistence.
      await checkPayoutHoldExpired(row, recon, holdId);
      return;
    }
    try {
      const { getTransferStatus } = await import("../mojaloop.service.js");
      const status = await getTransferStatus(transferId);
      if (status.transferState === "COMMITTED") outcome = "committed";
      else if (status.transferState === "ABORTED") {
        outcome = "aborted";
        abortReason = `rail_aborted: ${status.errorInformation?.errorDescription ?? "mojaloop transfer aborted by switch"}`;
      }
    } catch (err) {
      logger.warn({ payoutId: row.id, transferId, err: err instanceof Error ? err.message : String(err) },
        "[PayoutSweeper] Mojaloop status query failed — leaving row executing for next sweep");
    }
  } else if (row.rail === "stablecoin") {
    const transferId = row.settleRef;
    if (!transferId) {
      await checkPayoutHoldExpired(row, recon, holdId);
      return;
    }
    try {
      const { getTransfer } = await import("../_core/circleClient");
      const tx = await getTransfer(transferId);
      // H6a: Circle W3S states are UPPERCASE; circleClient does no normalization.
      const state = String(tx.status ?? "").toUpperCase();
      if (state === "COMPLETE") outcome = "committed";
      else if (state === "FAILED" || state === "DENIED" || state === "CANCELLED") {
        outcome = "aborted";
        abortReason = `rail_aborted: circle transfer ${state.toLowerCase()}`;
      }
    } catch (err) {
      logger.warn({ payoutId: row.id, transferId, err: err instanceof Error ? err.message : String(err) },
        "[PayoutSweeper] Circle status query failed — leaving row executing for next sweep");
    }
  } else {
    logger.warn({ payoutId: row.id, rail: row.rail }, "[PayoutSweeper] Executing payout on an unreconcilable rail — leaving for manual review");
    return;
  }

  // ── Act on the outcome ───────────────────────────────────────────────────
  if (outcome === "committed") {
    // C2: post the hold (retry-safe — deterministic post id, TB exists(46) is
    // idempotent success in the middleware), then the guarded settled flip.
    try {
      await payoutPostHold(row, holdId, ledger);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isBenignIdempotentReplay(msg)) {
        const marker = encodePayoutRecon({
          ...(recon ?? {}), railCommitted: true, railRef: row.settleRef ?? recon?.railRef,
          tbPostFailed: true, tbPostError: msg, detectedAt: recon?.detectedAt ?? new Date().toISOString(),
        });
        await db.execute(sql`
          UPDATE partner_payout_requests SET failure_reason = ${marker}, updated_at = NOW()
          WHERE id = ${row.id} AND partner_tenant_id = ${row.partnerTenantId} AND status = 'executing'
        `).catch(() => {});
        logger.error({ payoutId: row.id, settleRef: row.settleRef, err: msg },
          "[PayoutSweeper] CRITICAL: rail COMMITTED but TB post failed again — row stays executing with tbPostFailed; MANUAL RECONCILIATION REQUIRED");
        return;
      }
    }
    await flipPayout(db, row, "settled", { settleRef: row.settleRef, failureReason: null });
    return;
  }

  if (outcome === "aborted") {
    if (recon?.railCommitted) {
      // We previously recorded the rail as COMMITTED (e.g. TB post failed
      // after commit) — a later ABORTED is a conflicting signal. NEVER void a
      // hold for a payout we recorded as disbursed.
      logger.error({ payoutId: row.id, settleRef: row.settleRef },
        "[PayoutSweeper] CRITICAL: conflicting rail signals — row marked railCommitted but status query says ABORTED; leaving executing; MANUAL RECONCILIATION REQUIRED");
      return;
    }
    // M3 (round-2 audit): flip to `failed` ONLY when the prefund hold was
    // actually released — a failed void means the prefund is still captured,
    // and marking failed would misreport captured funds as released.
    let holdReleased = false;
    let voidError: string | null = null;
    try {
      await payoutVoidHold(row, holdId, ledger);
      holdReleased = true;
    } catch (err) {
      voidError = err instanceof Error ? err.message : String(err);
      // already_voided / expired = the hold is already gone (released by a
      // prior attempt or by TB's 1h timeout) — the prefund WAS released.
      if (/\bexists\b|already_voided|expired/i.test(voidError)) holdReleased = true;
    }
    if (!holdReleased) {
      // Last word from the cluster: if the hold simply no longer exists, it
      // was resolved elsewhere (auto-void timeout) — released.
      try {
        const transfers = await tigerBeetle.lookupTransfers([holdId]);
        if (transfers.length === 0) holdReleased = true;
      } catch { /* lookup unavailable — stay conservative */ }
    }
    if (!holdReleased) {
      // Void failed and the hold is still live: leave executing, mark once.
      if (!recon?.voidFailed) {
        const marker = encodePayoutRecon({
          ...(recon ?? {}),
          railAborted: true,
          voidFailed: true,
          voidError,
          detectedAt: recon?.detectedAt ?? new Date().toISOString(),
        });
        await db.execute(sql`
          UPDATE partner_payout_requests SET failure_reason = ${marker}, updated_at = NOW()
          WHERE id = ${row.id} AND partner_tenant_id = ${row.partnerTenantId} AND status = 'executing'
        `).catch(() => {});
        logger.error({ payoutId: row.id, settleRef: row.settleRef, err: voidError },
          "[PayoutSweeper] CRITICAL: rail ABORTED but hold void failed — prefund still captured; row stays executing with voidFailed (NOT flipped to failed); MANUAL RECONCILIATION REQUIRED");
      }
      return;
    }
    await flipPayout(db, row, "failed", { settleRef: row.settleRef, failureReason: abortReason });
    return;
  }

  // Still pending/unknown — honest: leave executing, flag expired holds.
  await checkPayoutHoldExpired(row, recon, holdId);
}

// ─── Vendor bills (vendor_bills paying + metadata.railUncertain) ─────────────

interface BillRow {
  id: number;
  tenantId: number;
  vendorId: number;
  amount: string;
  currency: string;
  speedTier: string;
  paymentRail: string | null;
  metadata: Record<string, unknown> | null;
  updatedAt: string;
}

function emitSweepBillEvent(eventType: string, key: string, payload: Record<string, unknown>): void {
  publishEvent("remitflow.vendor-bills", key, { eventType, ...payload, timestamp: new Date().toISOString() })
    .catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err), eventType }, "[PayoutSweeper] Kafka event failed"));
}

async function sweepBillRow(db: Db, bill: BillRow): Promise<void> {
  const meta = (bill.metadata ?? {}) as Record<string, unknown>;
  const transferId = typeof meta.transferId === "string" ? meta.transferId : null;
  const payerUserId = typeof meta.payerUserId === "number" ? meta.payerUserId : null;
  if (!transferId) {
    logger.error({ billId: bill.id }, "[PayoutSweeper] CRITICAL: rail-uncertain bill has no transferId — cannot reconcile; MANUAL RECONCILIATION REQUIRED");
    return;
  }

  let state: "COMMITTED" | "ABORTED" | "OTHER" = "OTHER";
  let abortDetail = "mojaloop transfer aborted by switch (reconciled)";
  try {
    const { getTransferStatus } = await import("../mojaloop.service.js");
    const status = await getTransferStatus(transferId);
    if (status.transferState === "COMMITTED") state = "COMMITTED";
    else if (status.transferState === "ABORTED") {
      state = "ABORTED";
      abortDetail = `mojaloop transfer aborted by switch (reconciled)${
        status.errorInformation ? `: ${status.errorInformation.errorCode} ${status.errorInformation.errorDescription}` : ""}`;
    }
  } catch (err) {
    logger.warn({ billId: bill.id, transferId, err: err instanceof Error ? err.message : String(err) },
      "[PayoutSweeper] Mojaloop status query failed — leaving bill paying for next sweep");
  }

  if (state === "OTHER") {
    // Unresolvable this cycle — honest leave; flag holds past the TB timeout.
    if (!meta.holdExpiredUnresolved && ageMs(meta.detectedAt, bill.updatedAt) > HOLD_EXPIRY_GRACE_MS) {
      await db.execute(sql`
        UPDATE vendor_bills
        SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ holdExpiredUnresolved: true, holdExpiredDetectedAt: new Date().toISOString() })}::jsonb,
            updated_at = NOW()
        WHERE id = ${bill.id} AND tenant_id = ${bill.tenantId} AND status = 'paying'
      `).catch(() => {});
      logger.error({ billId: bill.id, transferId },
        "[PayoutSweeper] CRITICAL: TB hold expired/auto-voided while the vendor-bill rail outcome is UNRESOLVED — payer debited, hold released, disbursement unknown; MANUAL RECONCILIATION REQUIRED");
    }
    return;
  }

  const amount = Number(bill.amount);
  // Fee: the parked metadata carries it; recompute from the bill's tier as a
  // fallback. Never guess — if neither yields a finite fee, fail closed.
  let fee: number | null = typeof meta.fee === "number" && Number.isFinite(meta.fee) ? meta.fee : null;
  if (fee == null) {
    try {
      fee = speedTierFee(amount, bill.paymentRail ?? "mojaloop", (bill.speedTier ?? "standard") as SpeedTier["tier"]);
    } catch {
      fee = null;
    }
  }
  if (fee == null || !Number.isFinite(amount)) {
    logger.error({ billId: bill.id, amount: bill.amount, speedTier: bill.speedTier },
      "[PayoutSweeper] CRITICAL: cannot determine amount+fee for reconciliation — refusing to guess money movement; MANUAL RECONCILIATION REQUIRED");
    return;
  }
  const total = amount + fee;
  const holdRef = `vbill-${bill.id}-hold`;
  const holdId = pendingTransferIdFor(holdRef);
  const paymentRef = `VBILL-${bill.id}`;

  if (state === "COMMITTED") {
    // Post the TB hold (retry-safe on metadata.tbPostFailed), then the paid
    // flip — mirrors vendorBills.ts executePayment (:770-812).
    try {
      await postPendingTransfer(pendingTransferIdFor(`${holdRef}-post`), holdId, toMinorUnits(total.toFixed(2)), bill.currency);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isBenignIdempotentReplay(msg)) {
        await db.execute(sql`
          UPDATE vendor_bills
          SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ tbPostFailed: true, tbPostError: msg })}::jsonb,
              updated_at = NOW()
          WHERE id = ${bill.id} AND tenant_id = ${bill.tenantId} AND status = 'paying'
        `).catch(() => {});
        logger.error({ billId: bill.id, transferId, err: msg },
          "[PayoutSweeper] CRITICAL: rail COMMITTED but TB post failed — funds disbursed, debit stands, bill stays paying with tbPostFailed; MANUAL RECONCILIATION REQUIRED");
        return;
      }
    }
    try {
      await db.transaction(async (tx: any) => {
        const paidRows = (await tx.execute(sql`
          UPDATE vendor_bills
          SET status = 'paid', paid_at = NOW(), payment_ref = ${transferId},
              metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ railUncertain: false, sweeperResolved: "committed", resolvedAt: new Date().toISOString() })}::jsonb,
              updated_at = NOW()
          WHERE id = ${bill.id} AND tenant_id = ${bill.tenantId} AND status = 'paying'
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (paidRows.length === 0) throw new Error("PAID_FLIP_FAILED");
        await tx.execute(sql`
          UPDATE transactions SET status = 'completed', "updatedAt" = NOW()
          WHERE reference = ${paymentRef} AND type = 'bill' AND status = 'processing'
        `);
      });
    } catch (err) {
      logger.warn({ billId: bill.id, err: err instanceof Error ? err.message : String(err) },
        "[PayoutSweeper] Paid flip failed (concurrent transition or tx error) — will retry next sweep");
      return;
    }
    emitSweepBillEvent("vendor_bill.paid", `vendor-bill:${bill.id}:paid`, {
      billId: bill.id, tenantId: bill.tenantId, amount, fee, currency: bill.currency,
      rail: bill.paymentRail ?? "mojaloop", paymentRef: transferId,
      reconciledBy: "payoutSettlementSweeper", paidAt: new Date().toISOString(),
    });
    return;
  }

  // ── Definitive ABORTED → the existing guarded refund path ────────────────
  if (payerUserId == null) {
    logger.error({ billId: bill.id, transferId },
      "[PayoutSweeper] CRITICAL: rail-uncertain bill lacks payerUserId — cannot refund safely; bill stays paying; MANUAL RECONCILIATION REQUIRED");
    return;
  }
  await voidPendingTransfer(pendingTransferIdFor(`${holdRef}-void`), holdId, bill.currency)
    .catch((voidErr: unknown) =>
      logger.error({ billId: bill.id, holdRef, err: voidErr instanceof Error ? voidErr.message : String(voidErr) },
        "[PayoutSweeper] CRITICAL: TB hold void failed on reconciled abort — hold will time out; MANUAL RECONCILIATION REQUIRED"));
  let refundOk = true;
  try {
    await db.transaction(async (tx: any) => {
      // Refund amount + fee to the payer (guarded wallet must exist).
      const refundRows = (await tx.execute(sql`
        UPDATE wallets
        SET balance = CAST(balance AS NUMERIC) + ${total.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
        WHERE "userId" = ${payerUserId} AND currency = ${bill.currency} AND status = 'active'
        RETURNING id
      `)) as unknown as Array<{ id: number }>;
      if (refundRows.length === 0) throw new Error("REFUND_WALLET_UNAVAILABLE");
      // Reverse the platform-fee leg (guarded — executePayment credited it).
      if (fee > 0) {
        const floatDebit = (await tx.execute(sql`
          UPDATE wallets
          SET balance = CAST(balance AS DECIMAL(18,4)) - ${fee.toFixed(4)}, "updatedAt" = NOW(), version = version + 1
          WHERE "userId" = ${PLATFORM_SYSTEM_USER_ID}
            AND currency = ${bill.currency}
            AND status = 'active'
            AND CAST(balance AS DECIMAL(18,4)) >= ${fee.toFixed(4)}
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (floatDebit.length === 0) throw new Error("FLOAT_FEE_REVERSAL_FAILED");
      }
      const failRows = (await tx.execute(sql`
        UPDATE vendor_bills
        SET status = 'failed', failure_reason = ${abortDetail},
            metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ railUncertain: false, sweeperResolved: "aborted", resolvedAt: new Date().toISOString() })}::jsonb,
            updated_at = NOW()
        WHERE id = ${bill.id} AND tenant_id = ${bill.tenantId} AND status = 'paying'
        RETURNING id
      `)) as unknown as Array<{ id: number }>;
      if (failRows.length === 0) throw new Error("FAILED_FLIP_FAILED");
      await tx.execute(sql`
        UPDATE transactions SET status = 'failed', "updatedAt" = NOW()
        WHERE reference = ${paymentRef} AND type = 'bill' AND status = 'processing'
      `);
      if (fee > 0) {
        await tx.execute(sql`
          UPDATE transactions SET status = 'reversed', "updatedAt" = NOW()
          WHERE reference = ${`${paymentRef}-fee`} AND type = 'fee' AND status = 'completed'
        `);
      }
    });
  } catch (refundErr) {
    refundOk = false;
    logger.error(
      { billId: bill.id, err: refundErr instanceof Error ? refundErr.message : String(refundErr), total, currency: bill.currency },
      "[PayoutSweeper] CRITICAL: wallet refund failed after reconciled abort — MANUAL RECONCILIATION REQUIRED",
    );
    // Honest status even here: mark failed with the refund failure noted.
    await db.execute(sql`
      UPDATE vendor_bills
      SET status = 'failed', failure_reason = ${`${abortDetail}; wallet refund FAILED — manual reconciliation required`}, updated_at = NOW()
      WHERE id = ${bill.id} AND tenant_id = ${bill.tenantId} AND status = 'paying'
    `).catch((e: unknown) =>
      logger.error({ billId: bill.id, err: e instanceof Error ? e.message : String(e) },
        "[PayoutSweeper] CRITICAL: could not even mark bill failed — MANUAL RECONCILIATION REQUIRED"));
  }
  emitSweepBillEvent("vendor_bill.failed", `vendor-bill:${bill.id}:failed`, {
    billId: bill.id, tenantId: bill.tenantId, amount, fee, currency: bill.currency,
    rail: bill.paymentRail ?? "mojaloop", reason: abortDetail, refundOk,
    reconciledBy: "payoutSettlementSweeper",
  });
}

// ─── P2P cross-border transfers (p2p_transfers settling + RECON marker) ──────
// M2 (round-2 audit): p2pInstant parks UNCERTAIN rail outcomes in 'settling'
// with a RECON:{...} marker in failure_reason (funds debited, neither
// completed nor refunded). Without a resolver those transfers sat debited
// forever. This section mirrors p2pInstant.ts:754-880 exactly:
//   COMMITTED → the success path (guarded completed flip + transactions row +
//               sender/receiver notifications, :771-787 + :866-898);
//   ABORTED   → the guarded single-winner claim+credit compensation (:795-825);
//   unknown   → leave parked + age-based unresolved escalation CRITICAL.

interface P2pRow {
  id: number;
  senderId: number;
  senderAlias: string | null;
  receiverAlias: string;
  receiverId: number | null;
  sendAmount: string;
  sendCurrency: string;
  receiveAmount: string | null;
  receiveCurrency: string | null;
  fee: string | null;
  rail: string | null;
  corridorCode: string | null;
  mojaloopTransferId: string | null;
  failureReason: string | null;
  updatedAt: string;
}

interface P2pReconMarker {
  railUncertain?: boolean;
  transferId?: string | null;
  railState?: string | null;
  reason?: string;
  detectedAt?: string;
  unresolvedEscalated?: boolean;
}

function decodeP2pRecon(failureReason: string | null): P2pReconMarker | null {
  if (!failureReason || !failureReason.startsWith("RECON:")) return null;
  try {
    const parsed = JSON.parse(failureReason.slice("RECON:".length));
    return parsed && typeof parsed === "object" ? parsed as P2pReconMarker : null;
  } catch {
    return null;
  }
}

/** Re-encode under the varchar(500) failure_reason cap — never truncate JSON. */
function encodeP2pRecon(marker: P2pReconMarker): string {
  const slim: P2pReconMarker = { ...marker };
  let out = `RECON:${JSON.stringify(slim)}`;
  if (out.length > 500) {
    delete slim.reason; // the long free-text field is the first to go
    out = `RECON:${JSON.stringify(slim)}`;
  }
  return out.slice(0, 500);
}

async function notifyP2pSender(senderId: number, title: string, message: string): Promise<void> {
  await publishEvent(KAFKA_TOPICS.NOTIFICATIONS, String(senderId), {
    userId: senderId, type: "p2p_sent", title, message, timestamp: new Date().toISOString(),
  }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[PayoutSweeper] P2P sender notification failed (degraded-open)"));
}

async function sweepP2pRow(db: Db, row: P2pRow): Promise<void> {
  const marker = decodeP2pRecon(row.failureReason);
  const transferId = marker?.transferId ?? row.mojaloopTransferId;
  if (!transferId) {
    logger.error({ p2pTransferId: row.id },
      "[PayoutSweeper] CRITICAL: parked p2p transfer has no rail transferId — cannot reconcile; MANUAL RECONCILIATION REQUIRED");
    return;
  }

  let state: "COMMITTED" | "ABORTED" | "OTHER" = "OTHER";
  let abortReason = "Transfer aborted by rail";
  try {
    const { getTransferStatus } = await import("../mojaloop.service.js");
    const status = await getTransferStatus(transferId);
    if (status.transferState === "COMMITTED") state = "COMMITTED";
    else if (status.transferState === "ABORTED") {
      state = "ABORTED";
      abortReason = status.errorInformation?.errorDescription ?? abortReason;
    }
  } catch (err) {
    logger.warn({ p2pTransferId: row.id, transferId, err: err instanceof Error ? err.message : String(err) },
      "[PayoutSweeper] Mojaloop status query failed — leaving p2p transfer parked for next sweep");
  }

  const sendAmount = Number(row.sendAmount);
  const fee = Number(row.fee ?? "0");
  if (!Number.isFinite(sendAmount) || !Number.isFinite(fee)) {
    logger.error({ p2pTransferId: row.id, sendAmount: row.sendAmount, fee: row.fee },
      "[PayoutSweeper] CRITICAL: parked p2p transfer has a non-numeric amount/fee — refusing to guess money movement; MANUAL RECONCILIATION REQUIRED");
    return;
  }
  const totalDebit = sendAmount + fee;
  const rail = row.rail ?? "mojaloop";

  if (state === "OTHER") {
    // Still unknown — honest leave; escalate once the park outlives the rail's
    // own settlement window (ILP expiry is 300s; 55min matches the hold grace).
    if (!marker?.unresolvedEscalated && ageMs(marker?.detectedAt, row.updatedAt) > HOLD_EXPIRY_GRACE_MS) {
      await db.execute(sql`
        UPDATE p2p_transfers
        SET failure_reason = ${encodeP2pRecon({ ...(marker ?? { railUncertain: true, transferId }), unresolvedEscalated: true, detectedAt: marker?.detectedAt ?? new Date().toISOString() })},
            updated_at = NOW()
        WHERE id = ${row.id} AND status = 'settling'
      `).catch(() => {});
      logger.error({ p2pTransferId: row.id, transferId, senderId: row.senderId, totalDebit, currency: row.sendCurrency },
        "[PayoutSweeper] CRITICAL: parked p2p transfer UNRESOLVED past the settlement window — sender funds remain debited while the rail outcome is unknown; MANUAL RECONCILIATION REQUIRED");
    }
    return;
  }

  if (state === "COMMITTED") {
    // Success path — mirrors p2pInstant.ts:771-787 with a single-winner guard.
    const flip = (await db.execute(sql`
      UPDATE p2p_transfers
      SET status = 'completed', completed_at = NOW(), mojaloop_transfer_id = ${transferId},
          failure_reason = NULL, updated_at = NOW()
      WHERE id = ${row.id} AND status = 'settling'
      RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (flip.length === 0) {
      logger.warn({ p2pTransferId: row.id }, "[PayoutSweeper] Guarded p2p completed flip matched 0 rows — concurrent resolver won; leaving as-is");
      return;
    }
    try {
      // Round-3 V2: schema-real columns (paymentLinks.ts:239-264 pattern) —
      // transactions has NO amount/currency keys; from*/to* are the real ones
      // (fromCurrency/fromAmount NOT NULL).
      await db.insert(transactions).values({
        userId: row.senderId,
        type: "send",
        status: "completed",
        fromCurrency: row.sendCurrency,
        fromAmount: sendAmount.toFixed(2),
        toCurrency: row.sendCurrency,
        toAmount: sendAmount.toFixed(2),
        fee: fee.toFixed(2),
        reference: `P2P-${row.id}`,
        description: `P2P cross-border to ${row.receiverAlias} via ${rail}`,
        recipientName: row.receiverAlias,
        metadata: { p2pTransferId: row.id, rail, mojaloopTransferId: transferId, reconciledBy: "payoutSettlementSweeper" },
      } as any);
    } catch (err) {
      logger.warn({ p2pTransferId: row.id, err: err instanceof Error ? err.message : String(err) }, "[PayoutSweeper] P2P transactions-row insert failed (degraded-open)");
    }
    await notifyP2pSender(row.senderId, "Payment Sent", `You sent ${row.sendCurrency} ${sendAmount.toLocaleString()} to ${row.receiverAlias}`);
    if (row.receiverId) {
      let senderName = "Someone";
      const nameRows = (await db.execute(sql`SELECT name FROM users WHERE id = ${row.senderId} LIMIT 1`)) as unknown as Array<{ name: string | null }>;
      if (nameRows[0]?.name) senderName = nameRows[0].name;
      await publishEvent(KAFKA_TOPICS.NOTIFICATIONS, String(row.receiverId), {
        userId: row.receiverId, type: "p2p_received", title: "Payment Received",
        message: `You received ${row.receiveCurrency ?? ""} ${Number(row.receiveAmount ?? "0").toLocaleString()} from ${senderName}`,
        timestamp: new Date().toISOString(),
      }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[PayoutSweeper] P2P receiver notification failed (degraded-open)"));
    }
    await publishEvent(KAFKA_TOPICS.TRANSACTIONS, String(row.id), {
      eventType: "p2p_transfer", transactionId: row.id, userId: row.senderId,
      amount: String(sendAmount), currency: row.sendCurrency, status: "completed",
      rail, corridorCode: row.corridorCode, reconciledBy: "payoutSettlementSweeper",
      timestamp: new Date().toISOString(),
    }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[PayoutSweeper] P2P Kafka event failed (degraded-open)"));
    return;
  }

  // ── Definitive ABORTED → guarded single-winner claim + credit (p2pInstant
  //    :795-825 mirror). Claim and credit are ATOMIC: if the sender wallet is
  //    unavailable the whole tx rolls back and the row stays 'settling'.
  let wonCompensation = false;
  try {
    wonCompensation = await db.transaction(async (tx: any) => {
      const claimRows = (await tx.execute(sql`
        UPDATE p2p_transfers
        SET status = 'compensated', failed_at = NOW(),
            failure_reason = ${abortReason.slice(0, 500)}, updated_at = NOW()
        WHERE id = ${row.id} AND status = 'settling'
        RETURNING id
      `)) as unknown as Array<{ id: number }>;
      if (claimRows.length === 0) return false;
      const creditRows = (await tx.execute(sql`
        UPDATE wallets SET balance = balance + ${totalDebit.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
        WHERE "userId" = ${row.senderId} AND currency = ${row.sendCurrency} AND status = 'active'
        RETURNING id
      `)) as unknown as Array<{ id: number }>;
      if (creditRows.length === 0) {
        throw new Error("COMPENSATION_CREDIT_FAILED: sender wallet unavailable");
      }
      return true;
    });
  } catch (err) {
    logger.error({ p2pTransferId: row.id, err: err instanceof Error ? err.message : String(err), totalDebit, currency: row.sendCurrency },
      "[PayoutSweeper] CRITICAL: p2p compensation failed atomically — row stays settling, NO partial state; MANUAL RECONCILIATION REQUIRED");
    return;
  }
  if (!wonCompensation) {
    logger.warn({ p2pTransferId: row.id }, "[PayoutSweeper] Guarded p2p compensation claim matched 0 rows — concurrent resolver won; leaving as-is");
    return;
  }
  try {
    // Round-3 V2: schema-real columns (paymentLinks.ts:239-264 pattern).
    await db.insert(transactions).values({
      userId: row.senderId,
      type: "send",
      status: "failed",
      fromCurrency: row.sendCurrency,
      fromAmount: sendAmount.toFixed(2),
      toCurrency: row.sendCurrency,
      toAmount: sendAmount.toFixed(2),
      fee: fee.toFixed(2),
      reference: `P2P-${row.id}`,
      description: `P2P cross-border to ${row.receiverAlias} via ${rail}`,
      recipientName: row.receiverAlias,
      metadata: { p2pTransferId: row.id, rail, mojaloopTransferId: transferId, reconciledBy: "payoutSettlementSweeper" },
    } as any);
  } catch (err) {
    logger.warn({ p2pTransferId: row.id, err: err instanceof Error ? err.message : String(err) }, "[PayoutSweeper] P2P transactions-row insert failed (degraded-open)");
  }
  await notifyP2pSender(row.senderId, "Payment Failed", `Your payment of ${row.sendCurrency} ${sendAmount.toLocaleString()} to ${row.receiverAlias} could not be completed — funds were returned to your wallet.`);
}

// ─── Card funding intents (executing >10min / refund_failed / stale refunding)
// Round-2 M4 / round-3 C-R3-1/C-R3-2/M1: an intent claimed by execute
// (captured→executing) whose executor outcome was never terminally written
// parks forever with captured card funds in limbo. W12: the scan also covers
// 'refund_failed' (retry a failed Stripe refund) and stale 'refunding' rows
// (crashed-claimant reclaim). Resolution follows FIX-C's
// describeIntentExecutionState contract (round-3 tightened):
//   landed     → guarded executing→executed flip + funding event; a row in a
//                refund-claim state probing 'landed' is PARKED (ambiguous
//                refund outcome — never risk purpose-paid AND card-refunded);
//   not_landed → verify the Stripe PI FIRST (M1): captured/succeeded → refund
//                via the SHARED single-winner claim helper
//                cardFunding.refundCapturedFundingIntent (guarded DB claim
//                executing/refund_failed/stale-refunding → refunding → Stripe
//                with the shared idempotency key → terminal refunded |
//                refund_failed flip) + funding event; refund failure →
//                'refund_failed' (rescanned next sweep) + CRITICAL;
//                requires_capture/uncaptured/canceled → guarded failed flip
//                (no refund owed). NEVER flip failed while a captured PI
//                remains unrefunded.
//   unknown    → keep parked + CRITICAL manual-recon (escalates after 24h).
// When the helper is not deployed yet (pre-merge), direct side-effect probes
// stand in under the same round-4 contract: invoice landed := keyed
// attribution match (invoices_v2.metadata.cardFunding.intents["<id>"] or any
// entry's/legacy stripePaymentIntentId, or legacy intentId); vendor_bill
// landed := bill status 'paid' AND rail corroboration for this intent
// (paymentRef Stripe-PI / CFINT_<id> / CF-<id> marker, or queue flag naming
// the intent) — a bare paid bill is NOT landed (paid-by-other-rail ⇒
// not_landed ⇒ refund); transfer (default executor never lands) →
// not_landed; unreadable probes → unknown.

type IntentExecutionState = "landed" | "not_landed" | "unknown";

interface CardFundingRow {
  id: number;
  tenantId: number;
  userId: number;
  stripePaymentIntentId: string;
  purpose: string;
  purposeEntityId: string;
  amount: string;
  currency: string;
  status: string;
  updatedAt: string;
}

const CARD_FUNDING_TOPIC = "remitflow.card-funding";
const CARD_FUNDING_SWEEP_BATCH = 25;
const CARD_FUNDING_STALE_MS = 24 * 60 * 60 * 1000;

async function describeCardFundingExecutionState(db: Db, row: CardFundingRow): Promise<IntentExecutionState> {
  const helper = (cardFunding as unknown as {
    describeIntentExecutionState?: (intentId: number) => Promise<IntentExecutionState>;
  }).describeIntentExecutionState;
  if (typeof helper === "function") {
    try {
      return await helper(row.id);
    } catch (err) {
      // Fail closed: a broken probe is never evidence of landing.
      logger.warn({ intentId: row.id, err: err instanceof Error ? err.message : String(err) },
        "[PayoutSweeper] describeIntentExecutionState threw — treating as unknown (parked)");
      return "unknown";
    }
  }
  // ── Fallback: direct side-effect probes (helper not yet deployed) ────────
  // Round-5 contract — MUST agree with FIX-C's helper (identical copies of
  // cardFundingAttributionMatches / paymentRefCorroboratesIntent logic):
  //   invoice:    landed := keyed attribution match on
  //               invoices_v2.metadata.cardFunding — intents["<id>"] exists,
  //               or any intents[k].stripePaymentIntentId matches, or the
  //               legacy top-level intentId/stripePaymentIntentId matches.
  //               Attribution absent/different := not_landed (another
  //               rail/intent paid, or unpaid — refund correct). Unreadable :=
  //               unknown (Stripe-PI-canceled ⇒ not_landed).
  //   vendor_bill: landed := status 'paid' AND payment-evidence corroboration
  //               for THIS intent — paymentRef contains the Stripe PI id or a
  //               boundary-exact CFINT_<id>/CF-<id> marker. The metadata queue
  //               flag NEVER corroborates landed (it proves a queue request,
  //               not which funds paid). A paid bill WITHOUT such evidence
  //               (another rail, e.g. VBILL-<id> wallet debit) := not_landed
  //               → refund remediates the double-charge. Flag + unpaid :=
  //               unknown (QUEUED). cancelled/rejected/void/failed :=
  //               not_landed.
  if (row.purpose === "invoice") {
    const inv = (await db.execute(sql`
      SELECT status, metadata FROM invoices_v2 WHERE id = ${Number(row.purposeEntityId)} AND tenant_id = ${row.tenantId} LIMIT 1
    `)) as unknown as Array<{ status: string; metadata: unknown }>;
    const invoice = inv[0];
    if (!invoice) {
      // Invoice unreadable — Stripe PI canceled ⇒ not_landed, else unknown.
      try {
        const { getStripe } = await import("../stripe.js");
        const pi = await getStripe().paymentIntents.retrieve(row.stripePaymentIntentId);
        if (pi.status === "canceled") return "not_landed";
      } catch { /* Stripe probe unavailable — stay unknown */ }
      return "unknown";
    }
    const meta = invoice.metadata && typeof invoice.metadata === "object"
      ? invoice.metadata as Record<string, unknown>
      : null;
    const cf = meta?.cardFunding && typeof meta.cardFunding === "object"
      ? meta.cardFunding as Record<string, unknown>
      : null;
    let attributed = false;
    if (cf) {
      // (b) legacy top-level intentId / (c-legacy) stripePaymentIntentId
      if ((cf.intentId !== undefined && cf.intentId !== null && String(cf.intentId) === String(row.id))
        || (typeof cf.stripePaymentIntentId === "string" && cf.stripePaymentIntentId === row.stripePaymentIntentId)) {
        attributed = true;
      }
      // (a) keyed intents map / (c) any entry's stripePaymentIntentId
      const intents = cf.intents;
      if (!attributed && intents !== null && typeof intents === "object") {
        const map = intents as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(map, String(row.id))) {
          attributed = true;
        } else {
          for (const key of Object.keys(map)) {
            const entry = map[key];
            if (entry !== null && typeof entry === "object") {
              const pi = (entry as Record<string, unknown>).stripePaymentIntentId;
              if (typeof pi === "string" && pi === row.stripePaymentIntentId) { attributed = true; break; }
            }
          }
        }
      }
    }
    if (attributed) {
      return "landed"; // THIS intent's payment is attributed on the invoice
    }
    // No attribution for this intent — whether the invoice is paid/covering
    // (another rail/intent paid) or unpaid/uncovered, THIS intent never
    // landed; refunding it is correct.
    return "not_landed";
  }
  if (row.purpose === "vendor_bill") {
    const bills = (await db.execute(sql`
      SELECT status, payment_ref AS "paymentRef",
             (metadata->'cardFundingExecutionRequested'->>'intentId') AS "flagIntentId",
             (metadata->'cardFundingExecutionRequested'->>'stripePaymentIntentId') AS "flagStripePi"
      FROM vendor_bills WHERE id = ${Number(row.purposeEntityId)} AND tenant_id = ${row.tenantId} LIMIT 1
    `)) as unknown as Array<{ status: string; paymentRef: string | null; flagIntentId: string | null; flagStripePi: string | null }>;
    const bill = bills[0];
    if (!bill) return "unknown"; // unreadable
    if (bill.status === "paid") {
      // H-R4-2 (round-5) — identical to cardFunding's
      // paymentRefCorroboratesIntent: landing requires PAYMENT-EVIDENCE
      // corroboration ONLY. The metadata queue flag NEVER corroborates — it
      // proves the intent QUEUED the bill, not which funds paid it.
      const ref = bill.paymentRef ?? "";
      let corroborated = ref.length > 0 && ref.includes(row.stripePaymentIntentId);
      if (!corroborated && ref.length > 0) {
        for (const marker of [`CFINT_${row.id}`, `CF-${row.id}`]) {
          // Boundary-exact (V1 MEDIUM-1): 'CF-12' must not match 'CF-123'.
          const escaped = marker.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
          if (new RegExp(`(^|[^0-9A-Za-z])${escaped}([^0-9]|$)`).test(ref)) {
            corroborated = true;
            break;
          }
        }
      }
      // Paid WITHOUT payment evidence ⇒ paid by another rail/intent ⇒ X's
      // funds can never be applied ⇒ not_landed (refund is the remediation).
      return corroborated ? "landed" : "not_landed";
    }
    if (bill.status === "cancelled" || bill.status === "rejected" || bill.status === "void" || bill.status === "failed") {
      return "not_landed";
    }
    // Any other state (incl. metadata.cardFundingExecutionRequested present —
    // QUEUED, the flag is not payment) is genuinely unresolved.
    return "unknown";
  }
  if (row.purpose === "transfer") return "not_landed"; // default executor never lands (honest UNAVAILABLE)
  return "unknown";
}

async function emitCardFundingEvent(
  eventType: string,
  row: CardFundingRow,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    await publishEvent(CARD_FUNDING_TOPIC, `card-funding:${row.id}:${eventType}`, {
      eventType,
      intentId: row.id,
      tenantId: row.tenantId,
      purpose: row.purpose,
      purposeEntityId: row.purposeEntityId,
      status,
      amount: String(row.amount),
      currency: row.currency,
      reconciledBy: "payoutSettlementSweeper",
      timestamp: new Date().toISOString(),
      ...extra,
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), intentId: row.id }, "[PayoutSweeper] Card-funding Kafka emit failed (degraded-open)");
  }
}

async function sweepCardFundingRow(db: Db, row: CardFundingRow): Promise<void> {
  const state = await describeCardFundingExecutionState(db, row);

  if (state === "landed") {
    // W12: only a clean 'executing' row may flip to executed. A
    // 'refund_failed'/'refunding' row carries an AMBIGUOUS refund outcome (a
    // Stripe refund may have landed while the response was lost) — flipping
    // executed could double-settle (purpose paid AND card refunded). Park for
    // manual reconciliation instead.
    if (row.status !== "executing") {
      logger.error(
        { intentId: row.id, status: row.status, stripePaymentIntentId: row.stripePaymentIntentId },
        "[PayoutSweeper] CRITICAL: card-funding intent probes 'landed' but sits in a refund-claim state — refund outcome AMBIGUOUS; refusing the executed flip (double-settlement risk); MANUAL RECONCILIATION REQUIRED",
      );
      return;
    }
    // The executor's side effect is durable fact — settle the intent.
    // Guarded single-winner executing→executed (mirrors cardFunding execute).
    const done = (await db.execute(sql`
      UPDATE card_funding_intents
      SET status = 'executed', updated_at = NOW()
      WHERE id = ${row.id} AND tenant_id = ${row.tenantId} AND status = 'executing'
      RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (done.length === 0) {
      logger.warn({ intentId: row.id }, "[PayoutSweeper] Guarded card-funding executed flip matched 0 rows — concurrent settlement won; leaving as-is");
      return;
    }
    await emitCardFundingEvent("funding.executed", row, "executed");
    return;
  }

  if (state === "not_landed") {
    // M1 (round-3): NEVER flip failed while a CAPTURED Stripe PI remains
    // unrefunded — that strands captured card funds forever (execute cannot
    // run on a failed intent to refund). Verify the PI first; refund captured
    // funds HERE (mirroring cardFunding execute's refund call), and only then
    // take a terminal flip.
    try {
      const { getStripe } = await import("../stripe.js");
      const stripe = getStripe();
      const pi = await stripe.paymentIntents.retrieve(row.stripePaymentIntentId);
      if (pi.status === "succeeded") {
        // Captured — a refund is owed. W12: issue it ONLY through the shared
        // single-winner claim helper (cardFunding.refundCapturedFundingIntent)
        // — the same function the execute path uses. The guarded DB claim
        // (executing/refund_failed/stale-refunding → refunding) decides which
        // path refunds; only the claim winner calls Stripe, with the identical
        // idempotency key `card-funding-refund-<intentId>`; the terminal
        // 'refunded' flip lands only after Stripe confirms (sweep-then-flip
        // ordering preserved); a Stripe failure parks the row in
        // 'refund_failed' which this sweeper rescans and retries.
        const refundHelper = (cardFunding as unknown as {
          refundCapturedFundingIntent?: (intent: { id: number; tenantId: number; stripePaymentIntentId: string }) => Promise<
            | { outcome: "refunded"; stripeRefundId: string | null; alreadyRefunded: boolean }
            | { outcome: "not_claimed"; currentStatus: string | null }
            | { outcome: "refund_failed"; error: string }
          >;
        }).refundCapturedFundingIntent;
        if (typeof refundHelper !== "function") {
          // Fail closed: NEVER refund without the single-winner claim.
          logger.error(
            { intentId: row.id, stripePaymentIntentId: row.stripePaymentIntentId },
            "[PayoutSweeper] CRITICAL: cardFunding.refundCapturedFundingIntent unavailable — refusing to refund without the single-winner claim; staying parked; MANUAL RECONCILIATION REQUIRED",
          );
          return;
        }
        const refundResult = await refundHelper({
          id: row.id,
          tenantId: row.tenantId,
          stripePaymentIntentId: row.stripePaymentIntentId,
        });
        if (refundResult.outcome === "not_claimed") {
          logger.warn({ intentId: row.id, currentStatus: refundResult.currentStatus },
            "[PayoutSweeper] Card-funding refund claim lost the race — concurrent path owns the intent; leaving as-is");
          return;
        }
        if (refundResult.outcome === "refund_failed") {
          // The helper parked the row in 'refund_failed' — this sweeper
          // rescans that state, so the retry is automatic.
          logger.error(
            { intentId: row.id, stripePaymentIntentId: row.stripePaymentIntentId, err: refundResult.error },
            "[PayoutSweeper] CRITICAL: card-funding intent not_landed but refund of the CAPTURED PI failed — parked in 'refund_failed' (NO failed flip; captured funds must not strand); retry next sweep; MANUAL RECONCILIATION REQUIRED",
          );
          return;
        }
        await emitCardFundingEvent("funding.refunded", row, "refunded", {
          refund: refundResult.alreadyRefunded ? "already_refunded_idempotent" : "issued_by_sweeper",
          stripeRefundId: refundResult.stripeRefundId ?? "already_refunded",
          reason: "execution side effect never landed (settlement sweeper)",
        });
        logger.info({ intentId: row.id, stripeRefundId: refundResult.stripeRefundId },
          "[PayoutSweeper] Card-funding intent refunded: executor never landed, captured PI refunded by sweeper (single-winner claim)");
        return;
      }
      // Only states where NOTHING is (or can still become) captured may flip
      // failed with no refund owed. 'processing'/'succeeded'-adjacent or
      // unrecognized states fail closed below.
      const noCaptureStates = new Set(["requires_capture", "requires_payment_method", "requires_confirmation", "requires_action", "canceled"]);
      if (!noCaptureStates.has(pi.status)) {
        logger.error(
          { intentId: row.id, stripePaymentIntentId: row.stripePaymentIntentId, piStatus: pi.status },
          "[PayoutSweeper] CRITICAL: unrecognized/uncertain Stripe PI state while not_landed — cannot prove no capture; staying executing (NO failed flip); MANUAL RECONCILIATION REQUIRED",
        );
        return;
      }
      // requires_capture/uncaptured/canceled — nothing captured, no refund owed.
    } catch (probeErr) {
      logger.error(
        { intentId: row.id, stripePaymentIntentId: row.stripePaymentIntentId, err: probeErr instanceof Error ? probeErr.message : String(probeErr) },
        "[PayoutSweeper] CRITICAL: Stripe PI probe failed while not_landed — cannot verify capture state; staying executing (NO failed flip); retry next sweep",
      );
      return;
    }
    // W12: 'refund_failed'/stale-'refunding' rows may also take this flip —
    // the PI is verifiably UNcaptured here, so no refund can have landed at
    // Stripe and marking failed strands nothing.
    const failed = (await db.execute(sql`
      UPDATE card_funding_intents
      SET status = 'failed', updated_at = NOW()
      WHERE id = ${row.id} AND tenant_id = ${row.tenantId}
        AND status IN ('executing', 'refund_failed', 'refunding')
      RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (failed.length === 0) {
      logger.warn({ intentId: row.id }, "[PayoutSweeper] Guarded card-funding failed flip matched 0 rows — concurrent settlement won; leaving as-is");
      return;
    }
    await emitCardFundingEvent("funding.failed", row, "failed", {
      reason: "execution side effect never landed (settlement sweeper)",
      refund: "not_owed — Stripe PI not captured",
    });
    logger.warn({ intentId: row.id, purpose: row.purpose, purposeEntityId: row.purposeEntityId },
      "[PayoutSweeper] Card-funding intent failed: executor never landed, Stripe PI not captured — no refund owed");
    return;
  }

  // unknown — keep parked honestly. CRITICAL manual-recon; escalates past 24h.
  const staleMs = ageMs(null, row.updatedAt);
  logger.error(
    { intentId: row.id, purpose: row.purpose, purposeEntityId: row.purposeEntityId, stripePaymentIntentId: row.stripePaymentIntentId, parkedHours: Math.round(staleMs / 3_600_000) },
    staleMs > CARD_FUNDING_STALE_MS
      ? "[PayoutSweeper] CRITICAL: card-funding intent parked >24h with UNRESOLVED execution state — captured funds in limbo; MANUAL RECONCILIATION REQUIRED"
      : "[PayoutSweeper] CRITICAL: card-funding intent execution state UNRESOLVED — leaving parked; manual reconciliation if persistent",
  );
}

// ─── Sweep cycle ──────────────────────────────────────────────────────────────

export async function runPayoutSettlementSweep(): Promise<{ payoutsScanned: number; billsScanned: number; p2pScanned: number; cardFundingScanned: number }> {
  const db = await getDb();
  if (!db) {
    logger.warn("[PayoutSweeper] Database unavailable — sweep skipped (fail closed, no state touched)");
    return { payoutsScanned: 0, billsScanned: 0, p2pScanned: 0, cardFundingScanned: 0 };
  }

  const payoutRows = (await db.execute(sql`
    SELECT id, partner_tenant_id AS "partnerTenantId", rail, currency, amount, corridor,
           settle_ref AS "settleRef", failure_reason AS "failureReason", tb_hold_id AS "tbHoldId",
           idempotency_key AS "idempotencyKey", updated_at AS "updatedAt"
    FROM partner_payout_requests
    WHERE status = 'executing'
    ORDER BY id
    LIMIT ${SWEEP_BATCH}
  `)) as unknown as PayoutRow[];

  for (const row of payoutRows) {
    try {
      await sweepPayoutRow(db, row);
    } catch (err) {
      // Crash-safe: one bad row never aborts the batch nor forces a state.
      logger.error({ payoutId: row.id, err: err instanceof Error ? err.message : String(err) },
        "[PayoutSweeper] Row reconciliation failed — leaving executing for next sweep");
    }
  }

  const billRows = (await db.execute(sql`
    SELECT id, tenant_id AS "tenantId", vendor_id AS "vendorId", amount, currency,
           speed_tier AS "speedTier", payment_rail AS "paymentRail", metadata, updated_at AS "updatedAt"
    FROM vendor_bills
    WHERE status = 'paying' AND metadata->>'railUncertain' = 'true'
    ORDER BY id
    LIMIT ${SWEEP_BATCH}
  `)) as unknown as BillRow[];

  for (const bill of billRows) {
    try {
      await sweepBillRow(db, bill);
    } catch (err) {
      logger.error({ billId: bill.id, err: err instanceof Error ? err.message : String(err) },
        "[PayoutSweeper] Bill reconciliation failed — leaving paying for next sweep");
    }
  }

  // M2 (round-2 audit): parked p2p cross-border transfers (settling + RECON).
  const p2pRows = (await db.execute(sql`
    SELECT id, sender_id AS "senderId", sender_alias AS "senderAlias", receiver_alias AS "receiverAlias",
           receiver_id AS "receiverId", send_amount AS "sendAmount", send_currency AS "sendCurrency",
           receive_amount AS "receiveAmount", receive_currency AS "receiveCurrency",
           fee, rail, corridor_code AS "corridorCode", mojaloop_transfer_id AS "mojaloopTransferId",
           failure_reason AS "failureReason", updated_at AS "updatedAt"
    FROM p2p_transfers
    WHERE status = 'settling' AND failure_reason LIKE 'RECON:%'
    ORDER BY id
    LIMIT ${SWEEP_BATCH}
  `)) as unknown as P2pRow[];

  for (const row of p2pRows) {
    try {
      await sweepP2pRow(db, row);
    } catch (err) {
      logger.error({ p2pTransferId: row.id, err: err instanceof Error ? err.message : String(err) },
        "[PayoutSweeper] P2P reconciliation failed — leaving settling for next sweep");
    }
  }

  // Round-2 M4: parked card-funding intents (executing > 10min, batch 25).
  // W12 (refund single-winner claim): also rescan 'refund_failed' rows (a
  // prior refund attempt failed at Stripe — retryable) and STALE 'refunding'
  // rows (a claimant crashed between the claim and the terminal write; the
  // 15min staleness window matches the helper's reclaim guard, and the Stripe
  // idempotency key collapses any duplicate refund the crashed claimant may
  // have issued).
  const cardFundingRows = (await db.execute(sql`
    SELECT id, tenant_id AS "tenantId", user_id AS "userId",
           stripe_payment_intent_id AS "stripePaymentIntentId",
           purpose, purpose_entity_id AS "purposeEntityId", amount, currency,
           status, updated_at AS "updatedAt"
    FROM card_funding_intents
    WHERE (status = 'executing' AND updated_at < NOW() - INTERVAL '10 minutes')
       OR (status = 'refund_failed' AND updated_at < NOW() - INTERVAL '2 minutes')
       OR (status = 'refunding' AND updated_at < NOW() - INTERVAL '15 minutes')
    ORDER BY id
    LIMIT ${CARD_FUNDING_SWEEP_BATCH}
  `)) as unknown as CardFundingRow[];

  for (const row of cardFundingRows) {
    try {
      await sweepCardFundingRow(db, row);
    } catch (err) {
      logger.error({ intentId: row.id, err: err instanceof Error ? err.message : String(err) },
        "[PayoutSweeper] Card-funding reconciliation failed — leaving executing for next sweep");
    }
  }

  return { payoutsScanned: payoutRows.length, billsScanned: billRows.length, p2pScanned: p2pRows.length, cardFundingScanned: cardFundingRows.length };
}

// ─── Registration (stablecoinScheduler.ts pattern; orchestrator boot-wires) ──

let sweeperTask: ScheduledTask | null = null;
let sweepInFlight = false;

/** Idempotent, overlap-guarded, crash-safe. Safe to call multiple times. */
export function startPayoutSettlementSweeper(): void {
  if (sweeperTask) {
    logger.info("[PayoutSweeper] Already running — start is idempotent, ignoring");
    return;
  }
  sweeperTask = cron.schedule("*/2 * * * *", () => {
    if (sweepInFlight) {
      logger.warn("[PayoutSweeper] Previous sweep still running — skipping this tick (overlap guard)");
      return;
    }
    sweepInFlight = true;
    runPayoutSettlementSweep()
      .catch((err: unknown) => {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, "[PayoutSweeper] Sweep cycle error — state untouched, next tick retries");
      })
      .finally(() => { sweepInFlight = false; });
  });
  logger.info("[PayoutSweeper] Settlement sweeper started (every 2min, overlap-guarded)");
}

export function stopPayoutSettlementSweeper(): void {
  if (sweeperTask) {
    sweeperTask.stop();
    sweeperTask = null;
  }
  logger.info("[PayoutSweeper] Settlement sweeper stopped");
}
