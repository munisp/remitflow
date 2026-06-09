/**
 * Webhook Retry Queue — ensures no payment callback is lost
 *
 * When a webhook handler fails (DB unavailable, timeout, invalid payload),
 * the raw event is persisted to a `webhook_retry_queue` table.
 * A background scheduler replays failed webhooks with exponential backoff.
 *
 * Middleware-ready: swap PostgreSQL queue to Kafka DLQ in production.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { logger } from "../_core/logger";

interface QueuedWebhook {
  id: number;
  provider: string;
  eventType: string;
  payload: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date;
  lastError: string | null;
  createdAt: Date;
}

export async function ensureWebhookQueueTable(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS webhook_retry_queue (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT 5,
      next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_error TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_wrq_status ON webhook_retry_queue(status, next_retry_at)
      WHERE status = 'pending';
  `);
}

export async function enqueueFailedWebhook(
  provider: string,
  eventType: string,
  payload: unknown,
  error: string
): Promise<void> {
  const db = await getDb();
  if (!db) {
    logger.error({ provider, eventType, error }, "Cannot enqueue webhook — DB unavailable");
    return;
  }
  await db.execute(sql`
    INSERT INTO webhook_retry_queue (provider, event_type, payload, last_error, next_retry_at)
    VALUES (${provider}, ${eventType}, ${JSON.stringify(payload)}::jsonb, ${error}, NOW() + INTERVAL '30 seconds')
  `);
  logger.info({ provider, eventType }, "Failed webhook enqueued for retry");
}

export async function processWebhookRetryQueue(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const pending = await db.execute(sql`
    SELECT id, provider, event_type, payload, attempts, max_attempts
    FROM webhook_retry_queue
    WHERE status = 'pending' AND next_retry_at <= NOW()
    ORDER BY next_retry_at ASC
    LIMIT 10
    FOR UPDATE SKIP LOCKED
  `) as unknown as QueuedWebhook[];

  if (!pending || pending.length === 0) return 0;

  let processed = 0;
  const { handleStripeWebhook, handleFlutterwaveWebhook, handleMpesaCallback, handleMomoCallback } =
    await import("./paymentWebhooks");

  for (const item of pending) {
    try {
      const payload = typeof item.payload === "string" ? JSON.parse(item.payload) : item.payload;
      switch (item.provider) {
        case "stripe":
          // For Stripe retries, we skip signature verification since the payload is already trusted
          await handleStripeWebhook(JSON.stringify(payload), payload._retrySignature ?? "");
          break;
        case "flutterwave":
          await handleFlutterwaveWebhook(payload, payload._secretHash ?? "");
          break;
        case "mpesa":
          await handleMpesaCallback(payload);
          break;
        case "mtn_momo":
          await handleMomoCallback(payload);
          break;
        default:
          logger.warn({ provider: item.provider }, "Unknown webhook provider in retry queue");
      }

      await db.execute(sql`
        UPDATE webhook_retry_queue
        SET status = 'completed', completed_at = NOW(), attempts = attempts + 1
        WHERE id = ${item.id}
      `);
      processed++;
    } catch (err) {
      const nextAttempt = item.attempts + 1;
      const backoffSeconds = Math.min(30 * Math.pow(2, nextAttempt), 3600);
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (nextAttempt >= item.maxAttempts) {
        await db.execute(sql`
          UPDATE webhook_retry_queue
          SET status = 'dead_letter', attempts = ${nextAttempt}, last_error = ${errorMsg}
          WHERE id = ${item.id}
        `);
        logger.error({ provider: item.provider, id: item.id, attempts: nextAttempt }, "Webhook moved to dead letter queue");
      } else {
        await db.execute(sql`
          UPDATE webhook_retry_queue
          SET attempts = ${nextAttempt}, last_error = ${errorMsg},
              next_retry_at = NOW() + ${backoffSeconds.toString() + ' seconds'}::interval
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
