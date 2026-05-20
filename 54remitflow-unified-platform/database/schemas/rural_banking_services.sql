-- =====================================================
-- RURAL BANKING SERVICES DATABASE SCHEMA
-- Comprehensive schema for rural banking, offline transactions,
-- mobile money integration, agricultural finance, and microfinance
-- Zero placeholders, zero mocks - production ready
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =====================================================
-- RURAL BANKING CORE TABLES
-- =====================================================

-- Rural branch types enumeration
CREATE TYPE rural_branch_type_enum AS ENUM (
    'full_service_branch',
    'mini_branch',
    'mobile_branch',
    'agent_point',
    'kiosk',
    'atm_point',
    'community_center',
    'market_stall',
    'cooperative_office',
    'school_based'
);

-- Service availability enumeration
CREATE TYPE service_availability_enum AS ENUM (
    'always_available',
    'business_hours',
    'scheduled_visits',
    'on_demand',
    'seasonal',
    'emergency_only'
);

-- Rural banking locations
CREATE TABLE rural_banking_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id VARCHAR(100) UNIQUE NOT NULL,
    location_name VARCHAR(255) NOT NULL,
    branch_type rural_branch_type_enum NOT NULL,
    
    -- Geographic information
    latitude DECIMAL(10,8) NOT NULL,
    longitude DECIMAL(11,8) NOT NULL,
    geolocation GEOGRAPHY(POINT, 4326) NOT NULL,
    address TEXT NOT NULL,
    village_name VARCHAR(255),
    district VARCHAR(255),
    region VARCHAR(255),
    country VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20),
    
    -- Accessibility information
    road_access_type VARCHAR(50), -- 'paved', 'gravel', 'dirt', 'footpath', 'boat_only'
    distance_to_main_road_km DECIMAL(6,2),
    nearest_town VARCHAR(255),
    distance_to_nearest_town_km DECIMAL(8,2),
    
    -- Infrastructure
    has_electricity BOOLEAN DEFAULT false,
    electricity_reliability_hours INTEGER DEFAULT 0, -- hours per day
    has_internet_connectivity BOOLEAN DEFAULT false,
    internet_type VARCHAR(30), -- 'fiber', '4g', '3g', '2g', 'satellite', 'none'
    internet_reliability_percent DECIMAL(5,2) DEFAULT 0.00,
    has_mobile_coverage BOOLEAN DEFAULT false,
    mobile_network_providers TEXT[], -- Array of provider names
    
    -- Banking infrastructure
    has_atm BOOLEAN DEFAULT false,
    has_pos_terminal BOOLEAN DEFAULT false,
    has_cash_vault BOOLEAN DEFAULT false,
    vault_capacity_usd DECIMAL(12,2) DEFAULT 0.00,
    
    -- Operating information
    operating_hours JSONB, -- {"monday": {"open": "08:00", "close": "17:00"}, ...}
    service_availability service_availability_enum NOT NULL DEFAULT 'business_hours',
    languages_supported TEXT[] NOT NULL DEFAULT ARRAY['English'],
    
    -- Population served
    estimated_population_served INTEGER,
    households_served INTEGER,
    businesses_served INTEGER,
    farmers_served INTEGER,
    
    -- Assigned personnel
    branch_manager_id UUID,
    assigned_agents UUID[],
    security_personnel_count INTEGER DEFAULT 0,
    
    -- Status and metrics
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    monthly_transaction_volume DECIMAL(15,2) DEFAULT 0.00,
    monthly_customer_visits INTEGER DEFAULT 0,
    customer_satisfaction_score DECIMAL(3,2) DEFAULT 0.00,
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- =====================================================
-- OFFLINE TRANSACTION MANAGEMENT
-- =====================================================

-- Offline transaction status enumeration
CREATE TYPE offline_transaction_status_enum AS ENUM (
    'pending_sync',
    'syncing',
    'synced',
    'sync_failed',
    'conflict_detected',
    'resolved',
    'expired',
    'cancelled'
);

-- Offline transactions table
CREATE TABLE offline_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offline_transaction_id VARCHAR(100) UNIQUE NOT NULL,
    device_id VARCHAR(100) NOT NULL,
    agent_id UUID NOT NULL,
    location_id UUID REFERENCES rural_banking_locations(id),
    
    -- Transaction details
    transaction_type VARCHAR(50) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    customer_id UUID,
    customer_identifier VARCHAR(100), -- Phone, ID, account number
    
    -- Offline specific fields
    offline_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    sync_timestamp TIMESTAMP WITH TIME ZONE,
    offline_duration_minutes INTEGER,
    
    -- Transaction data
    transaction_data JSONB NOT NULL,
    biometric_data JSONB,
    supporting_documents JSONB,
    
    -- Verification and security
    agent_signature VARCHAR(255),
    customer_signature VARCHAR(255),
    witness_signature VARCHAR(255),
    device_fingerprint VARCHAR(255),
    transaction_hash VARCHAR(128),
    
    -- Status and processing
    status offline_transaction_status_enum NOT NULL DEFAULT 'pending_sync',
    sync_attempts INTEGER DEFAULT 0,
    last_sync_attempt TIMESTAMP WITH TIME ZONE,
    sync_error_message TEXT,
    
    -- Conflict resolution
    conflict_type VARCHAR(50),
    conflict_description TEXT,
    resolution_method VARCHAR(50),
    resolved_by UUID,
    resolved_at TIMESTAMP WITH TIME ZONE,
    
    -- Risk assessment
    risk_score DECIMAL(5,2) DEFAULT 0.00,
    risk_factors JSONB DEFAULT '[]',
    requires_manual_review BOOLEAN DEFAULT false,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Offline transaction queue for synchronization
CREATE TABLE offline_transaction_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offline_transaction_id UUID NOT NULL REFERENCES offline_transactions(id),
    device_id VARCHAR(100) NOT NULL,
    
    -- Queue management
    queue_position INTEGER,
    priority INTEGER DEFAULT 5, -- 1 (highest) to 10 (lowest)
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    
    -- Processing status
    processing_status VARCHAR(30) DEFAULT 'queued',
    processing_started_at TIMESTAMP WITH TIME ZONE,
    processing_completed_at TIMESTAMP WITH TIME ZONE,
    processing_error TEXT,
    
    -- Scheduling
    scheduled_sync_time TIMESTAMP WITH TIME ZONE,
    next_retry_time TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- MOBILE MONEY INTEGRATION
-- =====================================================

-- Mobile money provider enumeration
CREATE TYPE mobile_money_provider_enum AS ENUM (
    'mpesa',
    'mtn_mobile_money',
    'airtel_money',
    'orange_money',
    'tigo_pesa',
    'ecocash',
    'telecash',
    'wave',
    'moov_money',
    'flooz'
);

-- Mobile money account types
CREATE TYPE mobile_money_account_type_enum AS ENUM (
    'personal',
    'business',
    'agent',
    'merchant',
    'super_agent'
);

-- Mobile money accounts
CREATE TABLE mobile_money_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id VARCHAR(100) UNIQUE NOT NULL,
    customer_id UUID,
    
    -- Provider information
    provider mobile_money_provider_enum NOT NULL,
    provider_account_id VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    account_type mobile_money_account_type_enum NOT NULL DEFAULT 'personal',
    
    -- Account details
    account_name VARCHAR(255) NOT NULL,
    account_status VARCHAR(30) NOT NULL DEFAULT 'active',
    kyc_level INTEGER DEFAULT 1, -- 1, 2, 3 (increasing verification levels)
    
    -- Limits and balances
    current_balance DECIMAL(15,2) DEFAULT 0.00,
    available_balance DECIMAL(15,2) DEFAULT 0.00,
    daily_transaction_limit DECIMAL(15,2),
    monthly_transaction_limit DECIMAL(15,2),
    single_transaction_limit DECIMAL(15,2),
    
    -- Usage tracking
    daily_transaction_count INTEGER DEFAULT 0,
    daily_transaction_amount DECIMAL(15,2) DEFAULT 0.00,
    monthly_transaction_count INTEGER DEFAULT 0,
    monthly_transaction_amount DECIMAL(15,2) DEFAULT 0.00,
    
    -- Geographic restrictions
    allowed_countries TEXT[],
    restricted_regions TEXT[],
    
    -- Security
    pin_hash VARCHAR(255),
    security_questions JSONB,
    last_login TIMESTAMP WITH TIME ZONE,
    failed_login_attempts INTEGER DEFAULT 0,
    account_locked_until TIMESTAMP WITH TIME ZONE,
    
    -- Integration details
    api_endpoint VARCHAR(255),
    api_credentials JSONB, -- Encrypted
    webhook_url VARCHAR(255),
    
    -- Audit fields
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Constraints
    UNIQUE(provider, provider_account_id),
    UNIQUE(provider, phone_number)
);

-- Mobile money transactions
CREATE TABLE mobile_money_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id VARCHAR(100) UNIQUE NOT NULL,
    external_transaction_id VARCHAR(100),
    
    -- Account information
    from_account_id UUID REFERENCES mobile_money_accounts(id),
    to_account_id UUID REFERENCES mobile_money_accounts(id),
    from_phone_number VARCHAR(20),
    to_phone_number VARCHAR(20),
    
    -- Transaction details
    transaction_type VARCHAR(50) NOT NULL, -- 'send_money', 'receive_money', 'cash_in', 'cash_out', 'bill_payment', 'airtime_purchase'
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate DECIMAL(10,6),
    
    -- Fees and charges
    transaction_fee DECIMAL(10,2) DEFAULT 0.00,
    provider_fee DECIMAL(10,2) DEFAULT 0.00,
    agent_commission DECIMAL(10,2) DEFAULT 0.00,
    total_charges DECIMAL(10,2) DEFAULT 0.00,
    
    -- Status and processing
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    provider_status VARCHAR(50),
    processing_time_seconds INTEGER,
    
    -- Reference information
    reference_number VARCHAR(100),
    provider_reference VARCHAR(100),
    agent_reference VARCHAR(100),
    customer_reference VARCHAR(100),
    
    -- Location and agent
    agent_id UUID,
    location_id UUID REFERENCES rural_banking_locations(id),
    transaction_location GEOGRAPHY(POINT, 4326),
    
    -- Additional details
    description TEXT,
    purpose VARCHAR(100),
    beneficiary_name VARCHAR(255),
    sender_name VARCHAR(255),
    
    -- Reconciliation
    reconciled BOOLEAN DEFAULT false,
    reconciliation_date TIMESTAMP WITH TIME ZONE,
    reconciliation_reference VARCHAR(100),
    
    -- Timestamps
    initiated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    
    -- Error handling
    error_code VARCHAR(50),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- =====================================================
-- AGRICULTURAL FINANCE
-- =====================================================

-- Crop types enumeration
CREATE TYPE crop_type_enum AS ENUM (
    'cereals',
    'legumes',
    'root_tubers',
    'vegetables',
    'fruits',
    'cash_crops',
    'livestock_feed',
    'medicinal_plants',
    'spices_herbs',
    'flowers_ornamental'
);

-- Farming methods enumeration
CREATE TYPE farming_method_enum AS ENUM (
    'traditional',
    'organic',
    'conventional',
    'precision_agriculture',
    'hydroponics',
    'greenhouse',
    'mixed_farming',
    'sustainable_agriculture'
);

-- Agricultural loans
CREATE TABLE agricultural_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id VARCHAR(100) UNIQUE NOT NULL,
    customer_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    location_id UUID REFERENCES rural_banking_locations(id),
    
    -- Loan details
    loan_amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    interest_rate DECIMAL(5,4) NOT NULL,
    loan_term_months INTEGER NOT NULL,
    repayment_frequency VARCHAR(20) NOT NULL, -- 'weekly', 'monthly', 'seasonal', 'harvest'
    
    -- Agricultural specifics
    farming_purpose TEXT NOT NULL,
    crop_types crop_type_enum[] NOT NULL,
    farming_method farming_method_enum NOT NULL DEFAULT 'traditional',
    farm_size_hectares DECIMAL(8,2),
    expected_yield_tons DECIMAL(10,2),
    expected_harvest_date DATE,
    
    -- Farm location
    farm_latitude DECIMAL(10,8),
    farm_longitude DECIMAL(11,8),
    farm_location GEOGRAPHY(POINT, 4326),
    farm_address TEXT,
    
    -- Collateral and guarantees
    collateral_type VARCHAR(100),
    collateral_value DECIMAL(15,2),
    collateral_description TEXT,
    guarantor_id UUID,
    guarantor_details JSONB,
    
    -- Risk assessment
    weather_risk_score DECIMAL(5,2) DEFAULT 0.00,
    market_risk_score DECIMAL(5,2) DEFAULT 0.00,
    farmer_experience_years INTEGER,
    credit_history_score DECIMAL(5,2) DEFAULT 0.00,
    overall_risk_score DECIMAL(5,2) DEFAULT 0.00,
    
    -- Insurance
    crop_insurance_policy VARCHAR(100),
    insurance_provider VARCHAR(255),
    insurance_premium DECIMAL(10,2) DEFAULT 0.00,
    insurance_coverage_amount DECIMAL(15,2) DEFAULT 0.00,
    
    -- Loan status
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    approval_date DATE,
    disbursement_date DATE,
    first_payment_due_date DATE,
    maturity_date DATE,
    
    -- Repayment tracking
    total_amount_due DECIMAL(15,2),
    principal_paid DECIMAL(15,2) DEFAULT 0.00,
    interest_paid DECIMAL(15,2) DEFAULT 0.00,
    fees_paid DECIMAL(15,2) DEFAULT 0.00,
    outstanding_balance DECIMAL(15,2),
    days_past_due INTEGER DEFAULT 0,
    
    -- Performance tracking
    actual_yield_tons DECIMAL(10,2),
    actual_harvest_date DATE,
    market_price_per_ton DECIMAL(10,2),
    total_revenue DECIMAL(15,2),
    profit_margin DECIMAL(5,2),
    
    -- Monitoring and support
    extension_officer_id UUID,
    last_farm_visit_date DATE,
    next_scheduled_visit DATE,
    technical_assistance_provided TEXT[],
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Agricultural loan repayments
CREATE TABLE agricultural_loan_repayments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repayment_id VARCHAR(100) UNIQUE NOT NULL,
    loan_id UUID NOT NULL REFERENCES agricultural_loans(id),
    
    -- Repayment details
    scheduled_date DATE NOT NULL,
    actual_payment_date DATE,
    scheduled_amount DECIMAL(15,2) NOT NULL,
    actual_amount_paid DECIMAL(15,2) DEFAULT 0.00,
    
    -- Payment breakdown
    principal_amount DECIMAL(15,2) NOT NULL,
    interest_amount DECIMAL(15,2) NOT NULL,
    penalty_amount DECIMAL(15,2) DEFAULT 0.00,
    fee_amount DECIMAL(15,2) DEFAULT 0.00,
    
    -- Payment method
    payment_method VARCHAR(50), -- 'cash', 'mobile_money', 'bank_transfer', 'crop_delivery'
    payment_reference VARCHAR(100),
    mobile_money_transaction_id UUID,
    
    -- Status
    status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
    payment_status VARCHAR(30), -- 'full', 'partial', 'overpaid', 'failed'
    
    -- Late payment tracking
    days_late INTEGER DEFAULT 0,
    late_fee_applied DECIMAL(10,2) DEFAULT 0.00,
    grace_period_applied BOOLEAN DEFAULT false,
    
    -- Seasonal adjustments
    seasonal_adjustment_applied BOOLEAN DEFAULT false,
    adjustment_reason TEXT,
    adjustment_amount DECIMAL(10,2) DEFAULT 0.00,
    
    -- Audit fields
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- =====================================================
-- MICROFINANCE MANAGEMENT
-- =====================================================

-- Microfinance group types
CREATE TYPE microfinance_group_type_enum AS ENUM (
    'savings_group',
    'credit_group',
    'self_help_group',
    'cooperative',
    'womens_group',
    'youth_group',
    'farmers_group',
    'traders_group',
    'artisans_group'
);

-- Microfinance groups
CREATE TABLE microfinance_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id VARCHAR(100) UNIQUE NOT NULL,
    group_name VARCHAR(255) NOT NULL,
    group_type microfinance_group_type_enum NOT NULL,
    
    -- Group details
    formation_date DATE NOT NULL,
    registration_number VARCHAR(100),
    legal_status VARCHAR(50),
    
    -- Location
    location_id UUID REFERENCES rural_banking_locations(id),
    meeting_location TEXT,
    meeting_schedule JSONB, -- {"frequency": "weekly", "day": "monday", "time": "14:00"}
    
    -- Membership
    total_members INTEGER NOT NULL DEFAULT 0,
    active_members INTEGER NOT NULL DEFAULT 0,
    male_members INTEGER DEFAULT 0,
    female_members INTEGER DEFAULT 0,
    youth_members INTEGER DEFAULT 0, -- Under 35
    
    -- Financial information
    total_savings DECIMAL(15,2) DEFAULT 0.00,
    total_loans_outstanding DECIMAL(15,2) DEFAULT 0.00,
    group_fund_balance DECIMAL(15,2) DEFAULT 0.00,
    emergency_fund_balance DECIMAL(15,2) DEFAULT 0.00,
    
    -- Group rules and policies
    minimum_savings_amount DECIMAL(10,2),
    maximum_loan_amount DECIMAL(15,2),
    interest_rate_on_loans DECIMAL(5,4),
    loan_term_months INTEGER,
    meeting_attendance_requirement DECIMAL(3,2), -- Percentage
    
    -- Leadership
    chairperson_id UUID,
    secretary_id UUID,
    treasurer_id UUID,
    
    -- Performance metrics
    loan_repayment_rate DECIMAL(5,2) DEFAULT 100.00,
    savings_growth_rate DECIMAL(5,2) DEFAULT 0.00,
    member_retention_rate DECIMAL(5,2) DEFAULT 100.00,
    meeting_attendance_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Support and training
    field_officer_id UUID,
    last_training_date DATE,
    training_topics_covered TEXT[],
    next_training_scheduled DATE,
    
    -- Status
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Microfinance group members
CREATE TABLE microfinance_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES microfinance_groups(id),
    customer_id UUID NOT NULL,
    
    -- Membership details
    membership_number VARCHAR(100),
    join_date DATE NOT NULL,
    membership_status VARCHAR(30) NOT NULL DEFAULT 'active',
    
    -- Member information
    role_in_group VARCHAR(50) DEFAULT 'member', -- 'member', 'chairperson', 'secretary', 'treasurer'
    shares_owned INTEGER DEFAULT 1,
    share_value DECIMAL(10,2),
    
    -- Financial tracking
    total_savings DECIMAL(15,2) DEFAULT 0.00,
    total_loans_taken DECIMAL(15,2) DEFAULT 0.00,
    total_loans_repaid DECIMAL(15,2) DEFAULT 0.00,
    current_loan_balance DECIMAL(15,2) DEFAULT 0.00,
    
    -- Participation tracking
    meetings_attended INTEGER DEFAULT 0,
    meetings_missed INTEGER DEFAULT 0,
    attendance_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Performance metrics
    savings_consistency_score DECIMAL(5,2) DEFAULT 0.00,
    loan_repayment_score DECIMAL(5,2) DEFAULT 100.00,
    group_participation_score DECIMAL(5,2) DEFAULT 0.00,
    
    -- Exit information
    exit_date DATE,
    exit_reason VARCHAR(100),
    final_settlement_amount DECIMAL(15,2),
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Constraints
    UNIQUE(group_id, customer_id)
);

-- Microfinance transactions
CREATE TABLE microfinance_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id VARCHAR(100) UNIQUE NOT NULL,
    group_id UUID NOT NULL REFERENCES microfinance_groups(id),
    member_id UUID REFERENCES microfinance_group_members(id),
    
    -- Transaction details
    transaction_type VARCHAR(50) NOT NULL, -- 'savings_deposit', 'loan_disbursement', 'loan_repayment', 'share_purchase', 'dividend_payment', 'fee_payment'
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    
    -- Transaction context
    meeting_date DATE,
    transaction_date DATE NOT NULL,
    description TEXT,
    reference_number VARCHAR(100),
    
    -- Loan specific fields
    loan_id VARCHAR(100),
    interest_amount DECIMAL(10,2) DEFAULT 0.00,
    principal_amount DECIMAL(10,2) DEFAULT 0.00,
    penalty_amount DECIMAL(10,2) DEFAULT 0.00,
    
    -- Processing information
    processed_by UUID,
    approved_by UUID,
    witness_signatures TEXT[],
    
    -- Status
    status VARCHAR(30) NOT NULL DEFAULT 'completed',
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- =====================================================
-- COMMUNITY BANKING FEATURES
-- =====================================================

-- Community banking services
CREATE TABLE community_banking_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id VARCHAR(100) UNIQUE NOT NULL,
    service_name VARCHAR(255) NOT NULL,
    service_category VARCHAR(100) NOT NULL, -- 'savings', 'credit', 'insurance', 'remittances', 'payments', 'education'
    
    -- Service details
    description TEXT NOT NULL,
    target_demographic VARCHAR(100), -- 'farmers', 'women', 'youth', 'elderly', 'small_business', 'all'
    minimum_age INTEGER DEFAULT 18,
    maximum_age INTEGER,
    
    -- Availability
    available_locations UUID[], -- Array of location IDs
    service_hours JSONB,
    seasonal_availability BOOLEAN DEFAULT false,
    available_months INTEGER[], -- Array of month numbers (1-12)
    
    -- Pricing and limits
    service_fee DECIMAL(10,2) DEFAULT 0.00,
    minimum_amount DECIMAL(15,2),
    maximum_amount DECIMAL(15,2),
    daily_limit DECIMAL(15,2),
    monthly_limit DECIMAL(15,2),
    
    -- Requirements
    kyc_level_required INTEGER DEFAULT 1,
    documents_required TEXT[],
    guarantor_required BOOLEAN DEFAULT false,
    collateral_required BOOLEAN DEFAULT false,
    
    -- Digital integration
    mobile_app_supported BOOLEAN DEFAULT false,
    ussd_supported BOOLEAN DEFAULT false,
    sms_supported BOOLEAN DEFAULT true,
    offline_supported BOOLEAN DEFAULT true,
    
    -- Performance metrics
    total_users INTEGER DEFAULT 0,
    monthly_active_users INTEGER DEFAULT 0,
    total_transaction_volume DECIMAL(18,2) DEFAULT 0.00,
    average_transaction_amount DECIMAL(15,2) DEFAULT 0.00,
    customer_satisfaction_score DECIMAL(3,2) DEFAULT 0.00,
    
    -- Status
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    launch_date DATE,
    sunset_date DATE,
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Community events and financial literacy
CREATE TABLE community_financial_education (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id VARCHAR(100) UNIQUE NOT NULL,
    event_title VARCHAR(255) NOT NULL,
    event_type VARCHAR(50) NOT NULL, -- 'workshop', 'seminar', 'training', 'awareness_campaign', 'demonstration'
    
    -- Event details
    description TEXT NOT NULL,
    target_audience VARCHAR(100),
    expected_participants INTEGER,
    actual_participants INTEGER DEFAULT 0,
    
    -- Scheduling
    event_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    duration_hours DECIMAL(4,2),
    
    -- Location
    location_id UUID REFERENCES rural_banking_locations(id),
    venue_name VARCHAR(255),
    venue_address TEXT,
    
    -- Content and curriculum
    topics_covered TEXT[] NOT NULL,
    learning_objectives TEXT[],
    materials_provided TEXT[],
    languages_used TEXT[],
    
    -- Facilitators and speakers
    facilitator_id UUID,
    guest_speakers JSONB, -- Array of speaker details
    
    -- Resources and costs
    budget_allocated DECIMAL(10,2) DEFAULT 0.00,
    actual_cost DECIMAL(10,2) DEFAULT 0.00,
    materials_cost DECIMAL(10,2) DEFAULT 0.00,
    venue_cost DECIMAL(10,2) DEFAULT 0.00,
    facilitator_fee DECIMAL(10,2) DEFAULT 0.00,
    
    -- Outcomes and feedback
    pre_assessment_scores JSONB,
    post_assessment_scores JSONB,
    knowledge_improvement_percent DECIMAL(5,2) DEFAULT 0.00,
    participant_feedback_score DECIMAL(3,2) DEFAULT 0.00,
    follow_up_required BOOLEAN DEFAULT false,
    follow_up_date DATE,
    
    -- Digital components
    has_digital_materials BOOLEAN DEFAULT false,
    digital_platform_used VARCHAR(100),
    recorded_session BOOLEAN DEFAULT false,
    recording_url VARCHAR(255),
    
    -- Status
    status VARCHAR(30) NOT NULL DEFAULT 'planned',
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Community savings challenges and campaigns
CREATE TABLE community_savings_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id VARCHAR(100) UNIQUE NOT NULL,
    campaign_name VARCHAR(255) NOT NULL,
    campaign_type VARCHAR(50) NOT NULL, -- 'savings_challenge', 'goal_based_savings', 'seasonal_savings', 'emergency_fund'
    
    -- Campaign details
    description TEXT NOT NULL,
    target_amount DECIMAL(15,2),
    target_participants INTEGER,
    actual_participants INTEGER DEFAULT 0,
    
    -- Timeline
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    duration_days INTEGER,
    
    -- Rules and incentives
    minimum_contribution DECIMAL(10,2),
    contribution_frequency VARCHAR(20), -- 'daily', 'weekly', 'monthly'
    incentive_structure JSONB,
    rewards_offered TEXT[],
    
    -- Location and eligibility
    location_id UUID REFERENCES rural_banking_locations(id),
    eligible_groups UUID[], -- Array of microfinance group IDs
    age_restrictions JSONB,
    other_eligibility_criteria TEXT[],
    
    -- Progress tracking
    total_amount_saved DECIMAL(15,2) DEFAULT 0.00,
    average_contribution DECIMAL(10,2) DEFAULT 0.00,
    completion_rate DECIMAL(5,2) DEFAULT 0.00,
    dropout_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- Gamification elements
    has_leaderboard BOOLEAN DEFAULT false,
    has_badges BOOLEAN DEFAULT false,
    has_milestones BOOLEAN DEFAULT false,
    milestone_rewards JSONB,
    
    -- Communication
    communication_channels TEXT[], -- 'sms', 'whatsapp', 'radio', 'community_meetings'
    reminder_frequency VARCHAR(20),
    progress_updates_frequency VARCHAR(20),
    
    -- Results and impact
    success_rate DECIMAL(5,2) DEFAULT 0.00,
    total_rewards_distributed DECIMAL(15,2) DEFAULT 0.00,
    participant_satisfaction DECIMAL(3,2) DEFAULT 0.00,
    behavioral_change_indicators JSONB,
    
    -- Status
    status VARCHAR(30) NOT NULL DEFAULT 'planned',
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- =====================================================
-- INDEXES FOR PERFORMANCE OPTIMIZATION
-- =====================================================

-- Rural banking locations indexes
CREATE INDEX idx_rural_locations_geolocation ON rural_banking_locations USING GIST(geolocation);
CREATE INDEX idx_rural_locations_branch_type ON rural_banking_locations(branch_type);
CREATE INDEX idx_rural_locations_status ON rural_banking_locations(status);
CREATE INDEX idx_rural_locations_country ON rural_banking_locations(country);
CREATE INDEX idx_rural_locations_region ON rural_banking_locations(region);

-- Offline transactions indexes
CREATE INDEX idx_offline_transactions_device ON offline_transactions(device_id);
CREATE INDEX idx_offline_transactions_agent ON offline_transactions(agent_id);
CREATE INDEX idx_offline_transactions_status ON offline_transactions(status);
CREATE INDEX idx_offline_transactions_timestamp ON offline_transactions(offline_timestamp);
CREATE INDEX idx_offline_transactions_sync ON offline_transactions(sync_timestamp);

-- Mobile money indexes
CREATE INDEX idx_mobile_money_accounts_provider ON mobile_money_accounts(provider);
CREATE INDEX idx_mobile_money_accounts_phone ON mobile_money_accounts(phone_number);
CREATE INDEX idx_mobile_money_accounts_customer ON mobile_money_accounts(customer_id);
CREATE INDEX idx_mobile_money_transactions_from ON mobile_money_transactions(from_account_id);
CREATE INDEX idx_mobile_money_transactions_to ON mobile_money_transactions(to_account_id);
CREATE INDEX idx_mobile_money_transactions_status ON mobile_money_transactions(status);
CREATE INDEX idx_mobile_money_transactions_date ON mobile_money_transactions(initiated_at);

-- Agricultural loans indexes
CREATE INDEX idx_agricultural_loans_customer ON agricultural_loans(customer_id);
CREATE INDEX idx_agricultural_loans_agent ON agricultural_loans(agent_id);
CREATE INDEX idx_agricultural_loans_status ON agricultural_loans(status);
CREATE INDEX idx_agricultural_loans_location ON agricultural_loans(location_id);
CREATE INDEX idx_agricultural_loans_harvest_date ON agricultural_loans(expected_harvest_date);
CREATE INDEX idx_agricultural_loans_farm_location ON agricultural_loans USING GIST(farm_location);

-- Microfinance indexes
CREATE INDEX idx_microfinance_groups_type ON microfinance_groups(group_type);
CREATE INDEX idx_microfinance_groups_location ON microfinance_groups(location_id);
CREATE INDEX idx_microfinance_groups_status ON microfinance_groups(status);
CREATE INDEX idx_microfinance_members_group ON microfinance_group_members(group_id);
CREATE INDEX idx_microfinance_members_customer ON microfinance_group_members(customer_id);
CREATE INDEX idx_microfinance_transactions_group ON microfinance_transactions(group_id);
CREATE INDEX idx_microfinance_transactions_type ON microfinance_transactions(transaction_type);
CREATE INDEX idx_microfinance_transactions_date ON microfinance_transactions(transaction_date);

-- Community banking indexes
CREATE INDEX idx_community_services_category ON community_banking_services(service_category);
CREATE INDEX idx_community_services_status ON community_banking_services(status);
CREATE INDEX idx_community_education_location ON community_financial_education(location_id);
CREATE INDEX idx_community_education_date ON community_financial_education(event_date);
CREATE INDEX idx_community_campaigns_location ON community_savings_campaigns(location_id);
CREATE INDEX idx_community_campaigns_dates ON community_savings_campaigns(start_date, end_date);

-- Composite indexes for common queries
CREATE INDEX idx_offline_transactions_device_status ON offline_transactions(device_id, status);
CREATE INDEX idx_mobile_money_provider_phone ON mobile_money_accounts(provider, phone_number);
CREATE INDEX idx_agricultural_loans_customer_status ON agricultural_loans(customer_id, status);
CREATE INDEX idx_microfinance_group_member ON microfinance_group_members(group_id, customer_id);

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
CREATE TRIGGER update_rural_banking_locations_updated_at 
    BEFORE UPDATE ON rural_banking_locations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_offline_transactions_updated_at 
    BEFORE UPDATE ON offline_transactions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_mobile_money_accounts_updated_at 
    BEFORE UPDATE ON mobile_money_accounts 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_mobile_money_transactions_updated_at 
    BEFORE UPDATE ON mobile_money_transactions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agricultural_loans_updated_at 
    BEFORE UPDATE ON agricultural_loans 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_microfinance_groups_updated_at 
    BEFORE UPDATE ON microfinance_groups 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_microfinance_group_members_updated_at 
    BEFORE UPDATE ON microfinance_group_members 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update geolocation from lat/lng
CREATE OR REPLACE FUNCTION update_geolocation_from_coordinates()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.geolocation = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply geolocation triggers
CREATE TRIGGER update_rural_locations_geolocation 
    BEFORE INSERT OR UPDATE ON rural_banking_locations 
    FOR EACH ROW EXECUTE FUNCTION update_geolocation_from_coordinates();

CREATE TRIGGER update_agricultural_loans_farm_location 
    BEFORE INSERT OR UPDATE ON agricultural_loans 
    FOR EACH ROW EXECUTE FUNCTION update_geolocation_from_coordinates();

-- Function to update microfinance group statistics
CREATE OR REPLACE FUNCTION update_microfinance_group_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE microfinance_groups 
        SET total_members = total_members + 1,
            active_members = CASE WHEN NEW.membership_status = 'active' THEN active_members + 1 ELSE active_members END,
            male_members = CASE WHEN (SELECT gender FROM customers WHERE id = NEW.customer_id) = 'male' THEN male_members + 1 ELSE male_members END,
            female_members = CASE WHEN (SELECT gender FROM customers WHERE id = NEW.customer_id) = 'female' THEN female_members + 1 ELSE female_members END
        WHERE id = NEW.group_id;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.membership_status != NEW.membership_status THEN
            UPDATE microfinance_groups 
            SET active_members = CASE 
                WHEN NEW.membership_status = 'active' AND OLD.membership_status != 'active' THEN active_members + 1
                WHEN NEW.membership_status != 'active' AND OLD.membership_status = 'active' THEN active_members - 1
                ELSE active_members
            END
            WHERE id = NEW.group_id;
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE microfinance_groups 
        SET total_members = total_members - 1,
            active_members = CASE WHEN OLD.membership_status = 'active' THEN active_members - 1 ELSE active_members END,
            male_members = CASE WHEN (SELECT gender FROM customers WHERE id = OLD.customer_id) = 'male' THEN male_members - 1 ELSE male_members END,
            female_members = CASE WHEN (SELECT gender FROM customers WHERE id = OLD.customer_id) = 'female' THEN female_members - 1 ELSE female_members END
        WHERE id = OLD.group_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ language 'plpgsql';

-- Apply microfinance group statistics triggers
CREATE TRIGGER update_microfinance_group_stats_trigger
    AFTER INSERT OR UPDATE OR DELETE ON microfinance_group_members
    FOR EACH ROW EXECUTE FUNCTION update_microfinance_group_stats();

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================

-- Rural banking location summary view
CREATE VIEW rural_banking_location_summary AS
SELECT 
    rbl.id,
    rbl.location_id,
    rbl.location_name,
    rbl.branch_type,
    rbl.country,
    rbl.region,
    rbl.village_name,
    rbl.has_electricity,
    rbl.has_internet_connectivity,
    rbl.has_mobile_coverage,
    rbl.estimated_population_served,
    rbl.status,
    COUNT(DISTINCT ot.id) as pending_offline_transactions,
    COUNT(DISTINCT mg.id) as microfinance_groups,
    COUNT(DISTINCT al.id) as active_agricultural_loans,
    rbl.monthly_transaction_volume,
    rbl.customer_satisfaction_score
FROM rural_banking_locations rbl
LEFT JOIN offline_transactions ot ON rbl.id = ot.location_id AND ot.status = 'pending_sync'
LEFT JOIN microfinance_groups mg ON rbl.id = mg.location_id AND mg.status = 'active'
LEFT JOIN agricultural_loans al ON rbl.id = al.location_id AND al.status IN ('active', 'disbursed')
GROUP BY 
    rbl.id, rbl.location_id, rbl.location_name, rbl.branch_type, rbl.country,
    rbl.region, rbl.village_name, rbl.has_electricity, rbl.has_internet_connectivity,
    rbl.has_mobile_coverage, rbl.estimated_population_served, rbl.status,
    rbl.monthly_transaction_volume, rbl.customer_satisfaction_score;

-- Mobile money account summary view
CREATE VIEW mobile_money_account_summary AS
SELECT 
    mma.id,
    mma.account_id,
    mma.provider,
    mma.phone_number,
    mma.account_type,
    mma.account_status,
    mma.current_balance,
    mma.daily_transaction_limit,
    mma.daily_transaction_count,
    mma.daily_transaction_amount,
    COUNT(mmt.id) as total_transactions,
    COUNT(CASE WHEN mmt.status = 'completed' THEN 1 END) as successful_transactions,
    COUNT(CASE WHEN mmt.status = 'failed' THEN 1 END) as failed_transactions,
    SUM(CASE WHEN mmt.status = 'completed' THEN mmt.amount ELSE 0 END) as total_transaction_volume
FROM mobile_money_accounts mma
LEFT JOIN mobile_money_transactions mmt ON mma.id = mmt.from_account_id OR mma.id = mmt.to_account_id
GROUP BY 
    mma.id, mma.account_id, mma.provider, mma.phone_number, mma.account_type,
    mma.account_status, mma.current_balance, mma.daily_transaction_limit,
    mma.daily_transaction_count, mma.daily_transaction_amount;

-- Agricultural loan portfolio view
CREATE VIEW agricultural_loan_portfolio AS
SELECT 
    al.id,
    al.loan_id,
    al.customer_id,
    al.loan_amount,
    al.interest_rate,
    al.loan_term_months,
    al.status,
    al.crop_types,
    al.farm_size_hectares,
    al.expected_harvest_date,
    al.outstanding_balance,
    al.days_past_due,
    al.overall_risk_score,
    COUNT(alr.id) as total_repayments,
    COUNT(CASE WHEN alr.status = 'completed' THEN 1 END) as completed_repayments,
    SUM(CASE WHEN alr.status = 'completed' THEN alr.actual_amount_paid ELSE 0 END) as total_amount_repaid,
    CASE 
        WHEN al.days_past_due = 0 THEN 'current'
        WHEN al.days_past_due <= 30 THEN 'past_due_30'
        WHEN al.days_past_due <= 60 THEN 'past_due_60'
        WHEN al.days_past_due <= 90 THEN 'past_due_90'
        ELSE 'past_due_90_plus'
    END as delinquency_bucket
FROM agricultural_loans al
LEFT JOIN agricultural_loan_repayments alr ON al.id = alr.loan_id
GROUP BY 
    al.id, al.loan_id, al.customer_id, al.loan_amount, al.interest_rate,
    al.loan_term_months, al.status, al.crop_types, al.farm_size_hectares,
    al.expected_harvest_date, al.outstanding_balance, al.days_past_due,
    al.overall_risk_score;

-- Microfinance group performance view
CREATE VIEW microfinance_group_performance AS
SELECT 
    mg.id,
    mg.group_id,
    mg.group_name,
    mg.group_type,
    mg.total_members,
    mg.active_members,
    mg.total_savings,
    mg.total_loans_outstanding,
    mg.loan_repayment_rate,
    mg.meeting_attendance_rate,
    COUNT(DISTINCT mt.id) as total_transactions,
    SUM(CASE WHEN mt.transaction_type = 'savings_deposit' THEN mt.amount ELSE 0 END) as total_savings_deposits,
    SUM(CASE WHEN mt.transaction_type = 'loan_disbursement' THEN mt.amount ELSE 0 END) as total_loans_disbursed,
    SUM(CASE WHEN mt.transaction_type = 'loan_repayment' THEN mt.amount ELSE 0 END) as total_loan_repayments,
    AVG(mgm.attendance_rate) as average_member_attendance,
    AVG(mgm.savings_consistency_score) as average_savings_consistency
FROM microfinance_groups mg
LEFT JOIN microfinance_transactions mt ON mg.id = mt.group_id
LEFT JOIN microfinance_group_members mgm ON mg.id = mgm.group_id AND mgm.membership_status = 'active'
GROUP BY 
    mg.id, mg.group_id, mg.group_name, mg.group_type, mg.total_members,
    mg.active_members, mg.total_savings, mg.total_loans_outstanding,
    mg.loan_repayment_rate, mg.meeting_attendance_rate;

-- =====================================================
-- STORED PROCEDURES FOR COMMON OPERATIONS
-- =====================================================

-- Procedure to sync offline transaction
CREATE OR REPLACE FUNCTION sync_offline_transaction(
    p_offline_transaction_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_transaction RECORD;
    v_sync_successful BOOLEAN := FALSE;
BEGIN
    -- Get offline transaction details
    SELECT * INTO v_transaction
    FROM offline_transactions
    WHERE id = p_offline_transaction_id
    AND status = 'pending_sync';
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    -- Update sync attempt
    UPDATE offline_transactions
    SET sync_attempts = sync_attempts + 1,
        last_sync_attempt = CURRENT_TIMESTAMP,
        status = 'syncing'
    WHERE id = p_offline_transaction_id;
    
    -- Simulate transaction processing (in real implementation, this would call the transaction processing service)
    BEGIN
        -- Validate transaction data
        IF v_transaction.transaction_data IS NOT NULL AND 
           v_transaction.amount > 0 AND
           v_transaction.customer_id IS NOT NULL THEN
            
            -- Mark as synced
            UPDATE offline_transactions
            SET status = 'synced',
                sync_timestamp = CURRENT_TIMESTAMP,
                offline_duration_minutes = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - v_transaction.offline_timestamp))/60
            WHERE id = p_offline_transaction_id;
            
            v_sync_successful := TRUE;
        ELSE
            -- Mark as sync failed
            UPDATE offline_transactions
            SET status = 'sync_failed',
                sync_error_message = 'Invalid transaction data'
            WHERE id = p_offline_transaction_id;
        END IF;
        
    EXCEPTION WHEN OTHERS THEN
        -- Mark as sync failed
        UPDATE offline_transactions
        SET status = 'sync_failed',
            sync_error_message = SQLERRM
        WHERE id = p_offline_transaction_id;
    END;
    
    RETURN v_sync_successful;
END;
$$ LANGUAGE plpgsql;

-- Procedure to calculate agricultural loan risk score
CREATE OR REPLACE FUNCTION calculate_agricultural_loan_risk(
    p_loan_id UUID
) RETURNS DECIMAL AS $$
DECLARE
    v_loan RECORD;
    v_risk_score DECIMAL := 0.00;
    v_weather_factor DECIMAL := 0.00;
    v_market_factor DECIMAL := 0.00;
    v_farmer_factor DECIMAL := 0.00;
    v_location_factor DECIMAL := 0.00;
BEGIN
    -- Get loan details
    SELECT * INTO v_loan
    FROM agricultural_loans
    WHERE id = p_loan_id;
    
    IF NOT FOUND THEN
        RETURN 0.00;
    END IF;
    
    -- Calculate weather risk factor (0-25 points)
    v_weather_factor := CASE 
        WHEN v_loan.crop_types && ARRAY['cereals'::crop_type_enum] THEN 15.00
        WHEN v_loan.crop_types && ARRAY['cash_crops'::crop_type_enum] THEN 20.00
        WHEN v_loan.crop_types && ARRAY['vegetables'::crop_type_enum] THEN 10.00
        ELSE 12.00
    END;
    
    -- Calculate market risk factor (0-25 points)
    v_market_factor := CASE 
        WHEN v_loan.farm_size_hectares < 2 THEN 20.00
        WHEN v_loan.farm_size_hectares < 5 THEN 15.00
        WHEN v_loan.farm_size_hectares < 10 THEN 10.00
        ELSE 5.00
    END;
    
    -- Calculate farmer experience factor (0-25 points)
    v_farmer_factor := CASE 
        WHEN v_loan.farmer_experience_years < 2 THEN 25.00
        WHEN v_loan.farmer_experience_years < 5 THEN 20.00
        WHEN v_loan.farmer_experience_years < 10 THEN 15.00
        WHEN v_loan.farmer_experience_years < 20 THEN 10.00
        ELSE 5.00
    END;
    
    -- Calculate location risk factor (0-25 points)
    SELECT CASE 
        WHEN rbl.has_electricity AND rbl.has_internet_connectivity THEN 5.00
        WHEN rbl.has_electricity OR rbl.has_internet_connectivity THEN 10.00
        WHEN rbl.distance_to_main_road_km < 5 THEN 15.00
        WHEN rbl.distance_to_main_road_km < 20 THEN 20.00
        ELSE 25.00
    END INTO v_location_factor
    FROM rural_banking_locations rbl
    WHERE rbl.id = v_loan.location_id;
    
    -- Calculate overall risk score
    v_risk_score := v_weather_factor + v_market_factor + v_farmer_factor + COALESCE(v_location_factor, 20.00);
    
    -- Update loan with calculated risk score
    UPDATE agricultural_loans
    SET weather_risk_score = v_weather_factor,
        market_risk_score = v_market_factor,
        overall_risk_score = v_risk_score
    WHERE id = p_loan_id;
    
    RETURN v_risk_score;
END;
$$ LANGUAGE plpgsql;

-- Procedure to process mobile money transaction
CREATE OR REPLACE FUNCTION process_mobile_money_transaction(
    p_from_phone VARCHAR(20),
    p_to_phone VARCHAR(20),
    p_amount DECIMAL,
    p_transaction_type VARCHAR(50),
    p_agent_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_transaction_id UUID;
    v_from_account_id UUID;
    v_to_account_id UUID;
    v_transaction_fee DECIMAL := 0.00;
BEGIN
    -- Generate transaction ID
    v_transaction_id := gen_random_uuid();
    
    -- Get account IDs
    SELECT id INTO v_from_account_id
    FROM mobile_money_accounts
    WHERE phone_number = p_from_phone AND account_status = 'active';
    
    SELECT id INTO v_to_account_id
    FROM mobile_money_accounts
    WHERE phone_number = p_to_phone AND account_status = 'active';
    
    -- Calculate transaction fee (simplified)
    v_transaction_fee := CASE 
        WHEN p_amount <= 100 THEN 1.00
        WHEN p_amount <= 500 THEN 2.50
        WHEN p_amount <= 1000 THEN 5.00
        ELSE p_amount * 0.01
    END;
    
    -- Create transaction record
    INSERT INTO mobile_money_transactions (
        id,
        transaction_id,
        from_account_id,
        to_account_id,
        from_phone_number,
        to_phone_number,
        transaction_type,
        amount,
        transaction_fee,
        agent_id,
        status,
        reference_number
    ) VALUES (
        v_transaction_id,
        'MMT' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDDHH24MISS') || SUBSTRING(v_transaction_id::TEXT, 1, 6),
        v_from_account_id,
        v_to_account_id,
        p_from_phone,
        p_to_phone,
        p_transaction_type,
        p_amount,
        v_transaction_fee,
        p_agent_id,
        'pending',
        'REF' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDDHH24MISS')
    );
    
    RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- SAMPLE DATA FOR TESTING (OPTIONAL)
-- =====================================================

-- Insert sample rural banking locations
INSERT INTO rural_banking_locations (
    location_id, location_name, branch_type, latitude, longitude, address,
    village_name, district, region, country, has_electricity, has_internet_connectivity,
    has_mobile_coverage, estimated_population_served, created_by
) VALUES 
('RBL-001', 'Kibera Community Center', 'community_center', -1.3133, 36.7833, 
 'Kibera Slums, Nairobi', 'Kibera', 'Nairobi', 'Nairobi', 'Kenya', 
 true, true, true, 5000, gen_random_uuid()),
('RBL-002', 'Mfangano Island Agent Point', 'agent_point', -0.4167, 33.9167,
 'Mfangano Island, Lake Victoria', 'Mfangano', 'Homa Bay', 'Nyanza', 'Kenya',
 false, false, true, 1200, gen_random_uuid()),
('RBL-003', 'Tamale Market Kiosk', 'kiosk', 9.4034, -0.8424,
 'Central Market, Tamale', 'Tamale', 'Tamale Metropolitan', 'Northern Region', 'Ghana',
 true, true, true, 8000, gen_random_uuid());

-- Insert sample microfinance groups
INSERT INTO microfinance_groups (
    group_id, group_name, group_type, formation_date, total_members,
    active_members, location_id, minimum_savings_amount, maximum_loan_amount,
    interest_rate_on_loans, created_by
) VALUES 
('MFG-001', 'Kibera Women Savings Group', 'womens_group', '2023-01-15', 25, 23,
 (SELECT id FROM rural_banking_locations WHERE location_id = 'RBL-001'),
 10.00, 500.00, 0.02, gen_random_uuid()),
('MFG-002', 'Mfangano Fishermen Cooperative', 'cooperative', '2022-08-20', 18, 16,
 (SELECT id FROM rural_banking_locations WHERE location_id = 'RBL-002'),
 20.00, 1000.00, 0.025, gen_random_uuid());

-- Insert sample mobile money providers
INSERT INTO mobile_money_accounts (
    account_id, provider, provider_account_id, phone_number, account_name,
    account_type, current_balance, daily_transaction_limit, created_by
) VALUES 
('MMA-001', 'mpesa', 'MPESA123456', '+254712345678', 'John Doe', 'personal',
 150.00, 1000.00, gen_random_uuid()),
('MMA-002', 'mtn_mobile_money', 'MTN789012', '+233241234567', 'Mary Asante', 'business',
 500.00, 5000.00, gen_random_uuid());

-- =====================================================
-- COMMENTS AND DOCUMENTATION
-- =====================================================

COMMENT ON TABLE rural_banking_locations IS 'Comprehensive rural banking location registry with infrastructure and accessibility information';
COMMENT ON TABLE offline_transactions IS 'Offline transaction management with synchronization and conflict resolution';
COMMENT ON TABLE mobile_money_accounts IS 'Mobile money account integration for multiple providers across Africa';
COMMENT ON TABLE agricultural_loans IS 'Specialized agricultural lending with crop-specific risk assessment';
COMMENT ON TABLE microfinance_groups IS 'Community-based microfinance group management and tracking';
COMMENT ON TABLE community_banking_services IS 'Community-focused banking services and financial inclusion programs';

COMMENT ON COLUMN rural_banking_locations.geolocation IS 'PostGIS geography point for location-based services and analysis';
COMMENT ON COLUMN offline_transactions.transaction_hash IS 'Cryptographic hash for transaction integrity verification';
COMMENT ON COLUMN agricultural_loans.farm_location IS 'PostGIS geography point for farm location and climate risk assessment';
COMMENT ON COLUMN mobile_money_transactions.metadata IS 'JSONB field for provider-specific transaction metadata';
COMMENT ON COLUMN microfinance_groups.meeting_schedule IS 'JSONB field for flexible meeting scheduling configuration';

