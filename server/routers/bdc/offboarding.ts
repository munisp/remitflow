/**
 * BDC Tenant Offboarding Router — SPEC-wave12 §4.7 (owner: B6)
 *
 * Tenant offboarding lifecycle (bdc_tenant_offboardings, one row per tenant):
 *
 *   - requestOffboarding  (admin+TOTP) upsert the offboarding record
 *                         (status='requested', initiated_by) — a COMPLETED
 *                         offboarding is terminal and cannot be re-opened —
 *                         then start bdcTenantOffboardingWorkflow (fail-soft;
 *                         the workflow honestly evaluates blockers: non-zero
 *                         position via computePosition, open NFEM batches,
 *                         unsettled IMTO payouts, open regulatory returns →
 *                         flips to 'completed' (+completed_at) or 'blocked'
 *                         with the blocker list in blockers jsonb).
 *   - getOffboardingStatus (query) read the tenant's offboarding record.
 *   - cancelOffboarding   (admin+TOTP) guarded removal — only from
 *                         'requested'|'blocked' (never once in_progress has
 *                         committed a blocker evaluation? — see note — and
 *                         NEVER from 'completed').
 *
 * Status vocabulary (schema comment): requested | in_progress | blocked |
 * completed. There is no 'cancelled' status, so cancel HONESTLY DELETES the
 * record — the tenant simply has no offboarding in flight (assertTenantActive
 * only blocks on 'completed', so a cancelled tenant is unaffected).
 *
 * Note on in_progress: the evaluation activity claims the row in a guarded
 * single-winner flip (requested|blocked → in_progress) for milliseconds
 * before settling to completed/blocked; cancel is accepted from
 * requested|blocked — the activity's own guarded flips no-op honestly when a
 * concurrent cancel removes the row mid-flight (returns 'cancelled').
 *
 * Enforcement: assertTenantActive (appended to ./_shared.ts by B6) throws
 * PRECONDITION_FAILED "tenant offboarded" once an offboarding completes;
 * ORCH wires it into the shared tenant-resolution choke point at merge so
 * every BDC procedure inherits the block.
 *
 * ORCHESTRATOR WIRING: register `bdcOffboardingRouter` in the bdc barrel
 * (server/routers/bdc/index.ts) at merge.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { router, auditedAdminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  bdcTenantOffboardings,
  type BdcTenantOffboarding,
} from "../../../drizzle/schema";
import { requireTotpStepUp } from "../../_core/totpStepUp";
import { createAuditLog } from "../../audit.service";
import { logger } from "../../_core/logger";

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — tenant offboarding denied (fail-closed)" });
  }
  return db;
}

export const bdcOffboardingRouter = router({
  /**
   * requestOffboarding (admin + TOTP) — upsert the tenant's offboarding
   * record to 'requested' and start the blocker-evaluation workflow. A
   * COMPLETED offboarding is terminal: re-requesting throws
   * PRECONDITION_FAILED (the tenant is offboarded — there is no re-onboard
   * path in this wave).
   */
  requestOffboarding: auditedAdminProcedure
    .input(z.object({
      tenantId: z.number().int().positive(),
      totpCode: z.string().length(6).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC tenant offboarding request");

      const upserted = (await db.execute(sql`
        INSERT INTO bdc_tenant_offboardings (tenant_id, status, blockers, initiated_by)
        VALUES (${input.tenantId}, 'requested', '[]'::jsonb, ${ctx.user.id})
        ON CONFLICT (tenant_id) DO UPDATE
          SET status = 'requested', blockers = '[]'::jsonb,
              initiated_by = EXCLUDED.initiated_by,
              completed_at = NULL, updated_at = NOW()
          WHERE bdc_tenant_offboardings.status <> 'completed'
        RETURNING id, status
      `)) as unknown as Array<{ id: number; status: string }>;

      if (upserted.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `tenant ${input.tenantId} is already offboarded (terminal 'completed') — offboarding cannot be re-requested`,
        });
      }

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_OFFBOARDING_REQUESTED",
        targetType: "bdc_tenant_offboardings",
        targetId: upserted[0].id,
        severity: "warning",
        description: `Tenant ${input.tenantId} offboarding requested`,
        metadata: { tenantId: input.tenantId },
      });

      // Start the blocker-evaluation workflow (fail-soft per §0.5: Temporal
      // down → row honestly stays 'requested'; a re-request re-drives it).
      const { startBdcTenantOffboarding } = await import("../../temporal/workflows-bdc.js");
      const workflowStarted = await startBdcTenantOffboarding(input.tenantId);
      if (!workflowStarted) {
        logger.warn({ tenantId: input.tenantId }, "[BDC] offboarding requested but evaluation workflow not started (Temporal unavailable) — re-request to re-drive");
      }

      return {
        offboardingId: upserted[0].id,
        tenantId: input.tenantId,
        status: "requested" as const,
        workflowStarted,
      };
    }),

  /**
   * startOffboarding (admin + TOTP) — W13 (F-11): explicit INSERT writer for
   * bdc_tenant_offboardings. The wave-12 blocker-evaluation activity only
   * UPDATEs the row; this procedure guarantees a row exists by upserting with
   * status 'in_progress' and the (possibly empty) blocker list in blockers
   * jsonb. ON CONFLICT (tenant_id) — the 0091 DDL UNIQUE index — moves a
   * non-terminal row forward; a COMPLETED offboarding is terminal and the
   * guarded WHERE rejects it (0 rows → PRECONDITION_FAILED).
   */
  startOffboarding: auditedAdminProcedure
    .input(z.object({
      tenantId: z.number().int().positive(),
      blockers: z.array(z.string().max(200)).max(50).default([]),
      totpCode: z.string().length(6).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC tenant offboarding start");

      const upserted = (await db.execute(sql`
        INSERT INTO bdc_tenant_offboardings (tenant_id, status, blockers, initiated_by)
        VALUES (${input.tenantId}, 'in_progress', ${JSON.stringify(input.blockers)}::jsonb, ${ctx.user.id})
        ON CONFLICT (tenant_id) DO UPDATE
          SET status = 'in_progress', blockers = EXCLUDED.blockers,
              initiated_by = EXCLUDED.initiated_by,
              completed_at = NULL, updated_at = NOW()
          WHERE bdc_tenant_offboardings.status <> 'completed'
        RETURNING id, status
      `)) as unknown as Array<{ id: number; status: string }>;

      if (upserted.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `tenant ${input.tenantId} is already offboarded (terminal 'completed') — offboarding cannot be restarted`,
        });
      }

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_OFFBOARDING_STARTED",
        targetType: "bdc_tenant_offboardings",
        targetId: upserted[0].id,
        severity: "warning",
        description: `Tenant ${input.tenantId} offboarding started (in_progress) with ${input.blockers.length} blocker(s)`,
        metadata: { tenantId: input.tenantId, blockers: input.blockers },
      });

      return {
        offboardingId: upserted[0].id,
        tenantId: input.tenantId,
        status: "in_progress" as const,
        blockers: input.blockers,
      };
    }),

  /** getOffboardingStatus — the tenant's offboarding record (null when none). */
  getOffboardingStatus: auditedAdminProcedure
    .input(z.object({ tenantId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db
        .select()
        .from(bdcTenantOffboardings)
        .where(sql`${bdcTenantOffboardings.tenantId} = ${input.tenantId}`)
        .limit(1);
      const offboarding = (rows[0] as BdcTenantOffboarding | undefined) ?? null;
      return {
        tenantId: input.tenantId,
        offboarding,
        offboarded: offboarding?.status === "completed",
      };
    }),

  /**
   * cancelOffboarding (admin + TOTP) — guarded removal of a non-terminal
   * offboarding (only from 'requested'|'blocked'). The schema has no
   * 'cancelled' status, so the record is honestly DELETED (guarded single
   * winner). 'completed' is terminal and can never be cancelled.
   */
  cancelOffboarding: auditedAdminProcedure
    .input(z.object({
      tenantId: z.number().int().positive(),
      totpCode: z.string().length(6).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await requireTotpStepUp(ctx.user.id, input.totpCode, "BDC tenant offboarding cancel");

      const removed = (await db.execute(sql`
        DELETE FROM bdc_tenant_offboardings
        WHERE tenant_id = ${input.tenantId} AND status IN ('requested', 'blocked')
        RETURNING id, status
      `)) as unknown as Array<{ id: number; status: string }>;

      if (removed.length === 0) {
        const existing = (await db.execute(sql`
          SELECT status FROM bdc_tenant_offboardings WHERE tenant_id = ${input.tenantId} LIMIT 1
        `)) as unknown as Array<{ status: string }>;
        throw new TRPCError({
          code: "CONFLICT",
          message: existing.length === 0
            ? `No offboarding in flight for tenant ${input.tenantId}`
            : `Offboarding for tenant ${input.tenantId} is not cancellable from status '${existing[0].status}' (only requested|blocked)`,
        });
      }

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_OFFBOARDING_CANCELLED",
        targetType: "bdc_tenant_offboardings",
        targetId: removed[0].id,
        description: `Tenant ${input.tenantId} offboarding cancelled from status '${removed[0].status}'`,
        metadata: { tenantId: input.tenantId, previousStatus: removed[0].status },
      });

      return { tenantId: input.tenantId, cancelled: true as const, previousStatus: removed[0].status };
    }),
});
