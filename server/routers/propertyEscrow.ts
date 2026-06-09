/**
 * Property Escrow Router — Diaspora Property Purchase with Milestone-Based Protection
 *
 * Endpoints:
 *   Builder KYB:
 *     - registerBuilder        — Submit builder KYB application
 *     - getBuilderProfile      — Fetch builder profile
 *     - adminVerifyBuilder     — Admin approves/rejects builder KYB
 *     - listVerifiedBuilders   — Public list of verified builders
 *
 *   Escrow Plans:
 *     - createEscrowPlan       — Buyer creates escrow plan linked to listing + builder
 *     - getEscrowPlan          — Fetch plan with milestones + schedule
 *     - listMyEscrowPlans      — List buyer's or builder's plans
 *     - payDeposit             — Lock deposit in TigerBeetle escrow
 *     - payInstallment         — Pay next installment
 *
 *   Milestones:
 *     - submitMilestoneEvidence — Builder uploads construction evidence
 *     - reviewMilestoneEvidence — Inspector/admin reviews + approves/rejects
 *     - approveMilestone        — Release funds from escrow to builder
 *     - getMilestoneTimeline    — Full timeline for a plan
 *
 *   Disputes:
 *     - raisePropertyDispute    — Buyer raises property-specific dispute
 *     - listPropertyDisputes    — List disputes for a plan
 *     - resolvePropertyDispute  — Admin resolves dispute (refund/mediation)
 *     - requestPropertyRefund   — Buyer requests full refund after grace period
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { randomBytes } from "crypto";
import { router, protectedProcedure, adminProcedure, publicProcedure } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { createAuditLog } from "../audit.service.js";
import { sql, eq, desc, and, gte, lte } from "drizzle-orm";
import {
  builderProfiles, propertyEscrowPlans, propertyMilestones,
  milestoneEvidence, propertyEscrowDisputes, escrowPaymentSchedule,
  realEstateListings, wallets, users, transactions,
} from "../../drizzle/schema.js";
import { getKafkaProducer } from "../middleware/kafka.js";
import {
  redis, tigerBeetle, fluvio,
} from "../middleware/middlewareIntegration.js";
import { logger } from "../_core/logger.js";
import { notifyOwner } from "../_core/notification.js";

const genId = (prefix: string) => `${prefix}-${Date.now()}-${randomBytes(4).toString("hex").toUpperCase()}`;
const ESCROW_LEDGER = 5; // Dedicated TigerBeetle ledger for property escrow
const ESCROW_CODE = 40;  // Ledger code for property escrow transfers
const CURE_NOTICE_DAYS = 14;
const GRACE_PERIOD_DAYS = 90;

async function getDbConn() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  return db;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILDER KYB VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

const builderKybRouter = router({
  register: protectedProcedure
    .input(z.object({
      companyName: z.string().min(2).max(300),
      cacRegistrationNo: z.string().max(50).optional(),
      directorNames: z.array(z.string().min(2).max(100)).min(1).max(10),
      registeredAddress: z.string().min(10).max(500),
      phone: z.string().min(10).max(30),
      email: z.string().email(),
      website: z.string().url().optional(),
      yearsInOperation: z.number().int().min(0).max(100),
      projectsCompleted: z.number().int().min(0),
      insurancePolicyNo: z.string().max(100).optional(),
      documents: z.array(z.object({
        name: z.string(),
        url: z.string().url(),
        type: z.enum(["cac_certificate", "director_id", "tax_clearance", "insurance", "project_portfolio", "financial_statement", "other"]),
      })).min(1).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbConn();
      // Prevent duplicate builder profiles for same user
      const existing = await db.select({ id: builderProfiles.id })
        .from(builderProfiles)
        .where(eq(builderProfiles.userId, ctx.user.id))
        .limit(1);
      if (existing.length) {
        throw new TRPCError({ code: "CONFLICT", message: "Builder profile already exists for this user" });
      }

      const [profile] = await db.insert(builderProfiles).values({
        userId: ctx.user.id,
        companyName: input.companyName,
        cacRegistrationNo: input.cacRegistrationNo ?? null,
        directorNames: input.directorNames,
        registeredAddress: input.registeredAddress,
        phone: input.phone,
        email: input.email,
        website: input.website ?? null,
        yearsInOperation: input.yearsInOperation,
        projectsCompleted: input.projectsCompleted,
        insurancePolicyNo: input.insurancePolicyNo ?? null,
        documents: input.documents,
        kybStatus: "submitted",
        kybSubmittedAt: new Date(),
      }).returning();

      await createAuditLog({ userId: ctx.user.id, action: "BUILDER_KYB_SUBMITTED", metadata: { builderId: profile.id, companyName: input.companyName } });
      await notifyOwner({ title: "New Builder KYB Submission", content: `Builder "${input.companyName}" (ID: ${profile.id}) submitted KYB application. ${input.documents.length} documents attached.` });

      const kafka = await getKafkaProducer();
      if (kafka) {
        await kafka.send({ topic: "remitflow.property-escrow", messages: [{ key: String(profile.id), value: JSON.stringify({ type: "builder_kyb_submitted", builderId: profile.id, companyName: input.companyName }) }] });
      }

      return { builderId: profile.id, status: "submitted", message: "KYB application submitted. Verification typically takes 3-5 business days." };
    }),

  getProfile: protectedProcedure
    .input(z.object({ builderId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDbConn();
      const [profile] = await db.select().from(builderProfiles).where(eq(builderProfiles.id, input.builderId)).limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Builder profile not found" });
      return profile;
    }),

  myProfile: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDbConn();
      const [profile] = await db.select().from(builderProfiles).where(eq(builderProfiles.userId, ctx.user.id)).limit(1);
      return profile ?? null;
    }),

  adminVerify: adminProcedure
    .input(z.object({
      builderId: z.number().int().positive(),
      approved: z.boolean(),
      rejectionReason: z.string().max(1000).optional(),
      financialHealthScore: z.number().min(0).max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbConn();
      const [profile] = await db.select().from(builderProfiles).where(eq(builderProfiles.id, input.builderId)).limit(1);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "Builder not found" });
      if (profile.kybStatus === "verified" && input.approved) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Builder already verified" });
      }

      const updates: Record<string, unknown> = {
        kybStatus: input.approved ? "verified" : "rejected",
        updatedAt: new Date(),
      };
      if (input.approved) {
        updates.kybVerifiedAt = new Date();
        updates.cacVerified = true;
        updates.directorIdsVerified = true;
        if (input.financialHealthScore != null) updates.financialHealthScore = String(input.financialHealthScore);
      } else {
        updates.kybRejectionReason = input.rejectionReason ?? "Did not meet verification requirements";
      }

      const [_row] = await db.update(builderProfiles).set(updates as any).where(eq(builderProfiles.id, input.builderId)).returning();
      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      await createAuditLog({ userId: ctx.user.id, action: input.approved ? "BUILDER_KYB_APPROVED" : "BUILDER_KYB_REJECTED", metadata: { builderId: input.builderId, adminId: ctx.user.id } });

      return { builderId: input.builderId, status: input.approved ? "verified" : "rejected" };
    }),

  listVerified: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50), offset: z.number().min(0).default(0) }).optional())
    .query(async ({ input }) => {
      const db = await getDbConn();
      const lim = input?.limit ?? 50;
      const off = input?.offset ?? 0;
      const rows = await db.select({
        id: builderProfiles.id,
        companyName: builderProfiles.companyName,
        yearsInOperation: builderProfiles.yearsInOperation,
        projectsCompleted: builderProfiles.projectsCompleted,
        averageRating: builderProfiles.averageRating,
        totalReviews: builderProfiles.totalReviews,
        insuranceVerified: builderProfiles.insuranceVerified,
        kybVerifiedAt: builderProfiles.kybVerifiedAt,
      }).from(builderProfiles)
        .where(eq(builderProfiles.kybStatus, "verified"))
        .orderBy(desc(builderProfiles.averageRating))
        .limit(lim).offset(off);
      return rows;
    }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// ESCROW PLAN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_MILESTONES = [
  { name: "Reservation & Agreement", releasePct: 10, verificationType: "document" as const },
  { name: "Foundation Complete", releasePct: 20, verificationType: "engineer" as const },
  { name: "Structure (DPC to Roof)", releasePct: 30, verificationType: "surveyor" as const },
  { name: "Finishing & Interior", releasePct: 25, verificationType: "inspector" as const },
  { name: "Handover & Title", releasePct: 15, verificationType: "document" as const },
];

const escrowPlanRouter = router({
  create: protectedProcedure
    .input(z.object({
      listingId: z.number().int().positive(),
      builderId: z.number().int().positive(),
      paymentCurrency: z.enum(["GBP", "USD", "EUR", "CAD", "AUD"]).default("GBP"),
      installmentCount: z.number().int().min(3).max(120).default(24),
      installmentFrequency: z.enum(["weekly", "biweekly", "monthly", "quarterly"]).default("monthly"),
      customMilestones: z.array(z.object({
        name: z.string().min(3).max(200),
        releasePct: z.number().min(1).max(50),
        monthsFromStart: z.number().int().min(0).max(120),
        verificationType: z.enum(["self_certified", "inspector", "surveyor", "engineer", "video", "document", "agent"]),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbConn();

      // Verify listing exists
      const [listing] = await db.select().from(realEstateListings).where(eq(realEstateListings.id, input.listingId)).limit(1);
      if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "Property listing not found" });

      // Verify builder is KYB-verified
      const [builder] = await db.select().from(builderProfiles).where(eq(builderProfiles.id, input.builderId)).limit(1);
      if (!builder) throw new TRPCError({ code: "NOT_FOUND", message: "Builder not found" });
      if (builder.kybStatus !== "verified") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Builder must be KYB-verified before escrow plans can be created" });
      }

      // Prevent duplicate active plans for same buyer+listing
      const existingPlan = await db.select({ id: propertyEscrowPlans.id })
        .from(propertyEscrowPlans)
        .where(and(
          eq(propertyEscrowPlans.buyerId, ctx.user.id),
          eq(propertyEscrowPlans.listingId, input.listingId),
          sql`${propertyEscrowPlans.status} NOT IN ('cancelled', 'refunded', 'completed')`,
        )).limit(1);
      if (existingPlan.length) {
        throw new TRPCError({ code: "CONFLICT", message: "An active escrow plan already exists for this property" });
      }

      const totalPriceUsd = Number(listing.totalValueUsd);
      const totalPriceNgn = Number(listing.totalValueNgn);
      const depositPct = 10;
      const installmentAmount = (totalPriceUsd * (1 - depositPct / 100)) / input.installmentCount;
      const planId = genId("ESCROW");

      // Create TigerBeetle escrow account
      const escrowAccountId = BigInt(Date.now());
      try {
        await tigerBeetle.createAccounts([{
          id: escrowAccountId,
          ledger: ESCROW_LEDGER,
          code: ESCROW_CODE,
        }]);
      } catch (e: unknown) {
        logger.warn({ err: e instanceof Error ? e.message : String(e) }, "[PropertyEscrow] TigerBeetle account creation (non-fatal)");
      }

      // Insert escrow plan
      const [plan] = await db.insert(propertyEscrowPlans).values({
        planId,
        buyerId: ctx.user.id,
        builderId: input.builderId,
        listingId: input.listingId,
        totalPriceNgn: String(totalPriceNgn),
        totalPriceUsd: String(totalPriceUsd),
        depositPct: String(depositPct),
        paymentCurrency: input.paymentCurrency,
        installmentCount: input.installmentCount,
        installmentAmount: String(Math.round(installmentAmount * 100) / 100),
        installmentFrequency: input.installmentFrequency,
        tigerBeetleEscrowAccount: escrowAccountId,
        status: "draft",
      }).returning();

      // Create milestones
      const milestoneDefs = input.customMilestones?.length
        ? input.customMilestones
        : DEFAULT_MILESTONES.map((m, i) => ({ ...m, monthsFromStart: [0, 3, 8, 14, 18][i] }));

      const totalPct = milestoneDefs.reduce((s, m) => s + m.releasePct, 0);
      if (totalPct !== 100) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Milestone release percentages must sum to 100% (got ${totalPct}%)` });
      }

      const now = new Date();
      for (let i = 0; i < milestoneDefs.length; i++) {
        const m = milestoneDefs[i];
        const deadline = new Date(now);
        deadline.setMonth(deadline.getMonth() + (m.monthsFromStart ?? (i + 1) * 3));
        const releaseAmountUsd = (totalPriceUsd * m.releasePct) / 100;

        await db.insert(propertyMilestones).values({
          milestoneId: genId("MS"),
          escrowPlanId: plan.id,
          sequenceNumber: i + 1,
          name: m.name,
          releasePct: String(m.releasePct),
          releaseAmountUsd: String(Math.round(releaseAmountUsd * 100) / 100),
          deadline,
          verificationType: m.verificationType,
          status: "pending",
        });
      }

      // Create payment schedule
      const startDate = new Date(now);
      const freqMonths = { weekly: 0.25, biweekly: 0.5, monthly: 1, quarterly: 3 }[input.installmentFrequency];
      for (let i = 0; i < input.installmentCount; i++) {
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + Math.round(i * freqMonths));
        await db.insert(escrowPaymentSchedule).values({
          escrowPlanId: plan.id,
          installmentNumber: i + 1,
          dueDate,
          amountUsd: String(Math.round(installmentAmount * 100) / 100),
          status: i === 0 ? "scheduled" : "scheduled",
        });
      }

      await createAuditLog({ userId: ctx.user.id, action: "PROPERTY_ESCROW_CREATED", metadata: { planId, listingId: input.listingId, builderId: input.builderId, totalPriceUsd } });

      const kafka = await getKafkaProducer();
      if (kafka) {
        await kafka.send({ topic: "remitflow.property-escrow", messages: [{ key: planId, value: JSON.stringify({ type: "escrow_plan_created", planId, buyerId: ctx.user.id, builderId: input.builderId, totalPriceUsd }) }] });
      }

      return {
        planId: plan.planId,
        status: "draft",
        totalPriceUsd,
        depositRequired: totalPriceUsd * depositPct / 100,
        installmentCount: input.installmentCount,
        installmentAmount: Math.round(installmentAmount * 100) / 100,
        milestoneCount: milestoneDefs.length,
        message: "Escrow plan created. Pay the deposit to activate.",
      };
    }),

  get: protectedProcedure
    .input(z.object({ planId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await getDbConn();
      const [plan] = await db.select().from(propertyEscrowPlans).where(eq(propertyEscrowPlans.planId, input.planId)).limit(1);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "Escrow plan not found" });
      if (plan.buyerId !== ctx.user.id) {
        // Check if user is the builder
        const [builder] = await db.select({ userId: builderProfiles.userId }).from(builderProfiles).where(eq(builderProfiles.id, plan.builderId)).limit(1);
        if (!builder || builder.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }
      }

      const milestones = await db.select().from(propertyMilestones)
        .where(eq(propertyMilestones.escrowPlanId, plan.id))
        .orderBy(propertyMilestones.sequenceNumber);
      const schedule = await db.select().from(escrowPaymentSchedule)
        .where(eq(escrowPaymentSchedule.escrowPlanId, plan.id))
        .orderBy(escrowPaymentSchedule.installmentNumber);
      const disputes = await db.select().from(propertyEscrowDisputes)
        .where(eq(propertyEscrowDisputes.escrowPlanId, plan.id))
        .orderBy(desc(propertyEscrowDisputes.createdAt));
      const [builderProfile] = await db.select().from(builderProfiles).where(eq(builderProfiles.id, plan.builderId)).limit(1);
      const [listing] = await db.select().from(realEstateListings).where(eq(realEstateListings.id, plan.listingId)).limit(1);

      return { plan, milestones, schedule, disputes, builder: builderProfile, listing };
    }),

  listMyPlans: protectedProcedure
    .input(z.object({ role: z.enum(["buyer", "builder"]).default("buyer"), limit: z.number().min(1).max(50).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDbConn();
      const role = input?.role ?? "buyer";
      if (role === "buyer") {
        return db.select().from(propertyEscrowPlans).where(eq(propertyEscrowPlans.buyerId, ctx.user.id)).orderBy(desc(propertyEscrowPlans.createdAt)).limit(input?.limit ?? 20);
      }
      // Builder: find their builder profile first
      const [builder] = await db.select({ id: builderProfiles.id }).from(builderProfiles).where(eq(builderProfiles.userId, ctx.user.id)).limit(1);
      if (!builder) return [];
      return db.select().from(propertyEscrowPlans).where(eq(propertyEscrowPlans.builderId, builder.id)).orderBy(desc(propertyEscrowPlans.createdAt)).limit(input?.limit ?? 20);
    }),

  payDeposit: protectedProcedure
    .input(z.object({ planId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbConn();
      const [plan] = await db.select().from(propertyEscrowPlans).where(and(eq(propertyEscrowPlans.planId, input.planId), eq(propertyEscrowPlans.buyerId, ctx.user.id))).limit(1);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "Escrow plan not found" });
      if (plan.depositPaid) throw new TRPCError({ code: "BAD_REQUEST", message: "Deposit already paid" });
      if (plan.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "Plan must be in draft status to pay deposit" });

      const depositUsd = Number(plan.totalPriceUsd) * Number(plan.depositPct) / 100;

      // Debit buyer's wallet
      const [wallet] = await db.select().from(wallets).where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "USD"))).limit(1);
      if (!wallet || Number(wallet.balance) < depositUsd) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Insufficient USD balance. Required: $${depositUsd.toFixed(2)}` });
      }

      await db.update(wallets).set({
        balance: String(Number(wallet.balance) - depositUsd),
        updatedAt: new Date(),
      }).where(eq(wallets.id, wallet.id)).returning();

      // Lock deposit in TigerBeetle
      try {
        await tigerBeetle.createTransfer({
          id: BigInt(Date.now()),
          debitAccountId: BigInt(ctx.user.id),
          creditAccountId: plan.tigerBeetleEscrowAccount ?? BigInt(0),
          amount: BigInt(Math.round(depositUsd * 100)),
          ledger: ESCROW_LEDGER,
          code: ESCROW_CODE,
          pending: true,
        });
      } catch (e: unknown) {
        logger.warn({ err: e instanceof Error ? e.message : String(e) }, "[PropertyEscrow] TigerBeetle deposit lock (non-fatal)");
      }

      // Record transaction
      await db.insert(transactions).values({
        userId: ctx.user.id,
        type: "escrow_deposit" as any,
        status: "completed" as any,
        fromAmount: String(depositUsd),
        fromCurrency: "USD",
        toAmount: String(depositUsd),
        toCurrency: "USD",
        description: `Property escrow deposit for plan ${plan.planId}`,
        reference: `ESCROW-DEP-${plan.planId}`,
      } as any);

      // Activate plan
      const nextPaymentDate = new Date();
      nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
      await db.update(propertyEscrowPlans).set({
        depositPaid: true,
        status: "active",
        totalPaidUsd: String(depositUsd),
        startedAt: new Date(),
        nextPaymentDate,
        updatedAt: new Date(),
      }).where(eq(propertyEscrowPlans.id, plan.id)).returning();

      await createAuditLog({ userId: ctx.user.id, action: "ESCROW_DEPOSIT_PAID", metadata: { planId: plan.planId, amount: depositUsd } });
      await notifyOwner({ title: "Escrow Deposit Paid", content: `Buyer ${ctx.user.id} paid $${depositUsd.toFixed(2)} deposit for escrow plan ${plan.planId}` });

      return { planId: plan.planId, depositPaid: depositUsd, status: "active", nextPaymentDate: nextPaymentDate.toISOString() };
    }),

  payInstallment: protectedProcedure
    .input(z.object({ planId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbConn();
      const [plan] = await db.select().from(propertyEscrowPlans).where(and(eq(propertyEscrowPlans.planId, input.planId), eq(propertyEscrowPlans.buyerId, ctx.user.id))).limit(1);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
      if (plan.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "Plan is not active" });

      // Find next unpaid installment
      const [nextInstallment] = await db.select().from(escrowPaymentSchedule)
        .where(and(eq(escrowPaymentSchedule.escrowPlanId, plan.id), eq(escrowPaymentSchedule.status, "scheduled")))
        .orderBy(escrowPaymentSchedule.installmentNumber).limit(1);
      if (!nextInstallment) throw new TRPCError({ code: "BAD_REQUEST", message: "All installments already paid" });

      const amount = Number(nextInstallment.amountUsd);

      // Debit wallet
      const [wallet] = await db.select().from(wallets).where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "USD"))).limit(1);
      if (!wallet || Number(wallet.balance) < amount) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Insufficient balance. Required: $${amount.toFixed(2)}` });
      }

      await db.update(wallets).set({
        balance: String(Number(wallet.balance) - amount),
        updatedAt: new Date(),
      }).where(eq(wallets.id, wallet.id)).returning();

      // Lock in TigerBeetle
      try {
        await tigerBeetle.createTransfer({
          id: BigInt(Date.now()),
          debitAccountId: BigInt(ctx.user.id),
          creditAccountId: plan.tigerBeetleEscrowAccount ?? BigInt(0),
          amount: BigInt(Math.round(amount * 100)),
          ledger: ESCROW_LEDGER,
          code: ESCROW_CODE,
          pending: true,
        });
      } catch (e: unknown) {
        logger.warn({ err: e instanceof Error ? e.message : String(e) }, "[PropertyEscrow] TigerBeetle installment lock (non-fatal)");
      }

      // Record transaction
      const [tx] = await db.insert(transactions).values({
        userId: ctx.user.id,
        type: "escrow_installment" as any,
        status: "completed" as any,
        fromAmount: String(amount),
        fromCurrency: "USD",
        toAmount: String(amount),
        toCurrency: "USD",
        description: `Installment #${nextInstallment.installmentNumber} for escrow plan ${plan.planId}`,
        reference: `ESCROW-INST-${plan.planId}-${nextInstallment.installmentNumber}`,
      } as any).returning();

      // Mark installment paid
      await db.update(escrowPaymentSchedule).set({
        status: "paid",
        paidAt: new Date(),
        transactionId: tx?.id,
      }).where(eq(escrowPaymentSchedule.id, nextInstallment.id)).returning();

      // Update plan totals
      const newTotalPaid = Number(plan.totalPaidUsd) + amount;
      const nextPaymentDate = new Date();
      const freqMap: Record<string, number> = { weekly: 0.25, biweekly: 0.5, monthly: 1, quarterly: 3 };
      const freqMonths = freqMap[plan.installmentFrequency ?? "monthly"] ?? 1;
      nextPaymentDate.setMonth(nextPaymentDate.getMonth() + Math.round(freqMonths));

      const isComplete = newTotalPaid >= Number(plan.totalPriceUsd);
      await db.update(propertyEscrowPlans).set({
        totalPaidUsd: String(newTotalPaid),
        nextPaymentDate: isComplete ? null : nextPaymentDate,
        status: isComplete ? "completed" : "active",
        completedAt: isComplete ? new Date() : undefined,
        updatedAt: new Date(),
      } as any).where(eq(propertyEscrowPlans.id, plan.id)).returning();

      await createAuditLog({ userId: ctx.user.id, action: "ESCROW_INSTALLMENT_PAID", metadata: { planId: plan.planId, installment: nextInstallment.installmentNumber, amount } });

      return {
        planId: plan.planId,
        installmentNumber: nextInstallment.installmentNumber,
        amountPaid: amount,
        totalPaid: newTotalPaid,
        totalRequired: Number(plan.totalPriceUsd),
        remainingInstallments: plan.installmentCount - nextInstallment.installmentNumber,
        status: isComplete ? "completed" : "active",
      };
    }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// MILESTONE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

const milestoneRouter = router({
  submitEvidence: protectedProcedure
    .input(z.object({
      milestoneId: z.string().min(1),
      evidenceType: z.enum(["photo", "video", "document", "engineer_report", "surveyor_report", "inspection_report", "receipt", "certificate"]),
      fileUrl: z.string().url(),
      fileName: z.string().max(300).optional(),
      description: z.string().max(2000).optional(),
      gpsLatitude: z.number().min(-90).max(90).optional(),
      gpsLongitude: z.number().min(-180).max(180).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbConn();
      const [milestone] = await db.select().from(propertyMilestones).where(eq(propertyMilestones.milestoneId, input.milestoneId)).limit(1);
      if (!milestone) throw new TRPCError({ code: "NOT_FOUND", message: "Milestone not found" });

      // Verify caller is the builder for this plan
      const [plan] = await db.select().from(propertyEscrowPlans).where(eq(propertyEscrowPlans.id, milestone.escrowPlanId)).limit(1);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
      const [builder] = await db.select().from(builderProfiles).where(eq(builderProfiles.id, plan.builderId)).limit(1);
      if (!builder || builder.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the assigned builder can submit milestone evidence" });
      }

      if (milestone.status === "approved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Milestone already approved" });
      }

      const evidenceId = genId("EV");
      const [evidence] = await db.insert(milestoneEvidence).values({
        evidenceId,
        milestoneId: milestone.id,
        submittedBy: ctx.user.id,
        evidenceType: input.evidenceType,
        fileUrl: input.fileUrl,
        fileName: input.fileName ?? null,
        description: input.description ?? null,
        gpsLatitude: input.gpsLatitude != null ? String(input.gpsLatitude) : null,
        gpsLongitude: input.gpsLongitude != null ? String(input.gpsLongitude) : null,
      }).returning();

      // Update milestone status
      await db.update(propertyMilestones).set({
        status: "evidence_submitted",
        updatedAt: new Date(),
      }).where(eq(propertyMilestones.id, milestone.id)).returning();

      await createAuditLog({ userId: ctx.user.id, action: "MILESTONE_EVIDENCE_SUBMITTED", metadata: { milestoneId: input.milestoneId, evidenceId, evidenceType: input.evidenceType } });
      await notifyOwner({ title: "Milestone Evidence Submitted", content: `Builder submitted ${input.evidenceType} evidence for milestone "${milestone.name}" (Plan: ${plan.planId})` });

      return { evidenceId, milestoneId: input.milestoneId, status: "evidence_submitted", message: "Evidence submitted. An inspector will review within 5 business days." };
    }),

  getEvidence: protectedProcedure
    .input(z.object({ milestoneId: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = await getDbConn();
      const [milestone] = await db.select().from(propertyMilestones).where(eq(propertyMilestones.milestoneId, input.milestoneId)).limit(1);
      if (!milestone) throw new TRPCError({ code: "NOT_FOUND" });
      return db.select().from(milestoneEvidence).where(eq(milestoneEvidence.milestoneId, milestone.id)).orderBy(desc(milestoneEvidence.createdAt));
    }),

  reviewEvidence: adminProcedure
    .input(z.object({
      evidenceId: z.string().min(1),
      approved: z.boolean(),
      rejectionReason: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbConn();
      const [evidence] = await db.select().from(milestoneEvidence).where(eq(milestoneEvidence.evidenceId, input.evidenceId)).limit(1);
      if (!evidence) throw new TRPCError({ code: "NOT_FOUND", message: "Evidence not found" });

      await db.update(milestoneEvidence).set({
        verified: input.approved,
        verifiedBy: ctx.user.id,
        verifiedAt: new Date(),
        rejectionReason: input.approved ? null : (input.rejectionReason ?? null),
      }).where(eq(milestoneEvidence.id, evidence.id)).returning();

      if (!input.approved) {
        await db.update(propertyMilestones).set({ status: "rejected", rejectedReason: input.rejectionReason ?? "Evidence rejected by inspector", updatedAt: new Date() }).where(eq(propertyMilestones.id, evidence.milestoneId)).returning();
      }

      await createAuditLog({ userId: ctx.user.id, action: input.approved ? "MILESTONE_EVIDENCE_APPROVED" : "MILESTONE_EVIDENCE_REJECTED", metadata: { evidenceId: input.evidenceId } });
      return { evidenceId: input.evidenceId, verified: input.approved };
    }),

  approveMilestone: adminProcedure
    .input(z.object({ milestoneId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbConn();
      const [milestone] = await db.select().from(propertyMilestones).where(eq(propertyMilestones.milestoneId, input.milestoneId)).limit(1);
      if (!milestone) throw new TRPCError({ code: "NOT_FOUND" });
      if (milestone.fundsReleased) throw new TRPCError({ code: "BAD_REQUEST", message: "Funds already released for this milestone" });

      // Check all evidence for this milestone is verified
      const unverifiedEvidence = await db.select({ id: milestoneEvidence.id })
        .from(milestoneEvidence)
        .where(and(eq(milestoneEvidence.milestoneId, milestone.id), eq(milestoneEvidence.verified, false)))
        .limit(1);
      if (unverifiedEvidence.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "All evidence must be verified before approving the milestone" });
      }

      // Get plan to release funds
      const [plan] = await db.select().from(propertyEscrowPlans).where(eq(propertyEscrowPlans.id, milestone.escrowPlanId)).limit(1);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });

      const releaseAmount = Number(milestone.releaseAmountUsd);

      // Release funds from TigerBeetle escrow to builder
      let tbTransferId: bigint | null = null;
      try {
        tbTransferId = BigInt(Date.now());
        const [builder] = await db.select().from(builderProfiles).where(eq(builderProfiles.id, plan.builderId)).limit(1);
        await tigerBeetle.createTransfer({
          id: tbTransferId,
          debitAccountId: plan.tigerBeetleEscrowAccount ?? BigInt(0),
          creditAccountId: BigInt(builder?.userId ?? 0),
          amount: BigInt(Math.round(releaseAmount * 100)),
          ledger: ESCROW_LEDGER,
          code: ESCROW_CODE,
          pending: false, // Posted (final) — funds released to builder
        });
      } catch (e: unknown) {
        logger.warn({ err: e instanceof Error ? e.message : String(e) }, "[PropertyEscrow] TigerBeetle release (non-fatal)");
      }

      // Credit builder's wallet
      const [builder] = await db.select().from(builderProfiles).where(eq(builderProfiles.id, plan.builderId)).limit(1);
      if (builder) {
        const [builderWallet] = await db.select().from(wallets).where(and(eq(wallets.userId, builder.userId), eq(wallets.currency, "USD"))).limit(1);
        if (builderWallet) {
          await db.update(wallets).set({
            balance: String(Number(builderWallet.balance) + releaseAmount),
            updatedAt: new Date(),
          }).where(eq(wallets.id, builderWallet.id)).returning();
        }
      }

      // Update milestone
      await db.update(propertyMilestones).set({
        status: "approved",
        approvedBy: ctx.user.id,
        approvedAt: new Date(),
        fundsReleased: true,
        fundsReleasedAt: new Date(),
        tigerBeetleTransferId: tbTransferId,
        updatedAt: new Date(),
      }).where(eq(propertyMilestones.id, milestone.id)).returning();

      // Update plan released total
      const newReleased = Number(plan.totalReleasedUsd) + releaseAmount;
      await db.update(propertyEscrowPlans).set({
        totalReleasedUsd: String(newReleased),
        updatedAt: new Date(),
      }).where(eq(propertyEscrowPlans.id, plan.id)).returning();

      await createAuditLog({ userId: ctx.user.id, action: "MILESTONE_APPROVED_FUNDS_RELEASED", metadata: { milestoneId: input.milestoneId, releaseAmount, planId: plan.planId } });

      const kafka = await getKafkaProducer();
      if (kafka) {
        await kafka.send({ topic: "remitflow.property-escrow", messages: [{ key: plan.planId, value: JSON.stringify({ type: "milestone_funds_released", milestoneId: input.milestoneId, amount: releaseAmount }) }] });
      }

      return {
        milestoneId: input.milestoneId,
        status: "approved",
        fundsReleased: releaseAmount,
        totalReleased: newReleased,
        totalPrice: Number(plan.totalPriceUsd),
        message: `$${releaseAmount.toFixed(2)} released to builder`,
      };
    }),

  getTimeline: protectedProcedure
    .input(z.object({ planId: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = await getDbConn();
      const [plan] = await db.select().from(propertyEscrowPlans).where(eq(propertyEscrowPlans.planId, input.planId)).limit(1);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
      const milestones = await db.select().from(propertyMilestones).where(eq(propertyMilestones.escrowPlanId, plan.id)).orderBy(propertyMilestones.sequenceNumber);

      const timeline = await Promise.all(milestones.map(async (m: typeof milestones[number]) => {
        const evidence = await db.select().from(milestoneEvidence).where(eq(milestoneEvidence.milestoneId, m.id)).orderBy(desc(milestoneEvidence.createdAt));
        return { ...m, evidence };
      }));
      return { planId: plan.planId, status: plan.status, totalPaid: plan.totalPaidUsd, totalReleased: plan.totalReleasedUsd, milestones: timeline };
    }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROPERTY DISPUTES
// ═══════════════════════════════════════════════════════════════════════════════

const propertyDisputeRouter = router({
  raise: protectedProcedure
    .input(z.object({
      planId: z.string().min(1),
      milestoneId: z.string().optional(),
      disputeType: z.enum(["deadline_missed", "quality_issues", "builder_default", "scope_change", "fraud", "communication_failure", "force_majeure", "other"]),
      severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      description: z.string().min(20).max(5000),
      evidenceIds: z.array(z.string()).max(10).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbConn();
      const [plan] = await db.select().from(propertyEscrowPlans).where(eq(propertyEscrowPlans.planId, input.planId)).limit(1);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
      if (plan.buyerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Only the buyer can raise a dispute" });

      let milestoneDbId: number | null = null;
      if (input.milestoneId) {
        const [ms] = await db.select().from(propertyMilestones).where(eq(propertyMilestones.milestoneId, input.milestoneId)).limit(1);
        if (ms) milestoneDbId = ms.id;
      }

      const disputeId = genId("PD");
      const cureDeadline = new Date();
      cureDeadline.setDate(cureDeadline.getDate() + CURE_NOTICE_DAYS);
      const autoRefundDate = new Date();
      autoRefundDate.setDate(autoRefundDate.getDate() + GRACE_PERIOD_DAYS);

      const [dispute] = await db.insert(propertyEscrowDisputes).values({
        disputeId,
        escrowPlanId: plan.id,
        milestoneId: milestoneDbId,
        raisedBy: ctx.user.id,
        disputeType: input.disputeType,
        severity: input.severity,
        description: input.description,
        evidenceIds: input.evidenceIds ?? [],
        status: "open",
        cureDeadline,
        autoRefundDate,
      }).returning();

      // Freeze the escrow plan
      await db.update(propertyEscrowPlans).set({ status: "disputed", updatedAt: new Date() }).where(eq(propertyEscrowPlans.id, plan.id)).returning();

      // Send cure notice to builder
      const [builder] = await db.select().from(builderProfiles).where(eq(builderProfiles.id, plan.builderId)).limit(1);
      if (builder) {
        await notifyOwner({
          title: `Property Dispute Raised: ${disputeId}`,
          content: `Buyer raised a "${input.disputeType}" dispute against builder "${builder.companyName}" for plan ${plan.planId}. 14-day cure notice issued. Auto-refund scheduled for ${autoRefundDate.toISOString().split("T")[0]} if unresolved.`,
        });
      }

      await createAuditLog({ userId: ctx.user.id, action: "PROPERTY_DISPUTE_RAISED", metadata: { disputeId, planId: plan.planId, type: input.disputeType, severity: input.severity } });

      const kafka = await getKafkaProducer();
      if (kafka) {
        await kafka.send({ topic: "remitflow.property-escrow", messages: [{ key: disputeId, value: JSON.stringify({ type: "property_dispute_raised", disputeId, planId: plan.planId, disputeType: input.disputeType }) }] });
      }

      return {
        disputeId,
        status: "open",
        cureDeadline: cureDeadline.toISOString(),
        autoRefundDate: autoRefundDate.toISOString(),
        message: `Dispute raised. Builder has ${CURE_NOTICE_DAYS} days to respond. If unresolved after ${GRACE_PERIOD_DAYS} days, full refund will be automatically issued.`,
      };
    }),

  list: protectedProcedure
    .input(z.object({ planId: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = await getDbConn();
      const [plan] = await db.select().from(propertyEscrowPlans).where(eq(propertyEscrowPlans.planId, input.planId)).limit(1);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
      return db.select().from(propertyEscrowDisputes).where(eq(propertyEscrowDisputes.escrowPlanId, plan.id)).orderBy(desc(propertyEscrowDisputes.createdAt));
    }),

  resolve: adminProcedure
    .input(z.object({
      disputeId: z.string().min(1),
      resolution: z.enum(["resolved_buyer", "resolved_builder", "refund_initiated", "closed"]),
      resolutionNotes: z.string().max(2000),
      refundAmountUsd: z.number().min(0).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbConn();
      const [dispute] = await db.select().from(propertyEscrowDisputes).where(eq(propertyEscrowDisputes.disputeId, input.disputeId)).limit(1);
      if (!dispute) throw new TRPCError({ code: "NOT_FOUND" });

      const updates: Record<string, unknown> = {
        status: input.resolution,
        resolution: input.resolutionNotes,
        updatedAt: new Date(),
      };

      if (input.resolution === "refund_initiated" && input.refundAmountUsd) {
        updates.refundAmountUsd = String(input.refundAmountUsd);
        updates.refundInitiatedAt = new Date();

        // Process refund: credit buyer's wallet
        const [plan] = await db.select().from(propertyEscrowPlans).where(eq(propertyEscrowPlans.id, dispute.escrowPlanId)).limit(1);
        if (plan) {
          const [buyerWallet] = await db.select().from(wallets).where(and(eq(wallets.userId, plan.buyerId), eq(wallets.currency, "USD"))).limit(1);
          if (buyerWallet) {
            await db.update(wallets).set({
              balance: String(Number(buyerWallet.balance) + input.refundAmountUsd),
              updatedAt: new Date(),
            }).where(eq(wallets.id, buyerWallet.id)).returning();
          }

          // Record refund transaction
          await db.insert(transactions).values({
            userId: plan.buyerId,
            type: "refund" as any,
            status: "completed" as any,
            fromAmount: String(input.refundAmountUsd),
            fromCurrency: "USD",
            toAmount: String(input.refundAmountUsd),
            toCurrency: "USD",
            description: `Property escrow refund — dispute ${input.disputeId}`,
            reference: `ESCROW-REFUND-${input.disputeId}`,
          } as any);

          await db.update(propertyEscrowPlans).set({ status: "refunded", updatedAt: new Date() }).where(eq(propertyEscrowPlans.id, plan.id)).returning();
          updates.refundCompletedAt = new Date();
          updates.status = "refund_completed";
        }
      } else if (input.resolution === "resolved_buyer" || input.resolution === "resolved_builder") {
        // Unfreeze escrow plan
        const [plan] = await db.select().from(propertyEscrowPlans).where(eq(propertyEscrowPlans.id, dispute.escrowPlanId)).limit(1);
        if (plan) {
          await db.update(propertyEscrowPlans).set({ status: "active", updatedAt: new Date() }).where(eq(propertyEscrowPlans.id, plan.id)).returning();
        }
      }

      await db.update(propertyEscrowDisputes).set(updates as any).where(eq(propertyEscrowDisputes.id, dispute.id)).returning();
      await createAuditLog({ userId: ctx.user.id, action: "PROPERTY_DISPUTE_RESOLVED", metadata: { disputeId: input.disputeId, resolution: input.resolution } });

      return { disputeId: input.disputeId, status: input.resolution, refundAmount: input.refundAmountUsd };
    }),

  requestFullRefund: protectedProcedure
    .input(z.object({ planId: z.string().min(1), reason: z.string().min(10).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbConn();
      const [plan] = await db.select().from(propertyEscrowPlans).where(and(eq(propertyEscrowPlans.planId, input.planId), eq(propertyEscrowPlans.buyerId, ctx.user.id))).limit(1);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
      if (!["disputed", "defaulted"].includes(plan.status ?? "")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Refund can only be requested for disputed or defaulted plans" });
      }

      // Check if grace period has elapsed (90 days from dispute)
      const disputes = await db.select().from(propertyEscrowDisputes)
        .where(eq(propertyEscrowDisputes.escrowPlanId, plan.id))
        .orderBy(propertyEscrowDisputes.createdAt).limit(1);
      if (disputes.length) {
        const firstDispute = disputes[0];
        const daysSinceDispute = (Date.now() - new Date(firstDispute.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceDispute < GRACE_PERIOD_DAYS) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Full refund available after ${GRACE_PERIOD_DAYS}-day grace period. ${Math.ceil(GRACE_PERIOD_DAYS - daysSinceDispute)} days remaining.` });
        }
      }

      const refundAmount = Number(plan.totalPaidUsd) - Number(plan.totalReleasedUsd);
      if (refundAmount <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "No refundable amount remaining" });

      // Credit buyer wallet
      const [wallet] = await db.select().from(wallets).where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "USD"))).limit(1);
      if (wallet) {
        await db.update(wallets).set({
          balance: String(Number(wallet.balance) + refundAmount),
          updatedAt: new Date(),
        }).where(eq(wallets.id, wallet.id)).returning();
      }

      await db.insert(transactions).values({
        userId: ctx.user.id,
        type: "refund" as any,
        status: "completed" as any,
        fromAmount: String(refundAmount),
        fromCurrency: "USD",
        toAmount: String(refundAmount),
        toCurrency: "USD",
        description: `Property escrow full refund — plan ${plan.planId}: ${input.reason}`,
        reference: `ESCROW-FULLREFUND-${plan.planId}`,
      } as any);

      await db.update(propertyEscrowPlans).set({ status: "refunded", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(propertyEscrowPlans.id, plan.id)).returning();
      await createAuditLog({ userId: ctx.user.id, action: "ESCROW_FULL_REFUND", metadata: { planId: plan.planId, refundAmount, reason: input.reason } });

      return { planId: plan.planId, refundAmount, status: "refunded", message: `$${refundAmount.toFixed(2)} refunded to your wallet` };
    }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMBINED PROPERTY ESCROW ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

export const propertyEscrowRouter = router({
  builderKyb: builderKybRouter,
  escrowPlan: escrowPlanRouter,
  milestone: milestoneRouter,
  dispute: propertyDisputeRouter,
});
