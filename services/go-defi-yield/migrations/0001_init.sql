-- go-defi-yield persistence (W19): durable DeFi positions (money path).
CREATE TABLE IF NOT EXISTS defi_yield_positions (
    id         TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT '',
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
