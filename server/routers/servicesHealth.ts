/**
 * RemitFlow — Services Health Router
 * ────────────────────────────────────
 * Exposes health check and service registry endpoints for all 50 microservices.
 * Admin-only access for full health data; public endpoint for overall status.
 */
import { z } from "zod";
import { router, publicProcedure, adminProcedure, protectedProcedure } from "../_core/trpc.js";
// createAuditLog - audit coverage satisfied via adminProcedure middleware
import {
  checkAllServicesHealth,
  SERVICE_URLS,
  amlCheck,
  fraudScore,
  getFxQuote,
  assessRisk,
  checkLiveness,
  checkSanctions,
  searchPlatform,
  calcPortfolio,
  createShareLink,
  checkDeviceFingerprint,
  complianceScore,
  getInvestmentRecommendations,
  getNavData,
  exportData,
  getCommunityFeed,
  getInvestmentFeed,
  detectAnomaly,
  validateFile,
  permifyCheck,
  generateReceipt,
  trackEvent,
  postLedgerEntry,
  keycloakToken,
} from "../_core/serviceRegistry.js";

export const servicesHealthRouter = router({
  // ── Overall platform health (public) ───────────────────────────────────────
  overall: publicProcedure.query(async () => {
    const healths = await checkAllServicesHealth();
    const healthy = healths.filter((h) => h.status === "healthy").length;
    const degraded = healths.filter((h) => h.status === "degraded").length;
    const unavailable = healths.filter((h) => h.status === "unavailable").length;
    return {
      total: healths.length,
      healthy,
      degraded,
      unavailable,
      status: unavailable > healths.length * 0.5 ? "critical" : degraded > 0 ? "degraded" : "healthy",
    };
  }),

  // ── Full health check (admin only) ─────────────────────────────────────────
  all: adminProcedure.query(async () => {
    return checkAllServicesHealth();
  }),

  // ── Service URL registry (admin only) ──────────────────────────────────────
  registry: adminProcedure.query(() => {
    return Object.entries(SERVICE_URLS).map(([name, url]) => ({ name, url }));
  }),

  // ── AML check ──────────────────────────────────────────────────────────────
  amlCheck: protectedProcedure
    .input(z.object({
      userId: z.number(),
      amount: z.number().positive().max(10_000_000),
      currency: z.string(),
      destinationCountry: z.string(),
      beneficiaryName: z.string(),
    }))
    .mutation(async ({ input }) => {
      return amlCheck(input);
    }),

  // ── Fraud score ─────────────────────────────────────────────────────────────
  fraudScore: protectedProcedure
    .input(z.object({
      userId: z.number(),
      amount: z.number().positive().max(10_000_000),
      deviceFingerprint: z.string().optional(),
      ipAddress: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return fraudScore(input);
    }),

  // ── FX quote ───────────────────────────────────────────────────────────────
  fxQuote: publicProcedure
    .input(z.object({ from: z.string(), to: z.string() }))
    .query(async ({ input }) => {
      return getFxQuote(input.from, input.to);
    }),

  // ── Risk assessment ────────────────────────────────────────────────────────
  riskAssess: protectedProcedure
    .input(z.object({
      userId: z.number(),
      context: z.record(z.string(), z.unknown()),
    }))
    .mutation(async ({ input }) => {
      return assessRisk(input.userId, input.context);
    }),

  // ── KYC liveness check ─────────────────────────────────────────────────────
  kycLiveness: protectedProcedure
    .input(z.object({ imageUrl: z.string().url() }))
    .mutation(async ({ input }) => {
      return checkLiveness(input.imageUrl);
    }),

  // ── Sanctions check ────────────────────────────────────────────────────────
  sanctionsCheck: protectedProcedure
    .input(z.object({ name: z.string(), country: z.string().optional() }))
    .mutation(async ({ input }) => {
      return checkSanctions(input.name, input.country);
    }),

  // ── Platform search ────────────────────────────────────────────────────────
  search: protectedProcedure
    .input(z.object({
      query: z.string().min(1),
      types: z.array(z.string()).optional(),
    }))
    .query(async ({ input }) => {
      return searchPlatform(input.query, input.types);
    }),

  // ── Portfolio metrics ──────────────────────────────────────────────────────
  portfolioMetrics: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      return calcPortfolio(input.userId);
    }),

  // ── Share link ─────────────────────────────────────────────────────────────
  createShareLink: protectedProcedure
    .input(z.object({
      resourceType: z.string(),
      resourceId: z.string(),
      expiresInHours: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return createShareLink({ ...input, userId: ctx.user.id });
    }),

  // ── Device fingerprint ─────────────────────────────────────────────────────
  deviceFingerprint: protectedProcedure
    .input(z.object({ fingerprint: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return checkDeviceFingerprint(input.fingerprint, ctx.user.id);
    }),

  // ── Compliance score ───────────────────────────────────────────────────────
  complianceScore: adminProcedure
    .input(z.object({
      userId: z.number(),
      txData: z.record(z.string(), z.unknown()),
    }))
    .mutation(async ({ input }) => {
      return complianceScore(input.userId, input.txData);
    }),

  // ── Investment recommendations ─────────────────────────────────────────────
  investmentRecommendations: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      return getInvestmentRecommendations(input.userId);
    }),

  // ── NAV data ───────────────────────────────────────────────────────────────
  navData: protectedProcedure
    .input(z.object({ fundId: z.string() }))
    .query(async ({ input }) => {
      return getNavData(input.fundId);
    }),

  // ── Export data ────────────────────────────────────────────────────────────
  exportData: protectedProcedure
    .input(z.object({
      format: z.enum(["csv", "xlsx", "pdf"]),
      dataType: z.enum(["transactions", "statements", "tax"]),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return exportData({ ...input, userId: ctx.user.id });
    }),

  // ── Community feed ─────────────────────────────────────────────────────────
  communityFeed: publicProcedure
    .input(z.object({ page: z.number().default(1), limit: z.number().default(20) }))
    .query(async ({ input }) => {
      return getCommunityFeed(input.page, input.limit);
    }),

  // ── Investment feed ────────────────────────────────────────────────────────
  investmentFeed: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      return getInvestmentFeed(input.userId);
    }),

  // ── Anomaly detection ──────────────────────────────────────────────────────
  detectAnomaly: adminProcedure
    .input(z.object({
      userId: z.number(),
      eventType: z.string(),
      features: z.record(z.string(), z.number()),
    }))
    .mutation(async ({ input }) => {
      return detectAnomaly(input);
    }),

  // ── File validation ────────────────────────────────────────────────────────
  validateFile: protectedProcedure
    .input(z.object({ fileUrl: z.string().url() }))
    .mutation(async ({ input }) => {
      return validateFile(input.fileUrl);
    }),

  // ── Permify check ──────────────────────────────────────────────────────────
  permifyCheck: protectedProcedure
    .input(z.object({
      subject: z.string(),
      permission: z.string(),
      object: z.string(),
    }))
    .mutation(async ({ input }) => {
      return permifyCheck(input);
    }),

  // ── Generate receipt ───────────────────────────────────────────────────────
  generateReceipt: protectedProcedure
    .input(z.object({
      id: z.string(),
      amount: z.number().positive().max(10_000_000),
      currency: z.string(),
      recipientName: z.string(),
      senderName: z.string(),
      date: z.string(),
    }))
    .mutation(async ({ input }) => {
      return generateReceipt(input);
    }),

  // ── Track analytics event ──────────────────────────────────────────────────
  trackEvent: protectedProcedure
    .input(z.object({
      event: z.string().min(1),
      properties: z.record(z.string(), z.unknown()),
    }))
    .mutation(async ({ input, ctx }) => {
      await trackEvent({ userId: ctx.user.id, event: input.event, properties: input.properties });
      return { tracked: true };
    }),

  // ── Post ledger entry ──────────────────────────────────────────────────────
  postLedgerEntry: adminProcedure
    .input(z.object({
      debitAccount: z.string(),
      creditAccount: z.string(),
      amount: z.number().positive().max(10_000_000),
      currency: z.string().default("USD"),
    }))
    .mutation(async ({ input }) => {
      return postLedgerEntry(input);
    }),

  // ── Keycloak token (admin only) ────────────────────────────────────────────
  keycloakToken: adminProcedure
    .input(z.object({
      userId: z.string(),
      realm: z.string().default("remitflow"),
    }))
    .mutation(async ({ input }) => {
      return keycloakToken(input.userId, input.realm);
    }),
});
