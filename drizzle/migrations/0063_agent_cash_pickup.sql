-- Migration: 0063_agent_cash_pickup
-- Agent Cash Pickup, Float Top-Up Requests, and Agent Network tables
-- Security: pickup codes stored as SHA-256 hashes only (never plaintext)
-- Expiry: 72 hours from creation

-- ============================================================
-- TABLE 1: cash_pickup_assignments
-- ============================================================
CREATE TABLE IF NOT EXISTS "cash_pickup_assignments" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "transfer_id"         uuid NOT NULL REFERENCES "transactions"("id") ON DELETE CASCADE,
  "agent_id"            uuid NOT NULL REFERENCES "users"("id"),
  "recipient_id"        uuid NOT NULL REFERENCES "users"("id"),
  "pickup_code_hash"    varchar(64) NOT NULL,  -- SHA-256 hex of 6-digit code
  "amount"              numeric(20, 6) NOT NULL CHECK ("amount" > 0),
  "currency"            varchar(3) NOT NULL,
  "status"              varchar(32) NOT NULL DEFAULT 'pending'
                          CHECK ("status" IN ('pending','ready','collected','expired','cancelled')),
  "failed_attempts"     integer NOT NULL DEFAULT 0 CHECK ("failed_attempts" >= 0),
  "max_attempts"        integer NOT NULL DEFAULT 3,
  "expires_at"          timestamptz NOT NULL DEFAULT (now() + interval '72 hours'),
  "collected_at"        timestamptz,
  "agent_location_id"   uuid,
  "notes"               text,
  "metadata"            jsonb DEFAULT '{}',
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE 2: float_topup_requests
-- ============================================================
CREATE TABLE IF NOT EXISTS "float_topup_requests" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent_id"            uuid NOT NULL REFERENCES "users"("id"),
  "requested_amount"    numeric(20, 6) NOT NULL CHECK ("requested_amount" > 0),
  "approved_amount"     numeric(20, 6),
  "currency"            varchar(3) NOT NULL,
  "status"              varchar(32) NOT NULL DEFAULT 'pending'
                          CHECK ("status" IN ('pending','approved','rejected','disbursed')),
  "requested_by"        uuid NOT NULL REFERENCES "users"("id"),
  "approved_by"         uuid,
  "disbursed_at"        timestamptz,
  "reason"              text,
  "metadata"            jsonb DEFAULT '{}',
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE 3: agent_network
-- ============================================================
CREATE TABLE IF NOT EXISTS "agent_network" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent_id"            uuid NOT NULL REFERENCES "users"("id") UNIQUE,
  "business_name"       varchar(255) NOT NULL,
  "country_code"        varchar(2) NOT NULL,
  "region"              varchar(128),
  "city"                varchar(128),
  "address"             text,
  "latitude"            numeric(10, 7),
  "longitude"           numeric(10, 7),
  "float_balance"       numeric(20, 6) NOT NULL DEFAULT 0,
  "float_currency"      varchar(3) NOT NULL DEFAULT 'USD',
  "float_limit"         numeric(20, 6) NOT NULL DEFAULT 10000,
  "is_active"           boolean NOT NULL DEFAULT true,
  "is_verified"         boolean NOT NULL DEFAULT false,
  "kyc_tier"            integer NOT NULL DEFAULT 1,
  "commission_rate"     numeric(6, 4) NOT NULL DEFAULT 0.005,
  "operating_hours"     jsonb DEFAULT '{"mon":"08:00-18:00","tue":"08:00-18:00","wed":"08:00-18:00","thu":"08:00-18:00","fri":"08:00-18:00","sat":"09:00-14:00","sun":"closed"}',
  "supported_currencies" varchar[] NOT NULL DEFAULT ARRAY['USD'],
  "metadata"            jsonb DEFAULT '{}',
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- INDICES (10+ required)
-- ============================================================
CREATE INDEX IF NOT EXISTS "idx_cash_pickup_transfer_id"    ON "cash_pickup_assignments"("transfer_id");
CREATE INDEX IF NOT EXISTS "idx_cash_pickup_agent_id"       ON "cash_pickup_assignments"("agent_id");
CREATE INDEX IF NOT EXISTS "idx_cash_pickup_recipient_id"   ON "cash_pickup_assignments"("recipient_id");
CREATE INDEX IF NOT EXISTS "idx_cash_pickup_status"         ON "cash_pickup_assignments"("status");
CREATE INDEX IF NOT EXISTS "idx_cash_pickup_expires_at"     ON "cash_pickup_assignments"("expires_at");
CREATE INDEX IF NOT EXISTS "idx_cash_pickup_code_hash"      ON "cash_pickup_assignments"("pickup_code_hash");
CREATE INDEX IF NOT EXISTS "idx_float_topup_agent_id"       ON "float_topup_requests"("agent_id");
CREATE INDEX IF NOT EXISTS "idx_float_topup_status"         ON "float_topup_requests"("status");
CREATE INDEX IF NOT EXISTS "idx_float_topup_created_at"     ON "float_topup_requests"("created_at");
CREATE INDEX IF NOT EXISTS "idx_agent_network_agent_id"     ON "agent_network"("agent_id");
CREATE INDEX IF NOT EXISTS "idx_agent_network_country"      ON "agent_network"("country_code");
CREATE INDEX IF NOT EXISTS "idx_agent_network_active"       ON "agent_network"("is_active") WHERE "is_active" = true;

-- ============================================================
-- TRIGGERS: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cash_pickup_updated_at
  BEFORE UPDATE ON "cash_pickup_assignments"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_float_topup_updated_at
  BEFORE UPDATE ON "float_topup_requests"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_agent_network_updated_at
  BEFORE UPDATE ON "agent_network"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
