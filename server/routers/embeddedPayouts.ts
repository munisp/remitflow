/**
 * W10-C5 / SPEC-wave10 — Embedded Payouts API (partner-scoped, P1-8).
 *
 * Auth (BOTH required, fail closed):
 *  1. Partner API key — `x-api-key` (or `Authorization: Bearer <key>`), resolved
 *     via the partnerApiKeys lookup pattern (sha256 hash compare against
 *     partner_api_keys, status='active', not expired) from partnerApplications.ts.
 *  2. HMAC-SHA256 body signature — `x-payout-signature` hex over the canonical
 *     (sorted-key) JSON of the request input, keyed with PAYOUTS_API_HMAC_SECRET.
 *     Constant-time compare. Secret unset → UNAVAILABLE (fail closed).
 *
 * createPayout flow (statuses per SPEC vocab: received→screening→funded→executing→settled|failed):
 *  - Idempotency: UNIQUE(partner_tenant_id, idempotency_key); conflict → return
 *    the ORIGINAL record (replay-safe, never re-executes).
 *  - Rail resolution from corridor; no live rail → failed / rail_unavailable (honest).
 *  - Sanctions screening via screenSanctions from server/_core/polyglotClient —
 *    the SAME fail-closed client transferCore's pipeline uses (throws on outage)
 *    → failed / screening_unavailable.
 *  - TigerBeetle two-phase hold (amount + speed-tier fee) from the partner float
 *    account (tigerbeetle_accounts: user_id = partnerTenantId, code = FLOAT_POOL,
 *    provisioned via provisionPlatformAccounts(partnerTenantId)); missing float
 *    or insufficient balance → failed / insufficient_prefund.
 *  - Speed-tier fee via quoteSpeedTiers/speedTierFee; the fee is included in the
 *    hold credited to the platform float pool (Wave-9 Q4 platform-float pattern).
 *  - Execution: mojaloop FSP client (requestQuote → initiateTransfer, the
 *    routers.ts:3300 pattern) or stablecoin (Circle). settled ONLY on rail
 *    confirmation (COMMITTED/COMPLETE); async acceptance (RESERVED/pending)
 *    stays `executing` honestly. ONLY pre-commit failures void the TB hold:
 *    once the rail reports COMMITTED/COMPLETE the disbursement is an
 *    irreversible fact (audit C2) — a failed TB post parks the row
 *    `executing` with a RECON marker (never void, never fail); an UNCERTAIN
 *    rail outcome (audit H3) is reconciled once, then parked for the
 *    settlement sweeper — never voided/refunded blindly.
 *  - Partner webhook delivery on every transition, HMAC-signed with the
 *    webhook's signing_secret (developerPortal deliverWebhook pattern).
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { partnerPayoutRequests, vendors, type PartnerPayoutRequest } from "../../drizzle/schema";
import { tigerbeetleAccounts } from "../../drizzle/schema.integrations";
import { tigerBeetle } from "../middleware/middlewareIntegration";
import { publishEvent } from "../middleware/kafka";
import { PLATFORM_SYSTEM_USER_ID, TB_ACCOUNT_CODES, TB_LEDGERS } from "../_core/tigerBeetle";
import { pendingTransferIdFor } from "../_core/transferPipeline";
import { screenSanctions } from "../_core/polyglotClient";
import { quoteSpeedTiers, speedTierFee, type SpeedTier } from "../_core/speedTiers";
import { logger } from "../_core/logger";

// ─── HMAC + canonical body ────────────────────────────────────────────────────

/** Deterministic JSON (sorted keys) — partners sign exactly this string. */
function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function verifyPayoutSignature(rawInput: unknown, signatureHeader: string | undefined): void {
  const secret = process.env.PAYOUTS_API_HMAC_SECRET?.trim();
  if (!secret) {
    // Fail closed: the payouts API is unconfigured — every call is rejected.
    throw new TRPCError({ code: "UNAVAILABLE", message: "Payouts API is not configured (PAYOUTS_API_HMAC_SECRET unset) — refusing all requests" });
  }
  if (!signatureHeader || !/^[0-9a-fA-F]{64}$/.test(signatureHeader)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Missing or malformed x-payout-signature header" });
  }
  const expected = createHmac("sha256", secret).update(stableStringify(rawInput ?? null), "utf8").digest("hex");
  const a = Buffer.from(signatureHeader.toLowerCase(), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid payout request signature" });
  }
}

// ─── Partner API-key auth (partnerApiKeys pattern from partnerApplications.ts) ─

interface PartnerContext { partnerTenantId: number; apiKeyId: number; environment: string; }

async function resolvePartnerByApiKey(req: { headers: Record<string, unknown> }): Promise<PartnerContext> {
  const headerKey = req.headers["x-api-key"];
  const auth = req.headers["authorization"];
  const apiKey = (typeof headerKey === "string" && headerKey.trim())
    || (typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7).trim() : "");
  if (!apiKey) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Partner API key required (x-api-key header)" });
  }
  const hash = createHash("sha256").update(apiKey).digest("hex");
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const rows = await db.execute(sql`
    SELECT id, tenant_id, environment FROM partner_api_keys
    WHERE key_hash = ${hash} AND status = 'active'
      AND (expires_at IS NULL OR expires_at > NOW())
    LIMIT 1
  `);
  const key = (rows as unknown as Array<{ id: number; tenant_id: number; environment: string }>)[0];
  if (!key) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or expired partner API key" });
  // Best-effort usage telemetry — never blocks the request.
  db.execute(sql`UPDATE partner_api_keys SET last_used_at = NOW(), request_count = COALESCE(request_count, 0) + 1 WHERE id = ${key.id}`)
    .catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[EmbeddedPayouts] API-key usage update failed"));
  return { partnerTenantId: key.tenant_id, apiKeyId: key.id, environment: key.environment };
}

/** Partner-scoped procedure: API key + HMAC body signature (both fail closed). */
const partnerProcedure = publicProcedure.use(async (opts) => {
  const partner = await resolvePartnerByApiKey(opts.ctx.req as unknown as { headers: Record<string, unknown> });
  const sig = (opts.ctx.req as unknown as { headers: Record<string, unknown> }).headers["x-payout-signature"];
  verifyPayoutSignature(opts.rawInput ?? null, typeof sig === "string" ? sig : undefined);
  return opts.next({ ctx: { ...opts.ctx, partner } });
});

// ─── Rail resolution (honest availability) ────────────────────────────────────

type Rail = "mojaloop" | "mobile_money" | "stablecoin" | "bank";

/** Destination-currency → candidate rails in priority order. */
const CORRIDOR_RAIL_CANDIDATES: Record<string, Rail[]> = {
  NGN: ["mojaloop", "mobile_money", "bank"],
  GHS: ["mobile_money", "bank"],
  KES: ["mobile_money", "bank"],
  TZS: ["mobile_money", "bank"],
  UGX: ["mobile_money", "bank"],
  USD: ["stablecoin", "bank"],
  USDC: ["stablecoin"],
  EUR: ["bank"],
  GBP: ["bank"],
};

export interface RailAvailability { rail: Rail; available: boolean; reason?: string; }

/**
 * A rail is "available" ONLY when a real execution path is configured.
 * mobile_money/bank have no partner-facing payout executor wired in this API
 * today — they are reported honestly as unavailable rather than fabricating
 * execution.
 */
export function railAvailability(rail: Rail): RailAvailability {
  switch (rail) {
    case "mojaloop":
      return process.env.MOJALOOP_SWITCH_URL?.trim()
        ? { rail, available: true }
        : { rail, available: false, reason: "MOJALOOP_SWITCH_URL not configured" };
    case "stablecoin": {
      const ok = !!(process.env.CIRCLE_API_KEY?.trim()
        && process.env.CIRCLE_PAYOUT_SOURCE_WALLET_ID?.trim()
        && process.env.CIRCLE_PAYOUT_TOKEN_ID?.trim());
      return ok
        ? { rail, available: true }
        : { rail, available: false, reason: "Circle payout env (CIRCLE_API_KEY / CIRCLE_PAYOUT_SOURCE_WALLET_ID / CIRCLE_PAYOUT_TOKEN_ID) not configured" };
    }
    case "mobile_money":
      return { rail, available: false, reason: "no live mobile-money payout executor wired for embedded payouts" };
    case "bank":
      return { rail, available: false, reason: "no live bank-rail payout executor wired for embedded payouts" };
  }
}

function railsForCorridor(corridor: string): RailAvailability[] {
  const to = corridor.split("-")[1] ?? "";
  const candidates = CORRIDOR_RAIL_CANDIDATES[to] ?? ["bank" as Rail];
  return candidates.map(railAvailability);
}

// ─── Reconciliation markers (audit C2/H3/H6) ─────────────────────────────────
// partner_payout_requests has NO metadata column and schema changes are out of
// scope, so parked-row reconciliation state is encoded in failure_reason with a
// strict RECON: prefix. The settlement sweeper (payoutSettlementSweeper.ts) is
// the only other reader/writer. A row in `executing` whose failure_reason
// starts with this prefix is PARKED, not failed.

export const PAYOUT_RECON_PREFIX = "RECON:";

export interface PayoutReconMarker {
  railCommitted?: boolean;
  railRef?: string;
  railUncertain?: boolean;
  transferId?: string;
  tbPostFailed?: boolean;
  tbPostError?: string;
  holdExpiredUnresolved?: boolean;
  detectedAt?: string;
  [k: string]: unknown;
}

export function encodePayoutRecon(marker: PayoutReconMarker): string {
  return PAYOUT_RECON_PREFIX + JSON.stringify(marker);
}

export function decodePayoutRecon(failureReason: string | null | undefined): PayoutReconMarker | null {
  if (!failureReason || !failureReason.startsWith(PAYOUT_RECON_PREFIX)) return null;
  try {
    const parsed = JSON.parse(failureReason.slice(PAYOUT_RECON_PREFIX.length));
    return parsed && typeof parsed === "object" ? parsed as PayoutReconMarker : null;
  } catch {
    return null;
  }
}

// ─── Partner webhook delivery (developerPortal deliverWebhook pattern) ────────

export async function deliverPartnerWebhooks(partnerTenantId: number, event: string, payload: Record<string, unknown>): Promise<{ attempted: number; delivered: number }> {
  const db = await getDb();
  if (!db) return { attempted: 0, delivered: 0 };
  const rows = await db.execute(sql`
    SELECT id, url, events, signing_secret FROM partner_webhooks
    WHERE tenant_id = ${partnerTenantId} AND is_active = true
  `);
  let attempted = 0;
  let delivered = 0;
  for (const wh of rows as unknown as Array<{ id: number; url: string; events: unknown; signing_secret: string }>) {
    let events: string[] = [];
    try { events = typeof wh.events === "string" ? JSON.parse(wh.events) : (wh.events as string[] ?? []); } catch { events = []; }
    if (!events.includes(event) && !events.includes("payout.*") && !events.includes("*")) continue;
    // HTTPS only + no redirect following (SSRF guard, developerPortal pattern).
    if (!wh.url.startsWith("https://")) {
      logger.warn({ webhookId: wh.id }, "[EmbeddedPayouts] Webhook URL rejected (HTTPS only)");
      continue;
    }
    attempted++;
    const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString(), id: `evt_${pendingTransferIdFor(`${event}:${payload.id ?? Date.now()}`).toString()}` });
    const signature = `sha256=${createHmac("sha256", wh.signing_secret).update(body).digest("hex")}`;
    try {
      const res = await fetch(wh.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RemitFlow-Signature": signature,
          "X-RemitFlow-Event": event,
          "User-Agent": "RemitFlow-Webhooks/1.0",
        },
        body,
        signal: AbortSignal.timeout(10_000),
        redirect: "manual",
      });
      if (res.status >= 200 && res.status < 300) {
        delivered++;
        await db.execute(sql`UPDATE partner_webhooks SET last_delivered_at = NOW(), failure_count = 0, updated_at = NOW() WHERE id = ${wh.id}`)
          .catch(() => {});
      } else {
        await db.execute(sql`UPDATE partner_webhooks SET failure_count = COALESCE(failure_count, 0) + 1, updated_at = NOW() WHERE id = ${wh.id}`)
          .catch(() => {});
        logger.warn({ webhookId: wh.id, status: res.status, event }, "[EmbeddedPayouts] Webhook delivery failed");
      }
    } catch (err) {
      await db.execute(sql`UPDATE partner_webhooks SET failure_count = COALESCE(failure_count, 0) + 1, updated_at = NOW() WHERE id = ${wh.id}`)
        .catch(() => {});
      logger.warn({ webhookId: wh.id, event, err: err instanceof Error ? err.message : String(err) }, "[EmbeddedPayouts] Webhook delivery error");
    }
  }
  return { attempted, delivered };
}

// ─── Status transition helper (guarded, single-winner) ───────────────────────

type PayoutStatus = "received" | "screening" | "funded" | "executing" | "settled" | "failed";

async function transition(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  id: number,
  partnerTenantId: number,
  from: PayoutStatus[],
  to: PayoutStatus,
  extra: Record<string, unknown> = {},
): Promise<PartnerPayoutRequest> {
  const set: Record<string, unknown> = { status: to, updatedAt: new Date(), ...extra };
  const [row] = await db.update(partnerPayoutRequests).set(set)
    .where(and(
      eq(partnerPayoutRequests.id, id),
      eq(partnerPayoutRequests.partnerTenantId, partnerTenantId),
      inArray(partnerPayoutRequests.status, from),
    ))
    .returning();
  if (!row) {
    const [current] = await db.select().from(partnerPayoutRequests)
      .where(and(eq(partnerPayoutRequests.id, id), eq(partnerPayoutRequests.partnerTenantId, partnerTenantId))).limit(1);
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Payout not found" });
    // M4 (audit): FAIL CLOSED on a guard miss. The previous behavior returned
    // the current row and let callers silently continue down a flow whose
    // precondition no longer held (e.g. crediting/webhooking as if the
    // transition had happened). A guard miss means a concurrent path changed
    // the state — the caller MUST abort, not continue.
    throw new TRPCError({
      code: "CONFLICT",
      message: `Payout ${id} is '${current.status}' — transition ${from.join("|")} → ${to} rejected (concurrent state change); operation aborted`,
    });
  }
  publishEvent("remitflow.embedded-payouts", String(id), {
    type: `payout.${to}`, tenantId: partnerTenantId, id, status: to,
    rail: row.rail, amount: row.amount, currency: row.currency, corridor: row.corridor,
    timestamp: new Date().toISOString(),
  }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[EmbeddedPayouts] Kafka publish failed (degraded-open)"));
  return row;
}

// ─── TB partner-float resolution + hold ──────────────────────────────────────

async function resolveTbFloat(userId: number, currency: string) {
  const ledger = TB_LEDGERS[currency];
  if (!ledger) return { ledger: null, account: null };
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Ledger account resolution unavailable (no database)" });
  const rows = await db.select().from(tigerbeetleAccounts)
    .where(and(
      eq(tigerbeetleAccounts.userId, userId),
      eq(tigerbeetleAccounts.code, TB_ACCOUNT_CODES.FLOAT_POOL),
      eq(tigerbeetleAccounts.currency, currency),
      eq(tigerbeetleAccounts.status, "active"),
    )).limit(1);
  return { ledger, account: rows[0] ?? null };
}

// ─── Input schemas ────────────────────────────────────────────────────────────

const payeeSchema = z.object({
  name: z.string().min(1).max(255),
  country: z.string().length(2),
  entityType: z.enum(["individual", "business"]).default("business"),
  msisdn: z.string().max(32).optional(),
  fspId: z.string().max(64).optional(),
  accountNumber: z.string().max(64).optional(),
  bankCode: z.string().max(32).optional(),
  walletAddress: z.string().max(128).optional(),
  chain: z.string().max(32).optional(),
  tokenId: z.string().max(64).optional(),
  circleWireId: z.string().max(64).optional(),
});

const createPayoutSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  payee: payeeSchema.optional(),
  vendorId: z.number().int().positive().optional(),
  amount: z.number().positive().max(10_000_000),
  currency: z.string().length(3),
  corridor: z.string().regex(/^[A-Z]{3}-[A-Z]{3}$/),
  speedTier: z.enum(["standard", "same_day", "instant"]).default("standard"),
}).refine((v) => (v.payee ? 1 : 0) + (v.vendorId ? 1 : 0) === 1, {
  message: "Exactly one of payee or vendorId is required",
});

// ─── Router ───────────────────────────────────────────────────────────────────
export const embeddedPayoutsRouter = router({
  createPayout: partnerProcedure
    .input(createPayoutSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const partnerTenantId = (ctx as unknown as { partner: PartnerContext }).partner.partnerTenantId;
      if (input.currency !== input.corridor.split("-")[0]) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `currency ${input.currency} does not match corridor origin ${input.corridor}` });
      }

      // ── Idempotency: UNIQUE(partner_tenant_id, idempotency_key) — on conflict
      //    return the ORIGINAL record (replay-safe; never re-executes).
      const payeeSnapshot = input.payee ?? { vendorId: input.vendorId };
      const inserted = await db.insert(partnerPayoutRequests).values({
        partnerTenantId,
        idempotencyKey: input.idempotencyKey,
        payee: payeeSnapshot as Record<string, unknown>,
        amount: input.amount.toFixed(4),
        currency: input.currency,
        corridor: input.corridor,
        rail: "unresolved",
        status: "received",
      }).onConflictDoNothing({
        target: [partnerPayoutRequests.partnerTenantId, partnerPayoutRequests.idempotencyKey],
      }).returning();
      if (inserted.length === 0) {
        const [original] = await db.select().from(partnerPayoutRequests)
          .where(and(eq(partnerPayoutRequests.partnerTenantId, partnerTenantId), eq(partnerPayoutRequests.idempotencyKey, input.idempotencyKey)))
          .limit(1);
        if (!original) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Idempotency conflict but original record missing" });
        return { replayed: true, payout: original };
      }
      const payout = inserted[0];
      const finish = async (row: PartnerPayoutRequest, event: string) => {
        const webhooks = await deliverPartnerWebhooks(partnerTenantId, event, {
          id: row.id, status: row.status, rail: row.rail, amount: row.amount,
          currency: row.currency, corridor: row.corridor, failureReason: row.failureReason,
          settleRef: row.settleRef, idempotencyKey: row.idempotencyKey,
        });
        return { replayed: false, payout: row, webhooks };
      };

      // ── Payee resolution (vendorId → tenant-scoped vendor record) ──────────
      let payee: z.infer<typeof payeeSchema>;
      if (input.vendorId != null) {
        const [vendor] = await db.select().from(vendors)
          .where(and(eq(vendors.id, input.vendorId), eq(vendors.tenantId, partnerTenantId))).limit(1);
        if (!vendor || vendor.kybStatus === "deactivated") {
          const row = await transition(db, payout.id, partnerTenantId, ["received"], "failed", { failureReason: "vendor_not_found_or_deactivated" });
          return finish(row, "payout.failed");
        }
        const pm = (vendor.payoutMethod ?? {}) as Record<string, unknown>;
        // M5 (audit): canonical payout-method keys are {rail, payeeFspId,
        // payeeMsisdn}; rows written before the contract was aligned used
        // {type, fspId, msisdn}. Dual-read — never break existing data.
        payee = {
          name: vendor.legalName,
          country: vendor.country,
          entityType: "business",
          msisdn: typeof pm.payeeMsisdn === "string" ? pm.payeeMsisdn : typeof pm.msisdn === "string" ? pm.msisdn : undefined,
          fspId: typeof pm.payeeFspId === "string" ? pm.payeeFspId : typeof pm.fspId === "string" ? pm.fspId : undefined,
          accountNumber: typeof pm.accountNumber === "string" ? pm.accountNumber : undefined,
          bankCode: typeof pm.bankCode === "string" ? pm.bankCode : undefined,
          walletAddress: typeof pm.walletAddress === "string" ? pm.walletAddress : undefined,
        };
      } else {
        payee = input.payee!;
      }

      // ── Rail resolution (honest: no live rail → failed with reason) ────────
      const rails = railsForCorridor(input.corridor);
      const chosen = rails.find((r) => r.available);
      if (!chosen) {
        const reason = `rail_unavailable: no live rail for corridor ${input.corridor} (${rails.map((r) => `${r.rail}: ${r.reason}`).join("; ")})`;
        const row = await transition(db, payout.id, partnerTenantId, ["received"], "failed", { failureReason: reason, rail: "none" });
        return finish(row, "payout.failed");
      }
      const rail = chosen.rail;

      // ── Speed-tier fee (throws on unavailable tier → failed, honest) ───────
      let fee = 0;
      try {
        fee = speedTierFee(input.amount, rail, input.speedTier as SpeedTier["tier"]);
      } catch (err) {
        const row = await transition(db, payout.id, partnerTenantId, ["received"], "failed", {
          failureReason: `invalid_speed_tier: ${err instanceof Error ? err.message : String(err)}`, rail,
        });
        return finish(row, "payout.failed");
      }

      // ── Sanctions screening — SAME fail-closed client transferCore uses
      //    (screenSanctions throws on outage → screening_unavailable).
      // Store the fully-resolved payee snapshot (vendor path) before screening.
      await transition(db, payout.id, partnerTenantId, ["received"], "screening", { rail, payee: payee as Record<string, unknown> });
      let screen;
      try {
        screen = await screenSanctions({ name: payee.name, country: payee.country, entityType: payee.entityType });
      } catch (err) {
        const row = await transition(db, payout.id, partnerTenantId, ["screening"], "failed", {
          failureReason: `screening_unavailable: ${err instanceof Error ? err.message : String(err)}`,
        });
        return finish(row, "payout.failed");
      }
      if (screen.isSanctioned || screen.action === "block") {
        const row = await transition(db, payout.id, partnerTenantId, ["screening"], "failed", {
          failureReason: `sanctions_match: ${screen.matchType ?? screen.riskLevel}`,
        });
        return finish(row, "payout.failed");
      }

      // ── TB hold from partner float (amount + fee → platform float pool) ────
      const partnerFloat = await resolveTbFloat(partnerTenantId, input.currency);
      if (!partnerFloat.ledger || !partnerFloat.account) {
        const row = await transition(db, payout.id, partnerTenantId, ["screening"], "failed", {
          failureReason: `insufficient_prefund: no provisioned partner float account for ${input.currency} — run provisionPlatformAccounts(partnerTenantId) and pre-fund`,
        });
        return finish(row, "payout.failed");
      }
      const platformFloat = await resolveTbFloat(PLATFORM_SYSTEM_USER_ID, input.currency);
      if (!platformFloat.account) {
        const row = await transition(db, payout.id, partnerTenantId, ["screening"], "failed", {
          failureReason: `platform_float_unprovisioned: platform float pool missing for ${input.currency}`,
        });
        return finish(row, "payout.failed");
      }
      const holdAmountCents = BigInt(Math.round((input.amount + fee) * 100));
      const holdId = pendingTransferIdFor(`EPP-HOLD-${payout.id}`);
      try {
        await tigerBeetle.validateBalance(BigInt(partnerFloat.account.tbAccountId), holdAmountCents);
        await tigerBeetle.createPendingTransfer({
          id: holdId,
          debitAccountId: BigInt(partnerFloat.account.tbAccountId),
          creditAccountId: BigInt(platformFloat.account.tbAccountId),
          amount: holdAmountCents,
          ledger: partnerFloat.ledger,
          code: 1,
          timeoutSeconds: 3600,
          userData128: BigInt(payout.id),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const insufficient = msg.includes("Insufficient funds") || /"result":\s*(54|55)\b/.test(msg);
        const row = await transition(db, payout.id, partnerTenantId, ["screening"], "failed", {
          failureReason: insufficient ? "insufficient_prefund: partner float balance below amount+fee" : `ledger_unavailable: ${msg}`,
        });
        return finish(row, "payout.failed");
      }
      await transition(db, payout.id, partnerTenantId, ["screening"], "funded", { tbHoldId: holdId.toString() });

      // ── Execute on the resolved rail ───────────────────────────────────────
      await transition(db, payout.id, partnerTenantId, ["funded"], "executing");
      const voidHold = async () => {
        await tigerBeetle.voidPendingTransfer({
          id: pendingTransferIdFor(`EPP-VOID-${payout.id}`),
          pendingId: holdId,
          ledger: partnerFloat.ledger!,
          code: 1,
        });
      };
      const postHold = async () => {
        await tigerBeetle.postPendingTransfer({
          id: pendingTransferIdFor(`EPP-SETTLE-${payout.id}`),
          pendingId: holdId,
          ledger: partnerFloat.ledger!,
          code: 1,
        });
      };

      if (rail === "mojaloop") {
        if (!payee.fspId || !(payee.msisdn || payee.accountNumber)) {
          await voidHold().catch((err: unknown) => logger.error({ err: err instanceof Error ? err.message : String(err), payoutId: payout.id }, "[EmbeddedPayouts] HOLD VOID FAILED — manual reconciliation required"));
          const row = await transition(db, payout.id, partnerTenantId, ["executing"], "failed", {
            failureReason: "rail_unavailable: mojaloop requires payee.fspId and payee.msisdn (or accountNumber)",
          });
          return finish(row, "payout.failed");
        }
        const { requestQuote, initiateTransfer, buildIlpPacket, getTransferStatus } = await import("../mojaloop.service.js");
        type MojaloopTransfer = Awaited<ReturnType<typeof initiateTransfer>>;
        // C2/H3 (audit): the rail SUBMISSION is isolated in its own try so
        // that only pre-commit failures (quote unreachable, packet build,
        // pre-send signing) reach the void+fail path. Everything
        // initiateTransfer RETURNS is an outcome to handle as fact below —
        // COMMITTED is irreversible, UNCERTAIN is reconciled/parked, and only
        // a definitive ABORTED voids the hold.
        let transfer: MojaloopTransfer;
        try {
          const payeeId = payee.msisdn ?? payee.accountNumber!;
          let ilpPacket = "";
          let condition = "";
          const quote = await requestQuote({
            payerMsisdn: `partner-${partnerTenantId}`,
            payeeMsisdn: payeeId,
            payerFspId: "remitflow-fsp",
            payeeFspId: payee.fspId,
            amount: input.amount.toFixed(2),
            currency: input.currency,
            note: `embedded-payout ${payout.id}`,
          }).catch(() => null); // quote outage → build the packet locally (routers.ts:3300 pattern)
          ilpPacket = quote?.ilpPacket ?? "";
          condition = quote?.condition ?? "";
          if (!ilpPacket || !condition) {
            // Async quote (HTTP 202) — build the ILPv4 packet locally.
            const built = buildIlpPacket({
              amount: input.amount.toFixed(2),
              currency: input.currency,
              destinationFspId: payee.fspId,
              destinationAccount: payeeId,
            });
            ilpPacket = built.ilpPacket;
            condition = built.condition;
          }
          transfer = await initiateTransfer({
            payerFspId: "remitflow-fsp",
            payeeFspId: payee.fspId,
            amount: input.amount.toFixed(2),
            currency: input.currency,
            ilpPacket,
            condition,
          });
        } catch (err) {
          // Pre-commit failure — the switch never accepted a transfer for this
          // payout (network failures around the POST come back as UNCERTAIN,
          // not thrown). Safe to void the hold and mark failed.
          await voidHold().catch((voidErr: unknown) => logger.error({ err: voidErr instanceof Error ? voidErr.message : String(voidErr), payoutId: payout.id }, "[EmbeddedPayouts] HOLD VOID FAILED — manual reconciliation required"));
          const row = await transition(db, payout.id, partnerTenantId, ["executing"], "failed", {
            failureReason: `rail_error: ${err instanceof Error ? err.message : String(err)}`,
          });
          return finish(row, "payout.failed");
        }

        // H3 (audit): UNCERTAIN outcome — the switch may have committed.
        // Reconcile ONCE via getTransferStatus before deciding; if still
        // unknown, park honestly (hold stays pending, row stays executing)
        // for the settlement sweeper. NEVER void/refund an unknown outcome.
        if (transfer.transferState === "UNCERTAIN") {
          let reconState = "query_failed";
          try {
            const recon = await getTransferStatus(transfer.transferId);
            reconState = recon.transferState;
            if (recon.transferState === "COMMITTED" || recon.transferState === "ABORTED" || recon.transferState === "RESERVED") {
              transfer = {
                ...transfer,
                transferState: recon.transferState,
                completedTimestamp: recon.completedTimestamp ?? transfer.completedTimestamp,
                fulfilment: recon.fulfilment ?? transfer.fulfilment,
                errorInformation: recon.errorInformation ?? transfer.errorInformation,
              };
            }
          } catch { /* reconciliation query itself failed — stays UNCERTAIN */ }
          if (transfer.transferState === "UNCERTAIN" || transfer.transferState === "RECEIVED") {
            logger.error(
              { payoutId: payout.id, transferId: transfer.transferId, reconState },
              "[EmbeddedPayouts] CRITICAL: mojaloop outcome UNCERTAIN — payout parked in executing, prefund hold NOT voided; settlement sweeper will reconcile; manual reconciliation if unresolved",
            );
            const row = await transition(db, payout.id, partnerTenantId, ["executing"], "executing", {
              settleRef: transfer.transferId,
              failureReason: encodePayoutRecon({ railUncertain: true, transferId: transfer.transferId, detectedAt: new Date().toISOString() }),
            });
            return finish(row, "payout.executing");
          }
        }

        if (transfer.transferState === "COMMITTED") {
          // C2 (audit): the rail COMMITTED — the disbursement is an
          // irreversible fact. The TB post runs in its OWN step: if it fails
          // we NEVER void the hold and NEVER mark failed (that would disburse
          // the payee AND release the prefund — money from nothing). Park the
          // row executing with a RECON marker; the settlement sweeper retries
          // the post. (Mirrors the correct vendorBills.ts:770-784 pattern.)
          try {
            await postHold();
          } catch (postErr) {
            const msg = postErr instanceof Error ? postErr.message : String(postErr);
            logger.error(
              { payoutId: payout.id, railRef: transfer.transferId, err: msg },
              "[EmbeddedPayouts] CRITICAL: rail COMMITTED but TB post failed — payee disbursed, prefund hold left pending for the settlement sweeper (NOT voided, NOT failed); MANUAL RECONCILIATION REQUIRED",
            );
            const row = await transition(db, payout.id, partnerTenantId, ["executing"], "executing", {
              settleRef: transfer.transferId,
              failureReason: encodePayoutRecon({ railCommitted: true, railRef: transfer.transferId, tbPostFailed: true, tbPostError: msg, detectedAt: new Date().toISOString() }),
            });
            return finish(row, "payout.executing");
          }
          const row = await transition(db, payout.id, partnerTenantId, ["executing"], "settled", { settleRef: transfer.transferId, failureReason: null });
          return finish(row, "payout.settled");
        }
        if (transfer.transferState === "RESERVED" || transfer.transferState === "RECEIVED") {
          // Honest async: switch accepted; settlement arrives via PUT callback
          // and the settlement sweeper polls getTransferStatus. The TB hold
          // remains pending — the sweeper resolves it, never a silent timeout.
          const row = await transition(db, payout.id, partnerTenantId, ["executing"], "executing", { settleRef: transfer.transferId });
          return finish(row, "payout.executing");
        }
        // ABORTED — definitive (only ever a switch-provided state/error).
        await voidHold().catch((err: unknown) => logger.error({ err: err instanceof Error ? err.message : String(err), payoutId: payout.id }, "[EmbeddedPayouts] HOLD VOID FAILED — manual reconciliation required"));
        const row = await transition(db, payout.id, partnerTenantId, ["executing"], "failed", {
          failureReason: `rail_aborted: ${transfer.errorInformation?.errorDescription ?? "mojaloop transfer aborted by switch"}`,
          settleRef: transfer.transferId,
        });
        return finish(row, "payout.failed");
      }

      if (rail === "stablecoin") {
        if (!payee.walletAddress) {
          await voidHold().catch((err: unknown) => logger.error({ err: err instanceof Error ? err.message : String(err), payoutId: payout.id }, "[EmbeddedPayouts] HOLD VOID FAILED — manual reconciliation required"));
          const row = await transition(db, payout.id, partnerTenantId, ["executing"], "failed", {
            failureReason: "rail_unavailable: stablecoin payout requires payee.walletAddress",
          });
          return finish(row, "payout.failed");
        }
        // C2 (audit): same isolation as the mojaloop path — the Circle POST is
        // in its own try; a returned transfer is handled as fact below and a
        // failed TB post after COMPLETE is NEVER voided/failed.
        let transfer: { id?: string; status?: string };
        try {
          const { createTransfer } = await import("../_core/circleClient");
          transfer = await createTransfer({
            sourceWalletId: process.env.CIRCLE_PAYOUT_SOURCE_WALLET_ID!,
            destinationAddress: payee.walletAddress,
            destinationChain: payee.chain ?? input.corridor.split("-")[1],
            amount: input.amount.toFixed(2),
            tokenId: process.env.CIRCLE_PAYOUT_TOKEN_ID!,
            idempotencyKey: `EPP-${partnerTenantId}-${input.idempotencyKey}`,
          });
          if (!transfer.id) throw new Error("Circle transfer returned no id");
        } catch (err) {
          // No rail confirmation and no transfer id to reconcile against —
          // pre-commit failure. Void the hold and fail honestly.
          await voidHold().catch((voidErr: unknown) => logger.error({ err: voidErr instanceof Error ? voidErr.message : String(voidErr), payoutId: payout.id }, "[EmbeddedPayouts] HOLD VOID FAILED — manual reconciliation required"));
          const row = await transition(db, payout.id, partnerTenantId, ["executing"], "failed", {
            failureReason: `rail_error: ${err instanceof Error ? err.message : String(err)}`,
          });
          return finish(row, "payout.failed");
        }
        // H6 (audit): Circle W3S states are UPPERCASE and circleClient does no
        // normalization — normalize at the comparison site, else async rails
        // can never settle.
        const circleState = String(transfer.status ?? "").toUpperCase();
        if (circleState === "COMPLETE") {
          // C2: rail COMPLETE = irreversible disbursement. Post in its own
          // step; on post failure park executing with a RECON marker for the
          // settlement sweeper — NEVER void, NEVER mark failed.
          try {
            await postHold();
          } catch (postErr) {
            const msg = postErr instanceof Error ? postErr.message : String(postErr);
            logger.error(
              { payoutId: payout.id, railRef: transfer.id, err: msg },
              "[EmbeddedPayouts] CRITICAL: circle transfer COMPLETE but TB post failed — payee disbursed, prefund hold left pending for the settlement sweeper (NOT voided, NOT failed); MANUAL RECONCILIATION REQUIRED",
            );
            const row = await transition(db, payout.id, partnerTenantId, ["executing"], "executing", {
              settleRef: transfer.id,
              failureReason: encodePayoutRecon({ railCommitted: true, railRef: transfer.id!, tbPostFailed: true, tbPostError: msg, detectedAt: new Date().toISOString() }),
            });
            return finish(row, "payout.executing");
          }
          const row = await transition(db, payout.id, partnerTenantId, ["executing"], "settled", { settleRef: transfer.id, failureReason: null });
          return finish(row, "payout.settled");
        }
        if (circleState === "FAILED" || circleState === "DENIED" || circleState === "CANCELLED") {
          // Definitive rail failure — void the hold, never silent.
          await voidHold().catch((voidErr: unknown) => logger.error({ err: voidErr instanceof Error ? voidErr.message : String(voidErr), payoutId: payout.id }, "[EmbeddedPayouts] HOLD VOID FAILED — manual reconciliation required"));
          const row = await transition(db, payout.id, partnerTenantId, ["executing"], "failed", {
            failureReason: `rail_aborted: circle transfer ${circleState.toLowerCase()}`,
            settleRef: transfer.id,
          });
          return finish(row, "payout.failed");
        }
        // INITIATED/QUEUED/PENDING/CONFIRMED/unknown — honest async; the hold
        // remains pending and the settlement sweeper polls getTransfer.
        const row = await transition(db, payout.id, partnerTenantId, ["executing"], "executing", { settleRef: transfer.id });
        return finish(row, "payout.executing");
      }

      // Unreachable given railAvailability, but never fabricate execution.
      await voidHold().catch((err: unknown) => logger.error({ err: err instanceof Error ? err.message : String(err), payoutId: payout.id }, "[EmbeddedPayouts] HOLD VOID FAILED — manual reconciliation required"));
      const row = await transition(db, payout.id, partnerTenantId, ["executing"], "failed", {
        failureReason: `rail_unavailable: ${rail} execution not wired`,
      });
      return finish(row, "payout.failed");
    }),

  getPayout: partnerProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const partnerTenantId = (ctx as unknown as { partner: PartnerContext }).partner.partnerTenantId;
      const [row] = await db.select().from(partnerPayoutRequests)
        .where(and(eq(partnerPayoutRequests.id, input.id), eq(partnerPayoutRequests.partnerTenantId, partnerTenantId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return row;
    }),

  /** Honest corridor view: candidate rails with real availability + speed tiers. */
  corridors: partnerProcedure
    .input(z.object({ corridor: z.string().regex(/^[A-Z]{3}-[A-Z]{3}$/).optional() }).optional())
    .query(async ({ input }) => {
      const corridors = input?.corridor ? [input.corridor] : Object.keys(CORRIDOR_RAIL_CANDIDATES).map((to) => `*-${to}`);
      return corridors.map((corridor) => {
        const rails = railsForCorridor(corridor);
        return {
          corridor,
          rails: rails.map((r) => ({
            rail: r.rail,
            available: r.available,
            reason: r.reason,
            // Speed tiers only quoted for live rails — never promise tiers on a rail we cannot execute.
            speedTiers: r.available ? quoteSpeedTiers(0, corridor.split("-")[1] ?? "", r.rail) : [],
          })),
        };
      });
    }),
});
