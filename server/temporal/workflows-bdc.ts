/**
 * SPEC-bdc §5 — BDC orchestration workflows (task queue `bdc-orchestration`).
 *
 * Workflows (deterministic — sandbox-safe, no direct I/O, no Date.now; all
 * side effects go through activities in server/temporal/activities-bdc.ts):
 *
 *   1. bdcNfemBatchLifecycleWorkflow(batchId)
 *      NFEM purchase batches must be liquidated or returned within 24h of
 *      funding (CBN NFEM rule). The workflow sleeps until the batch's
 *      deadlineAt (fetched via activity — never computed workflow-side), then
 *      re-queries the batch status:
 *        - still 'selling'  → forceLiquidationActivity (guarded flip to
 *                             'expired' + BDC_NFEM_ALERTS event + liquidation
 *                             task payload)
 *        - terminal already → honest no-op.
 *
 *   2. bdcReturnSubmissionWorkflow(returnId)
 *      Submits a staged regulatory return via submitReturnActivity
 *      (repo-standard retry policy: 3 attempts, 5s initial, 2× backoff, 1m
 *      cap — mirrors apApprovalWorkflow). Non-retryable adapter rejection is
 *      handled INSIDE the activity (row marked 'failed' + quarantine payload
 *      recorded in errorDetail) before a BdcNonRetryableError is thrown. On
 *      successful submission without a synchronous regulator ack, the
 *      workflow waits 72 hours and then runs publishReturnAckTimeoutAlert —
 *      the row HONESTLY stays 'submitted' and a BDC_RETURNS_STATUS alert is
 *      emitted; no fabricated acknowledgement.
 *
 *   3. bdcSettlementReconWorkflow(imtoCode, period)
 *      Daily-cron entry: reconcileActivity computes the per-tenant IMTO
 *      settlement variance report and publishes to BDC_POSITION_BREACH only
 *      when the unsettled-naira total exceeds the documented threshold
 *      (BDC_RECON_VARIANCE_THRESHOLD_NGN in activities-bdc.ts).
 *
 * Sandbox discipline (mirrors apApprovalWorkflow/arAgingWorkflow): top-level
 * imports are limited to @temporalio/workflow plus a TYPE-ONLY import of the
 * activity interface. The starter helpers at the bottom run OUTSIDE the
 * isolate (called from routers); every side-effecting module is dynamically
 * imported inside the function body. WORKER REGISTRATION IS ORCHESTRATOR-
 * OWNED: register a Worker on BDC_WORKFLOW_TASK_QUEUE with
 * workflowsPath = workflows-bdc.js, activities from activities-bdc.ts, and
 * bundlerOptions.ignoreModules covering the dynamically imported modules
 * ("./activities-bdc.js", "./temporalClient.js", "../_core/logger.js") —
 * same pattern as AP_WORKFLOW_IGNORE_MODULES in server/temporal/worker.ts.
 */
import { proxyActivities, sleep } from "@temporalio/workflow";
import type {
  BdcActivities,
  BdcBatchDeadlineInfo,
  BdcForceLiquidationOutcome,
  BdcOffboardingOutcome,
  BdcReconReport,
  BdcReturnSubmitOutcome,
} from "./activities-bdc";

// ─── Activity proxies (repo-standard retry policy) ───────────────────────────

const acts = proxyActivities<BdcActivities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
    nonRetryableErrorTypes: ["BdcNonRetryableError"],
  },
});

/** Regulator ack wait window for submitted returns (SPEC-bdc §5: 72h). */
const RETURN_ACK_TIMEOUT_MS = 72 * 60 * 60 * 1000;

// ─── 1. NFEM batch 24h lifecycle ─────────────────────────────────────────────

export interface BdcNfemBatchLifecycleResult {
  batchId: number;
  outcome: BdcForceLiquidationOutcome | "terminal_noop" | "no_deadline" | "not_found";
  status?: string;
}

/**
 * Sleep until the batch's liquidation deadline, then force-expire whatever is
 * still 'selling'. Deterministic: the deadline and the wait duration are
 * computed activity-side; the workflow only passes the returned duration to
 * sleep().
 */
export async function bdcNfemBatchLifecycleWorkflow(batchId: number): Promise<BdcNfemBatchLifecycleResult> {
  const deadline: BdcBatchDeadlineInfo = await acts.getBatchDeadline(batchId);
  if (!deadline.found) {
    return { batchId, outcome: "not_found" };
  }
  if (deadline.deadlineAt === null) {
    // Batch has no deadline (not funded yet / already unwound) — nothing to
    // enforce. Honest no-op; a new workflow is started on funding.
    return { batchId, outcome: "no_deadline", status: deadline.status };
  }

  if (deadline.msUntilDeadline > 0) {
    await sleep(deadline.msUntilDeadline);
  }

  const status = await acts.getBatchStatus(batchId);
  if (status === "selling") {
    const outcome = await acts.forceLiquidationActivity(batchId);
    return { batchId, outcome, status };
  }
  // 'liquidated' | 'returned' | 'expired' (or any non-selling state) → no-op.
  return { batchId, outcome: "terminal_noop", status };
}

// ─── 2. Regulatory return submission + 72h ack watch ─────────────────────────

export interface BdcReturnSubmissionResult {
  returnId: number;
  outcome:
    | "acknowledged"           // regulator ack received (adapter-confirmed)
    | "ack_timeout_alerted"    // still 'submitted' after 72h — alert emitted, state honest
    | "already_terminal"       // nothing to do (idempotent re-entry)
    | "failed";                // non-retryable adapter rejection — row failed + quarantined
  error?: string;
}

export async function bdcReturnSubmissionWorkflow(returnId: number): Promise<BdcReturnSubmissionResult> {
  let submitOutcome: BdcReturnSubmitOutcome;
  try {
    submitOutcome = await acts.submitReturnActivity(returnId);
  } catch (err) {
    // Non-retryable path: the activity already marked the row 'failed' and
    // recorded the quarantine payload before throwing. Retryable adapter
    // outages exhaust the retry policy and surface here too — the row then
    // honestly stays 'submitted' (submission never confirmed).
    return { returnId, outcome: "failed", error: (err as Error).message };
  }

  if (submitOutcome === "acknowledged") {
    return { returnId, outcome: "acknowledged" };
  }
  if (submitOutcome === "already_terminal") {
    return { returnId, outcome: "already_terminal" };
  }

  // 'submitted_pending_ack': wait the 72h regulator ack window, then check.
  await sleep(RETURN_ACK_TIMEOUT_MS);
  const alertOutcome = await acts.publishReturnAckTimeoutAlert(returnId);
  if (alertOutcome === "alerted") {
    return { returnId, outcome: "ack_timeout_alerted" };
  }
  // Ack arrived during the wait (ackReturn flipped the row) → acknowledged.
  return { returnId, outcome: "acknowledged" };
}

// ─── 3. IMTO settlement reconciliation (daily cron) ──────────────────────────

/**
 * Daily recon for one IMTO over one period (format "YYYY-MM", UTC). All work
 * is in the activity: variance report + conditional BDC_POSITION_BREACH
 * alert. Returns the full report so the cron registrar can log/inspect it.
 */
export async function bdcSettlementReconWorkflow(imtoCode: string, period: string): Promise<BdcReconReport> {
  return acts.reconcileActivity(imtoCode, period);
}

// ─── wave12 G7 — tenant offboarding (B6) ─────────────────────────────────────

/**
 * One-shot tenant offboarding evaluation (SPEC-wave12 §4.7): the activity
 * claims the offboarding record (requested|blocked → in_progress), honestly
 * evaluates every blocker (non-zero position, open NFEM batches, unsettled
 * IMTO payouts, open regulatory returns — fail-closed on an unverifiable
 * position), writes the blockers jsonb, and flips to 'completed'
 * (+completed_at) or 'blocked'. Re-running the workflow (re-request) simply
 * re-evaluates current state — idempotent by design.
 */
export async function bdcTenantOffboardingWorkflow(tenantId: number): Promise<BdcOffboardingOutcome> {
  return acts.evaluateOffboardingBlockers(tenantId);
}

// ─── Starter helpers (worker-process side — NOT part of the workflow sandbox) ─
// Called from routers (e.g. B2 sourcing.confirmNfemFunding, B3
// reporting.submitReturn) and the cron registrar. Fail-soft like
// startApApprovalExpiry: Temporal unavailable → warn + false; the caller keeps
// its honest DB state and the sweep/cron backstop still applies.

/** Start the 24h lifecycle watcher for a funded NFEM batch. Idempotent workflowId. */
export async function startBdcNfemBatchLifecycle(batchId: number): Promise<boolean> {
  const { getTemporalClient } = await import("./temporalClient.js");
  const { BDC_WORKFLOW_TASK_QUEUE } = await import("./activities-bdc.js");
  const { logger } = await import("../_core/logger.js");
  try {
    const client = await getTemporalClient();
    await client.start("bdcNfemBatchLifecycleWorkflow", {
      taskQueue: BDC_WORKFLOW_TASK_QUEUE,
      workflowId: `bdc-nfem-batch-${batchId}`,
      args: [batchId],
    });
    return true;
  } catch (err) {
    logger.warn(
      { batchId, err: err instanceof Error ? err.message : String(err) },
      "[BDC] Temporal unavailable — NFEM batch lifecycle workflow not started",
    );
    return false;
  }
}

/** Start the submission + 72h ack-watch workflow for a regulatory return. */
export async function startBdcReturnSubmission(returnId: number): Promise<boolean> {
  const { getTemporalClient } = await import("./temporalClient.js");
  const { BDC_WORKFLOW_TASK_QUEUE } = await import("./activities-bdc.js");
  const { logger } = await import("../_core/logger.js");
  try {
    const client = await getTemporalClient();
    await client.start("bdcReturnSubmissionWorkflow", {
      taskQueue: BDC_WORKFLOW_TASK_QUEUE,
      workflowId: `bdc-return-submit-${returnId}`,
      args: [returnId],
    });
    return true;
  } catch (err) {
    logger.warn(
      { returnId, err: err instanceof Error ? err.message : String(err) },
      "[BDC] Temporal unavailable — return submission workflow not started",
    );
    return false;
  }
}

/** Start a one-shot settlement recon (daily cron registrar invokes this per IMTO). */
export async function startBdcSettlementRecon(imtoCode: string, period: string): Promise<boolean> {
  const { getTemporalClient } = await import("./temporalClient.js");
  const { BDC_WORKFLOW_TASK_QUEUE } = await import("./activities-bdc.js");
  const { logger } = await import("../_core/logger.js");
  try {
    const client = await getTemporalClient();
    await client.start("bdcSettlementReconWorkflow", {
      taskQueue: BDC_WORKFLOW_TASK_QUEUE,
      workflowId: `bdc-settlement-recon-${imtoCode}-${period}`,
      args: [imtoCode, period],
    });
    return true;
  } catch (err) {
    logger.warn(
      { imtoCode, period, err: err instanceof Error ? err.message : String(err) },
      "[BDC] Temporal unavailable — settlement recon workflow not started",
    );
    return false;
  }
}

// ─── wave12 G1 (B4) — settled-reversal watchdog (daily cron) ─────────────────
// APPEND-ONLY block. Type-only import + dedicated activity proxy, so nothing
// above is touched. ORCH registers reversalWatchdogActivity on the same
// BDC_WORKFLOW_TASK_QUEUE worker and schedules startBdcReversalWatchdog()
// daily (cron registrar). The workflow is a thin deterministic shell: all
// I/O is in the activity; the activity marks nothing — it emits Kafka alerts
// for the human ops path (honest, SPEC-wave12 §4.1).
import type { BdcReversalWatchdogActivities, BdcReversalWatchdogReport } from "./activities-bdc";

const watchdogActs = proxyActivities<BdcReversalWatchdogActivities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
    nonRetryableErrorTypes: ["BdcNonRetryableError"],
  },
});

/**
 * Daily watchdog: find bdc_reversals stuck 'approved' > 24h (execution after
 * approval failed) and emit per-reversal Kafka alerts. Returns the full
 * report (persisted in workflow history).
 */
export async function bdcReversalWatchdogWorkflow(): Promise<BdcReversalWatchdogReport> {
  return watchdogActs.reversalWatchdogActivity();
}

/** Start a one-shot reversal watchdog sweep. Idempotent per UTC day (ORCH cron calls daily). */
export async function startBdcReversalWatchdog(): Promise<boolean> {
  const { getTemporalClient } = await import("./temporalClient.js");
  const { BDC_WORKFLOW_TASK_QUEUE } = await import("./activities-bdc.js");
  const { logger } = await import("../_core/logger.js");
  try {
    const client = await getTemporalClient();
    const day = new Date().toISOString().slice(0, 10); // worker-side clock — not sandboxed
    await client.start("bdcReversalWatchdogWorkflow", {
      taskQueue: BDC_WORKFLOW_TASK_QUEUE,
      workflowId: `bdc-reversal-watchdog-${day}`,
      args: [],
    });
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[BDC] Temporal unavailable — reversal watchdog workflow not started",
    );
    return false;
  }
}

/**
 * wave12 G7 (B6): start the tenant offboarding evaluation workflow. Idempotent
 * workflowId `bdc-offboard-${tenantId}`; fail-soft like the other starters —
 * Temporal unavailable (or a prior run still open) → warn + false; the
 * offboarding row stays 'requested' honestly and a re-request re-drives it.
 */
export async function startBdcTenantOffboarding(tenantId: number): Promise<boolean> {
  const { getTemporalClient } = await import("./temporalClient.js");
  const { BDC_WORKFLOW_TASK_QUEUE } = await import("./activities-bdc.js");
  const { logger } = await import("../_core/logger.js");
  try {
    const client = await getTemporalClient();
    await client.start("bdcTenantOffboardingWorkflow", {
      taskQueue: BDC_WORKFLOW_TASK_QUEUE,
      workflowId: `bdc-offboard-${tenantId}`,
      args: [tenantId],
    });
    return true;
  } catch (err) {
    logger.warn(
      { tenantId, err: err instanceof Error ? err.message : String(err) },
      "[BDC] Temporal unavailable — tenant offboarding workflow not started",
    );
    return false;
  }
}
