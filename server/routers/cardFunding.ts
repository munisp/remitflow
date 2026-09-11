/**
 * RemitFlow — Card Funding Router (W10 / SPEC-wave10 C2)
 * ──────────────────────────────────────────────────────
 * Card-funded payments for a declared purpose (vendor_bill | invoice | transfer):
 *   - createIntent: Stripe PaymentIntent for amount + card fee (manual capture),
 *     persisted to `card_funding_intents` with the HONEST Stripe-reported status;
 *   - confirmIntent (PRIMARY PATH): authed mutation that polls the Stripe
 *     PaymentIntent and advances the local row — nothing depends on edits to
 *     stripeWebhook.ts (NOT our file);
 *   - processFundingWebhook(event): exported handler the orchestrator wires
 *     into stripeWebhook.ts for `payment_intent.succeeded` / `payment_failed`;
 *   - execute: TOTP step-up + chargeback-hold enforcement for irreversible
 *     rails, then dispatches to the registered purpose executor
 *     (`registerPurposeExecutor` — invoicesV2Router registers "invoice"; C1's
 *     vendor-bill engine can register "vendor_bill"; "transfer" is honestly
 *     UNAVAILABLE until a real rail is wired);
 *   - failure → verified-pre-refund (executor side effect must verifiably be
 *     'not_landed') → Stripe refund via the shared single-winner claim helper
 *     refundCapturedFundingIntent (W12): guarded DB claim executing →
 *     'refunding' → Stripe → 'refunded' | 'refund_failed' (sweeper-retryable);
 *     never silent, never a refund without the claim. A landed
 *     or unverifiable side effect PARKS the intent in executing with a
 *     funding.execution_uncertain recon event — never auto-refund a
 *     settled-or-uncertain payment (H2 round 2; mirrors the embeddedPayouts
 *     C2/H3 park pattern). Parked intents are resolved by
 *     payoutSettlementSweeper via describeIntentExecutionState().
 *
 * Fail closed: STRIPE_SECRET_KEY unset → getStripe() throws → UNAVAILABLE.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { router, protectedProcedure } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { cardFundingIntents } from "../../drizzle/schema.js";
import { getStripe } from "../stripe.js";
import { publishEvent } from "../middleware/kafka.js";
import { logger } from "../_core/logger.js";
import { resolveTenantContext } from "../tenantMiddleware.js";

const FUNDING_TOPIC = "remitflow.card-funding";

// ─── Config (env-tunable, validated) ─────────────────────────────────────────
export const CARD_FEE_PCT = (() => {
  const raw = Number(process.env.CARD_FEE_PCT ?? "0.029");
  return Number.isFinite(raw) && raw >= 0 && raw < 0.25 ? raw : 0.029;
})();

export const CHARGEBACK_HOLD_HOURS = (() => {
  const raw = Number(process.env.CHARGEBACK_HOLD_HOURS ?? "24");
  return Number.isFinite(raw) && raw >= 0 && raw <= 24 * 30 ? raw : 24;
})();

// ─── Types & purpose-executor registry ───────────────────────────────────────
export type FundingPurpose = "vendor_bill" | "invoice" | "transfer";

export interface FundingIntentHandle {
  id: number;
  tenantId: number;
  userId: number;
  stripePaymentIntentId: string;
  purpose: string;
  purposeEntityId: string;
  amount: string;
  currency: string;
  feeAmount: string;
}

export interface FundingExecutionResult {
  /**
   * false → the purpose payment is NOT done yet (e.g. the vendor_bill queue
   * case): the intent STAYS `executing` (SPEC vocab) with the queue
   * instruction recorded on the vendor_bills row metadata. The non-vocab
   * status `pending_execution` was eliminated (H2) — it is NEVER written.
   */
  executed: boolean;
  detail?: Record<string, unknown>;
}

export interface PurposeExecutor {
  /**
   * true → the purpose payment is IRREVERSIBLE (e.g. stablecoin payout): the
   * chargeback hold (holdUntil) is enforced before execute. false → the
   * purpose payment is wallet-internal/reversible: hold skipped per SPEC C2.
   */
  irreversible: boolean;
  execute(intent: FundingIntentHandle): Promise<FundingExecutionResult>;
}

const purposeExecutors = new Map<FundingPurpose, PurposeExecutor>();

export function registerPurposeExecutor(purpose: FundingPurpose, executor: PurposeExecutor): void {
  if (purposeExecutors.has(purpose)) {
    logger.warn(`[CardFunding] executor for purpose '${purpose}' is being overridden`);
  }
  purposeExecutors.set(purpose, executor);
}

// ─── Shared helpers ───────────────────────────────────────────────────────────
async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

async function resolveFundingTenantId(userId: number): Promise<number> {
  const session = await resolveTenantContext(userId);
  if (session.tenantId == null) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No tenant membership — card funding unavailable" });
  }
  return session.tenantId;
}

function stripeOrUnavailable(): Stripe {
  try {
    return getStripe();
  } catch {
    throw new TRPCError({
      code: "UNAVAILABLE",
      message: "Card funding unavailable — Stripe is not configured (STRIPE_SECRET_KEY unset)",
    });
  }
}

function toDec4(n: number): number {
  if (!Number.isFinite(n)) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid monetary amount" });
  return Math.round(n * 10_000) / 10_000;
}

// ─── SPEC status vocab ────────────────────────────────────────────────────────
// cardFundingIntents.status vocab (SPEC-wave10):
//   requires_capture → captured → executing → executed | failed | refunded
// W12 transitional refund-claim states (refundCapturedFundingIntent):
//   executing → refunding → refunded | refund_failed (→ refunding → …)
// 'refunding'/'refund_failed' are claim markers, not business states: a row in
// 'refunding' is owned by an in-flight (or crashed — reclaimed after 15min)
// refund claimant; 'refund_failed' is retryable by the sweeper. Both ride on
// the varchar(24) status column — no schema change.
// Raw Stripe PaymentIntent statuses (requires_payment_method,
// requires_confirmation, requires_action, processing, requires_capture,
// succeeded, canceled) are NEVER written to the status column — they are
// mapped onto the SPEC vocab on write (M3 vocab drift). The raw Stripe status
// is preserved as `stripeStatus` on the emitted Kafka funding event and in
// logs (card_funding_intents has no metadata column and schema changes are
// out of scope — the funding event topic is the durable audit trail).
function mapStripeStatus(stripeStatus: string): "requires_capture" | "captured" | "failed" {
  switch (stripeStatus) {
    case "succeeded":
      return "captured";
    case "canceled":
      return "failed";
    case "requires_capture":
    case "requires_payment_method":
    case "requires_confirmation":
    case "requires_action":
    case "processing":
      return "requires_capture";
    default:
      // Unknown/new Stripe status → fail closed: remain pre-capture, never
      // invent a non-vocab status and never claim capture.
      logger.warn(`[CardFunding] unmapped Stripe status '${stripeStatus}' — persisting requires_capture (raw status kept on the funding event)`);
      return "requires_capture";
  }
}

/** Zero-decimal currencies charge in whole units; everything else in cents. */
const ZERO_DECIMAL_CURRENCIES = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);

function toMinorUnits(amount: number, currency: string): number {
  const mult = ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
  return Math.round(amount * mult);
}

async function emitFundingEvent(
  eventType: string,
  intent: { id: number | string; tenantId: number; purpose: string; purposeEntityId: string; status: string; amount: string | number; currency: string },
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    await publishEvent(FUNDING_TOPIC, `card-funding:${intent.id}:${eventType}`, {
      eventType,
      intentId: Number(intent.id),
      tenantId: intent.tenantId,
      purpose: intent.purpose,
      purposeEntityId: intent.purposeEntityId,
      status: intent.status,
      amount: String(intent.amount),
      currency: intent.currency,
      timestamp: new Date().toISOString(),
      ...extra,
    });
  } catch (err) {
    logger.warn("[CardFunding] Kafka emit failed (non-critical):", (err as Error)?.message);
  }
}

function computeHoldUntil(): Date {
  return new Date(Date.now() + CHARGEBACK_HOLD_HOURS * 3_600_000);
}

// ─── Core: create the Stripe PaymentIntent + local row ───────────────────────
export async function createCardFundingIntent(opts: {
  tenantId: number;
  userId: number;
  purpose: FundingPurpose;
  purposeEntityId: string;
  amount: number; // purpose amount (excludes card fee)
  currency: string;
  feeAmount?: number; // defaults to amount * CARD_FEE_PCT
}): Promise<{
  intentId: number;
  stripePaymentIntentId: string;
  clientSecret: string | null;
  status: string;
  stripeStatus: string;
  amount: number;
  feeAmount: number;
  totalCharge: number;
  currency: string;
}> {
  const amount = toDec4(opts.amount);
  if (!(amount > 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "Amount must be positive" });
  const feeAmount = toDec4(opts.feeAmount ?? amount * CARD_FEE_PCT);
  if (feeAmount < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Fee cannot be negative" });
  const totalCharge = toDec4(amount + feeAmount);
  const currency = opts.currency.toUpperCase();
  const stripe = stripeOrUnavailable();

  const pi = await stripe.paymentIntents.create({
    amount: toMinorUnits(totalCharge, currency),
    currency: currency.toLowerCase(),
    capture_method: "manual",
    automatic_payment_methods: { enabled: true },
    metadata: {
      tenantId: String(opts.tenantId),
      purpose: opts.purpose,
      purposeEntityId: opts.purposeEntityId,
    },
  });

  const db = await requireDb();
  // HONEST but vocab-mapped: the raw Stripe status (typically
  // requires_payment_method at creation) maps onto the SPEC vocab; the raw
  // value is preserved as stripeStatus on the emitted funding event (M3).
  const mappedStatus = mapStripeStatus(pi.status);
  const [row] = await db
    .insert(cardFundingIntents)
    .values({
      tenantId: opts.tenantId,
      userId: opts.userId,
      stripePaymentIntentId: pi.id,
      purpose: opts.purpose,
      purposeEntityId: opts.purposeEntityId,
      amount: amount.toFixed(4),
      currency,
      feeAmount: feeAmount.toFixed(4),
      status: mappedStatus,
    })
    .returning();
  await emitFundingEvent("funding.intent_created", row, { stripeStatus: pi.status });
  return {
    intentId: row.id,
    stripePaymentIntentId: pi.id,
    clientSecret: pi.client_secret,
    status: mappedStatus,
    stripeStatus: pi.status,
    amount,
    feeAmount,
    totalCharge,
    currency,
  };
}

// ─── Webhook handler (orchestrator wires this into stripeWebhook.ts) ─────────
/**
 * Handles Stripe events for card funding. Wire from stripeWebhook.ts as:
 *   import { processFundingWebhook } from "./routers/cardFunding";
 *   await processFundingWebhook(event); // for payment_intent.* events
 * Idempotent; guarded status transitions; fail closed on unknown rows.
 */
export async function processFundingWebhook(event: Stripe.Event): Promise<{ handled: boolean }> {
  const pi = event.data.object as Stripe.PaymentIntent;
  if (!pi || typeof pi.id !== "string") return { handled: false };
  const db = await requireDb();

  if (event.type === "payment_intent.succeeded") {
    // Captured: card funds are in. Start the chargeback hold.
    // H2: guarded from-state set — only PRE-capture states may transition
    // (requires_capture plus any legacy raw Stripe status still on disk from
    // before vocab mapping). A row in executing/executed/captured/failed/
    // refunded is NEVER resurrected by a late/duplicate Stripe event.
    const rows = (await db.execute(sql`
      UPDATE card_funding_intents
      SET status = 'captured', hold_until = ${computeHoldUntil()}, updated_at = NOW()
      WHERE stripe_payment_intent_id = ${pi.id}
        AND status NOT IN ('captured','executing','executed','failed','refunded')
      RETURNING id, tenant_id AS "tenantId", purpose, purpose_entity_id AS "purposeEntityId", amount, currency
    `)) as unknown as Array<{ id: number; tenantId: number; purpose: string; purposeEntityId: string; amount: string; currency: string }>;
    if (rows.length > 0) {
      await emitFundingEvent("funding.captured", { ...rows[0], status: "captured" }, { stripeStatus: pi.status });
    } else {
      // Already claimed/terminal or unknown intent — log honestly, never throw at Stripe.
      logger.info(`[CardFunding] payment_intent.succeeded for ${pi.id}: no transitionable row (idempotent, executing, or unknown)`);
    }
    return { handled: true };
  }

  if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
    // H2: same from-state discipline — a failure/cancel event may only fail a
    // PRE-capture row; it must never flip captured/executing/executed back.
    const rows = (await db.execute(sql`
      UPDATE card_funding_intents
      SET status = 'failed', updated_at = NOW()
      WHERE stripe_payment_intent_id = ${pi.id}
        AND status NOT IN ('captured','executing','executed','failed','refunded')
      RETURNING id, tenant_id AS "tenantId", purpose, purpose_entity_id AS "purposeEntityId", amount, currency
    `)) as unknown as Array<{ id: number; tenantId: number; purpose: string; purposeEntityId: string; amount: string; currency: string }>;
    if (rows.length > 0) {
      // Nothing was captured on payment_failed — no refund is owed; say so.
      await emitFundingEvent("funding.failed", { ...rows[0], status: "failed" }, { reason: event.type, refund: "not_required_no_capture", stripeStatus: pi.status });
      logger.warn(`[CardFunding] intent ${rows[0].id} failed via ${event.type} (no capture — no refund required)`);
    }
    return { handled: true };
  }

  return { handled: false };
}

// ─── Default purpose executors ────────────────────────────────────────────────
// vendor_bill: the actual payout is owned by C1's vendor-bills engine. Until
// that engine registers its own executor, we HONESTLY flag the vendor_bill row
// (metadata.cardFundingExecutionRequested) and report executed:false — the
// intent STAYS `executing` (SPEC vocab); we never claim the bill was paid and
// never write the eliminated non-vocab status pending_execution (H2).
// Named so verifyExecutorSideEffect can detect an OVERRIDE: when a custom
// engine replaces a default executor, its side effect is not verifiable here
// and any execution error must be treated as UNCERTAIN (park, never refund).
const defaultVendorBillExecutor: PurposeExecutor = {
  irreversible: false,
  async execute(intent) {
    const db = await requireDb();
    const billId = Number(intent.purposeEntityId);
    const rows = (await db.execute(sql`
      UPDATE vendor_bills
      SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
        cardFundingExecutionRequested: { intentId: intent.id, stripePaymentIntentId: intent.stripePaymentIntentId, requestedAt: new Date().toISOString() },
      })}::jsonb,
          updated_at = NOW()
      WHERE id = ${billId}
        AND tenant_id = ${intent.tenantId}
        AND status NOT IN ('paid','void')
      RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (rows.length === 0) {
      throw new TRPCError({ code: "CONFLICT", message: "Vendor bill not found or already paid/void — cannot queue card-funded payout" });
    }
    return {
      executed: false,
      detail: {
        status: "executing",
        instruction:
          "Vendor-bill payout is queued: the vendor_bills row was flagged (metadata.cardFundingExecutionRequested) " +
          "for the vendor-bills engine (registerPurposeExecutor('vendor_bill', …)) to perform the actual payout. " +
          "The intent remains 'executing' and the bill is NOT marked paid.",
      },
    };
  },
};
registerPurposeExecutor("vendor_bill", defaultVendorBillExecutor);

// transfer: no honest card-funded payout rail exists yet — fail closed.
// VERIFIED pre-effect: the body is a bare throw, nothing commits before it.
const defaultTransferExecutor: PurposeExecutor = {
  irreversible: true,
  async execute() {
    throw new TRPCError({
      code: "UNAVAILABLE",
      message: "Card-funded transfers are not implemented — no honest payout rail is wired for this purpose",
    });
  },
};
registerPurposeExecutor("transfer", defaultTransferExecutor);

// ─── Executor side-effect verification (H2 round 2 — pre-refund gate) ────────
export type IntentExecutionState = "landed" | "not_landed" | "unknown";

/**
 * Did the purpose executor's side effect COMMIT — for THIS intent? The
 * executor runs in its own transaction, so an execute() throw is ambiguous:
 * rolled-back pre-effect, committed-but-later-step-failed, or
 * commit-outcome-uncertain (connection drop during COMMIT). Refund may ONLY
 * fire on 'not_landed'; both 'landed' and 'unknown' must PARK (never
 * auto-refund a settled-or-uncertain payment).
 *
 * ATTRIBUTION CONTRACT (round 4, shared with FIX-A write side + FIX-B
 * sweeper): 'landed' requires proof that THIS intent — not another intent
 * and not another rail (payWallet/payBank/vendorBills.executePayment) — made
 * the payment:
 *   - invoice:   keyed attribution — invoices_v2.metadata.cardFunding
 *                .intents["<intentId>"] exists, or any intents[k]
 *                .stripePaymentIntentId matches, or the legacy top-level
 *                cardFunding.intentId / .stripePaymentIntentId matches
 *                (dual-read; see cardFundingAttributionMatches). The invoice
 *                executor writes that attribution in the SAME tx as the
 *                payment flip, from this build onward. Deployment
 *                assumption: intents parked before this build do not exist
 *                (same release train), so attribution-absent + paid
 *                unambiguously means ANOTHER rail/intent paid → this intent
 *                did not land → not_landed (refund is then the CORRECT
 *                outcome — e.g. duplicate intent B, or a card intent parked
 *                while payWallet settled the invoice).
 *   - vendor_bill: the default executor ONLY queues (metadata flag,
 *                executed:false) — a flag is QUEUED, never landed, and the
 *                flag NEVER corroborates landing (round 5: it proves a queue
 *                request, not which funds paid). landed requires
 *                vendor_bills.status === 'paid' AND payment-evidence
 *                corroboration for THIS intent (paymentRef contains the
 *                Stripe PI id or a boundary-exact CFINT_<id> / CF-<id>
 *                marker — see paymentRefCorroboratesIntent). Paid without
 *                such evidence (VBILL-<id>, wallet, mojaloop) → not_landed →
 *                the intent is refunded, remediating the double-charge;
 *                queued-but-unpaid (flag names this intent) → unknown (park);
 *                bill dead (cancelled/rejected/void/failed) → not_landed.
 */
/**
 * Round-4 keyed attribution matcher (H-R4-1 read side). The invoice executor
 * writes `metadata.cardFunding.intents["<intentId>"] = { stripePaymentIntentId,
 * appliedAt }` in the payment tx (sibling intents coexist); rows written
 * before this fix may carry the legacy top-level
 * `cardFunding.intentId` / `cardFunding.stripePaymentIntentId`.
 * Returns true iff intent X is named by ANY of:
 *   a. cardFunding.intents[String(X.id)] exists (new keyed form), OR
 *   b. legacy cardFunding.intentId == X.id, OR
 *   c. cardFunding.intents[k].stripePaymentIntentId == X.stripePaymentIntentId
 *      for any k, OR legacy cardFunding.stripePaymentIntentId match.
 * Pure + total: never throws; a missing/malformed cardFunding node is simply
 * "no match" (callers decide unknown vs not_landed). The sweeper fallback
 * probe carries an IDENTICAL copy — keep them in lockstep.
 */
function cardFundingAttributionMatches(
  metadata: Record<string, unknown>,
  intentId: number,
  stripePaymentIntentId: string,
): boolean {
  const cf = metadata.cardFunding;
  if (cf === null || typeof cf !== "object") return false;
  const cfObj = cf as Record<string, unknown>;
  // (b) legacy top-level intentId
  if (cfObj.intentId !== undefined && cfObj.intentId !== null && String(cfObj.intentId) === String(intentId)) {
    return true;
  }
  // (c-legacy) legacy top-level stripePaymentIntentId
  if (typeof cfObj.stripePaymentIntentId === "string" && cfObj.stripePaymentIntentId === stripePaymentIntentId) {
    return true;
  }
  // (a) + (c) keyed intents map
  const intents = cfObj.intents;
  if (intents !== null && typeof intents === "object") {
    const map = intents as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(map, String(intentId))) return true;
    for (const key of Object.keys(map)) {
      const entry = map[key];
      if (entry !== null && typeof entry === "object") {
        const pi = (entry as Record<string, unknown>).stripePaymentIntentId;
        if (typeof pi === "string" && pi === stripePaymentIntentId) return true;
      }
    }
  }
  return false;
}

/**
 * Round-5 rail corroboration (H-R4-2 surviving): a PAID vendor bill is
 * 'landed' for intent X ONLY on PAYMENT-EVIDENCE corroboration — the
 * paymentRef itself must name X's card funding:
 *   - paymentRef contains X.stripePaymentIntentId (exact-string containment;
 *     Stripe PI ids are fixed-charset and long, so substring is safe), OR
 *   - a BOUNDARY-EXACT CFINT_<X.id> / CF-<X.id> marker (V1 MEDIUM-1: naive
 *     substring 'CF-12' also matches 'CF-123' — markers must be bounded by a
 *     non-alphanumeric on the left and a non-digit on the right).
 * The metadata queue flag (cardFundingExecutionRequested) NEVER corroborates
 * landing: it only proves the intent QUEUED the bill, never which funds paid
 * it (verified exploit: flag names card intent C, payer wallet-pays via
 * vendorBills.executePayment, bill paid with a Mojaloop ref — flag-match
 * corroboration retained C's capture AND the wallet debit). A paid bill
 * without payment evidence is NOT landed for X ⇒ not_landed ⇒ refund (the
 * documented double-charge remediation). The flag remains meaningful ONLY in
 * the unpaid-bill branch (QUEUED ⇒ unknown/park).
 * The sweeper fallback vendor_bill probe carries an IDENTICAL copy.
 */
function paymentRefCorroboratesIntent(
  paymentRef: string | null,
  intent: { id: number; stripePaymentIntentId: string },
): boolean {
  const ref = paymentRef ?? "";
  if (ref.length === 0) return false;
  if (ref.includes(intent.stripePaymentIntentId)) return true;
  for (const marker of [`CFINT_${intent.id}`, `CF-${intent.id}`]) {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
    const re = new RegExp(`(^|[^0-9A-Za-z])${escaped}([^0-9]|$)`);
    if (re.test(ref)) return true;
  }
  return false;
}

async function verifyExecutorSideEffect(intent: {
  id: number;
  tenantId: number;
  purpose: string;
  purposeEntityId: string;
  amount: string;
  stripePaymentIntentId: string;
}): Promise<IntentExecutionState> {
  const db = await requireDb();

  if (intent.purpose === "invoice") {
    const rows = (await db.execute(sql`
      SELECT status, amount_paid AS "amountPaid", metadata
      FROM invoices_v2
      WHERE id = ${Number(intent.purposeEntityId)} AND tenant_id = ${intent.tenantId}
      LIMIT 1
    `)) as unknown as Array<{ status: string; amountPaid: string; metadata: unknown }>;
    const inv = rows[0];
    if (!inv) return "unknown"; // missing row — cannot verify → never auto-refund

    // Attribution (round-4 keyed form + legacy dual-read): parse the metadata
    // strictly — any JSON/parse problem is UNVERIFIABLE → unknown, never guess.
    let metadata: Record<string, unknown> | null = null;
    if (inv.metadata !== null && inv.metadata !== undefined) {
      let metaObj: unknown = inv.metadata;
      if (typeof metaObj === "string") {
        try {
          metaObj = JSON.parse(metaObj);
        } catch {
          return "unknown"; // unreadable metadata — cannot verify → never auto-refund
        }
      }
      if (typeof metaObj !== "object" || metaObj === null) return "unknown";
      metadata = metaObj as Record<string, unknown>;
    }
    if (metadata !== null && cardFundingAttributionMatches(metadata, intent.id, intent.stripePaymentIntentId)) {
      return "landed"; // THIS intent's payment committed (proof, not inference)
    }
    // Attribution absent or naming only OTHER intents: whether the invoice is
    // paid/covering (another rail/intent paid it) or unpaid/uncovered, THIS
    // intent verifiably did not pay it → not_landed (refund correct).
    return "not_landed";
  }

  if (intent.purpose === "vendor_bill") {
    if (purposeExecutors.get("vendor_bill") !== defaultVendorBillExecutor) {
      return "unknown"; // overridden by a real payout engine — not verifiable here
    }
    const rows = (await db.execute(sql`
      SELECT status,
             payment_ref AS "paymentRef",
             (metadata->'cardFundingExecutionRequested'->>'intentId') AS "flagIntentId",
             (metadata->'cardFundingExecutionRequested'->>'stripePaymentIntentId') AS "flagStripePi"
      FROM vendor_bills
      WHERE id = ${Number(intent.purposeEntityId)} AND tenant_id = ${intent.tenantId}
      LIMIT 1
    `)) as unknown as Array<{ status: string; paymentRef: string | null; flagIntentId: string | null; flagStripePi: string | null }>;
    const bill = rows[0];
    if (!bill) return "unknown";
    if (bill.status === "paid") {
      // H-R4-2 (round-5): the default executor only QUEUES the bill — a paid
      // bill settles THIS intent ONLY on payment-evidence corroboration
      // (paymentRef Stripe-PI / boundary-exact CFINT_<id> / CF-<id> marker).
      // The queue flag NEVER corroborates landing: it proves a queue request,
      // not which funds paid. Paid without such evidence (VBILL-<id>, wallet,
      // mojaloop, …) means X's captured funds can never be applied →
      // not_landed so the intent is REFUNDED — the double-charge remediation.
      return paymentRefCorroboratesIntent(bill.paymentRef, intent) ? "landed" : "not_landed";
    }
    const queuedForThisIntent =
      (bill.flagIntentId !== null && String(bill.flagIntentId) === String(intent.id)) ||
      (bill.flagStripePi !== null && bill.flagStripePi === intent.stripePaymentIntentId);
    // Bill dead — it will never be paid from the queue → this intent cannot land.
    if (["cancelled", "rejected", "void", "failed"].includes(bill.status)) return "not_landed";
    // Active states (captured/pending_approval/approved/scheduled/paying):
    // flag naming THIS intent → QUEUED, not landed → park as unknown; flag
    // absent or naming a DIFFERENT intent → this intent's only write never
    // committed (the other intent's flag won) → not_landed.
    return queuedForThisIntent ? "unknown" : "not_landed";
  }

  if (intent.purpose === "transfer") {
    // Default executor throws BEFORE any side effect (verified above); an
    // override's side effect is not verifiable here.
    return purposeExecutors.get("transfer") === defaultTransferExecutor ? "not_landed" : "unknown";
  }

  return "unknown"; // unregistered/custom purpose — never auto-refund
}

/**
 * Reconciliation probe for parked `executing` intents — consumed by
 * payoutSettlementSweeper (FIX-B). Round-4 contract (sweeper fallback probes
 * MUST mirror this):
 *   'landed'     → THIS intent's purpose payment verifiably committed:
 *                  invoice — keyed attribution match on
 *                  invoices_v2.metadata.cardFunding: intents["<id>"] exists,
 *                  or any intents[k].stripePaymentIntentId matches, or the
 *                  legacy top-level intentId/stripePaymentIntentId matches.
 *                  vendor_bill — status='paid' AND payment-evidence
 *                  corroboration naming THIS intent: paymentRef contains the
 *                  Stripe PI id or a boundary-exact CFINT_<id>/CF-<id>
 *                  marker. The metadata queue flag NEVER corroborates landed
 *                  (it proves a queue request, not which funds paid); a bare
 *                  paid status is NEVER enough (the default executor only
 *                  queues; another rail may have paid the bill).
 *                  Settle the intent executed.
 *   'not_landed' → this intent verifiably did NOT pay: invoice attribution
 *                  absent/different (paid by another rail/intent, or unpaid);
 *                  vendor_bill dead (cancelled/rejected/void/failed), or paid
 *                  WITHOUT payment-evidence corroboration for this intent
 *                  (another rail/intent paid — refunding X remediates the
 *                  double-charge), or never queued; transfer default executor
 *                  (pre-effect throw). Safe to fail + refund.
 *   'unknown'    → queued-but-unpaid vendor_bill (flag names this intent),
 *                  missing row, unreadable metadata, or overridden/custom
 *                  executor. Keep parked; manual recon required.
 * Terminal intent rows short-circuit: executed → 'landed';
 * failed/refunded → 'not_landed'.
 */
export async function describeIntentExecutionState(intentId: number): Promise<IntentExecutionState> {
  const db = await requireDb();
  const [intent] = await db
    .select()
    .from(cardFundingIntents)
    .where(eq(cardFundingIntents.id, intentId))
    .limit(1);
  if (!intent) return "unknown";
  if (intent.status === "executed") return "landed";
  if (intent.status === "failed" || intent.status === "refunded") return "not_landed";
  return verifyExecutorSideEffect(intent);
}

// ─── Shared single-winner refund claim (W12 audit: refund-path TOCTOU) ──────
/**
 * BOTH refund sites — the execute-path failure handler (below) and
 * payoutSettlementSweeper.sweepCardFundingRow — MUST go through this helper.
 *
 * The Stripe idempotency key `card-funding-refund-<intentId>` is identical at
 * both sites and is crash-safe at Stripe, but it is NOT a concurrency arbiter
 * on our side: without a DB-level claim, the execute path and the sweeper can
 * both pass their pre-refund checks for the same intent and both call Stripe
 * (duplicate refund calls collapse at Stripe, but both paths then emit
 * conflicting terminal writes/events), and the old execute path flipped the
 * intent to 'failed' BEFORE refunding — a refund failure then stranded
 * captured card funds on a terminal 'failed' row the sweeper never rescans.
 *
 * Mechanism (the DB row is the single winner arbiter):
 *   claim:   UPDATE ... SET status='refunding'
 *            WHERE id=? AND tenant_id=? AND (
 *              status IN ('executing','refund_failed')              — open rows
 *              OR (status='refunding' AND updated_at < NOW()-15min) — crashed
 *                claimant reclaim; Stripe idempotency key collapses any
 *                duplicate refund the crashed claimant may have issued)
 *            RETURNING id — ONLY the affected-rows==1 winner calls Stripe.
 *   success: status='refunded'      — the flip happens ONLY after Stripe
 *            confirms the refund (sweep-then-flip ordering preserved).
 *   failure: status='refund_failed' — retryable; the sweeper reclaims and
 *            retries on a later cycle.
 *   crash between claim and terminal write → the row stays 'refunding'; the
 *            sweeper reclaims it once stale (>15min) and re-drives the refund
 *            with the SAME idempotency key.
 *
 * 'refunding'/'refund_failed' ride on the existing varchar(24) status column
 * — NO schema change. Every other transition in this file and the sweeper is
 * a guarded UPDATE with an explicit from-state, so a claimed ('refunding')
 * row cannot be flipped captured/failed/executed underneath the claimant.
 */
export type CardFundingRefundOutcome =
  | { outcome: "refunded"; stripeRefundId: string | null; alreadyRefunded: boolean }
  | { outcome: "not_claimed"; currentStatus: string | null }
  | { outcome: "refund_failed"; error: string };

export async function refundCapturedFundingIntent(intent: {
  id: number;
  tenantId: number;
  stripePaymentIntentId: string;
}): Promise<CardFundingRefundOutcome> {
  const db = await requireDb();

  // Step 1: atomic single-winner claim.
  const claim = (await db.execute(sql`
    UPDATE card_funding_intents
    SET status = 'refunding', updated_at = NOW()
    WHERE id = ${intent.id} AND tenant_id = ${intent.tenantId}
      AND (
        status IN ('executing', 'refund_failed')
        OR (status = 'refunding' AND updated_at < NOW() - INTERVAL '15 minutes')
      )
    RETURNING id
  `)) as unknown as Array<{ id: number }>;
  if (claim.length === 0) {
    // Lost the race or the row is terminal. Idempotent replay: an already
    // refunded intent reports success WITHOUT re-calling Stripe.
    const [cur] = await db
      .select({ status: cardFundingIntents.status })
      .from(cardFundingIntents)
      .where(eq(cardFundingIntents.id, intent.id))
      .limit(1);
    if (cur?.status === "refunded") {
      return { outcome: "refunded", stripeRefundId: null, alreadyRefunded: true };
    }
    return { outcome: "not_claimed", currentStatus: cur?.status ?? null };
  }

  // Step 2: ONLY the claim winner reaches Stripe. The idempotency key is
  // identical at both call sites and across crashed-claimant reclaims, so a
  // duplicate refund call collapses to ONE Stripe refund.
  let stripeRefundId: string | null = null;
  let alreadyRefunded = false;
  let refundError: string | null = null;
  try {
    const stripe = stripeOrUnavailable();
    const refund = await stripe.refunds.create(
      { payment_intent: intent.stripePaymentIntentId },
      { idempotencyKey: `card-funding-refund-${intent.id}` },
    );
    stripeRefundId = refund.id;
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    const code = String((err as { code?: unknown })?.code ?? "");
    if (/already.*refund/i.test(`${code} ${msg}`)) {
      // A prior attempt's refund DID land at Stripe (response/commit lost) —
      // treat as refunded, never retry a second refund.
      alreadyRefunded = true;
    } else {
      refundError = msg;
    }
  }

  // Step 3: terminal transition, guarded on OUR claim (status='refunding').
  if (refundError !== null) {
    const failFlip = (await db.execute(sql`
      UPDATE card_funding_intents
      SET status = 'refund_failed', updated_at = NOW()
      WHERE id = ${intent.id} AND tenant_id = ${intent.tenantId} AND status = 'refunding'
      RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (failFlip.length === 0) {
      logger.error(`[CardFunding] CRITICAL: intent ${intent.id} refund failed (${refundError}) AND the refund_failed marker write matched 0 rows — row moved concurrently; MANUAL RECONCILIATION REQUIRED`);
    }
    return { outcome: "refund_failed", error: refundError };
  }
  const done = (await db.execute(sql`
    UPDATE card_funding_intents
    SET status = 'refunded', updated_at = NOW()
    WHERE id = ${intent.id} AND tenant_id = ${intent.tenantId} AND status = 'refunding'
    RETURNING id
  `)) as unknown as Array<{ id: number }>;
  if (done.length === 0) {
    // The refund IS durable at Stripe; only the local flip was lost. The row
    // stays 'refunding' and the sweeper's stale-claim reclaim re-drives this
    // helper — the Stripe idempotency key collapses the duplicate call and
    // the refunded flip then lands. Never flip blindly here.
    logger.error(`[CardFunding] CRITICAL: intent ${intent.id} Stripe refund succeeded (${stripeRefundId ?? "already_refunded"}) but the refunded flip matched 0 rows — left in 'refunding'; sweeper reclaim will settle it; MANUAL RECONCILIATION if persistent`);
  }
  return { outcome: "refunded", stripeRefundId, alreadyRefunded };
}

// ─── Router ───────────────────────────────────────────────────────────────────
export const cardFundingRouter = router({
  createIntent: protectedProcedure
    .input(
      z.object({
        purpose: z.enum(["vendor_bill", "invoice", "transfer"]),
        purposeEntityId: z.string().min(1).max(64),
        amount: z.number().positive().max(1_000_000),
        currency: z.string().length(3),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = await resolveFundingTenantId(ctx.user.id);
      return createCardFundingIntent({
        tenantId,
        userId: ctx.user.id,
        purpose: input.purpose,
        purposeEntityId: input.purposeEntityId,
        amount: input.amount,
        currency: input.currency,
      });
    }),

  /**
   * PRIMARY confirmation path (no dependency on stripeWebhook.ts edits):
   * polls the Stripe PaymentIntent and advances the local row honestly.
   *
   * H2: confirmIntent may ONLY transition requires_capture → captured (or
   * requires_capture → failed when Stripe reports canceled). Already-captured
   * is an idempotent success. It NEVER writes to a row in executing /
   * executed / failed / refunded — every write is a guarded UPDATE with an
   * explicit from-state and a RETURNING row-count check, so a concurrent
   * execute cannot be flipped back to captured (execute-then-refund exploit).
   */
  confirmIntent: protectedProcedure
    .input(z.object({ intentId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const tenantId = await resolveFundingTenantId(ctx.user.id);
      const [intent] = await db
        .select()
        .from(cardFundingIntents)
        .where(and(eq(cardFundingIntents.id, input.intentId), eq(cardFundingIntents.tenantId, tenantId)))
        .limit(1);
      if (!intent) throw new TRPCError({ code: "NOT_FOUND", message: "Funding intent not found" });

      if (intent.status === "captured") {
        // Idempotent success — never rewrite.
        return { intentId: intent.id, status: "captured" as const, holdUntil: intent.holdUntil };
      }
      if (intent.status === "executing") {
        // An execution owns this row — confirmation is closed, fail closed.
        throw new TRPCError({ code: "CONFLICT", message: "Funding intent is being executed — confirmation is closed" });
      }
      if (["executed", "failed", "refunded"].includes(intent.status)) {
        // Terminal — report honestly, NEVER touch.
        return { intentId: intent.id, status: intent.status, holdUntil: intent.holdUntil };
      }
      if (intent.status !== "requires_capture") {
        // Non-vocab legacy value on disk — fail closed, never guess a transition.
        throw new TRPCError({
          code: "CONFLICT",
          message: `Funding intent has unrecognized status '${intent.status}' — manual review required`,
        });
      }

      const stripe = stripeOrUnavailable();
      const pi = await stripe.paymentIntents.retrieve(intent.stripePaymentIntentId);
      const nextStatus = mapStripeStatus(pi.status); // SPEC vocab (M3); raw kept as stripeStatus

      if (nextStatus === "requires_capture") {
        // Stripe still pre-capture — nothing to write.
        return { intentId: intent.id, status: "requires_capture" as const, holdUntil: intent.holdUntil, stripeStatus: pi.status };
      }

      const holdUntil = nextStatus === "captured" ? (intent.holdUntil ?? computeHoldUntil()) : intent.holdUntil;
      // Guarded write: ONLY requires_capture → {captured|failed}. Row-count 0
      // means a concurrent path (webhook capture, execute claim) won — we
      // re-read and report the true state instead of writing blindly.
      const rows = (await db.execute(sql`
        UPDATE card_funding_intents
        SET status = ${nextStatus}, hold_until = ${holdUntil}, updated_at = NOW()
        WHERE id = ${intent.id} AND tenant_id = ${tenantId} AND status = 'requires_capture'
        RETURNING id
      `)) as unknown as Array<{ id: number }>;
      if (rows.length === 0) {
        const [cur] = await db
          .select()
          .from(cardFundingIntents)
          .where(eq(cardFundingIntents.id, intent.id))
          .limit(1);
        if (cur?.status === "captured") {
          // The webhook captured it concurrently — idempotent success.
          return { intentId: intent.id, status: "captured" as const, holdUntil: cur.holdUntil, stripeStatus: pi.status };
        }
        throw new TRPCError({
          code: "CONFLICT",
          message: `Funding intent transitioned concurrently (now '${cur?.status ?? "unknown"}') — re-fetch before retrying`,
        });
      }
      await emitFundingEvent(`funding.${nextStatus}`, { ...intent, status: nextStatus }, { stripeStatus: pi.status });
      return { intentId: intent.id, status: nextStatus, holdUntil, stripeStatus: pi.status };
    }),

  get: protectedProcedure
    .input(z.object({ intentId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = await requireDb();
      const tenantId = await resolveFundingTenantId(ctx.user.id);
      const [intent] = await db
        .select()
        .from(cardFundingIntents)
        .where(and(eq(cardFundingIntents.id, input.intentId), eq(cardFundingIntents.tenantId, tenantId)))
        .limit(1);
      if (!intent) throw new TRPCError({ code: "NOT_FOUND", message: "Funding intent not found" });
      return intent;
    }),

  execute: protectedProcedure
    .input(
      z.object({
        intentId: z.number().int().positive(),
        totpCode: z.string().regex(/^\d{6}$/).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const tenantId = await resolveFundingTenantId(ctx.user.id);

      // Canonical TOTP step-up (SPEC-wave7 C2): money-moving mutation.
      const { getTotpEnrollment, verifyTOTP } = await import("../totp.js");
      const enrollment = await getTotpEnrollment(ctx.user.id);
      if (!enrollment.dbAvailable) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "2FA verification unavailable — execution blocked" });
      }
      if (enrollment.enabled && enrollment.secret) {
        if (!input.totpCode) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "2FA code required for this action" });
        }
        const valid = await verifyTOTP(input.totpCode, enrollment.secret);
        if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid 2FA code" });
      }

      const [intent] = await db
        .select()
        .from(cardFundingIntents)
        .where(and(eq(cardFundingIntents.id, input.intentId), eq(cardFundingIntents.tenantId, tenantId)))
        .limit(1);
      if (!intent) throw new TRPCError({ code: "NOT_FOUND", message: "Funding intent not found" });
      // M3: bind execution to the intent creator — any same-tenant user must
      // NOT be able to execute (and potentially refund-fail) someone else's
      // captured funds. Admins are the explicit break-glass exception.
      if (intent.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the intent creator or an admin may execute this funding intent",
        });
      }
      if (intent.status !== "captured") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Funding intent is ${intent.status} — only captured intents can be executed`,
        });
      }

      const executor = purposeExecutors.get(intent.purpose as FundingPurpose);
      if (!executor) {
        throw new TRPCError({
          code: "UNAVAILABLE",
          message: `No execution path is registered for purpose '${intent.purpose}' — failing closed`,
        });
      }

      // Chargeback hold: enforced for IRREVERSIBLE rails; skipped only when the
      // purpose payment is wallet-internal/reversible (SPEC C2).
      if (executor.irreversible) {
        const holdUntil = intent.holdUntil ?? computeHoldUntil();
        if (Date.now() < holdUntil.getTime()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Chargeback hold active until ${holdUntil.toISOString()} — irreversible-rail execution is blocked until then`,
          });
        }
      }

      // Guarded flip captured→executing: a concurrent execute affects 0 rows.
      const claim = (await db.execute(sql`
        UPDATE card_funding_intents
        SET status = 'executing', updated_at = NOW()
        WHERE id = ${intent.id} AND tenant_id = ${tenantId} AND status = 'captured'
        RETURNING id
      `)) as unknown as Array<{ id: number }>;
      if (claim.length === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Funding intent is already being executed" });
      }

      try {
        const result = await executor.execute(intent);
        if (result.executed) {
          // H2: guarded terminal write executing → executed. Row-count 0 means
          // the row is no longer ours (concurrent settlement) — the catch
          // path below will then ALSO affect 0 rows and refuse to refund.
          const done = (await db.execute(sql`
            UPDATE card_funding_intents
            SET status = 'executed', updated_at = NOW()
            WHERE id = ${intent.id} AND tenant_id = ${tenantId} AND status = 'executing'
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (done.length === 0) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Funding intent was settled concurrently — terminal write refused",
            });
          }
          await emitFundingEvent("funding.executed", { ...intent, status: "executed" }, result.detail ?? {});
          return { intentId: intent.id, status: "executed", ...result.detail };
        }
        // executed:false (vendor_bill queue case): the intent STAYS executing
        // (SPEC vocab) — the queue instruction lives on the vendor_bills row
        // metadata. No status write; the non-vocab pending_execution is gone (H2).
        await emitFundingEvent("funding.execution_queued", { ...intent, status: "executing" }, result.detail ?? {});
        return { intentId: intent.id, status: "executing", ...result.detail };
      } catch (err) {
        // ── H2 round 2: NEVER refund a settled-or-uncertain payment ──────────
        // The executor commits its side effect in its OWN transaction (e.g.
        // invoicesV2 applyInvoicePaymentTx flips the invoice to paid). A throw
        // here is ambiguous: (a) rolled back pre-effect, (b) committed but a
        // later step failed, or (c) commit outcome uncertain (connection drop
        // during COMMIT — the driver throws though the tx landed). Refunding
        // in cases (b)/(c) settles the invoice AND refunds the payer. So:
        // verify the executor side effect BEFORE any status write or refund
        // (mirrors the C2/H3 park pattern in embeddedPayouts).
        const sideEffect = await verifyExecutorSideEffect(intent).catch((verifyErr: unknown) => {
          logger.error(
            `[CardFunding] intent ${intent.id}: side-effect verification itself failed — treating as UNCERTAIN:`,
            (verifyErr as Error)?.message,
          );
          return "unknown" as const;
        });

        if (sideEffect !== "not_landed") {
          // PARK: intent STAYS executing — no failed flip, NO refund. The
          // durable recon record is the Kafka funding event + this honest
          // response (card_funding_intents has no metadata column);
          // payoutSettlementSweeper resolves parked intents via
          // describeIntentExecutionState(); manual ops alerted via CRITICAL log.
          logger.error(
            `[CardFunding] CRITICAL: intent ${intent.id} execution threw but executor side effect is '${sideEffect}' — PARKED in executing, NO refund issued; reconciliation required. Original error:`,
            (err as Error)?.message,
          );
          await emitFundingEvent("funding.execution_uncertain", { ...intent, status: "executing" }, {
            executorSideEffect: sideEffect,
            purposeEntityId: intent.purposeEntityId,
            error: (err as Error)?.message ?? String(err),
            detectedAt: new Date().toISOString(),
            resolution: "parked_pending_reconciliation",
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              `Funding execution outcome UNCERTAIN: the executor reported an error but its side effect ` +
              `${sideEffect === "landed" ? "LANDED (the purpose payment committed)" : "could not be verified"}. ` +
              `The intent is PARKED in 'executing' — no refund was issued. Reconciliation (payoutSettlementSweeper / manual ops) will resolve it.`,
          });
        }

        // sideEffect === 'not_landed': the executor VERIFIABLY did not commit
        // (invoice still unpaid with amount_paid = 0; vendor_bill without the
        // execution flag under the default executor; transfer executor throws
        // pre-effect) — only now may we refund. The refund goes through the
        // SHARED single-winner claim helper (W12): the DB claim — not just
        // the Stripe idempotency key — arbitrates between this path and the
        // settlement sweeper, the terminal 'refunded' flip happens only AFTER
        // Stripe confirms, and a Stripe failure parks the intent in the
        // retryable 'refund_failed' state (the sweeper rescans it) instead of
        // stranding captured funds on a terminal 'failed' row.
        const refundResult = await refundCapturedFundingIntent(intent);

        if (refundResult.outcome === "not_claimed") {
          // A lost claim race means a concurrent path owns/settled the intent
          // — refunding anyway would be the execute-then-refund
          // double-settlement exploit, so we refuse.
          logger.error(
            `[CardFunding] intent ${intent.id}: execution error but the refund claim lost the race (status now '${refundResult.currentStatus ?? "unknown"}') — NO refund issued by this request; manual ops review required`,
          );
          throw new TRPCError({
            code: "CONFLICT",
            message: "Funding intent was settled concurrently — no refund issued by this request",
          });
        }

        if (refundResult.outcome === "refund_failed") {
          logger.error(
            `[CardFunding] CRITICAL: intent ${intent.id} execution failed AND refund failed — intent parked in 'refund_failed' (sweeper retries automatically):`,
            refundResult.error,
          );
          await emitFundingEvent("funding.refund_failed", { ...intent, status: "refund_failed" }, {
            error: (err as Error)?.message ?? String(err),
            refundError: refundResult.error,
            resolution: "retryable_by_payoutSettlementSweeper",
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              `Funding execution failed: ${(err as Error)?.message ?? String(err)}. ` +
              `The Stripe refund ALSO failed (${refundResult.error}) — the intent is parked in 'refund_failed' and the settlement sweeper will retry the refund automatically. No funds moved to the purpose.`,
          });
        }

        // Refund confirmed by Stripe and the intent is terminally 'refunded'.
        logger.warn(
          `[CardFunding] intent ${intent.id} execution failed — captured funds refunded (${refundResult.stripeRefundId ?? "already_refunded"})`,
        );
        await emitFundingEvent("funding.refunded", { ...intent, status: "refunded" }, {
          error: (err as Error)?.message ?? String(err),
          refundId: refundResult.stripeRefundId ?? "already_refunded",
          refund: refundResult.alreadyRefunded ? "already_refunded_idempotent" : "issued_by_execute_path",
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            `Funding execution failed: ${(err as Error)?.message ?? String(err)}. ` +
            `The captured card funds were refunded (${refundResult.stripeRefundId ?? "already refunded"}).`,
        });
      }
    }),
});
