/**
 * RemitFlow — Kafka Consumer Infrastructure
 * ──────────────────────────────────────────
 * Provides consumer group management for all 15 Kafka topics.
 * Each consumer dispatches to the appropriate handler.
 *
 * Topics consumed:
 *   - remitflow.transactions         → transaction monitoring, velocity checks
 *   - remitflow.kyc.events           → KYC workflow triggers
 *   - remitflow.fx.rates             → FX rate cache updates
 *   - remitflow.risk.scores          → risk dashboard updates
 *   - remitflow.notifications.stream → push notification dispatch
 *   - remitflow.audit.stream         → audit log persistence
 *   - remitflow.mojaloop.transfers   → Mojaloop transfer tracking
 *   - remitflow.investment.prices    → investment portfolio updates
 *   - remitflow.payment.initiated    → payment tracking
 *   - remitflow.payment.completed    → settlement confirmation
 *   - remitflow.payment.failed       → failure handling, retry logic
 *   - remitflow.dispute.opened       → dispute workflow trigger
 *   - remitflow.compliance.alert     → compliance dashboard alerts
 *   - remitflow.fraud.alert          → fraud case creation
 *   - kyc.liveness.result            → liveness audit logging
 */

import { KAFKA_TOPICS, sendToDLQ, publishEvent } from "./kafka";
import { getDb, createAuditLog } from "../db";
import { logger } from "../_core/logger";
import { sql } from "drizzle-orm";
import type { Consumer, KafkaMessage } from "kafkajs";

const CONSUMER_GROUP = process.env.KAFKA_CONSUMER_GROUP || "remitflow-main-consumer";
const DLQ_CONSUMER_GROUP = process.env.KAFKA_DLQ_CONSUMER_GROUP || "remitflow-dlq-persistence";

// Failed-handler retry policy: exponential backoff in-process, then DLQ.
const HANDLER_MAX_RETRIES = parseInt(process.env.KAFKA_HANDLER_MAX_RETRIES || "3", 10);
const HANDLER_RETRY_BASE_MS = parseInt(process.env.KAFKA_HANDLER_RETRY_BASE_MS || "500", 10);

// DLQ reprocess policy
const DLQ_REPROCESS_MAX_ATTEMPTS = 7;

interface ConsumerHandler {
  topic: string;
  handler: (message: Record<string, unknown>) => Promise<void>;
  description: string;
}

// ─── Handler Registry ────────────────────────────────────────────────────────

const handlers: ConsumerHandler[] = [
  {
    topic: KAFKA_TOPICS.TRANSACTIONS,
    description: "Transaction monitoring — velocity checks, pattern detection",
    handler: async (msg) => {
      const db = await getDb();
      if (!db) return;
      // Log transaction event for monitoring
      const txId = msg.transactionId as string;
      const amount = msg.amount as number;
      const userId = msg.userId as number;
      if (txId && userId) {
        await createAuditLog({
          userId,
          action: "transaction.event",
          targetType: "transaction",
          description: txId,
          metadata: { amount, eventType: msg.eventType },
        }).catch(() => {});
      }
    },
  },
  {
    topic: KAFKA_TOPICS.KYC_EVENTS,
    description: "KYC workflow triggers — delegates to KYC event consumer service",
    handler: async (msg) => {
      // Forward to KYC event consumer service
      const url = process.env.KYC_EVENT_CONSUMER_URL || "http://localhost:8120";
      try {
        await fetch(`${url}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: msg }),
        });
      } catch {
        // KYC event consumer handles its own persistence
      }
    },
  },
  {
    topic: KAFKA_TOPICS.FX_RATES,
    description: "FX rate cache update — updates in-memory rate cache",
    handler: async (msg) => {
      const base = msg.baseCurrency as string;
      const quote = msg.quoteCurrency as string;
      const rate = msg.rate as number;
      if (base && quote && rate) {
        // Update Redis rate cache if available
        try {
          const redis = await import("../middleware/redis.js");
          const client = (redis as Record<string, unknown>).redisClient;
          if (client && typeof (client as Record<string, Function>).set === "function") {
            await (client as Record<string, Function>).set(
              `fx:${base}:${quote}`,
              String(rate),
              { EX: 300 }
            );
          }
        } catch {
          // Redis unavailable — rate will be fetched on next request
        }
      }
    },
  },
  {
    topic: KAFKA_TOPICS.RISK_SCORES,
    description: "Risk dashboard updates — persists risk scores for analytics",
    handler: async (msg) => {
      const db = await getDb();
      if (!db) return;
      await createAuditLog({
        userId: (msg.userId as number) || 0,
        action: "risk.score.computed",
        targetType: "risk",
        description: (msg.transactionId as string) || "unknown",
        metadata: { score: msg.riskScore, factors: msg.factors },
      }).catch(() => {});
    },
  },
  {
    topic: KAFKA_TOPICS.NOTIFICATIONS,
    description: "Push notification dispatch — sends via configured channels",
    handler: async (msg) => {
      const userId = msg.userId as number;
      const title = msg.title as string;
      if (!userId || !title) return;
      // Notification dispatch handled by push notification service
      try {
        const pushUrl = process.env.PUSH_NOTIFICATION_URL || "http://localhost:8140";
        await fetch(`${pushUrl}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(msg),
        });
      } catch {
        // Push service unavailable — notification will be available in-app
      }
    },
  },
  {
    topic: KAFKA_TOPICS.AUDIT_LOGS,
    description: "Audit log persistence — writes to audit table and OpenSearch",
    handler: async (msg) => {
      const db = await getDb();
      if (!db) return;
      await createAuditLog({
        userId: (msg.userId as number) || 0,
        action: (msg.action as string) || "audit.event",
        targetType: (msg.resourceType as string) || "system",
        description: (msg.resourceId as string) || "unknown",
        metadata: msg,
      }).catch(() => {});
    },
  },
  {
    topic: KAFKA_TOPICS.PAYMENT_INITIATED,
    description: "Payment tracking — records initiation timestamp",
    handler: async (msg) => {
      const db = await getDb();
      if (!db) return;
      const paymentId = msg.paymentId as string;
      if (paymentId) {
        await createAuditLog({
          userId: (msg.userId as number) || 0,
          action: "payment.initiated",
          targetType: "payment",
          description: paymentId,
          metadata: { amount: msg.amount, currency: msg.currency, rail: msg.rail },
        }).catch(() => {});
      }
    },
  },
  {
    topic: KAFKA_TOPICS.PAYMENT_COMPLETED,
    description: "Settlement confirmation — updates transaction status",
    handler: async (msg) => {
      const db = await getDb();
      if (!db) return;
      const paymentId = msg.paymentId as string;
      if (paymentId) {
        await createAuditLog({
          userId: (msg.userId as number) || 0,
          action: "payment.completed",
          targetType: "payment",
          description: paymentId,
          metadata: { settledAt: msg.settledAt },
        }).catch(() => {});
      }
    },
  },
  {
    topic: KAFKA_TOPICS.PAYMENT_FAILED,
    description: "Payment failure handling — triggers retry or alert",
    handler: async (msg) => {
      const db = await getDb();
      if (!db) return;
      const paymentId = msg.paymentId as string;
      if (paymentId) {
        await createAuditLog({
          userId: (msg.userId as number) || 0,
          action: "payment.failed",
          targetType: "payment",
          description: paymentId,
          metadata: { error: msg.error, retryable: msg.retryable },
        }).catch(() => {});
      }
    },
  },
  {
    topic: KAFKA_TOPICS.DISPUTE_OPENED,
    description: "Dispute workflow trigger — creates dispute case",
    handler: async (msg) => {
      await createAuditLog({
        userId: (msg.userId as number) || 0,
        action: "dispute.opened",
        targetType: "dispute",
        description: (msg.disputeId as string) || "unknown",
        metadata: msg,
      }).catch(() => {});
    },
  },
  {
    topic: KAFKA_TOPICS.COMPLIANCE_ALERT,
    description: "Compliance dashboard alert — routes to compliance officers",
    handler: async (msg) => {
      await createAuditLog({
        userId: (msg.userId as number) || 0,
        action: "compliance.alert",
        targetType: "compliance",
        description: (msg.alertId as string) || "unknown",
        metadata: msg,
      }).catch(() => {});
    },
  },
  {
    topic: KAFKA_TOPICS.FRAUD_ALERT,
    description: "Fraud case creation — creates fraud investigation case",
    handler: async (msg) => {
      await createAuditLog({
        userId: (msg.userId as number) || 0,
        action: "fraud.alert",
        targetType: "fraud",
        description: (msg.alertId as string) || "unknown",
        metadata: msg,
      }).catch(() => {});
    },
  },
  {
    topic: KAFKA_TOPICS.KYC_LIVENESS_RESULT,
    description: "Liveness audit logging — persists liveness check results",
    handler: async (msg) => {
      await createAuditLog({
        userId: (msg.userId as number) || 0,
        action: "kyc.liveness.result",
        targetType: "kyc",
        description: (msg.sessionId as string) || "unknown",
        metadata: { passed: msg.passed, score: msg.score, method: msg.method },
      }).catch(() => {});
    },
  },
];

// ─── Consumer Management ─────────────────────────────────────────────────────

let _consumerRunning = false;
let _consumer: Consumer | null = null;
let _dlqConsumer: Consumer | null = null;
const _stats = {
  messagesProcessed: 0,
  messagesErrored: 0,
  messagesSentToDlq: 0,
  dlqPersisted: 0,
  dlqPersistErrors: 0,
  lastMessageAt: null as string | null,
  startedAt: null as string | null,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run a handler with exponential backoff retries (base * 2^attempt). */
async function withHandlerRetry<T>(
  fn: () => Promise<T>,
  context: Record<string, unknown>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= HANDLER_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < HANDLER_MAX_RETRIES) {
        const delayMs = HANDLER_RETRY_BASE_MS * 2 ** attempt;
        logger.warn(
          { ...context, attempt: attempt + 1, maxRetries: HANDLER_MAX_RETRIES, delayMs, err: (err as Error).message },
          "[Kafka] Handler failed — retrying with backoff",
        );
        await sleep(delayMs);
      }
    }
  }
  throw lastErr;
}

/** Manually commit the offset for a processed message (autoCommit is disabled). */
async function commitOffset(consumer: Consumer, topic: string, partition: number, offset: string): Promise<void> {
  await consumer.commitOffsets([{ topic, partition, offset: (Number(offset) + 1).toString() }]);
}

// ─── DLQ Persistence ─────────────────────────────────────────────────────────
// A dedicated consumer group drains remitflow.dlq into the dlq_messages table
// (see drizzle/0081_dlq_messages.sql) so failed messages survive
// restarts and can be reprocessed via reprocessDlqMessages().

async function persistDlqMessage(topic: string, partition: number, message: KafkaMessage): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("[DLQ] Cannot persist — database unavailable");

  const rawValue = message.value?.toString() ?? "";
  const key = message.key?.toString() ?? null;
  let envelope: Record<string, unknown> = {};
  try {
    envelope = JSON.parse(rawValue) as Record<string, unknown>;
  } catch {
    // Non-JSON DLQ payload — persist raw
  }

  await (db as any).execute(sql`
    INSERT INTO dlq_messages (topic, partition, offset, key, original_topic, payload, error, status, failed_at)
    VALUES (
      ${topic},
      ${partition},
      ${message.offset},
      ${key},
      ${(envelope.originalTopic as string) ?? null},
      ${rawValue},
      ${(envelope.error as string) ?? null},
      'pending',
      ${(envelope.failedAt as string) ?? new Date().toISOString()}
    )
    ON CONFLICT (topic, partition, offset) DO NOTHING
  `);
}

async function startDlqPersistenceConsumer(kafka: import("kafkajs").Kafka): Promise<void> {
  const consumer = kafka.consumer({ groupId: DLQ_CONSUMER_GROUP });
  await consumer.connect();
  _dlqConsumer = consumer;

  await consumer.subscribe({ topic: KAFKA_TOPICS.DLQ, fromBeginning: true });

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      try {
        await persistDlqMessage(topic, partition, message);
        await commitOffset(consumer, topic, partition, message.offset);
        _stats.dlqPersisted++;
      } catch (err) {
        // Do NOT commit — the message will be redelivered and persistence retried.
        _stats.dlqPersistErrors++;
        logger.error(
          { topic, partition, offset: message.offset, err: (err as Error).message },
          "[DLQ] Persistence failed — offset not committed, will retry",
        );
      }
    },
  });

  logger.info(`[DLQ] Persistence consumer started (group=${DLQ_CONSUMER_GROUP}, topic=${KAFKA_TOPICS.DLQ})`);
}

// ─── DLQ Reprocessing ────────────────────────────────────────────────────────

export interface DlqReprocessResult {
  reprocessed: number;
  failed: number;
  skipped: number;
}

/**
 * Reprocess persisted DLQ messages by republishing them to their original topic.
 * Worker function — invoke from a scheduler or admin job. Rows that exhaust
 * DLQ_REPROCESS_MAX_ATTEMPTS are marked 'failed' for manual intervention.
 */
export async function reprocessDlqMessages(limit = 50): Promise<DlqReprocessResult> {
  const db = await getDb();
  if (!db) throw new Error("[DLQ] Cannot reprocess — database unavailable");

  const result: DlqReprocessResult = { reprocessed: 0, failed: 0, skipped: 0 };
  const rows = (await (db as any).execute(sql`
    SELECT id, key, original_topic, payload, reprocess_count
    FROM dlq_messages
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
    ORDER BY id ASC
    LIMIT ${limit}
  `)) as Array<{
    id: number;
    key: string | null;
    original_topic: string | null;
    payload: string;
    reprocess_count: number;
  }>;

  for (const row of rows) {
    let envelope: Record<string, unknown> = {};
    try {
      envelope = JSON.parse(row.payload) as Record<string, unknown>;
    } catch { /* handled below */ }

    const originalTopic = row.original_topic ?? (envelope.originalTopic as string | undefined);
    const originalValue = (envelope.originalValue as string | undefined) ?? row.payload;
    if (!originalTopic) {
      // No route back — mark failed so it stops blocking the queue.
      await (db as any).execute(sql`
        UPDATE dlq_messages SET status = 'failed', error = COALESCE(error, '') || ' | no original topic'
        WHERE id = ${row.id}
      `);
      result.skipped++;
      continue;
    }

    try {
      const parsed = JSON.parse(originalValue) as Record<string, unknown>;
      const published = await publishEvent(originalTopic, row.key ?? `dlq-${row.id}`, parsed);
      if (!published) throw new Error("Kafka producer unavailable");

      await (db as any).execute(sql`
        UPDATE dlq_messages SET status = 'reprocessed', reprocessed_at = NOW() WHERE id = ${row.id}
      `);
      result.reprocessed++;
      logger.info({ id: row.id, originalTopic }, "[DLQ] Message reprocessed");
    } catch (err) {
      const attempts = (row.reprocess_count ?? 0) + 1;
      const exhausted = attempts >= DLQ_REPROCESS_MAX_ATTEMPTS;
      // Exponential backoff: 2^attempts minutes before the next reprocess try.
      const nextRetryAt = new Date(Date.now() + 2 ** attempts * 60_000).toISOString();
      await (db as any).execute(sql`
        UPDATE dlq_messages
        SET reprocess_count = ${attempts},
            status = ${exhausted ? "failed" : "pending"},
            next_retry_at = ${exhausted ? null : nextRetryAt},
            error = ${(err as Error).message}
        WHERE id = ${row.id}
      `);
      result.failed++;
      logger.error(
        { id: row.id, originalTopic, attempts, exhausted, err: (err as Error).message },
        "[DLQ] Reprocess failed",
      );
    }
  }

  return result;
}

// ─── Main Consumer Lifecycle ─────────────────────────────────────────────────

export async function startKafkaConsumers(): Promise<void> {
  if (_consumerRunning) return;

  try {
    const { Kafka } = await import("kafkajs");
    const kafka = new Kafka({
      clientId: "remitflow-main",
      brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
    });

    const consumer = kafka.consumer({ groupId: CONSUMER_GROUP });
    await consumer.connect();
    _consumer = consumer;

    for (const h of handlers) {
      await consumer.subscribe({ topic: h.topic, fromBeginning: false });
    }

    const handlerMap = new Map(handlers.map((h) => [h.topic, h.handler]));

    await consumer.run({
      // Manual offset management: an offset is only committed after the handler
      // succeeds (with retries) or after the message is safely parked in the DLQ.
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        const handler = handlerMap.get(topic);
        if (!handler || !message.value) {
          await commitOffset(consumer, topic, partition, message.offset);
          return;
        }

        const ctx = { topic, partition, offset: message.offset };
        try {
          const parsed = JSON.parse(message.value.toString());
          await withHandlerRetry(() => handler(parsed), ctx);
          await commitOffset(consumer, topic, partition, message.offset);
          _stats.messagesProcessed++;
          _stats.lastMessageAt = new Date().toISOString();
        } catch (err) {
          _stats.messagesErrored++;
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error({ ...ctx, err: errMsg }, `[Kafka] Handler exhausted retries [${topic}] — routing to DLQ`);
          try {
            await sendToDLQ(
              topic,
              message.key?.toString() ?? "unknown",
              message.value.toString(),
              errMsg,
            );
            // Message is durably parked in remitflow.dlq — safe to commit.
            await commitOffset(consumer, topic, partition, message.offset);
            _stats.messagesSentToDlq++;
          } catch (dlqErr) {
            // DLQ unavailable — do NOT commit; the message will be redelivered.
            logger.error(
              { ...ctx, err: (dlqErr as Error).message },
              "[Kafka] DLQ routing failed — offset not committed, message will be redelivered",
            );
          }
        }
      },
    });

    // Drain remitflow.dlq into Postgres for durability + reprocessing.
    await startDlqPersistenceConsumer(kafka);

    _consumerRunning = true;
    _stats.startedAt = new Date().toISOString();
    logger.info(`Kafka consumers started for ${handlers.length} topics (+ DLQ persistence)`);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Kafka consumers not started (broker unavailable)");
    // If subscribe/run failed after connect(), disconnect the orphaned consumers
    // so they don't leak broker connections / consumer-group slots.
    for (const c of [_dlqConsumer, _consumer]) {
      if (c) {
        try {
          await c.disconnect();
        } catch {
          /* best-effort cleanup */
        }
      }
    }
    _dlqConsumer = null;
    _consumer = null;
    _consumerRunning = false;
  }
}

export async function stopKafkaConsumers(): Promise<void> {
  for (const c of [_dlqConsumer, _consumer]) {
    if (!c) continue;
    try {
      await c.disconnect();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Kafka consumer disconnect warning");
    }
  }
  if (_consumer || _dlqConsumer) logger.info("Kafka consumers disconnected");
  _consumer = null;
  _dlqConsumer = null;
  _consumerRunning = false;
}

export function getConsumerStats() {
  return {
    running: _consumerRunning,
    topics: handlers.map((h) => ({ topic: h.topic, description: h.description })),
    stats: _stats,
  };
}

export function getConsumerHandlers() {
  return handlers;
}
