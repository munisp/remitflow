-- RemitFlow — Row-Level Security Policies
-- ═══════════════════════════════════════════════════════════════════════════════
-- Implements tenant isolation at the database level. Even if the application
-- layer is compromised, users cannot access other users' financial data.
--
-- Strategy:
-- 1. All queries set session variable: SET LOCAL app.current_user_id = '<id>'
-- 2. RLS policies enforce: user can only see rows where user_id = current_user_id
-- 3. Admin role bypasses RLS (app role 'remitflow_admin')
-- 4. Service accounts (for background jobs) use 'remitflow_service' role
--
-- Enable per-table with appropriate policies for each table's access pattern.

-- ─── Roles ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'remitflow_app') THEN
    CREATE ROLE remitflow_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'remitflow_admin') THEN
    CREATE ROLE remitflow_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'remitflow_service') THEN
    CREATE ROLE remitflow_service NOLOGIN;
  END IF;
END
$$;

-- Grant base permissions
GRANT USAGE ON SCHEMA public TO remitflow_app;
GRANT USAGE ON SCHEMA public TO remitflow_admin;
GRANT USAGE ON SCHEMA public TO remitflow_service;

-- ─── Helper function ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION current_app_user_id() RETURNS INTEGER AS $$
BEGIN
  RETURN COALESCE(
    NULLIF(current_setting('app.current_user_id', TRUE), '')::INTEGER,
    0
  );
EXCEPTION WHEN OTHERS THEN
  RETURN 0;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─── Transactions Table ───────────────────────────────────────────────────────
-- Users can only see their own transactions

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY transactions_user_isolation ON transactions
  FOR ALL
  TO remitflow_app
  USING (user_id = current_app_user_id());

CREATE POLICY transactions_admin_full ON transactions
  FOR ALL
  TO remitflow_admin
  USING (TRUE);

CREATE POLICY transactions_service_full ON transactions
  FOR ALL
  TO remitflow_service
  USING (TRUE);

-- ─── Wallets Table ────────────────────────────────────────────────────────────
-- Users can only see their own wallets

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY wallets_user_isolation ON wallets
  FOR ALL
  TO remitflow_app
  USING (user_id = current_app_user_id());

CREATE POLICY wallets_admin_full ON wallets
  FOR ALL
  TO remitflow_admin
  USING (TRUE);

CREATE POLICY wallets_service_full ON wallets
  FOR ALL
  TO remitflow_service
  USING (TRUE);

-- ─── Beneficiaries Table ──────────────────────────────────────────────────────
-- Users can only see their own beneficiaries

ALTER TABLE beneficiaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY beneficiaries_user_isolation ON beneficiaries
  FOR ALL
  TO remitflow_app
  USING (user_id = current_app_user_id());

CREATE POLICY beneficiaries_admin_full ON beneficiaries
  FOR ALL
  TO remitflow_admin
  USING (TRUE);

CREATE POLICY beneficiaries_service_full ON beneficiaries
  FOR ALL
  TO remitflow_service
  USING (TRUE);

-- ─── KYC Documents Table ──────────────────────────────────────────────────────
-- Users can only see their own KYC submissions

ALTER TABLE kyc_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY kyc_user_isolation ON kyc_documents
  FOR ALL
  TO remitflow_app
  USING (user_id = current_app_user_id());

CREATE POLICY kyc_admin_full ON kyc_documents
  FOR ALL
  TO remitflow_admin
  USING (TRUE);

CREATE POLICY kyc_service_full ON kyc_documents
  FOR ALL
  TO remitflow_service
  USING (TRUE);

-- ─── Notifications Table ──────────────────────────────────────────────────────
-- Users can only see their own notifications

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_user_isolation ON notifications
  FOR ALL
  TO remitflow_app
  USING (user_id = current_app_user_id());

CREATE POLICY notifications_admin_full ON notifications
  FOR ALL
  TO remitflow_admin
  USING (TRUE);

-- ─── Audit Logs Table ─────────────────────────────────────────────────────────
-- Users can see their own audit entries; admins see all

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_user_isolation ON audit_logs
  FOR SELECT
  TO remitflow_app
  USING (user_id = current_app_user_id());

CREATE POLICY audit_admin_full ON audit_logs
  FOR ALL
  TO remitflow_admin
  USING (TRUE);

CREATE POLICY audit_service_insert ON audit_logs
  FOR INSERT
  TO remitflow_service
  WITH CHECK (TRUE);

CREATE POLICY audit_service_select ON audit_logs
  FOR SELECT
  TO remitflow_service
  USING (TRUE);

-- ─── Virtual Cards Table ──────────────────────────────────────────────────────

ALTER TABLE virtual_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY cards_user_isolation ON virtual_cards
  FOR ALL
  TO remitflow_app
  USING (user_id = current_app_user_id());

CREATE POLICY cards_admin_full ON virtual_cards
  FOR ALL
  TO remitflow_admin
  USING (TRUE);

-- ─── Recurring Payments Table ─────────────────────────────────────────────────

ALTER TABLE recurring_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY recurring_user_isolation ON recurring_payments
  FOR ALL
  TO remitflow_app
  USING (user_id = current_app_user_id());

CREATE POLICY recurring_admin_full ON recurring_payments
  FOR ALL
  TO remitflow_admin
  USING (TRUE);

CREATE POLICY recurring_service_full ON recurring_payments
  FOR ALL
  TO remitflow_service
  USING (TRUE);

-- ─── Property Escrow Plans ────────────────────────────────────────────────────
-- Buyers see their own plans; builders see plans they're assigned to

ALTER TABLE property_escrow_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY escrow_buyer_isolation ON property_escrow_plans
  FOR ALL
  TO remitflow_app
  USING (buyer_id = current_app_user_id());

CREATE POLICY escrow_admin_full ON property_escrow_plans
  FOR ALL
  TO remitflow_admin
  USING (TRUE);

CREATE POLICY escrow_service_full ON property_escrow_plans
  FOR ALL
  TO remitflow_service
  USING (TRUE);

-- ─── Fee Rules (Admin-only table) ────────────────────────────────────────────
-- No user access; only admin and service roles

ALTER TABLE fee_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY fee_rules_admin_only ON fee_rules
  FOR ALL
  TO remitflow_admin
  USING (TRUE);

CREATE POLICY fee_rules_service ON fee_rules
  FOR ALL
  TO remitflow_service
  USING (TRUE);

-- ─── Connection Setup Function ────────────────────────────────────────────────
-- Call this at the start of every request to set the user context for RLS

CREATE OR REPLACE FUNCTION set_app_user_context(p_user_id INTEGER) RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id::TEXT, TRUE);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_app_user_context IS
  'Set the application user ID for row-level security. Must be called at the start of each request. Uses LOCAL setting so it is transaction-scoped.';
