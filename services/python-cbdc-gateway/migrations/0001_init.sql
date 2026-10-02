-- W19-E: durable persistence for python-cbdc-gateway money-path state
-- (wallets / transactions / programmable_conditions were previously in-memory only).
-- Applied at boot when AUTO_MIGRATE=1 (see src/main.py:_apply_migrations).

CREATE TABLE IF NOT EXISTS cbdc_wallet_balances (
    user_id     TEXT             NOT NULL,
    cbdc_code   TEXT             NOT NULL,
    balance     DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, cbdc_code)
);

CREATE TABLE IF NOT EXISTS cbdc_transactions (
    id          TEXT        PRIMARY KEY,
    tx_type     TEXT        NOT NULL,
    user_id     BIGINT      NOT NULL,
    data        JSONB       NOT NULL DEFAULT '{}',
    status      TEXT        NOT NULL DEFAULT 'completed',
    created_at  BIGINT      NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cbdc_transactions_user
    ON cbdc_transactions (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cbdc_transactions_type
    ON cbdc_transactions (tx_type, created_at);

CREATE TABLE IF NOT EXISTS cbdc_programmable_conditions (
    id             TEXT             PRIMARY KEY,
    user_id        BIGINT           NOT NULL,
    cbdc_code      TEXT             NOT NULL,
    amount         DOUBLE PRECISION NOT NULL,
    condition_type TEXT             NOT NULL,
    unlock_at      BIGINT,
    condition_data JSONB            NOT NULL DEFAULT '{}',
    status         TEXT             NOT NULL DEFAULT 'locked',
    created_at     BIGINT           NOT NULL,
    released_at    BIGINT
);
CREATE INDEX IF NOT EXISTS idx_cbdc_programmable_conditions_user
    ON cbdc_programmable_conditions (user_id, status);
