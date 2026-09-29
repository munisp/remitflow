-- wave-15: Open-source-first OpenKYC re-implementation (SPEC-wave15 W0).
-- ADDITIVE ONLY: new tables + indexes. No ALTER/DROP of existing objects.

-- Capture sessions: one row per KYC camera/NFC capture attempt.
CREATE TABLE IF NOT EXISTS kyc_capture_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" integer NOT NULL,
  tenant_id integer,
  status varchar(24) NOT NULL DEFAULT 'issued', -- 'issued'|'in_progress'|'verified'|'failed'|'expired'|'manual_review'
  nonce varchar(64) NOT NULL,
  challenge jsonb NOT NULL,                     -- server-issued randomized challenge sequence
  doc_type varchar(32),                         -- 'passport'|'national_id'|'drivers_license'
  nfc_supported boolean,
  verdict jsonb,                                -- aggregated stage verdicts at finalize
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS kyc_capture_sessions_user_idx ON kyc_capture_sessions ("userId");
CREATE INDEX IF NOT EXISTS kyc_capture_sessions_status_idx ON kyc_capture_sessions (status);

-- Challenge event stream (client-reported liveness events, server-audited).
CREATE TABLE IF NOT EXISTS kyc_challenge_events (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES kyc_capture_sessions (id),
  seq integer NOT NULL,
  event varchar(32) NOT NULL,                   -- 'blink'|'turnLeft'|'turnRight'|'smile'|'jawOpen'|'frame'
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyc_challenge_events_session_idx ON kyc_challenge_events (session_id);

-- Pipeline stage results: PG is source of truth (closes G5; replaces in-memory dict).
-- simulated=true rows are HONEST markers and must never count as success downstream.
CREATE TABLE IF NOT EXISTS kyc_pipeline_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" integer,
  session_id uuid,
  stage varchar(32) NOT NULL,                   -- 'ocr'|'mrz'|'authenticity'|'liveness'|'face_match'|'deepfake'|'nfc'
  model varchar(64),
  success boolean NOT NULL,
  simulated boolean NOT NULL DEFAULT false,
  score double precision,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyc_pipeline_results_user_idx ON kyc_pipeline_results ("userId");
CREATE INDEX IF NOT EXISTS kyc_pipeline_results_session_idx ON kyc_pipeline_results (session_id);

-- Biometric embeddings (AdaFace IR-50 512-d; replaces rust-biometric in-memory HashMap, closes G4).
-- Cosine similarity computed in SQL for candidate scans; pgvector extension deferred (infra TODO).
CREATE TABLE IF NOT EXISTS biometric_embeddings (
  id bigserial PRIMARY KEY,
  "userId" integer NOT NULL UNIQUE,
  model varchar(32) NOT NULL,                   -- 'adaface-ir50'|'sface'
  embedding double precision[] NOT NULL,
  source varchar(24),                           -- 'capture'|'document_portrait'|'nfc_dg2'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Document authenticity heuristic signals (UNCERTIFIED — risk signal only, never sole gate).
CREATE TABLE IF NOT EXISTS document_authenticity (
  id bigserial PRIMARY KEY,
  session_id uuid REFERENCES kyc_capture_sessions (id),
  "userId" integer,
  signals jsonb NOT NULL,                       -- {moire, specular, bezel, exif, ...}
  risk_score double precision NOT NULL,         -- 0..1
  verdict varchar(16) NOT NULL,                 -- 'low'|'medium'|'high'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_authenticity_user_idx ON document_authenticity ("userId");
