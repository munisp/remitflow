/**
 * RemitFlow — Fluvio Streaming Integration
 * ──────────────────────────────────────────
 * Type-safe Fluvio producer/consumer wrappers for real-time event streaming.
 *
 * Delivery semantics (post-audit F2): fluvioProduce() talks directly to the
 * Fluvio HTTP bridge and THROWS a typed FluvioError on any failure — the
 * outbox worker converts that into retries / dead-letter. No silent fallback,
 * no empty-success fabrication. Producers that explicitly want async delivery
 * use enqueueFluvioOutbox().
 *
 * Topics:
 *   - transfer-events: All transfer lifecycle events
 *   - kyc-events: KYC verification events
 *   - fraud-events: Fraud detection events
 *   - audit-events: Compliance audit trail
 *   - settlement-events: Settlement and reconciliation events
 *   - fx-events: FX rate updates and alerts
 *   - notification-events: User notification triggers
 */
import { logger } from "../../_core/logger";
import { getDb } from "../../db";
import { sql } from "drizzle-orm";

// ─── Topic Definitions ────────────────────────────────────────────────────────
export const FLUVIO_TOPICS = {
  TRANSFERS: "transfer-events",
  KYC: "kyc-events",
  FRAUD: "fraud-events",
  AUDIT: "audit-events",
  SETTLEMENT: "settlement-events",
  FX: "fx-events",
  NOTIFICATIONS: "notification-events",
  COMPLIANCE: "compliance-events",
  TIGERBEETLE: "tigerbeetle-events",
  TEMPORAL: "temporal-events",
} as const;

export type FluvioTopic = typeof FLUVIO_TOPICS[keyof typeof FLUVIO_TOPICS];

// ─── Event Schemas ────────────────────────────────────────────────────────────
export interface FluvioTransferEvent {
  event: "transfer.initiated" | "transfer.completed" | "transfer.failed" | "transfer.reversed";
  userId: number;
  transactionId?: number;
  amount: string;
  fromCurrency: string;
  toCurrency: string;
  rail: string;
  workflowId?: string;
  timestamp: string;
}

export interface FluvioKycEvent {
  event: "kyc.started" | "kyc.approved" | "kyc.rejected" | "kyc.tier_upgraded";
  userId: number;
  documentId?: number;
  tier?: string;
  timestamp: string;
}

export interface FluvioFraudEvent {
  event: "fraud.detected" | "fraud.resolved" | "fraud.escalated";
  userId: number;
  alertId: number;
  riskScore: number;
  reason: string;
  timestamp: string;
}

export interface FluvioAuditEvent {
  event: string;
  userId: number;
  action: string;
  resource: string;
  resourceId?: string;
  ipAddress?: string;
  timestamp: string;
}

export interface FluvioFxEvent {
  event: "fx.rate.updated" | "fx.alert.triggered";
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  source: string;
  timestamp: string;
}

// ─── Errors ──────────────────────────────────────────────────────────────────
/**
 * Typed Fluvio delivery failure. The outbox worker (server/workers/outbox.worker.ts)
 * catches these, applies its backoff schedule, and dead-letters after max retries.
 * There is deliberately NO silent fallback: a failed produce must surface.
 */
export type FluvioErrorCode = "BRIDGE_NOT_CONFIGURED" | "BRIDGE_UNREACHABLE" | "BRIDGE_REJECTED";

export class FluvioError extends Error {
  readonly code: FluvioErrorCode;
  readonly topic: string;
  constructor(code: FluvioErrorCode, topic: string, detail: string) {
    super(`[Fluvio] ${code}: topic=${topic} — ${detail}`);
    this.name = "FluvioError";
    this.code = code;
    this.topic = topic;
  }
}

// ─── Producer ─────────────────────────────────────────────────────────────────
/**
 * Produces a message to a Fluvio topic via the Fluvio HTTP bridge.
 *
 * FAILS LOUDLY: throws FluvioError when the bridge is not configured, is
 * unreachable, or rejects the record. Callers that need async delivery must
 * explicitly enqueue via enqueueFluvioOutbox() — nothing is fabricated here.
 */
export async function fluvioProduce(
  topic: FluvioTopic | string,
  key: string,
  value: unknown
): Promise<void> {
  const payload = typeof value === "string" ? value : JSON.stringify(value);

  const bridgeUrl = process.env.FLUVIO_HTTP_BRIDGE_URL;
  if (!bridgeUrl) {
    throw new FluvioError("BRIDGE_NOT_CONFIGURED", topic, "FLUVIO_HTTP_BRIDGE_URL is not set");
  }

  let res: Response;
  try {
    res = await fetch(`${bridgeUrl}/produce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, key, value: payload }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    throw new FluvioError("BRIDGE_UNREACHABLE", topic, (err as Error).message);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new FluvioError("BRIDGE_REJECTED", topic, `HTTP ${res.status} ${body}`.trim());
  }

  logger.debug({ topic, key }, "[Fluvio] Message produced");
}

/**
 * Explicit outbox enqueue for producers that want async, retried delivery.
 * The outbox worker will later call fluvioProduce() and dead-letter on
 * persistent bridge failure.
 */
export async function enqueueFluvioOutbox(
  topic: FluvioTopic | string,
  key: string,
  value: unknown
): Promise<void> {
  const payload = typeof value === "string" ? value : JSON.stringify(value);
  const db = await getDb();
  if (!db) {
    throw new FluvioError("BRIDGE_UNREACHABLE", topic, "database unavailable — cannot enqueue outbox event");
  }
  await (db as any).execute(sql`
    INSERT INTO outbox_events (aggregate_id, aggregate_type, event_type, payload, status, created_at)
    VALUES (${key}, ${topic}, 'fluvio.message', ${payload}, 'pending', NOW())
  `);
  logger.debug({ topic, key }, "[Fluvio] Message queued in outbox");
}

/**
 * Real health check against the Fluvio HTTP bridge. Never fabricates a
 * healthy status — reports configured/connected plus the error when down.
 */
export async function getFluvioBridgeHealth(): Promise<{
  configured: boolean;
  connected: boolean;
  endpoint: string | null;
  error: string | null;
}> {
  const bridgeUrl = process.env.FLUVIO_HTTP_BRIDGE_URL;
  if (!bridgeUrl) {
    return { configured: false, connected: false, endpoint: null, error: "FLUVIO_HTTP_BRIDGE_URL is not set" };
  }
  try {
    const res = await fetch(`${bridgeUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) {
      return { configured: true, connected: false, endpoint: bridgeUrl, error: `HTTP ${res.status}` };
    }
    return { configured: true, connected: true, endpoint: bridgeUrl, error: null };
  } catch (err) {
    return { configured: true, connected: false, endpoint: bridgeUrl, error: (err as Error).message };
  }
}

// ─── Typed Producers ─────────────────────────────────────────────────────────
export const fluvioStream = {
  transferEvent: (event: FluvioTransferEvent) =>
    fluvioProduce(FLUVIO_TOPICS.TRANSFERS, String(event.userId), event),

  kycEvent: (event: FluvioKycEvent) =>
    fluvioProduce(FLUVIO_TOPICS.KYC, String(event.userId), event),

  fraudEvent: (event: FluvioFraudEvent) =>
    fluvioProduce(FLUVIO_TOPICS.FRAUD, String(event.userId), event),

  auditEvent: (event: FluvioAuditEvent) =>
    fluvioProduce(FLUVIO_TOPICS.AUDIT, String(event.userId), event),

  fxEvent: (event: FluvioFxEvent) =>
    fluvioProduce(FLUVIO_TOPICS.FX, `${event.fromCurrency}-${event.toCurrency}`, event),

  complianceEvent: (event: Record<string, unknown>) =>
    fluvioProduce(FLUVIO_TOPICS.COMPLIANCE, String(event.userId ?? "system"), event),

  tigerBeetleEvent: (event: Record<string, unknown>) =>
    fluvioProduce(FLUVIO_TOPICS.TIGERBEETLE, String(event.accountId ?? "system"), event),

  temporalEvent: (event: Record<string, unknown>) =>
    fluvioProduce(FLUVIO_TOPICS.TEMPORAL, String(event.workflowId ?? "system"), event),
};

// ─── Offset Management ────────────────────────────────────────────────────────
export async function updateFluvioOffset(
  topic: FluvioTopic,
  partition: number,
  consumerGroup: string,
  offset: bigint
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await (db as any).execute(sql`
      INSERT INTO fluvio_offsets (topic, partition, consumer_group, offset, updated_at)
      VALUES (${topic}, ${partition}, ${consumerGroup}, ${offset}, NOW())
      ON CONFLICT (topic, partition, consumer_group)
      DO UPDATE SET offset = EXCLUDED.offset, updated_at = NOW()
    `);
  } catch (err) {
    logger.error({ err, topic, consumerGroup }, "[Fluvio] Offset update failed");
  }
}

export async function getFluvioOffset(
  topic: FluvioTopic,
  partition: number,
  consumerGroup: string
): Promise<bigint> {
  const db = await getDb();
  if (!db) return BigInt(0);

  try {
    const res = await (db as any).execute(sql`
      SELECT offset FROM fluvio_offsets
      WHERE topic = ${topic} AND partition = ${partition} AND consumer_group = ${consumerGroup}
    `);
    return res[0]?.offset ? BigInt(res[0].offset) : BigInt(0);
  } catch (err) {
    logger.error({ err, topic, consumerGroup }, "[Fluvio] Offset get failed");
    return BigInt(0);
  }
}
