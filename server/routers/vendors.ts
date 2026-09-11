/**
 * W10-C5 / SPEC-wave10 — Vendors router (Melio AP vendor management).
 *
 *  - Tenant-scoped CRUD (tenant from resolveTenantContext, never client input).
 *  - TOTP step-up (canonical Wave-7 C2 pattern) on payoutMethod change —
 *    changing where money goes is a money-moving mutation.
 *  - KYB doc registration with the Wave-9 MIME allowlist + storage-key
 *    sanitization (mirrors routers.ts:553-607) + fail-closed malware scan
 *    (validateFile, mirrors partnerApplications.uploadDocument W9/Q10 F9-3).
 *    NOTE: there is no vendor_documents table in the Wave-10 schema (only
 *    bill_documents → vendor_bills), so KYB doc references are stored in
 *    vendors.metadata.kybDocs — schema-real, no fabricated columns.
 *  - Tax fields: tin / whtRate / taxDocStatus (vendors table columns).
 *  - openBalance computed from vendor_bills: SUM(amount) WHERE status NOT IN
 *    ('paid','cancelled','rejected') (SPEC-wave10 C5).
 *  - paymentHistory from vendor_bills status='paid' rows.
 *  - Search-index upserts via server/services/searchIndexer (try/catch warn).
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { auditedProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { vendorBills, vendors, type Vendor } from "../../drizzle/schema";
import { resolveTenantContext } from "../tenantMiddleware";
import { validateFile } from "../_core/serviceRegistry";
import { logger } from "../_core/logger";
import { indexVendor } from "../services/searchIndexer";

// ─── W9 F9-1/F9-2 mirror (routers.ts:553-607): MIME allowlist + key hygiene ──
type UploadExt = "pdf" | "jpg" | "png" | "webp";
const UPLOAD_EXT_BY_MIME: Record<string, UploadExt> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const UPLOAD_ALLOWED_EXTS = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);

function assertUploadAllowed(mimeType: string, fileName: string): void {
  const ext = UPLOAD_EXT_BY_MIME[mimeType.toLowerCase().trim()];
  if (!ext) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported file type — only PDF, JPG, PNG, or WebP uploads are allowed" });
  }
  const nameExt = (fileName.includes(".") ? fileName.split(".").pop()! : "").toLowerCase();
  if (!UPLOAD_ALLOWED_EXTS.has(nameExt)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported file extension — only .pdf, .jpg, .jpeg, .png, or .webp uploads are allowed" });
  }
}

function sanitizeStorageKeyPart(raw: string, maxLen = 80): string {
  // Drop any directory components (path traversal), then whitelist characters.
  const base = raw.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "file";
  const cleaned = base
    .replace(/\.{2,}/g, ".")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, maxLen);
  return cleaned || "file";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireTenantId(userId: number): Promise<number> {
  let tenant;
  try {
    tenant = await resolveTenantContext(userId);
  } catch (err) {
    // Fail closed — never operate with unknown tenant isolation.
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Tenant context resolution failed — request refused (fail-closed)", cause: err as Error });
  }
  if (tenant.tenantId == null) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No tenant associated with your account." });
  }
  return tenant.tenantId;
}

/** Canonical Wave-7 C2 TOTP step-up (fail closed when enrollment lookup is unavailable). */
async function enforceTotpStepUp(userId: number, totpCode: string | undefined, actionLabel: string): Promise<void> {
  const { getTotpEnrollment, verifyTOTP } = await import("../totp");
  const enrollment = await getTotpEnrollment(userId);
  if (!enrollment.dbAvailable) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `2FA verification unavailable — ${actionLabel} blocked` });
  }
  if (enrollment.enabled && enrollment.secret) {
    if (!totpCode) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "2FA code required for this action" });
    }
    const valid = await verifyTOTP(totpCode, enrollment.secret);
    if (!valid) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid 2FA code" });
    }
  }
}

/** SPEC-wave10: open balance = SUM(amount) over bills NOT paid/cancelled/rejected. */
const OPEN_BALANCE_EXCLUDED_STATUSES = ["paid", "cancelled", "rejected"] as const;

async function computeOpenBalance(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, vendorId: number, tenantId: number): Promise<string> {
  // H5b (audit): tenant-filtered — vendor_bills.vendor_id alone is NOT a
  // tenant boundary; without tenant_id this leaked other tenants' bill totals.
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(CAST(${vendorBills.amount} AS NUMERIC)), 0)` })
    .from(vendorBills)
    .where(and(
      eq(vendorBills.vendorId, vendorId),
      eq(vendorBills.tenantId, tenantId),
      notInArray(vendorBills.status, [...OPEN_BALANCE_EXCLUDED_STATUSES]),
    ));
  return row?.total ?? "0";
}

function tryIndexVendor(vendor: Vendor): void {
  // Search is non-critical — indexing failures must never break the request.
  indexVendor(vendor as unknown as Record<string, unknown> & { id: number; tenantId: number }).catch((err) =>
    logger.warn({ err: err instanceof Error ? err.message : String(err), vendorId: vendor.id }, "[Vendors] OpenSearch index failed (fail-soft)"),
  );
}

// M5 (audit): canonical payout-method contract {rail, payeeFspId, payeeMsisdn}
// — this is what vendorBills.resolvePayout consumes. Rows written before the
// contract was aligned used {type, fspId, msisdn}; those stay READABLE via
// dual-read in vendorBills.resolvePayout / embeddedPayouts (never break
// existing data), but all NEW writes are validated against the canonical keys.
const payoutMethodSchema = z.object({
  rail: z.enum(["bank", "mobile_money", "stablecoin", "mojaloop"]),
  payeeFspId: z.string().max(64).optional(),
  payeeMsisdn: z.string().max(32).optional(),
  accountNumber: z.string().max(64).optional(),
  bankCode: z.string().max(32).optional(),
  routingNumber: z.string().max(32).optional(),
  walletAddress: z.string().max(128).optional(),
  currency: z.string().length(3).optional(),
}).passthrough();

const taxDocStatusSchema = z.enum(["none", "requested", "received", "verified"]);

// ─── Router ───────────────────────────────────────────────────────────────────
export const vendorsRouter = router({
  create: auditedProcedure
    .input(z.object({
      legalName: z.string().min(2).max(255),
      displayName: z.string().max(255).optional(),
      country: z.string().length(2),
      currency: z.string().length(3),
      payoutMethod: payoutMethodSchema.optional(),
      tin: z.string().max(64).optional(),
      whtRate: z.number().min(0).max(1).optional(),
      taxDocStatus: taxDocStatusSchema.optional(),
      metadata: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const tenantId = await requireTenantId(ctx.user.id);
      const [vendor] = await db.insert(vendors).values({
        tenantId,
        ownerUserId: ctx.user.id,
        legalName: input.legalName,
        displayName: input.displayName ?? null,
        country: input.country.toUpperCase(),
        currency: input.currency.toUpperCase(),
        payoutMethod: input.payoutMethod ?? {},
        kybStatus: "unverified",
        tin: input.tin ?? null,
        whtRate: input.whtRate != null ? input.whtRate.toFixed(4) : null,
        taxDocStatus: input.taxDocStatus ?? "none",
        metadata: input.metadata ?? {},
      }).returning();
      tryIndexVendor(vendor);
      return { success: true, verified: true, vendor };
    }),

  list: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      kybStatus: z.string().max(32).optional(),
      includeDeactivated: z.boolean().default(false),
      search: z.string().max(128).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const tenantId = await requireTenantId(ctx.user.id);
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;
      const conds = [eq(vendors.tenantId, tenantId)];
      if (input?.kybStatus) conds.push(eq(vendors.kybStatus, input.kybStatus));
      if (!input?.includeDeactivated) conds.push(ne(vendors.kybStatus, "deactivated"));
      if (input?.search?.trim()) {
        const p = `%${input.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        conds.push(sql`(${vendors.legalName} ILIKE ${p} OR ${vendors.displayName} ILIKE ${p})`);
      }
      const rows = await db
        .select({
          vendor: vendors,
          // H5b (audit): tenant-filtered subquery (b.tenant_id = this tenant).
          openBalance: sql<string>`COALESCE((
            SELECT SUM(CAST(b.amount AS NUMERIC)) FROM vendor_bills b
            WHERE b.vendor_id = ${vendors.id} AND b.tenant_id = ${tenantId} AND b.status NOT IN ('paid','cancelled','rejected')
          ), 0)`,
        })
        .from(vendors)
        .where(and(...conds))
        .orderBy(desc(vendors.updatedAt))
        .limit(limit)
        .offset(offset);
      return rows.map((r) => ({ ...r.vendor, openBalance: r.openBalance }));
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const tenantId = await requireTenantId(ctx.user.id);
      const [vendor] = await db.select().from(vendors)
        .where(and(eq(vendors.id, input.id), eq(vendors.tenantId, tenantId))).limit(1);
      if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      const openBalance = await computeOpenBalance(db, vendor.id, tenantId);
      return { ...vendor, openBalance };
    }),

  update: auditedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      legalName: z.string().min(2).max(255).optional(),
      displayName: z.string().max(255).nullable().optional(),
      country: z.string().length(2).optional(),
      currency: z.string().length(3).optional(),
      payoutMethod: payoutMethodSchema.optional(),
      tin: z.string().max(64).nullable().optional(),
      whtRate: z.number().min(0).max(1).nullable().optional(),
      taxDocStatus: taxDocStatusSchema.optional(),
      metadata: z.record(z.unknown()).optional(),
      totpCode: z.string().regex(/^\d{6}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const tenantId = await requireTenantId(ctx.user.id);
      const [existing] = await db.select().from(vendors)
        .where(and(eq(vendors.id, input.id), eq(vendors.tenantId, tenantId))).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      if (existing.kybStatus === "deactivated") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Vendor is deactivated" });
      }

      // TOTP step-up on payout-method change (SPEC-wave10 C5) — changing where
      // money is paid out is a money-moving mutation.
      const payoutMethodChanged = input.payoutMethod !== undefined
        && JSON.stringify(input.payoutMethod) !== JSON.stringify(existing.payoutMethod ?? {});
      if (payoutMethodChanged) {
        await enforceTotpStepUp(ctx.user.id, input.totpCode, "payout method change");
      }

      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.legalName !== undefined) set.legalName = input.legalName;
      if (input.displayName !== undefined) set.displayName = input.displayName;
      if (input.country !== undefined) set.country = input.country.toUpperCase();
      if (input.currency !== undefined) set.currency = input.currency.toUpperCase();
      if (input.payoutMethod !== undefined) set.payoutMethod = input.payoutMethod;
      if (input.tin !== undefined) set.tin = input.tin;
      if (input.whtRate !== undefined) set.whtRate = input.whtRate == null ? null : input.whtRate.toFixed(4);
      if (input.taxDocStatus !== undefined) set.taxDocStatus = input.taxDocStatus;
      if (input.metadata !== undefined) set.metadata = { ...(existing.metadata as Record<string, unknown> ?? {}), ...input.metadata };

      const [updated] = await db.update(vendors).set(set)
        .where(and(eq(vendors.id, input.id), eq(vendors.tenantId, tenantId)))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      tryIndexVendor(updated);
      return { success: true, verified: true, vendor: updated, payoutMethodChanged };
    }),

  deactivate: auditedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const tenantId = await requireTenantId(ctx.user.id);
      // Guarded: only deactivate a live vendor (idempotent-safe, no fabricated state).
      const [updated] = await db.update(vendors)
        .set({ kybStatus: "deactivated", updatedAt: new Date() })
        .where(and(eq(vendors.id, input.id), eq(vendors.tenantId, tenantId), ne(vendors.kybStatus, "deactivated")))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found or already deactivated" });
      tryIndexVendor(updated);
      return { success: true, verified: true, vendor: updated };
    }),

  /**
   * Register a KYB document for a vendor. Wave-9 MIME allowlist + storage-key
   * sanitization + fail-closed malware scan before the reference is stored.
   * Storage: vendors.metadata.kybDocs[] (no vendor_documents table exists).
   */
  uploadKybDoc: auditedProcedure
    .input(z.object({
      vendorId: z.number().int().positive(),
      fileName: z.string().min(1).max(255),
      mimeType: z.string().min(3).max(64),
      storageKey: z.string().min(1).max(512),
      docType: z.enum(["business_registration", "tax_certificate", "ownership_proof", "bank_letter", "other"]).default("other"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const tenantId = await requireTenantId(ctx.user.id);
      assertUploadAllowed(input.mimeType, input.fileName);
      const safeFileName = sanitizeStorageKeyPart(input.fileName);
      const safeKey = sanitizeStorageKeyPart(input.storageKey, 200);

      const [vendor] = await db.select().from(vendors)
        .where(and(eq(vendors.id, input.vendorId), eq(vendors.tenantId, tenantId))).limit(1);
      if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      if (vendor.kybStatus === "deactivated") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Vendor is deactivated" });
      }

      // W9/Q10 (F9-3) mirror: the document must pass the scanner BEFORE its
      // reference is stored. validateFile fails closed — any scan failure or
      // unsafe verdict REJECTS the upload.
      const fileUrl = `storage://${safeKey}`;
      try {
        const scan = await validateFile(fileUrl);
        if (!scan.safe) {
          logger.warn({ vendorId: input.vendorId, threats: scan.threats }, "[Vendors] Unsafe KYB document rejected");
          throw new TRPCError({ code: "BAD_REQUEST", message: `Document rejected by security scan: ${scan.threats.join(", ") || "unsafe content"}` });
        }
      } catch (scanErr) {
        if (scanErr instanceof TRPCError) throw scanErr;
        logger.warn({ err: scanErr instanceof Error ? scanErr.message : String(scanErr), vendorId: input.vendorId }, "[Vendors] KYB document scan failed — upload rejected (fail closed)");
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Document could not be scanned for threats — upload rejected. Please retry later." });
      }

      const metadata = (vendor.metadata ?? {}) as Record<string, unknown>;
      const kybDocs = Array.isArray(metadata.kybDocs) ? [...metadata.kybDocs as unknown[]] : [];
      const docRef = {
        docType: input.docType,
        fileName: safeFileName,
        mime: input.mimeType.toLowerCase().trim(),
        storageKey: safeKey,
        uploadedBy: ctx.user.id,
        uploadedAt: new Date().toISOString(),
      };
      kybDocs.push(docRef);
      // First KYB doc moves the vendor into review; never auto-verify.
      const nextKybStatus = vendor.kybStatus === "unverified" ? "pending_review" : vendor.kybStatus;
      const [updated] = await db.update(vendors)
        .set({ metadata: { ...metadata, kybDocs }, kybStatus: nextKybStatus, updatedAt: new Date() })
        .where(and(eq(vendors.id, input.vendorId), eq(vendors.tenantId, tenantId)))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      tryIndexVendor(updated);
      return { success: true, verified: true, doc: docRef, kybStatus: updated.kybStatus };
    }),

  openBalance: protectedProcedure
    .input(z.object({ vendorId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const tenantId = await requireTenantId(ctx.user.id);
      const [vendor] = await db.select({ id: vendors.id, currency: vendors.currency }).from(vendors)
        .where(and(eq(vendors.id, input.vendorId), eq(vendors.tenantId, tenantId))).limit(1);
      if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      const openBalance = await computeOpenBalance(db, vendor.id, tenantId);
      return { vendorId: vendor.id, currency: vendor.currency, openBalance, excludedStatuses: [...OPEN_BALANCE_EXCLUDED_STATUSES] };
    }),

  paymentHistory: protectedProcedure
    .input(z.object({
      vendorId: z.number().int().positive(),
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const tenantId = await requireTenantId(ctx.user.id);
      const [vendor] = await db.select({ id: vendors.id }).from(vendors)
        .where(and(eq(vendors.id, input.vendorId), eq(vendors.tenantId, tenantId))).limit(1);
      if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      const rows = await db.select({
        id: vendorBills.id,
        billNumber: vendorBills.billNumber,
        amount: vendorBills.amount,
        currency: vendorBills.currency,
        status: vendorBills.status,
        paymentRail: vendorBills.paymentRail,
        paymentRef: vendorBills.paymentRef,
        speedTier: vendorBills.speedTier,
        paidAt: vendorBills.paidAt,
      }).from(vendorBills)
        .where(and(eq(vendorBills.vendorId, input.vendorId), eq(vendorBills.tenantId, tenantId), eq(vendorBills.status, "paid")))
        .orderBy(desc(vendorBills.paidAt))
        .limit(input.limit)
        .offset(input.offset);
      return rows;
    }),
});
