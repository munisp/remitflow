-- RemitFlow Production Hardening: Comprehensive Index Migration
-- Adds proper indexes to all 263 tables for production-grade query performance.
-- Priority: financial tables first, then compliance, then operational.

-- ============================================================================
-- TIER 1: Critical Financial Tables (must be fast under load)
-- ============================================================================

-- transactions: the highest-volume table
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions ("userId");
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions ("status");
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions ("createdAt");
CREATE INDEX IF NOT EXISTS idx_transactions_user_status ON transactions ("userId", "status");
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions ("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_currency ON transactions ("currency");
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions ("type");
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions ("reference");

-- wallets: balance lookups are the most frequent operation
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets ("userId");
CREATE INDEX IF NOT EXISTS idx_wallets_user_currency ON wallets ("userId", "currency");
CREATE INDEX IF NOT EXISTS idx_wallets_status ON wallets ("status");

-- beneficiaries: looked up on every transfer
CREATE INDEX IF NOT EXISTS idx_beneficiaries_user_id ON beneficiaries ("userId");
CREATE INDEX IF NOT EXISTS idx_beneficiaries_user_name ON beneficiaries ("userId", "name");

-- audit_logs: compliance queries need fast filtering
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON "auditLogs" ("userId");
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON "auditLogs" ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON "auditLogs" ("action");
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON "auditLogs" ("severity");
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action ON "auditLogs" ("userId", "action");

-- idempotency_keys: deduplication lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_keys_key ON idempotency_keys ("key");
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON idempotency_keys ("createdAt");
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires ON idempotency_keys ("expiresAt");

-- rate_locks: time-sensitive FX operations
CREATE INDEX IF NOT EXISTS idx_rate_locks_user_id ON rate_locks ("userId");
CREATE INDEX IF NOT EXISTS idx_rate_locks_status ON rate_locks ("status");
CREATE INDEX IF NOT EXISTS idx_rate_locks_expires ON rate_locks ("expiresAt");

-- ============================================================================
-- TIER 2: KYC / AML / Compliance Tables
-- ============================================================================

-- kyc_documents
CREATE INDEX IF NOT EXISTS idx_kyc_documents_user_id ON "kycDocuments" ("userId");
CREATE INDEX IF NOT EXISTS idx_kyc_documents_status ON "kycDocuments" ("status");
CREATE INDEX IF NOT EXISTS idx_kyc_documents_type ON "kycDocuments" ("docType");
CREATE INDEX IF NOT EXISTS idx_kyc_documents_user_status ON "kycDocuments" ("userId", "status");

-- compliance_alerts
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_status ON compliance_alerts ("status");
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_severity ON compliance_alerts ("severity");
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_assigned ON compliance_alerts ("assignedTo");
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_created ON compliance_alerts ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_type ON compliance_alerts ("alertType");
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_user ON compliance_alerts ("userId");

-- compliance_cases
CREATE INDEX IF NOT EXISTS idx_compliance_cases_user ON "complianceCases" ("userId");
CREATE INDEX IF NOT EXISTS idx_compliance_cases_status ON "complianceCases" ("status");
CREATE INDEX IF NOT EXISTS idx_compliance_cases_severity ON "complianceCases" ("severity");
CREATE INDEX IF NOT EXISTS idx_compliance_cases_type ON "complianceCases" ("caseType");

-- sanctions_checks
CREATE INDEX IF NOT EXISTS idx_sanctions_checks_user ON sanctions_checks ("userId");
CREATE INDEX IF NOT EXISTS idx_sanctions_checks_status ON sanctions_checks ("status");
CREATE INDEX IF NOT EXISTS idx_sanctions_checks_created ON sanctions_checks ("createdAt" DESC);

-- travel_rule_records
CREATE INDEX IF NOT EXISTS idx_travel_rule_transaction ON travel_rule_records ("transactionId");
CREATE INDEX IF NOT EXISTS idx_travel_rule_status ON travel_rule_records ("status");

-- compliance_reports
CREATE INDEX IF NOT EXISTS idx_compliance_reports_type ON compliance_reports ("reportType");
CREATE INDEX IF NOT EXISTS idx_compliance_reports_status ON compliance_reports ("status");
CREATE INDEX IF NOT EXISTS idx_compliance_reports_created ON compliance_reports ("createdAt" DESC);

-- kyc_liveness_audit
CREATE INDEX IF NOT EXISTS idx_kyc_liveness_user ON kyc_liveness_audit ("userId");
CREATE INDEX IF NOT EXISTS idx_kyc_liveness_created ON kyc_liveness_audit ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_kyc_liveness_corridor ON kyc_liveness_audit ("corridorCode");

-- kyc_lifecycle
CREATE INDEX IF NOT EXISTS idx_kyc_lifecycle_user ON kyc_lifecycle ("userId");
CREATE INDEX IF NOT EXISTS idx_kyc_lifecycle_status ON kyc_lifecycle ("status");

-- compliance_watchlist
CREATE INDEX IF NOT EXISTS idx_compliance_watchlist_entity ON compliance_watchlist ("entityName");
CREATE INDEX IF NOT EXISTS idx_compliance_watchlist_type ON compliance_watchlist ("entityType");

-- regulatory_reports
CREATE INDEX IF NOT EXISTS idx_regulatory_reports_type ON regulatory_reports ("reportType");
CREATE INDEX IF NOT EXISTS idx_regulatory_reports_status ON regulatory_reports ("status");

-- fraud_alerts
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_user ON fraud_alerts ("userId");
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_status ON fraud_alerts ("status");
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_severity ON fraud_alerts ("severity");
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_created ON fraud_alerts ("createdAt" DESC);

-- ============================================================================
-- TIER 3: Payment & Transfer Tables
-- ============================================================================

-- recurring_payments
CREATE INDEX IF NOT EXISTS idx_recurring_payments_user ON "recurringPayments" ("userId");
CREATE INDEX IF NOT EXISTS idx_recurring_payments_status ON "recurringPayments" ("status");
CREATE INDEX IF NOT EXISTS idx_recurring_payments_next ON "recurringPayments" ("nextRunDate");

-- batch_payments
CREATE INDEX IF NOT EXISTS idx_batch_payments_user ON "batchPayments" ("userId");
CREATE INDEX IF NOT EXISTS idx_batch_payments_status ON "batchPayments" ("status");
CREATE INDEX IF NOT EXISTS idx_batch_payments_created ON "batchPayments" ("createdAt" DESC);

-- batch_payment_items
CREATE INDEX IF NOT EXISTS idx_batch_payment_items_batch ON batch_payment_items ("batchId");
CREATE INDEX IF NOT EXISTS idx_batch_payment_items_status ON batch_payment_items ("status");

-- payment_requests
CREATE INDEX IF NOT EXISTS idx_payment_requests_user ON payment_requests ("userId");
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests ("status");

-- scheduled_transfers
CREATE INDEX IF NOT EXISTS idx_scheduled_transfers_user ON scheduled_transfers ("userId");
CREATE INDEX IF NOT EXISTS idx_scheduled_transfers_next ON scheduled_transfers ("nextRunAt");
CREATE INDEX IF NOT EXISTS idx_scheduled_transfers_status ON scheduled_transfers ("status");

-- scheduled_transfer_runs
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_transfer ON "scheduledTransferRuns" ("scheduledTransferId");
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_status ON "scheduledTransferRuns" ("status");

-- split_bill_groups
CREATE INDEX IF NOT EXISTS idx_split_bill_creator ON split_bill_groups ("creatorId");

-- split_bill_participants
CREATE INDEX IF NOT EXISTS idx_split_bill_group ON split_bill_participants ("groupId");
CREATE INDEX IF NOT EXISTS idx_split_bill_user ON split_bill_participants ("userId");

-- direct_debit_mandates
CREATE INDEX IF NOT EXISTS idx_dd_mandates_user ON direct_debit_mandates ("userId");
CREATE INDEX IF NOT EXISTS idx_dd_mandates_status ON direct_debit_mandates ("status");

-- outbound_transfers
CREATE INDEX IF NOT EXISTS idx_outbound_transfers_user ON outbound_transfers ("userId");
CREATE INDEX IF NOT EXISTS idx_outbound_transfers_status ON outbound_transfers ("status");
CREATE INDEX IF NOT EXISTS idx_outbound_transfers_rail ON outbound_transfers ("rail");

-- mojaloop_transfers
CREATE INDEX IF NOT EXISTS idx_mojaloop_transfers_user ON mojaloop_transfers ("userId");
CREATE INDEX IF NOT EXISTS idx_mojaloop_transfers_status ON mojaloop_transfers ("status");
CREATE INDEX IF NOT EXISTS idx_mojaloop_transfers_ref ON mojaloop_transfers ("transferId");

-- swift_transactions
CREATE INDEX IF NOT EXISTS idx_swift_transactions_user ON swift_transactions ("userId");
CREATE INDEX IF NOT EXISTS idx_swift_transactions_status ON swift_transactions ("status");
CREATE INDEX IF NOT EXISTS idx_swift_transactions_uetr ON swift_transactions ("uetr");

-- papss_transfers
CREATE INDEX IF NOT EXISTS idx_papss_transfers_user ON papss_transfers ("userId");
CREATE INDEX IF NOT EXISTS idx_papss_transfers_status ON papss_transfers ("status");

-- africbdc_transfers
CREATE INDEX IF NOT EXISTS idx_africbdc_transfers_sender ON africbdc_transfers ("senderWalletId");
CREATE INDEX IF NOT EXISTS idx_africbdc_transfers_status ON africbdc_transfers ("status");

-- cbdc_wallets
CREATE INDEX IF NOT EXISTS idx_cbdc_wallets_user ON cbdc_wallets ("userId");
CREATE INDEX IF NOT EXISTS idx_cbdc_wallets_status ON cbdc_wallets ("status");

-- stablecoin_wallets
CREATE INDEX IF NOT EXISTS idx_stablecoin_wallets_user ON stablecoin_wallets ("userId");

-- ============================================================================
-- TIER 4: Cards, Savings, Investments
-- ============================================================================

-- cards
CREATE INDEX IF NOT EXISTS idx_cards_user ON cards ("userId");
CREATE INDEX IF NOT EXISTS idx_cards_status ON cards ("status");
CREATE INDEX IF NOT EXISTS idx_cards_type ON cards ("type");

-- savings_goals
CREATE INDEX IF NOT EXISTS idx_savings_goals_user ON "savingsGoals" ("userId");
CREATE INDEX IF NOT EXISTS idx_savings_goals_status ON "savingsGoals" ("status");

-- investment_orders
CREATE INDEX IF NOT EXISTS idx_investment_orders_user ON investment_orders ("userId");
CREATE INDEX IF NOT EXISTS idx_investment_orders_status ON investment_orders ("status");
CREATE INDEX IF NOT EXISTS idx_investment_orders_asset ON investment_orders ("assetId");

-- investment_price_history
CREATE INDEX IF NOT EXISTS idx_investment_prices_asset ON investment_price_history ("assetId");
CREATE INDEX IF NOT EXISTS idx_investment_prices_time ON investment_price_history ("recordedAt" DESC);

-- diaspora_bonds
CREATE INDEX IF NOT EXISTS idx_diaspora_bonds_status ON diaspora_bonds ("status");

-- bond_subscriptions
CREATE INDEX IF NOT EXISTS idx_bond_subs_user ON bond_subscriptions ("userId");
CREATE INDEX IF NOT EXISTS idx_bond_subs_bond ON bond_subscriptions ("bondId");
CREATE INDEX IF NOT EXISTS idx_bond_subs_status ON bond_subscriptions ("status");

-- bond_secondary_market_orders
CREATE INDEX IF NOT EXISTS idx_bond_orders_user ON bond_secondary_market_orders ("userId");
CREATE INDEX IF NOT EXISTS idx_bond_orders_status ON bond_secondary_market_orders ("status");
CREATE INDEX IF NOT EXISTS idx_bond_orders_type ON bond_secondary_market_orders ("orderType");

-- bnpl_plans
CREATE INDEX IF NOT EXISTS idx_bnpl_user ON bnpl_plans ("userId");
CREATE INDEX IF NOT EXISTS idx_bnpl_status ON bnpl_plans ("status");

-- invoice_financing_applications
CREATE INDEX IF NOT EXISTS idx_invoice_fin_user ON invoice_financing_applications ("userId");
CREATE INDEX IF NOT EXISTS idx_invoice_fin_status ON invoice_financing_applications ("status");

-- real_estate_listings
CREATE INDEX IF NOT EXISTS idx_real_estate_status ON real_estate_listings ("status");
CREATE INDEX IF NOT EXISTS idx_real_estate_country ON real_estate_listings ("country");

-- ============================================================================
-- TIER 5: Agent & Partner Tables
-- ============================================================================

-- agent_accounts
CREATE INDEX IF NOT EXISTS idx_agent_accounts_user ON agent_accounts ("userId");
CREATE INDEX IF NOT EXISTS idx_agent_accounts_status ON agent_accounts ("status");

-- pos_terminals
CREATE INDEX IF NOT EXISTS idx_pos_terminals_agent ON pos_terminals ("agentId");
CREATE INDEX IF NOT EXISTS idx_pos_terminals_status ON pos_terminals ("status");

-- partner_applications
CREATE INDEX IF NOT EXISTS idx_partner_apps_status ON partner_applications ("status");
CREATE INDEX IF NOT EXISTS idx_partner_apps_user ON partner_applications ("userId");

-- partner_payouts
CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner ON partner_payouts ("partnerId");
CREATE INDEX IF NOT EXISTS idx_partner_payouts_status ON partner_payouts ("status");

-- tenants
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants ("status");

-- tenant_users
CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON tenant_users ("tenantId");
CREATE INDEX IF NOT EXISTS idx_tenant_users_user ON tenant_users ("userId");

-- revenue_share_agreements
CREATE INDEX IF NOT EXISTS idx_rev_share_partner ON revenue_share_agreements ("partnerId");
CREATE INDEX IF NOT EXISTS idx_rev_share_status ON revenue_share_agreements ("status");

-- ============================================================================
-- TIER 6: Notifications, Support, Security
-- ============================================================================

-- notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications ("userId");
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications ("userId", "isRead");
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications ("type");

-- support_tickets
CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets ("userId");
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets ("status");
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON support_tickets ("priority");

-- security_events
CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events ("userId");
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events ("eventType");
CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events ("createdAt" DESC);

-- ip_login_history
CREATE INDEX IF NOT EXISTS idx_ip_login_user ON ip_login_history ("userId");
CREATE INDEX IF NOT EXISTS idx_ip_login_created ON ip_login_history ("createdAt" DESC);

-- user_lockouts
CREATE INDEX IF NOT EXISTS idx_user_lockouts_user ON user_lockouts ("userId");

-- disputes
CREATE INDEX IF NOT EXISTS idx_disputes_user ON disputes ("userId");
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes ("status");
CREATE INDEX IF NOT EXISTS idx_disputes_type ON disputes ("type");

-- chargeback_cases
CREATE INDEX IF NOT EXISTS idx_chargebacks_status ON chargeback_cases ("status");
CREATE INDEX IF NOT EXISTS idx_chargebacks_transaction ON chargeback_cases ("transactionId");

-- referrals
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals ("referrerId");
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals ("referredId");
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals ("status");

-- fx_alerts
CREATE INDEX IF NOT EXISTS idx_fx_alerts_user ON "fxAlerts" ("userId");
CREATE INDEX IF NOT EXISTS idx_fx_alerts_active ON "fxAlerts" ("isActive");

-- fx_rate_cache
CREATE INDEX IF NOT EXISTS idx_fx_rate_cache_base ON "fxRateCache" ("baseCurrency");
CREATE INDEX IF NOT EXISTS idx_fx_rate_cache_updated ON "fxRateCache" ("updatedAt" DESC);

-- virtual_accounts
CREATE INDEX IF NOT EXISTS idx_virtual_accounts_user ON "virtualAccounts" ("userId");
CREATE INDEX IF NOT EXISTS idx_virtual_accounts_status ON "virtualAccounts" ("status");

-- ============================================================================
-- TIER 7: Payroll, Marketplace, Misc
-- ============================================================================

-- payroll_runs
CREATE INDEX IF NOT EXISTS idx_payroll_runs_company ON payroll_runs ("companyId");
CREATE INDEX IF NOT EXISTS idx_payroll_runs_status ON payroll_runs ("status");

-- payroll_employees
CREATE INDEX IF NOT EXISTS idx_payroll_employees_company ON payroll_employees ("companyId");

-- payroll_disbursements
CREATE INDEX IF NOT EXISTS idx_payroll_disbursements_run ON payroll_disbursements ("runId");
CREATE INDEX IF NOT EXISTS idx_payroll_disbursements_status ON payroll_disbursements ("status");

-- contractor_invoices
CREATE INDEX IF NOT EXISTS idx_contractor_invoices_contractor ON contractor_invoices ("contractorId");
CREATE INDEX IF NOT EXISTS idx_contractor_invoices_status ON contractor_invoices ("status");

-- market_listings
CREATE INDEX IF NOT EXISTS idx_market_listings_seller ON market_listings ("sellerId");
CREATE INDEX IF NOT EXISTS idx_market_listings_status ON market_listings ("status");
CREATE INDEX IF NOT EXISTS idx_market_listings_category ON market_listings ("category");

-- market_orders
CREATE INDEX IF NOT EXISTS idx_market_orders_buyer ON market_orders ("buyerId");
CREATE INDEX IF NOT EXISTS idx_market_orders_seller ON market_orders ("sellerId");
CREATE INDEX IF NOT EXISTS idx_market_orders_status ON market_orders ("status");

-- document_vault
CREATE INDEX IF NOT EXISTS idx_document_vault_user ON document_vault ("userId");
CREATE INDEX IF NOT EXISTS idx_document_vault_type ON document_vault ("docType");
CREATE INDEX IF NOT EXISTS idx_document_vault_expires ON document_vault ("expiresAt");

-- api_keys
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys ("userId");
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys ("keyHash");
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys ("isActive");

-- api_key_usage_logs
CREATE INDEX IF NOT EXISTS idx_api_usage_key ON api_key_usage_logs ("apiKeyId");
CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_key_usage_logs ("createdAt" DESC);

-- webhook_endpoints
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_user ON webhook_endpoints ("userId");
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_active ON webhook_endpoints ("isActive");

-- webhook_deliveries
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON webhook_deliveries ("endpointId");
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries ("status");

-- cron_jobs
CREATE INDEX IF NOT EXISTS idx_cron_jobs_next ON cron_jobs ("nextRunAt");
CREATE INDEX IF NOT EXISTS idx_cron_jobs_active ON cron_jobs ("isActive");

-- system_config
CREATE INDEX IF NOT EXISTS idx_system_config_key ON system_config ("key");

-- feature_flags
CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags ("key");
CREATE INDEX IF NOT EXISTS idx_feature_flags_active ON feature_flags ("isActive");

-- promo_codes
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes ("code");
CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes ("isActive");
CREATE INDEX IF NOT EXISTS idx_promo_codes_expires ON promo_codes ("expiresAt");

-- consent_records
CREATE INDEX IF NOT EXISTS idx_consent_records_user ON consent_records ("userId");
CREATE INDEX IF NOT EXISTS idx_consent_records_type ON consent_records ("consentType");

-- erasure_requests
CREATE INDEX IF NOT EXISTS idx_erasure_requests_user ON erasure_requests ("userId");
CREATE INDEX IF NOT EXISTS idx_erasure_requests_status ON erasure_requests ("status");

-- ============================================================================
-- TIER 8: BDC, Corridor, Settlement Tables
-- ============================================================================

-- bdc_partners
CREATE INDEX IF NOT EXISTS idx_bdc_partners_status ON bdc_partners ("status");

-- bmatch_rate_snapshots
CREATE INDEX IF NOT EXISTS idx_bmatch_rates_pair ON bmatch_rate_snapshots ("pair");
CREATE INDEX IF NOT EXISTS idx_bmatch_rates_created ON bmatch_rate_snapshots ("createdAt" DESC);

-- correspondent_banks
CREATE INDEX IF NOT EXISTS idx_correspondent_banks_status ON correspondent_banks ("status");
CREATE INDEX IF NOT EXISTS idx_correspondent_banks_country ON correspondent_banks ("country");

-- settlement_accounts
CREATE INDEX IF NOT EXISTS idx_settlement_accounts_bank ON settlement_accounts ("bankId");
CREATE INDEX IF NOT EXISTS idx_settlement_accounts_currency ON settlement_accounts ("currency");

-- clearing_lines
CREATE INDEX IF NOT EXISTS idx_clearing_lines_settlement ON clearing_lines ("settlementId");
CREATE INDEX IF NOT EXISTS idx_clearing_lines_status ON clearing_lines ("status");

-- smart_routing_decisions
CREATE INDEX IF NOT EXISTS idx_smart_routing_transfer ON smart_routing_decisions ("transferId");
CREATE INDEX IF NOT EXISTS idx_smart_routing_rail ON smart_routing_decisions ("selectedRail");

-- payment_gateway_logs
CREATE INDEX IF NOT EXISTS idx_pg_logs_gateway ON payment_gateway_logs ("gateway");
CREATE INDEX IF NOT EXISTS idx_pg_logs_status ON payment_gateway_logs ("status");
CREATE INDEX IF NOT EXISTS idx_pg_logs_created ON payment_gateway_logs ("createdAt" DESC);

-- payment_metrics
CREATE INDEX IF NOT EXISTS idx_payment_metrics_rail ON payment_metrics ("rail");
CREATE INDEX IF NOT EXISTS idx_payment_metrics_period ON payment_metrics ("period");

-- transfer_audit_trail
CREATE INDEX IF NOT EXISTS idx_transfer_audit_transfer ON transfer_audit_trail ("transferId");
CREATE INDEX IF NOT EXISTS idx_transfer_audit_created ON transfer_audit_trail ("createdAt" DESC);

-- daily_volume_snapshots
CREATE INDEX IF NOT EXISTS idx_daily_volume_date ON daily_volume_snapshots ("snapshotDate" DESC);
CREATE INDEX IF NOT EXISTS idx_daily_volume_corridor ON daily_volume_snapshots ("corridor");

-- ============================================================================
-- TIER 9: Composite indexes for common query patterns
-- ============================================================================

-- Common admin listing pattern: status + created DESC
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_status_created ON compliance_alerts ("status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_disputes_status_created ON disputes ("status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status_created ON support_tickets ("status", "createdAt" DESC);

-- Common user dashboard pattern: userId + createdAt DESC (recent items)
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications ("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_cards_user_created ON cards ("userId", "createdAt" DESC);

-- Transaction search patterns
CREATE INDEX IF NOT EXISTS idx_transactions_user_type_created ON transactions ("userId", "type", "createdAt" DESC);
