-- W19-B (SPEC-wave19, lane B): MEDIUM persistence support tables.
-- Lane B may NOT touch drizzle/schema.ts (owned by W19-A); tables here are
-- created via raw SQL and typed inline at the call sites (sql`` queries).
--
-- wt_pbac_fallback_spend: durable write-through target for pbac.ts daily
-- spend fallback accounting (server/pbac.ts _writeThrough). Previously the
-- INSERT always failed silently (table did not exist; failure swallowed by
-- `.catch(() => {})`). Primary spend tracking lives in Redis
-- (`pbac:daily_spend:<userId>:<date>`, 24h TTL); this table is the degraded
-- fallback record so spend is never silently dropped.

CREATE TABLE IF NOT EXISTS wt_pbac_fallback_spend (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
