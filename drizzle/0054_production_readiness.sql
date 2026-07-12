-- RemitFlow — Production Readiness Migration
-- ═══════════════════════════════════════════
-- Adds missing tables for polyglot service integration,
-- outbox worker support, lakehouse sync state, and AML scoring.
-- Generated: 2025-07-12

-- ─── Outbox Events (Transactional Outbox Pattern) ────────────────────────────
CREATE TABLE IF NOT EXISTS outbox_events (
  id              BIGSERIAL PRIMARY KEY,
  event_type      VARCHAR(100)  NOT NULL,
  aggregate_type  VARCHAR(100)  NOT NULL,
  aggregate_id    VARCHAR(255)  NOT NULL,
  payload         JSONB         NOT NULL DEFAULT '{}',
  status          VARCHAR(20)   NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','delivered','dead_letter')),
  retry_count     INTEGER       NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_retry_at   TIMESTAMPTZ,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outbox_events_status_created
  ON outbox_events (status, created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_outbox_events_aggregate
  ON outbox_events (aggregate_type, aggregate_id);

-- ─── Fluvio Consumer Offsets ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fluvio_offsets (
  id              BIGSERIAL PRIMARY KEY,
  topic           VARCHAR(255)  NOT NULL,
  partition       INTEGER       NOT NULL DEFAULT 0,
  consumer_group  VARCHAR(255)  NOT NULL,
  offset          BIGINT        NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (topic, partition, consumer_group)
);
CREATE INDEX IF NOT EXISTS idx_fluvio_offsets_topic
  ON fluvio_offsets (topic, consumer_group);

-- ─── TigerBeetle Account Mappings ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tigerbeetle_accounts (
  id              BIGSERIAL PRIMARY KEY,
  tb_account_id   VARCHAR(255)  NOT NULL UNIQUE,
  user_id         BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ledger          INTEGER       NOT NULL,  -- currency code
  code            SMALLINT      NOT NULL,  -- account type
  status          VARCHAR(20)   NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','frozen','closed')),
  debits_posted   BIGINT        NOT NULL DEFAULT 0,
  credits_posted  BIGINT        NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tb_accounts_user_id
  ON tigerbeetle_accounts (user_id);
CREATE INDEX IF NOT EXISTS idx_tb_accounts_ledger
  ON tigerbeetle_accounts (ledger, status);

-- ─── TigerBeetle Transfer Records ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tigerbeetle_transfers (
  id              BIGSERIAL PRIMARY KEY,
  tb_transfer_id  VARCHAR(255)  NOT NULL UNIQUE,
  debit_account_id  VARCHAR(255) NOT NULL,
  credit_account_id VARCHAR(255) NOT NULL,
  amount          BIGINT        NOT NULL,
  ledger          INTEGER       NOT NULL,
  code            SMALLINT      NOT NULL,
  status          VARCHAR(20)   NOT NULL DEFAULT 'posted'
                    CHECK (status IN ('posted','voided','pending')),
  transaction_id  BIGINT        REFERENCES transactions(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tb_transfers_debit
  ON tigerbeetle_transfers (debit_account_id);
CREATE INDEX IF NOT EXISTS idx_tb_transfers_credit
  ON tigerbeetle_transfers (credit_account_id);
CREATE INDEX IF NOT EXISTS idx_tb_transfers_transaction
  ON tigerbeetle_transfers (transaction_id);

-- ─── Lakehouse Sync State ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lakehouse_sync_state (
  id              BIGSERIAL PRIMARY KEY,
  table_name      VARCHAR(255)  NOT NULL UNIQUE,
  last_synced_at  TIMESTAMPTZ,
  rows_synced     BIGINT        NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Fraud Alerts (AML Scorer output) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fraud_alerts (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT        NOT NULL REFERENCES users(id),
  transaction_id  BIGINT        REFERENCES transactions(id),
  risk_score      INTEGER       NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  risk_tier       VARCHAR(20)   NOT NULL CHECK (risk_tier IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  reasons         JSONB         NOT NULL DEFAULT '[]',
  action          VARCHAR(20)   NOT NULL CHECK (action IN ('approve','monitor','review','block')),
  model_version   VARCHAR(50)   NOT NULL DEFAULT '1.0.0',
  reviewed_by     BIGINT        REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  review_notes    TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_user_id
  ON fraud_alerts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_risk_tier
  ON fraud_alerts (risk_tier, created_at DESC)
  WHERE risk_tier IN ('HIGH','CRITICAL');
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_transaction
  ON fraud_alerts (transaction_id);

-- ─── Keycloak Session Sync ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS keycloak_sessions (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keycloak_session_id VARCHAR(255) NOT NULL UNIQUE,
  keycloak_user_id    VARCHAR(255) NOT NULL,
  realm           VARCHAR(100)  NOT NULL,
  access_token_hash VARCHAR(64),
  refresh_token_hash VARCHAR(64),
  expires_at      TIMESTAMPTZ   NOT NULL,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kc_sessions_user_id
  ON keycloak_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_kc_sessions_expires
  ON keycloak_sessions (expires_at)
  WHERE expires_at > NOW();

-- ─── Permify Policy Audit Log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS permify_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT        REFERENCES users(id),
  entity_type     VARCHAR(100)  NOT NULL,
  entity_id       VARCHAR(255)  NOT NULL,
  permission      VARCHAR(100)  NOT NULL,
  subject_type    VARCHAR(100)  NOT NULL,
  subject_id      VARCHAR(255)  NOT NULL,
  decision        VARCHAR(10)   NOT NULL CHECK (decision IN ('ALLOW','DENY','UNKNOWN')),
  snap_token      VARCHAR(255),
  latency_ms      INTEGER,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_permify_audit_user
  ON permify_audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_permify_audit_entity
  ON permify_audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_permify_audit_denied
  ON permify_audit_log (decision, created_at DESC)
  WHERE decision = 'DENY';

-- ─── APISIX Route Audit Log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apisix_route_audit (
  id              BIGSERIAL PRIMARY KEY,
  route_id        VARCHAR(255)  NOT NULL,
  operation       VARCHAR(20)   NOT NULL CHECK (operation IN ('create','update','delete')),
  route_config    JSONB         NOT NULL DEFAULT '{}',
  performed_by    BIGINT        REFERENCES users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_apisix_route_audit_route
  ON apisix_route_audit (route_id, created_at DESC);

-- ─── OpenAppSec WAF Events ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waf_events (
  id              BIGSERIAL PRIMARY KEY,
  event_type      VARCHAR(50)   NOT NULL,
  severity        VARCHAR(20)   NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  source_ip       INET,
  user_id         BIGINT        REFERENCES users(id),
  request_uri     TEXT,
  attack_type     VARCHAR(100),
  payload_snippet TEXT,
  action_taken    VARCHAR(20)   NOT NULL CHECK (action_taken IN ('block','detect','bypass')),
  rule_id         VARCHAR(100),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_waf_events_severity
  ON waf_events (severity, created_at DESC)
  WHERE severity IN ('high','critical');
CREATE INDEX IF NOT EXISTS idx_waf_events_source_ip
  ON waf_events (source_ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_waf_events_user
  ON waf_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- ─── Dapr State/PubSub Audit ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dapr_events (
  id              BIGSERIAL PRIMARY KEY,
  event_type      VARCHAR(100)  NOT NULL,
  pubsub_name     VARCHAR(100)  NOT NULL,
  topic           VARCHAR(255)  NOT NULL,
  data            JSONB         NOT NULL DEFAULT '{}',
  status          VARCHAR(20)   NOT NULL DEFAULT 'published'
                    CHECK (status IN ('published','failed','retrying')),
  error_message   TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dapr_events_topic
  ON dapr_events (topic, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dapr_events_status
  ON dapr_events (status, created_at DESC)
  WHERE status IN ('failed','retrying');

-- ─── Compliance Cases ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_cases (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT        NOT NULL REFERENCES users(id),
  case_type       VARCHAR(50)   NOT NULL CHECK (case_type IN ('fraud_alert','aml_flag','kyc_failure','sar_filed','ctr_filed','sanctions_hit')),
  status          VARCHAR(20)   NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','under_review','escalated','closed','false_positive')),
  priority        VARCHAR(10)   NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low','medium','high','critical')),
  notes           TEXT,
  assigned_to     BIGINT        REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_compliance_cases_user
  ON compliance_cases (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_cases_status
  ON compliance_cases (status, priority)
  WHERE status IN ('open','under_review','escalated');

-- ─── Notifications ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            VARCHAR(100)  NOT NULL,
  title           VARCHAR(255)  NOT NULL,
  body            TEXT          NOT NULL,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- ─── Settlement Batches ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settlement_batches (
  id              BIGSERIAL PRIMARY KEY,
  batch_reference VARCHAR(255)  NOT NULL UNIQUE,
  currency        VARCHAR(10)   NOT NULL,
  total_amount    NUMERIC(20,8) NOT NULL,
  transaction_count INTEGER     NOT NULL DEFAULT 0,
  status          VARCHAR(20)   NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','settled','failed','cancelled')),
  rail            VARCHAR(50)   NOT NULL,
  settled_at      TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_settlement_batches_status
  ON settlement_batches (status, created_at DESC);

-- ─── Performance: Missing FK Indexes ─────────────────────────────────────────
-- Add indexes on commonly queried FK columns that were missing
CREATE INDEX IF NOT EXISTS idx_transactions_user_id
  ON transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_status
  ON transactions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_user_id
  ON wallets (user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_user_id
  ON kyc_documents (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id
  ON audit_logs (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs (action, created_at DESC);
