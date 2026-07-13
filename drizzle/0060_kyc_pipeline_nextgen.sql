-- RemitFlow Migration 0060: Next-Generation KYC Pipeline
-- Adds tables for PaddleOCR + Docling + VLM + 6-layer liveness + ArcFace biometrics

-- ── Enums ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE kyc_status AS ENUM (
    'pending', 'processing', 'approved', 'rejected', 'manual_review', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE kyc_doc_type AS ENUM (
    'passport', 'national_id', 'drivers_license', 'bvn', 'nin', 'utility_bill'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE liveness_result AS ENUM (
    'live', 'spoof_print_2d', 'spoof_replay_2d', 'spoof_mask_3d',
    'spoof_digital_injection', 'spoof_deepfake', 'spoof_partial', 'unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE kyc_provider AS ENUM (
    'internal', 'iproov', 'facetec', 'onfido', 'jumio', 'sumsub'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kyc_orchestrations (
  id                  TEXT        PRIMARY KEY,
  user_id             INTEGER     NOT NULL,
  status              kyc_status  NOT NULL DEFAULT 'pending',
  doc_type            kyc_doc_type NOT NULL,
  doc_number          TEXT,
  first_name          TEXT        NOT NULL,
  last_name           TEXT        NOT NULL,
  date_of_birth       TEXT,
  nationality         TEXT,
  rejection_reasons   JSONB       NOT NULL DEFAULT '[]',
  fraud_signals       JSONB       NOT NULL DEFAULT '[]',
  stages              JSONB       NOT NULL DEFAULT '{}',
  processing_ms       INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS kyc_orch_user_idx    ON kyc_orchestrations (user_id);
CREATE INDEX IF NOT EXISTS kyc_orch_status_idx  ON kyc_orchestrations (status);
CREATE INDEX IF NOT EXISTS kyc_orch_created_idx ON kyc_orchestrations (created_at DESC);

CREATE TABLE IF NOT EXISTS kyc_document_extractions (
  id                      TEXT        PRIMARY KEY,
  orchestration_id        TEXT        NOT NULL REFERENCES kyc_orchestrations(id) ON DELETE CASCADE,
  user_id                 INTEGER     NOT NULL,
  doc_type                TEXT        NOT NULL,
  extracted_first_name    TEXT,
  extracted_last_name     TEXT,
  extracted_doc_number    TEXT,
  extracted_dob           TEXT,
  extracted_expiry        TEXT,
  extracted_nationality   TEXT,
  extracted_country       TEXT,
  extracted_mrz           TEXT,
  mrz_check_digit_valid   BOOLEAN,
  paddleocr_confidence    REAL,
  docling_confidence      REAL,
  overall_confidence      REAL,
  pipeline_stages         JSONB       NOT NULL DEFAULT '[]',
  fraud_signals           JSONB       NOT NULL DEFAULT '[]',
  raw_extraction          JSONB,
  processing_ms           INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kyc_doc_orch_idx  ON kyc_document_extractions (orchestration_id);
CREATE INDEX IF NOT EXISTS kyc_doc_user_idx  ON kyc_document_extractions (user_id);

CREATE TABLE IF NOT EXISTS kyc_vlm_analyses (
  id                  TEXT        PRIMARY KEY,
  orchestration_id    TEXT        NOT NULL REFERENCES kyc_orchestrations(id) ON DELETE CASCADE,
  user_id             INTEGER     NOT NULL,
  model               TEXT        NOT NULL,
  doc_type            TEXT        NOT NULL,
  is_authentic        BOOLEAN,
  authenticity_score  REAL,
  tampering_detected  BOOLEAN,
  tampering_details   TEXT,
  security_features   JSONB       NOT NULL DEFAULT '[]',
  missing_features    JSONB       NOT NULL DEFAULT '[]',
  fraud_indicators    JSONB       NOT NULL DEFAULT '[]',
  extracted_fields    JSONB,
  vlm_raw_response    TEXT,
  processing_ms       INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kyc_vlm_orch_idx ON kyc_vlm_analyses (orchestration_id);
CREATE INDEX IF NOT EXISTS kyc_vlm_user_idx ON kyc_vlm_analyses (user_id);

CREATE TABLE IF NOT EXISTS kyc_liveness_checks (
  id                  TEXT            PRIMARY KEY,
  orchestration_id    TEXT            REFERENCES kyc_orchestrations(id) ON DELETE SET NULL,
  user_id             INTEGER         NOT NULL,
  is_live             BOOLEAN         NOT NULL,
  overall_confidence  REAL            NOT NULL,
  passive_score       REAL,
  active_score        REAL,
  depth_score         REAL,
  injection_score     REAL,
  deepfake_score      REAL,
  quality_score       REAL,
  spoof_type          liveness_result,
  challenge_results   JSONB,
  provider            kyc_provider    NOT NULL DEFAULT 'internal',
  processing_ms       INTEGER,
  audit_trail         JSONB,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kyc_liveness_user_idx ON kyc_liveness_checks (user_id);
CREATE INDEX IF NOT EXISTS kyc_liveness_orch_idx ON kyc_liveness_checks (orchestration_id);
CREATE INDEX IF NOT EXISTS kyc_liveness_live_idx ON kyc_liveness_checks (is_live);

CREATE TABLE IF NOT EXISTS kyc_biometric_profiles (
  id              TEXT        PRIMARY KEY,
  user_id         INTEGER     NOT NULL,
  profile_id      TEXT        NOT NULL UNIQUE,
  quality_score   REAL,
  doc_type        TEXT,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ,
  revoked_reason  TEXT
);

CREATE INDEX IF NOT EXISTS kyc_bio_user_idx   ON kyc_biometric_profiles (user_id);
CREATE INDEX IF NOT EXISTS kyc_bio_active_idx ON kyc_biometric_profiles (user_id, is_active);

CREATE TABLE IF NOT EXISTS kyc_biometric_matches (
  id          TEXT        PRIMARY KEY,
  user_id     INTEGER     NOT NULL,
  profile_id  TEXT,
  matched     BOOLEAN     NOT NULL,
  similarity  REAL        NOT NULL,
  threshold   REAL        NOT NULL,
  method      TEXT,
  latency_ms  INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kyc_match_user_idx   ON kyc_biometric_matches (user_id);
CREATE INDEX IF NOT EXISTS kyc_match_result_idx ON kyc_biometric_matches (matched);

CREATE TABLE IF NOT EXISTS kyc_dedup_detections (
  id               TEXT        PRIMARY KEY,
  probe_user_id    INTEGER     NOT NULL,
  matched_user_id  INTEGER,
  similarity       REAL        NOT NULL,
  is_duplicate     BOOLEAN     NOT NULL,
  action           TEXT        NOT NULL,
  reviewed_by      INTEGER,
  reviewed_at      TIMESTAMPTZ,
  review_notes     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kyc_dedup_probe_idx  ON kyc_dedup_detections (probe_user_id);
CREATE INDEX IF NOT EXISTS kyc_dedup_match_idx  ON kyc_dedup_detections (matched_user_id);
CREATE INDEX IF NOT EXISTS kyc_dedup_is_dup_idx ON kyc_dedup_detections (is_duplicate);

CREATE TABLE IF NOT EXISTS kyc_challenge_sessions (
  id            TEXT    PRIMARY KEY,
  user_id       INTEGER NOT NULL,
  challenges    JSONB   NOT NULL,
  completed     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at_ms BIGINT  NOT NULL,
  expires_at_ms BIGINT  NOT NULL,
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS kyc_challenge_user_idx    ON kyc_challenge_sessions (user_id);
CREATE INDEX IF NOT EXISTS kyc_challenge_expires_idx ON kyc_challenge_sessions (expires_at_ms);

CREATE TABLE IF NOT EXISTS kyc_fraud_signals (
  id               TEXT        PRIMARY KEY,
  orchestration_id TEXT        NOT NULL REFERENCES kyc_orchestrations(id) ON DELETE CASCADE,
  user_id          INTEGER     NOT NULL,
  signal_type      TEXT        NOT NULL,
  signal_detail    TEXT,
  severity         TEXT        NOT NULL DEFAULT 'medium',
  source           TEXT        NOT NULL,
  resolved         BOOLEAN     NOT NULL DEFAULT FALSE,
  resolved_by      INTEGER,
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kyc_fraud_orch_idx     ON kyc_fraud_signals (orchestration_id);
CREATE INDEX IF NOT EXISTS kyc_fraud_user_idx     ON kyc_fraud_signals (user_id);
CREATE INDEX IF NOT EXISTS kyc_fraud_type_idx     ON kyc_fraud_signals (signal_type);
CREATE INDEX IF NOT EXISTS kyc_fraud_severity_idx ON kyc_fraud_signals (severity);

-- ── Trigger: auto-update updated_at on kyc_orchestrations ─────────────────────
CREATE OR REPLACE FUNCTION update_kyc_orchestration_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kyc_orchestrations_updated_at ON kyc_orchestrations;
CREATE TRIGGER kyc_orchestrations_updated_at
  BEFORE UPDATE ON kyc_orchestrations
  FOR EACH ROW EXECUTE FUNCTION update_kyc_orchestration_updated_at();

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE kyc_orchestrations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_liveness_checks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_biometric_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_biometric_matches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_fraud_signals       ENABLE ROW LEVEL SECURITY;

-- Users can only see their own KYC records
CREATE POLICY kyc_orchestrations_user_policy ON kyc_orchestrations
  USING (user_id = current_setting('app.current_user_id', TRUE)::INTEGER);

CREATE POLICY kyc_liveness_user_policy ON kyc_liveness_checks
  USING (user_id = current_setting('app.current_user_id', TRUE)::INTEGER);

CREATE POLICY kyc_biometric_user_policy ON kyc_biometric_profiles
  USING (user_id = current_setting('app.current_user_id', TRUE)::INTEGER);
