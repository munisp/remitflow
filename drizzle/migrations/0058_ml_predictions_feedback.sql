-- ML Predictions Feedback Loop table
-- Stores model predictions + actual outcomes for continuous training
CREATE TABLE IF NOT EXISTS ml_predictions (
    id SERIAL PRIMARY KEY,
    model_name VARCHAR(64) NOT NULL,
    input_id VARCHAR(128) NOT NULL,
    prediction DOUBLE PRECISION NOT NULL,
    actual DOUBLE PRECISION,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
    UNIQUE(model_name, input_id)
);

CREATE INDEX IF NOT EXISTS idx_ml_predictions_model ON ml_predictions(model_name);
CREATE INDEX IF NOT EXISTS idx_ml_predictions_model_created ON ml_predictions(model_name, created_at);
CREATE INDEX IF NOT EXISTS idx_ml_predictions_labeled ON ml_predictions(model_name) WHERE actual IS NOT NULL;

-- ML Training Runs audit table
CREATE TABLE IF NOT EXISTS ml_training_runs (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(64) UNIQUE NOT NULL,
    model_name VARCHAR(64) NOT NULL,
    trigger VARCHAR(32) NOT NULL,       -- manual, scheduled, drift, continuous
    data_source VARCHAR(32) NOT NULL,   -- platform_db, feedback_loop, synthetic
    training_samples INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    metrics JSONB,
    champion_version VARCHAR(64),
    challenger_version VARCHAR(64),
    deployed BOOLEAN DEFAULT FALSE,
    error TEXT,
    started_at TIMESTAMP DEFAULT NOW() NOT NULL,
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ml_training_runs_model ON ml_training_runs(model_name);
CREATE INDEX IF NOT EXISTS idx_ml_training_runs_status ON ml_training_runs(status);
