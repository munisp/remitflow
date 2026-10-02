-- rust-transaction-guard — durable receipts, double-spend, fencing, assertions (W19-D)
CREATE TABLE IF NOT EXISTS tx_guard_receipts (
    receipt_id        TEXT PRIMARY KEY,
    operation_id      TEXT NOT NULL UNIQUE,
    flow_type         TEXT NOT NULL,
    user_id           BIGINT NOT NULL,
    amount            DOUBLE PRECISION NOT NULL,
    currency          TEXT NOT NULL,
    debit_account     TEXT NOT NULL,
    credit_account    TEXT NOT NULL,
    prev_receipt_hash TEXT NOT NULL,
    receipt_hash      TEXT NOT NULL,
    timestamp_unix    BIGINT NOT NULL,
    fencing_token     BIGINT NOT NULL,
    balance_pre       DOUBLE PRECISION NOT NULL,
    balance_post      DOUBLE PRECISION NOT NULL,
    data              JSONB NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tx_guard_receipts_ts ON tx_guard_receipts(timestamp_unix);

-- operation_id -> receipt_id; the double-spend registry survives restarts
CREATE TABLE IF NOT EXISTS tx_guard_processed_ops (
    operation_id TEXT PRIMARY KEY,
    receipt_id   TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tx_guard_fencing_tokens (
    resource   TEXT PRIMARY KEY,
    token      BIGINT NOT NULL,
    owner      TEXT NOT NULL,
    issued_at  BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tx_guard_balance_assertions (
    id               BIGSERIAL PRIMARY KEY,
    account_id       TEXT NOT NULL,
    currency         TEXT NOT NULL,
    expected_balance DOUBLE PRECISION NOT NULL,
    actual_balance   DOUBLE PRECISION NOT NULL,
    operation_id     TEXT NOT NULL,
    assertion_type   TEXT NOT NULL,
    passed           BOOLEAN NOT NULL,
    timestamp_unix   BIGINT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tx_guard_assertions_account ON tx_guard_balance_assertions(account_id);
