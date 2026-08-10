/**
 * RemitFlow — Dapr Pub/Sub Integration
 * ──────────────────────────────────────
 * Provides type-safe Dapr pub/sub wrappers for all platform events.
 *
 * Topics:
 *   - transfer.initiated / transfer.completed / transfer.failed
 *   - kyc.verification.started / kyc.approved / kyc.rejected
 *   - user.provisioned / user.suspended
 *   - compliance.case.opened / compliance.case.resolved
 *   - fraud.alert.raised / fraud.alert.resolved
 *   - fx.rate.updated
 */
import { logger } from "../../_core/logger";
import { getDb, createAuditLog } from "../../db";
import { KAFKA_TOPICS } from "../../middleware/kafka";
import { getConsumerHandlers } from "../../middleware/kafkaConsumer";

const DAPR_HTTP_PORT = process.env.DAPR_HTTP_PORT || "3500";
// Component names match the Dapr Component manifests:
//   infrastructure/manifests/dapr/pubsub.yaml        → metadata.name: pubsub
//   infrastructure/runtime/dapr/components/statestore.yaml → metadata.name: statestore
const PUBSUB_NAME = process.env.DAPR_PUBSUB || "pubsub";
const BASE_URL = `http://localhost:${DAPR_HTTP_PORT}/v1.0/publish/${PUBSUB_NAME}`;

// ─── Event Types ──────────────────────────────────────────────────────────────
export interface TransferInitiatedEvent {
  userId: number;
  amount: string;
  fromCurrency: string;
  toCurrency: string;
  rail: string;
  workflowId: string;
  idempotencyKey: string;
  timestamp: string;
}

export interface TransferCompletedEvent {
  userId: number;
  transactionId: number;
  amount: string;
  fromCurrency: string;
  toCurrency: string;
  workflowId: string;
  timestamp: string;
}

export interface TransferFailedEvent {
  userId: number;
  transactionId?: number;
  amount: string;
  fromCurrency: string;
  toCurrency: string;
  error: string;
  workflowId: string;
  timestamp: string;
}

export interface KycVerificationEvent {
  userId: number;
  documentId: number;
  workflowId: string;
  timestamp: string;
}

export interface KycApprovedEvent {
  userId: number;
  documentId: number;
  newTier: string;
  timestamp: string;
}

export interface UserProvisionedEvent {
  userId: number;
  currencies: string[];
  timestamp: string;
}

export interface FraudAlertEvent {
  userId: number;
  alertId: number;
  riskScore: number;
  reason: string;
  timestamp: string;
}

export interface FxRateUpdatedEvent {
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  source: string;
  timestamp: string;
}

// ─── Publisher ────────────────────────────────────────────────────────────────
/**
 * Payment- and compliance-critical topics: a failed publish THROWS
 * (DaprPublishError) so the caller / outbox worker can retry or dead-letter.
 * Swallowing these failures silently loses money-movement lifecycle events.
 */
const CRITICAL_TOPICS = new Set([
  "transfer.initiated",
  "transfer.completed",
  "transfer.failed",
  "kyc.verification.started",
  "kyc.approved",
  "kyc.rejected",
  "user.provisioned",
  "fraud.alert.raised",
]);

export class DaprPublishError extends Error {
  readonly topic: string;
  constructor(topic: string, detail: string) {
    super(`[Dapr] Publish failed for topic=${topic}: ${detail}`);
    this.name = "DaprPublishError";
    this.topic = topic;
  }
}

async function publish<T>(topic: string, data: T): Promise<void> {
  const critical = CRITICAL_TOPICS.has(topic);
  try {
    const res = await fetch(`${BASE_URL}/${topic}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new DaprPublishError(topic, `HTTP ${res.status} — ${body}`);
    }
    logger.info({ topic }, "[Dapr] Event published");
  } catch (err) {
    logger.error({ err, topic, critical }, "[Dapr] Event publish failed");
    if (critical) {
      // Fail loudly — outbox worker converts this into retry/dead-letter.
      throw err instanceof DaprPublishError ? err : new DaprPublishError(topic, (err as Error).message);
    }
    // BEST-EFFORT (documented): fx.rate.updated is the only non-critical topic.
    // Rate updates are re-published every tick, so a dropped event self-heals.
  }
}

// ─── Typed Publishers ─────────────────────────────────────────────────────────
export const daprPublish = {
  transferInitiated: (data: TransferInitiatedEvent) => publish("transfer.initiated", data),
  transferCompleted: (data: TransferCompletedEvent) => publish("transfer.completed", data),
  transferFailed: (data: TransferFailedEvent) => publish("transfer.failed", data),
  kycVerificationStarted: (data: KycVerificationEvent) => publish("kyc.verification.started", data),
  kycApproved: (data: KycApprovedEvent) => publish("kyc.approved", data),
  kycRejected: (data: KycVerificationEvent) => publish("kyc.rejected", data),
  userProvisioned: (data: UserProvisionedEvent) => publish("user.provisioned", data),
  fraudAlertRaised: (data: FraudAlertEvent) => publish("fraud.alert.raised", data),
  fxRateUpdated: (data: FxRateUpdatedEvent) => publish("fx.rate.updated", data),
};

// ─── Inbound Subscriptions (Dapr → this app) ─────────────────────────────────
/** The 9 domain topics this app subscribes to (mirrors the typed publishers). */
export const DAPR_DOMAIN_TOPICS = [
  "transfer.initiated",
  "transfer.completed",
  "transfer.failed",
  "kyc.verification.started",
  "kyc.approved",
  "kyc.rejected",
  "user.provisioned",
  "fraud.alert.raised",
  "fx.rate.updated",
] as const;

export type DaprDomainTopic = typeof DAPR_DOMAIN_TOPICS[number];

/** Dapr subscription discovery payload served at GET /dapr/subscribe. */
export function getDaprSubscriptionConfig(): Array<{ pubsubname: string; topic: string; route: string }> {
  return DAPR_DOMAIN_TOPICS.map((topic) => ({
    pubsubname: PUBSUB_NAME,
    topic,
    route: `/events/${topic}`,
  }));
}

// Dapr domain topic → equivalent Kafka topic whose consumer handler applies
// the same business processing (single source of truth for both buses).
const DAPR_TO_KAFKA_TOPIC: Partial<Record<DaprDomainTopic, string>> = {
  "transfer.initiated": KAFKA_TOPICS.PAYMENT_INITIATED,
  "transfer.completed": KAFKA_TOPICS.PAYMENT_COMPLETED,
  "transfer.failed": KAFKA_TOPICS.PAYMENT_FAILED,
  "kyc.verification.started": KAFKA_TOPICS.KYC_EVENTS,
  "kyc.approved": KAFKA_TOPICS.KYC_EVENTS,
  "kyc.rejected": KAFKA_TOPICS.KYC_EVENTS,
  "fraud.alert.raised": KAFKA_TOPICS.FRAUD_ALERT,
  "fx.rate.updated": KAFKA_TOPICS.FX_RATES,
  // user.provisioned has no Kafka equivalent — audit persistence only.
};

/**
 * Handle an inbound Dapr domain event (delivered by the sidecar to
 * POST /events/<topic>). Persists an audit record, then dispatches to the
 * same handler the Kafka consumer uses for the equivalent topic.
 * Throws on failure so the route can answer RETRY and Dapr redelivers.
 */
export async function handleDaprDomainEvent(
  topic: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!(DAPR_DOMAIN_TOPICS as readonly string[]).includes(topic)) {
    throw new Error(`[Dapr] Unknown domain topic: ${topic}`);
  }
  const db = await getDb();
  if (!db) throw new Error("[Dapr] Cannot process event — database unavailable");

  await createAuditLog({
    userId: Number(data.userId) || 0,
    action: `dapr.event.${topic}`,
    targetType: "dapr_event",
    description: String(data.workflowId ?? data.transactionId ?? data.alertId ?? topic),
    metadata: data,
  });

  const kafkaTopic = DAPR_TO_KAFKA_TOPIC[topic as DaprDomainTopic];
  if (kafkaTopic) {
    const handler = getConsumerHandlers().find((h) => h.topic === kafkaTopic);
    if (handler) await handler.handler(data);
  }
}

// ─── State Store ──────────────────────────────────────────────────────────────
const STATE_STORE_NAME = process.env.DAPR_STATE_STORE || "statestore";
const STATE_BASE_URL = `http://localhost:${DAPR_HTTP_PORT}/v1.0/state/${STATE_STORE_NAME}`;

export async function daprSetState(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  try {
    const metadata = ttlSeconds ? { ttlInSeconds: String(ttlSeconds) } : {};
    const res = await fetch(STATE_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ key, value, metadata }]),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    logger.debug({ key }, "[Dapr] State set");
  } catch (err) {
    logger.error({ err, key }, "[Dapr] State set failed");
  }
}

export async function daprGetState<T>(key: string): Promise<T | null> {
  try {
    const res = await fetch(`${STATE_BASE_URL}/${key}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as T;
  } catch (err) {
    logger.error({ err, key }, "[Dapr] State get failed");
    return null;
  }
}

export async function daprDeleteState(key: string): Promise<void> {
  try {
    const res = await fetch(`${STATE_BASE_URL}/${key}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    logger.debug({ key }, "[Dapr] State deleted");
  } catch (err) {
    logger.error({ err, key }, "[Dapr] State delete failed");
  }
}
