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
  if (_connectionFailed) return null;
  if (_producer && _isConnected) return _producer;
  try {
    _producer = getRealKafka().producer({ allowAutoTopicCreation: true });
    await _producer.connect();
    _isConnected = true;
    logger.info("[Kafka] Producer connected to", KAFKA_BROKERS.join(","));
    return _producer;
  } catch (err) {
    _connectionFailed = true;
    logger.warn("[Kafka] Producer unavailable — degraded mode:", (err as Error).message);
    return null;
  }
}

export async function ensureTopicsExist(): Promise<void> {
  if (_connectionFailed) return;
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

export async function publishEvent<T>(topic: KafkaTopic | string, key: string, payload: T): Promise<boolean> {
  const p = await getKafkaProducer();
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
      messages: [{ key, value: JSON.stringify({ ...(payload as object), _publishedAt: new Date().toISOString() }) }],
    });
    return true;
  } catch (err) {
    logger.error("[Kafka] Publish failed:", topic, (err as Error).message);
    return false;
  }
}

export async function createKafkaConsumer(groupId?: string): Promise<Consumer | null> {
  if (_connectionFailed) return null;
  try {
    const consumer = getRealKafka().consumer({ groupId: groupId || KAFKA_GROUP_ID });
    await consumer.connect();
    return consumer;
  } catch (err) {
    logger.warn("[Kafka] Consumer unavailable:", (err as Error).message);
    return null;
  }
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
