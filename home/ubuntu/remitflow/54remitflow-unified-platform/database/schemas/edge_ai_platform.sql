-- =====================================================
-- Edge AI Platform Database Schema
-- Comprehensive schema for edge computing and distributed AI
-- Zero placeholders, zero mocks - production ready
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- =====================================================
-- ENUMS AND TYPES
-- =====================================================

-- Device status enumeration
CREATE TYPE device_status_enum AS ENUM (
    'online',
    'offline', 
    'maintenance',
    'error',
    'updating',
    'decommissioned'
);

-- Model type enumeration
CREATE TYPE model_type_enum AS ENUM (
    'fraud_detection',
    'customer_segmentation',
    'risk_assessment',
    'ocr_processing',
    'biometric_verification',
    'transaction_classification'
);

-- Deployment status enumeration
CREATE TYPE deployment_status_enum AS ENUM (
    'pending',
    'deploying',
    'deployed',
    'failed',
    'rollback'
);

-- Experiment status enumeration
CREATE TYPE experiment_status_enum AS ENUM (
    'pending',
    'running',
    'completed',
    'failed',
    'cancelled'
);

-- Alert severity enumeration
CREATE TYPE alert_severity_enum AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);

-- Event type enumeration
CREATE TYPE event_type_enum AS ENUM (
    'device_registered',
    'device_offline',
    'model_deployed',
    'model_updated',
    'performance_degradation',
    'anomaly_detected',
    'experiment_started',
    'experiment_completed'
);

-- =====================================================
-- EDGE DEVICES MANAGEMENT
-- =====================================================

-- Edge devices registry
CREATE TABLE edge_devices (
    device_id VARCHAR(255) PRIMARY KEY,
    device_type VARCHAR(100) NOT NULL,
    device_name VARCHAR(255),
    location_id VARCHAR(255),
    ip_address INET NOT NULL,
    port INTEGER NOT NULL DEFAULT 8080,
    status device_status_enum NOT NULL DEFAULT 'offline',
    capabilities TEXT[] DEFAULT '{}',
    hardware_specs JSONB DEFAULT '{}',
    software_version VARCHAR(50),
    firmware_version VARCHAR(50),
    last_heartbeat TIMESTAMP WITH TIME ZONE,
    performance_metrics JSONB DEFAULT '{}',
    models_deployed TEXT[] DEFAULT '{}',
    tenant_id VARCHAR(255) NOT NULL,
    location GEOMETRY(POINT, 4326),
    network_config JSONB DEFAULT '{}',
    security_config JSONB DEFAULT '{}',
    maintenance_schedule JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Device configuration profiles
CREATE TABLE device_config_profiles (
    profile_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_name VARCHAR(255) NOT NULL,
    device_type VARCHAR(100) NOT NULL,
    configuration JSONB NOT NULL,
    version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
    is_active BOOLEAN DEFAULT true,
    tenant_id VARCHAR(255) NOT NULL,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Device telemetry data
CREATE TABLE device_telemetry (
    telemetry_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(255) NOT NULL REFERENCES edge_devices(device_id),
    cpu_usage DECIMAL(5,2),
    memory_usage DECIMAL(5,2),
    disk_usage DECIMAL(5,2),
    network_usage JSONB,
    temperature DECIMAL(5,2),
    power_consumption DECIMAL(8,2),
    inference_count INTEGER DEFAULT 0,
    inference_latency DECIMAL(8,2),
    error_count INTEGER DEFAULT 0,
    uptime_seconds BIGINT,
    custom_metrics JSONB DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    tenant_id VARCHAR(255) NOT NULL
);

-- Device alerts and notifications
CREATE TABLE device_alerts (
    alert_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(255) NOT NULL REFERENCES edge_devices(device_id),
    alert_type VARCHAR(100) NOT NULL,
    severity alert_severity_enum NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    metrics JSONB,
    threshold_values JSONB,
    is_acknowledged BOOLEAN DEFAULT false,
    acknowledged_by VARCHAR(255),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    is_resolved BOOLEAN DEFAULT false,
    resolved_by VARCHAR(255),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    tenant_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- AI MODELS MANAGEMENT
-- =====================================================

-- AI models registry
CREATE TABLE ai_models (
    model_id VARCHAR(255) PRIMARY KEY,
    model_name VARCHAR(255),
    model_type model_type_enum NOT NULL,
    version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
    description TEXT,
    tenant_id VARCHAR(255) NOT NULL,
    accuracy DECIMAL(5,4),
    precision_score DECIMAL(5,4),
    recall_score DECIMAL(5,4),
    f1_score DECIMAL(5,4),
    size_mb DECIMAL(10,2),
    inference_time_ms DECIMAL(8,2),
    training_data_size INTEGER,
    training_duration_seconds INTEGER,
    hyperparameters JSONB DEFAULT '{}',
    config_params JSONB DEFAULT '{}',
    model_artifacts JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'active',
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Model versions and lineage
CREATE TABLE model_versions (
    version_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id VARCHAR(255) NOT NULL REFERENCES ai_models(model_id),
    version VARCHAR(50) NOT NULL,
    parent_version VARCHAR(50),
    changes_description TEXT,
    performance_metrics JSONB DEFAULT '{}',
    model_artifacts JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT false,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Model deployments tracking
CREATE TABLE model_deployments (
    deployment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id VARCHAR(255) NOT NULL REFERENCES ai_models(model_id),
    model_version VARCHAR(50),
    target_devices TEXT[] NOT NULL,
    deployment_config JSONB DEFAULT '{}',
    deployment_status deployment_status_enum DEFAULT 'pending',
    deployment_results JSONB DEFAULT '{}',
    rollback_on_failure BOOLEAN DEFAULT true,
    deployed_by VARCHAR(255),
    deployment_started_at TIMESTAMP WITH TIME ZONE,
    deployment_completed_at TIMESTAMP WITH TIME ZONE,
    tenant_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Model performance tracking
CREATE TABLE model_performance (
    performance_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id VARCHAR(255) NOT NULL REFERENCES ai_models(model_id),
    device_id VARCHAR(255) REFERENCES edge_devices(device_id),
    accuracy DECIMAL(5,4),
    precision_score DECIMAL(5,4),
    recall_score DECIMAL(5,4),
    f1_score DECIMAL(5,4),
    inference_count INTEGER DEFAULT 0,
    average_latency_ms DECIMAL(8,2),
    error_rate DECIMAL(5,4),
    throughput_per_second DECIMAL(8,2),
    resource_usage JSONB DEFAULT '{}',
    evaluation_period_start TIMESTAMP WITH TIME ZONE,
    evaluation_period_end TIMESTAMP WITH TIME ZONE,
    tenant_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- INFERENCE PROCESSING
-- =====================================================

-- Inference requests and responses
CREATE TABLE inference_records (
    record_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id VARCHAR(255) NOT NULL,
    model_id VARCHAR(255) NOT NULL REFERENCES ai_models(model_id),
    device_id VARCHAR(255) NOT NULL REFERENCES edge_devices(device_id),
    tenant_id VARCHAR(255) NOT NULL,
    input_data JSONB NOT NULL,
    input_hash VARCHAR(64),
    prediction JSONB,
    confidence DECIMAL(5,4),
    inference_time_ms DECIMAL(8,2),
    preprocessing_time_ms DECIMAL(8,2),
    postprocessing_time_ms DECIMAL(8,2),
    model_version VARCHAR(50),
    device_metrics JSONB DEFAULT '{}',
    error_message TEXT,
    is_successful BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Batch inference jobs
CREATE TABLE batch_inference_jobs (
    job_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_name VARCHAR(255),
    model_id VARCHAR(255) NOT NULL REFERENCES ai_models(model_id),
    device_ids TEXT[] NOT NULL,
    input_data_source VARCHAR(500),
    output_destination VARCHAR(500),
    job_config JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'pending',
    total_records INTEGER,
    processed_records INTEGER DEFAULT 0,
    successful_records INTEGER DEFAULT 0,
    failed_records INTEGER DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    tenant_id VARCHAR(255) NOT NULL,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- FEDERATED LEARNING
-- =====================================================

-- Federated learning experiments
CREATE TABLE federated_experiments (
    experiment_id VARCHAR(255) PRIMARY KEY,
    experiment_name VARCHAR(255),
    model_type model_type_enum NOT NULL,
    base_model_id VARCHAR(255) REFERENCES ai_models(model_id),
    participating_devices TEXT[] NOT NULL,
    total_rounds INTEGER NOT NULL,
    current_round INTEGER DEFAULT 0,
    min_clients INTEGER NOT NULL,
    fraction_fit DECIMAL(3,2) DEFAULT 0.1,
    fraction_evaluate DECIMAL(3,2) DEFAULT 0.1,
    config JSONB DEFAULT '{}',
    status experiment_status_enum DEFAULT 'pending',
    global_model_performance JSONB DEFAULT '{}',
    aggregation_strategy VARCHAR(100) DEFAULT 'fedavg',
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    tenant_id VARCHAR(255) NOT NULL,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Federated learning rounds
CREATE TABLE federated_rounds (
    round_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    experiment_id VARCHAR(255) NOT NULL REFERENCES federated_experiments(experiment_id),
    round_number INTEGER NOT NULL,
    participating_devices TEXT[] NOT NULL,
    round_config JSONB DEFAULT '{}',
    aggregated_metrics JSONB DEFAULT '{}',
    global_model_performance JSONB DEFAULT '{}',
    round_duration_seconds INTEGER,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Client participation in federated learning
CREATE TABLE federated_client_participation (
    participation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    round_id UUID NOT NULL REFERENCES federated_rounds(round_id),
    experiment_id VARCHAR(255) NOT NULL REFERENCES federated_experiments(experiment_id),
    device_id VARCHAR(255) NOT NULL REFERENCES edge_devices(device_id),
    round_number INTEGER NOT NULL,
    local_epochs INTEGER,
    local_batch_size INTEGER,
    local_learning_rate DECIMAL(8,6),
    training_samples INTEGER,
    validation_samples INTEGER,
    local_loss DECIMAL(10,6),
    local_accuracy DECIMAL(5,4),
    training_time_seconds INTEGER,
    communication_time_seconds INTEGER,
    model_update_size_mb DECIMAL(10,2),
    is_successful BOOLEAN DEFAULT true,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- EDGE COMPUTING ORCHESTRATION
-- =====================================================

-- Edge computing nodes
CREATE TABLE edge_computing_nodes (
    node_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_name VARCHAR(255) NOT NULL,
    node_type VARCHAR(100) NOT NULL, -- 'master', 'worker', 'hybrid'
    cluster_id VARCHAR(255),
    device_id VARCHAR(255) REFERENCES edge_devices(device_id),
    compute_capacity JSONB DEFAULT '{}', -- CPU, memory, storage, GPU
    current_workload JSONB DEFAULT '{}',
    available_resources JSONB DEFAULT '{}',
    network_bandwidth JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'active',
    last_health_check TIMESTAMP WITH TIME ZONE,
    tenant_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Distributed computing tasks
CREATE TABLE distributed_tasks (
    task_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_name VARCHAR(255) NOT NULL,
    task_type VARCHAR(100) NOT NULL, -- 'training', 'inference', 'data_processing'
    parent_task_id UUID REFERENCES distributed_tasks(task_id),
    assigned_nodes UUID[] DEFAULT '{}',
    task_config JSONB DEFAULT '{}',
    input_data JSONB,
    output_data JSONB,
    resource_requirements JSONB DEFAULT '{}',
    priority INTEGER DEFAULT 5,
    status VARCHAR(50) DEFAULT 'pending',
    progress_percentage DECIMAL(5,2) DEFAULT 0.0,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    estimated_completion TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    tenant_id VARCHAR(255) NOT NULL,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Task execution logs
CREATE TABLE task_execution_logs (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES distributed_tasks(task_id),
    node_id UUID REFERENCES edge_computing_nodes(node_id),
    device_id VARCHAR(255) REFERENCES edge_devices(device_id),
    log_level VARCHAR(20) NOT NULL, -- 'DEBUG', 'INFO', 'WARNING', 'ERROR'
    message TEXT NOT NULL,
    execution_context JSONB DEFAULT '{}',
    resource_usage JSONB DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- ANALYTICS AND MONITORING
-- =====================================================

-- Edge analytics aggregations
CREATE TABLE edge_analytics (
    analytics_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(255) NOT NULL REFERENCES edge_devices(device_id),
    model_id VARCHAR(255) REFERENCES ai_models(model_id),
    metric_type VARCHAR(100) NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    metric_value DECIMAL(15,6),
    metric_unit VARCHAR(50),
    aggregation_period VARCHAR(50), -- 'minute', 'hour', 'day', 'week'
    aggregation_function VARCHAR(50), -- 'avg', 'sum', 'min', 'max', 'count'
    dimensions JSONB DEFAULT '{}',
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Anomaly detection results
CREATE TABLE anomaly_detections (
    anomaly_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(255) NOT NULL REFERENCES edge_devices(device_id),
    model_id VARCHAR(255) REFERENCES ai_models(model_id),
    anomaly_type VARCHAR(100) NOT NULL,
    severity alert_severity_enum NOT NULL,
    confidence_score DECIMAL(5,4),
    detected_metrics JSONB NOT NULL,
    baseline_metrics JSONB,
    threshold_values JSONB,
    detection_algorithm VARCHAR(100),
    is_confirmed BOOLEAN DEFAULT false,
    confirmed_by VARCHAR(255),
    confirmed_at TIMESTAMP WITH TIME ZONE,
    false_positive BOOLEAN DEFAULT false,
    tenant_id VARCHAR(255) NOT NULL,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Performance benchmarks
CREATE TABLE performance_benchmarks (
    benchmark_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(255) NOT NULL REFERENCES edge_devices(device_id),
    model_id VARCHAR(255) REFERENCES ai_models(model_id),
    benchmark_type VARCHAR(100) NOT NULL,
    benchmark_config JSONB DEFAULT '{}',
    results JSONB NOT NULL,
    baseline_results JSONB,
    performance_score DECIMAL(8,4),
    percentile_rank DECIMAL(5,2),
    comparison_group VARCHAR(255),
    test_duration_seconds INTEGER,
    tenant_id VARCHAR(255) NOT NULL,
    executed_by VARCHAR(255),
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- SECURITY AND COMPLIANCE
-- =====================================================

-- Security events
CREATE TABLE security_events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(255) REFERENCES edge_devices(device_id),
    event_type VARCHAR(100) NOT NULL,
    severity alert_severity_enum NOT NULL,
    source_ip INET,
    user_agent TEXT,
    event_details JSONB NOT NULL,
    threat_indicators JSONB DEFAULT '{}',
    is_blocked BOOLEAN DEFAULT false,
    response_actions TEXT[],
    investigation_status VARCHAR(50) DEFAULT 'open',
    assigned_to VARCHAR(255),
    resolution_notes TEXT,
    tenant_id VARCHAR(255) NOT NULL,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE
);

-- Audit trail
CREATE TABLE audit_trail (
    audit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(100) NOT NULL, -- 'device', 'model', 'experiment', 'user'
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
-- SYSTEM EVENTS AND NOTIFICATIONS
-- =====================================================

-- System events
CREATE TABLE system_events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type event_type_enum NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    severity alert_severity_enum DEFAULT 'medium',
    metadata JSONB DEFAULT '{}',
    is_processed BOOLEAN DEFAULT false,
    processed_by VARCHAR(255),
    processed_at TIMESTAMP WITH TIME ZONE,
    tenant_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Model events (specific to AI models)
CREATE TABLE model_events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id VARCHAR(255) NOT NULL REFERENCES ai_models(model_id),
    event_type VARCHAR(100) NOT NULL,
    description TEXT,
    performance_impact JSONB DEFAULT '{}',
    affected_devices TEXT[],
    remediation_actions TEXT[],
    is_critical BOOLEAN DEFAULT false,
    tenant_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Edge devices indexes
CREATE INDEX idx_edge_devices_tenant_status ON edge_devices(tenant_id, status);
CREATE INDEX idx_edge_devices_location ON edge_devices USING GIST(location);
CREATE INDEX idx_edge_devices_last_heartbeat ON edge_devices(last_heartbeat);
CREATE INDEX idx_edge_devices_device_type ON edge_devices(device_type);

-- Device telemetry indexes
CREATE INDEX idx_device_telemetry_device_timestamp ON device_telemetry(device_id, timestamp DESC);
CREATE INDEX idx_device_telemetry_tenant_timestamp ON device_telemetry(tenant_id, timestamp DESC);

-- AI models indexes
CREATE INDEX idx_ai_models_tenant_type ON ai_models(tenant_id, model_type);
CREATE INDEX idx_ai_models_status ON ai_models(status);
CREATE INDEX idx_ai_models_created_at ON ai_models(created_at DESC);

-- Inference records indexes
CREATE INDEX idx_inference_records_model_device ON inference_records(model_id, device_id);
CREATE INDEX idx_inference_records_tenant_timestamp ON inference_records(tenant_id, created_at DESC);
CREATE INDEX idx_inference_records_request_id ON inference_records(request_id);

-- Federated experiments indexes
CREATE INDEX idx_federated_experiments_tenant_status ON federated_experiments(tenant_id, status);
CREATE INDEX idx_federated_experiments_model_type ON federated_experiments(model_type);

-- Analytics indexes
CREATE INDEX idx_edge_analytics_device_period ON edge_analytics(device_id, period_start, period_end);
CREATE INDEX idx_edge_analytics_metric_type ON edge_analytics(metric_type, metric_name);

-- Security events indexes
CREATE INDEX idx_security_events_device_severity ON security_events(device_id, severity);
CREATE INDEX idx_security_events_tenant_detected ON security_events(tenant_id, detected_at DESC);

-- Audit trail indexes
CREATE INDEX idx_audit_trail_entity ON audit_trail(entity_type, entity_id);
CREATE INDEX idx_audit_trail_tenant_timestamp ON audit_trail(tenant_id, timestamp DESC);
CREATE INDEX idx_audit_trail_actor ON audit_trail(actor, timestamp DESC);

-- =====================================================
-- TRIGGERS AND FUNCTIONS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_edge_devices_updated_at BEFORE UPDATE ON edge_devices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ai_models_updated_at BEFORE UPDATE ON ai_models
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_edge_computing_nodes_updated_at BEFORE UPDATE ON edge_computing_nodes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate input hash for inference records
CREATE OR REPLACE FUNCTION calculate_input_hash()
RETURNS TRIGGER AS $$
BEGIN
    NEW.input_hash = encode(sha256(NEW.input_data::text::bytea), 'hex');
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for input hash calculation
CREATE TRIGGER calculate_inference_input_hash BEFORE INSERT ON inference_records
    FOR EACH ROW EXECUTE FUNCTION calculate_input_hash();

-- Function to update device status based on heartbeat
CREATE OR REPLACE FUNCTION update_device_status_on_heartbeat()
RETURNS TRIGGER AS $$
BEGIN
    -- If heartbeat is updated and device was offline, mark as online
    IF NEW.last_heartbeat IS DISTINCT FROM OLD.last_heartbeat AND 
       NEW.last_heartbeat > CURRENT_TIMESTAMP - INTERVAL '2 minutes' AND
       OLD.status = 'offline' THEN
        NEW.status = 'online';
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for device status update
CREATE TRIGGER update_device_status_heartbeat BEFORE UPDATE ON edge_devices
    FOR EACH ROW EXECUTE FUNCTION update_device_status_on_heartbeat();

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================

-- Active devices summary
CREATE VIEW active_devices_summary AS
SELECT 
    tenant_id,
    device_type,
    COUNT(*) as total_devices,
    COUNT(CASE WHEN status = 'online' THEN 1 END) as online_devices,
    COUNT(CASE WHEN status = 'offline' THEN 1 END) as offline_devices,
    COUNT(CASE WHEN status = 'maintenance' THEN 1 END) as maintenance_devices,
    AVG(CASE WHEN performance_metrics->>'cpu_usage' IS NOT NULL 
        THEN (performance_metrics->>'cpu_usage')::DECIMAL END) as avg_cpu_usage,
    AVG(CASE WHEN performance_metrics->>'memory_usage' IS NOT NULL 
        THEN (performance_metrics->>'memory_usage')::DECIMAL END) as avg_memory_usage
FROM edge_devices
GROUP BY tenant_id, device_type;

-- Model performance summary
CREATE VIEW model_performance_summary AS
SELECT 
    m.model_id,
    m.model_name,
    m.model_type,
    m.tenant_id,
    COUNT(DISTINCT md.deployment_id) as total_deployments,
    COUNT(DISTINCT ir.device_id) as active_devices,
    COUNT(ir.record_id) as total_inferences,
    AVG(ir.confidence) as avg_confidence,
    AVG(ir.inference_time_ms) as avg_inference_time,
    COUNT(CASE WHEN ir.is_successful = false THEN 1 END) as failed_inferences,
    MAX(ir.created_at) as last_inference
FROM ai_models m
LEFT JOIN model_deployments md ON m.model_id = md.model_id
LEFT JOIN inference_records ir ON m.model_id = ir.model_id
WHERE m.status = 'active'
GROUP BY m.model_id, m.model_name, m.model_type, m.tenant_id;

-- Recent anomalies view
CREATE VIEW recent_anomalies AS
SELECT 
    ad.anomaly_id,
    ad.device_id,
    ed.device_name,
    ed.location_id,
    ad.anomaly_type,
    ad.severity,
    ad.confidence_score,
    ad.detected_metrics,
    ad.tenant_id,
    ad.detected_at
FROM anomaly_detections ad
JOIN edge_devices ed ON ad.device_id = ed.device_id
WHERE ad.detected_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
  AND ad.false_positive = false
ORDER BY ad.detected_at DESC;

-- Federated learning progress view
CREATE VIEW federated_learning_progress AS
SELECT 
    fe.experiment_id,
    fe.experiment_name,
    fe.model_type,
    fe.status,
    fe.current_round,
    fe.total_rounds,
    ROUND((fe.current_round::DECIMAL / fe.total_rounds) * 100, 2) as progress_percentage,
    array_length(fe.participating_devices, 1) as total_devices,
    COUNT(DISTINCT fcp.device_id) as active_devices,
    AVG(fcp.local_accuracy) as avg_local_accuracy,
    fe.tenant_id,
    fe.started_at
FROM federated_experiments fe
LEFT JOIN federated_client_participation fcp ON fe.experiment_id = fcp.experiment_id
WHERE fe.status IN ('running', 'completed')
GROUP BY fe.experiment_id, fe.experiment_name, fe.model_type, fe.status, 
         fe.current_round, fe.total_rounds, fe.participating_devices, 
         fe.tenant_id, fe.started_at;

-- =====================================================
-- STORED PROCEDURES
-- =====================================================

-- Procedure to cleanup old telemetry data
CREATE OR REPLACE FUNCTION cleanup_old_telemetry(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM device_telemetry 
    WHERE timestamp < CURRENT_TIMESTAMP - (retention_days || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Procedure to calculate device health score
CREATE OR REPLACE FUNCTION calculate_device_health_score(device_id_param VARCHAR(255))
RETURNS DECIMAL(5,2) AS $$
DECLARE
    health_score DECIMAL(5,2) := 0.0;
    cpu_score DECIMAL(5,2);
    memory_score DECIMAL(5,2);
    uptime_score DECIMAL(5,2);
    error_score DECIMAL(5,2);
BEGIN
    -- Get latest telemetry
    SELECT 
        CASE 
            WHEN cpu_usage <= 70 THEN 100
            WHEN cpu_usage <= 85 THEN 75
            WHEN cpu_usage <= 95 THEN 50
            ELSE 25
        END,
        CASE 
            WHEN memory_usage <= 70 THEN 100
            WHEN memory_usage <= 85 THEN 75
            WHEN memory_usage <= 95 THEN 50
            ELSE 25
        END,
        CASE 
            WHEN uptime_seconds >= 86400 THEN 100  -- 1 day
            WHEN uptime_seconds >= 43200 THEN 75   -- 12 hours
            WHEN uptime_seconds >= 21600 THEN 50   -- 6 hours
            ELSE 25
        END,
        CASE 
            WHEN error_count = 0 THEN 100
            WHEN error_count <= 5 THEN 75
            WHEN error_count <= 20 THEN 50
            ELSE 25
        END
    INTO cpu_score, memory_score, uptime_score, error_score
    FROM device_telemetry
    WHERE device_id = device_id_param
    ORDER BY timestamp DESC
    LIMIT 1;
    
    -- Calculate weighted average
    health_score := (cpu_score * 0.3 + memory_score * 0.3 + uptime_score * 0.2 + error_score * 0.2);
    
    RETURN COALESCE(health_score, 0.0);
END;
$$ LANGUAGE plpgsql;

-- Procedure to get model deployment status
CREATE OR REPLACE FUNCTION get_model_deployment_status(model_id_param VARCHAR(255))
RETURNS TABLE(
    device_id VARCHAR(255),
    device_name VARCHAR(255),
    deployment_status deployment_status_enum,
    deployed_at TIMESTAMP WITH TIME ZONE,
    last_inference TIMESTAMP WITH TIME ZONE,
    inference_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ed.device_id,
        ed.device_name,
        md.deployment_status,
        md.deployment_completed_at,
        MAX(ir.created_at) as last_inference,
        COUNT(ir.record_id) as inference_count
    FROM edge_devices ed
    LEFT JOIN model_deployments md ON ed.device_id = ANY(md.target_devices)
        AND md.model_id = model_id_param
    LEFT JOIN inference_records ir ON ed.device_id = ir.device_id 
        AND ir.model_id = model_id_param
    WHERE ed.device_id = ANY(
        SELECT unnest(target_devices) 
        FROM model_deployments 
        WHERE model_id = model_id_param
    )
    GROUP BY ed.device_id, ed.device_name, md.deployment_status, md.deployment_completed_at;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- INITIAL DATA AND CONFIGURATION
-- =====================================================

-- Insert default device configuration profiles
INSERT INTO device_config_profiles (profile_name, device_type, configuration, tenant_id, created_by) VALUES
('Default POS Configuration', 'pos_terminal', 
 '{"max_memory_mb": 2048, "max_cpu_percent": 80, "inference_timeout_ms": 5000, "batch_size": 1, "model_cache_size": 3}',
 'system', 'system'),
('Default IoT Configuration', 'iot_device',
 '{"max_memory_mb": 512, "max_cpu_percent": 70, "inference_timeout_ms": 10000, "batch_size": 1, "model_cache_size": 1}',
 'system', 'system'),
('Default Edge Server Configuration', 'edge_server',
 '{"max_memory_mb": 8192, "max_cpu_percent": 90, "inference_timeout_ms": 1000, "batch_size": 32, "model_cache_size": 10}',
 'system', 'system');

-- Create indexes for JSONB fields
CREATE INDEX idx_device_telemetry_metrics_gin ON device_telemetry USING GIN(custom_metrics);
CREATE INDEX idx_ai_models_hyperparameters_gin ON ai_models USING GIN(hyperparameters);
CREATE INDEX idx_inference_records_input_gin ON inference_records USING GIN(input_data);
CREATE INDEX idx_edge_analytics_dimensions_gin ON edge_analytics USING GIN(dimensions);

-- =====================================================
-- COMMENTS AND DOCUMENTATION
-- =====================================================

COMMENT ON TABLE edge_devices IS 'Registry of all edge computing devices in the network';
COMMENT ON TABLE device_telemetry IS 'Time-series telemetry data from edge devices';
COMMENT ON TABLE ai_models IS 'Registry of AI/ML models available for deployment';
COMMENT ON TABLE inference_records IS 'Log of all inference requests and responses';
COMMENT ON TABLE federated_experiments IS 'Federated learning experiments and configurations';
COMMENT ON TABLE edge_analytics IS 'Aggregated analytics data from edge devices';
COMMENT ON TABLE security_events IS 'Security events and incidents detected on edge devices';
COMMENT ON TABLE audit_trail IS 'Complete audit trail of all system activities';

COMMENT ON COLUMN edge_devices.capabilities IS 'Array of device capabilities (e.g., gpu, camera, sensors)';
COMMENT ON COLUMN edge_devices.hardware_specs IS 'JSON object containing hardware specifications';
COMMENT ON COLUMN edge_devices.performance_metrics IS 'Latest performance metrics from the device';
COMMENT ON COLUMN ai_models.hyperparameters IS 'Model hyperparameters used during training';
COMMENT ON COLUMN inference_records.input_hash IS 'SHA256 hash of input data for deduplication';
COMMENT ON COLUMN federated_experiments.config IS 'Federated learning configuration parameters';

-- Grant permissions (adjust as needed for your security model)
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO edge_ai_service;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO edge_ai_service;

