/**
 * BDC Rescreening Router — wave12 G3 (SPEC-wave12 §4.4, owner: B3)
 *
 * Periodic re-screening of KYC-verified BDC customers against the same
 * fail-closed sanctions/PEP provider used at onboarding
 * (server/lib/enhancedScreening.ts via server/services/bdcRescreening.ts).
 *
 * Procedures:
 *   runRescreening              admin mutation — TOTP step-up; STARTS a run
 *                               and returns an honest started-state ({runId,
 *                               status:'started'}); the run executes in the
 *                               background and appends result rows. Overlap
 *                               with an in-flight run → CONFLICT.
 *   listRescreeningResults      tenant-scoped query, id-cursor pagination
 *                               (same convention as compliance.listSofDeclarations).
 *   getCustomerScreeningStatus  latest result + blocked flag for one customer
 *                               (used by the teller UI; the sale-path gate is
 *                               assertCustomerNotRescreenBlocked in _shared.ts).
 *
 * Conventions follow server/routers/bdc/compliance.ts (requireDb /
 * requireTenantId via resolveTenantContext, audited procedures, audit log).
 * The router is mounted in the bdc barrel by ORCH at merge.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt } from "drizzle-orm";
import { router, auditedProcedure, auditedAdminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import { bdcRescreeningResults } from "../../../drizzle/schema";
import { resolveTenantContext } from "../../tenantMiddleware";
import { requireTotpStepUp } from "../../_core/totpStepUp";
import { createAuditLog } from "../../audit.service";
import { logger } from "../../_core/logger";
import {
  isRescreeningRunInFlight,
  newRescreeningRunId,
  runBdcRescreening,
} from "../../services/bdcRescreening";

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
    throw new TRPCError({ code: "FORBIDDEN", message: "An active tenant is required for BDC rescreening operations." });
  }
  return tenant.tenantId;
}

export const bdcRescreeningRouter = router({
  /**
   * MLRO/admin: trigger a rescreening run. `tenantId` omitted → all tenants.
   * Honest started-state: the run continues in the background; poll
   * listRescreeningResults (filter by the returned runId's rows) for progress.
   */
  runRescreening: auditedAdminProcedure
    .input(z.object({
      tenantId: z.number().int().positive().optional(),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC customer rescreening");
      await requireDb(); // fail fast if the run could not persist anything

      if (isRescreeningRunInFlight()) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A BDC rescreening run is already in progress — wait for it to finish",
        });
      }

      const scopeTenantId = input.tenantId ?? null;
      const runId = newRescreeningRunId();

      // Fire-and-forget with loud failure logging — the summary is persisted
      // row-by-row, so a crashed run leaves an honest partial trail.
      void runBdcRescreening(scopeTenantId, { runId }).catch((err) => {
        logger.error(
          { errMsg: (err as Error)?.message, runId, tenantId: scopeTenantId },
          "[BDC] Manual rescreening run FAILED",
        );
      });

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_RESCREENING_RUN_STARTED",
        targetType: "bdc_rescreening_results",
        severity: "info",
        description: `BDC customer rescreening run ${runId} started (tenant: ${scopeTenantId ?? "ALL"})`,
        metadata: { runId, tenantId: scopeTenantId },
      });

      return { runId, status: "started" as const, tenantId: scopeTenantId };
    }),

  /** MLRO/teller: rescreening result history — filters + id-cursor pagination. */
  listRescreeningResults: auditedProcedure
    .input(z.object({
      customerId: z.number().int().positive().optional(),
      verdict: z.enum(["clear", "match", "error"]).optional(),
      blockedOnly: z.boolean().optional(),
      cursor: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const rows = await db
        .select()
        .from(bdcRescreeningResults)
        .where(and(
          eq(bdcRescreeningResults.tenantId, tenantId),
          input.customerId ? eq(bdcRescreeningResults.customerId, input.customerId) : undefined,
          input.verdict ? eq(bdcRescreeningResults.verdict, input.verdict) : undefined,
          input.blockedOnly ? eq(bdcRescreeningResults.blocked, true) : undefined,
          input.cursor ? lt(bdcRescreeningResults.id, input.cursor) : undefined,
        ))
        .orderBy(desc(bdcRescreeningResults.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const results = hasMore ? rows.slice(0, input.limit) : rows;
      return { results, nextCursor: hasMore ? results[results.length - 1]?.id ?? null : null };
    }),

  /** Teller UI: latest rescreening verdict + blocked flag for one customer. */
  getCustomerScreeningStatus: auditedProcedure
    .input(z.object({ customerId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const [latest] = await db
        .select()
        .from(bdcRescreeningResults)
        .where(and(
          eq(bdcRescreeningResults.tenantId, tenantId),
          eq(bdcRescreeningResults.customerId, input.customerId),
        ))
        .orderBy(desc(bdcRescreeningResults.id))
        .limit(1);
      return {
        customerId: input.customerId,
        latest: latest ?? null,
        // Never screened → not blocked (onboarding screening is the gate);
        // latest verdict 'match' → blocked until an MLRO review clears it.
        blocked: latest?.blocked ?? false,
      };
    }),
});
