-- Full-Text Search indexes for key searchable tables
-- Uses PostgreSQL GIN indexes with tsvector for fast text search

-- Beneficiary search (name, bank, account)
CREATE INDEX IF NOT EXISTS idx_beneficiaries_fts
  ON beneficiaries USING GIN (
    to_tsvector('english', COALESCE(name, '') || ' ' || COALESCE(bank_name, '') || ' ' || COALESCE(account_number, ''))
  );

-- Transaction search (reference, description, status)
CREATE INDEX IF NOT EXISTS idx_transactions_fts
  ON transactions USING GIN (
    to_tsvector('english', COALESCE(reference, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(status, ''))
  );

-- User search (name, email)
CREATE INDEX IF NOT EXISTS idx_users_fts
  ON users USING GIN (
    to_tsvector('english', COALESCE(name, '') || ' ' || COALESCE(email, ''))
  );

-- KYC document search
CREATE INDEX IF NOT EXISTS idx_kyc_documents_fts
  ON kyc_documents USING GIN (
    to_tsvector('english', COALESCE(document_type, '') || ' ' || COALESCE(status, ''))
  );

-- Audit log search
CREATE INDEX IF NOT EXISTS idx_audit_log_fts
  ON audit_log USING GIN (
    to_tsvector('english', COALESCE(action, '') || ' ' || COALESCE(description, ''))
  );

-- Notification search
CREATE INDEX IF NOT EXISTS idx_notifications_fts
  ON notifications USING GIN (
    to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(message, ''))
  );

-- ─── Row-Level Security (RLS) ────────────────────────────────────────────────
-- Enable RLS on sensitive tables. Policies use current_setting('app.current_user_id')
-- which must be set by the application before each query.

-- Users table: users can only see their own record
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self_access ON users
  FOR ALL
  USING (id = current_setting('app.current_user_id', true)::int)
  WITH CHECK (id = current_setting('app.current_user_id', true)::int);

CREATE POLICY users_admin_access ON users
  FOR ALL
  USING (current_setting('app.current_user_role', true) = 'admin');

-- Transactions: users can only see their own transactions
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY transactions_owner_access ON transactions
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true)::int)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::int);

CREATE POLICY transactions_admin_access ON transactions
  FOR ALL
  USING (current_setting('app.current_user_role', true) = 'admin');

-- Wallets: users can only see their own wallets
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY wallets_owner_access ON wallets
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true)::int)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::int);

CREATE POLICY wallets_admin_access ON wallets
  FOR ALL
  USING (current_setting('app.current_user_role', true) = 'admin');

-- Beneficiaries: users can only see their own beneficiaries
ALTER TABLE beneficiaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY beneficiaries_owner_access ON beneficiaries
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true)::int)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::int);

CREATE POLICY beneficiaries_admin_access ON beneficiaries
  FOR ALL
  USING (current_setting('app.current_user_role', true) = 'admin');

-- KYC documents: users can only see their own documents
ALTER TABLE kyc_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY kyc_owner_access ON kyc_documents
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true)::int)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::int);

CREATE POLICY kyc_admin_access ON kyc_documents
  FOR ALL
  USING (current_setting('app.current_user_role', true) = 'admin');

-- Notifications: users can only see their own notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_owner_access ON notifications
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true)::int)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::int);

CREATE POLICY notifications_admin_access ON notifications
  FOR ALL
  USING (current_setting('app.current_user_role', true) = 'admin');

-- ─── Check Constraints ──────────────────────────────────────────────────────

-- Ensure positive transaction amounts
ALTER TABLE transactions ADD CONSTRAINT chk_positive_amount
  CHECK (amount > 0);

-- Ensure valid transaction status
ALTER TABLE transactions ADD CONSTRAINT chk_valid_status
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed', 'refunded'));

-- Ensure valid KYC tier
ALTER TABLE users ADD CONSTRAINT chk_valid_kyc_tier
  CHECK (kyc_tier IS NULL OR kyc_tier IN ('tier0', 'tier1', 'tier2', 'tier3'));

-- Ensure valid user role
ALTER TABLE users ADD CONSTRAINT chk_valid_role
  CHECK (role IN ('user', 'admin', 'agent', 'compliance'));

-- Ensure valid currency codes (3 uppercase letters)
ALTER TABLE wallets ADD CONSTRAINT chk_valid_currency
  CHECK (currency ~ '^[A-Z]{3}$');
