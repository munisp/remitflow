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

-- ─── Fluvio Consumer Offsets ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fluvio_offsets (
  id              BIGSERIAL PRIMARY KEY,
  topic           VARCHAR(255)  NOT NULL,
  partition       INTEGER       NOT NULL DEFAULT 0,
  consumer_group  VARCHAR(255)  NOT NULL,
  "offset"       BIGINT        NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (topic, partition, consumer_group)
);

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

-- ─── APISIX Route Audit Log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apisix_route_audit (
  id              BIGSERIAL PRIMARY KEY,
  route_id        VARCHAR(255)  NOT NULL,
  operation       VARCHAR(20)   NOT NULL CHECK (operation IN ('create','update','delete')),
  route_config    JSONB         NOT NULL DEFAULT '{}',
  performed_by    BIGINT        REFERENCES users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

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

-- ─── Performance: Missing FK Indexes ─────────────────────────────────────────
-- Add indexes on commonly queried FK columns that were missing

-- Index compatibility layer for the retained mixed snake_case/camelCase legacy schema.
-- Required columns and predicate identifiers are resolved from information_schema before each index is created.
DO $$
DECLARE
  target record;
  source_spec text;
  source_column text;
  direction text;
  resolved_column text;
  mapped_specs text[];
  rendered_columns text;
  rendered_predicate text;
  token text;
  can_create boolean;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
    ('idx_outbox_events_status_created', 'outbox_events', ARRAY['status', 'created_at'], 'status = ''pending'''),
    ('idx_outbox_events_aggregate', 'outbox_events', ARRAY['aggregate_type', 'aggregate_id'], NULL),
    ('idx_fluvio_offsets_topic', 'fluvio_offsets', ARRAY['topic', 'consumer_group'], NULL),
    ('idx_tb_accounts_user_id', 'tigerbeetle_accounts', ARRAY['user_id'], NULL),
    ('idx_tb_accounts_ledger', 'tigerbeetle_accounts', ARRAY['ledger', 'status'], NULL),
    ('idx_tb_transfers_debit', 'tigerbeetle_transfers', ARRAY['debit_account_id'], NULL),
    ('idx_tb_transfers_credit', 'tigerbeetle_transfers', ARRAY['credit_account_id'], NULL),
    ('idx_tb_transfers_transaction', 'tigerbeetle_transfers', ARRAY['transaction_id'], NULL),
    ('idx_fraud_alerts_user_id', 'fraud_alerts', ARRAY['user_id', 'created_at DESC'], NULL),
    ('idx_fraud_alerts_risk_tier', 'fraud_alerts', ARRAY['risk_tier', 'created_at DESC'], 'risk_tier IN (''HIGH'',''CRITICAL'')'),
    ('idx_fraud_alerts_transaction', 'fraud_alerts', ARRAY['transaction_id'], NULL),
    ('idx_kc_sessions_user_id', 'keycloak_sessions', ARRAY['user_id'], NULL),
    ('idx_kc_sessions_expires', 'keycloak_sessions', ARRAY['expires_at'], 'expires_at IS NOT NULL'),
    ('idx_permify_audit_user', 'permify_audit_log', ARRAY['user_id', 'created_at DESC'], NULL),
    ('idx_permify_audit_entity', 'permify_audit_log', ARRAY['entity_type', 'entity_id'], NULL),
    ('idx_permify_audit_denied', 'permify_audit_log', ARRAY['decision', 'created_at DESC'], 'decision = ''DENY'''),
    ('idx_apisix_route_audit_route', 'apisix_route_audit', ARRAY['route_id', 'created_at DESC'], NULL),
    ('idx_waf_events_severity', 'waf_events', ARRAY['severity', 'created_at DESC'], 'severity IN (''high'',''critical'')'),
    ('idx_waf_events_source_ip', 'waf_events', ARRAY['source_ip', 'created_at DESC'], NULL),
    ('idx_waf_events_user', 'waf_events', ARRAY['user_id', 'created_at DESC'], 'user_id IS NOT NULL'),
    ('idx_dapr_events_topic', 'dapr_events', ARRAY['topic', 'created_at DESC'], NULL),
    ('idx_dapr_events_status', 'dapr_events', ARRAY['status', 'created_at DESC'], 'status IN (''failed'',''retrying'')'),
    ('idx_compliance_cases_user', 'compliance_cases', ARRAY['user_id', 'created_at DESC'], NULL),
    ('idx_compliance_cases_status', 'compliance_cases', ARRAY['status', 'priority'], 'status IN (''open'',''under_review'',''escalated'')'),
    ('idx_notifications_user_unread', 'notifications', ARRAY['user_id', 'created_at DESC'], 'read_at IS NULL'),
    ('idx_settlement_batches_status', 'settlement_batches', ARRAY['status', 'created_at DESC'], NULL),
    ('idx_transactions_user_id', 'transactions', ARRAY['user_id', 'created_at DESC'], NULL),
    ('idx_transactions_status', 'transactions', ARRAY['status', 'created_at DESC'], NULL),
    ('idx_wallets_user_id', 'wallets', ARRAY['user_id'], NULL),
    ('idx_kyc_documents_user_id', 'kyc_documents', ARRAY['user_id', 'created_at DESC'], NULL),
    ('idx_audit_logs_user_id', 'audit_logs', ARRAY['user_id', 'created_at DESC'], 'user_id IS NOT NULL'),
    ('idx_audit_logs_action', 'audit_logs', ARRAY['action', 'created_at DESC'], NULL)
    ) AS requested(index_name, table_name, column_specs, predicate)
  LOOP
    mapped_specs := ARRAY[]::text[];
    can_create := true;

    FOREACH source_spec IN ARRAY target.column_specs LOOP
      source_column := regexp_replace(source_spec, '\s+(ASC|DESC)$', '', 'i');
      direction := CASE WHEN source_spec ~* '\s+DESC$' THEN ' DESC' WHEN source_spec ~* '\s+ASC$' THEN ' ASC' ELSE '' END;
      SELECT columns.column_name
        INTO resolved_column
        FROM information_schema.columns AS columns
       WHERE columns.table_schema = 'public'
         AND columns.table_name = target.table_name
         AND (
           columns.column_name = source_column
           OR lower(replace(columns.column_name, '_', '')) = lower(replace(source_column, '_', ''))
         )
       ORDER BY CASE WHEN columns.column_name = source_column THEN 0 ELSE 1 END
       LIMIT 1;
      IF resolved_column IS NULL THEN
        can_create := false;
        EXIT;
      END IF;
      mapped_specs := array_append(mapped_specs, quote_ident(resolved_column) || direction);
    END LOOP;

    rendered_predicate := target.predicate;
    IF can_create AND rendered_predicate IS NOT NULL THEN
      FOR token IN
        SELECT DISTINCT (match)[1]
          FROM regexp_matches(
            regexp_replace(rendered_predicate, '''[^'']*''', '', 'g'),
            '\m([A-Za-z_][A-Za-z0-9_]*)\M',
            'g'
          ) AS match
         WHERE lower((match)[1]) NOT IN ('and', 'or', 'is', 'not', 'null', 'in', 'true', 'false')
      LOOP
        SELECT columns.column_name
          INTO resolved_column
          FROM information_schema.columns AS columns
         WHERE columns.table_schema = 'public'
           AND columns.table_name = target.table_name
           AND (
             columns.column_name = token
             OR lower(replace(columns.column_name, '_', '')) = lower(replace(token, '_', ''))
           )
         ORDER BY CASE WHEN columns.column_name = token THEN 0 ELSE 1 END
         LIMIT 1;
        IF resolved_column IS NULL THEN
          can_create := false;
          EXIT;
        END IF;
        rendered_predicate := replace(rendered_predicate, token, quote_ident(resolved_column));
      END LOOP;
    END IF;

    IF can_create THEN
      SELECT string_agg(specification, ', ')
        INTO rendered_columns
        FROM unnest(mapped_specs) AS specification;
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)%s',
        target.index_name,
        'public',
        target.table_name,
        rendered_columns,
        CASE WHEN rendered_predicate IS NULL THEN '' ELSE ' WHERE ' || rendered_predicate END
      );
    END IF;
  END LOOP;
END $$;
