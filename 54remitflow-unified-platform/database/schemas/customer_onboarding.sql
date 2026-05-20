-- =====================================================
-- CUSTOMER ONBOARDING WITH EDGE AI DATABASE SCHEMA
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =====================================================
-- ENUMS AND TYPES
-- =====================================================

-- Customer onboarding status
CREATE TYPE customer_onboarding_status AS ENUM (
    'not_started',
    'in_progress',
    'documents_pending',
    'documents_uploaded',
    'documents_processing',
    'documents_verified',
    'biometric_pending',
    'biometric_captured',
    'biometric_verified',
    'kyc_pending',
    'kyc_in_progress',
    'kyc_verified',
    'risk_assessment_pending',
    'risk_assessment_completed',
    'approval_pending',
    'approved',
    'rejected',
    'suspended',
    'completed'
);

-- Customer types
CREATE TYPE customer_type AS ENUM (
    'individual',
    'business',
    'corporate',
    'government',
    'ngo',
    'cooperative'
);

-- Customer tier based on transaction limits and services
CREATE TYPE customer_tier AS ENUM (
    'basic',
    'standard',
    'premium',
    'vip',
    'corporate'
);

-- Document types for customer verification
CREATE TYPE customer_document_type AS ENUM (
    'national_id',
    'passport',
    'drivers_license',
    'voter_id',
    'birth_certificate',
    'marriage_certificate',
    'utility_bill',
    'bank_statement',
    'salary_slip',
    'business_registration',
    'tax_certificate',
    'proof_of_address',
    'photo',
    'signature_sample',
    'fingerprint',
    'iris_scan',
    'face_image',
    'voice_sample'
);

-- Verification status for documents and biometrics
CREATE TYPE verification_status AS ENUM (
    'not_started',
    'pending',
    'processing',
    'verified',
    'failed',
    'rejected',
    'expired',
    'requires_manual_review'
);

-- Biometric types
CREATE TYPE biometric_type AS ENUM (
    'fingerprint',
    'face',
    'iris',
    'voice',
    'signature',
    'palm_print',
    'retina'
);

-- Risk levels
CREATE TYPE risk_level AS ENUM (
    'very_low',
    'low',
    'medium',
    'high',
    'very_high',
    'critical'
);

-- Device types for edge deployment
CREATE TYPE device_type AS ENUM (
    'mobile_app',
    'tablet',
    'pos_terminal',
    'kiosk',
    'atm',
    'web_browser',
    'agent_device',
    'iot_device'
);

-- AI processing status
CREATE TYPE ai_processing_status AS ENUM (
    'queued',
    'processing',
    'completed',
    'failed',
    'requires_human_review'
);

-- =====================================================
-- CUSTOMER ONBOARDING TABLES
-- =====================================================

-- Main customer onboarding table
CREATE TABLE customer_onboarding (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_reference_number VARCHAR(50) UNIQUE NOT NULL,
    agent_id UUID NOT NULL,
    agent_tier VARCHAR(20) NOT NULL,
    customer_type customer_type NOT NULL DEFAULT 'individual',
    customer_tier customer_tier NOT NULL DEFAULT 'basic',
    status customer_onboarding_status NOT NULL DEFAULT 'not_started',
    current_step VARCHAR(100) NOT NULL DEFAULT 'personal_information',
    total_steps INTEGER NOT NULL DEFAULT 12,
    completed_steps INTEGER DEFAULT 0,
    progress_percentage DECIMAL(5,2) DEFAULT 0.0,
    
    -- Personal Information
    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100),
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(10),
    nationality VARCHAR(50),
    place_of_birth VARCHAR(100),
    marital_status VARCHAR(20),
    occupation VARCHAR(100),
    employer VARCHAR(255),
    monthly_income DECIMAL(15,2),
    source_of_income VARCHAR(100),
    
    -- Contact Information
    phone_number VARCHAR(20) NOT NULL,
    email_address VARCHAR(255),
    alternative_phone VARCHAR(20),
    preferred_language VARCHAR(10) DEFAULT 'en',
    communication_preference VARCHAR(20) DEFAULT 'sms',
    
    -- Address Information
    residential_address TEXT NOT NULL,
    residential_city VARCHAR(100) NOT NULL,
    residential_state VARCHAR(100),
    residential_country VARCHAR(50) NOT NULL,
    residential_postal_code VARCHAR(20),
    residential_coordinates GEOMETRY(POINT, 4326),
    mailing_address TEXT,
    mailing_city VARCHAR(100),
    mailing_state VARCHAR(100),
    mailing_country VARCHAR(50),
    mailing_postal_code VARCHAR(20),
    address_same_as_residential BOOLEAN DEFAULT true,
    
    -- Business Information (for business customers)
    business_name VARCHAR(255),
    business_registration_number VARCHAR(100),
    business_type VARCHAR(50),
    business_address TEXT,
    business_city VARCHAR(100),
    business_state VARCHAR(100),
    business_country VARCHAR(50),
    business_postal_code VARCHAR(20),
    business_coordinates GEOMETRY(POINT, 4326),
    business_phone VARCHAR(20),
    business_email VARCHAR(255),
    tax_identification_number VARCHAR(100),
    annual_revenue DECIMAL(15,2),
    number_of_employees INTEGER,
    business_established_date DATE,
    
    -- Next of Kin / Emergency Contact
    next_of_kin_name VARCHAR(255),
    next_of_kin_relationship VARCHAR(50),
    next_of_kin_phone VARCHAR(20),
    next_of_kin_address TEXT,
    
    -- Account Preferences
    preferred_account_type VARCHAR(50) DEFAULT 'savings',
    initial_deposit_amount DECIMAL(15,2) DEFAULT 0.0,
    preferred_transaction_limit DECIMAL(15,2),
    preferred_daily_limit DECIMAL(15,2),
    preferred_monthly_limit DECIMAL(15,2),
    requires_sms_alerts BOOLEAN DEFAULT true,
    requires_email_alerts BOOLEAN DEFAULT false,
    requires_mobile_banking BOOLEAN DEFAULT true,
    requires_internet_banking BOOLEAN DEFAULT false,
    requires_debit_card BOOLEAN DEFAULT true,
    
    -- Verification Status
    documents_complete BOOLEAN DEFAULT false,
    documents_verified BOOLEAN DEFAULT false,
    biometric_captured BOOLEAN DEFAULT false,
    biometric_verified BOOLEAN DEFAULT false,
    kyc_completed BOOLEAN DEFAULT false,
    kyc_verified BOOLEAN DEFAULT false,
    risk_assessment_completed BOOLEAN DEFAULT false,
    background_check_completed BOOLEAN DEFAULT false,
    reference_check_completed BOOLEAN DEFAULT false,
    
    -- Risk Assessment
    risk_level risk_level DEFAULT 'medium',
    risk_score DECIMAL(5,2) DEFAULT 50.0,
    aml_risk_score DECIMAL(5,2) DEFAULT 0.0,
    fraud_risk_score DECIMAL(5,2) DEFAULT 0.0,
    credit_risk_score DECIMAL(5,2) DEFAULT 0.0,
    
    -- Processing Information
    device_type device_type NOT NULL,
    device_id VARCHAR(255),
    device_fingerprint TEXT,
    ip_address INET,
    user_agent TEXT,
    geolocation GEOMETRY(POINT, 4326),
    session_id VARCHAR(255),
    
    -- Edge AI Processing
    edge_processing_enabled BOOLEAN DEFAULT false,
    edge_device_id VARCHAR(255),
    offline_mode_used BOOLEAN DEFAULT false,
    sync_status VARCHAR(20) DEFAULT 'synced',
    last_sync_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    application_started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    documents_submitted_at TIMESTAMP WITH TIME ZONE,
    biometric_captured_at TIMESTAMP WITH TIME ZONE,
    kyc_initiated_at TIMESTAMP WITH TIME ZONE,
    kyc_completed_at TIMESTAMP WITH TIME ZONE,
    risk_assessment_completed_at TIMESTAMP WITH TIME ZONE,
    approval_decision_at TIMESTAMP WITH TIME ZONE,
    onboarding_completed_at TIMESTAMP WITH TIME ZONE,
    
    -- Assignment and Review
    assigned_reviewer UUID,
    assigned_compliance_officer UUID,
    reviewed_by UUID,
    approved_by UUID,
    reviewer_notes TEXT,
    compliance_notes TEXT,
    rejection_reason TEXT,
    special_instructions TEXT,
    
    -- Audit Trail
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID
);

-- Customer documents table with AI processing
CREATE TABLE customer_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_onboarding_id UUID NOT NULL REFERENCES customer_onboarding(id) ON DELETE CASCADE,
    document_type customer_document_type NOT NULL,
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
    file_hash VARCHAR(128) UNIQUE,
    
    -- Verification Status
    verification_status verification_status DEFAULT 'not_started',
    verification_method VARCHAR(50) DEFAULT 'ai_automated',
    verified_at TIMESTAMP WITH TIME ZONE,
    verified_by UUID,
    verification_notes TEXT,
    
    -- AI Processing Results
    ai_processing_status ai_processing_status DEFAULT 'queued',
    ai_processing_started_at TIMESTAMP WITH TIME ZONE,
    ai_processing_completed_at TIMESTAMP WITH TIME ZONE,
    ai_confidence_score DECIMAL(5,2),
    ai_verification_flags TEXT[],
    
    -- OCR Results (GOT-OCR2.0)
    ocr_processed BOOLEAN DEFAULT false,
    ocr_confidence DECIMAL(5,2),
    ocr_text TEXT,
    ocr_structured_data JSONB,
    ocr_processing_time_ms INTEGER,
    ocr_model_version VARCHAR(50),
    
    -- Document Analysis
    image_quality_score DECIMAL(5,2),
    document_authenticity_score DECIMAL(5,2),
    tampering_detected BOOLEAN DEFAULT false,
    tampering_confidence DECIMAL(5,2),
    face_detected BOOLEAN DEFAULT false,
    face_match_score DECIMAL(5,2),
    
    -- Edge Processing
    processed_on_edge BOOLEAN DEFAULT false,
    edge_device_id VARCHAR(255),
    edge_processing_time_ms INTEGER,
    requires_cloud_verification BOOLEAN DEFAULT false,
    
    -- Manual Review
    requires_manual_review BOOLEAN DEFAULT false,
    manual_review_reason TEXT,
    manual_review_completed BOOLEAN DEFAULT false,
    manual_reviewer UUID,
    manual_review_notes TEXT,
    manual_review_decision VARCHAR(20),
    
    -- Audit Trail
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    uploaded_by UUID
);

-- Biometric data table
CREATE TABLE customer_biometrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_onboarding_id UUID NOT NULL REFERENCES customer_onboarding(id) ON DELETE CASCADE,
    biometric_type biometric_type NOT NULL,
    
    -- Biometric Data
    biometric_template BYTEA, -- Encrypted biometric template
    biometric_hash VARCHAR(128) UNIQUE,
    quality_score DECIMAL(5,2),
    capture_method VARCHAR(50),
    capture_device VARCHAR(255),
    
    -- Verification Status
    verification_status verification_status DEFAULT 'not_started',
    verification_method VARCHAR(50) DEFAULT 'ai_automated',
    verified_at TIMESTAMP WITH TIME ZONE,
    verified_by UUID,
    verification_confidence DECIMAL(5,2),
    verification_notes TEXT,
    
    -- AI Processing
    ai_processing_status ai_processing_status DEFAULT 'queued',
    ai_processing_started_at TIMESTAMP WITH TIME ZONE,
    ai_processing_completed_at TIMESTAMP WITH TIME ZONE,
    ai_confidence_score DECIMAL(5,2),
    ai_liveness_score DECIMAL(5,2),
    ai_spoof_detection_score DECIMAL(5,2),
    
    -- Face Recognition (for face biometrics)
    face_encoding BYTEA,
    face_landmarks JSONB,
    face_quality_metrics JSONB,
    liveness_detected BOOLEAN DEFAULT false,
    spoof_detected BOOLEAN DEFAULT false,
    
    -- Fingerprint Analysis (for fingerprint biometrics)
    minutiae_points JSONB,
    ridge_characteristics JSONB,
    fingerprint_class VARCHAR(20),
    
    -- Voice Analysis (for voice biometrics)
    voice_features JSONB,
    voice_quality_metrics JSONB,
    speaker_verification_score DECIMAL(5,2),
    
    -- Edge Processing
    processed_on_edge BOOLEAN DEFAULT false,
    edge_device_id VARCHAR(255),
    edge_processing_time_ms INTEGER,
    
    -- Privacy and Security
    encryption_key_id VARCHAR(255),
    data_retention_policy VARCHAR(50) DEFAULT 'standard',
    consent_given BOOLEAN DEFAULT false,
    consent_timestamp TIMESTAMP WITH TIME ZONE,
    
    -- Audit Trail
    captured_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    captured_by UUID
);

-- KYC verification results
CREATE TABLE customer_kyc_verification (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_onboarding_id UUID NOT NULL REFERENCES customer_onboarding(id) ON DELETE CASCADE,
    kyc_reference_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Verification Status
    status verification_status DEFAULT 'not_started',
    verification_level VARCHAR(20) DEFAULT 'basic',
    risk_level risk_level DEFAULT 'medium',
    
    -- Identity Verification
    identity_verified BOOLEAN DEFAULT false,
    identity_verification_method VARCHAR(50),
    identity_confidence_score DECIMAL(5,2),
    identity_verification_source VARCHAR(100),
    
    -- Address Verification
    address_verified BOOLEAN DEFAULT false,
    address_verification_method VARCHAR(50),
    address_confidence_score DECIMAL(5,2),
    address_verification_source VARCHAR(100),
    
    -- Contact Verification
    phone_verified BOOLEAN DEFAULT false,
    phone_verification_method VARCHAR(50),
    phone_verification_code VARCHAR(10),
    phone_verified_at TIMESTAMP WITH TIME ZONE,
    
    email_verified BOOLEAN DEFAULT false,
    email_verification_method VARCHAR(50),
    email_verification_token VARCHAR(255),
    email_verified_at TIMESTAMP WITH TIME ZONE,
    
    -- Document Verification Summary
    documents_verified_count INTEGER DEFAULT 0,
    documents_total_count INTEGER DEFAULT 0,
    documents_verification_score DECIMAL(5,2) DEFAULT 0.0,
    
    -- Biometric Verification Summary
    biometrics_verified_count INTEGER DEFAULT 0,
    biometrics_total_count INTEGER DEFAULT 0,
    biometrics_verification_score DECIMAL(5,2) DEFAULT 0.0,
    
    -- Third-party Verification
    third_party_verification_completed BOOLEAN DEFAULT false,
    third_party_verification_provider VARCHAR(100),
    third_party_verification_reference VARCHAR(255),
    third_party_verification_score DECIMAL(5,2),
    
    -- Overall Scores
    overall_kyc_score DECIMAL(5,2) DEFAULT 0.0,
    risk_score DECIMAL(5,2) DEFAULT 50.0,
    compliance_score DECIMAL(5,2) DEFAULT 0.0,
    
    -- Processing Information
    initiated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    expiry_date TIMESTAMP WITH TIME ZONE,
    
    -- Assignment and Review
    assigned_reviewer UUID,
    reviewed_by UUID,
    approved_by UUID,
    reviewer_notes TEXT,
    rejection_reason TEXT,
    additional_requirements TEXT,
    
    -- Audit Trail
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID
);

-- Risk assessment results
CREATE TABLE customer_risk_assessment (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_onboarding_id UUID NOT NULL REFERENCES customer_onboarding(id) ON DELETE CASCADE,
    assessment_reference VARCHAR(50) UNIQUE NOT NULL,
    
    -- Risk Categories
    overall_risk_level risk_level DEFAULT 'medium',
    overall_risk_score DECIMAL(5,2) DEFAULT 50.0,
    
    -- AML Risk Assessment
    aml_risk_level risk_level DEFAULT 'medium',
    aml_risk_score DECIMAL(5,2) DEFAULT 0.0,
    pep_check_completed BOOLEAN DEFAULT false,
    pep_match_found BOOLEAN DEFAULT false,
    pep_match_details JSONB,
    sanctions_check_completed BOOLEAN DEFAULT false,
    sanctions_match_found BOOLEAN DEFAULT false,
    sanctions_match_details JSONB,
    adverse_media_check_completed BOOLEAN DEFAULT false,
    adverse_media_found BOOLEAN DEFAULT false,
    adverse_media_details JSONB,
    
    -- Fraud Risk Assessment
    fraud_risk_level risk_level DEFAULT 'medium',
    fraud_risk_score DECIMAL(5,2) DEFAULT 0.0,
    device_risk_score DECIMAL(5,2) DEFAULT 0.0,
    behavioral_risk_score DECIMAL(5,2) DEFAULT 0.0,
    identity_theft_risk_score DECIMAL(5,2) DEFAULT 0.0,
    synthetic_identity_risk_score DECIMAL(5,2) DEFAULT 0.0,
    
    -- Credit Risk Assessment
    credit_risk_level risk_level DEFAULT 'medium',
    credit_risk_score DECIMAL(5,2) DEFAULT 0.0,
    credit_bureau_check_completed BOOLEAN DEFAULT false,
    credit_score INTEGER,
    credit_history_length_months INTEGER,
    default_history_found BOOLEAN DEFAULT false,
    bankruptcy_history_found BOOLEAN DEFAULT false,
    
    -- Operational Risk Assessment
    operational_risk_level risk_level DEFAULT 'medium',
    operational_risk_score DECIMAL(5,2) DEFAULT 0.0,
    geographic_risk_score DECIMAL(5,2) DEFAULT 0.0,
    product_risk_score DECIMAL(5,2) DEFAULT 0.0,
    channel_risk_score DECIMAL(5,2) DEFAULT 0.0,
    
    -- AI Risk Scoring
    ai_risk_model_version VARCHAR(50),
    ai_risk_score DECIMAL(5,2) DEFAULT 0.0,
    ai_risk_factors JSONB,
    ai_risk_explanation TEXT,
    ai_confidence_level DECIMAL(5,2),
    
    -- Risk Mitigation
    risk_mitigation_required BOOLEAN DEFAULT false,
    risk_mitigation_measures TEXT[],
    enhanced_due_diligence_required BOOLEAN DEFAULT false,
    ongoing_monitoring_required BOOLEAN DEFAULT false,
    transaction_monitoring_level VARCHAR(20) DEFAULT 'standard',
    
    -- Processing Information
    assessment_started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    assessment_completed_at TIMESTAMP WITH TIME ZONE,
    assessment_valid_until TIMESTAMP WITH TIME ZONE,
    
    -- Assignment and Review
    assessed_by UUID,
    reviewed_by UUID,
    approved_by UUID,
    assessor_notes TEXT,
    reviewer_notes TEXT,
    
    -- Audit Trail
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID
);

-- Edge device management
CREATE TABLE edge_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(255) UNIQUE NOT NULL,
    device_name VARCHAR(255) NOT NULL,
    device_type device_type NOT NULL,
    
    -- Device Information
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    serial_number VARCHAR(100),
    firmware_version VARCHAR(50),
    software_version VARCHAR(50),
    
    -- Location Information
    agent_id UUID,
    location_name VARCHAR(255),
    location_address TEXT,
    location_coordinates GEOMETRY(POINT, 4326),
    timezone VARCHAR(50),
    
    -- Capabilities
    has_camera BOOLEAN DEFAULT false,
    has_fingerprint_scanner BOOLEAN DEFAULT false,
    has_nfc BOOLEAN DEFAULT false,
    has_barcode_scanner BOOLEAN DEFAULT false,
    has_printer BOOLEAN DEFAULT false,
    has_internet_connectivity BOOLEAN DEFAULT true,
    supports_offline_mode BOOLEAN DEFAULT false,
    
    -- AI Processing Capabilities
    ai_processing_enabled BOOLEAN DEFAULT false,
    ai_model_versions JSONB,
    ocr_capability BOOLEAN DEFAULT false,
    biometric_processing_capability BOOLEAN DEFAULT false,
    fraud_detection_capability BOOLEAN DEFAULT false,
    
    -- Status and Health
    status VARCHAR(20) DEFAULT 'active',
    last_heartbeat TIMESTAMP WITH TIME ZONE,
    last_sync TIMESTAMP WITH TIME ZONE,
    battery_level INTEGER,
    storage_used_gb DECIMAL(8,2),
    storage_total_gb DECIMAL(8,2),
    memory_used_gb DECIMAL(8,2),
    memory_total_gb DECIMAL(8,2),
    cpu_usage_percent DECIMAL(5,2),
    
    -- Security
    device_certificate TEXT,
    encryption_enabled BOOLEAN DEFAULT true,
    security_patch_level VARCHAR(50),
    tamper_detection_enabled BOOLEAN DEFAULT true,
    tamper_detected BOOLEAN DEFAULT false,
    
    -- Configuration
    configuration JSONB,
    sync_frequency_minutes INTEGER DEFAULT 60,
    offline_storage_limit_gb DECIMAL(8,2) DEFAULT 10.0,
    
    -- Audit Trail
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    registered_by UUID
);

-- AI processing jobs for edge and cloud
CREATE TABLE ai_processing_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_reference VARCHAR(50) UNIQUE NOT NULL,
    
    -- Job Information
    job_type VARCHAR(50) NOT NULL, -- 'ocr', 'biometric_verification', 'fraud_detection', 'risk_assessment'
    priority INTEGER DEFAULT 5, -- 1 (highest) to 10 (lowest)
    status ai_processing_status DEFAULT 'queued',
    
    -- Related Entities
    customer_onboarding_id UUID REFERENCES customer_onboarding(id),
    document_id UUID REFERENCES customer_documents(id),
    biometric_id UUID REFERENCES customer_biometrics(id),
    
    -- Processing Location
    processing_location VARCHAR(20) DEFAULT 'cloud', -- 'edge', 'cloud', 'hybrid'
    edge_device_id VARCHAR(255),
    cloud_instance_id VARCHAR(255),
    
    -- Input Data
    input_data_path TEXT,
    input_data_size_bytes BIGINT,
    input_data_hash VARCHAR(128),
    input_parameters JSONB,
    
    -- Processing Results
    output_data JSONB,
    confidence_score DECIMAL(5,2),
    processing_time_ms INTEGER,
    model_version VARCHAR(50),
    error_message TEXT,
    
    -- Resource Usage
    cpu_time_ms INTEGER,
    memory_used_mb INTEGER,
    gpu_time_ms INTEGER,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    
    -- Assignment
    assigned_to VARCHAR(255), -- device_id or cloud_instance_id
    created_by UUID
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Customer onboarding indexes
CREATE INDEX idx_customer_onboarding_agent_id ON customer_onboarding(agent_id);
CREATE INDEX idx_customer_onboarding_status ON customer_onboarding(status);
CREATE INDEX idx_customer_onboarding_customer_type ON customer_onboarding(customer_type);
CREATE INDEX idx_customer_onboarding_risk_level ON customer_onboarding(risk_level);
CREATE INDEX idx_customer_onboarding_created_at ON customer_onboarding(created_at);
CREATE INDEX idx_customer_onboarding_reference ON customer_onboarding(customer_reference_number);
CREATE INDEX idx_customer_onboarding_phone ON customer_onboarding(phone_number);
CREATE INDEX idx_customer_onboarding_email ON customer_onboarding(email_address);

-- Spatial indexes for location-based queries
CREATE INDEX idx_customer_onboarding_residential_location ON customer_onboarding USING GIST(residential_coordinates);
CREATE INDEX idx_customer_onboarding_business_location ON customer_onboarding USING GIST(business_coordinates);
CREATE INDEX idx_customer_onboarding_geolocation ON customer_onboarding USING GIST(geolocation);

-- Document indexes
CREATE INDEX idx_customer_documents_onboarding_id ON customer_documents(customer_onboarding_id);
CREATE INDEX idx_customer_documents_type ON customer_documents(document_type);
CREATE INDEX idx_customer_documents_verification_status ON customer_documents(verification_status);
CREATE INDEX idx_customer_documents_ai_status ON customer_documents(ai_processing_status);
CREATE INDEX idx_customer_documents_uploaded_at ON customer_documents(uploaded_at);
CREATE INDEX idx_customer_documents_hash ON customer_documents(file_hash);

-- Biometric indexes
CREATE INDEX idx_customer_biometrics_onboarding_id ON customer_biometrics(customer_onboarding_id);
CREATE INDEX idx_customer_biometrics_type ON customer_biometrics(biometric_type);
CREATE INDEX idx_customer_biometrics_verification_status ON customer_biometrics(verification_status);
CREATE INDEX idx_customer_biometrics_ai_status ON customer_biometrics(ai_processing_status);
CREATE INDEX idx_customer_biometrics_captured_at ON customer_biometrics(captured_at);
CREATE INDEX idx_customer_biometrics_hash ON customer_biometrics(biometric_hash);

-- KYC verification indexes
CREATE INDEX idx_customer_kyc_onboarding_id ON customer_kyc_verification(customer_onboarding_id);
CREATE INDEX idx_customer_kyc_status ON customer_kyc_verification(status);
CREATE INDEX idx_customer_kyc_risk_level ON customer_kyc_verification(risk_level);
CREATE INDEX idx_customer_kyc_reference ON customer_kyc_verification(kyc_reference_number);

-- Risk assessment indexes
CREATE INDEX idx_customer_risk_onboarding_id ON customer_risk_assessment(customer_onboarding_id);
CREATE INDEX idx_customer_risk_overall_level ON customer_risk_assessment(overall_risk_level);
CREATE INDEX idx_customer_risk_aml_level ON customer_risk_assessment(aml_risk_level);
CREATE INDEX idx_customer_risk_fraud_level ON customer_risk_assessment(fraud_risk_level);
CREATE INDEX idx_customer_risk_reference ON customer_risk_assessment(assessment_reference);

-- Edge device indexes
CREATE INDEX idx_edge_devices_device_id ON edge_devices(device_id);
CREATE INDEX idx_edge_devices_agent_id ON edge_devices(agent_id);
CREATE INDEX idx_edge_devices_type ON edge_devices(device_type);
CREATE INDEX idx_edge_devices_status ON edge_devices(status);
CREATE INDEX idx_edge_devices_location ON edge_devices USING GIST(location_coordinates);

-- AI processing job indexes
CREATE INDEX idx_ai_jobs_status ON ai_processing_jobs(status);
CREATE INDEX idx_ai_jobs_type ON ai_processing_jobs(job_type);
CREATE INDEX idx_ai_jobs_priority ON ai_processing_jobs(priority);
CREATE INDEX idx_ai_jobs_onboarding_id ON ai_processing_jobs(customer_onboarding_id);
CREATE INDEX idx_ai_jobs_edge_device ON ai_processing_jobs(edge_device_id);
CREATE INDEX idx_ai_jobs_created_at ON ai_processing_jobs(created_at);

-- Text search indexes
CREATE INDEX idx_customer_onboarding_name_search ON customer_onboarding USING gin((first_name || ' ' || last_name) gin_trgm_ops);
CREATE INDEX idx_customer_onboarding_business_search ON customer_onboarding USING gin(business_name gin_trgm_ops);

-- =====================================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- =====================================================

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply timestamp triggers
CREATE TRIGGER update_customer_onboarding_updated_at BEFORE UPDATE ON customer_onboarding FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customer_documents_updated_at BEFORE UPDATE ON customer_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customer_biometrics_updated_at BEFORE UPDATE ON customer_biometrics FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customer_kyc_updated_at BEFORE UPDATE ON customer_kyc_verification FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customer_risk_updated_at BEFORE UPDATE ON customer_risk_assessment FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_edge_devices_updated_at BEFORE UPDATE ON edge_devices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate onboarding progress
CREATE OR REPLACE FUNCTION calculate_onboarding_progress()
RETURNS TRIGGER AS $$
DECLARE
    completed_count INTEGER := 0;
    total_count INTEGER := 12;
    progress_pct DECIMAL(5,2);
BEGIN
    -- Count completed steps
    IF NEW.documents_complete THEN completed_count := completed_count + 1; END IF;
    IF NEW.documents_verified THEN completed_count := completed_count + 1; END IF;
    IF NEW.biometric_captured THEN completed_count := completed_count + 1; END IF;
    IF NEW.biometric_verified THEN completed_count := completed_count + 1; END IF;
    IF NEW.kyc_completed THEN completed_count := completed_count + 1; END IF;
    IF NEW.kyc_verified THEN completed_count := completed_count + 1; END IF;
    IF NEW.risk_assessment_completed THEN completed_count := completed_count + 1; END IF;
    IF NEW.background_check_completed THEN completed_count := completed_count + 1; END IF;
    IF NEW.reference_check_completed THEN completed_count := completed_count + 1; END IF;
    
    -- Additional business-specific checks
    IF NEW.phone_number IS NOT NULL AND NEW.phone_number != '' THEN completed_count := completed_count + 1; END IF;
    IF NEW.residential_address IS NOT NULL AND NEW.residential_address != '' THEN completed_count := completed_count + 1; END IF;
    IF NEW.preferred_account_type IS NOT NULL THEN completed_count := completed_count + 1; END IF;
    
    -- Calculate progress percentage
    progress_pct := (completed_count::DECIMAL / total_count::DECIMAL) * 100;
    
    -- Update fields
    NEW.completed_steps := completed_count;
    NEW.progress_percentage := progress_pct;
    
    -- Update status based on progress
    IF completed_count = total_count THEN
        NEW.status := 'completed';
        NEW.onboarding_completed_at := CURRENT_TIMESTAMP;
    ELSIF completed_count >= 9 THEN
        NEW.status := 'approval_pending';
    ELSIF completed_count >= 6 THEN
        NEW.status := 'risk_assessment_pending';
    ELSIF completed_count >= 4 THEN
        NEW.status := 'kyc_pending';
    ELSIF completed_count >= 2 THEN
        NEW.status := 'biometric_pending';
    ELSIF completed_count >= 1 THEN
        NEW.status := 'documents_pending';
    ELSE
        NEW.status := 'in_progress';
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply progress calculation trigger
CREATE TRIGGER calculate_customer_onboarding_progress 
    BEFORE UPDATE ON customer_onboarding 
    FOR EACH ROW 
    EXECUTE FUNCTION calculate_onboarding_progress();

-- Function to update KYC scores
CREATE OR REPLACE FUNCTION calculate_kyc_scores()
RETURNS TRIGGER AS $$
DECLARE
    identity_weight DECIMAL := 0.30;
    address_weight DECIMAL := 0.20;
    contact_weight DECIMAL := 0.15;
    document_weight DECIMAL := 0.25;
    biometric_weight DECIMAL := 0.10;
    total_score DECIMAL := 0.0;
BEGIN
    -- Calculate weighted score
    IF NEW.identity_verified THEN
        total_score := total_score + (identity_weight * 100);
    END IF;
    
    IF NEW.address_verified THEN
        total_score := total_score + (address_weight * 100);
    END IF;
    
    IF NEW.phone_verified AND NEW.email_verified THEN
        total_score := total_score + (contact_weight * 100);
    ELSIF NEW.phone_verified OR NEW.email_verified THEN
        total_score := total_score + (contact_weight * 50);
    END IF;
    
    -- Add document verification score
    IF NEW.documents_verification_score > 0 THEN
        total_score := total_score + (document_weight * NEW.documents_verification_score);
    END IF;
    
    -- Add biometric verification score
    IF NEW.biometrics_verification_score > 0 THEN
        total_score := total_score + (biometric_weight * NEW.biometrics_verification_score);
    END IF;
    
    NEW.overall_kyc_score := total_score;
    
    -- Update status based on score
    IF total_score >= 80 THEN
        NEW.status := 'verified';
    ELSIF total_score >= 60 THEN
        NEW.status := 'processing';
    ELSE
        NEW.status := 'pending';
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply KYC score calculation trigger
CREATE TRIGGER calculate_customer_kyc_scores 
    BEFORE UPDATE ON customer_kyc_verification 
    FOR EACH ROW 
    EXECUTE FUNCTION calculate_kyc_scores();

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================

-- Customer onboarding summary view
CREATE VIEW customer_onboarding_summary AS
SELECT 
    co.id,
    co.customer_reference_number,
    co.first_name || ' ' || co.last_name AS full_name,
    co.customer_type,
    co.customer_tier,
    co.status,
    co.progress_percentage,
    co.risk_level,
    co.risk_score,
    co.agent_id,
    co.phone_number,
    co.email_address,
    co.application_started_at,
    co.onboarding_completed_at,
    
    -- Document status
    COUNT(cd.id) AS total_documents,
    COUNT(CASE WHEN cd.verification_status = 'verified' THEN 1 END) AS verified_documents,
    
    -- Biometric status
    COUNT(cb.id) AS total_biometrics,
    COUNT(CASE WHEN cb.verification_status = 'verified' THEN 1 END) AS verified_biometrics,
    
    -- KYC status
    ckv.status AS kyc_status,
    ckv.overall_kyc_score,
    
    -- Risk assessment status
    cra.overall_risk_level,
    cra.overall_risk_score
    
FROM customer_onboarding co
LEFT JOIN customer_documents cd ON co.id = cd.customer_onboarding_id
LEFT JOIN customer_biometrics cb ON co.id = cb.customer_onboarding_id
LEFT JOIN customer_kyc_verification ckv ON co.id = ckv.customer_onboarding_id
LEFT JOIN customer_risk_assessment cra ON co.id = cra.customer_onboarding_id
GROUP BY 
    co.id, co.customer_reference_number, co.first_name, co.last_name,
    co.customer_type, co.customer_tier, co.status, co.progress_percentage,
    co.risk_level, co.risk_score, co.agent_id, co.phone_number, co.email_address,
    co.application_started_at, co.onboarding_completed_at,
    ckv.status, ckv.overall_kyc_score, cra.overall_risk_level, cra.overall_risk_score;

-- Edge device status view
CREATE VIEW edge_device_status AS
SELECT 
    ed.id,
    ed.device_id,
    ed.device_name,
    ed.device_type,
    ed.agent_id,
    ed.location_name,
    ed.status,
    ed.last_heartbeat,
    ed.last_sync,
    ed.battery_level,
    ed.storage_used_gb,
    ed.storage_total_gb,
    ROUND((ed.storage_used_gb / ed.storage_total_gb) * 100, 2) AS storage_usage_percent,
    ed.cpu_usage_percent,
    ed.ai_processing_enabled,
    ed.supports_offline_mode,
    
    -- Health indicators
    CASE 
        WHEN ed.last_heartbeat > CURRENT_TIMESTAMP - INTERVAL '5 minutes' THEN 'online'
        WHEN ed.last_heartbeat > CURRENT_TIMESTAMP - INTERVAL '1 hour' THEN 'warning'
        ELSE 'offline'
    END AS connectivity_status,
    
    CASE 
        WHEN ed.battery_level > 20 THEN 'good'
        WHEN ed.battery_level > 10 THEN 'warning'
        ELSE 'critical'
    END AS battery_status,
    
    CASE 
        WHEN (ed.storage_used_gb / ed.storage_total_gb) * 100 < 80 THEN 'good'
        WHEN (ed.storage_used_gb / ed.storage_total_gb) * 100 < 95 THEN 'warning'
        ELSE 'critical'
    END AS storage_status
    
FROM edge_devices ed;

-- AI processing job queue view
CREATE VIEW ai_processing_queue AS
SELECT 
    apj.id,
    apj.job_reference,
    apj.job_type,
    apj.priority,
    apj.status,
    apj.processing_location,
    apj.edge_device_id,
    apj.customer_onboarding_id,
    apj.created_at,
    apj.started_at,
    apj.completed_at,
    
    -- Calculate processing time
    CASE 
        WHEN apj.completed_at IS NOT NULL AND apj.started_at IS NOT NULL THEN
            EXTRACT(EPOCH FROM (apj.completed_at - apj.started_at)) * 1000
        ELSE NULL
    END AS total_processing_time_ms,
    
    -- Calculate queue time
    CASE 
        WHEN apj.started_at IS NOT NULL THEN
            EXTRACT(EPOCH FROM (apj.started_at - apj.created_at)) * 1000
        ELSE 
            EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - apj.created_at)) * 1000
    END AS queue_time_ms,
    
    -- Related customer information
    co.customer_reference_number,
    co.first_name || ' ' || co.last_name AS customer_name
    
FROM ai_processing_jobs apj
LEFT JOIN customer_onboarding co ON apj.customer_onboarding_id = co.id
ORDER BY apj.priority ASC, apj.created_at ASC;

-- =====================================================
-- SAMPLE DATA FUNCTIONS
-- =====================================================

-- Function to generate customer reference number
CREATE OR REPLACE FUNCTION generate_customer_reference()
RETURNS VARCHAR(50) AS $$
BEGIN
    RETURN 'CUST-' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 999999)::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Function to generate KYC reference number
CREATE OR REPLACE FUNCTION generate_kyc_reference()
RETURNS VARCHAR(50) AS $$
BEGIN
    RETURN 'KYC-' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 999999)::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Function to generate risk assessment reference
CREATE OR REPLACE FUNCTION generate_risk_reference()
RETURNS VARCHAR(50) AS $$
BEGIN
    RETURN 'RISK-' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 999999)::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Function to generate AI job reference
CREATE OR REPLACE FUNCTION generate_ai_job_reference()
RETURNS VARCHAR(50) AS $$
BEGIN
    RETURN 'AI-' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDDHH24MISS') || '-' || LPAD(FLOOR(RANDOM() * 9999)::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON TABLE customer_onboarding IS 'Main table for customer onboarding process with comprehensive personal, business, and verification information';
COMMENT ON TABLE customer_documents IS 'Document storage and AI processing results including OCR and verification status';
COMMENT ON TABLE customer_biometrics IS 'Biometric data storage with AI processing and verification results';
COMMENT ON TABLE customer_kyc_verification IS 'KYC verification results and scoring';
COMMENT ON TABLE customer_risk_assessment IS 'Comprehensive risk assessment including AML, fraud, and credit risk';
COMMENT ON TABLE edge_devices IS 'Edge device management for distributed AI processing';
COMMENT ON TABLE ai_processing_jobs IS 'AI processing job queue for both edge and cloud processing';

COMMENT ON COLUMN customer_onboarding.customer_reference_number IS 'Unique customer reference number for tracking';
COMMENT ON COLUMN customer_onboarding.progress_percentage IS 'Calculated progress percentage based on completed steps';
COMMENT ON COLUMN customer_onboarding.risk_score IS 'Overall risk score from 0-100 (higher = more risky)';
COMMENT ON COLUMN customer_documents.ocr_structured_data IS 'Structured data extracted from documents using GOT-OCR2.0';
COMMENT ON COLUMN customer_biometrics.biometric_template IS 'Encrypted biometric template for matching';
COMMENT ON COLUMN customer_kyc_verification.overall_kyc_score IS 'Weighted KYC score from 0-100 (higher = better verification)';
COMMENT ON COLUMN edge_devices.ai_model_versions IS 'JSON object containing versions of AI models deployed on the device';
COMMENT ON COLUMN ai_processing_jobs.processing_location IS 'Where the job is processed: edge, cloud, or hybrid';

