/**
 * SPEC-bdc §3.10 — BDC IMTO payout router (B4).
 *
 * Inbound remittance (IMTO → Mojaloop) cash-out at a BDC branch:
 *   - payoutQuote          (teller)  validate recipient reference via Mojaloop
 *                           parties lookup (FAIL CLOSED UNAVAILABLE on Mojaloop
 *                           outage), price the payout from the tenant's
 *                           published buy rate + the IMTO commission schedule
 *                           (bps tier where tierMinUsd ≤ amount ≤ tierMaxUsd),
 *                           return an EPHEMERAL HMAC-SIGNED quote payload
 *                           (choice documented below — no quote row is
 *                           persisted; bdc_transactions stays reserved for
 *                           real executions).
 *   - executePayout        (teller+TOTP) KYC tier gate → claimIdempotency
 *                           (`BDC-IMTO-{tenantId}-{reference}`, tenant-scoped)
 *                           BEFORE money movement →
 *                           one db.transaction (bdc_transactions 'imto_payout'
 *                           status 'pending' + bdc_imto_settlements 'accrued'
 *                           + version-guarded drawer denomination decrement
 *                           when paying cash + TB posting DR IMTO_SETTLEMENT
 *                           CR NGN_CASH + CR COMMISSION_INCOME via _ledger) →
 *                           Mojaloop transfer leg initiated HONESTLY: the
 *                           payout stays 'pending' until the switch confirms
 *                           (webhook) or the synchronous response carries an
 *                           explicit switch state. UNCERTAIN is never
 *                           fabricated into success OR failure.
 *   - settlementStatement  (finance) period statement: deterministic
 *                           statementRef + guarded 'accrued'→'settled' flips
 *                           (only rows whose Mojaloop leg is confirmed).
 *   - reconcileSettlements (finance) READ-ONLY variance list.
 *
 * ── ORCHESTRATOR WIRING (webhook settlement confirmation) ────────────────────
 * server/mojaloop.webhook.ts MUST NOT be edited by B4. The extension point is
 * the transfer-committed callback:
 *   PUT /api/mojaloop/callback/transfers/:transferId
 *   (server/mojaloop.webhook.ts, the `payload.transferState === "COMMITTED"`
 *    block, immediately after advanceTransferState(...) succeeds ~line 296)
 * The orchestrator adds there:
 *   const { confirmImtoSettlement } = await import("./routers/bdc/imto");
 *   await confirmImtoSettlement(db2, transferId)
 *     .catch(err => logger.warn({ err, transferId }, "[BDC] IMTO settlement confirm failed"));
 * confirmImtoSettlement (exported below) performs the guarded single-winner
 * flips: bdc_imto_settlements 'accrued'→'settled' and the linked
 * bdc_transactions 'pending'/'posted'→'settled' (linked via
 * payment_leg->>'mojaloopTransferId').
 *
 * ── Ephemeral quote choice (documented per tasking) ─────────────────────────
 * The quote is NOT a bdc_transactions row: a pending 'quote' row would pollute
 * the money audit trail and the status vocabulary ('pending' means money
 * reserved). Instead payoutQuote returns { payload, signature } — an
 * HMAC-SHA256-signed (BDC_QUOTE_SIGNING_SECRET ?? JWT_SECRET/cookieSecret),
 * tenant-bound, 10-minute-expiring payload that executePayout verifies
 * (timing-safe) before any money movement. Tampering or cross-tenant replay
 * → BAD_REQUEST.
 *
 * ── _shared/_ledger signatures (verified against ./\_ledger) ────────────────
 *   getBdcProfile(db, tenantId) → active profile row (throws PRECONDITION_FAILED)
 *   assertBranchActive(db, tenantId, branchId) → void (throws on inactive/missing)
 *   toCents(value: string | number) → integer minor units (cents)
 *   ensureBdcAccounts(tenantId) → void (idempotent TB chart provisioning)
 *   postImtoPayout({ tenantId, idempotencyKey, nairaMinor: bigint,
 *     commissionMinor: bigint }) → TbLegRecord[]  (TB BigInt minor units;
 *     payout leg PENDING until confirmImtoSettlement posts it via confirmLeg;
 *     TB failure throws → tx rolls back, per SPEC §0.3 fail-closed)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHmac, timingSafeEqual } from "crypto";
import { router, auditedProcedure, auditedAdminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import { resolveTenantContext } from "../../tenantMiddleware";
import {
  bdcTransactions,
  bdcImtoSettlements,
  bdcCommissionSchedules,
  bdcRateQuotes,
  bdcDenominationInventory,
  bdcTellerDrawers,
} from "../../../drizzle/schema";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  lookupParty,
  initiateTransfer,
  buildIlpPacket,
} from "../../mojaloop.service";
import { claimIdempotency, storeIdempotency, releaseIdempotencyClaim } from "../../middleware/coreAtomicity";
import { requireTotpStepUp, requireKycTierForAmount } from "../../_core/totpStepUp";
import { ENV } from "../../_core/env";
import { logger } from "../../_core/logger";
import { getBdcProfile, assertBranchActive, toCents } from "./_shared";
import {
  ensureBdcAccounts,
  postImtoPayout,
  confirmLeg,
  reversePost,
  mirrorLegsToPg,
  type TbLegRecord,
} from "./_ledger";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

// ─── Constants ───────────────────────────────────────────────────────────────

/** Quote validity window — short-lived so rates cannot be shopped. */
const QUOTE_TTL_MS = 10 * 60 * 1000;

/**
 * Recon threshold (unsettled naira) used by reconcileSettlements. Keep in
 * sync with BDC_RECON_VARIANCE_THRESHOLD_NGN in
 * server/temporal/activities-bdc.ts (single source for the Temporal recon;
 * duplicated here only to avoid a router → temporal module dependency).
 */
const IMTO_RECON_VARIANCE_THRESHOLD_NGN = 100000;

/** Our FSP id on the Mojaloop switch (matches server/mojaloop.service.ts default). */
const MOJALOOP_FSP_ID = process.env.MOJALOOP_FSP_ID ?? "remitflow-fsp";

// ─── Quote payload (ephemeral, HMAC-signed) ──────────────────────────────────

const quotePayloadSchema = z.object({
  v: z.literal(1),
  tenantId: z.number().int(),
  imtoCode: z.string().min(1).max(32),
  reference: z.string().min(1).max(64),
  currency: z.string().length(3),
  fxAmount: z.string(),          // numeric(18,2) major units, FX currency
  rate: z.string(),              // naira per 1 FX unit
  nairaAmount: z.string(),       // gross naira value
  commission: z.string(),        // naira commission (deducted from payout)
  payoutAmount: z.string(),      // nairaAmount - commission (cash to recipient)
  payeeFspId: z.string().min(1), // IMTO FSP on the switch (resolved, never 'pending-callback')
  quoteId: z.string().min(8).max(64),
  expiresAt: z.string(),         // ISO
});
type ImtoQuotePayload = z.infer<typeof quotePayloadSchema>;

function quoteSecret(): string {
  return process.env.BDC_QUOTE_SIGNING_SECRET ?? ENV.cookieSecret;
}

function signQuotePayload(payload: ImtoQuotePayload): string {
  return createHmac("sha256", quoteSecret()).update(JSON.stringify(payload)).digest("base64url");
}

function verifyQuote(raw: { payload: unknown; signature: string }, tenantId: number): ImtoQuotePayload {
  const parsed = quotePayloadSchema.safeParse(raw.payload);
  if (!parsed.success) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Malformed payout quote payload" });
  }
  const payload = parsed.data;
  const expected = signQuotePayload(payload);
  const a = Buffer.from(raw.signature ?? "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid payout quote signature — re-quote" });
  }
  if (payload.tenantId !== tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Payout quote belongs to a different tenant" });
  }
  if (new Date(payload.expiresAt).getTime() <= Date.now()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Payout quote expired — re-quote" });
  }
  return payload;
}

// ─── Money helpers (numeric(18,2) major-unit strings; integer-cent math) ────

function centsToMajor(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** gross * bps/10000, rounded half-up to the cent. */
function bpsOf(grossMajor: string, bps: number): string {
  return centsToMajor(Math.round((toCents(grossMajor) * bps) / 10000));
}

function multiplyMajor(amountMajor: string, rateMajor: string): string {
  // amount (2dp) × rate (2dp) → cents precision: round(cents * rate).
  return centsToMajor(Math.round(toCents(amountMajor) * Number(rateMajor)));
}

async function requireTenantId(userId: number): Promise<number> {
  const tenant = await resolveTenantContext(userId);
  if (!tenant.tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "An active tenant is required for BDC IMTO operations." });
  }
  return tenant.tenantId;
}

async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — BDC IMTO operation denied (fail-closed)" });
  }
  return db;
}

/** period "YYYY-MM" → [start, end) UTC ISO bounds. */
function periodWindow(period: string): { start: string; end: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new TRPCError({ code: "BAD_REQUEST", message: "period must be YYYY-MM (UTC)" });
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new TRPCError({ code: "BAD_REQUEST", message: "period month out of range" });
  return {
    start: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    end: new Date(Date.UTC(year, month, 1)).toISOString(),
  };
}

// ─── Webhook entry point (orchestrator wires — see header) ───────────────────

/**
 * Confirm an IMTO payout settlement after the Mojaloop switch reports the
 * transfer COMMITTED. Guarded single-winner flips only — safe to call
 * repeatedly (duplicate/out-of-order webhooks are no-ops).
 *
 * Two-phase commit (F1/F10): the PENDING payout TB leg posted at initiation
 * (`imto:{txnId}:payout`) is POSTED here via confirmLeg, inside the same
 * db.transaction as the PG flips + PG mirror (M27). A TB failure throws →
 * the whole transaction rolls back → the webhook logs and a later replay
 * (duplicate webhook / manual re-drive) retries; the settlement is never
 * marked 'settled' while its naira leg is unposted (fail-closed).
 *
 * Returns the outcome for the caller's logging; never throws on
 * already-settled rows.
 */
export async function confirmImtoSettlement(
  db: Db,
  mojaloopTransferId: string,
): Promise<{ settlementUpdated: boolean; txnUpdated: boolean; reason?: string }> {
  return db.transaction(async (tx) => {
    const settled = (await tx.execute(sql`
      UPDATE bdc_imto_settlements
      SET status = 'settled', settled_at = COALESCE(settled_at, NOW()), updated_at = NOW()
      WHERE mojaloop_transfer_id = ${mojaloopTransferId} AND status = 'accrued'
      RETURNING id, tenant_id AS "tenantId"
    `)) as unknown as Array<{ id: number; tenantId: number }>;

    if (settled.length === 0) {
      const existing = (await tx.execute(sql`
        SELECT status FROM bdc_imto_settlements WHERE mojaloop_transfer_id = ${mojaloopTransferId} LIMIT 1
      `)) as unknown as Array<{ status: string }>;
      if (existing.length === 0) return { settlementUpdated: false, txnUpdated: false, reason: "no_settlement_row" };
      // Settlement already terminal — still try to settle the txn (crash-safe).
    }

    const tenantId = settled[0]?.tenantId;
    const txns = (await tx.execute(sql`
      UPDATE bdc_transactions
      SET status = 'settled', updated_at = NOW()
      WHERE payment_leg->>'mojaloopTransferId' = ${mojaloopTransferId}
        AND status IN ('pending', 'posted')
        ${tenantId ? sql`AND tenant_id = ${tenantId}` : sql``}
      RETURNING id, tenant_id AS "tenantId", tb_transfer_ids AS "tbTransferIds"
    `)) as unknown as Array<{ id: number; tenantId: number; tbTransferIds: unknown }>;

    // Two-phase commit of every pending TB leg (payout leg posted on the
    // switch's COMMITTED). Posting key must match initiation: `imto:{id}:payout`.
    for (const t of txns) {
      const legs = (t.tbTransferIds ?? []) as TbLegRecord[];
      if (legs.length === 0) continue;
      const payoutKey = `imto:${t.id}:payout`;
      const postedLegs: TbLegRecord[] = [];
      for (const leg of legs) {
        postedLegs.push(await confirmLeg(payoutKey, leg));
      }
      await tx.execute(sql`
        UPDATE bdc_transactions
        SET tb_transfer_ids = ${JSON.stringify(postedLegs)}::jsonb, updated_at = NOW()
        WHERE id = ${t.id}
      `);
      const postMirrorLegs: TbLegRecord[] = postedLegs
        .filter((l) => l.postTransferId)
        .map((l) => ({ ...l, leg: `${l.leg}-post`, transferId: l.postTransferId! }));
      if (postMirrorLegs.length > 0) {
        await mirrorLegsToPg(tx, postMirrorLegs, {
          reference: payoutKey,
          type: "bdc_imto_payout_settle",
          tenantId: t.tenantId,
          bdcTransactionId: t.id,
        });
      }
    }

    return {
      settlementUpdated: settled.length === 1,
      txnUpdated: txns.length >= 1,
      reason: settled.length === 0 ? "already_terminal" : undefined,
    };
  });
}

/**
 * Compensate an IMTO payout whose Mojaloop leg ABORTED (webhook error
 * callback path). Honest terminal states (F10): settlement 'accrued' →
 * 'disputed', linked txn 'pending'/'posted' → 'failed' with the switch's
 * reason, and the initiation TB legs are reversed (void PENDING payout leg,
 * reverse POSTED commission leg) so IMTO_SETTLEMENT / COMMISSION_INCOME do
 * not stay inflated. The TB reversal is fail-soft: the money never moved at
 * the switch, the PG rows are the honest record, and a TB outage is logged
 * loudly for recon instead of blocking the webhook ack.
 *
 * Guarded single-winner flips only — safe to call repeatedly.
 */
export async function abortImtoSettlement(
  db: Db,
  mojaloopTransferId: string,
  reason: string,
): Promise<{ settlementUpdated: boolean; txnUpdated: boolean; reason?: string }> {
  const disputed = (await db.execute(sql`
    UPDATE bdc_imto_settlements
    SET status = 'disputed', updated_at = NOW()
    WHERE mojaloop_transfer_id = ${mojaloopTransferId} AND status = 'accrued'
    RETURNING id, tenant_id AS "tenantId"
  `)) as unknown as Array<{ id: number; tenantId: number }>;

  if (disputed.length === 0) {
    const existing = (await db.execute(sql`
      SELECT status FROM bdc_imto_settlements WHERE mojaloop_transfer_id = ${mojaloopTransferId} LIMIT 1
    `)) as unknown as Array<{ status: string }>;
    if (existing.length === 0) return { settlementUpdated: false, txnUpdated: false, reason: "no_settlement_row" };
    // Already terminal — still try to fail the txn (crash-safe).
  }

  const tenantId = disputed[0]?.tenantId;
  const detail = `Mojaloop transfer aborted by switch: ${reason}`.slice(0, 1000);
  const txns = (await db.execute(sql`
    UPDATE bdc_transactions
    SET status = 'failed', failure_reason = ${detail}, updated_at = NOW()
    WHERE payment_leg->>'mojaloopTransferId' = ${mojaloopTransferId}
      AND status IN ('pending', 'posted')
      ${tenantId ? sql`AND tenant_id = ${tenantId}` : sql``}
    RETURNING id, tenant_id AS "tenantId", tb_transfer_ids AS "tbTransferIds"
  `)) as unknown as Array<{ id: number; tenantId: number; tbTransferIds: unknown }>;

  for (const t of txns) {
    const legs = (t.tbTransferIds ?? []) as TbLegRecord[];
    if (legs.length === 0) continue;
    try {
      const reversed = await reversePost(`imto:${t.id}:payout`, legs);
      await db.execute(sql`
        UPDATE bdc_transactions
        SET tb_transfer_ids = ${JSON.stringify(reversed)}::jsonb, updated_at = NOW()
        WHERE id = ${t.id}
      `);
      const reversalEntries = reversed.filter((l) => l.phase === "reversal");
      if (reversalEntries.length > 0) {
        await mirrorLegsToPg(db as unknown as Parameters<typeof mirrorLegsToPg>[0], reversalEntries, {
          reference: `imto:${t.id}:payout`,
          type: "bdc_imto_payout_reversal",
          tenantId: t.tenantId,
          bdcTransactionId: t.id,
        });
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), bdcTxnId: t.id, mojaloopTransferId },
        "[BDC IMTO] TB reversal of aborted payout FAILED — legs uncompensated; reconcile via reversePost replay",
      );
    }
  }

  return {
    settlementUpdated: disputed.length === 1,
    txnUpdated: txns.length >= 1,
    reason: disputed.length === 0 ? "already_terminal" : undefined,
  };
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const bdcImtoRouter = router({

  /**
   * payoutQuote — validate the recipient reference against the Mojaloop
   * network (parties lookup; FAIL CLOSED UNAVAILABLE on outage/circuit open),
   * resolve the tenant's published buy rate and the IMTO commission tier,
   * and return an ephemeral signed quote for executePayout.
   *
   * INPUT DEVIATION (documented): SPEC §3.10 lists { imtoCode, reference }.
   * A commission tier (tierMinUsd ≤ amount ≤ tierMaxUsd) and a naira amount
   * cannot be computed without the FX amount, so fxAmount + currency are
   * required inputs.
   */
  payoutQuote: auditedProcedure
    .input(z.object({
      imtoCode: z.string().min(1).max(32),
      reference: z.string().min(4).max(64), // recipient party identifier (MSISDN)
      fxAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, "fxAmount must be a positive decimal (≤2dp)"),
      currency: z.string().length(3).default("USD"),
    }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      const db = await requireDb();
      await getBdcProfile(db, tenantId);

      const fxCents = toCents(input.fxAmount);
      if (fxCents <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "fxAmount must be greater than zero" });
      }

      // 1. Validate the reference via Mojaloop parties lookup (FSPIOP v1.1).
      const party = await lookupParty("MSISDN", input.reference);
      if (party.error) {
        // Outage / circuit open / network failure → FAIL CLOSED (§0.3).
        throw new TRPCError({
          code: "UNAVAILABLE",
          message: `Mojaloop party lookup unavailable — IMTO payout quote denied (fail-closed): ${party.error}`,
        });
      }
      if (!party.found) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Payout reference not found on the Mojaloop network" });
      }
      const payeeFspId = party.fspId;
      if (!payeeFspId || payeeFspId === "pending-callback") {
        // Async (202) lookup — the FSP is not resolved synchronously; never
        // price a payout against an unresolved destination.
        throw new TRPCError({
          code: "UNAVAILABLE",
          message: "Mojaloop party lookup is asynchronous for this reference (FSP unresolved) — retry the quote",
        });
      }

      // 2. Latest published buy rate for the currency (BDC buys the FX).
      const [rateRow] = await db
        .select({ rate: bdcRateQuotes.rate, publishedAt: bdcRateQuotes.publishedAt, expiresAt: bdcRateQuotes.expiresAt })
        .from(bdcRateQuotes)
        .where(and(
          eq(bdcRateQuotes.tenantId, tenantId),
          eq(bdcRateQuotes.currency, input.currency),
          eq(bdcRateQuotes.side, "buy"),
          eq(bdcRateQuotes.status, "published"),
        ))
        .orderBy(desc(bdcRateQuotes.publishedAt))
        .limit(1);
      if (!rateRow || (rateRow.expiresAt && new Date(rateRow.expiresAt).getTime() <= Date.now())) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `No live published buy rate for ${input.currency} — publish a rate quote before IMTO payouts`,
        });
      }

      // 3. Commission schedule tier match: tierMinUsd ≤ amount ≤ tierMaxUsd.
      const [tier] = await db
        .select({ commissionBps: bdcCommissionSchedules.commissionBps })
        .from(bdcCommissionSchedules)
        .where(and(
          eq(bdcCommissionSchedules.tenantId, tenantId),
          eq(bdcCommissionSchedules.imtoCode, input.imtoCode),
          eq(bdcCommissionSchedules.active, true),
          lte(bdcCommissionSchedules.tierMinUsd, input.fxAmount),
          gte(bdcCommissionSchedules.tierMaxUsd, input.fxAmount),
        ))
        .limit(1);
      if (!tier) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `No active commission tier for IMTO ${input.imtoCode} covering ${input.fxAmount} ${input.currency}`,
        });
      }

      const nairaAmount = multiplyMajor(input.fxAmount, rateRow.rate);
      const commission = bpsOf(nairaAmount, tier.commissionBps);
      const payoutAmount = centsToMajor(toCents(nairaAmount) - toCents(commission));

      const payload: ImtoQuotePayload = {
        v: 1,
        tenantId,
        imtoCode: input.imtoCode,
        reference: input.reference,
        currency: input.currency,
        fxAmount: input.fxAmount,
        rate: rateRow.rate,
        nairaAmount,
        commission,
        payoutAmount,
        payeeFspId,
        quoteId: `BDCQ-${tenantId}-${Date.now().toString(36)}-${Math.floor(fxCents % 100000)}`,
        expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      };

      return {
        quoteId: payload.quoteId,
        expiresAt: payload.expiresAt,
        nairaAmount,
        commission,
        payoutAmount,
        rate: payload.rate,
        payeeFspId,
        quote: { payload, signature: signQuotePayload(payload) },
      };
    }),

  /**
   * executePayout — TOTP step-up + KYC tier gate + idempotency claim BEFORE
   * money movement; one db.transaction for the PG rows + TB posting; Mojaloop
   * transfer leg initiated afterwards with HONEST status handling:
   *   COMMITTED            → confirmImtoSettlement → 'settled'
   *   RESERVED / RECEIVED  → stays 'pending' until the webhook confirms
   *   ABORTED (switch)     → txn 'failed' + settlement 'disputed'
   *   UNCERTAIN            → stays 'pending', annotated for reconciliation
   */
  executePayout: auditedProcedure
    .input(z.object({
      quote: z.object({ payload: z.unknown(), signature: z.string().min(16) }),
      totpCode: z.string().length(6).optional(),
      branchId: z.number().int().positive(),
      customerId: z.number().int().positive().optional(),
      paymentLeg: z.object({
        method: z.enum(["cash", "nip_transfer", "prepaid_card", "domiciliary"]),
        reference: z.string().max(96).nullable().default(null),
      }),
      /** Notes handed out — REQUIRED when paymentLeg.method = 'cash'; the
       *  denomination × count total must equal the payout amount. */
      denominations: z.array(z.object({
        denomination: z.string().regex(/^\d+(\.\d{1,2})?$/),
        noteCount: z.number().int().positive(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      const db = await requireDb();
      const quote = verifyQuote(input.quote, tenantId);

      await requireTotpStepUp(ctx.user.id, input.totpCode, "IMTO payout execution");
      await requireKycTierForAmount(ctx.user.id, Number(quote.nairaAmount), "IMTO payout");

      // Tenant-scoped claim: a recipient reference (MSISDN) is NOT unique
      // across tenants — without the prefix one tenant's payout would burn /
      // replay another tenant's idempotency record.
      const idempotencyKey = `BDC-IMTO-${tenantId}-${quote.reference}`;
      const claim = await claimIdempotency(idempotencyKey);
      if (claim.cached) return claim.result as Record<string, unknown>;

      try {
      await getBdcProfile(db, tenantId);
      await assertBranchActive(db, tenantId, input.branchId);

      if (input.paymentLeg.method === "cash") {
        if (!input.denominations || input.denominations.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "denominations required for a cash payout" });
        }
        const totalCents = input.denominations.reduce(
          (sum, d) => sum + toCents(d.denomination) * d.noteCount, 0,
        );
        if (totalCents !== toCents(quote.payoutAmount)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Denomination total (${centsToMajor(totalCents)}) does not equal the payout amount (${quote.payoutAmount})`,
          });
        }
      }

      const cashPortion = input.paymentLeg.method === "cash" ? quote.payoutAmount : "0.00";

      // TB chart must exist before the posting (idempotent; outside the tx —
      // account provisioning is not money movement).
      await ensureBdcAccounts(tenantId);

      const { txnId, settlementId, tbTransferIds } = await db.transaction(async (tx) => {
        // Cash leg: version-guarded drawer denomination decrements (each
        // guarded UPDATE must affect exactly 1 row or the whole tx rolls back).
        if (input.paymentLeg.method === "cash") {
          const [drawer] = await tx
            .select({ id: bdcTellerDrawers.id })
            .from(bdcTellerDrawers)
            .where(and(
              eq(bdcTellerDrawers.tenantId, tenantId),
              eq(bdcTellerDrawers.branchId, input.branchId),
              eq(bdcTellerDrawers.holderUserId, ctx.user.id),
              eq(bdcTellerDrawers.status, "active"),
            ))
            .limit(1);
          if (!drawer) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "No active teller drawer for this user at the branch — cash payout denied",
            });
          }
          for (const d of input.denominations!) {
            const decremented = await tx
              .update(bdcDenominationInventory)
              .set({
                noteCount: sql`${bdcDenominationInventory.noteCount} - ${d.noteCount}`,
                version: sql`${bdcDenominationInventory.version} + 1`,
                updatedAt: new Date(),
              })
              .where(and(
                eq(bdcDenominationInventory.tenantId, tenantId),
                eq(bdcDenominationInventory.locationType, "drawer"),
                eq(bdcDenominationInventory.locationId, drawer.id),
                eq(bdcDenominationInventory.currency, "NGN"),
                eq(bdcDenominationInventory.denomination, d.denomination),
                gte(bdcDenominationInventory.noteCount, d.noteCount),
              ))
              .returning({ id: bdcDenominationInventory.id });
            if (decremented.length !== 1) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: `Insufficient drawer stock of NGN ${d.denomination} notes — cash payout denied`,
              });
            }
          }
        }

        const [txn] = await tx.insert(bdcTransactions).values({
          tenantId,
          branchId: input.branchId,
          txnType: "imto_payout",
          currency: quote.currency,
          fxAmount: quote.fxAmount,
          nairaAmount: quote.nairaAmount,
          rate: quote.rate,
          purposeCode: null,
          customerId: input.customerId ?? null,
          paymentLeg: {
            method: input.paymentLeg.method,
            reference: input.paymentLeg.reference,
            imtoCode: quote.imtoCode,
            quoteId: quote.quoteId,
            mojaloopTransferId: null as string | null,
          },
          cashPortion,
          idempotencyKey,
          tbTransferIds: [],
          status: "pending",
          makerId: ctx.user.id,
        }).returning({ id: bdcTransactions.id });

        const [settlement] = await tx.insert(bdcImtoSettlements).values({
          tenantId,
          imtoCode: quote.imtoCode,
          mojaloopTransferId: null,
          fxAmount: quote.fxAmount,
          nairaPaid: quote.payoutAmount,
          commission: quote.commission,
          status: "accrued",
        }).returning({ id: bdcImtoSettlements.id });

        // TB posting: DR IMTO_SETTLEMENT / CR NGN_CASH (PENDING until the
        // switch confirms) + DR IMTO_SETTLEMENT / CR COMMISSION_INCOME
        // (posted). Real _ledger signature: BigInt minor units; deterministic
        // posting key `imto:{txnId}:payout` (F1) — replay-safe. TB outage
        // throws UNAVAILABLE inside _ledger → tx rolls back (§0.3).
        const payoutKey = `imto:${txn.id}:payout`;
        const legs = await postImtoPayout({
          tenantId,
          idempotencyKey: payoutKey,
          nairaMinor: BigInt(toCents(quote.nairaAmount)),
          commissionMinor: BigInt(toCents(quote.commission)),
        });

        await tx.update(bdcTransactions)
          .set({ tbTransferIds: legs as unknown as Record<string, unknown>[], updatedAt: new Date() })
          .where(eq(bdcTransactions.id, txn.id));

        // PG mirror (ledger_entries) in the SAME transaction.
        await mirrorLegsToPg(tx, legs, {
          reference: payoutKey,
          type: "bdc_imto_payout",
          tenantId,
          bdcTransactionId: txn.id,
        });

        return { txnId: txn.id, settlementId: settlement.id, tbTransferIds: legs };
      });

      // ── Mojaloop settlement leg (post-commit; honest state machine) ──────
      const ilp = buildIlpPacket({
        amount: quote.nairaAmount,
        currency: "NGN",
        destinationFspId: quote.payeeFspId,
        destinationAccount: quote.reference,
        expirySeconds: 300,
        data: { bdcTxnId: txnId, imtoCode: quote.imtoCode, idempotencyKey },
      });
      const transfer = await initiateTransfer({
        payerFspId: MOJALOOP_FSP_ID,
        payeeFspId: quote.payeeFspId,
        amount: quote.nairaAmount,
        currency: "NGN",
        ilpPacket: ilp.ilpPacket,
        condition: ilp.condition,
        expirationSeconds: 300,
      });

      let finalStatus: string = "pending";
      if (transfer.transferState === "COMMITTED") {
        await recordMojaloopTransferId(db, tenantId, txnId, settlementId, transfer.transferId);
        const confirmed = await confirmImtoSettlement(db, transfer.transferId);
        finalStatus = confirmed.settlementUpdated || confirmed.txnUpdated ? "settled" : "pending";
      } else if (transfer.transferState === "ABORTED") {
        // Definitive switch-provided abort — mark honestly AND compensate the
        // initiation TB legs (void the PENDING payout leg, reverse the POSTED
        // commission leg) so IMTO_SETTLEMENT does not stay inflated. The txn
        // is already committed, so reversal is fail-soft: a TB outage is
        // logged loudly and surfaces in recon, never masked.
        await recordMojaloopTransferId(db, tenantId, txnId, settlementId, transfer.transferId);
        const abortReason = `Mojaloop transfer aborted by switch: ${transfer.errorInformation?.errorDescription ?? "no detail"}`;
        await db.execute(sql`
          UPDATE bdc_transactions
          SET status = 'failed', failure_reason = ${abortReason}, updated_at = NOW()
          WHERE id = ${txnId} AND tenant_id = ${tenantId} AND status = 'pending'
        `);
        await db.execute(sql`
          UPDATE bdc_imto_settlements
          SET status = 'disputed', updated_at = NOW()
          WHERE id = ${settlementId} AND tenant_id = ${tenantId} AND status = 'accrued'
        `);
        try {
          const [abortTxn] = await db
            .select()
            .from(bdcTransactions)
            .where(and(eq(bdcTransactions.id, txnId), eq(bdcTransactions.tenantId, tenantId)))
            .limit(1);
          const legs = (abortTxn?.tbTransferIds ?? []) as unknown as TbLegRecord[];
          if (abortTxn && legs.length > 0) {
            const reversed = await reversePost(`imto:${txnId}:payout`, legs);
            await db
              .update(bdcTransactions)
              .set({ tbTransferIds: reversed as unknown as Record<string, unknown>[], updatedAt: new Date() })
              .where(eq(bdcTransactions.id, txnId));
          }
        } catch (revErr) {
          logger.error(
            { err: revErr instanceof Error ? revErr.message : String(revErr), txnId, tenantId },
            "[BDC IMTO] TB reversal of aborted payout FAILED — legs uncompensated; reconcile via reversePost replay",
          );
        }
        finalStatus = "failed";
      } else {
        // RESERVED / RECEIVED / UNCERTAIN → stay 'pending'; webhook (or a
        // later getTransferStatus reconciliation) confirms. UNCERTAIN means
        // the switch MAY have committed — never auto-fail it.
        await recordMojaloopTransferId(db, tenantId, txnId, settlementId, transfer.transferId);
        if (transfer.transferState === "UNCERTAIN") {
          await db.execute(sql`
            UPDATE bdc_transactions
            SET failure_reason = ${`Mojaloop outcome uncertain — reconcile via GET /transfers/${transfer.transferId} before any refund/void`}, updated_at = NOW()
            WHERE id = ${txnId} AND tenant_id = ${tenantId} AND status = 'pending'
          `);
        }
        finalStatus = "pending";
      }

      const result = {
        txnId,
        settlementId,
        tbTransferIds,
        mojaloopTransferId: transfer.transferId,
        transferState: transfer.transferState,
        status: finalStatus,
        nairaAmount: quote.nairaAmount,
        commission: quote.commission,
        payoutAmount: quote.payoutAmount,
        idempotencyKey,
      };
      storeIdempotency(idempotencyKey, result);
      return result;
      } catch (err) {
        // Failed attempt must not burn the idempotency claim for its TTL —
        // release the pending marker so an honest retry can re-execute.
        await releaseIdempotencyClaim(idempotencyKey);
        throw err;
      }
    }),

  /**
   * settlementStatement (finance) — deterministic statementRef for a period;
   * guarded flips: 'accrued'→'settled' ONLY for rows whose Mojaloop leg is
   * confirmed (linked bdc_transactions settled), and statementRef attachment
   * for already-settled rows. Rows without a confirmed leg stay 'accrued'
   * and surface in reconcileSettlements.
   */
  settlementStatement: auditedAdminProcedure
    .input(z.object({
      imtoCode: z.string().min(1).max(32),
      period: z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM"),
    }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      const db = await requireDb();
      await getBdcProfile(db, tenantId);
      const { start, end } = periodWindow(input.period);
      const statementRef = `BDC-IMTO-STMT-${tenantId}-${input.imtoCode}-${input.period}`;

      // Guarded flip: accrued → settled, only with a confirmed transfer leg.
      const flipped = (await db.execute(sql`
        UPDATE bdc_imto_settlements s
        SET status = 'settled', statement_ref = ${statementRef},
            settled_at = COALESCE(s.settled_at, NOW()), updated_at = NOW()
        FROM bdc_transactions t
        WHERE s.tenant_id = ${tenantId} AND s.imto_code = ${input.imtoCode}
          AND s.status = 'accrued'
          AND s.created_at >= ${start} AND s.created_at < ${end}
          AND s.mojaloop_transfer_id IS NOT NULL
          AND t.tenant_id = s.tenant_id
          AND t.payment_leg->>'mojaloopTransferId' = s.mojaloop_transfer_id
          AND t.status = 'settled'
        RETURNING s.id
      `)) as unknown as Array<{ id: number }>;

      // Attach the statement ref to rows already settled in this period.
      await db.execute(sql`
        UPDATE bdc_imto_settlements
        SET statement_ref = ${statementRef}, updated_at = NOW()
        WHERE tenant_id = ${tenantId} AND imto_code = ${input.imtoCode}
          AND status = 'settled' AND statement_ref IS NULL
          AND created_at >= ${start} AND created_at < ${end}
      `);

      const rows = (await db.execute(sql`
        SELECT id, mojaloop_transfer_id AS "mojaloopTransferId", fx_amount AS "fxAmount",
               naira_paid AS "nairaPaid", commission, status, statement_ref AS "statementRef",
               settled_at AS "settledAt", created_at AS "createdAt"
        FROM bdc_imto_settlements
        WHERE tenant_id = ${tenantId} AND imto_code = ${input.imtoCode}
          AND created_at >= ${start} AND created_at < ${end}
        ORDER BY id
      `)) as unknown as Array<Record<string, unknown>>;

      const totals = rows.reduce(
        (acc, r) => ({
          fxAmount: acc.fxAmount + Number(r.fxAmount),
          nairaPaid: acc.nairaPaid + Number(r.nairaPaid),
          commission: acc.commission + Number(r.commission),
        }),
        { fxAmount: 0, nairaPaid: 0, commission: 0 },
      );

      logger.info({ tenantId, imtoCode: input.imtoCode, period: input.period, statementRef, markedSettled: flipped.length }, "[BDC] IMTO settlement statement generated");
      return {
        statementRef,
        period: input.period,
        window: { start, end },
        markedSettled: flipped.length,
        rowCount: rows.length,
        totals: {
          fxAmount: totals.fxAmount.toFixed(2),
          nairaPaid: totals.nairaPaid.toFixed(2),
          commission: totals.commission.toFixed(2),
        },
        rows,
      };
    }),

  /**
   * reconcileSettlements (finance) — READ-ONLY variance list: settlements
   * still 'accrued' at period end (unsettled vs the IMTO statement) with the
   * threshold comparison used by the daily recon workflow. No mutations.
   */
  reconcileSettlements: auditedAdminProcedure
    .input(z.object({
      imtoCode: z.string().min(1).max(32),
      period: z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM"),
    }))
    .query(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      const db = await requireDb();
      await getBdcProfile(db, tenantId);
      const { start, end } = periodWindow(input.period);

      const unsettled = (await db.execute(sql`
        SELECT id, mojaloop_transfer_id AS "mojaloopTransferId", fx_amount AS "fxAmount",
               naira_paid AS "nairaPaid", commission, created_at AS "createdAt"
        FROM bdc_imto_settlements
        WHERE tenant_id = ${tenantId} AND imto_code = ${input.imtoCode} AND status = 'accrued'
          AND created_at >= ${start} AND created_at < ${end}
        ORDER BY id
      `)) as unknown as Array<Record<string, unknown>>;

      const settledAgg = (await db.execute(sql`
        SELECT COUNT(*)::int AS "count", COALESCE(SUM(naira_paid), 0)::text AS "naira",
               COALESCE(SUM(commission), 0)::text AS "commission"
        FROM bdc_imto_settlements
        WHERE tenant_id = ${tenantId} AND imto_code = ${input.imtoCode} AND status = 'settled'
          AND created_at >= ${start} AND created_at < ${end}
      `)) as unknown as Array<{ count: number; naira: string; commission: string }>;

      const varianceNgn = unsettled.reduce((sum, r) => sum + Number(r.nairaPaid), 0);
      return {
        imtoCode: input.imtoCode,
        period: input.period,
        window: { start, end },
        unsettledCount: unsettled.length,
        unsettled,
        settledCount: settledAgg[0]?.count ?? 0,
        settledNaira: settledAgg[0]?.naira ?? "0",
        settledCommission: settledAgg[0]?.commission ?? "0",
        varianceNgn,
        thresholdNgn: IMTO_RECON_VARIANCE_THRESHOLD_NGN,
        exceedsThreshold: Math.abs(varianceNgn) > IMTO_RECON_VARIANCE_THRESHOLD_NGN,
        readOnly: true as const,
      };
    }),
});

/** Record the Mojaloop transfer id on the settlement + txn (guarded: only
 *  while the txn is still pending — a later duplicate call cannot clobber a
 *  terminal state). */
async function recordMojaloopTransferId(
  db: Db,
  tenantId: number,
  txnId: number,
  settlementId: number,
  transferId: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE bdc_imto_settlements
    SET mojaloop_transfer_id = ${transferId}, updated_at = NOW()
    WHERE id = ${settlementId} AND tenant_id = ${tenantId} AND mojaloop_transfer_id IS NULL
  `);
  await db.execute(sql`
    UPDATE bdc_transactions
    SET payment_leg = jsonb_set(payment_leg, '{mojaloopTransferId}', to_jsonb(${transferId}::text), true),
        updated_at = NOW()
    WHERE id = ${txnId} AND tenant_id = ${tenantId} AND status = 'pending'
  `);
}
