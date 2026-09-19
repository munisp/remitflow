import { TRPCError } from "@trpc/server";
import { and, eq, gt, lt, sql, inArray } from "drizzle-orm";
import { randomBytes, randomInt } from "crypto";
import { z } from "zod";
import { adminProcedure, protectedProcedure, publicProcedure, router ,
  auditedProcedure, auditedAdminProcedure, rateLimitedProcedure
} from "../_core/trpc";
import { getDb } from "../db";
import {
  partnerInviteCodes,
  tenantOnboardingSessions,
  tenants,
  tenantUsers,
  whiteLabelConfigs,
  users,
  travelRuleRecords,
  agentAccounts,
  transactions,
} from "../../drizzle/schema";
import { safeParseAmount } from "../lib/safeDecimal";
import { requireTotpStepUp } from "../_core/totpStepUp";
import { createAuditLog } from "../audit.service";
import { invalidateTenantCache } from "../tenantMiddleware";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateCode(prefix = "RF"): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = prefix + "-";
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      code += chars[randomInt(chars.length)];
    }
    if (i < 3) code += "-";
  }
  return code; // e.g. RF-ABCD-EFGH-JKLM-MNPQ
}

function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

// ─── Partner Onboarding Router ────────────────────────────────────────────────
export const partnerOnboardingRouter = router({

  // ── Step 0: Verify invite code (public — no auth required) ──────────────────
  verifyInviteCode: publicProcedure
    .input(z.object({ code: z.string().min(1).max(64).trim().toUpperCase() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [invite] = await db.select().from(partnerInviteCodes)
        .where(eq(partnerInviteCodes.code, input.code))
        .limit(1);

      if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid invite code. Please check the code and try again." });
      if (!invite.isActive) throw new TRPCError({ code: "FORBIDDEN", message: "This invite code has been deactivated." });
      if (invite.expiresAt && new Date() > invite.expiresAt) throw new TRPCError({ code: "FORBIDDEN", message: "This invite code has expired." });
      if (invite.maxUses !== null && invite.usedCount >= invite.maxUses) throw new TRPCError({ code: "FORBIDDEN", message: "This invite code has reached its maximum usage limit." });

      // Create onboarding session
      const sessionToken = generateSessionToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

      await db.insert(tenantOnboardingSessions).values({
        sessionToken,
        inviteCodeId: invite.id,
        step: 1,
        data: { inviteCode: input.code, plan: invite.plan },
        status: "in_progress",
        expiresAt,
      }).returning();

      return {
        valid: true,
        sessionToken,
        plan: invite.plan,
        description: invite.description,
        expiresAt: expiresAt.toISOString(),
        message: `Welcome! Your ${invite.plan} plan invite code is valid. Let's set up your white-label platform.`,
      };
    }),

  // ── Step 1: Save company info ─────────────────────────────────────────────
  saveCompanyInfo: publicProcedure
    .input(z.object({
      sessionToken: z.string().length(64),
      companyName: z.string().min(2).max(255).trim(),
      brandName: z.string().min(2).max(255).trim(),
      slug: z.string().min(3).max(63).trim().toLowerCase().regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only"),
      supportEmail: z.string().email(),
      website: z.string().url().optional(),
      country: z.string().length(2).toUpperCase(),
      defaultCurrency: z.string().length(3).toUpperCase(),
      description: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [session] = await db.select().from(tenantOnboardingSessions)
        .where(and(
          eq(tenantOnboardingSessions.sessionToken, input.sessionToken),
          eq(tenantOnboardingSessions.status, "in_progress"),
          gt(tenantOnboardingSessions.expiresAt, new Date()),
        )).limit(1);

      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found or expired. Please restart onboarding." });

      // Check slug uniqueness
      const [existing] = await db.select({ id: tenants.id }).from(tenants)
        .where(eq(tenants.slug, input.slug)).limit(1);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: `The slug "${input.slug}" is already taken. Please choose another.` });

      const updatedData = { ...session.data as Record<string, unknown>, ...input, step: 2 };
      await db.update(tenantOnboardingSessions)
        .set({ step: 2, data: updatedData, updatedAt: new Date() })
        .where(eq(tenantOnboardingSessions.id, session.id)).returning();

      return { success: true, verified: true, step: 2, message: "Company info saved. Next: customize your branding." };
    }),

  // ── Step 2: Save branding ────────────────────────────────────────────────
  saveBranding: publicProcedure
    .input(z.object({
      sessionToken: z.string().length(64),
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#7c3aed"),
      secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#06b6d4"),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#f59e0b"),
      logoUrl: z.string().url().optional(),
      faviconUrl: z.string().url().optional(),
      customDomain: z.string().max(255).optional(),
      showPoweredBy: z.boolean().default(true),
      termsUrl: z.string().url().optional(),
      privacyUrl: z.string().url().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [session] = await db.select().from(tenantOnboardingSessions)
        .where(and(
          eq(tenantOnboardingSessions.sessionToken, input.sessionToken),
          eq(tenantOnboardingSessions.status, "in_progress"),
          gt(tenantOnboardingSessions.expiresAt, new Date()),
        )).limit(1);

      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found or expired." });

      const updatedData = { ...session.data as Record<string, unknown>, branding: input, step: 3 };
      await db.update(tenantOnboardingSessions)
        .set({ step: 3, data: updatedData, updatedAt: new Date() })
        .where(eq(tenantOnboardingSessions.id, session.id)).returning();

      return { success: true, verified: true, step: 3, message: "Branding saved. Next: configure your corridors and fees." };
    }),

  // ── Step 3: Save corridors & fee config ──────────────────────────────────
  saveCorridors: publicProcedure
    .input(z.object({
      sessionToken: z.string().length(64),
      corridors: z.array(z.object({
        fromCountry: z.string().length(2),
        toCountry: z.string().length(2),
        fromCurrency: z.string().length(3),
        toCurrency: z.string().length(3),
        feePercent: z.number().min(0).max(10),
        feeFixed: z.number().min(0),
        enabled: z.boolean().default(true),
      })).min(1).max(50),
      defaultFeePercent: z.number().min(0).max(10).default(1.5),
      defaultFeeFixed: z.number().min(0).default(2),
      maxTransferAmount: z.number().min(100).max(1000000).default(10000),
      allowedCountries: z.array(z.string().length(2)).min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [session] = await db.select().from(tenantOnboardingSessions)
        .where(and(
          eq(tenantOnboardingSessions.sessionToken, input.sessionToken),
          eq(tenantOnboardingSessions.status, "in_progress"),
          gt(tenantOnboardingSessions.expiresAt, new Date()),
        )).limit(1);

      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found or expired." });

      const updatedData = { ...session.data as Record<string, unknown>, corridors: input, step: 4 };
      await db.update(tenantOnboardingSessions)
        .set({ step: 4, data: updatedData, updatedAt: new Date() })
        .where(eq(tenantOnboardingSessions.id, session.id)).returning();

      return { success: true, verified: true, step: 4, message: "Corridors configured. Next: review and launch." };
    }),

  // ── Step 4: Get session summary for review ────────────────────────────────
  getSessionSummary: publicProcedure
    .input(z.object({ sessionToken: z.string().length(64) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [session] = await db.select().from(tenantOnboardingSessions)
        .where(and(
          eq(tenantOnboardingSessions.sessionToken, input.sessionToken),
          gt(tenantOnboardingSessions.expiresAt, new Date()),
        )).limit(1);

      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found or expired." });

      return {
        step: session.step,
        status: session.status,
        data: session.data,
        expiresAt: session.expiresAt.toISOString(),
        tenantId: session.tenantId,
      };
    }),

  // ── Step 5: Complete onboarding — create tenant (requires auth) ───────────
  completOnboarding: auditedProcedure
    .input(z.object({
      sessionToken: z.string().length(64),
      acceptTerms: z.boolean().refine(v => v === true, "You must accept the terms of service"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [session] = await db.select().from(tenantOnboardingSessions)
        .where(and(
          eq(tenantOnboardingSessions.sessionToken, input.sessionToken),
          eq(tenantOnboardingSessions.status, "in_progress"),
          gt(tenantOnboardingSessions.expiresAt, new Date()),
        )).limit(1);

      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found or expired. Please restart onboarding." });
      if (session.step < 4) throw new TRPCError({ code: "BAD_REQUEST", message: `Please complete all steps first. Currently on step ${session.step}.` });

      const data = session.data as Record<string, unknown>;
      const branding = (data.branding as Record<string, unknown>) ?? {};
      const corridorConfig = (data.corridors as Record<string, unknown>) ?? {};

      // W13 (F-24): all five writes in ONE db.transaction; the invite code is
      // re-validated and its used_count incremented with a guarded single-winner
      // update (TOCTOU-safe), and users.tenant_id is set for the tenant admin.
      const newTenant = await db.transaction(async (tx) => {
        // Re-validate the invite inside the transaction (it may have been
        // deactivated or exhausted since verifyInviteCode ran).
        const [invite] = await tx.select().from(partnerInviteCodes)
          .where(eq(partnerInviteCodes.id, session.inviteCodeId)).limit(1);
        if (!invite || !invite.isActive) {
          throw new TRPCError({ code: "FORBIDDEN", message: "This invite code has been deactivated." });
        }
        if (invite.expiresAt && new Date() > invite.expiresAt) {
          throw new TRPCError({ code: "FORBIDDEN", message: "This invite code has expired." });
        }

        // 1. Create the tenant
        const [created] = await tx.insert(tenants).values({
          slug: data.slug as string,
          name: data.companyName as string,
          brandName: data.brandName as string,
          plan: (data.plan as string) ?? "starter",
          status: "trial",
          ownerId: ctx.user.id,
          primaryColor: (branding.primaryColor as string) ?? "#7c3aed",
          secondaryColor: (branding.secondaryColor as string) ?? "#06b6d4",
          accentColor: (branding.accentColor as string) ?? "#f59e0b",
          logoUrl: branding.logoUrl as string | undefined,
          faviconUrl: branding.faviconUrl as string | undefined,
          customDomain: branding.customDomain as string | undefined,
          supportEmail: data.supportEmail as string,
          defaultCurrency: (data.defaultCurrency as string) ?? "USD",
          defaultLocale: "en",
          allowedCountries: (corridorConfig.allowedCountries as string[]) ?? [],
          maxMonthlyVolume: String(corridorConfig.maxTransferAmount ?? 50000),
          metadata: {
            website: data.website,
            description: data.description,
            onboardedAt: new Date().toISOString(),
            corridors: corridorConfig.corridors,
            defaultFeePercent: corridorConfig.defaultFeePercent,
            defaultFeeFixed: corridorConfig.defaultFeeFixed,
          },
        }).returning();

        // 2. Add owner as tenant admin
        await tx.insert(tenantUsers).values({
          tenantId: created.id,
          userId: ctx.user.id,
          role: "admin",
        }).returning();

        // 3. Set the admin's home tenant (W0 additive users.tenant_id) so
        // resolveTenantContext resolves them to this tenant.
        await tx.update(users)
          .set({ tenantId: created.id, updatedAt: new Date() })
          .where(eq(users.id, ctx.user.id));

        // 4. Create white-label config
        await tx.insert(whiteLabelConfigs).values({
          tenantId: created.id,
          showPoweredBy: (branding.showPoweredBy as boolean) ?? true,
          termsUrl: branding.termsUrl as string | undefined,
          privacyUrl: branding.privacyUrl as string | undefined,
          requireInviteCode: false,
          allowSelfRegistration: true,
          onboardingSteps: [
            { id: "profile", label: "Complete Profile", required: true, order: 1, enabled: true },
            { id: "kyc", label: "Identity Verification", required: true, order: 2, enabled: true },
            { id: "wallet", label: "Fund Wallet", required: false, order: 3, enabled: true },
            { id: "transfer", label: "First Transfer", required: false, order: 4, enabled: true },
          ],
        }).returning();

        // 5a. Guarded invite usage increment — single winner, fails when the
        // code is exhausted (used_count < max_uses guard; NULL max_uses = unlimited).
        const bumped = await tx.update(partnerInviteCodes)
          .set({ usedCount: sql`${partnerInviteCodes.usedCount} + 1` })
          .where(and(
            eq(partnerInviteCodes.id, session.inviteCodeId),
            sql`(${partnerInviteCodes.maxUses} IS NULL OR ${partnerInviteCodes.usedCount} < ${partnerInviteCodes.maxUses})`,
          ))
          .returning({ id: partnerInviteCodes.id });
        if (bumped.length !== 1) {
          throw new TRPCError({ code: "CONFLICT", message: "This invite code has reached its maximum usage limit." });
        }

        // 5b. Mark session as completed
        await tx.update(tenantOnboardingSessions)
          .set({ status: "completed", completedAt: new Date(), tenantId: created.id, userId: ctx.user.id, step: 6, updatedAt: new Date() })
          .where(eq(tenantOnboardingSessions.id, session.id)).returning();

        return created;
      });

      // Tenant assignment changed — drop the cached tenant context.
      invalidateTenantCache(ctx.user.id);

      return {
        success: true,
        tenantId: newTenant.id,
        slug: newTenant.slug,
        dashboardUrl: `/tenant/${newTenant.slug}/dashboard`,
        message: `🎉 Your white-label platform "${newTenant.brandName}" is ready! You can now customize it from your tenant dashboard.`,
      };
    }),

  // ── Get my tenants (for logged-in users) ──────────────────────────────────
  myTenants: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const rows = await db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        brandName: tenants.brandName,
        plan: tenants.plan,
        status: tenants.status,
        primaryColor: tenants.primaryColor,
        logoUrl: tenants.logoUrl,
        customDomain: tenants.customDomain,
        role: tenantUsers.role,
        createdAt: tenants.createdAt,
      })
      .from(tenantUsers)
      .innerJoin(tenants, eq(tenantUsers.tenantId, tenants.id))
      .where(eq(tenantUsers.userId, ctx.user.id));
    return rows;
  }),

  // ── Get single tenant detail ──────────────────────────────────────────────
  getTenant: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [row] = await db
        .select()
        .from(tenants)
        .innerJoin(tenantUsers, eq(tenantUsers.tenantId, tenants.id))
        .where(and(eq(tenants.slug, input.slug), eq(tenantUsers.userId, ctx.user.id)))
        .limit(1);

      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found or access denied." });
      return { ...row.tenants, role: row.tenant_users.role };
    }),

  // ── Update tenant branding ────────────────────────────────────────────────
  updateTenantBranding: protectedProcedure
    .input(z.object({
      tenantId: z.number().int().positive(),
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      logoUrl: z.string().url().optional(),
      faviconUrl: z.string().url().optional(),
      brandName: z.string().min(2).max(255).optional(),
      customDomain: z.string().max(255).optional(),
      supportEmail: z.string().email().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership
      const [membership] = await db.select().from(tenantUsers)
        .where(and(eq(tenantUsers.tenantId, input.tenantId), eq(tenantUsers.userId, ctx.user.id), eq(tenantUsers.role, "admin")))
        .limit(1);
      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "You are not an admin of this tenant." });

      const { tenantId, ...updates } = input;
      const [_row] = await db.update(tenants).set({ ...updates, updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning();

      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found or access denied" });

      return { success: true, id: (_row as any).id, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  // ── Get tenant members ────────────────────────────────────────────────────
  getTenantMembers: protectedProcedure
    .input(z.object({ tenantId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [membership] = await db.select().from(tenantUsers)
        .where(and(eq(tenantUsers.tenantId, input.tenantId), eq(tenantUsers.userId, ctx.user.id)))
        .limit(1);
      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });

      const members = await db
        .select({
          id: tenantUsers.id,
          userId: tenantUsers.userId,
          role: tenantUsers.role,
          joinedAt: tenantUsers.joinedAt,
          name: users.name,
          email: users.email,
          avatar: users.avatar,
          kycTier: users.kycTier,
        })
        .from(tenantUsers)
        .innerJoin(users, eq(tenantUsers.userId, users.id))
        .where(eq(tenantUsers.tenantId, input.tenantId));

      return members;
    }),

  // ── Remove tenant member ──────────────────────────────────────────────────
  removeTenantMember: auditedProcedure
    .input(z.object({ tenantId: z.number().int().positive(), targetUserId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [membership] = await db.select().from(tenantUsers)
        .where(and(eq(tenantUsers.tenantId, input.tenantId), eq(tenantUsers.userId, ctx.user.id), eq(tenantUsers.role, "admin")))
        .limit(1);
      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Only tenant admins can remove members." });
      if (input.targetUserId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot remove yourself." });

      const _deleted = await db.delete(tenantUsers)

        .where(and(eq(tenantUsers.tenantId, input.tenantId), eq(tenantUsers.userId, input.targetUserId))).returning();

      if (_deleted.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      // W13: membership changed — invalidate the removed member's cached tenant context.
      invalidateTenantCache(input.targetUserId);

      return { success: true, updatedAt: new Date().toISOString() };
    }),

  // ── Get white-label config ────────────────────────────────────────────────
  getWhiteLabelConfig: protectedProcedure
    .input(z.object({ tenantId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [membership] = await db.select().from(tenantUsers)
        .where(and(eq(tenantUsers.tenantId, input.tenantId), eq(tenantUsers.userId, ctx.user.id)))
        .limit(1);
      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });

      const [config] = await db.select().from(whiteLabelConfigs)
        .where(eq(whiteLabelConfigs.tenantId, input.tenantId)).limit(1);

      return config ?? null;
    }),

  // ── Update white-label config ─────────────────────────────────────────────
  updateWhiteLabelConfig: protectedProcedure
    .input(z.object({
      tenantId: z.number().int().positive(),
      showPoweredBy: z.boolean().optional(),
      requireInviteCode: z.boolean().optional(),
      allowSelfRegistration: z.boolean().optional(),
      termsUrl: z.string().url().optional().nullable(),
      privacyUrl: z.string().url().optional().nullable(),
      welcomeEmailSubject: z.string().max(255).optional(),
      welcomeEmailBody: z.string().max(5000).optional(),
      gaTrackingId: z.string().max(50).optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [membership] = await db.select().from(tenantUsers)
        .where(and(eq(tenantUsers.tenantId, input.tenantId), eq(tenantUsers.userId, ctx.user.id), eq(tenantUsers.role, "admin")))
        .limit(1);
      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Only tenant admins can update white-label config." });

      const { tenantId, ...updates } = input;
      const [_row] = await db.update(whiteLabelConfigs)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(whiteLabelConfigs.tenantId, tenantId)).returning();

      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found or access denied" });
      return { success: true, id: (_row as any).id, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  // ── Tenant analytics ──────────────────────────────────────────────────────
  getTenantAnalytics: protectedProcedure
    .input(z.object({ tenantId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [membership] = await db.select().from(tenantUsers)
        .where(and(eq(tenantUsers.tenantId, input.tenantId), eq(tenantUsers.userId, ctx.user.id)))
        .limit(1);
      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });

      const [memberCount] = await db.select({ count: sql<number>`count(*)` })
        .from(tenantUsers).where(eq(tenantUsers.tenantId, input.tenantId));

      // W13 (F-24): real counts from the DB — no hardcoded 99.2% success rate
      // or fabricated corridors. Volume/success metrics are derived from the
      // transactions of this tenant's member users.
      const memberIds = (await db.select({ userId: tenantUsers.userId })
        .from(tenantUsers).where(eq(tenantUsers.tenantId, input.tenantId)))
        .map((m) => m.userId);

      let totalVolume = 0;
      let monthlyVolume = 0;
      let successRate: number | null = null;
      let recentActivity: Array<{
        id: number; type: string | null; status: string | null;
        fromAmount: string | null; fromCurrency: string | null; createdAt: Date | null;
      }> = [];

      if (memberIds.length > 0) {
        const [totals] = await db.select({
          total: sql<number>`count(*)`,
          completed: sql<number>`count(*) filter (where ${transactions.status} = 'completed')`,
          volume: sql<string>`coalesce(sum(${transactions.fromAmount}) filter (where ${transactions.status} = 'completed'), 0)`,
          monthlyVol: sql<string>`coalesce(sum(${transactions.fromAmount}) filter (where ${transactions.status} = 'completed' and ${transactions.createdAt} >= now() - interval '30 days'), 0)`,
        }).from(transactions).where(inArray(transactions.userId, memberIds));

        const totalN = Number(totals?.total ?? 0);
        const completedN = Number(totals?.completed ?? 0);
        totalVolume = Number(totals?.volume ?? 0);
        monthlyVolume = Number(totals?.monthlyVol ?? 0);
        // Honest: null when the tenant has no transfers yet (rate undefined).
        successRate = totalN > 0 ? Math.round((completedN / totalN) * 1000) / 10 : null;

        recentActivity = await db.select({
          id: transactions.id,
          type: transactions.type,
          status: transactions.status,
          fromAmount: transactions.fromAmount,
          fromCurrency: transactions.fromCurrency,
          createdAt: transactions.createdAt,
        }).from(transactions).where(inArray(transactions.userId, memberIds))
          .orderBy(sql`${transactions.createdAt} DESC`).limit(20);
      }

      return {
        totalMembers: Number(memberCount?.count ?? 0),
        activeMembers: Number(memberCount?.count ?? 0),
        totalVolume,
        monthlyVolume,
        successRate,
        avgTransferTime: null, // not measured — no timing instrumentation exists
        topCorridors: [], // corridor breakdown requires recipientCountry aggregation — not computed yet
        recentActivity,
      };
    }),
});

// ─── Admin Invite Code Management Router ──────────────────────────────────────
export const adminInviteCodesRouter = router({

  // ── List all invite codes ─────────────────────────────────────────────────
  list: adminProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
      activeOnly: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const offset = (input.page - 1) * input.limit;
      const conditions = input.activeOnly ? [eq(partnerInviteCodes.isActive, true)] : [];

      const codes = await db.select({
        id: partnerInviteCodes.id,
        code: partnerInviteCodes.code,
        description: partnerInviteCodes.description,
        plan: partnerInviteCodes.plan,
        maxUses: partnerInviteCodes.maxUses,
        usedCount: partnerInviteCodes.usedCount,
        isActive: partnerInviteCodes.isActive,
        expiresAt: partnerInviteCodes.expiresAt,
        createdAt: partnerInviteCodes.createdAt,
        creatorName: users.name,
        creatorEmail: users.email,
      })
        .from(partnerInviteCodes)
        .innerJoin(users, eq(partnerInviteCodes.createdBy, users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(sql`${partnerInviteCodes.createdAt} DESC`)
        .limit(input.limit)
        .offset(offset);

      const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(partnerInviteCodes);

      return { codes, total: Number(total) };
    }),

  // ── Generate new invite code ──────────────────────────────────────────────
  generate: adminProcedure
    .input(z.object({
      description: z.string().max(500).optional(),
      plan: z.enum(["starter", "growth", "enterprise"]).default("starter"),
      maxUses: z.number().int().min(1).max(1000).default(1),
      expiresInDays: z.number().int().min(1).max(365).optional(),
      customCode: z.string().min(4).max(32).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      let code = input.customCode?.toUpperCase() ?? generateCode("RF");

      // Ensure uniqueness
      let attempts = 0;
      while (attempts < 10) {
        const [existing] = await db.select({ id: partnerInviteCodes.id })
          .from(partnerInviteCodes).where(eq(partnerInviteCodes.code, code)).limit(1);
        if (!existing) break;
        code = generateCode("RF");
        attempts++;
      }

      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : undefined;

      const [newCode] = await db.insert(partnerInviteCodes).values({
        code,
        description: input.description,
        createdBy: ctx.user.id,
        plan: input.plan,
        maxUses: input.maxUses,
        usedCount: 0,
        isActive: true,
        expiresAt,
      }).returning();

      return {
        success: true,
        verified: true,
        code: newCode.code,
        id: newCode.id,
        onboardingUrl: `/partner/onboard?code=${newCode.code}`,
        message: `Invite code ${newCode.code} generated for ${input.plan} plan.`,
      };
    }),

  // ── Deactivate invite code ────────────────────────────────────────────────
  deactivate: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [_row] = await db.update(partnerInviteCodes)
        .set({ isActive: false })
        .where(eq(partnerInviteCodes.id, input.id)).returning();

      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found or access denied" });
      return { success: true, id: (_row as any).id, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  // ── Reactivate invite code ────────────────────────────────────────────────
  reactivate: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [_row] = await db.update(partnerInviteCodes)
        .set({ isActive: true })
        .where(eq(partnerInviteCodes.id, input.id)).returning();

      if (!_row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found or access denied" });
      return { success: true, id: (_row as any).id, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  // ── Delete invite code ────────────────────────────────────────────────────
  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [_deleted] = await db.delete(partnerInviteCodes).where(eq(partnerInviteCodes.id, input.id)).returning();
      if (!_deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Invite code not found" });
      return { success: true, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  // ── List all tenants (admin) ──────────────────────────────────────────────
  listTenants: adminProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
      status: z.enum(["trial", "active", "suspended", "cancelled"]).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const offset = (input.page - 1) * input.limit;
      const conditions = input.status ? [eq(tenants.status, input.status as any)] : [];

      const rows = await db.select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        brandName: tenants.brandName,
        plan: tenants.plan,
        status: tenants.status,
        primaryColor: tenants.primaryColor,
        logoUrl: tenants.logoUrl,
        customDomain: tenants.customDomain,
        supportEmail: tenants.supportEmail,
        defaultCurrency: tenants.defaultCurrency,
        maxMonthlyVolume: tenants.maxMonthlyVolume,
        createdAt: tenants.createdAt,
        ownerName: users.name,
        ownerEmail: users.email,
      })
        .from(tenants)
        .leftJoin(users, eq(tenants.ownerId, users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(sql`${tenants.createdAt} DESC`)
        .limit(input.limit)
        .offset(offset);

      const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(tenants);

      return { tenants: rows, total: Number(total) };
    }),

  // ── Update tenant status (admin) ──────────────────────────────────────────
  // W13 (F-24): TOTP step-up + audit + guarded single-winner transitions.
  // The pgEnum has 'churned', NOT 'cancelled' — using 'cancelled' was a runtime
  // failure. Allowed transitions: trial→active|suspended|churned,
  // active→suspended|churned, suspended→active|churned. churned is terminal.
  updateTenantStatus: auditedAdminProcedure
    .input(z.object({
      tenantId: z.number().int().positive(),
      status: z.enum(["trial", "active", "suspended", "churned"]),
      reason: z.string().max(500).optional(),
      totpCode: z.string().regex(/^\d{6}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, `tenant status change to ${input.status}`);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const ALLOWED_FROM: Record<string, string[]> = {
        active: ["trial", "suspended"],
        suspended: ["trial", "active"],
        churned: ["trial", "active", "suspended"],
        trial: [], // trial is the initial state — no transition back
      };
      const fromStatuses = ALLOWED_FROM[input.status] ?? [];

      const [_row] = await db.update(tenants)
        .set({ status: input.status, updatedAt: new Date() })
        .where(and(eq(tenants.id, input.tenantId), inArray(tenants.status, fromStatuses)))
        .returning();

      if (!_row) {
        const [existing] = await db.select({ status: tenants.status }).from(tenants)
          .where(eq(tenants.id, input.tenantId)).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
        throw new TRPCError({
          code: "CONFLICT",
          message: `Tenant cannot transition from '${existing.status}' to '${input.status}'`,
        });
      }

      await createAuditLog({
        userId: ctx.user.id,
        action: "TENANT_STATUS_CHANGED",
        targetType: "tenants",
        targetId: input.tenantId,
        severity: input.status === "churned" || input.status === "suspended" ? "warning" : "info",
        description: `Tenant ${input.tenantId} status → ${input.status}${input.reason ? `: ${input.reason}` : ""}`,
        metadata: { tenantId: input.tenantId, newStatus: input.status, reason: input.reason ?? null },
      });

      return { success: true, id: (_row as any).id, status: input.status, updatedAt: new Date().toISOString() };
    }),

  // ── Real-time partner analytics dashboard ──────────────────────────────────
  analytics: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const [totalCodes] = await db.select({ count: sql<number>`count(*)` }).from(partnerInviteCodes);
    const [activeCodes] = await db.select({ count: sql<number>`count(*)` }).from(partnerInviteCodes).where(eq(partnerInviteCodes.isActive, true));
    const [totalSessions] = await db.select({ count: sql<number>`count(*)` }).from(tenantOnboardingSessions);
    const [completedSessions] = await db.select({ count: sql<number>`count(*)` }).from(tenantOnboardingSessions).where(eq(tenantOnboardingSessions.status, 'completed'));
    const [totalTenants] = await db.select({ count: sql<number>`count(*)` }).from(tenants);
    const [activeTenants] = await db.select({ count: sql<number>`count(*)` }).from(tenants).where(eq(tenants.status, 'active'));

    const codePerformance = await db.select({
      code: partnerInviteCodes.code,
      description: partnerInviteCodes.description,
      plan: partnerInviteCodes.plan,
      maxUses: partnerInviteCodes.maxUses,
      usedCount: partnerInviteCodes.usedCount,
      isActive: partnerInviteCodes.isActive,
      expiresAt: partnerInviteCodes.expiresAt,
      createdAt: partnerInviteCodes.createdAt,
    }).from(partnerInviteCodes).orderBy(sql`${partnerInviteCodes.usedCount} DESC`);

    const funnelRaw = await db.select({
      step: tenantOnboardingSessions.step,
      status: tenantOnboardingSessions.status,
      count: sql<number>`count(*)`,
    }).from(tenantOnboardingSessions).groupBy(tenantOnboardingSessions.step, tenantOnboardingSessions.status);

    const recentActivity = await db.select({
      id: tenantOnboardingSessions.id,
      step: tenantOnboardingSessions.step,
      status: tenantOnboardingSessions.status,
      createdAt: tenantOnboardingSessions.createdAt,
      completedAt: tenantOnboardingSessions.completedAt,
      inviteCode: partnerInviteCodes.code,
      plan: partnerInviteCodes.plan,
      userName: users.name,
      userEmail: users.email,
      tenantName: tenants.name,
    })
      .from(tenantOnboardingSessions)
      .innerJoin(partnerInviteCodes, eq(tenantOnboardingSessions.inviteCodeId, partnerInviteCodes.id))
      .leftJoin(users, eq(tenantOnboardingSessions.userId, users.id))
      .leftJoin(tenants, eq(tenantOnboardingSessions.tenantId, tenants.id))
      .orderBy(sql`${tenantOnboardingSessions.createdAt} DESC`)
      .limit(20);

    const totalSessionsN = Number(totalSessions.count);
    const completedN = Number(completedSessions.count);
    const conversionRate = totalSessionsN > 0 ? Math.round((completedN / totalSessionsN) * 100) : 0;

    return {
      summary: {
        totalCodes: Number(totalCodes.count),
        activeCodes: Number(activeCodes.count),
        totalSessions: totalSessionsN,
        completedSessions: completedN,
        conversionRate,
        totalTenants: Number(totalTenants.count),
        activeTenants: Number(activeTenants.count),
      },
      codePerformance: codePerformance.map((c: any) => ({ ...c, usedCount: Number(c.usedCount), maxUses: Number(c.maxUses) })),
      funnel: funnelRaw.map((f: any) => ({ ...f, count: Number(f.count) })),
      recentActivity,
    };
  }),

  // ── Partner fee revenue analytics ────────────────────────────────────────
  feeRevenue: adminProcedure
    .input(z.object({ months: z.number().int().min(1).max(24).default(6) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // Get all tenants with their invite codes
      const tenantList = await db.select({
        tenantId: tenants.id,
        tenantName: tenants.name,
        plan: tenants.plan,
        inviteCode: partnerInviteCodes.code,
      }).from(tenants)
        .leftJoin(tenantOnboardingSessions, eq(tenantOnboardingSessions.tenantId, tenants.id))
        .leftJoin(partnerInviteCodes, eq(tenantOnboardingSessions.inviteCodeId, partnerInviteCodes.id));
      // Map users to tenants
      const tenantUserList = await db.select({ tenantId: tenantUsers.tenantId, userId: tenantUsers.userId }).from(tenantUsers);
      const userToTenant: Record<number, number> = {};
      for (const tu of tenantUserList) { userToTenant[tu.userId] = tu.tenantId; }
      // Get completed transactions with fees for the last N months
      const since = new Date();
      since.setMonth(since.getMonth() - input.months);
      const txList = await db.select({
        userId: transactions.userId,
        fee: transactions.fee,
        fromCurrency: transactions.fromCurrency,
        createdAt: transactions.createdAt,
      }).from(transactions)
        .where(and(
          sql`${transactions.createdAt} >= ${since.toISOString()}`,
          sql`CAST(${transactions.fee} AS DECIMAL) > 0`,
          eq(transactions.status, 'completed'),
        ));
      // Build per-tenant aggregates
      const tenantMap: Record<number, { tenantId: number; tenantName: string; plan: string; inviteCode: string; totalFee: number; txCount: number }> = {};
      for (const t of tenantList) {
        if (!tenantMap[t.tenantId]) {
          tenantMap[t.tenantId] = { tenantId: t.tenantId, tenantName: t.tenantName ?? 'Unknown', plan: t.plan ?? 'starter', inviteCode: t.inviteCode ?? 'Direct', totalFee: 0, txCount: 0 };
        }
      }
      const monthlyMap: Record<string, { month: string; totalFee: number; txCount: number }> = {};
      let globalFee = 0; let globalTx = 0;
      for (const tx of txList) {
        const fee = Number(tx.fee ?? 0);
        const tenantId = userToTenant[tx.userId];
        const monthKey = new Date(tx.createdAt).toISOString().slice(0, 7);
        if (!monthlyMap[monthKey]) { monthlyMap[monthKey] = { month: monthKey, totalFee: 0, txCount: 0 }; }
        monthlyMap[monthKey].totalFee += fee;
        monthlyMap[monthKey].txCount += 1;
        globalFee += fee; globalTx += 1;
        if (tenantId && tenantMap[tenantId]) { tenantMap[tenantId].totalFee += fee; tenantMap[tenantId].txCount += 1; }
      }
      const byPartner = Object.values(tenantMap)
        .map(t => ({ ...t, totalFee: safeParseAmount(t.totalFee.toFixed(2)), revenueShare: globalFee > 0 ? safeParseAmount(((t.totalFee / globalFee) * 100).toFixed(1)) : 0 }))
        .sort((a, b) => b.totalFee - a.totalFee);
      const monthly = Object.values(monthlyMap)
        .map(m => ({ ...m, totalFee: safeParseAmount(m.totalFee.toFixed(2)) }))
        .sort((a, b) => a.month.localeCompare(b.month));
      return { byPartner, monthly, topPartners: byPartner.slice(0, 10), totalRevenue: safeParseAmount(globalFee.toFixed(2)), totalTransactions: globalTx };
    }),
  // ── Get onboarding sessions (admin) ──────────────────────────────────────
  listOnboardingSessions: adminProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
      status: z.enum(["in_progress", "completed", "abandoned"]).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const offset = (input.page - 1) * input.limit;
      const conditions = input.status ? [eq(tenantOnboardingSessions.status, input.status)] : [];

      const sessions = await db.select({
        id: tenantOnboardingSessions.id,
        step: tenantOnboardingSessions.step,
        status: tenantOnboardingSessions.status,
        completedAt: tenantOnboardingSessions.completedAt,
        expiresAt: tenantOnboardingSessions.expiresAt,
        createdAt: tenantOnboardingSessions.createdAt,
        inviteCode: partnerInviteCodes.code,
        plan: partnerInviteCodes.plan,
        userName: users.name,
        userEmail: users.email,
        tenantName: tenants.name,
      })
        .from(tenantOnboardingSessions)
        .innerJoin(partnerInviteCodes, eq(tenantOnboardingSessions.inviteCodeId, partnerInviteCodes.id))
        .leftJoin(users, eq(tenantOnboardingSessions.userId, users.id))
        .leftJoin(tenants, eq(tenantOnboardingSessions.tenantId, tenants.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(sql`${tenantOnboardingSessions.createdAt} DESC`)
        .limit(input.limit)
        .offset(offset);

      const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(tenantOnboardingSessions);

      return { sessions, total: Number(total) };
    }),
});
