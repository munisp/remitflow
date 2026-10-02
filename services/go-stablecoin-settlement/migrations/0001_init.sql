-- go-stablecoin-settlement persistence (W19): durable stores + real outbox.
-- Previously: Dapr/TigerBeetle dual-write was best-effort ("no outbox table
-- exists... failed writes are logged, not queued"). settlement_outbox now
-- durably queues every failed side-effect for replay by the relay worker.

CREATE TABLE IF NOT EXISTS settlement_records (
    operation_id TEXT PRIMARY KEY,
    status       TEXT NOT NULL DEFAULT '',
    data         JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settlement_ledger_entries (
    entry_id   TEXT PRIMARY KEY,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settlement_webhook_events (
    id         TEXT PRIMARY KEY,
    provider   TEXT NOT NULL DEFAULT '',
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 24h webhook replay-protection, cross-replica (TTL swept by relay worker).
CREATE TABLE IF NOT EXISTS settlement_webhook_dedup (
    dedup_key  TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settlement_p2p_claims (
    claim_id   TEXT PRIMARY KEY,
    status     TEXT NOT NULL DEFAULT '',
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transactional outbox: durable queue for failed Dapr/Kafka/OpenSearch writes.
CREATE TABLE IF NOT EXISTS settlement_outbox (
    id           BIGSERIAL PRIMARY KEY,
    kind         TEXT NOT NULL,        -- ledger_state | kafka | opensearch
    topic        TEXT NOT NULL DEFAULT '',
    payload      JSONB NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_settlement_outbox_pending
    ON settlement_outbox (id) WHERE delivered_at IS NULL;
