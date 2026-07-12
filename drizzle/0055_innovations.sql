-- ═══════════════════════════════════════════════════════════════════════════
-- RemitFlow — Migration 0055: Innovation Layer
-- Adds tables for: Event Sourcing, CQRS Read Models, Saga Orchestration,
-- Circuit Breakers, DLQ, WAF Events, Compliance Cases, Settlement Batches,
-- Rate Limit Violations, Secret Rotation, Integration Health Log
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Event Store (Rust event-store service) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS event_store (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id      VARCHAR(512) NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id   VARCHAR(255) NOT NULL,
    event_type     VARCHAR(100) NOT NULL,
    event_version  BIGINT NOT NULL,
    payload        JSONB NOT NULL DEFAULT '{}',
    metadata       JSONB NOT NULL DEFAULT '{}',
    checksum       VARCHAR(64) NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (stream_id, event_version)
);
CREATE INDEX IF NOT EXISTS idx_event_store_stream ON event_store (stream_id, event_version);
CREATE INDEX IF NOT EXISTS idx_event_store_type   ON event_store (aggregate_type, created_at);
CREATE INDEX IF NOT EXISTS idx_event_store_agg    ON event_store (aggregate_id, aggregate_type);

-- ─── Aggregate Snapshots ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aggregate_snapshots (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id        VARCHAR(512) NOT NULL,
    aggregate_type   VARCHAR(100) NOT NULL,
    aggregate_id     VARCHAR(255) NOT NULL,
    snapshot_version BIGINT NOT NULL,
    state            JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_snapshots_stream ON aggregate_snapshots (stream_id, snapshot_version DESC);

-- ─── Projection Dispatch Queue ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projection_dispatch_queue (
    stream_id      VARCHAR(512) PRIMARY KEY,
    aggregate_type VARCHAR(100) NOT NULL,
    from_version   BIGINT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Projection Checkpoints ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projection_checkpoints (
    projection_name        VARCHAR(100) PRIMARY KEY,
    aggregate_type         VARCHAR(100) NOT NULL,
    last_processed_version BIGINT NOT NULL DEFAULT 0,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Saga Instances (Go saga orchestrator) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS saga_instances (
    id             VARCHAR(36) PRIMARY KEY,
    saga_type      VARCHAR(100) NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'pending',
    steps          JSONB NOT NULL DEFAULT '[]',
    input          JSONB NOT NULL DEFAULT '{}',
    correlation_id VARCHAR(36) NOT NULL,
    user_id        VARCHAR(255),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at   TIMESTAMPTZ,
    failed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_saga_status ON saga_instances (status, created_at);
CREATE INDEX IF NOT EXISTS idx_saga_type   ON saga_instances (saga_type, status);
CREATE INDEX IF NOT EXISTS idx_saga_user   ON saga_instances (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_saga_corr   ON saga_instances (correlation_id);

-- ─── CQRS Read Models ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rm_user_dashboard (
    user_id              BIGINT PRIMARY KEY,
    display_name         VARCHAR(255),
    kyc_tier             INTEGER NOT NULL DEFAULT 0,
    total_sent_usd       NUMERIC(20,2) NOT NULL DEFAULT 0,
    total_received_usd   NUMERIC(20,2) NOT NULL DEFAULT 0,
    transaction_count    INTEGER NOT NULL DEFAULT 0,
    active_wallets       INTEGER NOT NULL DEFAULT 0,
    last_transaction_at  TIMESTAMPTZ,
    risk_score           NUMERIC(5,4) NOT NULL DEFAULT 0,
    aml_flags            INTEGER NOT NULL DEFAULT 0,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rm_transaction_ledger (
    id               BIGSERIAL PRIMARY KEY,
    transaction_id   BIGINT NOT NULL UNIQUE,
    user_id          BIGINT NOT NULL,
    type             VARCHAR(50) NOT NULL,
    status           VARCHAR(20) NOT NULL,
    from_amount      NUMERIC(20,8) NOT NULL,
    from_currency    VARCHAR(10) NOT NULL,
    to_amount        NUMERIC(20,8),
    to_currency      VARCHAR(10),
    recipient_name   VARCHAR(255),
    corridor         VARCHAR(20),
    fx_rate          NUMERIC(20,8),
    fees_usd         NUMERIC(10,4),
    rail_used        VARCHAR(50),
    is_cross_border  BOOLEAN NOT NULL DEFAULT FALSE,
    risk_score       NUMERIC(5,4),
    created_at       TIMESTAMPTZ NOT NULL,
    settled_at       TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rm_tx_ledger_user     ON rm_transaction_ledger (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rm_tx_ledger_status   ON rm_transaction_ledger (status, created_at);
CREATE INDEX IF NOT EXISTS idx_rm_tx_ledger_corridor ON rm_transaction_ledger (corridor, created_at);

CREATE TABLE IF NOT EXISTS rm_wallet_balance (
    wallet_id          BIGINT PRIMARY KEY,
    user_id            BIGINT NOT NULL,
    currency           VARCHAR(10) NOT NULL,
    available_balance  NUMERIC(20,8) NOT NULL DEFAULT 0,
    pending_balance    NUMERIC(20,8) NOT NULL DEFAULT 0,
    reserved_balance   NUMERIC(20,8) NOT NULL DEFAULT 0,
    tb_account_id      VARCHAR(64),
    last_event_version BIGINT NOT NULL DEFAULT 0,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rm_wallet_user ON rm_wallet_balance (user_id, currency);

CREATE TABLE IF NOT EXISTS rm_compliance_summary (
    user_id           BIGINT PRIMARY KEY,
    kyc_status        VARCHAR(20) NOT NULL DEFAULT 'pending',
    kyc_tier          INTEGER NOT NULL DEFAULT 0,
    aml_risk_score    NUMERIC(5,4) NOT NULL DEFAULT 0,
    sanctions_match   BOOLEAN NOT NULL DEFAULT FALSE,
    pep_match         BOOLEAN NOT NULL DEFAULT FALSE,
    open_case_count   INTEGER NOT NULL DEFAULT 0,
    last_sar_filed_at TIMESTAMPTZ,
    velocity_breaches INTEGER NOT NULL DEFAULT 0,
    total_flagged_30d INTEGER NOT NULL DEFAULT 0,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rm_corridor_analytics (
    id                   BIGSERIAL PRIMARY KEY,
    corridor             VARCHAR(20) NOT NULL UNIQUE,
    transaction_count_24h INTEGER NOT NULL DEFAULT 0,
    transaction_count_7d  INTEGER NOT NULL DEFAULT 0,
    volume_usd_24h       NUMERIC(20,2) NOT NULL DEFAULT 0,
    volume_usd_7d        NUMERIC(20,2) NOT NULL DEFAULT 0,
    avg_fx_rate          NUMERIC(20,8),
    avg_fee_usd          NUMERIC(10,4),
    success_rate         NUMERIC(5,4) NOT NULL DEFAULT 1,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Circuit Breaker State ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS circuit_breaker_state (
    id             BIGSERIAL PRIMARY KEY,
    integration    VARCHAR(100) NOT NULL UNIQUE,
    state          VARCHAR(10) NOT NULL DEFAULT 'closed',
    failure_count  INTEGER NOT NULL DEFAULT 0,
    success_count  INTEGER NOT NULL DEFAULT 0,
    last_failure_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    opened_at      TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cb_state ON circuit_breaker_state (state);

-- ─── Integration Health Log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_health_log (
    id          BIGSERIAL PRIMARY KEY,
    integration VARCHAR(100) NOT NULL,
    status      VARCHAR(20) NOT NULL,
    latency_ms  INTEGER,
    details     JSONB DEFAULT '{}',
    checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_health_log_integration ON integration_health_log (integration, checked_at);
CREATE INDEX IF NOT EXISTS idx_health_log_status      ON integration_health_log (status, checked_at);

-- ─── Dead-Letter Queue ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dlq_events (
    id             BIGSERIAL PRIMARY KEY,
    source_queue   VARCHAR(255) NOT NULL,
    event_type     VARCHAR(100) NOT NULL,
    payload        JSONB NOT NULL DEFAULT '{}',
    failure_reason TEXT NOT NULL,
    retry_count    INTEGER NOT NULL DEFAULT 0,
    resolved_at    TIMESTAMPTZ,
    resolved_by    BIGINT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dlq_source_queue ON dlq_events (source_queue, created_at);
CREATE INDEX IF NOT EXISTS idx_dlq_unresolved   ON dlq_events (resolved_at, created_at) WHERE resolved_at IS NULL;

-- ─── WAF Events (OpenAppSec) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waf_events (
    id              BIGSERIAL PRIMARY KEY,
    event_type      VARCHAR(50) NOT NULL,
    severity        VARCHAR(20) NOT NULL,
    source_ip       VARCHAR(45),
    user_id         BIGINT,
    request_uri     TEXT,
    attack_type     VARCHAR(100),
    payload_snippet TEXT,
    action_taken    VARCHAR(20) NOT NULL,
    rule_id         VARCHAR(100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_waf_severity  ON waf_events (severity, created_at);
CREATE INDEX IF NOT EXISTS idx_waf_source_ip ON waf_events (source_ip, created_at);
CREATE INDEX IF NOT EXISTS idx_waf_user      ON waf_events (user_id, created_at);

-- ─── Dapr Events Audit ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dapr_events (
    id           BIGSERIAL PRIMARY KEY,
    event_type   VARCHAR(100) NOT NULL,
    pubsub_name  VARCHAR(100) NOT NULL,
    topic        VARCHAR(255) NOT NULL,
    data         JSONB NOT NULL DEFAULT '{}',
    status       VARCHAR(20) NOT NULL DEFAULT 'published',
    error_message TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dapr_events_topic  ON dapr_events (topic, created_at);
CREATE INDEX IF NOT EXISTS idx_dapr_events_status ON dapr_events (status, created_at);

-- ─── Permify Audit Log ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS permify_audit_log (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT,
    entity_type  VARCHAR(100) NOT NULL,
    entity_id    VARCHAR(255) NOT NULL,
    permission   VARCHAR(100) NOT NULL,
    subject_type VARCHAR(100) NOT NULL,
    subject_id   VARCHAR(255) NOT NULL,
    decision     VARCHAR(10) NOT NULL,
    snap_token   VARCHAR(255),
    latency_ms   INTEGER,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_permify_audit_user   ON permify_audit_log (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_permify_audit_entity ON permify_audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_permify_audit_denied ON permify_audit_log (decision, created_at) WHERE decision = 'deny';

-- ─── APISIX Route Audit ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apisix_route_audit (
    id           BIGSERIAL PRIMARY KEY,
    route_id     VARCHAR(255) NOT NULL,
    operation    VARCHAR(20) NOT NULL,
    route_config JSONB NOT NULL DEFAULT '{}',
    performed_by BIGINT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_apisix_route_audit ON apisix_route_audit (route_id, created_at);

-- ─── Compliance Cases ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_cases (
    id               BIGSERIAL PRIMARY KEY,
    user_id          BIGINT NOT NULL,
    case_type        VARCHAR(50) NOT NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'open',
    priority         VARCHAR(10) NOT NULL DEFAULT 'medium',
    notes            TEXT,
    assigned_to      BIGINT,
    resolved_at      TIMESTAMPTZ,
    resolution_notes TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_compliance_cases_user   ON compliance_cases (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_compliance_cases_status ON compliance_cases (status, priority);

-- ─── Settlement Batches ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settlement_batches (
    id                BIGSERIAL PRIMARY KEY,
    batch_reference   VARCHAR(255) NOT NULL UNIQUE,
    currency          VARCHAR(10) NOT NULL,
    total_amount      NUMERIC(20,8) NOT NULL,
    transaction_count INTEGER NOT NULL DEFAULT 0,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending',
    rail              VARCHAR(50) NOT NULL,
    settled_at        TIMESTAMPTZ,
    error_message     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_settlement_batches_status ON settlement_batches (status, created_at);
CREATE INDEX IF NOT EXISTS idx_settlement_batches_rail   ON settlement_batches (rail, status);

-- ─── Rate Limit Violations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limit_violations (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT,
    ip_address    VARCHAR(45),
    endpoint      VARCHAR(255) NOT NULL,
    limit_key     VARCHAR(255) NOT NULL,
    request_count INTEGER NOT NULL,
    window_secs   INTEGER NOT NULL,
    blocked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_violations_user     ON rate_limit_violations (user_id, blocked_at);
CREATE INDEX IF NOT EXISTS idx_rate_violations_ip       ON rate_limit_violations (ip_address, blocked_at);
CREATE INDEX IF NOT EXISTS idx_rate_violations_endpoint ON rate_limit_violations (endpoint, blocked_at);

-- ─── Secret Rotation Log ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS secret_rotation_log (
    id            BIGSERIAL PRIMARY KEY,
    secret_name   VARCHAR(255) NOT NULL,
    integration   VARCHAR(100) NOT NULL,
    rotated_by    BIGINT,
    rotation_mode VARCHAR(20) NOT NULL DEFAULT 'manual',
    success       BOOLEAN NOT NULL DEFAULT TRUE,
    error_message TEXT,
    rotated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_secret_rotation_integration ON secret_rotation_log (integration, rotated_at);
CREATE INDEX IF NOT EXISTS idx_secret_rotation_secret      ON secret_rotation_log (secret_name, rotated_at);

-- ─── Lakehouse Sync State ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lakehouse_sync_state (
    id            BIGSERIAL PRIMARY KEY,
    table_name    VARCHAR(255) NOT NULL UNIQUE,
    last_synced_at TIMESTAMPTZ,
    rows_synced   BIGINT NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
