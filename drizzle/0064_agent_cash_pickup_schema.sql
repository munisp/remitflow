-- Agent-network and cash-pickup runtime contracts.
-- The tables below match active tRPC handlers and remove the prior dependency on
-- absent raw-SQL tables for agent discovery, OTP-protected disbursement, and float operations.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS agent_network (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  country varchar(2) NOT NULL,
  city text,
  address text,
  phone varchar(32),
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  operating_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  services jsonb NOT NULL DEFAULT '[]'::jsonb,
  daily_limit numeric(24, 8) NOT NULL DEFAULT 0 CHECK (daily_limit >= 0),
  currency varchar(12) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_network_lookup_idx ON agent_network (country, city, currency, status, name);
CREATE INDEX IF NOT EXISTS agent_network_active_country_idx ON agent_network (country, status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS cash_pickup_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_reference text NOT NULL UNIQUE,
  user_id bigint NOT NULL,
  agent_network_id bigint NOT NULL REFERENCES agent_network(id),
  agent_name text NOT NULL,
  agent_address text,
  agent_city text,
  agent_country varchar(2),
  agent_phone varchar(32),
  pickup_code_hash text NOT NULL,
  amount numeric(24, 8) NOT NULL CHECK (amount > 0),
  currency varchar(12) NOT NULL,
  recipient_name text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'disbursed', 'expired', 'locked', 'cancelled')),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  verified_by_user_id bigint,
  disbursement_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  disbursed_at timestamptz
);
CREATE INDEX IF NOT EXISTS cash_pickup_assignments_agent_pending_idx ON cash_pickup_assignments (agent_network_id, status, expires_at);
CREATE INDEX IF NOT EXISTS cash_pickup_assignments_user_created_idx ON cash_pickup_assignments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cash_pickup_assignments_expiry_idx ON cash_pickup_assignments (expires_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS float_topup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id bigint NOT NULL,
  amount numeric(24, 8) NOT NULL CHECK (amount > 0),
  currency varchar(12) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'cancelled')),
  payment_reference text UNIQUE,
  requested_by bigint NOT NULL,
  reviewed_by bigint,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS float_topup_requests_agent_status_idx ON float_topup_requests (agent_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS float_topup_requests_pending_idx ON float_topup_requests (status, created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS agent_cash_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id bigint NOT NULL,
  assignment_id uuid REFERENCES cash_pickup_assignments(id),
  transfer_reference text,
  type varchar(32) NOT NULL CHECK (type IN ('disbursement', 'float_topup', 'commission', 'adjustment')),
  amount numeric(24, 8) NOT NULL,
  currency varchar(12) NOT NULL,
  reference text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_cash_transactions_agent_created_idx ON agent_cash_transactions (agent_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_cash_transactions_transfer_idx ON agent_cash_transactions (transfer_reference, created_at DESC);
