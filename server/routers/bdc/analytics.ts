/**
 * BDC Analytics Router — SPEC-wave12 §4.9 / G10 (owner: B7)
 *
 * Teller-fraud analytics: the TS side is a thin, fail-closed gateway to the
 * python-teller-analytics service (port 8230), plus tenant-scoped triage
 * queries over teller_fraud_signals.
 *
 * Conventions (verified against server/routers/bdc/vault.ts +
 * server/routers/geoAnalytics.ts):
 *  - auditedAdminProcedure for scan/triage mutations, auditedProcedure for reads.
 *  - TOTP step-up via requireTotpStepUp on every mutation.
 *  - Service calls fail CLOSED: TELLER_ANALYTICS_URL / INTERNAL_API_TOKEN
 *    unset → PRECONDITION_FAILED in production (non-prod falls back to
 *    http://localhost:8230 for the URL only — the token is always required
 *    because the python service refuses to boot without one).
 *  - Guarded single-winner status flips (UPDATE ... WHERE status=:prev
 *    RETURNING — 0 rows → CONFLICT).
 *  - Analytics must NEVER block money paths: the nightly scheduler entry
 *    (runNightlyTellerFraudScan) is fail-soft with logger.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt } from "drizzle-orm";
import { router, auditedProcedure, auditedAdminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import { tellerFraudSignals } from "../../../drizzle/schema";
import { resolveTenantContext } from "../../tenantMiddleware";
import { requireTotpStepUp } from "../../_core/totpStepUp";
import { createAuditLog } from "../../audit.service";
import { logger } from "../../_core/logger";

// ─── Local helpers ────────────────────────────────────────────────────────────

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable (fail-closed)" });
  }
  return db;
}

/** Resolve the caller's tenant — every BDC query is tenant-scoped (SPEC §0.9). */
async function requireTenantId(userId: number): Promise<number> {
  const tenant = await resolveTenantContext(userId);
  if (!tenant.tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "An active tenant is required for BDC analytics operations." });
  }
  return tenant.tenantId;
}

const SERVICE_TIMEOUT_MS = 60_000; // window scans aggregate up to 90 days
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 90;

const SIGNAL_TYPES = [
  "variance_pattern",
  "out_of_hours",
  "reversal_concentration",
  "counterfeit_concentration",
] as const;
const SIGNAL_STATUSES = ["open", "reviewing", "escalated", "cleared"] as const;

export interface TellerFraudRunSummary {
  signals_written: number;
  window_start: string;
  window_end: string;
  skipped: string[];
}

/**
 * Call the python-teller-analytics service. Fail-closed:
 *  - INTERNAL_API_TOKEN unset → PRECONDITION_FAILED (any environment): the
 *    python service refuses to boot without it, so no honest call is possible.
 *  - TELLER_ANALYTICS_URL unset → PRECONDITION_FAILED in production;
 *    non-production falls back to the default local port 8230.
 * Any upstream/network failure → UNAVAILABLE (never a fabricated summary).
 */
async function callTellerFraudRun(
  tenantId: number | null,
  windowDays: number,
): Promise<TellerFraudRunSummary> {
  const isProd = process.env.NODE_ENV === "production";
  const baseUrl = process.env.TELLER_ANALYTICS_URL ?? (isProd ? undefined : "http://localhost:8230");
  const token = process.env.INTERNAL_API_TOKEN;
  if (!baseUrl) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Teller-fraud analytics is not configured (TELLER_ANALYTICS_URL unset) — scan refused (fail-closed)",
    });
  }
  if (!token) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Teller-fraud analytics is not configured (INTERNAL_API_TOKEN unset) — scan refused (fail-closed)",
    });
  }

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl.replace(/\/+$/, "")}/analytics/teller-fraud/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": token },
      body: JSON.stringify({ tenant_id: tenantId, window_days: windowDays }),
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn({ errMsg: (err as Error)?.message }, "[TellerAnalytics] service unreachable");
    throw new TRPCError({
      code: "UNAVAILABLE",
      message: `Teller-fraud analytics service unreachable: ${(err as Error)?.message ?? "unknown"}`,
    });
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    logger.warn({ status: resp.status, detail: detail.slice(0, 300) }, "[TellerAnalytics] service rejected scan");
    throw new TRPCError({
      code: "UNAVAILABLE",
      message: `Teller-fraud analytics service error ${resp.status}: ${detail.slice(0, 200)}`,
    });
  }
  const body = (await resp.json()) as Partial<TellerFraudRunSummary>;
  if (typeof body.signals_written !== "number" || !body.window_start || !body.window_end) {
    throw new TRPCError({
      code: "UNAVAILABLE",
      message: "Teller-fraud analytics returned a malformed summary — refusing to report fabricated counts",
    });
  }
  return {
    signals_written: body.signals_written,
    window_start: body.window_start,
    window_end: body.window_end,
    skipped: Array.isArray(body.skipped) ? body.skipped.map(String) : [],
  };
}

// ─── Nightly scheduler entry (ORCH registers in the bdcScheduler pattern) ────

/**
 * Tenant-wide nightly scan (tenant_id = null). Analytics is never a money
 * path, so this is fail-SOFT: configuration/upstream problems are logged and
 * reported as null rather than thrown into the scheduler.
 */
export async function runNightlyTellerFraudScan(
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<TellerFraudRunSummary | null> {
  try {
    const summary = await callTellerFraudRun(null, Math.min(windowDays, MAX_WINDOW_DAYS));
    logger.info({ ...summary }, "[TellerAnalytics] nightly scan complete");
    return summary;
  } catch (err) {
    logger.warn(
      { errMsg: (err as Error)?.message },
      "[TellerAnalytics] nightly scan failed (fail-soft — analytics must not block operations)",
    );
    return null;
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const bdcAnalyticsRouter = router({
  /**
   * On-demand scan (admin + TOTP). tenantId optional — defaults to the
   * caller's tenant; platform admins without a tenant run the tenant-wide
   * scan (same shape as the nightly job). Returns the honest service summary.
   */
  runTellerFraudScan: auditedAdminProcedure
    .input(z.object({
      tenantId: z.number().int().positive().optional(),
      windowDays: z.number().int().min(1).max(MAX_WINDOW_DAYS).default(DEFAULT_WINDOW_DAYS),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC teller-fraud scan");
      const tenant = await resolveTenantContext(ctx.user.id);
      const targetTenantId = input.tenantId ?? tenant.tenantId ?? null;

      const summary = await callTellerFraudRun(targetTenantId, input.windowDays);

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_TELLER_FRAUD_SCAN",
        targetType: "teller_fraud_signals",
        description: `Teller-fraud scan over ${input.windowDays}d window (${targetTenantId === null ? "all tenants" : `tenant ${targetTenantId}`}): ${summary.signals_written} signal(s) written`,
        metadata: { tenantId: targetTenantId, windowDays: input.windowDays, ...summary },
      });

      return { tenantId: targetTenantId, ...summary };
    }),

  /** Tenant-scoped signal list with filters; id-cursor pagination. */
  listTellerFraudSignals: auditedProcedure
    .input(z.object({
      tellerUserId: z.number().int().positive().optional(),
      signalType: z.enum(SIGNAL_TYPES).optional(),
      status: z.enum(SIGNAL_STATUSES).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      cursor: z.number().int().positive().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);

      const conditions = [eq(tellerFraudSignals.tenantId, tenantId)];
      if (input.tellerUserId) conditions.push(eq(tellerFraudSignals.tellerUserId, input.tellerUserId));
      if (input.signalType) conditions.push(eq(tellerFraudSignals.signalType, input.signalType));
      if (input.status) conditions.push(eq(tellerFraudSignals.status, input.status));
      if (input.cursor) conditions.push(lt(tellerFraudSignals.id, input.cursor));

      const rows = await db
        .select()
        .from(tellerFraudSignals)
        .where(and(...conditions))
        .orderBy(desc(tellerFraudSignals.id))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const page = hasMore ? rows.slice(0, input.limit) : rows;
      return { rows: page, nextCursor: hasMore ? page[page.length - 1].id : null };
    }),

  /**
   * Analyst triage (admin + TOTP): guarded single-winner flip — the UPDATE
   * guards on the status read just before it, so a concurrent triage change
   * collides with CONFLICT instead of silently overwriting.
   */
  updateSignalStatus: auditedAdminProcedure
    .input(z.object({
      signalId: z.number().int().positive(),
      status: z.enum(["reviewing", "escalated", "cleared"]),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC teller-fraud signal triage");

      const [existing] = await db
        .select()
        .from(tellerFraudSignals)
        .where(and(eq(tellerFraudSignals.id, input.signalId), eq(tellerFraudSignals.tenantId, tenantId)))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Teller-fraud signal ${input.signalId} not found` });
      }
      if (existing.status === input.status) {
        return { signalId: input.signalId, status: existing.status, unchanged: true as const };
      }

      const flipped = await db
        .update(tellerFraudSignals)
        .set({ status: input.status })
        .where(
          and(
            eq(tellerFraudSignals.id, input.signalId),
            eq(tellerFraudSignals.tenantId, tenantId),
            eq(tellerFraudSignals.status, existing.status), // guarded flip
          ),
        )
        .returning({ id: tellerFraudSignals.id });
      if (flipped.length === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Signal ${input.signalId} was concurrently modified — refresh and retry`,
        });
      }

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_TELLER_FRAUD_SIGNAL_TRIAGE",
        targetType: "teller_fraud_signals",
        targetId: input.signalId,
        description: `Signal ${input.signalId} (${existing.signalType}, teller ${existing.tellerUserId}) ${existing.status} → ${input.status}`,
        metadata: {
          tenantId,
          signalId: input.signalId,
          signalType: existing.signalType,
          tellerUserId: existing.tellerUserId,
          previousStatus: existing.status,
          newStatus: input.status,
        },
      });

      return { signalId: input.signalId, status: input.status, unchanged: false as const };
    }),
});
