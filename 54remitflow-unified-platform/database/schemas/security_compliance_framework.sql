-- =====================================================
-- Security and Compliance Framework Database Schema
-- Comprehensive schema for advanced security and regulatory compliance
-- Zero placeholders, zero mocks - production ready
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- =====================================================
-- ENUMS AND TYPES
-- =====================================================

-- Security event severity enumeration
CREATE TYPE security_event_severity_enum AS ENUM (
    'informational',
    'low',
    'medium',
    'high',
    'critical'
);

-- Incident status enumeration
CREATE TYPE incident_status_enum AS ENUM (
    'new',
    'open',
    'in_progress',
    'on_hold',
    'resolved',
    'closed',
    'reopened'
);

-- Compliance status enumeration
CREATE TYPE compliance_status_enum AS ENUM (
    'compliant',
    'non_compliant',
    'pending_review',
    'at_risk',
    'not_applicable'
);

-- Policy type enumeration
CREATE TYPE policy_type_enum AS ENUM (
    'access_control',
    'data_protection',
    'network_security',
    'incident_response',
    'compliance',
    'audit',
    'custom'
);

-- Threat intelligence source enumeration
CREATE TYPE threat_source_enum AS ENUM (
    'opencti',
    'wazuh',
    'openappsec',
    'custom_feed',
    'manual_entry'
);

-- =====================================================
-- SECURITY POLICY MANAGEMENT
-- =====================================================

-- Security policies registry
CREATE TABLE security_policies (
    policy_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    policy_name VARCHAR(255) NOT NULL,
    policy_type policy_type_enum NOT NULL,
    description TEXT,
    version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
    is_active BOOLEAN DEFAULT true,
    rules JSONB NOT NULL, -- OPA Rego policies or similar
    scope JSONB, -- e.g., specific devices, tenants, locations
    tenant_id VARCHAR(255) NOT NULL,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Policy versions and history
CREATE TABLE security_policy_versions (
    version_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    policy_id UUID NOT NULL REFERENCES security_policies(policy_id),
    version VARCHAR(50) NOT NULL,
    rules JSONB NOT NULL,
    changes_description TEXT,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Policy application and enforcement logs
CREATE TABLE policy_enforcement_logs (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    policy_id UUID NOT NULL REFERENCES security_policies(policy_id),
    policy_version VARCHAR(50),
    target_entity_id VARCHAR(255) NOT NULL,
    target_entity_type VARCHAR(100) NOT NULL,
    is_compliant BOOLEAN NOT NULL,
    enforcement_details JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    tenant_id VARCHAR(255) NOT NULL
);

-- =====================================================
-- INCIDENT RESPONSE AND MANAGEMENT
-- =====================================================

-- Security incidents registry
CREATE TABLE security_incidents (
    incident_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_title VARCHAR(255) NOT NULL,
    status incident_status_enum NOT NULL DEFAULT 'new',
    severity security_event_severity_enum NOT NULL,
    description TEXT,
    assigned_to VARCHAR(255),
    incident_commander VARCHAR(255),
    detection_method VARCHAR(100),
    source_ip INET,
    affected_systems TEXT[],
    impact_assessment JSONB,
    tenant_id VARCHAR(255) NOT NULL,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE
);

-- Security events related to incidents
CREATE TABLE incident_events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id UUID NOT NULL REFERENCES security_incidents(incident_id),
    event_type VARCHAR(100) NOT NULL,
    severity security_event_severity_enum NOT NULL,
    source threat_source_enum NOT NULL,
    source_event_id VARCHAR(255),
    event_details JSONB NOT NULL,
    correlation_key VARCHAR(255),
    is_false_positive BOOLEAN DEFAULT false,
    tenant_id VARCHAR(255) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Incident response playbooks
CREATE TABLE incident_response_playbooks (
    playbook_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    playbook_name VARCHAR(255) NOT NULL,
    incident_type VARCHAR(100) NOT NULL,
    severity_level security_event_severity_enum,
    steps JSONB NOT NULL, -- e.g., containment, eradication, recovery steps
    is_active BOOLEAN DEFAULT true,
    version VARCHAR(50) DEFAULT '1.0.0',
    tenant_id VARCHAR(255) NOT NULL,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Incident response tasks
CREATE TABLE incident_response_tasks (
    task_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id UUID NOT NULL REFERENCES security_incidents(incident_id),
    playbook_id UUID REFERENCES incident_response_playbooks(playbook_id),
    task_name VARCHAR(255) NOT NULL,
    description TEXT,
    assigned_to VARCHAR(255),
    status VARCHAR(50) DEFAULT 'pending',
    due_date TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- COMPLIANCE MANAGEMENT
-- =====================================================

-- Compliance frameworks and regulations
CREATE TABLE compliance_frameworks (
    framework_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    framework_name VARCHAR(255) NOT NULL, -- e.g., GDPR, PCI-DSS, ISO 27001
    jurisdiction VARCHAR(100), -- e.g., EU, USA, South Africa, Nigeria
    description TEXT,
    version VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Compliance controls and requirements
CREATE TABLE compliance_controls (
    control_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    framework_id UUID NOT NULL REFERENCES compliance_frameworks(framework_id),
    control_reference VARCHAR(100) NOT NULL,
    control_name VARCHAR(255) NOT NULL,
    description TEXT,
    control_family VARCHAR(100),
    implementation_guidance TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Compliance assessment results
CREATE TABLE compliance_assessments (
    assessment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    control_id UUID NOT NULL REFERENCES compliance_controls(control_id),
    target_entity_id VARCHAR(255) NOT NULL,
    target_entity_type VARCHAR(100) NOT NULL,
    status compliance_status_enum NOT NULL,
    assessment_details JSONB,
    evidence_links TEXT[],
    assessed_by VARCHAR(255),
    assessment_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    remediation_plan TEXT,
    remediation_due_date TIMESTAMP WITH TIME ZONE,
    tenant_id VARCHAR(255) NOT NULL
);

-- =====================================================
-- DATA PROTECTION AND PRIVACY
-- =====================================================

-- Data classification policies
CREATE TABLE data_classification_policies (
    policy_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    policy_name VARCHAR(255) NOT NULL,
    classification_levels JSONB NOT NULL, -- e.g., public, internal, confidential, restricted
    default_classification VARCHAR(100) DEFAULT 'internal',
    is_active BOOLEAN DEFAULT true,
    tenant_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Classified data inventory
CREATE TABLE data_inventory (
    data_asset_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_name VARCHAR(255) NOT NULL,
    asset_description TEXT,
    data_owner VARCHAR(255),
    data_custodian VARCHAR(255),
    classification_level VARCHAR(100) NOT NULL,
    data_location VARCHAR(500),
    retention_period_days INTEGER,
    is_pii BOOLEAN DEFAULT false,
    pii_type VARCHAR(100),
    encryption_status VARCHAR(50) DEFAULT 'encrypted_at_rest',
    tenant_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Data access requests
CREATE TABLE data_access_requests (
    request_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    data_asset_id UUID NOT NULL REFERENCES data_inventory(data_asset_id),
    requester_id VARCHAR(255) NOT NULL,
    requester_role VARCHAR(100),
    access_purpose TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected
    approved_by VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    access_duration_hours INTEGER,
    access_expires_at TIMESTAMP WITH TIME ZONE,
    tenant_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- THREAT INTELLIGENCE
-- =====================================================

-- Threat intelligence indicators
CREATE TABLE threat_indicators (
    indicator_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    indicator_type VARCHAR(100) NOT NULL, -- e.g., ip_address, domain, file_hash, url
    indicator_value VARCHAR(500) NOT NULL,
    source threat_source_enum NOT NULL,
    source_reference VARCHAR(255),
    confidence_score DECIMAL(3,2),
    severity security_event_severity_enum,
    description TEXT,
    first_seen TIMESTAMP WITH TIME ZONE,
    last_seen TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    tags TEXT[],
    tenant_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Threat actors and campaigns
CREATE TABLE threat_actors (
    actor_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_name VARCHAR(255) NOT NULL,
    aliases TEXT[],
    description TEXT,
    motivation VARCHAR(255),
    sophistication_level VARCHAR(100),
    associated_campaigns TEXT[],
    known_tools TEXT[],
    target_industries TEXT[],
    target_regions TEXT[],
    source threat_source_enum,
    tenant_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- AUDIT AND LOGGING
-- =====================================================

-- Comprehensive audit trail
CREATE TABLE security_audit_trail (
    audit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(100) NOT NULL, -- 'policy', 'incident', 'user', 'system'
    entity_id VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    actor VARCHAR(255) NOT NULL,
    actor_type VARCHAR(50) NOT NULL, -- 'user', 'system', 'api'
    changes JSONB,
    previous_values JSONB,
    new_values JSONB,
    request_id VARCHAR(255),
    session_id VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    tenant_id VARCHAR(255) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Security policies indexes
CREATE INDEX idx_security_policies_tenant_type ON security_policies(tenant_id, policy_type);
CREATE INDEX idx_security_policies_is_active ON security_policies(is_active);

-- Security incidents indexes
CREATE INDEX idx_security_incidents_tenant_status ON security_incidents(tenant_id, status);
CREATE INDEX idx_security_incidents_severity ON security_incidents(severity);

-- Compliance assessments indexes
CREATE INDEX idx_compliance_assessments_control_entity ON compliance_assessments(control_id, target_entity_id);
CREATE INDEX idx_compliance_assessments_tenant_status ON compliance_assessments(tenant_id, status);

-- Threat indicators indexes
CREATE INDEX idx_threat_indicators_value ON threat_indicators(indicator_value);
CREATE INDEX idx_threat_indicators_type_value ON threat_indicators(indicator_type, indicator_value);
CREATE INDEX idx_threat_indicators_tenant_source ON threat_indicators(tenant_id, source);

-- Audit trail indexes
CREATE INDEX idx_security_audit_trail_entity ON security_audit_trail(entity_type, entity_id);
CREATE INDEX idx_security_audit_trail_tenant_timestamp ON security_audit_trail(tenant_id, timestamp DESC);
CREATE INDEX idx_security_audit_trail_actor ON security_audit_trail(actor, timestamp DESC);

-- =====================================================
-- TRIGGERS AND FUNCTIONS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_security_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_security_policies_updated_at BEFORE UPDATE ON security_policies
    FOR EACH ROW EXECUTE FUNCTION update_security_updated_at_column();

CREATE TRIGGER update_incident_response_playbooks_updated_at BEFORE UPDATE ON incident_response_playbooks
    FOR EACH ROW EXECUTE FUNCTION update_security_updated_at_column();

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================

-- Active incidents summary
CREATE VIEW active_incidents_summary AS
SELECT 
    tenant_id,
    severity,
    COUNT(*) as total_incidents,
    COUNT(CASE WHEN status = 'new' THEN 1 END) as new_incidents,
    COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_incidents,
    AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - detected_at))) as avg_age_seconds
FROM security_incidents
WHERE status IN ('new', 'open', 'in_progress')
GROUP BY tenant_id, severity;

-- Compliance posture overview
CREATE VIEW compliance_posture_overview AS
SELECT 
    ca.tenant_id,
    cf.framework_name,
    cc.control_family,
    COUNT(*) as total_controls,
    COUNT(CASE WHEN ca.status = 'compliant' THEN 1 END) as compliant_controls,
    COUNT(CASE WHEN ca.status = 'non_compliant' THEN 1 END) as non_compliant_controls,
    COUNT(CASE WHEN ca.status = 'at_risk' THEN 1 END) as at_risk_controls,
    ROUND((COUNT(CASE WHEN ca.status = 'compliant' THEN 1 END)::DECIMAL / COUNT(*)) * 100, 2) as compliance_percentage
FROM compliance_assessments ca
JOIN compliance_controls cc ON ca.control_id = cc.control_id
JOIN compliance_frameworks cf ON cc.framework_id = cf.framework_id
GROUP BY ca.tenant_id, cf.framework_name, cc.control_family;

-- =====================================================
-- COMMENTS AND DOCUMENTATION
-- =====================================================

COMMENT ON TABLE security_policies IS 'Registry of all security policies, including OPA Rego policies';
COMMENT ON TABLE security_incidents IS 'Central repository for all security incidents';
COMMENT ON TABLE compliance_frameworks IS 'Definitions of compliance frameworks and regulations';
COMMENT ON TABLE data_inventory IS 'Inventory of classified data assets';
COMMENT ON TABLE threat_indicators IS 'Collection of threat intelligence indicators from various sources';
COMMENT ON TABLE security_audit_trail IS 'Comprehensive audit trail for all security-related activities';

COMMENT ON COLUMN security_policies.rules IS 'JSONB field to store policy rules, e.g., OPA Rego code';
COMMENT ON COLUMN incident_events.source_event_id IS 'Original event ID from the source system (e.g., Wazuh alert ID)';
COMMENT ON COLUMN compliance_assessments.evidence_links IS 'Array of links to evidence documents or artifacts';
COMMENT ON COLUMN threat_indicators.indicator_value IS 'The actual value of the threat indicator (e.g., IP address, hash)';

-- Grant permissions (adjust as needed for your security model)
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO security_service;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO security_service;

