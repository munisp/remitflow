-- cbdc-service persistence (W19): durable CBDC wallets + transfers.
CREATE TABLE IF NOT EXISTS cbdc_wallets (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL DEFAULT '',
    currency   TEXT NOT NULL DEFAULT '',
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cbdc_transfers (
    id         TEXT PRIMARY KEY,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
