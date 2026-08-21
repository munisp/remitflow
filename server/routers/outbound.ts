/**
 * RemitFlow Outbound Router — v199
 * Proxies to three polyglot microservices:
 *   Go outbound-swift (8081), Rust float-income (8082), Python revenue-analytics (8083)
 *
 * v199 additions:
 *   - Annual limit tracking per purpose code (CBN Form A)
 *   - Cross-sell offer trigger (Python scoreCrossSell > 0.7)
 *   - Live FX rate endpoint proxy
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc.js";
import {
  createAuditLog,
  getAnnualUsage,
  getAllAnnualUsageForUser,
  incrementAnnualUsage,
  getActiveCrossSellOffer,
  createCrossSellOffer,
  respondToCrossSellOffer,
  markCrossSellOfferShown,
  getDb,
} from "../db.js";
import { safeParseAmount } from "../lib/safeDecimal";
import { executeTransferPipeline, settleTransferHold, compensateFailedTransfer } from "../_core/transferPipeline";
import { logger } from "../_core/logger";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { KYC_TIER_LIMITS, type KycTier } from "../business-rules";

const SWIFT_URL = process.env.OUTBOUND_SWIFT_URL ?? "http://localhost:8081";
const FLOAT_URL = process.env.FLOAT_INCOME_URL ?? "http://localhost:8082";
const ANALYTICS_URL = process.env.REVENUE_ANALYTICS_URL ?? "http://localhost:8083";

// CBN annual limits per purpose code (USD) — mirrors Go service
const CBN_ANNUAL_LIMITS_USD: Record<string, number> = {
  EDU: 10000, MED: 15000, TRV: 4000, REM: 50000,
  SME: 200000, HNW: 500000, INV: 100000, DIVI: 200000,
};

// Cross-sell offer templates keyed by segment
const CROSS_SELL_TEMPLATES: Record<string, {
  offerType: "savings_account" | "diaspora_bond" | "insurance" | "investment_fund" | "credit_card";
  headline: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
}> = {
  education: {
    offerType: "diaspora_bond",
    headline: "Earn 12% p.a. on your education savings",
    body: "Invest in a RemitFlow Diaspora Bond while your child studies abroad. Lock in NGN returns and beat inflation.",
    ctaLabel: "Explore Diaspora Bond",
    ctaUrl: "/savings/diaspora-bond",
  },
  medical: {
    offerType: "insurance",
    headline: "Protect your family with RemitFlow Health Cover",
    body: "Comprehensive international health insurance starting at $30/month. Covers medical tourism and repatriation.",
    ctaLabel: "Get Covered",
    ctaUrl: "/insurance/health",
  },
  labor: {
    offerType: "savings_account",
    headline: "Save smarter with RemitFlow Diaspora Savings",
    body: "Earn 9% p.a. on your NGN savings. Automatic deductions from your remittance flow.",
    ctaLabel: "Open Savings Account",
    ctaUrl: "/savings/diaspora",
  },
  hnw: {
    offerType: "investment_fund",
    headline: "Exclusive: RemitFlow HNW Investment Portfolio",
    body: "Access curated Nigerian equities, Eurobonds, and real estate investment trusts. Minimum $5,000.",
    ctaLabel: "Explore Portfolio",
    ctaUrl: "/investments/hnw",
  },
  sme: {
    offerType: "credit_card",
    headline: "RemitFlow SME Trade Finance Card",
    body: "Up to $50,000 revolving credit for import/export. 0% for 60 days on trade transactions.",
    ctaLabel: "Apply Now",
    ctaUrl: "/cards/sme-trade",
  },
};

async function callService(url: string, method: "GET" | "POST", body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Service error ${res.status}: ${err}`);
  }
  return res.json() as Promise<unknown>;
}

const swiftRouter = router({
  getQuote: protectedProcedure
    .input(z.object({
      amount_ngn: z.number().positive().max(10_000_000),
      destination_currency: z.string().length(3),
      purpose_code: z.string(),
      sender_segment: z.enum(["labor", "education", "medical", "sme", "hnw"]).optional(),
    }))
    .query(async ({ input }) => callService(`${SWIFT_URL}/quote`, "POST", input)),

  submitTransfer: protectedProcedure
    .input(z.object({
      amount_ngn: z.number().positive().max(10_000_000),
      destination_currency: z.string().length(3),
      purpose_code: z.string(),
      sender_segment: z.enum(["labor", "education", "medical", "sme", "hnw"]).optional(),
      beneficiary_name: z.string().min(2),
      beneficiary_account: z.string().min(4),
      beneficiary_bank_swift: z.string().min(8).max(11),
      beneficiary_country: z.string().length(2),
      totpCode: z.string().length(6).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // FF-037/FF-002: live FX for display/limit checks only — fail over to a
      // conservative fallback rate. The pipeline itself must receive the
      // NATIVE amount (amount_ngn) with fromCurrency NGN.
      let ngnPerUsd = 1600;
      try {
        const fxRes = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(3_000) });
        if (fxRes.ok) {
          const fxData = await fxRes.json() as { rates?: Record<string, number> };
          if (fxData.rates?.NGN) ngnPerUsd = fxData.rates.NGN;
        }
      } catch { /* use fallback rate */ }
      const estimatedUsd = input.amount_ngn / ngnPerUsd;
      const transferId = `SWIFT-${Date.now()}-${ctx.user.id}`;

      // 2FA enforcement for high-value SWIFT transfers (> $1,000 equivalent)
      if (estimatedUsd > 1000) {
        // SEC-25: read enrollment from mfa_settings (with users.twoFactor* fallback)
        const { getTotpEnrollment, verifyTOTP } = await import("../totp");
        const enrollment = await getTotpEnrollment(ctx.user.id);
        if (enrollment.dbAvailable && enrollment.enabled) {
          if (!input.totpCode) throw new TRPCError({ code: "FORBIDDEN", message: "2FA_REQUIRED: SWIFT transfers over $1,000 require TOTP verification." });
          const valid = await verifyTOTP(input.totpCode, enrollment.secret ?? "");
          if (!valid) throw new TRPCError({ code: "FORBIDDEN", message: "Invalid 2FA code" });
        }
      }

      // KYC tier limit enforcement
      const db = await getDb();
      if (db) {
        const [userForKyc] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
        const kycTier = (userForKyc?.kycTier ?? "tier0") as KycTier;
        const limits = KYC_TIER_LIMITS[kycTier];
        if (limits && estimatedUsd > limits.perTx) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `KYC Tier ${kycTier}: single transfer limit is $${limits.perTx}` });
        }
      }

      // Execute unified transfer pipeline (sanctions, fraud ML, velocity, TigerBeetle, Kafka, notifications)
      // FF-002: pass the NATIVE NGN amount with fromCurrency NGN. The pipeline
      // converts to minor units for the NGN TB ledger (566). Previously the
      // USD estimate was passed with fromCurrency NGN → a ~1600x under-hold.
      const pipelineResult = await executeTransferPipeline({
        userId: ctx.user.id,
        amount: input.amount_ngn,
        fromCurrency: "NGN",
        toCurrency: input.destination_currency,
        recipientName: input.beneficiary_name,
        recipientAccount: input.beneficiary_account,
        rail: "swift",
        corridorCode: input.beneficiary_country,
        featureLabel: "outbound_swift",
        transferId,
        description: `CBN purpose: ${input.purpose_code}`,
        metadata: { purposeCode: input.purpose_code, segment: input.sender_segment, swiftCode: input.beneficiary_bank_swift },
      });

      // Fetch current annual usage from DB
      const year = new Date().getFullYear();
      const usageRow = await getAnnualUsage(ctx.user.id, input.purpose_code, year);
      const usedUsd = usageRow ? safeParseAmount(usageRow.usedUsd as string) : 0;

      // Call Go service with X-Used-Annual-USD header for limit enforcement
      const res = await fetch(`${SWIFT_URL}/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Used-Annual-USD": String(usedUsd),
        },
        body: JSON.stringify({ ...input, sender_user_id: ctx.user.id }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const err = await res.json() as Record<string, unknown>;
        // FF-001: SWIFT rail rejected the transfer — void the TB hold
        // (state-aware compensation; never blind-refunds).
        if (pipelineResult.tigerBeetleRecorded) {
          await compensateFailedTransfer({
            transferId,
            userId: ctx.user.id,
            amount: input.amount_ngn,
            currency: "NGN",
            reason: `SWIFT service rejected submission: ${(err.error as string) ?? res.status}`,
            stage: "settlement",
          }).catch((cErr) => logger.warn({ err: cErr instanceof Error ? cErr.message : String(cErr), transferId }, "[Outbound] Hold release after SWIFT rejection failed — reaper will reconcile"));
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (err.error as string) ?? `SWIFT service error ${res.status}` });
      }

      const result = await res.json() as Record<string, unknown>;

      // FF-001: rail accepted — settle: post the TB hold in full AND debit the
      // PG wallet atomically (journaled, replay-safe).
      if (pipelineResult.tigerBeetleRecorded) {
        await settleTransferHold({
          transferId,
          userId: ctx.user.id,
          amount: input.amount_ngn,
          currency: "NGN",
        });
      }

      // Increment annual usage in DB
      await incrementAnnualUsage(ctx.user.id, input.purpose_code, estimatedUsd);

      return { ...result as object, verified: true, transferId, fraudScore: pipelineResult.fraudScore, tigerBeetleRecorded: pipelineResult.tigerBeetleRecorded };
    }),

  getFeeSchedule: publicProcedure
    .query(async () => callService(`${SWIFT_URL}/fee-schedule`, "GET")),

  checkCompliance: protectedProcedure
    .input(z.object({
      amount_ngn: z.number().positive().max(10_000_000),
      purpose_code: z.string(),
      sender_segment: z.enum(["labor", "education", "medical", "sme", "hnw"]).optional(),
    }))
    .query(async ({ input }) => callService(`${SWIFT_URL}/compliance`, "POST", input)),

  healthCheck: publicProcedure
    .query(async () => callService(`${SWIFT_URL}/health`, "GET")),

  // v199: Live FX rates from Go service
  getLiveFXRates: publicProcedure
    .query(async () => callService(`${SWIFT_URL}/fx-rates`, "GET")),

  // v199: Annual limit for a specific purpose code
  getAnnualLimit: protectedProcedure
    .input(z.object({
      purpose_code: z.string().min(2).max(10),
    }))
    .query(async ({ ctx, input }) => {
      const year = new Date().getFullYear();
      const code = input.purpose_code.toUpperCase();
      const usageRow = await getAnnualUsage(ctx.user.id, code, year);
      const usedUsd = usageRow ? safeParseAmount(usageRow.usedUsd as string) : 0;
      const capUsd = CBN_ANNUAL_LIMITS_USD[code] ?? 0;
      const remainingUsd = Math.max(0, capUsd - usedUsd);
      const utilizationPct = capUsd > 0 ? Math.round((usedUsd / capUsd) * 100) : 0;
      return {
        purposeCode: code,
        annualCapUsd: capUsd,
        usedUsd,
        remainingUsd,
        utilizationPct,
        isExceeded: capUsd > 0 && usedUsd >= capUsd,
        calendarYear: year,
      };
    }),

  // v199: All annual limits for current user
  getAllAnnualLimits: protectedProcedure
    .query(async ({ ctx }) => {
      const year = new Date().getFullYear();
      const usageRows = await getAllAnnualUsageForUser(ctx.user.id, year);
      const usageMap: Record<string, number> = {};
      for (const row of usageRows) {
        usageMap[row.purposeCode] = safeParseAmount(row.usedUsd as string);
      }
      return Object.entries(CBN_ANNUAL_LIMITS_USD).map(([code, cap]) => {
        const used = usageMap[code] ?? 0;
        return {
          purposeCode: code,
          annualCapUsd: cap,
          usedUsd: used,
          remainingUsd: Math.max(0, cap - used),
          utilizationPct: Math.round((used / cap) * 100),
          isExceeded: used >= cap,
          calendarYear: year,
        };
      });
    }),
});

const floatIncomeRouter = router({
  project: protectedProcedure
    .input(z.object({
      daily_volume_ngn: z.number().positive(),
      settlement_days: z.number().min(1).max(5).optional(),
      annual_growth_rate: z.number().min(0).max(2).optional(),
      projection_years: z.number().int().min(1).max(10).optional(),
    }))
    .query(async ({ input }) => callService(`${FLOAT_URL}/project`, "POST", input)),

  dailyAccrual: protectedProcedure
    .input(z.object({ float_balance_ngn: z.number().positive().max(10_000_000) }))
    .query(async ({ input }) => callService(`${FLOAT_URL}/daily-accrual`, "POST", input)),

  healthCheck: publicProcedure
    .query(async () => callService(`${FLOAT_URL}/health`, "GET")),
});

const revenueAnalyticsV2Router = router({
  classifySegment: protectedProcedure
    .input(z.object({
      amount_usd: z.number().positive().max(10_000_000),
      purpose_code: z.string(),
      purpose_description: z.string().max(2000).optional(),
      frequency_per_year: z.number().int().min(1).optional(),
      sender_occupation: z.string().optional(),
    }))
    .query(async ({ input }) => callService(`${ANALYTICS_URL}/segment-classify`, "POST", input)),

  scoreCrossSell: protectedProcedure
    .input(z.object({
      segment: z.enum(["labor", "education", "medical", "sme", "hnw"]),
      amount_usd: z.number().positive().max(10_000_000),
      frequency_per_year: z.number().int().min(1),
      months_active: z.number().int().min(0),
      has_nigerian_account: z.boolean(),
      has_diaspora_account: z.boolean(),
      age_group: z.enum(["18-25", "26-35", "36-50", "50+"]),
    }))
    .query(async ({ input }) => callService(`${ANALYTICS_URL}/cross-sell-score`, "POST", input)),

  formalizationRate: protectedProcedure
    .input(z.object({
      cohort_size: z.number().int().positive(),
      current_channel: z.enum(["cash", "mobile", "account"]),
      months_observed: z.number().int().min(1),
      incentive_offered: z.boolean(),
    }))
    .query(async ({ input }) => callService(`${ANALYTICS_URL}/formalization-rate`, "POST", input)),

  scenarioModel: protectedProcedure
    .input(z.object({
      base_daily_volume_ngn: z.number().positive(),
      growth_scenarios: z.record(z.string(), z.number()),
      segment_mix: z.record(z.string(), z.number()),
      years: z.number().int().min(1).max(10),
      fx_rate_ngn_usd: z.number().positive(),
    }))
    .query(async ({ input }) => callService(`${ANALYTICS_URL}/scenario-model`, "POST", input)),

  healthCheck: publicProcedure
    .query(async () => callService(`${ANALYTICS_URL}/health`, "GET")),
});

// ─── v199: Cross-Sell Offer router ────────────────────────────────────────────
const crossSellRouter = router({
  /**
   * checkAndTrigger: called on login/dashboard load.
   * Calls Python scoreCrossSell; if score > 0.7, creates a pending offer in DB.
   * Returns the active offer (or null if score is low / offer already exists).
   */
  checkAndTrigger: protectedProcedure
    .input(z.object({
      segment: z.enum(["labor", "education", "medical", "sme", "hnw"]).optional(),
      amount_usd: z.number().positive().max(10_000_000).optional(),
      frequency_per_year: z.number().int().min(1).optional(),
      months_active: z.number().int().min(0).optional(),
      has_nigerian_account: z.boolean().optional(),
      has_diaspora_account: z.boolean().optional(),
      age_group: z.enum(["18-25", "26-35", "36-50", "50+"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // First check if there's already an active offer
      const existing = await getActiveCrossSellOffer(ctx.user.id);
      if (existing) return { offer: existing, triggered: false };

      // Score defaults for users with minimal data
      const seg = input.segment ?? "labor";
      const scorePayload = {
        segment: seg,
        amount_usd: input.amount_usd ?? 500,
        frequency_per_year: input.frequency_per_year ?? 4,
        months_active: input.months_active ?? 6,
        has_nigerian_account: input.has_nigerian_account ?? true,
        has_diaspora_account: input.has_diaspora_account ?? false,
        age_group: input.age_group ?? "26-35",
      };

      let score = 0;
      try {
        const scoreResult = await callService(`${ANALYTICS_URL}/cross-sell-score`, "POST", scorePayload) as { score?: number };
        score = scoreResult.score ?? 0;
      } catch {
        // Analytics service unavailable — use heuristic fallback
        score = seg === "education" || seg === "medical" ? 0.75 : 0.5;
      }

      if (score <= 0.7) return { offer: null, triggered: false, score };

      // Score > 0.7 — create a targeted offer
      const template = CROSS_SELL_TEMPLATES[seg] ?? CROSS_SELL_TEMPLATES["labor"];
      const offer = await createCrossSellOffer({
        userId: ctx.user.id,
        offerType: template.offerType,
        score,
        segment: seg,
        headline: template.headline,
        body: template.body,
        ctaLabel: template.ctaLabel,
        ctaUrl: template.ctaUrl,
      });

      await createAuditLog({ userId: ctx.user.id, action: "crossSell.offerTriggered", description: `segment=${seg} score=${score}`, metadata: { segment: seg, score, offerType: template.offerType } });
      return { offer, triggered: true, score };
    }),

  /** getActive: returns the current pending offer for the user */
  getActive: protectedProcedure
    .query(async ({ ctx }) => {
      const offer = await getActiveCrossSellOffer(ctx.user.id);
      return { offer };
    }),

  /** markShown: called when the modal is displayed */
  markShown: protectedProcedure
    .input(z.object({ offerId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await markCrossSellOfferShown(input.offerId);
      return { ok: true };
    }),

  /** respond: user accepts or dismisses the offer */
  respond: protectedProcedure
    .input(z.object({
      offerId: z.number().int().positive(),
      response: z.enum(["accepted", "dismissed"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await respondToCrossSellOffer(input.offerId, input.response);
      await createAuditLog({ userId: ctx.user.id, action: `crossSell.offer${input.response === "accepted" ? "Accepted" : "Dismissed"}`, description: `offerId=${input.offerId}`, metadata: { offerId: input.offerId } });
      return { ok: true };
    }),
});

export const outboundRouter = router({
  swift: swiftRouter,
  floatIncome: floatIncomeRouter,
  analytics: revenueAnalyticsV2Router,
  crossSell: crossSellRouter,
});
