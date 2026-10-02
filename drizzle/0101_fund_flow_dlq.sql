-- W20 Lane B (DL-07/08/09/19/22): Kafka data-loss gap closures.
-- Additive only — CREATE TABLE/INDEX IF NOT EXISTS. No schema.ts changes
-- (raw SQL; Lane A owns drizzle/schema.ts).

-- ─── DL-07: fund-flow DLQ durability ─────────────────────────────────────────
-- Every message on remitflow.fund-flow.dlq is persisted BEFORE the offset is
-- committed (see server/_core/fundFlowDlqConsumer.ts). replayed_at is set when
-- an admin replay re-publishes the event to its origin topic.
CREATE TABLE IF NOT EXISTS fund_flow_dlq_events (
  id BIGSERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  partition INTEGER NOT NULL,
  kafka_offset BIGINT NOT NULL,
  key TEXT,
  payload JSONB,
  headers JSONB,
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replayed_at TIMESTAMPTZ,
  UNIQUE (topic, partition, kafka_offset)
);
CREATE INDEX IF NOT EXISTS fund_flow_dlq_events_pending_idx
  ON fund_flow_dlq_events (received_at) WHERE replayed_at IS NULL;

-- ─── DL-08: account event log (remitflow.account.events) ─────────────────────
CREATE TABLE IF NOT EXISTS account_events_log (
  id BIGSERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  partition INTEGER NOT NULL,
  kafka_offset BIGINT NOT NULL,
  key TEXT,
  payload JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (topic, partition, kafka_offset)
);

-- ─── DL-09: fund-flow event log (remitflow.fund-flow.events) ─────────────────
CREATE TABLE IF NOT EXISTS fund_flow_events_log (
  id BIGSERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  partition INTEGER NOT NULL,
  kafka_offset BIGINT NOT NULL,
  key TEXT,
  payload JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (topic, partition, kafka_offset)
);

-- ─── DL-19: Kafka transactional outbox ───────────────────────────────────────
-- Rows are written in the SAME db.transaction as the PG settlement journal so
-- downstream consumers see completed transfers even if Kafka was briefly down.
-- server/_core/fundFlowDlqConsumer.ts relayKafkaOutbox() drains pending rows.
CREATE TABLE IF NOT EXISTS kafka_outbox (
  id BIGSERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  key TEXT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | published | dead_letter
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS kafka_outbox_pending_idx
  ON kafka_outbox (created_at) WHERE status = 'pending';

-- ─── DL-22: saga registrations orphaned by orchestrator outages ───────────────
-- When the Go orchestrator is unreachable, executeAtomicFundFlow used to proceed
-- with sagaId=null, making later compensation a silent no-op. A row here lets a
-- reconciler attach compensation (saga_id) after the orchestrator recovers.
CREATE TABLE IF NOT EXISTS saga_pending_registrations (
  id BIGSERIAL PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  flow_type TEXT NOT NULL,
  user_id INTEGER,
  amount NUMERIC(20, 8),
  currency TEXT,
  transfer_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | attached | compensated
  saga_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attached_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS saga_pending_registrations_pending_idx
  ON saga_pending_registrations (created_at) WHERE status = 'pending';
