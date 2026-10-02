-- 0098_inmemory_persistence.sql — Wave-19 (W19-A): durable backing for the 8
-- TS CRITICAL in-memory business stores. ADDITIVE ONLY: CREATE TABLE IF NOT
-- EXISTS + CREATE INDEX IF NOT EXISTS. No drops, no alters of existing tables.
--
-- Stores replaced (audit: audit/w19-inmemory-maps.md, TS CRITICAL 1-8):
--   1. security.attacks.ts structuringMap              -> aml_structuring_counters
--   2. security.attacks.ts recentBeneficiaryAdditions  -> aml_beneficiary_additions
--   3. platformHardeningV3.ts rateLimitCounters        -> rate_limit_counters (PG fallback for Redis)
--   4. lib/webhookHmac.ts processedWebhooks            -> webhook_processed_events (24h TTL via expires_at)
--   6. routers/cryptoCustody.ts custodyIdempotencyCache-> custody_idempotency_keys
--   7. routers/developerExperience.ts webhookStore     -> developer_webhooks
--      routers/developerExperience.ts deliveryLogs     -> developer_webhook_deliveries
--   8. routers/featureFlags.ts corridorKillSwitches    -> corridor_kill_switches
-- (5. services/stablecoinAtomicity.ts idempotency+locks -> Redis via redisHardened, no table)

-- 1. AML structuring counters — 1h rolling window per user (gating transfers).
CREATE TABLE IF NOT EXISTS aml_structuring_counters (
  user_id        INTEGER PRIMARY KEY,
  total_usd      NUMERIC(18,2) NOT NULL DEFAULT 0,
  transfer_count INTEGER NOT NULL DEFAULT 0,
  window_start   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Ghost-beneficiary fraud signal — recent beneficiary additions (5-min window).
CREATE TABLE IF NOT EXISTS aml_beneficiary_additions (
  user_id        INTEGER NOT NULL,
  beneficiary_id INTEGER NOT NULL,
  added_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, beneficiary_id)
);
CREATE INDEX IF NOT EXISTS aml_beneficiary_additions_added_idx
  ON aml_beneficiary_additions (added_at);

-- 3. Rate-limit counters — PG fallback when Redis is unavailable
-- (platformHardeningV3.checkRateLimit). Keyed by "<userId>:<endpoint>".
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key        TEXT PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  reset_at   TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Webhook replay-protection dedup (24h window). Rows are ephemeral:
-- expires_at = processed_at + 24h; readers ignore expired rows and writers
-- delete them opportunistically.
CREATE TABLE IF NOT EXISTS webhook_processed_events (
  provider     VARCHAR(32) NOT NULL,
  event_id     TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (provider, event_id)
);
CREATE INDEX IF NOT EXISTS webhook_processed_events_expires_idx
  ON webhook_processed_events (expires_at);

-- 6. Custody payout idempotency. A replayed (user_id, idempotency_key) must
-- NEVER execute a second payout — the row is claimed BEFORE the payout runs
-- (status 'pending') and completed with the result afterwards.
CREATE TABLE IF NOT EXISTS custody_idempotency_keys (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'pending', -- 'pending'|'completed'|'failed'
  result          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS custody_idempotency_keys_expires_idx
  ON custody_idempotency_keys (expires_at);

-- 7. Developer webhook registrations. secret_enc is AES-256-GCM encrypted at
-- rest (server/_core/secretBox.ts, "v1:<iv>:<tag>:<ct>" format).
CREATE TABLE IF NOT EXISTS developer_webhooks (
  id           UUID PRIMARY KEY,
  user_id      INTEGER NOT NULL,
  url          TEXT NOT NULL,
  events       JSONB NOT NULL DEFAULT '[]'::jsonb,
  secret_enc   TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  description  TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS developer_webhooks_user_idx
  ON developer_webhooks (user_id);

CREATE TABLE IF NOT EXISTS developer_webhook_deliveries (
  id           UUID PRIMARY KEY,
  webhook_id   UUID NOT NULL REFERENCES developer_webhooks(id) ON DELETE CASCADE,
  event        TEXT NOT NULL,
  payload      JSONB,
  status_code  INTEGER,
  latency_ms   INTEGER,
  success      BOOLEAN NOT NULL DEFAULT FALSE,
  attempt      INTEGER NOT NULL DEFAULT 1,
  error        TEXT,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS developer_webhook_deliveries_hook_idx
  ON developer_webhook_deliveries (webhook_id, delivered_at DESC);

-- 8. Corridor kill switches — persisted so a kill survives restarts and is
-- consistent across replicas. Readers fail closed (unknown state => disabled).
CREATE TABLE IF NOT EXISTS corridor_kill_switches (
  corridor    VARCHAR(8) PRIMARY KEY, -- "<FROM>-<TO>", e.g. "USD-NGN"
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  disabled_at TIMESTAMPTZ,
  disabled_by VARCHAR(64),
  reason      TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
