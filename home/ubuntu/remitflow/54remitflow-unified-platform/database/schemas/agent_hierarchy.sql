-- Remittance Platform - 4-Tier Agent Hierarchy Database Schema
-- Comprehensive schema for Master Agents, Super Agents, Agents, and Sub Agents

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Agent Tier Enumeration
CREATE TYPE agent_tier AS ENUM ('sub_agent', 'agent', 'super_agent', 'master_agent');

-- Agent Status Enumeration
CREATE TYPE agent_status AS ENUM ('pending', 'active', 'suspended', 'inactive', 'terminated', 'under_review');

-- Territory Types
CREATE TYPE territory_type AS ENUM ('rural', 'urban', 'semi_urban', 'metropolitan');

-- Performance Rating
CREATE TYPE performance_rating AS ENUM ('excellent', 'good', 'satisfactory', 'needs_improvement', 'poor');

-- Training Status
CREATE TYPE training_status AS ENUM ('not_started', 'in_progress', 'completed', 'expired', 'failed');

-- Commission Status
CREATE TYPE commission_status AS ENUM ('pending', 'calculated', 'approved', 'paid', 'disputed', 'cancelled');

-- Document Types
CREATE TYPE document_type AS ENUM ('national_id', 'passport', 'drivers_license', 'business_license', 'tax_certificate', 'bank_statement', 'utility_bill', 'photo');

-- Verification Status
CREATE TYPE verification_status AS ENUM ('pending', 'in_progress', 'verified', 'rejected', 'expired');

-- =====================================================
-- CORE AGENT TABLES
-- =====================================================

-- Master Agents Table (Top-level network coordinators)
CREATE TABLE master_agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_code VARCHAR(20) UNIQUE NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    registration_number VARCHAR(100) UNIQUE NOT NULL,
    tax_id VARCHAR(50) UNIQUE NOT NULL,
    
    -- Contact Information
    primary_contact_name VARCHAR(255) NOT NULL,
    primary_contact_email VARCHAR(255) UNIQUE NOT NULL,
    primary_contact_phone VARCHAR(20) NOT NULL,
    secondary_contact_name VARCHAR(255),
    secondary_contact_email VARCHAR(255),
    secondary_contact_phone VARCHAR(20),
    
    -- Address Information
    headquarters_address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    state_province VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    coordinates GEOMETRY(POINT, 4326),
    
    -- Business Information
    business_type VARCHAR(100) NOT NULL,
    years_in_operation INTEGER NOT NULL,
    annual_revenue DECIMAL(15,2),
    employee_count INTEGER,
    
    -- Banking Information
    bank_name VARCHAR(255) NOT NULL,
    bank_account_number VARCHAR(50) NOT NULL,
    bank_routing_number VARCHAR(50) NOT NULL,
    bank_swift_code VARCHAR(20),
    
    -- Status and Metrics
    status agent_status DEFAULT 'pending',
    tier agent_tier DEFAULT 'master_agent',
    performance_rating performance_rating DEFAULT 'satisfactory',
    total_network_size INTEGER DEFAULT 0,
    total_transaction_volume DECIMAL(15,2) DEFAULT 0,
    total_commission_earned DECIMAL(15,2) DEFAULT 0,
    
    -- Territory Management
    assigned_regions TEXT[], -- Array of region codes
    territory_size_km2 DECIMAL(10,2),
    population_coverage INTEGER,
    
    -- Compliance and Risk
    kyb_status verification_status DEFAULT 'pending',
    kyb_completed_at TIMESTAMP,
    risk_score DECIMAL(5,2) DEFAULT 50.0,
    compliance_score DECIMAL(5,2) DEFAULT 50.0,
    last_audit_date TIMESTAMP,
    next_audit_due TIMESTAMP,
    
    -- System Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    
    -- Constraints
    CONSTRAINT master_agents_risk_score_check CHECK (risk_score >= 0 AND risk_score <= 100),
    CONSTRAINT master_agents_compliance_score_check CHECK (compliance_score >= 0 AND compliance_score <= 100)
);

-- Super Agents Table (Regional managers and supervisors)
CREATE TABLE super_agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_code VARCHAR(20) UNIQUE NOT NULL,
    master_agent_id UUID NOT NULL REFERENCES master_agents(id) ON DELETE CASCADE,
    
    -- Personal Information
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100),
    date_of_birth DATE NOT NULL,
    gender VARCHAR(10),
    nationality VARCHAR(100) NOT NULL,
    national_id VARCHAR(50) UNIQUE NOT NULL,
    
    -- Contact Information
    email VARCHAR(255) UNIQUE NOT NULL,
    phone_primary VARCHAR(20) NOT NULL,
    phone_secondary VARCHAR(20),
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(20),
    
    -- Address Information
    residential_address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    state_province VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    coordinates GEOMETRY(POINT, 4326),
    
    -- Professional Information
    education_level VARCHAR(100),
    work_experience_years INTEGER,
    previous_banking_experience BOOLEAN DEFAULT FALSE,
    languages_spoken TEXT[],
    
    -- Banking Information
    bank_name VARCHAR(255) NOT NULL,
    bank_account_number VARCHAR(50) NOT NULL,
    bank_routing_number VARCHAR(50) NOT NULL,
    
    -- Status and Performance
    status agent_status DEFAULT 'pending',
    tier agent_tier DEFAULT 'super_agent',
    performance_rating performance_rating DEFAULT 'satisfactory',
    supervised_agents_count INTEGER DEFAULT 0,
    total_transaction_volume DECIMAL(15,2) DEFAULT 0,
    total_commission_earned DECIMAL(15,2) DEFAULT 0,
    
    -- Territory Management
    assigned_territories TEXT[], -- Array of territory codes
    territory_type territory_type,
    coverage_area_km2 DECIMAL(10,2),
    population_served INTEGER,
    
    -- Training and Certification
    training_status training_status DEFAULT 'not_started',
    certification_level VARCHAR(50),
    certification_expiry_date DATE,
    last_training_date DATE,
    next_training_due DATE,
    
    -- Compliance and Risk
    kyc_status verification_status DEFAULT 'pending',
    kyc_completed_at TIMESTAMP,
    background_check_status verification_status DEFAULT 'pending',
    background_check_completed_at TIMESTAMP,
    risk_score DECIMAL(5,2) DEFAULT 50.0,
    compliance_score DECIMAL(5,2) DEFAULT 50.0,
    
    -- Performance Metrics
    monthly_transaction_target DECIMAL(15,2),
    monthly_transaction_achieved DECIMAL(15,2),
    customer_satisfaction_score DECIMAL(5,2),
    network_growth_rate DECIMAL(5,2),
    
    -- System Fields
    onboarded_at TIMESTAMP,
    activated_at TIMESTAMP,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    
    -- Constraints
    CONSTRAINT super_agents_risk_score_check CHECK (risk_score >= 0 AND risk_score <= 100),
    CONSTRAINT super_agents_compliance_score_check CHECK (compliance_score >= 0 AND compliance_score <= 100),
    CONSTRAINT super_agents_customer_satisfaction_check CHECK (customer_satisfaction_score >= 0 AND customer_satisfaction_score <= 100)
);

-- Agents Table (Primary service providers)
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_code VARCHAR(20) UNIQUE NOT NULL,
    super_agent_id UUID NOT NULL REFERENCES super_agents(id) ON DELETE CASCADE,
    master_agent_id UUID NOT NULL REFERENCES master_agents(id) ON DELETE CASCADE,
    
    -- Personal Information
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100),
    date_of_birth DATE NOT NULL,
    gender VARCHAR(10),
    nationality VARCHAR(100) NOT NULL,
    national_id VARCHAR(50) UNIQUE NOT NULL,
    
    -- Contact Information
    email VARCHAR(255) UNIQUE NOT NULL,
    phone_primary VARCHAR(20) NOT NULL,
    phone_secondary VARCHAR(20),
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(20),
    
    -- Address Information
    residential_address TEXT NOT NULL,
    business_address TEXT,
    city VARCHAR(100) NOT NULL,
    state_province VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    coordinates GEOMETRY(POINT, 4326),
    
    -- Professional Information
    education_level VARCHAR(100),
    work_experience_years INTEGER,
    previous_banking_experience BOOLEAN DEFAULT FALSE,
    business_type VARCHAR(100),
    business_registration_number VARCHAR(100),
    languages_spoken TEXT[],
    
    -- Banking Information
    bank_name VARCHAR(255) NOT NULL,
    bank_account_number VARCHAR(50) NOT NULL,
    bank_routing_number VARCHAR(50) NOT NULL,
    
    -- Status and Performance
    status agent_status DEFAULT 'pending',
    tier agent_tier DEFAULT 'agent',
    performance_rating performance_rating DEFAULT 'satisfactory',
    sub_agents_count INTEGER DEFAULT 0,
    total_transaction_volume DECIMAL(15,2) DEFAULT 0,
    total_commission_earned DECIMAL(15,2) DEFAULT 0,
    
    -- Territory and Operations
    assigned_area VARCHAR(255),
    territory_type territory_type,
    coverage_radius_km DECIMAL(8,2),
    estimated_population INTEGER,
    operating_hours VARCHAR(100),
    
    -- Training and Certification
    training_status training_status DEFAULT 'not_started',
    certification_level VARCHAR(50),
    certification_expiry_date DATE,
    last_training_date DATE,
    next_training_due DATE,
    training_score DECIMAL(5,2),
    
    -- Compliance and Risk
    kyc_status verification_status DEFAULT 'pending',
    kyc_completed_at TIMESTAMP,
    background_check_status verification_status DEFAULT 'pending',
    background_check_completed_at TIMESTAMP,
    risk_score DECIMAL(5,2) DEFAULT 50.0,
    compliance_score DECIMAL(5,2) DEFAULT 50.0,
    
    -- Performance Metrics
    daily_transaction_limit DECIMAL(15,2) DEFAULT 50000,
    monthly_transaction_limit DECIMAL(15,2) DEFAULT 1000000,
    current_daily_volume DECIMAL(15,2) DEFAULT 0,
    current_monthly_volume DECIMAL(15,2) DEFAULT 0,
    customer_count INTEGER DEFAULT 0,
    customer_satisfaction_score DECIMAL(5,2),
    
    -- Commission Configuration
    commission_rate DECIMAL(5,4) DEFAULT 0.0025, -- 0.25%
    commission_tier VARCHAR(20) DEFAULT 'standard',
    bonus_eligibility BOOLEAN DEFAULT TRUE,
    
    -- System Fields
    onboarded_at TIMESTAMP,
    activated_at TIMESTAMP,
    last_login_at TIMESTAMP,
    last_transaction_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    
    -- Constraints
    CONSTRAINT agents_risk_score_check CHECK (risk_score >= 0 AND risk_score <= 100),
    CONSTRAINT agents_compliance_score_check CHECK (compliance_score >= 0 AND compliance_score <= 100),
    CONSTRAINT agents_customer_satisfaction_check CHECK (customer_satisfaction_score >= 0 AND customer_satisfaction_score <= 100),
    CONSTRAINT agents_commission_rate_check CHECK (commission_rate >= 0 AND commission_rate <= 1)
);

-- Sub Agents Table (Local community representatives)
CREATE TABLE sub_agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_code VARCHAR(20) UNIQUE NOT NULL,
    parent_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    super_agent_id UUID NOT NULL REFERENCES super_agents(id) ON DELETE CASCADE,
    master_agent_id UUID NOT NULL REFERENCES master_agents(id) ON DELETE CASCADE,
    
    -- Personal Information
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100),
    date_of_birth DATE NOT NULL,
    gender VARCHAR(10),
    nationality VARCHAR(100) NOT NULL,
    national_id VARCHAR(50) UNIQUE NOT NULL,
    
    -- Contact Information
    email VARCHAR(255),
    phone_primary VARCHAR(20) NOT NULL,
    phone_secondary VARCHAR(20),
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(20),
    
    -- Address Information
    residential_address TEXT NOT NULL,
    business_address TEXT,
    village_community VARCHAR(255),
    city VARCHAR(100) NOT NULL,
    state_province VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20),
    coordinates GEOMETRY(POINT, 4326),
    
    -- Professional Information
    education_level VARCHAR(100),
    primary_occupation VARCHAR(100),
    community_role VARCHAR(100),
    local_language VARCHAR(100),
    literacy_level VARCHAR(50),
    
    -- Banking Information
    bank_name VARCHAR(255),
    bank_account_number VARCHAR(50),
    bank_routing_number VARCHAR(50),
    mobile_money_provider VARCHAR(100),
    mobile_money_number VARCHAR(20),
    
    -- Status and Performance
    status agent_status DEFAULT 'pending',
    tier agent_tier DEFAULT 'sub_agent',
    performance_rating performance_rating DEFAULT 'satisfactory',
    total_transaction_volume DECIMAL(15,2) DEFAULT 0,
    total_commission_earned DECIMAL(15,2) DEFAULT 0,
    
    -- Territory and Operations
    assigned_community VARCHAR(255),
    territory_type territory_type DEFAULT 'rural',
    coverage_radius_km DECIMAL(8,2) DEFAULT 5.0,
    estimated_population INTEGER,
    operating_days TEXT[], -- Array of operating days
    operating_hours VARCHAR(100),
    
    -- Training and Certification
    training_status training_status DEFAULT 'not_started',
    basic_training_completed BOOLEAN DEFAULT FALSE,
    certification_date DATE,
    last_training_date DATE,
    next_training_due DATE,
    training_score DECIMAL(5,2),
    
    -- Compliance and Risk
    kyc_status verification_status DEFAULT 'pending',
    kyc_completed_at TIMESTAMP,
    community_verification_status verification_status DEFAULT 'pending',
    community_verification_completed_at TIMESTAMP,
    risk_score DECIMAL(5,2) DEFAULT 50.0,
    
    -- Performance Metrics
    daily_transaction_limit DECIMAL(15,2) DEFAULT 10000,
    monthly_transaction_limit DECIMAL(15,2) DEFAULT 200000,
    current_daily_volume DECIMAL(15,2) DEFAULT 0,
    current_monthly_volume DECIMAL(15,2) DEFAULT 0,
    customer_count INTEGER DEFAULT 0,
    community_trust_score DECIMAL(5,2),
    
    -- Commission Configuration
    commission_rate DECIMAL(5,4) DEFAULT 0.002, -- 0.20%
    commission_tier VARCHAR(20) DEFAULT 'basic',
    
    -- System Fields
    onboarded_at TIMESTAMP,
    activated_at TIMESTAMP,
    last_activity_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    
    -- Constraints
    CONSTRAINT sub_agents_risk_score_check CHECK (risk_score >= 0 AND risk_score <= 100),
    CONSTRAINT sub_agents_community_trust_check CHECK (community_trust_score >= 0 AND community_trust_score <= 100),
    CONSTRAINT sub_agents_commission_rate_check CHECK (commission_rate >= 0 AND commission_rate <= 1)
);

-- =====================================================
-- TERRITORY MANAGEMENT TABLES
-- =====================================================

-- Territories Table
CREATE TABLE territories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    territory_code VARCHAR(20) UNIQUE NOT NULL,
    territory_name VARCHAR(255) NOT NULL,
    territory_type territory_type NOT NULL,
    
    -- Geographic Information
    country VARCHAR(100) NOT NULL,
    state_province VARCHAR(100) NOT NULL,
    region VARCHAR(100),
    district VARCHAR(100),
    boundary_coordinates GEOMETRY(POLYGON, 4326),
    center_coordinates GEOMETRY(POINT, 4326),
    area_km2 DECIMAL(10,2),
    
    -- Demographics
    population INTEGER,
    population_density DECIMAL(8,2),
    urban_population_percentage DECIMAL(5,2),
    literacy_rate DECIMAL(5,2),
    average_income DECIMAL(12,2),
    
    -- Infrastructure
    bank_branch_count INTEGER DEFAULT 0,
    atm_count INTEGER DEFAULT 0,
    mobile_network_coverage DECIMAL(5,2),
    internet_penetration DECIMAL(5,2),
    road_connectivity_score DECIMAL(5,2),
    
    -- Assignment Information
    master_agent_id UUID REFERENCES master_agents(id),
    super_agent_id UUID REFERENCES super_agents(id),
    assigned_at TIMESTAMP,
    
    -- Performance Metrics
    total_agents INTEGER DEFAULT 0,
    total_customers INTEGER DEFAULT 0,
    monthly_transaction_volume DECIMAL(15,2) DEFAULT 0,
    market_penetration DECIMAL(5,2) DEFAULT 0,
    
    -- System Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID
);

-- Territory Assignments Table
CREATE TABLE territory_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    territory_id UUID NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL,
    agent_tier agent_tier NOT NULL,
    
    -- Assignment Details
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by UUID NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    assignment_type VARCHAR(50) DEFAULT 'primary', -- primary, secondary, temporary
    
    -- Performance Targets
    monthly_transaction_target DECIMAL(15,2),
    customer_acquisition_target INTEGER,
    market_share_target DECIMAL(5,2),
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    
    -- System Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(territory_id, agent_id, effective_from)
);

-- =====================================================
-- PERFORMANCE AND METRICS TABLES
-- =====================================================

-- Agent Performance Metrics Table
CREATE TABLE agent_performance_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL,
    agent_tier agent_tier NOT NULL,
    
    -- Time Period
    metric_date DATE NOT NULL,
    metric_period VARCHAR(20) NOT NULL, -- daily, weekly, monthly, quarterly, yearly
    
    -- Transaction Metrics
    transaction_count INTEGER DEFAULT 0,
    transaction_volume DECIMAL(15,2) DEFAULT 0,
    average_transaction_size DECIMAL(12,2) DEFAULT 0,
    successful_transactions INTEGER DEFAULT 0,
    failed_transactions INTEGER DEFAULT 0,
    success_rate DECIMAL(5,2) DEFAULT 0,
    
    -- Customer Metrics
    new_customers_acquired INTEGER DEFAULT 0,
    total_active_customers INTEGER DEFAULT 0,
    customer_retention_rate DECIMAL(5,2) DEFAULT 0,
    customer_satisfaction_score DECIMAL(5,2) DEFAULT 0,
    
    -- Financial Metrics
    commission_earned DECIMAL(12,2) DEFAULT 0,
    revenue_generated DECIMAL(15,2) DEFAULT 0,
    cost_per_transaction DECIMAL(8,2) DEFAULT 0,
    profit_margin DECIMAL(5,2) DEFAULT 0,
    
    -- Operational Metrics
    uptime_percentage DECIMAL(5,2) DEFAULT 0,
    response_time_avg_seconds DECIMAL(8,2) DEFAULT 0,
    error_rate DECIMAL(5,2) DEFAULT 0,
    compliance_score DECIMAL(5,2) DEFAULT 0,
    
    -- Network Metrics (for higher tiers)
    network_size INTEGER DEFAULT 0,
    network_performance_score DECIMAL(5,2) DEFAULT 0,
    network_growth_rate DECIMAL(5,2) DEFAULT 0,
    
    -- System Fields
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(agent_id, metric_date, metric_period)
);

-- Commission Calculations Table
CREATE TABLE commission_calculations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL,
    agent_tier agent_tier NOT NULL,
    
    -- Calculation Period
    calculation_date DATE NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Base Commission
    base_transaction_volume DECIMAL(15,2) NOT NULL,
    base_commission_rate DECIMAL(5,4) NOT NULL,
    base_commission_amount DECIMAL(12,2) NOT NULL,
    
    -- Hierarchical Commission (for higher tiers)
    downstream_volume DECIMAL(15,2) DEFAULT 0,
    downstream_commission_rate DECIMAL(5,4) DEFAULT 0,
    downstream_commission_amount DECIMAL(12,2) DEFAULT 0,
    
    -- Performance Bonuses
    performance_bonus_amount DECIMAL(12,2) DEFAULT 0,
    target_achievement_bonus DECIMAL(12,2) DEFAULT 0,
    quality_bonus DECIMAL(12,2) DEFAULT 0,
    
    -- Deductions
    penalty_amount DECIMAL(12,2) DEFAULT 0,
    chargeback_amount DECIMAL(12,2) DEFAULT 0,
    adjustment_amount DECIMAL(12,2) DEFAULT 0,
    
    -- Final Calculation
    gross_commission DECIMAL(12,2) NOT NULL,
    tax_amount DECIMAL(12,2) DEFAULT 0,
    net_commission DECIMAL(12,2) NOT NULL,
    
    -- Payment Information
    payment_status commission_status DEFAULT 'pending',
    payment_date DATE,
    payment_reference VARCHAR(100),
    
    -- System Fields
    calculated_by UUID NOT NULL,
    approved_by UUID,
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- TRAINING AND CERTIFICATION TABLES
-- =====================================================

-- Training Modules Table
CREATE TABLE training_modules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_code VARCHAR(20) UNIQUE NOT NULL,
    module_name VARCHAR(255) NOT NULL,
    module_description TEXT,
    
    -- Module Configuration
    target_tier agent_tier NOT NULL,
    is_mandatory BOOLEAN DEFAULT TRUE,
    prerequisite_modules UUID[],
    estimated_duration_hours INTEGER NOT NULL,
    passing_score DECIMAL(5,2) DEFAULT 70.0,
    
    -- Content Information
    content_type VARCHAR(50), -- video, interactive, document, quiz
    content_url TEXT,
    content_version VARCHAR(20),
    
    -- Validity
    validity_period_months INTEGER DEFAULT 12,
    is_active BOOLEAN DEFAULT TRUE,
    
    -- System Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID
);

-- Agent Training Records Table
CREATE TABLE agent_training_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL,
    agent_tier agent_tier NOT NULL,
    training_module_id UUID NOT NULL REFERENCES training_modules(id),
    
    -- Training Progress
    status training_status DEFAULT 'not_started',
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    progress_percentage DECIMAL(5,2) DEFAULT 0,
    
    -- Assessment Results
    attempts_count INTEGER DEFAULT 0,
    best_score DECIMAL(5,2) DEFAULT 0,
    latest_score DECIMAL(5,2) DEFAULT 0,
    passed BOOLEAN DEFAULT FALSE,
    
    -- Certification
    certificate_issued BOOLEAN DEFAULT FALSE,
    certificate_number VARCHAR(100),
    certificate_issued_at TIMESTAMP,
    certificate_expires_at TIMESTAMP,
    
    -- System Fields
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(agent_id, training_module_id)
);

-- =====================================================
-- DOCUMENT MANAGEMENT TABLES
-- =====================================================

-- Agent Documents Table
CREATE TABLE agent_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL,
    agent_tier agent_tier NOT NULL,
    
    -- Document Information
    document_type document_type NOT NULL,
    document_name VARCHAR(255) NOT NULL,
    document_number VARCHAR(100),
    issuing_authority VARCHAR(255),
    issue_date DATE,
    expiry_date DATE,
    
    -- File Information
    file_path TEXT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size_bytes BIGINT,
    file_type VARCHAR(50),
    file_hash VARCHAR(128),
    
    -- Verification Status
    verification_status verification_status DEFAULT 'pending',
    verified_at TIMESTAMP,
    verified_by UUID,
    verification_notes TEXT,
    
    -- OCR and AI Processing
    ocr_processed BOOLEAN DEFAULT FALSE,
    ocr_confidence DECIMAL(5,2),
    extracted_text TEXT,
    ai_verification_score DECIMAL(5,2),
    
    -- System Fields
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    uploaded_by UUID
);

-- =====================================================
-- AUDIT AND COMPLIANCE TABLES
-- =====================================================

-- Agent Audit Trail Table
CREATE TABLE agent_audit_trail (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL,
    agent_tier agent_tier NOT NULL,
    
    -- Action Information
    action_type VARCHAR(100) NOT NULL,
    action_description TEXT NOT NULL,
    old_values JSONB,
    new_values JSONB,
    
    -- Context
    ip_address INET,
    user_agent TEXT,
    session_id VARCHAR(255),
    
    -- System Fields
    performed_by UUID NOT NULL,
    performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes for performance
    INDEX idx_agent_audit_agent_id (agent_id),
    INDEX idx_agent_audit_performed_at (performed_at),
    INDEX idx_agent_audit_action_type (action_type)
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Master Agents Indexes
CREATE INDEX idx_master_agents_status ON master_agents(status);
CREATE INDEX idx_master_agents_performance_rating ON master_agents(performance_rating);
CREATE INDEX idx_master_agents_kyb_status ON master_agents(kyb_status);
CREATE INDEX idx_master_agents_coordinates ON master_agents USING GIST(coordinates);

-- Super Agents Indexes
CREATE INDEX idx_super_agents_master_agent_id ON super_agents(master_agent_id);
CREATE INDEX idx_super_agents_status ON super_agents(status);
CREATE INDEX idx_super_agents_performance_rating ON super_agents(performance_rating);
CREATE INDEX idx_super_agents_coordinates ON super_agents USING GIST(coordinates);

-- Agents Indexes
CREATE INDEX idx_agents_super_agent_id ON agents(super_agent_id);
CREATE INDEX idx_agents_master_agent_id ON agents(master_agent_id);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_performance_rating ON agents(performance_rating);
CREATE INDEX idx_agents_coordinates ON agents USING GIST(coordinates);

-- Sub Agents Indexes
CREATE INDEX idx_sub_agents_parent_agent_id ON sub_agents(parent_agent_id);
CREATE INDEX idx_sub_agents_super_agent_id ON sub_agents(super_agent_id);
CREATE INDEX idx_sub_agents_master_agent_id ON sub_agents(master_agent_id);
CREATE INDEX idx_sub_agents_status ON sub_agents(status);
CREATE INDEX idx_sub_agents_coordinates ON sub_agents USING GIST(coordinates);

-- Territory Indexes
CREATE INDEX idx_territories_master_agent_id ON territories(master_agent_id);
CREATE INDEX idx_territories_super_agent_id ON territories(super_agent_id);
CREATE INDEX idx_territories_boundary_coordinates ON territories USING GIST(boundary_coordinates);
CREATE INDEX idx_territories_center_coordinates ON territories USING GIST(center_coordinates);

-- Performance Metrics Indexes
CREATE INDEX idx_performance_metrics_agent_id ON agent_performance_metrics(agent_id);
CREATE INDEX idx_performance_metrics_date ON agent_performance_metrics(metric_date);
CREATE INDEX idx_performance_metrics_period ON agent_performance_metrics(metric_period);

-- Commission Calculations Indexes
CREATE INDEX idx_commission_calculations_agent_id ON commission_calculations(agent_id);
CREATE INDEX idx_commission_calculations_date ON commission_calculations(calculation_date);
CREATE INDEX idx_commission_calculations_status ON commission_calculations(payment_status);

-- Training Records Indexes
CREATE INDEX idx_training_records_agent_id ON agent_training_records(agent_id);
CREATE INDEX idx_training_records_module_id ON agent_training_records(training_module_id);
CREATE INDEX idx_training_records_status ON agent_training_records(status);

-- Documents Indexes
CREATE INDEX idx_agent_documents_agent_id ON agent_documents(agent_id);
CREATE INDEX idx_agent_documents_type ON agent_documents(document_type);
CREATE INDEX idx_agent_documents_verification_status ON agent_documents(verification_status);

-- =====================================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update triggers to all main tables
CREATE TRIGGER update_master_agents_updated_at BEFORE UPDATE ON master_agents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_super_agents_updated_at BEFORE UPDATE ON super_agents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sub_agents_updated_at BEFORE UPDATE ON sub_agents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_territories_updated_at BEFORE UPDATE ON territories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_agent_documents_updated_at BEFORE UPDATE ON agent_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================

-- Complete Agent Hierarchy View
CREATE VIEW agent_hierarchy_view AS
SELECT 
    'master_agent' as agent_type,
    ma.id,
    ma.agent_code,
    ma.company_name as name,
    ma.primary_contact_email as email,
    ma.primary_contact_phone as phone,
    ma.status,
    ma.performance_rating,
    ma.total_network_size,
    ma.total_transaction_volume,
    ma.coordinates,
    NULL::UUID as parent_id,
    ma.created_at
FROM master_agents ma

UNION ALL

SELECT 
    'super_agent' as agent_type,
    sa.id,
    sa.agent_code,
    CONCAT(sa.first_name, ' ', sa.last_name) as name,
    sa.email,
    sa.phone_primary as phone,
    sa.status,
    sa.performance_rating,
    sa.supervised_agents_count as total_network_size,
    sa.total_transaction_volume,
    sa.coordinates,
    sa.master_agent_id as parent_id,
    sa.created_at
FROM super_agents sa

UNION ALL

SELECT 
    'agent' as agent_type,
    a.id,
    a.agent_code,
    CONCAT(a.first_name, ' ', a.last_name) as name,
    a.email,
    a.phone_primary as phone,
    a.status,
    a.performance_rating,
    a.sub_agents_count as total_network_size,
    a.total_transaction_volume,
    a.coordinates,
    a.super_agent_id as parent_id,
    a.created_at
FROM agents a

UNION ALL

SELECT 
    'sub_agent' as agent_type,
    sa.id,
    sa.agent_code,
    CONCAT(sa.first_name, ' ', sa.last_name) as name,
    sa.email,
    sa.phone_primary as phone,
    sa.status,
    sa.performance_rating,
    0 as total_network_size,
    sa.total_transaction_volume,
    sa.coordinates,
    sa.parent_agent_id as parent_id,
    sa.created_at
FROM sub_agents sa;

-- Agent Performance Summary View
CREATE VIEW agent_performance_summary AS
SELECT 
    apm.agent_id,
    ahv.agent_type,
    ahv.name,
    ahv.agent_code,
    SUM(apm.transaction_volume) as total_volume,
    AVG(apm.success_rate) as avg_success_rate,
    AVG(apm.customer_satisfaction_score) as avg_satisfaction,
    COUNT(DISTINCT apm.metric_date) as reporting_days,
    MAX(apm.calculated_at) as last_updated
FROM agent_performance_metrics apm
JOIN agent_hierarchy_view ahv ON apm.agent_id = ahv.id
WHERE apm.metric_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY apm.agent_id, ahv.agent_type, ahv.name, ahv.agent_code;

-- Territory Coverage View
CREATE VIEW territory_coverage_view AS
SELECT 
    t.id as territory_id,
    t.territory_name,
    t.territory_type,
    t.population,
    t.area_km2,
    COUNT(DISTINCT CASE WHEN ahv.agent_type = 'master_agent' THEN ahv.id END) as master_agents,
    COUNT(DISTINCT CASE WHEN ahv.agent_type = 'super_agent' THEN ahv.id END) as super_agents,
    COUNT(DISTINCT CASE WHEN ahv.agent_type = 'agent' THEN ahv.id END) as agents,
    COUNT(DISTINCT CASE WHEN ahv.agent_type = 'sub_agent' THEN ahv.id END) as sub_agents,
    t.monthly_transaction_volume,
    t.market_penetration
FROM territories t
LEFT JOIN territory_assignments ta ON t.id = ta.territory_id AND ta.is_active = TRUE
LEFT JOIN agent_hierarchy_view ahv ON ta.agent_id = ahv.id
GROUP BY t.id, t.territory_name, t.territory_type, t.population, t.area_km2, t.monthly_transaction_volume, t.market_penetration;

-- Commission Summary View
CREATE VIEW commission_summary_view AS
SELECT 
    cc.agent_id,
    ahv.agent_type,
    ahv.name,
    ahv.agent_code,
    DATE_TRUNC('month', cc.calculation_date) as month,
    SUM(cc.base_commission_amount) as total_base_commission,
    SUM(cc.downstream_commission_amount) as total_downstream_commission,
    SUM(cc.performance_bonus_amount) as total_bonuses,
    SUM(cc.net_commission) as total_net_commission,
    COUNT(*) as payment_count,
    COUNT(CASE WHEN cc.payment_status = 'paid' THEN 1 END) as paid_count
FROM commission_calculations cc
JOIN agent_hierarchy_view ahv ON cc.agent_id = ahv.id
GROUP BY cc.agent_id, ahv.agent_type, ahv.name, ahv.agent_code, DATE_TRUNC('month', cc.calculation_date);

-- Training Progress View
CREATE VIEW training_progress_view AS
SELECT 
    atr.agent_id,
    ahv.agent_type,
    ahv.name,
    ahv.agent_code,
    COUNT(tm.id) as total_modules,
    COUNT(CASE WHEN atr.status = 'completed' THEN 1 END) as completed_modules,
    COUNT(CASE WHEN atr.status = 'in_progress' THEN 1 END) as in_progress_modules,
    COUNT(CASE WHEN atr.passed = TRUE THEN 1 END) as passed_modules,
    ROUND(
        (COUNT(CASE WHEN atr.status = 'completed' THEN 1 END)::DECIMAL / COUNT(tm.id)) * 100, 
        2
    ) as completion_percentage
FROM agent_training_records atr
JOIN training_modules tm ON atr.training_module_id = tm.id
JOIN agent_hierarchy_view ahv ON atr.agent_id = ahv.id
WHERE tm.is_active = TRUE
GROUP BY atr.agent_id, ahv.agent_type, ahv.name, ahv.agent_code;

-- Document Verification Status View
CREATE VIEW document_verification_status_view AS
SELECT 
    ad.agent_id,
    ahv.agent_type,
    ahv.name,
    ahv.agent_code,
    COUNT(*) as total_documents,
    COUNT(CASE WHEN ad.verification_status = 'verified' THEN 1 END) as verified_documents,
    COUNT(CASE WHEN ad.verification_status = 'pending' THEN 1 END) as pending_documents,
    COUNT(CASE WHEN ad.verification_status = 'rejected' THEN 1 END) as rejected_documents,
    ROUND(
        (COUNT(CASE WHEN ad.verification_status = 'verified' THEN 1 END)::DECIMAL / COUNT(*)) * 100, 
        2
    ) as verification_percentage
FROM agent_documents ad
JOIN agent_hierarchy_view ahv ON ad.agent_id = ahv.id
GROUP BY ad.agent_id, ahv.agent_type, ahv.name, ahv.agent_code;

-- =====================================================
-- SAMPLE DATA INSERTION (for testing)
-- =====================================================

-- Insert sample master agent
INSERT INTO master_agents (
    agent_code, company_name, registration_number, tax_id,
    primary_contact_name, primary_contact_email, primary_contact_phone,
    headquarters_address, city, state_province, country, postal_code,
    business_type, years_in_operation, annual_revenue, employee_count,
    bank_name, bank_account_number, bank_routing_number,
    coordinates
) VALUES (
    'MA001', 'African Financial Services Ltd', 'REG123456789', 'TAX987654321',
    'John Doe', 'john.doe@afs.com', '+234-800-123-4567',
    '123 Banking Street, Victoria Island', 'Lagos', 'Lagos State', 'Nigeria', '101001',
    'Financial Services', 15, 50000000.00, 250,
    'First Bank of Nigeria', '1234567890', 'FBN011152003',
    ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)
);

-- Insert sample super agent
INSERT INTO super_agents (
    agent_code, master_agent_id, first_name, last_name, date_of_birth,
    nationality, national_id, email, phone_primary,
    residential_address, city, state_province, country, postal_code,
    education_level, work_experience_years, languages_spoken,
    bank_name, bank_account_number, bank_routing_number,
    coordinates
) VALUES (
    'SA001', (SELECT id FROM master_agents WHERE agent_code = 'MA001'),
    'Jane', 'Smith', '1985-03-15',
    'Nigerian', 'NIN12345678901', 'jane.smith@email.com', '+234-803-123-4567',
    '456 Residential Avenue, Ikeja', 'Lagos', 'Lagos State', 'Nigeria', '101002',
    'Bachelor Degree', 8, ARRAY['English', 'Yoruba', 'Hausa'],
    'Access Bank', '0987654321', 'ACC044150149',
    ST_SetSRID(ST_MakePoint(3.3567, 6.6018), 4326)
);

-- Insert sample agent
INSERT INTO agents (
    agent_code, super_agent_id, master_agent_id, first_name, last_name, date_of_birth,
    nationality, national_id, email, phone_primary,
    residential_address, city, state_province, country, postal_code,
    education_level, work_experience_years, business_type,
    bank_name, bank_account_number, bank_routing_number,
    coordinates
) VALUES (
    'AG001', 
    (SELECT id FROM super_agents WHERE agent_code = 'SA001'),
    (SELECT id FROM master_agents WHERE agent_code = 'MA001'),
    'Michael', 'Johnson', '1990-07-22',
    'Nigerian', 'NIN98765432109', 'michael.johnson@email.com', '+234-805-123-4567',
    '789 Agent Street, Surulere', 'Lagos', 'Lagos State', 'Nigeria', '101003',
    'High School', 5, 'Retail Business',
    'GTBank', '1122334455', 'GTB058152036',
    ST_SetSRID(ST_MakePoint(3.3515, 6.4969), 4326)
);

-- Insert sample sub agent
INSERT INTO sub_agents (
    agent_code, parent_agent_id, super_agent_id, master_agent_id,
    first_name, last_name, date_of_birth,
    nationality, national_id, phone_primary,
    residential_address, village_community, city, state_province, country,
    education_level, primary_occupation, community_role, local_language,
    mobile_money_provider, mobile_money_number,
    coordinates
) VALUES (
    'SUB001',
    (SELECT id FROM agents WHERE agent_code = 'AG001'),
    (SELECT id FROM super_agents WHERE agent_code = 'SA001'),
    (SELECT id FROM master_agents WHERE agent_code = 'MA001'),
    'Amina', 'Bello', '1995-12-10',
    'Nigerian', 'NIN11223344556', '+234-807-123-4567',
    'Village Square, Epe Community', 'Epe', 'Lagos', 'Lagos State', 'Nigeria',
    'Primary School', 'Farmer', 'Community Leader', 'Yoruba',
    'MTN Mobile Money', '+234-807-123-4567',
    ST_SetSRID(ST_MakePoint(3.9833, 6.5833), 4326)
);

-- Insert sample territory
INSERT INTO territories (
    territory_code, territory_name, territory_type,
    country, state_province, region, district,
    area_km2, population, population_density,
    master_agent_id, super_agent_id,
    center_coordinates
) VALUES (
    'TER001', 'Lagos Metropolitan Area', 'metropolitan',
    'Nigeria', 'Lagos State', 'Southwest', 'Lagos Mainland',
    1171.28, 15000000, 12810.74,
    (SELECT id FROM master_agents WHERE agent_code = 'MA001'),
    (SELECT id FROM super_agents WHERE agent_code = 'SA001'),
    ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)
);

-- Insert sample training modules
INSERT INTO training_modules (
    module_code, module_name, module_description, target_tier,
    estimated_duration_hours, content_type
) VALUES 
('TM001', 'Basic Banking Operations', 'Introduction to basic banking services and operations', 'sub_agent', 4, 'video'),
('TM002', 'Customer Service Excellence', 'Advanced customer service training for agents', 'agent', 6, 'interactive'),
('TM003', 'Network Management', 'Training for managing agent networks', 'super_agent', 8, 'video'),
('TM004', 'Strategic Leadership', 'Leadership and strategic planning for master agents', 'master_agent', 12, 'interactive');

-- =====================================================
-- COMMENTS AND DOCUMENTATION
-- =====================================================

COMMENT ON TABLE master_agents IS 'Top-level network coordinators responsible for overall network management';
COMMENT ON TABLE super_agents IS 'Regional managers and supervisors who oversee multiple agents';
COMMENT ON TABLE agents IS 'Primary service providers who directly serve customers';
COMMENT ON TABLE sub_agents IS 'Local community representatives providing basic banking services';
COMMENT ON TABLE territories IS 'Geographic territories for agent assignment and management';
COMMENT ON TABLE agent_performance_metrics IS 'Performance tracking and analytics for all agent tiers';
COMMENT ON TABLE commission_calculations IS 'Commission calculations and payment tracking';
COMMENT ON TABLE training_modules IS 'Training content and certification requirements';
COMMENT ON TABLE agent_training_records IS 'Individual agent training progress and certification status';
COMMENT ON TABLE agent_documents IS 'Document storage and verification for KYC/KYB compliance';
COMMENT ON TABLE agent_audit_trail IS 'Comprehensive audit trail for all agent-related activities';

-- End of Agent Hierarchy Database Schema

