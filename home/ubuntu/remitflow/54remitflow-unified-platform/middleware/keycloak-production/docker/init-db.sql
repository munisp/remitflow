-- Keycloak Database Initialization Script
-- This script initializes the PostgreSQL database for Keycloak

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE keycloak TO keycloak;

-- Create audit table for tracking authentication events
CREATE TABLE IF NOT EXISTS auth_audit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255),
    username VARCHAR(255),
    event_type VARCHAR(100) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    realm VARCHAR(255),
    client_id VARCHAR(255),
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB
);

CREATE INDEX idx_auth_audit_user_id ON auth_audit(user_id);
CREATE INDEX idx_auth_audit_username ON auth_audit(username);
CREATE INDEX idx_auth_audit_event_type ON auth_audit(event_type);
CREATE INDEX idx_auth_audit_created_at ON auth_audit(created_at);
CREATE INDEX idx_auth_audit_realm ON auth_audit(realm);

-- Create user session tracking table
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    username VARCHAR(255) NOT NULL,
    session_id VARCHAR(255) UNIQUE NOT NULL,
    realm VARCHAR(255) NOT NULL,
    client_id VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    active BOOLEAN DEFAULT TRUE,
    metadata JSONB
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_session_id ON user_sessions(session_id);
CREATE INDEX idx_user_sessions_active ON user_sessions(active);
CREATE INDEX idx_user_sessions_realm ON user_sessions(realm);

-- Create function to update last_accessed_at
CREATE OR REPLACE FUNCTION update_last_accessed()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_accessed_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for last_accessed_at
CREATE TRIGGER trigger_update_last_accessed
BEFORE UPDATE ON user_sessions
FOR EACH ROW
EXECUTE FUNCTION update_last_accessed();

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO keycloak;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO keycloak;

