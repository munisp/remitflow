/**
 * Webhook Retry Queue
 *
 * Durable retry scheduler for failed outbound webhook deliveries
 * (payment callbacks, tenant event hooks). Rows live in the
 * `webhook_retry_queue` table (drizzle/schema.ts); each attempt POSTs the
 * stored payload to the endpoint URL with an HMAC-SHA256 signature header,
 * backing off exponentially until `maxAttempts`, after which the delivery is
 * marked exhausted and the parent `webhook_deliveries` row is marked failed.
 *
 * The retry-processing pass is shared with the admin `processPending` router
 * mutation (server/routers/v97Features.ts) so both paths apply identical
 * semantics.
 */

import { createHash } from "crypto";
import { and, eq, lte } from "drizzle-orm";
import { getDb } from "../db";
import { webhookDeliveries, webhookEndpoints, webhookRetryQueue } from "../../drizzle/schema";
import { logger } from "../_core/logger";

/** Backoff schedule: 30s, 2m, 10m, 1h, 24h. */
export const BACKOFF_DELAYS_SECONDS = [30, 120, 600, 3600, 86400];

const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Verify the retry queue table exists and is queryable. Throws when the
 * migrations that create it have not been applied — the caller decides
 * whether that is fatal (startup logs it as non-blocking).
 */
export async function ensureWebhookQueueTable(): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("[WebhookRetry] Database unavailable — retry queue table cannot be verified");
  }
  await db.select({ id: webhookRetryQueue.id }).from(webhookRetryQueue).limit(0);
}

export interface RetryPassSummary {
  processed: number;
  succeeded: number;
  failed: number;
}

/**
 * Deliver every pending retry whose nextAttemptAt is due. Each entry is
 * marked processing before the attempt so a crash mid-pass does not double
 * deliver concurrently with the next tick.
 */
export async function processPendingWebhookRetries(limit = 50): Promise<RetryPassSummary> {
  const db = await getDb();
  if (!db) throw new Error("[WebhookRetry] Database unavailable");
  const now = new Date();
  const pending = await db.select().from(webhookRetryQueue)
    .where(and(eq(webhookRetryQueue.status, "pending"), lte(webhookRetryQueue.nextAttemptAt, now)))
    .limit(limit);

  let succeeded = 0;
  let failed = 0;

  for (const entry of pending) {
    // Mark as processing
    await db.update(webhookRetryQueue)
      .set({ status: "processing", lastAttemptAt: now, updatedAt: now })
      .where(eq(webhookRetryQueue.id, entry.id)).returning();

    try {
      // Get endpoint details
      const [endpoint] = await db.select().from(webhookEndpoints)
        .where(eq(webhookEndpoints.id, entry.endpointId)).limit(1);
      if (!endpoint || !endpoint.isActive) {
        await db.update(webhookRetryQueue)
          .set({ status: "exhausted", lastError: "Endpoint inactive or deleted", updatedAt: new Date() })
          .where(eq(webhookRetryQueue.id, entry.id)).returning();
        failed++;
        continue;
      }

      // Attempt delivery
      const signature = createHash("sha256").update(`${JSON.stringify(entry.payload)}${endpoint.secret}`).digest("hex");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
      try {
        const res = await fetch(endpoint.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Webhook-Signature": `sha256=${signature}`, "X-Attempt-Number": String(entry.attemptNumber) },
          body: JSON.stringify(entry.payload),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          await db.update(webhookRetryQueue)
            .set({ status: "succeeded", updatedAt: new Date() })
            .where(eq(webhookRetryQueue.id, entry.id)).returning();
          await db.update(webhookDeliveries)
            .set({ status: "delivered", responseStatus: res.status, deliveredAt: new Date() })
            .where(eq(webhookDeliveries.id, entry.deliveryId)).returning();
          succeeded++;
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        clearTimeout(timeout);
        const message = err instanceof Error ? err.message : String(err);
        const nextAttempt = entry.attemptNumber;
        if (nextAttempt >= entry.maxAttempts) {
          await db.update(webhookRetryQueue)
            .set({ status: "exhausted", lastError: message, updatedAt: new Date() })
            .where(eq(webhookRetryQueue.id, entry.id)).returning();
          await db.update(webhookDeliveries)
            .set({ status: "failed" })
            .where(eq(webhookDeliveries.id, entry.deliveryId)).returning();
        } else {
          const delaySeconds = BACKOFF_DELAYS_SECONDS[Math.min(nextAttempt, BACKOFF_DELAYS_SECONDS.length - 1)];
          await db.update(webhookRetryQueue)
            .set({
              status: "pending",
              attemptNumber: nextAttempt + 1,
              nextAttemptAt: new Date(Date.now() + delaySeconds * 1000),
              lastError: message,
              updatedAt: new Date(),
            })
            .where(eq(webhookRetryQueue.id, entry.id)).returning();
        }
        failed++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.update(webhookRetryQueue)
        .set({ status: "exhausted", lastError: message, updatedAt: new Date() })
        .where(eq(webhookRetryQueue.id, entry.id)).returning();
      failed++;
    }
  }

  return { processed: pending.length, succeeded, failed };
}

let timer: NodeJS.Timeout | null = null;
let passRunning = false;

/**
 * Start the background retry scheduler. Idempotent; each tick runs a bounded
 * processing pass and never overlaps with a still-running pass.
 */
export function startWebhookRetryScheduler(intervalMs = 30_000): void {
  if (timer) return;
  timer = setInterval(() => {
    if (passRunning) return;
    passRunning = true;
    processPendingWebhookRetries()
      .then((summary) => {
        if (summary.processed > 0) {
          logger.info({ ...summary }, "[WebhookRetry] Retry pass complete");
        }
      })
      .catch((err) => {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, "[WebhookRetry] Retry pass failed");
      })
      .finally(() => {
        passRunning = false;
      });
  }, intervalMs);
  timer.unref();
}

export function stopWebhookRetryScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
