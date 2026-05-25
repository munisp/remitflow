-- GPU Training Engine — PostgreSQL Schema
-- Standalone database for managing users, devices, training jobs, models, and remote nodes.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users & RBAC ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username        VARCHAR(128) NOT NULL UNIQUE,
    email           VARCHAR(256) UNIQUE,
    password_hash   VARCHAR(256) NOT NULL,
    role            VARCHAR(32) NOT NULL DEFAULT 'viewer'
                    CHECK (role IN ('admin','ml_engineer','data_scientist','viewer')),
    display_name    VARCHAR(256),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS api_keys (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash        VARCHAR(256) NOT NULL UNIQUE,
    key_prefix      VARCHAR(12) NOT NULL,
    label           VARCHAR(128),
    scopes          JSONB NOT NULL DEFAULT '["read"]',
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);

-- ─── Devices ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS devices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id         VARCHAR(128),
    vendor          VARCHAR(32) NOT NULL CHECK (vendor IN ('nvidia','amd','intel','huawei','apple','qualcomm','cpu')),
    backend         VARCHAR(32) NOT NULL CHECK (backend IN ('cuda','rocm','xpu','ascend','mps','directml','vulkan','opencl','cpu')),
    device_name     VARCHAR(256) NOT NULL,
    device_index    INT NOT NULL DEFAULT 0,
    memory_total_mb INT NOT NULL DEFAULT 0,
    memory_free_mb  INT NOT NULL DEFAULT 0,
    compute_capability VARCHAR(16) DEFAULT '',
    driver_version  VARCHAR(64) DEFAULT '',
    is_available    BOOLEAN NOT NULL DEFAULT true,
    priority        INT NOT NULL DEFAULT 100,
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_devices_vendor ON devices(vendor);
CREATE INDEX idx_devices_node ON devices(node_id);

-- ─── Training Jobs ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS training_jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    job_id          VARCHAR(64) NOT NULL UNIQUE,
    model_type      VARCHAR(64) NOT NULL,
    status          VARCHAR(32) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','loading_data','training','completed','failed','cancelled')),
    data_source     VARCHAR(32) NOT NULL DEFAULT 'synthetic'
                    CHECK (data_source IN ('synthetic','platform_db','custom','uploaded')),
    device_vendor   VARCHAR(32),
    device_name     VARCHAR(256),
    -- Hyperparameters
    epochs          INT NOT NULL DEFAULT 30,
    batch_size      INT NOT NULL DEFAULT 64,
    learning_rate   DOUBLE PRECISION NOT NULL DEFAULT 0.001,
    mixed_precision BOOLEAN NOT NULL DEFAULT true,
    -- Results
    training_samples INT,
    epochs_trained  INT,
    best_epoch      INT,
    training_time_s DOUBLE PRECISION,
    metrics         JSONB DEFAULT '{}',
    history         JSONB DEFAULT '[]',
    -- Paths
    model_path      VARCHAR(512),
    onnx_path       VARCHAR(512),
    error_message   TEXT,
    -- Remote execution
    remote_node_id  VARCHAR(128),
    -- Timestamps
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jobs_user ON training_jobs(user_id);
CREATE INDEX idx_jobs_status ON training_jobs(status);
CREATE INDEX idx_jobs_model_type ON training_jobs(model_type);
CREATE INDEX idx_jobs_created ON training_jobs(created_at DESC);

-- ─── Models Registry ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS models (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(128) NOT NULL,
    version         INT NOT NULL DEFAULT 1,
    model_type      VARCHAR(64) NOT NULL,
    format          VARCHAR(32) NOT NULL DEFAULT 'pytorch'
                    CHECK (format IN ('pytorch','onnx','tensorrt','openvino','coreml','quantized')),
    file_path       VARCHAR(512) NOT NULL,
    file_size_bytes BIGINT NOT NULL DEFAULT 0,
    input_shape     JSONB,
    output_shape    JSONB,
    -- Training provenance
    training_job_id UUID REFERENCES training_jobs(id) ON DELETE SET NULL,
    trained_on_device VARCHAR(256),
    training_metrics JSONB DEFAULT '{}',
    -- Deployment
    is_deployed     BOOLEAN NOT NULL DEFAULT false,
    deployed_device VARCHAR(256),
    inference_provider VARCHAR(64),
    -- Metadata
    description     TEXT,
    tags            JSONB DEFAULT '[]',
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(name, version)
);

CREATE INDEX idx_models_name ON models(name);
CREATE INDEX idx_models_type ON models(model_type);
CREATE INDEX idx_models_deployed ON models(is_deployed) WHERE is_deployed = true;

-- ─── Remote Nodes ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS remote_nodes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id         VARCHAR(128) NOT NULL UNIQUE,
    host            VARCHAR(256) NOT NULL,
    port            INT NOT NULL DEFAULT 8120,
    gpu_vendor      VARCHAR(32),
    api_key_hash    VARCHAR(256),
    status          VARCHAR(32) NOT NULL DEFAULT 'registered'
                    CHECK (status IN ('registered','healthy','unreachable','decommissioned')),
    last_health_at  TIMESTAMPTZ,
    health_data     JSONB DEFAULT '{}',
    registered_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_nodes_status ON remote_nodes(status);

-- ─── Inference Log ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inference_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    model_name      VARCHAR(128) NOT NULL,
    model_version   INT,
    device_used     VARCHAR(256),
    provider_used   VARCHAR(64),
    batch_size      INT NOT NULL DEFAULT 1,
    latency_ms      DOUBLE PRECISION NOT NULL,
    input_shape     JSONB,
    predictions     JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inference_model ON inference_log(model_name);
CREATE INDEX idx_inference_created ON inference_log(created_at DESC);

-- ─── Benchmark Results ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS benchmarks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name      VARCHAR(128) NOT NULL,
    device_vendor   VARCHAR(32) NOT NULL,
    device_name     VARCHAR(256) NOT NULL,
    provider        VARCHAR(64),
    input_shape     JSONB NOT NULL,
    batch_size      INT NOT NULL DEFAULT 1,
    iterations      INT NOT NULL DEFAULT 100,
    mean_latency_ms DOUBLE PRECISION NOT NULL,
    p50_latency_ms  DOUBLE PRECISION,
    p95_latency_ms  DOUBLE PRECISION,
    p99_latency_ms  DOUBLE PRECISION,
    throughput_rps  DOUBLE PRECISION,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bench_model ON benchmarks(model_name);

-- ─── Audit Log ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    action          VARCHAR(64) NOT NULL,
    resource_type   VARCHAR(64),
    resource_id     VARCHAR(128),
    details         JSONB DEFAULT '{}',
    ip_address      VARCHAR(45),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- ─── Seed default admin user ────────────────────────────────────────────────

INSERT INTO users (username, email, password_hash, role, display_name)
VALUES (
    'admin',
    'admin@gpu-engine.local',
    crypt('admin', gen_salt('bf')),
    'admin',
    'System Administrator'
) ON CONFLICT (username) DO NOTHING;
