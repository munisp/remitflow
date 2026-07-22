-- Contract-backed schemas generated from exact SQL literals by .audit/generate_remaining_schema_contract_migration.py.
-- Types are conservative PostgreSQL types selected from column semantics; review report records every inferred field and source query count.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS agent_customer_disputes (
  created_at TIMESTAMPTZ,
  customer_id TEXT,
  description TEXT,
  dispute_id TEXT,
  dispute_type TEXT,
  expected_amount NUMERIC(24, 8),
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  received_amount NUMERIC(24, 8),
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  status TEXT,
  transaction_ref TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_customer_disputes_dispute_id ON agent_customer_disputes (dispute_id);

CREATE TABLE IF NOT EXISTS agent_float_discrepancies (
  agent_id TEXT,
  detected_at TIMESTAMPTZ,
  discrepancy_amount NUMERIC(24, 8),
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS airtime_purchases (
  amount_ngn NUMERIC(24, 8),
  amount_usd NUMERIC(24, 8),
  data_plan JSONB,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  network TEXT,
  phone_number TEXT,
  provider_ref TEXT,
  purchase_type TEXT,
  status TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_airtime_purchases_user_id ON airtime_purchases (user_id);

CREATE TABLE IF NOT EXISTS aml_checks (
  amount NUMERIC(24, 8),
  created_at TIMESTAMPTZ,
  currency TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  receiver_id TEXT,
  sender_id TEXT,
  status TEXT,
  transaction_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_events (
  created_at TIMESTAMPTZ,
  event_name TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  properties JSONB,
  user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auto_convert_executions (
  error TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source_amount NUMERIC(24, 8),
  source_currency TEXT,
  status TEXT,
  target_stablecoin TEXT,
  transaction_id TEXT,
  usd_amount NUMERIC(24, 8),
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auto_convert_preferences (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  is_enabled BOOLEAN,
  target_stablecoin TEXT,
  threshold_amount NUMERIC(24, 8),
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auto_convert_preferences_is_enabled ON auto_convert_preferences (is_enabled);
CREATE INDEX IF NOT EXISTS idx_auto_convert_preferences_user_id ON auto_convert_preferences (user_id);

CREATE TABLE IF NOT EXISTS behavioral_biometrics (
  device_motion JSONB,
  fingerprint_hash TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  risk_score NUMERIC(24, 8),
  sample_id TEXT,
  touch_pressure JSONB,
  typing_pattern JSONB,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS beneficiary_group_members (
  added_at TIMESTAMPTZ,
  beneficiary_id TEXT,
  group_id TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS beneficiary_groups (
  color TEXT,
  created_at TIMESTAMPTZ,
  description TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT,
  user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_beneficiary_groups_color ON beneficiary_groups (color);
CREATE INDEX IF NOT EXISTS idx_beneficiary_groups_created_at ON beneficiary_groups (created_at);
CREATE INDEX IF NOT EXISTS idx_beneficiary_groups_description ON beneficiary_groups (description);
CREATE INDEX IF NOT EXISTS idx_beneficiary_groups_name ON beneficiary_groups (name);
CREATE INDEX IF NOT EXISTS idx_beneficiary_groups_user_id ON beneficiary_groups (user_id);

CREATE TABLE IF NOT EXISTS bill_payments (
  account_number TEXT,
  amount_ngn NUMERIC(24, 8),
  amount_usd NUMERIC(24, 8),
  biller_id TEXT,
  biller_name TEXT,
  category TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider_ref TEXT,
  status TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bill_payments_user_id ON bill_payments (user_id);

CREATE TABLE IF NOT EXISTS biller_accounts (
  account_name TEXT,
  account_number TEXT,
  biller_id TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_biller_accounts_account_number ON biller_accounts (account_number);
CREATE INDEX IF NOT EXISTS idx_biller_accounts_biller_id ON biller_accounts (biller_id);

CREATE TABLE IF NOT EXISTS billers (
  category TEXT,
  code TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billers_code ON billers (code);

CREATE TABLE IF NOT EXISTS biometric_enrollments (
  biometric_type TEXT,
  device_id TEXT,
  device_name TEXT,
  enrolled_at TIMESTAMPTZ,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  is_active BOOLEAN,
  public_key TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_biometric_enrollments_device_id ON biometric_enrollments (device_id);
CREATE INDEX IF NOT EXISTS idx_biometric_enrollments_user_id ON biometric_enrollments (user_id);

CREATE TABLE IF NOT EXISTS bnpl_collections (
  created_at TIMESTAMPTZ,
  escalation_level TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  installment_id TEXT,
  plan_id TEXT,
  status TEXT,
  user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bnpl_collections_installment_id ON bnpl_collections (installment_id);

CREATE TABLE IF NOT EXISTS bnpl_late_fees (
  created_at TIMESTAMPTZ,
  fee_amount_ngn NUMERIC(24, 8),
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  installment_id TEXT,
  plan_id TEXT,
  reason TEXT,
  user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bnpl_merchant_disputes (
  admin_notes TEXT,
  created_at TIMESTAMPTZ,
  description TEXT,
  dispute_id TEXT,
  dispute_type TEXT,
  evidence_urls TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  plan_id TEXT,
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  status TEXT,
  user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bnpl_merchant_disputes_dispute_id ON bnpl_merchant_disputes (dispute_id);

CREATE TABLE IF NOT EXISTS bond_default_events (
  affected_holders TEXT,
  bond_id TEXT,
  coupon_period TEXT,
  created_at TIMESTAMPTZ,
  event_type TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  incident_id TEXT,
  status TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chargebacks (
  amount NUMERIC(24, 8),
  created_at TIMESTAMPTZ,
  currency TEXT,
  description TEXT,
  evidence_url TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  merchant_response JSONB,
  reason TEXT,
  resolution TEXT,
  status TEXT,
  transaction_ref TEXT,
  updated_at TIMESTAMPTZ,
  user_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_chargebacks_created_at ON chargebacks (created_at);
CREATE INDEX IF NOT EXISTS idx_chargebacks_user_id ON chargebacks (user_id);

CREATE TABLE IF NOT EXISTS checkout_sessions (
  amount NUMERIC(24, 8),
  cancel_url TEXT,
  currency TEXT,
  customer_email TEXT,
  description TEXT,
  expires_at TIMESTAMPTZ,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  merchant_id TEXT,
  metadata JSONB,
  session_id TEXT,
  status TEXT,
  success_url TEXT,
  token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_exports (
  export_type TEXT,
  format TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  requested_at TIMESTAMPTZ,
  status TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_data_exports_user_id ON data_exports (user_id);

CREATE TABLE IF NOT EXISTS dca_executions (
  created_at TIMESTAMPTZ,
  from_amount NUMERIC(24, 8),
  from_currency TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rate NUMERIC(24, 8),
  schedule_id TEXT,
  status TEXT,
  to_amount NUMERIC(24, 8),
  to_asset TEXT,
  user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dca_schedules (
  execution_count NUMERIC(24, 8),
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  last_executed_at TIMESTAMPTZ,
  last_skip_reason TEXT,
  next_execution_at TIMESTAMPTZ,
  status TEXT,
  updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dca_schedules_next_execution_at ON dca_schedules (next_execution_at);
CREATE INDEX IF NOT EXISTS idx_dca_schedules_status ON dca_schedules (status);

CREATE TABLE IF NOT EXISTS developer_defaults (
  affected_investor_count NUMERIC(24, 8),
  created_at TIMESTAMPTZ,
  default_id TEXT,
  default_type TEXT,
  description TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  listing_id TEXT,
  refund_percentage NUMERIC(24, 8),
  status TEXT,
  total_at_risk_usd NUMERIC(24, 8),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_developer_defaults_default_id ON developer_defaults (default_id);
CREATE INDEX IF NOT EXISTS idx_developer_defaults_listing_id ON developer_defaults (listing_id);
CREATE INDEX IF NOT EXISTS idx_developer_defaults_status ON developer_defaults (status);

CREATE TABLE IF NOT EXISTS dlq_permanent_failures (
  error TEXT,
  escalated_at TIMESTAMPTZ,
  first_failed_at TIMESTAMPTZ,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  message_payload JSONB,
  original_topic TEXT,
  retry_count NUMERIC(24, 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dlq_resolutions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  message_payload JSONB,
  original_topic TEXT,
  resolved_at TIMESTAMPTZ,
  retry_count NUMERIC(24, 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dsar_requests (
  details JSONB,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  request_id TEXT,
  request_type TEXT,
  response_data JSONB,
  response_due_at JSONB,
  status TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fednow_transfers (
  amount NUMERIC(24, 8),
  creditor_account_number TEXT,
  creditor_name TEXT,
  creditor_routing_number TEXT,
  currency TEXT,
  end_to_end_id TEXT,
  gateway_response JSONB,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  message_payload JSONB,
  status TEXT,
  transaction_id TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fednow_transfers_transaction_id ON fednow_transfers (transaction_id);
CREATE INDEX IF NOT EXISTS idx_fednow_transfers_user_id ON fednow_transfers (user_id);

CREATE TABLE IF NOT EXISTS float_income_records (
  balance NUMERIC(24, 8),
  created_at TIMESTAMPTZ,
  currency TEXT,
  date TIMESTAMPTZ,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rate NUMERIC(24, 8),
  yield_amount NUMERIC(24, 8),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_float_income_records_currency ON float_income_records (currency);
CREATE INDEX IF NOT EXISTS idx_float_income_records_date ON float_income_records (date);

CREATE TABLE IF NOT EXISTS fx_forward_contracts (
  amount NUMERIC(24, 8),
  from_currency TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  locked_rate NUMERIC(24, 8),
  settlement_date TIMESTAMPTZ,
  status TEXT,
  to_currency TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fx_forward_contracts_user_id ON fx_forward_contracts (user_id);

CREATE TABLE IF NOT EXISTS gdpr_requests (
  created_at TIMESTAMPTZ,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reason TEXT,
  request_type TEXT,
  status TEXT,
  user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gdpr_requests_status ON gdpr_requests (status);
CREATE INDEX IF NOT EXISTS idx_gdpr_requests_user_id ON gdpr_requests (user_id);

CREATE TABLE IF NOT EXISTS goaml_reports (
  created_by TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  narrative TEXT,
  report_id TEXT,
  report_type TEXT,
  status TEXT,
  transaction_ids TEXT,
  xml_content JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hsm_keys (
  created_at TIMESTAMPTZ,
  created_by TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key_id TEXT,
  key_type TEXT,
  public_key TEXT,
  purpose TEXT,
  status TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS investment_distributions (
  asset_type TEXT,
  distribution_type TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  paid_at TIMESTAMPTZ,
  status TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_investment_distributions_asset_type ON investment_distributions (asset_type);
CREATE INDEX IF NOT EXISTS idx_investment_distributions_status ON investment_distributions (status);
CREATE INDEX IF NOT EXISTS idx_investment_distributions_user_id ON investment_distributions (user_id);

CREATE TABLE IF NOT EXISTS iso20022_messages (
  direction TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  message_id TEXT,
  message_type TEXT,
  original_message_id TEXT,
  payment_count NUMERIC(24, 8),
  status TEXT,
  total_amount NUMERIC(24, 8),
  xml_content JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kyc_submissions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rejection_reason TEXT,
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  status TEXT,
  "updatedAt" TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mortgage_hardship_requests (
  application_id TEXT,
  created_at TIMESTAMPTZ,
  description TEXT,
  duration_months NUMERIC(24, 8),
  hardship_type TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  proposed_arrangement TEXT,
  request_id TEXT,
  resolved_at TIMESTAMPTZ,
  status TEXT,
  user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mortgage_hardship_requests_request_id ON mortgage_hardship_requests (request_id);

CREATE TABLE IF NOT EXISTS notification_log (
  channel TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  status TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notification_log_channel ON notification_log (channel);
CREATE INDEX IF NOT EXISTS idx_notification_log_status ON notification_log (status);
CREATE INDEX IF NOT EXISTS idx_notification_log_user_id ON notification_log (user_id);

CREATE TABLE IF NOT EXISTS offline_queue (
  created_at TIMESTAMPTZ,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  operation_type TEXT,
  payload JSONB,
  retry_count NUMERIC(24, 8),
  status TEXT,
  user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_offline_queue_user_id ON offline_queue (user_id);

CREATE TABLE IF NOT EXISTS open_banking_accounts (
  consent_id TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  status TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_open_banking_accounts_consent_id ON open_banking_accounts (consent_id);
CREATE INDEX IF NOT EXISTS idx_open_banking_accounts_status ON open_banking_accounts (status);
CREATE INDEX IF NOT EXISTS idx_open_banking_accounts_user_id ON open_banking_accounts (user_id);

CREATE TABLE IF NOT EXISTS payment_dlq (
  attempts TEXT,
  created_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  last_retry_at TIMESTAMPTZ,
  payload JSONB,
  payment_id TEXT,
  rail TEXT,
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_dlq_attempts ON payment_dlq (attempts);
CREATE INDEX IF NOT EXISTS idx_payment_dlq_resolved_at ON payment_dlq (resolved_at);

CREATE TABLE IF NOT EXISTS payment_state_transitions (
  created_at TIMESTAMPTZ,
  from_state TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  metadata JSONB,
  payment_id TEXT,
  reason TEXT,
  to_state TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_disputes (
  created_at TIMESTAMPTZ,
  description TEXT,
  dispute_id TEXT,
  dispute_type TEXT,
  employee_user_id TEXT,
  expected_amount NUMERIC(24, 8),
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  received_amount NUMERIC(24, 8),
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  run_item_id TEXT,
  status TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_disputes_dispute_id ON payroll_disputes (dispute_id);

CREATE TABLE IF NOT EXISTS pii_tokens (
  auth_tag TEXT,
  created_by TEXT,
  encrypted_value TEXT,
  field_type TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  iv TEXT,
  token TEXT,
  token_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pii_tokens_token ON pii_tokens (token);

CREATE TABLE IF NOT EXISTS pos_transactions (
  agent_id TEXT,
  cash_ TEXT,
  created_at TIMESTAMPTZ,
  float_balance NUMERIC(24, 8),
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reference TEXT,
  type TEXT,
  user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pos_transactions_agent_id ON pos_transactions (agent_id);
CREATE INDEX IF NOT EXISTS idx_pos_transactions_cash_ ON pos_transactions (cash_);
CREATE INDEX IF NOT EXISTS idx_pos_transactions_created_at ON pos_transactions (created_at);
CREATE INDEX IF NOT EXISTS idx_pos_transactions_reference ON pos_transactions (reference);
CREATE INDEX IF NOT EXISTS idx_pos_transactions_type ON pos_transactions (type);

CREATE TABLE IF NOT EXISTS property_kyc (
  document_type TEXT,
  document_url TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ownership_type TEXT,
  property_address TEXT,
  property_value TEXT,
  status TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_property_kyc_user_id ON property_kyc (user_id);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  referred_id TEXT,
  referrer_id TEXT,
  reward_amount_usd NUMERIC(24, 8),
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_referred_id ON referral_rewards (referred_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer_id ON referral_rewards (referrer_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_reward_amount_usd ON referral_rewards (reward_amount_usd);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_status ON referral_rewards (status);

CREATE TABLE IF NOT EXISTS risk_scores (
  action TEXT,
  context JSONB,
  evaluated_at TIMESTAMPTZ,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  score NUMERIC(24, 8),
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sanctions_list (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  expires_at TIMESTAMPTZ,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS settlement_netting_results (
  created_at TIMESTAMPTZ,
  currency TEXT,
  direction TEXT,
  gross_volume NUMERIC(24, 8),
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  net_volume NUMERIC(24, 8),
  party_a TEXT,
  party_b TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settlement_queue (
  created_at TIMESTAMPTZ,
  currency TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  status TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_settlement_queue_created_at ON settlement_queue (created_at);
CREATE INDEX IF NOT EXISTS idx_settlement_queue_status ON settlement_queue (status);

CREATE TABLE IF NOT EXISTS settlement_reconciliations (
  created_at TIMESTAMPTZ,
  details JSONB,
  discrepancy_count NUMERIC(24, 8),
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  matched BOOLEAN,
  our_count NUMERIC(24, 8),
  period_end TEXT,
  period_start TEXT,
  provider_count NUMERIC(24, 8),
  rail TEXT,
  status TEXT,
  total_diff NUMERIC(24, 8),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS smart_contracts (
  amount NUMERIC(24, 8),
  conditions JSONB,
  contract_id TEXT,
  creator_id TEXT,
  currency TEXT,
  expires_at TIMESTAMPTZ,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  recipient_id TEXT,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS split_bills (
  creator_id TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_split_bills_creator_id ON split_bills (creator_id);

CREATE TABLE IF NOT EXISTS stablecoin_conversions (
  created_at TIMESTAMPTZ,
  fee NUMERIC(24, 8),
  from_amount NUMERIC(24, 8),
  from_currency TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rate NUMERIC(24, 8),
  source_transaction_id TEXT,
  status TEXT,
  to_amount NUMERIC(24, 8),
  to_stablecoin TEXT,
  user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_messages (
  adm TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  is_agent BOOLEAN,
  message TEXT,
  sender_id TEXT,
  ticket_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_messages_adm ON support_messages (adm);
CREATE INDEX IF NOT EXISTS idx_support_messages_sender_id ON support_messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_id ON support_messages (ticket_id);

CREATE TABLE IF NOT EXISTS tamper_proof_audit_log (
  action TEXT,
  created_at TIMESTAMPTZ,
  details JSONB,
  entry_hash TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ip_address TEXT,
  previous_hash TEXT,
  resource_id TEXT,
  resource_type TEXT,
  user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transfer_escalations (
  created_at TIMESTAMPTZ,
  description TEXT,
  escalation_id TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reason TEXT,
  sla_deadline TEXT,
  status TEXT,
  transaction_id TEXT,
  user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transfer_goals (
  auto_transfer_enabled BOOLEAN,
  created_at TIMESTAMPTZ,
  currency TEXT,
  current_amount NUMERIC(24, 8),
  deadline TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT,
  status TEXT,
  target_amount NUMERIC(24, 8),
  user_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transfer_goals_user_id ON transfer_goals (user_id);

CREATE TABLE IF NOT EXISTS transfer_limit_overrides (
  daily_limit NUMERIC(24, 8),
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  monthly_limit NUMERIC(24, 8),
  single_limit NUMERIC(24, 8),
  tier TEXT,
  "updatedAt" TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_stablecoin_preferences (
  auto_convert_enabled TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  min_threshold TEXT,
  preferred_stablecoin TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_stablecoin_preferences_auto_convert_enabled ON user_stablecoin_preferences (auto_convert_enabled);
CREATE INDEX IF NOT EXISTS idx_user_stablecoin_preferences_user_id ON user_stablecoin_preferences (user_id);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  current_period_end TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  plan_id TEXT,
  started_at TIMESTAMPTZ,
  status TEXT,
  subscription_id TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vasp_directory (
  active BOOLEAN,
  country_code TEXT,
  endpoint TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT,
  protocol TEXT,
  public_key TEXT,
  vasp_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vasp_directory_active ON vasp_directory (active);
CREATE INDEX IF NOT EXISTS idx_vasp_directory_country_code ON vasp_directory (country_code);

CREATE TABLE IF NOT EXISTS vasp_reports (
  amount_usd NUMERIC(24, 8),
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  receiver_address TEXT,
  receiver_name TEXT,
  report_id TEXT,
  sender_address TEXT,
  sender_name TEXT,
  status TEXT,
  transfer_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vrp_consents (
  beneficiary_account_id TEXT,
  consent_id TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  max_cumulative_amount NUMERIC(24, 8),
  max_cumulative_period TEXT,
  max_single_payment TEXT,
  reference TEXT,
  status TEXT,
  user_id TEXT,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  currency TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON wallet_transactions (user_id);

CREATE TABLE IF NOT EXISTS web_vitals_metrics (
  cls TEXT,
  fid TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  inp TEXT,
  lcp TEXT,
  ttfb TEXT,
  url TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS yield_harvest_log (
  action TEXT,
  amount NUMERIC(24, 8),
  created_at TIMESTAMPTZ,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  position_id TEXT,
  protocol TEXT,
  user_id TEXT,
  value_usd TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS yield_positions (
  auto_compound TEXT,
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  status TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_yield_positions_auto_compound ON yield_positions (auto_compound);
CREATE INDEX IF NOT EXISTS idx_yield_positions_status ON yield_positions (status);
CREATE INDEX IF NOT EXISTS idx_yield_positions_user_id ON yield_positions (user_id);
