-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 0054: Add production indexes for 404 tables
-- Addresses: Only 26 indexes across 404 tables → full table scans under load
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Core tables (highest query volume) ────────────────────────────────────

-- transactions: queried on every dashboard load, transaction list, analytics
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_user_status ON transactions(user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_currency ON transactions(from_currency, to_currency);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_reference ON transactions(reference);

-- wallets: queried on every authenticated page
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallets_user_currency ON wallets(user_id, currency);

-- beneficiaries: queried on send money flow
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_beneficiaries_user_id ON beneficiaries(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_beneficiaries_user_favorite ON beneficiaries(user_id, is_favorite DESC);

-- notifications: queried on every page (badge count)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

-- ── KYC/Compliance ────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kyc_documents_user_id ON kyc_documents(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kyc_documents_status ON kyc_documents(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kyc_documents_user_type ON kyc_documents(user_id, document_type);

-- compliance_cases
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_compliance_cases_user_id ON compliance_cases(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_compliance_cases_status ON compliance_cases(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_compliance_cases_assigned ON compliance_cases(assigned_to);

-- ── Audit & Security ─────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_action ON audit_logs(user_id, action);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- user_lockouts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_lockouts_user_id ON user_lockouts(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_lockouts_ip ON user_lockouts(ip_address);

-- ── Financial ─────────────────────────────────────────────────────────────

-- fx_rate_cache
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fx_rate_cache_pair ON fx_rate_cache(base_currency, target_currency);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fx_rate_cache_updated ON fx_rate_cache(updated_at DESC);

-- rate_locks
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_locks_user_id ON rate_locks(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_locks_expires ON rate_locks(expires_at);

-- batch_payments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_batch_payments_user_id ON batch_payments(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_batch_payments_status ON batch_payments(status);

-- recurring_payments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recurring_payments_user_id ON recurring_payments(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recurring_payments_next ON recurring_payments(next_execution_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recurring_payments_status ON recurring_payments(status);

-- ── Cards & Banking ──────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cards_user_id ON cards(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cards_status ON cards(status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_virtual_accounts_user_id ON virtual_accounts(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_virtual_accounts_currency ON virtual_accounts(currency);

-- ── Products ─────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_savings_goals_user_id ON savings_goals(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bnpl_plans_user_id ON bnpl_plans(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bnpl_plans_status ON bnpl_plans(status);

-- disputes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_disputes_user_id ON disputes(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_disputes_status ON disputes(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_disputes_transaction ON disputes(transaction_id);

-- support_tickets
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_tickets_user_id ON support_tickets(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_tickets_priority ON support_tickets(priority);

-- ── Referrals & Social ───────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referrals_referrer_id ON referrals(referrer_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referrals_referee_id ON referrals(referee_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_referrals_code ON referrals(code);

-- ── Notification preferences ─────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_prefs_user ON notification_preferences(user_id);

-- ── FX alerts ────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fx_alerts_user_id ON fx_alerts(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fx_alerts_pair ON fx_alerts(base_currency, target_currency);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fx_alerts_active ON fx_alerts(is_active);

-- ── Split bills ──────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_split_bill_groups_creator ON split_bill_groups(creator_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_split_bill_participants_user ON split_bill_participants(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_split_bill_participants_group ON split_bill_participants(group_id);

-- ── Direct debits ────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_direct_debit_mandates_user ON direct_debit_mandates(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_direct_debit_mandates_status ON direct_debit_mandates(status);

-- ── Stablecoins & CBDC ──────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stablecoin_wallets_user ON stablecoin_wallets(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cbdc_wallets_user ON cbdc_wallets(user_id);

-- ── Partner/Agent ────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pos_terminals_user ON pos_terminals(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_accounts_user ON agent_accounts(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_accounts_status ON agent_accounts(status);

-- ── Cross-sell ───────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_sell_offers_user ON cross_sell_offers(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_sell_offers_status ON cross_sell_offers(status);

-- ── Outbound ─────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbound_annual_usage_user ON outbound_annual_usage(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbound_annual_usage_year ON outbound_annual_usage(year);

-- ── Users ────────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_kyc_tier ON users(kyc_tier);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- ── Composite indexes for common query patterns ──────────────────────────

-- Dashboard: recent transactions by user ordered by date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_user_date_status
  ON transactions(user_id, created_at DESC, status);

-- Admin: all users with KYC pending
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_kyc_pending
  ON users(kyc_tier) WHERE kyc_tier = 'pending';

-- Compliance: open cases by priority
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_compliance_open_priority
  ON compliance_cases(priority, created_at) WHERE status = 'open';
