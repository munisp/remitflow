-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0059: Property Escrow System
-- Covers: builder KYB profiles, escrow plans, milestones, milestone evidence,
--         property-specific disputes, cure notices, auto-refund scheduling
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Builder Profiles (KYB Verification) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS builder_profiles (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id),
  company_name        VARCHAR(300) NOT NULL,
  cac_registration_no VARCHAR(50),
  cac_verified        BOOLEAN DEFAULT FALSE,
  director_names      JSONB DEFAULT '[]'::jsonb,
  director_ids_verified BOOLEAN DEFAULT FALSE,
  registered_address  TEXT,
  phone               VARCHAR(30),
  email               VARCHAR(200),
  website             VARCHAR(300),
  years_in_operation  INTEGER DEFAULT 0,
  projects_completed  INTEGER DEFAULT 0,
  projects_in_progress INTEGER DEFAULT 0,
  average_rating      NUMERIC(3,2) DEFAULT 0.00,
  total_reviews       INTEGER DEFAULT 0,
  financial_health_score NUMERIC(5,2),
  insurance_policy_no VARCHAR(100),
  insurance_verified  BOOLEAN DEFAULT FALSE,
  kyb_status          VARCHAR(20) DEFAULT 'pending'
                        CHECK (kyb_status IN ('pending','submitted','under_review','verified','rejected','suspended')),
  kyb_submitted_at    TIMESTAMPTZ,
  kyb_verified_at     TIMESTAMPTZ,
  kyb_rejection_reason TEXT,
  documents           JSONB DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_builder_profiles_user ON builder_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_builder_profiles_status ON builder_profiles(kyb_status);

-- ─── Property Escrow Plans ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_escrow_plans (
  id                  SERIAL PRIMARY KEY,
  plan_id             VARCHAR(50) UNIQUE NOT NULL,
  buyer_id            INTEGER NOT NULL REFERENCES users(id),
  builder_id          INTEGER NOT NULL REFERENCES builder_profiles(id),
  listing_id          INTEGER NOT NULL REFERENCES real_estate_listings(id),
  total_price_ngn     NUMERIC(24,2) NOT NULL,
  total_price_usd     NUMERIC(18,2) NOT NULL,
  deposit_pct         NUMERIC(5,2) DEFAULT 10.00,
  deposit_paid        BOOLEAN DEFAULT FALSE,
  payment_currency    VARCHAR(10) DEFAULT 'GBP',
  installment_count   INTEGER NOT NULL,
  installment_amount  NUMERIC(18,2) NOT NULL,
  installment_frequency VARCHAR(20) DEFAULT 'monthly'
                        CHECK (installment_frequency IN ('weekly','biweekly','monthly','quarterly')),
  fx_rate_locked      NUMERIC(18,8),
  fx_lock_expires_at  TIMESTAMPTZ,
  smart_contract_id   VARCHAR(50) REFERENCES smart_contracts(contract_id),
  agreement_id        INTEGER,
  tigerbeetle_escrow_account BIGINT,
  total_paid_usd      NUMERIC(18,2) DEFAULT 0.00,
  total_released_usd  NUMERIC(18,2) DEFAULT 0.00,
  status              VARCHAR(30) DEFAULT 'draft'
                        CHECK (status IN ('draft','active','paused','completed','disputed','defaulted','refunded','cancelled')),
  next_payment_date   DATE,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_escrow_plans_buyer ON property_escrow_plans(buyer_id);
CREATE INDEX IF NOT EXISTS idx_escrow_plans_builder ON property_escrow_plans(builder_id);
CREATE INDEX IF NOT EXISTS idx_escrow_plans_listing ON property_escrow_plans(listing_id);
CREATE INDEX IF NOT EXISTS idx_escrow_plans_status ON property_escrow_plans(status);

-- ─── Property Milestones ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_milestones (
  id                  SERIAL PRIMARY KEY,
  milestone_id        VARCHAR(50) UNIQUE NOT NULL,
  escrow_plan_id      INTEGER NOT NULL REFERENCES property_escrow_plans(id),
  sequence_number     INTEGER NOT NULL,
  name                VARCHAR(200) NOT NULL,
  description         TEXT,
  release_pct         NUMERIC(5,2) NOT NULL,
  release_amount_usd  NUMERIC(18,2) NOT NULL,
  deadline            DATE NOT NULL,
  verification_type   VARCHAR(30) DEFAULT 'inspector'
                        CHECK (verification_type IN ('self_certified','inspector','surveyor','engineer','video','document','agent')),
  status              VARCHAR(30) DEFAULT 'pending'
                        CHECK (status IN ('pending','in_progress','evidence_submitted','under_review','approved','rejected','overdue','cure_notice','defaulted')),
  cure_notice_sent_at TIMESTAMPTZ,
  cure_notice_expires_at TIMESTAMPTZ,
  approved_by         INTEGER REFERENCES users(id),
  approved_at         TIMESTAMPTZ,
  rejected_reason     TEXT,
  funds_released      BOOLEAN DEFAULT FALSE,
  funds_released_at   TIMESTAMPTZ,
  tigerbeetle_transfer_id BIGINT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(escrow_plan_id, sequence_number)
);
CREATE INDEX IF NOT EXISTS idx_milestones_plan ON property_milestones(escrow_plan_id);
CREATE INDEX IF NOT EXISTS idx_milestones_status ON property_milestones(status);
CREATE INDEX IF NOT EXISTS idx_milestones_deadline ON property_milestones(deadline);

-- ─── Milestone Evidence ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS milestone_evidence (
  id                  SERIAL PRIMARY KEY,
  evidence_id         VARCHAR(50) UNIQUE NOT NULL,
  milestone_id        INTEGER NOT NULL REFERENCES property_milestones(id),
  submitted_by        INTEGER NOT NULL REFERENCES users(id),
  evidence_type       VARCHAR(30) NOT NULL
                        CHECK (evidence_type IN ('photo','video','document','engineer_report','surveyor_report','inspection_report','receipt','certificate')),
  file_url            TEXT NOT NULL,
  file_name           VARCHAR(300),
  file_size_bytes     BIGINT,
  description         TEXT,
  gps_latitude        NUMERIC(10,7),
  gps_longitude       NUMERIC(10,7),
  metadata            JSONB DEFAULT '{}'::jsonb,
  verified            BOOLEAN DEFAULT FALSE,
  verified_by         INTEGER REFERENCES users(id),
  verified_at         TIMESTAMPTZ,
  rejection_reason    TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_evidence_milestone ON milestone_evidence(milestone_id);
CREATE INDEX IF NOT EXISTS idx_evidence_submitted ON milestone_evidence(submitted_by);

-- ─── Property Escrow Disputes ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_escrow_disputes (
  id                  SERIAL PRIMARY KEY,
  dispute_id          VARCHAR(50) UNIQUE NOT NULL,
  escrow_plan_id      INTEGER NOT NULL REFERENCES property_escrow_plans(id),
  milestone_id        INTEGER REFERENCES property_milestones(id),
  raised_by           INTEGER NOT NULL REFERENCES users(id),
  dispute_type        VARCHAR(30) NOT NULL
                        CHECK (dispute_type IN ('deadline_missed','quality_issues','builder_default','scope_change','fraud','communication_failure','force_majeure','other')),
  severity            VARCHAR(10) DEFAULT 'medium'
                        CHECK (severity IN ('low','medium','high','critical')),
  description         TEXT NOT NULL,
  evidence_ids        JSONB DEFAULT '[]'::jsonb,
  status              VARCHAR(30) DEFAULT 'open'
                        CHECK (status IN ('open','cure_notice_sent','under_review','mediation','arbitration','resolved_buyer','resolved_builder','refund_initiated','refund_completed','closed')),
  resolution          TEXT,
  refund_amount_usd   NUMERIC(18,2),
  refund_initiated_at TIMESTAMPTZ,
  refund_completed_at TIMESTAMPTZ,
  assigned_mediator   INTEGER REFERENCES users(id),
  cure_deadline       TIMESTAMPTZ,
  auto_refund_date    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prop_disputes_plan ON property_escrow_disputes(escrow_plan_id);
CREATE INDEX IF NOT EXISTS idx_prop_disputes_status ON property_escrow_disputes(status);
CREATE INDEX IF NOT EXISTS idx_prop_disputes_raised ON property_escrow_disputes(raised_by);
CREATE INDEX IF NOT EXISTS idx_prop_disputes_autorefund ON property_escrow_disputes(auto_refund_date) WHERE auto_refund_date IS NOT NULL;

-- ─── Escrow Payment Schedule ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS escrow_payment_schedule (
  id                  SERIAL PRIMARY KEY,
  escrow_plan_id      INTEGER NOT NULL REFERENCES property_escrow_plans(id),
  installment_number  INTEGER NOT NULL,
  due_date            DATE NOT NULL,
  amount_usd          NUMERIC(18,2) NOT NULL,
  amount_local        NUMERIC(24,2),
  fx_rate_used        NUMERIC(18,8),
  status              VARCHAR(20) DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','processing','paid','failed','skipped','refunded')),
  paid_at             TIMESTAMPTZ,
  transaction_id      INTEGER REFERENCES transactions(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(escrow_plan_id, installment_number)
);
CREATE INDEX IF NOT EXISTS idx_escrow_schedule_plan ON escrow_payment_schedule(escrow_plan_id);
CREATE INDEX IF NOT EXISTS idx_escrow_schedule_due ON escrow_payment_schedule(due_date);
CREATE INDEX IF NOT EXISTS idx_escrow_schedule_status ON escrow_payment_schedule(status);
