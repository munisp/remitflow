-- Migration: Add missing columns to ledger_entries + create bill_payments
-- ledger_entries already exists but lacks columns used by doubleEntry.ts
-- bill_payments is new, used by v75Features.ts (bill pay)

-- Make legacy columns nullable so new double-entry format can coexist
ALTER TABLE ledger_entries ALTER COLUMN debit_account_id DROP NOT NULL;
ALTER TABLE ledger_entries ALTER COLUMN credit_account_id DROP NOT NULL;
ALTER TABLE ledger_entries ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE ledger_entries ALTER COLUMN type DROP NOT NULL;

-- Add double-entry bookkeeping columns to existing ledger_entries
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(100);
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS account_id VARCHAR(100);
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS account_type VARCHAR(20);
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS debit DECIMAL(18, 4) DEFAULT 0;
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS credit DECIMAL(18, 4) DEFAULT 0;
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS idx_ledger_entries_transaction_id ON ledger_entries (transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_id ON ledger_entries (account_id);

-- Create bill_payments table for bill pay feature
CREATE TABLE IF NOT EXISTS bill_payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  biller_id VARCHAR(50) NOT NULL,
  biller_name VARCHAR(200) NOT NULL,
  category VARCHAR(50) NOT NULL,
  account_number VARCHAR(30) NOT NULL,
  amount_ngn DECIMAL(18, 2) NOT NULL,
  amount_usd DECIMAL(18, 4) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  provider_ref VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bill_payments_user_id ON bill_payments (user_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_status ON bill_payments (status);
CREATE INDEX IF NOT EXISTS idx_bill_payments_created_at ON bill_payments (created_at);
