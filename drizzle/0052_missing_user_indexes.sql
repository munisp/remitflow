-- Canonical user-lookup indexes for the legacy schema lineage.
-- The retained pre-0051 snapshot contains both camelCase and snake_case user identifiers.
-- This migration creates the requested index only when a user identifier exists on the target table.

DO $$
DECLARE
  target record;
  user_column text;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
    ('idx_fxAlerts_user_id', 'fxAlerts'),
    ('idx_virtualAccounts_user_id', 'virtualAccounts'),
    ('idx_recurringPayments_user_id', 'recurringPayments'),
    ('idx_scheduledTransferRuns_user_id', 'scheduledTransferRuns'),
    ('idx_batchPayments_user_id', 'batchPayments'),
    ('idx_disputes_user_id', 'disputes'),
    ('idx_support_tickets_user_id', 'support_tickets'),
    ('idx_rate_locks_user_id', 'rate_locks'),
    ('idx_direct_debit_mandates_user_id', 'direct_debit_mandates'),
    ('idx_consent_records_user_id', 'consent_records'),
    ('idx_payment_metrics_user_id', 'payment_metrics'),
    ('idx_bnpl_plans_user_id', 'bnpl_plans'),
    ('idx_stablecoin_wallets_user_id', 'stablecoin_wallets'),
    ('idx_mojaloop_transfers_user_id', 'mojaloop_transfers'),
    ('idx_pos_terminals_user_id', 'pos_terminals'),
    ('idx_agent_accounts_user_id', 'agent_accounts'),
    ('idx_kyb_records_user_id', 'kyb_records'),
    ('idx_erasure_requests_user_id', 'erasure_requests'),
    ('idx_notificationPreferences_user_id', 'notificationPreferences'),
    ('idx_chatSessions_user_id', 'chatSessions'),
    ('idx_complianceCases_user_id', 'complianceCases'),
    ('idx_fraud_alerts_user_id', 'fraud_alerts'),
    ('idx_talent_profiles_user_id', 'talent_profiles'),
    ('idx_fund_votes_user_id', 'fund_votes'),
    ('idx_diaspora_collective_members_user_id', 'diaspora_collective_members'),
    ('idx_family_members_user_id', 'family_members'),
    ('idx_family_budgets_user_id', 'family_budgets'),
    ('idx_user_investments_user_id', 'user_investments'),
    ('idx_investment_watchlist_user_id', 'investment_watchlist'),
    ('idx_investment_orders_user_id', 'investment_orders'),
    ('idx_tenant_users_user_id', 'tenant_users'),
    ('idx_user_feature_flags_user_id', 'user_feature_flags'),
    ('idx_travel_rule_records_user_id', 'travel_rule_records'),
    ('idx_tenant_onboarding_sessions_user_id', 'tenant_onboarding_sessions'),
    ('idx_webhook_endpoints_user_id', 'webhook_endpoints'),
    ('idx_api_keys_user_id', 'api_keys'),
    ('idx_payment_gateway_logs_user_id', 'payment_gateway_logs'),
    ('idx_compliance_watchlist_user_id', 'compliance_watchlist'),
    ('idx_stock_watchlists_user_id', 'stock_watchlists'),
    ('idx_ngx_orders_user_id', 'ngx_orders'),
    ('idx_real_estate_investments_user_id', 'real_estate_investments'),
    ('idx_startup_investments_user_id', 'startup_investments'),
    ('idx_paypal_transactions_user_id', 'paypal_transactions'),
    ('idx_flutterwave_transactions_user_id', 'flutterwave_transactions'),
    ('idx_push_subscriptions_user_id', 'push_subscriptions'),
    ('idx_api_key_usage_logs_user_id', 'api_key_usage_logs'),
    ('idx_stripe_receipts_user_id', 'stripe_receipts'),
    ('idx_fx_alert_trigger_history_user_id', 'fx_alert_trigger_history'),
    ('idx_chargeback_cases_user_id', 'chargeback_cases'),
    ('idx_smart_routing_decisions_user_id', 'smart_routing_decisions'),
    ('idx_developer_sandbox_sessions_user_id', 'developer_sandbox_sessions'),
    ('idx_sandbox_scenarios_user_id', 'sandbox_scenarios'),
    ('idx_security_events_user_id', 'security_events'),
    ('idx_mfa_settings_user_id', 'mfa_settings'),
    ('idx_transfer_audit_trail_user_id', 'transfer_audit_trail'),
    ('idx_promo_redemptions_user_id', 'promo_redemptions'),
    ('idx_user_notif_prefs_user_id', 'user_notif_prefs'),
    ('idx_scheduled_transfers_user_id', 'scheduled_transfers'),
    ('idx_exchange_rate_alerts_user_id', 'exchange_rate_alerts'),
    ('idx_sanctions_checks_user_id', 'sanctions_checks'),
    ('idx_bulk_payment_batches_user_id', 'bulk_payment_batches'),
    ('idx_open_banking_consents_user_id', 'open_banking_consents'),
    ('idx_user_onboarding_progress_user_id', 'user_onboarding_progress'),
    ('idx_ab_assignments_user_id', 'ab_assignments'),
    ('idx_document_vault_user_id', 'document_vault'),
    ('idx_rate_alert_history_user_id', 'rate_alert_history'),
    ('idx_doc_reminder_prefs_user_id', 'doc_reminder_prefs'),
    ('idx_doc_reminder_log_user_id', 'doc_reminder_log'),
    ('idx_velocity_overrides_user_id', 'velocity_overrides'),
    ('idx_velocity_whitelist_user_id', 'velocity_whitelist'),
    ('idx_kyc_lifecycle_user_id', 'kyc_lifecycle'),
    ('idx_kyc_lifecycle_history_user_id', 'kyc_lifecycle_history'),
    ('idx_document_renewals_user_id', 'document_renewals'),
    ('idx_api_key_rotation_log_user_id', 'api_key_rotation_log'),
    ('idx_transaction_exports_user_id', 'transaction_exports'),
    ('idx_ip_login_history_user_id', 'ip_login_history'),
    ('idx_cbdc_mint_burn_log_user_id', 'cbdc_mint_burn_log'),
    ('idx_community_activity_feed_user_id', 'community_activity_feed'),
    ('idx_ctr_auto_flags_user_id', 'ctr_auto_flags'),
    ('idx_partner_digital_agreements_user_id', 'partner_digital_agreements'),
    ('idx_security_incidents_user_id', 'security_incidents'),
    ('idx_push_notification_preferences_user_id', 'push_notification_preferences'),
    ('idx_user_lockouts_user_id', 'user_lockouts'),
    ('idx_bricspay_transfers_user_id', 'bricspay_transfers'),
    ('idx_mbridge_transfers_user_id', 'mbridge_transfers'),
    ('idx_ghipss_transfers_user_id', 'ghipss_transfers'),
    ('idx_africbdc_transfers_user_id', 'africbdc_transfers'),
    ('idx_papss_transfers_user_id', 'papss_transfers'),
    ('idx_wallet_funding_events_user_id', 'wallet_funding_events'),
    ('idx_outbound_annual_usage_user_id', 'outbound_annual_usage'),
    ('idx_cross_sell_offers_user_id', 'cross_sell_offers'),
    ('idx_xof_payout_accounts_user_id', 'xof_payout_accounts'),
    ('idx_ecowas_compliance_checks_user_id', 'ecowas_compliance_checks'),
    ('idx_immigrant_worker_profiles_user_id', 'immigrant_worker_profiles'),
    ('idx_tiered_kyc_sessions_user_id', 'tiered_kyc_sessions'),
    ('idx_hnw_profiles_user_id', 'hnw_profiles'),
    ('idx_hnw_relationship_managers_user_id', 'hnw_relationship_managers'),
    ('idx_sme_trade_bulk_batches_user_id', 'sme_trade_bulk_batches'),
    ('idx_sme_trade_payments_user_id', 'sme_trade_payments'),
    ('idx_form_m_documents_user_id', 'form_m_documents'),
    ('idx_diaspora_usa_profiles_user_id', 'diaspora_usa_profiles'),
    ('idx_ach_payment_methods_user_id', 'ach_payment_methods'),
    ('idx_us_compliance_disclosures_user_id', 'us_compliance_disclosures'),
    ('idx_diaspora_eu_profiles_user_id', 'diaspora_eu_profiles'),
    ('idx_sepa_payment_methods_user_id', 'sepa_payment_methods'),
    ('idx_diaspora_canada_profiles_user_id', 'diaspora_canada_profiles'),
    ('idx_interac_payment_methods_user_id', 'interac_payment_methods'),
    ('idx_west_africa_transfers_user_id', 'west_africa_transfers'),
    ('idx_immigrant_worker_kyc_user_id', 'immigrant_worker_kyc'),
    ('idx_hnw_client_profiles_user_id', 'hnw_client_profiles'),
    ('idx_hnw_rate_locks_user_id', 'hnw_rate_locks'),
    ('idx_hnw_transfers_user_id', 'hnw_transfers'),
    ('idx_hnw_rm_requests_user_id', 'hnw_rm_requests'),
    ('idx_sme_trade_batches_user_id', 'sme_trade_batches'),
    ('idx_diaspora_profiles_user_id', 'diaspora_profiles'),
    ('idx_diaspora_offer_claims_user_id', 'diaspora_offer_claims'),
    ('idx_outbound_transfers_user_id', 'outbound_transfers'),
    ('idx_swift_transactions_user_id', 'swift_transactions'),
    ('idx_payroll_employees_user_id', 'payroll_employees'),
    ('idx_bond_subscriptions_user_id', 'bond_subscriptions'),
    ('idx_bond_coupon_payments_user_id', 'bond_coupon_payments'),
    ('idx_merchant_kyb_reviews_user_id', 'merchant_kyb_reviews')
    ) AS requested(index_name, table_name)
  LOOP
    user_column := NULL;
    SELECT columns.column_name
      INTO user_column
      FROM information_schema.columns AS columns
     WHERE columns.table_schema = 'public'
       AND columns.table_name = target.table_name
       AND columns.column_name IN ('userId', 'user_id')
     ORDER BY CASE columns.column_name WHEN 'userId' THEN 0 ELSE 1 END
     LIMIT 1;

    IF user_column IS NOT NULL THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%I)',
        target.index_name,
        'public',
        target.table_name,
        user_column
      );
    END IF;
  END LOOP;
END $$;
