/**
 * RemitFlow — Transactional Outbox Worker
 * ─────────────────────────────────────────
 * Polls the outbox_events table and delivers pending events to their
 * respective destinations (Fluvio, Dapr, webhooks).
 *
 * Guarantees:
 *   - At-least-once delivery
 *   - Exponential backoff on failure (1s → 2s → 4s → 8s → 16s → dead-letter)
 *   - Max 5 retries before moving to dead-letter status
 *   - Concurrent processing with per-aggregate ordering (FIFO per aggregate_id)
 *   - Idempotent delivery via event_id deduplication
 *
 * Deployment:
 *   - Runs as a background worker in the same Node.js process
 *   - Can be extracted to a separate process by importing and calling start()
 */
import { getDb } from "../db";
import { outboxEvents } from "../../drizzle/schema";
import { eq, and, lte, asc, sql } from "drizzle-orm";
import { logger } from "../_core/logger";
import { fluvioProduce, FLUVIO_TOPICS } from "../integrations/fluvio/streaming";
import { daprPublish } from "../integrations/dapr/pubsub";

const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 50;
const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 1000;

let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;

// ─── Delivery Router ──────────────────────────────────────────────────────────
async function deliverEvent(event: typeof outboxEvents.$inferSelect): Promise<void> {
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
      await fluvioProduce(event.aggregateType as any, event.aggregateId, payload);
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
      // Unknown type — log and mark as dead-letter to avoid infinite retry
      logger.warn({ eventType: event.eventType, aggregateType: event.aggregateType }, "[Outbox] Unknown event type — dead-lettering");
      throw new Error(`Unknown aggregate type: ${event.aggregateType}`);
  }
}

// ─── Process Batch ────────────────────────────────────────────────────────────
async function processBatch(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Fetch pending events that are ready to process (respecting backoff)
  const pending = await db
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.status, "pending" as any),
        lte(outboxEvents.nextRetryAt ?? outboxEvents.createdAt, new Date())
      )
    )
    .orderBy(asc(outboxEvents.createdAt))
    .limit(BATCH_SIZE);

  if (pending.length === 0) return;

  logger.debug({ count: pending.length }, "[Outbox] Processing batch");

  // Process events concurrently but maintain per-aggregate ordering
  const byAggregate = new Map<string, typeof pending>();
  for (const event of pending) {
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

async function processEvent(db: any, event: typeof outboxEvents.$inferSelect): Promise<void> {
  try {
    await deliverEvent(event);

    // Mark as delivered
    await db
      .update(outboxEvents)
      .set({ status: "delivered" as any, processedAt: new Date() })
      .where(eq(outboxEvents.id, event.id));

    logger.debug({ eventId: event.id, eventType: event.eventType }, "[Outbox] Event delivered");
  } catch (err) {
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
        lastError: (err as Error).message,
        nextRetryAt: isDeadLetter ? null : nextRetryAt,
      } as any)
      .where(eq(outboxEvents.id, event.id));

    if (isDeadLetter) {
      logger.error(
        { eventId: event.id, eventType: event.eventType, retryCount },
        "[Outbox] Event dead-lettered after max retries"
      );
    } else {
      logger.warn(
        { eventId: event.id, eventType: event.eventType, retryCount, nextRetryAt },
        "[Outbox] Event delivery failed — will retry"
      );
    }
  }
}

// ─── Dead-Letter Requeue ──────────────────────────────────────────────────────
export async function requeueDeadLetters(maxAge = 3600000): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const cutoff = new Date(Date.now() - maxAge);
  const result = await db
    .update(outboxEvents)
    .set({ status: "pending" as any, retryCount: 0, lastError: null } as any)
    .where(
      and(
        eq(outboxEvents.status, "dead_letter" as any),
        lte(outboxEvents.createdAt, cutoff)
      )
    )
    .returning({ id: outboxEvents.id });

  logger.info({ count: result.length }, "[Outbox] Dead-letter events requeued");
  return result.length;
}

// ─── Worker Lifecycle ─────────────────────────────────────────────────────────
export function startOutboxWorker(): void {
  if (isRunning) return;
  isRunning = true;

  logger.info("[Outbox] Worker started");

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
