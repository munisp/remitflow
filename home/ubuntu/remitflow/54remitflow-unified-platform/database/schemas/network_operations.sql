-- =====================================================
-- NETWORK OPERATIONS AND SETTLEMENT DATABASE SCHEMA
-- Comprehensive schema for transaction processing, settlement,
-- commission management, and cash flow optimization
-- Zero placeholders, zero mocks - production ready
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- =====================================================
-- TRANSACTION PROCESSING TABLES
-- =====================================================

-- Transaction types enumeration
CREATE TYPE transaction_type_enum AS ENUM (
    'cash_in',
    'cash_out', 
    'deposit',
    'withdrawal',
    'transfer',
    'bill_payment',
    'airtime_purchase',
    'data_purchase',
    'merchant_payment',
    'agent_float_request',
    'agent_float_transfer',
    'commission_payment',
    'fee_collection',
    'reversal',
    'adjustment'
);

-- Transaction status enumeration
CREATE TYPE transaction_status_enum AS ENUM (
    'initiated',
    'pending',
    'processing',
    'completed',
    'failed',
    'cancelled',
    'reversed',
    'expired',
    'on_hold',
    'under_review'
);

-- Transaction priority enumeration
CREATE TYPE transaction_priority_enum AS ENUM (
    'low',
    'normal',
    'high',
    'urgent',
    'critical'
);

-- Main transactions table
CREATE TABLE network_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_reference VARCHAR(50) UNIQUE NOT NULL,
    external_reference VARCHAR(100),
    parent_transaction_id UUID REFERENCES network_transactions(id),
    
    -- Transaction details
    transaction_type transaction_type_enum NOT NULL,
    transaction_status transaction_status_enum NOT NULL DEFAULT 'initiated',
    priority transaction_priority_enum NOT NULL DEFAULT 'normal',
    
    -- Parties involved
    originator_agent_id UUID NOT NULL,
    originator_customer_id UUID,
    beneficiary_agent_id UUID,
    beneficiary_customer_id UUID,
    
    -- Financial details
    transaction_amount DECIMAL(15,2) NOT NULL CHECK (transaction_amount > 0),
    transaction_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    fee_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    commission_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(15,2) NOT NULL,
    
    -- Exchange rate information (for multi-currency)
    exchange_rate DECIMAL(10,6),
    base_currency VARCHAR(3),
    converted_amount DECIMAL(15,2),
    
    -- Transaction context
    channel VARCHAR(30) NOT NULL DEFAULT 'agent_app',
    device_id VARCHAR(255),
    device_fingerprint TEXT,
    ip_address INET,
    geolocation GEOGRAPHY(POINT, 4326),
    
    -- Processing information
    processing_node VARCHAR(100),
    processing_time_ms INTEGER,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    
    -- Fraud and risk
    fraud_score DECIMAL(5,2) DEFAULT 0.00,
    risk_level VARCHAR(20) DEFAULT 'low',
    fraud_flags TEXT[],
    
    -- Settlement information
    settlement_batch_id UUID,
    settlement_date DATE,
    settlement_status VARCHAR(30) DEFAULT 'pending',
    
    -- Timestamps
    initiated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Constraints
    CONSTRAINT valid_total_amount CHECK (total_amount = transaction_amount + fee_amount + tax_amount),
    CONSTRAINT valid_parties CHECK (
        (originator_agent_id IS NOT NULL) OR 
        (beneficiary_agent_id IS NOT NULL)
    )
);

-- Transaction state history for audit trail
CREATE TABLE transaction_state_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES network_transactions(id),
    previous_status transaction_status_enum,
    new_status transaction_status_enum NOT NULL,
    reason VARCHAR(255),
    error_code VARCHAR(50),
    error_message TEXT,
    changed_by UUID,
    changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
);

-- Transaction fees configuration
CREATE TABLE transaction_fee_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name VARCHAR(100) NOT NULL,
    transaction_type transaction_type_enum NOT NULL,
    agent_tier VARCHAR(20),
    customer_tier VARCHAR(20),
    
    -- Amount ranges
    min_amount DECIMAL(15,2) DEFAULT 0.00,
    max_amount DECIMAL(15,2),
    
    -- Fee structure
    fixed_fee DECIMAL(15,2) DEFAULT 0.00,
    percentage_fee DECIMAL(5,4) DEFAULT 0.0000,
    minimum_fee DECIMAL(15,2) DEFAULT 0.00,
    maximum_fee DECIMAL(15,2),
    
    -- Geographic and temporal constraints
    applicable_countries TEXT[],
    applicable_regions TEXT[],
    effective_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    effective_to TIMESTAMP WITH TIME ZONE,
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- =====================================================
-- SETTLEMENT SYSTEM TABLES
-- =====================================================

-- Settlement batch status enumeration
CREATE TYPE settlement_batch_status_enum AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed',
    'cancelled',
    'partially_completed'
);

-- Settlement batches
CREATE TABLE settlement_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_reference VARCHAR(50) UNIQUE NOT NULL,
    batch_type VARCHAR(30) NOT NULL, -- 'daily', 'weekly', 'monthly', 'on_demand'
    
    -- Batch details
    settlement_date DATE NOT NULL,
    cut_off_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status settlement_batch_status_enum NOT NULL DEFAULT 'pending',
    
    -- Financial summary
    total_transactions INTEGER NOT NULL DEFAULT 0,
    total_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    total_fees DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    total_commissions DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    net_settlement_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    
    -- Processing information
    processing_started_at TIMESTAMP WITH TIME ZONE,
    processing_completed_at TIMESTAMP WITH TIME ZONE,
    processing_duration_seconds INTEGER,
    
    -- Bank integration
    bank_batch_reference VARCHAR(100),
    bank_confirmation_reference VARCHAR(100),
    bank_status VARCHAR(30),
    bank_response_code VARCHAR(10),
    bank_response_message TEXT,
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Settlement entries (individual agent settlements within a batch)
CREATE TABLE settlement_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    settlement_batch_id UUID NOT NULL REFERENCES settlement_batches(id),
    agent_id UUID NOT NULL,
    
    -- Settlement details
    entry_reference VARCHAR(50) NOT NULL,
    settlement_type VARCHAR(30) NOT NULL, -- 'net_settlement', 'commission_payment', 'fee_collection'
    
    -- Financial details
    transaction_count INTEGER NOT NULL DEFAULT 0,
    gross_transaction_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    total_fees_collected DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    total_commissions_earned DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    net_settlement_amount DECIMAL(15,2) NOT NULL,
    
    -- Agent account information
    agent_account_number VARCHAR(50),
    partner_bank_code VARCHAR(20),
    partner_bank_name VARCHAR(100),
    
    -- Processing status
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    processed_at TIMESTAMP WITH TIME ZONE,
    
    -- Bank integration
    bank_transaction_reference VARCHAR(100),
    bank_status VARCHAR(30),
    bank_response_code VARCHAR(10),
    bank_response_message TEXT,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Constraints
    UNIQUE(settlement_batch_id, agent_id, settlement_type)
);

-- Settlement reconciliation
CREATE TABLE settlement_reconciliation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    settlement_batch_id UUID NOT NULL REFERENCES settlement_batches(id),
    
    -- Reconciliation details
    reconciliation_date DATE NOT NULL,
    reconciliation_type VARCHAR(30) NOT NULL, -- 'automatic', 'manual', 'exception'
    
    -- Financial reconciliation
    expected_amount DECIMAL(15,2) NOT NULL,
    actual_amount DECIMAL(15,2) NOT NULL,
    variance_amount DECIMAL(15,2) NOT NULL,
    variance_percentage DECIMAL(5,4) NOT NULL,
    
    -- Status
    reconciliation_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    is_reconciled BOOLEAN NOT NULL DEFAULT false,
    
    -- Exception handling
    exception_count INTEGER DEFAULT 0,
    exception_details JSONB DEFAULT '{}',
    
    -- Resolution
    resolution_notes TEXT,
    resolved_by UUID,
    resolved_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- =====================================================
-- COMMISSION MANAGEMENT TABLES
-- =====================================================

-- Commission types enumeration
CREATE TYPE commission_type_enum AS ENUM (
    'transaction_commission',
    'volume_bonus',
    'performance_bonus',
    'recruitment_bonus',
    'retention_bonus',
    'special_promotion'
);

-- Commission calculation methods
CREATE TYPE commission_calculation_method_enum AS ENUM (
    'fixed_amount',
    'percentage',
    'tiered_percentage',
    'volume_based',
    'performance_based'
);

-- Commission rules
CREATE TABLE commission_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name VARCHAR(100) NOT NULL,
    rule_code VARCHAR(50) UNIQUE NOT NULL,
    
    -- Rule scope
    commission_type commission_type_enum NOT NULL,
    transaction_type transaction_type_enum,
    agent_tier VARCHAR(20),
    customer_tier VARCHAR(20),
    
    -- Calculation method
    calculation_method commission_calculation_method_enum NOT NULL,
    
    -- Fixed amount commission
    fixed_amount DECIMAL(15,2),
    
    -- Percentage commission
    percentage_rate DECIMAL(5,4),
    minimum_commission DECIMAL(15,2),
    maximum_commission DECIMAL(15,2),
    
    -- Tiered commission structure
    tier_structure JSONB, -- Array of {min_amount, max_amount, rate} objects
    
    -- Volume-based commission
    volume_thresholds JSONB, -- Array of {min_volume, max_volume, rate} objects
    
    -- Performance-based commission
    performance_metrics JSONB, -- Performance criteria and rates
    
    -- Temporal constraints
    effective_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    effective_to TIMESTAMP WITH TIME ZONE,
    
    -- Geographic constraints
    applicable_countries TEXT[],
    applicable_regions TEXT[],
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Commission calculations (individual commission records)
CREATE TABLE commission_calculations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID REFERENCES network_transactions(id),
    agent_id UUID NOT NULL,
    commission_rule_id UUID NOT NULL REFERENCES commission_rules(id),
    
    -- Calculation details
    calculation_reference VARCHAR(50) UNIQUE NOT NULL,
    commission_type commission_type_enum NOT NULL,
    calculation_method commission_calculation_method_enum NOT NULL,
    
    -- Financial details
    base_amount DECIMAL(15,2) NOT NULL,
    commission_rate DECIMAL(5,4),
    calculated_commission DECIMAL(15,2) NOT NULL,
    final_commission DECIMAL(15,2) NOT NULL,
    
    -- Adjustments
    adjustment_amount DECIMAL(15,2) DEFAULT 0.00,
    adjustment_reason VARCHAR(255),
    
    -- Status
    status VARCHAR(30) NOT NULL DEFAULT 'calculated',
    
    -- Payment information
    payment_batch_id UUID,
    paid_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    calculated_by UUID,
    calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Commission payment batches
CREATE TABLE commission_payment_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_reference VARCHAR(50) UNIQUE NOT NULL,
    
    -- Batch details
    payment_period_start DATE NOT NULL,
    payment_period_end DATE NOT NULL,
    payment_date DATE NOT NULL,
    
    -- Financial summary
    total_agents INTEGER NOT NULL DEFAULT 0,
    total_commissions DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    total_adjustments DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    net_payment_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    
    -- Processing status
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    processing_started_at TIMESTAMP WITH TIME ZONE,
    processing_completed_at TIMESTAMP WITH TIME ZONE,
    
    -- Bank integration
    bank_batch_reference VARCHAR(100),
    bank_status VARCHAR(30),
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Commission payment entries
CREATE TABLE commission_payment_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_batch_id UUID NOT NULL REFERENCES commission_payment_batches(id),
    agent_id UUID NOT NULL,
    
    -- Payment details
    entry_reference VARCHAR(50) NOT NULL,
    commission_count INTEGER NOT NULL DEFAULT 0,
    gross_commission_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    adjustment_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    net_payment_amount DECIMAL(15,2) NOT NULL,
    
    -- Agent payment information
    agent_account_number VARCHAR(50),
    partner_bank_code VARCHAR(20),
    partner_bank_name VARCHAR(100),
    
    -- Processing status
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    processed_at TIMESTAMP WITH TIME ZONE,
    
    -- Bank integration
    bank_transaction_reference VARCHAR(100),
    bank_status VARCHAR(30),
    bank_response_code VARCHAR(10),
    bank_response_message TEXT,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Constraints
    UNIQUE(payment_batch_id, agent_id)
);

-- =====================================================
-- CASH FLOW OPTIMIZATION TABLES
-- =====================================================

-- Cash position tracking
CREATE TABLE agent_cash_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    
    -- Cash balances
    opening_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    current_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    available_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    reserved_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    
    -- Limits
    minimum_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    maximum_balance DECIMAL(15,2),
    daily_transaction_limit DECIMAL(15,2),
    monthly_transaction_limit DECIMAL(15,2),
    
    -- Float management
    float_request_threshold DECIMAL(15,2),
    auto_float_enabled BOOLEAN NOT NULL DEFAULT false,
    preferred_float_amount DECIMAL(15,2),
    
    -- Last update
    last_transaction_id UUID,
    last_updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(agent_id, currency),
    CONSTRAINT valid_balances CHECK (
        current_balance = available_balance + reserved_balance AND
        available_balance >= 0 AND
        reserved_balance >= 0
    )
);

-- Cash movement tracking
CREATE TABLE cash_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,
    transaction_id UUID REFERENCES network_transactions(id),
    
    -- Movement details
    movement_reference VARCHAR(50) UNIQUE NOT NULL,
    movement_type VARCHAR(30) NOT NULL, -- 'debit', 'credit', 'reserve', 'release'
    movement_category VARCHAR(50) NOT NULL, -- 'transaction', 'float', 'commission', 'fee', 'adjustment'
    
    -- Financial details
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    
    -- Balance impact
    balance_before DECIMAL(15,2) NOT NULL,
    balance_after DECIMAL(15,2) NOT NULL,
    
    -- Description and reference
    description TEXT,
    external_reference VARCHAR(100),
    
    -- Timestamps
    movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Float requests and transfers
CREATE TABLE float_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_reference VARCHAR(50) UNIQUE NOT NULL,
    
    -- Request details
    requesting_agent_id UUID NOT NULL,
    source_agent_id UUID, -- For agent-to-agent transfers
    requested_amount DECIMAL(15,2) NOT NULL CHECK (requested_amount > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    
    -- Request type and priority
    request_type VARCHAR(30) NOT NULL, -- 'manual', 'automatic', 'emergency'
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    
    -- Status tracking
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    
    -- Approval workflow
    requires_approval BOOLEAN NOT NULL DEFAULT true,
    approved_by UUID,
    approved_at TIMESTAMP WITH TIME ZONE,
    approval_notes TEXT,
    
    -- Processing
    processed_by UUID,
    processed_at TIMESTAMP WITH TIME ZONE,
    processing_notes TEXT,
    
    -- Financial details
    approved_amount DECIMAL(15,2),
    transfer_fee DECIMAL(15,2) DEFAULT 0.00,
    
    -- Bank integration
    bank_transaction_reference VARCHAR(100),
    bank_status VARCHAR(30),
    
    -- Timestamps
    requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    required_by TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- =====================================================
-- NETWORK MONITORING TABLES
-- =====================================================

-- Network performance metrics
CREATE TABLE network_performance_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Metric details
    metric_name VARCHAR(100) NOT NULL,
    metric_category VARCHAR(50) NOT NULL, -- 'transaction', 'settlement', 'commission', 'cash_flow'
    metric_type VARCHAR(30) NOT NULL, -- 'counter', 'gauge', 'histogram', 'summary'
    
    -- Metric value
    metric_value DECIMAL(15,4) NOT NULL,
    metric_unit VARCHAR(20),
    
    -- Dimensions
    agent_id UUID,
    agent_tier VARCHAR(20),
    transaction_type transaction_type_enum,
    currency VARCHAR(3),
    region VARCHAR(100),
    country VARCHAR(100),
    
    -- Time dimensions
    measurement_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    measurement_date DATE NOT NULL DEFAULT CURRENT_DATE,
    measurement_hour INTEGER NOT NULL DEFAULT EXTRACT(HOUR FROM CURRENT_TIMESTAMP),
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Network alerts and notifications
CREATE TABLE network_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Alert details
    alert_type VARCHAR(50) NOT NULL,
    alert_severity VARCHAR(20) NOT NULL, -- 'info', 'warning', 'error', 'critical'
    alert_title VARCHAR(255) NOT NULL,
    alert_message TEXT NOT NULL,
    
    -- Alert context
    entity_type VARCHAR(50), -- 'agent', 'transaction', 'settlement', 'system'
    entity_id UUID,
    
    -- Alert conditions
    threshold_value DECIMAL(15,4),
    actual_value DECIMAL(15,4),
    condition_met VARCHAR(100),
    
    -- Status tracking
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    acknowledged_by UUID,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    
    -- Notification tracking
    notification_sent BOOLEAN NOT NULL DEFAULT false,
    notification_channels TEXT[], -- 'email', 'sms', 'push', 'webhook'
    notification_sent_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    triggered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- System health monitoring
CREATE TABLE system_health_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Health check details
    service_name VARCHAR(100) NOT NULL,
    service_type VARCHAR(50) NOT NULL, -- 'api', 'database', 'cache', 'queue', 'external'
    endpoint_url VARCHAR(500),
    
    -- Health status
    status VARCHAR(20) NOT NULL, -- 'healthy', 'degraded', 'unhealthy', 'unknown'
    response_time_ms INTEGER,
    
    -- Check details
    check_type VARCHAR(30) NOT NULL, -- 'ping', 'http', 'database', 'custom'
    check_result JSONB,
    error_message TEXT,
    
    -- Timestamps
    checked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- =====================================================
-- INDEXES FOR PERFORMANCE OPTIMIZATION
-- =====================================================

-- Transaction indexes
CREATE INDEX idx_network_transactions_reference ON network_transactions(transaction_reference);
CREATE INDEX idx_network_transactions_status ON network_transactions(transaction_status);
CREATE INDEX idx_network_transactions_type ON network_transactions(transaction_type);
CREATE INDEX idx_network_transactions_agent ON network_transactions(originator_agent_id);
CREATE INDEX idx_network_transactions_date ON network_transactions(initiated_at);
CREATE INDEX idx_network_transactions_settlement ON network_transactions(settlement_batch_id);
CREATE INDEX idx_network_transactions_amount ON network_transactions(transaction_amount);
CREATE INDEX idx_network_transactions_geolocation ON network_transactions USING GIST(geolocation);

-- Settlement indexes
CREATE INDEX idx_settlement_batches_date ON settlement_batches(settlement_date);
CREATE INDEX idx_settlement_batches_status ON settlement_batches(status);
CREATE INDEX idx_settlement_entries_agent ON settlement_entries(agent_id);
CREATE INDEX idx_settlement_entries_batch ON settlement_entries(settlement_batch_id);

-- Commission indexes
CREATE INDEX idx_commission_calculations_agent ON commission_calculations(agent_id);
CREATE INDEX idx_commission_calculations_transaction ON commission_calculations(transaction_id);
CREATE INDEX idx_commission_calculations_date ON commission_calculations(calculated_at);
CREATE INDEX idx_commission_payment_entries_agent ON commission_payment_entries(agent_id);

-- Cash flow indexes
CREATE INDEX idx_agent_cash_positions_agent ON agent_cash_positions(agent_id);
CREATE INDEX idx_cash_movements_agent ON cash_movements(agent_id);
CREATE INDEX idx_cash_movements_date ON cash_movements(movement_date);
CREATE INDEX idx_float_requests_agent ON float_requests(requesting_agent_id);
CREATE INDEX idx_float_requests_status ON float_requests(status);

-- Monitoring indexes
CREATE INDEX idx_network_performance_metrics_name ON network_performance_metrics(metric_name);
CREATE INDEX idx_network_performance_metrics_timestamp ON network_performance_metrics(measurement_timestamp);
CREATE INDEX idx_network_alerts_type ON network_alerts(alert_type);
CREATE INDEX idx_network_alerts_severity ON network_alerts(alert_severity);
CREATE INDEX idx_network_alerts_status ON network_alerts(status);
CREATE INDEX idx_system_health_checks_service ON system_health_checks(service_name);
CREATE INDEX idx_system_health_checks_timestamp ON system_health_checks(checked_at);

-- Composite indexes for common queries
CREATE INDEX idx_transactions_agent_date ON network_transactions(originator_agent_id, initiated_at);
CREATE INDEX idx_transactions_status_date ON network_transactions(transaction_status, initiated_at);
CREATE INDEX idx_transactions_type_amount ON network_transactions(transaction_type, transaction_amount);
CREATE INDEX idx_commission_agent_date ON commission_calculations(agent_id, calculated_at);
CREATE INDEX idx_cash_movements_agent_date ON cash_movements(agent_id, movement_date);

-- =====================================================
-- TRIGGERS FOR AUTOMATED UPDATES
-- =====================================================

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update triggers to relevant tables
CREATE TRIGGER update_network_transactions_updated_at 
    BEFORE UPDATE ON network_transactions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settlement_batches_updated_at 
    BEFORE UPDATE ON settlement_batches 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settlement_entries_updated_at 
    BEFORE UPDATE ON settlement_entries 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_commission_rules_updated_at 
    BEFORE UPDATE ON commission_rules 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_commission_calculations_updated_at 
    BEFORE UPDATE ON commission_calculations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agent_cash_positions_updated_at 
    BEFORE UPDATE ON agent_cash_positions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_float_requests_updated_at 
    BEFORE UPDATE ON float_requests 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update cash positions after cash movements
CREATE OR REPLACE FUNCTION update_cash_position_after_movement()
RETURNS TRIGGER AS $$
BEGIN
    -- Update the agent's cash position
    UPDATE agent_cash_positions 
    SET 
        current_balance = NEW.balance_after,
        available_balance = CASE 
            WHEN NEW.movement_type = 'reserve' THEN available_balance - NEW.amount
            WHEN NEW.movement_type = 'release' THEN available_balance + NEW.amount
            ELSE NEW.balance_after
        END,
        reserved_balance = CASE 
            WHEN NEW.movement_type = 'reserve' THEN reserved_balance + NEW.amount
            WHEN NEW.movement_type = 'release' THEN reserved_balance - NEW.amount
            ELSE reserved_balance
        END,
        last_transaction_id = NEW.transaction_id,
        last_updated_at = CURRENT_TIMESTAMP
    WHERE agent_id = NEW.agent_id 
    AND currency = NEW.currency;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply cash position update trigger
CREATE TRIGGER update_cash_position_after_movement_trigger
    AFTER INSERT ON cash_movements
    FOR EACH ROW EXECUTE FUNCTION update_cash_position_after_movement();

-- Function to create transaction state history
CREATE OR REPLACE FUNCTION create_transaction_state_history()
RETURNS TRIGGER AS $$
BEGIN
    -- Only create history if status actually changed
    IF OLD.transaction_status IS DISTINCT FROM NEW.transaction_status THEN
        INSERT INTO transaction_state_history (
            transaction_id,
            previous_status,
            new_status,
            changed_by,
            changed_at
        ) VALUES (
            NEW.id,
            OLD.transaction_status,
            NEW.transaction_status,
            NEW.updated_by,
            CURRENT_TIMESTAMP
        );
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply transaction state history trigger
CREATE TRIGGER create_transaction_state_history_trigger
    AFTER UPDATE ON network_transactions
    FOR EACH ROW EXECUTE FUNCTION create_transaction_state_history();

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================

-- Transaction summary view
CREATE VIEW transaction_summary AS
SELECT 
    DATE(initiated_at) as transaction_date,
    transaction_type,
    transaction_status,
    originator_agent_id,
    COUNT(*) as transaction_count,
    SUM(transaction_amount) as total_amount,
    SUM(fee_amount) as total_fees,
    SUM(commission_amount) as total_commissions,
    AVG(processing_time_ms) as avg_processing_time,
    AVG(fraud_score) as avg_fraud_score
FROM network_transactions
GROUP BY 
    DATE(initiated_at),
    transaction_type,
    transaction_status,
    originator_agent_id;

-- Agent performance view
CREATE VIEW agent_performance_summary AS
SELECT 
    acp.agent_id,
    acp.currency,
    acp.current_balance,
    acp.available_balance,
    COUNT(nt.id) as total_transactions,
    SUM(nt.transaction_amount) as total_transaction_volume,
    SUM(cc.final_commission) as total_commissions_earned,
    AVG(nt.fraud_score) as avg_fraud_score,
    MAX(nt.initiated_at) as last_transaction_date
FROM agent_cash_positions acp
LEFT JOIN network_transactions nt ON acp.agent_id = nt.originator_agent_id
LEFT JOIN commission_calculations cc ON acp.agent_id = cc.agent_id
GROUP BY 
    acp.agent_id,
    acp.currency,
    acp.current_balance,
    acp.available_balance;

-- Settlement status view
CREATE VIEW settlement_status_summary AS
SELECT 
    sb.id as batch_id,
    sb.batch_reference,
    sb.settlement_date,
    sb.status as batch_status,
    sb.total_transactions,
    sb.total_amount,
    COUNT(se.id) as agent_count,
    SUM(se.net_settlement_amount) as total_net_settlement,
    COUNT(CASE WHEN se.status = 'completed' THEN 1 END) as completed_agents,
    COUNT(CASE WHEN se.status = 'failed' THEN 1 END) as failed_agents
FROM settlement_batches sb
LEFT JOIN settlement_entries se ON sb.id = se.settlement_batch_id
GROUP BY 
    sb.id,
    sb.batch_reference,
    sb.settlement_date,
    sb.status,
    sb.total_transactions,
    sb.total_amount;

-- Network health view
CREATE VIEW network_health_summary AS
SELECT 
    service_name,
    service_type,
    status,
    COUNT(*) as check_count,
    AVG(response_time_ms) as avg_response_time,
    MAX(checked_at) as last_check_time,
    COUNT(CASE WHEN status = 'healthy' THEN 1 END) as healthy_checks,
    COUNT(CASE WHEN status = 'unhealthy' THEN 1 END) as unhealthy_checks
FROM system_health_checks
WHERE checked_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
GROUP BY 
    service_name,
    service_type,
    status;

-- =====================================================
-- STORED PROCEDURES FOR COMMON OPERATIONS
-- =====================================================

-- Procedure to calculate transaction fees
CREATE OR REPLACE FUNCTION calculate_transaction_fee(
    p_transaction_type transaction_type_enum,
    p_amount DECIMAL(15,2),
    p_agent_tier VARCHAR(20),
    p_customer_tier VARCHAR(20),
    p_country VARCHAR(100)
) RETURNS DECIMAL(15,2) AS $$
DECLARE
    v_fee DECIMAL(15,2) := 0.00;
    v_rule RECORD;
BEGIN
    -- Find applicable fee rule
    SELECT * INTO v_rule
    FROM transaction_fee_rules
    WHERE transaction_type = p_transaction_type
    AND (agent_tier IS NULL OR agent_tier = p_agent_tier)
    AND (customer_tier IS NULL OR customer_tier = p_customer_tier)
    AND (applicable_countries IS NULL OR p_country = ANY(applicable_countries))
    AND (min_amount IS NULL OR p_amount >= min_amount)
    AND (max_amount IS NULL OR p_amount <= max_amount)
    AND is_active = true
    AND CURRENT_TIMESTAMP BETWEEN effective_from AND COALESCE(effective_to, 'infinity')
    ORDER BY 
        CASE WHEN agent_tier IS NOT NULL THEN 1 ELSE 2 END,
        CASE WHEN customer_tier IS NOT NULL THEN 1 ELSE 2 END,
        CASE WHEN applicable_countries IS NOT NULL THEN 1 ELSE 2 END
    LIMIT 1;
    
    IF FOUND THEN
        -- Calculate fee based on rule
        v_fee := v_rule.fixed_fee + (p_amount * v_rule.percentage_fee / 100);
        
        -- Apply minimum and maximum limits
        IF v_rule.minimum_fee IS NOT NULL AND v_fee < v_rule.minimum_fee THEN
            v_fee := v_rule.minimum_fee;
        END IF;
        
        IF v_rule.maximum_fee IS NOT NULL AND v_fee > v_rule.maximum_fee THEN
            v_fee := v_rule.maximum_fee;
        END IF;
    END IF;
    
    RETURN v_fee;
END;
$$ LANGUAGE plpgsql;

-- Procedure to calculate commission
CREATE OR REPLACE FUNCTION calculate_commission(
    p_transaction_id UUID,
    p_agent_id UUID,
    p_transaction_type transaction_type_enum,
    p_amount DECIMAL(15,2),
    p_agent_tier VARCHAR(20)
) RETURNS UUID AS $$
DECLARE
    v_commission_id UUID;
    v_rule RECORD;
    v_commission DECIMAL(15,2) := 0.00;
    v_reference VARCHAR(50);
BEGIN
    -- Find applicable commission rule
    SELECT * INTO v_rule
    FROM commission_rules
    WHERE commission_type = 'transaction_commission'
    AND (transaction_type IS NULL OR transaction_type = p_transaction_type)
    AND (agent_tier IS NULL OR agent_tier = p_agent_tier)
    AND is_active = true
    AND CURRENT_TIMESTAMP BETWEEN effective_from AND COALESCE(effective_to, 'infinity')
    ORDER BY 
        CASE WHEN transaction_type IS NOT NULL THEN 1 ELSE 2 END,
        CASE WHEN agent_tier IS NOT NULL THEN 1 ELSE 2 END
    LIMIT 1;
    
    IF FOUND THEN
        -- Calculate commission based on method
        CASE v_rule.calculation_method
            WHEN 'fixed_amount' THEN
                v_commission := v_rule.fixed_amount;
            WHEN 'percentage' THEN
                v_commission := p_amount * v_rule.percentage_rate / 100;
            -- Add other calculation methods as needed
        END CASE;
        
        -- Apply minimum and maximum limits
        IF v_rule.minimum_commission IS NOT NULL AND v_commission < v_rule.minimum_commission THEN
            v_commission := v_rule.minimum_commission;
        END IF;
        
        IF v_rule.maximum_commission IS NOT NULL AND v_commission > v_rule.maximum_commission THEN
            v_commission := v_rule.maximum_commission;
        END IF;
        
        -- Generate reference
        v_reference := 'COMM-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || UPPER(SUBSTRING(gen_random_uuid()::text, 1, 6));
        
        -- Insert commission calculation
        INSERT INTO commission_calculations (
            transaction_id,
            agent_id,
            commission_rule_id,
            calculation_reference,
            commission_type,
            calculation_method,
            base_amount,
            commission_rate,
            calculated_commission,
            final_commission,
            calculated_by
        ) VALUES (
            p_transaction_id,
            p_agent_id,
            v_rule.id,
            v_reference,
            'transaction_commission',
            v_rule.calculation_method,
            p_amount,
            v_rule.percentage_rate,
            v_commission,
            v_commission,
            NULL -- System calculated
        ) RETURNING id INTO v_commission_id;
    END IF;
    
    RETURN v_commission_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- SAMPLE DATA FOR TESTING (OPTIONAL)
-- =====================================================

-- Insert sample fee rules
INSERT INTO transaction_fee_rules (
    rule_name, transaction_type, agent_tier, fixed_fee, percentage_fee, minimum_fee, maximum_fee, created_by
) VALUES 
('Standard Cash In Fee', 'cash_in', NULL, 0.50, 0.5, 0.50, 5.00, gen_random_uuid()),
('Standard Cash Out Fee', 'cash_out', NULL, 1.00, 1.0, 1.00, 10.00, gen_random_uuid()),
('Transfer Fee', 'transfer', NULL, 0.25, 0.25, 0.25, 2.50, gen_random_uuid()),
('Bill Payment Fee', 'bill_payment', NULL, 0.75, 0.75, 0.75, 7.50, gen_random_uuid());

-- Insert sample commission rules
INSERT INTO commission_rules (
    rule_name, rule_code, commission_type, transaction_type, calculation_method, 
    percentage_rate, minimum_commission, maximum_commission, created_by
) VALUES 
('Cash In Commission', 'CASH_IN_COMM', 'transaction_commission', 'cash_in', 'percentage', 0.25, 0.10, 2.00, gen_random_uuid()),
('Cash Out Commission', 'CASH_OUT_COMM', 'transaction_commission', 'cash_out', 'percentage', 0.50, 0.20, 5.00, gen_random_uuid()),
('Transfer Commission', 'TRANSFER_COMM', 'transaction_commission', 'transfer', 'percentage', 0.15, 0.05, 1.00, gen_random_uuid()),
('Bill Payment Commission', 'BILL_PAY_COMM', 'transaction_commission', 'bill_payment', 'percentage', 0.30, 0.15, 3.00, gen_random_uuid());

-- =====================================================
-- COMMENTS AND DOCUMENTATION
-- =====================================================

COMMENT ON TABLE network_transactions IS 'Core transaction processing table with comprehensive financial and audit information';
COMMENT ON TABLE settlement_batches IS 'Settlement batch processing for agent reconciliation and payments';
COMMENT ON TABLE commission_calculations IS 'Individual commission calculations linked to transactions and rules';
COMMENT ON TABLE agent_cash_positions IS 'Real-time cash position tracking for all agents';
COMMENT ON TABLE network_performance_metrics IS 'System performance and business metrics collection';
COMMENT ON TABLE network_alerts IS 'Alert and notification management for system monitoring';

COMMENT ON COLUMN network_transactions.fraud_score IS 'AI-calculated fraud risk score (0-100)';
COMMENT ON COLUMN network_transactions.geolocation IS 'PostGIS geography point for transaction location';
COMMENT ON COLUMN commission_rules.tier_structure IS 'JSON array of tiered commission rates';
COMMENT ON COLUMN agent_cash_positions.available_balance IS 'Balance available for transactions (current - reserved)';
COMMENT ON COLUMN cash_movements.movement_type IS 'Type of cash movement: debit, credit, reserve, release';

