-- TigerBeetle Database Initialization Script
-- Creates necessary tables and indexes for TigerBeetle integration

-- Create extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- TigerBeetle Sync Events Table
CREATE TABLE IF NOT EXISTS tigerbeetle_sync_events (
    id VARCHAR(100) PRIMARY KEY,
    type VARCHAR(20) NOT NULL,
    operation VARCHAR(20) NOT NULL,
    data JSONB NOT NULL,
    source VARCHAR(50) NOT NULL,
    timestamp BIGINT NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TigerBeetle Sync Nodes Table
CREATE TABLE IF NOT EXISTS tigerbeetle_sync_nodes (
    id VARCHAR(100) PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    url VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL,
    last_sync TIMESTAMP,
    last_heartbeat TIMESTAMP,
    pending_events INTEGER DEFAULT 0,
    sync_errors JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TigerBeetle Sync Events Manager Table
CREATE TABLE IF NOT EXISTS tigerbeetle_sync_events_manager (
    id VARCHAR(100) PRIMARY KEY,
    type VARCHAR(20) NOT NULL,
    operation VARCHAR(20) NOT NULL,
    data JSONB NOT NULL,
    source_node VARCHAR(100) NOT NULL,
    target_nodes JSONB NOT NULL,
    timestamp BIGINT NOT NULL,
    processed_nodes JSONB DEFAULT '[]',
    failed_nodes JSONB DEFAULT '[]',
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TigerBeetle Accounts Metadata Table
CREATE TABLE IF NOT EXISTS tigerbeetle_accounts_metadata (
    account_id BIGINT PRIMARY KEY,
    user_id VARCHAR(100),
    account_type VARCHAR(50),
    currency VARCHAR(3) DEFAULT 'USD',
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TigerBeetle Transfers Metadata Table
CREATE TABLE IF NOT EXISTS tigerbeetle_transfers_metadata (
    transfer_id BIGINT PRIMARY KEY,
    transaction_id VARCHAR(100),
    transfer_type VARCHAR(50),
    description TEXT,
    reference VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- TigerBeetle Audit Log Table
CREATE TABLE IF NOT EXISTS tigerbeetle_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    user_id VARCHAR(100),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    source VARCHAR(100)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tigerbeetle_sync_events_processed ON tigerbeetle_sync_events(processed, timestamp);
CREATE INDEX IF NOT EXISTS idx_tigerbeetle_sync_events_type ON tigerbeetle_sync_events(type, operation);
CREATE INDEX IF NOT EXISTS idx_tigerbeetle_sync_events_source ON tigerbeetle_sync_events(source);

CREATE INDEX IF NOT EXISTS idx_tigerbeetle_sync_nodes_status ON tigerbeetle_sync_nodes(status);
CREATE INDEX IF NOT EXISTS idx_tigerbeetle_sync_nodes_type ON tigerbeetle_sync_nodes(type);

CREATE INDEX IF NOT EXISTS idx_tigerbeetle_sync_events_manager_status ON tigerbeetle_sync_events_manager(status, timestamp);
CREATE INDEX IF NOT EXISTS idx_tigerbeetle_sync_events_manager_source ON tigerbeetle_sync_events_manager(source_node);
CREATE INDEX IF NOT EXISTS idx_tigerbeetle_sync_events_manager_type ON tigerbeetle_sync_events_manager(type, operation);

CREATE INDEX IF NOT EXISTS idx_tigerbeetle_accounts_metadata_user ON tigerbeetle_accounts_metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_tigerbeetle_accounts_metadata_type ON tigerbeetle_accounts_metadata(account_type);

CREATE INDEX IF NOT EXISTS idx_tigerbeetle_transfers_metadata_transaction ON tigerbeetle_transfers_metadata(transaction_id);
CREATE INDEX IF NOT EXISTS idx_tigerbeetle_transfers_metadata_type ON tigerbeetle_transfers_metadata(transfer_type);

CREATE INDEX IF NOT EXISTS idx_tigerbeetle_audit_log_entity ON tigerbeetle_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_tigerbeetle_audit_log_timestamp ON tigerbeetle_audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_tigerbeetle_audit_log_user ON tigerbeetle_audit_log(user_id);

-- Create functions for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_tigerbeetle_sync_nodes_updated_at 
    BEFORE UPDATE ON tigerbeetle_sync_nodes 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tigerbeetle_sync_events_manager_updated_at 
    BEFORE UPDATE ON tigerbeetle_sync_events_manager 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tigerbeetle_accounts_metadata_updated_at 
    BEFORE UPDATE ON tigerbeetle_accounts_metadata 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tigerbeetle_transfers_metadata_updated_at 
    BEFORE UPDATE ON tigerbeetle_transfers_metadata 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert initial data
INSERT INTO tigerbeetle_sync_nodes (id, type, url, status) VALUES 
    ('zig-primary', 'zig-primary', 'http://tigerbeetle-zig-primary:8030', 'online'),
    ('edge-1', 'go-edge', 'http://tigerbeetle-go-edge-1:8031', 'online'),
    ('edge-2', 'go-edge', 'http://tigerbeetle-go-edge-2:8031', 'online')
ON CONFLICT (id) DO NOTHING;

-- Create views for monitoring
CREATE OR REPLACE VIEW tigerbeetle_sync_status AS
SELECT 
    n.id,
    n.type,
    n.status,
    n.last_sync,
    n.last_heartbeat,
    n.pending_events,
    COALESCE(pending.count, 0) as pending_sync_events,
    COALESCE(failed.count, 0) as failed_sync_events
FROM tigerbeetle_sync_nodes n
LEFT JOIN (
    SELECT source_node, COUNT(*) as count 
    FROM tigerbeetle_sync_events_manager 
    WHERE status = 'pending' 
    GROUP BY source_node
) pending ON n.id = pending.source_node
LEFT JOIN (
    SELECT source_node, COUNT(*) as count 
    FROM tigerbeetle_sync_events_manager 
    WHERE status = 'failed' 
    GROUP BY source_node
) failed ON n.id = failed.source_node;

CREATE OR REPLACE VIEW tigerbeetle_sync_metrics AS
SELECT 
    COUNT(*) as total_events,
    COUNT(*) FILTER (WHERE status = 'completed') as completed_events,
    COUNT(*) FILTER (WHERE status = 'pending') as pending_events,
    COUNT(*) FILTER (WHERE status = 'failed') as failed_events,
    COUNT(*) FILTER (WHERE status = 'partial') as partial_events,
    ROUND(
        COUNT(*) FILTER (WHERE status = 'failed') * 100.0 / NULLIF(COUNT(*), 0), 
        2
    ) as error_rate_percent,
    AVG(
        EXTRACT(EPOCH FROM (updated_at - created_at))
    ) FILTER (WHERE status = 'completed') as avg_processing_time_seconds
FROM tigerbeetle_sync_events_manager;

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO banking_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO banking_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO banking_user;
