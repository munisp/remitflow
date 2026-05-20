-- analytics-schema.sql - Postgres Analytics Database Schema
-- All analytics tables for real-time querying

-- Create analytics schema
CREATE SCHEMA IF NOT EXISTS analytics;

-- User Acquisitions
CREATE TABLE IF NOT EXISTS analytics.user_acquisitions (
    user_id VARCHAR(255) NOT NULL,
    source VARCHAR(100) NOT NULL,
    medium VARCHAR(100) NOT NULL,
    campaign VARCHAR(255),
    referrer TEXT,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, timestamp)
);

CREATE INDEX idx_acquisitions_source ON analytics.user_acquisitions(source);
CREATE INDEX idx_acquisitions_timestamp ON analytics.user_acquisitions(timestamp);

-- Onboarding Metrics
CREATE TABLE IF NOT EXISTS analytics.onboarding_metrics (
    user_id VARCHAR(255) NOT NULL,
    step INTEGER NOT NULL,
    step_name VARCHAR(100) NOT NULL,
    completed BOOLEAN NOT NULL,
    time_spent INTEGER NOT NULL,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, step, timestamp)
);

CREATE INDEX idx_onboarding_user ON analytics.onboarding_metrics(user_id);
CREATE INDEX idx_onboarding_step ON analytics.onboarding_metrics(step);

-- Feature Adoption
CREATE TABLE IF NOT EXISTS analytics.feature_adoption (
    user_id VARCHAR(255) NOT NULL,
    feature_name VARCHAR(100) NOT NULL,
    first_used BIGINT NOT NULL,
    usage_count INTEGER NOT NULL,
    last_used BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, feature_name)
);

CREATE INDEX idx_feature_name ON analytics.feature_adoption(feature_name);
CREATE INDEX idx_feature_usage ON analytics.feature_adoption(usage_count DESC);

-- Retention Metrics
CREATE TABLE IF NOT EXISTS analytics.retention_metrics (
    user_id VARCHAR(255) NOT NULL,
    install_date BIGINT NOT NULL,
    day1_active BOOLEAN DEFAULT FALSE,
    day7_active BOOLEAN DEFAULT FALSE,
    day30_active BOOLEAN DEFAULT FALSE,
    last_active_date BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id)
);

CREATE INDEX idx_retention_install ON analytics.retention_metrics(install_date);
CREATE INDEX idx_retention_last_active ON analytics.retention_metrics(last_active_date);

-- Session Metrics
CREATE TABLE IF NOT EXISTS analytics.session_metrics (
    session_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    start_time BIGINT NOT NULL,
    end_time BIGINT NOT NULL,
    duration INTEGER NOT NULL,
    screen_views INTEGER NOT NULL,
    clicks INTEGER NOT NULL,
    errors INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id)
);

CREATE INDEX idx_session_user ON analytics.session_metrics(user_id);
CREATE INDEX idx_session_duration ON analytics.session_metrics(duration DESC);

-- Events (all analytics events)
CREATE TABLE IF NOT EXISTS analytics.events (
    event_id SERIAL PRIMARY KEY,
    event_name VARCHAR(100) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    user_id VARCHAR(255),
    session_id VARCHAR(255),
    timestamp BIGINT NOT NULL,
    properties JSONB,
    platform VARCHAR(50),
    app_version VARCHAR(50),
    device_info JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_events_name ON analytics.events(event_name);
CREATE INDEX idx_events_type ON analytics.events(event_type);
CREATE INDEX idx_events_user ON analytics.events(user_id);
CREATE INDEX idx_events_timestamp ON analytics.events(timestamp);
CREATE INDEX idx_events_properties ON analytics.events USING GIN(properties);

-- A/B Test Assignments
CREATE TABLE IF NOT EXISTS analytics.ab_assignments (
    user_id VARCHAR(255) NOT NULL,
    test_id VARCHAR(100) NOT NULL,
    variant_id VARCHAR(100) NOT NULL,
    assigned_at BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, test_id)
);

CREATE INDEX idx_ab_test ON analytics.ab_assignments(test_id);
CREATE INDEX idx_ab_variant ON analytics.ab_assignments(variant_id);

-- A/B Test Results
CREATE TABLE IF NOT EXISTS analytics.ab_results (
    result_id SERIAL PRIMARY KEY,
    test_id VARCHAR(100) NOT NULL,
    variant_id VARCHAR(100) NOT NULL,
    metric VARCHAR(100) NOT NULL,
    value DECIMAL(15, 2) NOT NULL,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ab_results_test ON analytics.ab_results(test_id);
CREATE INDEX idx_ab_results_metric ON analytics.ab_results(metric);

-- Crashes
CREATE TABLE IF NOT EXISTS analytics.crashes (
    crash_id VARCHAR(255) NOT NULL,
    session_id VARCHAR(255),
    user_id VARCHAR(255),
    error_type VARCHAR(255) NOT NULL,
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (crash_id)
);

CREATE INDEX idx_crashes_user ON analytics.crashes(user_id);
CREATE INDEX idx_crashes_type ON analytics.crashes(error_type);
CREATE INDEX idx_crashes_timestamp ON analytics.crashes(timestamp);

-- Performance Metrics
CREATE TABLE IF NOT EXISTS analytics.performance_metrics (
    metric_id SERIAL PRIMARY KEY,
    metric_name VARCHAR(100) NOT NULL,
    value DECIMAL(15, 2) NOT NULL,
    timestamp BIGINT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_perf_name ON analytics.performance_metrics(metric_name);
CREATE INDEX idx_perf_timestamp ON analytics.performance_metrics(timestamp);

-- Feature Flag Usage
CREATE TABLE IF NOT EXISTS analytics.feature_flag_usage (
    flag_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    enabled BOOLEAN NOT NULL,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (flag_id, user_id, timestamp)
);

CREATE INDEX idx_flag_id ON analytics.feature_flag_usage(flag_id);

-- User Feedback
CREATE TABLE IF NOT EXISTS analytics.user_feedback (
    feedback_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT,
    screenshot TEXT,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (feedback_id)
);

CREATE INDEX idx_feedback_user ON analytics.user_feedback(user_id);
CREATE INDEX idx_feedback_type ON analytics.user_feedback(type);
CREATE INDEX idx_feedback_rating ON analytics.user_feedback(rating);

-- Funnel Events
CREATE TABLE IF NOT EXISTS analytics.funnel_events (
    event_id SERIAL PRIMARY KEY,
    funnel_id VARCHAR(100) NOT NULL,
    step_id VARCHAR(100) NOT NULL,
    step_name VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_funnel_id ON analytics.funnel_events(funnel_id);
CREATE INDEX idx_funnel_step ON analytics.funnel_events(step_id);
CREATE INDEX idx_funnel_user ON analytics.funnel_events(user_id);

-- Revenue Events
CREATE TABLE IF NOT EXISTS analytics.revenue_events (
    event_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    product_id VARCHAR(255) NOT NULL,
    transaction_id VARCHAR(255) NOT NULL,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id)
);

CREATE INDEX idx_revenue_user ON analytics.revenue_events(user_id);
CREATE INDEX idx_revenue_type ON analytics.revenue_events(event_type);
CREATE INDEX idx_revenue_timestamp ON analytics.revenue_events(timestamp);

-- Create lakehouse schema (for lakehouse data)
CREATE SCHEMA IF NOT EXISTS lakehouse;

-- Lakehouse tables mirror analytics tables but optimized for bulk inserts
-- (Same structure as analytics schema but with different indexes)
