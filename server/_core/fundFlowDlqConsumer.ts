/**
 * RemitFlow — Fund-Flow DLQ Consumer + Event-Log Consumers + Kafka Outbox Relay
 * ───────────────────────────────────────────────────────────────────────────────
 * W20 Lane B gap closures:
 *
 *   DL-07: `remitflow.fund-flow.dlq` previously had ZERO consumers — failed fund
 *     flows were published and then vanished. This consumer persists EVERY DLQ
 *     message to `fund_flow_dlq_events` BEFORE committing the offset, and exposes
 *     `replayFundFlowDlqEvents()` (admin/reconciler entry point) which re-publishes
 *     persisted events to their origin topic and stamps `replayed_at`.
 *
 *   DL-08/09: consumers for `remitflow.account.events` and
 *     `remitflow.fund-flow.events` persisting every message to
 *     `account_events_log` / `fund_flow_events_log` (durable audit trail).
 *
 *   DL-19: Kafka outbox relay. transferPipeline.ts writes `kafka_outbox` rows in
 *     the SAME db.transaction as the settlement journal; `relayKafkaOutbox()`
 *     publishes pending rows with exponential backoff, so downstream consumers
 *     see completed transfers even if Kafka was briefly down.
 *
 * Fail-closed: persistence happens before offset commit; a DB failure leaves the
 * offset uncommitted so the message is redelivered. Telemetry is fail-open but
 * NEVER silent — every failure is logged and counted.
 */

import { sql } from "drizzle-orm";
import type { Consumer, Kafka, KafkaMessage } from "kafkajs";
import { getDb } from "../db";
import { publishEvent, KAFKA_TOPICS } from "../middleware/kafka";
import { logger } from "./logger";

const FUND_FLOW_DLQ_GROUP = process.env.KAFKA_FUND_FLOW_DLQ_GROUP || "remitflow-fund-flow-dlq-persistence";
const EVENT_LOG_GROUP = process.env.KAFKA_EVENT_LOG_GROUP || "remitflow-event-log-persistence";

/** Max publish attempts before an outbox row is dead-lettered for manual redrive. */
const OUTBOX_MAX_ATTEMPTS = 10;
/** Base for outbox retry backoff: attempts^2 seconds. */
const OUTBOX_RETRY_BASE_MS = 5_000;

// ─── Metrics (in-memory, fail-open telemetry — never silent) ─────────────────

export const fundFlowDlqMetrics = {
  dlqPersisted: 0,
  dlqPersistErrors: 0,
  dlqReplayed: 0,
  dlqReplayErrors: 0,
  accountEventsLogged: 0,
  fundFlowEventsLogged: 0,
  eventLogErrors: 0,
  outboxPublished: 0,
  outboxPublishErrors: 0,
  outboxDeadLettered: 0,
};

export function getFundFlowDlqMetrics(): Readonly<typeof fundFlowDlqMetrics> {
  return { ...fundFlowDlqMetrics };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decodeHeaders(message: KafkaMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(message.headers ?? {})) {
    out[k] = v == null ? "" : Array.isArray(v) ? v.map((b) => b.toString()).join(",") : v.toString();
  }
  return out;
}

function parsePayload(message: KafkaMessage): unknown {
  const raw = message.value?.toString() ?? "";
  try {
    return JSON.parse(raw);
  } catch {
    return { raw }; // non-JSON payload — persist verbatim
  }
}

async function commitOffset(consumer: Consumer, topic: string, partition: number, offset: string): Promise<void> {
  await consumer.commitOffsets([{ topic, partition, offset: (Number(offset) + 1).toString() }]);
}

/** Insert a consumer-record row BEFORE the offset is committed. Fail-closed. */
async function persistEventRow(table: "fund_flow_dlq_events" | "account_events_log" | "fund_flow_events_log", topic: string, partition: number, message: KafkaMessage, error: string | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error(`[${table}] Cannot persist — database unavailable`);
  const payload = JSON.stringify(parsePayload(message));
  const headers = JSON.stringify(decodeHeaders(message));
  const key = message.key?.toString() ?? null;
  if (table === "fund_flow_dlq_events") {
    await (db as any).execute(sql`
      INSERT INTO fund_flow_dlq_events (topic, partition, kafka_offset, key, payload, headers, error, received_at)
      VALUES (${topic}, ${partition}, ${message.offset}, ${key}, ${payload}::jsonb, ${headers}::jsonb, ${error}, NOW())
      ON CONFLICT (topic, partition, kafka_offset) DO NOTHING
    `);
  } else if (table === "account_events_log") {
    await (db as any).execute(sql`
      INSERT INTO account_events_log (topic, partition, kafka_offset, key, payload, received_at)
      VALUES (${topic}, ${partition}, ${message.offset}, ${key}, ${payload}::jsonb, NOW())
      ON CONFLICT (topic, partition, kafka_offset) DO NOTHING
    `);
  } else {
    await (db as any).execute(sql`
      INSERT INTO fund_flow_events_log (topic, partition, kafka_offset, key, payload, received_at)
      VALUES (${topic}, ${partition}, ${message.offset}, ${key}, ${payload}::jsonb, NOW())
      ON CONFLICT (topic, partition, kafka_offset) DO NOTHING
    `);
  }
}

// ─── DL-07: fund-flow DLQ persistence consumer ────────────────────────────────

export async function startFundFlowDlqConsumer(kafka: Kafka): Promise<Consumer> {
  const consumer = kafka.consumer({ groupId: FUND_FLOW_DLQ_GROUP });
  await consumer.connect();
  await consumer.subscribe({ topic: KAFKA_TOPICS.FUND_FLOW_DLQ, fromBeginning: true });

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const payload = parsePayload(message) as Record<string, unknown>;
        const errText = typeof payload?.error === "string" ? payload.error : null;
        await persistEventRow("fund_flow_dlq_events", topic, partition, message, errText);
        // Persisted durably — safe to commit.
        await commitOffset(consumer, topic, partition, message.offset);
        fundFlowDlqMetrics.dlqPersisted++;
      } catch (err) {
        // Do NOT commit — redelivery retries persistence (fail closed).
        fundFlowDlqMetrics.dlqPersistErrors++;
        logger.error(
          { topic, partition, offset: message.offset, err: (err as Error).message },
          "[FundFlowDLQ] Persistence failed — offset not committed, will retry",
        );
      }
    },
  });

  logger.info(`[FundFlowDLQ] Persistence consumer started (group=${FUND_FLOW_DLQ_GROUP}, topic=${KAFKA_TOPICS.FUND_FLOW_DLQ})`);
  return consumer;
}

export interface FundFlowDlqReplayResult {
  replayed: number;
  failed: number;
}

/**
 * Admin replay: re-publish persisted fund-flow DLQ events to their origin topic
 * (`remitflow.fund-flow.events` — the fund-flow event stream the failed operation
 * belonged to) and stamp `replayed_at`. Idempotent: already-replayed rows are
 * skipped; a publish failure leaves replayed_at NULL for a later attempt.
 */
export async function replayFundFlowDlqEvents(limit = 50): Promise<FundFlowDlqReplayResult> {
  const db = await getDb();
  if (!db) throw new Error("[FundFlowDLQ] Cannot replay — database unavailable");

  const rows = (await (db as any).execute(sql`
    SELECT id, key, payload
    FROM fund_flow_dlq_events
    WHERE replayed_at IS NULL
    ORDER BY id ASC
    LIMIT ${limit}
  `)) as unknown as Array<{ id: number; key: string | null; payload: Record<string, unknown> }>;

  const result: FundFlowDlqReplayResult = { replayed: 0, failed: 0 };
  for (const row of rows) {
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    const key = row.key ?? (payload?.operationId as string | undefined) ?? `dlq-${row.id}`;
    try {
      const published = await publishEvent(KAFKA_TOPICS.FUND_FLOW_EVENTS, key, {
        ...payload,
        replayedFromDlq: true,
        dlqEventId: row.id,
        replayedAt: new Date().toISOString(),
      });
      if (!published) throw new Error("Kafka producer unavailable");
      await (db as any).execute(sql`
        UPDATE fund_flow_dlq_events SET replayed_at = NOW() WHERE id = ${row.id}
      `);
      result.replayed++;
      fundFlowDlqMetrics.dlqReplayed++;
    } catch (err) {
      result.failed++;
      fundFlowDlqMetrics.dlqReplayErrors++;
      logger.error({ id: row.id, err: (err as Error).message }, "[FundFlowDLQ] Replay publish failed — left unreplayed");
    }
  }

  // W20 DL-10: produce FUND_FLOW_RECONCILIATION — the topic was registered but
  // never produced. Emitted whenever a replay pass does work (fail-open, logged).
  if (result.replayed > 0 || result.failed > 0) {
    try {
      const published = await publishEvent(KAFKA_TOPICS.FUND_FLOW_RECONCILIATION, `replay-${Date.now()}`, {
        eventType: "fund_flow_dlq_replay",
        replayed: result.replayed,
        failed: result.failed,
        timestamp: new Date().toISOString(),
      });
      if (!published) logger.warn({ ...result }, "[FundFlowDLQ] FUND_FLOW_RECONCILIATION publish returned false (producer unavailable)");
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[FundFlowDLQ] FUND_FLOW_RECONCILIATION publish failed");
    }
  }
  return result;
}

// ─── DL-08/09: account / fund-flow event log consumers ───────────────────────

export async function startEventLogConsumers(kafka: Kafka): Promise<Consumer> {
  const consumer = kafka.consumer({ groupId: EVENT_LOG_GROUP });
  await consumer.connect();
  await consumer.subscribe({ topic: KAFKA_TOPICS.ACCOUNT_EVENTS, fromBeginning: true });
  await consumer.subscribe({ topic: KAFKA_TOPICS.FUND_FLOW_EVENTS, fromBeginning: true });

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      const table = topic === KAFKA_TOPICS.ACCOUNT_EVENTS ? "account_events_log" : "fund_flow_events_log";
      try {
        await persistEventRow(table, topic, partition, message, null);
        await commitOffset(consumer, topic, partition, message.offset);
        if (table === "account_events_log") fundFlowDlqMetrics.accountEventsLogged++;
        else fundFlowDlqMetrics.fundFlowEventsLogged++;
      } catch (err) {
        // Do NOT commit — redelivery retries persistence (fail closed).
        fundFlowDlqMetrics.eventLogErrors++;
        logger.error(
          { topic, partition, offset: message.offset, err: (err as Error).message },
          `[EventLog] ${table} persistence failed — offset not committed, will retry`,
        );
      }
    },
  });

  logger.info(`[EventLog] Consumers started (group=${EVENT_LOG_GROUP}, topics=${KAFKA_TOPICS.ACCOUNT_EVENTS},${KAFKA_TOPICS.FUND_FLOW_EVENTS})`);
  return consumer;
}

// ─── DL-19: Kafka outbox relay ────────────────────────────────────────────────

/**
 * Publish pending `kafka_outbox` rows (written transactionally by
 * transferPipeline.ts alongside the settlement journal). At-least-once:
 * a row is marked published only after publishEvent confirms; rows that
 * exhaust OUTBOX_MAX_ATTEMPTS are dead-lettered for manual redrive.
 */
export async function relayKafkaOutbox(batchSize = 50): Promise<{ published: number; failed: number }> {
  const db = await getDb();
  if (!db) {
    logger.warn("[KafkaOutbox] Relay skipped — database unavailable");
    return { published: 0, failed: 0 };
  }

  const rows = (await (db as any).execute(sql`
    SELECT id, topic, key, payload, attempts
    FROM kafka_outbox
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
    ORDER BY id ASC
    LIMIT ${batchSize}
  `)) as unknown as Array<{ id: number; topic: string; key: string | null; payload: unknown; attempts: number }>;

  let published = 0;
  let failed = 0;
  for (const row of rows) {
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    try {
      const ok = await publishEvent(row.topic, row.key ?? `outbox-${row.id}`, payload as Record<string, unknown>);
      if (!ok) throw new Error("Kafka producer unavailable");
      await (db as any).execute(sql`
        UPDATE kafka_outbox SET status = 'published', published_at = NOW() WHERE id = ${row.id}
      `);
      published++;
      fundFlowDlqMetrics.outboxPublished++;
    } catch (err) {
      failed++;
      fundFlowDlqMetrics.outboxPublishErrors++;
      const attempts = row.attempts + 1;
      const exhausted = attempts >= OUTBOX_MAX_ATTEMPTS;
      const nextRetryAt = new Date(Date.now() + OUTBOX_RETRY_BASE_MS * attempts ** 2).toISOString();
      await (db as any).execute(sql`
        UPDATE kafka_outbox
        SET attempts = ${attempts},
            status = ${exhausted ? "dead_letter" : "pending"},
            next_retry_at = ${exhausted ? null : nextRetryAt},
            last_error = ${(err as Error).message}
        WHERE id = ${row.id}
      `);
      if (exhausted) {
        fundFlowDlqMetrics.outboxDeadLettered++;
        logger.error({ id: row.id, topic: row.topic, attempts }, "[KafkaOutbox] Row dead-lettered after max attempts — MANUAL REDRIVE REQUIRED");
      } else {
        logger.warn({ id: row.id, topic: row.topic, attempts, err: (err as Error).message }, "[KafkaOutbox] Publish failed — will retry with backoff");
      }
    }
  }
  return { published, failed };
}

let outboxRelayTimer: NodeJS.Timeout | null = null;

/** Start the interval relay. Safe to call when Kafka is down — rows accumulate. */
export function startKafkaOutboxRelay(intervalMs = 2_000): void {
  if (outboxRelayTimer) return;
  outboxRelayTimer = setInterval(() => {
    relayKafkaOutbox().catch((err) =>
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "[KafkaOutbox] Relay pass failed"));
  }, intervalMs);
  outboxRelayTimer.unref?.();
  logger.info({ intervalMs }, "[KafkaOutbox] Relay started");
}

export function stopKafkaOutboxRelay(): void {
  if (outboxRelayTimer) clearInterval(outboxRelayTimer);
  outboxRelayTimer = null;
}
