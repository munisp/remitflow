-- RemitFlow Production Hardening Migration
-- Adds tables for: payment DLQ, idempotency, state machine, settlement reconciliation,
-- continuous monitoring, and performance infrastructure

-- ─── Payment Dead Letter Queue ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_dlq (
    id SERIAL PRIMARY KEY,
    payment_id VARCHAR(255) NOT NULL,
    rail VARCHAR(100) NOT NULL,
    error_code VARCHAR(100),
    error_message TEXT,
    attempts INTEGER DEFAULT 0,
    payload JSONB,
    resolved_at TIMESTAMP,
    resolved_by INTEGER REFERENCES users(id),
    resolution_notes TEXT,
    last_retry_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_dlq_unresolved ON payment_dlq(created_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payment_dlq_payment_id ON payment_dlq(payment_id);

-- ─── Payment State Transitions (Audit Trail) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_state_transitions (
    id SERIAL PRIMARY KEY,
    payment_id VARCHAR(255) NOT NULL,
    from_state VARCHAR(50) NOT NULL,
    to_state VARCHAR(50) NOT NULL,
    reason TEXT,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_state_payment_id ON payment_state_transitions(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_state_created ON payment_state_transitions(created_at);

-- ─── Idempotency Keys ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key VARCHAR(255) PRIMARY KEY,
    result JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);

-- ─── Settlement Reconciliations ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settlement_reconciliations (
    id SERIAL PRIMARY KEY,
    rail VARCHAR(100) NOT NULL,
    period_start TIMESTAMP NOT NULL,
    period_end TIMESTAMP NOT NULL,
    our_count INTEGER NOT NULL DEFAULT 0,
    provider_count INTEGER NOT NULL DEFAULT 0,
    matched INTEGER NOT NULL DEFAULT 0,
    discrepancy_count INTEGER NOT NULL DEFAULT 0,
    total_diff DECIMAL(20, 4) DEFAULT 0,
    status VARCHAR(50) NOT NULL,
    details JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_recon_rail ON settlement_reconciliations(rail, period_start);

-- ─── Continuous Monitoring ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS continuous_monitoring (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    monitoring_type VARCHAR(50) NOT NULL,
    frequency VARCHAR(20) NOT NULL DEFAULT 'daily',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    enrolled_by INTEGER REFERENCES users(id),
    last_check_at TIMESTAMP,
    next_check_at TIMESTAMP,
    last_result VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, monitoring_type)
);

CREATE INDEX IF NOT EXISTS idx_continuous_monitoring_due ON continuous_monitoring(next_check_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_continuous_monitoring_user ON continuous_monitoring(user_id);

-- ─── PEP Screening Results ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pep_screening_results (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    screened_name VARCHAR(500) NOT NULL,
    is_pep BOOLEAN NOT NULL DEFAULT FALSE,
    provider VARCHAR(100),
    matches JSONB,
    screened_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pep_screening_user ON pep_screening_results(user_id);
CREATE INDEX IF NOT EXISTS idx_pep_screening_flagged ON pep_screening_results(user_id) WHERE is_pep = TRUE;

-- ─── Adverse Media Results ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adverse_media_results (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    screened_name VARCHAR(500) NOT NULL,
    has_adverse_media BOOLEAN NOT NULL DEFAULT FALSE,
    articles JSONB,
    screened_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adverse_media_user ON adverse_media_results(user_id);

-- ─── API Key Lifecycle ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_key_rotations (
    id SERIAL PRIMARY KEY,
    api_key_id INTEGER NOT NULL,
    old_key_hash VARCHAR(255),
    new_key_hash VARCHAR(255) NOT NULL,
    rotated_by INTEGER REFERENCES users(id),
    reason VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─── Security Events (persistent) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS security_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    ip_address VARCHAR(45),
    user_id INTEGER REFERENCES users(id),
    path VARCHAR(500),
    details JSONB,
    severity VARCHAR(20) DEFAULT 'info',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_security_events_ip ON security_events(ip_address);

-- ─── Circuit Breaker State (for persistence across restarts) ─────────────────
CREATE TABLE IF NOT EXISTS circuit_breaker_state (
    service_name VARCHAR(255) PRIMARY KEY,
    state VARCHAR(20) NOT NULL DEFAULT 'closed',
    failure_count INTEGER DEFAULT 0,
    last_failure_at TIMESTAMP,
    opened_at TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─── SLO Tracking ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slo_metrics (
    id SERIAL PRIMARY KEY,
    slo_name VARCHAR(255) NOT NULL,
    window_start TIMESTAMP NOT NULL,
    window_end TIMESTAMP NOT NULL,
    total_requests BIGINT DEFAULT 0,
    successful_requests BIGINT DEFAULT 0,
    error_budget_consumed DECIMAL(10, 4) DEFAULT 0,
    burn_rate DECIMAL(10, 4) DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slo_metrics_name ON slo_metrics(slo_name, window_start);

-- ─── Performance: Vacuum and Analyze scheduling config ──────────────────────
COMMENT ON TABLE transactions IS 'High-volume table — recommend monthly partitioning and weekly VACUUM ANALYZE';
COMMENT ON TABLE audit_logs IS 'High-volume table — recommend monthly partitioning (7-year retention) and weekly VACUUM ANALYZE';
COMMENT ON TABLE kyc_documents IS 'Medium-volume table — recommend quarterly partitioning (10-year retention)';
COMMENT ON TABLE sanctions_checks IS 'Medium-volume table — recommend monthly partitioning (7-year retention)';
