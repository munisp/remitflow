-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0061: KYC/KYB Trigger Event Tracking Tables
-- Implements all 15 KYC/KYB trigger event audit tables
-- ─────────────────────────────────────────────────────────────────────────────

-- Enums
DO $$ BEGIN
  CREATE TYPE kyc_trigger_type AS ENUM (
    'user_registration', 'first_transfer_attempt', 'transaction_over_1000',
    'transaction_over_10000', 'pep_match_detected', 'sanctions_hit',
    'high_risk_score', 'periodic_rekyc_due', 'country_risk_change',
    'sar_filed', 'business_registration', 'director_change',
    'merchant_onboarding', 'license_expiry', 'beneficial_owner_change',
    'kyc_tier_upgrade_required', 'kyc_document_expired', 'kyc_address_change',
    'kyc_manual_review'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE kyc_trigger_status AS ENUM (
    'fired', 'processing', 'workflow_started', 'completed', 'failed', 'ignored'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE kyc_entity_type AS ENUM ('user', 'business', 'merchant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE kyc_freeze_reason AS ENUM (
    'sanctions_hit', 'sar_filed', 'high_risk_score', 'manual_review',
    'pep_edd_required', 'document_expired', 'suspicious_activity', 'regulatory_hold'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- KYC Trigger Events — audit log of every trigger fired
CREATE TABLE IF NOT EXISTS kyc_trigger_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type      kyc_trigger_type NOT NULL,
  entity_type       kyc_entity_type NOT NULL DEFAULT 'user',
  entity_id         VARCHAR(255) NOT NULL,
  user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE,
  business_id       UUID,
  amount            DECIMAL(20, 8),
  currency          VARCHAR(10),
  risk_score        DECIMAL(5, 2),
  country           VARCHAR(10),
  correlation_id    UUID NOT NULL DEFAULT gen_random_uuid(),
  status            kyc_trigger_status NOT NULL DEFAULT 'fired',
  workflow_id       VARCHAR(255),
  metadata          JSONB,
  fired_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ,
  error_message     TEXT
);

CREATE INDEX IF NOT EXISTS kyc_trigger_events_user_id_idx ON kyc_trigger_events(user_id);
CREATE INDEX IF NOT EXISTS kyc_trigger_events_trigger_type_idx ON kyc_trigger_events(trigger_type);
CREATE INDEX IF NOT EXISTS kyc_trigger_events_status_idx ON kyc_trigger_events(status);
CREATE INDEX IF NOT EXISTS kyc_trigger_events_correlation_id_idx ON kyc_trigger_events(correlation_id);
CREATE INDEX IF NOT EXISTS kyc_trigger_events_fired_at_idx ON kyc_trigger_events(fired_at DESC);
CREATE INDEX IF NOT EXISTS kyc_trigger_events_entity_idx ON kyc_trigger_events(entity_type, entity_id);

-- KYC Freeze Log — log of all account freezes and unfreezes
CREATE TABLE IF NOT EXISTS kyc_freeze_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id       UUID,
  freeze_reason     kyc_freeze_reason NOT NULL,
  frozen_by         VARCHAR(255) NOT NULL DEFAULT 'system',
  frozen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unfrozen_at       TIMESTAMPTZ,
  unfrozen_by       VARCHAR(255),
  trigger_event_id  UUID REFERENCES kyc_trigger_events(id),
  sanctions_list    VARCHAR(255),
  sar_reference     VARCHAR(255),
  notes             TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS kyc_freeze_log_user_id_idx ON kyc_freeze_log(user_id);
CREATE INDEX IF NOT EXISTS kyc_freeze_log_is_active_idx ON kyc_freeze_log(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS kyc_freeze_log_frozen_at_idx ON kyc_freeze_log(frozen_at DESC);

-- Row-Level Security for freeze log
ALTER TABLE kyc_freeze_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY kyc_freeze_log_tenant_policy ON kyc_freeze_log
  USING (user_id::text = current_setting('app.current_user_id', TRUE));

-- KYC Re-KYC Schedule — scheduled re-KYC events
CREATE TABLE IF NOT EXISTS kyc_rekyc_schedule (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kyc_tier          INTEGER NOT NULL DEFAULT 0,
  schedule_reason   VARCHAR(100) NOT NULL,
  due_at            TIMESTAMPTZ NOT NULL,
  notified_at       TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  risk_score        DECIMAL(5, 2),
  is_pep            BOOLEAN NOT NULL DEFAULT FALSE,
  is_high_risk      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kyc_rekyc_schedule_user_id_idx ON kyc_rekyc_schedule(user_id);
CREATE INDEX IF NOT EXISTS kyc_rekyc_schedule_due_at_idx ON kyc_rekyc_schedule(due_at)
  WHERE completed_at IS NULL AND cancelled_at IS NULL;

-- KYC Tier Requirements — per-operation KYC tier requirements
CREATE TABLE IF NOT EXISTS kyc_tier_requirements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type    VARCHAR(100) NOT NULL UNIQUE,
  minimum_tier      INTEGER NOT NULL DEFAULT 1,
  max_amount_tier1  DECIMAL(20, 8),
  max_amount_tier2  DECIMAL(20, 8),
  max_amount_tier3  DECIMAL(20, 8),
  currency          VARCHAR(10) NOT NULL DEFAULT 'USD',
  description       TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default tier requirements
INSERT INTO kyc_tier_requirements (operation_type, minimum_tier, max_amount_tier1, max_amount_tier2, max_amount_tier3, description)
VALUES
  ('transfer_domestic',   1, 500,    5000,   50000,  'Domestic bank transfer'),
  ('transfer_cross_border', 2, 200,  2000,   20000,  'Cross-border remittance'),
  ('stablecoin_onramp',   1, 500,    5000,   50000,  'Stablecoin on-ramp'),
  ('stablecoin_offramp',  2, 200,    2000,   20000,  'Stablecoin off-ramp'),
  ('crypto_buy',          1, 500,    5000,   50000,  'Cryptocurrency purchase'),
  ('crypto_sell',         2, 200,    2000,   20000,  'Cryptocurrency sale'),
  ('merchant_payment',    1, 1000,   10000,  100000, 'Merchant payment'),
  ('escrow_create',       2, 1000,   10000,  100000, 'Escrow creation'),
  ('bulk_payment',        3, NULL,   NULL,   NULL,   'Bulk payment (always requires Tier 3)')
ON CONFLICT (operation_type) DO NOTHING;

-- KYB Trigger Events — KYB-specific trigger audit log
CREATE TABLE IF NOT EXISTS kyb_trigger_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type          VARCHAR(100) NOT NULL,
  business_id           UUID NOT NULL,
  user_id               INTEGER REFERENCES users(id),
  correlation_id        UUID NOT NULL DEFAULT gen_random_uuid(),
  status                kyc_trigger_status NOT NULL DEFAULT 'fired',
  workflow_id           VARCHAR(255),
  director_name         VARCHAR(255),
  owner_name            VARCHAR(255),
  ownership_percentage  DECIMAL(5, 2),
  license_type          VARCHAR(100),
  license_expiry_date   TIMESTAMPTZ,
  metadata              JSONB,
  fired_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS kyb_trigger_events_business_id_idx ON kyb_trigger_events(business_id);
CREATE INDEX IF NOT EXISTS kyb_trigger_events_trigger_type_idx ON kyb_trigger_events(trigger_type);
CREATE INDEX IF NOT EXISTS kyb_trigger_events_fired_at_idx ON kyb_trigger_events(fired_at DESC);

-- KYC Country Risk Log — log of country risk level changes
CREATE TABLE IF NOT EXISTS kyc_country_risk_log (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code            VARCHAR(10) NOT NULL,
  previous_risk_level     VARCHAR(50),
  new_risk_level          VARCHAR(50) NOT NULL,
  change_reason           TEXT,
  affected_users_count    INTEGER DEFAULT 0,
  rekyc_triggered_count   INTEGER DEFAULT 0,
  changed_by              VARCHAR(255) NOT NULL DEFAULT 'system',
  changed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata                JSONB
);

CREATE INDEX IF NOT EXISTS kyc_country_risk_log_country_code_idx ON kyc_country_risk_log(country_code);
CREATE INDEX IF NOT EXISTS kyc_country_risk_log_changed_at_idx ON kyc_country_risk_log(changed_at DESC);

-- Add kyc_expires_at and kyc_tier columns to users table if not present
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_tier INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_frozen BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_freeze_reason VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS risk_score DECIMAL(5, 2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_pep BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pep_level VARCHAR(50);

CREATE INDEX IF NOT EXISTS users_kyc_tier_idx ON users(kyc_tier);
CREATE INDEX IF NOT EXISTS users_kyc_expires_at_idx ON users(kyc_expires_at) WHERE kyc_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_kyc_frozen_idx ON users(kyc_frozen) WHERE kyc_frozen = TRUE;
CREATE INDEX IF NOT EXISTS users_risk_score_idx ON users(risk_score DESC);
