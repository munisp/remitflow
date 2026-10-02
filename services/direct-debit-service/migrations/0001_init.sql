-- direct-debit-service persistence (W19): durable mandates + collections.
CREATE TABLE IF NOT EXISTS dd_mandates (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL DEFAULT '',
    scheme     TEXT NOT NULL DEFAULT '',
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dd_collections (
    id         TEXT PRIMARY KEY,
    mandate_id TEXT NOT NULL DEFAULT '',
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
