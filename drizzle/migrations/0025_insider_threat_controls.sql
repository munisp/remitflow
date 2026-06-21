-- Migration: Insider Threat Controls
-- Adds tables for maker-checker workflow, JIT access, audit logging,
-- canary tokens, and DLP tracking.

-- 1. Maker-Checker Dual Authorization Requests
CREATE TABLE IF NOT EXISTS maker_checker_requests (
    id VARCHAR(64) PRIMARY KEY,
    operation_type VARCHAR(50) NOT NULL,
    requested_by INTEGER NOT NULL REFERENCES users(id),
    requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
    payload JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    approved_by INTEGER REFERENCES users(id),
    approved_at TIMESTAMP,
    rejection_reason TEXT,
    expires_at TIMESTAMP NOT NULL,
    risk_score INTEGER NOT NULL DEFAULT 0,
    required_approvers INTEGER NOT NULL DEFAULT 1,
    current_approvals INTEGER NOT NULL DEFAULT 0,
    justification TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mc_requests_status ON maker_checker_requests(status);
CREATE INDEX idx_mc_requests_requested_by ON maker_checker_requests(requested_by);
CREATE INDEX idx_mc_requests_expires ON maker_checker_requests(expires_at);

-- 2. JIT (Just-In-Time) Access Grants
CREATE TABLE IF NOT EXISTS jit_access_grants (
    id VARCHAR(64) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    privilege VARCHAR(50) NOT NULL,
    granted_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    granted_by INTEGER NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at TIMESTAMP,
    revoked_by INTEGER REFERENCES users(id),
    actions_performed INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jit_grants_user ON jit_access_grants(user_id);
CREATE INDEX idx_jit_grants_active ON jit_access_grants(expires_at) WHERE revoked = FALSE;
CREATE INDEX idx_jit_grants_privilege ON jit_access_grants(privilege);

-- 3. WebAuthn/FIDO2 Credentials
CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id VARCHAR(64) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    credential_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    sign_count INTEGER NOT NULL DEFAULT 0,
    aaguid VARCHAR(36),
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_used TIMESTAMP
);

CREATE INDEX idx_webauthn_user ON webauthn_credentials(user_id);
CREATE INDEX idx_webauthn_cred_id ON webauthn_credentials(credential_id);

-- 4. Geo + Time Fence Configuration
CREATE TABLE IF NOT EXISTS geo_time_fence_config (
    id SERIAL PRIMARY KEY,
    allowed_ips TEXT[] DEFAULT '{}',
    allowed_countries VARCHAR(2)[] DEFAULT '{CA,NG,US,GB,KE,GH,ZA}',
    business_hours_start INTEGER NOT NULL DEFAULT 6,
    business_hours_end INTEGER NOT NULL DEFAULT 22,
    allowed_days INTEGER[] DEFAULT '{1,2,3,4,5}',
    break_glass_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_by INTEGER REFERENCES users(id)
);

-- 5. Break-Glass Access Log (immutable)
CREATE TABLE IF NOT EXISTS break_glass_log (
    id VARCHAR(64) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    incident_id VARCHAR(100),
    granted_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    review_due TIMESTAMP NOT NULL,
    reviewed BOOLEAN NOT NULL DEFAULT FALSE,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP
);

CREATE INDEX idx_break_glass_user ON break_glass_log(user_id);
CREATE INDEX idx_break_glass_review ON break_glass_log(review_due) WHERE reviewed = FALSE;

-- 6. DLP (Data Loss Prevention) Access Log
CREATE TABLE IF NOT EXISTS dlp_access_log (
    id VARCHAR(64) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    action VARCHAR(20) NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    record_count INTEGER NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    blocked BOOLEAN NOT NULL DEFAULT FALSE,
    reason TEXT,
    ip_address INET,
    query_hash VARCHAR(64)
);

CREATE INDEX idx_dlp_user ON dlp_access_log(user_id);
CREATE INDEX idx_dlp_blocked ON dlp_access_log(blocked) WHERE blocked = TRUE;
CREATE INDEX idx_dlp_timestamp ON dlp_access_log(timestamp);

-- 7. Canary Tokens (Honey Records)
CREATE TABLE IF NOT EXISTS canary_tokens (
    id VARCHAR(64) PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    record_id VARCHAR(100) NOT NULL,
    honey_data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    trip_count INTEGER NOT NULL DEFAULT 0,
    last_trip TIMESTAMP,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX idx_canary_table_record ON canary_tokens(table_name, record_id);

-- 8. Canary Trip Alerts
CREATE TABLE IF NOT EXISTS canary_trips (
    id VARCHAR(64) PRIMARY KEY,
    canary_token_id VARCHAR(64) NOT NULL REFERENCES canary_tokens(id),
    accessed_by INTEGER NOT NULL,
    ip_address INET,
    query_pattern TEXT,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    auto_action VARCHAR(50) NOT NULL DEFAULT 'session_flagged',
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_by INTEGER REFERENCES users(id)
);

CREATE INDEX idx_canary_trips_token ON canary_trips(canary_token_id);
CREATE INDEX idx_canary_trips_accessed_by ON canary_trips(accessed_by);

-- 9. Immutable Audit Log (local backup — primary is Go service with hash chain)
CREATE TABLE IF NOT EXISTS immutable_audit_log (
    chain_position BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    actor_id INTEGER NOT NULL,
    actor_role VARCHAR(30),
    ip_address INET,
    resource VARCHAR(100),
    action VARCHAR(50) NOT NULL,
    outcome VARCHAR(20) NOT NULL,
    risk_score INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}',
    previous_hash VARCHAR(64),
    entry_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_actor ON immutable_audit_log(actor_id);
CREATE INDEX idx_audit_event_type ON immutable_audit_log(event_type);
CREATE INDEX idx_audit_created ON immutable_audit_log(created_at);
CREATE INDEX idx_audit_risk ON immutable_audit_log(risk_score) WHERE risk_score >= 50;

-- 10. Delayed Reversals Queue
CREATE TABLE IF NOT EXISTS delayed_reversals (
    id VARCHAR(64) PRIMARY KEY,
    transfer_ref VARCHAR(100) NOT NULL,
    amount DECIMAL(20,2) NOT NULL,
    requested_by INTEGER NOT NULL REFERENCES users(id),
    requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
    execute_at TIMESTAMP NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'cancelled')),
    cancelled_by INTEGER REFERENCES users(id),
    cancelled_at TIMESTAMP,
    cancel_reason TEXT
);

CREATE INDEX idx_delayed_reversals_status ON delayed_reversals(status);
CREATE INDEX idx_delayed_reversals_execute ON delayed_reversals(execute_at) WHERE status = 'pending';

-- 11. Enable pgaudit extension (if available)
-- Note: Requires superuser and pgaudit extension installed on the server
-- In production: ALTER SYSTEM SET pgaudit.log = 'all';
-- CREATE EXTENSION IF NOT EXISTS pgaudit;

-- 12. Row-Level Security on sensitive tables
-- Enable RLS (in production, enforce policies per-role)
ALTER TABLE maker_checker_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE jit_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE break_glass_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE dlp_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE canary_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE immutable_audit_log ENABLE ROW LEVEL SECURITY;

-- Insert default geo-time fence config
INSERT INTO geo_time_fence_config (allowed_countries, business_hours_start, business_hours_end, allowed_days, break_glass_enabled)
VALUES ('{CA,NG,US,GB,KE,GH,ZA}', 6, 22, '{1,2,3,4,5}', TRUE)
ON CONFLICT DO NOTHING;

-- Insert canary tokens in key tables
INSERT INTO canary_tokens (id, table_name, record_id, honey_data) VALUES
('canary_users_9999', 'users', '9999', '{"name": "Test Account DO NOT ACCESS", "email": "honey@internal.test"}'),
('canary_wallets_9999', 'wallets', '9999', '{"balance": "999999.99", "currency": "USD"}'),
('canary_transactions_9999', 'transactions', '9999', '{"amount": "1000000", "type": "suspicious_test"}'),
('canary_kyc_9999', 'kyc_documents', '9999', '{"document_type": "passport", "number": "HONEY_TOKEN"}'),
('canary_agents_9999', 'agent_network', '9999', '{"business_name": "Honey Agent DO NOT ACCESS"}')
ON CONFLICT DO NOTHING;
