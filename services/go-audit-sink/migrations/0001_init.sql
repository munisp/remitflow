-- go-audit-sink persistence (W19): append-only hash-chained audit log.
-- chain_position is the hash-chain ordering; entries are never updated or
-- deleted (WORM semantics enforced by the service — no UPDATE/DELETE paths).
CREATE TABLE IF NOT EXISTS audit_sink_events (
    chain_position BIGINT PRIMARY KEY,
    id             TEXT NOT NULL,
    event_type     TEXT NOT NULL DEFAULT '',
    actor_id       INTEGER NOT NULL DEFAULT 0,
    prev_hash      TEXT NOT NULL DEFAULT '',
    entry_hash     TEXT NOT NULL DEFAULT '',
    data           JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_sink_events_type ON audit_sink_events (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_sink_events_actor ON audit_sink_events (actor_id);
