/**
 * RemitFlow — Bill Capture (OCR) tRPC Router — Wave 10 C3
 *
 * Inbound vendor-bill capture:
 *   - Per-tenant inbound email address (`bills-<token>@remitflow.io`; the
 *     token is stored sha256-hashed ONLY — the plaintext address is shown
 *     once at generation time).
 *   - `inboundEmail` webhook (public + INBOUND_EMAIL_SECRET shared-secret
 *     header, constant-time compared; fail closed when the secret is unset):
 *     MIME allowlist + storage-key sanitization (mirrored from the Wave-9
 *     upload hardening at server/routers.ts:553-607) → store document →
 *     ocr_jobs row (source='email') → Redis `ocr:queue` push (+ `ocr:seen:<sha256>`
 *     SET NX idempotency) → python bill-capture service POST /extract.
 *   - FAIL CLOSED: when BILL_CAPTURE_URL / INTERNAL_SERVICE_KEY are unset the
 *     job stays 'queued' and the response honestly says accepted-not-processed.
 *   - confidence < OCR_MIN_CONFIDENCE (default 0.8) → status 'review', else
 *     'extracted'. OCR fields are NEVER auto-applied onto a vendor bill —
 *     `confirmExtraction` applies human-confirmed fields via a guarded
 *     UPDATE ... WHERE status='captured' row-count check.
 *
 * Exports `enqueueOcrJob(billId, storageKey)` for C1's
 * vendorBills.uploadDocument (job source='upload' linked to the bill).
 */

import { z } from "zod";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { getDb } from "../db";
import { logger } from "../_core/logger";
import { storagePut, storageGet } from "../storage";
import { getRedisConnection } from "../middleware/redisHardened";
import { publishEvent } from "../middleware/kafka.js";
import { fluvioProduce, FluvioError } from "../integrations/fluvio/streaming";
import { resolveTenantContext } from "../tenantMiddleware";
import { ocrJobs, tenants, vendorBills, vendors } from "../../drizzle/schema";

// ── Config (fail closed) ──────────────────────────────────────────────────────
const BILL_CAPTURE_URL = process.env.BILL_CAPTURE_URL; // python-bill-capture (:8112)
const INBOUND_EMAIL_SECRET = process.env.INBOUND_EMAIL_SECRET;
const OCR_MIN_CONFIDENCE = (() => {
  const raw = parseFloat(process.env.OCR_MIN_CONFIDENCE ?? "0.8");
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.8;
})();
const INBOUND_DOMAIN = "remitflow.io";
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024; // 20 MiB decoded
const OCR_SEEN_TTL_SECONDS = 7 * 24 * 3600;

const KAFKA_TOPIC_VENDOR_BILLS = "remitflow.vendor-bills";
const FLUVIO_TOPIC_INBOUND = "bill-capture-inbound";

// ─── Upload MIME allowlist + storage-key hygiene ─────────────────────────────
// Mirrored from the Wave-9 hardening at server/routers.ts:553-607 (those
// helpers are module-private there). Only pdf/jpg/jpeg/png/webp; keys are
// sanitized to [a-zA-Z0-9._-] with directory components dropped.
type UploadExt = "pdf" | "jpg" | "png" | "webp";
const UPLOAD_EXT_BY_MIME: Record<string, UploadExt> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const UPLOAD_ALLOWED_EXTS = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);

function resolveUploadExt(mimeType: string): UploadExt {
  const ext = UPLOAD_EXT_BY_MIME[mimeType.toLowerCase().trim()];
  if (!ext) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported file type — only PDF, JPG, PNG, or WebP uploads are allowed" });
  }
  return ext;
}

function assertUploadAllowed(mimeType: string, fileName: string): void {
  resolveUploadExt(mimeType); // throws on disallowed MIME
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

function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Constant-time string compare that does not leak length (hash both sides). */
function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

/** Resolve the caller's tenant, failing closed when none can be resolved. */
async function requireTenantId(userId: number): Promise<number> {
  const tenant = await resolveTenantContext(userId);
  if (tenant.tenantId == null) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No tenant context for user — bill capture is tenant-scoped" });
  }
  return tenant.tenantId;
}

type ExtractionOutcome = {
  processed: boolean;
  status: "queued" | "extracted" | "review" | "failed";
  confidence?: number;
  reason?: string;
};

/**
 * Call the python bill-capture service and settle the ocr_jobs row.
 * FAIL CLOSED: when BILL_CAPTURE_URL or INTERNAL_SERVICE_KEY is unset, the
 * service is unreachable, or it reports `unconfigured`, the job stays
 * 'queued' and processed=false is returned — never a fabricated extraction.
 * NEVER writes to vendor_bills.
 */
async function runExtractionForJob(args: {
  jobId: number;
  tenantId: number;
  storageKey: string;
  documentBase64: string;
}): Promise<ExtractionOutcome> {
  const { jobId, tenantId, storageKey, documentBase64 } = args;
  const serviceKey = process.env.INTERNAL_SERVICE_KEY;
  if (!BILL_CAPTURE_URL || !serviceKey) {
    logger.warn({ jobId }, "[BillCapture] BILL_CAPTURE_URL/INTERNAL_SERVICE_KEY unset — OCR job left queued (fail closed)");
    return { processed: false, status: "queued", reason: "bill-capture service not configured" };
  }

  const db = await requireDb();
  const setJob = async (status: string, extra: Record<string, unknown> = {}) =>
    db.update(ocrJobs)
      .set({ status, updatedAt: new Date(), ...extra })
      .where(and(eq(ocrJobs.id, jobId), eq(ocrJobs.tenantId, tenantId)));

  await setJob("processing");

  let resp: Response;
  try {
    resp = await fetch(`${BILL_CAPTURE_URL.replace(/\/+$/, "")}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Service-Key": serviceKey },
      body: JSON.stringify({ storageKey, documentBase64 }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    // Network/timeout — retryable: leave the job queued for the worker.
    await setJob("queued");
    logger.warn({ jobId, errMsg: (err as Error).message }, "[BillCapture] bill-capture service unreachable — job left queued");
    return { processed: false, status: "queued", reason: "service unreachable" };
  }

  const body = await resp.json().catch(() => null) as any;

  if (resp.status === 401 || resp.status === 503) {
    // Auth/config failure on the python side — retryable, leave queued.
    await setJob("queued");
    logger.warn({ jobId, httpStatus: resp.status }, "[BillCapture] bill-capture service rejected call — job left queued");
    return { processed: false, status: "queued", reason: `service returned ${resp.status}` };
  }

  if (body?.status === "unconfigured") {
    await setJob("queued");
    logger.warn({ jobId, reason: body?.reason }, "[BillCapture] OCR engine unconfigured — job left queued");
    return { processed: false, status: "queued", reason: body?.reason ?? "ocr engine unconfigured" };
  }

  if (!resp.ok || body?.status !== "extracted") {
    const message = typeof body?.error === "string" ? body.error.slice(0, 500) : `HTTP ${resp.status}`;
    await setJob("failed", { error: message });
    return { processed: true, status: "failed", reason: message };
  }

  const confidence = typeof body.confidence === "number" ? body.confidence : 0;
  const finalStatus = confidence < OCR_MIN_CONFIDENCE ? "review" : "extracted";
  await setJob(finalStatus, {
    result: {
      fields: body.fields ?? null,
      engine: body.engine ?? null,
      ocrConfidenceAvg: body.ocrConfidenceAvg ?? null,
      documentSha256: body.documentSha256 ?? null,
    },
    confidence: confidence.toFixed(4),
  });
  return { processed: true, status: finalStatus as "extracted" | "review", confidence };
}

/**
 * Exported for C1's vendorBills.uploadDocument: create an OCR job
 * (source='upload') linked to an existing vendor bill, push the Redis queue,
 * and attempt inline extraction (fail closed → job stays queued).
 */
export async function enqueueOcrJob(billId: number, storageKey: string): Promise<{
  jobId: number;
  status: "queued" | "extracted" | "review" | "failed";
  processed: boolean;
}> {
  const db = await requireDb();
  const [bill] = await db.select().from(vendorBills).where(eq(vendorBills.id, billId)).limit(1);
  if (!bill) throw new Error(`enqueueOcrJob: vendor_bills id=${billId} not found — refusing to queue orphan OCR job`);

  const [job] = await db.insert(ocrJobs).values({
    tenantId: bill.tenantId,
    storageKey,
    source: "upload",
    status: "queued",
    billId,
  }).returning({ id: ocrJobs.id });

  const queuePayload = JSON.stringify({ jobId: job.id, tenantId: bill.tenantId, storageKey, source: "upload", billId });
  try {
    const redis = await getRedisConnection();
    await redis.lpush("ocr:queue", queuePayload);
  } catch (err) {
    // The ocr_jobs row is the durable queue; Redis is the wake-up mechanism.
    logger.warn({ jobId: job.id, errMsg: (err as Error).message }, "[BillCapture] Redis ocr:queue push failed — job remains queued in DB");
  }

  // Fetch the document bytes back from storage for inline extraction. Any
  // failure leaves the job queued (fail closed) for a later worker pass.
  let documentBase64: string | null = null;
  try {
    const { url } = await storageGet(storageKey);
    const docResp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (docResp.ok) {
      const buf = Buffer.from(await docResp.arrayBuffer());
      if (buf.length > 0 && buf.length <= MAX_DOCUMENT_BYTES) documentBase64 = buf.toString("base64");
    }
  } catch (err) {
    logger.warn({ jobId: job.id, errMsg: (err as Error).message }, "[BillCapture] could not fetch document for inline OCR — job left queued");
  }

  if (!documentBase64) return { jobId: job.id, status: "queued", processed: false };

  const outcome = await runExtractionForJob({ jobId: job.id, tenantId: bill.tenantId, storageKey, documentBase64 });
  return { jobId: job.id, status: outcome.status, processed: outcome.processed };
}

// ─── Router ───────────────────────────────────────────────────────────────────
export const billCaptureRouter = createTRPCRouter({

  /**
   * Generate (or rotate) this tenant's inbound bill-capture address.
   * The token is stored sha256-only; the full address is returned ONCE.
   */
  generateInboundAddress: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);

      const token = randomBytes(24).toString("hex");
      const tokenHash = sha256Hex(token);

      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
      const metadata = {
        ...((tenant.metadata as Record<string, unknown>) ?? {}),
        billCapture: {
          ...(((tenant.metadata as any)?.billCapture as Record<string, unknown>) ?? {}),
          inboundTokenHash: tokenHash,
          rotatedAt: new Date().toISOString(),
        },
      };
      await db.update(tenants).set({ metadata, updatedAt: new Date() }).where(eq(tenants.id, tenantId));

      return {
        address: `bills-${token}@${INBOUND_DOMAIN}`,
        tokenStoredAs: "sha256",
        note: "Store this address now — the token is hashed at rest and cannot be shown again. Generating a new address rotates the token and invalidates the old one.",
      };
    }),

  /**
   * Inbound email webhook (public; shared-secret header `x-inbound-email-secret`,
   * constant-time vs INBOUND_EMAIL_SECRET; fail closed when unset).
   */
  inboundEmail: publicProcedure
    .input(z.object({
      to: z.string().min(3).max(320),
      from: z.string().max(320).optional(),
      subject: z.string().max(500).optional(),
      fileName: z.string().min(1).max(255),
      mimeType: z.string().min(3).max(100),
      documentBase64: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!INBOUND_EMAIL_SECRET) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE" as "INTERNAL_SERVER_ERROR", message: "Inbound email webhook is not configured (INBOUND_EMAIL_SECRET unset)" });
      }
      const presentedRaw = (ctx.req as any)?.headers?.["x-inbound-email-secret"];
      const presented = Array.isArray(presentedRaw) ? presentedRaw[0] : presentedRaw;
      if (!presented || !constantTimeEqual(String(presented), INBOUND_EMAIL_SECRET)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid webhook secret" });
      }

      const tokenMatch = input.to.match(/bills-([A-Za-z0-9_-]{8,128})@remitflow\.io/i);
      if (!tokenMatch) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Recipient is not a bill-capture address" });
      }
      const tokenHash = sha256Hex(tokenMatch[1]);

      const db = await requireDb();
      const tenantRows = await db.execute(sql`
        SELECT id FROM tenants
        WHERE metadata->'billCapture'->>'inboundTokenHash' = ${tokenHash}
        LIMIT 1
      `) as any;
      const tenantRow = (tenantRows?.rows ?? tenantRows ?? [])[0];
      if (!tenantRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Unknown inbound bill-capture address" });
      }
      const tenantId = Number(tenantRow.id);

      // Wave-9 allowlist + key sanitization (mirrored helpers above).
      assertUploadAllowed(input.mimeType, input.fileName);

      let docBytes: Buffer;
      try {
        docBytes = Buffer.from(input.documentBase64, "base64");
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "documentBase64 is not valid base64" });
      }
      if (docBytes.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Empty document" });
      if (docBytes.length > MAX_DOCUMENT_BYTES) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Document exceeds 20 MiB limit" });
      const docHash = sha256Hex(docBytes);

      // M8 fix — content-addressed storage, stored BEFORE the dedupe marker.
      // The storage key is derived from the sha256 of the document content, so
      // storagePut of an identical document is naturally idempotent (same
      // bytes → same key → harmless overwrite). Consequences:
      //   1. A storage failure now happens BEFORE `ocr:seen:<hash>` is set, so
      //      the retry is NOT dropped as a duplicate (the old ordering —
      //      SET NX first, storage second — lost the document on storage
      //      failure because the retry was deduped away).
      //   2. If the NX check below loses (genuine duplicate delivery), the
      //      identical blob is already stored at this exact key; the re-put is
      //      an overwrite of identical content and the first delivery's
      //      ocr_jobs row remains authoritative — nothing is orphaned.
      const storageKey = `bill-capture/${tenantId}/${docHash}/${sanitizeStorageKeyPart(input.fileName)}`;
      try {
        await storagePut(storageKey, docBytes, input.mimeType.toLowerCase().trim());
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Document storage unavailable: ${(err as Error).message}` });
      }

      // Idempotency: same document content never creates a second job.
      const redis = await getRedisConnection(); // throws when unavailable (integrity op)
      const seen = await redis.set(`ocr:seen:${docHash}`, String(Date.now()), "EX", OCR_SEEN_TTL_SECONDS, "NX");
      if (seen !== "OK") {
        return { accepted: true, status: "duplicate", docHash, processed: false };
      }

      let job: { id: number };
      try {
        [job] = await db.insert(ocrJobs).values({
          tenantId,
          storageKey,
          source: "email",
          status: "queued",
        }).returning({ id: ocrJobs.id });
      } catch (err) {
        // The marker was claimed but no job exists — release it so a retry can
        // recreate the job (re-storage is idempotent: content-addressed key).
        await redis.del(`ocr:seen:${docHash}`).catch(() => {});
        throw err;
      }

      const queuePayload = JSON.stringify({ jobId: job.id, tenantId, storageKey, source: "email", docHash });
      await redis.lpush("ocr:queue", queuePayload);

      // Best-effort Fluvio mirror (stream consumers/lakehouse); Redis+DB is authoritative.
      try {
        await fluvioProduce(FLUVIO_TOPIC_INBOUND, String(job.id), {
          jobId: job.id, tenantId, storageKey, source: "email", docHash,
          receivedAt: new Date().toISOString(),
        });
      } catch (err) {
        if (!(err instanceof FluvioError && err.code === "BRIDGE_NOT_CONFIGURED")) {
          logger.warn({ jobId: job.id, errMsg: (err as Error).message }, "[BillCapture] Fluvio produce failed (non-fatal)");
        }
      }

      const outcome = await runExtractionForJob({
        jobId: job.id,
        tenantId,
        storageKey,
        documentBase64: docBytes.toString("base64"),
      });

      return {
        accepted: true,
        status: outcome.status,       // queued | extracted | review | failed — never fabricated
        processed: outcome.processed, // false ⇒ accepted-not-processed, job remains queued
        jobId: job.id,
        docHash,
        ...(outcome.confidence !== undefined ? { confidence: outcome.confidence } : {}),
        ...(outcome.reason ? { reason: outcome.reason } : {}),
      };
    }),

  /**
   * Tenant-scoped OCR job status.
   */
  jobStatus: protectedProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const [job] = await db.select().from(ocrJobs)
        .where(and(eq(ocrJobs.id, input.jobId), eq(ocrJobs.tenantId, tenantId)))
        .limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "OCR job not found" });
      return job;
    }),

  /**
   * Recent OCR jobs for the caller's tenant (review queue).
   */
  listJobs: protectedProcedure
    .input(z.object({
      status: z.enum(["queued", "processing", "extracted", "failed", "review"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const conditions = [eq(ocrJobs.tenantId, tenantId)];
      if (input.status) conditions.push(eq(ocrJobs.status, input.status));
      return db.select().from(ocrJobs)
        .where(and(...conditions))
        .orderBy(desc(ocrJobs.createdAt))
        .limit(input.limit);
    }),

  /**
   * Apply HUMAN-CONFIRMED fields onto a vendor bill. Role check: the bill's
   * creator or an admin (TOTP not required — no money moves here). Guarded
   * UPDATE ... WHERE id AND tenant_id AND status='captured' with a row-count
   * check so a bill that has already moved on cannot be clobbered.
   */
  confirmExtraction: protectedProcedure
    .input(z.object({
      billId: z.number().int().positive(),
      ocrJobId: z.number().int().positive().optional(),
      fields: z.object({
        vendorId: z.number().int().positive().optional(),
        billNumber: z.string().min(1).max(128).optional(),
        description: z.string().max(2000).optional(),
        amount: z.number().positive().max(1_000_000_000_000).optional(),
        currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }).refine(f => Object.values(f).some(v => v !== undefined), { message: "At least one field must be provided" }),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);

      const [bill] = await db.select().from(vendorBills)
        .where(and(eq(vendorBills.id, input.billId), eq(vendorBills.tenantId, tenantId)))
        .limit(1);
      if (!bill) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor bill not found" });

      const isAdmin = ctx.user.role === "admin";
      if (!isAdmin && bill.createdBy !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the bill creator or an admin may confirm an extraction" });
      }

      const f = input.fields;

      // H5a fix: a vendorId supplied by the caller must belong to the BILL's
      // tenant — otherwise a cross-tenant vendor id would be written onto the
      // bill (cross-tenant data reference / vendor write). Fail closed.
      if (f.vendorId !== undefined) {
        const [vendor] = await db.select({ id: vendors.id }).from(vendors)
          .where(and(eq(vendors.id, f.vendorId), eq(vendors.tenantId, tenantId)))
          .limit(1);
        if (!vendor) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Vendor does not belong to this tenant — vendorId refused (no fields applied)",
          });
        }
      }

      const setFragments = [sql`updated_at = now()`];
      const appliedFields: string[] = [];
      if (f.vendorId !== undefined)    { setFragments.push(sql`vendor_id = ${f.vendorId}`);            appliedFields.push("vendorId"); }
      if (f.billNumber !== undefined)  { setFragments.push(sql`bill_number = ${f.billNumber}`);        appliedFields.push("billNumber"); }
      if (f.description !== undefined) { setFragments.push(sql`description = ${f.description}`);       appliedFields.push("description"); }
      if (f.amount !== undefined)      { setFragments.push(sql`amount = ${f.amount.toFixed(4)}`);      appliedFields.push("amount"); }
      if (f.currency !== undefined)    { setFragments.push(sql`currency = ${f.currency.toUpperCase()}`); appliedFields.push("currency"); }
      if (f.dueDate !== undefined)     { setFragments.push(sql`due_date = ${new Date(`${f.dueDate}T00:00:00Z`)}`); appliedFields.push("dueDate"); }
      setFragments.push(sql`metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
        ocrConfirmation: {
          confirmedBy: ctx.user.id,
          ocrJobId: input.ocrJobId ?? null,
          appliedFields,
          confirmedAt: new Date().toISOString(),
        },
      })}::jsonb`);

      const result = await db.execute(sql`
        UPDATE vendor_bills
        SET ${sql.join(setFragments, sql`, `)}
        WHERE id = ${input.billId} AND tenant_id = ${tenantId} AND status = 'captured'
        RETURNING id
      `) as any;
      const updatedRows = result?.rows ?? result ?? [];
      if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Bill is no longer in 'captured' status — extraction confirmation refused (no fields applied)",
        });
      }

      await publishEvent(KAFKA_TOPIC_VENDOR_BILLS, String(input.billId), {
        eventType: "bill.captured",
        billId: input.billId,
        tenantId,
        confirmedBy: ctx.user.id,
        ocrJobId: input.ocrJobId ?? null,
        appliedFields,
        timestamp: new Date().toISOString(),
      });

      return { success: true, billId: input.billId, appliedFields };
    }),
});
