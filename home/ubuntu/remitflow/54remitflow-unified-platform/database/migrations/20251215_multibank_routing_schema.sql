-- Multi-Bank Smart Routing Schema
-- Comprehensive schema for multi-bank payment routing, liquidity management, and reconciliation

-- =============================================================================
-- BANK DIRECTORY
-- =============================================================================

CREATE TABLE IF NOT EXISTS bank_directory (
    code VARCHAR(10) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    short_name VARCHAR(50) NOT NULL,
    nip_code VARCHAR(10),
    sort_code VARCHAR(20),
    swift_code VARCHAR(20),
    category VARCHAR(50) NOT NULL DEFAULT 'commercial',
    has_direct_api BOOLEAN NOT NULL DEFAULT false,
    has_on_us_transfer BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    avg_success_rate DECIMAL(5,4) NOT NULL DEFAULT 0.95,
    avg_latency_ms INTEGER NOT NULL DEFAULT 1000,
    daily_limit DECIMAL(18,2) NOT NULL DEFAULT 50000000,
    single_txn_limit DECIMAL(18,2) NOT NULL DEFAULT 10000000,
    cutoff_time TIME NOT NULL DEFAULT '22:00:00',
    weekend_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_directory_category ON bank_directory(category);
CREATE INDEX IF NOT EXISTS idx_bank_directory_active ON bank_directory(is_active);

-- =============================================================================
-- BANK ACCOUNTS (Our prefunded accounts at various banks)
-- =============================================================================

CREATE TABLE IF NOT EXISTS bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_code VARCHAR(10) NOT NULL REFERENCES bank_directory(code),
    bank_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(20) NOT NULL,
    account_name VARCHAR(255) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
    current_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
    available_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
    reserved_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
    minimum_balance DECIMAL(18,2) NOT NULL DEFAULT 100000,
    max_daily_outflow DECIMAL(18,2) NOT NULL DEFAULT 10000000,
    today_outflow DECIMAL(18,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    has_on_us_capability BOOLEAN NOT NULL DEFAULT false,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(bank_code, account_number)
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_bank ON bank_accounts(bank_code);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_active ON bank_accounts(is_active);

-- =============================================================================
-- TRANSFER REQUESTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS transfer_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id VARCHAR(255) UNIQUE NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
    source_agent_id VARCHAR(255),
    dest_account_number VARCHAR(20) NOT NULL,
    dest_bank_code VARCHAR(10) NOT NULL REFERENCES bank_directory(code),
    dest_account_name VARCHAR(255),
    narration TEXT,
    reference VARCHAR(255),
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    idempotency_key VARCHAR(255) UNIQUE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_requests_dest_bank ON transfer_requests(dest_bank_code);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_idempotency ON transfer_requests(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_created ON transfer_requests(created_at);

-- =============================================================================
-- ROUTING DECISIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS routing_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id VARCHAR(255) NOT NULL REFERENCES transfer_requests(transfer_id),
    selected_rail VARCHAR(20) NOT NULL,
    source_account_id UUID REFERENCES bank_accounts(id),
    dest_bank_code VARCHAR(10) NOT NULL,
    estimated_latency_ms INTEGER NOT NULL,
    estimated_cost DECIMAL(10,2) NOT NULL,
    success_probability DECIMAL(5,4) NOT NULL,
    score DECIMAL(10,6) NOT NULL,
    reason TEXT,
    fallback_rails JSONB DEFAULT '[]',
    required_reserve DECIMAL(18,2) NOT NULL,
    timeout_seconds INTEGER NOT NULL DEFAULT 30,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routing_decisions_transfer ON routing_decisions(transfer_id);
CREATE INDEX IF NOT EXISTS idx_routing_decisions_rail ON routing_decisions(selected_rail);
CREATE INDEX IF NOT EXISTS idx_routing_decisions_created ON routing_decisions(created_at);

-- =============================================================================
-- TRANSFER RESULTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS transfer_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id VARCHAR(255) NOT NULL REFERENCES transfer_requests(transfer_id),
    provider_reference VARCHAR(255),
    session_id VARCHAR(255),
    status VARCHAR(20) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
    source_account VARCHAR(20),
    dest_account VARCHAR(20),
    dest_bank_code VARCHAR(10),
    dest_account_name VARCHAR(255),
    response_code VARCHAR(10),
    response_message TEXT,
    transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settlement_date TIMESTAMPTZ,
    fee DECIMAL(10,2) NOT NULL DEFAULT 0,
    narration TEXT,
    processing_time_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_results_transfer ON transfer_results(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_results_status ON transfer_results(status);
CREATE INDEX IF NOT EXISTS idx_transfer_results_provider_ref ON transfer_results(provider_reference);
CREATE INDEX IF NOT EXISTS idx_transfer_results_session ON transfer_results(session_id);

-- =============================================================================
-- LIQUIDITY THRESHOLDS
-- =============================================================================

CREATE TABLE IF NOT EXISTS liquidity_thresholds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_code VARCHAR(10) NOT NULL REFERENCES bank_directory(code),
    critical_low DECIMAL(18,2) NOT NULL,
    low DECIMAL(18,2) NOT NULL,
    optimal DECIMAL(18,2) NOT NULL,
    high DECIMAL(18,2) NOT NULL,
    critical_high DECIMAL(18,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(bank_code)
);

-- =============================================================================
-- LIQUIDITY ALERTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS liquidity_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_code VARCHAR(10) NOT NULL REFERENCES bank_directory(code),
    bank_name VARCHAR(255) NOT NULL,
    alert_type VARCHAR(20) NOT NULL,
    current_balance DECIMAL(18,2) NOT NULL,
    threshold DECIMAL(18,2) NOT NULL,
    message TEXT NOT NULL,
    is_resolved BOOLEAN NOT NULL DEFAULT false,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liquidity_alerts_bank ON liquidity_alerts(bank_code);
CREATE INDEX IF NOT EXISTS idx_liquidity_alerts_type ON liquidity_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_liquidity_alerts_resolved ON liquidity_alerts(is_resolved);

-- =============================================================================
-- SWEEP INSTRUCTIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS sweep_instructions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_bank_code VARCHAR(10) NOT NULL REFERENCES bank_directory(code),
    source_account VARCHAR(20) NOT NULL,
    dest_bank_code VARCHAR(10) NOT NULL REFERENCES bank_directory(code),
    dest_account VARCHAR(20) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    transfer_ref VARCHAR(255),
    scheduled_at TIMESTAMPTZ NOT NULL,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sweep_instructions_status ON sweep_instructions(status);
CREATE INDEX IF NOT EXISTS idx_sweep_instructions_scheduled ON sweep_instructions(scheduled_at);

-- =============================================================================
-- BANK STATEMENTS (For reconciliation)
-- =============================================================================

CREATE TABLE IF NOT EXISTS bank_statements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_code VARCHAR(10) NOT NULL REFERENCES bank_directory(code),
    account_number VARCHAR(20) NOT NULL,
    transaction_date TIMESTAMPTZ NOT NULL,
    value_date TIMESTAMPTZ,
    reference VARCHAR(255),
    narration TEXT,
    debit_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
    credit_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
    balance DECIMAL(18,2),
    transaction_type VARCHAR(10),
    channel VARCHAR(50),
    counterparty_account VARCHAR(20),
    counterparty_bank VARCHAR(10),
    counterparty_name VARCHAR(255),
    is_matched BOOLEAN NOT NULL DEFAULT false,
    matched_with UUID,
    match_confidence DECIMAL(5,4),
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_statements_bank ON bank_statements(bank_code, account_number);
CREATE INDEX IF NOT EXISTS idx_bank_statements_date ON bank_statements(transaction_date);
CREATE INDEX IF NOT EXISTS idx_bank_statements_reference ON bank_statements(reference);
CREATE INDEX IF NOT EXISTS idx_bank_statements_matched ON bank_statements(is_matched);

-- =============================================================================
-- INTERNAL TRANSACTIONS (For reconciliation)
-- =============================================================================

CREATE TABLE IF NOT EXISTS internal_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id VARCHAR(255) NOT NULL,
    bank_code VARCHAR(10) NOT NULL REFERENCES bank_directory(code),
    account_number VARCHAR(20) NOT NULL,
    transaction_date TIMESTAMPTZ NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
    transaction_type VARCHAR(10) NOT NULL,
    reference VARCHAR(255),
    provider_reference VARCHAR(255),
    session_id VARCHAR(255),
    narration TEXT,
    counterparty_account VARCHAR(20),
    counterparty_bank VARCHAR(10),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    is_reconciled BOOLEAN NOT NULL DEFAULT false,
    reconciled_with UUID,
    reconciled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_internal_transactions_bank ON internal_transactions(bank_code, account_number);
CREATE INDEX IF NOT EXISTS idx_internal_transactions_date ON internal_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_internal_transactions_reference ON internal_transactions(reference);
CREATE INDEX IF NOT EXISTS idx_internal_transactions_reconciled ON internal_transactions(is_reconciled);

-- =============================================================================
-- RECONCILIATION RESULTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS reconciliation_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_code VARCHAR(10) NOT NULL REFERENCES bank_directory(code),
    account_number VARCHAR(20) NOT NULL,
    reconciliation_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    opening_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
    closing_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
    total_debits DECIMAL(18,2) NOT NULL DEFAULT 0,
    total_credits DECIMAL(18,2) NOT NULL DEFAULT 0,
    matched_count INTEGER NOT NULL DEFAULT 0,
    unmatched_bank_count INTEGER NOT NULL DEFAULT 0,
    unmatched_internal_count INTEGER NOT NULL DEFAULT 0,
    discrepancy_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_results_bank ON reconciliation_results(bank_code, account_number);
CREATE INDEX IF NOT EXISTS idx_reconciliation_results_date ON reconciliation_results(reconciliation_date);
CREATE INDEX IF NOT EXISTS idx_reconciliation_results_status ON reconciliation_results(status);

-- =============================================================================
-- RECONCILIATION EXCEPTIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reconciliation_id UUID NOT NULL REFERENCES reconciliation_results(id),
    exception_type VARCHAR(50) NOT NULL,
    bank_statement_id UUID,
    internal_txn_id UUID,
    bank_amount DECIMAL(18,2),
    internal_amount DECIMAL(18,2),
    difference DECIMAL(18,2),
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    resolved_by VARCHAR(255),
    resolved_at TIMESTAMPTZ,
    resolution TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_exceptions_recon ON reconciliation_exceptions(reconciliation_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_exceptions_type ON reconciliation_exceptions(exception_type);
CREATE INDEX IF NOT EXISTS idx_reconciliation_exceptions_status ON reconciliation_exceptions(status);

-- =============================================================================
-- CONNECTOR HEALTH
-- =============================================================================

CREATE TABLE IF NOT EXISTS connector_health (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_name VARCHAR(100) NOT NULL,
    bank_code VARCHAR(10),
    rail VARCHAR(20) NOT NULL,
    is_healthy BOOLEAN NOT NULL DEFAULT true,
    circuit_state VARCHAR(20) NOT NULL DEFAULT 'closed',
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_failure_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    avg_latency_ms INTEGER,
    success_rate DECIMAL(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(connector_name)
);

CREATE INDEX IF NOT EXISTS idx_connector_health_bank ON connector_health(bank_code);
CREATE INDEX IF NOT EXISTS idx_connector_health_healthy ON connector_health(is_healthy);

-- =============================================================================
-- ROUTING METRICS (For ML-based optimization)
-- =============================================================================

CREATE TABLE IF NOT EXISTS routing_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id VARCHAR(255) NOT NULL,
    bank_code VARCHAR(10) NOT NULL,
    rail VARCHAR(20) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    was_successful BOOLEAN NOT NULL,
    actual_latency_ms INTEGER,
    actual_cost DECIMAL(10,2),
    predicted_success_rate DECIMAL(5,4),
    predicted_latency_ms INTEGER,
    predicted_cost DECIMAL(10,2),
    hour_of_day INTEGER,
    day_of_week INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routing_metrics_bank ON routing_metrics(bank_code);
CREATE INDEX IF NOT EXISTS idx_routing_metrics_rail ON routing_metrics(rail);
CREATE INDEX IF NOT EXISTS idx_routing_metrics_created ON routing_metrics(created_at);
CREATE INDEX IF NOT EXISTS idx_routing_metrics_success ON routing_metrics(was_successful);

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_bank_directory_updated_at
    BEFORE UPDATE ON bank_directory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_bank_accounts_updated_at
    BEFORE UPDATE ON bank_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_liquidity_thresholds_updated_at
    BEFORE UPDATE ON liquidity_thresholds
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_connector_health_updated_at
    BEFORE UPDATE ON connector_health
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Reset daily outflows at midnight
CREATE OR REPLACE FUNCTION reset_daily_outflows()
RETURNS void AS $$
BEGIN
    UPDATE bank_accounts SET today_outflow = 0, updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- SEED DATA: Nigerian Banks
-- =============================================================================

INSERT INTO bank_directory (code, name, short_name, nip_code, sort_code, swift_code, category, has_direct_api, has_on_us_transfer, avg_success_rate, avg_latency_ms, daily_limit, single_txn_limit, cutoff_time, weekend_enabled)
VALUES
    ('058', 'Guaranty Trust Bank', 'GTB', '058', '058152000', 'GTBINGLA', 'commercial', true, true, 0.98, 500, 50000000, 10000000, '23:00', true),
    ('044', 'Access Bank', 'ACCESS', '044', '044150000', 'ABORNGLA', 'commercial', true, true, 0.97, 600, 50000000, 10000000, '23:00', true),
    ('057', 'Zenith Bank', 'ZENITH', '057', '057150000', 'ZEABORNGLA', 'commercial', true, true, 0.98, 450, 50000000, 10000000, '23:00', true),
    ('033', 'United Bank for Africa', 'UBA', '033', '033150000', 'UNABORNGLA', 'commercial', true, true, 0.96, 700, 50000000, 10000000, '22:00', true),
    ('011', 'First Bank of Nigeria', 'FIRSTBANK', '011', '011150000', 'FBABORNGLA', 'commercial', true, true, 0.95, 800, 50000000, 10000000, '22:00', true),
    ('032', 'Union Bank of Nigeria', 'UNION', '032', '032150000', 'UBNINGLA', 'commercial', true, true, 0.94, 900, 30000000, 5000000, '21:00', true),
    ('035', 'Wema Bank', 'WEMA', '035', '035150000', 'WABORNGLA', 'commercial', true, true, 0.93, 850, 20000000, 5000000, '21:00', true),
    ('050', 'Ecobank Nigeria', 'ECOBANK', '050', '050150000', 'EABORNGLA', 'commercial', true, true, 0.94, 750, 30000000, 5000000, '22:00', true),
    ('076', 'Polaris Bank', 'POLARIS', '076', '076150000', 'PABORNGLA', 'commercial', true, true, 0.92, 950, 20000000, 5000000, '21:00', true),
    ('221', 'Stanbic IBTC Bank', 'STANBIC', '221', '221150000', 'SBICNGLA', 'commercial', true, true, 0.96, 600, 40000000, 10000000, '22:00', true),
    ('214', 'First City Monument Bank', 'FCMB', '214', '214150000', 'FCMBORNGLA', 'commercial', true, true, 0.95, 700, 30000000, 5000000, '22:00', true),
    ('070', 'Fidelity Bank', 'FIDELITY', '070', '070150000', 'FIDTNGLA', 'commercial', true, true, 0.95, 650, 30000000, 5000000, '22:00', true),
    ('068', 'Sterling Bank', 'STERLING', '068', '068150000', 'NAMENGLA', 'commercial', true, true, 0.94, 750, 25000000, 5000000, '22:00', true),
    ('304', 'Providus Bank', 'PROVIDUS', '304', '304150000', 'PRVDNGLA', 'commercial', true, true, 0.94, 650, 20000000, 5000000, '22:00', true),
    ('039', 'Keystone Bank', 'KEYSTONE', '039', '039150000', '', 'commercial', false, false, 0.91, 1000, 20000000, 5000000, '21:00', true),
    ('023', 'Citibank Nigeria', 'CITI', '023', '023150000', 'CITINGLA', 'commercial', false, false, 0.97, 500, 100000000, 50000000, '22:00', false),
    ('082', 'Standard Chartered Bank', 'STANCHART', '082', '082150000', 'SCBLNGLA', 'commercial', false, false, 0.97, 550, 100000000, 50000000, '22:00', false),
    ('215', 'Unity Bank', 'UNITY', '215', '215150000', '', 'commercial', false, false, 0.90, 1100, 15000000, 3000000, '20:00', true),
    ('301', 'Jaiz Bank', 'JAIZ', '301', '301150000', '', 'commercial', false, false, 0.92, 900, 10000000, 2000000, '20:00', false),
    ('100', 'Kuda Microfinance Bank', 'KUDA', '100', '100150000', '', 'microfinance', true, true, 0.96, 400, 5000000, 1000000, '23:59', true),
    ('999', 'OPay Digital Services', 'OPAY', '999', '999150000', '', 'mobile_money', true, true, 0.97, 350, 5000000, 1000000, '23:59', true),
    ('998', 'PalmPay', 'PALMPAY', '998', '998150000', '', 'mobile_money', true, true, 0.96, 400, 5000000, 1000000, '23:59', true),
    ('997', 'Moniepoint Microfinance Bank', 'MONIEPOINT', '997', '997150000', '', 'microfinance', true, true, 0.97, 380, 5000000, 1000000, '23:59', true)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    has_direct_api = EXCLUDED.has_direct_api,
    has_on_us_transfer = EXCLUDED.has_on_us_transfer,
    avg_success_rate = EXCLUDED.avg_success_rate,
    avg_latency_ms = EXCLUDED.avg_latency_ms,
    updated_at = NOW();

-- Comments for documentation
COMMENT ON TABLE bank_directory IS 'Directory of all Nigerian banks with routing metadata';
COMMENT ON TABLE bank_accounts IS 'Our prefunded accounts at various banks for multi-bank routing';
COMMENT ON TABLE transfer_requests IS 'Incoming transfer requests to be routed';
COMMENT ON TABLE routing_decisions IS 'Smart routing decisions with scoring and fallback options';
COMMENT ON TABLE transfer_results IS 'Results of executed transfers';
COMMENT ON TABLE liquidity_thresholds IS 'Liquidity thresholds for each bank account';
COMMENT ON TABLE liquidity_alerts IS 'Liquidity alerts when thresholds are breached';
COMMENT ON TABLE sweep_instructions IS 'Instructions for liquidity rebalancing between accounts';
COMMENT ON TABLE bank_statements IS 'Imported bank statements for reconciliation';
COMMENT ON TABLE internal_transactions IS 'Internal transaction records for reconciliation';
COMMENT ON TABLE reconciliation_results IS 'Results of reconciliation runs';
COMMENT ON TABLE reconciliation_exceptions IS 'Exceptions found during reconciliation';
COMMENT ON TABLE connector_health IS 'Health status of bank connectors';
COMMENT ON TABLE routing_metrics IS 'Metrics for ML-based routing optimization';
