-- go-liquidity-manager persistence (W19): durable LP positions + swap executions.
CREATE TABLE IF NOT EXISTS liquidity_positions (
    id         TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL DEFAULT 0,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only audit record of every swap execution (money path).
CREATE TABLE IF NOT EXISTS liquidity_swap_executions (
    id         TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL DEFAULT 0,
    token_in   TEXT NOT NULL DEFAULT '',
    token_out  TEXT NOT NULL DEFAULT '',
    amount_in  DOUBLE PRECISION NOT NULL DEFAULT 0,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
