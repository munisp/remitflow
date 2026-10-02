-- go-odl-orchestrator persistence (W19): durable ODL settlements, quotes, routes.
CREATE TABLE IF NOT EXISTS odl_settlements (
    id         TEXT PRIMARY KEY,
    status     TEXT NOT NULL DEFAULT '',
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS odl_quotes (
    id         TEXT PRIMARY KEY,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS odl_routes (
    id         TEXT PRIMARY KEY, -- "FROM_TO" corridor key
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
