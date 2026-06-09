import { router, protectedProcedure } from "../_core/trpc";
import { createAuditLog } from "../audit.service";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { smeTradeBatches, smeTradePayments, formMDocuments } from "../../drizzle/schema";
import { eq, desc, and, gte, lte, like, sql, count } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { logger } from '../_core/logger';

const SME_TRADE_URL = process.env.SME_TRADE_URL ?? "http://go-sme-trade-service:8097";
const SME_COMPLIANCE_URL = process.env.SME_COMPLIANCE_URL ?? "http://python-sme-compliance:8102";

async function callSmeService(baseUrl: string, path: string, body?: object) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "Service error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `SME service error: ${err}` });
  }
  return res.json();
}

const paymentSchema = z.object({
  recipientName: z.string().min(2).max(200),
  recipientAccount: z.string().min(8).max(34),
  recipientSwift: z.string().min(8).max(11),
  recipientBank: z.string().min(2).max(200),
  amountUsd: z.number().positive().max(1_000_000),
  reference: z.string().min(2).max(100),
  invoiceNumber: z.string().optional(),
  goodsDescription: z.string().optional(),
});

export const smeTradeRouter = router({
  getSmeCorridorRates: protectedProcedure.query(async () => {
    try {
      return await callSmeService(SME_TRADE_URL, "/rates");
    } catch {
      return {
        corridors: [
          { code: "CN", name: "China", currency: "CNY", fee_bps: 120, min_amount_usd: 1000, max_amount_usd: 500000, form_m_threshold_usd: 10000 },
          { code: "AE", name: "UAE", currency: "AED", fee_bps: 100, min_amount_usd: 500, max_amount_usd: 500000, form_m_threshold_usd: 10000 },
          { code: "IN", name: "India", currency: "INR", fee_bps: 90, min_amount_usd: 500, max_amount_usd: 500000, form_m_threshold_usd: 10000 },
          { code: "GB", name: "United Kingdom", currency: "GBP", fee_bps: 80, min_amount_usd: 1000, max_amount_usd: 1000000, form_m_threshold_usd: 10000 },
          { code: "US", name: "United States", currency: "USD", fee_bps: 75, min_amount_usd: 1000, max_amount_usd: 1000000, form_m_threshold_usd: 10000 },
        ],
        source: "fallback",
      };
    }
  }),

  validateFormM: protectedProcedure
    .input(z.object({
      formMNumber: z.string().min(10).max(30),
      corridorCode: z.string().length(2),
      valueUsd: z.number().positive(),
      importerName: z.string().min(2).max(200).optional(),
      exporterName: z.string().min(2).max(200).optional(),
      goodsDescription: z.string().min(5).max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const FORM_M_THRESHOLD_USD = 10_000;

      // 1. Enforce CBN Form M threshold — reject early if below threshold
      if (input.valueUsd < FORM_M_THRESHOLD_USD) {
        return {
          formMNumber: input.formMNumber,
          isValid: false,
          errors: [`Form M is only required for trade payments >= USD ${FORM_M_THRESHOLD_USD.toLocaleString()}. Current value: USD ${input.valueUsd.toLocaleString()}`],
          warnings: [],
          cbnReference: null,
          formMRequired: false,
          validatedAt: new Date().toISOString(),
          source: "local_threshold_check",
        };
      }

      // 2. Call the python-sme-compliance service
      let serviceResult: Record<string, unknown>;
      let validationSource = "sme_compliance_service";
      try {
        serviceResult = await callSmeService(SME_COMPLIANCE_URL, "/validate-form-m", {
          form_m_number: input.formMNumber,
          corridor_code: input.corridorCode,
          value_usd: input.valueUsd,
          importer_name: input.importerName ?? ctx.user.name ?? "Unknown Importer",
          exporter_name: input.exporterName ?? "Unknown Exporter",
          goods_description: input.goodsDescription ?? "",
        });
      } catch (err) {
        // 3. Graceful fallback: local CBN Form M format validation
        validationSource = "local_fallback";
        const errors: string[] = [];
        const warnings: string[] = [];

        // CBN Form M number format: FM + year (2 digits) + 6-digit sequence, e.g. FM240001234
        const formMPattern = /^FM\d{2}\d{4,10}$/;
        if (!formMPattern.test(input.formMNumber)) {
          errors.push(`Form M number '${input.formMNumber}' does not match CBN format (FM + 2-digit year + sequence, e.g. FM240001234)`);
        }
        if (!input.goodsDescription || input.goodsDescription.length < 10) {
          warnings.push("Goods description is very brief — may be rejected by CBN");
        }
        const supportedCorridors = ["CN", "AE", "IN", "GB", "US", "DE", "FR", "CA"];
        if (!supportedCorridors.includes(input.corridorCode)) {
          errors.push(`Corridor '${input.corridorCode}' is not in the approved CBN trade corridors list`);
        }
        const isValid = errors.length === 0;
        serviceResult = {
          form_m_number: input.formMNumber,
          is_valid: isValid,
          errors,
          warnings,
          cbn_reference: isValid ? `CBN-FM-FALLBACK-${Date.now()}` : null,
          validated_at: new Date().toISOString(),
        };
      }

      // 4. Persist validation result to form_m_documents for audit trail
      try {
        const db = await getDb();
        await db.insert(formMDocuments).values({
          userId: ctx.user.id,
          formType: "Form_M",
          formNumber: input.formMNumber,
          cbnPortalRef: (serviceResult.cbn_reference as string) ?? null,
          validityDate: serviceResult.is_valid ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) : null, // 90 days validity
          pythonValidationResult: {
            ...serviceResult,
            validation_source: validationSource,
            corridor_code: input.corridorCode,
            value_usd: input.valueUsd,
            validated_by_user: ctx.user.id,
          },
          status: serviceResult.is_valid ? "validated" : "rejected",
          createdAt: new Date(),
        });
      } catch (dbErr) {
        // Non-fatal: log but don't block the response
        logger.error({ err: dbErr }, '[validateFormM] Failed to persist to form_m_documents:');
      }

      // 5. Return normalised response
      return {
        formMNumber: input.formMNumber,
        isValid: serviceResult.is_valid as boolean,
        errors: (serviceResult.errors as string[]) ?? [],
        warnings: (serviceResult.warnings as string[]) ?? [],
        cbnReference: serviceResult.cbn_reference as string | null,
        formMRequired: true,
        validatedAt: serviceResult.validated_at as string ?? new Date().toISOString(),
        source: validationSource,
      };
    }),

  submitBatch: protectedProcedure
    .input(z.object({
      corridorCode: z.string().length(2),
      payments: z.array(paymentSchema).min(1).max(500),
      formMNumber: z.string().optional(),
      batchReference: z.string().min(2).max(100).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const totalAmountUsd = input.payments.reduce((s, p) => s + p.amountUsd, 0);
      const db = await getDb();
      const batchId = `SME-${Date.now()}-${ctx.user.id}`;

      // Create batch record
      await db.insert(smeTradeBatches).values({
        batchId,
        userId: ctx.user.id,
        corridorCode: input.corridorCode,
        totalPayments: input.payments.length,
        totalAmountUsd: totalAmountUsd.toFixed(2),
        formMNumber: input.formMNumber,
        batchReference: input.batchReference,
        status: "processing",
        createdAt: new Date(),
      });

      // Submit to Go SME trade service
      const result = await callSmeService(SME_TRADE_URL, "/batch", {
        batch_id: batchId,
        user_id: ctx.user.id,
        corridor_code: input.corridorCode,
        payments: input.payments,
        form_m_number: input.formMNumber,
        total_amount_usd: totalAmountUsd,
      });

      // Update batch status
      await db.update(smeTradeBatches)
        .set({
          status: result.status ?? "processing",
          succeeded: result.succeeded ?? 0,
          failed: result.failed ?? 0,
        })
        .where(eq(smeTradeBatches.batchId, batchId)).returning();

      return { ...result, batchId };
    }),

  getBatchStatus: protectedProcedure
    .input(z.object({ batchId: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      const [batch] = await db.select().from(smeTradeBatches)
        .where(eq(smeTradeBatches.batchId, input.batchId));
      if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Batch not found" });
      if (batch.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }
      return batch;
    }),

  getBatchHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      return db.select().from(smeTradeBatches)
        .where(eq(smeTradeBatches.userId, ctx.user.id))
        .orderBy(desc(smeTradeBatches.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  getComplianceReport: protectedProcedure
    .input(z.object({ batchId: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      const [batch] = await db.select().from(smeTradeBatches)
        .where(eq(smeTradeBatches.batchId, input.batchId));
      if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Batch not found" });
      if (batch.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }
      try {
        return await callSmeService(SME_COMPLIANCE_URL, `/report/${input.batchId}`);
      } catch {
        return { batchId: input.batchId, status: batch.status, message: "Compliance report not yet available" };
      }
    }),

  // ── User-scoped Form M validation history ──────────────────────────────────
  listFormMHistory: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
      status: z.enum(["pending", "validated", "approved", "rejected", "all"]).default("all"),
      search: z.string().max(100).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const conditions = [eq(formMDocuments.userId, ctx.user.id)];
      if (input.status !== "all") {
        conditions.push(eq(formMDocuments.status, input.status));
      }
      if (input.search) {
        conditions.push(like(formMDocuments.formNumber, `%${input.search}%`));
      }
      const [rows, [{ total }]] = await Promise.all([
        db.select().from(formMDocuments)
          .where(and(...conditions))
          .orderBy(desc(formMDocuments.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ total: count() }).from(formMDocuments).where(and(...conditions)),
      ]);
      return { rows, total: Number(total), limit: input.limit, offset: input.offset };
    }),

  // ── Admin: all Form M documents across all users ────────────────────────────
  listFormMDocumentsAdmin: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
      status: z.enum(["pending", "validated", "approved", "rejected", "all"]).default("all"),
      search: z.string().max(100).optional(),
      userId: z.number().int().optional(),
      expiringWithinDays: z.number().int().min(1).max(365).optional(),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const db = await getDb();
      const conditions: ReturnType<typeof eq>[] = [];
      if (input.status !== "all") {
        conditions.push(eq(formMDocuments.status, input.status) as any);
      }
      if (input.userId) {
        conditions.push(eq(formMDocuments.userId, input.userId) as any);
      }
      if (input.search) {
        conditions.push(like(formMDocuments.formNumber, `%${input.search}%`) as any);
      }
      if (input.expiringWithinDays) {
        const cutoff = new Date(Date.now() + input.expiringWithinDays * 24 * 60 * 60 * 1000);
        conditions.push(lte(formMDocuments.validityDate, cutoff) as any);
        conditions.push(gte(formMDocuments.validityDate, new Date()) as any);
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const [rows, [{ total }]] = await Promise.all([
        db.select({
          id: formMDocuments.id,
          userId: formMDocuments.userId,
          formType: formMDocuments.formType,
          formNumber: formMDocuments.formNumber,
          cbnPortalRef: formMDocuments.cbnPortalRef,
          validityDate: formMDocuments.validityDate,
          status: formMDocuments.status,
          createdAt: formMDocuments.createdAt,
          pythonValidationResult: formMDocuments.pythonValidationResult,
          userName: users.name,
          userEmail: users.email,
        })
          .from(formMDocuments)
          .leftJoin(users, eq(formMDocuments.userId, users.id))
          .where(whereClause)
          .orderBy(desc(formMDocuments.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ total: count() }).from(formMDocuments).where(whereClause),
      ]);
      return { rows, total: Number(total), limit: input.limit, offset: input.offset };
    }),

  // ── Admin: update Form M document status ───────────────────────────────────
  updateFormMStatus: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      status: z.enum(["pending", "validated", "approved", "rejected"]),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const db = await getDb();
      const [doc] = await db.select().from(formMDocuments).where(eq(formMDocuments.id, input.id));
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Form M document not found" });
      const [updated] = await db.update(formMDocuments)
        .set({
          status: input.status,
          pythonValidationResult: {
            ...(doc.pythonValidationResult as Record<string, unknown> ?? {}),
            compliance_review: {
              reviewed_by: ctx.user.id,
              reviewed_at: new Date().toISOString(),
              new_status: input.status,
              note: input.note ?? null,
            },
          },
        })
        .where(eq(formMDocuments.id, input.id))
        .returning();
      return updated;
    }),

  // ── Get single Form M document detail ──────────────────────────────────────
  getFormMDocument: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [doc] = await db.select({
        id: formMDocuments.id,
        userId: formMDocuments.userId,
        formType: formMDocuments.formType,
        formNumber: formMDocuments.formNumber,
        cbnPortalRef: formMDocuments.cbnPortalRef,
        validityDate: formMDocuments.validityDate,
        status: formMDocuments.status,
        createdAt: formMDocuments.createdAt,
        pythonValidationResult: formMDocuments.pythonValidationResult,
        documentUrl: formMDocuments.documentUrl,
        tradePaymentId: formMDocuments.tradePaymentId,
        userName: users.name,
        userEmail: users.email,
      })
        .from(formMDocuments)
        .leftJoin(users, eq(formMDocuments.userId, users.id))
        .where(eq(formMDocuments.id, input.id));
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Form M document not found" });
      if (doc.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }
      return doc;
    }),
});
