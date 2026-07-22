-- Agent registration and approval workflow contract.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS agent_registrations (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL UNIQUE,
  agent_code varchar(32) NOT NULL UNIQUE,
  business_name varchar(255) NOT NULL,
  business_type varchar(100) NOT NULL,
  state varchar(100) NOT NULL,
  lga varchar(100),
  address varchar(500),
  phone varchar(20) NOT NULL,
  tier varchar(20) NOT NULL DEFAULT 'basic' CHECK (tier IN ('basic', 'silver', 'gold', 'platinum')),
  status varchar(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'rejected')),
  daily_limit_ngn numeric(24, 8) NOT NULL DEFAULT 0 CHECK (daily_limit_ngn >= 0),
  commission_rate_pct numeric(8, 4) NOT NULL DEFAULT 0 CHECK (commission_rate_pct >= 0),
  monthly_volume_ngn numeric(24, 8) NOT NULL DEFAULT 0 CHECK (monthly_volume_ngn >= 0),
  approved_at timestamptz,
  approved_by bigint,
  rejection_reason text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_registrations_discovery_idx ON agent_registrations (status, state, tier, monthly_volume_ngn DESC);
CREATE INDEX IF NOT EXISTS agent_registrations_business_search_idx ON agent_registrations (state, business_name, agent_code);
