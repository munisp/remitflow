-- Comprehensive Remittance Platform Database Schema
-- Production-grade PostgreSQL schema with advanced features

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Create custom types
CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'pending_verification', 'blocked');
CREATE TYPE transaction_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed');
CREATE TYPE transaction_type AS ENUM ('cash_in', 'cash_out', 'transfer', 'bill_payment', 'airtime_purchase', 'merchant_payment', 'salary_disbursement', 'loan_disbursement', 'loan_repayment', 'savings_deposit', 'savings_withdrawal');
CREATE TYPE agent_tier AS ENUM ('agent', 'super_agent', 'master_agent', 'distributor');
CREATE TYPE kyc_status AS ENUM ('not_started', 'in_progress', 'pending_review', 'approved', 'rejected', 'expired');
CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE fraud_alert_status AS ENUM ('open', 'investigating', 'resolved', 'false_positive');
CREATE TYPE device_type AS ENUM ('mobile', 'pos', 'atm', 'web', 'api', 'ussd');
CREATE TYPE currency_code AS ENUM ('KES', 'USD', 'EUR', 'GBP', 'UGX', 'TZS', 'RWF', 'ETB');
CREATE TYPE notification_type AS ENUM ('sms', 'email', 'push', 'in_app', 'webhook');
CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'delivered', 'failed', 'bounced');

-- Core Tables

-- Countries and Regions
CREATE TABLE countries (
    id SERIAL PRIMARY KEY,
    code VARCHAR(3) UNIQUE NOT NULL, -- ISO 3166-1 alpha-3
    name VARCHAR(100) NOT NULL,
    currency_code currency_code NOT NULL,
    phone_prefix VARCHAR(10),
    timezone VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE regions (
    id SERIAL PRIMARY KEY,
    country_id INTEGER REFERENCES countries(id),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    coordinates GEOMETRY(POLYGON, 4326),
    population INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Financial Institutions
CREATE TABLE financial_institutions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    country_id INTEGER REFERENCES countries(id),
    license_number VARCHAR(100),
    regulatory_body VARCHAR(100),
    swift_code VARCHAR(11),
    contact_info JSONB,
    compliance_info JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Agent Hierarchy and Management
CREATE TABLE agent_networks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    financial_institution_id UUID REFERENCES financial_institutions(id),
    country_id INTEGER REFERENCES countries(id),
    network_code VARCHAR(20) UNIQUE NOT NULL,
    commission_structure JSONB,
    operational_limits JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_code VARCHAR(50) UNIQUE NOT NULL,
    network_id UUID REFERENCES agent_networks(id),
    parent_agent_id UUID REFERENCES agents(id),
    tier agent_tier NOT NULL DEFAULT 'agent',
    business_name VARCHAR(200) NOT NULL,
    owner_name VARCHAR(200) NOT NULL,
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255),
    national_id VARCHAR(50),
    tax_id VARCHAR(50),
    business_license VARCHAR(100),
    
    -- Location information
    physical_address TEXT,
    coordinates GEOMETRY(POINT, 4326),
    region_id INTEGER REFERENCES regions(id),
    
    -- Financial information
    bank_account_number VARCHAR(50),
    bank_name VARCHAR(100),
    commission_rate DECIMAL(5,4) DEFAULT 0.0200, -- 2%
    
    -- Operational limits
    daily_transaction_limit DECIMAL(15,2) DEFAULT 1000000.00,
    monthly_transaction_limit DECIMAL(15,2) DEFAULT 30000000.00,
    single_transaction_limit DECIMAL(15,2) DEFAULT 500000.00,
    
    -- Status and verification
    status user_status DEFAULT 'pending_verification',
    kyc_status kyc_status DEFAULT 'not_started',
    risk_level risk_level DEFAULT 'medium',
    
    -- Operational information
    operating_hours JSONB,
    services_offered TEXT[],
    float_balance DECIMAL(15,2) DEFAULT 0.00,
    
    -- Metadata
    onboarding_date DATE,
    last_activity_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_coordinates CHECK (ST_IsValid(coordinates)),
    CONSTRAINT positive_limits CHECK (
        daily_transaction_limit > 0 AND 
        monthly_transaction_limit > 0 AND 
        single_transaction_limit > 0
    )
);

-- Customer Management
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Personal information
    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100),
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(10),
    nationality VARCHAR(3) REFERENCES countries(code),
    
    -- Contact information
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255),
    alternative_phone VARCHAR(20),
    
    -- Identification
    national_id VARCHAR(50),
    passport_number VARCHAR(50),
    driving_license VARCHAR(50),
    
    -- Address information
    physical_address TEXT,
    postal_address TEXT,
    coordinates GEOMETRY(POINT, 4326),
    region_id INTEGER REFERENCES regions(id),
    
    -- Financial information
    occupation VARCHAR(100),
    employer VARCHAR(200),
    monthly_income DECIMAL(15,2),
    source_of_funds VARCHAR(200),
    
    -- Account information
    registration_agent_id UUID REFERENCES agents(id),
    primary_agent_id UUID REFERENCES agents(id),
    account_balance DECIMAL(15,2) DEFAULT 0.00,
    
    -- Limits and restrictions
    daily_transaction_limit DECIMAL(15,2) DEFAULT 100000.00,
    monthly_transaction_limit DECIMAL(15,2) DEFAULT 3000000.00,
    
    -- Status and verification
    status user_status DEFAULT 'pending_verification',
    kyc_status kyc_status DEFAULT 'not_started',
    risk_level risk_level DEFAULT 'low',
    
    -- Preferences
    preferred_language VARCHAR(10) DEFAULT 'en',
    notification_preferences JSONB,
    
    -- Metadata
    registration_date DATE DEFAULT CURRENT_DATE,
    last_login TIMESTAMP WITH TIME ZONE,
    last_transaction_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_coordinates CHECK (ST_IsValid(coordinates)),
    CONSTRAINT valid_age CHECK (date_of_birth IS NULL OR date_of_birth <= CURRENT_DATE - INTERVAL '16 years'),
    CONSTRAINT positive_balance CHECK (account_balance >= 0),
    CONSTRAINT positive_limits CHECK (
        daily_transaction_limit > 0 AND 
        monthly_transaction_limit > 0
    )
);

-- KYC and Document Management
CREATE TABLE kyc_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID REFERENCES customers(id),
    agent_id UUID REFERENCES agents(id),
    document_type VARCHAR(50) NOT NULL,
    document_number VARCHAR(100),
    document_file_path TEXT,
    document_hash VARCHAR(64),
    
    -- OCR and verification results
    ocr_extracted_data JSONB,
    verification_results JSONB,
    verification_score DECIMAL(5,4),
    
    -- Status and workflow
    status kyc_status DEFAULT 'pending_review',
    submitted_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    reviewed_date TIMESTAMP WITH TIME ZONE,
    reviewer_id UUID,
    review_notes TEXT,
    
    -- Expiry and validity
    issue_date DATE,
    expiry_date DATE,
    is_valid BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Transaction Management
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_reference VARCHAR(100) UNIQUE NOT NULL,
    
    -- Transaction parties
    customer_id UUID REFERENCES customers(id),
    agent_id UUID REFERENCES agents(id),
    beneficiary_customer_id UUID REFERENCES customers(id),
    beneficiary_agent_id UUID REFERENCES agents(id),
    
    -- Transaction details
    transaction_type transaction_type NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    currency currency_code NOT NULL DEFAULT 'KES',
    exchange_rate DECIMAL(10,6) DEFAULT 1.000000,
    
    -- Fees and charges
    agent_commission DECIMAL(15,2) DEFAULT 0.00,
    system_fee DECIMAL(15,2) DEFAULT 0.00,
    tax_amount DECIMAL(15,2) DEFAULT 0.00,
    total_charges DECIMAL(15,2) DEFAULT 0.00,
    
    -- Transaction flow
    debit_account VARCHAR(50),
    credit_account VARCHAR(50),
    
    -- Status and processing
    status transaction_status DEFAULT 'pending',
    processing_code VARCHAR(10),
    response_code VARCHAR(10),
    
    -- Device and channel information
    device_type device_type,
    device_id VARCHAR(100),
    channel VARCHAR(50),
    pos_terminal_id VARCHAR(50),
    
    -- Location and security
    transaction_coordinates GEOMETRY(POINT, 4326),
    ip_address INET,
    user_agent TEXT,
    device_fingerprint VARCHAR(255),
    
    -- Timing information
    initiated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    
    -- Additional information
    description TEXT,
    reference_data JSONB,
    external_reference VARCHAR(100),
    
    -- Reconciliation
    reconciliation_status VARCHAR(20) DEFAULT 'pending',
    reconciled_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit trail
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT positive_amount CHECK (amount > 0),
    CONSTRAINT valid_coordinates CHECK (ST_IsValid(transaction_coordinates)),
    CONSTRAINT valid_exchange_rate CHECK (exchange_rate > 0)
);

-- Account Ledger for Double Entry Bookkeeping
CREATE TABLE account_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID REFERENCES transactions(id),
    
    -- Account information
    account_number VARCHAR(50) NOT NULL,
    account_type VARCHAR(50) NOT NULL, -- customer, agent, system, bank, etc.
    account_owner_id UUID, -- References customers(id) or agents(id)
    
    -- Entry details
    entry_type VARCHAR(10) NOT NULL CHECK (entry_type IN ('debit', 'credit')),
    amount DECIMAL(15,2) NOT NULL,
    currency currency_code NOT NULL DEFAULT 'KES',
    
    -- Balance tracking
    balance_before DECIMAL(15,2) NOT NULL,
    balance_after DECIMAL(15,2) NOT NULL,
    
    -- Metadata
    description TEXT,
    reference_number VARCHAR(100),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT positive_amount CHECK (amount > 0),
    CONSTRAINT valid_balance_calculation CHECK (
        (entry_type = 'debit' AND balance_after = balance_before - amount) OR
        (entry_type = 'credit' AND balance_after = balance_before + amount)
    )
);

-- Fraud Detection and Risk Management
CREATE TABLE fraud_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_name VARCHAR(100) UNIQUE NOT NULL,
    rule_type VARCHAR(50) NOT NULL, -- velocity, amount, location, behavioral, etc.
    rule_definition JSONB NOT NULL,
    threshold_values JSONB,
    
    -- Rule configuration
    is_active BOOLEAN DEFAULT true,
    severity_level risk_level DEFAULT 'medium',
    action_on_trigger VARCHAR(50) DEFAULT 'flag', -- flag, block, review
    
    -- Performance metrics
    trigger_count INTEGER DEFAULT 0,
    false_positive_count INTEGER DEFAULT 0,
    true_positive_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fraud_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID REFERENCES transactions(id),
    customer_id UUID REFERENCES customers(id),
    agent_id UUID REFERENCES agents(id),
    
    -- Alert details
    alert_type VARCHAR(50) NOT NULL,
    risk_score DECIMAL(5,4) NOT NULL,
    severity_level risk_level NOT NULL,
    
    -- Rule information
    triggered_rules JSONB,
    rule_explanations TEXT,
    
    -- ML model information
    model_predictions JSONB,
    feature_values JSONB,
    
    -- Status and resolution
    status fraud_alert_status DEFAULT 'open',
    assigned_to UUID,
    resolution_notes TEXT,
    is_false_positive BOOLEAN,
    
    -- Timing
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Device and Session Management
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_fingerprint VARCHAR(255) UNIQUE NOT NULL,
    
    -- Device information
    device_type device_type NOT NULL,
    device_model VARCHAR(100),
    operating_system VARCHAR(100),
    browser_info VARCHAR(200),
    screen_resolution VARCHAR(20),
    
    -- Network information
    ip_address INET,
    user_agent TEXT,
    
    -- Security information
    is_trusted BOOLEAN DEFAULT false,
    risk_score DECIMAL(5,4) DEFAULT 0.5000,
    
    -- Usage tracking
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    usage_count INTEGER DEFAULT 1,
    
    -- Associated users
    associated_customers UUID[],
    associated_agents UUID[],
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_token VARCHAR(255) UNIQUE NOT NULL,
    
    -- User information
    user_id UUID NOT NULL,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('customer', 'agent', 'admin')),
    
    -- Device and location
    device_id UUID REFERENCES devices(id),
    ip_address INET,
    location_coordinates GEOMETRY(POINT, 4326),
    
    -- Session details
    login_method VARCHAR(50), -- password, biometric, otp, etc.
    mfa_verified BOOLEAN DEFAULT false,
    
    -- Status and timing
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    terminated_at TIMESTAMP WITH TIME ZONE,
    
    -- Security
    failed_attempts INTEGER DEFAULT 0,
    is_suspicious BOOLEAN DEFAULT false,
    
    CONSTRAINT valid_coordinates CHECK (ST_IsValid(location_coordinates))
);

-- Notification System
CREATE TABLE notification_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_name VARCHAR(100) UNIQUE NOT NULL,
    notification_type notification_type NOT NULL,
    
    -- Template content
    subject_template TEXT,
    body_template TEXT NOT NULL,
    
    -- Configuration
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 5,
    
    -- Localization
    language VARCHAR(10) DEFAULT 'en',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Recipient information
    recipient_id UUID NOT NULL,
    recipient_type VARCHAR(20) NOT NULL CHECK (recipient_type IN ('customer', 'agent', 'admin')),
    
    -- Notification details
    notification_type notification_type NOT NULL,
    template_id UUID REFERENCES notification_templates(id),
    
    -- Content
    subject TEXT,
    message TEXT NOT NULL,
    
    -- Delivery information
    delivery_address VARCHAR(255), -- phone number, email address, etc.
    
    -- Status and timing
    status notification_status DEFAULT 'pending',
    scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    reference_id UUID, -- transaction_id, alert_id, etc.
    reference_type VARCHAR(50),
    
    -- Retry information
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Audit and Compliance
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Event information
    event_type VARCHAR(100) NOT NULL,
    event_category VARCHAR(50) NOT NULL, -- authentication, transaction, configuration, etc.
    
    -- Actor information
    actor_id UUID,
    actor_type VARCHAR(20), -- customer, agent, admin, system
    
    -- Target information
    target_id UUID,
    target_type VARCHAR(50),
    
    -- Event details
    event_description TEXT,
    event_data JSONB,
    
    -- Context information
    ip_address INET,
    user_agent TEXT,
    session_id UUID,
    
    -- Timing
    event_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Compliance
    retention_period INTERVAL DEFAULT INTERVAL '7 years',
    is_sensitive BOOLEAN DEFAULT false
);

CREATE TABLE compliance_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_type VARCHAR(100) NOT NULL,
    report_period_start DATE NOT NULL,
    report_period_end DATE NOT NULL,
    
    -- Report content
    report_data JSONB NOT NULL,
    summary_statistics JSONB,
    
    -- Generation information
    generated_by UUID,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Status
    status VARCHAR(20) DEFAULT 'draft',
    approved_by UUID,
    approved_at TIMESTAMP WITH TIME ZONE,
    
    -- File information
    file_path TEXT,
    file_hash VARCHAR(64),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Configuration and System Management
CREATE TABLE system_configurations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    config_type VARCHAR(50) NOT NULL, -- limits, fees, rules, etc.
    
    -- Metadata
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    
    -- Change tracking
    created_by UUID,
    updated_by UUID,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fee_structures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    structure_name VARCHAR(100) NOT NULL,
    transaction_type transaction_type NOT NULL,
    
    -- Fee calculation
    fee_type VARCHAR(20) NOT NULL CHECK (fee_type IN ('fixed', 'percentage', 'tiered')),
    fee_value DECIMAL(15,6) NOT NULL,
    minimum_fee DECIMAL(15,2) DEFAULT 0.00,
    maximum_fee DECIMAL(15,2),
    
    -- Applicability
    agent_tier agent_tier,
    customer_segment VARCHAR(50),
    amount_range_min DECIMAL(15,2),
    amount_range_max DECIMAL(15,2),
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    effective_from DATE DEFAULT CURRENT_DATE,
    effective_to DATE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Analytics and Reporting Tables
CREATE TABLE daily_agent_summaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID REFERENCES agents(id),
    summary_date DATE NOT NULL,
    
    -- Transaction metrics
    total_transactions INTEGER DEFAULT 0,
    total_volume DECIMAL(15,2) DEFAULT 0.00,
    total_commission DECIMAL(15,2) DEFAULT 0.00,
    
    -- Transaction type breakdown
    cash_in_count INTEGER DEFAULT 0,
    cash_in_volume DECIMAL(15,2) DEFAULT 0.00,
    cash_out_count INTEGER DEFAULT 0,
    cash_out_volume DECIMAL(15,2) DEFAULT 0.00,
    transfer_count INTEGER DEFAULT 0,
    transfer_volume DECIMAL(15,2) DEFAULT 0.00,
    
    -- Customer metrics
    unique_customers INTEGER DEFAULT 0,
    new_customers INTEGER DEFAULT 0,
    
    -- Float management
    opening_balance DECIMAL(15,2) DEFAULT 0.00,
    closing_balance DECIMAL(15,2) DEFAULT 0.00,
    float_additions DECIMAL(15,2) DEFAULT 0.00,
    
    -- Performance metrics
    success_rate DECIMAL(5,4) DEFAULT 1.0000,
    average_transaction_time INTERVAL,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(agent_id, summary_date)
);

CREATE TABLE customer_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID REFERENCES customers(id),
    analysis_date DATE NOT NULL,
    
    -- Behavioral metrics
    transaction_frequency DECIMAL(10,4) DEFAULT 0.0000,
    average_transaction_amount DECIMAL(15,2) DEFAULT 0.00,
    preferred_transaction_types TEXT[],
    
    -- Engagement metrics
    days_since_last_transaction INTEGER,
    total_lifetime_value DECIMAL(15,2) DEFAULT 0.00,
    
    -- Risk metrics
    risk_score DECIMAL(5,4) DEFAULT 0.5000,
    fraud_alerts_count INTEGER DEFAULT 0,
    
    -- Segmentation
    customer_segment VARCHAR(50),
    churn_probability DECIMAL(5,4) DEFAULT 0.0000,
    
    -- Predictions
    predicted_next_transaction_date DATE,
    predicted_monthly_volume DECIMAL(15,2) DEFAULT 0.00,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(customer_id, analysis_date)
);

-- Indexes for Performance Optimization

-- Primary lookup indexes
CREATE INDEX idx_agents_code ON agents(agent_code);
CREATE INDEX idx_agents_phone ON agents(phone_number);
CREATE INDEX idx_agents_network ON agents(network_id);
CREATE INDEX idx_agents_parent ON agents(parent_agent_id);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_location ON agents USING GIST(coordinates);

CREATE INDEX idx_customers_number ON customers(customer_number);
CREATE INDEX idx_customers_phone ON customers(phone_number);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_national_id ON customers(national_id);
CREATE INDEX idx_customers_agent ON customers(primary_agent_id);
CREATE INDEX idx_customers_status ON customers(status);
CREATE INDEX idx_customers_location ON customers USING GIST(coordinates);

-- Transaction indexes
CREATE INDEX idx_transactions_reference ON transactions(transaction_reference);
CREATE INDEX idx_transactions_customer ON transactions(customer_id);
CREATE INDEX idx_transactions_agent ON transactions(agent_id);
CREATE INDEX idx_transactions_type ON transactions(transaction_type);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_date ON transactions(initiated_at);
CREATE INDEX idx_transactions_amount ON transactions(amount);
CREATE INDEX idx_transactions_location ON transactions USING GIST(transaction_coordinates);

-- Composite indexes for common queries
CREATE INDEX idx_transactions_customer_date ON transactions(customer_id, initiated_at);
CREATE INDEX idx_transactions_agent_date ON transactions(agent_id, initiated_at);
CREATE INDEX idx_transactions_status_date ON transactions(status, initiated_at);
CREATE INDEX idx_transactions_type_date ON transactions(transaction_type, initiated_at);

-- Fraud detection indexes
CREATE INDEX idx_fraud_alerts_transaction ON fraud_alerts(transaction_id);
CREATE INDEX idx_fraud_alerts_customer ON fraud_alerts(customer_id);
CREATE INDEX idx_fraud_alerts_agent ON fraud_alerts(agent_id);
CREATE INDEX idx_fraud_alerts_status ON fraud_alerts(status);
CREATE INDEX idx_fraud_alerts_severity ON fraud_alerts(severity_level);
CREATE INDEX idx_fraud_alerts_date ON fraud_alerts(detected_at);

-- Audit and compliance indexes
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id, actor_type);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_id, target_type);
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(event_timestamp);

-- Analytics indexes
CREATE INDEX idx_daily_summaries_agent_date ON daily_agent_summaries(agent_id, summary_date);
CREATE INDEX idx_customer_analytics_date ON customer_analytics(customer_id, analysis_date);

-- Full-text search indexes
CREATE INDEX idx_agents_search ON agents USING GIN(to_tsvector('english', business_name || ' ' || owner_name));
CREATE INDEX idx_customers_search ON customers USING GIN(to_tsvector('english', first_name || ' ' || COALESCE(middle_name, '') || ' ' || last_name));

-- Triggers for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update triggers to relevant tables
CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_fraud_alerts_updated_at BEFORE UPDATE ON fraud_alerts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_kyc_documents_updated_at BEFORE UPDATE ON kyc_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_devices_updated_at BEFORE UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_sessions_updated_at BEFORE UPDATE ON user_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_system_configurations_updated_at BEFORE UPDATE ON system_configurations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_fee_structures_updated_at BEFORE UPDATE ON fee_structures FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Views for Common Queries

-- Active agents with their network information
CREATE VIEW active_agents_view AS
SELECT 
    a.id,
    a.agent_code,
    a.business_name,
    a.owner_name,
    a.phone_number,
    a.tier,
    a.status,
    a.float_balance,
    an.name as network_name,
    an.network_code,
    fi.name as institution_name,
    c.name as country_name,
    r.name as region_name
FROM agents a
JOIN agent_networks an ON a.network_id = an.id
JOIN financial_institutions fi ON an.financial_institution_id = fi.id
JOIN countries c ON an.country_id = c.id
LEFT JOIN regions r ON a.region_id = r.id
WHERE a.status = 'active' AND an.is_active = true;

-- Customer transaction summary
CREATE VIEW customer_transaction_summary AS
SELECT 
    c.id as customer_id,
    c.customer_number,
    c.first_name,
    c.last_name,
    c.phone_number,
    COUNT(t.id) as total_transactions,
    SUM(CASE WHEN t.status = 'completed' THEN t.amount ELSE 0 END) as total_volume,
    MAX(t.initiated_at) as last_transaction_date,
    AVG(CASE WHEN t.status = 'completed' THEN t.amount ELSE NULL END) as avg_transaction_amount
FROM customers c
LEFT JOIN transactions t ON c.id = t.customer_id
GROUP BY c.id, c.customer_number, c.first_name, c.last_name, c.phone_number;

-- Daily transaction summary
CREATE VIEW daily_transaction_summary AS
SELECT 
    DATE(initiated_at) as transaction_date,
    transaction_type,
    status,
    COUNT(*) as transaction_count,
    SUM(amount) as total_volume,
    AVG(amount) as average_amount,
    SUM(total_charges) as total_fees
FROM transactions
WHERE initiated_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(initiated_at), transaction_type, status
ORDER BY transaction_date DESC, transaction_type;

-- Fraud alert summary
CREATE VIEW fraud_alert_summary AS
SELECT 
    DATE(detected_at) as alert_date,
    alert_type,
    severity_level,
    status,
    COUNT(*) as alert_count,
    AVG(risk_score) as average_risk_score
FROM fraud_alerts
WHERE detected_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(detected_at), alert_type, severity_level, status
ORDER BY alert_date DESC, severity_level;

-- Functions for Business Logic

-- Calculate agent commission
CREATE OR REPLACE FUNCTION calculate_agent_commission(
    p_agent_id UUID,
    p_transaction_type transaction_type,
    p_amount DECIMAL(15,2)
) RETURNS DECIMAL(15,2) AS $$
DECLARE
    v_commission_rate DECIMAL(5,4);
    v_commission DECIMAL(15,2);
BEGIN
    -- Get agent commission rate
    SELECT commission_rate INTO v_commission_rate
    FROM agents
    WHERE id = p_agent_id;
    
    -- Calculate commission based on transaction type and amount
    CASE p_transaction_type
        WHEN 'cash_in' THEN
            v_commission := p_amount * v_commission_rate;
        WHEN 'cash_out' THEN
            v_commission := p_amount * v_commission_rate * 1.5; -- Higher rate for cash out
        WHEN 'transfer' THEN
            v_commission := p_amount * v_commission_rate * 0.8; -- Lower rate for transfers
        ELSE
            v_commission := p_amount * v_commission_rate;
    END CASE;
    
    RETURN COALESCE(v_commission, 0.00);
END;
$$ LANGUAGE plpgsql;

-- Validate transaction limits
CREATE OR REPLACE FUNCTION validate_transaction_limits(
    p_customer_id UUID,
    p_agent_id UUID,
    p_amount DECIMAL(15,2),
    p_transaction_type transaction_type
) RETURNS BOOLEAN AS $$
DECLARE
    v_customer_daily_limit DECIMAL(15,2);
    v_customer_monthly_limit DECIMAL(15,2);
    v_agent_daily_limit DECIMAL(15,2);
    v_agent_single_limit DECIMAL(15,2);
    v_customer_daily_total DECIMAL(15,2);
    v_customer_monthly_total DECIMAL(15,2);
    v_agent_daily_total DECIMAL(15,2);
BEGIN
    -- Get customer limits
    SELECT daily_transaction_limit, monthly_transaction_limit
    INTO v_customer_daily_limit, v_customer_monthly_limit
    FROM customers
    WHERE id = p_customer_id;
    
    -- Get agent limits
    SELECT daily_transaction_limit, single_transaction_limit
    INTO v_agent_daily_limit, v_agent_single_limit
    FROM agents
    WHERE id = p_agent_id;
    
    -- Check single transaction limit
    IF p_amount > v_agent_single_limit THEN
        RETURN FALSE;
    END IF;
    
    -- Calculate customer daily total
    SELECT COALESCE(SUM(amount), 0)
    INTO v_customer_daily_total
    FROM transactions
    WHERE customer_id = p_customer_id
    AND DATE(initiated_at) = CURRENT_DATE
    AND status IN ('completed', 'processing');
    
    -- Check customer daily limit
    IF v_customer_daily_total + p_amount > v_customer_daily_limit THEN
        RETURN FALSE;
    END IF;
    
    -- Calculate customer monthly total
    SELECT COALESCE(SUM(amount), 0)
    INTO v_customer_monthly_total
    FROM transactions
    WHERE customer_id = p_customer_id
    AND DATE_TRUNC('month', initiated_at) = DATE_TRUNC('month', CURRENT_DATE)
    AND status IN ('completed', 'processing');
    
    -- Check customer monthly limit
    IF v_customer_monthly_total + p_amount > v_customer_monthly_limit THEN
        RETURN FALSE;
    END IF;
    
    -- Calculate agent daily total
    SELECT COALESCE(SUM(amount), 0)
    INTO v_agent_daily_total
    FROM transactions
    WHERE agent_id = p_agent_id
    AND DATE(initiated_at) = CURRENT_DATE
    AND status IN ('completed', 'processing');
    
    -- Check agent daily limit
    IF v_agent_daily_total + p_amount > v_agent_daily_limit THEN
        RETURN FALSE;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Insert sample data for testing
INSERT INTO countries (code, name, currency_code, phone_prefix, timezone) VALUES
('KEN', 'Kenya', 'KES', '+254', 'Africa/Nairobi'),
('UGA', 'Uganda', 'UGX', '+256', 'Africa/Kampala'),
('TZA', 'Tanzania', 'TZS', '+255', 'Africa/Dar_es_Salaam'),
('RWA', 'Rwanda', 'RWF', '+250', 'Africa/Kigali'),
('ETH', 'Ethiopia', 'ETB', '+251', 'Africa/Addis_Ababa');

INSERT INTO financial_institutions (name, code, country_id, license_number) VALUES
('Kenya Commercial Bank', 'KCB', 1, 'CBK/LIC/001'),
('Equity Bank', 'EQUITY', 1, 'CBK/LIC/002'),
('Safaricom PLC', 'SAFARICOM', 1, 'CBK/LIC/003');

INSERT INTO agent_networks (name, financial_institution_id, country_id, network_code) VALUES
('KCB Agent Network', (SELECT id FROM financial_institutions WHERE code = 'KCB'), 1, 'KCB_AGENTS'),
('Equity Agent Network', (SELECT id FROM financial_institutions WHERE code = 'EQUITY'), 1, 'EQ_AGENTS'),
('M-Pesa Agent Network', (SELECT id FROM financial_institutions WHERE code = 'SAFARICOM'), 1, 'MPESA_AGENTS');

-- Add comments for documentation
COMMENT ON TABLE agents IS 'Agent information and hierarchy management';
COMMENT ON TABLE customers IS 'Customer information and account management';
COMMENT ON TABLE transactions IS 'All financial transactions in the system';
COMMENT ON TABLE fraud_alerts IS 'Fraud detection alerts and investigations';
COMMENT ON TABLE audit_logs IS 'Comprehensive audit trail for compliance';
COMMENT ON TABLE account_ledger IS 'Double-entry bookkeeping ledger';

-- Grant permissions (adjust as needed for your environment)
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO remittance_app;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO remittance_app;

