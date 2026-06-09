/**
 * Webhook Retry Queue — ensures no payment callback is lost
 *
 * When a webhook delivery fails (timeout, handler error, DB unavailable),
 * the delivery is enqueued for retry with exponential backoff.
 * A background scheduler replays pending retries from the `webhook_retry_queue` table.
 *
 * Schema: uses the Drizzle-managed `webhook_retry_queue` table with FK references
 * to `webhook_deliveries` and `webhook_endpoints`.
 *
 * Middleware-ready: swap PostgreSQL queue to Kafka DLQ in production.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { logger } from "../_core/logger";

interface QueuedRetry {
  id: number;
  delivery_id: number;
  endpoint_id: number;
  payload: unknown;
  attempt_number: number;
  max_attempts: number;
  next_attempt_at: Date;
  last_error: string | null;
  status: string;
}

/**
 * Ensure the partial index exists for efficient pending-retry lookups.
 * The table itself is managed by Drizzle migrations — we only add the index if missing.
 */
export async function ensureWebhookQueueTable(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Verify the table exists (Drizzle migration should have created it)
  const tableCheck = await db.execute(
    sql`SELECT to_regclass('public.webhook_retry_queue') AS tbl`
  ) as unknown as Array<{ tbl: string | null }>;

  if (!tableCheck?.[0]?.tbl) {
    logger.warn("[Webhooks] webhook_retry_queue table not found — run Drizzle migrations first");
    return;
  }

  // Add partial index for efficient pending-retry lookups (idempotent)
  try {
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_wrq_pending_retry
          ON webhook_retry_queue(status, next_attempt_at)
          WHERE status = 'pending'`
    );
  } catch {
    // Index may already exist under a different name — non-critical
  }
}

/**
 * Enqueue a failed webhook delivery for retry.
 * Requires a valid delivery_id and endpoint_id from the webhook_deliveries/endpoints tables.
 */
export async function enqueueFailedWebhook(
  deliveryId: number,
  endpointId: number,
  payload: unknown,
  error: string
): Promise<void> {
  const db = await getDb();
  if (!db) {
    logger.error({ deliveryId, endpointId, error }, "Cannot enqueue webhook — DB unavailable");
    return;
  }
  await db.execute(sql`
    INSERT INTO webhook_retry_queue (delivery_id, endpoint_id, payload, last_error, next_attempt_at, status)
    VALUES (${deliveryId}, ${endpointId}, ${JSON.stringify(payload)}::json, ${error}, NOW() + INTERVAL '30 seconds', 'pending')
  `);
  logger.info({ deliveryId, endpointId }, "Failed webhook enqueued for retry");
}

/**
 * Process pending retries — fetch expired items, attempt re-delivery, update status.
 * Uses SELECT ... FOR UPDATE SKIP LOCKED for safe concurrent processing.
 */
export async function processWebhookRetryQueue(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const pending = await db.execute(sql`
    SELECT id, delivery_id, endpoint_id, payload, attempt_number, max_attempts
    FROM webhook_retry_queue
    WHERE status = 'pending' AND next_attempt_at <= NOW()
    ORDER BY next_attempt_at ASC
    LIMIT 10
    FOR UPDATE SKIP LOCKED
  `) as unknown as QueuedRetry[];

  if (!pending || pending.length === 0) return 0;

  let processed = 0;

  for (const item of pending) {
    try {
      // Look up the original delivery to get event_type for routing
      const deliveries = await db.execute(sql`
        SELECT event_type FROM webhook_deliveries WHERE id = ${item.delivery_id}
      `) as unknown as Array<{ event_type: string }>;

      const eventType = deliveries?.[0]?.event_type ?? "unknown";

      // Look up the endpoint URL for re-delivery
      const endpoints = await db.execute(sql`
        SELECT url, secret FROM webhook_endpoints WHERE id = ${item.endpoint_id}
      `) as unknown as Array<{ url: string; secret: string }>;

      if (endpoints?.[0]?.url) {
        const endpoint = endpoints[0];
        const payloadStr = typeof item.payload === "string" ? item.payload : JSON.stringify(item.payload);

        // Re-deliver the webhook to the endpoint URL
        const response = await fetch(endpoint.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Event": eventType,
            "X-Webhook-Retry": String(item.attempt_number),
          },
          body: payloadStr,
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          throw new Error(`Endpoint returned ${response.status}`);
        }
      }

      // Mark as completed
      await db.execute(sql`
        UPDATE webhook_retry_queue
        SET status = 'completed', last_attempt_at = NOW(), attempt_number = attempt_number + 1, updated_at = NOW()
        WHERE id = ${item.id}
      `);
      processed++;
    } catch (err) {
      const nextAttempt = item.attempt_number + 1;
      const backoffSeconds = Math.min(30 * Math.pow(2, nextAttempt), 3600);
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (nextAttempt >= item.max_attempts) {
        // Move to dead letter queue
        await db.execute(sql`
          UPDATE webhook_retry_queue
          SET status = 'dead_letter', attempt_number = ${nextAttempt}, last_error = ${errorMsg},
              last_attempt_at = NOW(), updated_at = NOW()
          WHERE id = ${item.id}
        `);
        logger.error({ deliveryId: item.delivery_id, id: item.id, attempts: nextAttempt }, "Webhook moved to dead letter queue");
      } else {
        await db.execute(sql`
          UPDATE webhook_retry_queue
          SET attempt_number = ${nextAttempt}, last_error = ${errorMsg},
              next_attempt_at = NOW() + ${backoffSeconds.toString() + ' seconds'}::interval,
              last_attempt_at = NOW(), updated_at = NOW()
          WHERE id = ${item.id}
        `);
      }
    }
  }

  return processed;
}

let retryInterval: ReturnType<typeof setInterval> | null = null;

export function startWebhookRetryScheduler(intervalMs = 30_000): void {
  if (retryInterval) return;
  retryInterval = setInterval(async () => {
    try {
      const count = await processWebhookRetryQueue();
      if (count > 0) logger.info({ processed: count }, "Webhook retry queue processed");
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, "Webhook retry scheduler error");
    }
  }, intervalMs);
  logger.info({ intervalMs }, "Webhook retry scheduler started");
}

export function stopWebhookRetryScheduler(): void {
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
}
