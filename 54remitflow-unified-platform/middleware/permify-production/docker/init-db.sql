-- Permify PostgreSQL Initialization Script
-- This script sets up the database for Permify authorization system

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create schemas for organization
CREATE SCHEMA IF NOT EXISTS permify;
CREATE SCHEMA IF NOT EXISTS audit;

-- Set search path
SET search_path TO permify, public;

-- Grant permissions
GRANT ALL PRIVILEGES ON SCHEMA permify TO permify;
GRANT ALL PRIVILEGES ON SCHEMA audit TO permify;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA permify TO permify;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA permify TO permify;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA audit TO permify;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA audit TO permify;

-- Create audit log table for tracking authorization changes
CREATE TABLE IF NOT EXISTS audit.authorization_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(100),
    entity_id VARCHAR(255),
    subject_type VARCHAR(100),
    subject_id VARCHAR(255),
    relation VARCHAR(100),
    permission VARCHAR(100),
    result VARCHAR(20),
    metadata JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255)
);

-- Create indexes for audit log
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit.authorization_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit.authorization_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit.authorization_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_subject ON audit.authorization_log(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit.authorization_log(created_at DESC);

-- Create performance metrics table
CREATE TABLE IF NOT EXISTS audit.performance_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(255) NOT NULL,
    operation VARCHAR(100) NOT NULL,
    duration_ms INTEGER NOT NULL,
    cache_hit BOOLEAN DEFAULT false,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance metrics
CREATE INDEX IF NOT EXISTS idx_perf_metrics_tenant ON audit.performance_metrics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_perf_metrics_operation ON audit.performance_metrics(operation);
CREATE INDEX IF NOT EXISTS idx_perf_metrics_created_at ON audit.performance_metrics(created_at DESC);

-- Create function to clean old audit logs (retention: 90 days)
CREATE OR REPLACE FUNCTION audit.clean_old_logs()
RETURNS void AS $$
BEGIN
    DELETE FROM audit.authorization_log
    WHERE created_at < NOW() - INTERVAL '90 days';
    
    DELETE FROM audit.performance_metrics
    WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Create scheduled job to clean old logs (requires pg_cron extension)
-- Uncomment if pg_cron is available:
-- SELECT cron.schedule('clean-old-permify-logs', '0 2 * * *', 'SELECT audit.clean_old_logs();');

-- Grant execute permission on function
GRANT EXECUTE ON FUNCTION audit.clean_old_logs() TO permify;

-- Create view for authorization statistics
CREATE OR REPLACE VIEW audit.authorization_stats AS
SELECT 
    tenant_id,
    action,
    result,
    DATE(created_at) as date,
    COUNT(*) as count,
    AVG(CASE WHEN metadata->>'duration_ms' IS NOT NULL 
        THEN (metadata->>'duration_ms')::INTEGER 
        ELSE NULL END) as avg_duration_ms
FROM audit.authorization_log
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY tenant_id, action, result, DATE(created_at)
ORDER BY date DESC, count DESC;

-- Grant select permission on view
GRANT SELECT ON audit.authorization_stats TO permify;

-- Insert initial tenant configuration
-- This will be used by the remittance platform
INSERT INTO permify.tenants (id, name, created_at) 
VALUES ('remittance-platform', 'Nigerian Remittance Platform', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

-- Create notification for successful initialization
DO $$
BEGIN
    RAISE NOTICE 'Permify database initialized successfully';
    RAISE NOTICE 'Default tenant: remittance-platform';
    RAISE NOTICE 'Audit logging enabled';
    RAISE NOTICE 'Performance metrics enabled';
END $$;

