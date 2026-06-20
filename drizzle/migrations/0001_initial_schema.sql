-- RemitFlow Initial Schema Migration
-- Creates core tables required for production operation

-- Users & Authentication
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(50),
  password_hash VARCHAR(255) NOT NULL,
  kyc_tier SMALLINT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  country_code CHAR(2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_country ON users(country_code);

-- Beneficiaries
CREATE TABLE IF NOT EXISTS beneficiaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  full_name VARCHAR(255) NOT NULL,
  bank_code VARCHAR(20),
  account_number VARCHAR(50),
  mobile_number VARCHAR(50),
  country_code CHAR(2) NOT NULL,
  delivery_method VARCHAR(20) NOT NULL DEFAULT 'bank_transfer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, account_number, bank_code)
);

CREATE INDEX idx_beneficiaries_user ON beneficiaries(user_id);

-- Transfers
CREATE TABLE IF NOT EXISTS transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  beneficiary_id UUID NOT NULL REFERENCES beneficiaries(id),
  idempotency_key VARCHAR(64) UNIQUE NOT NULL,
  source_currency CHAR(3) NOT NULL,
  destination_currency CHAR(3) NOT NULL,
  source_amount NUMERIC(18,4) NOT NULL,
  destination_amount NUMERIC(18,4) NOT NULL,
  fx_rate NUMERIC(18,8) NOT NULL,
  fee_amount NUMERIC(18,4) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  rail VARCHAR(30) NOT NULL,
  corridor VARCHAR(10) NOT NULL,
  reference VARCHAR(100),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX idx_transfers_user ON transfers(user_id);
CREATE INDEX idx_transfers_status ON transfers(status);
CREATE INDEX idx_transfers_created ON transfers(created_at);
CREATE INDEX idx_transfers_idempotency ON transfers(idempotency_key);

-- KYC Documents
CREATE TABLE IF NOT EXISTS kyc_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  document_type VARCHAR(30) NOT NULL,
  provider VARCHAR(30) NOT NULL,
  provider_check_id VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  result JSONB,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);

CREATE INDEX idx_kyc_user ON kyc_documents(user_id);
CREATE INDEX idx_kyc_status ON kyc_documents(status);

-- Audit Trail
CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  actor_id UUID,
  target_type VARCHAR(30),
  target_id UUID,
  details JSONB NOT NULL DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  hash VARCHAR(64) NOT NULL,
  previous_hash VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_actor ON audit_events(actor_id);
CREATE INDEX idx_audit_type ON audit_events(event_type);
CREATE INDEX idx_audit_created ON audit_events(created_at);
CREATE INDEX idx_audit_target ON audit_events(target_type, target_id);

-- Compliance (SAR/STR filings)
CREATE TABLE IF NOT EXISTS compliance_filings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_type VARCHAR(10) NOT NULL,
  jurisdiction CHAR(2) NOT NULL,
  subject_user_id UUID REFERENCES users(id),
  transfer_ids UUID[] NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  filed_at TIMESTAMPTZ,
  regulator_reference VARCHAR(100),
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_filings_user ON compliance_filings(subject_user_id);
CREATE INDEX idx_filings_status ON compliance_filings(status);

-- Nostro/Vostro Balances (for settlement tracking)
CREATE TABLE IF NOT EXISTS nostro_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency CHAR(3) NOT NULL,
  bank_name VARCHAR(255) NOT NULL,
  account_number VARCHAR(50) NOT NULL,
  country_code CHAR(2) NOT NULL,
  balance NUMERIC(18,4) NOT NULL DEFAULT 0,
  last_reconciled_at TIMESTAMPTZ,
  UNIQUE(currency, bank_name, account_number)
);

-- Feature flags
CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) UNIQUE NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  rollout_percentage SMALLINT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
