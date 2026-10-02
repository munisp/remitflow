-- rust-transaction-processor — durable transaction + idempotency store (W19-D)
CREATE TABLE IF NOT EXISTS tx_processor_transactions (
    id               TEXT PRIMARY KEY,
    idempotency_key  TEXT NOT NULL UNIQUE,
    user_id          TEXT NOT NULL,
    from_account_id  TEXT NOT NULL,
    to_account_id    TEXT NOT NULL,
    amount           DOUBLE PRECISION NOT NULL,
    fee              DOUBLE PRECISION NOT NULL,
    net_amount       DOUBLE PRECISION NOT NULL,
    currency         TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    status           TEXT NOT NULL,
    data             JSONB NOT NULL DEFAULT '{}',
    created_at_unix  BIGINT NOT NULL,
    updated_at_unix  BIGINT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tx_processor_user ON tx_processor_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_processor_status ON tx_processor_transactions(status);
