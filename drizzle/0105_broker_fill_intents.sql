-- W21-I: durable broker fill intents (raw SQL mirror of drizzle/schema.ts
-- brokerFillIntents). Additive-only: CREATE TABLE/INDEX IF NOT EXISTS.
--
-- Every broker fill webhook rejected by investment.brokerWebhook (broker not
-- configured, or fill ingestion not yet implemented) is inserted here BEFORE
-- the endpoint throws NOT_IMPLEMENTED, so operations has a durable, queryable
-- trace of every fill the platform refused to ingest (fail-closed behavior is
-- preserved; the row replaces the old log-only structured audit event).

CREATE TABLE IF NOT EXISTS broker_fill_intents (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER,
  user_id INTEGER,
  broker_name VARCHAR(64) NOT NULL,
  symbol VARCHAR(32),
  qty NUMERIC(30, 8),
  price NUMERIC(30, 8),
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'rejected_unimplemented',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS broker_fill_intents_broker_ref_idx
  ON broker_fill_intents (broker_name, reference);
CREATE INDEX IF NOT EXISTS broker_fill_intents_created_idx
  ON broker_fill_intents (created_at);
