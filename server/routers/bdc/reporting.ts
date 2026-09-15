/**
 * BDC Regulatory Returns Router — SPEC-bdc §3.9 (owner: B3)
 *
 * Staging, submission, acknowledgement, retry and evidence packs for the
 * CBN FIFX / FinA / CARP / TRMS / extranet returns.
 *
 * Service integration (C1 contract §4.1):
 *  - POST {BDC_RETURNS_SERVICE_URL}/returns/build  {tenantId, returnType,
 *    periodStart, periodEnd, data} → {payload, validationErrors[], formatVersion}
 *  - POST {BDC_RETURNS_SERVICE_URL}/returns/submit {returnType, payload} →
 *    sandbox: {simulated:true, ackRef:"SIM-..."}; production w/o creds: 503.
 *  Calls go through callService (server/_core/serviceProxy.ts) which injects
 *  W3C trace-context + X-Tenant-Id headers. Outage → UNAVAILABLE (fail-closed,
 *  SPEC §0.3/§0.4 — never fabricated).
 *
 * Honest states: sandbox ackRef 'SIM-...' leaves status 'submitted' — a return
 * is only 'acknowledged' via ackReturn (real or callback-confirmed ack).
 * temporalWorkflowId stays null until B4 wires bdcReturnSubmissionWorkflow.
 *
 * Idempotency: base key `BDC-RET-{type}-{tenantId}-{periodStart}-{periodEnd}`
 * (unique column); retries insert with suffix `-R{n}`.
 *
 * Evidence packs: lakehouseWrite (server/lakehouse.service.ts router-facing
 * HTTP client to python-lakehouse) — unavailable → explicit UNAVAILABLE,
 * never a fabricated pack.
 *
 * TOTP (requireTotpStepUp): submitReturn, ackReturn.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lt, like, or } from "drizzle-orm";
import { router, auditedProcedure, auditedAdminProcedure } from "../../_core/trpc";
import { getDb } from "../../db";
import {
  bdcPositionSnapshots,
  bdcRegulatoryReturns,
  bdcTransactions,
} from "../../../drizzle/schema";
import { resolveTenantContext } from "../../tenantMiddleware";
import { requireTotpStepUp } from "../../_core/totpStepUp";
import { createAuditLog } from "../../audit.service";
import { callService } from "../../_core/serviceProxy";
import { lakehouseWrite } from "../../lakehouse.service";
import { logger } from "../../_core/logger";
import { getBdcProfile } from "./_shared";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RETURN_TYPES = ["fifx", "fina", "carp", "trms", "extranet"] as const;
const RETURN_STATUSES = ["draft", "staged", "submitted", "acknowledged", "quarantined", "failed"] as const;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

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
    throw new TRPCError({ code: "FORBIDDEN", message: "An active tenant is required for BDC regulatory returns." });
  }
  return tenant.tenantId;
}

function returnsServiceUrl(): string {
  const url = process.env.BDC_RETURNS_SERVICE_URL;
  if (!url) {
    // Fail closed (SPEC §0.4): no configured service → UNAVAILABLE, never fabricate.
    throw new TRPCError({
      code: "UNAVAILABLE",
      message: "BDC_RETURNS_SERVICE_URL is not configured — regulatory returns service unavailable (fail-closed)",
    });
  }
  return url.replace(/\/$/, "");
}

/** Inclusive period → [startUtc, endExclusiveUtc). */
function periodBounds(periodStart: string, periodEnd: string): { start: Date; endExclusive: Date } {
  const start = new Date(`${periodStart}T00:00:00.000Z`);
  const endExclusive = new Date(new Date(`${periodEnd}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid period dates" });
  }
  if (start >= endExclusive) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "periodStart must be on or before periodEnd" });
  }
  return { start, endExclusive };
}

async function loadReturn(db: any, tenantId: number, returnId: number) {
  const [row] = await db
    .select()
    .from(bdcRegulatoryReturns)
    .where(and(eq(bdcRegulatoryReturns.id, returnId), eq(bdcRegulatoryReturns.tenantId, tenantId)))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Regulatory return ${returnId} not found` });
  }
  return row;
}

/**
 * Allocate an idempotency key: base key on first build, `-R{n}` suffix on
 * retries (n = number of prior attempts with this base).
 */
async function allocateIdempotencyKey(db: any, tenantId: number, base: string): Promise<string> {
  const existing = await db
    .select({ idempotencyKey: bdcRegulatoryReturns.idempotencyKey })
    .from(bdcRegulatoryReturns)
    .where(
      and(
        eq(bdcRegulatoryReturns.tenantId, tenantId),
        or(eq(bdcRegulatoryReturns.idempotencyKey, base), like(bdcRegulatoryReturns.idempotencyKey, `${base}-R%`)),
      ),
    );
  if (existing.length === 0) return base;
  return `${base}-R${existing.length}`;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const bdcReportingRouter = router({
  /**
   * MLRO/finance: gather the tenant's period data, build the return payload
   * via go-bdc-regulatory-returns, and stage it (status 'staged').
   */
  buildReturn: auditedAdminProcedure
    .input(z.object({
      returnType: z.enum(RETURN_TYPES),
      periodStart: dateSchema,
      periodEnd: dateSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);
      const { start, endExclusive } = periodBounds(input.periodStart, input.periodEnd);
      const baseUrl = returnsServiceUrl();

      // Gather tenant data for the period (transactions + position snapshots).
      const [transactions, positionSnapshots] = await Promise.all([
        db
          .select()
          .from(bdcTransactions)
          .where(
            and(
              eq(bdcTransactions.tenantId, tenantId),
              gte(bdcTransactions.createdAt, start),
              lt(bdcTransactions.createdAt, endExclusive),
            ),
          )
          .orderBy(bdcTransactions.createdAt),
        db
          .select()
          .from(bdcPositionSnapshots)
          .where(
            and(
              eq(bdcPositionSnapshots.tenantId, tenantId),
              gte(bdcPositionSnapshots.snapshotAt, start),
              lt(bdcPositionSnapshots.snapshotAt, endExclusive),
            ),
          )
          .orderBy(bdcPositionSnapshots.snapshotAt),
      ]);

      let built: { payload: unknown; validationErrors?: unknown[]; formatVersion?: string };
      try {
        built = await callService<typeof built>(`${baseUrl}/returns/build`, {
          method: "POST",
          body: {
            tenantId,
            returnType: input.returnType,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            data: { transactions, positionSnapshots },
          },
          timeoutMs: 15_000,
        });
      } catch (err) {
        logger.error({ err, returnType: input.returnType }, "[BDC] returns/build call failed — fail-closed");
        throw new TRPCError({
          code: "UNAVAILABLE",
          message: "Regulatory returns service unavailable — return not staged (fail-closed)",
          cause: err,
        });
      }

      const baseKey = `BDC-RET-${input.returnType}-${tenantId}-${input.periodStart}-${input.periodEnd}`;
      const idempotencyKey = await allocateIdempotencyKey(db, tenantId, baseKey);

      const [row] = await db
        .insert(bdcRegulatoryReturns)
        .values({
          tenantId,
          returnType: input.returnType,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          payload: {
            built: built.payload ?? null,
            validationErrors: built.validationErrors ?? [],
            sourceRowCounts: {
              transactions: transactions.length,
              positionSnapshots: positionSnapshots.length,
            },
          },
          formatVersion: built.formatVersion ?? "v1-fixture",
          status: "staged",
          idempotencyKey,
          temporalWorkflowId: null, // B4 wires bdcReturnSubmissionWorkflow here
        })
        .returning();

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_RETURN_STAGED",
        targetType: "bdc_regulatory_returns",
        targetId: row.id,
        description: `${input.returnType} return staged for ${input.periodStart}..${input.periodEnd} (key ${idempotencyKey})`,
        metadata: {
          tenantId,
          returnType: input.returnType,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          idempotencyKey,
          validationErrors: built.validationErrors ?? [],
        },
      });

      return row;
    }),

  /**
   * MLRO + TOTP: guarded flip staged→submitted (single winner), then adapter
   * submit. Sandbox ackRef 'SIM-...' leaves status 'submitted' (ack only via
   * ackReturn). Adapter failure after the flip → row reverted to 'staged'
   * with errorDetail and UNAVAILABLE thrown.
   */
  submitReturn: auditedAdminProcedure
    .input(z.object({
      returnId: z.number().int().positive(),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      await getBdcProfile(db, tenantId);
      await requireTotpStepUp(ctx.user.id, input.totpCode, "regulatory return submission");
      const row = await loadReturn(db, tenantId, input.returnId);
      const baseUrl = returnsServiceUrl();

      // Guarded single-winner claim.
      const claimed = await db
        .update(bdcRegulatoryReturns)
        .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(bdcRegulatoryReturns.id, row.id),
            eq(bdcRegulatoryReturns.tenantId, tenantId),
            eq(bdcRegulatoryReturns.status, "staged"),
          ),
        )
        .returning();
      if (claimed.length === 0) {
        // Idempotent replay (F7): a return already past the guarded flip
        // replays its existing snapshot — NEVER a second adapter submission,
        // a second Temporal workflow start, or another attempt increment.
        if (row.status === "submitted" || row.status === "acknowledged") {
          return { return: row, ackRef: row.ackRef ?? null, simulated: false, replay: true as const };
        }
        throw new TRPCError({
          code: "CONFLICT",
          message: `Return ${row.id} is not staged (current status '${row.status}') — already claimed or invalid state`,
        });
      }

      const payloadBody = (row.payload as Record<string, unknown> | null)?.built ?? row.payload;
      let submitResult: { simulated?: boolean; ackRef?: string; reason?: string };
      try {
        submitResult = await callService<typeof submitResult>(`${baseUrl}/returns/submit`, {
          method: "POST",
          body: { returnType: row.returnType, payload: payloadBody },
          timeoutMs: 15_000,
        });
      } catch (err) {
        // Submission leg failed after the claim — revert to staged (honest:
        // nothing reached the regulator) and surface UNAVAILABLE.
        await db
          .update(bdcRegulatoryReturns)
          .set({
            status: "staged",
            submittedAt: null,
            errorDetail: `submit failed: ${(err as Error).message}`.slice(0, 1000),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(bdcRegulatoryReturns.id, row.id),
              eq(bdcRegulatoryReturns.tenantId, tenantId),
              eq(bdcRegulatoryReturns.status, "submitted"),
            ),
          );
        logger.error({ err, returnId: row.id }, "[BDC] returns/submit failed — reverted to staged");
        throw new TRPCError({
          code: "UNAVAILABLE",
          message: "Regulatory returns service unavailable during submit — return reverted to 'staged' (fail-closed)",
          cause: err,
        });
      }

      const ackRef = submitResult.ackRef ?? null;
      // Status stays 'submitted' — NEVER 'acknowledged' here (even for the
      // sandbox SIM- ack); acknowledgement only via ackReturn.
      // Start the ack-tracking/retry workflow (72h ack timeout alert lives
      // there). Fail-soft: Temporal outage never blocks the submission — the
      // return is already honestly 'submitted' and ackReturn remains manual.
      let temporalWorkflowId: string | null = null;
      try {
        const { startBdcReturnSubmission } = await import("../../temporal/workflows-bdc.js");
        const started = await startBdcReturnSubmission(row.id);
        // M22: must match the starter's workflowId format (workflows-bdc.ts).
        if (started) temporalWorkflowId = `bdc-return-submit-${row.id}`;
      } catch (wfErr) {
        logger.warn({ err: wfErr, returnId: row.id }, "[BDC] Temporal unavailable — ack-tracking workflow not started; manual ackReturn remains available");
      }
      const [finalRow] = await db
        .update(bdcRegulatoryReturns)
        .set({
          ackRef,
          errorDetail: null,
          temporalWorkflowId,
          updatedAt: new Date(),
        })
        .where(and(eq(bdcRegulatoryReturns.id, row.id), eq(bdcRegulatoryReturns.tenantId, tenantId)))
        .returning();

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_RETURN_SUBMITTED",
        targetType: "bdc_regulatory_returns",
        targetId: row.id,
        description: `${row.returnType} return ${row.id} submitted (ackRef ${ackRef ?? "none"}, simulated=${submitResult.simulated === true})`,
        metadata: { tenantId, returnId: row.id, ackRef, simulated: submitResult.simulated === true },
      });

      return { return: finalRow, ackRef, simulated: submitResult.simulated === true };
    }),

  /**
   * Admin/callback: guarded submitted→acknowledged with ackRef.
   * ackRef mismatch or explicit error → 'quarantined' + errorDetail.
   */
  ackReturn: auditedAdminProcedure
    .input(z.object({
      returnId: z.number().int().positive(),
      ackRef: z.string().max(96).optional(),
      error: z.string().max(1000).optional(),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      // Regulatory mutation — canonical step-up (F8/F15), same pattern as
      // submitReturn and the other money-moving mutations.
      await requireTotpStepUp(ctx.user.id, input.totpCode, "regulatory return acknowledgement");
      const row = await loadReturn(db, tenantId, input.returnId);

      const quarantine = async (detail: string) => {
        const q = await db
          .update(bdcRegulatoryReturns)
          .set({ status: "quarantined", errorDetail: detail.slice(0, 1000), updatedAt: new Date() })
          .where(
            and(
              eq(bdcRegulatoryReturns.id, row.id),
              eq(bdcRegulatoryReturns.tenantId, tenantId),
              eq(bdcRegulatoryReturns.status, "submitted"),
            ),
          )
          .returning();
        if (q.length === 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Return ${row.id} is not submitted (current status '${row.status}')`,
          });
        }
        await createAuditLog({
          userId: ctx.user.id,
          action: "BDC_RETURN_QUARANTINED",
          targetType: "bdc_regulatory_returns",
          targetId: row.id,
          severity: "critical",
          description: `Return ${row.id} quarantined: ${detail}`,
          metadata: { tenantId, returnId: row.id, detail },
        });
        return q[0];
      };

      if (input.error) {
        return { return: await quarantine(`ack error: ${input.error}`), outcome: "quarantined" as const };
      }
      if (!input.ackRef) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "ackRef is required when no error is supplied" });
      }
      if (row.ackRef && row.ackRef !== input.ackRef) {
        return {
          return: await quarantine(`ackRef mismatch: stored '${row.ackRef}', received '${input.ackRef}'`),
          outcome: "quarantined" as const,
        };
      }

      const acked = await db
        .update(bdcRegulatoryReturns)
        .set({ status: "acknowledged", ackRef: input.ackRef, ackAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(bdcRegulatoryReturns.id, row.id),
            eq(bdcRegulatoryReturns.tenantId, tenantId),
            eq(bdcRegulatoryReturns.status, "submitted"),
          ),
        )
        .returning();
      if (acked.length === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Return ${row.id} is not submitted (current status '${row.status}') — single-winner guard`,
        });
      }

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_RETURN_ACKNOWLEDGED",
        targetType: "bdc_regulatory_returns",
        targetId: row.id,
        description: `Return ${row.id} acknowledged (ackRef ${input.ackRef})`,
        metadata: { tenantId, returnId: row.id, ackRef: input.ackRef },
      });

      return { return: acked[0], outcome: "acknowledged" as const };
    }),

  /** List returns with filters; cursor = last seen id (descending). */
  listReturns: auditedProcedure
    .input(z.object({
      returnType: z.enum(RETURN_TYPES).optional(),
      status: z.enum(RETURN_STATUSES).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      cursor: z.number().int().positive().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const conditions = [eq(bdcRegulatoryReturns.tenantId, tenantId)];
      if (input.returnType) conditions.push(eq(bdcRegulatoryReturns.returnType, input.returnType));
      if (input.status) conditions.push(eq(bdcRegulatoryReturns.status, input.status));
      if (input.cursor) conditions.push(lt(bdcRegulatoryReturns.id, input.cursor));

      const rows = await db
        .select()
        .from(bdcRegulatoryReturns)
        .where(and(...conditions))
        .orderBy(desc(bdcRegulatoryReturns.id))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const page = hasMore ? rows.slice(0, input.limit) : rows;
      return {
        rows: page,
        nextCursor: hasMore ? page[page.length - 1].id : null,
      };
    }),

  /** Single return by id (tenant-scoped). */
  getReturn: auditedProcedure
    .input(z.object({ returnId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      return loadReturn(db, tenantId, input.returnId);
    }),

  /** Re-stage a quarantined return as a NEW staged row with idempotency suffix -R{n}. */
  retryQuarantined: auditedAdminProcedure
    .input(z.object({ returnId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const row = await loadReturn(db, tenantId, input.returnId);
      if (row.status !== "quarantined") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Only quarantined returns can be re-staged (current status '${row.status}')`,
        });
      }

      const base = row.idempotencyKey.replace(/-R\d+$/, "");
      const idempotencyKey = await allocateIdempotencyKey(db, tenantId, base);

      const [restaged] = await db
        .insert(bdcRegulatoryReturns)
        .values({
          tenantId,
          returnType: row.returnType,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          payload: row.payload,
          formatVersion: row.formatVersion,
          status: "staged",
          idempotencyKey,
          temporalWorkflowId: null, // B4 wires bdcReturnSubmissionWorkflow here
        })
        .returning();

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_RETURN_RESTAGED",
        targetType: "bdc_regulatory_returns",
        targetId: restaged.id,
        description: `Quarantined return ${row.id} re-staged as ${restaged.id} (key ${idempotencyKey})`,
        metadata: { tenantId, fromReturnId: row.id, toReturnId: restaged.id, idempotencyKey },
      });

      return restaged;
    }),

  /**
   * MLRO: persist an evidence pack for a return to the lakehouse
   * (server/lakehouse.service.ts → python-lakehouse). Lakehouse unavailable →
   * explicit UNAVAILABLE; nothing is fabricated.
   */
  evidencePack: auditedAdminProcedure
    .input(z.object({ returnId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const tenantId = await requireTenantId(ctx.user.id);
      const row = await loadReturn(db, tenantId, input.returnId);

      const pack = {
        tenantId,
        returnId: row.id,
        returnType: row.returnType,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        status: row.status,
        formatVersion: row.formatVersion,
        payload: row.payload,
        ackRef: row.ackRef,
        submittedAt: row.submittedAt,
        ackAt: row.ackAt,
        generatedByUserId: ctx.user.id,
        generatedAt: new Date().toISOString(),
      };

      let result;
      try {
        result = await lakehouseWrite("bdc_regulatory_evidence", pack, { country: "NG" });
      } catch (err) {
        logger.error({ err, returnId: row.id }, "[BDC] lakehouse evidence pack write failed — fail-closed");
        throw new TRPCError({
          code: "UNAVAILABLE",
          message: "Lakehouse service unavailable — evidence pack NOT generated (fail-closed, nothing fabricated)",
          cause: err,
        });
      }

      await createAuditLog({
        userId: ctx.user.id,
        action: "BDC_EVIDENCE_PACK_WRITTEN",
        targetType: "bdc_regulatory_returns",
        targetId: row.id,
        description: `Evidence pack for return ${row.id} written to lakehouse (${result.path})`,
        metadata: { tenantId, returnId: row.id, lakehouse: result },
      });

      return { returnId: row.id, lakehouse: result };
    }),
});
