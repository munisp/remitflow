-- =====================================================
-- POS INTEGRATION AND HARDWARE MANAGEMENT DATABASE SCHEMA
-- Comprehensive schema for POS devices, hardware management,
-- edge computing, and IoT connectivity
-- Zero placeholders, zero mocks - production ready
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- =====================================================
-- POS DEVICE MANAGEMENT TABLES
-- =====================================================

-- Device types enumeration
CREATE TYPE device_type_enum AS ENUM (
    'pos_terminal',
    'mobile_pos',
    'tablet_pos',
    'smart_pos',
    'card_reader',
    'biometric_scanner',
    'receipt_printer',
    'cash_drawer',
    'barcode_scanner',
    'iot_sensor',
    'edge_gateway',
    'security_camera'
);

-- Device status enumeration
CREATE TYPE device_status_enum AS ENUM (
    'active',
    'inactive',
    'maintenance',
    'faulty',
    'offline',
    'updating',
    'provisioning',
    'decommissioned',
    'stolen',
    'quarantined'
);

-- Connectivity types enumeration
CREATE TYPE connectivity_type_enum AS ENUM (
    'wifi',
    'ethernet',
    'cellular_4g',
    'cellular_5g',
    'bluetooth',
    'nfc',
    'satellite',
    'lora',
    'zigbee'
);

-- Main POS devices table
CREATE TABLE pos_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id VARCHAR(100) UNIQUE NOT NULL,
    device_name VARCHAR(255) NOT NULL,
    device_type device_type_enum NOT NULL,
    device_status device_status_enum NOT NULL DEFAULT 'provisioning',
    
    -- Device specifications
    manufacturer VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    serial_number VARCHAR(100) UNIQUE NOT NULL,
    firmware_version VARCHAR(50),
    hardware_version VARCHAR(50),
    
    -- Agent assignment
    assigned_agent_id UUID,
    assigned_location VARCHAR(255),
    installation_date DATE,
    last_maintenance_date DATE,
    next_maintenance_date DATE,
    
    -- Network configuration
    mac_address VARCHAR(17) UNIQUE,
    ip_address INET,
    connectivity_type connectivity_type_enum NOT NULL DEFAULT 'wifi',
    network_ssid VARCHAR(100),
    
    -- Geographic information
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    geolocation GEOGRAPHY(POINT, 4326),
    address TEXT,
    timezone VARCHAR(50) DEFAULT 'UTC',
    
    -- Device capabilities
    supports_contactless BOOLEAN DEFAULT false,
    supports_chip_card BOOLEAN DEFAULT false,
    supports_magnetic_stripe BOOLEAN DEFAULT false,
    supports_biometric BOOLEAN DEFAULT false,
    supports_receipt_printing BOOLEAN DEFAULT false,
    supports_cash_drawer BOOLEAN DEFAULT false,
    
    -- Security features
    encryption_enabled BOOLEAN DEFAULT true,
    tamper_detection_enabled BOOLEAN DEFAULT true,
    secure_boot_enabled BOOLEAN DEFAULT true,
    device_certificate TEXT,
    last_security_scan TIMESTAMP WITH TIME ZONE,
    
    -- Performance metrics
    uptime_percentage DECIMAL(5,2) DEFAULT 0.00,
    average_response_time_ms INTEGER DEFAULT 0,
    total_transactions_processed BIGINT DEFAULT 0,
    last_transaction_time TIMESTAMP WITH TIME ZONE,
    
    -- Battery and power (for mobile devices)
    battery_level INTEGER CHECK (battery_level >= 0 AND battery_level <= 100),
    is_charging BOOLEAN DEFAULT false,
    power_source VARCHAR(20) DEFAULT 'ac', -- 'ac', 'battery', 'solar'
    
    -- Edge computing capabilities
    edge_computing_enabled BOOLEAN DEFAULT false,
    cpu_cores INTEGER,
    ram_mb INTEGER,
    storage_gb INTEGER,
    gpu_enabled BOOLEAN DEFAULT false,
    
    -- Status tracking
    last_heartbeat TIMESTAMP WITH TIME ZONE,
    last_seen TIMESTAMP WITH TIME ZONE,
    connection_quality VARCHAR(20) DEFAULT 'unknown', -- 'excellent', 'good', 'fair', 'poor'
    
    -- Audit fields
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Constraints
    CONSTRAINT valid_battery_level CHECK (
        (device_type IN ('mobile_pos', 'tablet_pos') AND battery_level IS NOT NULL) OR
        (device_type NOT IN ('mobile_pos', 'tablet_pos'))
    )
);

-- Device configuration profiles
CREATE TABLE device_configuration_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_name VARCHAR(100) NOT NULL,
    device_type device_type_enum NOT NULL,
    
    -- Configuration settings
    configuration JSONB NOT NULL,
    
    -- Security settings
    security_policy JSONB DEFAULT '{}',
    
    -- Network settings
    network_config JSONB DEFAULT '{}',
    
    -- Application settings
    app_config JSONB DEFAULT '{}',
    
    -- Update settings
    auto_update_enabled BOOLEAN DEFAULT true,
    update_window_start TIME,
    update_window_end TIME,
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_default BOOLEAN NOT NULL DEFAULT false,
    
    -- Version control
    version INTEGER NOT NULL DEFAULT 1,
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Device software and firmware
CREATE TABLE device_software (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES pos_devices(id),
    
    -- Software details
    software_name VARCHAR(100) NOT NULL,
    software_type VARCHAR(50) NOT NULL, -- 'firmware', 'os', 'application', 'driver'
    current_version VARCHAR(50) NOT NULL,
    latest_version VARCHAR(50),
    
    -- Installation details
    installed_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    installation_method VARCHAR(50), -- 'ota', 'manual', 'factory'
    
    -- Update information
    update_available BOOLEAN DEFAULT false,
    update_priority VARCHAR(20) DEFAULT 'normal', -- 'critical', 'high', 'normal', 'low'
    update_size_mb INTEGER,
    
    -- Status
    status VARCHAR(30) NOT NULL DEFAULT 'installed', -- 'installed', 'updating', 'failed', 'pending'
    
    -- Checksums and verification
    checksum VARCHAR(128),
    signature_verified BOOLEAN DEFAULT false,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- =====================================================
-- DEVICE MONITORING AND TELEMETRY
-- =====================================================

-- Device telemetry data
CREATE TABLE device_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES pos_devices(id),
    
    -- Timestamp
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- System metrics
    cpu_usage_percent DECIMAL(5,2),
    memory_usage_percent DECIMAL(5,2),
    disk_usage_percent DECIMAL(5,2),
    network_usage_mbps DECIMAL(10,2),
    
    -- Performance metrics
    response_time_ms INTEGER,
    transaction_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    
    -- Environmental metrics
    temperature_celsius DECIMAL(5,2),
    humidity_percent DECIMAL(5,2),
    
    -- Power metrics
    battery_level INTEGER,
    power_consumption_watts DECIMAL(8,2),
    voltage DECIMAL(6,2),
    
    -- Network metrics
    signal_strength_dbm INTEGER,
    network_latency_ms INTEGER,
    data_sent_mb DECIMAL(10,2) DEFAULT 0.00,
    data_received_mb DECIMAL(10,2) DEFAULT 0.00,
    
    -- Security metrics
    failed_authentication_attempts INTEGER DEFAULT 0,
    security_events_count INTEGER DEFAULT 0,
    
    -- Custom metrics
    custom_metrics JSONB DEFAULT '{}',
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Device alerts and notifications
CREATE TABLE device_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES pos_devices(id),
    
    -- Alert details
    alert_type VARCHAR(50) NOT NULL,
    alert_severity VARCHAR(20) NOT NULL, -- 'info', 'warning', 'error', 'critical'
    alert_title VARCHAR(255) NOT NULL,
    alert_message TEXT NOT NULL,
    
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

-- Device maintenance records
CREATE TABLE device_maintenance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES pos_devices(id),
    
    -- Maintenance details
    maintenance_type VARCHAR(50) NOT NULL, -- 'preventive', 'corrective', 'emergency', 'upgrade'
    maintenance_title VARCHAR(255) NOT NULL,
    maintenance_description TEXT,
    
    -- Scheduling
    scheduled_date DATE NOT NULL,
    scheduled_time TIME,
    estimated_duration_minutes INTEGER,
    
    -- Execution
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    actual_duration_minutes INTEGER,
    
    -- Personnel
    assigned_technician_id UUID,
    performed_by UUID,
    
    -- Status
    status VARCHAR(30) NOT NULL DEFAULT 'scheduled', -- 'scheduled', 'in_progress', 'completed', 'cancelled', 'failed'
    
    -- Results
    maintenance_notes TEXT,
    parts_replaced TEXT[],
    issues_found TEXT[],
    issues_resolved TEXT[],
    
    -- Cost tracking
    labor_cost DECIMAL(10,2) DEFAULT 0.00,
    parts_cost DECIMAL(10,2) DEFAULT 0.00,
    total_cost DECIMAL(10,2) DEFAULT 0.00,
    
    -- Next maintenance
    next_maintenance_date DATE,
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- =====================================================
-- EDGE COMPUTING AND IOT CONNECTIVITY
-- =====================================================

-- Edge computing nodes
CREATE TABLE edge_computing_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id VARCHAR(100) UNIQUE NOT NULL,
    node_name VARCHAR(255) NOT NULL,
    
    -- Node specifications
    node_type VARCHAR(50) NOT NULL, -- 'gateway', 'compute', 'storage', 'hybrid'
    hardware_profile VARCHAR(100),
    
    -- Computing resources
    cpu_cores INTEGER NOT NULL,
    cpu_frequency_ghz DECIMAL(4,2),
    ram_gb INTEGER NOT NULL,
    storage_gb INTEGER NOT NULL,
    gpu_enabled BOOLEAN DEFAULT false,
    gpu_memory_gb INTEGER,
    
    -- Network capabilities
    network_interfaces JSONB DEFAULT '[]',
    bandwidth_mbps INTEGER,
    supports_5g BOOLEAN DEFAULT false,
    supports_wifi6 BOOLEAN DEFAULT false,
    
    -- Geographic information
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    geolocation GEOGRAPHY(POINT, 4326),
    coverage_radius_km DECIMAL(6,2),
    
    -- Connected devices
    max_connected_devices INTEGER DEFAULT 100,
    current_connected_devices INTEGER DEFAULT 0,
    
    -- Status and health
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    health_score DECIMAL(5,2) DEFAULT 100.00,
    last_heartbeat TIMESTAMP WITH TIME ZONE,
    
    -- Edge services
    running_services JSONB DEFAULT '[]',
    available_services JSONB DEFAULT '[]',
    
    -- Security
    security_level VARCHAR(20) DEFAULT 'standard', -- 'basic', 'standard', 'high', 'critical'
    encryption_enabled BOOLEAN DEFAULT true,
    firewall_enabled BOOLEAN DEFAULT true,
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- IoT device registry
CREATE TABLE iot_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id VARCHAR(100) UNIQUE NOT NULL,
    device_name VARCHAR(255) NOT NULL,
    device_type VARCHAR(50) NOT NULL,
    
    -- Device specifications
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    firmware_version VARCHAR(50),
    
    -- Connectivity
    edge_node_id UUID REFERENCES edge_computing_nodes(id),
    connection_protocol VARCHAR(30), -- 'mqtt', 'coap', 'http', 'websocket', 'lorawan'
    connection_status VARCHAR(20) DEFAULT 'disconnected',
    
    -- MQTT configuration
    mqtt_topic VARCHAR(255),
    mqtt_qos INTEGER DEFAULT 1,
    mqtt_retain BOOLEAN DEFAULT false,
    
    -- Data collection
    data_collection_interval_seconds INTEGER DEFAULT 60,
    last_data_received TIMESTAMP WITH TIME ZONE,
    data_format VARCHAR(20) DEFAULT 'json', -- 'json', 'xml', 'binary', 'csv'
    
    -- Geographic information
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    geolocation GEOGRAPHY(POINT, 4326),
    
    -- Status
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    battery_level INTEGER,
    signal_strength INTEGER,
    
    -- Security
    device_key VARCHAR(255),
    certificate TEXT,
    last_authentication TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- IoT data streams
CREATE TABLE iot_data_streams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES iot_devices(id),
    
    -- Data details
    stream_name VARCHAR(100) NOT NULL,
    data_type VARCHAR(50) NOT NULL, -- 'sensor', 'event', 'status', 'metric'
    
    -- Timestamp
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Data payload
    raw_data JSONB NOT NULL,
    processed_data JSONB,
    
    -- Data quality
    data_quality_score DECIMAL(5,2) DEFAULT 100.00,
    validation_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'valid', 'invalid', 'suspicious'
    
    -- Processing status
    processing_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processed', 'failed', 'skipped'
    processed_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- =====================================================
-- FLUVIO MQTT INTEGRATION
-- =====================================================

-- MQTT brokers configuration
CREATE TABLE mqtt_brokers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    broker_name VARCHAR(100) NOT NULL,
    broker_host VARCHAR(255) NOT NULL,
    broker_port INTEGER NOT NULL DEFAULT 1883,
    
    -- Security configuration
    use_tls BOOLEAN DEFAULT false,
    tls_port INTEGER DEFAULT 8883,
    username VARCHAR(100),
    password_hash VARCHAR(255),
    
    -- Connection settings
    keep_alive_seconds INTEGER DEFAULT 60,
    clean_session BOOLEAN DEFAULT true,
    max_connections INTEGER DEFAULT 1000,
    
    -- Quality of Service
    default_qos INTEGER DEFAULT 1,
    max_qos INTEGER DEFAULT 2,
    
    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    last_health_check TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- MQTT topics configuration
CREATE TABLE mqtt_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    broker_id UUID NOT NULL REFERENCES mqtt_brokers(id),
    
    -- Topic details
    topic_name VARCHAR(255) NOT NULL,
    topic_pattern VARCHAR(255), -- For wildcard subscriptions
    topic_type VARCHAR(50) NOT NULL, -- 'device_data', 'commands', 'alerts', 'status'
    
    -- Access control
    read_access BOOLEAN DEFAULT true,
    write_access BOOLEAN DEFAULT false,
    admin_access BOOLEAN DEFAULT false,
    
    -- Quality of Service
    qos INTEGER DEFAULT 1,
    retain BOOLEAN DEFAULT false,
    
    -- Message handling
    message_format VARCHAR(20) DEFAULT 'json',
    compression_enabled BOOLEAN DEFAULT false,
    encryption_enabled BOOLEAN DEFAULT false,
    
    -- Rate limiting
    max_messages_per_second INTEGER DEFAULT 100,
    max_message_size_bytes INTEGER DEFAULT 1048576, -- 1MB
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT true,
    subscriber_count INTEGER DEFAULT 0,
    publisher_count INTEGER DEFAULT 0,
    
    -- Statistics
    total_messages_received BIGINT DEFAULT 0,
    total_messages_sent BIGINT DEFAULT 0,
    last_message_timestamp TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    created_by UUID NOT NULL,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Constraints
    UNIQUE(broker_id, topic_name)
);

-- MQTT message log
CREATE TABLE mqtt_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES mqtt_topics(id),
    device_id UUID REFERENCES iot_devices(id),
    
    -- Message details
    message_id VARCHAR(100),
    message_type VARCHAR(50), -- 'data', 'command', 'response', 'alert', 'heartbeat'
    
    -- Timestamp
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Message content
    payload JSONB NOT NULL,
    payload_size_bytes INTEGER NOT NULL,
    
    -- Quality of Service
    qos INTEGER NOT NULL,
    retain BOOLEAN NOT NULL DEFAULT false,
    duplicate BOOLEAN NOT NULL DEFAULT false,
    
    -- Processing
    processing_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processed', 'failed', 'ignored'
    processed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- =====================================================
-- DEVICE SECURITY AND FRAUD DETECTION
-- =====================================================

-- Device security events
CREATE TABLE device_security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES pos_devices(id),
    
    -- Event details
    event_type VARCHAR(50) NOT NULL,
    event_severity VARCHAR(20) NOT NULL, -- 'info', 'warning', 'error', 'critical'
    event_title VARCHAR(255) NOT NULL,
    event_description TEXT NOT NULL,
    
    -- Event context
    source_ip INET,
    user_agent TEXT,
    session_id VARCHAR(255),
    
    -- Security indicators
    threat_level VARCHAR(20) DEFAULT 'low', -- 'low', 'medium', 'high', 'critical'
    confidence_score DECIMAL(5,2) DEFAULT 0.00,
    
    -- Detection method
    detection_method VARCHAR(50), -- 'rule_based', 'ml_model', 'signature', 'behavioral'
    detection_rule VARCHAR(255),
    
    -- Response actions
    action_taken VARCHAR(100),
    blocked BOOLEAN DEFAULT false,
    quarantined BOOLEAN DEFAULT false,
    
    -- Investigation
    investigated BOOLEAN DEFAULT false,
    investigated_by UUID,
    investigated_at TIMESTAMP WITH TIME ZONE,
    investigation_notes TEXT,
    
    -- Status
    status VARCHAR(30) NOT NULL DEFAULT 'open', -- 'open', 'investigating', 'resolved', 'false_positive'
    
    -- Timestamps
    detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Device fraud patterns
CREATE TABLE device_fraud_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern_name VARCHAR(100) NOT NULL,
    pattern_type VARCHAR(50) NOT NULL, -- 'transaction', 'behavioral', 'network', 'hardware'
    
    -- Pattern definition
    pattern_rules JSONB NOT NULL,
    pattern_conditions JSONB NOT NULL,
    
    -- Risk assessment
    risk_score INTEGER NOT NULL CHECK (risk_score >= 1 AND risk_score <= 100),
    severity VARCHAR(20) NOT NULL DEFAULT 'medium',
    
    -- Detection settings
    is_active BOOLEAN NOT NULL DEFAULT true,
    detection_threshold DECIMAL(5,2) DEFAULT 0.80,
    
    -- Actions
    auto_block BOOLEAN DEFAULT false,
    auto_alert BOOLEAN DEFAULT true,
    require_investigation BOOLEAN DEFAULT true,
    
    -- Statistics
    total_detections BIGINT DEFAULT 0,
    true_positives BIGINT DEFAULT 0,
    false_positives BIGINT DEFAULT 0,
    accuracy_rate DECIMAL(5,2) DEFAULT 0.00,
    
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

-- POS device indexes
CREATE INDEX idx_pos_devices_device_id ON pos_devices(device_id);
CREATE INDEX idx_pos_devices_status ON pos_devices(device_status);
CREATE INDEX idx_pos_devices_agent ON pos_devices(assigned_agent_id);
CREATE INDEX idx_pos_devices_type ON pos_devices(device_type);
CREATE INDEX idx_pos_devices_geolocation ON pos_devices USING GIST(geolocation);
CREATE INDEX idx_pos_devices_last_heartbeat ON pos_devices(last_heartbeat);

-- Device telemetry indexes
CREATE INDEX idx_device_telemetry_device ON device_telemetry(device_id);
CREATE INDEX idx_device_telemetry_timestamp ON device_telemetry(timestamp);
CREATE INDEX idx_device_telemetry_device_timestamp ON device_telemetry(device_id, timestamp);

-- Device alerts indexes
CREATE INDEX idx_device_alerts_device ON device_alerts(device_id);
CREATE INDEX idx_device_alerts_type ON device_alerts(alert_type);
CREATE INDEX idx_device_alerts_severity ON device_alerts(alert_severity);
CREATE INDEX idx_device_alerts_status ON device_alerts(status);
CREATE INDEX idx_device_alerts_triggered ON device_alerts(triggered_at);

-- Edge computing indexes
CREATE INDEX idx_edge_nodes_status ON edge_computing_nodes(status);
CREATE INDEX idx_edge_nodes_geolocation ON edge_computing_nodes USING GIST(geolocation);
CREATE INDEX idx_edge_nodes_heartbeat ON edge_computing_nodes(last_heartbeat);

-- IoT device indexes
CREATE INDEX idx_iot_devices_device_id ON iot_devices(device_id);
CREATE INDEX idx_iot_devices_edge_node ON iot_devices(edge_node_id);
CREATE INDEX idx_iot_devices_status ON iot_devices(status);
CREATE INDEX idx_iot_devices_geolocation ON iot_devices USING GIST(geolocation);

-- IoT data streams indexes
CREATE INDEX idx_iot_data_device ON iot_data_streams(device_id);
CREATE INDEX idx_iot_data_timestamp ON iot_data_streams(timestamp);
CREATE INDEX idx_iot_data_type ON iot_data_streams(data_type);
CREATE INDEX idx_iot_data_device_timestamp ON iot_data_streams(device_id, timestamp);

-- MQTT indexes
CREATE INDEX idx_mqtt_topics_broker ON mqtt_topics(broker_id);
CREATE INDEX idx_mqtt_topics_name ON mqtt_topics(topic_name);
CREATE INDEX idx_mqtt_messages_topic ON mqtt_messages(topic_id);
CREATE INDEX idx_mqtt_messages_timestamp ON mqtt_messages(timestamp);
CREATE INDEX idx_mqtt_messages_device ON mqtt_messages(device_id);

-- Security indexes
CREATE INDEX idx_device_security_events_device ON device_security_events(device_id);
CREATE INDEX idx_device_security_events_type ON device_security_events(event_type);
CREATE INDEX idx_device_security_events_severity ON device_security_events(event_severity);
CREATE INDEX idx_device_security_events_detected ON device_security_events(detected_at);

-- Composite indexes for common queries
CREATE INDEX idx_devices_agent_status ON pos_devices(assigned_agent_id, device_status);
CREATE INDEX idx_telemetry_device_time ON device_telemetry(device_id, timestamp DESC);
CREATE INDEX idx_alerts_device_status ON device_alerts(device_id, status);
CREATE INDEX idx_iot_data_device_type_time ON iot_data_streams(device_id, data_type, timestamp DESC);

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
CREATE TRIGGER update_pos_devices_updated_at 
    BEFORE UPDATE ON pos_devices 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_device_configuration_profiles_updated_at 
    BEFORE UPDATE ON device_configuration_profiles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_edge_computing_nodes_updated_at 
    BEFORE UPDATE ON edge_computing_nodes 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_iot_devices_updated_at 
    BEFORE UPDATE ON iot_devices 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_mqtt_brokers_updated_at 
    BEFORE UPDATE ON mqtt_brokers 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_mqtt_topics_updated_at 
    BEFORE UPDATE ON mqtt_topics 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update device last_seen timestamp
CREATE OR REPLACE FUNCTION update_device_last_seen()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE pos_devices 
    SET last_seen = CURRENT_TIMESTAMP,
        last_heartbeat = CASE 
            WHEN NEW.timestamp > COALESCE(last_heartbeat, '1970-01-01'::timestamp) 
            THEN NEW.timestamp 
            ELSE last_heartbeat 
        END
    WHERE id = NEW.device_id;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply device last seen trigger
CREATE TRIGGER update_device_last_seen_trigger
    AFTER INSERT ON device_telemetry
    FOR EACH ROW EXECUTE FUNCTION update_device_last_seen();

-- Function to update edge node connected devices count
CREATE OR REPLACE FUNCTION update_edge_node_device_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE edge_computing_nodes 
        SET current_connected_devices = current_connected_devices + 1
        WHERE id = NEW.edge_node_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE edge_computing_nodes 
        SET current_connected_devices = current_connected_devices - 1
        WHERE id = OLD.edge_node_id;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.edge_node_id IS DISTINCT FROM NEW.edge_node_id THEN
            UPDATE edge_computing_nodes 
            SET current_connected_devices = current_connected_devices - 1
            WHERE id = OLD.edge_node_id;
            
            UPDATE edge_computing_nodes 
            SET current_connected_devices = current_connected_devices + 1
            WHERE id = NEW.edge_node_id;
        END IF;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ language 'plpgsql';

-- Apply edge node device count triggers
CREATE TRIGGER update_edge_node_device_count_insert
    AFTER INSERT ON iot_devices
    FOR EACH ROW EXECUTE FUNCTION update_edge_node_device_count();

CREATE TRIGGER update_edge_node_device_count_update
    AFTER UPDATE ON iot_devices
    FOR EACH ROW EXECUTE FUNCTION update_edge_node_device_count();

CREATE TRIGGER update_edge_node_device_count_delete
    AFTER DELETE ON iot_devices
    FOR EACH ROW EXECUTE FUNCTION update_edge_node_device_count();

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================

-- Device health summary view
CREATE VIEW device_health_summary AS
SELECT 
    pd.id,
    pd.device_id,
    pd.device_name,
    pd.device_type,
    pd.device_status,
    pd.assigned_agent_id,
    pd.uptime_percentage,
    pd.last_heartbeat,
    pd.last_seen,
    pd.connection_quality,
    COUNT(da.id) as active_alerts,
    COUNT(CASE WHEN da.alert_severity = 'critical' THEN 1 END) as critical_alerts,
    AVG(dt.cpu_usage_percent) as avg_cpu_usage,
    AVG(dt.memory_usage_percent) as avg_memory_usage,
    MAX(dt.timestamp) as last_telemetry
FROM pos_devices pd
LEFT JOIN device_alerts da ON pd.id = da.device_id AND da.status = 'active'
LEFT JOIN device_telemetry dt ON pd.id = dt.device_id 
    AND dt.timestamp >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
GROUP BY 
    pd.id, pd.device_id, pd.device_name, pd.device_type, pd.device_status,
    pd.assigned_agent_id, pd.uptime_percentage, pd.last_heartbeat, 
    pd.last_seen, pd.connection_quality;

-- Edge computing summary view
CREATE VIEW edge_computing_summary AS
SELECT 
    ecn.id,
    ecn.node_id,
    ecn.node_name,
    ecn.node_type,
    ecn.status,
    ecn.health_score,
    ecn.current_connected_devices,
    ecn.max_connected_devices,
    ecn.cpu_cores,
    ecn.ram_gb,
    ecn.storage_gb,
    COUNT(id.id) as total_iot_devices,
    COUNT(CASE WHEN id.status = 'active' THEN 1 END) as active_iot_devices,
    COUNT(CASE WHEN id.connection_status = 'connected' THEN 1 END) as connected_devices
FROM edge_computing_nodes ecn
LEFT JOIN iot_devices id ON ecn.id = id.edge_node_id
GROUP BY 
    ecn.id, ecn.node_id, ecn.node_name, ecn.node_type, ecn.status,
    ecn.health_score, ecn.current_connected_devices, ecn.max_connected_devices,
    ecn.cpu_cores, ecn.ram_gb, ecn.storage_gb;

-- MQTT topic statistics view
CREATE VIEW mqtt_topic_statistics AS
SELECT 
    mt.id,
    mt.topic_name,
    mt.topic_type,
    mb.broker_name,
    mt.subscriber_count,
    mt.publisher_count,
    mt.total_messages_received,
    mt.total_messages_sent,
    mt.last_message_timestamp,
    COUNT(mm.id) as messages_last_hour,
    AVG(mm.payload_size_bytes) as avg_message_size
FROM mqtt_topics mt
JOIN mqtt_brokers mb ON mt.broker_id = mb.id
LEFT JOIN mqtt_messages mm ON mt.id = mm.topic_id 
    AND mm.timestamp >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
GROUP BY 
    mt.id, mt.topic_name, mt.topic_type, mb.broker_name,
    mt.subscriber_count, mt.publisher_count, mt.total_messages_received,
    mt.total_messages_sent, mt.last_message_timestamp;

-- Device security summary view
CREATE VIEW device_security_summary AS
SELECT 
    pd.id,
    pd.device_id,
    pd.device_name,
    pd.device_type,
    pd.assigned_agent_id,
    COUNT(dse.id) as total_security_events,
    COUNT(CASE WHEN dse.event_severity = 'critical' THEN 1 END) as critical_events,
    COUNT(CASE WHEN dse.status = 'open' THEN 1 END) as open_events,
    MAX(dse.detected_at) as last_security_event,
    AVG(dse.confidence_score) as avg_confidence_score
FROM pos_devices pd
LEFT JOIN device_security_events dse ON pd.id = dse.device_id
    AND dse.detected_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
GROUP BY 
    pd.id, pd.device_id, pd.device_name, pd.device_type, pd.assigned_agent_id;

-- =====================================================
-- STORED PROCEDURES FOR COMMON OPERATIONS
-- =====================================================

-- Procedure to register a new POS device
CREATE OR REPLACE FUNCTION register_pos_device(
    p_device_id VARCHAR(100),
    p_device_name VARCHAR(255),
    p_device_type device_type_enum,
    p_manufacturer VARCHAR(100),
    p_model VARCHAR(100),
    p_serial_number VARCHAR(100),
    p_assigned_agent_id UUID,
    p_created_by UUID
) RETURNS UUID AS $$
DECLARE
    v_device_uuid UUID;
BEGIN
    -- Insert new device
    INSERT INTO pos_devices (
        device_id,
        device_name,
        device_type,
        manufacturer,
        model,
        serial_number,
        assigned_agent_id,
        device_status,
        created_by
    ) VALUES (
        p_device_id,
        p_device_name,
        p_device_type,
        p_manufacturer,
        p_model,
        p_serial_number,
        p_assigned_agent_id,
        'provisioning',
        p_created_by
    ) RETURNING id INTO v_device_uuid;
    
    -- Create initial configuration
    INSERT INTO device_configuration_profiles (
        profile_name,
        device_type,
        configuration,
        is_default,
        created_by
    ) VALUES (
        'Default ' || p_device_type || ' Profile',
        p_device_type,
        '{"auto_update": true, "security_level": "standard"}',
        true,
        p_created_by
    ) ON CONFLICT DO NOTHING;
    
    RETURN v_device_uuid;
END;
$$ LANGUAGE plpgsql;

-- Procedure to process device heartbeat
CREATE OR REPLACE FUNCTION process_device_heartbeat(
    p_device_id VARCHAR(100),
    p_telemetry_data JSONB
) RETURNS BOOLEAN AS $$
DECLARE
    v_device_uuid UUID;
BEGIN
    -- Get device UUID
    SELECT id INTO v_device_uuid
    FROM pos_devices
    WHERE device_id = p_device_id;
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    -- Update device last heartbeat
    UPDATE pos_devices
    SET 
        last_heartbeat = CURRENT_TIMESTAMP,
        last_seen = CURRENT_TIMESTAMP,
        device_status = CASE 
            WHEN device_status = 'offline' THEN 'active'
            ELSE device_status
        END
    WHERE id = v_device_uuid;
    
    -- Insert telemetry data
    INSERT INTO device_telemetry (
        device_id,
        cpu_usage_percent,
        memory_usage_percent,
        disk_usage_percent,
        battery_level,
        temperature_celsius,
        custom_metrics
    ) VALUES (
        v_device_uuid,
        (p_telemetry_data->>'cpu_usage')::DECIMAL,
        (p_telemetry_data->>'memory_usage')::DECIMAL,
        (p_telemetry_data->>'disk_usage')::DECIMAL,
        (p_telemetry_data->>'battery_level')::INTEGER,
        (p_telemetry_data->>'temperature')::DECIMAL,
        p_telemetry_data
    );
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Procedure to detect offline devices
CREATE OR REPLACE FUNCTION detect_offline_devices(
    p_offline_threshold_minutes INTEGER DEFAULT 5
) RETURNS INTEGER AS $$
DECLARE
    v_offline_count INTEGER := 0;
    v_device RECORD;
BEGIN
    -- Find devices that haven't sent heartbeat within threshold
    FOR v_device IN
        SELECT id, device_id, device_name
        FROM pos_devices
        WHERE device_status = 'active'
        AND (last_heartbeat IS NULL OR last_heartbeat < CURRENT_TIMESTAMP - INTERVAL '1 minute' * p_offline_threshold_minutes)
    LOOP
        -- Update device status to offline
        UPDATE pos_devices
        SET device_status = 'offline'
        WHERE id = v_device.id;
        
        -- Create alert
        INSERT INTO device_alerts (
            device_id,
            alert_type,
            alert_severity,
            alert_title,
            alert_message,
            triggered_at
        ) VALUES (
            v_device.id,
            'connectivity',
            'warning',
            'Device Offline',
            'Device ' || v_device.device_name || ' (' || v_device.device_id || ') has gone offline',
            CURRENT_TIMESTAMP
        );
        
        v_offline_count := v_offline_count + 1;
    END LOOP;
    
    RETURN v_offline_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- SAMPLE DATA FOR TESTING (OPTIONAL)
-- =====================================================

-- Insert sample MQTT broker
INSERT INTO mqtt_brokers (
    broker_name, broker_host, broker_port, use_tls, created_by
) VALUES 
('Primary MQTT Broker', 'mqtt.agentbanking.local', 1883, false, gen_random_uuid()),
('Secure MQTT Broker', 'secure-mqtt.agentbanking.local', 8883, true, gen_random_uuid());

-- Insert sample edge computing node
INSERT INTO edge_computing_nodes (
    node_id, node_name, node_type, cpu_cores, ram_gb, storage_gb, 
    latitude, longitude, created_by
) VALUES 
('EDGE-001', 'Lagos Central Edge Node', 'hybrid', 8, 32, 1000, 6.5244, 3.3792, gen_random_uuid()),
('EDGE-002', 'Nairobi Edge Gateway', 'gateway', 4, 16, 500, -1.2921, 36.8219, gen_random_uuid());

-- Insert sample device configuration profiles
INSERT INTO device_configuration_profiles (
    profile_name, device_type, configuration, security_policy, is_default, created_by
) VALUES 
('Standard POS Terminal', 'pos_terminal', 
 '{"auto_update": true, "heartbeat_interval": 30, "transaction_timeout": 120}',
 '{"encryption": true, "tamper_detection": true, "secure_boot": true}',
 true, gen_random_uuid()),
('Mobile POS Profile', 'mobile_pos',
 '{"auto_update": true, "heartbeat_interval": 60, "battery_optimization": true}',
 '{"encryption": true, "biometric_auth": true}',
 true, gen_random_uuid());

-- =====================================================
-- COMMENTS AND DOCUMENTATION
-- =====================================================

COMMENT ON TABLE pos_devices IS 'Comprehensive POS device registry with hardware specifications and status tracking';
COMMENT ON TABLE device_telemetry IS 'Real-time telemetry data collection from POS devices and IoT sensors';
COMMENT ON TABLE edge_computing_nodes IS 'Edge computing infrastructure for distributed processing and IoT management';
COMMENT ON TABLE iot_devices IS 'IoT device registry with MQTT connectivity and data streaming capabilities';
COMMENT ON TABLE mqtt_topics IS 'MQTT topic configuration for Fluvio integration and message routing';
COMMENT ON TABLE device_security_events IS 'Security event tracking and fraud detection for POS devices';

COMMENT ON COLUMN pos_devices.geolocation IS 'PostGIS geography point for device location tracking';
COMMENT ON COLUMN device_telemetry.custom_metrics IS 'JSONB field for device-specific telemetry data';
COMMENT ON COLUMN iot_data_streams.raw_data IS 'Raw sensor data in JSON format';
COMMENT ON COLUMN mqtt_messages.payload IS 'MQTT message payload in JSON format';
COMMENT ON COLUMN device_fraud_patterns.pattern_rules IS 'JSON-based fraud detection rules and conditions';

