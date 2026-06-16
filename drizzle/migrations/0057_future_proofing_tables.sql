-- Future-Proofing Tables Migration (Categories 1-10)
-- Supports: FedNow, goAML, NDPA DSAR, VRP, Smart Contracts, HSM, PII Vault, Behavioral Biometrics

-- Category 2: Open Banking
CREATE TABLE IF NOT EXISTS open_banking_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  bank_id VARCHAR(50) NOT NULL,
  bank_account_id VARCHAR(100) NOT NULL,
  account_type VARCHAR(20) DEFAULT 'current',
  status VARCHAR(20) DEFAULT 'active',
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS open_banking_consents (
  id SERIAL PRIMARY KEY,
  consent_id VARCHAR(50) UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  bank_id VARCHAR(50) NOT NULL,
  permissions JSONB NOT NULL,
  status VARCHAR(30) DEFAULT 'awaiting_authorization',
  state_token VARCHAR(128),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_requests (
  id SERIAL PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  amount DECIMAL(18,4) NOT NULL,
  currency VARCHAR(3) DEFAULT 'NGN',
  description TEXT,
  token VARCHAR(128) UNIQUE NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  payer_email VARCHAR(255),
  payer_phone VARCHAR(30),
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkout_sessions (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(50) UNIQUE NOT NULL,
  merchant_id VARCHAR(100) NOT NULL,
  amount DECIMAL(18,4) NOT NULL,
  currency VARCHAR(3) DEFAULT 'NGN',
  description TEXT,
  success_url TEXT,
  cancel_url TEXT,
  metadata JSONB DEFAULT '{}',
  customer_email VARCHAR(255),
  token VARCHAR(128) UNIQUE NOT NULL,
  status VARCHAR(20) DEFAULT 'open',
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vrp_consents (
  id SERIAL PRIMARY KEY,
  consent_id VARCHAR(50) UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  beneficiary_account_id VARCHAR(100) NOT NULL,
  max_single_payment DECIMAL(18,4) NOT NULL,
  max_cumulative_amount DECIMAL(18,4) NOT NULL,
  max_cumulative_period VARCHAR(20) NOT NULL,
  valid_from DATE NOT NULL,
  valid_to DATE NOT NULL,
  reference VARCHAR(140),
  status VARCHAR(20) DEFAULT 'active',
  total_paid DECIMAL(18,4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Category 3: ISO 20022
CREATE TABLE IF NOT EXISTS iso20022_messages (
  id SERIAL PRIMARY KEY,
  message_id VARCHAR(100) UNIQUE NOT NULL,
  message_type VARCHAR(20) NOT NULL,
  direction VARCHAR(10) NOT NULL DEFAULT 'outbound',
  xml_content TEXT NOT NULL,
  status VARCHAR(10) DEFAULT 'ACTC',
  original_message_id VARCHAR(100),
  payment_count INTEGER DEFAULT 1,
  total_amount DECIMAL(18,4),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Category 4: Smart Contracts
CREATE TABLE IF NOT EXISTS smart_contracts (
  id SERIAL PRIMARY KEY,
  contract_id VARCHAR(50) UNIQUE NOT NULL,
  creator_id INTEGER NOT NULL REFERENCES users(id),
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  amount DECIMAL(18,4) NOT NULL,
  currency VARCHAR(10) DEFAULT 'eNGN',
  conditions JSONB NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  executed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Category 5: Compliance
CREATE TABLE IF NOT EXISTS goaml_reports (
  id SERIAL PRIMARY KEY,
  report_id VARCHAR(50) UNIQUE NOT NULL,
  report_type VARCHAR(5) NOT NULL,
  xml_content TEXT NOT NULL,
  transaction_ids JSONB,
  status VARCHAR(20) DEFAULT 'draft',
  created_by INTEGER REFERENCES users(id),
  narrative TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dsar_requests (
  id SERIAL PRIMARY KEY,
  request_id VARCHAR(50) UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  request_type VARCHAR(20) NOT NULL,
  details TEXT,
  status VARCHAR(20) DEFAULT 'received',
  response_data JSONB,
  response_due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sanctions_list (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  aliases JSONB DEFAULT '[]',
  date_of_birth DATE,
  country VARCHAR(5),
  list_source VARCHAR(50) NOT NULL,
  entity_type VARCHAR(20) DEFAULT 'individual',
  sanctions_programs JSONB DEFAULT '[]',
  sanction_type VARCHAR(50),
  entry_id VARCHAR(100),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Category 7: FedNow
CREATE TABLE IF NOT EXISTS fednow_transfers (
  id SERIAL PRIMARY KEY,
  transaction_id VARCHAR(50) UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount DECIMAL(18,4) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  creditor_routing_number VARCHAR(9) NOT NULL,
  creditor_account_number VARCHAR(17) NOT NULL,
  creditor_name VARCHAR(140) NOT NULL,
  end_to_end_id VARCHAR(50) NOT NULL,
  status VARCHAR(10) DEFAULT 'submitted',
  message_payload JSONB,
  gateway_response JSONB,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Category 8: Security
CREATE TABLE IF NOT EXISTS hsm_keys (
  id SERIAL PRIMARY KEY,
  key_id VARCHAR(50) UNIQUE NOT NULL,
  key_type VARCHAR(20) NOT NULL,
  purpose VARCHAR(100),
  created_by INTEGER REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'active',
  public_key TEXT,
  rotated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pii_tokens (
  id SERIAL PRIMARY KEY,
  token VARCHAR(100) NOT NULL,
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  field_type VARCHAR(30) NOT NULL,
  encrypted_value TEXT NOT NULL,
  iv VARCHAR(32) NOT NULL,
  auth_tag VARCHAR(32) NOT NULL,
  created_by INTEGER REFERENCES users(id),
  accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS behavioral_biometrics (
  id SERIAL PRIMARY KEY,
  sample_id VARCHAR(50) UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  typing_pattern JSONB DEFAULT '[]',
  touch_pressure JSONB DEFAULT '[]',
  device_motion JSONB DEFAULT '{}',
  fingerprint_hash VARCHAR(64),
  risk_score DECIMAL(5,4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Category 10: Business
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id SERIAL PRIMARY KEY,
  subscription_id VARCHAR(50) UNIQUE NOT NULL,
  user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
  plan_id VARCHAR(20) NOT NULL DEFAULT 'free',
  status VARCHAR(20) DEFAULT 'active',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  current_period_end TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

-- Category 5: CBDC mint/burn log for eNaira
CREATE TABLE IF NOT EXISTS cbdc_mint_burn_log (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER,
  operation VARCHAR(20) NOT NULL,
  amount DECIMAL(18,4) NOT NULL,
  currency VARCHAR(10) DEFAULT 'eNGN',
  operator_id INTEGER REFERENCES users(id),
  reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Smart routing decisions table
CREATE TABLE IF NOT EXISTS smart_routing_decisions (
  id SERIAL PRIMARY KEY,
  orchestration_id VARCHAR(50) UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount DECIMAL(18,4) NOT NULL,
  from_currency VARCHAR(3) NOT NULL,
  to_currency VARCHAR(3) NOT NULL,
  selected_provider VARCHAR(30) NOT NULL,
  estimated_fee DECIMAL(18,4),
  score DECIMAL(8,4),
  alternatives JSONB DEFAULT '[]',
  priority VARCHAR(20) DEFAULT 'cost',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ob_accounts_user ON open_banking_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_ob_consents_user ON open_banking_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_token ON payment_requests(token);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_token ON checkout_sessions(token);
CREATE INDEX IF NOT EXISTS idx_vrp_consents_user ON vrp_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_iso20022_type ON iso20022_messages(message_type);
CREATE INDEX IF NOT EXISTS idx_smart_contracts_creator ON smart_contracts(creator_id);
CREATE INDEX IF NOT EXISTS idx_goaml_type ON goaml_reports(report_type);
CREATE INDEX IF NOT EXISTS idx_dsar_user ON dsar_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_sanctions_name ON sanctions_list USING gin (to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_fednow_user ON fednow_transfers(user_id);
CREATE INDEX IF NOT EXISTS idx_pii_tokens_hash ON pii_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_behavioral_user ON behavioral_biometrics(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_routing_decisions_user ON smart_routing_decisions(user_id);

-- Extension for similarity matching (sanctions screening)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_sanctions_name_trgm ON sanctions_list USING gin (name gin_trgm_ops);
