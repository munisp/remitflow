-- Migration 0010: GDPR erasure log and AML tables

-- GDPR erasure log
CREATE TABLE IF NOT EXISTS gdpr_erasure_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    reason VARCHAR(255) DEFAULT 'user_request',
    requested_by VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    tables_deleted JSONB DEFAULT '[]',
    tables_anonymised JSONB DEFAULT '[]',
    errors JSONB DEFAULT '[]',
    error TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gdpr_erasure_user_id ON gdpr_erasure_log(user_id);
CREATE INDEX IF NOT EXISTS idx_gdpr_erasure_status ON gdpr_erasure_log(status);

-- AML transaction log
CREATE TABLE IF NOT EXISTS aml_transaction_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id VARCHAR(255) UNIQUE NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    amount DECIMAL(20,8) NOT NULL,
    amount_usd DECIMAL(20,8) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
    transaction_type VARCHAR(100) NOT NULL,
    origin_country VARCHAR(10) NOT NULL DEFAULT 'NG',
    destination_country VARCHAR(10) NOT NULL DEFAULT 'NG',
    risk_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    risk_level VARCHAR(20) NOT NULL DEFAULT 'low',
    risk_factors JSONB DEFAULT '[]',
    is_blocked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aml_log_user_id ON aml_transaction_log(user_id);
CREATE INDEX IF NOT EXISTS idx_aml_log_risk_level ON aml_transaction_log(risk_level);
CREATE INDEX IF NOT EXISTS idx_aml_log_created_at ON aml_transaction_log(created_at);

-- AML alerts
CREATE TABLE IF NOT EXISTS aml_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    alert_type VARCHAR(100) NOT NULL,
    risk_level VARCHAR(20) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'open',
    reviewer_id VARCHAR(255),
    reviewer_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_aml_alerts_user_id ON aml_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_aml_alerts_status ON aml_alerts(status);
CREATE INDEX IF NOT EXISTS idx_aml_alerts_risk_level ON aml_alerts(risk_level);

-- AML SARs (Suspicious Activity Reports)
CREATE TABLE IF NOT EXISTS aml_sars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_number VARCHAR(100) UNIQUE NOT NULL,
    alert_id UUID NOT NULL,
    filing_officer_id VARCHAR(255) NOT NULL,
    subject_user_id VARCHAR(255) NOT NULL,
    transaction_ids JSONB DEFAULT '[]',
    total_amount_usd DECIMAL(20,8) NOT NULL,
    suspicious_activity_description TEXT NOT NULL,
    activity_start_date TIMESTAMPTZ NOT NULL,
    activity_end_date TIMESTAMPTZ NOT NULL,
    law_enforcement_contacted BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(50) NOT NULL DEFAULT 'submitted',
    filed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aml_sars_subject ON aml_sars(subject_user_id);
CREATE INDEX IF NOT EXISTS idx_aml_sars_status ON aml_sars(status);

-- Sanctions list
CREATE TABLE IF NOT EXISTS sanctions_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id VARCHAR(255) NOT NULL,
    entity_type VARCHAR(50) NOT NULL DEFAULT 'individual',
    list_source VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sanctions_entity_id ON sanctions_list(entity_id);

-- PEP list
CREATE TABLE IF NOT EXISTS pep_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    pep_type VARCHAR(100) NOT NULL DEFAULT 'domestic',
    is_active BOOLEAN NOT NULL DEFAULT true,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pep_user_id ON pep_list(user_id);

COMMENT ON TABLE gdpr_erasure_log IS 'GDPR Article 17 erasure request audit trail — must be retained for 7 years';
COMMENT ON TABLE aml_transaction_log IS 'AML transaction screening log — must be retained for 7 years (FATF requirement)';
COMMENT ON TABLE aml_sars IS 'Suspicious Activity Reports — must be retained for 7 years';
