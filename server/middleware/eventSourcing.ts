/**
 * RemitFlow — Event Sourcing & CQRS Engine
 *
 * Full event sourcing implementation using Kafka + Postgres event store.
 * - Every state change is captured as an immutable event
 * - Events are published to Kafka topics for downstream consumers
 * - CQRS: Command handlers write events, Query handlers read materialized views
 * - Event replay for rebuilding state from scratch
 * - Snapshots for performance optimization
 *
 * Integrations: Kafka (streaming), Postgres (event store), Redis (read cache),
 *               OpenSearch (full-text search on events), TigerBeetle (financial ledger)
 */
import { z } from "zod";
import { getDb } from "../db.js";
import { sql, desc, asc, eq, and, gte, lte, count } from "drizzle-orm";
import { logger } from "../_core/logger.js";
import { getKafkaProducer, KAFKA_TOPICS } from "./kafka.js";

// ─── Event Types ──────────────────────────────────────────────────────────────
export type DomainEvent = {
  eventId: string;
  aggregateId: string;
  aggregateType: AggregateType;
  eventType: string;
  version: number;
  payload: Record<string, unknown>;
  metadata: EventMetadata;
  timestamp: Date;
};

export type AggregateType =
  | "Transfer" | "Wallet" | "User" | "Beneficiary" | "KYC"
  | "Dispute" | "Card" | "Savings" | "Loan" | "FXOrder"
  | "DirectDebit" | "RecurringPayment" | "CBDC" | "Agent";

export interface EventMetadata {
  userId?: number;
  correlationId: string;
  causationId?: string;
  source: string;
  ip?: string;
  userAgent?: string;
  schemaVersion: number;
}

// ─── Event Store (Postgres-backed) ────────────────────────────────────────────
const EVENT_STORE_DDL = `
  CREATE TABLE IF NOT EXISTS event_store (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_id VARCHAR(255) NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    event_type VARCHAR(200) NOT NULL,
    version INTEGER NOT NULL,
    payload JSONB NOT NULL,
    metadata JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (aggregate_id, version)
  );
  CREATE INDEX IF NOT EXISTS idx_event_store_aggregate ON event_store (aggregate_id, version ASC);
  CREATE INDEX IF NOT EXISTS idx_event_store_type ON event_store (event_type);
  CREATE INDEX IF NOT EXISTS idx_event_store_created ON event_store (created_at);

  CREATE TABLE IF NOT EXISTS event_snapshots (
    snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_id VARCHAR(255) NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    version INTEGER NOT NULL,
    state JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (aggregate_id)
  );

  CREATE TABLE IF NOT EXISTS materialized_projections (
    projection_id VARCHAR(200) PRIMARY KEY,
    last_event_id UUID,
    last_version INTEGER NOT NULL DEFAULT 0,
    state JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

let _initialized = false;

export async function initEventStore(): Promise<void> {
  if (_initialized) return;
  const db = await getDb();
  if (!db) { logger.warn("[EventSourcing] DB unavailable, event store not initialized"); return; }
  try {
    await db.execute(sql.raw(EVENT_STORE_DDL));
    _initialized = true;
    logger.info("[EventSourcing] Event store initialized");
  } catch (err) {
    logger.error({ err }, "[EventSourcing] Failed to initialize event store");
  }
}

// ─── Append Events ────────────────────────────────────────────────────────────
export async function appendEvents(
  aggregateId: string,
  aggregateType: AggregateType,
  events: Array<{ eventType: string; payload: Record<string, unknown> }>,
  metadata: EventMetadata,
  expectedVersion?: number
): Promise<DomainEvent[]> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable for event store");

  // Optimistic concurrency check
  const [currentRow] = await db.execute(
    sql`SELECT COALESCE(MAX(version), 0) as max_version FROM event_store WHERE aggregate_id = ${aggregateId}`
  ) as any[];
  const currentVersion = Number(currentRow?.max_version ?? 0);

  if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
    throw new Error(`Concurrency conflict: expected version ${expectedVersion}, found ${currentVersion}`);
  }

  const storedEvents: DomainEvent[] = [];
  let version = currentVersion;

  for (const event of events) {
    version++;
    const domainEvent: DomainEvent = {
      eventId: crypto.randomUUID(),
      aggregateId,
      aggregateType,
      eventType: event.eventType,
      version,
      payload: event.payload,
      metadata: { ...metadata, schemaVersion: metadata.schemaVersion || 1 },
      timestamp: new Date(),
    };

    await db.execute(sql`
      INSERT INTO event_store (event_id, aggregate_id, aggregate_type, event_type, version, payload, metadata)
      VALUES (${domainEvent.eventId}, ${aggregateId}, ${aggregateType}, ${event.eventType}, ${version},
              ${JSON.stringify(event.payload)}::jsonb, ${JSON.stringify(domainEvent.metadata)}::jsonb)
    `);

    storedEvents.push(domainEvent);

    // Publish to Kafka
    try {
      const producer = await getKafkaProducer();
      if (producer) {
        await producer.send({
          topic: `remitflow.events.${aggregateType.toLowerCase()}`,
          messages: [{
            key: aggregateId,
            value: JSON.stringify(domainEvent),
            headers: {
              "event-type": Buffer.from(event.eventType),
              "aggregate-type": Buffer.from(aggregateType),
              "correlation-id": Buffer.from(metadata.correlationId),
            },
          }],
        });
      }
    } catch (kafkaErr) {
      logger.warn({ err: kafkaErr }, "[EventSourcing] Kafka publish failed, event persisted to DB only");
    }
  }

  return storedEvents;
}

// ─── Load Events ──────────────────────────────────────────────────────────────
export async function loadEvents(
  aggregateId: string,
  fromVersion?: number
): Promise<DomainEvent[]> {
  const db = await getDb();
  if (!db) return [];

  const minVersion = fromVersion ?? 0;
  const rows = await db.execute(
    sql`SELECT * FROM event_store WHERE aggregate_id = ${aggregateId} AND version > ${minVersion} ORDER BY version ASC`
  ) as any[];

  return (rows as any[]).map((r: any) => ({
    eventId: r.event_id,
    aggregateId: r.aggregate_id,
    aggregateType: r.aggregate_type as AggregateType,
    eventType: r.event_type,
    version: r.version,
    payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
    metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata,
    timestamp: new Date(r.created_at),
  }));
}

// ─── Snapshots ────────────────────────────────────────────────────────────────
export async function saveSnapshot(
  aggregateId: string,
  aggregateType: AggregateType,
  version: number,
  state: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`
    INSERT INTO event_snapshots (aggregate_id, aggregate_type, version, state)
    VALUES (${aggregateId}, ${aggregateType}, ${version}, ${JSON.stringify(state)}::jsonb)
    ON CONFLICT (aggregate_id) DO UPDATE SET version = ${version}, state = ${JSON.stringify(state)}::jsonb, created_at = NOW()
  `);
}

export async function loadSnapshot(aggregateId: string): Promise<{ version: number; state: Record<string, unknown> } | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.execute(
    sql`SELECT version, state FROM event_snapshots WHERE aggregate_id = ${aggregateId}`
  ) as any[];
  if (!row) return null;
  return { version: row.version, state: typeof row.state === "string" ? JSON.parse(row.state) : row.state };
}

// ─── Materialized Projections (CQRS Read Models) ─────────────────────────────
export async function updateProjection(
  projectionId: string,
  lastEventId: string,
  lastVersion: number,
  state: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`
    INSERT INTO materialized_projections (projection_id, last_event_id, last_version, state)
    VALUES (${projectionId}, ${lastEventId}::uuid, ${lastVersion}, ${JSON.stringify(state)}::jsonb)
    ON CONFLICT (projection_id) DO UPDATE SET last_event_id = ${lastEventId}::uuid, last_version = ${lastVersion},
      state = ${JSON.stringify(state)}::jsonb, updated_at = NOW()
  `);
}

export async function getProjection(projectionId: string): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.execute(
    sql`SELECT state FROM materialized_projections WHERE projection_id = ${projectionId}`
  ) as any[];
  if (!row) return null;
  return typeof row.state === "string" ? JSON.parse(row.state) : row.state;
}

// ─── Event Replay ─────────────────────────────────────────────────────────────
export async function replayEvents(
  aggregateType: AggregateType,
  handler: (event: DomainEvent) => Promise<void>,
  fromTimestamp?: Date,
  batchSize = 1000
): Promise<{ processed: number; errors: number }> {
  const db = await getDb();
  if (!db) return { processed: 0, errors: 0 };

  let offset = 0;
  let processed = 0;
  let errors = 0;

  while (true) {
    const condition = fromTimestamp
      ? sql`aggregate_type = ${aggregateType} AND created_at >= ${fromTimestamp.toISOString()}`
      : sql`aggregate_type = ${aggregateType}`;

    const rows = await db.execute(
      sql`SELECT * FROM event_store WHERE ${condition} ORDER BY created_at ASC, version ASC LIMIT ${batchSize} OFFSET ${offset}`
    ) as any[];

    if (!rows || (rows as any[]).length === 0) break;

    for (const row of rows as any[]) {
      try {
        const event: DomainEvent = {
          eventId: row.event_id,
          aggregateId: row.aggregate_id,
          aggregateType: row.aggregate_type as AggregateType,
          eventType: row.event_type,
          version: row.version,
          payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
          metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
          timestamp: new Date(row.created_at),
        };
        await handler(event);
        processed++;
      } catch {
        errors++;
      }
    }

    offset += batchSize;
    if ((rows as any[]).length < batchSize) break;
  }

  return { processed, errors };
}

// ─── Transfer Aggregate (Domain Model) ────────────────────────────────────────
export interface TransferState {
  transferId: string;
  userId: number;
  status: "initiated" | "validated" | "sanctioned" | "submitted" | "processing" | "completed" | "failed" | "refunded";
  fromCurrency: string;
  toCurrency: string;
  fromAmount: number;
  toAmount: number;
  fee: number;
  rail: string;
  beneficiaryId?: number;
  railReference?: string;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export function applyTransferEvent(state: TransferState | null, event: DomainEvent): TransferState {
  const p = event.payload as Record<string, any>;
  switch (event.eventType) {
    case "TransferInitiated":
      return {
        transferId: event.aggregateId,
        userId: p.userId,
        status: "initiated",
        fromCurrency: p.fromCurrency,
        toCurrency: p.toCurrency,
        fromAmount: p.fromAmount,
        toAmount: 0,
        fee: 0,
        rail: p.rail ?? "unknown",
        beneficiaryId: p.beneficiaryId,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      };
    case "TransferValidated":
      return { ...state!, status: "validated", fee: p.fee ?? state!.fee, toAmount: p.toAmount ?? state!.toAmount, updatedAt: event.timestamp };
    case "TransferSanctioned":
      return { ...state!, status: "sanctioned", updatedAt: event.timestamp };
    case "TransferSubmitted":
      return { ...state!, status: "submitted", rail: p.rail ?? state!.rail, railReference: p.railReference, updatedAt: event.timestamp };
    case "TransferProcessing":
      return { ...state!, status: "processing", updatedAt: event.timestamp };
    case "TransferCompleted":
      return { ...state!, status: "completed", toAmount: p.toAmount ?? state!.toAmount, railReference: p.railReference ?? state!.railReference, updatedAt: event.timestamp };
    case "TransferFailed":
      return { ...state!, status: "failed", failureReason: p.reason, updatedAt: event.timestamp };
    case "TransferRefunded":
      return { ...state!, status: "refunded", updatedAt: event.timestamp };
    default:
      return state!;
  }
}

export async function getTransferState(transferId: string): Promise<TransferState | null> {
  const snapshot = await loadSnapshot(transferId);
  let state: TransferState | null = (snapshot?.state as unknown as TransferState) ?? null;
  const fromVersion = snapshot?.version ?? 0;

  const events = await loadEvents(transferId, fromVersion);
  for (const event of events) {
    state = applyTransferEvent(state, event);
  }

  // Save snapshot every 10 events
  if (events.length >= 10 && state) {
    const lastEvent = events[events.length - 1];
    await saveSnapshot(transferId, "Transfer", lastEvent.version, state as unknown as Record<string, unknown>);
  }

  return state;
}

// ─── Command Handlers ─────────────────────────────────────────────────────────
export async function initiateTransfer(params: {
  userId: number;
  fromCurrency: string;
  toCurrency: string;
  fromAmount: number;
  beneficiaryId?: number;
  rail?: string;
  correlationId: string;
}): Promise<{ transferId: string; events: DomainEvent[] }> {
  const transferId = `TXF-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  const events = await appendEvents(
    transferId,
    "Transfer",
    [{ eventType: "TransferInitiated", payload: { ...params } }],
    { correlationId: params.correlationId, source: "api", userId: params.userId, schemaVersion: 1 }
  );

  return { transferId, events };
}

export async function completeTransfer(transferId: string, params: {
  toAmount: number;
  railReference: string;
  correlationId: string;
  userId: number;
}): Promise<DomainEvent[]> {
  const state = await getTransferState(transferId);
  if (!state) throw new Error(`Transfer ${transferId} not found`);
  if (state.status === "completed") throw new Error(`Transfer already completed`);

  return appendEvents(
    transferId,
    "Transfer",
    [{ eventType: "TransferCompleted", payload: { toAmount: params.toAmount, railReference: params.railReference } }],
    { correlationId: params.correlationId, source: "api", userId: params.userId, schemaVersion: 1 },
    state.updatedAt ? undefined : 0
  );
}
