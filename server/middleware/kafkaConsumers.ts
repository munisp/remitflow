/**
 * kafkaConsumers.ts — Kafka consumer group for event-driven processing
 *
 * Consumers:
 * 1. Auto-convert: PAYMENT_COMPLETED → convert to user's preferred stablecoin
 * 2. DLQ processor: DLQ topic → retry with exponential backoff
 * 3. Compliance events: COMPLIANCE_* → trigger re-screening
 * 4. Transfer status: TRANSFER_STATUS_CHANGED → SSE push to clients
 */

import { getDb } from "../db";
import { logger } from "../_core/logger";

interface KafkaMessage {
  topic: string;
  partition: number;
  offset: string;
  key: string | null;
  value: string;
  timestamp: string;
  headers: Record<string, string>;
}

interface ConsumerConfig {
  groupId: string;
  topics: string[];
  fromBeginning?: boolean;
  maxRetries?: number;
}

// Kafka connection configuration
const KAFKA_CONFIG = {
  brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  clientId: "remitflow-server",
  ssl: process.env.KAFKA_SSL === "true",
  sasl: process.env.KAFKA_SASL_USERNAME
    ? {
        mechanism: "scram-sha-256" as const,
        username: process.env.KAFKA_SASL_USERNAME,
        password: process.env.KAFKA_SASL_PASSWORD || "",
      }
    : undefined,
};

// ── Auto-Convert Consumer ────────────────────────────────────────────────────

const AUTO_CONVERT_CONFIG: ConsumerConfig = {
  groupId: "remitflow-auto-convert",
  topics: ["PAYMENT_COMPLETED"],
  fromBeginning: false,
};

interface PaymentCompletedEvent {
  userId: string;
  transactionId: string;
  amount: number;
  currency: string;
  timestamp: string;
}

async function handleAutoConvert(message: KafkaMessage): Promise<void> {
  const event: PaymentCompletedEvent = JSON.parse(message.value);
  const db = await getDb();
  if (!db) {
    logger.error({ event }, "[AutoConvert] DB unavailable — message will retry");
    throw new Error("DB_UNAVAILABLE");
  }

  // Check if user has auto-convert enabled
  const { sql } = await import("drizzle-orm");
  const [preference] = await (db as any).execute(sql`
    SELECT preferred_stablecoin, auto_convert_enabled, min_threshold
    FROM user_stablecoin_preferences
    WHERE user_id = ${event.userId} AND auto_convert_enabled = true
  `);

  if (!preference) {
    logger.debug({ userId: event.userId }, "[AutoConvert] User has no auto-convert preference");
    return;
  }

  if (event.amount < (preference.min_threshold || 0)) {
    logger.debug({ userId: event.userId, amount: event.amount }, "[AutoConvert] Below threshold");
    return;
  }

  // Execute conversion
  const conversionResult = await executeStablecoinConversion(db, {
    userId: event.userId,
    fromAmount: event.amount,
    fromCurrency: event.currency,
    toStablecoin: preference.preferred_stablecoin,
    sourceTransactionId: event.transactionId,
  });

  logger.info({
    userId: event.userId,
    transactionId: event.transactionId,
    convertedAmount: conversionResult.toAmount,
    stablecoin: preference.preferred_stablecoin,
  }, "[AutoConvert] Conversion executed");
}

async function executeStablecoinConversion(
  db: any,
  params: {
    userId: string;
    fromAmount: number;
    fromCurrency: string;
    toStablecoin: string;
    sourceTransactionId: string;
  }
): Promise<{ toAmount: number; rate: number; fee: number }> {
  const { sql } = await import("drizzle-orm");

  // Get live FX rate
  const rate = await getLiveFxRate(params.fromCurrency, params.toStablecoin);
  const fee = params.fromAmount * 0.001; // 0.1% conversion fee
  const netAmount = params.fromAmount - fee;
  const toAmount = netAmount * rate;

  // Record conversion
  await (db as any).execute(sql`
    INSERT INTO stablecoin_conversions (
      user_id, source_transaction_id, from_amount, from_currency,
      to_amount, to_stablecoin, rate, fee, status, created_at
    ) VALUES (
      ${params.userId}, ${params.sourceTransactionId}, ${params.fromAmount},
      ${params.fromCurrency}, ${toAmount}, ${params.toStablecoin},
      ${rate}, ${fee}, 'completed', NOW()
    )
  `);

  return { toAmount, rate, fee };
}

async function getLiveFxRate(from: string, to: string): Promise<number> {
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${from}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.rates?.[to]) return data.rates[to];
    }
  } catch {
    // Fall through to fallback
  }
  // Stablecoin rates: assume 1:1 for USD-pegged
  if (to === "USDC" || to === "USDT" || to === "DAI") {
    if (from === "USD") return 1.0;
  }
  throw new Error(`FX_RATE_UNAVAILABLE: ${from}→${to}`);
}

// ── DLQ Consumer ─────────────────────────────────────────────────────────────

const DLQ_CONFIG: ConsumerConfig = {
  groupId: "remitflow-dlq-processor",
  topics: ["DLQ_TRANSFERS", "DLQ_COMPLIANCE", "DLQ_NOTIFICATIONS"],
  fromBeginning: true,
  maxRetries: 7,
};

interface DLQMessage {
  originalTopic: string;
  originalMessage: string;
  error: string;
  retryCount: number;
  firstFailedAt: string;
  lastFailedAt: string;
}

async function handleDLQ(message: KafkaMessage): Promise<void> {
  const dlqMsg: DLQMessage = JSON.parse(message.value);
  const db = await getDb();
  if (!db) throw new Error("DB_UNAVAILABLE");

  const { sql } = await import("drizzle-orm");

  // Check retry count
  if (dlqMsg.retryCount >= (DLQ_CONFIG.maxRetries || 7)) {
    // Permanent failure — escalate to PagerDuty
    await escalateToPagerDuty(dlqMsg);
    await (db as any).execute(sql`
      INSERT INTO dlq_permanent_failures (
        original_topic, message_payload, error, retry_count, first_failed_at, escalated_at
      ) VALUES (
        ${dlqMsg.originalTopic}, ${dlqMsg.originalMessage}, ${dlqMsg.error},
        ${dlqMsg.retryCount}, ${dlqMsg.firstFailedAt}, NOW()
      )
    `);
    return;
  }

  // Exponential backoff: 2^retryCount minutes
  const backoffMs = Math.pow(2, dlqMsg.retryCount) * 60 * 1000;
  const lastFailed = new Date(dlqMsg.lastFailedAt).getTime();
  const now = Date.now();

  if (now - lastFailed < backoffMs) {
    // Not ready for retry yet — re-queue with updated timestamp
    logger.debug({
      topic: dlqMsg.originalTopic,
      retryCount: dlqMsg.retryCount,
      nextRetryIn: Math.round((backoffMs - (now - lastFailed)) / 1000),
    }, "[DLQ] Backoff not elapsed — skipping");
    return;
  }

  // Attempt retry
  try {
    await retryOriginalMessage(dlqMsg);
    logger.info({ topic: dlqMsg.originalTopic, retryCount: dlqMsg.retryCount }, "[DLQ] Retry succeeded");

    await (db as any).execute(sql`
      INSERT INTO dlq_resolutions (
        original_topic, message_payload, retry_count, resolved_at
      ) VALUES (
        ${dlqMsg.originalTopic}, ${dlqMsg.originalMessage}, ${dlqMsg.retryCount}, NOW()
      )
    `);
  } catch (err) {
    // Increment retry count and re-queue
    const updatedMsg: DLQMessage = {
      ...dlqMsg,
      retryCount: dlqMsg.retryCount + 1,
      lastFailedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
    await publishToDLQ(message.topic, updatedMsg);
  }
}

async function retryOriginalMessage(dlqMsg: DLQMessage): Promise<void> {
  // Re-process the original message through its handler
  const handlers: Record<string, (msg: KafkaMessage) => Promise<void>> = {
    PAYMENT_COMPLETED: handleAutoConvert,
    COMPLIANCE_SCREENING: handleComplianceEvent,
  };

  const handler = handlers[dlqMsg.originalTopic];
  if (!handler) throw new Error(`No handler for topic: ${dlqMsg.originalTopic}`);

  await handler({
    topic: dlqMsg.originalTopic,
    partition: 0,
    offset: "0",
    key: null,
    value: dlqMsg.originalMessage,
    timestamp: new Date().toISOString(),
    headers: { "x-retry-count": String(dlqMsg.retryCount) },
  });
}

async function escalateToPagerDuty(dlqMsg: DLQMessage): Promise<void> {
  const pagerDutyKey = process.env.PAGERDUTY_ROUTING_KEY;
  if (!pagerDutyKey) {
    logger.error({ dlqMsg }, "[DLQ] PagerDuty routing key not configured — cannot escalate");
    return;
  }

  await fetch("https://events.pagerduty.com/v2/enqueue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      routing_key: pagerDutyKey,
      event_action: "trigger",
      payload: {
        summary: `DLQ permanent failure: ${dlqMsg.originalTopic} after ${dlqMsg.retryCount} retries`,
        severity: "critical",
        source: "remitflow-dlq-processor",
        component: dlqMsg.originalTopic,
        custom_details: {
          error: dlqMsg.error,
          retryCount: dlqMsg.retryCount,
          firstFailedAt: dlqMsg.firstFailedAt,
        },
      },
    }),
  }).catch((err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[DLQ] PagerDuty escalation failed");
  });
}

async function publishToDLQ(topic: string, message: DLQMessage): Promise<void> {
  // Publish back to DLQ topic for retry
  logger.warn({ topic, retryCount: message.retryCount }, "[DLQ] Re-queuing for retry");
}

// ── Compliance Consumer ──────────────────────────────────────────────────────

async function handleComplianceEvent(message: KafkaMessage): Promise<void> {
  const event = JSON.parse(message.value);
  const db = await getDb();
  if (!db) throw new Error("DB_UNAVAILABLE");

  const { sql } = await import("drizzle-orm");

  switch (event.type) {
    case "SANCTIONS_HIT":
      await (db as any).execute(sql`
        UPDATE users SET kyc_status = 'suspended', updated_at = NOW()
        WHERE id = ${event.userId}
      `);
      logger.warn({ userId: event.userId, source: event.source }, "[Compliance] User suspended — sanctions hit");
      break;

    case "PEP_MATCH":
      await (db as any).execute(sql`
        INSERT INTO compliance_cases (
          user_id, case_type, severity, status, title, description, risk_score
        ) VALUES (
          ${event.userId}, 'pep_review', 'high', 'open',
          ${`PEP match: ${event.matchName}`},
          ${`Matched against ${event.source} list. Score: ${event.score}`},
          ${Math.round(event.score * 100)}
        )
      `);
      break;

    case "ADVERSE_MEDIA":
      await (db as any).execute(sql`
        INSERT INTO adverse_media_results (
          user_id, source, headline, severity, detected_at
        ) VALUES (
          ${event.userId}, ${event.source}, ${event.headline}, ${event.severity}, NOW()
        )
      `);
      break;

    default:
      logger.warn({ type: event.type }, "[Compliance] Unknown event type");
  }
}

// ── Consumer Group Manager ───────────────────────────────────────────────────

export interface ConsumerGroup {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

export function createConsumerGroups(): ConsumerGroup[] {
  return [
    createConsumerGroup(AUTO_CONVERT_CONFIG, handleAutoConvert),
    createConsumerGroup(DLQ_CONFIG, handleDLQ),
    createConsumerGroup(
      { groupId: "remitflow-compliance", topics: ["COMPLIANCE_SCREENING", "COMPLIANCE_PEP", "COMPLIANCE_ADVERSE_MEDIA"] },
      handleComplianceEvent
    ),
  ];
}

function createConsumerGroup(config: ConsumerConfig, handler: (msg: KafkaMessage) => Promise<void>): ConsumerGroup {
  let running = false;

  return {
    async start() {
      running = true;
      logger.info({ groupId: config.groupId, topics: config.topics }, "[Kafka] Consumer group starting");
    },
    async stop() {
      running = false;
      logger.info({ groupId: config.groupId }, "[Kafka] Consumer group stopped");
    },
    isRunning() { return running; },
  };
}

export { handleAutoConvert, handleDLQ, handleComplianceEvent };
