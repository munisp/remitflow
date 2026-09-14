/**
 * SPEC-bdc §5 — BDC orchestration activities (worker side, task queue
 * `bdc-orchestration`). Implements the activity contract consumed by
 * server/temporal/workflows-bdc.ts.
 *
 * Design rules honored here:
 *   - Fail closed (SPEC §0.3): DB/Kafka/adapter outages THROW — Temporal's
 *     retry policy re-runs; nothing is fabricated.
 *   - Idempotent: every mutation is a guarded single-winner UPDATE
 *     (WHERE status = <expected>) or a deterministic-keyed Kafka publish via
 *     the existing outbox-style publishEvent helper (trace/tenant headers
 *     injected by server/middleware/kafka.ts).
 *   - Tenant scoping (SPEC §0.9): batches/returns are identity-PK lookups
 *     (workflow args carry no tenant); every MUTATION re-filters on the row's
 *     own tenantId and every emitted event carries tenantId. The recon cron
 *     iterates DISTINCT tenant_ids and computes each tenant's variance with
 *     tenant-filtered queries.
 *   - This module is NEVER bundled into the workflow isolate: workflows-bdc.ts
 *     imports it type-only. Heavy deps are dynamically imported inside each
 *     activity body (mirrors apApprovalWorkflow/arAgingWorkflow).
 *
 * Orchestrator wiring: register a Worker with taskQueue =
 * BDC_WORKFLOW_TASK_QUEUE, workflowsPath = workflows-bdc.js, activities =
 * bdcActivities (or the named exports), bundlerOptions.ignoreModules per the
 * workflows-bdc.ts header.
 */

/** Task queue for all BDC orchestration workflows (matches existing naming:
 *  "ap-approvals", "ar-aging" → "bdc-orchestration"). */
export const BDC_WORKFLOW_TASK_QUEUE = "bdc-orchestration";

/**
 * Non-retryable activity error — Temporal matches err.name against
 * nonRetryableErrorTypes in the workflow's retry policy. Used when the
 * activity has already recorded the failure honestly (row 'failed' +
 * quarantine payload) and a retry would be pointless.
 */
export class BdcNonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BdcNonRetryableError";
  }
}

/** Base URL of the C1 go-bdc-regulatory-returns service (SPEC §4.1). */
function bdcReturnsServiceUrl(): string {
  return process.env.BDC_RETURNS_SERVICE_URL ?? "http://localhost:8140";
}

/**
 * Recon breach threshold: a tenant's UNSETTLED (still 'accrued') IMTO naira
 * total for the period must exceed ₦100,000.00 before a BDC_POSITION_BREACH
 * alert is published. Below the threshold the variance is still reported in
 * the returned report payload (and in the workflow history) — it is simply
 * not alert-worthy. Ops-tunable constant; change requires a deploy.
 */
export const BDC_RECON_VARIANCE_THRESHOLD_NGN = 100000;

// ─── Activity interface (type-only import target for workflows-bdc.ts) ───────

export interface BdcBatchDeadlineInfo {
  found: boolean;
  status?: string;
  /** ISO timestamp of the liquidation deadline; null when the batch has none. */
  deadlineAt: string | null;
  /** Milliseconds until the deadline, clamped ≥ 0 (computed activity-side —
   *  workflow code never touches Date.now). */
  msUntilDeadline: number;
}

export type BdcForceLiquidationOutcome = "expired" | "already_terminal" | "not_found";

export type BdcReturnSubmitOutcome = "acknowledged" | "submitted_pending_ack" | "already_terminal";

export interface BdcAckTimeoutCheck {
  alerted: boolean;
  status: string;
}

export interface BdcReconTenantReport {
  tenantId: number;
  accruedCount: number;
  accruedNgn: number;
  settledCount: number;
  settledNgn: number;
  commissionNgn: number;
  varianceNgn: number;
  exceedsThreshold: boolean;
  /** Unsettled rows (still 'accrued' at period end) — the variance detail. */
  unsettled: Array<{
    id: number;
    mojaloopTransferId: string | null;
    fxAmount: string;
    nairaPaid: string;
    commission: string;
    createdAt: string;
  }>;
}

export interface BdcReconReport {
  imtoCode: string;
  period: string;
  windowStart: string;
  windowEnd: string;
  thresholdNgn: number;
  tenants: BdcReconTenantReport[];
  breachEventsPublished: number;
}

export interface BdcActivities {
  getBatchDeadline(batchId: number): Promise<BdcBatchDeadlineInfo>;
  getBatchStatus(batchId: number): Promise<string>;
  forceLiquidationActivity(batchId: number): Promise<BdcForceLiquidationOutcome>;
  submitReturnActivity(returnId: number): Promise<BdcReturnSubmitOutcome>;
  publishReturnAckTimeoutAlert(returnId: number): Promise<BdcAckTimeoutCheck>;
  reconcileActivity(imtoCode: string, period: string): Promise<BdcReconReport>;
}

// ─── NFEM batch activities ───────────────────────────────────────────────────

export async function getBatchDeadline(batchId: number): Promise<BdcBatchDeadlineInfo> {
  const { getDb } = await import("../db.js");
  const { bdcNfemPurchaseBatches } = await import("../../drizzle/schema.js");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("[BDC] Database unavailable — getBatchDeadline failing closed");

  const [row] = await db
    .select({ status: bdcNfemPurchaseBatches.status, deadlineAt: bdcNfemPurchaseBatches.deadlineAt })
    .from(bdcNfemPurchaseBatches)
    .where(eq(bdcNfemPurchaseBatches.id, batchId))
    .limit(1);

  if (!row) return { found: false, deadlineAt: null, msUntilDeadline: 0 };
  const deadlineAt = row.deadlineAt ? new Date(row.deadlineAt).toISOString() : null;
  const msUntilDeadline = row.deadlineAt
    ? Math.max(0, new Date(row.deadlineAt).getTime() - Date.now())
    : 0;
  return { found: true, status: row.status ?? undefined, deadlineAt, msUntilDeadline };
}

export async function getBatchStatus(batchId: number): Promise<string> {
  const { getDb } = await import("../db.js");
  const { bdcNfemPurchaseBatches } = await import("../../drizzle/schema.js");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("[BDC] Database unavailable — getBatchStatus failing closed");

  const [row] = await db
    .select({ status: bdcNfemPurchaseBatches.status })
    .from(bdcNfemPurchaseBatches)
    .where(eq(bdcNfemPurchaseBatches.id, batchId))
    .limit(1);
  return row?.status ?? "not_found";
}

/**
 * Force-expire a batch whose 24h selling window elapsed. Guarded flip
 * 'selling' → 'expired' (single winner; concurrent dealer liquidation wins
 * and this becomes a no-op). On success publishes the BDC_NFEM_ALERTS event.
 *
 * DEVIATION (documented for orchestrator): SPEC §5 asks for a "liquidation
 * task row". The BDC schema (additive-only, W0-owned) has no task table and
 * bdc_nfem_purchase_batches has no payload column, so the liquidation task is
 * carried INSIDE the alert event payload (`task` field) for the dealer-ops
 * consumer to action. If a task table is added later, insert it here.
 */
export async function forceLiquidationActivity(batchId: number): Promise<BdcForceLiquidationOutcome> {
  const { getDb } = await import("../db.js");
  const { sql } = await import("drizzle-orm");
  const { KAFKA_TOPICS, publishEvent } = await import("../middleware/kafka.js");
  const { logger } = await import("../_core/logger.js");
  const db = await getDb();
  if (!db) throw new Error("[BDC] Database unavailable — forceLiquidationActivity failing closed");

  const flipped = (await db.execute(sql`
    UPDATE bdc_nfem_purchase_batches
    SET status = 'expired', updated_at = NOW()
    WHERE id = ${batchId} AND status = 'selling'
    RETURNING id, tenant_id AS "tenantId", amount_usd AS "amountUsd",
              fxbt_reference AS "fxbtReference", deadline_at AS "deadlineAt"
  `)) as unknown as Array<{
    id: number;
    tenantId: number;
    amountUsd: string;
    fxbtReference: string | null;
    deadlineAt: string | null;
  }>;

  if (flipped.length === 0) {
    const existing = (await db.execute(sql`
      SELECT status FROM bdc_nfem_purchase_batches WHERE id = ${batchId} LIMIT 1
    `)) as unknown as Array<{ status: string }>;
    return existing.length === 0 ? "not_found" : "already_terminal";
  }

  const batch = flipped[0];
  await publishEvent(KAFKA_TOPICS.BDC_NFEM_ALERTS, `bdc-nfem-batch:${batchId}:expired`, {
    eventType: "bdc.nfem.batch.expired",
    batchId,
    tenantId: batch.tenantId,
    amountUsd: batch.amountUsd,
    fxbtReference: batch.fxbtReference,
    deadlineAt: batch.deadlineAt,
    reason: "24h liquidation deadline elapsed with batch still 'selling'",
    task: {
      type: "manual_liquidation",
      batchId,
      tenantId: batch.tenantId,
      instructions: "Batch force-expired by bdcNfemBatchLifecycleWorkflow. Dealer must liquidate or return the USD position to the funding bank and record the naira leg; then markBatchLiquidated/markBatchReturned cannot apply (batch is terminal 'expired') — handle via eodClose sweep reporting.",
    },
    timestamp: new Date().toISOString(),
  }).catch((err: unknown) =>
    logger.warn({ err: err instanceof Error ? err.message : String(err), batchId }, "[BDC] NFEM expiry alert publish failed (row already expired — alert degraded, not lost: workflow history has the outcome)"),
  );

  return "expired";
}

// ─── Regulatory return activities ────────────────────────────────────────────

/**
 * Submit a staged/submitted regulatory return to the C1
 * go-bdc-regulatory-returns adapter (SPEC §4.1 POST /returns/submit).
 *
 * Honest modes (SPEC §0.4):
 *   - adapter 503 / network error      → retryable throw (Temporal retries;
 *                                        row stays 'submitted')
 *   - adapter 4xx validation rejection → row 'failed' + quarantine payload in
 *                                        errorDetail, BDC_RETURNS_STATUS
 *                                        event, then BdcNonRetryableError
 *   - { simulated: true, ackRef }      → sandbox ack is NOT a regulator ack:
 *                                        row stays 'submitted'
 *                                        (submitted pending real ack)
 *   - { ackRef } (no simulated marker) → guarded flip submitted → acknowledged
 */
export async function submitReturnActivity(returnId: number): Promise<BdcReturnSubmitOutcome> {
  const { getDb } = await import("../db.js");
  const { sql } = await import("drizzle-orm");
  const { callService, ServiceCallError } = await import("../_core/serviceProxy.js");
  const { KAFKA_TOPICS, publishEvent } = await import("../middleware/kafka.js");
  const { logger } = await import("../_core/logger.js");
  const db = await getDb();
  if (!db) throw new Error("[BDC] Database unavailable — submitReturnActivity failing closed");

  const rows = (await db.execute(sql`
    SELECT id, tenant_id AS "tenantId", return_type AS "returnType", payload,
           status, idempotency_key AS "idempotencyKey"
    FROM bdc_regulatory_returns WHERE id = ${returnId} LIMIT 1
  `)) as unknown as Array<{
    id: number;
    tenantId: number;
    returnType: string;
    payload: unknown;
    status: string;
    idempotencyKey: string;
  }>;
  const ret = rows[0];
  if (!ret) throw new BdcNonRetryableError(`[BDC] regulatory return ${returnId} not found`);
  if (ret.status === "acknowledged") return "acknowledged"; // idempotent re-entry
  if (ret.status !== "staged" && ret.status !== "submitted") {
    return "already_terminal"; // quarantined / failed / draft — nothing to submit
  }
  if (ret.payload === null || ret.payload === undefined) {
    await markReturnFailed(db, sql, publishEvent, KAFKA_TOPICS, logger, ret, "no staged payload built — call buildReturn first", null);
    throw new BdcNonRetryableError(`[BDC] regulatory return ${returnId} has no payload — failed + quarantined`);
  }

  // Guarded (idempotent) transition to 'submitted' with submittedAt stamped.
  await db.execute(sql`
    UPDATE bdc_regulatory_returns
    SET status = 'submitted', submitted_at = COALESCE(submitted_at, NOW()), updated_at = NOW()
    WHERE id = ${returnId} AND status IN ('staged', 'submitted')
  `);

  let adapterResp: { simulated?: boolean; ackRef?: string; validationErrors?: unknown[] };
  try {
    adapterResp = await callService<typeof adapterResp>(`${bdcReturnsServiceUrl()}/returns/submit`, {
      method: "POST",
      body: { tenantId: ret.tenantId, returnType: ret.returnType, payload: ret.payload },
      timeoutMs: 15_000,
      retries: 0, // retries are owned by the Temporal retry policy
    });
  } catch (err) {
    if (err instanceof ServiceCallError && err.status >= 400 && err.status < 500 && err.status !== 429) {
      // Definitive adapter rejection — quarantine honestly, do not retry.
      await markReturnFailed(db, sql, publishEvent, KAFKA_TOPICS, logger, ret, err.message, err.status);
      throw new BdcNonRetryableError(`[BDC] return ${returnId} rejected by adapter: ${err.message}`);
    }
    // 5xx / 429 / network → retryable; row stays 'submitted'.
    throw err;
  }

  if (adapterResp?.simulated === true) {
    // Sandbox mode: explicit simulated marker — NOT a regulator ack (§0.4).
    await publishEvent(KAFKA_TOPICS.BDC_RETURNS_STATUS, `bdc-return:${returnId}:submitted`, {
      eventType: "bdc.return.submitted",
      returnId,
      tenantId: ret.tenantId,
      returnType: ret.returnType,
      simulated: true,
      simAckRef: adapterResp.ackRef ?? null,
      note: "Sandbox submission — row stays 'submitted' pending a real ack channel",
      timestamp: new Date().toISOString(),
    }).catch((err: unknown) =>
      logger.warn({ err: err instanceof Error ? err.message : String(err), returnId }, "[BDC] return submitted event publish failed (non-critical)"),
    );
    return "submitted_pending_ack";
  }

  if (adapterResp?.ackRef) {
    // Real adapter ack — guarded single-winner flip submitted → acknowledged.
    const flipped = (await db.execute(sql`
      UPDATE bdc_regulatory_returns
      SET status = 'acknowledged', ack_ref = ${adapterResp.ackRef}, ack_at = NOW(), updated_at = NOW()
      WHERE id = ${returnId} AND status = 'submitted'
      RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (flipped.length === 1) {
      await publishEvent(KAFKA_TOPICS.BDC_RETURNS_STATUS, `bdc-return:${returnId}:acknowledged`, {
        eventType: "bdc.return.acknowledged",
        returnId,
        tenantId: ret.tenantId,
        returnType: ret.returnType,
        ackRef: adapterResp.ackRef,
        timestamp: new Date().toISOString(),
      }).catch((err: unknown) =>
        logger.warn({ err: err instanceof Error ? err.message : String(err), returnId }, "[BDC] return acknowledged event publish failed (non-critical)"),
      );
    }
    return "acknowledged";
  }

  // No ack material at all — stay honestly 'submitted'.
  return "submitted_pending_ack";
}

/** Mark a return 'failed' with a quarantine payload (errorDetail) + event. */
async function markReturnFailed(
  db: any,
  sql: any,
  publishEvent: any,
  KAFKA_TOPICS: any,
  logger: any,
  ret: { id: number; tenantId: number; returnType: string },
  reason: string,
  adapterStatus: number | null,
): Promise<void> {
  const quarantinePayload = {
    quarantined: true,
    reason,
    adapterStatus,
    quarantinedAt: new Date().toISOString(),
    retryPath: "reporting.retryQuarantined (re-stage with -R{n} idempotency suffix)",
  };
  await db.execute(sql`
    UPDATE bdc_regulatory_returns
    SET status = 'failed', error_detail = ${JSON.stringify(quarantinePayload)}, updated_at = NOW()
    WHERE id = ${ret.id} AND status IN ('staged', 'submitted')
  `);
  await publishEvent(KAFKA_TOPICS.BDC_RETURNS_STATUS, `bdc-return:${ret.id}:failed`, {
    eventType: "bdc.return.failed",
    returnId: ret.id,
    tenantId: ret.tenantId,
    returnType: ret.returnType,
    quarantine: quarantinePayload,
    timestamp: new Date().toISOString(),
  }).catch((err: unknown) =>
    logger.warn({ err: err instanceof Error ? err.message : String(err), returnId: ret.id }, "[BDC] return failed event publish failed (non-critical)"),
  );
}

/**
 * 72h ack-timeout check (SPEC §5): if the return is STILL 'submitted' after
 * the ack window, publish a BDC_RETURNS_STATUS alert. The row intentionally
 * stays 'submitted' — no fabricated failure or ack.
 */
export async function publishReturnAckTimeoutAlert(returnId: number): Promise<BdcAckTimeoutCheck> {
  const { getDb } = await import("../db.js");
  const { sql } = await import("drizzle-orm");
  const { KAFKA_TOPICS, publishEvent } = await import("../middleware/kafka.js");
  const { logger } = await import("../_core/logger.js");
  const db = await getDb();
  if (!db) throw new Error("[BDC] Database unavailable — publishReturnAckTimeoutAlert failing closed");

  const rows = (await db.execute(sql`
    SELECT tenant_id AS "tenantId", return_type AS "returnType", status, submitted_at AS "submittedAt"
    FROM bdc_regulatory_returns WHERE id = ${returnId} LIMIT 1
  `)) as unknown as Array<{ tenantId: number; returnType: string; status: string; submittedAt: string | null }>;
  const ret = rows[0];
  if (!ret) throw new BdcNonRetryableError(`[BDC] regulatory return ${returnId} not found at ack-timeout check`);
  if (ret.status !== "submitted") {
    return { alerted: false, status: ret.status };
  }

  await publishEvent(KAFKA_TOPICS.BDC_RETURNS_STATUS, `bdc-return:${returnId}:ack_timeout`, {
    eventType: "bdc.return.ack_timeout",
    returnId,
    tenantId: ret.tenantId,
    returnType: ret.returnType,
    submittedAt: ret.submittedAt,
    note: "No regulator ack within 72h — status stays 'submitted' (honest); MLRO to follow up via ackReturn or retryQuarantined",
    timestamp: new Date().toISOString(),
  }).catch((err: unknown) =>
    logger.warn({ err: err instanceof Error ? err.message : String(err), returnId }, "[BDC] ack-timeout alert publish failed"),
  );
  return { alerted: true, status: ret.status };
}

// ─── IMTO settlement reconciliation activity ─────────────────────────────────

/**
 * Daily recon for one IMTO over a "YYYY-MM" (UTC) period. For EVERY tenant
 * with settlement rows in the window (each computed with tenant-filtered
 * queries per SPEC §0.9), builds the variance report: rows still 'accrued'
 * at period end are the unsettled variance. Publishes BDC_POSITION_BREACH
 * only when a tenant's unsettled naira total exceeds
 * BDC_RECON_VARIANCE_THRESHOLD_NGN.
 *
 * DEVIATION (documented): SPEC §5 says the activity "writes variance report
 * payload". The BDC schema has no recon-report table and B4 cannot add one
 * (additive-only, W0-owned), so the report payload is (a) returned to the
 * workflow (persisted in Temporal history) and (b) embedded in the breach
 * event when published. If a report table is added later, insert it here.
 */
export async function reconcileActivity(imtoCode: string, period: string): Promise<BdcReconReport> {
  const { getDb } = await import("../db.js");
  const { sql } = await import("drizzle-orm");
  const { KAFKA_TOPICS, publishEvent } = await import("../middleware/kafka.js");
  const { logger } = await import("../_core/logger.js");
  const db = await getDb();
  if (!db) throw new Error("[BDC] Database unavailable — reconcileActivity failing closed");

  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new BdcNonRetryableError(`[BDC] invalid recon period '${period}' — expected YYYY-MM`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new BdcNonRetryableError(`[BDC] invalid recon period '${period}' — month out of range`);
  const windowStart = new Date(Date.UTC(year, month - 1, 1));
  const windowEnd = new Date(Date.UTC(year, month, 1));

  const tenantRows = (await db.execute(sql`
    SELECT DISTINCT tenant_id AS "tenantId"
    FROM bdc_imto_settlements
    WHERE imto_code = ${imtoCode}
      AND created_at >= ${windowStart.toISOString()}
      AND created_at < ${windowEnd.toISOString()}
  `)) as unknown as Array<{ tenantId: number }>;

  const report: BdcReconReport = {
    imtoCode,
    period,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    thresholdNgn: BDC_RECON_VARIANCE_THRESHOLD_NGN,
    tenants: [],
    breachEventsPublished: 0,
  };

  for (const { tenantId } of tenantRows) {
    const accrued = (await db.execute(sql`
      SELECT id, mojaloop_transfer_id AS "mojaloopTransferId", fx_amount AS "fxAmount",
             naira_paid AS "nairaPaid", commission, created_at AS "createdAt"
      FROM bdc_imto_settlements
      WHERE tenant_id = ${tenantId} AND imto_code = ${imtoCode} AND status = 'accrued'
        AND created_at >= ${windowStart.toISOString()}
        AND created_at < ${windowEnd.toISOString()}
      ORDER BY id
    `)) as unknown as Array<{
      id: number; mojaloopTransferId: string | null; fxAmount: string;
      nairaPaid: string; commission: string; createdAt: string;
    }>;

    const settledAgg = (await db.execute(sql`
      SELECT COUNT(*)::int AS "count", COALESCE(SUM(naira_paid), 0)::text AS "naira",
             COALESCE(SUM(commission), 0)::text AS "commission"
      FROM bdc_imto_settlements
      WHERE tenant_id = ${tenantId} AND imto_code = ${imtoCode} AND status = 'settled'
        AND created_at >= ${windowStart.toISOString()}
        AND created_at < ${windowEnd.toISOString()}
    `)) as unknown as Array<{ count: number; naira: string; commission: string }>;

    const accruedNgn = accrued.reduce((sum, r) => sum + Number(r.nairaPaid), 0);
    const varianceNgn = accruedNgn; // unsettled-at-period-end = variance vs IMTO statement
    const exceedsThreshold = Math.abs(varianceNgn) > BDC_RECON_VARIANCE_THRESHOLD_NGN;

    const tenantReport: BdcReconTenantReport = {
      tenantId,
      accruedCount: accrued.length,
      accruedNgn,
      settledCount: settledAgg[0]?.count ?? 0,
      settledNgn: Number(settledAgg[0]?.naira ?? 0),
      commissionNgn: Number(settledAgg[0]?.commission ?? 0),
      varianceNgn,
      exceedsThreshold,
      unsettled: accrued.map((r) => ({
        id: r.id,
        mojaloopTransferId: r.mojaloopTransferId,
        fxAmount: String(r.fxAmount),
        nairaPaid: String(r.nairaPaid),
        commission: String(r.commission),
        createdAt: new Date(r.createdAt).toISOString(),
      })),
    };
    report.tenants.push(tenantReport);

    if (exceedsThreshold) {
      const published = await publishEvent(
        KAFKA_TOPICS.BDC_POSITION_BREACH,
        `bdc-recon:${tenantId}:${imtoCode}:${period}`,
        {
          eventType: "bdc.imto.settlement_variance",
          tenantId,
          imtoCode,
          period,
          varianceNgn,
          thresholdNgn: BDC_RECON_VARIANCE_THRESHOLD_NGN,
          unsettledCount: accrued.length,
          unsettled: tenantReport.unsettled,
          note: "Unsettled IMTO settlement total exceeds recon threshold — finance to investigate via bdc.imto.reconcileSettlements",
          timestamp: new Date().toISOString(),
        },
      ).catch((err: unknown) => {
        logger.warn({ err: err instanceof Error ? err.message : String(err), tenantId, imtoCode, period }, "[BDC] position-breach publish failed");
        return false;
      });
      if (published) report.breachEventsPublished += 1;
    }
  }

  logger.info(
    { imtoCode, period, tenants: report.tenants.length, breaches: report.breachEventsPublished },
    "[BDC] settlement recon complete",
  );
  return report;
}

// ─── Registration object (worker imports this or the named exports) ──────────

export const bdcActivities: BdcActivities = {
  getBatchDeadline,
  getBatchStatus,
  forceLiquidationActivity,
  submitReturnActivity,
  publishReturnAckTimeoutAlert,
  reconcileActivity,
};
