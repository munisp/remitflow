/**
 * RemitFlow — AR Aging Workflow (W10 / SPEC-wave10 C2)
 * ────────────────────────────────────────────────────
 * Daily sweep on the `ar-aging` task queue: invoices_v2 rows that are `sent`
 * with dueDate < now flip to `overdue` (guarded UPDATE — only sent→overdue),
 * the invoice creator gets an enum-valid reminder notification (type "system"
 * per schema.ts notif_type enum), and a Kafka `remitflow.invoices` event is
 * emitted per transitioned invoice.
 *
 * Sandbox discipline mirrors server/temporal/workflows.ts +
 * fundFlowActivities.ts: the top level imports ONLY @temporalio/workflow
 * (deterministic); every side-effecting module (db, schema, kafka, logger,
 * @temporalio/client) is dynamically imported inside the activity / schedule
 * functions so the workflow bundle stays clean. The pino logger is NOT
 * isolate-safe, so it is lazy-loaded at each usage site (V2 round 2) — it is
 * never imported at module top level and never used in the workflow body.
 */
import { proxyActivities } from "@temporalio/workflow";

/**
 * Task queue for the AR aging sweep. Read LAZILY (V2-R2): this module is
 * bundled into the Temporal workflow isolate (workflowsPath) where `process`
 * is undefined, so env access must live inside a function body — never at
 * module top level. Nothing workflow-side invokes this; only the worker
 * (server/temporal/worker.ts) and the boot-time schedule registrar call it.
 */
export function arAgingTaskQueue(): string {
  return process.env.TEMPORAL_AR_AGING_QUEUE ?? "ar-aging";
}
const INVOICES_TOPIC = "remitflow.invoices";

// ─── Activity interface + deterministic workflow ─────────────────────────────
export interface ArAgingActivities {
  runArAgingSweepActivity(): Promise<{ overdueCount: number; remindersSent: number }>;
}

const { runArAgingSweepActivity: runArAgingSweep } = proxyActivities<ArAgingActivities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "10 seconds",
    backoffCoefficient: 2,
    maximumInterval: "2 minutes",
  },
});

/** Daily AR aging sweep — executed once per schedule tick. */
export async function arAgingWorkflow(): Promise<{ overdueCount: number; remindersSent: number }> {
  return runArAgingSweep();
}

// ─── Activity implementation (all side effects) ──────────────────────────────
export async function runArAgingSweepActivity(): Promise<{ overdueCount: number; remindersSent: number }> {
  const { getDb } = await import("../db.js");
  const { sql } = await import("drizzle-orm");
  const { notifications } = await import("../../drizzle/schema.js");
  const { publishEvent } = await import("../middleware/kafka.js");
  const { logger } = await import("../_core/logger.js");

  const db = await getDb();
  if (!db) throw new Error("[ArAging] Database unavailable — failing closed");

  // Guarded flip: ONLY sent → overdue. partially_paid keeps its status (it is
  // already delinquent-tracked); a concurrent payment/void affects 0 rows.
  const transitioned = (await db.execute(sql`
    UPDATE invoices_v2
    SET status = 'overdue', updated_at = NOW()
    WHERE status = 'sent'
      AND due_date IS NOT NULL
      AND due_date < NOW()
    RETURNING id, tenant_id AS "tenantId", invoice_number AS "invoiceNumber",
              total, amount_paid AS "amountPaid", currency, due_date AS "dueDate",
              created_by AS "createdBy"
  `)) as unknown as Array<{
    id: number | string;
    tenantId: number;
    invoiceNumber: string;
    total: string;
    amountPaid: string;
    currency: string;
    dueDate: string;
    createdBy: number;
  }>;

  let remindersSent = 0;
  for (const inv of transitioned) {
    try {
      // Enum-valid type per schema.ts notif_type enum ("system").
      await db.insert(notifications).values({
        userId: inv.createdBy,
        type: "system",
        title: `Invoice ${inv.invoiceNumber} is overdue`,
        message: `Invoice ${inv.invoiceNumber} for ${inv.total} ${inv.currency} was due ${new Date(inv.dueDate).toISOString().slice(0, 10)} and is now overdue. Outstanding: ${(Number(inv.total) - Number(inv.amountPaid)).toFixed(4)} ${inv.currency}.`,
        isRead: false,
        createdAt: new Date(),
      });
      remindersSent += 1;
    } catch (err) {
      logger.warn(`[ArAging] reminder notification failed for invoice ${inv.id}:`, (err as Error)?.message);
    }
    try {
      await publishEvent(INVOICES_TOPIC, `invoice:${inv.id}:invoice.overdue`, {
        eventType: "invoice.overdue",
        invoiceId: Number(inv.id),
        tenantId: inv.tenantId,
        invoiceNumber: inv.invoiceNumber,
        status: "overdue",
        total: String(inv.total),
        currency: inv.currency,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn(`[ArAging] Kafka emit failed for invoice ${inv.id} (non-critical):`, (err as Error)?.message);
    }
  }

  logger.info(`[ArAging] sweep complete: ${transitioned.length} invoice(s) → overdue, ${remindersSent} reminder(s) sent`);
  return { overdueCount: transitioned.length, remindersSent };
}

// ─── Schedule registration (daily) ───────────────────────────────────────────
/**
 * Installs the daily Temporal Schedule for the AR aging sweep on the
 * `ar-aging` queue. Boot-time helper — warn-soft when Temporal is unreachable
 * (mirrors temporal/client.ts degradation); never throws into app boot.
 */
export async function registerArAgingSchedule(): Promise<boolean> {
  const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "default";
  const { logger } = await import("../_core/logger.js");
  try {
    const { Connection, Client } = await import("@temporalio/client");
    const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
    const client = new Client({ connection, namespace: NAMESPACE });
    await client.schedule.create({
      scheduleId: "ar-aging-daily",
      spec: { cronExpressions: ["0 6 * * *"] }, // daily 06:00 UTC
      action: {
        type: "startWorkflow",
        workflowType: arAgingWorkflow,
        taskQueue: arAgingTaskQueue(),
      },
      policies: { catchupWindow: "1 hour", overlap: "SKIP" },
    });
    logger.info(`[ArAging] daily schedule registered (queue: ${arAgingTaskQueue()})`);
    return true;
  } catch (err) {
    logger.warn("[ArAging] Temporal unavailable — schedule NOT registered:", (err as Error)?.message);
    return false;
  }
}
