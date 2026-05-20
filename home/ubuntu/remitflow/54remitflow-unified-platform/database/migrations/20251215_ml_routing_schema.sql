-- ML Routing Schema
-- Database schema for ML-based multi-bank routing

-- Model Registry Table
-- Stores all trained model versions for versioning and deployment
CREATE TABLE IF NOT EXISTS ml_model_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_type VARCHAR(50) NOT NULL,  -- success_prediction, latency_prediction, liquidity_forecast
    model_version VARCHAR(50) NOT NULL,
    model_path VARCHAR(500) NOT NULL,
    metrics JSONB,  -- Training metrics (accuracy, MAE, etc.)
    metadata JSONB,  -- Additional metadata (hyperparameters, features used, etc.)
    is_deployed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deployed_at TIMESTAMPTZ,
    UNIQUE(model_type, model_version)
);

-- Index for fast lookup of deployed models
CREATE INDEX IF NOT EXISTS idx_ml_model_registry_deployed 
ON ml_model_registry(model_type, is_deployed) WHERE is_deployed = TRUE;

-- Routing Metrics Table (enhanced for ML training)
-- Captures predicted vs actual metrics for model training
CREATE TABLE IF NOT EXISTS routing_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id VARCHAR(255) NOT NULL UNIQUE,
    bank_code VARCHAR(10) NOT NULL,
    rail VARCHAR(20) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    was_successful BOOLEAN NOT NULL,
    actual_latency_ms INTEGER,
    actual_cost DECIMAL(10,2),
    predicted_success_rate DECIMAL(5,4),
    predicted_latency_ms INTEGER,
    predicted_cost DECIMAL(10,2),
    hour_of_day INTEGER,
    day_of_week INTEGER,
    error_code VARCHAR(50),
    error_message TEXT,
    model_version VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying during model training
CREATE INDEX IF NOT EXISTS idx_routing_metrics_bank_code ON routing_metrics(bank_code);
CREATE INDEX IF NOT EXISTS idx_routing_metrics_rail ON routing_metrics(rail);
CREATE INDEX IF NOT EXISTS idx_routing_metrics_created_at ON routing_metrics(created_at);
CREATE INDEX IF NOT EXISTS idx_routing_metrics_success ON routing_metrics(was_successful, created_at);

-- Partitioning for large-scale data (optional, for production)
-- CREATE TABLE routing_metrics_partitioned (
--     LIKE routing_metrics INCLUDING ALL
-- ) PARTITION BY RANGE (created_at);

-- Feature Store Tables
-- Real-time features cached for ML inference

-- Bank Features Table
CREATE TABLE IF NOT EXISTS ml_bank_features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_code VARCHAR(10) NOT NULL,
    feature_name VARCHAR(100) NOT NULL,
    feature_value DECIMAL(18,6) NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(bank_code, feature_name, window_start)
);

CREATE INDEX IF NOT EXISTS idx_ml_bank_features_lookup 
ON ml_bank_features(bank_code, feature_name, window_end DESC);

-- Rail Features Table
CREATE TABLE IF NOT EXISTS ml_rail_features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rail VARCHAR(20) NOT NULL,
    feature_name VARCHAR(100) NOT NULL,
    feature_value DECIMAL(18,6) NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(rail, feature_name, window_start)
);

CREATE INDEX IF NOT EXISTS idx_ml_rail_features_lookup 
ON ml_rail_features(rail, feature_name, window_end DESC);

-- Bandit State Table
-- Stores Thompson Sampling bandit state for exploration/exploitation
CREATE TABLE IF NOT EXISTS ml_bandit_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bandit_type VARCHAR(50) NOT NULL,  -- rail_selection, bank_selection
    arm_name VARCHAR(50) NOT NULL,
    alpha DECIMAL(18,6) NOT NULL DEFAULT 1.0,  -- Successes + 1
    beta DECIMAL(18,6) NOT NULL DEFAULT 1.0,   -- Failures + 1
    total_pulls INTEGER NOT NULL DEFAULT 0,
    total_rewards DECIMAL(18,6) NOT NULL DEFAULT 0,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(bandit_type, arm_name)
);

-- Contextual Bandit State (LinUCB)
CREATE TABLE IF NOT EXISTS ml_contextual_bandit_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bandit_type VARCHAR(50) NOT NULL,
    arm_name VARCHAR(50) NOT NULL,
    a_matrix BYTEA,  -- Serialized numpy array
    b_vector BYTEA,  -- Serialized numpy array
    n_features INTEGER NOT NULL,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(bandit_type, arm_name)
);

-- Liquidity Snapshots Table
-- Historical balance data for liquidity forecasting
CREATE TABLE IF NOT EXISTS liquidity_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_code VARCHAR(10) NOT NULL,
    account_number VARCHAR(50) NOT NULL,
    available_balance DECIMAL(18,2) NOT NULL,
    reserved_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
    current_balance DECIMAL(18,2) NOT NULL,
    today_inflow DECIMAL(18,2) NOT NULL DEFAULT 0,
    today_outflow DECIMAL(18,2) NOT NULL DEFAULT 0,
    snapshot_hour INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liquidity_snapshots_lookup 
ON liquidity_snapshots(bank_code, account_number, created_at DESC);

-- Liquidity Forecasts Table
-- Stores generated forecasts for auditing and analysis
CREATE TABLE IF NOT EXISTS liquidity_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_code VARCHAR(10) NOT NULL,
    account_number VARCHAR(50) NOT NULL,
    forecast_period VARCHAR(10) NOT NULL,
    current_balance DECIMAL(18,2) NOT NULL,
    predicted_inflow DECIMAL(18,2) NOT NULL,
    predicted_outflow DECIMAL(18,2) NOT NULL,
    predicted_balance DECIMAL(18,2) NOT NULL,
    confidence_lower DECIMAL(18,2),
    confidence_upper DECIMAL(18,2),
    confidence_level DECIMAL(5,4),
    recommended_action VARCHAR(100),
    model_used VARCHAR(50),
    forecast_timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liquidity_forecasts_lookup 
ON liquidity_forecasts(bank_code, account_number, created_at DESC);

-- Sweep Recommendations Table
-- Stores auto-generated sweep recommendations
CREATE TABLE IF NOT EXISTS sweep_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_bank_code VARCHAR(10) NOT NULL,
    source_account VARCHAR(50) NOT NULL,
    dest_bank_code VARCHAR(10) NOT NULL,
    dest_account VARCHAR(50) NOT NULL,
    amount DECIMAL(18,2) NOT NULL,
    reason TEXT,
    urgency VARCHAR(20) NOT NULL,  -- low, medium, high, critical
    recommended_time TIMESTAMPTZ NOT NULL,
    confidence DECIMAL(5,4),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, approved, executed, rejected
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sweep_recommendations_status 
ON sweep_recommendations(status, recommended_time);

-- ML Training Jobs Table
-- Tracks model training jobs
CREATE TABLE IF NOT EXISTS ml_training_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type VARCHAR(50) NOT NULL,  -- success_model, latency_model, liquidity_model
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    training_samples INTEGER,
    validation_samples INTEGER,
    metrics JSONB,
    error_message TEXT,
    model_version VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_training_jobs_status 
ON ml_training_jobs(status, created_at DESC);

-- ML Predictions Log Table
-- Logs all predictions for analysis and debugging
CREATE TABLE IF NOT EXISTS ml_predictions_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id VARCHAR(255) NOT NULL,
    prediction_type VARCHAR(50) NOT NULL,  -- success, latency, cost
    input_features JSONB NOT NULL,
    predicted_value DECIMAL(18,6) NOT NULL,
    model_version VARCHAR(50),
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partition by date for efficient querying and cleanup
CREATE INDEX IF NOT EXISTS idx_ml_predictions_log_created 
ON ml_predictions_log(created_at);

-- ML Alerts Table
-- Stores ML-related alerts (performance degradation, drift, etc.)
CREATE TABLE IF NOT EXISTS ml_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,  -- info, warning, critical
    message TEXT NOT NULL,
    details JSONB,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by VARCHAR(255),
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_alerts_unacknowledged 
ON ml_alerts(acknowledged, severity, created_at DESC) WHERE acknowledged = FALSE;

-- Feature Drift Detection Table
-- Tracks feature distribution changes over time
CREATE TABLE IF NOT EXISTS ml_feature_drift (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_name VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,  -- bank, rail, global
    entity_id VARCHAR(50),
    baseline_mean DECIMAL(18,6),
    baseline_std DECIMAL(18,6),
    current_mean DECIMAL(18,6),
    current_std DECIMAL(18,6),
    drift_score DECIMAL(10,6),  -- KL divergence or similar
    is_drifted BOOLEAN DEFAULT FALSE,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_feature_drift_drifted 
ON ml_feature_drift(is_drifted, created_at DESC) WHERE is_drifted = TRUE;

-- A/B Test Results Table
-- Stores results of ML model A/B tests
CREATE TABLE IF NOT EXISTS ml_ab_test_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_name VARCHAR(100) NOT NULL,
    variant_a VARCHAR(50) NOT NULL,  -- Model version A
    variant_b VARCHAR(50) NOT NULL,  -- Model version B
    metric_name VARCHAR(50) NOT NULL,
    variant_a_value DECIMAL(18,6),
    variant_b_value DECIMAL(18,6),
    sample_size_a INTEGER,
    sample_size_b INTEGER,
    p_value DECIMAL(10,6),
    is_significant BOOLEAN,
    winner VARCHAR(50),
    test_start TIMESTAMPTZ NOT NULL,
    test_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Functions for feature computation

-- Function to compute bank success rate over a time window
CREATE OR REPLACE FUNCTION compute_bank_success_rate(
    p_bank_code VARCHAR(10),
    p_window_hours INTEGER
) RETURNS DECIMAL(5,4) AS $$
DECLARE
    v_success_rate DECIMAL(5,4);
BEGIN
    SELECT COALESCE(AVG(CASE WHEN was_successful THEN 1.0 ELSE 0.0 END), 0.95)
    INTO v_success_rate
    FROM routing_metrics
    WHERE bank_code = p_bank_code
    AND created_at > NOW() - (p_window_hours || ' hours')::INTERVAL;
    
    RETURN v_success_rate;
END;
$$ LANGUAGE plpgsql;

-- Function to compute bank average latency over a time window
CREATE OR REPLACE FUNCTION compute_bank_avg_latency(
    p_bank_code VARCHAR(10),
    p_window_hours INTEGER
) RETURNS INTEGER AS $$
DECLARE
    v_avg_latency INTEGER;
BEGIN
    SELECT COALESCE(AVG(actual_latency_ms), 1000)::INTEGER
    INTO v_avg_latency
    FROM routing_metrics
    WHERE bank_code = p_bank_code
    AND was_successful = TRUE
    AND actual_latency_ms IS NOT NULL
    AND created_at > NOW() - (p_window_hours || ' hours')::INTERVAL;
    
    RETURN v_avg_latency;
END;
$$ LANGUAGE plpgsql;

-- Function to compute rail success rate over a time window
CREATE OR REPLACE FUNCTION compute_rail_success_rate(
    p_rail VARCHAR(20),
    p_window_hours INTEGER
) RETURNS DECIMAL(5,4) AS $$
DECLARE
    v_success_rate DECIMAL(5,4);
BEGIN
    SELECT COALESCE(AVG(CASE WHEN was_successful THEN 1.0 ELSE 0.0 END), 0.95)
    INTO v_success_rate
    FROM routing_metrics
    WHERE rail = p_rail
    AND created_at > NOW() - (p_window_hours || ' hours')::INTERVAL;
    
    RETURN v_success_rate;
END;
$$ LANGUAGE plpgsql;

-- Scheduled job to refresh feature store (run hourly)
-- This would be called by a cron job or scheduler
CREATE OR REPLACE FUNCTION refresh_ml_features() RETURNS VOID AS $$
DECLARE
    v_bank RECORD;
    v_rail RECORD;
BEGIN
    -- Refresh bank features
    FOR v_bank IN SELECT DISTINCT bank_code FROM routing_metrics LOOP
        -- 1-hour success rate
        INSERT INTO ml_bank_features (bank_code, feature_name, feature_value, window_start, window_end)
        VALUES (
            v_bank.bank_code,
            'success_rate_1h',
            compute_bank_success_rate(v_bank.bank_code, 1),
            NOW() - INTERVAL '1 hour',
            NOW()
        )
        ON CONFLICT (bank_code, feature_name, window_start) 
        DO UPDATE SET feature_value = EXCLUDED.feature_value, computed_at = NOW();
        
        -- 24-hour success rate
        INSERT INTO ml_bank_features (bank_code, feature_name, feature_value, window_start, window_end)
        VALUES (
            v_bank.bank_code,
            'success_rate_24h',
            compute_bank_success_rate(v_bank.bank_code, 24),
            NOW() - INTERVAL '24 hours',
            NOW()
        )
        ON CONFLICT (bank_code, feature_name, window_start) 
        DO UPDATE SET feature_value = EXCLUDED.feature_value, computed_at = NOW();
        
        -- 1-hour avg latency
        INSERT INTO ml_bank_features (bank_code, feature_name, feature_value, window_start, window_end)
        VALUES (
            v_bank.bank_code,
            'avg_latency_1h',
            compute_bank_avg_latency(v_bank.bank_code, 1),
            NOW() - INTERVAL '1 hour',
            NOW()
        )
        ON CONFLICT (bank_code, feature_name, window_start) 
        DO UPDATE SET feature_value = EXCLUDED.feature_value, computed_at = NOW();
    END LOOP;
    
    -- Refresh rail features
    FOR v_rail IN SELECT DISTINCT rail FROM routing_metrics LOOP
        INSERT INTO ml_rail_features (rail, feature_name, feature_value, window_start, window_end)
        VALUES (
            v_rail.rail,
            'success_rate_1h',
            compute_rail_success_rate(v_rail.rail, 1),
            NOW() - INTERVAL '1 hour',
            NOW()
        )
        ON CONFLICT (rail, feature_name, window_start) 
        DO UPDATE SET feature_value = EXCLUDED.feature_value, computed_at = NOW();
        
        INSERT INTO ml_rail_features (rail, feature_name, feature_value, window_start, window_end)
        VALUES (
            v_rail.rail,
            'success_rate_24h',
            compute_rail_success_rate(v_rail.rail, 24),
            NOW() - INTERVAL '24 hours',
            NOW()
        )
        ON CONFLICT (rail, feature_name, window_start) 
        DO UPDATE SET feature_value = EXCLUDED.feature_value, computed_at = NOW();
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Trigger to capture liquidity snapshots hourly
CREATE OR REPLACE FUNCTION capture_liquidity_snapshot() RETURNS TRIGGER AS $$
BEGIN
    -- Only capture if hour changed
    IF EXTRACT(HOUR FROM NEW.updated_at) != EXTRACT(HOUR FROM OLD.updated_at) THEN
        INSERT INTO liquidity_snapshots (
            bank_code, account_number, available_balance, reserved_balance,
            current_balance, today_inflow, today_outflow, snapshot_hour
        ) VALUES (
            NEW.bank_code, NEW.account_number, NEW.available_balance,
            NEW.reserved_balance, NEW.current_balance, NEW.today_inflow,
            NEW.today_outflow, EXTRACT(HOUR FROM NEW.updated_at)::INTEGER
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to bank_accounts table (if exists)
-- DROP TRIGGER IF EXISTS trg_capture_liquidity_snapshot ON bank_accounts;
-- CREATE TRIGGER trg_capture_liquidity_snapshot
-- AFTER UPDATE ON bank_accounts
-- FOR EACH ROW EXECUTE FUNCTION capture_liquidity_snapshot();

-- Cleanup old data (run daily)
CREATE OR REPLACE FUNCTION cleanup_ml_data() RETURNS VOID AS $$
BEGIN
    -- Delete predictions log older than 30 days
    DELETE FROM ml_predictions_log WHERE created_at < NOW() - INTERVAL '30 days';
    
    -- Delete routing metrics older than 90 days (keep for training)
    DELETE FROM routing_metrics WHERE created_at < NOW() - INTERVAL '90 days';
    
    -- Delete liquidity snapshots older than 90 days
    DELETE FROM liquidity_snapshots WHERE created_at < NOW() - INTERVAL '90 days';
    
    -- Delete acknowledged alerts older than 30 days
    DELETE FROM ml_alerts WHERE acknowledged = TRUE AND created_at < NOW() - INTERVAL '30 days';
    
    -- Delete old feature drift records
    DELETE FROM ml_feature_drift WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (adjust as needed)
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ml_service;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ml_service;

COMMENT ON TABLE ml_model_registry IS 'Stores all trained ML model versions for versioning and deployment';
COMMENT ON TABLE routing_metrics IS 'Captures predicted vs actual routing metrics for ML training';
COMMENT ON TABLE ml_bank_features IS 'Real-time bank features for ML inference';
COMMENT ON TABLE ml_rail_features IS 'Real-time rail features for ML inference';
COMMENT ON TABLE ml_bandit_state IS 'Thompson Sampling bandit state for exploration/exploitation';
COMMENT ON TABLE liquidity_snapshots IS 'Historical balance data for liquidity forecasting';
COMMENT ON TABLE liquidity_forecasts IS 'Generated liquidity forecasts for auditing';
COMMENT ON TABLE sweep_recommendations IS 'Auto-generated sweep recommendations';
COMMENT ON TABLE ml_training_jobs IS 'Tracks ML model training jobs';
COMMENT ON TABLE ml_predictions_log IS 'Logs all ML predictions for analysis';
COMMENT ON TABLE ml_alerts IS 'ML-related alerts for monitoring';
COMMENT ON TABLE ml_feature_drift IS 'Feature distribution drift detection';
COMMENT ON TABLE ml_ab_test_results IS 'ML model A/B test results';
