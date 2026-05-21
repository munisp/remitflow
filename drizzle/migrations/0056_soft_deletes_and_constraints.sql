-- P1 Database 2.4: Soft delete columns
-- P1 Database 2.5: Additional constraints
-- P0 Database 2.3: Migration versioning

-- Soft deletes on critical financial/user tables
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE "kycDocuments" ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE "auditLogs" ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE "recurringPayments" ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Partial indexes for soft delete (exclude deleted records from normal queries)
CREATE INDEX IF NOT EXISTS idx_users_active ON users (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_active ON transactions (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_beneficiaries_active ON beneficiaries (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wallets_active ON wallets (id) WHERE deleted_at IS NULL;

-- Additional check constraints
ALTER TABLE transactions ADD CONSTRAINT IF NOT EXISTS chk_tx_amount_positive
  CHECK (amount > 0);
ALTER TABLE wallets ADD CONSTRAINT IF NOT EXISTS chk_wallet_balance_nonneg
  CHECK (balance >= 0);
ALTER TABLE "savingsGoals" ADD CONSTRAINT IF NOT EXISTS chk_savings_target_positive
  CHECK ("targetAmount" > 0);
ALTER TABLE rate_locks ADD CONSTRAINT IF NOT EXISTS chk_rate_lock_positive
  CHECK (rate > 0);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_tx_user_created ON transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_user_status ON transactions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_tx_beneficiary ON transactions (beneficiary_id) WHERE beneficiary_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wallets_user_currency ON wallets (user_id, currency);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications (user_id, read) WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_kyc_user_status ON "kycDocuments" (user_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_user_created ON "auditLogs" (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_beneficiaries_user ON beneficiaries (user_id);
CREATE INDEX IF NOT EXISTS idx_cards_user ON cards (user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_user ON "recurringPayments" (user_id);
CREATE INDEX IF NOT EXISTS idx_disputes_user ON disputes (user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_id);

-- Connection pool monitoring table
CREATE TABLE IF NOT EXISTS db_pool_metrics (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  pool_size INT NOT NULL,
  active_connections INT NOT NULL,
  idle_connections INT NOT NULL,
  waiting_clients INT NOT NULL,
  max_connections INT NOT NULL
);

-- Schema version tracking table
CREATE TABLE IF NOT EXISTS schema_versions (
  id SERIAL PRIMARY KEY,
  version VARCHAR(50) NOT NULL,
  description TEXT,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  checksum VARCHAR(64)
);

INSERT INTO schema_versions (version, description)
VALUES ('0056', 'Soft deletes, constraints, composite indexes, pool monitoring')
ON CONFLICT DO NOTHING;
