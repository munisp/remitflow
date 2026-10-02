-- rust-payment-retry — durable retry jobs + dead-letter queue (W19-D)
CREATE TABLE IF NOT EXISTS payment_retry_jobs (
    id               TEXT PRIMARY KEY,
    transfer_id      TEXT NOT NULL,
    user_id          BIGINT NOT NULL,
    amount_cents     BIGINT NOT NULL,
    currency         TEXT NOT NULL,
    rail             TEXT NOT NULL,
    attempt          SMALLINT NOT NULL,
    max_attempts     SMALLINT NOT NULL,
    next_retry_at    BIGINT NOT NULL,
    last_error       TEXT,
    status           TEXT NOT NULL,
    idempotency_key  TEXT NOT NULL UNIQUE,
    created_at_unix  BIGINT NOT NULL,
    updated_at_unix  BIGINT NOT NULL,
    data             JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_retry_jobs_status ON payment_retry_jobs(status);
CREATE INDEX IF NOT EXISTS idx_payment_retry_jobs_due ON payment_retry_jobs(next_retry_at) WHERE status IN ('queued','retrying');

CREATE TABLE IF NOT EXISTS payment_retry_dlq (
    id          TEXT PRIMARY KEY,
    transfer_id TEXT NOT NULL,
    rail        TEXT NOT NULL,
    final_error TEXT NOT NULL,
    attempts    SMALLINT NOT NULL,
    resolved    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at_unix BIGINT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_retry_dlq_unresolved ON payment_retry_dlq(resolved) WHERE NOT resolved;
