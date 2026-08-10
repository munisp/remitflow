-- =============================================================================
-- RemitFlow Production Database Migration v2.0 — Complete Schema
-- Run this BEFORE starting any services
-- =============================================================================

-- Create database (run as superuser)
-- CREATE DATABASE remitflow OWNER remitflow;

-- ─── Compliance ML ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_ml_state (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_compliance_ml_updated ON compliance_ml_state(updated_at);

CREATE TABLE IF NOT EXISTS compliance_ml_events (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_compliance_ml_events_type ON compliance_ml_events(event_type, created_at);

CREATE TABLE IF NOT EXISTS screening_alerts (
    id BIGSERIAL PRIMARY KEY,
    transaction_id TEXT,
    user_id TEXT,
    screening_type TEXT NOT NULL,
    provider TEXT NOT NULL,
    raw_response JSONB,
    risk_score REAL,
    flagged BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_screening_tx ON screening_alerts(transaction_id);
CREATE INDEX IF NOT EXISTS idx_screening_user ON screening_alerts(user_id);

-- ─── KYC Liveness ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kyc_liveness_sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    method_used TEXT,
    fallback_active BOOLEAN DEFAULT FALSE,
    confidence REAL,
    raw_result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_kyc_user ON kyc_liveness_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_liveness_sessions(status);

CREATE TABLE IF NOT EXISTS kyc_liveness_events (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT,
    event_type TEXT NOT NULL,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kyc_events_session ON kyc_liveness_events(session_id);

-- ─── AML Scorer ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aml_scores (
    id BIGSERIAL PRIMARY KEY,
    transaction_id TEXT,
    user_id TEXT,
    score REAL NOT NULL,
    model_version TEXT,
    model_age_days INT,
    features JSONB,
    flagged BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aml_tx ON aml_scores(transaction_id);
CREATE INDEX IF NOT EXISTS idx_aml_user ON aml_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_aml_flagged ON aml_scores(flagged, created_at);

-- ─── FX Engine ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fx_rates (
    id BIGSERIAL PRIMARY KEY,
    base_currency TEXT NOT NULL,
    quote_currency TEXT NOT NULL,
    rate REAL NOT NULL,
    provider TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes'
);
CREATE INDEX IF NOT EXISTS idx_fx_pair ON fx_rates(base_currency, quote_currency, fetched_at DESC);

CREATE TABLE IF NOT EXISTS fx_quotes (
    quote_id TEXT PRIMARY KEY,
    transaction_id TEXT,
    base_currency TEXT NOT NULL,
    quote_currency TEXT NOT NULL,
    amount REAL NOT NULL,
    mid_rate REAL NOT NULL,
    spread_bps REAL NOT NULL,
    customer_rate REAL NOT NULL,
    customer_amount REAL NOT NULL,
    provider TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fx_quote_tx ON fx_quotes(transaction_id);

-- ─── Core Banking ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS core_banking_events (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    account_id TEXT,
    payload JSONB,
    provider_response JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cb_events_type ON core_banking_events(event_type, created_at);

CREATE TABLE IF NOT EXISTS core_banking_accounts (
    account_id TEXT PRIMARY KEY,
    tp_account_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    account_type TEXT NOT NULL DEFAULT 'checking',
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'active',
    balance_cents BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cb_accounts_user ON core_banking_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_cb_accounts_status ON core_banking_accounts(status);

CREATE TABLE IF NOT EXISTS core_banking_transfers (
    transfer_id TEXT PRIMARY KEY,
    tp_transfer_id TEXT,
    source_account_id TEXT NOT NULL,
    destination_account_id TEXT NOT NULL,
    amount_cents BIGINT NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reference TEXT,
    provider_response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cb_transfers_status ON core_banking_transfers(status);

-- ─── Rust Transaction Processor (Double-Entry Ledger) ───────────────────────
CREATE TABLE IF NOT EXISTS accounts (
    account_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    balance_cents BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);

CREATE TABLE IF NOT EXISTS transactions (
    transaction_id TEXT PRIMARY KEY,
    sender_account_id TEXT NOT NULL REFERENCES accounts(account_id),
    receiver_account_id TEXT NOT NULL REFERENCES accounts(account_id),
    amount_cents BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'pending',
    settlement_status TEXT NOT NULL DEFAULT 'pending',
    reference TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_tx_settlement ON transactions(settlement_status);
CREATE INDEX IF NOT EXISTS idx_tx_sender ON transactions(sender_account_id);
CREATE INDEX IF NOT EXISTS idx_tx_receiver ON transactions(receiver_account_id);
CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_entries (
    entry_id BIGSERIAL PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(transaction_id),
    account_id TEXT NOT NULL REFERENCES accounts(account_id),
    entry_type TEXT NOT NULL CHECK (entry_type IN ('debit', 'credit')),
    amount_cents BIGINT NOT NULL,
    currency TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_tx ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(account_id);

CREATE TABLE IF NOT EXISTS settlement_events (
    event_id BIGSERIAL PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(transaction_id),
    event_type TEXT NOT NULL CHECK (event_type IN ('submitted', 'confirmed', 'completed', 'failed')),
    provider TEXT,
    provider_reference TEXT,
    raw_response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_settlement_tx ON settlement_events(transaction_id);
CREATE INDEX IF NOT EXISTS idx_settlement_type ON settlement_events(event_type, created_at);

-- ─── Travel Rule ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS travel_rule_messages (
    id BIGSERIAL PRIMARY KEY,
    message_id TEXT UNIQUE NOT NULL,
    transaction_id TEXT NOT NULL,
    protocol TEXT NOT NULL,
    direction TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    originator_vasp TEXT,
    beneficiary_vasp TEXT,
    originator_data JSONB,
    beneficiary_data JSONB,
    amount REAL NOT NULL,
    currency TEXT NOT NULL,
    raw_payload JSONB,
    response_payload JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tr_tx ON travel_rule_messages(transaction_id);
CREATE INDEX IF NOT EXISTS idx_tr_status ON travel_rule_messages(status);

CREATE TABLE IF NOT EXISTS travel_rule_vasps (
    vasp_id TEXT PRIMARY KEY,
    vasp_name TEXT NOT NULL,
    vasp_did TEXT,
    trisa_endpoint TEXT,
    sygna_vasp_code TEXT,
    openvasp_node_id TEXT,
    supported_protocols TEXT[],
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── SAR Filing ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sar_reports (
    sar_id TEXT PRIMARY KEY,
    transaction_id TEXT,
    user_id TEXT,
    jurisdiction TEXT NOT NULL,
    filing_status TEXT NOT NULL DEFAULT 'draft',
    nca_reference TEXT,
    fincen_boid TEXT,
    risk_score REAL,
    risk_factors TEXT[],
    amount_usd REAL,
    sender_country TEXT,
    receiver_country TEXT,
    narrative TEXT,
    raw_submission JSONB,
    fiu_response JSONB,
    error_message TEXT,
    filed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sar_tx ON sar_reports(transaction_id);
CREATE INDEX IF NOT EXISTS idx_sar_status ON sar_reports(filing_status);
CREATE INDEX IF NOT EXISTS idx_sar_jurisdiction ON sar_reports(jurisdiction);

CREATE TABLE IF NOT EXISTS sar_attachments (
    attachment_id BIGSERIAL PRIMARY KEY,
    sar_id TEXT NOT NULL REFERENCES sar_reports(sar_id),
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_data BYTEA,
    file_hash TEXT,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Kafka Streaming ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kafka_dlq (
    id BIGSERIAL PRIMARY KEY,
    topic TEXT NOT NULL,
    partition INT,
    key TEXT,
    payload JSONB NOT NULL,
    error TEXT,
    retry_count INT DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dlq_topic ON kafka_dlq(topic);
CREATE INDEX IF NOT EXISTS idx_dlq_retry ON kafka_dlq(next_retry_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dlq_created ON kafka_dlq(created_at);

CREATE TABLE IF NOT EXISTS kafka_events (
    id BIGSERIAL PRIMARY KEY,
    topic TEXT NOT NULL,
    partition INT,
    offset BIGINT,
    key TEXT,
    payload JSONB NOT NULL,
    produced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_topic ON kafka_events(topic, produced_at DESC);

-- ─── MFA Service ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mfa_methods (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    method_type TEXT NOT NULL CHECK (method_type IN ('totp', 'webauthn', 'backup_codes')),
    secret TEXT,
    public_key BYTEA,
    credential_id BYTEA,
    sign_count INT DEFAULT 0,
    confirmed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    UNIQUE(user_id, method_type)
);
CREATE INDEX IF NOT EXISTS idx_mfa_user ON mfa_methods(user_id);

CREATE TABLE IF NOT EXISTS mfa_challenges (
    challenge_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    method_type TEXT NOT NULL,
    challenge_data TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mfa_challenge ON mfa_challenges(challenge_id, expires_at);

CREATE TABLE IF NOT EXISTS mfa_audit (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    method_type TEXT NOT NULL,
    action TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    success BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mfa_audit_user ON mfa_audit(user_id, created_at DESC);

-- ─── Audit & Compliance Views ───────────────────────────────────────────────
CREATE OR REPLACE VIEW v_transaction_audit AS
SELECT
    t.transaction_id,
    t.status,
    t.settlement_status,
    t.amount_cents / 100.0 AS amount,
    t.currency,
    sa.account_id AS sender_account,
    sa.user_id AS sender_user,
    ra.account_id AS receiver_account,
    ra.user_id AS receiver_user,
    t.reference,
    t.created_at,
    t.settled_at,
    (SELECT COUNT(*) FROM ledger_entries le WHERE le.transaction_id = t.transaction_id) AS ledger_entry_count,
    (SELECT COUNT(*) FROM settlement_events se WHERE se.transaction_id = t.transaction_id) AS settlement_event_count
FROM transactions t
JOIN accounts sa ON t.sender_account_id = sa.account_id
JOIN accounts ra ON t.receiver_account_id = ra.account_id;

CREATE OR REPLACE VIEW v_compliance_dashboard AS
SELECT
    DATE_TRUNC('day', s.created_at) AS day,
    s.screening_type,
    s.provider,
    COUNT(*) AS total_screenings,
    SUM(CASE WHEN s.flagged THEN 1 ELSE 0 END) AS flagged_count,
    AVG(s.risk_score) AS avg_risk_score
FROM screening_alerts s
GROUP BY 1, 2, 3;

CREATE OR REPLACE VIEW v_sar_overdue AS
SELECT
    sar_id,
    transaction_id,
    user_id,
    jurisdiction,
    filing_status,
    created_at,
    (created_at + INTERVAL '30 days') AS deadline,
    NOW() - (created_at + INTERVAL '30 days') AS overdue_by
FROM sar_reports
WHERE filing_status IN ('draft', 'pending_manual_review')
AND created_at < NOW() - INTERVAL '30 days';
