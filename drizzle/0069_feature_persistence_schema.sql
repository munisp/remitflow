-- Migrated from server/_core/featurePersistence.ts.
-- Apply only through the recorded migration lifecycle.

-- ledger_entries is provisioned by 0063_core_runtime_schema.sql with the
-- TigerBeetle reconciliation fields and financial precision required at runtime.

CREATE TABLE IF NOT EXISTS feature_merchant_accounts (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  business_name VARCHAR(200) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  total_volume NUMERIC(18,2) DEFAULT 0,
  total_payments INTEGER DEFAULT 0,
  fee_percent NUMERIC(5,2) DEFAULT 1.0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_payment_intents (
  id VARCHAR(64) PRIMARY KEY,
  merchant_id VARCHAR(64) NOT NULL REFERENCES feature_merchant_accounts(id),
  amount NUMERIC(18,2) NOT NULL,
  currency VARCHAR(8) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  tx_hash VARCHAR(128),
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feature_invoices (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  currency VARCHAR(8) NOT NULL,
  stablecoin VARCHAR(8) NOT NULL,
  status VARCHAR(20) DEFAULT 'sent',
  payment_link TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feature_subscriptions (
  id VARCHAR(64) PRIMARY KEY,
  merchant_id VARCHAR(64) NOT NULL,
  subscriber_user_id INTEGER NOT NULL,
  plan_name VARCHAR(200),
  amount NUMERIC(18,2) NOT NULL,
  stablecoin VARCHAR(8) NOT NULL,
  interval VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  next_billing_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_swap_executions (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  from_coin VARCHAR(8) NOT NULL,
  to_coin VARCHAR(8) NOT NULL,
  from_chain VARCHAR(20),
  to_chain VARCHAR(20),
  input_amount NUMERIC(18,6) NOT NULL,
  output_amount NUMERIC(18,6) NOT NULL,
  fee NUMERIC(18,6),
  status VARCHAR(20) DEFAULT 'completed',
  tx_hash VARCHAR(128),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_lending_positions (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type VARCHAR(10) NOT NULL,
  coin VARCHAR(8) NOT NULL,
  amount NUMERIC(18,6) NOT NULL,
  rate NUMERIC(8,4),
  health_factor NUMERIC(8,4),
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_savings_deposits (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  amount NUMERIC(18,6) NOT NULL,
  stablecoin VARCHAR(8) NOT NULL,
  term_days INTEGER NOT NULL,
  apy NUMERIC(8,4) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  maturity_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_corridor_transfers (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  corridor_id VARCHAR(10) NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  source_currency VARCHAR(8) NOT NULL,
  dest_currency VARCHAR(8) NOT NULL,
  fx_rate NUMERIC(18,6) NOT NULL,
  fee NUMERIC(18,2) NOT NULL,
  dest_amount NUMERIC(18,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'completed',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_smart_wallets (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  chain VARCHAR(20) NOT NULL,
  address VARCHAR(128),
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_batch_payouts (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name VARCHAR(200),
  stablecoin VARCHAR(8) NOT NULL,
  total_amount NUMERIC(18,6) NOT NULL,
  total_fee NUMERIC(18,6) NOT NULL,
  recipient_count INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feature_programmable_payments (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type VARCHAR(20) NOT NULL,
  amount NUMERIC(18,6) NOT NULL,
  stablecoin VARCHAR(8) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  schedule_type VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_payroll_runs (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name VARCHAR(200),
  stablecoin VARCHAR(8) NOT NULL,
  total_amount NUMERIC(18,6) DEFAULT 0,
  recipient_count INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'draft',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  executed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feature_limit_orders (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  from_currency VARCHAR(8) NOT NULL,
  to_currency VARCHAR(8) NOT NULL,
  target_rate NUMERIC(18,6) NOT NULL,
  amount NUMERIC(18,6) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  filled_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feature_api_keys (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name VARCHAR(200) NOT NULL,
  key_hash VARCHAR(128),
  scopes JSONB DEFAULT '[]',
  status VARCHAR(20) DEFAULT 'active',
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_proposals (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  category VARCHAR(50),
  status VARCHAR(20) DEFAULT 'active',
  options JSONB DEFAULT '[]',
  votes JSONB DEFAULT '[]',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  ends_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feature_referrals (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  referral_code VARCHAR(20) NOT NULL,
  referred_user_id INTEGER,
  bonus_amount NUMERIC(18,6) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_qr_codes (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type VARCHAR(20) NOT NULL,
  payload TEXT NOT NULL,
  amount NUMERIC(18,6),
  currency VARCHAR(8) DEFAULT 'NGN',
  merchant_id VARCHAR(64),
  merchant_name VARCHAR(200),
  description VARCHAR(500),
  expires_at TIMESTAMP,
  max_scans INTEGER,
  scan_count INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_qr_scans (
  id VARCHAR(64) PRIMARY KEY,
  qr_id VARCHAR(64) NOT NULL,
  scanner_id VARCHAR(64) NOT NULL,
  scanner_ip VARCHAR(64),
  scanner_device VARCHAR(200),
  result_action VARCHAR(30) NOT NULL,
  payment_id VARCHAR(64),
  scanned_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_nfc_terminals (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  merchant_id VARCHAR(64),
  terminal_name VARCHAR(200),
  terminal_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  supported_protocols JSONB DEFAULT '[]',
  max_transaction_amount NUMERIC(18,6) DEFAULT 0,
  currency VARCHAR(8) DEFAULT 'NGN',
  firmware_version VARCHAR(20),
  last_heartbeat TIMESTAMP,
  heartbeat_count INTEGER DEFAULT 0,
  location JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_nfc_transactions (
  id VARCHAR(64) PRIMARY KEY,
  terminal_id VARCHAR(64),
  payer_id VARCHAR(64) NOT NULL,
  payee_id VARCHAR(64) NOT NULL,
  amount NUMERIC(18,6) NOT NULL,
  currency VARCHAR(8) DEFAULT 'NGN',
  method VARCHAR(20) NOT NULL,
  card_type VARCHAR(30),
  card_last_four VARCHAR(4),
  nonce VARCHAR(128) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  auth_code VARCHAR(12),
  offline_queued BOOLEAN DEFAULT false,
  settlement_id VARCHAR(64),
  created_at TIMESTAMP DEFAULT NOW(),
  settled_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feature_nfc_tags (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  tag_type VARCHAR(30),
  ndef_payload TEXT,
  linked_account_id VARCHAR(64),
  max_amount NUMERIC(18,6) DEFAULT 0,
  currency VARCHAR(8) DEFAULT 'NGN',
  daily_limit NUMERIC(18,6) DEFAULT 0,
  daily_used NUMERIC(18,6) DEFAULT 0,
  daily_reset_at TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_merchant_qr_profiles (
  id VARCHAR(64) PRIMARY KEY,
  user_id INTEGER NOT NULL,
  merchant_id VARCHAR(64),
  business_name VARCHAR(200),
  business_category VARCHAR(50),
  default_currency VARCHAR(8) DEFAULT 'NGN',
  accepted_coins JSONB DEFAULT '[]',
  till_number VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Mark Lane Integration Tables
CREATE TABLE IF NOT EXISTS feature_marklane_quotes (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  corridor_id VARCHAR(10),
  from_currency VARCHAR(8),
  to_currency VARCHAR(8),
  amount NUMERIC(18,4),
  rate NUMERIC(18,8),
  converted_amount NUMERIC(18,4),
  fee NUMERIC(12,4),
  expires_at TIMESTAMP,
  quote_type VARCHAR(10) DEFAULT 'spot',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_marklane_transfers (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  marklane_transfer_id VARCHAR(64),
  corridor VARCHAR(10),
  from_currency VARCHAR(8),
  to_currency VARCHAR(8),
  send_amount NUMERIC(18,4),
  receive_amount NUMERIC(18,4),
  fx_rate NUMERIC(18,8),
  fee NUMERIC(12,4),
  status VARCHAR(20) DEFAULT 'pending',
  reference VARCHAR(100),
  recipient_name VARCHAR(100),
  recipient_account VARCHAR(34),
  recipient_bank VARCHAR(50),
  data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feature_marklane_kyc_passports (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  source_regulator VARCHAR(20),
  target_regulator VARCHAR(20),
  kyc_tier INTEGER,
  verification_status VARCHAR(20) DEFAULT 'pending',
  documents JSONB DEFAULT '[]',
  aml_screening JSONB DEFAULT '{}',
  valid_until TIMESTAMP,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_marklane_fx_professionals (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  name VARCHAR(100),
  email VARCHAR(200),
  marklane_partner_id VARCHAR(64),
  status VARCHAR(20) DEFAULT 'pending',
  corridors JSONB DEFAULT '[]',
  commission_rate NUMERIC(6,4) DEFAULT 0.15,
  total_volume NUMERIC(18,4) DEFAULT 0,
  total_commissions NUMERIC(18,4) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_marklane_prefunding (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  currency VARCHAR(8),
  amount NUMERIC(18,4),
  status VARCHAR(20) DEFAULT 'pending',
  instructions JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_quote_user ON feature_marklane_quotes(user_id);
CREATE INDEX IF NOT EXISTS idx_ml_transfer_user ON feature_marklane_transfers(user_id);
CREATE INDEX IF NOT EXISTS idx_ml_transfer_status ON feature_marklane_transfers(status);
CREATE INDEX IF NOT EXISTS idx_ml_kyc_user ON feature_marklane_kyc_passports(user_id);
CREATE INDEX IF NOT EXISTS idx_ml_fx_prof_user ON feature_marklane_fx_professionals(user_id);

CREATE INDEX IF NOT EXISTS idx_ledger_reference ON ledger_entries(reference);
CREATE INDEX IF NOT EXISTS idx_merchant_user ON feature_merchant_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_invoice_user ON feature_invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_swap_user ON feature_swap_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_lending_user ON feature_lending_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_savings_user ON feature_savings_deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_corridor_user ON feature_corridor_transfers(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_user ON feature_smart_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_batch_user ON feature_batch_payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_user ON feature_programmable_payments(user_id);

CREATE TABLE IF NOT EXISTS compliance_filings (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "transferRef" VARCHAR(128) NOT NULL,
  "filingType" VARCHAR(32) NOT NULL,
  jurisdiction VARCHAR(8) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending_review',
  "filingId" VARCHAR(128),
  "amountUsd" NUMERIC(18,2),
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "resolvedAt" TIMESTAMP,
  UNIQUE("transferRef", "filingType", jurisdiction)
);
CREATE INDEX IF NOT EXISTS idx_compliance_filings_user ON compliance_filings("userId");
CREATE INDEX IF NOT EXISTS idx_compliance_filings_ref ON compliance_filings("transferRef");
