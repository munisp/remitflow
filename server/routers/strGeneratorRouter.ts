/**
 * RemitFlow — STR (Suspicious Transaction Report) Generator Router
 * ══════════════════════════════════════════════════════════════════════════════
 * Bridges the TypeScript API layer with the Python STR generator service.
 * Provides tRPC procedures for compliance officers to generate, review,
 * and file Suspicious Transaction Reports with financial intelligence units.
 *
 * Supported jurisdictions: NG (NFIU), GH (FIC), KE (FRC), ZA (FIC-SA),
 *                          US (FinCEN), GB (UKFIU), CA (FINTRAC), FATF (goAML)
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
import { db } from "../db-shim";
import { getRedisClient } from "../middleware/redis";
const redis = getRedisClient();
import { publishEvent } from "../lib/middleware-orchestrator";

const STR_SVC_URL = process.env.STR_GENERATOR_URL ?? "http://python-str-generator:8210";

// ── Zod Schemas ───────────────────────────────────────────────────────────────

const SubjectSchema = z.object({
  full_name: z.string().min(2).max(200),
  date_of_birth: z.string().optional(),
  nationality: z.string().length(2).optional(),
  id_type: z.enum(["national_id", "passport", "drivers_license", "bvn", "nin"]).optional(),
  id_number: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  occupation: z.string().optional(),
  is_pep: z.boolean().default(false),
  is_sanctioned: z.boolean().default(false),
});

const TransactionSchema = z.object({
  transaction_id: z.string(),
  amount: z.number().positive(),
  currency: z.string().length(3),
  transaction_date: z.string(),
  transaction_type: z.string().default("wire_transfer"),
  channel: z.string().default("digital"),
  purpose: z.string().optional(),
  beneficiary_name: z.string().optional(),
  beneficiary_account: z.string().optional(),
  beneficiary_country: z.string().length(2).optional(),
});

const SUSPICION_INDICATOR_CODES = [
  "SI-001", "SI-002", "SI-003", "SI-004", "SI-005",
  "SI-006", "SI-007", "SI-008", "SI-009", "SI-010",
  "SI-011", "SI-012", "SI-013", "SI-014", "SI-015",
] as const;

// ── Helper ────────────────────────────────────────────────────────────────────

async function callStrService<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<T | null> {
  try {
    const res = await fetch(`${STR_SVC_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, path }, "[STR] Service returned error");
      return null;
    }
    return res.json() as Promise<T>;
  } catch (e) {
    logger.error({ err: e, path }, "[STR] Service call failed");
    return null;
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const strGeneratorRouter = router({
  /**
   * Generate a complete STR package for a flagged alert.
   */
  generateStr: adminProcedure
    .input(z.object({
      alertId: z.string(),
      userId: z.number().int().positive(),
      subject: SubjectSchema,
      transactions: z.array(TransactionSchema).min(1).max(50),
      suspicionIndicators: z.array(z.enum(SUSPICION_INDICATOR_CODES)).min(1),
      jurisdiction: z.enum(["NG", "GH", "KE", "ZA", "US", "GB", "CA", "FATF"]).default("NG"),
      priority: z.enum(["urgent", "high", "normal"]).default("normal"),
      narrative: z.string().optional(),
      reportingOfficer: z.string().default("Compliance Officer"),
    }))
    .mutation(async ({ input, ctx }) => {
      // Check for duplicate STR for this alert
      const cacheKey = `str:generated:${input.alertId}`;
      const existing = await redis.get(cacheKey);
      if (existing) {
        logger.warn({ alertId: input.alertId }, "[STR] Duplicate STR generation attempt");
        return JSON.parse(existing);
      }

      const result = await callStrService<{
        str_id: string;
        status: string;
        pdf_size_bytes: number;
        pdf_checksum_sha256: string;
        generated_at: string;
        endpoints: Record<string, string>;
      }>("/v1/str/generate", "POST", {
        alert_id: input.alertId,
        user_id: input.userId,
        subject: input.subject,
        transactions: input.transactions,
        suspicion_indicators: input.suspicionIndicators,
        jurisdiction: input.jurisdiction,
        priority: input.priority,
        narrative: input.narrative,
        reporting_officer: input.reportingOfficer,
        auto_generate_narrative: !input.narrative,
      });

      if (!result) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "STR generator service unavailable. Please try again or contact support.",
        });
      }

      // Cache for 1 hour to prevent duplicates
      await redis.set(cacheKey, JSON.stringify(result), "EX", 3600);

      // Publish to Kafka for audit trail
      await publishEvent("compliance.str.generated", {
        strId: result.str_id,
        alertId: input.alertId,
        userId: input.userId,
        jurisdiction: input.jurisdiction,
        priority: input.priority,
        generatedBy: ctx.user?.email ?? "system",
        generatedAt: result.generated_at,
      });

      logger.info({ strId: result.str_id, alertId: input.alertId }, "[STR] Report generated");
      return result;
    }),

  /**
   * Get the PDF binary for a generated STR.
   */
  getStrPdf: adminProcedure
    .input(z.object({
      strId: z.string(),
      alertId: z.string(),
      userId: z.number().int().positive(),
      subject: SubjectSchema,
      transactions: z.array(TransactionSchema).min(1),
      suspicionIndicators: z.array(z.enum(SUSPICION_INDICATOR_CODES)).min(1),
      jurisdiction: z.enum(["NG", "GH", "KE", "ZA", "US", "GB", "CA", "FATF"]).default("NG"),
    }))
    .mutation(async ({ input }) => {
      // Return base64-encoded PDF for download
      const res = await fetch(`${STR_SVC_URL}/v1/str/${input.strId}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alert_id: input.alertId,
          user_id: input.userId,
          subject: input.subject,
          transactions: input.transactions,
          suspicion_indicators: input.suspicionIndicators,
          jurisdiction: input.jurisdiction,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!res.ok) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to generate STR PDF" });
      }

      const pdfBuffer = await res.arrayBuffer();
      const base64 = Buffer.from(pdfBuffer).toString("base64");

      return {
        strId: input.strId,
        pdfBase64: base64,
        mimeType: "application/pdf",
        filename: `${input.strId}.pdf`,
      };
    }),

  /**
   * Get the goAML XML for a generated STR.
   */
  getStrXml: adminProcedure
    .input(z.object({
      strId: z.string(),
      alertId: z.string(),
      userId: z.number().int().positive(),
      subject: SubjectSchema,
      transactions: z.array(TransactionSchema).min(1),
      suspicionIndicators: z.array(z.enum(SUSPICION_INDICATOR_CODES)).min(1),
      jurisdiction: z.enum(["NG", "GH", "KE", "ZA", "US", "GB", "CA", "FATF"]).default("NG"),
    }))
    .mutation(async ({ input }) => {
      const res = await fetch(`${STR_SVC_URL}/v1/str/${input.strId}/xml`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alert_id: input.alertId,
          user_id: input.userId,
          subject: input.subject,
          transactions: input.transactions,
          suspicion_indicators: input.suspicionIndicators,
          jurisdiction: input.jurisdiction,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to generate STR XML" });
      }

      const xmlContent = await res.text();
      return {
        strId: input.strId,
        xml: xmlContent,
        mimeType: "application/xml",
        filename: `${input.strId}.xml`,
      };
    }),

  /**
   * List available suspicion indicator codes.
   */
  listIndicators: protectedProcedure
    .query(async () => {
      const result = await callStrService<{
        indicators: Array<{ code: string; description: string }>;
      }>("/v1/indicators", "GET");

      return result?.indicators ?? [];
    }),
});
