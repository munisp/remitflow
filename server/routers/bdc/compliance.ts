/**
 * BDC Compliance Router — SPEC-bdc §3.8 (owner: B3)
 *
 * Source-of-funds declarations (≥ $10k), PEP/sanctions screening, STR filing
 * via the existing goAML integration client path, and CTR pre-post checks.
 *
 * Reused clients (no new deps):
 *  - Screening: server/lib/enhancedScreening.ts → runEnhancedScreening
 *    (fail-closed in production; we also fail closed on ANY outage here).
 *  - STR: POST ${GOAML_SERVICE_URL}/v1/str/create (direct service client;
 *    the old tRPC wrapper was deleted in wave-13 C6).
 *    Default http://localhost:8123, services/go-goaml-integration.
 *  - CTR: threshold logic ported from server/routers/v98Features.ts
 *    (ctr.checkAndFlag: $10k daily threshold + 24h structuring pattern,
 *    same USD conversion table) — that router does not export its helpers,
 *    so the identical logic is kept here against bdc_transactions.
 *
 * Storage notes:
 *  - Screening results: bdc_customers.mrzData is the ONLY nullable jsonb on
 *    the table and nothing in the codebase writes it yet; the screening
 *    report is stored under a `screening` key, preserving any pre-existing
 *    MRZ fields (documented per task contract).
 *  - STR drafts: retained tamper-evidently via createAuditLog metadata on
 *    every filing attempt (there is no BDC STR table and §0.1 forbids schema
 *    changes) — on goAML outage the procedure throws UNAVAILABLE and the
 *    draft remains in the audit trail.
 *
 * TOTP (requireTotpStepUp): reviewSofDeclaration, fileStr.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { router, auditedProcedure, auditedAdminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  auditLogs,
  bdcCustomers,
  bdcSofDeclarations,
  bdcTransactions,
} from "../../../drizzle/schema";
import { resolveTenantContext } from "../../tenantMiddleware";
import { requireTotpStepUp } from "../../_core/totpStepUp";
import { createAuditLog } from "../../audit.service";
import { logger } from "../../_core/logger";
import { getBdcProfile, toCents } from "./_shared";

// ─── Constants / helpers ──────────────────────────────────────────────────────

/** $10,000 in cents — SoF declaration trigger (SPEC §3.4/§3.8). */
export const SOF_THRESHOLD_USD_CENTS = 1_000_000;

/** Predicate: does this USD amount (integer cents) require a SoF declaration? */
export function sofRequired(amountUsdCents: number): boolean {
  return amountUsdCents >= SOF_THRESHOLD_USD_CENTS;
}

/** CTR daily-report threshold (USD) — same as v98Features ctr.checkAndFlag. */
const CTR_THRESHOLD_USD = 10_000;

/** USD conversion table — identical to v98Features.ts (approximate screening rates). */
const USD_RATES: Record<string, number> = {
  USD: 1, EUR: 1.08, GBP: 1.27, NGN: 0.00065, GHS: 0.067,
  KES: 0.0077, ZAR: 0.054, XOF: 0.0016, MAD: 0.099,
};

function toUsd(amount: number, currency: string): number {
  const rate = USD_RATES[currency.toUpperCase()] ?? 0.001;
  return amount * rate;
}

const GOAML_URL = process.env.GOAML_SERVICE_URL || "http://localhost:8123";

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable (fail-closed)" });
  }
  return db;
}

async function requireTenantId(userId: number): Promise<number> {
  const tenant = await resolveTenantContext(userId);
  if (!tenant.tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "An active tenant is required for BDC compliance operations." });
  }
  return tenant.tenantId;
}

async function requireCustomer(db: any, tenantId: number, customerId: number) {
  const [customer] = await db
    .select()
    .from(bdcCustomers)
    .where(and(eq(bdcCustomers.id, customerId), eq(bdcCustomers.tenantId, tenantId)))
    .limit(1);
  if (!customer) {
    throw new TRPCError({ code: "NOT_FOUND", message: `BDC customer ${customerId} not found` });
  }
  return customer;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const bdcComplianceRouter = router({
  /** Teller: submit a Source-of-Funds declaration (status 'submitted'). */
  submitSofDeclaration: auditedProcedure
    .input(z.object({
      customerId: z.number().int().positive(),
      transactionId: z.number().int().positive().optional(),
      amountUsd: z.string().regex(/^\d+(\.\d{1,2})?$/, "major-unit USD amount (e.g. '12500.00')"),
      sourceDescription: z.string().min(10).max(2000),
      documentRefs: z.array(z.string().max(255)).max(20).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);
      await requireCustomer(db, tenantId, input.customerId);

      const required = sofRequired(toCents(input.amountUsd));

      const [row] = await db
        .insert(bdcSofDeclarations)
        .values({
          tenantId,
          customerId: input.customerId,
          transactionId: input.transactionId ?? null,
          amountUsd: input.amountUsd,
          sourceDescription: input.sourceDescription,
          documentRefs: input.documentRefs,
          status: "submitted",
        })
        .returning();

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_SOF_SUBMITTED",
        targetType: "bdc_sof_declarations",
        targetId: row.id,
        description: `SoF declaration ${row.id} submitted for customer ${input.customerId} ($${input.amountUsd})`,
        metadata: { tenantId, customerId: input.customerId, amountUsd: input.amountUsd, sofRequired: required },
      });

      return { declaration: row, sofRequired: required };
    }),

  /** MLRO + TOTP: approve/reject a submitted declaration (guarded single-winner). */
  reviewSofDeclaration: auditedAdminProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      decision: z.enum(["approved", "rejected"]),
      reason: z.string().min(5).max(1000),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);
      await requireTotpStepUp(ctx.user.id, input.totpCode, "SoF declaration review");

      const reviewed = await db.transaction(async (tx: any) => {
        const rows = await tx
          .update(bdcSofDeclarations)
          .set({
            status: input.decision,
            reviewedBy: ctx.user.id,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(bdcSofDeclarations.id, input.declarationId),
              eq(bdcSofDeclarations.tenantId, tenantId),
              eq(bdcSofDeclarations.status, "submitted"), // single-winner guard
            ),
          )
          .returning();
        if (rows.length === 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Declaration ${input.declarationId} is not awaiting review (already decided or unknown)`,
          });
        }
        return rows[0];
      });

      await createAuditLog({
        userId: ctx.user.id,
        action: `BDC_SOF_${input.decision.toUpperCase()}`,
        targetType: "bdc_sof_declarations",
        targetId: reviewed.id,
        severity: input.decision === "rejected" ? "warning" : "info",
        description: `SoF declaration ${reviewed.id} ${input.decision} by MLRO`,
        metadata: { tenantId, declarationId: reviewed.id, decision: input.decision, reason: input.reason },
      });

      return reviewed;
    }),

  /**
   * Screen a BDC customer (PEP/sanctions/adverse media) via the existing
   * enhancedScreening client. FAIL-CLOSED: any screening outage → UNAVAILABLE.
   */
  screenCustomer: auditedProcedure
    .input(z.object({ customerId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);
      const customer = await requireCustomer(db, tenantId, input.customerId);

      let report;
      try {
        const { runEnhancedScreening } = await import("../../lib/enhancedScreening");
        report = await runEnhancedScreening({
          name: customer.fullName ?? "UNKNOWN",
          userId: ctx.user.id,
          transactionId: `bdc-customer-${customer.id}`,
        });
      } catch (err) {
        logger.error({ err, customerId: customer.id }, "[BDC] enhanced screening unavailable — fail-closed");
        throw new TRPCError({
          code: "UNAVAILABLE",
          message: "Screening provider unavailable — customer screening blocked (fail-closed)",
          cause: err,
        });
      }

      // Store under mrzData.screening — mrzData is the only nullable jsonb on
      // bdc_customers; preserve any existing MRZ payload.
      const existing = customer.mrzData;
      const base =
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : existing != null
            ? { mrz: existing }
            : {};
      const storedScreening = {
        ...report,
        screenedByUserId: ctx.user.id,
        storedAt: new Date().toISOString(),
      };

      // Map screening risk onto the customer's standing fields.
      const riskRating =
        report.riskLevel === "low" ? "low" : report.riskLevel === "medium" ? "standard" : "high";

      await db
        .update(bdcCustomers)
        .set({
          mrzData: { ...base, screening: storedScreening },
          pepFlag: report.pep.isPEP,
          riskRating,
          updatedAt: new Date(),
        })
        .where(and(eq(bdcCustomers.id, customer.id), eq(bdcCustomers.tenantId, tenantId)));

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_CUSTOMER_SCREENED",
        targetType: "bdc_customers",
        targetId: customer.id,
        severity: report.overallResult === "clear" ? "info" : "warning",
        description: `Screening ${report.overallResult} (${report.riskLevel}) for customer ${customer.id}`,
        metadata: {
          tenantId,
          customerId: customer.id,
          overallResult: report.overallResult,
          riskLevel: report.riskLevel,
          pep: report.pep.isPEP,
          screeningId: report.id,
        },
      });

      return {
        customerId: customer.id,
        report,
        stored: { field: "mrzData.screening", pepFlag: report.pep.isPEP, riskRating },
      };
    }),

  /**
   * MLRO + TOTP: file an STR for a BDC transaction via the existing goAML
   * client path (direct goAML service call). Service down →
   * UNAVAILABLE; the draft is retained in the audit trail (payload).
   */
  fileStr: auditedAdminProcedure
    .input(z.object({
      transactionId: z.number().int().positive(),
      suspicionReason: z.string().min(10).max(2000),
      riskLevel: z.enum(["low", "medium", "high", "critical"]),
      narrative: z.string().min(50).max(10000),
      filingOfficer: z.string().min(2).max(128),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);
      await requireTotpStepUp(ctx.user.id, input.totpCode, "STR filing");

      const [txn] = await db
        .select()
        .from(bdcTransactions)
        .where(and(eq(bdcTransactions.id, input.transactionId), eq(bdcTransactions.tenantId, tenantId)))
        .limit(1);
      if (!txn) {
        throw new TRPCError({ code: "NOT_FOUND", message: `BDC transaction ${input.transactionId} not found` });
      }
      const customer = txn.customerId != null ? await requireCustomer(db, tenantId, txn.customerId) : null;

      // STR draft built from bdc_transactions + customer.
      const draft = {
        customer_id: customer != null ? String(customer.id) : "walk-in",
        customer_name: customer?.fullName ?? "UNIDENTIFIED WALK-IN",
        transaction_id: String(txn.id),
        amount: Number(txn.fxAmount),
        currency: (txn.currency ?? "USD").toUpperCase(),
        suspicion_reason: input.suspicionReason,
        risk_level: input.riskLevel,
        narrative: input.narrative,
        filing_officer: input.filingOfficer,
      };

      // Retain the draft (payload) tamper-evidently BEFORE the external call —
      // on goAML outage this is the retained draft referenced by the error.
      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_STR_DRAFT",
        targetType: "bdc_transactions",
        targetId: txn.id,
        description: `STR draft for BDC transaction ${txn.id}`,
        metadata: { tenantId, draft },
      });

      let serviceResponse: Record<string, unknown>;
      try {
        const res = await fetch(`${GOAML_URL}/v1/str/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          throw new Error(`goAML service returned HTTP ${res.status}`);
        }
        serviceResponse = (await res.json()) as Record<string, unknown>;
      } catch (err) {
        logger.error({ err, transactionId: txn.id }, "[BDC] goAML STR filing failed — draft retained in audit log");
        throw new TRPCError({
          code: "UNAVAILABLE",
          message: "goAML filing service unavailable — STR draft retained in audit trail (action BDC_STR_DRAFT); retry filing later",
          cause: err,
        });
      }

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_STR_FILED",
        targetType: "bdc_transactions",
        targetId: txn.id,
        severity: "warning",
        description: `STR filed for BDC transaction ${txn.id} (report ${serviceResponse.report_id ?? serviceResponse.id ?? "unknown"})`,
        metadata: { tenantId, draft, serviceResponse },
      });

      return {
        reportId: (serviceResponse.report_id ?? serviceResponse.id ?? null) as string | null,
        status: (serviceResponse.status ?? "created") as string,
        draft,
        serviceResponse,
      };
    }),

  /**
   * Pre-post CTR check — mirrors v98Features ctr.checkAndFlag logic:
   * ≥ $10k single amount → amount_threshold; else 24h customer aggregate
   * (from bdc_transactions) crossing $10k → structuring_pattern.
   * Read-only: does not flag or persist anything.
   */
  ctrCheck: auditedProcedure
    .input(z.object({
      customerId: z.number().int().positive().optional(),
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "major-unit amount"),
      currency: z.string().length(3),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);

      const amountUsd = toUsd(Number(input.amount), input.currency);
      let recent24hUsdTotal = 0;
      let reason: "amount_threshold" | "structuring_pattern" | null = null;

      if (amountUsd >= CTR_THRESHOLD_USD) {
        reason = "amount_threshold";
      } else if (input.customerId != null) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recent = await db
          .select({ fxAmount: bdcTransactions.fxAmount, currency: bdcTransactions.currency })
          .from(bdcTransactions)
          .where(
            and(
              eq(bdcTransactions.tenantId, tenantId),
              eq(bdcTransactions.customerId, input.customerId),
              gte(bdcTransactions.createdAt, since),
              sql`${bdcTransactions.status} <> 'reversed'`,
            ),
          )
          .orderBy(desc(bdcTransactions.createdAt))
          .limit(50);
        recent24hUsdTotal = recent.reduce(
          (s: number, t: { fxAmount: string; currency: string | null }) => s + toUsd(Number(t.fxAmount), t.currency ?? "USD"),
          0,
        );
        if (recent24hUsdTotal + amountUsd >= CTR_THRESHOLD_USD) {
          reason = "structuring_pattern";
        }
      }

      return {
        requiresCtr: reason !== null,
        reason,
        threshold: CTR_THRESHOLD_USD,
        amountUsd: Number(amountUsd.toFixed(2)),
        recent24hUsdTotal: Number(recent24hUsdTotal.toFixed(2)),
      };
    }),

  /** MLRO: SoF declaration review queue — status filter + id-cursor pagination. */
  listSofDeclarations: auditedProcedure
    .input(z.object({
      status: z.enum(["submitted", "approved", "rejected"]).optional(),
      customerId: z.number().int().positive().optional(),
      cursor: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const rows = await db
        .select()
        .from(bdcSofDeclarations)
        .where(and(
          eq(bdcSofDeclarations.tenantId, tenantId),
          input.status ? eq(bdcSofDeclarations.status, input.status) : undefined,
          input.customerId ? eq(bdcSofDeclarations.customerId, input.customerId) : undefined,
          input.cursor ? sql`${bdcSofDeclarations.id} < ${input.cursor}` : undefined,
        ))
        .orderBy(desc(bdcSofDeclarations.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const declarations = hasMore ? rows.slice(0, input.limit) : rows;
      return { declarations, nextCursor: hasMore ? declarations[declarations.length - 1]?.id ?? null : null };
    }),

  /**
   * MLRO: STR draft/filing history. Drafts are retained tamper-evidently in
   * auditLogs (action BDC_STR_DRAFT / BDC_STR_FILED, metadata.tenantId scoped)
   * because the additive schema has no BDC STR table (B3 design, documented).
   */
  listStrs: auditedProcedure
    .input(z.object({
      cursor: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const rows = await db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          targetId: auditLogs.targetId,
          description: auditLogs.description,
          metadata: auditLogs.metadata,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(and(
          sql`${auditLogs.action} IN ('BDC_STR_DRAFT', 'BDC_STR_FILED')`,
          sql`${auditLogs.metadata}->>'tenantId' = ${String(tenantId)}`,
          input.cursor ? sql`${auditLogs.id} < ${input.cursor}` : undefined,
        ))
        .orderBy(desc(auditLogs.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const strs = hasMore ? rows.slice(0, input.limit) : rows;
      return { strs, nextCursor: hasMore ? strs[strs.length - 1]?.id ?? null : null };
    }),
});

// ─── wave12 G6 structuring (B6) — rolling 7d/30d aggregation ────────────────

/** SPEC-wave12 §4.6 thresholds (USD): 7-day ≥ $10,000 or 30-day ≥ $50,000. */
export const STRUCTURING_THRESHOLD_7D_USD = 10_000;
export const STRUCTURING_THRESHOLD_30D_USD = 50_000;

// ORCH adds a KAFKA_TOPICS constant at merge; publish the literal topic here.
const BDC_STRUCTURING_ALERTS_TOPIC = "remitflow.bdc.structuring.alerts";

export interface RollingThresholdResult {
  block: boolean;
  reason?: string;
  totals: { d7: number; d30: number };
}

/**
 * checkRollingThresholds (SPEC-wave12 §4.6) — multi-day structuring guard.
 * Exported helper; ORCH wires the call into the sale path (sales.ts buyFx /
 * sellFx) at merge — callers block with PRECONDITION_FAILED when
 * `{block:true, reason:'sof_required'}`.
 *
 * Sums fx_amount over bdc_transactions for (tenant_id, customer_id) with
 * txn_type IN ('buy_fx','sell_fx') and status NOT IN ('failed','reversed')
 * in rolling 7-day and 30-day windows, INCLUDING the pending trade amount
 * (newAmountUsd). If a window total meets its threshold and there is NO
 * approved bdc_sof_declarations row on file for the customer:
 *   - upsert bdc_structuring_alerts (ON CONFLICT on the unique
 *     (tenant_id, customer_id, window_days, window_start) key UPDATE
 *     totals/txn_count — repeat detections refresh the same alert row),
 *   - publish a Kafka alert on INSERT only (fail-soft telemetry, §0.5),
 *   - return {block:true, reason:'sof_required', totals}.
 * Fail-closed: a DB outage throws (requireDb) — the sale must not proceed
 * unchecked.
 */
export async function checkRollingThresholds(
  tenantId: number,
  customerId: number,
  newAmountUsd: number,
): Promise<RollingThresholdResult> {
  const db = await requireDb();
  const { publishEvent } = await import("../../middleware/kafka");

  const [sums] = (await db.execute(sql`
    SELECT
      COALESCE(SUM(fx_amount) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0)::text  AS "sum7",
      COUNT(*)        FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int               AS "count7",
      COALESCE(SUM(fx_amount) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0)::text AS "sum30",
      COUNT(*)        FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int              AS "count30",
      (CURRENT_DATE - INTERVAL '7 days')::date::text  AS "windowStart7",
      (CURRENT_DATE - INTERVAL '30 days')::date::text AS "windowStart30"
    FROM bdc_transactions
    WHERE tenant_id = ${tenantId}
      AND customer_id = ${customerId}
      AND txn_type IN ('buy_fx', 'sell_fx')
      AND status NOT IN ('failed', 'reversed')
      AND created_at >= NOW() - INTERVAL '30 days'
  `)) as unknown as Array<{
    sum7: string; count7: number; sum30: string; count30: number;
    windowStart7: string; windowStart30: string;
  }>;

  const d7 = Number(sums?.sum7 ?? 0) + newAmountUsd;
  const d30 = Number(sums?.sum30 ?? 0) + newAmountUsd;
  const totals = { d7, d30 };

  const breach7 = d7 >= STRUCTURING_THRESHOLD_7D_USD;
  const breach30 = d30 >= STRUCTURING_THRESHOLD_30D_USD;
  if (!breach7 && !breach30) {
    return { block: false, totals };
  }

  // Approved source-of-funds declaration on file clears the block (alert
  // rows are NOT written for declared funds).
  const sof = (await db.execute(sql`
    SELECT id FROM bdc_sof_declarations
    WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND status = 'approved'
    LIMIT 1
  `)) as unknown as Array<{ id: number }>;
  if (sof.length > 0) {
    return { block: false, totals };
  }

  // Upsert one alert per breached window. (xmax = 0) distinguishes a fresh
  // INSERT from a conflict UPDATE so the Kafka alert fires only once per
  // (tenant, customer, window) detection.
  const windows: Array<{ days: 7 | 30; total: number; count: number; start: string }> = [];
  if (breach7) windows.push({ days: 7, total: d7, count: (sums?.count7 ?? 0) + 1, start: sums?.windowStart7 ?? "" });
  if (breach30) windows.push({ days: 30, total: d30, count: (sums?.count30 ?? 0) + 1, start: sums?.windowStart30 ?? "" });

  for (const w of windows) {
    const upserted = (await db.execute(sql`
      INSERT INTO bdc_structuring_alerts
        (tenant_id, customer_id, window_days, window_start, total_usd, txn_count, disposition)
      VALUES
        (${tenantId}, ${customerId}, ${w.days}, ${w.start}::date, ${w.total.toFixed(2)}, ${w.count}, 'sof_required')
      ON CONFLICT (tenant_id, customer_id, window_days, window_start)
      DO UPDATE SET total_usd = EXCLUDED.total_usd, txn_count = EXCLUDED.txn_count, updated_at = NOW()
      RETURNING id, (xmax = 0) AS "inserted"
    `)) as unknown as Array<{ id: number; inserted: boolean }>;

    const row = upserted[0];
    if (row?.inserted) {
      await publishEvent(BDC_STRUCTURING_ALERTS_TOPIC, `bdc-structuring:${tenantId}:${customerId}:${w.days}:${w.start}`, {
        eventType: "bdc.structuring.alert",
        alertId: row.id,
        tenantId,
        customerId,
        windowDays: w.days,
        windowStart: w.start,
        totalUsd: w.total.toFixed(2),
        txnCount: w.count,
        thresholdUsd: w.days === 7 ? STRUCTURING_THRESHOLD_7D_USD : STRUCTURING_THRESHOLD_30D_USD,
        reason: "sof_required",
        timestamp: new Date().toISOString(),
      }).catch((err: unknown) =>
        logger.warn({ err: err instanceof Error ? err.message : String(err), tenantId, customerId }, "[BDC] structuring alert publish failed (alert row persisted — non-critical)"),
      );
    }
  }

  logger.warn(
    { tenantId, customerId, d7, d30, breach7, breach30 },
    "[BDC] rolling structuring threshold breached without approved SoF — blocking sale (sof_required)",
  );
  return { block: true, reason: "sof_required", totals };
}
