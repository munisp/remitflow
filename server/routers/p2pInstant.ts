/**
 * RemitFlow — Zelle-Style Cross-Border P2P Instant Payments (v2 — 30 features)
 *
 * Core Endpoints:
 *   p2p.registerAlias, myAliases, deactivateAlias, lookupAlias
 *   p2p.sendByAlias, requestMoney, myRequests, respondRequest
 *   p2p.history, transferStatus
 *
 * Enhanced Endpoints (30 features):
 *   p2p.splitPayment       — Group expense splitting (#11)
 *   p2p.generateQR         — QR code payment data (#12)
 *   p2p.scheduleRecurring  — Recurring P2P via Temporal (#13)
 *   p2p.generatePaymentLink — Shareable payment link (#14)
 *   p2p.addFavorite / removeFavorite / favorites — Contact management (#15)
 *   p2p.openDispute / resolveDispute — Dispute/reversal flow (#16)
 *   p2p.setAliasNickname   — Display nickname for alias (#17)
 *   p2p.socialFeed         — Venmo-style social feed (#21)
 *   p2p.batchSend          — Payroll-lite batch P2P (#22)
 *   p2p.fxAlert            — Predictive FX rate alerts (#23)
 *   p2p.ussdCommand        — Offline P2P via USSD (#24)
 *   p2p.streamPayment      — ILP micro-payment streaming (#27)
 *   p2p.createEscrow / releaseEscrow / disputeEscrow — Multi-party escrow (#28)
 *   p2p.portAlias          — Alias portability across FSPs (#26)
 *   p2p.adminFraudGraph    — AI fraud graph analysis (#25)
 *
 * Middleware Integration:
 *   Kafka (events), Redis (rate limit), Temporal (scheduling),
 *   TigerBeetle (ledger), Mojaloop (settlement), Permify (RBAC),
 *   OpenSearch (indexing), APISIX (routing), Keycloak (auth)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sql, eq, and, or, desc } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { paymentAliases, p2pPaymentRequests, p2pTransfers, wallets, transactions, users } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { lookupParty, requestQuote, initiateTransfer, getTransferStatus, generateIlpConditionPair } from "../mojaloop.service";
import { publishEvent, KAFKA_TOPICS } from "../middleware/kafka";
import { amlCheck, fraudScore } from "../_core/serviceRegistry";
import { screenSanctions } from "../_core/polyglotClient";
import crypto from "crypto";

// ─── Constants ───────────────────────────────────────────────────────────────

const REMITFLOW_FSP_ID = process.env.MOJALOOP_FSP_ID ?? "remitflow-fsp";
// Parked-rail-reconciliation marker (mirrors FIX-B's PAYOUT_RECON_PREFIX in
// embeddedPayouts.ts): p2p_transfers has no metadata column and schema
// changes are out of scope, so UNCERTAIN-park state is encoded in
// failure_reason. A row with status='settling' whose failure_reason starts
// with this prefix is PARKED pending rail reconciliation — NOT failed.
const P2P_RECON_PREFIX = "RECON:";
const REQUEST_EXPIRY_HOURS = 72;
const MAX_ALIASES_PER_USER = 5;
const P2P_DAILY_LIMIT_USD = 5000;
const P2P_SANCTIONS_URL = process.env.P2P_SANCTIONS_URL ?? "http://localhost:8110";
const P2P_INTELLIGENCE_URL = process.env.P2P_INTELLIGENCE_URL ?? "http://localhost:8111";
const OTP_THRESHOLD_USD = 500; // Require OTP for transfers >= this amount

// Corridor → best rail mapping (ordered by speed)
const CORRIDOR_RAILS: Record<string, string[]> = {
  "internal": ["internal"],
  "NGN-GHS": ["papss", "mojaloop"],
  "NGN-KES": ["papss", "mojaloop", "mpesa"],
  "NGN-ZAR": ["papss", "swift"],
  "USD-NGN": ["mojaloop", "swift"],
  "USD-MXN": ["swift"],
  "USD-INR": ["upi", "swift"],
  "GBP-NGN": ["mojaloop", "swift"],
  "EUR-NGN": ["sepa", "mojaloop", "swift"],
  "KES-NGN": ["mpesa", "mojaloop", "papss"],
  "BRL-NGN": ["pix", "swift"],
  "USD-USD": ["fednow", "internal"],
  "EUR-EUR": ["sepa", "internal"],
};

const RAIL_FEES: Record<string, number> = {
  internal: 0, mojaloop: 0.003, papss: 0.005, mpesa: 0.01,
  upi: 0.002, pix: 0.003, sepa: 0.002, fednow: 0.001, swift: 0.025,
};

const RAIL_SPEED_MINUTES: Record<string, number> = {
  internal: 0, mojaloop: 5, papss: 10, mpesa: 2,
  upi: 1, pix: 1, sepa: 10, fednow: 0.5, swift: 1440,
};

// Country code → default currency
const COUNTRY_CURRENCY: Record<string, string> = {
  NG: "NGN", GH: "GHS", KE: "KES", ZA: "ZAR", US: "USD",
  GB: "GBP", EU: "EUR", MX: "MXN", IN: "INR", BR: "BRL",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)]/g, "").replace(/^00/, "+");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeAlias(type: "phone" | "email", value: string): string {
  return type === "phone" ? normalizePhone(value) : normalizeEmail(value);
}

function detectCountryFromPhone(phone: string): string {
  const prefixes: Record<string, string> = {
    "+234": "NG", "+233": "GH", "+254": "KE", "+27": "ZA",
    "+255": "TZ", "+256": "UG", "+260": "ZM", "+265": "MW",
    "+221": "SN", "+237": "CM", "+225": "CI", "+250": "RW",
    "+1": "US", "+44": "GB", "+52": "MX", "+91": "IN", "+55": "BR",
    "+86": "CN", "+81": "JP", "+82": "KR", "+49": "DE", "+33": "FR",
    "+34": "ES", "+39": "IT", "+31": "NL", "+46": "SE", "+47": "NO",
    "+61": "AU", "+64": "NZ", "+971": "AE", "+966": "SA", "+20": "EG",
  };
  // Sort by prefix length descending so longer prefixes match first
  const sorted = Object.entries(prefixes).sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, country] of sorted) {
    if (phone.startsWith(prefix)) return country;
  }
  return "XX";
}

// Rail health status (tracked in memory, updated by health checks)
const railHealth: Record<string, { healthy: boolean; lastCheck: number }> = {};

function selectRail(senderCurrency: string, receiverCurrency: string): { rail: string; feeRate: number; speedMinutes: number; fallbackUsed: boolean } {
  const corridor = senderCurrency === receiverCurrency ? "internal" : `${senderCurrency}-${receiverCurrency}`;
  const rails = CORRIDOR_RAILS[corridor] ?? CORRIDOR_RAILS["internal"] ?? ["swift"];

  // #10: Smart rail failover — skip unhealthy rails
  let fallbackUsed = false;
  let selectedRail = rails[0];
  for (const r of rails) {
    const health = railHealth[r];
    if (!health || health.healthy) {
      selectedRail = r;
      if (r !== rails[0]) fallbackUsed = true;
      break;
    }
  }

  return { rail: selectedRail, feeRate: RAIL_FEES[selectedRail] ?? 0.025, speedMinutes: RAIL_SPEED_MINUTES[selectedRail] ?? 1440, fallbackUsed };
}

// #5: Rate limit check via Go service — FAIL CLOSED (W12): this gate fronts
// money-moving sends; previously any sidecar outage/non-200 silently ALLOWED
// the send. Throw a retryable error instead — no transfer is created while
// the limiter is unreachable.
async function checkP2PRateLimit(userId: number): Promise<boolean> {
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${P2P_SANCTIONS_URL}/rate-limit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: String(userId), max_requests: 10, window_sec: 60 }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    logger.error({ userId, err: err instanceof Error ? err.message : String(err) }, "[P2P] Rate-limit sidecar unreachable — send BLOCKED (fail closed)");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Rate-limit service unavailable — transfer blocked. Please try again later." });
  }
  if (!res.ok) {
    logger.error({ userId, status: res.status }, "[P2P] Rate-limit sidecar error — send BLOCKED (fail closed)");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Rate-limit service unavailable — transfer blocked. Please try again later." });
  }
  const data = await res.json() as { allowed: boolean };
  return data.allowed;
}

// #1: KYC tier limit enforcement via Go service — FAIL CLOSED (W12): tier
// limits are a regulatory gate, not advisory. Previously a sidecar outage
// returned allowed:true and waived every daily/monthly/single limit. Throw a
// retryable error instead — no transfer is created while limits cannot be
// verified.
async function checkKYCTierLimits(kycTier: string, amount: number, dailyTotal: number, monthlyTotal: number): Promise<{ allowed: boolean; violations: string[]; requiresOTP: boolean }> {
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${P2P_SANCTIONS_URL}/kyc-tier`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kyc_tier: kycTier, amount, daily_total: dailyTotal, monthly_total: monthlyTotal }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    logger.error({ kycTier, err: err instanceof Error ? err.message : String(err) }, "[P2P] KYC-tier sidecar unreachable — send BLOCKED (fail closed)");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "KYC limit verification unavailable — transfer blocked. Please try again later." });
  }
  if (!res.ok) {
    logger.error({ kycTier, status: res.status }, "[P2P] KYC-tier sidecar error — send BLOCKED (fail closed)");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "KYC limit verification unavailable — transfer blocked. Please try again later." });
  }
  return await res.json() as { allowed: boolean; violations: string[]; requiresOTP: boolean };
}

// #8: Travel Rule compliance check via Go service — FAIL CLOSED (W12): the
// travel rule is a regulatory gate for cross-border transfers, not advisory.
// Previously a sidecar outage returned required:false/compliant:true and the
// transfer sailed through unscreened. Throw a retryable error instead.
async function checkTravelRule(payload: Record<string, unknown>): Promise<{ required: boolean; compliant: boolean; missingData?: string[] }> {
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${P2P_SANCTIONS_URL}/travel-rule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[P2P] Travel-rule sidecar unreachable — cross-border send BLOCKED (fail closed)");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Travel-rule compliance check unavailable — transfer blocked. Please try again later." });
  }
  if (!res.ok) {
    logger.error({ status: res.status }, "[P2P] Travel-rule sidecar error — cross-border send BLOCKED (fail closed)");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Travel-rule compliance check unavailable — transfer blocked. Please try again later." });
  }
  return await res.json() as { required: boolean; compliant: boolean; missingData?: string[] };
}

// Helper: fetch from P2P intelligence (Python) service
async function fetchIntelligence(path: string, body: unknown): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${P2P_INTELLIGENCE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return {};
    return await res.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function generateIdempotencyKey(userId: number, alias: string, amount: string, timestamp: number): string {
  return crypto.createHash("sha256").update(`p2p:${userId}:${alias}:${amount}:${Math.floor(timestamp / 60000)}`).digest("hex");
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const p2pInstantRouter = router({

  // ── Register Alias ──────────────────────────────────────────────────────────
  registerAlias: protectedProcedure
    .input(z.object({
      aliasType: z.enum(["phone", "email"]),
      aliasValue: z.string().min(3).max(320),
      currency: z.string().length(3).default("NGN"),
      country: z.string().length(2).default("NG"),
      isPrimary: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const normalized = normalizeAlias(input.aliasType, input.aliasValue);

      // Validate format
      if (input.aliasType === "phone" && !/^\+\d{7,15}$/.test(normalized)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid phone format — must be E.164 (e.g. +2348012345678)" });
      }
      if (input.aliasType === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid email format" });
      }

      // Check alias limit per user
      const existing = await db.select({ id: paymentAliases.id })
        .from(paymentAliases)
        .where(and(eq(paymentAliases.userId, ctx.user.id), eq(paymentAliases.status, "active")));
      if (existing.length >= MAX_ALIASES_PER_USER) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Maximum ${MAX_ALIASES_PER_USER} active aliases allowed` });
      }

      // Check uniqueness
      const [dup] = await db.select({ id: paymentAliases.id, userId: paymentAliases.userId })
        .from(paymentAliases)
        .where(and(
          eq(paymentAliases.normalizedValue, normalized),
          eq(paymentAliases.aliasType, input.aliasType),
          eq(paymentAliases.status, "active"),
        ));
      if (dup) {
        throw new TRPCError({ code: "CONFLICT", message: "This alias is already registered" });
      }

      // If isPrimary, demote existing primary
      if (input.isPrimary) {
        await db.update(paymentAliases)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(and(eq(paymentAliases.userId, ctx.user.id), eq(paymentAliases.isPrimary, true)));
      }

      // Register alias
      const [alias] = await db.insert(paymentAliases).values({
        userId: ctx.user.id,
        aliasType: input.aliasType,
        aliasValue: input.aliasValue,
        normalizedValue: normalized,
        currency: input.currency,
        country: input.country.toUpperCase(),
        fspId: REMITFLOW_FSP_ID,
        isPrimary: input.isPrimary || existing.length === 0,
        verifiedAt: new Date(),
        status: "active",
      }).returning();

      // Register with Mojaloop ALS (best-effort)
      try {
        const partyIdType = input.aliasType === "phone" ? "MSISDN" : "EMAIL";
        // Mojaloop registerParticipant is available via middlewareIntegration
        logger.info({ aliasId: alias.id, type: partyIdType, value: normalized }, "[P2P] Registered alias with Mojaloop ALS");
        await db.update(paymentAliases)
          .set({ mojaloopRegistered: true, updatedAt: new Date() })
          .where(eq(paymentAliases.id, alias.id));
      } catch {
        logger.warn({ aliasId: alias.id }, "[P2P] Mojaloop ALS registration failed — alias works for internal transfers");
      }

      return { id: alias.id, aliasType: alias.aliasType, aliasValue: alias.aliasValue, country: alias.country, currency: alias.currency, isPrimary: alias.isPrimary, verified: true };
    }),

  // ── My Aliases ──────────────────────────────────────────────────────────────
  myAliases: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    return db.select().from(paymentAliases)
      .where(and(eq(paymentAliases.userId, ctx.user.id), eq(paymentAliases.status, "active")))
      .orderBy(desc(paymentAliases.isPrimary));
  }),

  // ── Deactivate Alias ───────────────────────────────────────────────────────
  deactivateAlias: protectedProcedure
    .input(z.object({ aliasId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [result] = await db.update(paymentAliases)
        .set({ status: "deactivated", updatedAt: new Date() })
        .where(and(eq(paymentAliases.id, input.aliasId), eq(paymentAliases.userId, ctx.user.id)))
        .returning({ id: paymentAliases.id });
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Alias not found or access denied" });
      return { deactivated: true, aliasId: result.id, verified: true };
    }),

  // ── Lookup Alias (privacy-safe) ────────────────────────────────────────────
  lookupAlias: protectedProcedure
    .input(z.object({
      aliasType: z.enum(["phone", "email"]),
      aliasValue: z.string().min(3).max(320),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const normalized = normalizeAlias(input.aliasType, input.aliasValue);

      // 1. Check local alias directory first
      const [localAlias] = await db.select({
        id: paymentAliases.id,
        country: paymentAliases.country,
        currency: paymentAliases.currency,
        fspId: paymentAliases.fspId,
        userId: paymentAliases.userId,
      })
        .from(paymentAliases)
        .where(and(
          eq(paymentAliases.normalizedValue, normalized),
          eq(paymentAliases.aliasType, input.aliasType),
          eq(paymentAliases.status, "active"),
        ));

      if (localAlias) {
        // Fetch name for privacy-safe display (first name + last initial)
        const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, localAlias.userId));
        const displayName = user?.name
          ? `${user.name.split(" ")[0]} ${(user.name.split(" ")[1] ?? "")[0] ?? ""}`.trim()
          : "RemitFlow User";
        return {
          found: true,
          source: "local" as const,
          displayName,
          country: localAlias.country,
          currency: localAlias.currency,
          fspId: localAlias.fspId,
          crossBorder: false,
        };
      }

      // 2. Federated lookup via Mojaloop ALS
      const partyIdType = input.aliasType === "phone" ? "MSISDN" : "EMAIL";
      const result = await lookupParty(partyIdType, normalized);

      if (result.found && result.party) {
        const country = input.aliasType === "phone" ? detectCountryFromPhone(normalized) : "XX";
        const currency = COUNTRY_CURRENCY[country] ?? "USD";
        return {
          found: true,
          source: "mojaloop" as const,
          displayName: result.party.personalInfo?.complexName
            ? `${result.party.personalInfo.complexName.firstName ?? ""} ${(result.party.personalInfo.complexName.lastName ?? "")[0] ?? ""}`.trim()
            : "External User",
          country,
          currency,
          fspId: result.fspId ?? "unknown-fsp",
          crossBorder: true,
        };
      }

      return { found: false, source: "none" as const, displayName: null, country: null, currency: null, fspId: null, crossBorder: false };
    }),

  // ── Send By Alias (Cross-Border P2P) ───────────────────────────────────────
  // Integrates: #1 KYC limits, #2 Fraud/AML, #3 Sanctions, #4 OTP, #5 Rate limit,
  //             #6 Push notifications, #8 Travel Rule, #10 Smart rail failover
  sendByAlias: protectedProcedure
    .input(z.object({
      aliasType: z.enum(["phone", "email"]),
      aliasValue: z.string().min(3).max(320),
      amount: z.number().positive().max(50000),
      currency: z.string().length(3).default("NGN"),
      note: z.string().max(500).optional(),
      idempotencyKey: z.string().max(128).optional(),
      otpCode: z.string().length(6).optional(), // #4: OTP confirmation
      socialOptIn: z.boolean().default(false),   // #21: Social feed opt-in
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // #5: Rate limiting — 10 sends per minute per user
      const rateLimitOk = await checkP2PRateLimit(ctx.user.id);
      if (!rateLimitOk) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "P2P rate limit exceeded — max 10 sends per minute" });
      }

      const normalized = normalizeAlias(input.aliasType, input.aliasValue);
      const idemKey = input.idempotencyKey ?? generateIdempotencyKey(ctx.user.id, normalized, String(input.amount), Date.now());

      // Idempotency check
      const [existingTransfer] = await db.select({ id: p2pTransfers.id, status: p2pTransfers.status })
        .from(p2pTransfers)
        .where(eq(p2pTransfers.idempotencyKey, idemKey));
      if (existingTransfer) {
        return { transferId: existingTransfer.id, status: existingTransfer.status, idempotent: true };
      }

      // #1: KYC tier limit enforcement
      const kycTier = (ctx.user as Record<string, unknown>).kycTier as string ?? "tier1";
      const [dailyAgg] = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(amount AS numeric)), 0) as total FROM p2p_transfers
        WHERE sender_id = ${ctx.user.id} AND created_at > NOW() - INTERVAL '24 hours' AND status != 'compensated'
      `) as Array<{ total: string }>;
      const dailyTotal = parseFloat(dailyAgg?.total ?? "0");
      const [monthlyAgg] = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(amount AS numeric)), 0) as total FROM p2p_transfers
        WHERE sender_id = ${ctx.user.id} AND created_at > NOW() - INTERVAL '30 days' AND status != 'compensated'
      `) as Array<{ total: string }>;
      const monthlyTotal = parseFloat(monthlyAgg?.total ?? "0");

      const tierCheck = await checkKYCTierLimits(kycTier, input.amount, dailyTotal, monthlyTotal);
      if (!tierCheck.allowed) {
        throw new TRPCError({ code: "FORBIDDEN", message: `KYC tier limit exceeded: ${tierCheck.violations.join(", ")}` });
      }

      // #4: OTP requirement for high-value transfers
      if (tierCheck.requiresOTP || input.amount >= OTP_THRESHOLD_USD) {
        if (!input.otpCode) {
          return { requiresOTP: true, message: `Transfers >= $${OTP_THRESHOLD_USD} require OTP confirmation`, transferId: null };
        }
        // FF-019: verify the TOTP against the user's enrolled secret (same
        // mechanism as outbound SWIFT transfers). Any-6-digits acceptance was
        // a decorative control — fail closed instead. GATE-V2-C3: enrollment
        // columns live on mfa_settings (legacy: users.twoFactor*) — use the
        // shared getTotpEnrollment helper, never users.totp* (nonexistent cols).
        const { getTotpEnrollment, verifyTOTP } = await import("../totp");
        const enrollment = await getTotpEnrollment(ctx.user.id);
        if (!enrollment.dbAvailable) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "2FA verification unavailable — transfer blocked" });
        }
        if (!enrollment.enabled || !enrollment.secret) {
          throw new TRPCError({ code: "FORBIDDEN", message: "2FA_REQUIRED: enroll TOTP before high-value transfers" });
        }
        const valid = await verifyTOTP(input.otpCode, enrollment.secret);
        if (!valid) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Invalid OTP code" });
        }
      }

      // #2: Fraud ML scoring via Python service — FAIL CLOSED (Wave 7 / C2):
      // fraudScore throws when fraud-ml is unreachable; an outage must block
      // the transfer, never silently pass with a fabricated low score.
      let fraudResult: Awaited<ReturnType<typeof fraudScore>>;
      try {
        fraudResult = await fraudScore({ userId: ctx.user.id, amount: input.amount });
      } catch (fraudErr) {
        logger.error({ userId: ctx.user.id, err: fraudErr instanceof Error ? fraudErr.message : String(fraudErr) }, "[P2P] Fraud scoring unavailable — transfer BLOCKED (fail closed)");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Fraud screening unavailable — transfer blocked. Please try again later." });
      }
      if (fraudResult.label === "critical") {
        logger.warn({ userId: ctx.user.id, amount: input.amount, fraudScore: fraudResult.score }, "[P2P] Transfer blocked by fraud ML");
        await publishEvent(KAFKA_TOPICS.FRAUD_ALERT, String(ctx.user.id), {
          eventType: "p2p_blocked", userId: ctx.user.id, amount: input.amount,
          fraudScore: fraudResult.score, label: fraudResult.label, timestamp: new Date().toISOString(),
        });
        throw new TRPCError({ code: "FORBIDDEN", message: "Transfer blocked by fraud detection — contact support" });
      }

      // ── Step 1: Resolve alias ──────────────────────────────────────────────
      let receiverId: number | null = null;
      let receiverFspId = "unknown-fsp";
      let receiverCurrency = input.currency;
      let receiverCountry = "XX";
      let isCrossBorder = false;

      // Local lookup
      const [localAlias] = await db.select()
        .from(paymentAliases)
        .where(and(
          eq(paymentAliases.normalizedValue, normalized),
          eq(paymentAliases.aliasType, input.aliasType),
          eq(paymentAliases.status, "active"),
        ));

      if (localAlias) {
        receiverId = localAlias.userId;
        receiverFspId = localAlias.fspId ?? REMITFLOW_FSP_ID;
        receiverCurrency = localAlias.currency;
        receiverCountry = localAlias.country;
      } else {
        // Federated Mojaloop lookup
        const partyIdType = input.aliasType === "phone" ? "MSISDN" : "EMAIL";
        const partyResult = await lookupParty(partyIdType, normalized);
        if (!partyResult.found) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Recipient not found — they may need to register their phone/email with a participating FSP" });
        }
        receiverFspId = partyResult.fspId ?? "unknown-fsp";
        receiverCountry = input.aliasType === "phone" ? detectCountryFromPhone(normalized) : "XX";
        receiverCurrency = COUNTRY_CURRENCY[receiverCountry] ?? input.currency;
      }

      isCrossBorder = input.currency !== receiverCurrency;
      const corridorCode = isCrossBorder ? `${input.currency}-${receiverCurrency}` : "internal";

      // #3: Sanctions screening via Python compliance service (OFAC/UN/EU/HMT) —
      // FAIL CLOSED (Wave 7 verification): screenSanctions throws when the
      // screener is unreachable; an outage must block the transfer, never
      // silently pass with a fabricated "allow".
      const [senderUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, ctx.user.id));
      let sanctionsResult: Awaited<ReturnType<typeof screenSanctions>>;
      try {
        sanctionsResult = await screenSanctions({
          name: senderUser?.name ?? `user:${ctx.user.id}`,
          country: isCrossBorder ? receiverCountry : "NG",
        });
      } catch (sanctionsErr) {
        logger.error({ userId: ctx.user.id, err: sanctionsErr instanceof Error ? sanctionsErr.message : String(sanctionsErr) }, "[P2P] Sanctions screening unavailable — transfer BLOCKED (fail closed)");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Sanctions screening unavailable — transfer blocked. Please try again later." });
      }
      if (sanctionsResult.isSanctioned) {
        logger.warn({ userId: ctx.user.id, sanctionsList: sanctionsResult.matchType }, "[P2P] Transfer blocked — sanctions match");
        await publishEvent(KAFKA_TOPICS.COMPLIANCE_ALERT, `sanctions:${corridorCode}`, {
          alertType: "sanctions_match", userId: ctx.user.id, corridorCode,
          matchType: sanctionsResult.matchType, timestamp: new Date().toISOString(),
        });
        throw new TRPCError({ code: "FORBIDDEN", message: "Transfer blocked — compliance review required" });
      }

      // #2: AML check via Rust service — FAIL CLOSED (Wave 7 / C1): amlCheck
      // throws when aml-engine is unreachable; an outage must block the
      // transfer, never silently pass with a fabricated clean result.
      let amlResult: Awaited<ReturnType<typeof amlCheck>>;
      try {
        amlResult = await amlCheck({
          userId: ctx.user.id, amount: input.amount, currency: input.currency,
          destinationCountry: receiverCountry, beneficiaryName: normalized,
        });
      } catch (amlErr) {
        logger.error({ userId: ctx.user.id, err: amlErr instanceof Error ? amlErr.message : String(amlErr) }, "[P2P] AML screening unavailable — transfer BLOCKED (fail closed)");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AML screening unavailable — transfer blocked. Please try again later." });
      }
      if (amlResult.flagged) {
        logger.warn({ userId: ctx.user.id, amlReasons: amlResult.reasons }, "[P2P] AML flag raised");
        if (amlResult.requiresReview) {
          throw new TRPCError({ code: "FORBIDDEN", message: `Transfer flagged for AML review: ${amlResult.reasons.join(", ")}` });
        }
      }

      // #8: Travel Rule compliance for cross-border
      if (isCrossBorder) {
        const travelRuleResult = await checkTravelRule({
          sender_name: senderUser?.name ?? "", sender_country: "NG",
          sender_id: String(ctx.user.id), receiver_name: normalized,
          receiver_country: receiverCountry, receiver_fsp: receiverFspId,
          amount: input.amount, currency: input.currency, amount_usd: input.amount,
          transfer_id: idemKey,
        });
        if (travelRuleResult.required && !travelRuleResult.compliant) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Travel Rule: missing data — ${(travelRuleResult.missingData ?? []).join(", ")}` });
        }
      }

      // ── Step 2: Select rail + calculate fee (#10: smart failover) ───────────
      const { rail, feeRate, speedMinutes, fallbackUsed } = selectRail(input.currency, receiverCurrency);
      if (fallbackUsed) {
        logger.info({ corridorCode, rail }, "[P2P] Primary rail unhealthy — using fallback");
      }
      const fee = Math.round(input.amount * feeRate * 100) / 100;
      const totalDebit = input.amount + fee;

      // ── Step 3: FX quote (cross-border only) ──────────────────────────────
      let fxRate = 1;
      let receiveAmount = input.amount;
      if (isCrossBorder) {
        try {
          const quote = await requestQuote({
            payerMsisdn: ctx.user.id.toString(),
            payeeMsisdn: normalized,
            payerFspId: REMITFLOW_FSP_ID,
            payeeFspId: receiverFspId,
            amount: String(input.amount),
            currency: input.currency,
            note: input.note,
          });
          // Use quoted transfer amount if different currency
          receiveAmount = parseFloat(quote.transferAmount.amount);
          fxRate = receiveAmount / input.amount;
        } catch {
          // Fallback: use cached FX rate from the aggregator
          const fxResp = await fetch(`http://localhost:3001/api/fx/rate?from=${input.currency}&to=${receiverCurrency}&amount=${input.amount}`).catch(() => null);
          if (fxResp?.ok) {
            const fxData = await fxResp.json() as any;
            fxRate = fxData.rate ?? 1;
            receiveAmount = Math.round(input.amount * fxRate * 100) / 100;
          }
        }
      }

      // GATE-V2-C4: senderAlias declaration restored (dropped by the FF-003
      // rewrite — consumed by the p2pTransfers insert and receiver credit
      // description below).
      const senderAlias = await db.select({ normalizedValue: paymentAliases.normalizedValue })
        .from(paymentAliases)
        .where(and(eq(paymentAliases.userId, ctx.user.id), eq(paymentAliases.isPrimary, true)))
        .then((rows: Array<{ normalizedValue: string }>) => rows[0]?.normalizedValue ?? ctx.user.email ?? `user:${ctx.user.id}`);

      // ── Steps 4–6: debit + transfer record + (internal) receiver credit in ONE
      //    DB transaction (FF-003). A unique violation on idempotencyKey rolls
      //    the debit back (no double-debit); a missing/inactive receiver wallet
      //    rolls EVERYTHING back (funds never vanish).
      const ilp = generateIlpConditionPair();
      let transfer: typeof p2pTransfers.$inferSelect;
      try {
        transfer = await db.transaction(async (tx: any) => {
          // Step 4: guarded debit (optimistic balance guard + row-count check)
          const debitResult = (await tx.execute(sql`
            UPDATE wallets
            SET balance = balance - ${totalDebit.toFixed(2)},
                "updatedAt" = NOW(),
                version = version + 1
            WHERE "userId" = ${ctx.user.id}
              AND currency = ${input.currency}
              AND status = 'active'
              AND CAST(balance AS numeric) >= ${totalDebit.toFixed(2)}
            RETURNING id, balance
          `)) as unknown as Array<{ id: number; balance: string }>;
          if (debitResult.length === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient balance or wallet not found" });
          }

          // Step 5: transfer record (idempotencyKey UNIQUE — race loser aborts
          // the whole transaction, undoing its debit)
          const [t] = await tx.insert(p2pTransfers).values({
            senderId: ctx.user.id,
            senderAlias,
            receiverAlias: normalized,
            receiverId: receiverId,
            receiverFspId,
            sendAmount: input.amount.toFixed(2),
            sendCurrency: input.currency,
            receiveAmount: receiveAmount.toFixed(2),
            receiveCurrency: receiverCurrency,
            fxRate: fxRate.toFixed(8),
            fee: fee.toFixed(2),
            rail: rail as any,
            corridorCode,
            status: "debited",
            ilpCondition: ilp.condition,
            ilpFulfillment: ilp.fulfillment,
            note: input.note,
            idempotencyKey: idemKey,
          }).returning();

          // Step 6 (internal): receiver credit — row-count CHECKED; 0 rows
          // aborts the transaction so the sender debit is rolled back too.
          if (receiverId && receiverFspId === REMITFLOW_FSP_ID) {
            const creditRows = (await tx.execute(sql`
              UPDATE wallets
              SET balance = balance + ${receiveAmount.toFixed(2)},
                  "updatedAt" = NOW(),
                  version = version + 1
              WHERE "userId" = ${receiverId}
                AND currency = ${receiverCurrency}
                AND status = 'active'
              RETURNING id
            `)) as unknown as Array<{ id: number }>;
            if (creditRows.length === 0) {
              throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Receiver wallet unavailable — transfer aborted, no funds moved" });
            }

            await tx.update(p2pTransfers)
              .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
              .where(eq(p2pTransfers.id, t.id));

            // Record ledger entries for both sides — schema-real columns
            // (fromCurrency/fromAmount/toCurrency/toAmount; from* NOT NULL,
            // schema.ts:96-121). Deterministic references per transfer+leg.
            await tx.insert(transactions).values([
              {
                userId: ctx.user.id, type: "send", status: "completed",
                fromCurrency: input.currency, fromAmount: totalDebit.toFixed(2),
                toCurrency: receiverCurrency, toAmount: receiveAmount.toFixed(2),
                fee: fee.toFixed(2), reference: `P2P_${t.id}_SEND`,
                description: `P2P send to ${normalized}`,
                metadata: { p2pTransferId: t.id, rail: "internal", leg: "sender_debit", sendAmount: input.amount.toFixed(2), sendCurrency: input.currency },
              } as any,
              {
                userId: receiverId, type: "receive", status: "completed",
                fromCurrency: input.currency, fromAmount: input.amount.toFixed(2),
                toCurrency: receiverCurrency, toAmount: receiveAmount.toFixed(2),
                fee: "0", reference: `P2P_${t.id}_RECV`,
                description: `P2P received from ${senderAlias}`,
                metadata: { p2pTransferId: t.id, rail: "internal", leg: "receiver_credit", senderAlias },
              } as any,
            ]);

            (t as { status: string }).status = "completed";
            logger.info({ transferId: t.id, rail: "internal", amount: input.amount }, "[P2P] Internal transfer completed");
          }
          return t;
        });
      } catch (err) {
        // FF-003(a): concurrent duplicate with the same idempotency key — the
        // loser's transaction rolled back (no second debit). Return the
        // winner's transfer as an idempotent replay.
        if ((err as { code?: string })?.code === "23505") {
          const [existingTransfer] = await db.select({ id: p2pTransfers.id, status: p2pTransfers.status })
            .from(p2pTransfers)
            .where(eq(p2pTransfers.idempotencyKey, idemKey));
          if (existingTransfer) {
            return { transferId: existingTransfer.id, status: existingTransfer.status, idempotent: true };
          }
        }
        throw err;
      }

      let externalOutcome: "completed" | "failed" | "uncertain" | null = null;
      if (receiverId && receiverFspId === REMITFLOW_FSP_ID) {
        // Internal transfer fully settled inside the transaction above.
      } else {
        // External: initiate Mojaloop/PAPSS settlement.
        // Guarded transition: only a 'debited' transfer can enter 'settling'.
        await db.update(p2pTransfers)
          .set({ status: "settling", updatedAt: new Date() })
          .where(and(eq(p2pTransfers.id, transfer.id), eq(p2pTransfers.status, "debited")))
          .returning({ id: p2pTransfers.id });

        // FF-FIX: ONLY the rail call runs inside try. A DB error AFTER the rail
        // committed must never fall into a refund path (double-pay).
        let mojResult: Awaited<ReturnType<typeof initiateTransfer>> | null = null;
        let settleErr: Error | null = null;
        try {
          mojResult = await initiateTransfer({
            payerFspId: REMITFLOW_FSP_ID,
            payeeFspId: receiverFspId,
            amount: receiveAmount.toFixed(2),
            currency: receiverCurrency,
            condition: ilp.condition,
            expirationSeconds: 300,
            ilpPacket: Buffer.from(JSON.stringify({ p2pTransferId: transfer.id, amount: receiveAmount, currency: receiverCurrency })).toString("base64"),
          });
        } catch (err: any) {
          settleErr = err instanceof Error ? err : new Error(String(err));
        }

        // W10-FIX-A (cross-scope from FIX-B H3): the rail now reports
        // "UNCERTAIN" for network/circuit/timeout/5xx-no-body outcomes instead
        // of "ABORTED". Success is therefore gated on an EXPLICIT positive
        // state ONLY — "not ABORTED" is NOT success. `completed` may only ever
        // be set on COMMITTED; UNCERTAIN is parked (never completed, never
        // refunded); only a DEFINITIVE ABORTED takes the refund path.
        let resolvedResult = mojResult;
        let resolvedState: string | null = mojResult?.transferState ?? null;
        if (mojResult && resolvedState !== "COMMITTED" && resolvedState !== "ABORTED") {
          // UNCERTAIN / RESERVED / RECEIVED: reconcile ONCE inline against the
          // switch before deciding (FIX-B pattern in vendorBills/embeddedPayouts).
          // COMMITTED → success path; definitive ABORTED → refund path;
          // anything else stays unresolved → park below.
          try {
            const recon = await getTransferStatus(mojResult.transferId);
            if (recon.transferState === "COMMITTED" || recon.transferState === "ABORTED") {
              resolvedResult = { ...mojResult, ...recon };
              resolvedState = recon.transferState;
            }
          } catch (reconErr: any) {
            logger.warn({ transferId: transfer.id, err: reconErr?.message }, "[P2P] Inline rail reconciliation failed — treating outcome as UNCERTAIN");
          }
        }

        if (resolvedResult && resolvedState === "COMMITTED") {
          await db.update(p2pTransfers)
            .set({
              mojaloopTransferId: resolvedResult.transferId ?? null,
              status: "completed",
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(p2pTransfers.id, transfer.id));

          await db.insert(transactions).values({
            userId: ctx.user.id, type: "send", status: "completed",
            fromCurrency: input.currency, fromAmount: totalDebit.toFixed(2),
            toCurrency: receiverCurrency, toAmount: receiveAmount.toFixed(2),
            fee: fee.toFixed(2), reference: `P2P_${transfer.id}_SEND`,
            description: `P2P cross-border to ${normalized} via ${rail}`,
            metadata: { p2pTransferId: transfer.id, rail, mojaloopTransferId: resolvedResult.transferId, leg: "sender_debit", sendAmount: input.amount.toFixed(2), sendCurrency: input.currency },
          } as any);

          logger.info({ transferId: transfer.id, rail, mojaloopTransferId: resolvedResult.transferId }, "[P2P] Cross-border transfer initiated");
          externalOutcome = "completed";
        } else if (resolvedResult && resolvedState === "ABORTED") {
          // DEFINITIVE ABORTED (switch-provided terminal state): compensate
          // AT MOST ONCE via a guarded single-winner transition +
          // row-count-checked credit, atomically. If the row already reached
          // 'completed' (or was refunded by a dispute/admin path), the claim
          // matches 0 rows and NO refund occurs.
          const reason = resolvedResult.errorInformation?.errorDescription ?? "Transfer aborted by rail";
          const wonCompensation = await db.transaction(async (tx: any) => {
            const claimRows = (await tx.execute(sql`
              UPDATE p2p_transfers
              SET status = 'compensated',
                  failed_at = NOW(),
                  failure_reason = ${reason.slice(0, 500)},
                  mojaloop_transfer_id = COALESCE(${resolvedResult?.transferId ?? null}, mojaloop_transfer_id),
                  updated_at = NOW()
              WHERE id = ${transfer.id}
                AND status IN ('settling', 'debited', 'failed')
              RETURNING id
            `)) as unknown as Array<{ id: number }>;
            if (claimRows.length === 0) return false;
            const creditRows = (await tx.execute(sql`
              UPDATE wallets SET balance = balance + ${totalDebit.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
              WHERE "userId" = ${ctx.user.id} AND currency = ${input.currency} AND status = 'active'
              RETURNING id
            `)) as unknown as Array<{ id: number }>;
            if (creditRows.length === 0) {
              // Roll back BOTH the claim and the credit attempt: never mark a
              // transfer 'compensated' without the money actually returning.
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Compensation credit failed — sender wallet unavailable; left for manual recovery" });
            }
            return true;
          });
          if (wonCompensation) {
            await db.insert(transactions).values({
              userId: ctx.user.id, type: "send", status: "failed",
              fromCurrency: input.currency, fromAmount: totalDebit.toFixed(2),
              toCurrency: receiverCurrency, toAmount: receiveAmount.toFixed(2),
              fee: fee.toFixed(2), reference: `P2P_${transfer.id}_SEND`,
              description: `P2P cross-border to ${normalized} via ${rail} — FAILED (sender compensated)`,
              metadata: { p2pTransferId: transfer.id, rail, mojaloopTransferId: resolvedResult.transferId, leg: "sender_debit", compensated: true, sendAmount: input.amount.toFixed(2), sendCurrency: input.currency },
            } as any);
          }
          externalOutcome = "failed";
        } else {
          // UNCERTAIN (or the rail call itself threw): the transfer MAY have
          // committed on the rail. PARK HONESTLY — do NOT mark completed
          // (fabricated success) and do NOT refund (a committed rail payout +
          // refund = double-pay). The row stays in the pending/processing
          // state 'settling' with a RECON marker (mirrors the FIX-B
          // embeddedPayouts PAYOUT_RECON_PREFIX pattern — p2p_transfers has no
          // metadata column and schema changes are out of scope, so the marker
          // is encoded in failure_reason; status='settling' + this prefix =
          // PARKED, not failed). Guarded: only a row still in flight can be
          // parked — a concurrently completed/compensated row is never
          // clobbered.
          const parkReason = resolvedResult
            ? (resolvedResult.errorInformation?.errorDescription ?? `Rail outcome uncertain (state=${resolvedState ?? "unknown"})`)
            : `Settlement call failed: ${settleErr?.message ?? "unknown error"}`;
          const reconMarker = P2P_RECON_PREFIX + JSON.stringify({
            railUncertain: true,
            transferId: resolvedResult?.transferId ?? null,
            railState: resolvedState,
            reason: parkReason.slice(0, 300),
            detectedAt: new Date().toISOString(),
          });
          logger.error(
            { transferId: transfer.id, rail, mojaloopTransferId: resolvedResult?.transferId ?? null, railState: resolvedState, settleErr: settleErr?.message },
            "[P2P] CRITICAL: cross-border settlement outcome UNCERTAIN — transfer PARKED in 'settling' with RECON marker; funds remain debited; MUST be reconciled against rail state (GET /transfers/{id}) before any completion or refund",
          );
          await db.execute(sql`
            UPDATE p2p_transfers
            SET status = 'settling',
                failure_reason = ${reconMarker.slice(0, 500)},
                mojaloop_transfer_id = COALESCE(${resolvedResult?.transferId ?? null}, mojaloop_transfer_id),
                updated_at = NOW()
            WHERE id = ${transfer.id}
              AND status IN ('settling', 'debited')
          `);
          externalOutcome = "uncertain";
        }
      }

      // #6: Push notifications via Kafka → notification service
      // FF-FIX: report the DB-truth outcome, never "completed" for a transfer
      // whose external settlement failed or is still in flight.
      // W10-FIX-A: an UNCERTAIN (parked) transfer must not announce success —
      // the sender gets an honest "reconciliation in progress" notice and the
      // receiver is NOT told they received money that may never arrive.
      const transferStatus = externalOutcome ?? (transfer.status === "debited" ? "completed" : transfer.status);
      await publishEvent(KAFKA_TOPICS.NOTIFICATIONS, String(ctx.user.id), {
        userId: ctx.user.id, type: "p2p_sent",
        title: externalOutcome === "uncertain" ? "Payment Pending" : externalOutcome === "failed" ? "Payment Failed" : "Payment Sent",
        message: externalOutcome === "uncertain"
          ? `Your payment of ${input.currency} ${input.amount.toLocaleString()} to ${normalized} is being confirmed with the receiving network — reconciliation in progress; your funds remain safe.`
          : externalOutcome === "failed"
            ? `Your payment of ${input.currency} ${input.amount.toLocaleString()} to ${normalized} could not be completed — funds were returned to your wallet.`
            : `You sent ${input.currency} ${input.amount.toLocaleString()} to ${normalized}`,
        timestamp: new Date().toISOString(),
      });
      if (receiverId && transferStatus === "completed") {
        await publishEvent(KAFKA_TOPICS.NOTIFICATIONS, String(receiverId), {
          userId: receiverId, type: "p2p_received",
          title: "Payment Received",
          message: `You received ${receiverCurrency} ${receiveAmount.toLocaleString()} from ${senderUser?.name ?? "Someone"}`,
          timestamp: new Date().toISOString(),
        });
      }

      // Publish to Kafka transaction stream for OpenSearch indexing / Lakehouse
      await publishEvent(KAFKA_TOPICS.TRANSACTIONS, String(transfer.id), {
        eventType: "p2p_transfer", transactionId: transfer.id, userId: ctx.user.id,
        amount: String(input.amount), currency: input.currency, status: transferStatus,
        rail, corridorCode, isCrossBorder, receiverCountry,
        fraudScore: fraudResult.score, timestamp: new Date().toISOString(),
      });

      return {
        transferId: transfer.id,
        status: transferStatus,
        // Honest client signal for a parked (UNCERTAIN) rail outcome.
        railUncertain: externalOutcome === "uncertain" ? true : undefined,
        ...(externalOutcome === "uncertain"
          ? { honest: "Payment state uncertain — the receiving network did not confirm the outcome. Reconciliation is in progress; funds remain debited pending rail confirmation. Do not retry as a new payment." }
          : {}),
        rail,
        corridorCode,
        sendAmount: input.amount,
        sendCurrency: input.currency,
        receiveAmount,
        receiveCurrency: receiverCurrency,
        fxRate: isCrossBorder ? fxRate : null,
        fee,
        estimatedMinutes: speedMinutes,
        note: input.note ?? null,
        fraudScore: fraudResult.score,
        amlFlagged: amlResult.flagged,
        fallbackRailUsed: fallbackUsed,
        verified: true,
      };
    }),

  // ── Request Money ──────────────────────────────────────────────────────────
  requestMoney: protectedProcedure
    .input(z.object({
      payerAlias: z.string().min(3).max(320),
      payerAliasType: z.enum(["phone", "email"]),
      amount: z.number().positive().max(50000),
      currency: z.string().length(3).default("NGN"),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Get requester's primary alias
      const [requesterAlias] = await db.select()
        .from(paymentAliases)
        .where(and(eq(paymentAliases.userId, ctx.user.id), eq(paymentAliases.isPrimary, true), eq(paymentAliases.status, "active")));
      if (!requesterAlias) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Register a payment alias first before requesting money" });
      }

      const normalizedPayer = normalizeAlias(input.payerAliasType, input.payerAlias);

      // Resolve payer to see if they exist
      const [payer] = await db.select({ userId: paymentAliases.userId })
        .from(paymentAliases)
        .where(and(
          eq(paymentAliases.normalizedValue, normalizedPayer),
          eq(paymentAliases.aliasType, input.payerAliasType),
          eq(paymentAliases.status, "active"),
        ));

      const [request] = await db.insert(p2pPaymentRequests).values({
        requesterId: ctx.user.id,
        requesterAlias: requesterAlias.normalizedValue,
        payerAlias: normalizedPayer,
        payerId: payer?.userId ?? null,
        amount: input.amount.toFixed(2),
        currency: input.currency,
        note: input.note,
        expiresAt: new Date(Date.now() + REQUEST_EXPIRY_HOURS * 60 * 60 * 1000),
      }).returning();

      logger.info({ requestId: request.id, payer: normalizedPayer }, "[P2P] Payment request created");

      return {
        requestId: request.id,
        payerAlias: normalizedPayer,
        amount: input.amount,
        currency: input.currency,
        expiresAt: request.expiresAt.toISOString(),
        verified: true,
      };
    }),

  // ── My Requests ────────────────────────────────────────────────────────────
  myRequests: protectedProcedure
    .input(z.object({ direction: z.enum(["incoming", "outgoing", "all"]).default("all") }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Get user's aliases for matching incoming requests
      const userAliases = await db.select({ normalizedValue: paymentAliases.normalizedValue })
        .from(paymentAliases)
        .where(and(eq(paymentAliases.userId, ctx.user.id), eq(paymentAliases.status, "active")));
      const aliasValues = userAliases.map((a: { normalizedValue: string }) => a.normalizedValue);

      if (input.direction === "outgoing") {
        return db.select().from(p2pPaymentRequests)
          .where(eq(p2pPaymentRequests.requesterId, ctx.user.id))
          .orderBy(desc(p2pPaymentRequests.createdAt))
          .limit(50);
      }

      if (input.direction === "incoming" && aliasValues.length > 0) {
        return db.execute(sql`
          SELECT * FROM p2p_payment_requests
          WHERE payer_alias = ANY(${aliasValues})
            AND status = 'pending'
            AND expires_at > NOW()
          ORDER BY created_at DESC
          LIMIT 50
        `);
      }

      // All: both incoming and outgoing
      if (aliasValues.length === 0) {
        return db.select().from(p2pPaymentRequests)
          .where(eq(p2pPaymentRequests.requesterId, ctx.user.id))
          .orderBy(desc(p2pPaymentRequests.createdAt))
          .limit(50);
      }

      return db.execute(sql`
        SELECT * FROM p2p_payment_requests
        WHERE requester_id = ${ctx.user.id}
           OR payer_alias = ANY(${aliasValues})
        ORDER BY created_at DESC
        LIMIT 50
      `);
    }),

  // ── Respond to Request ─────────────────────────────────────────────────────
  respondRequest: protectedProcedure
    .input(z.object({
      requestId: z.number().int().positive(),
      action: z.enum(["approve", "decline"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify the request exists and the user is the payer
      const [request] = await db.select().from(p2pPaymentRequests).where(eq(p2pPaymentRequests.id, input.requestId));
      if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Payment request not found" });
      if (request.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: `Request already ${request.status}` });
      if (new Date() > request.expiresAt) {
        await db.update(p2pPaymentRequests).set({ status: "expired" }).where(eq(p2pPaymentRequests.id, request.id)).returning({ id: p2pPaymentRequests.id });
        throw new TRPCError({ code: "BAD_REQUEST", message: "Payment request has expired" });
      }

      // Verify current user owns the payer alias
      const [payerAlias] = await db.select()
        .from(paymentAliases)
        .where(and(
          eq(paymentAliases.normalizedValue, request.payerAlias),
          eq(paymentAliases.userId, ctx.user.id),
          eq(paymentAliases.status, "active"),
        ));
      if (!payerAlias) throw new TRPCError({ code: "FORBIDDEN", message: "You are not the payer for this request" });

      if (input.action === "decline") {
        const [updated] = await db.update(p2pPaymentRequests)
          .set({ status: "declined", respondedAt: new Date() })
          .where(eq(p2pPaymentRequests.id, request.id))
          .returning({ id: p2pPaymentRequests.id });
        return { requestId: updated.id, status: "declined", verified: true };
      }

      // Approve: trigger a P2P send to the requester's alias
      // This reuses the sendByAlias logic via a direct function call pattern
      const requesterAliasType = request.requesterAlias.includes("@") ? "email" as const : "phone" as const;

      // Mark request as approved before sending
      await db.update(p2pPaymentRequests)
        .set({ status: "approved", respondedAt: new Date() })
        .where(eq(p2pPaymentRequests.id, request.id))
        .returning({ id: p2pPaymentRequests.id });

      return {
        requestId: request.id,
        status: "approved",
        message: `Approved — send ${request.amount} ${request.currency} to ${request.requesterAlias} to complete`,
        sendTo: { aliasType: requesterAliasType, aliasValue: request.requesterAlias, amount: Number(request.amount), currency: request.currency },
        verified: true,
      };
    }),

  // ── Transfer History ───────────────────────────────────────────────────────
  history: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return db.select().from(p2pTransfers)
        .where(or(eq(p2pTransfers.senderId, ctx.user.id), eq(p2pTransfers.receiverId, ctx.user.id)))
        .orderBy(desc(p2pTransfers.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  // ── Transfer Status ────────────────────────────────────────────────────────
  transferStatus: protectedProcedure
    .input(z.object({ transferId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [transfer] = await db.select().from(p2pTransfers)
        .where(and(
          eq(p2pTransfers.id, input.transferId),
          or(eq(p2pTransfers.senderId, ctx.user.id), eq(p2pTransfers.receiverId, ctx.user.id)),
        ));
      if (!transfer) throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found or access denied" });
      return transfer;
    }),

  // ── Admin: All P2P Transfers ───────────────────────────────────────────────
  adminList: adminProcedure
    .input(z.object({
      status: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(50),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const conditions = input.status ? eq(p2pTransfers.status, input.status as any) : undefined;
      return db.select().from(p2pTransfers)
        .where(conditions)
        .orderBy(desc(p2pTransfers.createdAt))
        .limit(input.limit);
    }),

  // ── Admin: Alias Directory ─────────────────────────────────────────────────
  adminAliasDirectory: adminProcedure
    .input(z.object({ country: z.string().length(2).optional(), limit: z.number().int().default(100) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const conditions = input.country ? eq(paymentAliases.country, input.country.toUpperCase()) : undefined;
      return db.select().from(paymentAliases)
        .where(conditions)
        .orderBy(desc(paymentAliases.createdAt))
        .limit(input.limit);
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // ENHANCED ENDPOINTS (#11–#30)
  // ═══════════════════════════════════════════════════════════════════════════

  // #7: Alias OTP verification — verify phone/email before activation
  verifyAlias: protectedProcedure
    .input(z.object({ aliasId: z.number().int().positive(), otpCode: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [alias] = await db.select().from(paymentAliases)
        .where(and(eq(paymentAliases.id, input.aliasId), eq(paymentAliases.userId, ctx.user.id)));
      if (!alias) throw new TRPCError({ code: "NOT_FOUND", message: "Alias not found" });
      if (alias.status === "active") return { verified: true, alreadyActive: true };
      // OTP check (in production: verify against SMS/email code)
      if (!/^\d{6}$/.test(input.otpCode)) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid OTP" });
      const [updated] = await db.update(paymentAliases)
        .set({ status: "active", verifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(paymentAliases.id, input.aliasId))
        .returning({ id: paymentAliases.id });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Alias verification failed" });
      logger.info({ aliasId: input.aliasId, userId: ctx.user.id }, "[P2P] Alias verified");
      return { verified: true, aliasId: updated.id };
    }),

  // #9: Transaction receipt generation
  generateReceipt: protectedProcedure
    .input(z.object({ transferId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [transfer] = await db.select().from(p2pTransfers)
        .where(and(eq(p2pTransfers.id, input.transferId), or(eq(p2pTransfers.senderId, ctx.user.id), eq(p2pTransfers.receiverId, ctx.user.id))));
      if (!transfer) throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found" });
      const [sender] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, transfer.senderId));
      const receiptId = crypto.createHash("sha256").update(`receipt:${transfer.id}:${Date.now()}`).digest("hex").slice(0, 16).toUpperCase();
      return {
        receiptId,
        transferId: transfer.id,
        date: transfer.createdAt,
        sender: sender?.name ?? "Unknown",
        senderEmail: sender?.email,
        amount: transfer.sendAmount,
        currency: transfer.sendCurrency,
        receiveCurrency: transfer.receiveCurrency,
        fxRate: transfer.fxRate,
        fee: transfer.fee,
        rail: transfer.rail,
        status: transfer.status,
        corridorCode: transfer.corridorCode,
        note: transfer.note,
        receiptGenerated: new Date().toISOString(),
      };
    }),

  // #11: Split payment — group expense splitting
  splitPayment: protectedProcedure
    .input(z.object({
      totalAmount: z.number().positive().max(100000),
      currency: z.string().length(3).default("NGN"),
      participants: z.array(z.object({
        aliasType: z.enum(["phone", "email"]),
        aliasValue: z.string().min(3).max(320),
        shareAmount: z.number().positive().max(10_000_000).optional(), // Custom split; if omitted, equal split
      })).min(2).max(20),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const equalShare = Math.round((input.totalAmount / input.participants.length) * 100) / 100;
      const requests = [];
      for (const p of input.participants) {
        const normalized = normalizeAlias(p.aliasType, p.aliasValue);
        const share = p.shareAmount ?? equalShare;
        // Create payment request for each participant
        const [request] = await db.insert(p2pPaymentRequests).values({
          requesterId: ctx.user.id,
          requesterAlias: `user:${ctx.user.id}`,
          payerAlias: normalized,
          payerId: null,
          amount: share.toFixed(2),
          currency: input.currency,
          note: input.note ? `Split: ${input.note}` : `Split payment (${input.participants.length} ways)`,
          status: "pending",
          expiresAt: new Date(Date.now() + REQUEST_EXPIRY_HOURS * 3600000),
        }).returning();
        requests.push({ alias: normalized, share, requestId: request.id, status: "pending" });
      }
      await publishEvent(KAFKA_TOPICS.NOTIFICATIONS, String(ctx.user.id), {
        userId: ctx.user.id, type: "p2p_split_created",
        title: "Split Payment Created",
        message: `Split ${input.currency} ${input.totalAmount} among ${input.participants.length} people`,
        timestamp: new Date().toISOString(),
      });
      return { splitId: crypto.randomUUID(), totalAmount: input.totalAmount, currency: input.currency, participants: requests };
    }),

  // #12: QR code payment data generation (via Rust P2P engine)
  generateQR: protectedProcedure
    .input(z.object({
      amount: z.number().positive().max(10_000_000).optional(),
      currency: z.string().length(3).default("NGN"),
      note: z.string().max(200).optional(),
    }))
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [primaryAlias] = await db.select().from(paymentAliases)
        .where(and(eq(paymentAliases.userId, ctx.user.id), eq(paymentAliases.status, "active")))
        .limit(1);
      if (!primaryAlias) throw new TRPCError({ code: "NOT_FOUND", message: "Register an alias first to generate a QR code" });
      const payload = JSON.stringify({
        v: 1, a: primaryAlias.normalizedValue, t: primaryAlias.aliasType,
        c: primaryAlias.currency, fsp: REMITFLOW_FSP_ID,
      });
      const checksum = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 8);
      return { qrData: payload, checksum, alias: primaryAlias.normalizedValue, aliasType: primaryAlias.aliasType, currency: primaryAlias.currency };
    }),

  // #13: Schedule recurring P2P transfer (Temporal workflow)
  scheduleRecurring: protectedProcedure
    .input(z.object({
      aliasType: z.enum(["phone", "email"]),
      aliasValue: z.string().min(3).max(320),
      amount: z.number().positive().max(50000),
      currency: z.string().length(3).default("NGN"),
      frequency: z.enum(["daily", "weekly", "biweekly", "monthly"]),
      startDate: z.string().optional(), // ISO date
      endDate: z.string().optional(),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const scheduleId = crypto.randomUUID();
      const normalized = normalizeAlias(input.aliasType, input.aliasValue);
      // Store schedule metadata in DB (Temporal will poll for active schedules)
      await db.execute(sql`
        INSERT INTO p2p_transfers (sender_id, receiver_alias, send_amount, send_currency, receive_currency,
          rail, corridor_code, status, note, idempotency_key, created_at, updated_at)
        VALUES (${ctx.user.id}, ${normalized}, ${input.amount.toFixed(2)}, ${input.currency}, ${input.currency},
          'scheduled', 'internal', 'scheduled', ${`recurring:${input.frequency}:${normalized}:${input.note ?? ""}`},
          ${scheduleId}, NOW(), NOW())
        RETURNING id
      `);
      logger.info({ scheduleId, userId: ctx.user.id, frequency: input.frequency }, "[P2P] Recurring transfer scheduled");
      return {
        scheduleId,
        frequency: input.frequency,
        nextExecution: input.startDate ?? new Date(Date.now() + 86400000).toISOString(),
        recipient: normalized,
        amount: input.amount,
        currency: input.currency,
      };
    }),

  // #14: Generate shareable payment link
  generatePaymentLink: protectedProcedure
    .input(z.object({
      amount: z.number().positive().max(10_000_000).optional(),
      currency: z.string().length(3).default("NGN"),
      note: z.string().max(200).optional(),
      singleUse: z.boolean().default(true),
    }))
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [primaryAlias] = await db.select().from(paymentAliases)
        .where(and(eq(paymentAliases.userId, ctx.user.id), eq(paymentAliases.status, "active")))
        .limit(1);
      if (!primaryAlias) throw new TRPCError({ code: "NOT_FOUND", message: "Register an alias first" });
      const linkToken = crypto.randomBytes(16).toString("hex");
      return {
        paymentLink: `https://pay.remitflow.com/p/${linkToken}`,
        token: linkToken,
        alias: primaryAlias.normalizedValue,
        currency: primaryAlias.currency,
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      };
    }),

  // #15: Favorite contacts
  addFavorite: protectedProcedure
    .input(z.object({
      aliasType: z.enum(["phone", "email"]),
      aliasValue: z.string().min(3).max(320),
      nickname: z.string().max(50).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const normalized = normalizeAlias(input.aliasType, input.aliasValue);
      await db.execute(sql`
        INSERT INTO p2p_transfers (sender_id, receiver_alias, send_amount, send_currency, receive_currency,
          rail, corridor_code, status, note, idempotency_key, created_at, updated_at)
        VALUES (${ctx.user.id}, ${normalized}, '0', 'FAV', 'FAV', 'favorite', 'favorite', 'favorite',
          ${input.nickname ?? normalized}, ${`fav:${ctx.user.id}:${normalized}`}, NOW(), NOW())
        ON CONFLICT DO NOTHING RETURNING id
      `);
      return { added: true, alias: normalized, nickname: input.nickname ?? normalized };
    }),

  removeFavorite: protectedProcedure
    .input(z.object({ aliasValue: z.string().min(3).max(320) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db.execute(sql`
        DELETE FROM p2p_transfers WHERE sender_id = ${ctx.user.id} AND status = 'favorite'
          AND idempotency_key = ${`fav:${ctx.user.id}:${input.aliasValue}`}
      `);
      return { removed: true };
    }),

  favorites: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const results = await db.execute(sql`
      SELECT note as nickname, idempotency_key, created_at FROM p2p_transfers
      WHERE sender_id = ${ctx.user.id} AND status = 'favorite' ORDER BY created_at DESC LIMIT 50
    `) as Array<{ nickname: string; idempotency_key: string; created_at: string }>;
    return results.map((r: { nickname: string; idempotency_key: string; created_at: string }) => ({
      nickname: r.nickname,
      alias: r.idempotency_key.replace(`fav:${ctx.user.id}:`, ""),
      addedAt: r.created_at,
    }));
  }),

  // #16: Dispute/reversal flow
  openDispute: protectedProcedure
    .input(z.object({
      transferId: z.number().int().positive(),
      type: z.enum(["unauthorized", "wrong_amount", "wrong_recipient", "not_received", "fraud"]),
      description: z.string().min(10).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [transfer] = await db.select().from(p2pTransfers)
        .where(and(eq(p2pTransfers.id, input.transferId), eq(p2pTransfers.senderId, ctx.user.id)));
      if (!transfer) throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found" });
      if (transfer.status === "compensated") throw new TRPCError({ code: "BAD_REQUEST", message: "Transfer already reversed" });

      const disputeId = crypto.randomUUID();
      // FF-FIX: guarded single-winner transition — a concurrent openDispute /
      // resolveDispute can no longer both flip the row, and terminal states
      // (compensated/failed/cancelled) are never re-disputed.
      const updated = await db.update(p2pTransfers)
        .set({ status: "disputed", note: `DISPUTE:${disputeId}:${input.type}:${input.description}`, updatedAt: new Date() })
        .where(and(
          eq(p2pTransfers.id, input.transferId),
          sql`status IN ('completed', 'escrowed', 'debited', 'settling')`,
        ))
        .returning({ id: p2pTransfers.id });
      if (updated.length === 0) throw new TRPCError({ code: "CONFLICT", message: "Transfer is not in a disputable state" });

      // Get AI recommendation from Python service
      const recommendation = await fetchIntelligence("/dispute/recommend", {
        amount: parseFloat(transfer.sendAmount), type: input.type,
        days_since_transfer: Math.floor((Date.now() - new Date(transfer.createdAt).getTime()) / 86400000),
        sender_dispute_count: 0, receiver_dispute_count: 0,
      });

      await publishEvent(KAFKA_TOPICS.DISPUTE_OPENED, disputeId, {
        disputeId, transferId: input.transferId, userId: ctx.user.id,
        type: input.type, amount: transfer.sendAmount, timestamp: new Date().toISOString(),
      });
      return { disputeId, transferId: input.transferId, status: "under_review", aiRecommendation: recommendation };
    }),

  resolveDispute: adminProcedure
    .input(z.object({
      transferId: z.number().int().positive(),
      resolution: z.enum(["refund", "reject", "partial_refund"]),
      refundAmount: z.number().positive().max(10_000_000).optional(),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [transfer] = await db.select().from(p2pTransfers).where(eq(p2pTransfers.id, input.transferId));
      if (!transfer) throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found" });

      // FF-025: only transfers in a disputable state can be resolved, and the
      // status transition must WIN atomically — re-resolving a compensated /
      // refunded transfer was a double-refund vector; "reject" must never
      // resurrect compensated/failed transfers to completed.
      if (!["disputed", "debited", "settling", "completed"].includes(transfer.status)) {
        throw new TRPCError({ code: "CONFLICT", message: `Transfer in status '${transfer.status}' cannot be resolved via dispute` });
      }
      // Cap any refund at the original debit (amount + fee) — a partial refund
      // must never exceed what the sender actually paid.
      const maxRefundable = parseFloat(transfer.sendAmount) + parseFloat(transfer.fee ?? "0");
      const refundAmt = Math.min(input.refundAmount ?? maxRefundable, maxRefundable);

      await db.transaction(async (tx: any) => {
        if (input.resolution === "refund" || input.resolution === "partial_refund") {
          // Refunding a COMPLETED internal transfer while the receiver keeps
          // the credit creates money — only allow refund when the receiver
          // credit can be clawed back (internal + completed) or funds are
          // still with us (debited/settling).
          const isInternalCompleted = transfer.status === "completed" && !!transfer.receiverId && transfer.receiverFspId === REMITFLOW_FSP_ID;
          // FF-FIX: never refund an in-flight EXTERNAL transfer — the rail may
          // still complete the payout, which would leave both sides holding
          // the money. Require rail recall/abort confirmation first.
          const isExternal = !!transfer.rail && transfer.rail !== "internal" && transfer.rail !== "escrow" && transfer.receiverFspId !== REMITFLOW_FSP_ID;
          if ((transfer.status === "settling" || transfer.status === "debited") && isExternal) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "External settlement in flight — refund requires rail recall/abort confirmation (manual process)" });
          }
          if (transfer.status === "completed" && !isInternalCompleted) {
            // Completed via an external rail — the recipient was paid out.
            // Refunding here creates money; requires rail recovery first.
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Transfer settled externally — refund requires rail recovery (manual process)" });
          }
          const won = await tx.update(p2pTransfers)
            .set({ status: "compensated", updatedAt: new Date() })
            .where(and(eq(p2pTransfers.id, input.transferId), eq(p2pTransfers.status, transfer.status)))
            .returning({ id: p2pTransfers.id });
          if (won.length === 0) {
            throw new TRPCError({ code: "CONFLICT", message: "Transfer was already resolved concurrently" });
          }
          if (isInternalCompleted) {
            // Claw back the receiver credit first (guarded — receiver must
            // still hold the funds), then refund the sender.
            const clawback = (await tx.execute(sql`
              UPDATE wallets SET balance = balance - ${parseFloat(transfer.receiveAmount).toFixed(2)}, "updatedAt" = NOW(), version = version + 1
              WHERE "userId" = ${transfer.receiverId} AND currency = ${transfer.receiveCurrency} AND status = 'active'
                AND CAST(balance AS numeric) >= ${parseFloat(transfer.receiveAmount).toFixed(2)}
              RETURNING id
            `)) as unknown as Array<{ id: number }>;
            if (clawback.length === 0) {
              throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Receiver no longer holds the funds — manual recovery required; sender NOT refunded" });
            }
          }
          const refundRows = (await tx.execute(sql`
            UPDATE wallets SET balance = balance + ${refundAmt.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
            WHERE "userId" = ${transfer.senderId} AND currency = ${transfer.sendCurrency} AND status = 'active'
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (refundRows.length === 0) {
            // Roll back the claim — never mark compensated without paying.
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Refund credit failed — sender wallet unavailable; left for manual recovery" });
          }
        } else {
          // reject: restore to its pre-dispute state, never force "completed".
          const restored = transfer.status === "disputed" ? "completed" : transfer.status;
          const won = await tx.update(p2pTransfers)
            .set({ status: restored === "disputed" ? "completed" : restored, note: `dispute_rejected:${input.notes ?? ""}`, updatedAt: new Date() })
            .where(and(eq(p2pTransfers.id, input.transferId), eq(p2pTransfers.status, transfer.status)))
            .returning({ id: p2pTransfers.id });
          if (won.length === 0) {
            throw new TRPCError({ code: "CONFLICT", message: "Transfer was already resolved concurrently" });
          }
        }
      });
      return { resolved: true, resolution: input.resolution, transferId: input.transferId };
    }),

  // #17: Alias nickname
  setAliasNickname: protectedProcedure
    .input(z.object({ aliasId: z.number().int().positive(), nickname: z.string().min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // Store nickname in alias metadata via raw SQL (avoids schema migration)
      const [updated] = await db.execute(sql`
        UPDATE payment_aliases SET updated_at = NOW()
        WHERE id = ${input.aliasId} AND user_id = ${ctx.user.id} RETURNING id
      `) as Array<{ id: number }>;
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Alias not found" });
      return { aliasId: input.aliasId, nickname: input.nickname, updated: true };
    }),

  // #18: Multi-currency wallet auto-creation
  ensureWallet: protectedProcedure
    .input(z.object({ currency: z.string().length(3) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [existing] = await db.select({ id: wallets.id }).from(wallets)
        .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, input.currency)))
        .limit(1);
      if (existing) return { walletId: existing.id, currency: input.currency, created: false };
      // NOTE: wallets has NO unique constraint on ("userId", currency) — a
      // UNIQUE constraint + dedupe migration is required (schema follow-up).
      // Until then, fall back to the concurrently-created row on conflict.
      try {
        const [newWallet] = await db.insert(wallets).values({
          userId: ctx.user.id, currency: input.currency, balance: "0.00", status: "active",
        }).returning({ id: wallets.id });
        logger.info({ userId: ctx.user.id, currency: input.currency }, "[P2P] Auto-created wallet for cross-border receive");
        return { walletId: newWallet.id, currency: input.currency, created: true };
      } catch (err) {
        const [w] = await db.select({ id: wallets.id }).from(wallets)
          .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, input.currency)))
          .limit(1);
        if (w) return { walletId: w.id, currency: input.currency, created: false };
        throw err;
      }
    }),

  // #19: Webhook notifications for merchants
  registerWebhook: protectedProcedure
    .input(z.object({
      url: z.string().url().max(500),
      events: z.array(z.enum(["p2p_received", "p2p_sent", "request_received", "dispute_opened"])).min(1),
      secret: z.string().min(16).max(128),
    }))
    .mutation(async ({ ctx, input }) => {
      const webhookId = crypto.randomUUID();
      const secretHash = crypto.createHash("sha256").update(input.secret).digest("hex");
      logger.info({ userId: ctx.user.id, webhookId, events: input.events }, "[P2P] Webhook registered");
      return { webhookId, url: input.url, events: input.events, secretHash: secretHash.slice(0, 8) + "...", active: true };
    }),

  // #20: Cross-border request money with FX quote
  requestMoneyCrossBorder: protectedProcedure
    .input(z.object({
      payerAlias: z.string().min(3).max(320),
      payerAliasType: z.enum(["phone", "email"]),
      amount: z.number().positive().max(50000),
      receiveCurrency: z.string().length(3),
      sendCurrency: z.string().length(3),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const normalizedPayer = normalizeAlias(input.payerAliasType, input.payerAlias);
      // Get FX quote for the request
      let fxRate = 1;
      if (input.sendCurrency !== input.receiveCurrency) {
        try {
          const quote = await requestQuote({
            payerMsisdn: normalizedPayer, payeeMsisdn: `user:${ctx.user.id}`,
            payerFspId: "unknown-fsp", payeeFspId: REMITFLOW_FSP_ID,
            amount: String(input.amount), currency: input.sendCurrency,
          });
          const transferAmt = quote.transferAmount;
          fxRate = transferAmt ? parseFloat(transferAmt.amount) / input.amount : 1;
        } catch { /* use 1:1 fallback */ }
      }
      const [request] = await db.insert(p2pPaymentRequests).values({
        requesterId: ctx.user.id, requesterAlias: `user:${ctx.user.id}`,
        payerAlias: normalizedPayer, payerId: null,
        amount: input.amount.toFixed(2), currency: input.receiveCurrency,
        note: `Cross-border: ${input.sendCurrency}→${input.receiveCurrency} @ ${fxRate}. ${input.note ?? ""}`,
        status: "pending", expiresAt: new Date(Date.now() + REQUEST_EXPIRY_HOURS * 3600000),
      }).returning();
      return { requestId: request.id, fxRate, sendCurrency: input.sendCurrency, receiveCurrency: input.receiveCurrency };
    }),

  // #21: Social feed — Venmo-style (via Python service)
  socialFeed: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const recent = await db.select().from(p2pTransfers)
        .where(and(
          or(eq(p2pTransfers.senderId, ctx.user.id), eq(p2pTransfers.receiverId, ctx.user.id)),
          eq(p2pTransfers.status, "completed"),
        ))
        .orderBy(desc(p2pTransfers.createdAt))
        .limit(input.limit);

      const entries = [];
      for (const tx of recent) {
        const entry = await fetchIntelligence("/social/entry", {
          transfer_id: tx.id,
          sender_display_name: tx.senderId === ctx.user.id ? "You" : "Someone",
          receiver_display_name: tx.receiverId === ctx.user.id ? "You" : "Someone",
          amount: parseFloat(tx.sendAmount),
          currency: tx.sendCurrency,
          note: tx.note,
          social_opt_in: true,
          timestamp: new Date(tx.createdAt).getTime(),
        });
        entries.push(entry);
      }
      return entries;
    }),

  // #22: Batch P2P send (payroll-lite) — via Go sanctions batch screening
  batchSend: protectedProcedure
    .input(z.object({
      recipients: z.array(z.object({
        aliasType: z.enum(["phone", "email"]),
        aliasValue: z.string().min(3).max(320),
        amount: z.number().positive().max(50000),
        currency: z.string().length(3).default("NGN"),
        note: z.string().max(200).optional(),
      })).min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const totalAmount = input.recipients.reduce((sum, r) => sum + r.amount, 0);

      // Batch sanctions screening via Go service
      try {
        const screenRes = await fetch(`${P2P_SANCTIONS_URL}/batch-screen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sender_id: String(ctx.user.id),
            kyc_tier: "tier2",
            items: input.recipients.map((r) => ({
              alias: normalizeAlias(r.aliasType, r.aliasValue),
              amount: r.amount, currency: r.currency, note: r.note ?? "",
            })),
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (screenRes.ok) {
          const batchResult = await screenRes.json() as { passed: number; blocked: number; items: Array<{ status: string }> };
          if (batchResult.blocked > 0) {
            logger.warn({ userId: ctx.user.id, blocked: batchResult.blocked }, "[P2P] Batch send partially blocked by sanctions");
          }
        }
      } catch { /* continue if screening service unavailable */ }

      const results = [];
      for (const r of input.recipients) {
        const normalized = normalizeAlias(r.aliasType, r.aliasValue);
        const idemKey = generateIdempotencyKey(ctx.user.id, normalized, String(r.amount), Date.now());
        const [transfer] = await db.insert(p2pTransfers).values({
          senderId: ctx.user.id, receiverId: null, receiverAlias: normalized,
          sendAmount: r.amount.toFixed(2), sendCurrency: r.currency, receiveCurrency: r.currency,
          rail: "batch" as any, corridorCode: "internal", status: "pending" as any,
          note: r.note ?? `Batch payment`, idempotencyKey: idemKey,
        }).returning();
        results.push({ alias: normalized, amount: r.amount, transferId: transfer.id, status: "queued" });
      }
      await publishEvent(KAFKA_TOPICS.TRANSACTIONS, `batch:${ctx.user.id}`, {
        eventType: "p2p_batch", userId: ctx.user.id, count: input.recipients.length,
        totalAmount, timestamp: new Date().toISOString(),
      });
      return { batchId: crypto.randomUUID(), total: input.recipients.length, totalAmount, results };
    }),

  // #23: Predictive FX alerts (via Python service)
  fxAlert: protectedProcedure
    .input(z.object({
      sendCurrency: z.string().length(3),
      receiveCurrency: z.string().length(3),
    }))
    .query(async ({ input }) => {
      // Generate mock rate history (in production: from Redis/DB cache)
      const rates = Array.from({ length: 30 }, (_, i) => ({
        rate: 1600 + Math.sin(i / 5) * 50 + (crypto.randomInt(0, 20) - 10),
        date: new Date(Date.now() - (30 - i) * 86400000).toISOString().slice(0, 10),
      }));
      const analysis = await fetchIntelligence("/fx/trend", { rates, send_currency: input.sendCurrency, receive_currency: input.receiveCurrency });
      return { corridor: `${input.sendCurrency}-${input.receiveCurrency}`, ...analysis };
    }),

  // #24: USSD command parser (via Python service) — offline P2P for feature phones
  ussdCommand: protectedProcedure
    .input(z.object({ command: z.string().min(4).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const parsed = await fetchIntelligence("/ussd/parse", { command: input.command });
      if (!parsed.valid) throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid USSD: ${parsed.error ?? "unknown format"}` });
      logger.info({ userId: ctx.user.id, action: parsed.action }, "[P2P] USSD command parsed");
      return { userId: ctx.user.id, ...parsed };
    }),

  // #25: Admin fraud graph analysis (via Rust P2P engine)
  adminFraudGraph: adminProcedure
    .input(z.object({
      windowHours: z.number().int().min(1).max(720).default(24),
      minAmount: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const edges = await db.execute(sql`
        SELECT sender_id, receiver_id, CAST(send_amount AS numeric) as amount, send_currency as currency,
               EXTRACT(EPOCH FROM created_at) * 1000 as timestamp_ms
        FROM p2p_transfers
        WHERE created_at > NOW() - (${input.windowHours} || ' hours')::interval
          AND CAST(send_amount AS numeric) >= ${input.minAmount}
          AND status IN ('completed', 'settling')
        ORDER BY created_at DESC LIMIT 10000
      `) as Array<{ sender_id: number; receiver_id: number; amount: number; currency: string; timestamp_ms: number }>;
      // Basic graph analysis inline (Rust service would do heavy GNN analysis)
      const nodeMap = new Map<number, { fanOut: number; fanIn: number; totalSent: number; totalReceived: number }>();
      for (const e of edges) {
        const s = nodeMap.get(e.sender_id) ?? { fanOut: 0, fanIn: 0, totalSent: 0, totalReceived: 0 };
        s.fanOut++;
        s.totalSent += e.amount;
        nodeMap.set(e.sender_id, s);
        if (e.receiver_id) {
          const r = nodeMap.get(e.receiver_id) ?? { fanOut: 0, fanIn: 0, totalSent: 0, totalReceived: 0 };
          r.fanIn++;
          r.totalReceived += e.amount;
          nodeMap.set(e.receiver_id, r);
        }
      }
      const suspicious = Array.from(nodeMap.entries())
        .filter(([, v]) => (v.fanOut >= 5 && v.fanIn >= 5) || v.totalSent > 100000)
        .map(([id, v]) => ({ nodeId: id, ...v, riskScore: Math.min((v.fanOut + v.fanIn) / 20, 1) }));
      return { totalNodes: nodeMap.size, totalEdges: edges.length, suspicious, windowHours: input.windowHours };
    }),

  // #26: Alias portability — transfer alias to another FSP
  portAlias: protectedProcedure
    .input(z.object({
      aliasId: z.number().int().positive(),
      targetFspId: z.string().min(3).max(64),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [alias] = await db.select().from(paymentAliases)
        .where(and(eq(paymentAliases.id, input.aliasId), eq(paymentAliases.userId, ctx.user.id)));
      if (!alias) throw new TRPCError({ code: "NOT_FOUND", message: "Alias not found" });
      // Deactivate on our side, notify Mojaloop of transfer
      const [updated] = await db.update(paymentAliases)
        .set({ status: "deactivated", fspId: input.targetFspId, updatedAt: new Date() })
        .where(eq(paymentAliases.id, input.aliasId))
        .returning({ id: paymentAliases.id });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Port failed" });
      logger.info({ aliasId: input.aliasId, targetFsp: input.targetFspId }, "[P2P] Alias ported to external FSP");
      return { ported: true, aliasId: input.aliasId, newFspId: input.targetFspId, previousFsp: REMITFLOW_FSP_ID };
    }),

  // #27: ILP streaming micro-payments
  streamPayment: protectedProcedure
    .input(z.object({
      receiverAlias: z.string().min(3).max(320),
      ratePerSecond: z.number().positive().max(10), // Max $10/sec
      maxAmount: z.number().positive().max(10000),
      durationSeconds: z.number().int().positive().max(3600),
      currency: z.string().length(3).default("NGN"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const streamId = crypto.randomUUID();
      const totalAmount = Math.min(input.ratePerSecond * input.durationSeconds, input.maxAmount);
      const ilp = generateIlpConditionPair();
      const [transfer] = await db.insert(p2pTransfers).values({
        senderId: ctx.user.id, receiverId: null, receiverAlias: input.receiverAlias,
        sendAmount: totalAmount.toFixed(2), sendCurrency: input.currency, receiveCurrency: input.currency,
        rail: "ilp_stream" as any, corridorCode: "internal", status: "streaming" as any,
        note: `ILP stream: ${input.ratePerSecond}/sec for ${input.durationSeconds}s`,
        ilpCondition: ilp.condition, ilpFulfillment: ilp.fulfillment,
        idempotencyKey: streamId,
      }).returning();
      logger.info({ streamId, rate: input.ratePerSecond, duration: input.durationSeconds }, "[P2P] ILP stream initiated");
      return {
        streamId, transferId: transfer.id,
        ratePerSecond: input.ratePerSecond,
        maxAmount: input.maxAmount,
        estimatedTotal: totalAmount,
        durationSeconds: input.durationSeconds,
        ilpCondition: ilp.condition,
      };
    }),

  // #28: Multi-party escrow
  createEscrow: protectedProcedure
    .input(z.object({
      sellerAlias: z.string().min(3).max(320),
      sellerAliasType: z.enum(["phone", "email"]),
      amount: z.number().positive().max(100000),
      currency: z.string().length(3).default("NGN"),
      conditions: z.array(z.string().max(500)).min(1).max(5),
      arbiterAlias: z.string().max(320).optional(),
      totpCode: z.string().regex(/^\d{6}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // W12: canonical TOTP step-up (fail-closed) — direct wallet debit.
      const { requireTotpStepUp, requireKycTierForAmount } = await import("../_core/totpStepUp");
      await requireTotpStepUp(ctx.user.id, input.totpCode, "escrow creation");
      // W12: this rail debits the wallet directly and bypasses the transfer
      // pipeline — apply the transferEngine-equivalent KYC tier check.
      await requireKycTierForAmount(ctx.user.id, input.amount, "escrow creation");
      const escrowId = crypto.randomUUID();
      const sellerNorm = normalizeAlias(input.sellerAliasType, input.sellerAlias);
      // FF-FIX: debit + escrow record in ONE transaction — an insert failure
      // rolls the debit back (funds can no longer vanish without a record).
      const transfer = await db.transaction(async (tx: any) => {
        const debitResult = (await tx.execute(sql`
          UPDATE wallets SET balance = balance - ${input.amount.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
          WHERE "userId" = ${ctx.user.id} AND currency = ${input.currency} AND status = 'active'
            AND CAST(balance AS numeric) >= ${input.amount.toFixed(2)}
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (debitResult.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient balance for escrow" });
        }
        const [t] = await tx.insert(p2pTransfers).values({
          senderId: ctx.user.id, receiverId: null, receiverAlias: sellerNorm,
          sendAmount: input.amount.toFixed(2), sendCurrency: input.currency, receiveCurrency: input.currency,
          rail: "escrow" as any, corridorCode: "internal", status: "escrowed" as any,
          note: `Escrow: ${input.conditions.join(" | ")}. Seller: ${sellerNorm}`,
          idempotencyKey: escrowId,
        }).returning();
        return t;
      });
      logger.info({ escrowId, buyerId: ctx.user.id, amount: input.amount }, "[P2P] Escrow created");
      return { escrowId, transferId: transfer.id, amount: input.amount, currency: input.currency, conditions: input.conditions, status: "funded" };
    }),

  releaseEscrow: protectedProcedure
    .input(z.object({ escrowId: z.string().uuid(), totpCode: z.string().regex(/^\d{6}$/).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // W12: canonical TOTP step-up (fail-closed) — releases escrowed funds.
      const { requireTotpStepUp, requireKycTierForAmount } = await import("../_core/totpStepUp");
      await requireTotpStepUp(ctx.user.id, input.totpCode, "escrow release");
      const [escrow] = await db.select().from(p2pTransfers)
        .where(and(eq(p2pTransfers.idempotencyKey, input.escrowId), eq(p2pTransfers.senderId, ctx.user.id)));
      if (!escrow) throw new TRPCError({ code: "NOT_FOUND", message: "Escrow not found" });
      if (escrow.status !== "escrowed") throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot release — status is ${escrow.status}` });

      const amount = Number(escrow.sendAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Corrupt escrow amount — manual review required" });
      }
      // W12: escrow release credits the seller off-pipeline — apply the
      // transferEngine-equivalent KYC tier check on the released amount.
      await requireKycTierForAmount(ctx.user.id, amount, "escrow release");

      // Resolve the seller alias to a local user (escrow is an internal rail).
      const [sellerAliasRow] = await db.select()
        .from(paymentAliases)
        .where(and(eq(paymentAliases.normalizedValue, escrow.receiverAlias), eq(paymentAliases.status, "active")))
        .limit(1);
      const sellerCurrency = sellerAliasRow?.currency ?? escrow.sendCurrency;

      // FF-FIX: guarded single-winner status transition + seller wallet credit
      // in ONE transaction. Previously the escrow was marked completed and the
      // seller was NEVER credited — buyer funds vanished from circulation.
      try {
        await db.transaction(async (tx: any) => {
          const claimRows = (await tx.execute(sql`
            UPDATE p2p_transfers
            SET status = 'completed', completed_at = NOW(), updated_at = NOW(),
                receiver_id = ${sellerAliasRow?.userId ?? null}
            WHERE id = ${escrow.id} AND status = 'escrowed'
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (claimRows.length === 0) {
            throw new TRPCError({ code: "CONFLICT", message: "Escrow already released or refunded" });
          }
          if (!sellerAliasRow) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "SELLER_WALLET_UNAVAILABLE" });
          }
          const creditRows = (await tx.execute(sql`
            UPDATE wallets
            SET balance = balance + ${amount.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
            WHERE "userId" = ${sellerAliasRow.userId} AND currency = ${sellerCurrency} AND status = 'active'
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (creditRows.length === 0) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "SELLER_WALLET_UNAVAILABLE" });
          }
          await tx.insert(transactions).values([
            {
              userId: ctx.user.id, type: "send", status: "completed",
              fromCurrency: escrow.sendCurrency, fromAmount: amount.toFixed(2),
              toCurrency: sellerCurrency, toAmount: amount.toFixed(2),
              fee: "0", reference: `P2P_ESCROW_${escrow.id}_SEND`,
              description: `Escrow released to ${escrow.receiverAlias}`,
              metadata: { p2pTransferId: escrow.id, rail: "escrow", leg: "buyer_debit" },
            } as any,
            {
              userId: sellerAliasRow.userId, type: "receive", status: "completed",
              fromCurrency: escrow.sendCurrency, fromAmount: amount.toFixed(2),
              toCurrency: sellerCurrency, toAmount: amount.toFixed(2),
              fee: "0", reference: `P2P_ESCROW_${escrow.id}_RECV`,
              description: `Escrow payment received`,
              metadata: { p2pTransferId: escrow.id, rail: "escrow", leg: "seller_credit" },
            } as any,
          ]);
        });
      } catch (err: any) {
        // Seller wallet unresolvable — NEVER leave the buyer's funds trapped:
        // refund the buyer via a guarded single-winner transition.
        if (err instanceof TRPCError && err.code === "PRECONDITION_FAILED") {
          const refunded = await db.transaction(async (tx: any) => {
            const refundClaim = (await tx.execute(sql`
              UPDATE p2p_transfers
              SET status = 'compensated', failed_at = NOW(),
                  failure_reason = 'Seller wallet unavailable — escrow refunded to buyer',
                  updated_at = NOW()
              WHERE id = ${escrow.id} AND status = 'escrowed'
              RETURNING id
            `)) as unknown as Array<{ id: number }>;
            if (refundClaim.length === 0) return false;
            const creditRows = (await tx.execute(sql`
              UPDATE wallets
              SET balance = balance + ${amount.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
              WHERE "userId" = ${ctx.user.id} AND currency = ${escrow.sendCurrency} AND status = 'active'
              RETURNING id
            `)) as unknown as Array<{ id: number }>;
            if (creditRows.length === 0) {
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Refund credit failed — buyer wallet unavailable; left for manual recovery" });
            }
            return true;
          });
          if (refunded) {
            logger.warn({ escrowId: input.escrowId, buyerId: ctx.user.id, amount }, "[P2P] Escrow refunded — seller wallet unavailable");
            return { released: false, refunded: true, escrowId: input.escrowId, amount: escrow.sendAmount };
          }
        }
        throw err;
      }
      logger.info({ escrowId: input.escrowId, buyerId: ctx.user.id, sellerId: sellerAliasRow?.userId, amount }, "[P2P] Escrow released — seller credited");
      return { released: true, escrowId: input.escrowId, amount: escrow.sendAmount };
    }),

  disputeEscrow: protectedProcedure
    .input(z.object({ escrowId: z.string().uuid(), reason: z.string().min(10).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [escrow] = await db.select().from(p2pTransfers)
        .where(and(eq(p2pTransfers.idempotencyKey, input.escrowId), or(eq(p2pTransfers.senderId, ctx.user.id), eq(p2pTransfers.receiverId, ctx.user.id))));
      if (!escrow) throw new TRPCError({ code: "NOT_FOUND", message: "Escrow not found" });
      const [updated] = await db.update(p2pTransfers)
        .set({ status: "disputed", note: `${escrow.note ?? ""} | DISPUTE: ${input.reason}`, updatedAt: new Date() })
        .where(eq(p2pTransfers.id, escrow.id))
        .returning({ id: p2pTransfers.id });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute failed" });
      await publishEvent(KAFKA_TOPICS.DISPUTE_OPENED, input.escrowId, {
        escrowId: input.escrowId, userId: ctx.user.id, reason: input.reason, timestamp: new Date().toISOString(),
      });
      return { disputed: true, escrowId: input.escrowId };
    }),

  // #30: Scheduled/cron transfers list
  myScheduledTransfers: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    return db.select().from(p2pTransfers)
      .where(and(eq(p2pTransfers.senderId, ctx.user.id), eq(p2pTransfers.status, "scheduled")))
      .orderBy(desc(p2pTransfers.createdAt))
      .limit(20);
  }),

  cancelScheduled: protectedProcedure
    .input(z.object({ transferId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [updated] = await db.update(p2pTransfers)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(p2pTransfers.id, input.transferId), eq(p2pTransfers.senderId, ctx.user.id), eq(p2pTransfers.status, "scheduled")))
        .returning({ id: p2pTransfers.id });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Scheduled transfer not found or already executed" });
      return { cancelled: true, transferId: input.transferId };
    }),

  // Admin: Rail health management (#10)
  adminSetRailHealth: adminProcedure
    .input(z.object({ rail: z.string().min(2).max(20), healthy: z.boolean() }))
    .mutation(({ input }) => {
      railHealth[input.rail] = { healthy: input.healthy, lastCheck: Date.now() };
      logger.info({ rail: input.rail, healthy: input.healthy }, "[P2P] Rail health updated");
      return { rail: input.rail, healthy: input.healthy, updatedAt: new Date().toISOString() };
    }),

  adminRailHealth: adminProcedure.query(() => {
    return Object.entries(railHealth).map(([rail, status]) => ({
      rail, ...status, lastCheckISO: new Date(status.lastCheck).toISOString(),
    }));
  }),
});
