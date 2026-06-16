import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'providers/auth_provider.dart';
import 'widgets/main_shell.dart';
// ── Screen imports (384 screens) ─────────────────────────────────
import 'screens/a_b_testing_admin_screen.dart';
import 'screens/a_i_hub_screen.dart';
import 'screens/a_i_metrics_dashboard_screen.dart';
import 'screens/a_m_l_batch_engine_page_screen.dart';
import 'screens/a_p_i_changelog_screen.dart';
import 'screens/a_p_i_key_manager_screen.dart';
import 'screens/a_p_i_usage_dashboard_screen.dart';
import 'screens/a_r_t_agent_page_screen.dart';
import 'screens/account_health_screen.dart';
import 'screens/admin_analytics_screen.dart';
import 'screens/admin_audit_log_screen.dart';
import 'screens/admin_bulk_actions_screen.dart';
import 'screens/admin_compliance_screen.dart';
import 'screens/admin_digital_agreements_screen.dart';
import 'screens/admin_disputes_screen.dart';
import 'screens/admin_feature_flags_screen.dart';
import 'screens/admin_home_screen.dart';
import 'screens/admin_invite_codes_screen.dart';
import 'screens/admin_k_y_c_screen.dart';
import 'screens/admin_microservices_screen.dart';
import 'screens/admin_nav_analytics_screen.dart';
import 'screens/admin_partner_applications_screen.dart';
import 'screens/admin_readiness_screen.dart';
import 'screens/admin_revenue_share_screen.dart';
import 'screens/admin_seed_data_screen.dart';
import 'screens/admin_stripe_test_screen.dart';
import 'screens/admin_tenants_screen.dart';
import 'screens/admin_users_screen.dart';
import 'screens/admin_white_label_screen.dart';
import 'screens/afri_market_screen.dart';
import 'screens/agent_cash_in_screen.dart';
import 'screens/agent_k_y_b_admin_screen.dart';
import 'screens/agent_kyb_admin_screen.dart';
import 'screens/agent_network_screen.dart';
import 'screens/agent_p_o_s_screen.dart';
import 'screens/agent_register_screen.dart';
import 'screens/airtime_screen.dart';
import 'screens/aml_batch_engine_screen.dart';
import 'screens/analytics_screen.dart';
import 'screens/api_key_admin_page_screen.dart';
import 'screens/api_key_admin_screen.dart';
import 'screens/art_agent_screen.dart';
import 'screens/audit_log_admin_screen.dart';
import 'screens/audit_log_viewer_screen.dart';
import 'screens/audit_logs_screen.dart';
import 'screens/audit_trail_v2_page_screen.dart';
import 'screens/audit_trail_v2_screen.dart';
import 'screens/b_d_c_partner_portal_screen.dart';
import 'screens/batch_payment_admin_screen.dart';
import 'screens/batch_payments_screen.dart';
import 'screens/bdc_onboarding_email_preview_screen.dart';
import 'screens/beneficiaries_screen.dart';
import 'screens/beneficiary_manager_screen.dart';
import 'screens/beneficiary_screen.dart';
import 'screens/beyond_remittance_screen.dart';
import 'screens/bill_payment_screen.dart';
import 'screens/billing_engine_dashboard_screen.dart';
import 'screens/bills_screen.dart';
import 'screens/bnpl_screen.dart';
import 'screens/bond_secondary_market_screen.dart';
import 'screens/branding_preview_screen.dart';
import 'screens/bulk_payments_v2_page_screen.dart';
import 'screens/bulk_payments_v2_screen.dart';
import 'screens/bulk_user_actions_screen.dart';
import 'screens/business_credit_scoring_screen.dart';
import 'screens/business_savings_screen.dart';
import 'screens/c_b_d_c_admin_screen.dart';
import 'screens/cbdc_admin_screen.dart' as cbdc_compat;
import 'screens/c_b_d_c_screen.dart';
import 'screens/c_t_r_compliance_screen.dart';
import 'screens/carbon_offset_page_screen.dart';
import 'screens/carbon_offset_screen.dart';
import 'screens/cards_screen.dart';
import 'screens/cbdc_screen.dart';
import 'screens/chargeback_manager_screen.dart';
import 'screens/chat_agent_dashboard_screen.dart';
import 'screens/checkout_s_d_k_screen.dart';
import 'screens/checkout_sdk_screen.dart';
import 'screens/circuit_breaker_dashboard_screen.dart';
import 'screens/coco_index_page_screen.dart';
import 'screens/coco_index_screen.dart';
import 'screens/community_feed_screen.dart';
import 'screens/community_hub_screen.dart';
import 'screens/community_leaderboard_screen.dart';
import 'screens/community_screen.dart';
import 'screens/compliance_alerts_screen.dart';
import 'screens/compliance_email_config_screen.dart';
import 'screens/compliance_form_m_audit_screen.dart';
import 'screens/compliance_metrics_dashboard_screen.dart';
import 'screens/compliance_reporting_screen.dart';
import 'screens/compliance_scoring_page_screen.dart';
import 'screens/compliance_scoring_screen.dart';
import 'screens/compliance_watchlist_page_screen.dart';
import 'screens/compliance_watchlist_screen.dart';
import 'screens/component_showcase_screen.dart';
import 'screens/consent_management_screen.dart';
import 'screens/contractor_payments_screen.dart';
import 'screens/conversational_payments_screen.dart';
import 'screens/corridor_pricing_admin_screen.dart';
import 'screens/corridor_pricing_screen.dart';
import 'screens/cron_jobs_admin_screen.dart';
import 'screens/cross_border_compliance_page_screen.dart';
import 'screens/cross_border_compliance_screen.dart';
import 'screens/cross_sell_marketplace_screen.dart';
import 'screens/d_p_i_a_screen.dart';
import 'screens/daily_volume_widget_screen.dart';
import 'screens/dashboard_screen.dart';
import 'screens/data_pipelines_page_screen.dart';
import 'screens/data_pipelines_screen.dart';
import 'screens/developer_sandbox_screen.dart';
import 'screens/diaspora_bond_market_screen.dart';
import 'screens/diaspora_canada_screen.dart';
import 'screens/diaspora_e_u_screen.dart';
import 'screens/diaspora_eu_screen.dart';
import 'screens/diaspora_invest_screen.dart';
import 'screens/diaspora_italy_screen.dart';
import 'screens/diaspora_mortgage_screen.dart';
import 'screens/diaspora_u_k_screen.dart';
import 'screens/diaspora_u_s_a_screen.dart';
import 'screens/diaspora_usa_screen.dart';
import 'screens/direct_debit_screen.dart';
import 'screens/dispute_management_page_screen.dart';
import 'screens/dispute_management_screen.dart';
import 'screens/disputes_screen.dart';
import 'screens/document_o_c_r_page_screen.dart';
import 'screens/document_ocr_screen.dart';
import 'screens/document_vault_page_screen.dart';
import 'screens/document_vault_renewal_screen.dart';
import 'screens/document_vault_screen.dart';
import 'screens/e_s_g_reporting_screen.dart';
import 'screens/education_payments_screen.dart';
import 'screens/embedded_payroll_a_p_i_screen.dart';
import 'screens/embedded_payroll_api_screen.dart';
import 'screens/esg_reporting_screen.dart';
import 'screens/exchange_rates_screen.dart';
import 'screens/expense_management_screen.dart';
import 'screens/f_c_a_compliance_screen.dart';
import 'screens/f_x_alerts_screen.dart';
import 'screens/f_x_hedging_page_screen.dart';
import 'screens/f_x_hedging_screen.dart';
import 'screens/f_x_options_pricing_page_screen.dart';
import 'screens/f_x_rate_alerts_screen.dart';
import 'screens/f_x_streaming_page_screen.dart';
import 'screens/family_dashboard_screen.dart';
import 'screens/feature_flag_admin_screen.dart';
import 'screens/feature_flags_admin_screen.dart';
import 'screens/fednow_transfer_screen.dart';
import 'screens/fee_negotiation_page_screen.dart';
import 'screens/fee_negotiation_screen.dart';
import 'screens/fee_rules_c_r_u_d_page_screen.dart';
import 'screens/fee_rules_c_r_u_d_v2_page_screen.dart';
import 'screens/fee_rules_crud_screen.dart';
import 'screens/fee_rules_crud_v2_screen.dart';
import 'screens/fee_rules_crudv2_page_screen.dart' as frcv2_compat;
import 'screens/fee_rules_engine_screen.dart';
import 'screens/float_income_dashboard_screen.dart';
import 'screens/form_m_history_screen.dart';
import 'screens/formalization_dashboard_screen.dart';
import 'screens/fraud_detection_v2_page_screen.dart';
import 'screens/fraud_detection_v2_screen.dart';
import 'screens/fraud_monitor_screen.dart';
import 'screens/fx_alerts_screen.dart';
import 'screens/fx_options_pricing_screen.dart';
import 'screens/fx_streaming_screen.dart';
import 'screens/g_d_p_r_data_screen.dart';
import 'screens/g_d_p_r_erasure_screen.dart';
import 'screens/global_payroll_screen.dart';
import 'screens/global_search_screen.dart';
import 'screens/grafana_dashboard_page_screen.dart';
import 'screens/grafana_dashboard_screen.dart';
import 'screens/help_screen.dart';
import 'screens/hnw_private_banking_screen.dart';
import 'screens/home_screen.dart';
import 'screens/i_p_login_history_screen.dart';
import 'screens/immigrant_worker_send_screen.dart';
import 'screens/investment_portfolio_screen.dart';
import 'screens/invoice_financing_screen.dart';
import 'screens/k_g_q_a_page_screen.dart';
import 'screens/kgqa_page_screen.dart' as kgqa_compat;
import 'screens/k_y_c_admin_queue_screen.dart';
import 'screens/k_y_c_lifecycle_page_screen.dart';
import 'screens/k_y_c_lifecycle_tracker_screen.dart';
import 'screens/k_y_c_verification_screen.dart';
import 'screens/kafka_dashboard_screen.dart';
import 'screens/kg_qa_screen.dart';
import 'screens/knowledge_graph_page_screen.dart';
import 'screens/knowledge_graph_screen.dart';
import 'screens/kyc_lifecycle_screen.dart';
import 'screens/kyc_screen.dart';
import 'screens/lakehouse_analytics_screen.dart';
import 'screens/lakehouse_page_screen.dart';
import 'screens/lakehouse_screen.dart';
import 'screens/landing_page_screen.dart';
import 'screens/landing_screen.dart';
import 'screens/ledger_page_screen.dart';
import 'screens/ledger_reconciliation_screen.dart';
import 'screens/ledger_screen.dart';
import 'screens/letter_of_credit_screen.dart';
import 'screens/liquidity_monitor_page_screen.dart';
import 'screens/liquidity_monitor_screen.dart';
import 'screens/liquidity_stress_test_page_screen.dart';
import 'screens/liquidity_stress_test_screen.dart';
import 'screens/live_chat_screen.dart';
import 'screens/live_f_x_calculator_screen.dart';
import 'screens/load_test_dashboard_screen.dart';
import 'screens/login_screen.dart';
import 'screens/loyalty_rewards_v2_page_screen.dart';
import 'screens/loyalty_rewards_v2_screen.dart';
import 'screens/m_f_a_settings_screen.dart';
import 'screens/m_pesa_screen.dart';
import 'screens/medical_tourism_screen.dart';
import 'screens/merchant_k_y_b_page_screen.dart';
import 'screens/merchant_k_y_b_review_screen.dart';
import 'screens/merchant_kyb_review_screen.dart';
import 'screens/merchant_kyb_screen.dart';
import 'screens/merchant_onboarding_page_screen.dart';
import 'screens/merchant_onboarding_screen.dart';
import 'screens/middleware_health_screen.dart';
import 'screens/mojaloop_screen.dart';
import 'screens/multi_currency_ledger_page_screen.dart';
import 'screens/multi_currency_ledger_screen.dart';
import 'screens/multi_currency_wallet_v2_page_screen.dart';
import 'screens/multi_currency_wallet_v2_screen.dart';
import 'screens/multi_hop_routing_page_screen.dart';
import 'screens/multi_hop_routing_screen.dart';
import 'screens/my_tenants_screen.dart';
import 'screens/my_transfers_screen.dart';
import 'screens/n_g_x_stock_market_screen.dart';
import 'screens/not_found_screen.dart';
import 'screens/notification_center_page_screen.dart';
import 'screens/notification_center_screen.dart';
import 'screens/notification_center_v2_page_screen.dart';
import 'screens/notification_center_v2_screen.dart';
import 'screens/notification_preferences_screen.dart';
import 'screens/notification_settings_screen.dart';
import 'screens/notifications_screen.dart';
import 'screens/ollama_chat_page_screen.dart';
import 'screens/ollama_chat_screen.dart';
import 'screens/onboarding_screen.dart';
import 'screens/open_banking_page_screen.dart';
import 'screens/open_banking_screen.dart';
import 'screens/outbound_revenue_model_screen.dart';
import 'screens/p_b_a_c_policies_screen.dart';
import 'screens/pbac_policies_screen.dart' as pbac_compat;
import 'screens/p_o_s_management_screen.dart';
import 'screens/p_w_a_dashboard_screen.dart';
import 'screens/p_w_a_features_screen.dart';
import 'screens/papss_compliance_screen.dart';
import 'screens/partner_analytics_screen.dart';
import 'screens/partner_application_status_screen.dart';
import 'screens/partner_apply_screen.dart';
import 'screens/partner_onboard_screen.dart';
import 'screens/partner_payouts_screen.dart';
import 'screens/partner_payouts_v2_page_screen.dart';
import 'screens/partner_payouts_v2_screen.dart';
import 'screens/partner_self_service_screen.dart';
import 'screens/pay_request_screen.dart';
import 'screens/payment_cancel_screen.dart';
import 'screens/payment_methods_screen.dart';
import 'screens/payment_performance_screen.dart';
import 'screens/payment_rails_page_screen.dart';
import 'screens/payment_rails_screen.dart';
import 'screens/payment_success_screen.dart';
import 'screens/payroll_run_screen.dart';
import 'screens/presentation_deck_screen.dart';
import 'screens/private_banking_dashboard_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/promo_code_admin_screen.dart';
import 'screens/promo_codes_admin_screen.dart';
import 'screens/property_k_y_c_screen.dart';
import 'screens/pwa_features_screen.dart';
import 'screens/q_r_code_screen.dart';
import 'screens/qr_pay_screen.dart';
import 'screens/rails_health_dashboard_screen.dart';
import 'screens/rate_alert_history_page_screen.dart';
import 'screens/rate_alert_history_screen.dart';
import 'screens/rate_calculator_screen.dart';
import 'screens/rate_lock_screen.dart';
import 'screens/real_estate_hub_screen.dart';
import 'screens/real_time_transaction_monitor_screen.dart';
import 'screens/receive_money_screen.dart';
import 'screens/recipient_onboarding_screen.dart';
import 'screens/reconciliation_v2_page_screen.dart';
import 'screens/reconciliation_v2_screen.dart';
import 'screens/recurring_payments_screen.dart';
import 'screens/recurring_screen.dart';
import 'screens/referral_dashboard_screen.dart';
import 'screens/referral_screen.dart';
import 'screens/regulatory_reporting_page_screen.dart';
import 'screens/regulatory_reporting_screen.dart';
import 'screens/request_money_screen.dart';
import 'screens/revenue_analytics_page_screen.dart';
import 'screens/revenue_analytics_screen.dart';
import 'screens/revenue_share_p_w_a_screen.dart';
import 'screens/revenue_share_pwa_screen.dart' as pwa_compat;
import 'screens/revenue_share_screen.dart';
import 'screens/s_l_a_monitor_screen.dart';
import 'screens/s_m_e_trade_payment_screen.dart';
import 'screens/s_w_i_f_t_tracker_page_screen.dart';
import 'screens/sanctions_screening_page_screen.dart';
import 'screens/sanctions_screening_screen.dart';
import 'screens/sandbox_scenarios_screen.dart';
import 'screens/savings_goals_screen.dart';
import 'screens/savings_screen.dart';
import 'screens/scheduled_transfers_v2_screen.dart';
import 'screens/security_attack_simulator_screen.dart';
import 'screens/security_audit_report_screen.dart';
import 'screens/security_dashboard_screen.dart';
import 'screens/security_events_log_screen.dart';
import 'screens/security_score_screen.dart';
import 'screens/security_settings_screen.dart';
import 'screens/self_unlock_screen.dart';
import 'screens/send_crypto_screen.dart';
import 'screens/send_from_nigeria_screen.dart';
import 'screens/send_money_screen.dart';
import 'screens/send_to_benin_screen.dart';
import 'screens/send_to_cameroon_screen.dart';
import 'screens/send_to_ghana_screen.dart';
import 'screens/send_to_kenya_screen.dart';
import 'screens/send_to_mali_screen.dart';
import 'screens/send_to_niger_screen.dart';
import 'screens/send_abroad_screen.dart';
import 'screens/send_to_nigeria_screen.dart';
import 'screens/send_to_senegal_screen.dart';
import 'screens/send_to_south_africa_screen.dart';
import 'screens/send_to_tanzania_screen.dart';
import 'screens/send_to_togo_screen.dart';
import 'screens/send_to_uganda_screen.dart';
import 'screens/services_health_dashboard_screen.dart' as shd_compat;
import 'screens/settings_screen.dart';
import 'screens/settlement_netting_page_screen.dart';
import 'screens/settlement_netting_screen.dart';
import 'screens/similar_transactions_page_screen.dart';
import 'screens/similar_transactions_screen.dart';
import 'screens/smart_routing_dashboard_screen.dart';
import 'screens/smart_routing_v2_page_screen.dart';
import 'screens/smart_routing_v2_screen.dart';
import 'screens/sme_trade_form_m_history_screen.dart';
import 'screens/sme_trade_payment_screen.dart';
import 'screens/split_bill_screen.dart';
import 'screens/stablecoin_screen.dart';
import 'screens/startup_deal_room_screen.dart';
import 'screens/stripe_payment_history_screen.dart';
import 'screens/stripe_receipts_screen.dart';
import 'screens/stripe_retry_admin_screen.dart';
import 'screens/subscription_tiers_screen.dart';
import 'screens/support_screen.dart';
import 'screens/support_tickets_screen.dart';
import 'screens/swift_tracker_screen.dart';
import 'screens/system_config_admin_screen.dart';
import 'screens/system_config_page_screen.dart';
import 'screens/system_health_dashboard_v2_screen.dart';
import 'screens/talent_bridge_screen.dart';
import 'screens/tenant_admin_screen.dart';
import 'screens/tenant_config_page_screen.dart';
import 'screens/tenant_config_screen.dart';
import 'screens/tenant_dashboard_screen.dart';
import 'screens/tenant_feature_flags_admin_screen.dart';
import 'screens/tenant_onboarding_wizard_screen.dart';
import 'screens/tiered_k_y_c_flow_screen.dart';
import 'screens/transaction_export_screen.dart';
import 'screens/transaction_history_screen.dart';
import 'screens/transaction_receipt_screen.dart';
import 'screens/transaction_search_screen.dart';
import 'screens/transactions_screen.dart';
import 'screens/transfer_analytics_screen.dart';
import 'screens/transfer_audit_trail_screen.dart';
import 'screens/transfer_dispute_form_screen.dart';
import 'screens/transfer_goals_screen.dart';
import 'screens/transfer_limits_screen.dart';
import 'screens/transfer_limits_v2_page_screen.dart';
import 'screens/transfer_limits_v2_screen.dart';
import 'screens/transfer_tracking_screen.dart';
import 'screens/travel_rule_screen.dart';
import 'screens/treasury_dashboard_page_screen.dart';
import 'screens/treasury_dashboard_screen.dart';
import 'screens/treasury_management_screen.dart';
import 'screens/trisa_compliance_screen.dart';
import 'screens/user_onboarding_screen.dart';
import 'screens/v_a_p_i_d_push_manager_screen.dart';
import 'screens/vector_search_page_screen.dart';
import 'screens/vector_search_screen.dart';
import 'screens/velocity_check_dashboard_screen.dart';
import 'screens/virtual_account_screen.dart';
import 'screens/wallet_screen.dart';
import 'screens/webhook_admin_screen.dart';
import 'screens/webhook_manager_screen.dart';
import 'screens/webhook_retry_page_screen.dart';
import 'screens/webhook_retry_screen.dart';
import 'screens/wise_transfer_screen.dart';

// ── Router Configuration ────────────────────────────────────────────────────
final _router = GoRouter(
  initialLocation: '/dashboard',
  redirect: (context, state) => null,
  routes: [
    GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
    GoRoute(path: '/onboarding', builder: (context, state) => const OnboardingScreen()),
    ShellRoute(
      builder: (context, state, child) => MainShell(child: child),
      routes: [
        GoRoute(path: '/dashboard', builder: (context, state) => const DashboardScreen()),
        GoRoute(path: '/send', builder: (context, state) => const SendMoneyScreen()),
        GoRoute(path: '/transactions', builder: (context, state) => const TransactionHistoryScreen()),
        GoRoute(path: '/wallet', builder: (context, state) => const WalletScreen()),
        GoRoute(path: '/profile', builder: (context, state) => const ProfileScreen()),
      ],
    ),
    // ── All 378 feature screens ─────────────────────────────────────
    GoRoute(path: '/a-b-testing-admin', builder: (context, state) => const ABTestingAdminScreen()),
    GoRoute(path: '/a-i-hub', builder: (context, state) => const AIHubScreen()),
    GoRoute(path: '/a-i-metrics-dashboard', builder: (context, state) => const AIMetricsDashboardScreen()),
    GoRoute(path: '/a-m-l-batch-engine-page', builder: (context, state) => const AMLBatchEnginePageScreen()),
    GoRoute(path: '/a-p-i-changelog', builder: (context, state) => const APIChangelogScreen()),
    GoRoute(path: '/a-p-i-key-manager', builder: (context, state) => const APIKeyManagerScreen()),
    GoRoute(path: '/a-p-i-usage-dashboard', builder: (context, state) => const APIUsageDashboardScreen()),
    GoRoute(path: '/a-r-t-agent-page', builder: (context, state) => const ARTAgentPageScreen()),
    GoRoute(path: '/account-health', builder: (context, state) => const AccountHealthScreen()),
    GoRoute(path: '/admin-analytics', builder: (context, state) => const AdminAnalyticsScreen()),
    GoRoute(path: '/admin-audit-log', builder: (context, state) => const AdminAuditLogScreen()),
    GoRoute(path: '/admin-bulk-actions', builder: (context, state) => const AdminBulkActionsScreen()),
    GoRoute(path: '/admin-compliance', builder: (context, state) => const AdminComplianceScreen()),
    GoRoute(path: '/admin-digital-agreements', builder: (context, state) => const AdminDigitalAgreementsScreen()),
    GoRoute(path: '/admin-disputes', builder: (context, state) => const AdminDisputesScreen()),
    GoRoute(path: '/admin-feature-flags', builder: (context, state) => const AdminFeatureFlagsScreen()),
    GoRoute(path: '/admin-home', builder: (context, state) => const AdminHomeScreen()),
    GoRoute(path: '/admin-invite-codes', builder: (context, state) => const AdminInviteCodesScreen()),
    GoRoute(path: '/admin-k-y-c', builder: (context, state) => const AdminKYCScreen()),
    GoRoute(path: '/admin-microservices', builder: (context, state) => const AdminMicroservicesScreen()),
    GoRoute(path: '/admin-nav-analytics', builder: (context, state) => const AdminNavAnalyticsScreen()),
    GoRoute(path: '/admin-partner-applications', builder: (context, state) => const AdminPartnerApplicationsScreen()),
    GoRoute(path: '/admin-readiness', builder: (context, state) => const AdminReadinessScreen()),
    GoRoute(path: '/admin-revenue-share', builder: (context, state) => const AdminRevenueShareScreen()),
    GoRoute(path: '/admin-seed-data', builder: (context, state) => const AdminSeedDataScreen()),
    GoRoute(path: '/admin-stripe-test', builder: (context, state) => const AdminStripeTestScreen()),
    GoRoute(path: '/admin-tenants', builder: (context, state) => const AdminTenantsScreen()),
    GoRoute(path: '/admin-users', builder: (context, state) => const AdminUsersScreen()),
    GoRoute(path: '/admin-white-label', builder: (context, state) => const AdminWhiteLabelScreen()),
    GoRoute(path: '/afri-market', builder: (context, state) => const AfriMarketScreen()),
    GoRoute(path: '/agent-cash-in', builder: (context, state) => const AgentCashInScreen()),
    GoRoute(path: '/agent-k-y-b-admin', builder: (context, state) => const AgentKYBAdminScreen()),
    GoRoute(path: '/agent-kyb-admin', builder: (context, state) => const AgentKybAdminScreen()),
    GoRoute(path: '/agent-network', builder: (context, state) => const AgentNetworkScreen()),
    GoRoute(path: '/agent-p-o-s', builder: (context, state) => const AgentPOSScreen()),
    GoRoute(path: '/agent-register', builder: (context, state) => const AgentRegisterScreen()),
    GoRoute(path: '/airtime', builder: (context, state) => const AirtimeScreen()),
    GoRoute(path: '/aml-batch-engine', builder: (context, state) => const AMLBatchEngineScreen()),
    GoRoute(path: '/analytics', builder: (context, state) => const AnalyticsScreen()),
    GoRoute(path: '/api-key-admin-page', builder: (context, state) => const ApiKeyAdminPageScreen()),
    GoRoute(path: '/api-key-admin', builder: (context, state) => const ApiKeyAdminScreen()),
    GoRoute(path: '/art-agent', builder: (context, state) => const ARTAgentScreen()),
    GoRoute(path: '/audit-log-admin', builder: (context, state) => const AuditLogAdminScreen()),
    GoRoute(path: '/audit-log-viewer', builder: (context, state) => const AuditLogViewerScreen()),
    GoRoute(path: '/audit-logs', builder: (context, state) => const AuditLogsScreen()),
    GoRoute(path: '/audit-trail-v2-page', builder: (context, state) => const AuditTrailV2PageScreen()),
    GoRoute(path: '/audit-trail-v2', builder: (context, state) => const AuditTrailV2Screen()),
    GoRoute(path: '/b-d-c-partner-portal', builder: (context, state) => const BDCPartnerPortalScreen()),
    GoRoute(path: '/batch-payment-admin', builder: (context, state) => const BatchPaymentAdminScreen()),
    GoRoute(path: '/batch-payments', builder: (context, state) => const BatchPaymentsScreen()),
    GoRoute(path: '/bdc-onboarding-email-preview', builder: (context, state) => const BdcOnboardingEmailPreviewScreen()),
    GoRoute(path: '/beneficiaries', builder: (context, state) => const BeneficiariesScreen()),
    GoRoute(path: '/beneficiary-manager', builder: (context, state) => const BeneficiaryManagerScreen()),
    GoRoute(path: '/beneficiary', builder: (context, state) => const BeneficiaryScreen()),
    GoRoute(path: '/beyond-remittance', builder: (context, state) => const BeyondRemittanceScreen()),
    GoRoute(path: '/bill-payment', builder: (context, state) => const BillPaymentScreen()),
    GoRoute(path: '/billing-engine-dashboard', builder: (context, state) => const BillingEngineDashboard()),
    GoRoute(path: '/bills', builder: (context, state) => const BillsScreen()),
    GoRoute(path: '/bnpl', builder: (context, state) => const BnplScreen()),
    GoRoute(path: '/bond-secondary-market', builder: (context, state) => const AppColors()),
    GoRoute(path: '/branding-preview', builder: (context, state) => const BrandingPreviewScreen()),
    GoRoute(path: '/bulk-payments-v2-page', builder: (context, state) => const BulkPaymentsV2PageScreen()),
    GoRoute(path: '/bulk-payments-v2', builder: (context, state) => const BulkPaymentsV2Screen()),
    GoRoute(path: '/bulk-user-actions', builder: (context, state) => const BulkUserActionsScreen()),
    GoRoute(path: '/business-credit-scoring', builder: (context, state) => const CreditScore()),
    GoRoute(path: '/business-savings', builder: (context, state) => const BusinessSavingsAccount()),
    GoRoute(path: '/c-b-d-c-admin', builder: (context, state) => const CBDCAdminScreen()),
    GoRoute(path: '/cbdc-admin', builder: (context, state) => const CBDCAdminScreen()),
    GoRoute(path: '/c-b-d-c', builder: (context, state) => const CBDCScreen()),
    GoRoute(path: '/c-t-r-compliance', builder: (context, state) => const CTRComplianceScreen()),
    GoRoute(path: '/carbon-offset-page', builder: (context, state) => const CarbonOffsetPageScreen()),
    GoRoute(path: '/carbon-offset', builder: (context, state) => const CarbonOffsetScreen()),
    GoRoute(path: '/cards', builder: (context, state) => const CardsScreen()),
    GoRoute(path: '/cbdc', builder: (context, state) => const CbdcScreen()),
    GoRoute(path: '/chargeback-manager', builder: (context, state) => const ChargebackManagerScreen()),
    GoRoute(path: '/chat-agent-dashboard', builder: (context, state) => const ChatAgentDashboardScreen()),
    GoRoute(path: '/checkout-s-d-k', builder: (context, state) => const CheckoutSDKScreen()),
    GoRoute(path: '/checkout-sdk', builder: (context, state) => const CheckoutSdkScreen()),
    GoRoute(path: '/circuit-breaker-dashboard', builder: (context, state) => const CircuitBreakerDashboardScreen()),
    GoRoute(path: '/coco-index-page', builder: (context, state) => const CocoIndexPageScreen()),
    GoRoute(path: '/coco-index', builder: (context, state) => const CocoIndexScreen()),
    GoRoute(path: '/community-feed', builder: (context, state) => const CommunityFeedScreen()),
    GoRoute(path: '/community-hub', builder: (context, state) => const CommunityHubScreen()),
    GoRoute(path: '/community-leaderboard', builder: (context, state) => const CommunityLeaderboardScreen()),
    GoRoute(path: '/community', builder: (context, state) => const CommunityScreen()),
    GoRoute(path: '/compliance-alerts', builder: (context, state) => const ComplianceAlertsScreen()),
    GoRoute(path: '/compliance-email-config', builder: (context, state) => const ComplianceEmailConfigScreen()),
    GoRoute(path: '/compliance-form-m-audit', builder: (context, state) => const ComplianceFormMAuditScreen()),
    GoRoute(path: '/compliance-metrics-dashboard', builder: (context, state) => const ComplianceMetricsDashboardScreen()),
    GoRoute(path: '/compliance-reporting', builder: (context, state) => const ComplianceReportingScreen()),
    GoRoute(path: '/compliance-scoring-page', builder: (context, state) => const ComplianceScoringPageScreen()),
    GoRoute(path: '/compliance-scoring', builder: (context, state) => const ComplianceScoringScreen()),
    GoRoute(path: '/compliance-watchlist-page', builder: (context, state) => const ComplianceWatchlistPageScreen()),
    GoRoute(path: '/compliance-watchlist', builder: (context, state) => const ComplianceWatchlistScreen()),
    GoRoute(path: '/component-showcase', builder: (context, state) => const ComponentShowcaseScreen()),
    GoRoute(path: '/consent-management', builder: (context, state) => const ConsentManagementScreen()),
    GoRoute(path: '/contractor-payments', builder: (context, state) => const Invoice()),
    GoRoute(path: '/conversational-payments', builder: (context, state) => const ConversationalPaymentsScreen()),
    GoRoute(path: '/corridor-pricing-admin', builder: (context, state) => const CorridorPricingAdminScreen()),
    GoRoute(path: '/corridor-pricing', builder: (context, state) => const CorridorPricingScreen()),
    GoRoute(path: '/cron-jobs-admin', builder: (context, state) => const CronJobsAdminScreen()),
    GoRoute(path: '/cross-border-compliance-page', builder: (context, state) => const CrossBorderCompliancePageScreen()),
    GoRoute(path: '/cross-border-compliance', builder: (context, state) => const CrossBorderComplianceScreen()),
    GoRoute(path: '/cross-sell-marketplace', builder: (context, state) => const CrossSellMarketplaceScreen()),
    GoRoute(path: '/d-p-i-a', builder: (context, state) => const DPIAScreen()),
    GoRoute(path: '/daily-volume-widget', builder: (context, state) => const DailyVolumeWidgetScreen()),
    GoRoute(path: '/data-pipelines-page', builder: (context, state) => const DataPipelinesPageScreen()),
    GoRoute(path: '/data-pipelines', builder: (context, state) => const DataPipelinesScreen()),
    GoRoute(path: '/developer-sandbox', builder: (context, state) => const DeveloperSandboxScreen()),
    GoRoute(path: '/diaspora-bond-market', builder: (context, state) => const DiasporaBondMarketScreen()),
    GoRoute(path: '/diaspora-canada', builder: (context, state) => const DiasporaCanadaScreen()),
    GoRoute(path: '/diaspora-e-u', builder: (context, state) => const DiasporaEUScreen()),
    GoRoute(path: '/diaspora-eu', builder: (context, state) => const DiasporaEU()),
    GoRoute(path: '/diaspora-invest', builder: (context, state) => const DiasporaInvestScreen()),
    GoRoute(path: '/diaspora-italy', builder: (context, state) => const DiasporaItalyScreen()),
    GoRoute(path: '/diaspora-mortgage', builder: (context, state) => const DiasporaMortgageScreen()),
    GoRoute(path: '/diaspora-u-k', builder: (context, state) => const DiasporaUKScreen()),
    GoRoute(path: '/diaspora-u-s-a', builder: (context, state) => const DiasporaUSAScreen()),
    GoRoute(path: '/diaspora-usa', builder: (context, state) => const DiasporaUSA()),
    GoRoute(path: '/direct-debit', builder: (context, state) => const DirectDebitScreen()),
    GoRoute(path: '/dispute-management-page', builder: (context, state) => const DisputeManagementPageScreen()),
    GoRoute(path: '/dispute-management', builder: (context, state) => const DisputeManagementScreen()),
    GoRoute(path: '/disputes', builder: (context, state) => const DisputesScreen()),
    GoRoute(path: '/document-o-c-r-page', builder: (context, state) => const DocumentOCRPageScreen()),
    GoRoute(path: '/document-ocr', builder: (context, state) => const DocumentOCRScreen()),
    GoRoute(path: '/document-vault-page', builder: (context, state) => const DocumentVaultPageScreen()),
    GoRoute(path: '/document-vault-renewal', builder: (context, state) => const DocumentVaultRenewalScreen()),
    GoRoute(path: '/document-vault', builder: (context, state) => const DocumentVaultScreen()),
    GoRoute(path: '/e-s-g-reporting', builder: (context, state) => const ESGReportingScreen()),
    GoRoute(path: '/education-payments', builder: (context, state) => const EducationPaymentsScreen()),
    GoRoute(path: '/embedded-payroll-a-p-i', builder: (context, state) => const EmbeddedPayrollAPIScreen()),
    GoRoute(path: '/embedded-payroll-api', builder: (context, state) => const EmbeddedPayrollApiScreen()),
    GoRoute(path: '/esg-reporting', builder: (context, state) => const EsgReport()),
    GoRoute(path: '/exchange-rates', builder: (context, state) => const ExchangeRatesScreen()),
    GoRoute(path: '/expense-management', builder: (context, state) => const ExpenseManagementScreen()),
    GoRoute(path: '/f-c-a-compliance', builder: (context, state) => const FCAComplianceScreen()),
    GoRoute(path: '/f-x-alerts', builder: (context, state) => const FXAlertsScreen()),
    GoRoute(path: '/f-x-hedging-page', builder: (context, state) => const FXHedgingPageScreen()),
    GoRoute(path: '/f-x-hedging', builder: (context, state) => const FXHedgingScreen()),
    GoRoute(path: '/f-x-options-pricing-page', builder: (context, state) => const FXOptionsPricingPageScreen()),
    GoRoute(path: '/f-x-rate-alerts', builder: (context, state) => const FXRateAlertsScreen()),
    GoRoute(path: '/f-x-streaming-page', builder: (context, state) => const FXStreamingPageScreen()),
    GoRoute(path: '/family-dashboard', builder: (context, state) => const FamilyDashboardScreen()),
    GoRoute(path: '/feature-flag-admin', builder: (context, state) => const FeatureFlagAdminScreen()),
    GoRoute(path: '/feature-flags-admin', builder: (context, state) => const FeatureFlagsAdminScreen()),
    GoRoute(path: '/fednow-transfer', builder: (context, state) => const FedNowTransferScreen()),
    GoRoute(path: '/fee-negotiation-page', builder: (context, state) => const FeeNegotiationPageScreen()),
    GoRoute(path: '/fee-negotiation', builder: (context, state) => const FeeNegotiationScreen()),
    GoRoute(path: '/fee-rules-c-r-u-d-page', builder: (context, state) => const FeeRulesCRUDPageScreen()),
    GoRoute(path: '/fee-rules-c-r-u-d-v2-page', builder: (context, state) => const FeeRulesCRUDV2PageScreen()),
    GoRoute(path: '/fee-rules-crud', builder: (context, state) => const FeeRulesCRUDScreen()),
    GoRoute(path: '/fee-rules-crud-v2', builder: (context, state) => const FeeRulesCRUDV2Screen()),
    GoRoute(path: '/fee-rules-v2', builder: (context, state) => const FeeRulesCRUDV2Screen()),
    GoRoute(path: '/fee-rules-engine', builder: (context, state) => const FeeRulesEngineScreen()),
    GoRoute(path: '/float-income-dashboard', builder: (context, state) => const FloatIncomeDashboardScreen()),
    GoRoute(path: '/form-m-history', builder: (context, state) => const FormMHistoryScreen()),
    GoRoute(path: '/formalization-dashboard', builder: (context, state) => const FormalizationDashboardScreen()),
    GoRoute(path: '/fraud-detection-v2-page', builder: (context, state) => const FraudDetectionV2PageScreen()),
    GoRoute(path: '/fraud-detection-v2', builder: (context, state) => const FraudDetectionV2Screen()),
    GoRoute(path: '/fraud-monitor', builder: (context, state) => const FraudMonitorScreen()),
    GoRoute(path: '/fx-alerts', builder: (context, state) => const FxAlertsScreen()),
    GoRoute(path: '/fx-options-pricing', builder: (context, state) => const FXOptionsPricingScreen()),
    GoRoute(path: '/fx-streaming', builder: (context, state) => const FXStreamingScreen()),
    GoRoute(path: '/g-d-p-r-data', builder: (context, state) => const GDPRDataScreen()),
    GoRoute(path: '/g-d-p-r-erasure', builder: (context, state) => const GDPRErasureScreen()),
    GoRoute(path: '/global-payroll', builder: (context, state) => const GlobalPayrollScreen()),
    GoRoute(path: '/global-search', builder: (context, state) => const GlobalSearchScreen()),
    GoRoute(path: '/grafana-dashboard-page', builder: (context, state) => const GrafanaDashboardPageScreen()),
    GoRoute(path: '/grafana-dashboard', builder: (context, state) => const GrafanaDashboardScreen()),
    GoRoute(path: '/help', builder: (context, state) => const HelpScreen()),
    GoRoute(path: '/hnw-private-banking', builder: (context, state) => const HnwPrivateBankingScreen()),
    GoRoute(path: '/home', builder: (context, state) => const HomeScreen()),
    GoRoute(path: '/i-p-login-history', builder: (context, state) => const IPLoginHistoryScreen()),
    GoRoute(path: '/immigrant-worker-send', builder: (context, state) => const ImmigrantWorkerSendScreen()),
    GoRoute(path: '/investment-portfolio', builder: (context, state) => const InvestmentPortfolioScreen()),
    GoRoute(path: '/invoice-financing', builder: (context, state) => const InvoiceFinancing()),
    GoRoute(path: '/k-g-q-a-page', builder: (context, state) => const KGQAPageScreen()),
    GoRoute(path: '/kgqa', builder: (context, state) => const KGQAPageScreen()),
    GoRoute(path: '/k-y-c-admin-queue', builder: (context, state) => const KYCAdminQueueScreen()),
    GoRoute(path: '/k-y-c-lifecycle-page', builder: (context, state) => const KYCLifecyclePageScreen()),
    GoRoute(path: '/k-y-c-lifecycle-tracker', builder: (context, state) => const KYCLifecycleTrackerScreen()),
    GoRoute(path: '/k-y-c-verification', builder: (context, state) => const KYCVerificationScreen()),
    GoRoute(path: '/kafka-dashboard', builder: (context, state) => const KafkaDashboardScreen()),
    GoRoute(path: '/kg-qa', builder: (context, state) => const KGQAScreen()),
    GoRoute(path: '/knowledge-graph-page', builder: (context, state) => const KnowledgeGraphPageScreen()),
    GoRoute(path: '/knowledge-graph', builder: (context, state) => const KnowledgeGraphScreen()),
    GoRoute(path: '/kyc-lifecycle', builder: (context, state) => const KYCLifecycleScreen()),
    GoRoute(path: '/kyc', builder: (context, state) => const KycScreen()),
    GoRoute(path: '/lakehouse-analytics', builder: (context, state) => const LakehouseAnalyticsScreen()),
    GoRoute(path: '/lakehouse-page', builder: (context, state) => const LakehousePageScreen()),
    GoRoute(path: '/lakehouse', builder: (context, state) => const LakehouseScreen()),
    GoRoute(path: '/landing-page', builder: (context, state) => const LandingPageScreen()),
    GoRoute(path: '/landing', builder: (context, state) => const LandingScreen()),
    GoRoute(path: '/ledger-page', builder: (context, state) => const LedgerPageScreen()),
    GoRoute(path: '/ledger-reconciliation', builder: (context, state) => const LedgerReconciliationScreen()),
    GoRoute(path: '/ledger', builder: (context, state) => const LedgerScreen()),
    GoRoute(path: '/letter-of-credit', builder: (context, state) => const LetterOfCreditScreen()),
    GoRoute(path: '/liquidity-monitor-page', builder: (context, state) => const LiquidityMonitorPageScreen()),
    GoRoute(path: '/liquidity-monitor', builder: (context, state) => const LiquidityMonitorScreen()),
    GoRoute(path: '/liquidity-stress-test-page', builder: (context, state) => const LiquidityStressTestPageScreen()),
    GoRoute(path: '/liquidity-stress-test', builder: (context, state) => const LiquidityStressTestScreen()),
    GoRoute(path: '/live-chat', builder: (context, state) => const LiveChatScreen()),
    GoRoute(path: '/live-f-x-calculator', builder: (context, state) => const LiveFXCalculatorScreen()),
    GoRoute(path: '/load-test-dashboard', builder: (context, state) => const LoadTestDashboardScreen()),
    GoRoute(path: '/loyalty-rewards-v2-page', builder: (context, state) => const LoyaltyRewardsV2PageScreen()),
    GoRoute(path: '/loyalty-rewards-v2', builder: (context, state) => const LoyaltyRewardsV2Screen()),
    GoRoute(path: '/m-f-a-settings', builder: (context, state) => const MFASettingsScreen()),
    GoRoute(path: '/m-pesa', builder: (context, state) => const MPesaScreen()),
    GoRoute(path: '/mpesa', builder: (context, state) => const MPesaScreen()),
    GoRoute(path: '/medical-tourism', builder: (context, state) => const MedicalTourismScreen()),
    GoRoute(path: '/merchant-k-y-b-page', builder: (context, state) => const MerchantKYBPageScreen()),
    GoRoute(path: '/merchant-k-y-b-review', builder: (context, state) => const MerchantKYBReviewScreen()),
    GoRoute(path: '/merchant-kyb-review', builder: (context, state) => const MerchantKybReviewScreen()),
    GoRoute(path: '/merchant-kyb', builder: (context, state) => const MerchantKYBScreen()),
    GoRoute(path: '/merchant-onboarding-page', builder: (context, state) => const MerchantOnboardingPageScreen()),
    GoRoute(path: '/merchant-onboarding', builder: (context, state) => const MerchantOnboardingScreen()),
    GoRoute(path: '/middleware-health', builder: (context, state) => const MiddlewareHealthScreen()),
    GoRoute(path: '/mojaloop', builder: (context, state) => const MojaloopScreen()),
    GoRoute(path: '/multi-currency-ledger-page', builder: (context, state) => const MultiCurrencyLedgerPageScreen()),
    GoRoute(path: '/multi-currency-ledger', builder: (context, state) => const MultiCurrencyLedgerScreen()),
    GoRoute(path: '/multi-currency-wallet-v2-page', builder: (context, state) => const MultiCurrencyWalletV2PageScreen()),
    GoRoute(path: '/multi-currency-wallet-v2', builder: (context, state) => const MultiCurrencyWalletV2Screen()),
    GoRoute(path: '/multi-hop-routing-page', builder: (context, state) => const MultiHopRoutingPageScreen()),
    GoRoute(path: '/multi-hop-routing', builder: (context, state) => const MultiHopRoutingScreen()),
    GoRoute(path: '/my-tenants', builder: (context, state) => const MyTenantsScreen()),
    GoRoute(path: '/my-transfers', builder: (context, state) => const MyTransfersScreen()),
    GoRoute(path: '/n-g-x-stock-market', builder: (context, state) => const NGXStockMarketScreen()),
    GoRoute(path: '/not-found', builder: (context, state) => const NotFoundScreen()),
    GoRoute(path: '/notification-center-page', builder: (context, state) => const NotificationCenterPageScreen()),
    GoRoute(path: '/notification-center', builder: (context, state) => const NotificationCenterScreen()),
    GoRoute(path: '/notification-center-v2-page', builder: (context, state) => const NotificationCenterV2PageScreen()),
    GoRoute(path: '/notification-center-v2', builder: (context, state) => const NotificationCenterV2Screen()),
    GoRoute(path: '/notification-preferences', builder: (context, state) => const NotificationPreferencesScreen()),
    GoRoute(path: '/notification-settings', builder: (context, state) => const NotificationSettingsScreen()),
    GoRoute(path: '/notifications', builder: (context, state) => const NotificationsScreen()),
    GoRoute(path: '/ollama-chat-page', builder: (context, state) => const OllamaChatPageScreen()),
    GoRoute(path: '/ollama-chat', builder: (context, state) => const OllamaChatScreen()),
    GoRoute(path: '/open-banking-page', builder: (context, state) => const OpenBankingPageScreen()),
    GoRoute(path: '/open-banking', builder: (context, state) => const OpenBankingScreen()),
    GoRoute(path: '/outbound-revenue-model', builder: (context, state) => const OutboundRevenueModelScreen()),
    GoRoute(path: '/p-b-a-c-policies', builder: (context, state) => const PBACPoliciesScreen()),
    GoRoute(path: '/pbac-policies', builder: (context, state) => const PBACPoliciesScreen()),
    GoRoute(path: '/p-o-s-management', builder: (context, state) => const POSManagementScreen()),
    GoRoute(path: '/p-w-a-dashboard', builder: (context, state) => const PWADashboardScreen()),
    GoRoute(path: '/p-w-a-features', builder: (context, state) => const PWAFeaturesScreen()),
    GoRoute(path: '/papss-compliance', builder: (context, state) => const PapssComplianceScreen()),
    GoRoute(path: '/partner-analytics', builder: (context, state) => const PartnerAnalyticsScreen()),
    GoRoute(path: '/partner-application-status', builder: (context, state) => const PartnerApplicationStatusScreen()),
    GoRoute(path: '/partner-apply', builder: (context, state) => const PartnerApplyScreen()),
    GoRoute(path: '/partner-onboard', builder: (context, state) => const PartnerOnboardScreen()),
    GoRoute(path: '/partner-payouts', builder: (context, state) => const PartnerPayoutsScreen()),
    GoRoute(path: '/partner-payouts-v2-page', builder: (context, state) => const PartnerPayoutsV2PageScreen()),
    GoRoute(path: '/partner-payouts-v2', builder: (context, state) => const PartnerPayoutsV2Screen()),
    GoRoute(path: '/partner-self-service', builder: (context, state) => const PartnerSelfServiceScreen()),
    GoRoute(path: '/pay-request', builder: (context, state) => const PayRequestScreen()),
    GoRoute(path: '/payment-cancel', builder: (context, state) => const PaymentCancelScreen()),
    GoRoute(path: '/payment-methods', builder: (context, state) => const PaymentMethodsScreen()),
    GoRoute(path: '/payment-performance', builder: (context, state) => const PaymentPerformanceScreen()),
    GoRoute(path: '/payment-rails-page', builder: (context, state) => const PaymentRailsPageScreen()),
    GoRoute(path: '/payment-rails', builder: (context, state) => const PaymentRailsScreen()),
    GoRoute(path: '/payment-success', builder: (context, state) => const PaymentSuccessScreen()),
    GoRoute(path: '/payroll-run', builder: (context, state) => const PayrollRunScreen()),
    GoRoute(path: '/presentation-deck', builder: (context, state) => const PresentationDeckScreen()),
    GoRoute(path: '/private-banking-dashboard', builder: (context, state) => const PrivateBankingDashboardScreen()),
    GoRoute(path: '/promo-code-admin', builder: (context, state) => const PromoCodeAdminScreen()),
    GoRoute(path: '/promo-codes-admin', builder: (context, state) => const PromoCodesAdminScreen()),
    GoRoute(path: '/property-k-y-c', builder: (context, state) => const PropertyKYCScreen()),
    GoRoute(path: '/pwa-features', builder: (context, state) => const PwaFeaturesScreen()),
    GoRoute(path: '/q-r-code', builder: (context, state) => const QRCodeScreen()),
    GoRoute(path: '/qr-pay', builder: (context, state) => const QrPayScreen()),
    GoRoute(path: '/rails-health-dashboard', builder: (context, state) => const RailsHealthDashboardScreen()),
    GoRoute(path: '/rate-alert-history-page', builder: (context, state) => const RateAlertHistoryPageScreen()),
    GoRoute(path: '/rate-alert-history', builder: (context, state) => const RateAlertHistoryScreen()),
    GoRoute(path: '/rate-calculator', builder: (context, state) => const RateCalculatorScreen()),
    GoRoute(path: '/rate-lock', builder: (context, state) => const RateLockScreen()),
    GoRoute(path: '/real-estate-hub', builder: (context, state) => const RealEstateHubScreen()),
    GoRoute(path: '/real-time-transaction-monitor', builder: (context, state) => const RealTimeTransactionMonitorScreen()),
    GoRoute(path: '/receive-money', builder: (context, state) => const ReceiveMoneyScreen()),
    GoRoute(path: '/recipient-onboarding', builder: (context, state) => const RecipientOnboardingScreen()),
    GoRoute(path: '/reconciliation-v2-page', builder: (context, state) => const ReconciliationV2PageScreen()),
    GoRoute(path: '/reconciliation-v2', builder: (context, state) => const ReconciliationV2Screen()),
    GoRoute(path: '/recurring-payments', builder: (context, state) => const RecurringPaymentsScreen()),
    GoRoute(path: '/recurring', builder: (context, state) => const RecurringScreen()),
    GoRoute(path: '/referral-dashboard', builder: (context, state) => const ReferralDashboardScreen()),
    GoRoute(path: '/referral', builder: (context, state) => const ReferralScreen()),
    GoRoute(path: '/regulatory-reporting-page', builder: (context, state) => const RegulatoryReportingPageScreen()),
    GoRoute(path: '/regulatory-reporting', builder: (context, state) => const RegulatoryReportingScreen()),
    GoRoute(path: '/request-money', builder: (context, state) => const RequestMoneyScreen()),
    GoRoute(path: '/revenue-analytics-page', builder: (context, state) => const RevenueAnalyticsPageScreen()),
    GoRoute(path: '/revenue-analytics', builder: (context, state) => const RevenueAnalyticsScreen()),
    GoRoute(path: '/revenue-share-p-w-a', builder: (context, state) => const RevenueSharePWAScreen()),
    GoRoute(path: '/revenue-share-pwa', builder: (context, state) => const RevenueSharePWAScreen()),
    GoRoute(path: '/revenue-share', builder: (context, state) => const RevenueShareScreen()),
    GoRoute(path: '/s-l-a-monitor', builder: (context, state) => const SLAMonitorScreen()),
    GoRoute(path: '/s-m-e-trade-payment', builder: (context, state) => const SMETradePaymentScreen()),
    GoRoute(path: '/s-w-i-f-t-tracker-page', builder: (context, state) => const SWIFTTrackerPageScreen()),
    GoRoute(path: '/sanctions-screening-page', builder: (context, state) => const SanctionsScreeningPageScreen()),
    GoRoute(path: '/sanctions-screening', builder: (context, state) => const SanctionsScreeningScreen()),
    GoRoute(path: '/sandbox-scenarios', builder: (context, state) => const SandboxScenariosScreen()),
    GoRoute(path: '/savings-goals', builder: (context, state) => const SavingsGoalsScreen()),
    GoRoute(path: '/savings', builder: (context, state) => const SavingsScreen()),
    GoRoute(path: '/scheduled-transfers-v2', builder: (context, state) => const ScheduledTransfersV2Screen()),
    GoRoute(path: '/security-attack-simulator', builder: (context, state) => const SecurityAttackSimulatorScreen()),
    GoRoute(path: '/security-audit-report', builder: (context, state) => const SecurityAuditReportScreen()),
    GoRoute(path: '/security-dashboard', builder: (context, state) => const SecurityDashboardScreen()),
    GoRoute(path: '/security-events-log', builder: (context, state) => const SecurityEventsLogScreen()),
    GoRoute(path: '/security-score', builder: (context, state) => const SecurityScoreScreen()),
    GoRoute(path: '/security-settings', builder: (context, state) => const SecuritySettingsScreen()),
    GoRoute(path: '/self-unlock', builder: (context, state) => const SelfUnlockScreen()),
    GoRoute(path: '/send-crypto', builder: (context, state) => const SendCryptoScreen()),
    GoRoute(path: '/send-from-nigeria', builder: (context, state) => const SendFromNigeriaScreen()),
    GoRoute(path: '/send-money', builder: (context, state) => const SendMoneyScreen()),
    GoRoute(path: '/send-to-benin', builder: (context, state) => const SendToBeninScreen()),
    GoRoute(path: '/send-to-cameroon', builder: (context, state) => const SendToCameroonScreen()),
    GoRoute(path: '/send-to-ghana', builder: (context, state) => const SendToGhanaScreen()),
    GoRoute(path: '/send-to-kenya', builder: (context, state) => const SendToKenyaScreen()),
    GoRoute(path: '/send-to-mali', builder: (context, state) => const SendToMaliScreen()),
    GoRoute(path: '/send-to-niger', builder: (context, state) => const SendToNigerScreen()),
    GoRoute(path: '/send-abroad', builder: (context, state) => const SendAbroadScreen()),
    GoRoute(path: '/send-to-nigeria', builder: (context, state) => const SendToNigeriaScreen()),
    GoRoute(path: '/send-to-senegal', builder: (context, state) => const SendToSenegalScreen()),
    GoRoute(path: '/send-to-south-africa', builder: (context, state) => const SendToSouthAfricaScreen()),
    GoRoute(path: '/send-to-tanzania', builder: (context, state) => const SendToTanzaniaScreen()),
    GoRoute(path: '/send-to-togo', builder: (context, state) => const SendToTogoScreen()),
    GoRoute(path: '/send-to-uganda', builder: (context, state) => const SendToUgandaScreen()),
    GoRoute(path: '/services-health-dashboard', builder: (context, state) => const ServicesHealthDashboardScreen()),
    GoRoute(path: '/services-health', builder: (context, state) => const ServicesHealthDashboardScreen()),
    GoRoute(path: '/settings', builder: (context, state) => const SettingsScreen()),
    GoRoute(path: '/settlement-netting-page', builder: (context, state) => const SettlementNettingPageScreen()),
    GoRoute(path: '/settlement-netting', builder: (context, state) => const SettlementNettingScreen()),
    GoRoute(path: '/similar-transactions-page', builder: (context, state) => const SimilarTransactionsPageScreen()),
    GoRoute(path: '/similar-transactions', builder: (context, state) => const SimilarTransactionsScreen()),
    GoRoute(path: '/smart-routing-dashboard', builder: (context, state) => const SmartRoutingDashboardScreen()),
    GoRoute(path: '/smart-routing-v2-page', builder: (context, state) => const SmartRoutingV2PageScreen()),
    GoRoute(path: '/smart-routing-v2', builder: (context, state) => const SmartRoutingV2Screen()),
    GoRoute(path: '/sme-trade-form-m-history', builder: (context, state) => const SmeTradeFormMHistoryScreen()),
    GoRoute(path: '/sme-trade-payment', builder: (context, state) => const SmeTradePaymentScreen()),
    GoRoute(path: '/split-bill', builder: (context, state) => const SplitBillScreen()),
    GoRoute(path: '/stablecoin', builder: (context, state) => const StablecoinScreen()),
    GoRoute(path: '/startup-deal-room', builder: (context, state) => const StartupDealRoomScreen()),
    GoRoute(path: '/stripe-payment-history', builder: (context, state) => const StripePaymentHistoryScreen()),
    GoRoute(path: '/stripe-receipts', builder: (context, state) => const StripeReceiptsScreen()),
    GoRoute(path: '/stripe-retry-admin', builder: (context, state) => const StripeRetryAdminScreen()),
    GoRoute(path: '/subscription-tiers', builder: (context, state) => const SubscriptionTiersScreen()),
    GoRoute(path: '/support', builder: (context, state) => const SupportScreen()),
    GoRoute(path: '/support-tickets', builder: (context, state) => const SupportTicketsScreen()),
    GoRoute(path: '/swift-tracker', builder: (context, state) => const SWIFTTrackerScreen()),
    GoRoute(path: '/system-config-admin', builder: (context, state) => const SystemConfigAdminScreen()),
    GoRoute(path: '/system-config', builder: (context, state) => const SystemConfigScreen()),
    GoRoute(path: '/system-config-page', builder: (context, state) => const SystemConfigScreen()),
    GoRoute(path: '/system-health-dashboard-v2', builder: (context, state) => const SystemHealthDashboardV2()),
    GoRoute(path: '/talent-bridge', builder: (context, state) => const TalentBridgeScreen()),
    GoRoute(path: '/tenant-admin', builder: (context, state) => const TenantAdminScreen()),
    GoRoute(path: '/tenant-config-page', builder: (context, state) => const TenantConfigPageScreen()),
    GoRoute(path: '/tenant-config', builder: (context, state) => const TenantConfigScreen()),
    GoRoute(path: '/tenant-dashboard', builder: (context, state) => const TenantDashboardScreen()),
    GoRoute(path: '/tenant-feature-flags-admin', builder: (context, state) => const TenantFeatureFlagsAdminScreen()),
    GoRoute(path: '/tenant-onboarding-wizard', builder: (context, state) => const TenantOnboardingWizardScreen()),
    GoRoute(path: '/tiered-k-y-c-flow', builder: (context, state) => const TieredKYCFlowScreen()),
    GoRoute(path: '/transaction-export', builder: (context, state) => const TransactionExportScreen()),
    GoRoute(path: '/transaction-history', builder: (context, state) => const TransactionHistoryScreen()),
    GoRoute(path: '/transaction-receipt', builder: (context, state) => const TransactionReceiptScreen()),
    GoRoute(path: '/transaction-search', builder: (context, state) => const TransactionSearchScreen()),
    GoRoute(path: '/transfer-analytics', builder: (context, state) => const TransferAnalyticsScreen()),
    GoRoute(path: '/transfer-audit-trail', builder: (context, state) => const TransferAuditTrailScreen()),
    GoRoute(path: '/transfer-dispute-form', builder: (context, state) => const TransferDisputeFormScreen()),
    GoRoute(path: '/transfer-goals', builder: (context, state) => const TransferGoalsScreen()),
    GoRoute(path: '/transfer-limits', builder: (context, state) => const TransferLimitsScreen()),
    GoRoute(path: '/transfer-limits-v2-page', builder: (context, state) => const TransferLimitsV2PageScreen()),
    GoRoute(path: '/transfer-limits-v2', builder: (context, state) => const TransferLimitsV2Screen()),
    GoRoute(path: '/transfer-tracking', builder: (context, state) => const TransferTrackingScreen()),
    GoRoute(path: '/travel-rule', builder: (context, state) => const TravelRuleScreen()),
    GoRoute(path: '/treasury-dashboard-page', builder: (context, state) => const TreasuryDashboardPageScreen()),
    GoRoute(path: '/treasury-dashboard', builder: (context, state) => const TreasuryDashboardScreen()),
    GoRoute(path: '/treasury-management', builder: (context, state) => const TreasuryManagementScreen()),
    GoRoute(path: '/trisa-compliance', builder: (context, state) => const TrisaComplianceScreen()),
    GoRoute(path: '/user-onboarding', builder: (context, state) => const UserOnboardingScreen()),
    GoRoute(path: '/v-a-p-i-d-push-manager', builder: (context, state) => const VAPIDPushManagerScreen()),
    GoRoute(path: '/vector-search-page', builder: (context, state) => const VectorSearchPageScreen()),
    GoRoute(path: '/vector-search', builder: (context, state) => const VectorSearchScreen()),
    GoRoute(path: '/velocity-check-dashboard', builder: (context, state) => const VelocityCheckDashboardScreen()),
    GoRoute(path: '/virtual-account', builder: (context, state) => const VirtualAccountScreen()),
    GoRoute(path: '/webhook-admin', builder: (context, state) => const WebhookAdminScreen()),
    GoRoute(path: '/webhook-manager', builder: (context, state) => const WebhookManagerScreen()),
    GoRoute(path: '/webhook-retry-page', builder: (context, state) => const WebhookRetryPageScreen()),
    GoRoute(path: '/webhook-retry', builder: (context, state) => const WebhookRetryScreen()),
    GoRoute(path: '/wise-transfer', builder: (context, state) => const WiseTransferScreen()),
  ],
);

// ── App Widget ───────────────────────────────────────────────────────────────
class RemitFlowApp extends ConsumerWidget {
  const RemitFlowApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'RemitFlow',
      debugShowCheckedModeBanner: false,
      theme: _buildTheme(),
      routerConfig: _router,
    );
  }

  ThemeData _buildTheme() {
    const primaryColor = Color(0xFF6366F1);
    const backgroundColor = Color(0xFF0F0F1A);
    const surfaceColor = Color(0xFF1A1A2E);

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: const ColorScheme.dark(
        primary: primaryColor,
        secondary: Color(0xFF8B5CF6),
        background: backgroundColor,
        surface: surfaceColor,
        onPrimary: Colors.white,
        onBackground: Colors.white,
        onSurface: Color(0xFFE2E8F0),
      ),
      scaffoldBackgroundColor: backgroundColor,
      cardColor: surfaceColor,
      textTheme: GoogleFonts.interTextTheme(ThemeData.dark().textTheme).copyWith(
        displayLarge: GoogleFonts.inter(fontSize: 32, fontWeight: FontWeight.w800, color: Colors.white),
        headlineMedium: GoogleFonts.inter(fontSize: 24, fontWeight: FontWeight.w700, color: Colors.white),
        titleLarge: GoogleFonts.inter(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white),
        bodyLarge: GoogleFonts.inter(fontSize: 16, color: const Color(0xFFE2E8F0)),
        bodyMedium: GoogleFonts.inter(fontSize: 14, color: const Color(0xFF9CA3AF)),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: backgroundColor,
        foregroundColor: Colors.white,
        elevation: 0,
        titleTextStyle: GoogleFonts.inter(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: surfaceColor,
        selectedItemColor: primaryColor,
        unselectedItemColor: Color(0xFF64748B),
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surfaceColor,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFF2D2D4E)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFF2D2D4E)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: primaryColor),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primaryColor,
          foregroundColor: Colors.white,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: GoogleFonts.inter(fontSize: 15, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}
