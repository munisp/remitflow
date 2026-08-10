/**
 * RemitFlow — Transactional Outbox Worker
 * ─────────────────────────────────────────
 * Polls the outbox_events table and delivers pending events to their
 * respective destinations (Fluvio, Dapr, webhooks).
 *
 * Guarantees:
 *   - At-least-once delivery
 *   - Multi-replica safe claiming: batches are claimed with
 *     SELECT ... FOR UPDATE SKIP LOCKED inside a transaction, then stamped
 *     with a lease (locked_at/locked_by). Delivery happens after the claim
 *     transaction commits, so no database locks are held during network I/O.
 *   - Crash recovery via visibility timeout: a claimed row whose lease is
 *     older than VISIBILITY_TIMEOUT_MS becomes claimable again.
 *   - Exponential backoff on transient failure (1s → 2s → 4s → 8s → 16s)
 *   - Immediate dead-letter for non-retriable failures: unknown aggregate
 *     types and Fluvio bridge outages/rejections (typed FluvioError) — these
 *     NEVER requeue in a loop. Redrive explicitly via requeueDeadLetters()
 *     after the bridge recovers.
 *   - Per-aggregate FIFO ordering within a batch
 *
 * Deployment:
 *   - Runs as a background worker in the same Node.js process
 *   - Can be extracted to a separate process by importing and calling start()
 */
import { hostname } from "node:os";
import { getDb } from "../db";
import { outboxEvents } from "../../drizzle/schema";
import { eq, and, lte, sql } from "drizzle-orm";
import { logger } from "../_core/logger";
import { fluvioProduce, FluvioError } from "../integrations/fluvio/streaming";
import { daprPublish } from "../integrations/dapr/pubsub";

const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 50;
const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 1000;
/** How long a claimed row stays invisible to other workers before its lease
 *  is considered abandoned (crash recovery). Must exceed the slowest delivery
 *  attempt (HTTP timeouts are ≤3s; one minute is ample headroom). */
const VISIBILITY_TIMEOUT_MS = 60_000;

const WORKER_ID = `outbox-worker@${hostname()}:${process.pid}`;

// ─── Metrics (in-memory; surfaced via getOutboxWorkerMetrics / /metrics) ─────
const metrics = {
  batchesClaimed: 0,
  eventsClaimed: 0,
  delivered: 0,
  retried: 0,
  deadLettered: 0,
  /** Dead letters caused specifically by Fluvio bridge outage/rejection. */
  fluvioBridgeDeadLetters: 0,
  requeued: 0,
};

export function getOutboxWorkerMetrics(): Readonly<typeof metrics> {
  return { ...metrics };
}

/** Marker for failures that must dead-letter immediately, never requeue. */
class NonRetriableDeliveryError extends Error {}

type OutboxEvent = typeof outboxEvents.$inferSelect;

// ─── Delivery Router ──────────────────────────────────────────────────────────
async function deliverEvent(event: OutboxEvent): Promise<void> {
  const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;

  switch (event.aggregateType) {
    case "transfer-events":
    case "kyc-events":
    case "fraud-events":
    case "audit-events":
    case "settlement-events":
    case "fx-events":
    case "compliance-events":
    case "tigerbeetle-events":
    case "temporal-events":
    case "notification-events":
      // Throws typed FluvioError on bridge not-configured / unreachable / rejected.
      await fluvioProduce(event.aggregateType, event.aggregateId, payload);
      break;

    case "dapr.transfer.initiated":
      await daprPublish.transferInitiated(payload);
      break;
    case "dapr.transfer.completed":
      await daprPublish.transferCompleted(payload);
      break;
    case "dapr.transfer.failed":
      await daprPublish.transferFailed(payload);
      break;
    case "dapr.kyc.approved":
      await daprPublish.kycApproved(payload);
      break;
    case "dapr.user.provisioned":
      await daprPublish.userProvisioned(payload);
      break;

    default:
      // Unknown type — can never succeed; dead-letter instead of retrying forever.
      throw new NonRetriableDeliveryError(`Unknown aggregate type: ${event.aggregateType}`);
  }
}

// ─── Batch Claim (multi-replica safe) ─────────────────────────────────────────
/**
 * Atomically claims up to BATCH_SIZE due pending events:
 *   - FOR UPDATE SKIP LOCKED → concurrent workers never claim the same rows
 *   - lease stamp (locked_at/locked_by) → claimed rows stay invisible until
 *     they are finalized or the visibility timeout expires (crash recovery)
 * The claim runs inside a transaction that commits BEFORE any delivery I/O.
 */
async function claimBatch(db: any): Promise<OutboxEvent[]> {
  return db.transaction(async (tx: any) => {
    const result = await tx.execute(sql`
      WITH claimed AS (
        SELECT id
        FROM outbox_events
        WHERE status = 'pending'
          AND COALESCE(next_retry_at, created_at) <= NOW()
          AND (
            locked_at IS NULL
            OR locked_at < NOW() - (${VISIBILITY_TIMEOUT_MS}::text || ' milliseconds')::interval
          )
        ORDER BY created_at ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_events AS o
      SET locked_at = NOW(), locked_by = ${WORKER_ID}
      FROM claimed
      WHERE o.id = claimed.id
      RETURNING o.*
    `);
    const rows = (result as any)?.rows ?? result ?? [];
    return rows as OutboxEvent[];
  });
}

// ─── Finalization ─────────────────────────────────────────────────────────────
async function markDelivered(db: any, event: OutboxEvent): Promise<void> {
  await db
    .update(outboxEvents)
    .set({
      status: "delivered",
      publishedAt: new Date(),
      errorMessage: null,
      lockedAt: null,
      lockedBy: null,
    } as any)
    .where(eq(outboxEvents.id, event.id));
  metrics.delivered++;
}

async function markDeadLetter(db: any, event: OutboxEvent, err: Error, reason: string): Promise<void> {
  await db
    .update(outboxEvents)
    .set({
      status: "dead_letter",
      retryCount: (event.retryCount ?? 0) + 1,
      errorMessage: `[${reason}] ${err.message}`.slice(0, 2000),
      failedAt: new Date(),
      nextRetryAt: null,
      lockedAt: null,
      lockedBy: null,
    } as any)
    .where(eq(outboxEvents.id, event.id));
  metrics.deadLettered++;
}

async function scheduleRetry(db: any, event: OutboxEvent, err: Error): Promise<void> {
  const retryCount = (event.retryCount ?? 0) + 1;
  const isDeadLetter = retryCount >= MAX_RETRIES;

  // Exponential backoff: 1s, 2s, 4s, 8s, 16s
  const backoffMs = BACKOFF_BASE_MS * Math.pow(2, retryCount - 1);
  const nextRetryAt = new Date(Date.now() + backoffMs);

  await db
    .update(outboxEvents)
    .set({
      status: isDeadLetter ? "dead_letter" : "pending",
      retryCount,
      errorMessage: err.message.slice(0, 2000),
      nextRetryAt: isDeadLetter ? null : nextRetryAt,
      failedAt: isDeadLetter ? new Date() : null,
      lockedAt: null,
      lockedBy: null,
    } as any)
    .where(eq(outboxEvents.id, event.id));

  if (isDeadLetter) {
    metrics.deadLettered++;
    logger.error(
      { eventId: event.id, eventType: event.eventType, retryCount, err: err.message },
      "[Outbox] Event dead-lettered after max retries"
    );
  } else {
    metrics.retried++;
    logger.warn(
      { eventId: event.id, eventType: event.eventType, retryCount, nextRetryAt, err: err.message },
      "[Outbox] Event delivery failed — will retry"
    );
  }
}

async function processEvent(db: any, event: OutboxEvent): Promise<void> {
  try {
    await deliverEvent(event);
    await markDelivered(db, event);
    logger.debug({ eventId: event.id, eventType: event.eventType }, "[Outbox] Event delivered");
  } catch (err) {
    const error = err as Error;

    // Fluvio bridge failure (not configured / unreachable / rejected): the
    // bridge is absent or refused the record — requeueing loops forever, so
    // dead-letter immediately. Redrive with requeueDeadLetters() after the
    // bridge recovers.
    if (error instanceof FluvioError) {
      await markDeadLetter(db, event, error, error.code);
      metrics.fluvioBridgeDeadLetters++;
      logger.error(
        { eventId: event.id, eventType: event.eventType, fluvioCode: error.code, topic: error.topic, err: error.message },
        "[Outbox] Fluvio bridge failure — event dead-lettered (NOT requeued). Redrive after bridge recovery."
      );
      return;
    }

    // Unknown aggregate type can never succeed — dead-letter, don't loop.
    if (error instanceof NonRetriableDeliveryError) {
      logger.error(
        { eventId: event.id, eventType: event.eventType, aggregateType: event.aggregateType },
        "[Outbox] Non-retriable delivery error — dead-lettering"
      );
      await markDeadLetter(db, event, error, "NON_RETRIABLE");
      return;
    }

    await scheduleRetry(db, event, error);
  }
}

// ─── Process Batch ────────────────────────────────────────────────────────────
async function processBatch(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const claimed = await claimBatch(db);
  if (claimed.length === 0) return;

  metrics.batchesClaimed++;
  metrics.eventsClaimed += claimed.length;
  logger.debug({ count: claimed.length, workerId: WORKER_ID }, "[Outbox] Claimed batch");

  // Process events concurrently but maintain per-aggregate FIFO ordering
  const byAggregate = new Map<string, OutboxEvent[]>();
  for (const event of claimed) {
    const key = event.aggregateId;
    if (!byAggregate.has(key)) byAggregate.set(key, []);
    byAggregate.get(key)!.push(event);
  }

  await Promise.allSettled(
    Array.from(byAggregate.values()).map(async (events) => {
      for (const event of events) {
        await processEvent(db, event);
      }
    })
  );
}

// ─── Dead-Letter Redrive ──────────────────────────────────────────────────────
/**
 * Admin redrive: requeue dead-lettered events (e.g. after the Fluvio bridge
 * recovers from an outage). Only events dead-lettered at least `minAgeMs`
 * ago are touched, so an operator redrive cannot race a live failure.
 * Resets retry counters and clears leases so the worker reclaims them.
 */
export async function requeueDeadLetters(minAgeMs = 60_000): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("[Outbox] Cannot requeue dead letters — database unavailable");

  const cutoff = new Date(Date.now() - minAgeMs);
  const result = await db
    .update(outboxEvents)
    .set({
      status: "pending",
      retryCount: 0,
      errorMessage: null,
      nextRetryAt: null,
      lockedAt: null,
      lockedBy: null,
    } as any)
    .where(
      and(
        eq(outboxEvents.status, "dead_letter" as any),
        lte(outboxEvents.failedAt, cutoff)
      )
    )
    .returning({ id: outboxEvents.id });

  metrics.requeued += result.length;
  logger.info({ count: result.length, minAgeMs }, "[Outbox] Dead-letter events requeued for redrive");
  return result.length;
}

// ─── Worker Lifecycle ─────────────────────────────────────────────────────────
let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;

export function startOutboxWorker(): void {
  if (isRunning) return;
  isRunning = true;

  logger.info({ workerId: WORKER_ID, visibilityTimeoutMs: VISIBILITY_TIMEOUT_MS }, "[Outbox] Worker started");

  const tick = async () => {
    if (!isRunning) return;
    try {
      await processBatch();
    } catch (err) {
      logger.error({ err }, "[Outbox] Worker tick failed");
    } finally {
      if (isRunning) {
        pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    }
  };

  pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
}

export function stopOutboxWorker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info("[Outbox] Worker stopped");
}
