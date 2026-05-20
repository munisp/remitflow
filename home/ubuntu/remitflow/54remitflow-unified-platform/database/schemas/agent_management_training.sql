-- Agent Management and Training System Database Schema
-- Comprehensive schema for agent onboarding, KYC verification, training, certification, and performance evaluation

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- ENUMERATIONS
-- =====================================================

-- Onboarding Status
CREATE TYPE onboarding_status AS ENUM (
    'not_started', 'in_progress', 'documents_pending', 'kyc_pending', 
    'training_pending', 'background_check_pending', 'completed', 'rejected'
);

-- KYC Status
CREATE TYPE kyc_status AS ENUM (
    'not_started', 'documents_uploaded', 'under_review', 'additional_info_required',
    'verified', 'rejected', 'expired'
);

-- Training Status
CREATE TYPE training_status AS ENUM (
    'not_started', 'enrolled', 'in_progress', 'completed', 'failed', 'expired'
);

-- Certification Status
CREATE TYPE certification_status AS ENUM (
    'not_certified', 'in_progress', 'certified', 'expired', 'revoked'
);

-- Document Type
CREATE TYPE document_type AS ENUM (
    'national_id', 'passport', 'drivers_license', 'business_license', 
    'tax_certificate', 'bank_statement', 'utility_bill', 'photo',
    'educational_certificate', 'employment_letter', 'reference_letter'
);

-- Verification Method
CREATE TYPE verification_method AS ENUM (
    'manual', 'automated', 'hybrid', 'third_party'
);

-- Training Type
CREATE TYPE training_type AS ENUM (
    'onboarding', 'compliance', 'product', 'technical', 'soft_skills', 'certification'
);

-- Assessment Type
CREATE TYPE assessment_type AS ENUM (
    'quiz', 'practical', 'interview', 'simulation', 'project'
);

-- Performance Category
CREATE TYPE performance_category AS ENUM (
    'transaction_volume', 'customer_satisfaction', 'compliance', 'training', 'network_growth'
);

-- =====================================================
-- AGENT ONBOARDING TABLES
-- =====================================================

-- Agent Onboarding Process
CREATE TABLE agent_onboarding (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL,
    agent_tier VARCHAR(20) NOT NULL,
    
    -- Onboarding Information
    application_number VARCHAR(50) UNIQUE NOT NULL,
    status onboarding_status DEFAULT 'not_started',
    current_step VARCHAR(100) NOT NULL DEFAULT 'application_submission',
    total_steps INTEGER NOT NULL DEFAULT 8,
    completed_steps INTEGER DEFAULT 0,
    progress_percentage DECIMAL(5,2) DEFAULT 0.0,
    
    -- Timeline
    application_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    documents_submitted_at TIMESTAMP,
    kyc_initiated_at TIMESTAMP,
    kyc_completed_at TIMESTAMP,
    training_started_at TIMESTAMP,
    training_completed_at TIMESTAMP,
    background_check_initiated_at TIMESTAMP,
    background_check_completed_at TIMESTAMP,
    onboarding_completed_at TIMESTAMP,
    
    -- Assigned Personnel
    assigned_reviewer UUID,
    assigned_trainer UUID,
    assigned_supervisor UUID,
    
    -- Requirements Checklist
    documents_complete BOOLEAN DEFAULT FALSE,
    kyc_verified BOOLEAN DEFAULT FALSE,
    training_completed BOOLEAN DEFAULT FALSE,
    background_check_passed BOOLEAN DEFAULT FALSE,
    references_verified BOOLEAN DEFAULT FALSE,
    bank_account_verified BOOLEAN DEFAULT FALSE,
    equipment_assigned BOOLEAN DEFAULT FALSE,
    territory_assigned BOOLEAN DEFAULT FALSE,
    
    -- Notes and Comments
    reviewer_notes TEXT,
    rejection_reason TEXT,
    special_instructions TEXT,
    
    -- System Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    
    -- Constraints
    CONSTRAINT agent_onboarding_progress_check CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
    CONSTRAINT agent_onboarding_steps_check CHECK (completed_steps >= 0 AND completed_steps <= total_steps)
);

-- Onboarding Steps Configuration
CREATE TABLE onboarding_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    step_number INTEGER NOT NULL,
    step_name VARCHAR(100) NOT NULL,
    step_description TEXT,
    agent_tier VARCHAR(20) NOT NULL,
    
    -- Step Configuration
    is_mandatory BOOLEAN DEFAULT TRUE,
    estimated_duration_hours INTEGER,
    prerequisite_steps INTEGER[],
    auto_advance BOOLEAN DEFAULT FALSE,
    
    -- Validation Rules
    validation_rules JSONB,
    required_documents TEXT[],
    required_approvals TEXT[],
    
    -- System Fields
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(step_number, agent_tier)
);

-- Agent Onboarding Step Progress
CREATE TABLE agent_onboarding_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    onboarding_id UUID NOT NULL REFERENCES agent_onboarding(id) ON DELETE CASCADE,
    step_id UUID NOT NULL REFERENCES onboarding_steps(id),
    
    -- Step Progress
    status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, completed, failed, skipped
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    attempts_count INTEGER DEFAULT 0,
    
    -- Step Data
    step_data JSONB,
    validation_results JSONB,
    reviewer_comments TEXT,
    
    -- System Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(onboarding_id, step_id)
);

-- =====================================================
-- KYC VERIFICATION TABLES
-- =====================================================

-- KYC Verification Process
CREATE TABLE kyc_verification (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL,
    agent_tier VARCHAR(20) NOT NULL,
    
    -- KYC Information
    kyc_reference_number VARCHAR(50) UNIQUE NOT NULL,
    status kyc_status DEFAULT 'not_started',
    verification_level VARCHAR(20) DEFAULT 'basic', -- basic, enhanced, premium
    risk_level VARCHAR(20) DEFAULT 'medium', -- low, medium, high
    
    -- Personal Information Verification
    identity_verified BOOLEAN DEFAULT FALSE,
    address_verified BOOLEAN DEFAULT FALSE,
    phone_verified BOOLEAN DEFAULT FALSE,
    email_verified BOOLEAN DEFAULT FALSE,
    
    -- Business Information Verification (for business agents)
    business_registration_verified BOOLEAN DEFAULT FALSE,
    tax_registration_verified BOOLEAN DEFAULT FALSE,
    business_address_verified BOOLEAN DEFAULT FALSE,
    
    -- Financial Information Verification
    bank_account_verified BOOLEAN DEFAULT FALSE,
    financial_statements_verified BOOLEAN DEFAULT FALSE,
    credit_check_completed BOOLEAN DEFAULT FALSE,
    
    -- Verification Methods Used
    document_verification_method verification_method,
    biometric_verification_completed BOOLEAN DEFAULT FALSE,
    third_party_verification_completed BOOLEAN DEFAULT FALSE,
    
    -- Verification Results
    overall_score DECIMAL(5,2) DEFAULT 0.0,
    identity_score DECIMAL(5,2) DEFAULT 0.0,
    address_score DECIMAL(5,2) DEFAULT 0.0,
    financial_score DECIMAL(5,2) DEFAULT 0.0,
    risk_score DECIMAL(5,2) DEFAULT 50.0,
    
    -- Timeline
    initiated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    documents_submitted_at TIMESTAMP,
    review_started_at TIMESTAMP,
    review_completed_at TIMESTAMP,
    verification_completed_at TIMESTAMP,
    expiry_date TIMESTAMP,
    
    -- Personnel
    assigned_reviewer UUID,
    verified_by UUID,
    
    -- Notes
    reviewer_notes TEXT,
    rejection_reason TEXT,
    additional_requirements TEXT,
    
    -- System Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    
    -- Constraints
    CONSTRAINT kyc_verification_scores_check CHECK (
        overall_score >= 0 AND overall_score <= 100 AND
        identity_score >= 0 AND identity_score <= 100 AND
        address_score >= 0 AND address_score <= 100 AND
        financial_score >= 0 AND financial_score <= 100 AND
        risk_score >= 0 AND risk_score <= 100
    )
);

-- Document Management
CREATE TABLE agent_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL,
    kyc_verification_id UUID REFERENCES kyc_verification(id),
    
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
    file_hash VARCHAR(128) UNIQUE,
    
    -- Verification Status
    verification_status kyc_status DEFAULT 'not_started',
    verification_method verification_method,
    verified_at TIMESTAMP,
    verified_by UUID,
    verification_notes TEXT,
    
    -- OCR and AI Processing
    ocr_processed BOOLEAN DEFAULT FALSE,
    ocr_confidence DECIMAL(5,2),
    extracted_text TEXT,
    extracted_data JSONB,
    ai_verification_score DECIMAL(5,2),
    ai_verification_flags TEXT[],
    
    -- Document Quality
    image_quality_score DECIMAL(5,2),
    document_authenticity_score DECIMAL(5,2),
    tampering_detected BOOLEAN DEFAULT FALSE,
    
    -- System Fields
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    uploaded_by UUID,
    
    -- Constraints
    CONSTRAINT agent_documents_quality_scores_check CHECK (
        (ocr_confidence IS NULL OR (ocr_confidence >= 0 AND ocr_confidence <= 100)) AND
        (ai_verification_score IS NULL OR (ai_verification_score >= 0 AND ai_verification_score <= 100)) AND
        (image_quality_score IS NULL OR (image_quality_score >= 0 AND image_quality_score <= 100)) AND
        (document_authenticity_score IS NULL OR (document_authenticity_score >= 0 AND document_authenticity_score <= 100))
    )
);

-- Background Check Results
CREATE TABLE background_checks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL,
    kyc_verification_id UUID REFERENCES kyc_verification(id),
    
    -- Check Information
    check_reference_number VARCHAR(50) UNIQUE NOT NULL,
    check_type VARCHAR(50) NOT NULL, -- criminal, credit, employment, education, reference
    status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, completed, failed
    
    -- Check Provider
    provider_name VARCHAR(255),
    provider_reference VARCHAR(100),
    
    -- Results
    result VARCHAR(20), -- clear, flagged, rejected
    score DECIMAL(5,2),
    findings TEXT,
    recommendations TEXT,
    
    -- Timeline
    initiated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    
    -- System Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    
    -- Constraints
    CONSTRAINT background_checks_score_check CHECK (score IS NULL OR (score >= 0 AND score <= 100))
);

-- =====================================================
-- TRAINING SYSTEM TABLES
-- =====================================================

-- Training Programs
CREATE TABLE training_programs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_code VARCHAR(20) UNIQUE NOT NULL,
    program_name VARCHAR(255) NOT NULL,
    program_description TEXT,
    
    -- Program Configuration
    target_tier VARCHAR(20) NOT NULL,
    training_type training_type NOT NULL,
    is_mandatory BOOLEAN DEFAULT TRUE,
    prerequisite_programs UUID[],
    
    -- Content Information
    estimated_duration_hours INTEGER NOT NULL,
    total_modules INTEGER DEFAULT 1,
    passing_score DECIMAL(5,2) DEFAULT 70.0,
    max_attempts INTEGER DEFAULT 3,
    
    -- Validity and Certification
    certification_provided BOOLEAN DEFAULT FALSE,
    certification_validity_months INTEGER,
    continuing_education_required BOOLEAN DEFAULT FALSE,
    
    -- Program Status
    is_active BOOLEAN DEFAULT TRUE,
    version VARCHAR(10) DEFAULT '1.0',
    
    -- System Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    
    -- Constraints
    CONSTRAINT training_programs_passing_score_check CHECK (passing_score >= 0 AND passing_score <= 100)
);

-- Training Modules
CREATE TABLE training_modules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id UUID NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
    module_code VARCHAR(20) NOT NULL,
    module_name VARCHAR(255) NOT NULL,
    module_description TEXT,
    
    -- Module Configuration
    module_order INTEGER NOT NULL,
    estimated_duration_hours INTEGER NOT NULL,
    is_mandatory BOOLEAN DEFAULT TRUE,
    prerequisite_modules UUID[],
    
    -- Content Information
    content_type VARCHAR(50), -- video, interactive, document, quiz, simulation
    content_url TEXT,
    content_metadata JSONB,
    
    -- Assessment Configuration
    has_assessment BOOLEAN DEFAULT FALSE,
    assessment_type assessment_type,
    passing_score DECIMAL(5,2) DEFAULT 70.0,
    max_attempts INTEGER DEFAULT 3,
    
    -- System Fields
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    
    -- Constraints
    UNIQUE(program_id, module_code),
    CONSTRAINT training_modules_passing_score_check CHECK (passing_score >= 0 AND passing_score <= 100)
);

-- Agent Training Enrollments
CREATE TABLE agent_training_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL,
    program_id UUID NOT NULL REFERENCES training_programs(id),
    
    -- Enrollment Information
    enrollment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    enrollment_type VARCHAR(20) DEFAULT 'mandatory', -- mandatory, voluntary, assigned
    assigned_by UUID,
    
    -- Progress Tracking
    status training_status DEFAULT 'enrolled',
    progress_percentage DECIMAL(5,2) DEFAULT 0.0,
    current_module_id UUID REFERENCES training_modules(id),
    
    -- Timeline
    started_at TIMESTAMP,
    target_completion_date TIMESTAMP,
    completed_at TIMESTAMP,
    
    -- Performance
    attempts_count INTEGER DEFAULT 0,
    best_score DECIMAL(5,2) DEFAULT 0.0,
    latest_score DECIMAL(5,2) DEFAULT 0.0,
    total_study_hours DECIMAL(8,2) DEFAULT 0.0,
    
    -- Certification
    certification_earned BOOLEAN DEFAULT FALSE,
    certificate_number VARCHAR(100),
    certificate_issued_at TIMESTAMP,
    certificate_expires_at TIMESTAMP,
    
    -- System Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(agent_id, program_id),
    CONSTRAINT agent_training_enrollments_progress_check CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
    CONSTRAINT agent_training_enrollments_scores_check CHECK (
        best_score >= 0 AND best_score <= 100 AND
        latest_score >= 0 AND latest_score <= 100
    )
);

-- Agent Module Progress
CREATE TABLE agent_module_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id UUID NOT NULL REFERENCES agent_training_enrollments(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES training_modules(id),
    
    -- Progress Information
    status training_status DEFAULT 'not_started',
    progress_percentage DECIMAL(5,2) DEFAULT 0.0,
    
    -- Timeline
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    last_accessed_at TIMESTAMP,
    
    -- Performance
    attempts_count INTEGER DEFAULT 0,
    best_score DECIMAL(5,2) DEFAULT 0.0,
    latest_score DECIMAL(5,2) DEFAULT 0.0,
    study_time_hours DECIMAL(8,2) DEFAULT 0.0,
    
    -- Assessment Results
    assessment_passed BOOLEAN DEFAULT FALSE,
    assessment_data JSONB,
    
    -- System Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(enrollment_id, module_id),
    CONSTRAINT agent_module_progress_progress_check CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
    CONSTRAINT agent_module_progress_scores_check CHECK (
        best_score >= 0 AND best_score <= 100 AND
        latest_score >= 0 AND latest_score <= 100
    )
);

-- Training Assessments
CREATE TABLE training_assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id UUID NOT NULL REFERENCES training_modules(id),
    
    -- Assessment Information
    assessment_name VARCHAR(255) NOT NULL,
    assessment_description TEXT,
    assessment_type assessment_type NOT NULL,
    
    -- Configuration
    time_limit_minutes INTEGER,
    passing_score DECIMAL(5,2) DEFAULT 70.0,
    max_attempts INTEGER DEFAULT 3,
    randomize_questions BOOLEAN DEFAULT TRUE,
    
    -- Questions Configuration
    total_questions INTEGER,
    questions_data JSONB, -- Store questions, options, correct answers
    
    -- System Fields
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    
    -- Constraints
    CONSTRAINT training_assessments_passing_score_check CHECK (passing_score >= 0 AND passing_score <= 100)
);

-- Assessment Attempts
CREATE TABLE assessment_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL,
    assessment_id UUID NOT NULL REFERENCES training_assessments(id),
    module_progress_id UUID NOT NULL REFERENCES agent_module_progress(id),
    
    -- Attempt Information
    attempt_number INTEGER NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    submitted_at TIMESTAMP,
    time_taken_minutes INTEGER,
    
    -- Results
    score DECIMAL(5,2),
    passed BOOLEAN DEFAULT FALSE,
    correct_answers INTEGER DEFAULT 0,
    total_questions INTEGER,
    
    -- Attempt Data
    answers_data JSONB, -- Store user answers
    detailed_results JSONB, -- Store question-by-question results
    
    -- System Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT assessment_attempts_score_check CHECK (score IS NULL OR (score >= 0 AND score <= 100))
);

-- =====================================================
-- CERTIFICATION SYSTEM TABLES
-- =====================================================

-- Certification Types
CREATE TABLE certification_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    certification_code VARCHAR(20) UNIQUE NOT NULL,
    certification_name VARCHAR(255) NOT NULL,
    certification_description TEXT,
    
    -- Configuration
    target_tier VARCHAR(20) NOT NULL,
    required_programs UUID[] NOT NULL,
    additional_requirements TEXT[],
    
    -- Validity
    validity_months INTEGER NOT NULL,
    renewal_required BOOLEAN DEFAULT TRUE,
    continuing_education_hours INTEGER,
    
    -- System Fields
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID
);

-- Agent Certifications
CREATE TABLE agent_certifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL,
    certification_type_id UUID NOT NULL REFERENCES certification_types(id),
    
    -- Certification Information
    certificate_number VARCHAR(100) UNIQUE NOT NULL,
    status certification_status DEFAULT 'in_progress',
    
    -- Timeline
    application_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    issued_date TIMESTAMP,
    expiry_date TIMESTAMP,
    renewal_date TIMESTAMP,
    
    -- Requirements Tracking
    training_completed BOOLEAN DEFAULT FALSE,
    assessment_passed BOOLEAN DEFAULT FALSE,
    additional_requirements_met BOOLEAN DEFAULT FALSE,
    
    -- Certification Data
    issuing_authority VARCHAR(255),
    issued_by UUID,
    certification_data JSONB,
    
    -- System Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(agent_id, certification_type_id, issued_date)
);

-- =====================================================
-- PERFORMANCE EVALUATION TABLES
-- =====================================================

-- Performance Evaluation Criteria
CREATE TABLE performance_criteria (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    criteria_code VARCHAR(20) UNIQUE NOT NULL,
    criteria_name VARCHAR(255) NOT NULL,
    criteria_description TEXT,
    
    -- Configuration
    category performance_category NOT NULL,
    target_tier VARCHAR(20) NOT NULL,
    weight_percentage DECIMAL(5,2) NOT NULL,
    
    -- Measurement
    measurement_method VARCHAR(50), -- quantitative, qualitative, hybrid
    measurement_unit VARCHAR(20),
    target_value DECIMAL(12,2),
    minimum_threshold DECIMAL(12,2),
    
    -- Scoring
    scoring_method VARCHAR(50), -- linear, tiered, custom
    max_score DECIMAL(5,2) DEFAULT 100.0,
    
    -- System Fields
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    
    -- Constraints
    CONSTRAINT performance_criteria_weight_check CHECK (weight_percentage >= 0 AND weight_percentage <= 100),
    CONSTRAINT performance_criteria_max_score_check CHECK (max_score >= 0 AND max_score <= 100)
);

-- Agent Performance Evaluations
CREATE TABLE agent_performance_evaluations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL,
    
    -- Evaluation Information
    evaluation_period_start DATE NOT NULL,
    evaluation_period_end DATE NOT NULL,
    evaluation_type VARCHAR(20) DEFAULT 'regular', -- regular, probationary, annual, special
    
    -- Overall Results
    overall_score DECIMAL(5,2),
    overall_rating VARCHAR(20), -- excellent, good, satisfactory, needs_improvement, poor
    
    -- Category Scores
    transaction_volume_score DECIMAL(5,2),
    customer_satisfaction_score DECIMAL(5,2),
    compliance_score DECIMAL(5,2),
    training_score DECIMAL(5,2),
    network_growth_score DECIMAL(5,2),
    
    -- Evaluation Status
    status VARCHAR(20) DEFAULT 'draft', -- draft, submitted, reviewed, approved, published
    
    -- Personnel
    evaluator_id UUID,
    reviewer_id UUID,
    approved_by UUID,
    
    -- Timeline
    evaluation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    submitted_at TIMESTAMP,
    reviewed_at TIMESTAMP,
    approved_at TIMESTAMP,
    published_at TIMESTAMP,
    
    -- Comments and Recommendations
    evaluator_comments TEXT,
    strengths TEXT,
    areas_for_improvement TEXT,
    development_recommendations TEXT,
    action_plan TEXT,
    
    -- System Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    
    -- Constraints
    CONSTRAINT agent_performance_evaluations_scores_check CHECK (
        (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100)) AND
        (transaction_volume_score IS NULL OR (transaction_volume_score >= 0 AND transaction_volume_score <= 100)) AND
        (customer_satisfaction_score IS NULL OR (customer_satisfaction_score >= 0 AND customer_satisfaction_score <= 100)) AND
        (compliance_score IS NULL OR (compliance_score >= 0 AND compliance_score <= 100)) AND
        (training_score IS NULL OR (training_score >= 0 AND training_score <= 100)) AND
        (network_growth_score IS NULL OR (network_growth_score >= 0 AND network_growth_score <= 100))
    )
);

-- Performance Evaluation Details
CREATE TABLE performance_evaluation_details (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    evaluation_id UUID NOT NULL REFERENCES agent_performance_evaluations(id) ON DELETE CASCADE,
    criteria_id UUID NOT NULL REFERENCES performance_criteria(id),
    
    -- Measurement Data
    measured_value DECIMAL(12,2),
    target_value DECIMAL(12,2),
    achievement_percentage DECIMAL(5,2),
    
    -- Scoring
    raw_score DECIMAL(5,2),
    weighted_score DECIMAL(5,2),
    
    -- Comments
    evaluator_notes TEXT,
    supporting_evidence TEXT,
    
    -- System Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(evaluation_id, criteria_id),
    CONSTRAINT performance_evaluation_details_scores_check CHECK (
        (achievement_percentage IS NULL OR (achievement_percentage >= 0)) AND
        (raw_score IS NULL OR (raw_score >= 0 AND raw_score <= 100)) AND
        (weighted_score IS NULL OR (weighted_score >= 0 AND weighted_score <= 100))
    )
);

-- =====================================================
-- AUDIT AND COMPLIANCE TABLES
-- =====================================================

-- Agent Activity Log
CREATE TABLE agent_activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL,
    
    -- Activity Information
    activity_type VARCHAR(100) NOT NULL,
    activity_description TEXT NOT NULL,
    activity_category VARCHAR(50), -- onboarding, training, performance, compliance
    
    -- Context
    related_entity_type VARCHAR(50), -- training_program, assessment, evaluation, document
    related_entity_id UUID,
    
    -- Activity Data
    activity_data JSONB,
    old_values JSONB,
    new_values JSONB,
    
    -- Session Information
    session_id VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    
    -- System Fields
    performed_by UUID,
    performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes for performance
    INDEX idx_agent_activity_log_agent_id (agent_id),
    INDEX idx_agent_activity_log_performed_at (performed_at),
    INDEX idx_agent_activity_log_activity_type (activity_type),
    INDEX idx_agent_activity_log_category (activity_category)
);

-- Compliance Tracking
CREATE TABLE compliance_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL,
    
    -- Compliance Information
    compliance_type VARCHAR(100) NOT NULL, -- kyc, training, certification, performance
    requirement_name VARCHAR(255) NOT NULL,
    requirement_description TEXT,
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending', -- pending, compliant, non_compliant, expired
    compliance_date TIMESTAMP,
    expiry_date TIMESTAMP,
    
    -- Evidence
    evidence_type VARCHAR(50), -- document, assessment, evaluation, system_record
    evidence_reference VARCHAR(255),
    evidence_data JSONB,
    
    -- Verification
    verified_by UUID,
    verified_at TIMESTAMP,
    verification_notes TEXT,
    
    -- System Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    updated_by UUID
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Agent Onboarding Indexes
CREATE INDEX idx_agent_onboarding_agent_id ON agent_onboarding(agent_id);
CREATE INDEX idx_agent_onboarding_status ON agent_onboarding(status);
CREATE INDEX idx_agent_onboarding_application_date ON agent_onboarding(application_date);

-- KYC Verification Indexes
CREATE INDEX idx_kyc_verification_agent_id ON kyc_verification(agent_id);
CREATE INDEX idx_kyc_verification_status ON kyc_verification(status);
CREATE INDEX idx_kyc_verification_initiated_at ON kyc_verification(initiated_at);

-- Document Indexes
CREATE INDEX idx_agent_documents_agent_id ON agent_documents(agent_id);
CREATE INDEX idx_agent_documents_type ON agent_documents(document_type);
CREATE INDEX idx_agent_documents_verification_status ON agent_documents(verification_status);

-- Training Indexes
CREATE INDEX idx_agent_training_enrollments_agent_id ON agent_training_enrollments(agent_id);
CREATE INDEX idx_agent_training_enrollments_program_id ON agent_training_enrollments(program_id);
CREATE INDEX idx_agent_training_enrollments_status ON agent_training_enrollments(status);

-- Performance Evaluation Indexes
CREATE INDEX idx_agent_performance_evaluations_agent_id ON agent_performance_evaluations(agent_id);
CREATE INDEX idx_agent_performance_evaluations_period ON agent_performance_evaluations(evaluation_period_start, evaluation_period_end);
CREATE INDEX idx_agent_performance_evaluations_status ON agent_performance_evaluations(status);

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

-- Apply update triggers
CREATE TRIGGER update_agent_onboarding_updated_at BEFORE UPDATE ON agent_onboarding FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_kyc_verification_updated_at BEFORE UPDATE ON kyc_verification FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_agent_documents_updated_at BEFORE UPDATE ON agent_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_training_programs_updated_at BEFORE UPDATE ON training_programs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_agent_training_enrollments_updated_at BEFORE UPDATE ON agent_training_enrollments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_agent_performance_evaluations_updated_at BEFORE UPDATE ON agent_performance_evaluations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update onboarding progress
CREATE OR REPLACE FUNCTION update_onboarding_progress()
RETURNS TRIGGER AS $$
BEGIN
    -- Update progress percentage based on completed steps
    UPDATE agent_onboarding 
    SET 
        progress_percentage = (completed_steps::DECIMAL / total_steps) * 100,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.onboarding_id;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_onboarding_progress_trigger 
    AFTER UPDATE ON agent_onboarding_steps 
    FOR EACH ROW 
    WHEN (NEW.status = 'completed' AND OLD.status != 'completed')
    EXECUTE FUNCTION update_onboarding_progress();

-- Function to update training enrollment progress
CREATE OR REPLACE FUNCTION update_training_progress()
RETURNS TRIGGER AS $$
DECLARE
    total_modules INTEGER;
    completed_modules INTEGER;
    progress_pct DECIMAL(5,2);
BEGIN
    -- Get total modules for the program
    SELECT COUNT(*) INTO total_modules
    FROM training_modules tm
    JOIN agent_training_enrollments ate ON tm.program_id = ate.program_id
    WHERE ate.id = NEW.enrollment_id AND tm.is_active = TRUE;
    
    -- Get completed modules
    SELECT COUNT(*) INTO completed_modules
    FROM agent_module_progress amp
    WHERE amp.enrollment_id = NEW.enrollment_id AND amp.status = 'completed';
    
    -- Calculate progress percentage
    IF total_modules > 0 THEN
        progress_pct = (completed_modules::DECIMAL / total_modules) * 100;
    ELSE
        progress_pct = 0;
    END IF;
    
    -- Update enrollment progress
    UPDATE agent_training_enrollments 
    SET 
        progress_percentage = progress_pct,
        updated_at = CURRENT_TIMESTAMP,
        status = CASE 
            WHEN progress_pct = 100 THEN 'completed'::training_status
            WHEN progress_pct > 0 THEN 'in_progress'::training_status
            ELSE status
        END
    WHERE id = NEW.enrollment_id;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_training_progress_trigger 
    AFTER UPDATE ON agent_module_progress 
    FOR EACH ROW 
    WHEN (NEW.status = 'completed' AND OLD.status != 'completed')
    EXECUTE FUNCTION update_training_progress();

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================

-- Agent Onboarding Status View
CREATE VIEW agent_onboarding_status_view AS
SELECT 
    ao.agent_id,
    ao.agent_tier,
    ao.application_number,
    ao.status,
    ao.progress_percentage,
    ao.completed_steps,
    ao.total_steps,
    ao.application_date,
    ao.onboarding_completed_at,
    CASE 
        WHEN ao.status = 'completed' THEN 'Completed'
        WHEN ao.status = 'rejected' THEN 'Rejected'
        WHEN ao.progress_percentage >= 75 THEN 'Near Completion'
        WHEN ao.progress_percentage >= 50 THEN 'In Progress'
        WHEN ao.progress_percentage >= 25 THEN 'Getting Started'
        ELSE 'Just Started'
    END as progress_stage,
    EXTRACT(DAYS FROM CURRENT_TIMESTAMP - ao.application_date) as days_since_application
FROM agent_onboarding ao;

-- KYC Verification Summary View
CREATE VIEW kyc_verification_summary_view AS
SELECT 
    kv.agent_id,
    kv.kyc_reference_number,
    kv.status,
    kv.verification_level,
    kv.risk_level,
    kv.overall_score,
    kv.identity_verified,
    kv.address_verified,
    kv.phone_verified,
    kv.email_verified,
    kv.bank_account_verified,
    kv.initiated_at,
    kv.verification_completed_at,
    COUNT(ad.id) as total_documents,
    COUNT(CASE WHEN ad.verification_status = 'verified' THEN 1 END) as verified_documents,
    COUNT(bc.id) as background_checks,
    COUNT(CASE WHEN bc.result = 'clear' THEN 1 END) as clear_background_checks
FROM kyc_verification kv
LEFT JOIN agent_documents ad ON kv.id = ad.kyc_verification_id
LEFT JOIN background_checks bc ON kv.id = bc.kyc_verification_id
GROUP BY kv.id, kv.agent_id, kv.kyc_reference_number, kv.status, kv.verification_level, 
         kv.risk_level, kv.overall_score, kv.identity_verified, kv.address_verified, 
         kv.phone_verified, kv.email_verified, kv.bank_account_verified, 
         kv.initiated_at, kv.verification_completed_at;

-- Training Progress Summary View
CREATE VIEW training_progress_summary_view AS
SELECT 
    ate.agent_id,
    tp.program_name,
    ate.status,
    ate.progress_percentage,
    ate.enrollment_date,
    ate.started_at,
    ate.completed_at,
    ate.best_score,
    ate.certification_earned,
    ate.certificate_number,
    ate.certificate_expires_at,
    COUNT(tm.id) as total_modules,
    COUNT(CASE WHEN amp.status = 'completed' THEN 1 END) as completed_modules,
    COUNT(CASE WHEN amp.status = 'in_progress' THEN 1 END) as in_progress_modules,
    AVG(amp.best_score) as average_module_score
FROM agent_training_enrollments ate
JOIN training_programs tp ON ate.program_id = tp.id
LEFT JOIN training_modules tm ON tp.id = tm.program_id AND tm.is_active = TRUE
LEFT JOIN agent_module_progress amp ON ate.id = amp.enrollment_id
GROUP BY ate.id, ate.agent_id, tp.program_name, ate.status, ate.progress_percentage,
         ate.enrollment_date, ate.started_at, ate.completed_at, ate.best_score,
         ate.certification_earned, ate.certificate_number, ate.certificate_expires_at;

-- Performance Evaluation Summary View
CREATE VIEW performance_evaluation_summary_view AS
SELECT 
    ape.agent_id,
    ape.evaluation_period_start,
    ape.evaluation_period_end,
    ape.evaluation_type,
    ape.overall_score,
    ape.overall_rating,
    ape.transaction_volume_score,
    ape.customer_satisfaction_score,
    ape.compliance_score,
    ape.training_score,
    ape.network_growth_score,
    ape.status,
    ape.evaluation_date,
    ape.approved_at,
    COUNT(ped.id) as total_criteria_evaluated,
    AVG(ped.achievement_percentage) as average_achievement_percentage
FROM agent_performance_evaluations ape
LEFT JOIN performance_evaluation_details ped ON ape.id = ped.evaluation_id
GROUP BY ape.id, ape.agent_id, ape.evaluation_period_start, ape.evaluation_period_end,
         ape.evaluation_type, ape.overall_score, ape.overall_rating,
         ape.transaction_volume_score, ape.customer_satisfaction_score,
         ape.compliance_score, ape.training_score, ape.network_growth_score,
         ape.status, ape.evaluation_date, ape.approved_at;

-- Agent Certification Status View
CREATE VIEW agent_certification_status_view AS
SELECT 
    ac.agent_id,
    ct.certification_name,
    ac.certificate_number,
    ac.status,
    ac.issued_date,
    ac.expiry_date,
    ac.renewal_date,
    CASE 
        WHEN ac.expiry_date < CURRENT_DATE THEN 'Expired'
        WHEN ac.expiry_date < CURRENT_DATE + INTERVAL '30 days' THEN 'Expiring Soon'
        WHEN ac.status = 'certified' THEN 'Active'
        ELSE 'Inactive'
    END as certification_status,
    EXTRACT(DAYS FROM ac.expiry_date - CURRENT_DATE) as days_until_expiry
FROM agent_certifications ac
JOIN certification_types ct ON ac.certification_type_id = ct.id;

-- =====================================================
-- SAMPLE DATA INSERTION
-- =====================================================

-- Insert sample onboarding steps
INSERT INTO onboarding_steps (step_number, step_name, step_description, agent_tier, estimated_duration_hours) VALUES
(1, 'Application Submission', 'Submit initial application with basic information', 'agent', 1),
(2, 'Document Upload', 'Upload required identification and business documents', 'agent', 2),
(3, 'KYC Verification', 'Complete Know Your Customer verification process', 'agent', 24),
(4, 'Background Check', 'Undergo comprehensive background verification', 'agent', 48),
(5, 'Training Enrollment', 'Enroll in mandatory training programs', 'agent', 1),
(6, 'Training Completion', 'Complete all required training modules', 'agent', 40),
(7, 'Territory Assignment', 'Receive territory and customer assignment', 'agent', 2),
(8, 'Final Approval', 'Receive final approval and activation', 'agent', 4);

-- Insert sample training programs
INSERT INTO training_programs (program_code, program_name, program_description, target_tier, training_type, estimated_duration_hours) VALUES
('BASIC-001', 'Basic Banking Operations', 'Introduction to fundamental banking operations and services', 'agent', 'onboarding', 8),
('COMP-001', 'Compliance and Regulations', 'Understanding banking regulations and compliance requirements', 'agent', 'compliance', 6),
('CUST-001', 'Customer Service Excellence', 'Advanced customer service skills and techniques', 'agent', 'soft_skills', 4),
('TECH-001', 'Technology and Systems', 'Training on banking technology and systems usage', 'agent', 'technical', 6),
('PROD-001', 'Product Knowledge', 'Comprehensive knowledge of banking products and services', 'agent', 'product', 8);

-- Insert sample performance criteria
INSERT INTO performance_criteria (criteria_code, criteria_name, category, target_tier, weight_percentage, measurement_method, target_value) VALUES
('TXN-VOL', 'Transaction Volume', 'transaction_volume', 'agent', 25.0, 'quantitative', 100000.00),
('CUST-SAT', 'Customer Satisfaction', 'customer_satisfaction', 'agent', 20.0, 'quantitative', 85.0),
('COMP-SCR', 'Compliance Score', 'compliance', 'agent', 20.0, 'quantitative', 95.0),
('TRN-SCR', 'Training Score', 'training', 'agent', 15.0, 'quantitative', 80.0),
('NET-GRW', 'Network Growth', 'network_growth', 'agent', 20.0, 'quantitative', 10.0);

-- Insert sample certification types
INSERT INTO certification_types (certification_code, certification_name, target_tier, required_programs, validity_months) VALUES
('CERT-BASIC', 'Basic Agent Certification', 'agent', ARRAY[(SELECT id FROM training_programs WHERE program_code = 'BASIC-001')], 12),
('CERT-ADV', 'Advanced Agent Certification', 'agent', ARRAY[(SELECT id FROM training_programs WHERE program_code = 'BASIC-001'), (SELECT id FROM training_programs WHERE program_code = 'COMP-001')], 24);

-- =====================================================
-- COMMENTS AND DOCUMENTATION
-- =====================================================

COMMENT ON TABLE agent_onboarding IS 'Tracks the complete agent onboarding process from application to activation';
COMMENT ON TABLE kyc_verification IS 'Manages Know Your Customer verification process with comprehensive scoring';
COMMENT ON TABLE agent_documents IS 'Stores and tracks verification status of agent documents with OCR processing';
COMMENT ON TABLE training_programs IS 'Defines training programs with modules and certification requirements';
COMMENT ON TABLE agent_training_enrollments IS 'Tracks agent enrollment and progress in training programs';
COMMENT ON TABLE agent_performance_evaluations IS 'Comprehensive performance evaluation system with multiple criteria';
COMMENT ON TABLE agent_certifications IS 'Manages agent certifications with expiry and renewal tracking';
COMMENT ON TABLE compliance_tracking IS 'Tracks compliance requirements and status for regulatory adherence';

-- End of Agent Management and Training System Database Schema

