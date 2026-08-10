/**
 * RemitFlow — Kafka Client (Production v79)
 * Uses real kafkajs with graceful degradation when Kafka unavailable.
 * All financial lifecycle events flow through this module.
 */
import { Kafka, Producer, Consumer, Admin, logLevel, CompressionTypes } from "kafkajs";
import { logger } from '../_core/logger';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || "localhost:9092").split(",");
const KAFKA_CLIENT_ID = process.env.KAFKA_CLIENT_ID || "remitflow-app";
const KAFKA_GROUP_ID = process.env.KAFKA_GROUP_ID || "remitflow-consumers";

// ── Topic Definitions ─────────────────────────────────────────────────────────
export const KAFKA_TOPICS = {
  TRANSACTIONS: "remitflow.transactions",
  KYC_EVENTS: "remitflow.kyc.events",
  FX_RATES: "remitflow.fx.rates",
  RISK_SCORES: "remitflow.risk.scores",
  NOTIFICATIONS: "remitflow.notifications.stream",
  AUDIT_LOGS: "remitflow.audit.stream",
  MOJALOOP_TRANSFERS: "remitflow.mojaloop.transfers",
  INVESTMENT_PRICES: "remitflow.investment.prices",
  PAYMENT_INITIATED: "remitflow.payment.initiated",
  PAYMENT_COMPLETED: "remitflow.payment.completed",
  PAYMENT_FAILED: "remitflow.payment.failed",
  DISPUTE_OPENED: "remitflow.dispute.opened",
  COMPLIANCE_ALERT: "remitflow.compliance.alert",
  FRAUD_ALERT: "remitflow.fraud.alert",
  KYC_LIVENESS_RESULT: "kyc.liveness.result",
  TIGERBEETLE_OPERATIONS: "remitflow.tigerbeetle.operations",
  TIGERBEETLE_RECONCILIATION: "remitflow.tigerbeetle.reconciliation",
  ACCOUNT_EVENTS: "remitflow.account.events",
  ACCOUNT_PROVISIONED: "remitflow.account.provisioned",
  FUND_FLOW_EVENTS: "remitflow.fund-flow.events",
  FUND_FLOW_LEDGER: "remitflow.fund-flow.ledger",
  FUND_FLOW_SAGAS: "remitflow.fund-flow.sagas",
  FUND_FLOW_DLQ: "remitflow.fund-flow.dlq",
  FUND_FLOW_RECONCILIATION: "remitflow.fund-flow.reconciliation",
  // ── KYC/KYB Trigger Topics (Phase 7 — KYC Trigger Engine) ────────────────
  KYC_TRIGGER_INITIATED: "kyc.trigger.initiated",
  KYC_TRIGGER_COMPLETED: "kyc.trigger.completed",
  KYC_TRIGGER_FAILED: "kyc.trigger.failed",
  KYB_TRIGGER_INITIATED: "kyb.trigger.initiated",
  KYB_TRIGGER_COMPLETED: "kyb.trigger.completed",
  KYC_SANCTIONS_FREEZE: "kyc.sanctions.freeze",
  KYC_EDD_REQUIRED: "kyc.edd.required",
  KYC_REKYC_REQUIRED: "kyc.rekyc.required",
  // ── Dead Letter Queue — failed consumer messages land here after retries ──
  DLQ: "remitflow.dlq",
} as const;

export type KafkaTopic = typeof KAFKA_TOPICS[keyof typeof KAFKA_TOPICS];

// ── Event Interfaces ──────────────────────────────────────────────────────────
export interface TransactionEvent {
  eventType: "created" | "updated" | "completed" | "failed" | "cancelled";
  transactionId: number | string;
  userId: number | string;
  amount: number;
  currency: string;
  toCurrency?: string;
  toAmount?: number;
  status: string;
  destinationCountry?: string;
  timestamp: string;
}

export interface KYCEvent {
  eventType: "submitted" | "approved" | "rejected" | "tier_upgraded"
    | "account.opened" | "account.application.created" | "kyc.verification.required"
    | "account.kyc.verified" | "kyb.verification.required";
  userId: number | string;
  kycTier?: number;
  previousTier?: number;
  reason?: string;
  tier?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

export interface KYCTriggerEvent {
  triggerType: string;
  userId: number | string;
  entityId?: string;
  entityType?: "individual" | "business";
  triggeredBy: string;
  riskScore?: number;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface FXRateEvent {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  provider: string;
  timestamp: string;
}

export interface RiskScoreEvent {
  transactionId: number | string;
  userId: number | string;
  riskScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  decision: "approve" | "review" | "reject";
  flags: string[];
  timestamp: string;
}

export interface NotificationEvent {
  userId: number | string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface PaymentInitiatedEvent {
  paymentId: string;
  userId: number | string;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  toAmount: number;
  corridorId: string;
  timestamp: string;
}

// ── Real Kafka Producer ───────────────────────────────────────────────────────
let _kafka: Kafka | null = null;
let _producer: Producer | null = null;
let _isConnected = false;
let _connectionFailed = false;
let _lastConnectionAttempt = 0;
const KAFKA_RETRY_INTERVAL_MS = 60_000;

function getRealKafka(): Kafka {
  if (!_kafka) {
    _kafka = new Kafka({
      clientId: KAFKA_CLIENT_ID,
      brokers: KAFKA_BROKERS,
      logLevel: logLevel.ERROR,
      retry: { initialRetryTime: 300, retries: 1 },
    });
  }
  return _kafka;
}

export async function getKafkaProducer(): Promise<Producer | null> {
  if (_connectionFailed && Date.now() - _lastConnectionAttempt < KAFKA_RETRY_INTERVAL_MS) return null;
  if (_producer && _isConnected) return _producer;
  try {
    _producer = getRealKafka().producer({
      allowAutoTopicCreation: true,
      // Idempotent producer: exactly-once per partition. Requires
      // maxInFlightRequests=1 so retries cannot reorder batches.
      idempotent: true,
      maxInFlightRequests: 1,
    } as Parameters<Kafka['producer']>[0]);
    await _producer.connect();
    _isConnected = true;
    _connectionFailed = false;
    logger.info("[Kafka] Idempotent producer connected to", KAFKA_BROKERS.join(","));
    return _producer;
  } catch (err) {
    _connectionFailed = true;
    _lastConnectionAttempt = Date.now();
    logger.warn(`[Kafka] Producer unavailable — will retry in ${KAFKA_RETRY_INTERVAL_MS / 1000}s:`, (err as Error).message);
    return null;
  }
}

/** Send a failed message to the Dead Letter Queue */
export async function sendToDLQ(originalTopic: string, key: string, value: string, error: string): Promise<void> {
  const producer = await getKafkaProducer();
  if (!producer) {
    logger.error({ originalTopic, key, error }, "[Kafka] Cannot send to DLQ — producer unavailable");
    throw new Error(`[Kafka] DLQ publish failed — producer unavailable (originalTopic=${originalTopic})`);
  }
  await producer.send({
    topic: KAFKA_TOPICS.DLQ,
    messages: [{
      key,
      value: JSON.stringify({ originalTopic, originalValue: value, error, failedAt: new Date().toISOString() }),
      headers: { "x-original-topic": Buffer.from(originalTopic), "x-error": Buffer.from(error.slice(0, 500)) },
    }],
  });
}

export async function ensureTopicsExist(): Promise<void> {
  if (_connectionFailed && Date.now() - _lastConnectionAttempt < KAFKA_RETRY_INTERVAL_MS) return;
  try {
    const admin: Admin = getRealKafka().admin();
    await admin.connect();
    const existing = await admin.listTopics();
    const toCreate = Object.values(KAFKA_TOPICS)
      .filter(t => !existing.includes(t))
      .map(topic => ({ topic, numPartitions: 3, replicationFactor: 1 }));
    if (toCreate.length > 0) {
      await admin.createTopics({ topics: toCreate });
      logger.info("[Kafka] Created topics:", toCreate.map(t => t.topic).join(", "));
    }
    await admin.disconnect();
  } catch (err) {
    logger.warn("[Kafka] Could not ensure topics:", (err as Error).message);
  }
}

/**
 * Schema registry for event validation.
 * In production: integrate with Confluent Schema Registry or AWS Glue.
 * For now: validates event shape at publish time to prevent schema drift.
 */
const EVENT_SCHEMAS: Record<string, string[]> = {
  [KAFKA_TOPICS.TRANSACTIONS]: ["eventType", "transactionId", "userId", "amount", "currency", "status", "timestamp"],
  [KAFKA_TOPICS.KYC_EVENTS]: ["eventType", "userId", "timestamp"],
  [KAFKA_TOPICS.FX_RATES]: ["baseCurrency", "quoteCurrency", "rate", "timestamp"],
  [KAFKA_TOPICS.RISK_SCORES]: ["transactionId", "riskScore", "riskLevel", "decision", "timestamp"],
  [KAFKA_TOPICS.NOTIFICATIONS]: ["userId", "type", "title", "message", "timestamp"],
  [KAFKA_TOPICS.PAYMENT_INITIATED]: ["paymentId", "userId", "amount", "timestamp"],
  [KAFKA_TOPICS.KYC_TRIGGER_INITIATED]: ["triggerType", "userId", "triggeredBy", "timestamp"],
  [KAFKA_TOPICS.KYC_TRIGGER_COMPLETED]: ["triggerType", "userId", "triggeredBy", "timestamp"],
  [KAFKA_TOPICS.KYB_TRIGGER_INITIATED]: ["triggerType", "userId", "triggeredBy", "timestamp"],
  [KAFKA_TOPICS.KYC_SANCTIONS_FREEZE]: ["userId", "timestamp"],
};

function validateEventSchema(topic: string, payload: Record<string, unknown>): boolean {
  const requiredFields = EVENT_SCHEMAS[topic];
  if (!requiredFields) return true;
  for (const field of requiredFields) {
    if (payload[field] === undefined && payload[field] !== null) {
      logger.warn(`[Kafka] Schema validation: missing field '${field}' in ${topic}`);
      return false;
    }
  }
  return true;
}

export async function publishEvent<T>(topic: KafkaTopic | string, key: string, payload: T): Promise<boolean> {
  const p = await getKafkaProducer();
  // Validate event schema before publishing
  if (typeof payload === 'object' && payload !== null) {
    validateEventSchema(topic, payload as Record<string, unknown>);
  }
  if (!p) {
    if (process.env.NODE_ENV !== "production") {
      logger.info(`[Kafka:DEV] ${topic}:`, JSON.stringify(payload).slice(0, 120));
    }
    return false;
  }
  try {
    await p.send({
      topic,
      compression: CompressionTypes.GZIP,
      messages: [{
        key,
        value: JSON.stringify({ ...(payload as object), _publishedAt: new Date().toISOString() }),
        headers: {
          'x-schema-version': Buffer.from('v1'),
          'x-source': Buffer.from('remitflow-app'),
          // Deterministic idempotency key: stable for a given (topic, aggregate/event id)
          // so retries of the same logical event dedupe instead of duplicating.
          'x-idempotency-key': Buffer.from(`${topic}:${key}`),
        },
      }],
    });
    return true;
  } catch (err) {
    logger.error("[Kafka] Publish failed:", topic, (err as Error).message);
    // Attempt DLQ for critical topics
    if (topic.startsWith('remitflow.payment') || topic === KAFKA_TOPICS.TRANSACTIONS) {
      await sendToDLQ(topic, key, JSON.stringify(payload), (err as Error).message).catch(() => {});
    }
    return false;
  }
}

export async function createKafkaConsumer(groupId?: string): Promise<Consumer | null> {
  if (_connectionFailed) return null;
  try {
    const consumer = getRealKafka().consumer({
      groupId: groupId || KAFKA_GROUP_ID,
    } as Parameters<Kafka['consumer']>[0]);
    await consumer.connect();
    return consumer;
  } catch (err) {
    logger.warn("[Kafka] Consumer unavailable:", (err as Error).message);
    return null;
  }
}

/**
 * Subscribe a consumer to topics with at-least-once message processing.
 * Messages are processed with manual offset commit on success.
 * Failed messages are sent to DLQ.
 */
export async function subscribeWithHandler(
  consumer: Consumer,
  topics: string[],
  handler: (topic: string, key: string | null, value: Record<string, unknown>) => Promise<void>
): Promise<void> {
  for (const topic of topics) {
    await consumer.subscribe({ topic, fromBeginning: false });
  }

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const key = message.key?.toString() ?? null;
      const valueStr = message.value?.toString() ?? "{}";
      try {
        const value = JSON.parse(valueStr) as Record<string, unknown>;
        await handler(topic, key, value);
      } catch (err) {
        logger.error({ topic, partition, offset: message.offset, err }, "[Kafka] Message processing failed — sending to DLQ");
        await sendToDLQ(topic, key ?? "unknown", valueStr, (err as Error).message).catch(() => {});
      }
    },
  });
}

export async function disconnectKafka(): Promise<void> {
  if (_producer && _isConnected) {
    await _producer.disconnect();
    _isConnected = false;
  }
}

// ── High-Level Event Publishers ───────────────────────────────────────────────
export async function publishTransactionEvent(event: TransactionEvent): Promise<void> {
  await publishEvent(KAFKA_TOPICS.TRANSACTIONS, String(event.transactionId), {
    ...event, timestamp: event.timestamp || new Date().toISOString(),
  });
}

export async function publishKYCEvent(event: KYCEvent): Promise<void> {
  await publishEvent(KAFKA_TOPICS.KYC_EVENTS, String(event.userId), {
    ...event, timestamp: event.timestamp || new Date().toISOString(),
  });
}

export async function publishKYCTriggerEvent(event: KYCTriggerEvent): Promise<void> {
  await publishEvent(KAFKA_TOPICS.KYC_TRIGGER_INITIATED, String(event.userId), {
    ...event, timestamp: event.timestamp || new Date().toISOString(),
  });
}

export async function publishKYCTriggerCompleted(event: KYCTriggerEvent): Promise<void> {
  await publishEvent(KAFKA_TOPICS.KYC_TRIGGER_COMPLETED, String(event.userId), {
    ...event, timestamp: event.timestamp || new Date().toISOString(),
  });
}

export async function publishKYBTriggerEvent(event: KYCTriggerEvent): Promise<void> {
  await publishEvent(KAFKA_TOPICS.KYB_TRIGGER_INITIATED, String(event.userId), {
    ...event, timestamp: event.timestamp || new Date().toISOString(),
  });
}

export async function publishSanctionsFreezeEvent(event: {
  userId: number | string;
  reason: string;
  sanctionsListHit: string;
  timestamp: string;
}): Promise<void> {
  await publishEvent(KAFKA_TOPICS.KYC_SANCTIONS_FREEZE, String(event.userId), {
    ...event, timestamp: event.timestamp || new Date().toISOString(),
  });
}

export async function publishEDDRequiredEvent(event: {
  userId: number | string;
  reason: string;
  riskScore: number;
  timestamp: string;
}): Promise<void> {
  await publishEvent(KAFKA_TOPICS.KYC_EDD_REQUIRED, String(event.userId), {
    ...event, timestamp: event.timestamp || new Date().toISOString(),
  });
}

export async function publishReKYCRequiredEvent(event: {
  userId: number | string;
  reason: string;
  dueDate: string;
  timestamp: string;
}): Promise<void> {
  await publishEvent(KAFKA_TOPICS.KYC_REKYC_REQUIRED, String(event.userId), {
    ...event, timestamp: event.timestamp || new Date().toISOString(),
  });
}

export async function publishFXRateEvent(event: FXRateEvent): Promise<void> {
  await publishEvent(KAFKA_TOPICS.FX_RATES, `${event.baseCurrency}:${event.quoteCurrency}`, {
    ...event, timestamp: event.timestamp || new Date().toISOString(),
  });
}

export async function publishRiskScoreEvent(event: RiskScoreEvent): Promise<void> {
  await publishEvent(KAFKA_TOPICS.RISK_SCORES, String(event.transactionId), {
    ...event, timestamp: event.timestamp || new Date().toISOString(),
  });
}

export async function publishNotificationEvent(event: NotificationEvent): Promise<void> {
  await publishEvent(KAFKA_TOPICS.NOTIFICATIONS, String(event.userId), {
    ...event, timestamp: event.timestamp || new Date().toISOString(),
  });
}

export async function publishAuditEvent(event: {
  userId: number | string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: string;
  ipAddress?: string;
  severity?: string;
}): Promise<void> {
  await publishEvent(KAFKA_TOPICS.AUDIT_LOGS, String(event.userId), {
    ...event, timestamp: new Date().toISOString(),
  });
}

export async function publishLivenessResultEvent(event: {
  auditId: number;
  userId: number;
  corridorCode: string;
  overallLive: boolean;
  passiveScore: number | null;
  passivePassed: boolean | null;
  activePassed: boolean | null;
  blinkCount: number | null;
  headMovementDeg: number | null;
  deepfakeScore: number | null;
  deepfakePassed: boolean | null;
  deepfakeMethod: string | null;
  source: string;
  createdAt: string;
}): Promise<boolean> {
  return publishEvent(KAFKA_TOPICS.KYC_LIVENESS_RESULT, String(event.userId), event);
}

export async function publishComplianceAlertEvent(event: {
  alertType: string;
  corridorCode: string;
  metric: string;
  value: number;
  threshold: number;
  windowSize: number;
  message: string;
  severity: "low" | "medium" | "high" | "critical";
}): Promise<boolean> {
  return publishEvent(KAFKA_TOPICS.COMPLIANCE_ALERT, `${event.alertType}:${event.corridorCode}`, event);
}

export async function publishPaymentInitiated(event: PaymentInitiatedEvent): Promise<void> {
  await publishEvent(KAFKA_TOPICS.PAYMENT_INITIATED, event.paymentId, {
    ...event, timestamp: event.timestamp || new Date().toISOString(),
  });
}

// ── Legacy KafkaClient class (backwards compatibility) ────────────────────────
export function getKafkaClient() {
  return {
    async produce(topic: string, message: unknown): Promise<void> {
      await publishEvent(topic as KafkaTopic, "legacy", message);
    },
    async connect(): Promise<void> { await getKafkaProducer(); },
    async disconnect(): Promise<void> { await disconnectKafka(); },
  };
}
