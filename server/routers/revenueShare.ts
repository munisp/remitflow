import { router, protectedProcedure, adminProcedure } from "../_core/trpc.js";
import { createAuditLog } from "../db.js";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, asc, sql, gte, lte, sum, count } from "drizzle-orm";
import {
  revenueShareAgreements, revenueShareTiers, revenueShareLedger,
  revenueShareReports, partnerPayouts, tenants, transactions, users,
} from "../../drizzle/schema.js";

async function getDb() {
  const { getDb: _getDb } = await import("../db.js");
  return _getDb();
}

// ─── Revenue Share Router ─────────────────────────────────────────────────────
export const revenueShareRouter = router({

  // ── Agreements ──────────────────────────────────────────────────────────────
  listAgreements: adminProcedure
    .input(z.object({
      status: z.enum(["draft", "active", "suspended", "terminated", "all"]).default("all"),
      tenantId: z.number().optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      let q = db
        .select({
          agreement: revenueShareAgreements,
          tenantName: tenants.name,
          tenantSlug: tenants.slug,
        })
        .from(revenueShareAgreements)
        .leftJoin(tenants, eq(revenueShareAgreements.tenantId, tenants.id))
        .orderBy(desc(revenueShareAgreements.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      const rows = await q;
      return {
        agreements: rows.map((r: any) => ({ ...r.agreement, tenantName: r.tenantName, tenantSlug: r.tenantSlug })),
        total: rows.length,
      };
    }),

  getAgreement: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [agreement] = await db
        .select()
        .from(revenueShareAgreements)
        .where(eq(revenueShareAgreements.id, input.id));
      if (!agreement) throw new TRPCError({ code: "NOT_FOUND" });
      const tiers = await db
        .select()
        .from(revenueShareTiers)
        .where(eq(revenueShareTiers.agreementId, input.id))
        .orderBy(asc(revenueShareTiers.sortOrder));
      return { ...agreement, tiers };
    }),

  createAgreement: adminProcedure
    .input(z.object({
      tenantId: z.number(),
      name: z.string().min(1).max(255),
      model: z.enum(["percentage", "flat_fee", "tiered", "hybrid"]).default("percentage"),
      baseRate: z.number().min(0).max(1).default(0.3),
      flatFeeAmount: z.number().min(0).default(0),
      flatFeeCurrency: z.string().default("USD"),
      minPayoutThreshold: z.number().min(0).default(50),
      payoutCurrency: z.string().default("USD"),
      payoutMethod: z.enum(["bank_transfer", "crypto", "mobile_money", "paypal"]).default("bank_transfer"),
      payoutFrequency: z.string().default("monthly"),
      effectiveFrom: z.string().optional(),
      effectiveTo: z.string().optional(),
      bankName: z.string().optional(),
      bankAccountNumber: z.string().optional(),
      bankRoutingNumber: z.string().optional(),
      bankSwiftCode: z.string().optional(),
      bankIban: z.string().optional(),
      paypalEmail: z.string().email().optional(),
      notes: z.string().optional(),
      tiers: z.array(z.object({
        tierName: z.string(),
        minMonthlyVolume: z.number(),
        maxMonthlyVolume: z.number().optional(),
        rate: z.number().min(0).max(1),
        bonusRate: z.number().min(0).max(1).default(0),
        sortOrder: z.number().default(0),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { tiers: tierInput, ...agreementData } = input;
      const [result] = await db.insert(revenueShareAgreements).values({
        ...agreementData,
        baseRate: agreementData.baseRate.toString(),
        flatFeeAmount: agreementData.flatFeeAmount.toString(),
        minPayoutThreshold: agreementData.minPayoutThreshold.toString(),
        effectiveFrom: agreementData.effectiveFrom ? new Date(agreementData.effectiveFrom) : new Date(),
        effectiveTo: agreementData.effectiveTo ? new Date(agreementData.effectiveTo) : undefined,
        createdBy: ctx.user.id,
      }).returning();
      const agreementId = (result as any).id;
      if (tierInput && tierInput.length > 0) {
        await db.insert(revenueShareTiers).values(
          tierInput.map(t => ({
            agreementId,
            tierName: t.tierName,
            minMonthlyVolume: t.minMonthlyVolume.toString(),
            maxMonthlyVolume: t.maxMonthlyVolume?.toString(),
            rate: t.rate.toString(),
            bonusRate: t.bonusRate.toString(),
            sortOrder: t.sortOrder,
          }))
        );
      }
      return { id: agreementId, success: true };
    }),

  updateAgreement: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      model: z.enum(["percentage", "flat_fee", "tiered", "hybrid"]).optional(),
      baseRate: z.number().min(0).max(1).optional(),
      minPayoutThreshold: z.number().min(0).optional(),
      payoutFrequency: z.string().optional(),
      bankName: z.string().optional(),
      bankAccountNumber: z.string().optional(),
      bankSwiftCode: z.string().optional(),
      bankIban: z.string().optional(),
      paypalEmail: z.string().optional(),
      notes: z.string().optional(),
      status: z.enum(["draft", "active", "suspended", "terminated"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, baseRate, minPayoutThreshold, ...rest } = input;
      await db.update(revenueShareAgreements)
        .set({
          ...rest,
          ...(baseRate !== undefined ? { baseRate: baseRate.toString() } : {}),
          ...(minPayoutThreshold !== undefined ? { minPayoutThreshold: minPayoutThreshold.toString() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(revenueShareAgreements.id, id));
      return { success: true, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  approveAgreement: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [_row] = await db.update(revenueShareAgreements)
        .set({ status: "active", approvedBy: ctx.user.id, approvedAt: new Date(), updatedAt: new Date() })
        .where(eq(revenueShareAgreements.id, input.id)).returning();
      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found or access denied" });
      return { success: true, id: (_row as any).id, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  terminateAgreement: adminProcedure
    .input(z.object({ id: z.number(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [_row] = await db.update(revenueShareAgreements)
        .set({ status: "terminated", effectiveTo: new Date(), notes: input.reason, updatedAt: new Date() })
        .where(eq(revenueShareAgreements.id, input.id)).returning();
      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found or access denied" });
      return { success: true, id: (_row as any).id, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  // ── Tiers ────────────────────────────────────────────────────────────────────
  addTier: adminProcedure
    .input(z.object({
      agreementId: z.number(),
      tierName: z.string(),
      minMonthlyVolume: z.number(),
      maxMonthlyVolume: z.number().optional(),
      rate: z.number().min(0).max(1),
      bonusRate: z.number().min(0).max(1).default(0),
      sortOrder: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [result] = await db.insert(revenueShareTiers).values({
        agreementId: input.agreementId,
        tierName: input.tierName,
        minMonthlyVolume: input.minMonthlyVolume.toString(),
        maxMonthlyVolume: input.maxMonthlyVolume?.toString(),
        rate: input.rate.toString(),
        bonusRate: input.bonusRate.toString(),
        sortOrder: input.sortOrder,
      }).returning();
      return result;
    }),

  deleteTier: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const _deleted = await db.delete(revenueShareTiers).where(eq(revenueShareTiers.id, input.id)).returning();
      if (_deleted.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return { success: true, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  // ── Ledger ────────────────────────────────────────────────────────────────────
  getLedger: adminProcedure
    .input(z.object({
      agreementId: z.number().optional(),
      tenantId: z.number().optional(),
      periodMonth: z.number().optional(),
      periodYear: z.number().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const conditions = [];
      if (input.agreementId) conditions.push(eq(revenueShareLedger.agreementId, input.agreementId));
      if (input.tenantId) conditions.push(eq(revenueShareLedger.tenantId, input.tenantId));
      if (input.periodMonth) conditions.push(eq(revenueShareLedger.periodMonth, input.periodMonth));
      if (input.periodYear) conditions.push(eq(revenueShareLedger.periodYear, input.periodYear));
      const entries = await db
        .select()
        .from(revenueShareLedger)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(revenueShareLedger.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      return { entries, total: entries.length };
    }),

  // ── Reports ────────────────────────────────────────────────────────────────────
  generateReport: adminProcedure
    .input(z.object({
      tenantId: z.number(),
      agreementId: z.number(),
      periodMonth: z.number().min(1).max(12),
      periodYear: z.number().min(2020).max(2100),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Aggregate ledger entries for the period
      const ledgerRows = await db
        .select()
        .from(revenueShareLedger)
        .where(and(
          eq(revenueShareLedger.agreementId, input.agreementId),
          eq(revenueShareLedger.tenantId, input.tenantId),
          eq(revenueShareLedger.periodMonth, input.periodMonth),
          eq(revenueShareLedger.periodYear, input.periodYear),
        ));
      const totalFeeRevenue = ledgerRows.reduce((s: any, r: any) => s + parseFloat(r.grossFeeRevenue), 0);
      const partnerEarnings = ledgerRows.reduce((s: any, r: any) => s + parseFloat(r.partnerShare), 0);
      const platformEarnings = ledgerRows.reduce((s: any, r: any) => s + parseFloat(r.platformShare), 0);
      const totalTransactions = ledgerRows.filter((r: any) => r.transactionId).length;
      // Get the agreement to find applied rate
      const [agreement] = await db.select().from(revenueShareAgreements).where(eq(revenueShareAgreements.id, input.agreementId));
      const appliedRate = agreement?.baseRate || "0.3";
      // Upsert report
      const existing = await db.select().from(revenueShareReports).where(and(
        eq(revenueShareReports.agreementId, input.agreementId),
        eq(revenueShareReports.periodMonth, input.periodMonth),
        eq(revenueShareReports.periodYear, input.periodYear),
      ));
      if (existing.length > 0) {
        await db.update(revenueShareReports)
          .set({
            totalTransactions, totalFeeRevenue: totalFeeRevenue.toString(),
            partnerEarnings: partnerEarnings.toString(), platformEarnings: platformEarnings.toString(),
            appliedRate, generatedAt: new Date(),
          })
          .where(eq(revenueShareReports.id, existing[0].id));
        return { id: existing[0].id, updated: true };
      }
      const [report] = await db.insert(revenueShareReports).values({
        tenantId: input.tenantId, agreementId: input.agreementId,
        periodMonth: input.periodMonth, periodYear: input.periodYear,
        totalTransactions, totalFeeRevenue: totalFeeRevenue.toString(),
        partnerEarnings: partnerEarnings.toString(), platformEarnings: platformEarnings.toString(),
        appliedRate, status: "pending",
      }).returning();
      return { id: (report as any).id, created: true };
    }),

  listReports: adminProcedure
    .input(z.object({
      tenantId: z.number().optional(),
      agreementId: z.number().optional(),
      status: z.enum(["pending", "paid", "disputed", "all"]).default("all"),
      limit: z.number().default(20),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const conditions = [];
      if (input.tenantId) conditions.push(eq(revenueShareReports.tenantId, input.tenantId));
      if (input.agreementId) conditions.push(eq(revenueShareReports.agreementId, input.agreementId));
      if (input.status !== "all") conditions.push(eq(revenueShareReports.status, input.status));
      const reports = await db
        .select({
          report: revenueShareReports,
          tenantName: tenants.name,
        })
        .from(revenueShareReports)
        .leftJoin(tenants, eq(revenueShareReports.tenantId, tenants.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(revenueShareReports.generatedAt))
        .limit(input.limit)
        .offset(input.offset);
      return {
        reports: reports.map((r: any) => ({ ...r.report, tenantName: r.tenantName })),
        total: reports.length,
      };
    }),

  markReportPaid: adminProcedure
    .input(z.object({ reportId: z.number(), payoutId: z.number().optional() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [_row] = await db.update(revenueShareReports)
        .set({ status: "paid", paidAt: new Date(), ...(input.payoutId ? { payoutId: input.payoutId } : {}) })
        .where(eq(revenueShareReports.id, input.reportId)).returning();
      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found or access denied" });
      return { success: true, id: (_row as any).id, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  // ── Analytics ─────────────────────────────────────────────────────────────────
  adminAnalytics: adminProcedure
    .input(z.object({
      periodYear: z.number().default(new Date().getFullYear()),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // Aggregate by tenant for the year
      const byTenant = await db
        .select({
          tenantId: revenueShareReports.tenantId,
          tenantName: tenants.name,
          totalPartnerEarnings: sql<string>`sum(${revenueShareReports.partnerEarnings})`,
          totalPlatformEarnings: sql<string>`sum(${revenueShareReports.platformEarnings})`,
          totalVolume: sql<string>`sum(${revenueShareReports.totalVolume})`,
          totalTransactions: sql<string>`sum(${revenueShareReports.totalTransactions})`,
          reportCount: sql<string>`count(*)`,
        })
        .from(revenueShareReports)
        .leftJoin(tenants, eq(revenueShareReports.tenantId, tenants.id))
        .where(eq(revenueShareReports.periodYear, input.periodYear))
        .groupBy(revenueShareReports.tenantId, tenants.name);
      // Monthly trend
      const monthlyTrend = await db
        .select({
          month: revenueShareReports.periodMonth,
          totalPartnerEarnings: sql<string>`sum(${revenueShareReports.partnerEarnings})`,
          totalPlatformEarnings: sql<string>`sum(${revenueShareReports.platformEarnings})`,
          totalVolume: sql<string>`sum(${revenueShareReports.totalVolume})`,
        })
        .from(revenueShareReports)
        .where(eq(revenueShareReports.periodYear, input.periodYear))
        .groupBy(revenueShareReports.periodMonth)
        .orderBy(asc(revenueShareReports.periodMonth));
      const totalPartnerPaid = byTenant.reduce((s: any, r: any) => s + parseFloat(r.totalPartnerEarnings || "0"), 0);
      const totalPlatformKept = byTenant.reduce((s: any, r: any) => s + parseFloat(r.totalPlatformEarnings || "0"), 0);
      return {
        summary: {
          totalPartnerPaid,
          totalPlatformKept,
          totalRevenue: totalPartnerPaid + totalPlatformKept,
          activeAgreements: byTenant.length,
          avgPartnerRate: byTenant.length > 0
            ? (totalPartnerPaid / (totalPartnerPaid + totalPlatformKept) * 100).toFixed(1)
            : "0",
        },
        byTenant: byTenant.map((r: any) => ({
          tenantId: r.tenantId,
          tenantName: r.tenantName || `Tenant ${r.tenantId}`,
          partnerEarnings: parseFloat(r.totalPartnerEarnings || "0"),
          platformEarnings: parseFloat(r.totalPlatformEarnings || "0"),
          volume: parseFloat(r.totalVolume || "0"),
          transactions: parseInt(r.totalTransactions || "0"),
        })),
        monthlyTrend: monthlyTrend.map((r: any) => ({
          month: r.month,
          partnerEarnings: parseFloat(r.totalPartnerEarnings || "0"),
          platformEarnings: parseFloat(r.totalPlatformEarnings || "0"),
          volume: parseFloat(r.totalVolume || "0"),
        })),
      };
    }),

  // ── Tenant-facing portal ─────────────────────────────────────────────────────
  myAgreement: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // Find tenant for this user
      const [tenantUser] = await db
        .select({ tenantId: sql<number>`tenant_users.tenant_id` })
        .from(sql`tenant_users`)
        .where(sql`tenant_users.user_id = ${ctx.user.id}`)
        .limit(1);
      if (!tenantUser) return null;
      const [agreement] = await db
        .select()
        .from(revenueShareAgreements)
        .where(and(
          eq(revenueShareAgreements.tenantId, tenantUser.tenantId),
          eq(revenueShareAgreements.status, "active"),
        ))
        .limit(1);
      if (!agreement) return null;
      const tiers = await db
        .select()
        .from(revenueShareTiers)
        .where(eq(revenueShareTiers.agreementId, agreement.id))
        .orderBy(asc(revenueShareTiers.sortOrder));
      return { ...agreement, tiers };
    }),

  applyAsPartner: protectedProcedure
    .input(z.object({
      companyName: z.string().min(2),
      contactEmail: z.string().email(),
      contactName: z.string().min(2),
      country: z.string().min(2),
      businessType: z.string().optional(),
      expectedVolume: z.string().optional(),
      targetCorridors: z.string().optional(),
      message: z.string().optional(),
      agreedToTerms: z.boolean(),
      signatureName: z.string().min(2),
      signatureTitle: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await createAuditLog({ userId: ctx.user.id, action: "partner.apply", metadata: { companyName: input.companyName, contactEmail: input.contactEmail } });
      return {
        success: true,
        applicationId: `PA-${Date.now()}`,
        message: "Application received. Our team will review and contact you within 2 business days.",
      };
    }),

  myEarnings: protectedProcedure
    .input(z.object({
      periodYear: z.number().default(new Date().getFullYear()),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [tenantUser] = await db
        .select({ tenantId: sql<number>`tenant_users.tenant_id` })
        .from(sql`tenant_users`)
        .where(sql`tenant_users.user_id = ${ctx.user.id}`)
        .limit(1);
      if (!tenantUser) return { reports: [], summary: null };
      const reports = await db
        .select()
        .from(revenueShareReports)
        .where(and(
          eq(revenueShareReports.tenantId, tenantUser.tenantId),
          eq(revenueShareReports.periodYear, input.periodYear),
        ))
        .orderBy(desc(revenueShareReports.periodMonth));
      const totalEarned = reports.reduce((s: any, r: any) => s + parseFloat(r.partnerEarnings), 0);
      const totalPaid = reports.filter((r: any) => r.status === "paid").reduce((s: any, r: any) => s + parseFloat(r.partnerEarnings), 0);
      const totalPending = reports.filter((r: any) => r.status === "pending").reduce((s: any, r: any) => s + parseFloat(r.partnerEarnings), 0);
      return {
        reports,
        summary: { totalEarned, totalPaid, totalPending, reportCount: reports.length },
      };
    }),
});
