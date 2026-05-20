-- Mojaloop Hub PostgreSQL Schema
-- This schema is for the LOCAL Mojaloop Hub deployment with PostgreSQL
-- 
-- IMPORTANT: This is the schema for Mojaloop's metadata and scheme-level data.
-- TigerBeetle remains the ledger-of-record for all customer balances.
--
-- Database: mojaloop_hub
-- Compatible with: Mojaloop v15.x+ (PostgreSQL support via Knex.js)

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- PARTICIPANTS (DFSPs registered with the hub)
-- ============================================================================
CREATE TABLE IF NOT EXISTS participants (
    participant_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(128),
    
    -- Participant type (DFSP, HUB, etc.)
    participant_type VARCHAR(32) NOT NULL DEFAULT 'DFSP',
    
    -- Currency support
    currency_id VARCHAR(3) NOT NULL DEFAULT 'NGN',
    
    -- Endpoints for callbacks
    endpoints JSONB DEFAULT '{}',
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_participants_name ON participants(name);
CREATE INDEX idx_participants_active ON participants(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_participants_currency ON participants(currency_id);

-- ============================================================================
-- PARTICIPANT ENDPOINTS (callback URLs for each participant)
-- ============================================================================
CREATE TABLE IF NOT EXISTS participant_endpoints (
    endpoint_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_id UUID NOT NULL REFERENCES participants(participant_id),
    endpoint_type VARCHAR(64) NOT NULL,
    endpoint_value TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(participant_id, endpoint_type)
);

CREATE INDEX idx_participant_endpoints_participant ON participant_endpoints(participant_id);
CREATE INDEX idx_participant_endpoints_type ON participant_endpoints(endpoint_type);

-- ============================================================================
-- PARTICIPANT POSITIONS (scheme-level positions, NOT ledger-of-record)
-- ============================================================================
-- NOTE: These are Mojaloop's view of positions for settlement purposes.
-- TigerBeetle is the authoritative ledger for actual balances.
CREATE TABLE IF NOT EXISTS participant_positions (
    position_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_id UUID NOT NULL REFERENCES participants(participant_id),
    currency_id VARCHAR(3) NOT NULL DEFAULT 'NGN',
    
    -- Position values (scheme-level, for settlement calculation)
    value DECIMAL(18, 4) NOT NULL DEFAULT 0,
    reserved_value DECIMAL(18, 4) NOT NULL DEFAULT 0,
    
    -- Limits
    net_debit_cap DECIMAL(18, 4),
    
    -- Timestamps
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    changed_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(participant_id, currency_id)
);

CREATE INDEX idx_participant_positions_participant ON participant_positions(participant_id);
CREATE INDEX idx_participant_positions_currency ON participant_positions(currency_id);

-- ============================================================================
-- TRANSFERS (FSPIOP transfer records)
-- ============================================================================
CREATE TABLE IF NOT EXISTS transfers (
    transfer_id UUID PRIMARY KEY,
    
    -- Participants
    payer_fsp VARCHAR(128) NOT NULL,
    payee_fsp VARCHAR(128) NOT NULL,
    
    -- Amount
    amount DECIMAL(18, 4) NOT NULL,
    currency_id VARCHAR(3) NOT NULL DEFAULT 'NGN',
    
    -- Transfer state
    transfer_state VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
    -- States: RECEIVED, RESERVED, COMMITTED, ABORTED, EXPIRED
    
    -- ILC (Interledger Condition)
    ilp_condition VARCHAR(256),
    ilp_fulfilment VARCHAR(256),
    
    -- Expiry
    expiration_date TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_date TIMESTAMP WITH TIME ZONE,
    
    -- Extension data
    extension_list JSONB DEFAULT '[]',
    
    -- TigerBeetle reference (for reconciliation)
    tigerbeetle_transfer_id BIGINT,
    tigerbeetle_pending_id BIGINT
);

CREATE INDEX idx_transfers_payer ON transfers(payer_fsp);
CREATE INDEX idx_transfers_payee ON transfers(payee_fsp);
CREATE INDEX idx_transfers_state ON transfers(transfer_state);
CREATE INDEX idx_transfers_created ON transfers(created_date);
CREATE INDEX idx_transfers_tigerbeetle ON transfers(tigerbeetle_transfer_id) WHERE tigerbeetle_transfer_id IS NOT NULL;

-- ============================================================================
-- TRANSFER STATE CHANGES (audit trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS transfer_state_changes (
    state_change_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID NOT NULL REFERENCES transfers(transfer_id),
    transfer_state VARCHAR(32) NOT NULL,
    reason TEXT,
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_transfer_state_changes_transfer ON transfer_state_changes(transfer_id);
CREATE INDEX idx_transfer_state_changes_created ON transfer_state_changes(created_date);

-- ============================================================================
-- QUOTES (FSPIOP quote records)
-- ============================================================================
CREATE TABLE IF NOT EXISTS quotes (
    quote_id UUID PRIMARY KEY,
    transaction_id UUID,
    transaction_request_id UUID,
    
    -- Participants
    payer_fsp VARCHAR(128) NOT NULL,
    payee_fsp VARCHAR(128) NOT NULL,
    
    -- Amount
    amount DECIMAL(18, 4) NOT NULL,
    currency_id VARCHAR(3) NOT NULL DEFAULT 'NGN',
    amount_type VARCHAR(16) NOT NULL DEFAULT 'SEND',
    
    -- Fees
    payer_fee DECIMAL(18, 4) DEFAULT 0,
    payee_fee DECIMAL(18, 4) DEFAULT 0,
    
    -- Quote state
    quote_state VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
    
    -- ILC
    ilp_condition VARCHAR(256),
    ilp_packet TEXT,
    
    -- Expiry
    expiration_date TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Extension data
    extension_list JSONB DEFAULT '[]'
);

CREATE INDEX idx_quotes_transaction ON quotes(transaction_id);
CREATE INDEX idx_quotes_payer ON quotes(payer_fsp);
CREATE INDEX idx_quotes_payee ON quotes(payee_fsp);
CREATE INDEX idx_quotes_state ON quotes(quote_state);
CREATE INDEX idx_quotes_created ON quotes(created_date);

-- ============================================================================
-- TRANSACTION REQUESTS (Request-to-Pay)
-- ============================================================================
CREATE TABLE IF NOT EXISTS transaction_requests (
    transaction_request_id UUID PRIMARY KEY,
    
    -- Participants
    payer_fsp VARCHAR(128),
    payee_fsp VARCHAR(128) NOT NULL,
    
    -- Payer info
    payer_type VARCHAR(32),
    payer_identifier_type VARCHAR(32),
    payer_identifier_value VARCHAR(128),
    
    -- Payee info
    payee_type VARCHAR(32),
    payee_identifier_type VARCHAR(32),
    payee_identifier_value VARCHAR(128),
    
    -- Amount
    amount DECIMAL(18, 4) NOT NULL,
    currency_id VARCHAR(3) NOT NULL DEFAULT 'NGN',
    
    -- Transaction type
    scenario VARCHAR(32) NOT NULL DEFAULT 'PAYMENT',
    initiator VARCHAR(16) NOT NULL DEFAULT 'PAYEE',
    initiator_type VARCHAR(16) NOT NULL DEFAULT 'CONSUMER',
    
    -- State
    transaction_request_state VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
    
    -- Expiry
    expiration_date TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Extension data
    extension_list JSONB DEFAULT '[]'
);

CREATE INDEX idx_txn_requests_payer ON transaction_requests(payer_fsp);
CREATE INDEX idx_txn_requests_payee ON transaction_requests(payee_fsp);
CREATE INDEX idx_txn_requests_state ON transaction_requests(transaction_request_state);
CREATE INDEX idx_txn_requests_created ON transaction_requests(created_date);

-- ============================================================================
-- AUTHORIZATIONS (for OTP/PIN verification)
-- ============================================================================
CREATE TABLE IF NOT EXISTS authorizations (
    authorization_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_request_id UUID REFERENCES transaction_requests(transaction_request_id),
    transfer_id UUID REFERENCES transfers(transfer_id),
    
    -- Authorization type
    authorization_type VARCHAR(32) NOT NULL DEFAULT 'OTP',
    
    -- State
    authorization_state VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    -- States: PENDING, APPROVED, REJECTED, EXPIRED
    
    -- Response
    response_code VARCHAR(32),
    
    -- Timestamps
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    response_date TIMESTAMP WITH TIME ZONE,
    expiration_date TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_authorizations_txn_request ON authorizations(transaction_request_id);
CREATE INDEX idx_authorizations_transfer ON authorizations(transfer_id);
CREATE INDEX idx_authorizations_state ON authorizations(authorization_state);

-- ============================================================================
-- SETTLEMENT WINDOWS
-- ============================================================================
CREATE TABLE IF NOT EXISTS settlement_windows (
    settlement_window_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Window state
    state VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    -- States: OPEN, CLOSED, PENDING_SETTLEMENT, SETTLED, ABORTED
    
    -- Reason for state change
    reason TEXT,
    
    -- Timestamps
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    changed_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_settlement_windows_state ON settlement_windows(state);
CREATE INDEX idx_settlement_windows_created ON settlement_windows(created_date);

-- ============================================================================
-- SETTLEMENT WINDOW CONTENT (transfers in each window)
-- ============================================================================
CREATE TABLE IF NOT EXISTS settlement_window_content (
    content_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    settlement_window_id UUID NOT NULL REFERENCES settlement_windows(settlement_window_id),
    
    -- Participant
    participant_id UUID NOT NULL REFERENCES participants(participant_id),
    currency_id VARCHAR(3) NOT NULL DEFAULT 'NGN',
    
    -- Position change
    ledger_entry_type VARCHAR(16) NOT NULL,
    amount DECIMAL(18, 4) NOT NULL,
    
    -- Timestamps
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_settlement_content_window ON settlement_window_content(settlement_window_id);
CREATE INDEX idx_settlement_content_participant ON settlement_window_content(participant_id);

-- ============================================================================
-- SETTLEMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS settlements (
    settlement_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    settlement_window_id UUID NOT NULL REFERENCES settlement_windows(settlement_window_id),
    
    -- Settlement state
    state VARCHAR(32) NOT NULL DEFAULT 'PENDING_SETTLEMENT',
    
    -- Settlement model
    settlement_model_id VARCHAR(64),
    
    -- Timestamps
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    changed_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_settlements_window ON settlements(settlement_window_id);
CREATE INDEX idx_settlements_state ON settlements(state);

-- ============================================================================
-- SETTLEMENT PARTICIPANT ACCOUNTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS settlement_participant_accounts (
    account_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    settlement_id UUID NOT NULL REFERENCES settlements(settlement_id),
    participant_id UUID NOT NULL REFERENCES participants(participant_id),
    
    -- Account state
    state VARCHAR(32) NOT NULL DEFAULT 'PENDING_SETTLEMENT',
    
    -- Net settlement amount
    net_amount DECIMAL(18, 4) NOT NULL DEFAULT 0,
    currency_id VARCHAR(3) NOT NULL DEFAULT 'NGN',
    
    -- Timestamps
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    changed_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_settlement_accounts_settlement ON settlement_participant_accounts(settlement_id);
CREATE INDEX idx_settlement_accounts_participant ON settlement_participant_accounts(participant_id);

-- ============================================================================
-- PARTY LOOKUP (Account Lookup Service data)
-- ============================================================================
CREATE TABLE IF NOT EXISTS party_lookup (
    lookup_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Party identifier
    party_id_type VARCHAR(32) NOT NULL,
    party_id_value VARCHAR(128) NOT NULL,
    party_sub_id_or_type VARCHAR(128),
    
    -- FSP that owns this party
    fsp_id VARCHAR(128) NOT NULL,
    
    -- Currency
    currency_id VARCHAR(3),
    
    -- Party info
    party_name VARCHAR(256),
    party_info JSONB DEFAULT '{}',
    
    -- Timestamps
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    changed_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(party_id_type, party_id_value, party_sub_id_or_type, currency_id)
);

CREATE INDEX idx_party_lookup_type_value ON party_lookup(party_id_type, party_id_value);
CREATE INDEX idx_party_lookup_fsp ON party_lookup(fsp_id);

-- ============================================================================
-- CALLBACKS (for tracking callback delivery)
-- ============================================================================
CREATE TABLE IF NOT EXISTS callbacks (
    callback_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Reference
    reference_type VARCHAR(32) NOT NULL,
    reference_id UUID NOT NULL,
    
    -- Callback details
    callback_type VARCHAR(64) NOT NULL,
    callback_url TEXT NOT NULL,
    
    -- Payload
    request_body JSONB,
    response_body JSONB,
    
    -- Status
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    -- States: PENDING, SENT, DELIVERED, FAILED, RETRYING
    
    -- HTTP response
    http_status_code INTEGER,
    
    -- Retry tracking
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sent_date TIMESTAMP WITH TIME ZONE,
    
    -- Error details
    error_message TEXT
);

CREATE INDEX idx_callbacks_reference ON callbacks(reference_type, reference_id);
CREATE INDEX idx_callbacks_status ON callbacks(status);
CREATE INDEX idx_callbacks_retry ON callbacks(next_retry_at) WHERE status = 'RETRYING';

-- ============================================================================
-- AUDIT LOG
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    audit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Entity reference
    entity_type VARCHAR(64) NOT NULL,
    entity_id UUID NOT NULL,
    
    -- Action
    action VARCHAR(32) NOT NULL,
    
    -- Actor
    actor_type VARCHAR(32),
    actor_id VARCHAR(128),
    
    -- Changes
    old_value JSONB,
    new_value JSONB,
    
    -- Timestamp
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_date);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_type, actor_id);

-- ============================================================================
-- TIGERBEETLE RECONCILIATION (for ledger-of-record sync)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tigerbeetle_reconciliation (
    reconciliation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Reconciliation type
    reconciliation_type VARCHAR(32) NOT NULL,
    
    -- Mojaloop reference
    mojaloop_entity_type VARCHAR(32) NOT NULL,
    mojaloop_entity_id UUID NOT NULL,
    
    -- TigerBeetle reference
    tigerbeetle_account_id BIGINT,
    tigerbeetle_transfer_id BIGINT,
    
    -- Amounts
    mojaloop_amount DECIMAL(18, 4),
    tigerbeetle_amount DECIMAL(18, 4),
    
    -- Status
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    -- States: PENDING, MATCHED, DISCREPANCY, RESOLVED
    
    -- Discrepancy details
    discrepancy_amount DECIMAL(18, 4),
    discrepancy_reason TEXT,
    
    -- Timestamps
    created_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_date TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_tb_recon_mojaloop ON tigerbeetle_reconciliation(mojaloop_entity_type, mojaloop_entity_id);
CREATE INDEX idx_tb_recon_tigerbeetle ON tigerbeetle_reconciliation(tigerbeetle_transfer_id);
CREATE INDEX idx_tb_recon_status ON tigerbeetle_reconciliation(status);

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Active transfers summary
CREATE OR REPLACE VIEW v_active_transfers AS
SELECT 
    t.transfer_id,
    t.payer_fsp,
    t.payee_fsp,
    t.amount,
    t.currency_id,
    t.transfer_state,
    t.created_date,
    t.expiration_date,
    t.tigerbeetle_transfer_id
FROM transfers t
WHERE t.transfer_state IN ('RECEIVED', 'RESERVED')
  AND (t.expiration_date IS NULL OR t.expiration_date > NOW());

-- Settlement window summary
CREATE OR REPLACE VIEW v_settlement_summary AS
SELECT 
    sw.settlement_window_id,
    sw.state,
    sw.created_date,
    COUNT(DISTINCT swc.participant_id) as participant_count,
    SUM(CASE WHEN swc.ledger_entry_type = 'DEBIT' THEN swc.amount ELSE 0 END) as total_debits,
    SUM(CASE WHEN swc.ledger_entry_type = 'CREDIT' THEN swc.amount ELSE 0 END) as total_credits
FROM settlement_windows sw
LEFT JOIN settlement_window_content swc ON sw.settlement_window_id = swc.settlement_window_id
GROUP BY sw.settlement_window_id, sw.state, sw.created_date;

-- Participant position summary
CREATE OR REPLACE VIEW v_participant_positions AS
SELECT 
    p.name as participant_name,
    pp.currency_id,
    pp.value as position_value,
    pp.reserved_value,
    pp.net_debit_cap,
    (pp.net_debit_cap - pp.value - pp.reserved_value) as available_liquidity
FROM participants p
JOIN participant_positions pp ON p.participant_id = pp.participant_id
WHERE p.is_active = TRUE;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to update changed_date on update
CREATE OR REPLACE FUNCTION update_changed_date()
RETURNS TRIGGER AS $$
BEGIN
    NEW.changed_date = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to relevant tables
CREATE TRIGGER tr_participant_positions_changed
    BEFORE UPDATE ON participant_positions
    FOR EACH ROW EXECUTE FUNCTION update_changed_date();

CREATE TRIGGER tr_settlement_windows_changed
    BEFORE UPDATE ON settlement_windows
    FOR EACH ROW EXECUTE FUNCTION update_changed_date();

CREATE TRIGGER tr_settlements_changed
    BEFORE UPDATE ON settlements
    FOR EACH ROW EXECUTE FUNCTION update_changed_date();

CREATE TRIGGER tr_party_lookup_changed
    BEFORE UPDATE ON party_lookup
    FOR EACH ROW EXECUTE FUNCTION update_changed_date();

-- ============================================================================
-- INITIAL DATA
-- ============================================================================

-- Insert hub participant
INSERT INTO participants (name, description, participant_type, currency_id)
VALUES ('Hub', 'Mojaloop Hub', 'HUB', 'NGN')
ON CONFLICT (name) DO NOTHING;

-- Insert initial settlement window
INSERT INTO settlement_windows (state, reason)
VALUES ('OPEN', 'Initial settlement window')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE transfers IS 'FSPIOP transfer records. TigerBeetle is the ledger-of-record for actual balances.';
COMMENT ON TABLE participant_positions IS 'Scheme-level positions for settlement. NOT the ledger-of-record.';
COMMENT ON TABLE tigerbeetle_reconciliation IS 'Reconciliation between Mojaloop scheme data and TigerBeetle ledger.';
COMMENT ON COLUMN transfers.tigerbeetle_transfer_id IS 'Reference to TigerBeetle transfer for reconciliation.';
