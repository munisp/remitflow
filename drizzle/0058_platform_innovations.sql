-- RemitFlow Migration 0058: Platform Innovation Tables
-- Covers: webhooks, SLO tracking, cost attribution, chaos experiments,
--         FX hedging positions, compliance scores, developer API keys, GDPR erasure

-- ── Enums ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE webhook_status     AS ENUM ('active', 'inactive', 'suspended');
  CREATE TYPE slo_status         AS ENUM ('healthy', 'at_risk', 'breached');
  CREATE TYPE chaos_type         AS ENUM ('latency', 'error', 'network_partition', 'resource_exhaustion', 'service_kill');
  CREATE TYPE chaos_status       AS ENUM ('pending', 'running', 'complete', 'aborted');
  CREATE TYPE risk_band          AS ENUM ('low', 'medium', 'high', 'critical');
  CREATE TYPE compliance_action  AS ENUM ('allow', 'review', 'block');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Webhook endpoints ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          INTEGER NOT NULL,
  tenant_id        TEXT,
  url              TEXT NOT NULL,
  events           TEXT[] NOT NULL,
  secret           TEXT NOT NULL,
  status           webhook_status NOT NULL DEFAULT 'active',
  description      TEXT,
  failure_count    INTEGER NOT NULL DEFAULT 0,
  last_delivered_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_user_idx   ON webhook_endpoints(user_id);
CREATE INDEX IF NOT EXISTS webhook_endpoints_tenant_idx ON webhook_endpoints(tenant_id);

-- ── Webhook delivery logs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id   UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event        TEXT NOT NULL,
  payload      JSONB,
  status_code  INTEGER,
  latency_ms   INTEGER,
  success      BOOLEAN NOT NULL DEFAULT FALSE,
  attempt      INTEGER NOT NULL DEFAULT 1,
  error        TEXT,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS webhook_delivery_logs_webhook_idx ON webhook_delivery_logs(webhook_id);
CREATE INDEX IF NOT EXISTS webhook_delivery_logs_event_idx   ON webhook_delivery_logs(event);
CREATE INDEX IF NOT EXISTS webhook_delivery_logs_success_idx ON webhook_delivery_logs(success);

-- ── SLO events ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slo_events (
  id         BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  slo_name   TEXT NOT NULL,
  service    TEXT NOT NULL,
  success    BOOLEAN NOT NULL,
  latency_ms NUMERIC(10,2),
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS slo_events_slo_name_idx ON slo_events(slo_name);
CREATE INDEX IF NOT EXISTS slo_events_service_idx  ON slo_events(service);
CREATE INDEX IF NOT EXISTS slo_events_created_idx  ON slo_events(created_at DESC);

-- ── SLO reports ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slo_reports (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slo_name                TEXT NOT NULL,
  service                 TEXT NOT NULL,
  target_pct              NUMERIC(6,3) NOT NULL,
  compliance_pct          NUMERIC(6,3) NOT NULL,
  error_budget_used_pct   NUMERIC(6,3) NOT NULL,
  error_budget_remain_pct NUMERIC(6,3) NOT NULL,
  burn_rate_1h            NUMERIC(8,2),
  burn_rate_24h           NUMERIC(8,2),
  status                  slo_status NOT NULL,
  report_date             TIMESTAMPTZ NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS slo_reports_slo_date_idx ON slo_reports(slo_name, report_date DESC);

-- ── Cost attribution ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cost_attribution_entries (
  id         BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  tenant_id  TEXT NOT NULL,
  rail       TEXT NOT NULL,
  service    TEXT NOT NULL,
  cost_usd   NUMERIC(12,6) NOT NULL,
  count      INTEGER NOT NULL DEFAULT 1,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cost_attribution_tenant_idx  ON cost_attribution_entries(tenant_id);
CREATE INDEX IF NOT EXISTS cost_attribution_rail_idx    ON cost_attribution_entries(rail);
CREATE INDEX IF NOT EXISTS cost_attribution_service_idx ON cost_attribution_entries(service);
CREATE INDEX IF NOT EXISTS cost_attribution_date_idx    ON cost_attribution_entries(created_at DESC);

-- ── Chaos experiments ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chaos_experiments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  type            chaos_type NOT NULL,
  target_service  TEXT NOT NULL,
  config          JSONB NOT NULL,
  blast_radius    JSONB,
  status          chaos_status NOT NULL DEFAULT 'pending',
  injected_count  BIGINT NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_by      INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chaos_experiments_status_idx  ON chaos_experiments(status);
CREATE INDEX IF NOT EXISTS chaos_experiments_service_idx ON chaos_experiments(target_service);

-- ── FX hedging positions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fx_hedging_positions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT,
  currency_pair       TEXT NOT NULL,
  hedge_type          TEXT NOT NULL,
  notional_amount     NUMERIC(20,8) NOT NULL,
  strike_rate         NUMERIC(20,8) NOT NULL,
  spot_rate_at_entry  NUMERIC(20,8) NOT NULL,
  current_spot_rate   NUMERIC(20,8),
  unrealized_pnl      NUMERIC(20,8),
  premium_paid        NUMERIC(20,8),
  expires_at          TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL DEFAULT 'open',
  closed_at           TIMESTAMPTZ,
  realized_pnl        NUMERIC(20,8),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fx_hedging_positions_tenant_idx ON fx_hedging_positions(tenant_id);
CREATE INDEX IF NOT EXISTS fx_hedging_positions_pair_idx   ON fx_hedging_positions(currency_pair);
CREATE INDEX IF NOT EXISTS fx_hedging_positions_status_idx ON fx_hedging_positions(status);
CREATE INDEX IF NOT EXISTS fx_hedging_positions_expiry_idx ON fx_hedging_positions(expires_at);

-- ── Compliance transaction scores ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_transaction_scores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id TEXT NOT NULL,
  user_id        INTEGER NOT NULL,
  risk_score     INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  risk_band      risk_band NOT NULL,
  action         compliance_action NOT NULL,
  reasons        TEXT[],
  sanctions_hit  BOOLEAN NOT NULL DEFAULT FALSE,
  pep_hit        BOOLEAN NOT NULL DEFAULT FALSE,
  metadata       JSONB,
  scored_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS compliance_scores_tx_idx     ON compliance_transaction_scores(transaction_id);
CREATE INDEX IF NOT EXISTS compliance_scores_user_idx   ON compliance_transaction_scores(user_id);
CREATE INDEX IF NOT EXISTS compliance_scores_band_idx   ON compliance_transaction_scores(risk_band);
CREATE INDEX IF NOT EXISTS compliance_scores_action_idx ON compliance_transaction_scores(action);

-- ── Developer API keys ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS developer_api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     INTEGER NOT NULL,
  tenant_id   TEXT,
  key_hash    TEXT NOT NULL,
  key_prefix  TEXT NOT NULL,
  name        TEXT NOT NULL,
  scopes      TEXT[],
  environment TEXT NOT NULL DEFAULT 'production',
  last_used_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS developer_api_keys_hash_idx   ON developer_api_keys(key_hash);
CREATE INDEX        IF NOT EXISTS developer_api_keys_user_idx   ON developer_api_keys(user_id);
CREATE INDEX        IF NOT EXISTS developer_api_keys_prefix_idx ON developer_api_keys(key_prefix);

-- ── GDPR erasure requests ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gdpr_erasure_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      INTEGER NOT NULL,
  requester_id TEXT NOT NULL,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'initiated',
  steps        JSONB,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gdpr_erasure_requests_user_idx   ON gdpr_erasure_requests(user_id);
CREATE INDEX IF NOT EXISTS gdpr_erasure_requests_status_idx ON gdpr_erasure_requests(status);
