-- go-fx-hedging persistence (W19): durable forward contracts + FX options.
CREATE TABLE IF NOT EXISTS fx_forward_contracts (
    id         TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT '',
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fx_options (
    id         TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT '',
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
