-- Agent Cash Pickup Assignments
-- Links transfers with deliveryMethod=cash_pickup to specific agent locations
CREATE TABLE IF NOT EXISTS cash_pickup_assignments (
  id BIGSERIAL PRIMARY KEY,
  transfer_reference VARCHAR(64) NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  agent_network_id INTEGER NOT NULL,
  agent_name VARCHAR(200),
  agent_address VARCHAR(500),
  agent_city VARCHAR(100),
  agent_country VARCHAR(10),
  agent_phone VARCHAR(30),
  pickup_code_hash VARCHAR(64) NOT NULL,
  amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'NGN',
  recipient_name VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  disbursed_by_agent_id INTEGER,
  disbursement_ref VARCHAR(64),
  recipient_id_type VARCHAR(30),
  recipient_id_hash VARCHAR(64),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '72 hours',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_pickup_status CHECK (status IN ('pending', 'completed', 'expired', 'locked', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_cpa_transfer_ref ON cash_pickup_assignments(transfer_reference);
CREATE INDEX IF NOT EXISTS idx_cpa_agent_network_id ON cash_pickup_assignments(agent_network_id, status);
CREATE INDEX IF NOT EXISTS idx_cpa_user_id ON cash_pickup_assignments(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cpa_status_expires ON cash_pickup_assignments(status, expires_at) WHERE status = 'pending';

-- Float Top-Up Requests
-- Agents request float replenishment via bank transfer; admin approves and credits wallet
CREATE TABLE IF NOT EXISTS float_topup_requests (
  id BIGSERIAL PRIMARY KEY,
  agent_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount NUMERIC(18, 2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'NGN',
  bank_name VARCHAR(100) NOT NULL,
  bank_account_number VARCHAR(20) NOT NULL,
  reference VARCHAR(64) NOT NULL UNIQUE,
  verified_amount NUMERIC(18, 2),
  status VARCHAR(30) NOT NULL DEFAULT 'pending_verification',
  approved_by INTEGER,
  approved_at TIMESTAMPTZ,
  rejected_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_topup_status CHECK (status IN ('pending_verification', 'approved', 'rejected', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_ftr_user_id ON float_topup_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_ftr_agent_id ON float_topup_requests(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ftr_reference ON float_topup_requests(reference);
CREATE INDEX IF NOT EXISTS idx_ftr_pending ON float_topup_requests(status) WHERE status = 'pending_verification';

-- Add agent_network table if it doesn't exist (used by findAgents)
CREATE TABLE IF NOT EXISTS agent_network (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  country VARCHAR(10) NOT NULL,
  city VARCHAR(100),
  address VARCHAR(500),
  phone VARCHAR(30),
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  operating_hours VARCHAR(200),
  services TEXT[],
  daily_limit NUMERIC(18, 2) DEFAULT 5000000,
  currency VARCHAR(8) DEFAULT 'NGN',
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_network_country ON agent_network(country, status);
CREATE INDEX IF NOT EXISTS idx_agent_network_city ON agent_network(city, status);
