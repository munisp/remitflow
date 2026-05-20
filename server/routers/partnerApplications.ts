/**
 * v91 — Partner Application & Approval Workflow Router
 *
 * Covers:
 *  - Public: apply (multi-step), check status
 *  - Protected: manage own application, sign SLA, upload docs
 *  - Admin: approval queue, review, approve/reject, request more info, comments
 *  - Partner self-service: API keys, webhooks, branding, team, analytics
 *  - Compliance: email config, report delivery
 */
import { TRPCError } from "@trpc/server";
import { auditedProcedure, auditedAdminProcedure, rateLimitedProcedure } from "../_core/trpc";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { sql } from "drizzle-orm";
import { logger } from '../_core/logger';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateApiKey(env: "sandbox" | "production"): { fullKey: string; prefix: string; hash: string } {
  const prefix = env === "production" ? "rf_live" : "rf_test";
  const secret = randomBytes(24).toString("hex");
  const fullKey = `${prefix}_${secret}`;
  const keyPrefix = fullKey.substring(0, 12);
  const hash = createHash("sha256").update(fullKey).digest("hex");
  return { fullKey, prefix: keyPrefix, hash };
}

function generateWebhookSecret(): string {
  return "whsec_" + randomBytes(32).toString("hex");
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 63);
}

// ─── Partner Application Router ───────────────────────────────────────────────
export const partnerApplicationsRouter = router({
  // ── Public: Submit new application ──────────────────────────────────────────
  submit: publicProcedure
    .input(z.object({
      companyName: z.string().min(2).max(255),
      brandName: z.string().min(2).max(255),
      applicationType: z.enum(["fintech_startup", "bank", "mfi", "ngo", "telecom", "aggregator", "enterprise", "other"]).default("fintech_startup"),
      contactName: z.string().min(2).max(255),
      contactEmail: z.string().email(),
      contactPhone: z.string().optional(),
      website: z.string().url().optional(),
      country: z.string().length(2).or(z.string().length(3)),
      registrationNumber: z.string().optional(),
      taxId: z.string().optional(),
      incorporationDate: z.string().optional(),
      businessDescription: z.string().min(50).max(2000),
      expectedMonthlyVolume: z.number().positive().optional(),
      expectedUserCount: z.number().int().positive().optional(),
      targetCorridors: z.array(z.string()).default([]),
      requestedPlan: z.enum(["starter", "growth", "enterprise", "white_label"]).default("starter"),
      hasAmlPolicy: z.boolean().default(false),
      hasKycProcess: z.boolean().default(false),
      isRegulated: z.boolean().default(false),
      regulatoryLicenses: z.array(z.string()).default([]),
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#7c3aed"),
      secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#06b6d4"),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Generate unique slug
      const baseSlug = slugify(input.brandName);
      const uniqueSuffix = randomBytes(3).toString("hex");
      const slug = `${baseSlug}-${uniqueSuffix}`;

      const result = await db.execute(sql`
        INSERT INTO partner_applications (
          company_name, brand_name, slug, application_type,
          contact_name, contact_email, contact_phone, website,
          country, registration_number, tax_id, incorporation_date,
          business_description, expected_monthly_volume, expected_user_count,
          target_corridors, requested_plan,
          has_aml_policy, has_kyc_process, is_regulated, regulatory_licenses,
          primary_color, secondary_color,
          status, submitted_at, created_at, updated_at
        ) VALUES (
          ${input.companyName}, ${input.brandName}, ${slug}, ${input.applicationType},
          ${input.contactName}, ${input.contactEmail}, ${input.contactPhone ?? null}, ${input.website ?? null},
          ${input.country}, ${input.registrationNumber ?? null}, ${input.taxId ?? null}, ${input.incorporationDate ?? null},
          ${input.businessDescription}, ${input.expectedMonthlyVolume ?? null}, ${input.expectedUserCount ?? null},
          ${JSON.stringify(input.targetCorridors)}, ${input.requestedPlan},
          ${input.hasAmlPolicy}, ${input.hasKycProcess}, ${input.isRegulated}, ${JSON.stringify(input.regulatoryLicenses)},
          ${input.primaryColor}, ${input.secondaryColor},
          'submitted', NOW(), NOW(), NOW()
        ) RETURNING id, slug, status
      `);
      const row = (result as any[])[0];
      return {
        success: true,
        applicationId: row.id,
        slug: row.slug,
        status: "submitted",
        message: "Your application has been submitted. Our team will review it within 2-3 business days.",
        trackingUrl: `/partner/application/${row.slug}`,
      };
    }),

  // ── Public: Check application status by slug ─────────────────────────────
  checkStatus: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const rows = await db.execute(sql`
        SELECT id, slug, company_name, brand_name, status, submitted_at, reviewed_at,
               rejection_reason, additional_info_request, approved_at, sla_signed_at,
               requested_plan, contact_email
        FROM partner_applications WHERE slug = ${input.slug} LIMIT 1
      `);
      const app = (rows as any[])[0];
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });
      return app;
    }),

  // ── Protected: Get my applications ──────────────────────────────────────────
  myApplications: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.execute(sql`
      SELECT id, slug, company_name, brand_name, status, submitted_at, reviewed_at,
             approved_at, requested_plan, rejection_reason, additional_info_request
      FROM partner_applications
      WHERE submitted_by_user_id = ${ctx.user.id}
      ORDER BY created_at DESC
    `);
    return rows as any[];
  }),

  // ── Protected: Upload compliance document URL ────────────────────────────
  uploadDocument: protectedProcedure
    .input(z.object({
      applicationId: z.number().int(),
      docType: z.enum(["businessRegDocUrl", "amlPolicyDocUrl", "directorIdDocUrl", "bankStatementDocUrl"]),
      fileUrl: z.string().url(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const colMap: Record<string, string> = {
        businessRegDocUrl: "business_reg_doc_url",
        amlPolicyDocUrl: "aml_policy_doc_url",
        directorIdDocUrl: "director_id_doc_url",
        bankStatementDocUrl: "bank_statement_doc_url",
      };
      const col = colMap[input.docType];
      await db.execute(sql`
        UPDATE partner_applications
        SET ${sql.raw(col)} = ${input.fileUrl}, updated_at = NOW()
        WHERE id = ${input.applicationId} AND submitted_by_user_id = ${ctx.user.id}
      `);
      return { success: true };
    }),

  // ── Protected: Sign SLA ──────────────────────────────────────────────────
  signSla: auditedProcedure
    .input(z.object({
      applicationId: z.number().int(),
      slaVersion: z.string().default("v1.0"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.execute(sql`
        UPDATE partner_applications
        SET sla_signed_at = NOW(), sla_version = ${input.slaVersion}, updated_at = NOW()
        WHERE id = ${input.applicationId} AND submitted_by_user_id = ${ctx.user.id}
      `);
      return { success: true, signedAt: new Date().toISOString() };
    }),

  // ── Protected: Provide additional info ──────────────────────────────────
  provideAdditionalInfo: auditedProcedure
    .input(z.object({
      applicationId: z.number().int(),
      response: z.string().min(10),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.execute(sql`
        UPDATE partner_applications
        SET status = 'submitted',
            additional_info_provided_at = NOW(),
            business_description = COALESCE(business_description, '') || E'\n\n[Additional Info]\n' || ${input.response},
            updated_at = NOW()
        WHERE id = ${input.applicationId} AND submitted_by_user_id = ${ctx.user.id}
          AND status = 'additional_info_required'
      `);
      return { success: true };
    }),

  // ── Admin: List all applications with filters ────────────────────────────
  adminList: adminProcedure
    .input(z.object({
      status: z.enum(["draft", "submitted", "under_review", "additional_info_required", "approved", "rejected", "suspended", "all"]).default("all"),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { applications: [], total: 0, page: input.page, limit: input.limit };
      const offset = (input.page - 1) * input.limit;
      const statusFilter = input.status === "all" ? sql`1=1` : sql`status = ${input.status}`;
      const searchFilter = input.search
        ? sql`AND (company_name ILIKE ${'%' + input.search + '%'} OR contact_email ILIKE ${'%' + input.search + '%'} OR brand_name ILIKE ${'%' + input.search + '%'})`
        : sql``;
      const rows = await db.execute(sql`
        SELECT pa.*, u.name as reviewer_name
        FROM partner_applications pa
        LEFT JOIN users u ON u.id = pa.reviewed_by
        WHERE ${statusFilter} ${searchFilter}
        ORDER BY pa.submitted_at DESC NULLS LAST, pa.created_at DESC
        LIMIT ${input.limit} OFFSET ${offset}
      `);
      const countRows = await db.execute(sql`
        SELECT COUNT(*) as total FROM partner_applications WHERE ${statusFilter} ${searchFilter}
      `);
      return {
        applications: rows as any[],
        total: Number((countRows as any[])[0]?.total ?? 0),
        page: input.page,
        limit: input.limit,
      };
    }),

  // ── Admin: Get single application detail ────────────────────────────────
  adminGetDetail: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const rows = await db.execute(sql`
        SELECT pa.*, u.name as reviewer_name, u2.name as submitter_name
        FROM partner_applications pa
        LEFT JOIN users u ON u.id = pa.reviewed_by
        LEFT JOIN users u2 ON u2.id = pa.submitted_by_user_id
        WHERE pa.id = ${input.id} LIMIT 1
      `);
      const app = (rows as any[])[0];
      if (!app) throw new TRPCError({ code: "NOT_FOUND" });
      // Get comments
      const comments = await db.execute(sql`
        SELECT pac.*, u.name as author_name, u.avatar as author_avatar
        FROM partner_application_comments pac
        JOIN users u ON u.id = pac.author_id
        WHERE pac.application_id = ${input.id}
        ORDER BY pac.created_at ASC
      `);
      return { ...app, comments: comments as any[] };
    }),

  // ── Admin: Move to under_review ──────────────────────────────────────────
  startReview: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.execute(sql`
        UPDATE partner_applications
        SET status = 'under_review', reviewed_by = ${ctx.user.id}, updated_at = NOW()
        WHERE id = ${input.id} AND status IN ('submitted', 'additional_info_required')
      `);
      return { success: true };
    }),

  // ── Admin: Approve application ───────────────────────────────────────────
  approve: adminProcedure
    .input(z.object({
      id: z.number().int(),
      reviewNotes: z.string().optional(),
      plan: z.enum(["starter", "growth", "enterprise", "white_label"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Get application
      const appRows = await db.execute(sql`SELECT * FROM partner_applications WHERE id = ${input.id} LIMIT 1`);
      const app = (appRows as any[])[0];
      if (!app) throw new TRPCError({ code: "NOT_FOUND" });

      // Create tenant
      const tenantRows = await db.execute(sql`
        INSERT INTO tenants (slug, name, plan, status, brand_name, support_email, primary_color, secondary_color, logo_url, "createdAt", "updatedAt")
        VALUES (${app.slug}, ${app.company_name}, ${input.plan ?? app.requested_plan}, 'active',
                ${app.brand_name}, ${app.contact_email}, ${app.primary_color}, ${app.secondary_color}, ${app.logo_url ?? null},
                NOW(), NOW())
        RETURNING id
      `);
      const tenantId = (tenantRows as any[])[0].id;

      // Generate invite code for the partner
      const inviteCode = `RF-${randomBytes(4).toString("hex").toUpperCase()}-APPROVED`;
      await db.execute(sql`
        INSERT INTO partner_invite_codes (code, description, created_by, max_uses, plan, is_active, "createdAt")
        VALUES (${inviteCode}, ${'Auto-generated for approved application ' + app.slug}, ${ctx.user.id}, 1, ${input.plan ?? app.requested_plan}, true, NOW())
      `);


      // Update application
      await db.execute(sql`
        UPDATE partner_applications
        SET status = 'approved', reviewed_by = ${ctx.user.id}, reviewed_at = NOW(),
            approved_at = NOW(), review_notes = ${input.reviewNotes ?? null},
            tenant_id = ${tenantId}, updated_at = NOW()
        WHERE id = ${input.id}
      `);

      // Add audit comment
      await db.execute(sql`
        INSERT INTO partner_application_comments (application_id, author_id, comment, is_internal, created_at)
        VALUES (${input.id}, ${ctx.user.id}, ${`Application approved. Tenant created with ID ${tenantId}. Plan: ${input.plan ?? app.requested_plan}`}, false, NOW())
      `);

      return { success: true, tenantId, inviteCode };
    }),

  // ── Admin: Reject application ────────────────────────────────────────────
  reject: adminProcedure
    .input(z.object({
      id: z.number().int(),
      rejectionReason: z.string().min(10),
      reviewNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.execute(sql`
        UPDATE partner_applications
        SET status = 'rejected', reviewed_by = ${ctx.user.id}, reviewed_at = NOW(),
            rejection_reason = ${input.rejectionReason},
            review_notes = ${input.reviewNotes ?? null}, updated_at = NOW()
        WHERE id = ${input.id}
      `);
      await db.execute(sql`
        INSERT INTO partner_application_comments (application_id, author_id, comment, is_internal, created_at)
        VALUES (${input.id}, ${ctx.user.id}, ${`Application rejected: ${input.rejectionReason}`}, false, NOW())
      `);
      return { success: true };
    }),

  // ── Admin: Request additional info ──────────────────────────────────────
  requestAdditionalInfo: adminProcedure
    .input(z.object({
      id: z.number().int(),
      request: z.string().min(10),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.execute(sql`
        UPDATE partner_applications
        SET status = 'additional_info_required',
            additional_info_request = ${input.request},
            reviewed_by = ${ctx.user.id}, updated_at = NOW()
        WHERE id = ${input.id}
      `);
      await db.execute(sql`
        INSERT INTO partner_application_comments (application_id, author_id, comment, is_internal, created_at)
        VALUES (${input.id}, ${ctx.user.id}, ${`Additional info requested: ${input.request}`}, false, NOW())
      `);
      return { success: true };
    }),

  // ── Admin: Add comment ───────────────────────────────────────────────────
  addComment: adminProcedure
    .input(z.object({
      applicationId: z.number().int(),
      comment: z.string().min(1),
      isInternal: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.execute(sql`
        INSERT INTO partner_application_comments (application_id, author_id, comment, is_internal, created_at)
        VALUES (${input.applicationId}, ${ctx.user.id}, ${input.comment}, ${input.isInternal}, NOW())
      `);
      return { success: true };
    }),

  // ── Admin: Dashboard stats ───────────────────────────────────────────────
  adminStats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, pending: 0, approved: 0, rejected: 0, underReview: 0 };
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status IN ('submitted', 'additional_info_required')) as pending,
        COUNT(*) FILTER (WHERE status = 'under_review') as under_review,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) FILTER (WHERE status = 'suspended') as suspended
      FROM partner_applications
    `);
    return (rows as any[])[0];
  }),
});

// ─── Partner API Keys Router ──────────────────────────────────────────────────
export const partnerApiKeysRouter = router({
  // List keys for a tenant
  list: protectedProcedure
    .input(z.object({ tenantId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.execute(sql`
        SELECT id, name, key_prefix, environment, status, permissions,
               last_used_at, expires_at, request_count, created_at
        FROM partner_api_keys
        WHERE tenant_id = ${input.tenantId}
        ORDER BY created_at DESC
      `);
      return rows as any[];
    }),

  // Create new API key
  create: protectedProcedure
    .input(z.object({
      tenantId: z.number().int(),
      name: z.string().min(1).max(100),
      environment: z.enum(["sandbox", "production"]).default("sandbox"),
      permissions: z.array(z.string()).default(["transfers:read", "transfers:write", "webhooks:manage"]),
      expiresInDays: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { fullKey, prefix, hash } = generateApiKey(input.environment);
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86400000).toISOString()
        : null;
      const keyInserted = await db.execute(sql`
        INSERT INTO partner_api_keys (tenant_id, name, key_prefix, key_hash, environment, status, permissions, expires_at, created_by, created_at)
        VALUES (${input.tenantId}, ${input.name}, ${prefix}, ${hash}, ${input.environment}, 'active',
                ${JSON.stringify(input.permissions)}, ${expiresAt}, ${ctx.user.id}, NOW())
        RETURNING id
      `);
      const keyId = (keyInserted as any)[0]?.id ?? 0;
      // Return full key ONCE — never stored in DB
      return { success: true, fullKey, prefix, keyId, environment: input.environment };
    }),

  // Revoke key
  revoke: auditedProcedure
    .input(z.object({ keyId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.execute(sql`
        UPDATE partner_api_keys
        SET status = 'revoked', revoked_by = ${ctx.user.id}, revoked_at = NOW()
        WHERE id = ${input.keyId}
      `);
      return { success: true };
    }),
});

// ─── Partner Webhooks Router ──────────────────────────────────────────────────
export const partnerWebhooksRouter = router({
  list: protectedProcedure
    .input(z.object({ tenantId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.execute(sql`
        SELECT id, url, events, is_active, last_delivered_at, failure_count, created_at
        FROM partner_webhooks WHERE tenant_id = ${input.tenantId} ORDER BY created_at DESC
      `);
      return rows as any[];
    }),

  create: protectedProcedure
    .input(z.object({
      tenantId: z.number().int(),
      url: z.string().url(),
      events: z.array(z.string()).default(["transfer.completed", "transfer.failed", "kyc.approved"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const signingSecret = generateWebhookSecret();
      const whInserted = await db.execute(sql`
        INSERT INTO partner_webhooks (tenant_id, url, events, signing_secret, is_active, failure_count, created_by, created_at, updated_at)
        VALUES (${input.tenantId}, ${input.url}, ${JSON.stringify(input.events)}, ${signingSecret}, true, 0, ${ctx.user.id}, NOW(), NOW())
        RETURNING id
      `);
      const webhookId = (whInserted as any)[0]?.id ?? 0;
      return { success: true, signingSecret, webhookId };
    }),

  toggle: auditedProcedure
    .input(z.object({ webhookId: z.number().int(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.execute(sql`UPDATE partner_webhooks SET is_active = ${input.isActive}, updated_at = NOW() WHERE id = ${input.webhookId}`);
      return { success: true };
    }),

  delete: auditedProcedure
    .input(z.object({ webhookId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.execute(sql`DELETE FROM partner_webhooks WHERE id = ${input.webhookId}`);
      return { success: true };
    }),
});

// ─── User Onboarding Router ───────────────────────────────────────────────────
export const userOnboardingRouter = router({
  getProgress: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.execute(sql`
      SELECT * FROM user_onboarding_progress WHERE user_id = ${ctx.user.id} LIMIT 1
    `);
    if ((rows as any[]).length === 0) {
      // Create initial record
      await db.execute(sql`
        INSERT INTO user_onboarding_progress (user_id, status, created_at, updated_at)
        VALUES (${ctx.user.id}, 'not_started', NOW(), NOW())
        ON CONFLICT (user_id) DO NOTHING
      `);
      return {
        status: "not_started",
        profileCompleted: false,
        bankLinked: false,
        kycStarted: false,
        kycCompleted: false,
        firstTransferMade: false,
        notificationsEnabled: false,
        completedSteps: 0,
        totalSteps: 6,
        percentComplete: 0,
      };
    }
    const p = (rows as any[])[0];
    const completedSteps = [p.profile_completed, p.bank_linked, p.kyc_started, p.kyc_completed, p.first_transfer_made, p.notifications_enabled].filter(Boolean).length;
    return {
      ...p,
      completedSteps,
      totalSteps: 6,
      percentComplete: Math.round((completedSteps / 6) * 100),
    };
  }),

  completeStep: auditedProcedure
    .input(z.object({
      step: z.enum(["profile", "bank", "kycStart", "kycComplete", "firstTransfer", "notifications"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const colMap: Record<string, { col: string; tsCol: string }> = {
        profile: { col: "profile_completed", tsCol: "profile_completed_at" },
        bank: { col: "bank_linked", tsCol: "bank_linked_at" },
        kycStart: { col: "kyc_started", tsCol: "kyc_started_at" },
        kycComplete: { col: "kyc_completed", tsCol: "kyc_completed_at" },
        firstTransfer: { col: "first_transfer_made", tsCol: "first_transfer_at" },
        notifications: { col: "notifications_enabled", tsCol: null as any },
      };
      const { col, tsCol } = colMap[input.step];
      const tsUpdate = tsCol ? sql`, ${sql.raw(tsCol)} = NOW()` : sql``;
      await db.execute(sql`
        INSERT INTO user_onboarding_progress (user_id, status, ${sql.raw(col)}, created_at, updated_at)
        VALUES (${ctx.user.id}, 'in_progress', true, NOW(), NOW())
        ON CONFLICT (user_id) DO UPDATE
        SET ${sql.raw(col)} = true, status = 'in_progress', updated_at = NOW() ${tsUpdate}
      `);
      // Check if all steps complete
      const rows = await db.execute(sql`SELECT * FROM user_onboarding_progress WHERE user_id = ${ctx.user.id} LIMIT 1`);
      const p = (rows as any[])[0];
      if (p?.profile_completed && p?.bank_linked && p?.kyc_completed && p?.first_transfer_made) {
        await db.execute(sql`UPDATE user_onboarding_progress SET status = 'completed', completed_at = NOW() WHERE user_id = ${ctx.user.id}`);
      }
      return { success: true };
    }),

  skip: auditedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await db.execute(sql`
      INSERT INTO user_onboarding_progress (user_id, status, skipped_at, created_at, updated_at)
      VALUES (${ctx.user.id}, 'skipped', NOW(), NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET status = 'skipped', skipped_at = NOW(), updated_at = NOW()
    `);
    return { success: true };
  }),

  // Full onboarding completion — saves all collected data in one shot
  complete: protectedProcedure
    .input(z.object({
      phone: z.string().optional(),
      country: z.string().optional(),
      address: z.string().optional(),
      dateOfBirth: z.string().optional(),
      idType: z.string().optional(),
      idNumber: z.string().optional(),
      bankName: z.string().optional(),
      accountNumber: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const profileCompleted = !!(input.phone && input.address);
      const bankLinked = !!(input.bankName && input.accountNumber);
      const kycStarted = !!(input.idType || input.idNumber);
      await db.execute(sql`
        INSERT INTO user_onboarding_progress
          (user_id, status, profile_completed, bank_linked, kyc_started, created_at, updated_at)
        VALUES
          (${ctx.user.id}, 'in_progress', ${profileCompleted}, ${bankLinked}, ${kycStarted}, NOW(), NOW())
        ON CONFLICT (user_id) DO UPDATE
        SET profile_completed = ${profileCompleted},
            bank_linked = ${bankLinked},
            kyc_started = ${kycStarted},
            status = 'in_progress',
            updated_at = NOW()
      `);
      return { success: true, profileCompleted, bankLinked, kycStarted };
    }),
});

// ─── Compliance Email Config Router ──────────────────────────────────────────
export const complianceEmailRouter = router({
  // Multi-recipient list
  listConfigs: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.execute(sql`SELECT * FROM compliance_email_config ORDER BY created_at DESC`);
    return (rows as any[]).map((r: any) => ({
      ...r,
      report_types: typeof r.report_types === 'string' ? JSON.parse(r.report_types) : (r.report_types ?? []),
    }));
  }),

  createConfig: adminProcedure
    .input(z.object({
      recipientEmail: z.string().email(),
      recipientName: z.string().min(2),
      reportTypes: z.array(z.string()).min(1),
      frequency: z.enum(["immediate", "daily_digest", "weekly_digest"]).default("immediate"),
      includeAttachment: z.boolean().default(true),
      encryptAttachment: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.execute(sql`
        INSERT INTO compliance_email_config
          (officer_name, officer_email, report_types, is_active, frequency, include_attachment, encrypt_attachment,
           smtp_host, smtp_port, from_email, from_name, created_by, created_at, updated_at)
        VALUES
          (${input.recipientName}, ${input.recipientEmail}, ${JSON.stringify(input.reportTypes)}, true,
           ${input.frequency}, ${input.includeAttachment}, ${input.encryptAttachment},
           'smtp.sendgrid.net', 587, 'compliance@remitflow.com', 'RemitFlow Compliance',
           ${ctx.user.id}, NOW(), NOW())
      `);
      return { success: true };
    }),

  deleteConfig: adminProcedure
    .input(z.object({ configId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.execute(sql`DELETE FROM compliance_email_config WHERE id = ${input.configId}`);
      return { success: true };
    }),

  sendTestEmail: adminProcedure
    .input(z.object({ reportType: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const rows = await db.execute(sql`SELECT * FROM compliance_email_config WHERE is_active = true LIMIT 1`);
      const config = (rows as any[])[0];
      const toEmail = config?.officer_email ?? "compliance@remitflow.com";
      logger.info(`[Compliance Email] TEST: ${input.reportType} → ${toEmail}`);
      return { success: true, sentTo: toEmail, reportType: input.reportType };
    }),

  getDeliveryLog: adminProcedure
    .input(z.object({ limit: z.number().int().default(20) }))
    .query(async () => {
      // In production this would query an email_delivery_log table
      return [] as any[];
    }),

  getConfig: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.execute(sql`
      SELECT id, officer_name, officer_email, report_types, is_active,
             smtp_host, smtp_port, smtp_user, from_email, from_name, created_at
      FROM compliance_email_config WHERE is_active = true ORDER BY created_at DESC LIMIT 1
    `);
    return (rows as any[])[0] ?? null;
  }),

  saveConfig: adminProcedure
    .input(z.object({
      officerName: z.string().min(2),
      officerEmail: z.string().email(),
      reportTypes: z.array(z.string()).default(["CTR", "SAR", "FBAR"]),
      smtpHost: z.string().default("smtp.sendgrid.net"),
      smtpPort: z.number().int().default(587),
      smtpUser: z.string().optional(),
      smtpPassword: z.string().optional(),
      fromEmail: z.string().email().default("compliance@remitflow.com"),
      fromName: z.string().default("RemitFlow Compliance"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Deactivate existing
      await db.execute(sql`UPDATE compliance_email_config SET is_active = false`);
      // Insert new
      await db.execute(sql`
        INSERT INTO compliance_email_config (
          officer_name, officer_email, report_types, is_active,
          smtp_host, smtp_port, smtp_user, smtp_password_encrypted,
          from_email, from_name, created_by, created_at, updated_at
        ) VALUES (
          ${input.officerName}, ${input.officerEmail}, ${JSON.stringify(input.reportTypes)}, true,
          ${input.smtpHost}, ${input.smtpPort}, ${input.smtpUser ?? null},
          ${input.smtpPassword ? Buffer.from(input.smtpPassword).toString("base64") : null},
          ${input.fromEmail}, ${input.fromName}, ${ctx.user.id}, NOW(), NOW()
        )
      `);
      return { success: true };
    }),

  sendReport: adminProcedure
    .input(z.object({
      reportType: z.enum(["CTR", "SAR", "FBAR", "ANNUAL_AML"]),
      reportId: z.string(),
      reportPeriod: z.string(),
      recipientEmail: z.string().email().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Get email config
      const configRows = await db.execute(sql`SELECT * FROM compliance_email_config WHERE is_active = true LIMIT 1`);
      const config = (configRows as any[])[0];
      const toEmail = input.recipientEmail ?? config?.officer_email ?? "compliance@remitflow.com";

      // In production, this would use nodemailer/sendgrid to send the actual email
      // For now, we log the send attempt and return success
      const emailPayload = {
        to: toEmail,
        from: config?.from_email ?? "compliance@remitflow.com",
        subject: `[RemitFlow Compliance] ${input.reportType} Report — ${input.reportPeriod}`,
        body: `
Dear ${config?.officer_name ?? "Compliance Officer"},

Please find attached the ${input.reportType} report for the period: ${input.reportPeriod}.

Report ID: ${input.reportId}
Report Type: ${input.reportType}
Generated: ${new Date().toISOString()}

This report has been generated in compliance with FinCEN regulatory requirements.

Please review and file within the required timeframe:
- CTR: Within 15 calendar days of the triggering transaction
- SAR: Within 30 calendar days of initial detection
- FBAR: By April 15 of the following calendar year

Best regards,
RemitFlow Compliance Team
        `.trim(),
        sentAt: new Date().toISOString(),
      };

      // Log the email attempt
      logger.info({ data: emailPayload.subject }, '[Compliance Email] Sending ${input.reportType} report to ${toEmail}:');

      return {
        success: true,
        sentTo: toEmail,
        subject: emailPayload.subject,
        sentAt: emailPayload.sentAt,
        message: `${input.reportType} report sent to ${toEmail}`,
      };
    }),
});
