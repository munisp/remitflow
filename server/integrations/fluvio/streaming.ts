/**
 * RemitFlow — Fluvio Streaming Integration
 * ──────────────────────────────────────────
 * Type-safe Fluvio producer/consumer wrappers for real-time event streaming.
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

// ─── Producer ─────────────────────────────────────────────────────────────────
/**
 * Produces a message to a Fluvio topic.
 * Falls back to the outbox pattern if Fluvio is unavailable.
 */
export async function fluvioProduce(
  topic: FluvioTopic,
  key: string,
  value: unknown
): Promise<void> {
  const payload = typeof value === "string" ? value : JSON.stringify(value);

  try {
    // Try direct Fluvio HTTP bridge (if configured)
    const bridgeUrl = process.env.FLUVIO_HTTP_BRIDGE_URL;
    if (bridgeUrl) {
      const res = await fetch(`${bridgeUrl}/produce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, key, value: payload }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        logger.debug({ topic, key }, "[Fluvio] Message produced");
        return;
      }
    }

    // Fallback: write to outbox table for async delivery
    const db = await getDb();
    if (db) {
      await (db as any).execute(sql`
        INSERT INTO outbox_events (aggregate_id, aggregate_type, event_type, payload, status, created_at)
        VALUES (${key}, ${topic}, 'fluvio.message', ${payload}, 'pending', NOW())
      `);
      logger.debug({ topic, key }, "[Fluvio] Message queued in outbox");
    }
  } catch (err) {
    logger.error({ err, topic, key }, "[Fluvio] Produce failed");
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
