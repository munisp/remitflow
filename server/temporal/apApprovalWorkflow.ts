/**
 * W10-C1 / SPEC-wave10 — AP approval-expiry workflow (task queue `ap-approvals`).
 *
 * Workflow: wait-for-approval with a timeout. Reminder notifications are sent
 * at fractional points of the timeout; at the deadline a GUARDED expiry runs
 * (UPDATE approval_requests SET status='expired' WHERE status='pending' —
 * a request already decided in the meantime is a no-op, never clobbered).
 * Every expiry emits the Kafka event; reminders use ONLY enum-valid
 * notification types (notif_type enum: "system" here).
 *
 * Layout: the workflow function is pure (only @temporalio/workflow imports
 * plus a TYPE-ONLY activity interface) so it is safe for the Temporal
 * workflow sandbox. Activity implementations live in the exported
 * `apApprovalActivities` object for worker registration; their heavy
 * dependencies are loaded lazily inside each activity body.
 */
import { proxyActivities, sleep } from "@temporalio/workflow";

export const AP_APPROVAL_TASK_QUEUE = "ap-approvals";

// ─── Activity interface (type-only — implemented below for the worker) ───────
export interface ApApprovalActivities {
  /** true while the request is still pending. */
  isApprovalRequestPending(requestId: number): Promise<boolean>;
  /** Send an enum-valid reminder notification for a pending request. */
  sendApprovalReminder(requestId: number): Promise<void>;
  /** Guarded pending → expired flip + Kafka event. Returns the outcome. */
  expireApprovalRequest(requestId: number): Promise<"expired" | "already_decided" | "not_found">;
}

const acts = proxyActivities<ApApprovalActivities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
  },
});

export interface ApApprovalExpiryInput {
  requestId: number;
  /** Total wait before expiry. */
  timeoutMs: number;
  /** Fractions of the timeout at which reminders fire (default 50% / 85%). */
  remindAtFractions?: number[];
}

export interface ApApprovalExpiryResult {
  requestId: number;
  outcome: "expired" | "already_decided" | "not_found" | "decided_before_timeout";
  remindersSent: number;
}

/**
 * Approval-expiry workflow: remind at fractions of the timeout, then expire
 * whatever is still pending. Exits early (without expiring) when the request
 * is decided before the deadline.
 */
export async function apApprovalExpiryWorkflow(input: ApApprovalExpiryInput): Promise<ApApprovalExpiryResult> {
  const fractions = (input.remindAtFractions ?? [0.5, 0.85]).filter((f) => f > 0 && f < 1).sort((a, b) => a - b);
  let elapsed = 0;
  let remindersSent = 0;

  for (const fraction of fractions) {
    const target = Math.floor(input.timeoutMs * fraction);
    if (target > elapsed) {
      await sleep(target - elapsed);
      elapsed = target;
    }
    const pending = await acts.isApprovalRequestPending(input.requestId);
    if (!pending) {
      return { requestId: input.requestId, outcome: "decided_before_timeout", remindersSent };
    }
    await acts.sendApprovalReminder(input.requestId);
    remindersSent++;
  }

  if (input.timeoutMs > elapsed) {
    await sleep(input.timeoutMs - elapsed);
  }
  const outcome = await acts.expireApprovalRequest(input.requestId);
  return { requestId: input.requestId, outcome, remindersSent };
}

// ─── Activity implementations (worker side — NOT part of the workflow sandbox) ─

/**
 * Activity implementations for `ap-approvals` workers. Register with the
 * Temporal worker alongside the workflow (queue: AP_APPROVAL_TASK_QUEUE).
 */
export const apApprovalActivities: ApApprovalActivities = {
  async isApprovalRequestPending(requestId: number): Promise<boolean> {
    const { getDb } = await import("../db.js");
    const { approvalRequests } = await import("../../drizzle/schema.js");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) throw new Error("Database unavailable — cannot check approval request");
    const [row] = await db
      .select({ status: approvalRequests.status })
      .from(approvalRequests)
      .where(eq(approvalRequests.id, requestId))
      .limit(1);
    return row?.status === "pending";
  },

  async sendApprovalReminder(requestId: number): Promise<void> {
    const { getDb } = await import("../db.js");
    const { approvalRequests, approvalSteps, notifications } = await import("../../drizzle/schema.js");
    const { and, asc, eq } = await import("drizzle-orm");
    const { publishEvent } = await import("../middleware/kafka.js");
    const { logger } = await import("../_core/logger.js");
    const db = await getDb();
    if (!db) throw new Error("Database unavailable — cannot send approval reminder");

    const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId)).limit(1);
    if (!req || req.status !== "pending") return; // nothing to remind about

    // Notify the requester and the current pending step's designated approver.
    const [currentStep] = await db
      .select()
      .from(approvalSteps)
      .where(and(eq(approvalSteps.requestId, requestId), eq(approvalSteps.status, "pending")))
      .orderBy(asc(approvalSteps.step))
      .limit(1);

    const recipients = new Set<number>([req.createdBy]);
    if (currentStep) recipients.add(currentStep.approverUserId);

    for (const userId of recipients) {
      // notif_type enum-valid: "system".
      await db.insert(notifications).values({
        userId,
        title: "Approval reminder",
        message: `Approval request #${requestId} (${req.entityType} ${req.entityId}, ${req.amount} ${req.currency}) is still pending and will expire soon.`,
        type: "system",
        metadata: { kind: "approval_reminder", requestId, entityType: req.entityType, entityId: req.entityId },
      });
    }

    await publishEvent("remitflow.vendor-bills", `approval:${requestId}:reminder`, {
      eventType: "approval.request.reminder",
      requestId,
      tenantId: req.tenantId,
      entityType: req.entityType,
      entityId: req.entityId,
      recipients: [...recipients],
      timestamp: new Date().toISOString(),
    }).catch((err: unknown) =>
      logger.warn({ err: err instanceof Error ? err.message : String(err), requestId }, "[ApApproval] reminder Kafka event failed"),
    );
  },

  async expireApprovalRequest(requestId: number): Promise<"expired" | "already_decided" | "not_found"> {
    // Guarded status update + Kafka event live in the engine (single source).
    const { expireRequest } = await import("../services/approvalEngine.js");
    return expireRequest(requestId);
  },
};

// ─── Starter helper (called from the vendorBills router; fail-soft) ──────────
/**
 * Start the approval-expiry workflow for a request. Returns true when the
 * workflow was started. Temporal unavailable → warn + false (the request
 * simply has no auto-expiry; callers treat this as best-effort).
 */
export async function startApApprovalExpiry(requestId: number, timeoutMs: number): Promise<boolean> {
  const { getTemporalClient } = await import("./temporalClient.js");
  const { logger } = await import("../_core/logger.js");
  try {
    const client = await getTemporalClient();
    await client.start("apApprovalExpiryWorkflow", {
      taskQueue: AP_APPROVAL_TASK_QUEUE,
      workflowId: `ap-approval-expiry-${requestId}`,
      args: [{ requestId, timeoutMs } satisfies ApApprovalExpiryInput],
    });
    return true;
  } catch (err) {
    logger.warn(
      { requestId, err: err instanceof Error ? err.message : String(err) },
      "[ApApproval] Temporal unavailable — approval-expiry workflow not started",
    );
    return false;
  }
}
