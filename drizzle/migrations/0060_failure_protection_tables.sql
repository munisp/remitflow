-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0060: Failure Protection Tables
-- "What If Things Go Wrong?" tables for all money-moving features
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. BNPL Late Fees
CREATE TABLE IF NOT EXISTS bnpl_late_fees (
  id SERIAL PRIMARY KEY,
  installment_id INTEGER NOT NULL,
  plan_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  fee_amount_ngn NUMERIC(18,2) NOT NULL,
  reason VARCHAR(50) DEFAULT 'overdue_penalty',
  paid BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bnpl_late_fees_user ON bnpl_late_fees (user_id);
CREATE INDEX IF NOT EXISTS idx_bnpl_late_fees_plan ON bnpl_late_fees (plan_id);

-- 2. BNPL Collections
CREATE TABLE IF NOT EXISTS bnpl_collections (
  id SERIAL PRIMARY KEY,
  installment_id INTEGER NOT NULL,
  plan_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  escalation_level VARCHAR(20) DEFAULT 'internal',
  assigned_to INTEGER,
  notes TEXT,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bnpl_collections_user ON bnpl_collections (user_id);
CREATE INDEX IF NOT EXISTS idx_bnpl_collections_status ON bnpl_collections (status);

-- 3. BNPL Merchant Disputes
CREATE TABLE IF NOT EXISTS bnpl_merchant_disputes (
  id SERIAL PRIMARY KEY,
  dispute_id VARCHAR(50) UNIQUE NOT NULL,
  plan_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  dispute_type VARCHAR(30) NOT NULL,
  description TEXT NOT NULL,
  evidence_urls JSONB DEFAULT '[]',
  status VARCHAR(20) DEFAULT 'open',
  resolution VARCHAR(30),
  admin_notes TEXT,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bnpl_merchant_disputes_user ON bnpl_merchant_disputes (user_id);
CREATE INDEX IF NOT EXISTS idx_bnpl_merchant_disputes_status ON bnpl_merchant_disputes (status);

-- 4. Agent Float Discrepancies
CREATE TABLE IF NOT EXISTS agent_float_discrepancies (
  id SERIAL PRIMARY KEY,
  agent_id INTEGER NOT NULL,
  discrepancy_amount NUMERIC(18,2),
  detected_at TIMESTAMP DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'flagged',
  resolution TEXT,
  resolved_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_discrepancies_agent ON agent_float_discrepancies (agent_id);

-- 5. Agent Customer Disputes
CREATE TABLE IF NOT EXISTS agent_customer_disputes (
  id SERIAL PRIMARY KEY,
  dispute_id VARCHAR(50) UNIQUE NOT NULL,
  transaction_ref VARCHAR(100) NOT NULL,
  customer_id INTEGER NOT NULL,
  dispute_type VARCHAR(30) NOT NULL,
  expected_amount NUMERIC(18,2),
  received_amount NUMERIC(18,2),
  description TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'open',
  resolution VARCHAR(30),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_disputes_customer ON agent_customer_disputes (customer_id);
CREATE INDEX IF NOT EXISTS idx_agent_disputes_status ON agent_customer_disputes (status);

-- 6. Transfer Escalations
CREATE TABLE IF NOT EXISTS transfer_escalations (
  id SERIAL PRIMARY KEY,
  escalation_id VARCHAR(50) UNIQUE NOT NULL,
  transaction_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  reason VARCHAR(30) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'open',
  sla_deadline TIMESTAMP,
  resolved_at TIMESTAMP,
  resolution TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transfer_escalations_user ON transfer_escalations (user_id);
CREATE INDEX IF NOT EXISTS idx_transfer_escalations_status ON transfer_escalations (status);
CREATE INDEX IF NOT EXISTS idx_transfer_escalations_sla ON transfer_escalations (sla_deadline);

-- 7. Payroll Disputes
CREATE TABLE IF NOT EXISTS payroll_disputes (
  id SERIAL PRIMARY KEY,
  dispute_id VARCHAR(50) UNIQUE NOT NULL,
  run_item_id INTEGER NOT NULL,
  employee_user_id INTEGER NOT NULL,
  dispute_type VARCHAR(30) NOT NULL,
  expected_amount NUMERIC(18,2),
  received_amount NUMERIC(18,2),
  description TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'open',
  resolution VARCHAR(30),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_disputes_employee ON payroll_disputes (employee_user_id);

-- 8. Developer Defaults (Real Estate)
CREATE TABLE IF NOT EXISTS developer_defaults (
  id SERIAL PRIMARY KEY,
  default_id VARCHAR(50) UNIQUE NOT NULL,
  listing_id INTEGER NOT NULL,
  default_type VARCHAR(30) NOT NULL,
  description TEXT NOT NULL,
  affected_investor_count INTEGER DEFAULT 0,
  total_at_risk_usd NUMERIC(18,2) DEFAULT 0,
  refund_percentage NUMERIC(5,2),
  status VARCHAR(20) DEFAULT 'investigation',
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dev_defaults_listing ON developer_defaults (listing_id);

-- 9. Bond Default Events
CREATE TABLE IF NOT EXISTS bond_default_events (
  id SERIAL PRIMARY KEY,
  incident_id VARCHAR(50) UNIQUE NOT NULL,
  bond_id INTEGER NOT NULL,
  event_type VARCHAR(30) NOT NULL,
  coupon_period VARCHAR(30),
  affected_holders INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'open',
  recovery_amount_usd NUMERIC(18,2),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bond_defaults_bond ON bond_default_events (bond_id);

-- 10. Mortgage Hardship Requests
CREATE TABLE IF NOT EXISTS mortgage_hardship_requests (
  id SERIAL PRIMARY KEY,
  request_id VARCHAR(50) UNIQUE NOT NULL,
  application_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  hardship_type VARCHAR(30) NOT NULL,
  description TEXT NOT NULL,
  proposed_arrangement VARCHAR(30),
  duration_months INTEGER DEFAULT 3,
  status VARCHAR(20) DEFAULT 'pending',
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hardship_user ON mortgage_hardship_requests (user_id);

-- 11. Card Chargebacks
CREATE TABLE IF NOT EXISTS card_chargebacks (
  id SERIAL PRIMARY KEY,
  chargeback_id VARCHAR(50) UNIQUE NOT NULL,
  card_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  transaction_ref VARCHAR(100) NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'USD',
  merchant_name VARCHAR(200),
  reason VARCHAR(30) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'open',
  resolution VARCHAR(30),
  admin_notes TEXT,
  provisional_credit_applied BOOLEAN DEFAULT false,
  provisional_credit_at TIMESTAMP,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chargebacks_user ON card_chargebacks (user_id);
CREATE INDEX IF NOT EXISTS idx_chargebacks_card ON card_chargebacks (card_id);
CREATE INDEX IF NOT EXISTS idx_chargebacks_status ON card_chargebacks (status);

-- Add columns needed by existing tables
ALTER TABLE agent_accounts ADD COLUMN IF NOT EXISTS freeze_reason VARCHAR(50);
ALTER TABLE agent_accounts ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMP DEFAULT NOW();
ALTER TABLE agent_accounts ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(18,2) DEFAULT 0;

ALTER TABLE virtual_cards ADD COLUMN IF NOT EXISTS freeze_reason VARCHAR(50);

ALTER TABLE split_bill_participants ADD COLUMN IF NOT EXISTS payment_deadline TIMESTAMP;

ALTER TABLE payroll_run_items ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE payroll_run_items ADD COLUMN IF NOT EXISTS failure_reason TEXT;
