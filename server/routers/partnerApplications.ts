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
import { validateFile, type FileValidationResult } from "../_core/serviceRegistry";
import { requireTotpStepUp } from "../_core/totpStepUp";
import { sendPartnerApproval } from "../email";
import { encryptField } from "../_core/secretBox";

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

// W13 (SPEC §5.1): best-effort in-memory rate limiter for the PUBLIC submit
// endpoint (no new deps; rateLimitedProcedure is protected-only). Keyed by
// client IP; 5 submissions per 10 minutes. Fail-closed on excess.
const _submitHits = new Map<string, number[]>();
function submitRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const hits = (_submitHits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= 5) {
    _submitHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  _submitHits.set(ip, hits);
  if (_submitHits.size > 10_000) {
    for (const [k, v] of _submitHits) {
      if (v.every((t) => now - t >= windowMs)) _submitHits.delete(k);
    }
  }
  return true;
}

// W13 (SPEC §5.1 F-T2): tenant membership oracle for partner self-service
// (API keys, webhooks). Caller must be a global admin OR hold a tenant_users
// row for the target tenant. Returns the verified tenantId.
async function assertPartnerTenantMembership(
  db: any,
  userId: number,
  userRole: string,
  tenantId: number,
): Promise<number> {
  if (userRole === "admin") return tenantId;
  const rows = await db.execute(sql`
    SELECT 1 AS ok FROM tenant_users WHERE tenant_id = ${tenantId} AND user_id = ${userId} LIMIT 1
  `);
  if (!(rows as any[]).length) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this tenant" });
  }
  return tenantId;
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
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // W13: best-effort in-memory rate limit (public endpoint; see helper).
      const ip = (ctx as any).req?.ip ?? (ctx as any).req?.socket?.remoteAddress ?? "unknown";
      if (!submitRateLimit(String(ip))) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many submissions — please retry later" });
      }

      // W13 (SPEC §5.1): slug entropy raised to randomBytes(8); base truncated
      // so base + "-" + 16 hex chars never exceeds slug varchar(63).
      const baseSlug = slugify(input.brandName).substring(0, 46) || "partner";
      const uniqueSuffix = randomBytes(8).toString("hex");
      const slug = `${baseSlug}-${uniqueSuffix}`;

      // W13: claim token authorizes later document/SLA/info updates for
      // applicants without a session (replaces the `submitted_by_user_id IS
      // NULL` bypass). Returned ONCE here; stored in claim_token varchar(64).
      const claimToken = randomBytes(32).toString("hex");
      const submittedByUserId = ctx.user?.id ?? null;

      const result = await db.execute(sql`
        INSERT INTO partner_applications (
          company_name, brand_name, slug, application_type,
          contact_name, contact_email, contact_phone, website,
          country, registration_number, tax_id, incorporation_date,
          business_description, expected_monthly_volume, expected_user_count,
          target_corridors, requested_plan,
          has_aml_policy, has_kyc_process, is_regulated, regulatory_licenses,
          primary_color, secondary_color,
          status, submitted_at, claim_token, submitted_by_user_id, created_at, updated_at
        ) VALUES (
          ${input.companyName}, ${input.brandName}, ${slug}, ${input.applicationType},
          ${input.contactName}, ${input.contactEmail}, ${input.contactPhone ?? null}, ${input.website ?? null},
          ${input.country}, ${input.registrationNumber ?? null}, ${input.taxId ?? null}, ${input.incorporationDate ?? null},
          ${input.businessDescription}, ${input.expectedMonthlyVolume ?? null}, ${input.expectedUserCount ?? null},
          ${JSON.stringify(input.targetCorridors)}, ${input.requestedPlan},
          ${input.hasAmlPolicy}, ${input.hasKycProcess}, ${input.isRegulated}, ${JSON.stringify(input.regulatoryLicenses)},
          ${input.primaryColor}, ${input.secondaryColor},
          'submitted', NOW(), ${claimToken}, ${submittedByUserId}, NOW(), NOW()
        ) RETURNING id, slug, status
      `);
      const row = (result as any[])[0];
      return {
        success: true,
        applicationId: row.id,
        slug: row.slug,
        status: "submitted",
        // Shown ONCE — required to manage this application without an account.
        claimToken,
        message: "Your application has been submitted. Our team will review it within 2-3 business days.",
        trackingUrl: `/partner/application/${row.slug}`,
      };
    }),

  // ── Public: Check application status by slug ─────────────────────────────
  // W13 (SPEC §5.1): PII stripped — status + timestamps ONLY. No contact
  // email, no rejection-reason detail, no internal request text.
  checkStatus: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const rows = await db.execute(sql`
        SELECT slug, status, submitted_at, reviewed_at, approved_at, sla_signed_at,
               (additional_info_request IS NOT NULL) AS additional_info_requested
        FROM partner_applications WHERE slug = ${input.slug} LIMIT 1
      `);
      const app = (rows as any[])[0];
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });
      return {
        slug: app.slug,
        status: app.status,
        submittedAt: app.submitted_at,
        reviewedAt: app.reviewed_at,
        approvedAt: app.approved_at,
        slaSignedAt: app.sla_signed_at,
        additionalInfoRequested: !!app.additional_info_requested,
      };
    }),

  // ── Protected: Get my applications ──────────────────────────────────────────
  myApplications: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
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
      // W13: authorizes applicants whose submission has no linked account yet.
      claimToken: z.string().max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const colMap: Record<string, string> = {
        businessRegDocUrl: "business_reg_doc_url",
        amlPolicyDocUrl: "aml_policy_doc_url",
        directorIdDocUrl: "director_id_doc_url",
        bankStatementDocUrl: "bank_statement_doc_url",
      };
      const col = colMap[input.docType];
      if (!col) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid document type" });
      // W9/Q10 (F9-3): the document must pass the file scanner BEFORE its URL
      // is stored. validateFile fails closed (throws when the scanner is
      // unavailable) — any scan failure/unsafe verdict REJECTS the upload.
      let scan: FileValidationResult;
      try {
        scan = await validateFile(input.fileUrl);
      } catch (scanErr: any) {
        logger.warn({ err: scanErr?.message, applicationId: input.applicationId, docType: input.docType }, "[Partner] Document scan failed — upload rejected (fail closed)");
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Document could not be scanned for threats — upload rejected. Please retry later." });
      }
      if (!scan.safe) {
        logger.warn({ applicationId: input.applicationId, docType: input.docType, threats: scan.threats }, "[Partner] Unsafe document rejected");
        throw new TRPCError({ code: "BAD_REQUEST", message: `Document rejected by security scan: ${scan.threats.join(", ") || "unsafe content"}` });
      }
      // W13 (F-T3): ownership = linked account OR valid claim token. The
      // `OR submitted_by_user_id IS NULL` bypass is removed; NULL claim_token
      // never matches (SQL NULL comparison is false) so token-less public
      // rows fail closed.
      const result = await db.execute(sql`
        UPDATE partner_applications
        SET ${sql.raw(col)} = ${input.fileUrl}, submitted_by_user_id = ${ctx.user.id}, updated_at = NOW()
        WHERE id = ${input.applicationId}
          AND (submitted_by_user_id = ${ctx.user.id} OR claim_token = ${input.claimToken ?? null})
        RETURNING id
      `);
      if (!result.length) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found or access denied" });
      return { success: true, updatedAt: new Date().toISOString() };
    }),

  // ── Protected: Sign SLA ──────────────────────────────────────────────────
  signSla: auditedProcedure
    .input(z.object({
      applicationId: z.number().int(),
      slaVersion: z.string().default("v1.0"),
      claimToken: z.string().max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const result = await db.execute(sql`
        UPDATE partner_applications
        SET sla_signed_at = NOW(), sla_version = ${input.slaVersion}, submitted_by_user_id = ${ctx.user.id}, updated_at = NOW()
        WHERE id = ${input.applicationId}
          AND (submitted_by_user_id = ${ctx.user.id} OR claim_token = ${input.claimToken ?? null})
        RETURNING id
      `);
      if (!result.length) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found or access denied" });
      return { success: true, signedAt: new Date().toISOString() };
    }),

  // ── Protected: Provide additional info ──────────────────────────────────
  provideAdditionalInfo: auditedProcedure
    .input(z.object({
      applicationId: z.number().int(),
      response: z.string().min(10),
      claimToken: z.string().max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const result = await db.execute(sql`
        UPDATE partner_applications
        SET status = 'submitted',
            additional_info_provided_at = NOW(),
            submitted_by_user_id = ${ctx.user.id},
            business_description = COALESCE(business_description, '') || E'\n\n[Additional Info]\n' || ${input.response},
            updated_at = NOW()
        WHERE id = ${input.applicationId}
          AND (submitted_by_user_id = ${ctx.user.id} OR claim_token = ${input.claimToken ?? null})
          AND status = 'additional_info_required'
        RETURNING id
      `);
      if (!result.length) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found or not awaiting additional info" });
      return { success: true, updatedAt: new Date().toISOString() };
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
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
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
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const rows = await db.execute(sql`
        SELECT pa.*, u.name as reviewer_name, u2.name as submitter_name
        FROM partner_applications pa
        LEFT JOIN users u ON u.id = pa.reviewed_by
        LEFT JOIN users u2 ON u2.id = pa.submitted_by_user_id
        WHERE pa.id = ${input.id} LIMIT 1
      `);
      const app = (rows as any[])[0];
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
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
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // W13: guarded transition — affected==1 else CONFLICT.
      const res = await db.execute(sql`
        UPDATE partner_applications
        SET status = 'under_review', reviewed_by = ${ctx.user.id}, updated_at = NOW()
        WHERE id = ${input.id} AND status IN ('submitted', 'additional_info_required')
        RETURNING id
      `);
      if (!(res as any[]).length) {
        throw new TRPCError({ code: "CONFLICT", message: "Application is not in a reviewable state (already moved)" });
      }
      return { success: true, updatedAt: new Date().toISOString() };
    }),

  // ── Admin: Approve application ───────────────────────────────────────────
  // W13 (SPEC §5.1 F-13): TOTP step-up + SLA-signed gate + guarded transition
  // + single db.transaction (application→approved, tenants row status 'trial'
  // — activation happens separately after evidence —, tenant_users admin row,
  // users.tenant_id set, invite code linked). Approval email wired honestly:
  // transport failure is audited and reported, never fake-sent.
  approve: auditedAdminProcedure
    .input(z.object({
      id: z.number().int(),
      reviewNotes: z.string().optional(),
      plan: z.enum(["starter", "growth", "enterprise", "white_label"]).optional(),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await requireTotpStepUp(ctx.user.id, input.totpCode, "partner application approval");

      // Get application
      const appRows = await db.execute(sql`SELECT * FROM partner_applications WHERE id = ${input.id} LIMIT 1`);
      const app = (appRows as any[])[0];
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      // Fail closed: SLA must be signed before approval.
      if (!app.sla_signed_at) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "SLA must be signed before approval" });
      }

      const plan = input.plan ?? app.requested_plan;
      const inviteCode = `RF-${randomBytes(4).toString("hex").toUpperCase()}-APPROVED`;

      const { tenantId } = await db.transaction(async (tx: any) => {
        // Guarded single-winner transition FIRST (inside txn so a lost race
        // rolls back any tenant/invite writes).
        const claim = await tx.execute(sql`
          UPDATE partner_applications
          SET status = 'approved', reviewed_by = ${ctx.user.id}, reviewed_at = NOW(),
              approved_at = NOW(), review_notes = ${input.reviewNotes ?? null}, updated_at = NOW()
          WHERE id = ${input.id} AND status IN ('submitted', 'under_review')
          RETURNING id
        `);
        if (!(claim as any[]).length) {
          throw new TRPCError({ code: "CONFLICT", message: "Application is not in an approvable state (already decided)" });
        }

        // Tenant starts as 'trial' — NOT active; tenantsRouter.activate is the
        // only activation path, after evidence.
        const tenantRows = await tx.execute(sql`
          INSERT INTO tenants (slug, name, plan, status, brand_name, support_email, primary_color, secondary_color, logo_url, "createdAt", "updatedAt")
          VALUES (${app.slug}, ${app.company_name}, ${plan}, 'trial',
                  ${app.brand_name}, ${app.contact_email}, ${app.primary_color}, ${app.secondary_color}, ${app.logo_url ?? null},
                  NOW(), NOW())
          RETURNING id
        `);
        const newTenantId = (tenantRows as any[])[0].id;

        // Invite code + link back to the application.
        const inviteRows = await tx.execute(sql`
          INSERT INTO partner_invite_codes (code, description, created_by, max_uses, plan, is_active, "createdAt")
          VALUES (${inviteCode}, ${'Auto-generated for approved application ' + app.slug}, ${ctx.user.id}, 1, ${plan}, true, NOW())
          RETURNING id
        `);
        const inviteCodeId = (inviteRows as any[])[0].id;

        await tx.execute(sql`
          UPDATE partner_applications
          SET tenant_id = ${newTenantId}, invite_code_id = ${inviteCodeId}, updated_at = NOW()
          WHERE id = ${input.id}
        `);

        // Partner admin membership + users.tenant_id (W13 column). Does not
        // clobber an existing different-tenant assignment.
        if (app.submitted_by_user_id != null) {
          await tx.execute(sql`
            INSERT INTO tenant_users (tenant_id, user_id, role, joined_at)
            VALUES (${newTenantId}, ${app.submitted_by_user_id}, 'admin', NOW())
            ON CONFLICT (tenant_id, user_id) DO NOTHING
          `);
          await tx.execute(sql`
            UPDATE users SET tenant_id = ${newTenantId}
            WHERE id = ${app.submitted_by_user_id} AND (tenant_id IS NULL OR tenant_id = ${newTenantId})
          `);
        }

        await tx.execute(sql`
          INSERT INTO partner_application_comments (application_id, author_id, comment, is_internal, created_at)
          VALUES (${input.id}, ${ctx.user.id}, ${`Application approved. Tenant created with ID ${newTenantId} (status: trial). Plan: ${plan}`}, false, NOW())
        `);

        return { tenantId: newTenantId as number };
      });

      // Wire the existing approval email — honest failure handling: a
      // transport failure is logged + audited as a warning comment and
      // reported via emailSent:false. The approval itself stands.
      let emailSent = false;
      let emailError: string | undefined;
      try {
        const emailResult = await sendPartnerApproval({
          to: app.contact_email,
          partnerName: app.company_name,
          contactName: app.contact_name,
          plan,
          inviteCode,
        });
        emailSent = emailResult.success;
        if (!emailResult.success) emailError = emailResult.error ?? "unknown transport error";
      } catch (err: any) {
        emailError = err?.message ?? String(err);
      }
      if (!emailSent) {
        logger.warn({ applicationId: input.id, err: emailError }, "[Partner] Approval email NOT sent — transport unavailable");
        await db.execute(sql`
          INSERT INTO partner_application_comments (application_id, author_id, comment, is_internal, created_at)
          VALUES (${input.id}, ${ctx.user.id}, ${`WARNING: approval email to ${app.contact_email} was NOT sent (${emailError ?? "transport unavailable"}). Invite code must be delivered manually.`}, true, NOW())
        `).catch(() => {});
      }

      return { success: true, tenantId, inviteCode, emailSent, ...(emailError ? { emailError } : {}) };
    }),

  // ── Admin: Reject application ────────────────────────────────────────────
  // W13: TOTP step-up + guarded transition (never from 'approved').
  reject: auditedAdminProcedure
    .input(z.object({
      id: z.number().int(),
      rejectionReason: z.string().min(10),
      reviewNotes: z.string().optional(),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await requireTotpStepUp(ctx.user.id, input.totpCode, "partner application rejection");
      const res = await db.execute(sql`
        UPDATE partner_applications
        SET status = 'rejected', reviewed_by = ${ctx.user.id}, reviewed_at = NOW(),
            rejection_reason = ${input.rejectionReason},
            review_notes = ${input.reviewNotes ?? null}, updated_at = NOW()
        WHERE id = ${input.id} AND status <> 'approved'
        RETURNING id
      `);
      if (!(res as any[]).length) {
        throw new TRPCError({ code: "CONFLICT", message: "Application not found or already approved (approved applications cannot be rejected)" });
      }
      await db.execute(sql`
        INSERT INTO partner_application_comments (application_id, author_id, comment, is_internal, created_at)
        VALUES (${input.id}, ${ctx.user.id}, ${`Application rejected: ${input.rejectionReason}`}, false, NOW())
      `);
      return { success: true, updatedAt: new Date().toISOString() };
    }),

  // ── Admin: Request additional info ──────────────────────────────────────
  requestAdditionalInfo: adminProcedure
    .input(z.object({
      id: z.number().int(),
      request: z.string().min(10),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const res = await db.execute(sql`
        UPDATE partner_applications
        SET status = 'additional_info_required',
            additional_info_request = ${input.request},
            reviewed_by = ${ctx.user.id}, updated_at = NOW()
        WHERE id = ${input.id} AND status IN ('submitted', 'under_review')
        RETURNING id
      `);
      if (!(res as any[]).length) {
        throw new TRPCError({ code: "CONFLICT", message: "Application is not in a state that accepts info requests" });
      }
      await db.execute(sql`
        INSERT INTO partner_application_comments (application_id, author_id, comment, is_internal, created_at)
        VALUES (${input.id}, ${ctx.user.id}, ${`Additional info requested: ${input.request}`}, false, NOW())
      `);
      return { success: true, updatedAt: new Date().toISOString() };
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
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db.execute(sql`
        INSERT INTO partner_application_comments (application_id, author_id, comment, is_internal, created_at)
        VALUES (${input.applicationId}, ${ctx.user.id}, ${input.comment}, ${input.isInternal}, NOW())
      `);
      return { success: true, updatedAt: new Date().toISOString() };
    }),

  // ── Admin: Dashboard stats ───────────────────────────────────────────────
  adminStats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
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
// W13 (SPEC §5.1 F-T2): every proc requires global admin OR a tenant_users
// membership row for the target tenant — these keys authenticate the
// embedded-payouts money API. Production keys additionally require TOTP.
export const partnerApiKeysRouter = router({
  // List keys for a tenant
  list: protectedProcedure
    .input(z.object({ tenantId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertPartnerTenantMembership(db, ctx.user.id, ctx.user.role, input.tenantId);
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
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await assertPartnerTenantMembership(db, ctx.user.id, ctx.user.role, input.tenantId);
      if (input.environment === "production") {
        await requireTotpStepUp(ctx.user.id, input.totpCode, "production partner API key creation");
      }
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
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const keyRows = await db.execute(sql`SELECT id, tenant_id FROM partner_api_keys WHERE id = ${input.keyId} LIMIT 1`);
      const key = (keyRows as any[])[0];
      if (!key) throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
      await assertPartnerTenantMembership(db, ctx.user.id, ctx.user.role, key.tenant_id);
      const res = await db.execute(sql`
        UPDATE partner_api_keys
        SET status = 'revoked', revoked_by = ${ctx.user.id}, revoked_at = NOW()
        WHERE id = ${input.keyId} AND status = 'active'
        RETURNING id
      `);
      if (!(res as any[]).length) {
        throw new TRPCError({ code: "CONFLICT", message: "Key already revoked or expired" });
      }
      return { success: true, updatedAt: new Date().toISOString() };
    }),
});

// ─── Partner Webhooks Router ──────────────────────────────────────────────────
// W13 (SPEC §5.1): all procs are scoped to a tenant the caller actually
// belongs to (tenant_users row) unless they are a global admin.
export const partnerWebhooksRouter = router({
  list: protectedProcedure
    .input(z.object({ tenantId: z.number().int() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const tenantId = await assertPartnerTenantMembership(db, ctx.user.id, ctx.user.role, input.tenantId);
      const rows = await db.execute(sql`
        SELECT id, url, events, is_active, last_delivered_at, failure_count, created_at
        FROM partner_webhooks WHERE tenant_id = ${tenantId} ORDER BY created_at DESC
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
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // W13: membership-verified tenant — a client-supplied tenantId for a
      // tenant the caller does not belong to is rejected (signed events would
      // leak across tenants).
      const tenantId = await assertPartnerTenantMembership(db, ctx.user.id, ctx.user.role, input.tenantId);
      const signingSecret = generateWebhookSecret();
      const whInserted = await db.execute(sql`
        INSERT INTO partner_webhooks (tenant_id, url, events, signing_secret, is_active, failure_count, created_by, created_at, updated_at)
        VALUES (${tenantId}, ${input.url}, ${JSON.stringify(input.events)}, ${signingSecret}, true, 0, ${ctx.user.id}, NOW(), NOW())
        RETURNING id
      `);
      const webhookId = (whInserted as any)[0]?.id ?? 0;
      return { success: true, signingSecret, webhookId };
    }),

  toggle: auditedProcedure
    .input(z.object({ webhookId: z.number().int(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const whRows = await db.execute(sql`SELECT id, tenant_id FROM partner_webhooks WHERE id = ${input.webhookId} LIMIT 1`);
      const wh = (whRows as any[])[0];
      if (!wh) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      await assertPartnerTenantMembership(db, ctx.user.id, ctx.user.role, wh.tenant_id);
      const _res = await db.execute(sql`UPDATE partner_webhooks SET is_active = ${input.isActive}, updated_at = NOW() WHERE id = ${input.webhookId} AND tenant_id = ${wh.tenant_id} RETURNING 1`);

      if (!_res.length) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      return { success: true, updatedAt: new Date().toISOString() };
    }),

  delete: auditedProcedure
    .input(z.object({ webhookId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const whRows = await db.execute(sql`SELECT id, tenant_id FROM partner_webhooks WHERE id = ${input.webhookId} LIMIT 1`);
      const wh = (whRows as any[])[0];
      if (!wh) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      await assertPartnerTenantMembership(db, ctx.user.id, ctx.user.role, wh.tenant_id);
      await db.execute(sql`DELETE FROM partner_webhooks WHERE id = ${input.webhookId} AND tenant_id = ${wh.tenant_id}`);
      return { success: true, updatedAt: new Date().toISOString() };
    }),
});
