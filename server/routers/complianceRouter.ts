/**
 * complianceRouter.ts — tRPC Router for Phase 2 Compliance Features
 *
 * Exposes endpoints for:
 *   - Travel Rule management
 *   - Regulatory reporting (SAR/STR/CTR)
 *   - Enhanced screening (PEP, adverse media)
 *   - Data residency controls
 *   - Audit trail queries
 *   - KYC webhook processing
 *   - Continuous monitoring
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  requiresTravelRule,
  buildIVMS101Payload,
  submitTravelRuleTransfer,
  resolveCounterpartyVASP,
  TRAVEL_RULE_THRESHOLDS,
} from "../lib/travelRule";
import {
  generateCTR,
  generateSAR,
  detectStructuring,
  submitReport,
  shouldFileCTR,
  getJurisdiction,
  CTR_THRESHOLDS,
  SUSPICIOUS_INDICATORS,
} from "../lib/regulatoryReporting";
import {
  getDataRegion,
  canTransferData,
  processDataSubjectRequest,
  generateDataExport,
  validateProcessingLegality,
  DATA_CATEGORIES,
  DATA_RESIDENCY_POLICIES,
} from "../lib/dataResidency";
import {
  recordAuditEvent,
  verifyChainIntegrity,
  generateAuditExport,
} from "../lib/complianceAuditTrail";
import {
  runEnhancedScreening,
  enableContinuousMonitoring,
  requiresEDD,
  SANCTIONS_LISTS,
} from "../lib/enhancedScreening";
import {
  processOnfidoWebhook,
  processSmileWebhook,
  verifyOnfidoSignature,
  verifySmileSignature,
  getTierLimits,
  checkTierLimit,
  KYC_TIER_LIMITS,
} from "../lib/kycWebhooks";

export const complianceRouter = router({
  // ── Travel Rule ─────────────────────────────────────────────────────────

  travelRule: router({
    checkThreshold: protectedProcedure
      .input(z.object({
        amount: z.number(),
        currency: z.string(),
        originatorCountry: z.string(),
        beneficiaryCountry: z.string(),
      }))
      .query(({ input }) => requiresTravelRule(input)),

    submit: protectedProcedure
      .input(z.object({
        originator: z.object({
          firstName: z.string(),
          lastName: z.string(),
          dateOfBirth: z.string().optional(),
          nationalId: z.string().optional(),
          nationalIdType: z.string().optional(),
          country: z.string(),
          accountNumber: z.string(),
        }),
        beneficiary: z.object({
          firstName: z.string(),
          lastName: z.string(),
          country: z.string(),
          accountNumber: z.string(),
        }),
        asset: z.string(),
        amount: z.string(),
        chain: z.string(),
        txHash: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const ivms101 = buildIVMS101Payload(input);
        const vasp = await resolveCounterpartyVASP(input.beneficiary.accountNumber, input.chain);
        return submitTravelRuleTransfer({
          ivms101,
          asset: input.asset,
          amount: input.amount,
          chain: input.chain,
          txHash: input.txHash,
          beneficiaryVASPdid: vasp?.did,
        });
      }),

    getThresholds: protectedProcedure.query(() => TRAVEL_RULE_THRESHOLDS),

    resolveVASP: protectedProcedure
      .input(z.object({ walletAddress: z.string(), chain: z.string() }))
      .query(async ({ input }) => resolveCounterpartyVASP(input.walletAddress, input.chain)),
  }),

  // ── Regulatory Reporting ────────────────────────────────────────────────

  reporting: router({
    fileCTR: protectedProcedure
      .input(z.object({
        subject: z.object({
          type: z.enum(["individual", "entity"]),
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          entityName: z.string().optional(),
          country: z.string(),
          accountNumbers: z.array(z.string()),
        }),
        transaction: z.object({
          id: z.string(),
          date: z.string(),
          amount: z.number(),
          currency: z.string(),
          type: z.enum(["wire", "crypto", "cash", "mobile_money", "card"]),
          direction: z.enum(["inbound", "outbound", "internal"]),
        }),
        jurisdiction: z.enum(["CA", "US", "GB", "NG", "GH", "KE", "ZA"]),
      }))
      .mutation(async ({ input, ctx }) => {
        const report = generateCTR({
          subject: input.subject,
          transaction: input.transaction,
          jurisdiction: input.jurisdiction,
          filedBy: `user-${ctx.user.id}`,
        });
        return submitReport(report);
      }),

    fileSAR: protectedProcedure
      .input(z.object({
        subject: z.object({
          type: z.enum(["individual", "entity"]),
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          entityName: z.string().optional(),
          country: z.string(),
          accountNumbers: z.array(z.string()),
        }),
        transactions: z.array(z.object({
          id: z.string(),
          date: z.string(),
          amount: z.number(),
          currency: z.string(),
          type: z.enum(["wire", "crypto", "cash", "mobile_money", "card"]),
          direction: z.enum(["inbound", "outbound", "internal"]),
        })),
        indicators: z.array(z.string()),
        narrative: z.string().min(50),
        jurisdiction: z.enum(["CA", "US", "GB", "NG", "GH", "KE", "ZA"]),
        dateRange: z.object({ from: z.string(), to: z.string() }),
      }))
      .mutation(async ({ input, ctx }) => {
        const matchedIndicators = SUSPICIOUS_INDICATORS.filter(i => input.indicators.includes(i.code));
        const report = generateSAR({
          subject: input.subject,
          transactions: input.transactions,
          indicators: matchedIndicators,
          narrative: input.narrative,
          jurisdiction: input.jurisdiction,
          filedBy: `user-${ctx.user.id}`,
          dateRange: input.dateRange,
        });
        return submitReport(report);
      }),

    detectStructuring: protectedProcedure
      .input(z.object({
        transactions: z.array(z.object({
          id: z.string(),
          date: z.string(),
          amount: z.number(),
          currency: z.string(),
          type: z.enum(["wire", "crypto", "cash", "mobile_money", "card"]),
          direction: z.enum(["inbound", "outbound", "internal"]),
        })),
        jurisdiction: z.enum(["CA", "US", "GB", "NG", "GH", "KE", "ZA"]),
      }))
      .query(({ input }) => detectStructuring({ transactions: input.transactions, jurisdiction: input.jurisdiction })),

    shouldFileCTR: protectedProcedure
      .input(z.object({
        amount: z.number(),
        currency: z.string(),
        jurisdiction: z.enum(["CA", "US", "GB", "NG", "GH", "KE", "ZA"]),
      }))
      .query(({ input }) => shouldFileCTR(input.amount, input.currency, input.jurisdiction)),

    getIndicators: protectedProcedure.query(() => SUSPICIOUS_INDICATORS),
    getCTRThresholds: protectedProcedure.query(() => CTR_THRESHOLDS),
  }),

  // ── Enhanced Screening ──────────────────────────────────────────────────

  screening: router({
    run: protectedProcedure
      .input(z.object({
        name: z.string(),
        dateOfBirth: z.string().optional(),
        country: z.string().optional(),
        transactionId: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => runEnhancedScreening({ ...input, userId: ctx.user.id })),

    enableMonitoring: protectedProcedure
      .input(z.object({
        name: z.string(),
        country: z.string(),
        dateOfBirth: z.string().optional(),
        riskLevel: z.enum(["low", "medium", "high", "critical", "prohibited"]),
      }))
      .mutation(async ({ input, ctx }) => enableContinuousMonitoring({ ...input, userId: ctx.user.id })),

    checkEDD: protectedProcedure
      .input(z.object({
        pepMatches: z.array(z.object({
          name: z.string(),
          position: z.string(),
          country: z.string(),
          level: z.enum(["head_of_state", "senior_official", "legislature", "judiciary", "military", "state_enterprise", "family_member", "close_associate"]),
          source: z.string(),
        })),
      }))
      .query(({ input }) => requiresEDD(input.pepMatches)),

    getLists: protectedProcedure.query(() => SANCTIONS_LISTS),
  }),

  // ── Data Residency ──────────────────────────────────────────────────────

  dataResidency: router({
    getRegion: protectedProcedure
      .input(z.object({ country: z.string() }))
      .query(({ input }) => getDataRegion(input.country)),

    canTransfer: protectedProcedure
      .input(z.object({ fromCountry: z.string(), toRegion: z.enum(["eu-west", "us-east", "ca-central", "ng-lagos", "za-johannesburg", "ke-nairobi", "gb-london"]) }))
      .query(({ input }) => canTransferData(input.fromCountry, input.toRegion)),

    submitDSAR: protectedProcedure
      .input(z.object({
        type: z.enum(["access", "erasure", "rectification", "portability", "restriction", "objection"]),
        reason: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => processDataSubjectRequest({
        userId: ctx.user.id,
        userEmail: ctx.user.email || "",
        country: "US", // Would be read from user profile in production
        type: input.type,
        reason: input.reason,
      })),

    exportData: protectedProcedure
      .input(z.object({ categories: z.array(z.string()) }))
      .query(({ input, ctx }) => generateDataExport({ userId: ctx.user.id, categories: input.categories })),

    validateProcessing: protectedProcedure
      .input(z.object({
        country: z.string(),
        dataCategory: z.string(),
        purpose: z.string(),
        hasConsent: z.boolean(),
      }))
      .query(({ input }) => validateProcessingLegality(input)),

    getPolicies: protectedProcedure.query(() => DATA_RESIDENCY_POLICIES),
    getCategories: protectedProcedure.query(() => DATA_CATEGORIES),
  }),

  // ── Audit Trail ─────────────────────────────────────────────────────────

  audit: router({
    record: protectedProcedure
      .input(z.object({
        type: z.string(),
        details: z.record(z.string(), z.unknown()),
        jurisdiction: z.string().optional(),
        correlationId: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => recordAuditEvent({
        type: input.type as Parameters<typeof recordAuditEvent>[0]["type"],
        userId: ctx.user.id,
        actorId: `user-${ctx.user.id}`,
        actorType: "user",
        jurisdiction: input.jurisdiction,
        details: input.details,
        correlationId: input.correlationId,
      })),

    verifyIntegrity: protectedProcedure
      .input(z.object({ events: z.array(z.any()) }))
      .query(({ input }) => verifyChainIntegrity(input.events)),

    export: protectedProcedure
      .input(z.object({
        format: z.enum(["json", "csv", "xml"]),
        jurisdiction: z.string(),
        dateRange: z.object({ from: z.string(), to: z.string() }),
      }))
      .query(({ input, ctx }) => generateAuditExport({
        events: [],
        format: input.format,
        jurisdiction: input.jurisdiction,
        exportedBy: `user-${ctx.user.id}`,
        dateRange: input.dateRange,
      })),
  }),

  // ── KYC Tier Management ─────────────────────────────────────────────────

  kyc: router({
    getTierLimits: protectedProcedure
      .input(z.object({ tier: z.number().min(0).max(3) }))
      .query(({ input }) => getTierLimits(input.tier)),

    checkLimit: protectedProcedure
      .input(z.object({
        tier: z.number(),
        amount: z.number(),
        dailyTotal: z.number(),
        monthlyTotal: z.number(),
      }))
      .query(({ input }) => checkTierLimit(input)),

    getAllTiers: protectedProcedure.query(() => KYC_TIER_LIMITS),
  }),
});

export type ComplianceRouter = typeof complianceRouter;
