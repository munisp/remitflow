-- Mojaloop Database Initialization Script
-- Creates all necessary tables, indexes, and initial data

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create schemas
CREATE SCHEMA IF NOT EXISTS mojaloop;
CREATE SCHEMA IF NOT EXISTS audit;

-- Set search path
SET search_path TO mojaloop, public;

-- Participants table
CREATE TABLE IF NOT EXISTS participants (
    participant_id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'DFSP',
    currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    endpoints JSONB,
    capabilities JSONB,
    settlement_model VARCHAR(50) DEFAULT 'DEFERRED_NET',
    CONSTRAINT chk_participant_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED'))
);

CREATE INDEX idx_participants_status ON participants(status);
CREATE INDEX idx_participants_type ON participants(type);
CREATE INDEX idx_participants_currency ON participants(currency);

-- Quotes table
CREATE TABLE IF NOT EXISTS quotes (
    quote_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID NOT NULL,
    payer_fsp VARCHAR(255) NOT NULL REFERENCES participants(participant_id),
    payee_fsp VARCHAR(255) NOT NULL REFERENCES participants(participant_id),
    amount_type VARCHAR(20) NOT NULL DEFAULT 'SEND',
    amount DECIMAL(20, 4) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    fees DECIMAL(20, 4) DEFAULT 0,
    commission DECIMAL(20, 4) DEFAULT 0,
    transfer_amount DECIMAL(20, 4) NOT NULL,
    exchange_rate DECIMAL(20, 8),
    expiration TIMESTAMP NOT NULL,
    geo_code VARCHAR(255),
    note TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_quote_status CHECK (status IN ('PENDING', 'RESERVED', 'COMMITTED', 'ABORTED', 'EXPIRED'))
);

CREATE INDEX idx_quotes_transaction_id ON quotes(transaction_id);
CREATE INDEX idx_quotes_payer_fsp ON quotes(payer_fsp);
CREATE INDEX idx_quotes_payee_fsp ON quotes(payee_fsp);
CREATE INDEX idx_quotes_status ON quotes(status);
CREATE INDEX idx_quotes_created_at ON quotes(created_at);

-- Transfers table
CREATE TABLE IF NOT EXISTS transfers (
    transfer_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_id UUID REFERENCES quotes(quote_id),
    payer_fsp VARCHAR(255) NOT NULL REFERENCES participants(participant_id),
    payee_fsp VARCHAR(255) NOT NULL REFERENCES participants(participant_id),
    amount DECIMAL(20, 4) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    condition VARCHAR(512) NOT NULL,
    fulfillment VARCHAR(512),
    expiration TIMESTAMP NOT NULL,
    transfer_state VARCHAR(20) NOT NULL DEFAULT 'RESERVED',
    settlement_window_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_timestamp TIMESTAMP,
    error_information JSONB,
    extensions JSONB,
    CONSTRAINT chk_transfer_state CHECK (transfer_state IN ('RECEIVED', 'RESERVED', 'COMMITTED', 'ABORTED', 'SETTLED'))
);

CREATE INDEX idx_transfers_quote_id ON transfers(quote_id);
CREATE INDEX idx_transfers_payer_fsp ON transfers(payer_fsp);
CREATE INDEX idx_transfers_payee_fsp ON transfers(payee_fsp);
CREATE INDEX idx_transfers_state ON transfers(transfer_state);
CREATE INDEX idx_transfers_settlement_window ON transfers(settlement_window_id);
CREATE INDEX idx_transfers_created_at ON transfers(created_at);

-- Settlement Windows table
CREATE TABLE IF NOT EXISTS settlement_windows (
    settlement_window_id SERIAL PRIMARY KEY,
    state VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    reason VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_settlement_window_state CHECK (state IN ('OPEN', 'CLOSED', 'PENDING_SETTLEMENT', 'SETTLED', 'ABORTED'))
);

CREATE INDEX idx_settlement_windows_state ON settlement_windows(state);
CREATE INDEX idx_settlement_windows_created_at ON settlement_windows(created_at);

-- Settlement Accounts table
CREATE TABLE IF NOT EXISTS settlement_accounts (
    settlement_account_id SERIAL PRIMARY KEY,
    participant_id VARCHAR(255) NOT NULL REFERENCES participants(participant_id),
    currency VARCHAR(3) NOT NULL,
    balance DECIMAL(20, 4) NOT NULL DEFAULT 0,
    reserved_balance DECIMAL(20, 4) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(participant_id, currency)
);

CREATE INDEX idx_settlement_accounts_participant ON settlement_accounts(participant_id);
CREATE INDEX idx_settlement_accounts_currency ON settlement_accounts(currency);

-- Settlement Transfers table
CREATE TABLE IF NOT EXISTS settlement_transfers (
    settlement_transfer_id SERIAL PRIMARY KEY,
    settlement_window_id INTEGER NOT NULL REFERENCES settlement_windows(settlement_window_id),
    transfer_id UUID NOT NULL REFERENCES transfers(transfer_id),
    participant_id VARCHAR(255) NOT NULL REFERENCES participants(participant_id),
    amount DECIMAL(20, 4) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    direction VARCHAR(10) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_direction CHECK (direction IN ('DEBIT', 'CREDIT'))
);

CREATE INDEX idx_settlement_transfers_window ON settlement_transfers(settlement_window_id);
CREATE INDEX idx_settlement_transfers_transfer ON settlement_transfers(transfer_id);
CREATE INDEX idx_settlement_transfers_participant ON settlement_transfers(participant_id);

-- Audit Log table
CREATE TABLE IF NOT EXISTS audit.audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    action VARCHAR(20) NOT NULL,
    old_value JSONB,
    new_value JSONB,
    user_id VARCHAR(255),
    ip_address INET,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_action CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'READ'))
);

CREATE INDEX idx_audit_log_entity ON audit.audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_action ON audit.audit_log(action);
CREATE INDEX idx_audit_log_created_at ON audit.audit_log(created_at);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_participants_updated_at BEFORE UPDATE ON participants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quotes_updated_at BEFORE UPDATE ON quotes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transfers_updated_at BEFORE UPDATE ON transfers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settlement_accounts_updated_at BEFORE UPDATE ON settlement_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert initial settlement window
INSERT INTO settlement_windows (state, reason) VALUES ('OPEN', 'Initial settlement window');

-- Insert sample participants for testing
INSERT INTO participants (participant_id, name, type, currency, status) VALUES
    ('rafiki-ng', 'Rafiki Nigeria', 'DFSP', 'NGN', 'ACTIVE'),
    ('cips-global', 'CIPS Global', 'DFSP', 'USD', 'ACTIVE'),
    ('papss-africa', 'PAPSS Africa', 'DFSP', 'XOF', 'ACTIVE')
ON CONFLICT (participant_id) DO NOTHING;

-- Create settlement accounts for sample participants
INSERT INTO settlement_accounts (participant_id, currency, balance, reserved_balance) VALUES
    ('rafiki-ng', 'NGN', 1000000.00, 0.00),
    ('cips-global', 'USD', 100000.00, 0.00),
    ('papss-africa', 'XOF', 50000000.00, 0.00)
ON CONFLICT (participant_id, currency) DO NOTHING;

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA mojaloop TO mojaloop;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA mojaloop TO mojaloop;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA audit TO mojaloop;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA audit TO mojaloop;

-- Analyze tables for query optimization
ANALYZE participants;
ANALYZE quotes;
ANALYZE transfers;
ANALYZE settlement_windows;
ANALYZE settlement_accounts;
ANALYZE settlement_transfers;

