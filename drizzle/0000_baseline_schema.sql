-- Reconstructed canonical baseline for missing legacy migrations 0000–0050.
-- Source: drizzle/meta/0051_snapshot.json. This creates the state expected before 0051.
-- Regenerate with: node scripts/rebuild-baseline-migration.mjs

CREATE TYPE "ab_event_type" AS ENUM ('impression', 'click', 'conversion', 'signup', 'transfer');

CREATE TYPE "ab_experiment_status" AS ENUM ('draft', 'running', 'paused', 'completed');

CREATE TYPE "agreement_status" AS ENUM ('draft', 'sent', 'viewed', 'digitally_signed', 'physically_signed', 'fully_executed', 'expired', 'terminated');

CREATE TYPE "api_key_status" AS ENUM ('active', 'revoked', 'expired');

CREATE TYPE "audit_severity" AS ENUM ('info', 'warning', 'critical');

CREATE TYPE "batch_status" AS ENUM ('draft', 'processing', 'completed', 'failed', 'partial');

CREATE TYPE "bdc_partner_status" AS ENUM ('pending_review', 'approved', 'suspended', 'rejected');

CREATE TYPE "billing_fee_mode" AS ENUM ('PERCENTAGE', 'FLAT', 'HYBRID');

CREATE TYPE "billing_payout_method" AS ENUM ('BANK_TRANSFER', 'MOBILE_MONEY', 'CASH_PICKUP', 'WALLET', 'CRYPTO');

CREATE TYPE "billing_settlement_status" AS ENUM ('PENDING', 'SETTLED', 'FAILED', 'REVERSED');

CREATE TYPE "billing_tenant_status" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

CREATE TYPE "billing_tenant_type" AS ENUM ('IMTO_PARTNER', 'WHITE_LABEL', 'ENTERPRISE_SENDER');

CREATE TYPE "bond_coupon_freq" AS ENUM ('monthly', 'quarterly', 'semi_annual', 'annual');

CREATE TYPE "bond_status" AS ENUM ('upcoming', 'open', 'closed', 'matured', 'defaulted');

CREATE TYPE "bond_type" AS ENUM ('fgn_diaspora', 'eurobond', 'corporate', 'sukuk', 'green_bond', 'infrastructure');

CREATE TYPE "bulk_payment_batch_status" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

CREATE TYPE "business_savings_status" AS ENUM ('active', 'matured', 'withdrawn', 'cancelled');

CREATE TYPE "business_savings_type" AS ENUM ('instant_access', 'notice_30_day', 'fixed_30', 'fixed_90', 'fixed_180', 'fixed_365');

CREATE TYPE "card_brand" AS ENUM ('visa', 'mastercard', 'verve');

CREATE TYPE "card_status" AS ENUM ('active', 'frozen', 'expired', 'cancelled');

CREATE TYPE "card_type" AS ENUM ('virtual', 'physical');

CREATE TYPE "case_severity" AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE "case_status" AS ENUM ('open', 'under_review', 'resolved', 'escalated', 'dismissed');

CREATE TYPE "case_type" AS ENUM ('aml_flag', 'fraud_alert', 'sanctions_hit', 'pep_match', 'unusual_activity', 'high_risk_corridor');

CREATE TYPE "chat_channel" AS ENUM ('web', 'mobile', 'api', 'whatsapp', 'telegram');

CREATE TYPE "chat_priority" AS ENUM ('low', 'normal', 'high', 'urgent');

CREATE TYPE "chat_role" AS ENUM ('user', 'assistant');

CREATE TYPE "chat_session_status" AS ENUM ('bot', 'queued', 'active', 'resolved', 'abandoned');

CREATE TYPE "collective_status" AS ENUM ('forming', 'active', 'investing', 'completed', 'dissolved');

CREATE TYPE "community_fund_status" AS ENUM ('active', 'completed', 'paused', 'closed');

CREATE TYPE "contractor_invoice_status" AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'paid', 'cancelled');

CREATE TYPE "contractor_status" AS ENUM ('active', 'inactive', 'suspended');

CREATE TYPE "correspondent_risk" AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE "credit_application_status" AS ENUM ('draft', 'submitted', 'scoring', 'approved', 'rejected', 'disbursed', 'repaid', 'defaulted');

CREATE TYPE "credit_score_status" AS ENUM ('pending', 'calculated', 'expired', 'disputed');

CREATE TYPE "cron_job_status" AS ENUM ('active', 'paused', 'error', 'running');

CREATE TYPE "cross_sell_offer_status" AS ENUM ('pending', 'shown', 'accepted', 'dismissed', 'expired');

CREATE TYPE "cross_sell_offer_type" AS ENUM ('savings_account', 'diaspora_bond', 'insurance', 'investment_fund', 'credit_card');

CREATE TYPE "dd_freq" AS ENUM ('weekly', 'monthly', 'quarterly', 'annually');

CREATE TYPE "dd_status" AS ENUM ('active', 'paused', 'cancelled');

CREATE TYPE "derisking_status" AS ENUM ('active', 'watch', 'at_risk', 'terminated');

CREATE TYPE "dispute_priority" AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE "dispute_status" AS ENUM ('open', 'under_review', 'resolved', 'closed');

CREATE TYPE "dispute_type" AS ENUM ('unauthorized', 'duplicate', 'not_received', 'wrong_amount', 'other');

CREATE TYPE "document_vault_category" AS ENUM ('identity', 'address', 'financial', 'compliance', 'contract', 'other');

CREATE TYPE "document_vault_status" AS ENUM ('active', 'expired', 'archived', 'shared');

CREATE TYPE "embedded_payroll_api_key_status" AS ENUM ('active', 'revoked', 'expired');

CREATE TYPE "employment_type" AS ENUM ('full_time', 'part_time', 'contractor', 'intern');

CREATE TYPE "entity_group_status" AS ENUM ('active', 'suspended', 'dissolved');

CREATE TYPE "eu_corridor" AS ENUM ('IT', 'DE', 'FR', 'ES', 'NL', 'BE', 'PT', 'IE');

CREATE TYPE "expense_category" AS ENUM ('travel', 'accommodation', 'meals', 'equipment', 'software', 'marketing', 'professional_services', 'utilities', 'office_supplies', 'training', 'other');

CREATE TYPE "expense_policy_action" AS ENUM ('auto_approve', 'require_review', 'reject');

CREATE TYPE "expense_status" AS ENUM ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'reimbursed');

CREATE TYPE "family_relationship" AS ENUM ('spouse', 'parent', 'child', 'sibling', 'grandparent', 'grandchild', 'uncle_aunt', 'cousin', 'other');

CREATE TYPE "feature_flag_scope" AS ENUM ('global', 'tenant', 'user');

CREATE TYPE "fraud_alert_status" AS ENUM ('pending', 'reviewed', 'blocked', 'cleared');

CREATE TYPE "fraud_risk_level" AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE "funding_source_type" AS ENUM ('remittance_inflow', 'nfem_fx_conversion', 'internal_transfer', 'stripe_topup', 'crypto_conversion', 'agent_cash', 'other');

CREATE TYPE "fx_direction" AS ENUM ('above', 'below');

CREATE TYPE "gateway" AS ENUM ('stripe', 'paypal', 'flutterwave', 'bank_transfer', 'mpesa', 'mojaloop');

CREATE TYPE "gateway_tx_status" AS ENUM ('initiated', 'pending', 'success', 'failed', 'refunded', 'disputed');

CREATE TYPE "hnw_tier" AS ENUM ('standard', 'premium', 'ultra');

CREATE TYPE "id_doc_type" AS ENUM ('ecowas_id', 'national_id', 'passport', 'drivers_license', 'nin_slip', 'voters_card');

CREATE TYPE "intercompany_transfer_status" AS ENUM ('pending', 'approved', 'processing', 'completed', 'failed', 'cancelled');

CREATE TYPE "investment_asset_type" AS ENUM ('stock', 'etf', 'commodity', 'crypto', 'mining_share', 'real_estate', 'bond', 'index_fund');

CREATE TYPE "investment_stage" AS ENUM ('seed', 'series_a', 'series_b', 'growth', 'ipo_ready');

CREATE TYPE "investment_status" AS ENUM ('open', 'closing', 'funded', 'closed');

CREATE TYPE "invoice_financing_status" AS ENUM ('draft', 'submitted', 'under_review', 'approved', 'funded', 'repaying', 'repaid', 'defaulted', 'rejected');

CREATE TYPE "kyc_doc_status" AS ENUM ('pending', 'under_review', 'approved', 'rejected');

CREATE TYPE "kyc_doc_type" AS ENUM ('passport', 'national_id', 'drivers_license', 'utility_bill', 'bank_statement', 'selfie', 'proof_of_address');

CREATE TYPE "kyc_stage" AS ENUM ('not_started', 'documents_submitted', 'under_review', 'additional_info_required', 'approved', 'rejected', 'expired', 'suspended');

CREATE TYPE "kyc_tier_v2" AS ENUM ('tier0', 'tier1', 'tier2', 'tier3');

CREATE TYPE "kycTier" AS ENUM ('tier0', 'tier1', 'tier2', 'tier3');

CREATE TYPE "lc_status" AS ENUM ('draft', 'submitted', 'issued', 'advised', 'documents_presented', 'documents_checked', 'payment_authorised', 'settled', 'expired', 'cancelled');

CREATE TYPE "lc_type" AS ENUM ('sight', 'usance', 'standby', 'revolving');

CREATE TYPE "market_category" AS ENUM ('electronics', 'fashion', 'food', 'crafts', 'services', 'real_estate', 'agriculture', 'education', 'health', 'other');

CREATE TYPE "market_listing_status" AS ENUM ('active', 'sold', 'cancelled', 'pending');

CREATE TYPE "market_order_status" AS ENUM ('pending_payment', 'paid', 'shipped', 'delivered', 'disputed', 'refunded', 'cancelled');

CREATE TYPE "merchant_kyb_status" AS ENUM ('pending', 'documents_requested', 'under_review', 'approved', 'rejected', 'suspended');

CREATE TYPE "mortgage_status" AS ENUM ('enquiry', 'application', 'under_review', 'conditionally_approved', 'approved', 'offer_issued', 'completed', 'active', 'defaulted', 'closed');

CREATE TYPE "mortgage_type" AS ENUM ('purchase', 'remortgage', 'equity_release', 'buy_to_let', 'diaspora_home_build');

CREATE TYPE "notif_type" AS ENUM ('transaction', 'security', 'kyc', 'system', 'promotion', 'fx_alert');

CREATE TYPE "open_banking_consent_status" AS ENUM ('awaiting_authorisation', 'authorised', 'rejected', 'revoked', 'expired');

CREATE TYPE "partner_api_key_env" AS ENUM ('sandbox', 'production');

CREATE TYPE "partner_api_key_status" AS ENUM ('active', 'revoked', 'expired');

CREATE TYPE "partner_application_status" AS ENUM ('draft', 'submitted', 'under_review', 'additional_info_required', 'approved', 'rejected', 'suspended');

CREATE TYPE "partner_application_type" AS ENUM ('fintech_startup', 'bank', 'mfi', 'ngo', 'telecom', 'aggregator', 'enterprise', 'other');

CREATE TYPE "payment_rail" AS ENUM ('mojaloop', 'cips', 'upi', 'pix', 'swift', 'sepa', 'ach', 'bricspay', 'mbridge', 'ghipss', 'africbdc', 'papss');

CREATE TYPE "payout_method" AS ENUM ('bank_transfer', 'crypto', 'mobile_money', 'paypal');

CREATE TYPE "payout_status" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

CREATE TYPE "payroll_company_status" AS ENUM ('active', 'suspended', 'pending_kyb');

CREATE TYPE "payroll_frequency" AS ENUM ('weekly', 'bi_weekly', 'semi_monthly', 'monthly');

CREATE TYPE "payroll_item_status" AS ENUM ('pending', 'processing', 'paid', 'failed', 'on_hold');

CREATE TYPE "payroll_jurisdiction" AS ENUM ('NG', 'GB', 'US', 'CA', 'DE', 'FR', 'IT', 'AE', 'GH', 'KE', 'ZA');

CREATE TYPE "payroll_run_status" AS ENUM ('draft', 'pending_approval', 'approved', 'processing', 'disbursed', 'failed', 'cancelled');

CREATE TYPE "pipeline_run_status" AS ENUM ('pending', 'running', 'success', 'failed', 'cancelled');

CREATE TYPE "proposal_status" AS ENUM ('draft', 'voting', 'approved', 'rejected', 'funded', 'completed');

CREATE TYPE "rate_alert_history_status" AS ENUM ('triggered', 'snoozed', 'dismissed');

CREATE TYPE "rate_lock_status" AS ENUM ('active', 'used', 'expired');

CREATE TYPE "recurring_freq" AS ENUM ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly');

CREATE TYPE "recurring_status" AS ENUM ('active', 'paused', 'cancelled');

CREATE TYPE "referral_bonus_status" AS ENUM ('pending', 'approved', 'paid', 'expired', 'rejected');

CREATE TYPE "referral_status" AS ENUM ('pending', 'completed', 'rewarded');

CREATE TYPE "regulatory_report_status" AS ENUM ('pending', 'generating', 'ready', 'filed', 'failed');

CREATE TYPE "regulatory_report_type" AS ENUM ('CTR', 'SAR', 'FBAR', 'ANNUAL_AML');

CREATE TYPE "rev_share_ledger_type" AS ENUM ('credit', 'debit', 'adjustment', 'reversal');

CREATE TYPE "rev_share_model" AS ENUM ('percentage', 'flat_fee', 'tiered', 'hybrid');

CREATE TYPE "rev_share_status" AS ENUM ('draft', 'active', 'suspended', 'terminated');

CREATE TYPE "role" AS ENUM ('admin', 'user', 'partner');

CREATE TYPE "sanctions_check_result" AS ENUM ('clear', 'hit', 'pending_review');

CREATE TYPE "savings_status" AS ENUM ('active', 'completed', 'paused');

CREATE TYPE "scheduled_run_status" AS ENUM ('success', 'failed', 'skipped');

CREATE TYPE "settlement_account_status" AS ENUM ('active', 'pending_cbn_filing', 'filed', 'suspended', 'closed');

CREATE TYPE "signature_method" AS ENUM ('digital_checkbox', 'drawn', 'typed', 'uploaded');

CREATE TYPE "sm_order_status" AS ENUM ('open', 'matched', 'cancelled', 'expired');

CREATE TYPE "sm_order_type" AS ENUM ('sell', 'buy');

CREATE TYPE "subscription_status" AS ENUM ('pending_payment', 'active', 'matured', 'sold', 'cancelled');

CREATE TYPE "swift_gpi_status" AS ENUM ('ACCP', 'ACSP', 'ACSC', 'RJCT', 'PDNG');

CREATE TYPE "talent_availability" AS ENUM ('full_time', 'part_time', 'advisory', 'project_based');

CREATE TYPE "talent_booking_status" AS ENUM ('pending', 'accepted', 'declined', 'completed', 'cancelled');

CREATE TYPE "talent_engagement" AS ENUM ('advisory', 'mentorship', 'consulting', 'speaking', 'training');

CREATE TYPE "tax_authority" AS ENUM ('FIRS', 'HMRC', 'IRS', 'KRA', 'GRA', 'SARS', 'OTHER');

CREATE TYPE "tax_filing_status" AS ENUM ('draft', 'calculated', 'submitted', 'acknowledged', 'accepted', 'rejected', 'amended');

CREATE TYPE "tenant_plan" AS ENUM ('starter', 'growth', 'enterprise', 'white_label');

CREATE TYPE "tenant_status" AS ENUM ('active', 'suspended', 'trial', 'churned');

CREATE TYPE "threshold_operator" AS ENUM ('below', 'above');

CREATE TYPE "ticket_priority" AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE "ticket_status" AS ENUM ('open', 'in_progress', 'resolved', 'closed');

CREATE TYPE "trade_corridor" AS ENUM ('CN', 'AE', 'IN', 'US', 'GB', 'DE', 'TR', 'BD');

CREATE TYPE "trade_purpose" AS ENUM ('goods_import', 'services_import', 'royalties', 'technical_fees', 'dividends', 'loan_repayment');

CREATE TYPE "tx_status" AS ENUM ('initiated', 'pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed');

CREATE TYPE "tx_type" AS ENUM ('send', 'receive', 'exchange', 'topup', 'withdrawal', 'fee', 'refund', 'airtime', 'bill', 'savings', 'card');

CREATE TYPE "user_investment_status" AS ENUM ('pending', 'active', 'sold', 'cancelled', 'matured');

CREATE TYPE "user_onboarding_status" AS ENUM ('not_started', 'in_progress', 'completed', 'skipped');

CREATE TYPE "va_status" AS ENUM ('active', 'inactive');

CREATE TYPE "velocity_action" AS ENUM ('block', 'flag', 'require_2fa', 'notify_admin');

CREATE TYPE "velocity_window" AS ENUM ('1h', '6h', '24h', '7d', '30d');

CREATE TYPE "wallet_status" AS ENUM ('active', 'suspended', 'closed');

CREATE TYPE "watchlist_status" AS ENUM ('clear', 'flagged', 'blocked', 'under_review');

CREATE TYPE "webhook_event_status" AS ENUM ('pending', 'delivered', 'failed', 'retrying');

CREATE TYPE "west_african_corridor" AS ENUM ('GH', 'TG', 'NE', 'ML', 'BJ', 'CI', 'SN', 'BF');

CREATE TYPE "xof_payout_method" AS ENUM ('mobile_money', 'bank_account', 'cash_pickup', 'wallet');

CREATE TABLE "ab_assignments" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "experiment_id" integer  NOT NULL,
  "user_id" integer,
  "session_id" varchar(128),
  "variant_id" varchar(64)  NOT NULL,
  "assigned_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "ab_events" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "experiment_id" integer  NOT NULL,
  "assignment_id" integer,
  "variant_id" varchar(64)  NOT NULL,
  "event_type" "ab_event_type"  NOT NULL,
  "metadata" json  DEFAULT '{}'::json,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "ab_experiments" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "name" varchar(200)  NOT NULL,
  "description" text,
  "status" "ab_experiment_status"  DEFAULT 'draft'  NOT NULL,
  "variants" json  DEFAULT '[]'::json,
  "target_page" varchar(200),
  "start_date" timestamp,
  "end_date" timestamp,
  "created_by" integer,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "ach_payment_methods" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "bank_name" varchar(200)  NOT NULL,
  "routing_number" varchar(20)  NOT NULL,
  "account_number_masked" varchar(20)  NOT NULL,
  "account_type" varchar(20)  NOT NULL,
  "plaid_account_id" varchar(200),
  "is_verified" boolean  DEFAULT false,
  "is_default" boolean  DEFAULT false,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "africbdc_transfers" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "transfer_id" varchar(100)  NOT NULL,
  "cbdc_ref" varchar(100),
  "cbdc_type" varchar(20)  NOT NULL,
  "send_amount" numeric(18, 6)  NOT NULL,
  "currency" varchar(10)  NOT NULL,
  "country" varchar(3)  NOT NULL,
  "sender_wallet" varchar(200)  NOT NULL,
  "receiver_wallet" varchar(200)  NOT NULL,
  "sender_name" varchar(200),
  "receiver_name" varchar(200),
  "purpose" varchar(100),
  "status" varchar(30)  DEFAULT 'pending'  NOT NULL,
  "mojaloop_routed" boolean  DEFAULT false,
  "cbdc_status" varchar(20),
  "error_message" text,
  "settled_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "africbdc_transfers_transfer_id_unique" UNIQUE ("transfer_id")
);

CREATE TABLE "agent_accounts" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "agent_code" varchar(20)  NOT NULL,
  "business_name" varchar(200),
  "location" varchar(300),
  "phone" varchar(20),
  "status" varchar(20)  DEFAULT 'active',
  "tier" varchar(20)  DEFAULT 'basic',
  "commission_rate" numeric(5, 2)  DEFAULT '1.50',
  "daily_limit" numeric(18, 2)  DEFAULT '1000000.00',
  "total_transactions" integer  DEFAULT 0,
  "total_volume" numeric(18, 2)  DEFAULT '0.00',
  "rating" numeric(3, 2)  DEFAULT '5.00',
  "created_at" timestamp  DEFAULT now(),
  "updated_at" timestamp  DEFAULT now()
);

CREATE TABLE "agent_cashin_transactions" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "agent_id" integer  NOT NULL,
  "worker_id" integer  NOT NULL,
  "amount_ngn" numeric(18, 2)  NOT NULL,
  "destination_corridor" "west_african_corridor"  NOT NULL,
  "payout_method" "xof_payout_method"  NOT NULL,
  "beneficiary_mobile" varchar(20),
  "beneficiary_name" varchar(200),
  "status" varchar(30)  DEFAULT 'pending'  NOT NULL,
  "agent_fee_ngn" numeric(10, 2),
  "tiger_beetle_debit_entry" bigint,
  "tiger_beetle_credit_entry" bigint,
  "mojaloop_transfer_id" varchar(200),
  "fluvio_offset" bigint,
  "reference" varchar(100)  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "settled_at" timestamp
);

CREATE TABLE "agreement_signatures" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "agreement_doc_id" integer  NOT NULL,
  "signer_type" varchar(20)  DEFAULT 'partner'  NOT NULL,
  "signer_user_id" integer,
  "signer_name" varchar(255)  NOT NULL,
  "signer_email" varchar(255)  NOT NULL,
  "signer_title" varchar(100),
  "method" "signature_method"  DEFAULT 'digital_checkbox'  NOT NULL,
  "ip_address" varchar(45),
  "user_agent" text,
  "checkbox_confirmed" boolean  DEFAULT false  NOT NULL,
  "signature_data" text,
  "signed_at" timestamp  DEFAULT now()  NOT NULL,
  "is_valid" boolean  DEFAULT true  NOT NULL,
  "verification_hash" varchar(128)
);

CREATE TABLE "agreement_templates" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "name" varchar(255)  NOT NULL,
  "version" varchar(20)  DEFAULT '1.0'  NOT NULL,
  "type" varchar(50)  DEFAULT 'revenue_share'  NOT NULL,
  "content" text  NOT NULL,
  "is_active" boolean  DEFAULT true  NOT NULL,
  "created_by" integer,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "airflow_dag_runs" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "dag_id" varchar(100)  NOT NULL,
  "run_id" varchar(100),
  "status" "pipeline_run_status"  DEFAULT 'pending'  NOT NULL,
  "triggered_by" integer,
  "conf" json,
  "started_at" timestamp  DEFAULT now()  NOT NULL,
  "completed_at" timestamp,
  "duration_ms" integer,
  "error_message" text
);

CREATE TABLE "analyticsThresholds" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "metric" varchar(64)  NOT NULL,
  "label" varchar(128)  NOT NULL,
  "threshold" integer  NOT NULL,
  "operator" "threshold_operator"  DEFAULT 'below'  NOT NULL,
  "notifyOwner" boolean  DEFAULT true,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "analyticsThresholds_metric_unique" UNIQUE ("metric")
);

CREATE TABLE "api_changelogs" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "version" varchar(20)  NOT NULL,
  "release_date" timestamp  NOT NULL,
  "title" varchar(255)  NOT NULL,
  "type" varchar(20)  NOT NULL,
  "summary" text  NOT NULL,
  "breaking_changes" text,
  "new_endpoints" text,
  "deprecated_endpoints" text,
  "bug_fixes" text,
  "is_published" boolean  DEFAULT true  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "api_key_rotation_log" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "old_key_id" integer  NOT NULL,
  "new_key_id" integer  NOT NULL,
  "user_id" integer  NOT NULL,
  "reason" varchar(200),
  "rotated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "api_key_usage_logs" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "api_key_id" integer  NOT NULL,
  "user_id" integer  NOT NULL,
  "endpoint" varchar(200)  NOT NULL,
  "method" varchar(10)  DEFAULT 'POST'  NOT NULL,
  "status_code" integer  DEFAULT 200  NOT NULL,
  "latency_ms" integer  DEFAULT 0  NOT NULL,
  "ip_address" varchar(50),
  "environment" varchar(10)  DEFAULT 'live'  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "api_keys" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "tenant_id" integer,
  "name" varchar(100)  NOT NULL,
  "key_hash" varchar(128)  NOT NULL,
  "key_prefix" varchar(12)  NOT NULL,
  "scopes" json  DEFAULT '[]'::json,
  "status" "api_key_status"  DEFAULT 'active'  NOT NULL,
  "last_used_at" timestamp,
  "expires_at" timestamp,
  "ip_allowlist" json  DEFAULT '[]'::json,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "api_keys_key_hash_unique" UNIQUE ("key_hash")
);

CREATE TABLE "auditLogs" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "userId" integer  NOT NULL,
  "targetId" integer,
  "targetType" varchar(64),
  "action" varchar(64)  NOT NULL,
  "description" text,
  "ipAddress" varchar(64),
  "userAgent" text,
  "severity" "audit_severity"  DEFAULT 'info',
  "metadata" json,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "batch_payment_items" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "batch_id" integer  NOT NULL,
  "recipient_name" varchar(200)  NOT NULL,
  "recipient_account" varchar(100),
  "recipient_bank" varchar(100),
  "recipient_country" varchar(10),
  "amount" numeric(18, 2)  NOT NULL,
  "currency" varchar(10)  DEFAULT 'USD'  NOT NULL,
  "status" varchar(20)  DEFAULT 'pending'  NOT NULL,
  "transaction_id" integer,
  "error_message" text,
  "processed_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "batchPayments" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "userId" integer  NOT NULL,
  "name" varchar(128)  NOT NULL,
  "totalAmount" numeric(18, 2),
  "currency" varchar(8)  DEFAULT 'NGN',
  "totalRecipients" integer  DEFAULT 0,
  "successCount" integer  DEFAULT 0,
  "failedCount" integer  DEFAULT 0,
  "status" "batch_status"  DEFAULT 'draft',
  "payments" json,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "bdc_liquidity_requests" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "bdc_partner_id" integer  NOT NULL,
  "settlement_account_id" integer,
  "requested_amount_usd" integer  NOT NULL,
  "approved_amount_usd" integer,
  "bmatch_rate_at_request" varchar(30),
  "status" varchar(30)  DEFAULT 'pending'  NOT NULL,
  "adb_transfer_reference" varchar(200),
  "processed_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "bdc_partners" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "name" varchar(200)  NOT NULL,
  "cbn_licence_number" varchar(100)  NOT NULL,
  "adb_name" varchar(200)  NOT NULL,
  "adb_code" varchar(20),
  "contact_email" varchar(200),
  "contact_phone" varchar(50),
  "status" "bdc_partner_status"  DEFAULT 'pending_review'  NOT NULL,
  "max_daily_fx_usd" integer  DEFAULT 100000  NOT NULL,
  "notes" text,
  "approved_by" integer,
  "approved_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "bdc_partners_cbn_licence_number_unique" UNIQUE ("cbn_licence_number")
);

CREATE TABLE "beneficiaries" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "userId" integer  NOT NULL,
  "name" varchar(128)  NOT NULL,
  "accountNumber" varchar(64),
  "bankName" varchar(128),
  "bankCode" varchar(16),
  "currency" varchar(8)  DEFAULT 'NGN',
  "country" varchar(64),
  "phone" varchar(32),
  "email" varchar(320),
  "isFavorite" boolean  DEFAULT false,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "billing_audit_log" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "tenant_id" varchar(100)  NOT NULL,
  "event_type" varchar(50)  NOT NULL,
  "entity_type" varchar(50)  NOT NULL,
  "entity_id" varchar(100)  NOT NULL,
  "actor_user_id" varchar(100)  NOT NULL,
  "actor_role" varchar(50)  NOT NULL,
  "before_state" jsonb,
  "after_state" jsonb,
  "ip_address" varchar(45),
  "user_agent" text,
  "occurred_at_ms" bigint  NOT NULL
);

CREATE TABLE "billing_config_history" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "config_id" varchar(100)  NOT NULL,
  "tenant_id" varchar(100)  NOT NULL,
  "version" varchar(50)  NOT NULL,
  "snapshot" jsonb  NOT NULL,
  "changed_by" varchar(100)  NOT NULL,
  "change_reason" text,
  "changed_at_ms" bigint  NOT NULL,
  "notification_sent" boolean  DEFAULT false  NOT NULL
);

CREATE TABLE "billing_configs" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "config_id" varchar(100)  NOT NULL,
  "tenant_id" varchar(100)  NOT NULL,
  "version" varchar(50)  DEFAULT '1.0.0'  NOT NULL,
  "is_active" boolean  DEFAULT true  NOT NULL,
  "fee_mode" "billing_fee_mode"  DEFAULT 'PERCENTAGE'  NOT NULL,
  "fee_percentage" numeric(8, 4),
  "flat_fee_minor" integer  DEFAULT 0,
  "fee_cap_minor" integer  DEFAULT 2000,
  "fee_floor_minor" integer  DEFAULT 100,
  "fx_spread_percentage" numeric(8, 4)  DEFAULT '0.8000'  NOT NULL,
  "hedge_cost_percentage" numeric(8, 4)  DEFAULT '0.1500'  NOT NULL,
  "platform_fee_share_pct" numeric(8, 4)  DEFAULT '40.0000'  NOT NULL,
  "platform_fx_share_pct" numeric(8, 4)  DEFAULT '100.0000'  NOT NULL,
  "overhead_per_tx_minor" integer  DEFAULT 50  NOT NULL,
  "updated_by" varchar(100)  NOT NULL,
  "change_reason" text,
  "created_at_ms" bigint  NOT NULL,
  "updated_at_ms" bigint  NOT NULL,
  CONSTRAINT "billing_configs_config_id_unique" UNIQUE ("config_id")
);

CREATE TABLE "billing_events" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "event_id" varchar(100)  NOT NULL,
  "tenant_id" varchar(100)  NOT NULL,
  "transaction_id" varchar(100)  NOT NULL,
  "corridor" varchar(10)  NOT NULL,
  "send_currency" char(3)  NOT NULL,
  "recv_currency" char(3)  NOT NULL,
  "send_amount_minor" bigint  NOT NULL,
  "recv_amount_minor" bigint  NOT NULL,
  "transfer_fee_minor" bigint  DEFAULT 0  NOT NULL,
  "platform_fee_share_minor" bigint  DEFAULT 0  NOT NULL,
  "partner_fee_share_minor" bigint  DEFAULT 0  NOT NULL,
  "fee_mode" "billing_fee_mode"  NOT NULL,
  "mid_market_rate" numeric(20, 8)  NOT NULL,
  "applied_rate" numeric(20, 8)  NOT NULL,
  "fx_spread_minor" bigint  DEFAULT 0  NOT NULL,
  "fx_hedge_cost_minor" bigint  DEFAULT 0  NOT NULL,
  "net_fx_revenue_minor" bigint  DEFAULT 0  NOT NULL,
  "payout_method" "billing_payout_method"  DEFAULT 'BANK_TRANSFER'  NOT NULL,
  "payout_cost_minor" bigint  DEFAULT 0  NOT NULL,
  "allocated_overhead_minor" bigint  DEFAULT 0  NOT NULL,
  "net_platform_profit_minor" bigint  DEFAULT 0  NOT NULL,
  "settlement_status" "billing_settlement_status"  DEFAULT 'PENDING'  NOT NULL,
  "created_by_user_id" varchar(100)  NOT NULL,
  "billing_config_version" varchar(50)  NOT NULL,
  "event_timestamp_ms" bigint  NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "billing_events_event_id_unique" UNIQUE ("event_id")
);

CREATE TABLE "billing_tenants" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "tenant_id" varchar(100)  NOT NULL,
  "tenant_name" varchar(255)  NOT NULL,
  "tenant_type" "billing_tenant_type"  NOT NULL,
  "status" "billing_tenant_status"  DEFAULT 'PENDING'  NOT NULL,
  "owner_email" varchar(255)  NOT NULL,
  "owner_name" varchar(255),
  "keycloak_realm_id" varchar(100),
  "mojaloop_dfsp_id" varchar(50),
  "onboarded_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "billing_tenants_tenant_id_unique" UNIQUE ("tenant_id")
);

CREATE TABLE "bmatch_rate_snapshots" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "pair" varchar(20)  NOT NULL,
  "from_currency" varchar(10)  NOT NULL,
  "to_currency" varchar(10)  NOT NULL,
  "mid_rate" varchar(30)  NOT NULL,
  "bid_rate" varchar(30),
  "ask_rate" varchar(30),
  "spread_bps" varchar(20),
  "platform_rate" varchar(30),
  "platform_spread_bps" varchar(20),
  "within_cbn_limit" boolean  DEFAULT true  NOT NULL,
  "source" varchar(100)  DEFAULT 'adb_passthrough_simulated'  NOT NULL,
  "session" varchar(20),
  "snapshot_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "bnpl_plans" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "merchant" varchar(200)  NOT NULL,
  "description" varchar(500),
  "total_amount" numeric(18, 2)  NOT NULL,
  "paid_amount" numeric(18, 2)  DEFAULT '0.00',
  "currency" varchar(10)  DEFAULT 'NGN',
  "installments" integer  DEFAULT 4,
  "installment_amount" numeric(18, 2),
  "interest_rate" numeric(5, 2)  DEFAULT '2.50',
  "status" varchar(20)  DEFAULT 'active',
  "next_due_date" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp  DEFAULT now(),
  "updated_at" timestamp  DEFAULT now()
);

CREATE TABLE "bond_coupon_payments" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "subscription_id" integer  NOT NULL,
  "bond_id" integer  NOT NULL,
  "user_id" integer  NOT NULL,
  "coupon_number" integer  NOT NULL,
  "period_start" timestamp  NOT NULL,
  "period_end" timestamp  NOT NULL,
  "scheduled_date" timestamp  NOT NULL,
  "paid_date" timestamp,
  "gross_amount" numeric(18, 2)  NOT NULL,
  "withholding_tax" numeric(18, 2)  DEFAULT '0',
  "net_amount" numeric(18, 2)  NOT NULL,
  "currency" varchar(8)  DEFAULT 'USD',
  "status" varchar(20)  DEFAULT 'scheduled',
  "transaction_id" integer,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "bond_secondary_market_orders" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "subscription_id" integer  NOT NULL,
  "seller_id" integer  NOT NULL,
  "buyer_id" integer,
  "bond_id" integer  NOT NULL,
  "order_type" "sm_order_type"  DEFAULT 'sell',
  "units" integer  NOT NULL,
  "ask_price" numeric(18, 2)  NOT NULL,
  "bid_price" numeric(18, 2),
  "matched_price" numeric(18, 2),
  "total_value" numeric(18, 2),
  "currency" varchar(8)  DEFAULT 'USD',
  "status" "sm_order_status"  DEFAULT 'open',
  "expires_at" timestamp,
  "matched_at" timestamp,
  "settlement_tx_id" integer,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "bond_subscriptions" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "bond_id" integer  NOT NULL,
  "subscription_ref" varchar(80)  NOT NULL,
  "units" integer  NOT NULL,
  "face_value" numeric(18, 2)  NOT NULL,
  "purchase_price" numeric(18, 2)  NOT NULL,
  "total_paid" numeric(18, 2)  NOT NULL,
  "currency" varchar(8)  DEFAULT 'USD',
  "status" "subscription_status"  DEFAULT 'pending_payment',
  "transaction_id" integer,
  "total_coupons_received" numeric(18, 2)  DEFAULT '0',
  "maturity_proceeds" numeric(18, 2),
  "accrued_interest" numeric(18, 2)  DEFAULT '0',
  "current_value" numeric(18, 2),
  "yield_at_purchase" numeric(6, 4),
  "purchased_at" timestamp  DEFAULT now()  NOT NULL,
  "matured_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "bond_subscriptions_subscription_ref_unique" UNIQUE ("subscription_ref")
);

CREATE TABLE "bricspay_transfers" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "transfer_id" varchar(100)  NOT NULL,
  "dcms_message_id" varchar(100),
  "sender_country" varchar(3)  NOT NULL,
  "receiver_country" varchar(3)  NOT NULL,
  "send_amount" numeric(18, 6)  NOT NULL,
  "send_currency" varchar(10)  NOT NULL,
  "receive_currency" varchar(10)  NOT NULL,
  "receive_amount" numeric(18, 6),
  "exchange_rate" numeric(18, 8),
  "sender_vpa" varchar(200),
  "receiver_vpa" varchar(200)  NOT NULL,
  "sender_name" varchar(200),
  "receiver_name" varchar(200),
  "purpose" varchar(50),
  "status" varchar(30)  DEFAULT 'pending'  NOT NULL,
  "mojaloop_routed" boolean  DEFAULT false,
  "error_message" text,
  "settled_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "bricspay_transfers_transfer_id_unique" UNIQUE ("transfer_id")
);

CREATE TABLE "bulk_payment_batches" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "batch_id" text  NOT NULL,
  "user_id" integer  NOT NULL,
  "name" text  NOT NULL,
  "description" text,
  "total_payments" integer  DEFAULT 0  NOT NULL,
  "completed" integer  DEFAULT 0  NOT NULL,
  "failed" integer  DEFAULT 0  NOT NULL,
  "pending" integer  DEFAULT 0  NOT NULL,
  "status" "bulk_payment_batch_status"  DEFAULT 'pending'  NOT NULL,
  "currency" text  DEFAULT 'USD'  NOT NULL,
  "total_amount" integer  DEFAULT 0  NOT NULL,
  "success_rate" integer  DEFAULT 0  NOT NULL,
  "estimated_completion_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "bulk_payment_batches_batch_id_unique" UNIQUE ("batch_id")
);

CREATE TABLE "bulk_user_action_log" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "admin_id" integer  NOT NULL,
  "action" varchar(50)  NOT NULL,
  "target_user_ids" jsonb  NOT NULL,
  "affected_count" integer  DEFAULT 0  NOT NULL,
  "status" varchar(20)  DEFAULT 'completed'  NOT NULL,
  "notes" text,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "business_credit_scores" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "company_id" integer  NOT NULL,
  "score" integer  NOT NULL,
  "grade" varchar(5)  NOT NULL,
  "transaction_volume" numeric(18, 2),
  "avg_monthly_volume" numeric(18, 2),
  "payroll_consistency" numeric(5, 2),
  "kyb_score" integer,
  "payment_history" numeric(5, 2),
  "utilization_ratio" numeric(5, 2),
  "account_age" integer,
  "max_credit_limit_usd" numeric(18, 2),
  "status" "credit_score_status"  DEFAULT 'pending',
  "calculated_at" timestamp,
  "expires_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "business_savings_accounts" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "company_id" integer  NOT NULL,
  "owner_id" integer  NOT NULL,
  "product_id" integer  NOT NULL,
  "principal_usd" numeric(18, 2)  NOT NULL,
  "current_balance_usd" numeric(18, 2)  NOT NULL,
  "accrued_interest_usd" numeric(18, 2)  DEFAULT '0',
  "start_date" timestamp  NOT NULL,
  "maturity_date" timestamp,
  "last_interest_date" timestamp,
  "status" "business_savings_status"  DEFAULT 'active',
  "auto_renew" boolean  DEFAULT false,
  "withdrawn_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "business_savings_products" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "name" varchar(200)  NOT NULL,
  "type" "business_savings_type"  NOT NULL,
  "currency" varchar(8)  DEFAULT 'USD',
  "annual_rate_pct" numeric(5, 2)  NOT NULL,
  "min_deposit_usd" numeric(18, 2)  DEFAULT '1000',
  "max_deposit_usd" numeric(18, 2)  DEFAULT '10000000',
  "term_days" integer,
  "is_active" boolean  DEFAULT true,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "business_savings_txns" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "account_id" integer  NOT NULL,
  "type" varchar(30)  NOT NULL,
  "amount_usd" numeric(18, 2)  NOT NULL,
  "balance_after" numeric(18, 2)  NOT NULL,
  "description" varchar(300),
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "carbon_credits" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "owner_id" integer  NOT NULL,
  "credit_type" varchar(50)  DEFAULT 'VCS',
  "vintage_year" integer,
  "quantity_tonnes" numeric(10, 3)  NOT NULL,
  "price_per_tonne_usd" numeric(10, 2),
  "total_value_usd" numeric(18, 2),
  "registry_id" varchar(100),
  "project_name" varchar(300),
  "project_country" varchar(4),
  "status" varchar(20)  DEFAULT 'active',
  "retired_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "cards" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "userId" integer  NOT NULL,
  "type" "card_type"  NOT NULL,
  "brand" "card_brand"  NOT NULL,
  "last4" varchar(4)  NOT NULL,
  "expiryMonth" varchar(2)  NOT NULL,
  "expiryYear" varchar(4)  NOT NULL,
  "status" "card_status"  DEFAULT 'active',
  "currency" varchar(8)  DEFAULT 'USD',
  "spendLimit" numeric(18, 2),
  "cardholderName" varchar(128),
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "caseComments" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "caseId" integer  NOT NULL,
  "authorId" integer  NOT NULL,
  "authorName" varchar(128)  NOT NULL,
  "content" text  NOT NULL,
  "isInternal" boolean  DEFAULT true,
  "parentId" integer,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "cbdc_mint_burn_log" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "currency" varchar(20)  NOT NULL,
  "operation" varchar(10)  NOT NULL,
  "amount" numeric(18, 2)  NOT NULL,
  "balance_before" numeric(18, 2)  NOT NULL,
  "balance_after" numeric(18, 2)  NOT NULL,
  "authorized_by" integer,
  "transaction_ref" varchar(100),
  "reason" text,
  "status" varchar(20)  DEFAULT 'completed'  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "cbdc_wallets" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "currency" varchar(10)  NOT NULL,
  "balance" numeric(18, 2)  DEFAULT '0.00',
  "wallet_address" varchar(100),
  "issuer" varchar(200)  DEFAULT 'Central Bank',
  "wallet_type" varchar(20)  DEFAULT 'retail',
  "status" varchar(20)  DEFAULT 'active',
  "created_at" timestamp  DEFAULT now(),
  "updated_at" timestamp  DEFAULT now()
);

CREATE TABLE "cbn_compliance_exports" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "export_type" varchar(50)  NOT NULL,
  "from_date" timestamp  NOT NULL,
  "to_date" timestamp  NOT NULL,
  "corridor" varchar(20),
  "record_count" integer  DEFAULT 0  NOT NULL,
  "file_url" text,
  "file_key" text,
  "status" varchar(30)  DEFAULT 'generated'  NOT NULL,
  "generated_by" integer,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "cbn_corridors" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "corridor" varchar(20)  NOT NULL,
  "papss_enabled" boolean  DEFAULT false  NOT NULL,
  "exchange_rate" varchar(30),
  "transfer_fee_percent" varchar(10),
  "settlement_time_hours" integer  DEFAULT 24,
  "min_amount_usd" integer  DEFAULT 1,
  "max_amount_usd" integer  DEFAULT 50000,
  "is_active" boolean  DEFAULT true  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "cbn_corridors_corridor_unique" UNIQUE ("corridor")
);

CREATE TABLE "chargeback_cases" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "transaction_id" integer,
  "stripe_charge_id" varchar(200),
  "amount" numeric(18, 2)  NOT NULL,
  "currency" varchar(10)  DEFAULT 'USD'  NOT NULL,
  "reason" varchar(100)  NOT NULL,
  "status" varchar(30)  DEFAULT 'open'  NOT NULL,
  "evidence_url" text,
  "notes" text,
  "due_date" timestamp,
  "resolved_at" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "chat_agent_status" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "agent_id" integer  NOT NULL,
  "is_online" boolean  DEFAULT false  NOT NULL,
  "is_available" boolean  DEFAULT true  NOT NULL,
  "max_concurrent_chats" integer  DEFAULT 5  NOT NULL,
  "active_chat_count" integer  DEFAULT 0  NOT NULL,
  "last_seen_at" timestamp  DEFAULT now()  NOT NULL,
  "status_message" varchar(255),
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "chat_agent_status_agent_id_unique" UNIQUE ("agent_id")
);

CREATE TABLE "chat_canned_responses" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "title" varchar(255)  NOT NULL,
  "shortcut" varchar(50)  NOT NULL,
  "content" text  NOT NULL,
  "category" varchar(50)  DEFAULT 'general',
  "usage_count" integer  DEFAULT 0  NOT NULL,
  "created_by" integer,
  "is_active" boolean  DEFAULT true  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "chat_canned_responses_shortcut_unique" UNIQUE ("shortcut")
);

CREATE TABLE "chat_session_meta" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "session_id" integer  NOT NULL,
  "status" "chat_session_status"  DEFAULT 'bot'  NOT NULL,
  "priority" "chat_priority"  DEFAULT 'normal'  NOT NULL,
  "channel" "chat_channel"  DEFAULT 'web'  NOT NULL,
  "assigned_agent_id" integer,
  "queue_position" integer,
  "wait_time_seconds" integer,
  "first_response_at" timestamp,
  "resolved_at" timestamp,
  "satisfaction_score" integer,
  "satisfaction_comment" text,
  "tags" jsonb  DEFAULT '[]'::jsonb,
  "internal_notes" text,
  "escalated_at" timestamp,
  "escalated_reason" text,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "chat_session_meta_session_id_unique" UNIQUE ("session_id")
);

CREATE TABLE "chatMessages" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "sessionId" integer  NOT NULL,
  "role" "chat_role"  NOT NULL,
  "content" text  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "chatSessions" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "userId" integer  NOT NULL,
  "title" varchar(255)  DEFAULT 'New Conversation'  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "clearing_lines" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "correspondent_bank_id" integer  NOT NULL,
  "currency" varchar(10)  NOT NULL,
  "limit_usd" numeric(18, 2)  NOT NULL,
  "used_usd" numeric(18, 2)  DEFAULT '0'  NOT NULL,
  "utilization_percent" numeric(5, 2),
  "alert_threshold_percent" integer  DEFAULT 80  NOT NULL,
  "tiger_beetle_account_id" bigint,
  "redis_util_key" varchar(200),
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "community_activity_feed" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer,
  "actor_name" varchar(200)  NOT NULL,
  "actor_avatar" text,
  "activity_type" varchar(50)  NOT NULL,
  "title" varchar(300)  NOT NULL,
  "description" text,
  "amount" numeric(18, 2),
  "currency" varchar(10),
  "country" varchar(100),
  "sdg_goal" integer,
  "is_public" boolean  DEFAULT true  NOT NULL,
  "likes_count" integer  DEFAULT 0  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "community_funds" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "created_by_user_id" integer  NOT NULL,
  "name" varchar(200)  NOT NULL,
  "description" text,
  "country" varchar(64),
  "theme" varchar(100),
  "total_raised" numeric(18, 2)  DEFAULT '0',
  "goal_amount" numeric(18, 2),
  "currency" varchar(10)  DEFAULT 'USD',
  "contributor_count" integer  DEFAULT 0,
  "beneficiary_count" integer  DEFAULT 0,
  "sdg_goals" json  DEFAULT '[]'::json,
  "status" "community_fund_status"  DEFAULT 'active',
  "image_url" text,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "compliance_alert_notes" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "alert_id" integer  NOT NULL,
  "author_id" integer  NOT NULL,
  "content" text  NOT NULL,
  "is_internal" boolean  DEFAULT true  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "compliance_alerts" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "alert_type" varchar(50)  NOT NULL,
  "severity" varchar(20)  DEFAULT 'medium'  NOT NULL,
  "title" varchar(200)  NOT NULL,
  "description" text,
  "related_user_id" integer,
  "related_transaction_id" integer,
  "status" varchar(20)  DEFAULT 'open'  NOT NULL,
  "acknowledged_by" integer,
  "acknowledged_at" timestamp,
  "resolved_at" timestamp,
  "assigned_to" integer,
  "assigned_at" timestamp,
  "sar_submitted_at" timestamp,
  "sar_reference" varchar(64),
  "sar_deadline" timestamp,
  "snooze_until" timestamp,
  "mlro_notes" text,
  "metadata" text,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "compliance_email_config" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "tenant_id" integer,
  "officer_name" varchar(255)  NOT NULL,
  "officer_email" varchar(255)  NOT NULL,
  "report_types" json  DEFAULT '["CTR","SAR","FBAR"]'::json,
  "is_active" boolean  DEFAULT true  NOT NULL,
  "smtp_host" varchar(255)  DEFAULT 'smtp.sendgrid.net',
  "smtp_port" integer  DEFAULT 587,
  "smtp_user" varchar(255),
  "smtp_password_encrypted" text,
  "from_email" varchar(255)  DEFAULT 'compliance@remitflow.com',
  "from_name" varchar(100)  DEFAULT 'RemitFlow Compliance',
  "frequency" varchar(32)  DEFAULT 'immediate',
  "include_attachment" boolean  DEFAULT true,
  "encrypt_attachment" boolean  DEFAULT false,
  "created_by" integer,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "compliance_reports" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "report_type" varchar(50)  NOT NULL,
  "report_period" varchar(30)  NOT NULL,
  "generated_by" integer  NOT NULL,
  "status" varchar(20)  DEFAULT 'draft'  NOT NULL,
  "file_url" text,
  "summary" text,
  "total_transactions" integer  DEFAULT 0,
  "total_volume" numeric(18, 2),
  "flagged_transactions" integer  DEFAULT 0,
  "submitted_at" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "compliance_watchlist" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer,
  "name" varchar(200)  NOT NULL,
  "date_of_birth" date,
  "nationality" varchar(3),
  "id_number" varchar(50),
  "status" "watchlist_status"  DEFAULT 'clear'  NOT NULL,
  "risk_score" integer  DEFAULT 0  NOT NULL,
  "matched_lists" json  DEFAULT '[]'::json,
  "notes" text,
  "reviewed_by" integer,
  "reviewed_at" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "complianceCases" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "userId" integer  NOT NULL,
  "transactionId" integer,
  "caseType" "case_type"  DEFAULT 'aml_flag'  NOT NULL,
  "severity" "case_severity"  DEFAULT 'medium'  NOT NULL,
  "status" "case_status"  DEFAULT 'open'  NOT NULL,
  "title" varchar(255)  NOT NULL,
  "description" text,
  "riskScore" integer  DEFAULT 0,
  "priority" "ticket_priority"  DEFAULT 'medium',
  "assignedTo" varchar(255),
  "dueAt" timestamp,
  "resolvedAt" timestamp,
  "escalatedAt" timestamp,
  "notes" text,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "consent_records" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "consent_type" varchar(100)  NOT NULL,
  "granted" boolean  DEFAULT false,
  "version" varchar(20)  DEFAULT '1.0',
  "ip_address" varchar(45),
  "granted_at" timestamp,
  "revoked_at" timestamp,
  "created_at" timestamp  DEFAULT now()
);

CREATE TABLE "contractor_invoices" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "contractor_id" integer  NOT NULL,
  "owner_id" integer  NOT NULL,
  "invoice_number" varchar(50)  NOT NULL,
  "description" text  NOT NULL,
  "line_items" json  DEFAULT '[]'::json,
  "subtotal_usd" numeric(18, 2)  NOT NULL,
  "tax_amount_usd" numeric(18, 2)  DEFAULT '0',
  "total_usd" numeric(18, 2)  NOT NULL,
  "currency" varchar(8)  DEFAULT 'USD'  NOT NULL,
  "due_date" timestamp,
  "paid_at" timestamp,
  "status" "contractor_invoice_status"  DEFAULT 'draft',
  "rejection_reason" text,
  "payment_ref" varchar(100),
  "attachment_url" text,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "contractor_invoices_invoice_number_unique" UNIQUE ("invoice_number")
);

CREATE TABLE "contractors" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "owner_id" integer  NOT NULL,
  "company_id" integer,
  "full_name" varchar(200)  NOT NULL,
  "email" varchar(255)  NOT NULL,
  "phone" varchar(30),
  "country" varchar(4)  NOT NULL,
  "currency" varchar(8)  DEFAULT 'USD'  NOT NULL,
  "bank_name" varchar(200),
  "bank_account" varchar(100),
  "bank_routing_code" varchar(50),
  "tax_id" varchar(100),
  "specialty" varchar(200),
  "hourly_rate_usd" numeric(10, 2),
  "status" "contractor_status"  DEFAULT 'active',
  "kyc_verified" boolean  DEFAULT false,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "correspondent_banks" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "bank_name" varchar(200)  NOT NULL,
  "swift_bic" varchar(20)  NOT NULL,
  "country" varchar(5)  NOT NULL,
  "currency" varchar(10)  NOT NULL,
  "nostro_account_number" varchar(50),
  "clearing_line_usd" numeric(18, 2),
  "used_line_usd" numeric(18, 2)  DEFAULT '0',
  "settlement_cost_bps" integer  DEFAULT 150  NOT NULL,
  "risk_score" "correspondent_risk"  DEFAULT 'low'  NOT NULL,
  "derisking_status" "derisking_status"  DEFAULT 'active'  NOT NULL,
  "last_review_date" timestamp,
  "next_review_date" timestamp,
  "open_search_doc_id" varchar(200),
  "tiger_beetle_account_id" bigint,
  "kafka_topic" varchar(200),
  "lakehouse_table_path" varchar(500),
  "is_active" boolean  DEFAULT true  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "correspondent_banks_swift_bic_unique" UNIQUE ("swift_bic")
);

CREATE TABLE "correspondent_banks_v200" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "correspondent_id" varchar(100)  NOT NULL,
  "bank_name" varchar(200)  NOT NULL,
  "swift_code" varchar(11)  NOT NULL,
  "country_code" varchar(2),
  "currency" varchar(3),
  "clearing_line_usd" numeric(18, 2)  DEFAULT '0',
  "nostro_balance_usd" numeric(18, 2)  DEFAULT '0',
  "vostro_balance_usd" numeric(18, 2)  DEFAULT '0',
  "utilization_pct" numeric(5, 2)  DEFAULT '0',
  "fee_bps" numeric(6, 2)  DEFAULT '50',
  "settlement_rail" varchar(20)  DEFAULT 'swift',
  "status" varchar(20)  DEFAULT 'active',
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now(),
  CONSTRAINT "correspondent_banks_v200_correspondent_id_unique" UNIQUE ("correspondent_id")
);

CREATE TABLE "correspondent_risk_scores" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "correspondent_bank_id" integer  NOT NULL,
  "score_date" timestamp  DEFAULT now()  NOT NULL,
  "overall_score" numeric(5, 4)  NOT NULL,
  "aml_score" numeric(5, 4),
  "sanctions_score" numeric(5, 4),
  "financial_health_score" numeric(5, 4),
  "geopolitical_score" numeric(5, 4),
  "python_model_version" varchar(50),
  "open_search_doc_id" varchar(200),
  "lakehouse_row_id" varchar(200),
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "correspondent_settlements" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "correspondent_id" varchar(100)  NOT NULL,
  "direction" varchar(30)  NOT NULL,
  "amount_usd" numeric(18, 2),
  "currency" varchar(3),
  "status" varchar(20)  DEFAULT 'pending',
  "reference" varchar(100),
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "corridor_margin_history" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "corridor_id" varchar(50)  NOT NULL,
  "corridor_name" varchar(100)  NOT NULL,
  "change_type" varchar(30)  NOT NULL,
  "old_value" varchar(100),
  "new_value" varchar(100)  NOT NULL,
  "changed_by" integer  NOT NULL,
  "changed_by_name" varchar(100),
  "reason" text,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "credit_applications" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "company_id" integer  NOT NULL,
  "applicant_id" integer  NOT NULL,
  "credit_score_id" integer,
  "requested_usd" numeric(18, 2)  NOT NULL,
  "approved_usd" numeric(18, 2),
  "interest_rate_pct" numeric(5, 2),
  "term_months" integer,
  "purpose" varchar(300),
  "status" "credit_application_status"  DEFAULT 'draft',
  "disbursed_at" timestamp,
  "repaid_at" timestamp,
  "rejection_reason" text,
  "reviewed_by" integer,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "cron_jobs" (
  "id" varchar(64)  NOT NULL  PRIMARY KEY,
  "name" varchar(255)  NOT NULL,
  "description" text,
  "schedule" varchar(100)  NOT NULL,
  "status" "cron_job_status"  DEFAULT 'active'  NOT NULL,
  "last_run_at" timestamp,
  "last_run_status" varchar(20),
  "last_run_duration_ms" integer,
  "last_run_error" text,
  "next_run_at" timestamp,
  "run_count" integer  DEFAULT 0  NOT NULL,
  "error_count" integer  DEFAULT 0  NOT NULL,
  "category" varchar(50)  DEFAULT 'general'  NOT NULL,
  "metadata" text,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "cross_sell_offers" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "offer_type" "cross_sell_offer_type"  NOT NULL,
  "score" numeric(5, 4)  NOT NULL,
  "segment" varchar(30),
  "headline" varchar(200),
  "body" text,
  "cta_label" varchar(100),
  "cta_url" varchar(500),
  "status" "cross_sell_offer_status"  DEFAULT 'pending'  NOT NULL,
  "shown_at" timestamp,
  "responded_at" timestamp,
  "expires_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "ctr_auto_flags" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "transaction_id" integer  NOT NULL,
  "user_id" integer  NOT NULL,
  "amount" numeric(18, 2)  NOT NULL,
  "currency" varchar(10)  NOT NULL,
  "amount_usd" numeric(18, 2),
  "flag_reason" varchar(200)  NOT NULL,
  "report_type" varchar(20)  DEFAULT 'CTR'  NOT NULL,
  "status" varchar(30)  DEFAULT 'pending_review'  NOT NULL,
  "reviewed_by" integer,
  "reviewed_at" timestamp,
  "filed_at" timestamp,
  "notes" text,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "daily_volume_snapshots" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "snapshot_date" varchar(10)  NOT NULL,
  "total_transactions" integer  DEFAULT 0  NOT NULL,
  "total_volume_usd" numeric(18, 2)  DEFAULT '0'  NOT NULL,
  "total_fees_usd" numeric(18, 2)  DEFAULT '0'  NOT NULL,
  "unique_senders" integer  DEFAULT 0  NOT NULL,
  "top_corridor" varchar(20),
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "dbt_run_history" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "run_id" varchar(100),
  "model_select" varchar(255),
  "status" "pipeline_run_status"  DEFAULT 'pending'  NOT NULL,
  "triggered_by" integer,
  "started_at" timestamp  DEFAULT now()  NOT NULL,
  "completed_at" timestamp,
  "duration_ms" integer,
  "models_run" integer  DEFAULT 0,
  "models_error" integer  DEFAULT 0,
  "error_message" text,
  "results" json
);

CREATE TABLE "derisking_alerts" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "correspondent_bank_id" integer  NOT NULL,
  "alert_type" varchar(50)  NOT NULL,
  "severity" varchar(20)  NOT NULL,
  "title" varchar(300)  NOT NULL,
  "description" text,
  "is_acknowledged" boolean  DEFAULT false,
  "acknowledged_by" integer,
  "acknowledged_at" timestamp,
  "kafka_event_id" varchar(200),
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "developer_sandbox_sessions" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "session_key" varchar(100)  NOT NULL,
  "environment" varchar(20)  DEFAULT 'sandbox'  NOT NULL,
  "test_api_key" varchar(100),
  "request_count" integer  DEFAULT 0  NOT NULL,
  "last_request_at" timestamp,
  "expires_at" timestamp,
  "is_active" boolean  DEFAULT true  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "developer_sandbox_sessions_session_key_unique" UNIQUE ("session_key")
);

CREATE TABLE "diaspora_bonds" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "isin" varchar(20),
  "name" varchar(300)  NOT NULL,
  "issuer" varchar(200)  NOT NULL,
  "bond_type" "bond_type"  NOT NULL,
  "currency" varchar(8)  DEFAULT 'USD',
  "face_value" numeric(18, 2)  NOT NULL,
  "min_subscription" numeric(18, 2)  DEFAULT '500',
  "max_subscription" numeric(18, 2),
  "coupon_rate" numeric(6, 4)  NOT NULL,
  "coupon_frequency" "bond_coupon_freq"  DEFAULT 'semi_annual',
  "issue_date" timestamp  NOT NULL,
  "maturity_date" timestamp  NOT NULL,
  "offer_open_date" timestamp  NOT NULL,
  "offer_close_date" timestamp  NOT NULL,
  "target_raise" numeric(18, 2),
  "raised_amount" numeric(18, 2)  DEFAULT '0',
  "total_units" integer,
  "available_units" integer,
  "status" "bond_status"  DEFAULT 'upcoming',
  "rating_agency" varchar(50),
  "credit_rating" varchar(10),
  "prospectus_url" text,
  "image_url" text,
  "description" text,
  "eligible_countries" json  DEFAULT '[]'::json,
  "is_tax_exempt" boolean  DEFAULT false,
  "yield_to_maturity" numeric(6, 4),
  "duration" numeric(8, 4),
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "diaspora_bonds_isin_unique" UNIQUE ("isin")
);

CREATE TABLE "diaspora_canada_profiles" (
  "user_id" integer  NOT NULL,
  "province" varchar(5),
  "interac_email" varchar(200),
  "interac_phone" varchar(30),
  "fintrac_reporting_ref" varchar(100),
  "keycloak_role_id" varchar(100),
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "diaspora_canada_profiles_user_id_unique" UNIQUE ("user_id")
);

CREATE TABLE "diaspora_collective_members" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "collective_id" integer  NOT NULL,
  "user_id" integer  NOT NULL,
  "role" varchar(20)  DEFAULT 'member',
  "my_contribution" numeric(18, 2)  DEFAULT '0',
  "currency" varchar(10)  DEFAULT 'USD',
  "joined_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "diaspora_collectives" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "created_by_user_id" integer  NOT NULL,
  "name" varchar(200)  NOT NULL,
  "description" text,
  "target_amount" numeric(18, 2),
  "total_contributed" numeric(18, 2)  DEFAULT '0',
  "currency" varchar(10)  DEFAULT 'USD',
  "member_count" integer  DEFAULT 1,
  "max_members" integer  DEFAULT 20,
  "status" "collective_status"  DEFAULT 'forming',
  "investment_focus" varchar(200),
  "country" varchar(64),
  "next_vote_date" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "diaspora_eu_profiles" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "country" "eu_corridor"  NOT NULL,
  "sepa_iban" varchar(50),
  "sepa_bic" varchar(20),
  "sepa_account_name" varchar(200),
  "psd2_consent_id" varchar(200),
  "psd2_consent_expiry" timestamp,
  "eba_compliance_ref" varchar(100),
  "keycloak_role_id" varchar(100),
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "diaspora_eu_profiles_user_id_unique" UNIQUE ("user_id")
);

CREATE TABLE "diaspora_offer_claims" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "offer_type" varchar(50)  NOT NULL,
  "diaspora_region" varchar(20),
  "status" varchar(20)  DEFAULT 'active',
  "claimed_at" timestamp  DEFAULT now()  NOT NULL,
  "expires_at" timestamp,
  "used_at" timestamp
);

CREATE TABLE "diaspora_profiles" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "diaspora_region" varchar(20)  NOT NULL,
  "country_of_residence" varchar(2),
  "home_corridor" varchar(5)  DEFAULT 'NG',
  "preferred_payment_rail" varchar(20),
  "avg_transfer_amount_usd" numeric(12, 2)  DEFAULT '0',
  "transfer_frequency_per_year" numeric(5, 1)  DEFAULT '0',
  "total_transferred_ytd_usd" numeric(18, 2)  DEFAULT '0',
  "cross_sell_score" numeric(4, 3)  DEFAULT '0',
  "acquisition_channel" varchar(50),
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()
);

CREATE TABLE "diaspora_usa_profiles" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "us_state" varchar(5),
  "plaid_item_id" varchar(200),
  "plaid_access_token" varchar(500),
  "ach_routing_number" varchar(20),
  "ach_account_number" varchar(50),
  "ach_account_type" varchar(20),
  "fincen_mtl_number" varchar(100),
  "state_transmitter_licences" text[],
  "compliance_disclosure_accepted_at" timestamp,
  "keycloak_role_id" varchar(100),
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "diaspora_usa_profiles_user_id_unique" UNIQUE ("user_id")
);

CREATE TABLE "direct_debit_mandates" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "creditor" varchar(255)  NOT NULL,
  "creditor_account" varchar(100),
  "amount" numeric(18, 2)  NOT NULL,
  "currency" varchar(10)  DEFAULT 'NGN',
  "frequency" "dd_freq"  DEFAULT 'monthly',
  "status" "dd_status"  DEFAULT 'active',
  "next_debit_date" timestamp,
  "last_debit_date" timestamp,
  "mandate_ref" varchar(100),
  "created_at" timestamp  DEFAULT now()
);

CREATE TABLE "disputes" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "userId" integer  NOT NULL,
  "transactionId" integer,
  "type" "dispute_type"  NOT NULL,
  "description" text  NOT NULL,
  "status" "dispute_status"  DEFAULT 'open',
  "resolution" text,
  "fileUrl" text,
  "fileKey" text,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "doc_reminder_log" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "document_id" integer  NOT NULL,
  "reminder_type" varchar(10)  NOT NULL,
  "channel" varchar(20)  NOT NULL,
  "status" varchar(20)  DEFAULT 'sent'  NOT NULL,
  "sent_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "doc_reminder_prefs" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "remind_30d" boolean  DEFAULT true  NOT NULL,
  "remind_14d" boolean  DEFAULT true  NOT NULL,
  "remind_7d" boolean  DEFAULT true  NOT NULL,
  "remind_3d" boolean  DEFAULT true  NOT NULL,
  "remind_1d" boolean  DEFAULT true  NOT NULL,
  "notify_email" boolean  DEFAULT true  NOT NULL,
  "notify_in_app" boolean  DEFAULT true  NOT NULL,
  "notify_push" boolean  DEFAULT false  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "doc_reminder_prefs_user_id_unique" UNIQUE ("user_id")
);

CREATE TABLE "document_renewals" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "original_doc_id" integer  NOT NULL,
  "new_doc_id" integer,
  "user_id" integer  NOT NULL,
  "status" varchar(20)  DEFAULT 'pending'  NOT NULL,
  "initiated_at" timestamp  DEFAULT now()  NOT NULL,
  "completed_at" timestamp,
  "notes" text
);

CREATE TABLE "document_vault" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "name" varchar(255)  NOT NULL,
  "description" text,
  "category" "document_vault_category"  DEFAULT 'other'  NOT NULL,
  "status" "document_vault_status"  DEFAULT 'active'  NOT NULL,
  "file_url" text  NOT NULL,
  "file_key" varchar(500)  NOT NULL,
  "mime_type" varchar(100),
  "file_size" integer,
  "is_encrypted" boolean  DEFAULT false,
  "expires_at" timestamp,
  "shared_with" json  DEFAULT '[]'::json,
  "tags" json  DEFAULT '[]'::json,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "ecowas_compliance_checks" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "transfer_id" integer,
  "user_id" integer  NOT NULL,
  "corridor_code" "west_african_corridor"  NOT NULL,
  "amount_ngn" numeric(18, 2)  NOT NULL,
  "check_type" varchar(50)  NOT NULL,
  "result" varchar(20)  NOT NULL,
  "risk_score" numeric(5, 4),
  "details" jsonb,
  "open_search_doc_id" varchar(200),
  "tiger_beetle_entry_id" bigint,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "embedded_payroll_api_keys" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "tenant_id" integer  NOT NULL,
  "key_hash" varchar(128)  NOT NULL,
  "key_prefix" varchar(12)  NOT NULL,
  "label" varchar(200),
  "environment" varchar(10)  DEFAULT 'sandbox',
  "status" "embedded_payroll_api_key_status"  DEFAULT 'active',
  "last_used_at" timestamp,
  "expires_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "embedded_payroll_api_keys_key_hash_unique" UNIQUE ("key_hash")
);

CREATE TABLE "embedded_payroll_requests" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "tenant_id" integer  NOT NULL,
  "api_key_id" integer  NOT NULL,
  "external_run_id" varchar(100),
  "company_name" varchar(200)  NOT NULL,
  "employee_count" integer  NOT NULL,
  "total_amount_usd" numeric(18, 2)  NOT NULL,
  "currency" varchar(8)  DEFAULT 'USD',
  "payload_hash" varchar(128),
  "status" varchar(30)  DEFAULT 'received',
  "processed_at" timestamp,
  "error_message" text,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "entity_group_members" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "group_id" integer  NOT NULL,
  "company_id" integer  NOT NULL,
  "role" varchar(50)  DEFAULT 'subsidiary',
  "added_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "entity_groups" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "owner_id" integer  NOT NULL,
  "name" varchar(300)  NOT NULL,
  "description" text,
  "base_currency" varchar(8)  DEFAULT 'USD',
  "status" "entity_group_status"  DEFAULT 'active',
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "erasure_requests" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "requested_at" timestamp  DEFAULT now(),
  "scheduled_at" timestamp  NOT NULL,
  "executed_at" timestamp,
  "cancelled_at" timestamp,
  "status" varchar(30)  DEFAULT 'pending',
  "reason" varchar(500),
  "ip_address" varchar(45),
  "anonymized_fields" text,
  "retained_records" text,
  "created_at" timestamp  DEFAULT now(),
  "updated_at" timestamp  DEFAULT now()
);

CREATE TABLE "esg_reports" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "owner_id" integer  NOT NULL,
  "reporting_period" varchar(20)  NOT NULL,
  "total_remittance_usd" numeric(18, 2),
  "co2_offset_kg" numeric(18, 2),
  "financial_inclusion_count" integer,
  "women_beneficiaries" integer,
  "rural_reach" integer,
  "jobs_supported" integer,
  "sdg_goals" json  DEFAULT '[]'::json,
  "carbon_cert_url" text,
  "published_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "exchange_rate_alerts" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "from_currency" varchar(10)  NOT NULL,
  "to_currency" varchar(10)  NOT NULL,
  "target_rate" numeric(18, 6)  NOT NULL,
  "direction" varchar(10)  DEFAULT 'above'  NOT NULL,
  "is_active" boolean  DEFAULT true  NOT NULL,
  "triggered_at" timestamp,
  "notification_sent" boolean  DEFAULT false  NOT NULL,
  "snooze_until" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "expense_items" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "report_id" integer  NOT NULL,
  "category" "expense_category"  NOT NULL,
  "description" varchar(500)  NOT NULL,
  "amount_usd" numeric(10, 2)  NOT NULL,
  "currency" varchar(8)  DEFAULT 'USD',
  "expense_date" timestamp  NOT NULL,
  "receipt_url" text,
  "merchant_name" varchar(200),
  "policy_id" integer,
  "auto_approved" boolean  DEFAULT false,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "expense_policies" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "company_id" integer  NOT NULL,
  "name" varchar(200)  NOT NULL,
  "category" "expense_category"  NOT NULL,
  "max_amount_usd" numeric(10, 2)  NOT NULL,
  "requires_receipt" boolean  DEFAULT true,
  "action" "expense_policy_action"  DEFAULT 'require_review',
  "is_active" boolean  DEFAULT true,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "expense_reports" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "company_id" integer  NOT NULL,
  "submitted_by" integer  NOT NULL,
  "approved_by" integer,
  "title" varchar(300)  NOT NULL,
  "description" text,
  "total_amount_usd" numeric(18, 2)  DEFAULT '0',
  "currency" varchar(8)  DEFAULT 'USD',
  "status" "expense_status"  DEFAULT 'draft',
  "rejection_reason" text,
  "reimbursed_at" timestamp,
  "payment_ref" varchar(100),
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "family_budgets" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "family_member_id" integer  NOT NULL,
  "monthly_limit" numeric(18, 2)  NOT NULL,
  "currency" varchar(10)  DEFAULT 'USD',
  "current_month_spent" numeric(18, 2)  DEFAULT '0',
  "alert_threshold" integer  DEFAULT 80,
  "auto_renew" boolean  DEFAULT true,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "family_members" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "name" varchar(200)  NOT NULL,
  "relationship" "family_relationship"  DEFAULT 'other',
  "country" varchar(64),
  "phone" varchar(30),
  "email" varchar(200),
  "bank_account" varchar(100),
  "bank_name" varchar(200),
  "currency" varchar(10)  DEFAULT 'NGN',
  "avatar_url" text,
  "notes" text,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "feature_flags" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "key" varchar(100)  NOT NULL,
  "name" varchar(255)  NOT NULL,
  "description" text,
  "scope" "feature_flag_scope"  DEFAULT 'global'  NOT NULL,
  "default_enabled" boolean  DEFAULT true  NOT NULL,
  "rollout_pct" integer  DEFAULT 100  NOT NULL,
  "required_plan" "tenant_plan",
  "category" varchar(50)  DEFAULT 'feature',
  "tags" json  DEFAULT '[]'::json,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "feature_flags_key_unique" UNIQUE ("key")
);

CREATE TABLE "fee_rules" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "corridor" varchar(20)  NOT NULL,
  "min_amount" numeric(18, 2)  DEFAULT '0'  NOT NULL,
  "max_amount" numeric(18, 2),
  "fee_type" varchar(20)  DEFAULT 'percentage'  NOT NULL,
  "fee_percentage" numeric(5, 4)  DEFAULT '0',
  "fee_fixed" numeric(18, 2)  DEFAULT '0',
  "min_fee" numeric(18, 2)  DEFAULT '0',
  "max_fee" numeric(18, 2),
  "is_active" boolean  DEFAULT true  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "flutterwave_transactions" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "flw_ref" varchar(100)  NOT NULL,
  "tx_ref" varchar(100)  NOT NULL,
  "amount_usd" numeric(18, 2)  NOT NULL,
  "currency" varchar(10)  DEFAULT 'USD'  NOT NULL,
  "payment_link" text,
  "status" varchar(30)  DEFAULT 'pending'  NOT NULL,
  "wallet_credited" boolean  DEFAULT false  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "flutterwave_transactions_flw_ref_unique" UNIQUE ("flw_ref"),
  CONSTRAINT "flutterwave_transactions_tx_ref_unique" UNIQUE ("tx_ref")
);

CREATE TABLE "form_m_documents" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "trade_payment_id" integer,
  "form_type" varchar(10)  NOT NULL,
  "form_number" varchar(50),
  "document_url" varchar(500),
  "cbn_portal_ref" varchar(100),
  "validity_date" timestamp,
  "python_validation_result" jsonb,
  "status" varchar(30)  DEFAULT 'pending'  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "fraud_alerts" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer,
  "transaction_id" integer,
  "risk_score" integer  DEFAULT 0,
  "risk_level" "fraud_risk_level"  DEFAULT 'low',
  "status" "fraud_alert_status"  DEFAULT 'pending',
  "flagged_reasons" json,
  "transaction_amount" integer  DEFAULT 0,
  "reviewer_id" integer,
  "reviewer_notes" text,
  "reviewed_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "fraud_model_runs" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "run_id" text  NOT NULL,
  "model_name" text  NOT NULL,
  "model_version" text  NOT NULL,
  "triggered_by" text  DEFAULT 'airflow'  NOT NULL,
  "status" text  DEFAULT 'running'  NOT NULL,
  "accuracy" integer,
  "f1_score" integer,
  "auc_roc" integer,
  "training_records" integer,
  "validation_records" integer,
  "duration_seconds" integer,
  "completed_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "fraud_model_runs_run_id_unique" UNIQUE ("run_id")
);

CREATE TABLE "fund_proposals" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "fund_id" integer  NOT NULL,
  "submitted_by_user_id" integer  NOT NULL,
  "title" varchar(300)  NOT NULL,
  "description" text,
  "requested_amount" numeric(18, 2)  NOT NULL,
  "currency" varchar(10)  DEFAULT 'USD',
  "beneficiary_name" varchar(200),
  "beneficiary_country" varchar(64),
  "impact_description" text,
  "status" "proposal_status"  DEFAULT 'voting',
  "votes_for" integer  DEFAULT 0,
  "votes_against" integer  DEFAULT 0,
  "voting_deadline" timestamp,
  "funded_at" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "fund_votes" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "proposal_id" integer  NOT NULL,
  "user_id" integer  NOT NULL,
  "vote" varchar(10)  NOT NULL,
  "comment" text,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "fx_alert_trigger_history" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "alert_id" integer  NOT NULL,
  "user_id" integer  NOT NULL,
  "from_currency" varchar(10)  NOT NULL,
  "to_currency" varchar(10)  NOT NULL,
  "target_rate" numeric(18, 6)  NOT NULL,
  "triggered_rate" numeric(18, 6)  NOT NULL,
  "direction" varchar(10)  DEFAULT 'above'  NOT NULL,
  "notification_sent" boolean  DEFAULT false  NOT NULL,
  "triggered_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "fx_rate_history" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "from_currency" varchar(10)  NOT NULL,
  "to_currency" varchar(10)  NOT NULL,
  "rate" numeric(18, 8)  NOT NULL,
  "source" varchar(50)  DEFAULT 'api'  NOT NULL,
  "recorded_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "fxAlerts" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "userId" integer  NOT NULL,
  "fromCurrency" varchar(8)  NOT NULL,
  "toCurrency" varchar(8)  NOT NULL,
  "targetRate" numeric(18, 6)  NOT NULL,
  "direction" "fx_direction"  NOT NULL,
  "isActive" boolean  DEFAULT true,
  "triggered" boolean  DEFAULT false,
  "triggeredAt" timestamp,
  "notifiedAt" timestamp,
  "lastCheckedRate" numeric(18, 6),
  "lastCheckedAt" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "fxRateCache" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "baseCurrency" varchar(8)  NOT NULL,
  "rates" json  NOT NULL,
  "fetchedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "ghipss_transfers" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "transfer_id" varchar(100)  NOT NULL,
  "ghipss_ref" varchar(100),
  "transfer_type" varchar(20)  NOT NULL,
  "send_amount" numeric(18, 6)  NOT NULL,
  "send_currency" varchar(10)  NOT NULL,
  "receive_currency" varchar(10),
  "receive_amount" numeric(18, 6),
  "sender_account" varchar(200)  NOT NULL,
  "receiver_account" varchar(200)  NOT NULL,
  "receiver_bank" varchar(50),
  "receiver_msisdn" varchar(20),
  "sender_name" varchar(200),
  "receiver_name" varchar(200),
  "narration" varchar(500),
  "status" varchar(30)  DEFAULT 'pending'  NOT NULL,
  "mojaloop_routed" boolean  DEFAULT false,
  "papss_routed" boolean  DEFAULT false,
  "error_message" text,
  "settled_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "ghipss_transfers_transfer_id_unique" UNIQUE ("transfer_id")
);

CREATE TABLE "hnw_client_profiles" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "aum_tier" varchar(20)  DEFAULT 'standard',
  "negotiated_spread_bps" numeric(6, 2)  DEFAULT '150.00',
  "rm_name" varchar(100),
  "rm_email" varchar(200),
  "rm_phone" varchar(30),
  "max_rate_lock_amount_ngn" numeric(18, 2),
  "preferred_currencies" text,
  "notes" text,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now(),
  CONSTRAINT "hnw_client_profiles_user_id_unique" UNIQUE ("user_id")
);

CREATE TABLE "hnw_fx_rates" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "hnw_profile_id" integer  NOT NULL,
  "currency_pair" varchar(10)  NOT NULL,
  "base_rate" numeric(18, 8)  NOT NULL,
  "negotiated_rate" numeric(18, 8)  NOT NULL,
  "spread_bps" integer  NOT NULL,
  "valid_from" timestamp  NOT NULL,
  "valid_until" timestamp  NOT NULL,
  "rust_engine_quote_id" varchar(200),
  "redis_rate_key" varchar(200),
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "hnw_portfolios" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "hnw_profile_id" integer  NOT NULL,
  "asset_class" varchar(50)  NOT NULL,
  "asset_name" varchar(200)  NOT NULL,
  "current_value_usd" numeric(18, 2)  NOT NULL,
  "allocation_percent" numeric(5, 2),
  "yield_percent" numeric(5, 4),
  "open_search_doc_id" varchar(200),
  "tiger_beetle_account_id" bigint,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "hnw_profiles" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "tier" "hnw_tier"  DEFAULT 'standard'  NOT NULL,
  "annual_transfer_volume_usd" numeric(18, 2),
  "assigned_rm_id" integer,
  "negotiated_fx_spread_bps" integer  DEFAULT 150,
  "priority_swift_enabled" boolean  DEFAULT false,
  "dedicated_iban_enabled" boolean  DEFAULT false,
  "keycloak_role_id" varchar(100),
  "permify_subject_id" varchar(100),
  "onboarded_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "hnw_profiles_user_id_unique" UNIQUE ("user_id")
);

CREATE TABLE "hnw_rate_locks" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "lock_id" varchar(100)  NOT NULL,
  "user_id" integer  NOT NULL,
  "corridor_code" varchar(5)  NOT NULL,
  "amount_ngn" numeric(18, 2),
  "fx_rate" numeric(18, 8),
  "spread_bps" numeric(6, 2),
  "status" varchar(20)  DEFAULT 'active',
  "expires_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "hnw_rate_locks_lock_id_unique" UNIQUE ("lock_id")
);

CREATE TABLE "hnw_relationship_managers" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "display_name" varchar(200)  NOT NULL,
  "email" varchar(200)  NOT NULL,
  "phone" varchar(30),
  "calendar_url" varchar(500),
  "max_clients" integer  DEFAULT 25  NOT NULL,
  "current_clients" integer  DEFAULT 0  NOT NULL,
  "specialisations" text[],
  "dapr_actor_id" varchar(200),
  "is_active" boolean  DEFAULT true  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "hnw_relationship_managers_user_id_unique" UNIQUE ("user_id")
);

CREATE TABLE "hnw_rm_requests" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "message" text  NOT NULL,
  "preferred_contact_time" varchar(100),
  "topic" varchar(50)  DEFAULT 'general',
  "status" varchar(20)  DEFAULT 'pending',
  "rm_response" text,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "resolved_at" timestamp
);

CREATE TABLE "hnw_transfers" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "transfer_id" varchar(100)  NOT NULL,
  "user_id" integer  NOT NULL,
  "rate_lock_id" varchar(100),
  "corridor_code" varchar(5)  NOT NULL,
  "amount_ngn" numeric(18, 2),
  "fx_rate" numeric(18, 8),
  "recipient_swift" varchar(11),
  "recipient_account" varchar(34),
  "recipient_name" varchar(100),
  "purpose_code" varchar(10)  DEFAULT 'PER',
  "status" varchar(30)  DEFAULT 'pending',
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "hnw_transfers_transfer_id_unique" UNIQUE ("transfer_id")
);

CREATE TABLE "idempotency_keys" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "key" varchar(200)  NOT NULL,
  "user_id" integer,
  "operation" varchar(100)  NOT NULL,
  "response_status" integer,
  "response_body" text,
  "expires_at" timestamp  NOT NULL,
  "created_at" timestamp  DEFAULT now()
);

CREATE TABLE "immigrant_worker_kyc" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "kyc_tier" varchar(20)  DEFAULT 'tier1',
  "nin" varchar(11),
  "bvn" varchar(11),
  "selfie_verified" boolean  DEFAULT false,
  "document_type" varchar(50),
  "document_verified" boolean  DEFAULT false,
  "monthly_limit_usd" numeric(12, 2)  DEFAULT '500.00',
  "monthly_used_usd" numeric(12, 2)  DEFAULT '0.00',
  "annual_limit_usd" numeric(12, 2)  DEFAULT '5000.00',
  "annual_used_usd" numeric(12, 2)  DEFAULT '0.00',
  "verification_provider" varchar(50),
  "verified_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "immigrant_worker_kyc_user_id_unique" UNIQUE ("user_id")
);

CREATE TABLE "immigrant_worker_profiles" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "nationality_code" varchar(5)  NOT NULL,
  "preferred_language" varchar(10)  DEFAULT 'en',
  "employer_name" varchar(200),
  "employer_address" text,
  "work_permit_number" varchar(50),
  "work_permit_expiry" timestamp,
  "kyc_tier" "kyc_tier_v2"  DEFAULT 'tier0'  NOT NULL,
  "daily_limit_ngn" integer  DEFAULT 50000  NOT NULL,
  "monthly_limit_ngn" integer  DEFAULT 200000  NOT NULL,
  "keycloak_role_id" varchar(100),
  "permify_subject_id" varchar(100),
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "impersonationTokens" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "adminId" integer  NOT NULL,
  "targetUserId" integer  NOT NULL,
  "token" varchar(128)  NOT NULL,
  "expiresAt" timestamp  NOT NULL,
  "usedAt" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "impersonationTokens_token_unique" UNIQUE ("token")
);

CREATE TABLE "interac_payment_methods" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "interac_email" varchar(200),
  "interac_phone" varchar(30),
  "bank_name" varchar(200),
  "transit_number" varchar(10),
  "institution_number" varchar(5),
  "account_number_masked" varchar(20),
  "is_verified" boolean  DEFAULT false,
  "is_default" boolean  DEFAULT false,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "intercompany_transfers" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "group_id" integer  NOT NULL,
  "from_company_id" integer  NOT NULL,
  "to_company_id" integer  NOT NULL,
  "amount_usd" numeric(18, 2)  NOT NULL,
  "from_currency" varchar(8)  NOT NULL,
  "to_currency" varchar(8)  NOT NULL,
  "fx_rate" numeric(18, 8),
  "purpose" varchar(300),
  "status" "intercompany_transfer_status"  DEFAULT 'pending',
  "approved_by" integer,
  "approved_at" timestamp,
  "completed_at" timestamp,
  "payment_ref" varchar(100),
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "investment_assets" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "symbol" varchar(20)  NOT NULL,
  "name" varchar(200)  NOT NULL,
  "asset_type" "investment_asset_type"  NOT NULL,
  "exchange" varchar(50),
  "country" varchar(64),
  "sector" varchar(100),
  "current_price" numeric(18, 6)  DEFAULT '0',
  "currency" varchar(10)  DEFAULT 'USD',
  "price_change_24h" numeric(10, 4)  DEFAULT '0',
  "price_change_pct_24h" numeric(10, 4)  DEFAULT '0',
  "market_cap" numeric(24, 2),
  "volume_24h" numeric(24, 2),
  "description" text,
  "logo_url" text,
  "min_investment" numeric(18, 2)  DEFAULT '10',
  "is_active" boolean  DEFAULT true,
  "is_featured" boolean  DEFAULT false,
  "tags" json  DEFAULT '[]'::json,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "investment_opportunities" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "title" varchar(300)  NOT NULL,
  "description" text,
  "country" varchar(64)  NOT NULL,
  "sector" varchar(100),
  "stage" "investment_stage"  DEFAULT 'seed',
  "target_amount" numeric(18, 2)  NOT NULL,
  "raised_amount" numeric(18, 2)  DEFAULT '0',
  "min_investment" numeric(18, 2)  DEFAULT '100',
  "currency" varchar(10)  DEFAULT 'USD',
  "due_date" timestamp,
  "sdg_alignment" json  DEFAULT '[]'::json,
  "expected_return" numeric(5, 2),
  "risk_level" varchar(20)  DEFAULT 'medium',
  "image_url" text,
  "status" "investment_status"  DEFAULT 'open',
  "investor_count" integer  DEFAULT 0,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "investment_orders" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "asset_id" integer  NOT NULL,
  "order_type" varchar(10)  DEFAULT 'buy',
  "quantity" numeric(18, 8)  NOT NULL,
  "price_at_order" numeric(18, 6)  NOT NULL,
  "total_amount" numeric(18, 2)  NOT NULL,
  "currency" varchar(10)  DEFAULT 'USD',
  "status" varchar(20)  DEFAULT 'completed',
  "fee" numeric(10, 4)  DEFAULT '0',
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "investment_price_history" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "asset_id" integer  NOT NULL,
  "open" numeric(18, 6)  NOT NULL,
  "high" numeric(18, 6)  NOT NULL,
  "low" numeric(18, 6)  NOT NULL,
  "close" numeric(18, 6)  NOT NULL,
  "volume" numeric(24, 2)  DEFAULT '0',
  "timestamp" timestamp  NOT NULL,
  "interval" varchar(10)  DEFAULT '1d'
);

CREATE TABLE "investment_watchlist" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "asset_id" integer  NOT NULL,
  "alert_price" numeric(18, 6),
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "invoice_financing_applications" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "applicant_id" integer  NOT NULL,
  "invoice_number" varchar(100)  NOT NULL,
  "debtor_name" varchar(300)  NOT NULL,
  "debtor_country" varchar(4),
  "invoice_amount_usd" numeric(18, 2)  NOT NULL,
  "advance_rate_pct" numeric(5, 2)  DEFAULT '80',
  "advance_amount_usd" numeric(18, 2),
  "fee_rate_pct" numeric(5, 2)  DEFAULT '2.5',
  "fee_amount_usd" numeric(18, 2),
  "invoice_due_date" timestamp  NOT NULL,
  "invoice_doc_url" text,
  "contract_doc_url" text,
  "status" "invoice_financing_status"  DEFAULT 'draft',
  "funded_at" timestamp,
  "repaid_at" timestamp,
  "reviewed_by" integer,
  "rejection_reason" text,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "invoice_financing_repayments" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "application_id" integer  NOT NULL,
  "amount_usd" numeric(18, 2)  NOT NULL,
  "payment_ref" varchar(100),
  "paid_at" timestamp  DEFAULT now()  NOT NULL,
  "notes" text
);

CREATE TABLE "ip_login_history" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer,
  "ip_address" varchar(45)  NOT NULL,
  "user_agent" text,
  "country" varchar(100),
  "city" varchar(100),
  "is_success" boolean  DEFAULT true  NOT NULL,
  "is_suspicious" boolean  DEFAULT false  NOT NULL,
  "suspicious_reason" varchar(200),
  "device_fingerprint" varchar(200),
  "login_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "kafka_consumer_metrics" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "topic" varchar(200)  NOT NULL,
  "group_id" varchar(100)  NOT NULL,
  "partition" integer  DEFAULT 0  NOT NULL,
  "current_offset" bigint  DEFAULT 0  NOT NULL,
  "log_end_offset" bigint  DEFAULT 0  NOT NULL,
  "lag" bigint  DEFAULT 0  NOT NULL,
  "messages_consumed" bigint  DEFAULT 0  NOT NULL,
  "messages_per_second" numeric(10, 2)  DEFAULT '0',
  "last_consumed_at" timestamp,
  "status" varchar(20)  DEFAULT 'active'  NOT NULL,
  "error_message" text,
  "recorded_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "kyb_records" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "business_name" varchar(300)  NOT NULL,
  "registration_number" varchar(100),
  "tax_id" varchar(100),
  "incorporation_date" varchar(20),
  "country" varchar(10),
  "industry" varchar(100),
  "website" varchar(300),
  "annual_revenue" numeric(18, 2),
  "employee_count" integer,
  "ubo_name" varchar(200),
  "ubo_ownership" numeric(5, 2),
  "status" varchar(30)  DEFAULT 'pending',
  "risk_rating" varchar(20)  DEFAULT 'medium',
  "reviewed_by" varchar(100),
  "reviewed_at" timestamp,
  "rejection_reason" text,
  "created_at" timestamp  DEFAULT now(),
  "updated_at" timestamp  DEFAULT now()
);

CREATE TABLE "kyc_lifecycle" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "stage" "kyc_stage"  DEFAULT 'not_started'  NOT NULL,
  "tier" integer  DEFAULT 1  NOT NULL,
  "submitted_at" timestamp,
  "review_started_at" timestamp,
  "reviewed_at" timestamp,
  "approved_at" timestamp,
  "rejected_at" timestamp,
  "expires_at" timestamp,
  "rejection_reason" text,
  "additional_info_required" text,
  "reviewed_by" integer,
  "risk_score" integer  DEFAULT 0,
  "notes" text,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "kyc_lifecycle_history" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "lifecycle_id" integer  NOT NULL,
  "user_id" integer  NOT NULL,
  "from_stage" "kyc_stage"  NOT NULL,
  "to_stage" "kyc_stage"  NOT NULL,
  "changed_by" integer,
  "reason" text,
  "metadata" json,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "kyc_liveness_audit" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "kyc_doc_id" integer,
  "passive_score" numeric(5, 4),
  "passive_passed" boolean,
  "passive_spoofing_type" varchar(50),
  "active_blink_count" integer,
  "active_head_movement_deg" numeric(6, 2),
  "active_passed" boolean,
  "deepfake_score" numeric(5, 4),
  "deepfake_method" varchar(100),
  "deepfake_indicators" json,
  "deepfake_passed" boolean,
  "corridor_code" varchar(5)  DEFAULT '',
  "overall_live" boolean  DEFAULT false  NOT NULL,
  "source" varchar(30)  DEFAULT 'trpc_extract',
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "kycDocuments" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "userId" integer  NOT NULL,
  "docType" "kyc_doc_type"  NOT NULL,
  "status" "kyc_doc_status"  DEFAULT 'pending',
  "fileUrl" text,
  "fileKey" text,
  "rejectionReason" text,
  "expiresAt" timestamp,
  "reviewedAt" timestamp,
  "supersededAt" timestamp,
  "extractedData" json,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "lc_documents" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "lc_id" integer  NOT NULL,
  "document_type" varchar(100)  NOT NULL,
  "document_url" text  NOT NULL,
  "uploaded_by" integer  NOT NULL,
  "verified" boolean  DEFAULT false,
  "verified_by" integer,
  "verified_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "letters_of_credit" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "applicant_id" integer  NOT NULL,
  "lc_number" varchar(50)  NOT NULL,
  "lc_type" "lc_type"  DEFAULT 'sight',
  "beneficiary_name" varchar(300)  NOT NULL,
  "beneficiary_country" varchar(4)  NOT NULL,
  "beneficiary_bank" varchar(300),
  "issuing_bank" varchar(300)  DEFAULT 'RemitFlow Trade Finance',
  "amount_usd" numeric(18, 2)  NOT NULL,
  "currency" varchar(8)  DEFAULT 'USD',
  "goods_description" text  NOT NULL,
  "shipment_port" varchar(200),
  "destination_port" varchar(200),
  "latest_ship_date" timestamp,
  "expiry_date" timestamp  NOT NULL,
  "incoterms" varchar(20)  DEFAULT 'CIF',
  "documents_required" json  DEFAULT '[]'::json,
  "status" "lc_status"  DEFAULT 'draft',
  "issued_at" timestamp,
  "settled_at" timestamp,
  "collateral_pct" numeric(5, 2)  DEFAULT '10',
  "fee_amount_usd" numeric(18, 2),
  "reviewed_by" integer,
  "rejection_reason" text,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "letters_of_credit_lc_number_unique" UNIQUE ("lc_number")
);

CREATE TABLE "market_listings" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "seller_id" integer  NOT NULL,
  "title" varchar(200)  NOT NULL,
  "description" text,
  "category" "market_category"  DEFAULT 'other'  NOT NULL,
  "price" numeric(18, 2)  NOT NULL,
  "currency" varchar(10)  DEFAULT 'USD'  NOT NULL,
  "country" varchar(64)  NOT NULL,
  "city" varchar(64),
  "image_url" text,
  "status" "market_listing_status"  DEFAULT 'active'  NOT NULL,
  "view_count" integer  DEFAULT 0,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "market_orders" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "listing_id" integer  NOT NULL,
  "buyer_id" integer  NOT NULL,
  "seller_id" integer  NOT NULL,
  "amount" numeric(18, 2)  NOT NULL,
  "currency" varchar(10)  NOT NULL,
  "status" "market_order_status"  DEFAULT 'pending_payment'  NOT NULL,
  "escrow_held" boolean  DEFAULT false,
  "buyer_note" text,
  "seller_note" text,
  "deliveryConfirmedAt" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "market_ratings" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "order_id" integer  NOT NULL,
  "rater_id" integer  NOT NULL,
  "rated_user_id" integer  NOT NULL,
  "rating" integer  NOT NULL,
  "review" text,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "market_ratings_order_id_unique" UNIQUE ("order_id")
);

CREATE TABLE "mbridge_transfers" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "transfer_id" varchar(100)  NOT NULL,
  "dlt_tx_hash" varchar(100),
  "sender_country" varchar(3)  NOT NULL,
  "receiver_country" varchar(3)  NOT NULL,
  "send_amount" numeric(18, 6)  NOT NULL,
  "send_cbdc" varchar(20)  NOT NULL,
  "receive_cbdc" varchar(20)  NOT NULL,
  "receive_amount" numeric(18, 6),
  "exchange_rate" numeric(18, 8),
  "sender_cbdc_address" varchar(200),
  "receiver_cbdc_address" varchar(200)  NOT NULL,
  "status" varchar(30)  DEFAULT 'pending'  NOT NULL,
  "mojaloop_routed" boolean  DEFAULT false,
  "settlement_time_ms" integer,
  "error_message" text,
  "settled_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "mbridge_transfers_transfer_id_unique" UNIQUE ("transfer_id")
);

CREATE TABLE "merchant_kyb_reviews" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "business_name" varchar(300)  NOT NULL,
  "registration_number" varchar(100),
  "tax_id" varchar(100),
  "country" varchar(4)  NOT NULL,
  "industry" varchar(100),
  "website" varchar(300),
  "expected_monthly_vol" numeric(18, 2),
  "business_reg_doc_url" text,
  "director_id_doc_url" text,
  "bank_statement_doc_url" text,
  "aml_policy_doc_url" text,
  "status" "merchant_kyb_status"  DEFAULT 'pending',
  "reviewed_by" integer,
  "reviewed_at" timestamp,
  "rejection_reason" text,
  "risk_rating" varchar(20)  DEFAULT 'medium',
  "notes" text,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "mfa_settings" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "totp_secret" varchar(100),
  "totp_enabled" boolean  DEFAULT false  NOT NULL,
  "backup_codes" text,
  "enrolled_at" timestamp,
  "last_used_at" timestamp,
  "failed_attempts" integer  DEFAULT 0  NOT NULL,
  "locked_until" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "mfa_settings_user_id_unique" UNIQUE ("user_id")
);

CREATE TABLE "mojaloop_fsps" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "fsp_id" varchar(100)  NOT NULL,
  "name" varchar(200)  NOT NULL,
  "country" varchar(10)  NOT NULL,
  "currency" varchar(10)  NOT NULL,
  "endpoint" text  NOT NULL,
  "is_active" boolean  DEFAULT true  NOT NULL,
  "supported_schemes" jsonb,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "mojaloop_fsps_fsp_id_unique" UNIQUE ("fsp_id")
);

CREATE TABLE "mojaloop_transfers" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "transfer_id" varchar(100),
  "quote_id" varchar(100),
  "transaction_id" varchar(100),
  "payer_fsp" varchar(100),
  "payee_fsp" varchar(100),
  "payer_identifier" varchar(200),
  "payee_identifier" varchar(200),
  "amount" numeric(18, 2)  NOT NULL,
  "currency" varchar(10)  NOT NULL,
  "ilp_packet" text,
  "condition" varchar(200),
  "fulfilment" varchar(200),
  "status" varchar(30)  DEFAULT 'PENDING',
  "error_code" varchar(10),
  "error_description" varchar(500),
  "expiration_date" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp  DEFAULT now()
);

CREATE TABLE "mortgage_applications" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "applicant_id" integer  NOT NULL,
  "mortgage_type" "mortgage_type"  DEFAULT 'purchase',
  "property_country" varchar(4)  NOT NULL,
  "property_address" text,
  "property_value_usd" numeric(18, 2)  NOT NULL,
  "loan_amount_usd" numeric(18, 2)  NOT NULL,
  "deposit_amount_usd" numeric(18, 2)  NOT NULL,
  "ltv_pct" numeric(5, 2),
  "term_years" integer  NOT NULL,
  "interest_rate_pct" numeric(5, 2),
  "monthly_payment_usd" numeric(18, 2),
  "applicant_country" varchar(4),
  "annual_income_usd" numeric(18, 2),
  "employment_status" varchar(50),
  "credit_score" integer,
  "status" "mortgage_status"  DEFAULT 'enquiry',
  "assigned_advisor_id" integer,
  "offer_expires_at" timestamp,
  "completed_at" timestamp,
  "rejection_reason" text,
  "notes" text,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "mortgage_repayments" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "application_id" integer  NOT NULL,
  "due_date" timestamp  NOT NULL,
  "paid_date" timestamp,
  "principal_usd" numeric(18, 2)  NOT NULL,
  "interest_usd" numeric(18, 2)  NOT NULL,
  "total_usd" numeric(18, 2)  NOT NULL,
  "balance_after_usd" numeric(18, 2),
  "status" varchar(20)  DEFAULT 'pending',
  "payment_ref" varchar(100),
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "ngx_orders" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "stock_id" integer  NOT NULL,
  "order_type" varchar(20)  NOT NULL,
  "status" varchar(30)  DEFAULT 'pending'  NOT NULL,
  "quantity_units" numeric(18, 6)  NOT NULL,
  "price_per_unit_ngn" numeric(18, 4)  NOT NULL,
  "total_amount_ngn" numeric(24, 2)  NOT NULL,
  "total_amount_usd" numeric(18, 2),
  "fx_rate_used" numeric(18, 6),
  "broker_reference" varchar(100),
  "broker_name" varchar(100)  DEFAULT 'Bamboo'  NOT NULL,
  "executed_at" timestamp,
  "notes" text,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "ngx_stocks" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "ticker" varchar(20)  NOT NULL,
  "name" varchar(200)  NOT NULL,
  "sector" varchar(100)  NOT NULL,
  "exchange" varchar(20)  DEFAULT 'NGX'  NOT NULL,
  "current_price_ngn" numeric(18, 4)  NOT NULL,
  "previous_close_ngn" numeric(18, 4),
  "change_percent" numeric(8, 4),
  "market_cap_ngn" numeric(24, 2),
  "pe_ratio" numeric(10, 2),
  "dividend_yield" numeric(8, 4),
  "week_52_high" numeric(18, 4),
  "week_52_low" numeric(18, 4),
  "description" text,
  "logo_url" text,
  "is_active" boolean  DEFAULT true  NOT NULL,
  "last_updated" timestamp  DEFAULT now()  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "ngx_stocks_ticker_unique" UNIQUE ("ticker")
);

CREATE TABLE "nifi_pipeline_runs" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "pipeline_id" varchar(100)  NOT NULL,
  "pipeline_name" varchar(255),
  "status" "pipeline_run_status"  DEFAULT 'pending'  NOT NULL,
  "triggered_by" integer,
  "started_at" timestamp  DEFAULT now()  NOT NULL,
  "completed_at" timestamp,
  "duration_ms" integer,
  "records_processed" integer  DEFAULT 0,
  "error_message" text,
  "metadata" json
);

CREATE TABLE "notificationPreferences" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "userId" integer  NOT NULL,
  "category" varchar(50)  NOT NULL,
  "emailEnabled" boolean  DEFAULT true,
  "inAppEnabled" boolean  DEFAULT true,
  "pushEnabled" boolean  DEFAULT false,
  "createdAt" timestamp  DEFAULT now(),
  "updatedAt" timestamp  DEFAULT now()
);

CREATE TABLE "notifications" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "userId" integer  NOT NULL,
  "title" varchar(256)  NOT NULL,
  "message" text  NOT NULL,
  "type" "notif_type"  DEFAULT 'system',
  "isRead" boolean  DEFAULT false,
  "actionUrl" varchar(256),
  "metadata" json,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "open_banking_consents" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "consent_id" text  NOT NULL,
  "user_id" integer  NOT NULL,
  "bank_id" text  NOT NULL,
  "bank_name" text  NOT NULL,
  "status" "open_banking_consent_status"  DEFAULT 'awaiting_authorisation'  NOT NULL,
  "permissions" text[],
  "expires_at" timestamp,
  "authorised_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "open_banking_consents_consent_id_unique" UNIQUE ("consent_id")
);

CREATE TABLE "outbound_annual_usage" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "purpose_code" varchar(20)  NOT NULL,
  "calendar_year" integer  NOT NULL,
  "used_usd" numeric(18, 2)  DEFAULT '0.00'  NOT NULL,
  "last_transaction_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "outbound_transfers" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "transfer_type" varchar(20)  DEFAULT 'outbound',
  "rail" varchar(20),
  "corridor_code" varchar(5),
  "amount_ngn" numeric(18, 2),
  "amount_foreign" numeric(18, 2),
  "foreign_currency" varchar(3),
  "fx_rate" numeric(18, 8),
  "fees_ngn" numeric(18, 2),
  "recipient_name" varchar(100),
  "recipient_account" varchar(34),
  "recipient_swift" varchar(11),
  "purpose_code" varchar(10),
  "status" varchar(30)  DEFAULT 'pending',
  "external_ref" varchar(100),
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "completed_at" timestamp
);

CREATE TABLE "outbox_events" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "aggregate_id" varchar(100)  NOT NULL,
  "aggregate_type" varchar(100)  NOT NULL,
  "event_type" varchar(100)  NOT NULL,
  "payload" text  NOT NULL,
  "status" varchar(20)  DEFAULT 'pending',
  "retry_count" integer  DEFAULT 0,
  "max_retries" integer  DEFAULT 3,
  "published_at" timestamp,
  "failed_at" timestamp,
  "error_message" text,
  "created_at" timestamp  DEFAULT now()
);

CREATE TABLE "papss_transfers" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "transfer_id" varchar(100)  NOT NULL,
  "papss_ref" varchar(100),
  "sender_country" varchar(3)  NOT NULL,
  "receiver_country" varchar(3)  NOT NULL,
  "send_amount" numeric(18, 6)  NOT NULL,
  "send_currency" varchar(10)  NOT NULL,
  "receive_currency" varchar(10)  NOT NULL,
  "receive_amount" numeric(18, 6),
  "exchange_rate" numeric(18, 8),
  "sender_account" varchar(200)  NOT NULL,
  "receiver_account" varchar(200)  NOT NULL,
  "sender_bank_code" varchar(20),
  "receiver_bank_code" varchar(20),
  "sender_name" varchar(200),
  "receiver_name" varchar(200),
  "narration" varchar(500),
  "corridor" varchar(10),
  "status" varchar(30)  DEFAULT 'pending'  NOT NULL,
  "mojaloop_routed" boolean  DEFAULT false,
  "ghipss_routed" boolean  DEFAULT false,
  "netting_batch_id" varchar(100),
  "settled_at" timestamp,
  "error_message" text,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "papss_transfers_transfer_id_unique" UNIQUE ("transfer_id")
);

CREATE TABLE "partner_api_keys" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "tenant_id" integer  NOT NULL,
  "name" varchar(100)  NOT NULL,
  "key_prefix" varchar(12)  NOT NULL,
  "key_hash" varchar(64)  NOT NULL,
  "environment" "partner_api_key_env"  DEFAULT 'sandbox'  NOT NULL,
  "status" "partner_api_key_status"  DEFAULT 'active'  NOT NULL,
  "permissions" json  DEFAULT '[]'::json,
  "last_used_at" timestamp,
  "expires_at" timestamp,
  "created_by" integer  NOT NULL,
  "revoked_by" integer,
  "revoked_at" timestamp,
  "request_count" integer  DEFAULT 0,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "partner_application_comments" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "application_id" integer  NOT NULL,
  "author_id" integer  NOT NULL,
  "comment" text  NOT NULL,
  "is_internal" boolean  DEFAULT true  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "partner_applications" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "company_name" varchar(255)  NOT NULL,
  "brand_name" varchar(255)  NOT NULL,
  "slug" varchar(63)  NOT NULL,
  "application_type" "partner_application_type"  DEFAULT 'fintech_startup'  NOT NULL,
  "contact_name" varchar(255)  NOT NULL,
  "contact_email" varchar(255)  NOT NULL,
  "contact_phone" varchar(30),
  "website" text,
  "country" varchar(3)  NOT NULL,
  "registration_number" varchar(100),
  "tax_id" varchar(100),
  "incorporation_date" varchar(20),
  "business_description" text,
  "expected_monthly_volume" numeric(18, 2),
  "expected_user_count" integer,
  "target_corridors" json  DEFAULT '[]'::json,
  "requested_plan" varchar(30)  DEFAULT 'starter'  NOT NULL,
  "has_aml_policy" boolean  DEFAULT false,
  "has_kyc_process" boolean  DEFAULT false,
  "is_regulated" boolean  DEFAULT false,
  "regulatory_licenses" json  DEFAULT '[]'::json,
  "business_reg_doc_url" text,
  "aml_policy_doc_url" text,
  "director_id_doc_url" text,
  "bank_statement_doc_url" text,
  "primary_color" varchar(7)  DEFAULT '#7c3aed',
  "secondary_color" varchar(7)  DEFAULT '#06b6d4',
  "logo_url" text,
  "status" "partner_application_status"  DEFAULT 'draft'  NOT NULL,
  "submitted_at" timestamp,
  "reviewed_by" integer,
  "reviewed_at" timestamp,
  "review_notes" text,
  "rejection_reason" text,
  "additional_info_request" text,
  "additional_info_provided_at" timestamp,
  "approved_at" timestamp,
  "tenant_id" integer,
  "sla_signed_at" timestamp,
  "sla_version" varchar(20)  DEFAULT 'v1.0',
  "invite_code_id" integer,
  "submitted_by_user_id" integer,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "partner_applications_slug_unique" UNIQUE ("slug")
);

CREATE TABLE "partner_digital_agreements" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "agreement_id" integer  NOT NULL,
  "template_id" integer,
  "tenant_id" integer  NOT NULL,
  "status" "agreement_status"  DEFAULT 'draft'  NOT NULL,
  "agreement_text" text  NOT NULL,
  "sent_at" timestamp,
  "viewed_at" timestamp,
  "digitally_signed_at" timestamp,
  "physically_signed_at" timestamp,
  "fully_executed_at" timestamp,
  "expires_at" timestamp,
  "partner_name" varchar(255)  NOT NULL,
  "partner_email" varchar(255)  NOT NULL,
  "partner_title" varchar(100),
  "partner_company" varchar(255),
  "partner_ip_address" varchar(45),
  "partner_user_agent" text,
  "platform_signed_by" integer,
  "platform_signed_at" timestamp,
  "signed_document_url" text,
  "signed_document_key" text,
  "physical_document_url" text,
  "physical_document_key" text,
  "audit_trail" jsonb  DEFAULT '[]'::jsonb,
  "metadata" jsonb  DEFAULT '{}'::jsonb,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "partner_invite_codes" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "code" varchar(32)  NOT NULL,
  "description" text,
  "created_by" integer  NOT NULL,
  "max_uses" integer  DEFAULT 1,
  "used_count" integer  DEFAULT 0  NOT NULL,
  "plan" varchar(20)  DEFAULT 'starter'  NOT NULL,
  "expires_at" timestamp,
  "is_active" boolean  DEFAULT true  NOT NULL,
  "metadata" json  DEFAULT '{}'::json,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "partner_invite_codes_code_unique" UNIQUE ("code")
);

CREATE TABLE "partner_payouts" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "tenant_id" integer  NOT NULL,
  "amount" numeric(18, 6)  NOT NULL,
  "currency" varchar(10)  DEFAULT 'USD'  NOT NULL,
  "method" "payout_method"  DEFAULT 'bank_transfer'  NOT NULL,
  "status" "payout_status"  DEFAULT 'pending'  NOT NULL,
  "reference" varchar(64),
  "period_start" timestamp  NOT NULL,
  "period_end" timestamp  NOT NULL,
  "fee_revenue" numeric(18, 6)  DEFAULT '0'  NOT NULL,
  "revenue_share" numeric(5, 4)  DEFAULT '0.3'  NOT NULL,
  "notes" text,
  "processed_at" timestamp,
  "processed_by" integer,
  "metadata" json  DEFAULT '{}'::json,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "partner_payouts_reference_unique" UNIQUE ("reference")
);

CREATE TABLE "partner_webhooks" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "tenant_id" integer  NOT NULL,
  "url" text  NOT NULL,
  "events" json  DEFAULT '[]'::json,
  "signing_secret" varchar(128)  NOT NULL,
  "is_active" boolean  DEFAULT true  NOT NULL,
  "last_delivered_at" timestamp,
  "failure_count" integer  DEFAULT 0,
  "created_by" integer  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "payment_gateway_logs" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer,
  "gateway" "gateway"  NOT NULL,
  "gateway_tx_id" varchar(128),
  "amount" numeric(18, 6)  NOT NULL,
  "currency" varchar(10)  NOT NULL,
  "status" "gateway_tx_status"  DEFAULT 'initiated'  NOT NULL,
  "direction" varchar(10)  DEFAULT 'credit'  NOT NULL,
  "metadata" json  DEFAULT '{}'::json,
  "error_message" text,
  "ip_address" varchar(45),
  "user_agent" text,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "payment_metrics" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "corridor" varchar(20)  NOT NULL,
  "success_count" integer  DEFAULT 0,
  "failure_count" integer  DEFAULT 0,
  "avg_processing_ms" integer  DEFAULT 0,
  "total_volume" numeric(18, 2)  DEFAULT '0.00',
  "period" varchar(20)  NOT NULL,
  "created_at" timestamp  DEFAULT now()
);

CREATE TABLE "payment_requests" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "requester_id" integer  NOT NULL,
  "amount" numeric(18, 2),
  "currency" varchar(8)  DEFAULT 'USD'  NOT NULL,
  "description" text,
  "token" varchar(64)  NOT NULL,
  "status" varchar(20)  DEFAULT 'pending'  NOT NULL,
  "payer_user_id" integer,
  "payer_email" varchar(255),
  "transaction_id" integer,
  "expires_at" timestamp,
  "paid_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "payment_requests_token_unique" UNIQUE ("token")
);

CREATE TABLE "paypal_transactions" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "paypal_order_id" varchar(100)  NOT NULL,
  "paypal_capture_id" varchar(100),
  "amount_usd" numeric(18, 2)  NOT NULL,
  "currency" varchar(10)  DEFAULT 'USD'  NOT NULL,
  "status" varchar(30)  DEFAULT 'created'  NOT NULL,
  "wallet_credited" boolean  DEFAULT false  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "paypal_transactions_paypal_order_id_unique" UNIQUE ("paypal_order_id")
);

CREATE TABLE "payroll_companies" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "owner_id" integer  NOT NULL,
  "name" varchar(200)  NOT NULL,
  "registration_number" varchar(100),
  "tax_id" varchar(100),
  "country" varchar(4)  NOT NULL,
  "base_currency" varchar(8)  DEFAULT 'USD',
  "status" "payroll_company_status"  DEFAULT 'active',
  "logo_url" text,
  "total_employees" integer  DEFAULT 0,
  "monthly_payroll_usd" numeric(18, 2)  DEFAULT '0',
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "payroll_disbursements" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "run_id" integer  NOT NULL,
  "batch_reference" varchar(80)  NOT NULL,
  "rail" varchar(30)  NOT NULL,
  "currency" varchar(8)  NOT NULL,
  "total_amount" numeric(18, 2)  NOT NULL,
  "item_count" integer  DEFAULT 0,
  "status" varchar(20)  DEFAULT 'pending',
  "external_ref" varchar(200),
  "sent_at" timestamp,
  "settled_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "payroll_employees" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "company_id" integer  NOT NULL,
  "user_id" integer,
  "employee_code" varchar(50)  NOT NULL,
  "first_name" varchar(100)  NOT NULL,
  "last_name" varchar(100)  NOT NULL,
  "email" varchar(200)  NOT NULL,
  "phone" varchar(30),
  "job_title" varchar(150),
  "department" varchar(100),
  "employment_type" "employment_type"  DEFAULT 'full_time',
  "jurisdiction" "payroll_jurisdiction"  NOT NULL,
  "country" varchar(4)  NOT NULL,
  "gross_salary" numeric(18, 2)  NOT NULL,
  "salary_currency" varchar(8)  DEFAULT 'USD',
  "bank_name" varchar(150),
  "bank_account" varchar(100),
  "bank_routing_code" varchar(50),
  "mobile_money_num" varchar(30),
  "preferred_channel" varchar(20)  DEFAULT 'bank',
  "tax_code" varchar(50),
  "national_id" varchar(100),
  "start_date" timestamp,
  "end_date" timestamp,
  "is_active" boolean  DEFAULT true,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "payroll_run_items" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "run_id" integer  NOT NULL,
  "employee_id" integer  NOT NULL,
  "gross_salary" numeric(18, 2)  NOT NULL,
  "gross_currency" varchar(8)  NOT NULL,
  "gross_usd" numeric(18, 2)  NOT NULL,
  "fx_rate" numeric(18, 8)  DEFAULT '1',
  "income_tax" numeric(18, 2)  DEFAULT '0',
  "social_security" numeric(18, 2)  DEFAULT '0',
  "pension" numeric(18, 2)  DEFAULT '0',
  "nhf" numeric(18, 2)  DEFAULT '0',
  "nhis" numeric(18, 2)  DEFAULT '0',
  "other_deductions" numeric(18, 2)  DEFAULT '0',
  "total_deductions" numeric(18, 2)  DEFAULT '0',
  "net_pay" numeric(18, 2)  NOT NULL,
  "net_currency" varchar(8)  NOT NULL,
  "net_usd" numeric(18, 2)  NOT NULL,
  "remit_fee" numeric(18, 2)  DEFAULT '0',
  "status" "payroll_item_status"  DEFAULT 'pending',
  "transaction_id" integer,
  "disbursed_at" timestamp,
  "failure_reason" text,
  "tax_breakdown" json,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "payroll_runs" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "company_id" integer  NOT NULL,
  "run_reference" varchar(80)  NOT NULL,
  "period_start" timestamp  NOT NULL,
  "period_end" timestamp  NOT NULL,
  "pay_date" timestamp  NOT NULL,
  "frequency" "payroll_frequency"  NOT NULL,
  "status" "payroll_run_status"  DEFAULT 'draft',
  "total_gross_usd" numeric(18, 2)  DEFAULT '0',
  "total_tax_usd" numeric(18, 2)  DEFAULT '0',
  "total_deduct_usd" numeric(18, 2)  DEFAULT '0',
  "total_net_usd" numeric(18, 2)  DEFAULT '0',
  "total_fee_usd" numeric(18, 2)  DEFAULT '0',
  "employee_count" integer  DEFAULT 0,
  "approved_by_user_id" integer,
  "approved_at" timestamp,
  "disbursed_at" timestamp,
  "notes" text,
  "engine_response" json,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "payroll_runs_run_reference_unique" UNIQUE ("run_reference")
);

CREATE TABLE "payroll_tax_configs" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "jurisdiction" "payroll_jurisdiction"  NOT NULL,
  "tax_year" integer  NOT NULL,
  "brackets" json  NOT NULL,
  "social_security_rate" numeric(6, 4)  DEFAULT '0',
  "medicare_rate" numeric(6, 4)  DEFAULT '0',
  "pension_employee_rate" numeric(6, 4)  DEFAULT '0',
  "pension_employer_rate" numeric(6, 4)  DEFAULT '0',
  "nhf_rate" numeric(6, 4)  DEFAULT '0',
  "nhis_rate" numeric(6, 4)  DEFAULT '0',
  "effective_from" timestamp  NOT NULL,
  "effective_to" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "payroll_tax_filings" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "company_id" integer  NOT NULL,
  "payroll_run_id" integer,
  "tax_authority" "tax_authority"  NOT NULL,
  "jurisdiction" varchar(4)  NOT NULL,
  "period_start" timestamp  NOT NULL,
  "period_end" timestamp  NOT NULL,
  "total_gross_usd" numeric(18, 2)  NOT NULL,
  "total_tax_usd" numeric(18, 2)  NOT NULL,
  "total_pension_usd" numeric(18, 2)  DEFAULT '0',
  "employee_count" integer  NOT NULL,
  "filing_reference" varchar(100),
  "submitted_at" timestamp,
  "acknowledged_at" timestamp,
  "status" "tax_filing_status"  DEFAULT 'draft',
  "filing_doc_url" text,
  "receipt_url" text,
  "rejection_reason" text,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "pos_terminals" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "terminal_id" varchar(50)  NOT NULL,
  "merchant_name" varchar(200)  NOT NULL,
  "merchant_category" varchar(100),
  "location" varchar(300),
  "status" varchar(20)  DEFAULT 'active',
  "serial_number" varchar(100),
  "model" varchar(100),
  "last_seen" timestamp,
  "daily_limit" numeric(18, 2)  DEFAULT '500000.00',
  "total_transactions" integer  DEFAULT 0,
  "total_volume" numeric(18, 2)  DEFAULT '0.00',
  "created_at" timestamp  DEFAULT now(),
  "updated_at" timestamp  DEFAULT now()
);

CREATE TABLE "promo_codes" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "code" varchar(50)  NOT NULL,
  "description" text,
  "discount_type" varchar(20)  DEFAULT 'percentage'  NOT NULL,
  "discount_value" numeric(10, 4)  NOT NULL,
  "min_transfer_amount" numeric(18, 2)  DEFAULT '0',
  "max_discount_amount" numeric(18, 2),
  "usage_limit" integer,
  "usage_count" integer  DEFAULT 0  NOT NULL,
  "per_user_limit" integer  DEFAULT 1,
  "valid_from" timestamp  DEFAULT now()  NOT NULL,
  "valid_until" timestamp,
  "corridors" text,
  "is_active" boolean  DEFAULT true  NOT NULL,
  "created_by" integer,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "promo_codes_code_unique" UNIQUE ("code")
);

CREATE TABLE "promo_redemptions" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "promo_code_id" integer  NOT NULL,
  "user_id" integer  NOT NULL,
  "transaction_id" integer,
  "discount_applied" numeric(18, 2)  NOT NULL,
  "currency" varchar(10)  DEFAULT 'USD'  NOT NULL,
  "redeemed_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "push_notification_preferences" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "preference_key" varchar(100)  NOT NULL,
  "is_enabled" boolean  DEFAULT true  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "push_subscriptions" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "endpoint" text  NOT NULL,
  "p256dh" text  NOT NULL,
  "auth" text  NOT NULL,
  "device_name" varchar(100)  DEFAULT 'Browser',
  "is_active" boolean  DEFAULT true  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "last_used_at" timestamp,
  CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE ("endpoint")
);

CREATE TABLE "rail_health_status" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "rail" "payment_rail"  NOT NULL,
  "status" varchar(20)  DEFAULT 'unknown'  NOT NULL,
  "latency_ms" integer,
  "last_checked_at" timestamp  DEFAULT now()  NOT NULL,
  "error_message" text,
  "metadata" jsonb  DEFAULT '{}'::jsonb
);

CREATE TABLE "rate_alert_history" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "from_currency" varchar(10)  NOT NULL,
  "to_currency" varchar(10)  NOT NULL,
  "target_rate" numeric(18, 6)  NOT NULL,
  "actual_rate" numeric(18, 6)  NOT NULL,
  "direction" varchar(10)  DEFAULT 'above',
  "status" "rate_alert_history_status"  DEFAULT 'triggered'  NOT NULL,
  "notification_sent" boolean  DEFAULT false,
  "snoozed_until" timestamp,
  "triggered_at" timestamp  DEFAULT now()  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "rate_locks" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "from_currency" varchar(10)  NOT NULL,
  "to_currency" varchar(10)  NOT NULL,
  "locked_rate" numeric(18, 8)  NOT NULL,
  "amount" numeric(18, 2)  NOT NULL,
  "expires_at" timestamp  NOT NULL,
  "status" "rate_lock_status"  DEFAULT 'active',
  "created_at" timestamp  DEFAULT now()
);

CREATE TABLE "real_estate_investments" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "listing_id" integer  NOT NULL,
  "shares_owned" integer  NOT NULL,
  "price_per_share_paid" numeric(18, 2)  NOT NULL,
  "total_invested_usd" numeric(18, 2)  NOT NULL,
  "ownership_pct" numeric(8, 6)  NOT NULL,
  "status" varchar(30)  DEFAULT 'active'  NOT NULL,
  "returns_paid_usd" numeric(18, 2)  DEFAULT '0',
  "last_return_date" timestamp,
  "invested_at" timestamp  DEFAULT now()  NOT NULL,
  "exited_at" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "real_estate_listings" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "title" varchar(300)  NOT NULL,
  "description" text  NOT NULL,
  "property_type" varchar(50)  NOT NULL,
  "location" varchar(200)  NOT NULL,
  "city" varchar(100)  NOT NULL,
  "state" varchar(100)  NOT NULL,
  "total_value_ngn" numeric(24, 2)  NOT NULL,
  "total_value_usd" numeric(18, 2)  NOT NULL,
  "minimum_investment_usd" numeric(18, 2)  NOT NULL,
  "total_shares" integer  NOT NULL,
  "available_shares" integer  NOT NULL,
  "price_per_share_usd" numeric(18, 2)  NOT NULL,
  "expected_annual_return_pct" numeric(8, 2),
  "rental_yield_pct" numeric(8, 2),
  "appreciation_pct" numeric(8, 2),
  "tenure_years" integer,
  "status" varchar(30)  DEFAULT 'open'  NOT NULL,
  "image_urls" json  DEFAULT '[]'::json,
  "documents" json  DEFAULT '[]'::json,
  "developer_name" varchar(200),
  "developer_rating" numeric(3, 1),
  "completion_date" timestamp,
  "is_verified" boolean  DEFAULT false  NOT NULL,
  "is_featured" boolean  DEFAULT false  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "recurringPayments" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "userId" integer  NOT NULL,
  "name" varchar(128)  NOT NULL,
  "recipientName" varchar(128),
  "recipientAccount" varchar(64),
  "recipientBank" varchar(128),
  "amount" numeric(18, 2)  NOT NULL,
  "currency" varchar(8)  DEFAULT 'NGN',
  "targetCurrency" varchar(8)  DEFAULT 'USD',
  "description" varchar(256),
  "frequency" "recurring_freq"  NOT NULL,
  "timezone" varchar(64)  DEFAULT 'UTC',
  "startDate" timestamp,
  "endDate" timestamp,
  "nextRunAt" timestamp,
  "lastRunAt" timestamp,
  "status" "recurring_status"  DEFAULT 'active',
  "lastRunStatus" varchar(16),
  "failureCount" integer  DEFAULT 0,
  "executionCount" integer  DEFAULT 0,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "referral_bonuses" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "referrer_id" integer  NOT NULL,
  "referred_id" integer  NOT NULL,
  "referral_code" varchar(32)  NOT NULL,
  "referrer_bonus" numeric(18, 2)  DEFAULT '0',
  "referred_bonus" numeric(18, 2)  DEFAULT '0',
  "currency" varchar(10)  DEFAULT 'USD',
  "status" "referral_bonus_status"  DEFAULT 'pending'  NOT NULL,
  "trigger_event" varchar(100)  DEFAULT 'first_transfer',
  "paid_at" timestamp,
  "expires_at" timestamp,
  "notes" text,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "referrals" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "referrerId" integer  NOT NULL,
  "referredId" integer  NOT NULL,
  "status" "referral_status"  DEFAULT 'pending',
  "rewardAmount" numeric(18, 2)  DEFAULT '500.00',
  "rewardCurrency" varchar(8)  DEFAULT 'NGN',
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "regulatory_reports" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "report_id" text  NOT NULL,
  "report_type" "regulatory_report_type"  NOT NULL,
  "status" "regulatory_report_status"  DEFAULT 'pending'  NOT NULL,
  "format" text  DEFAULT 'pdf'  NOT NULL,
  "period_start" text  NOT NULL,
  "period_end" text  NOT NULL,
  "generated_by" integer,
  "download_url" text,
  "filed_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "regulatory_reports_report_id_unique" UNIQUE ("report_id")
);

CREATE TABLE "revenue_share_agreements" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "tenant_id" integer  NOT NULL,
  "name" varchar(255)  NOT NULL,
  "model" "rev_share_model"  DEFAULT 'percentage'  NOT NULL,
  "status" "rev_share_status"  DEFAULT 'draft'  NOT NULL,
  "base_rate" numeric(7, 6)  DEFAULT '0.300000'  NOT NULL,
  "flat_fee_amount" numeric(18, 6)  DEFAULT '0',
  "flat_fee_currency" varchar(10)  DEFAULT 'USD',
  "min_payout_threshold" numeric(18, 2)  DEFAULT '50.00',
  "payout_currency" varchar(10)  DEFAULT 'USD',
  "payout_method" "payout_method"  DEFAULT 'bank_transfer',
  "payout_frequency" varchar(20)  DEFAULT 'monthly',
  "effective_from" timestamp  DEFAULT now()  NOT NULL,
  "effective_to" timestamp,
  "bank_name" varchar(255),
  "bank_account_number" varchar(64),
  "bank_routing_number" varchar(64),
  "bank_swift_code" varchar(20),
  "bank_iban" varchar(64),
  "paypal_email" varchar(255),
  "notes" text,
  "approved_by" integer,
  "approved_at" timestamp,
  "created_by" integer,
  "metadata" jsonb  DEFAULT '{}'::jsonb,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "revenue_share_ledger" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "agreement_id" integer  NOT NULL,
  "tenant_id" integer  NOT NULL,
  "type" "rev_share_ledger_type"  NOT NULL,
  "transaction_id" integer,
  "gross_fee_revenue" numeric(18, 6)  NOT NULL,
  "applied_rate" numeric(7, 6)  NOT NULL,
  "partner_share" numeric(18, 6)  NOT NULL,
  "platform_share" numeric(18, 6)  NOT NULL,
  "currency" varchar(10)  DEFAULT 'USD'  NOT NULL,
  "period_month" integer  NOT NULL,
  "period_year" integer  NOT NULL,
  "payout_id" integer,
  "description" text,
  "metadata" jsonb  DEFAULT '{}'::jsonb,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "revenue_share_reports" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "tenant_id" integer  NOT NULL,
  "agreement_id" integer  NOT NULL,
  "period_month" integer  NOT NULL,
  "period_year" integer  NOT NULL,
  "total_transactions" integer  DEFAULT 0  NOT NULL,
  "total_volume" numeric(18, 2)  DEFAULT '0'  NOT NULL,
  "total_fee_revenue" numeric(18, 6)  DEFAULT '0'  NOT NULL,
  "partner_earnings" numeric(18, 6)  DEFAULT '0'  NOT NULL,
  "platform_earnings" numeric(18, 6)  DEFAULT '0'  NOT NULL,
  "applied_tier_id" integer,
  "applied_rate" numeric(7, 6)  NOT NULL,
  "payout_id" integer,
  "status" varchar(20)  DEFAULT 'pending'  NOT NULL,
  "generated_at" timestamp  DEFAULT now()  NOT NULL,
  "paid_at" timestamp
);

CREATE TABLE "revenue_share_tiers" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "agreement_id" integer  NOT NULL,
  "tier_name" varchar(100)  NOT NULL,
  "min_monthly_volume" numeric(18, 2)  NOT NULL,
  "max_monthly_volume" numeric(18, 2),
  "rate" numeric(7, 6)  NOT NULL,
  "bonus_rate" numeric(7, 6)  DEFAULT '0',
  "sort_order" integer  DEFAULT 0  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "sanctions_checks" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "screening_id" text  NOT NULL,
  "user_id" integer,
  "entity_name" text  NOT NULL,
  "entity_type" text  DEFAULT 'individual'  NOT NULL,
  "result" "sanctions_check_result"  DEFAULT 'clear'  NOT NULL,
  "risk_level" text  DEFAULT 'low'  NOT NULL,
  "lists_checked" text[],
  "match_details" text,
  "reviewed_by" integer,
  "reviewed_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "sanctions_checks_screening_id_unique" UNIQUE ("screening_id")
);

CREATE TABLE "sandbox_scenarios" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "name" varchar(100)  NOT NULL,
  "description" text,
  "scenario_type" varchar(50)  DEFAULT 'transfer'  NOT NULL,
  "payload" text  NOT NULL,
  "tags" text,
  "is_public" boolean  DEFAULT false  NOT NULL,
  "run_count" integer  DEFAULT 0  NOT NULL,
  "last_run_at" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "savingsGoals" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "userId" integer  NOT NULL,
  "name" varchar(128)  NOT NULL,
  "emoji" varchar(8)  DEFAULT '🎯',
  "targetAmount" numeric(18, 2)  NOT NULL,
  "currentAmount" numeric(18, 2)  DEFAULT '0.00',
  "currency" varchar(8)  DEFAULT 'NGN',
  "targetDate" timestamp,
  "autoSave" boolean  DEFAULT false,
  "autoSaveAmount" numeric(18, 2),
  "purpose" varchar(32)  DEFAULT 'other',
  "status" "savings_status"  DEFAULT 'active',
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "scheduled_transfers" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "beneficiary_id" integer,
  "from_currency" varchar(10)  NOT NULL,
  "to_currency" varchar(10)  NOT NULL,
  "amount" numeric(18, 2)  NOT NULL,
  "frequency" varchar(20)  NOT NULL,
  "next_run_at" timestamp  NOT NULL,
  "last_run_at" timestamp,
  "run_count" integer  DEFAULT 0  NOT NULL,
  "max_runs" integer,
  "status" varchar(20)  DEFAULT 'active'  NOT NULL,
  "description" text,
  "promo_code" varchar(50),
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "scheduledTransferRuns" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "scheduleId" integer  NOT NULL,
  "userId" integer  NOT NULL,
  "status" "scheduled_run_status"  NOT NULL,
  "amount" numeric(18, 2)  NOT NULL,
  "currency" varchar(8)  NOT NULL,
  "targetCurrency" varchar(8),
  "fxRate" numeric(18, 6),
  "transactionId" integer,
  "errorMessage" varchar(512),
  "executedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "security_events" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer,
  "event_type" varchar(80)  NOT NULL,
  "severity" varchar(20)  DEFAULT 'info'  NOT NULL,
  "ip_address" varchar(50),
  "user_agent" text,
  "location" varchar(100),
  "details" text,
  "resolved" boolean  DEFAULT false  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "security_incidents" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "type" varchar(50)  NOT NULL,
  "severity" varchar(20)  NOT NULL,
  "source_ip" varchar(45),
  "user_id" integer,
  "endpoint" varchar(255),
  "payload" text,
  "blocked" boolean  DEFAULT true  NOT NULL,
  "response_code" integer,
  "details" text,
  "resolved_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "sepa_payment_methods" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "iban" varchar(50)  NOT NULL,
  "bic" varchar(20),
  "account_name" varchar(200)  NOT NULL,
  "bank_name" varchar(200),
  "country" "eu_corridor"  NOT NULL,
  "is_verified" boolean  DEFAULT false,
  "is_default" boolean  DEFAULT false,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "settlement_accounts" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "corridor" varchar(20)  NOT NULL,
  "adb_name" varchar(200)  NOT NULL,
  "adb_code" varchar(20),
  "account_number" varchar(50)  NOT NULL,
  "account_name" varchar(200)  NOT NULL,
  "currency" varchar(10)  DEFAULT 'NGN'  NOT NULL,
  "status" "settlement_account_status"  DEFAULT 'pending_cbn_filing'  NOT NULL,
  "is_primary" boolean  DEFAULT false  NOT NULL,
  "cbn_filed_at" timestamp,
  "cbn_reference_number" varchar(100),
  "notes" text,
  "created_by" integer,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "sla_incidents" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "title" varchar(200)  NOT NULL,
  "severity" varchar(20)  DEFAULT 'medium'  NOT NULL,
  "status" varchar(20)  DEFAULT 'open'  NOT NULL,
  "affected_service" varchar(100),
  "root_cause" text,
  "resolution" text,
  "reported_by" integer,
  "started_at" timestamp  DEFAULT now()  NOT NULL,
  "resolved_at" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "smart_routing_decisions" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "transfer_id" integer,
  "user_id" integer  NOT NULL,
  "from_currency" varchar(10)  NOT NULL,
  "to_currency" varchar(10)  NOT NULL,
  "amount" numeric(18, 2)  NOT NULL,
  "selected_provider" varchar(100)  NOT NULL,
  "estimated_fee" numeric(18, 2),
  "estimated_time_seconds" integer,
  "score" numeric(5, 2),
  "decision_factors" text,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "sme_trade_batches" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "batch_id" varchar(100)  NOT NULL,
  "user_id" integer  NOT NULL,
  "corridor_code" varchar(5)  NOT NULL,
  "total_payments" integer  DEFAULT 0,
  "total_amount_usd" numeric(18, 2),
  "form_m_number" varchar(30),
  "batch_reference" varchar(100),
  "status" varchar(30)  DEFAULT 'processing',
  "succeeded" integer  DEFAULT 0,
  "failed" integer  DEFAULT 0,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "completed_at" timestamp,
  CONSTRAINT "sme_trade_batches_batch_id_unique" UNIQUE ("batch_id")
);

CREATE TABLE "sme_trade_bulk_batches" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "batch_reference" varchar(100)  NOT NULL,
  "total_payments" integer  NOT NULL,
  "total_amount_ngn" numeric(18, 2)  NOT NULL,
  "csv_file_url" varchar(500),
  "status" varchar(30)  DEFAULT 'pending'  NOT NULL,
  "validation_errors" jsonb,
  "rust_processor_job_id" varchar(200),
  "temporal_workflow_id" varchar(200),
  "kafka_batch_id" varchar(200),
  "tiger_beetle_batch_id" varchar(200),
  "lakehouse_batch_path" varchar(500),
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "completed_at" timestamp,
  CONSTRAINT "sme_trade_bulk_batches_batch_reference_unique" UNIQUE ("batch_reference")
);

CREATE TABLE "sme_trade_payments" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "batch_id" integer,
  "user_id" integer  NOT NULL,
  "corridor" "trade_corridor"  NOT NULL,
  "purpose" "trade_purpose"  NOT NULL,
  "amount_ngn" numeric(18, 2)  NOT NULL,
  "amount_foreign" numeric(18, 2)  NOT NULL,
  "foreign_currency" varchar(10)  NOT NULL,
  "fx_rate" numeric(18, 8)  NOT NULL,
  "beneficiary_name" varchar(200)  NOT NULL,
  "beneficiary_bank" varchar(200),
  "beneficiary_swift" varchar(20),
  "beneficiary_account" varchar(50),
  "form_m_number" varchar(50),
  "form_a_number" varchar(50),
  "cbn_approval_ref" varchar(100),
  "status" varchar(30)  DEFAULT 'pending'  NOT NULL,
  "swift_mt103_ref" varchar(100),
  "tiger_beetle_entry_id" bigint,
  "open_search_doc_id" varchar(200),
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "settled_at" timestamp
);

CREATE TABLE "split_bill_groups" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "group_id" varchar(64)  NOT NULL,
  "creator_id" integer  NOT NULL,
  "title" varchar(200)  NOT NULL,
  "total_amount" numeric(18, 2)  NOT NULL,
  "currency" varchar(8)  DEFAULT 'USD'  NOT NULL,
  "note" text,
  "status" varchar(20)  DEFAULT 'active'  NOT NULL,
  "expires_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "split_bill_groups_group_id_unique" UNIQUE ("group_id")
);

CREATE TABLE "split_bill_participants" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "group_id" varchar(64)  NOT NULL,
  "name" varchar(200)  NOT NULL,
  "email" varchar(255),
  "share_amount" numeric(18, 2)  NOT NULL,
  "token" varchar(64)  NOT NULL,
  "status" varchar(20)  DEFAULT 'pending'  NOT NULL,
  "paid_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "split_bill_participants_token_unique" UNIQUE ("token")
);

CREATE TABLE "stablecoin_wallets" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "symbol" varchar(10)  NOT NULL,
  "balance" numeric(18, 8)  DEFAULT '0.00000000',
  "wallet_address" varchar(200),
  "network" varchar(50)  DEFAULT 'Ethereum',
  "protocol" varchar(50)  DEFAULT 'ERC-20',
  "status" varchar(20)  DEFAULT 'active',
  "created_at" timestamp  DEFAULT now(),
  "updated_at" timestamp  DEFAULT now()
);

CREATE TABLE "startup_deals" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "company_name" varchar(200)  NOT NULL,
  "tagline" varchar(300)  NOT NULL,
  "description" text  NOT NULL,
  "sector" varchar(100)  NOT NULL,
  "stage" varchar(50)  NOT NULL,
  "location" varchar(200)  NOT NULL,
  "founded_year" integer,
  "team_size" integer,
  "target_raise_usd" numeric(18, 2)  NOT NULL,
  "raised_so_far_usd" numeric(18, 2)  DEFAULT '0',
  "minimum_ticket_usd" numeric(18, 2)  NOT NULL,
  "valuation_usd" numeric(24, 2),
  "equity_offered_pct" numeric(8, 4),
  "instrument_type" varchar(50)  DEFAULT 'SAFE'  NOT NULL,
  "status" varchar(30)  DEFAULT 'open'  NOT NULL,
  "website_url" text,
  "pitch_deck_url" text,
  "logo_url" text,
  "image_urls" json  DEFAULT '[]'::json,
  "highlights" json  DEFAULT '[]'::json,
  "risks" json  DEFAULT '[]'::json,
  "metrics" json  DEFAULT '[]'::json,
  "closing_date" timestamp,
  "is_featured" boolean  DEFAULT false  NOT NULL,
  "is_verified" boolean  DEFAULT false  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "startup_investments" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "deal_id" integer  NOT NULL,
  "amount_usd" numeric(18, 2)  NOT NULL,
  "instrument_type" varchar(50)  NOT NULL,
  "equity_pct" numeric(10, 6),
  "status" varchar(30)  DEFAULT 'pending'  NOT NULL,
  "payment_method" varchar(50)  DEFAULT 'wallet',
  "agreement_signed" boolean  DEFAULT false  NOT NULL,
  "agreement_url" text,
  "notes" text,
  "invested_at" timestamp  DEFAULT now()  NOT NULL,
  "confirmed_at" timestamp,
  "exited_at" timestamp,
  "exit_value_usd" numeric(18, 2),
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "stock_watchlists" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "stock_id" integer  NOT NULL,
  "alert_price_ngn" numeric(18, 4),
  "notes" text,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "stripe_receipts" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "stripe_session_id" varchar(200)  NOT NULL,
  "stripe_payment_intent_id" varchar(200),
  "amount_total" integer  NOT NULL,
  "currency" varchar(10)  DEFAULT 'usd'  NOT NULL,
  "status" varchar(30)  DEFAULT 'paid'  NOT NULL,
  "product_name" varchar(200),
  "receipt_url" text,
  "metadata" text,
  "paid_at" timestamp  DEFAULT now()  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "stripe_receipts_stripe_session_id_unique" UNIQUE ("stripe_session_id")
);

CREATE TABLE "stripe_webhook_retry_log" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "stripe_event_id" varchar(200)  NOT NULL,
  "event_type" varchar(100)  NOT NULL,
  "payload" jsonb,
  "attempt_count" integer  DEFAULT 1  NOT NULL,
  "last_attempt_at" timestamp  DEFAULT now()  NOT NULL,
  "next_retry_at" timestamp,
  "status" varchar(20)  DEFAULT 'pending'  NOT NULL,
  "error_message" text,
  "resolved_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "support_tickets" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "subject" varchar(255)  NOT NULL,
  "message" text  NOT NULL,
  "status" "ticket_status"  DEFAULT 'open',
  "priority" "ticket_priority"  DEFAULT 'medium',
  "category" varchar(100),
  "agent_id" integer,
  "resolution" text,
  "created_at" timestamp  DEFAULT now(),
  "updated_at" timestamp  DEFAULT now(),
  "resolved_at" timestamp
);

CREATE TABLE "swift_transactions" (
  "id" varchar(64)  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "uetr" uuid  NOT NULL,
  "msg_id" varchar(128)  NOT NULL,
  "end_to_end_id" varchar(128),
  "tx_id" varchar(128),
  "debtor_name" varchar(200),
  "debtor_account" varchar(100),
  "debtor_bic" varchar(20),
  "creditor_name" varchar(200),
  "creditor_account" varchar(100),
  "creditor_bic" varchar(20),
  "amount" numeric(18, 6)  NOT NULL,
  "currency" varchar(10)  NOT NULL,
  "charge_bearer" varchar(10),
  "remittance_info" text,
  "status" "swift_gpi_status"  DEFAULT 'ACCP'  NOT NULL,
  "message_json" json  DEFAULT '{}'::json,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "swift_transactions_uetr_unique" UNIQUE ("uetr")
);

CREATE TABLE "system_config" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "key" varchar(100)  NOT NULL,
  "value" text  NOT NULL,
  "description" text,
  "is_secret" boolean  DEFAULT false  NOT NULL,
  "updated_by" integer,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "system_config_key_unique" UNIQUE ("key")
);

CREATE TABLE "system_config_audit_log" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "config_key" varchar(100)  NOT NULL,
  "old_value" text,
  "new_value" text,
  "changed_by" integer,
  "change_reason" text,
  "reload_triggered" boolean  DEFAULT false,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "talent_bookings" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "opportunity_id" integer  NOT NULL,
  "expert_user_id" integer  NOT NULL,
  "status" "talent_booking_status"  DEFAULT 'pending',
  "message" text,
  "proposed_rate" numeric(10, 2),
  "currency" varchar(10)  DEFAULT 'USD',
  "start_date" timestamp,
  "end_date" timestamp,
  "completed_at" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "talent_opportunities" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "posted_by_user_id" integer  NOT NULL,
  "institution_name" varchar(200)  NOT NULL,
  "title" varchar(300)  NOT NULL,
  "description" text,
  "sector" varchar(100),
  "country" varchar(64),
  "engagement_type" "talent_engagement"  DEFAULT 'advisory',
  "compensation" numeric(10, 2),
  "currency" varchar(10)  DEFAULT 'USD',
  "deadline" timestamp,
  "status" varchar(20)  DEFAULT 'open',
  "applicant_count" integer  DEFAULT 0,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "talent_profiles" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "bio" text,
  "expertise" json  DEFAULT '[]'::json,
  "countries" json  DEFAULT '[]'::json,
  "availability" "talent_availability"  DEFAULT 'advisory',
  "hourly_rate" numeric(10, 2),
  "currency" varchar(10)  DEFAULT 'USD',
  "linkedin_url" text,
  "portfolio_url" text,
  "verified" boolean  DEFAULT false,
  "total_bookings" integer  DEFAULT 0,
  "avg_rating" numeric(3, 2)  DEFAULT '0',
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "talent_profiles_user_id_unique" UNIQUE ("user_id")
);

CREATE TABLE "tenant_configs" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "tenant_id" varchar(100)  NOT NULL,
  "tenant_name" varchar(255)  NOT NULL,
  "primary_color" varchar(20)  DEFAULT '#6366f1',
  "secondary_color" varchar(20)  DEFAULT '#8b5cf6',
  "logo_url" text,
  "favicon_url" text,
  "custom_domain" varchar(255),
  "support_email" varchar(255),
  "support_phone" varchar(50),
  "default_currency" varchar(10)  DEFAULT 'USD',
  "allowed_currencies" json,
  "max_transfer_limit" numeric(18, 2)  DEFAULT '50000',
  "kyc_required" boolean  DEFAULT true,
  "mfa_required" boolean  DEFAULT false,
  "webhook_url" text,
  "webhook_secret" varchar(255),
  "is_active" boolean  DEFAULT true,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "tenant_configs_tenant_id_unique" UNIQUE ("tenant_id")
);

CREATE TABLE "tenant_feature_flags" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "tenant_id" integer  NOT NULL,
  "flag_id" integer  NOT NULL,
  "enabled" boolean  NOT NULL,
  "overridden_by" integer,
  "reason" text,
  "expires_at" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "tenant_onboarding_sessions" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "session_token" varchar(64)  NOT NULL,
  "invite_code_id" integer  NOT NULL,
  "user_id" integer,
  "tenant_id" integer,
  "step" integer  DEFAULT 1  NOT NULL,
  "data" json  DEFAULT '{}'::json,
  "status" varchar(20)  DEFAULT 'in_progress'  NOT NULL,
  "completed_at" timestamp,
  "expires_at" timestamp  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "tenant_onboarding_sessions_session_token_unique" UNIQUE ("session_token")
);

CREATE TABLE "tenant_users" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "tenant_id" integer  NOT NULL,
  "user_id" integer  NOT NULL,
  "role" varchar(20)  DEFAULT 'member'  NOT NULL,
  "joined_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "tenants" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "slug" varchar(63)  NOT NULL,
  "name" varchar(255)  NOT NULL,
  "plan" "tenant_plan"  DEFAULT 'starter'  NOT NULL,
  "status" "tenant_status"  DEFAULT 'trial'  NOT NULL,
  "owner_id" integer,
  "logo_url" text,
  "favicon_url" text,
  "primary_color" varchar(7)  DEFAULT '#7c3aed',
  "secondary_color" varchar(7)  DEFAULT '#06b6d4',
  "accent_color" varchar(7)  DEFAULT '#f59e0b',
  "brand_name" varchar(255),
  "support_email" varchar(255),
  "support_url" text,
  "custom_domain" varchar(255),
  "default_currency" varchar(10)  DEFAULT 'USD',
  "default_locale" varchar(10)  DEFAULT 'en',
  "allowed_countries" json  DEFAULT '[]'::json,
  "max_users" integer  DEFAULT 100,
  "max_monthly_volume" numeric(18, 2)  DEFAULT '50000',
  "metadata" json  DEFAULT '{}'::json,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "tenants_slug_unique" UNIQUE ("slug")
);

CREATE TABLE "tiered_kyc_sessions" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "session_token" varchar(200)  NOT NULL,
  "target_tier" "kyc_tier_v2"  NOT NULL,
  "id_doc_type" "id_doc_type",
  "id_doc_number" varchar(100),
  "id_doc_front_url" varchar(500),
  "id_doc_back_url" varchar(500),
  "selfie_url" varchar(500),
  "liveness_score" numeric(5, 4),
  "ocr_data" jsonb,
  "rust_kyc_service_result" jsonb,
  "status" varchar(30)  DEFAULT 'pending'  NOT NULL,
  "rejection_reason" text,
  "redis_session_key" varchar(200),
  "temporal_workflow_id" varchar(200),
  "kafka_event_id" varchar(200),
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "completed_at" timestamp,
  CONSTRAINT "tiered_kyc_sessions_session_token_unique" UNIQUE ("session_token")
);

CREATE TABLE "transaction_exports" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "format" varchar(10)  NOT NULL,
  "status" varchar(20)  DEFAULT 'pending'  NOT NULL,
  "filters" jsonb,
  "record_count" integer  DEFAULT 0,
  "file_url" text,
  "file_size" integer,
  "expires_at" timestamp,
  "error_message" text,
  "requested_at" timestamp  DEFAULT now()  NOT NULL,
  "completed_at" timestamp
);

CREATE TABLE "transactions" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "userId" integer  NOT NULL,
  "type" "tx_type"  NOT NULL,
  "status" "tx_status"  DEFAULT 'pending',
  "fromCurrency" varchar(8)  NOT NULL,
  "fromAmount" numeric(18, 2)  NOT NULL,
  "toCurrency" varchar(8),
  "toAmount" numeric(18, 2),
  "fee" numeric(18, 2)  DEFAULT '0.00',
  "fxRate" numeric(18, 6),
  "reference" varchar(64),
  "description" text,
  "recipientName" varchar(128),
  "recipientAccount" varchar(64),
  "recipientBank" varchar(128),
  "recipientCountry" varchar(64),
  "channel" varchar(32),
  "metadata" json,
  "idempotency_key" varchar(200),
  "archived_at" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "transfer_audit_trail" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "transfer_id" integer  NOT NULL,
  "user_id" integer  NOT NULL,
  "from_status" varchar(30),
  "to_status" varchar(30)  NOT NULL,
  "triggered_by" varchar(50)  NOT NULL,
  "reason" text,
  "metadata" text,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "travel_rule_records" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "transaction_id" integer,
  "direction" varchar(10)  DEFAULT 'outbound'  NOT NULL,
  "originator_name" varchar(255)  NOT NULL,
  "originator_account" varchar(100),
  "originator_address" text,
  "originator_country" varchar(3),
  "beneficiary_name" varchar(255)  NOT NULL,
  "beneficiary_account" varchar(100),
  "beneficiary_address" text,
  "beneficiary_country" varchar(3),
  "amount" numeric(18, 2)  NOT NULL,
  "currency" varchar(10)  NOT NULL,
  "vasp" varchar(255),
  "vasp_lei" varchar(20),
  "status" varchar(20)  DEFAULT 'pending'  NOT NULL,
  "threshold" numeric(18, 2)  DEFAULT '1000',
  "reported_at" timestamp,
  "acknowledged_at" timestamp,
  "notes" text,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "treasury_positions" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "currency" varchar(10)  NOT NULL,
  "balance" numeric(18, 2)  NOT NULL,
  "locked_balance" numeric(18, 2)  DEFAULT '0',
  "available_balance" numeric(18, 2)  NOT NULL,
  "usd_equivalent" numeric(18, 2),
  "provider" varchar(100),
  "account_ref" varchar(200),
  "updatedAt" timestamp  DEFAULT now()  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "us_compliance_disclosures" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "disclosure_version" varchar(20)  NOT NULL,
  "disclosure_type" varchar(50)  NOT NULL,
  "accepted_at" timestamp  DEFAULT now()  NOT NULL,
  "ip_address" varchar(50),
  "user_agent" text
);

CREATE TABLE "user_feature_flags" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "flag_id" integer  NOT NULL,
  "enabled" boolean  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "user_investments" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "asset_id" integer  NOT NULL,
  "status" "user_investment_status"  DEFAULT 'active',
  "quantity" numeric(18, 8)  NOT NULL,
  "purchase_price" numeric(18, 6)  NOT NULL,
  "current_value" numeric(18, 2),
  "currency" varchar(10)  DEFAULT 'USD',
  "purchased_at" timestamp  DEFAULT now()  NOT NULL,
  "sold_at" timestamp,
  "sold_price" numeric(18, 6),
  "notes" text,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "user_lockouts" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "failed_attempts" integer  DEFAULT 0  NOT NULL,
  "locked_at" timestamp,
  "lock_expires_at" timestamp,
  "last_failed_at" timestamp,
  "unlocked_at" timestamp,
  "unlocked_by_admin_id" integer,
  "notification_sent_at" timestamp,
  "unlock_token" text,
  "unlock_token_expires_at" timestamp,
  "unlock_requested_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "user_lockouts_user_id_unique" UNIQUE ("user_id")
);

CREATE TABLE "user_notif_prefs" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "email_transactions" boolean  DEFAULT true  NOT NULL,
  "email_marketing" boolean  DEFAULT false  NOT NULL,
  "email_security" boolean  DEFAULT true  NOT NULL,
  "push_transactions" boolean  DEFAULT true  NOT NULL,
  "push_marketing" boolean  DEFAULT false  NOT NULL,
  "sms_transactions" boolean  DEFAULT false  NOT NULL,
  "fx_alert_enabled" boolean  DEFAULT false  NOT NULL,
  "fx_alert_threshold" numeric(10, 4),
  "fx_alert_currency" varchar(10),
  "updatedAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "user_notif_prefs_user_id_unique" UNIQUE ("user_id")
);

CREATE TABLE "user_onboarding_progress" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "status" "user_onboarding_status"  DEFAULT 'not_started'  NOT NULL,
  "profile_completed" boolean  DEFAULT false,
  "bank_linked" boolean  DEFAULT false,
  "kyc_started" boolean  DEFAULT false,
  "kyc_completed" boolean  DEFAULT false,
  "first_transfer_made" boolean  DEFAULT false,
  "notifications_enabled" boolean  DEFAULT false,
  "profile_completed_at" timestamp,
  "bank_linked_at" timestamp,
  "kyc_started_at" timestamp,
  "kyc_completed_at" timestamp,
  "first_transfer_at" timestamp,
  "completed_at" timestamp,
  "skipped_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "user_onboarding_progress_user_id_unique" UNIQUE ("user_id")
);

CREATE TABLE "users" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "openId" varchar(128)  NOT NULL,
  "email" varchar(320),
  "name" varchar(128),
  "phone" varchar(32),
  "avatar" text,
  "loginMethod" varchar(32),
  "role" "role"  DEFAULT 'user',
  "kycTier" "kycTier"  DEFAULT 'tier0',
  "referralCode" varchar(16),
  "referredBy" integer,
  "twoFactorEnabled" boolean  DEFAULT false,
  "twoFactorSecret" varchar(64),
  "address" varchar(256),
  "dateOfBirth" date,
  "defaultCurrency" varchar(8)  DEFAULT 'NGN',
  "lastSignedIn" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "users_openId_unique" UNIQUE ("openId")
);

CREATE TABLE "velocity_overrides" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "rule_id" integer  NOT NULL,
  "user_id" integer,
  "reason" text  NOT NULL,
  "expires_at" timestamp,
  "granted_by" integer  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "velocity_rules" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "name" varchar(100)  NOT NULL,
  "description" text,
  "window" "velocity_window"  DEFAULT '24h'  NOT NULL,
  "max_count" integer,
  "max_amount" numeric(18, 2),
  "currency" varchar(10)  DEFAULT 'USD',
  "action" "velocity_action"  DEFAULT 'flag'  NOT NULL,
  "is_active" boolean  DEFAULT true  NOT NULL,
  "applies_to" varchar(20)  DEFAULT 'all',
  "created_by" integer,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "velocity_whitelist" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "reason" text  NOT NULL,
  "added_by" integer  NOT NULL,
  "expires_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "virtualAccounts" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "userId" integer  NOT NULL,
  "currency" varchar(8)  NOT NULL,
  "bank" varchar(128)  NOT NULL,
  "accountNumber" varchar(32)  NOT NULL,
  "accountName" varchar(128)  NOT NULL,
  "routingNumber" varchar(32),
  "sortCode" varchar(16),
  "iban" varchar(64),
  "swiftCode" varchar(16),
  "status" "va_status"  DEFAULT 'active',
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "wallet_funding_events" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "wallet_id" integer  NOT NULL,
  "user_id" integer  NOT NULL,
  "amount" varchar(30)  NOT NULL,
  "currency" varchar(10)  NOT NULL,
  "funding_source_type" "funding_source_type"  NOT NULL,
  "source_reference" varchar(200),
  "settlement_account_id" integer,
  "is_nfem_approved" boolean  DEFAULT false  NOT NULL,
  "blocked_reason" text,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "wallets" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "userId" integer  NOT NULL,
  "currency" varchar(8)  NOT NULL,
  "balance" numeric(18, 2)  DEFAULT '0.00'  NOT NULL,
  "lockedBalance" numeric(18, 2)  DEFAULT '0.00',
  "isDefault" boolean  DEFAULT false,
  "status" "wallet_status"  DEFAULT 'active',
  "version" integer  DEFAULT 1  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "webhook_deliveries" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "endpoint_id" integer  NOT NULL,
  "event_type" varchar(64)  NOT NULL,
  "payload" json  DEFAULT '{}'::json,
  "status" "webhook_event_status"  DEFAULT 'pending'  NOT NULL,
  "response_status" integer,
  "response_body" text,
  "attempt_count" integer  DEFAULT 0  NOT NULL,
  "next_retry_at" timestamp,
  "delivered_at" timestamp,
  "createdAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "webhook_endpoints" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "tenant_id" integer,
  "user_id" integer,
  "url" text  NOT NULL,
  "secret" varchar(64)  NOT NULL,
  "events" json  DEFAULT '[]'::json,
  "is_active" boolean  DEFAULT true  NOT NULL,
  "description" text,
  "last_delivered_at" timestamp,
  "failure_count" integer  DEFAULT 0  NOT NULL,
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "webhook_retry_queue" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "delivery_id" integer  NOT NULL,
  "endpoint_id" integer  NOT NULL,
  "payload" json  NOT NULL,
  "attempt_number" integer  DEFAULT 1  NOT NULL,
  "max_attempts" integer  DEFAULT 5  NOT NULL,
  "next_attempt_at" timestamp  NOT NULL,
  "last_attempt_at" timestamp,
  "last_error" text,
  "status" varchar(20)  DEFAULT 'pending'  NOT NULL,
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "west_africa_transfers" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "transfer_id" varchar(100)  NOT NULL,
  "user_id" integer  NOT NULL,
  "corridor_code" varchar(5)  NOT NULL,
  "amount_ngn" numeric(18, 2),
  "amount_xof" numeric(18, 2),
  "fx_rate" numeric(18, 8),
  "fees_ngn" numeric(18, 2),
  "recipient_mobile_money" varchar(30)  NOT NULL,
  "recipient_name" varchar(100)  NOT NULL,
  "mojaloop_dfsp_id" varchar(50),
  "mojaloop_txn_id" varchar(100),
  "purpose_code" varchar(10)  DEFAULT 'FAM',
  "status" varchar(30)  DEFAULT 'pending',
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now(),
  CONSTRAINT "west_africa_transfers_transfer_id_unique" UNIQUE ("transfer_id")
);

CREATE TABLE "west_african_corridors" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "corridor_code" "west_african_corridor"  NOT NULL,
  "country_name" varchar(100)  NOT NULL,
  "currency" varchar(10)  NOT NULL,
  "fx_rate_ngn" numeric(18, 6)  NOT NULL,
  "fx_rate_updated_at" timestamp  DEFAULT now()  NOT NULL,
  "cbdc_enabled" boolean  DEFAULT false,
  "mojaloop_enabled" boolean  DEFAULT false,
  "min_transfer_ngn" integer  DEFAULT 5000  NOT NULL,
  "max_transfer_ngn" integer  DEFAULT 5000000  NOT NULL,
  "fee_percent" numeric(5, 4)  DEFAULT '0.0150'  NOT NULL,
  "settlement_hours" integer  DEFAULT 24  NOT NULL,
  "is_active" boolean  DEFAULT true  NOT NULL,
  "kafka_topic" varchar(200),
  "dapr_app_id" varchar(100),
  "mojaloop_fsp_id" varchar(100),
  "created_at" timestamp  DEFAULT now()  NOT NULL,
  "updated_at" timestamp  DEFAULT now()  NOT NULL
);

CREATE TABLE "white_label_configs" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "tenant_id" integer  NOT NULL,
  "onboarding_steps" json  DEFAULT '[]'::json,
  "nav_sections" json  DEFAULT '[]'::json,
  "terms_url" text,
  "privacy_url" text,
  "welcome_email_subject" varchar(255),
  "welcome_email_body" text,
  "show_powered_by" boolean  DEFAULT true,
  "allow_self_registration" boolean  DEFAULT true,
  "require_invite_code" boolean  DEFAULT false,
  "ga_tracking_id" varchar(50),
  "intercom_app_id" varchar(50),
  "createdAt" timestamp  DEFAULT now()  NOT NULL,
  "updatedAt" timestamp  DEFAULT now()  NOT NULL,
  CONSTRAINT "white_label_configs_tenant_id_unique" UNIQUE ("tenant_id")
);

CREATE TABLE "xof_payout_accounts" (
  "id" serial  NOT NULL  PRIMARY KEY,
  "user_id" integer  NOT NULL,
  "corridor_code" "west_african_corridor"  NOT NULL,
  "payout_method" "xof_payout_method"  NOT NULL,
  "account_name" varchar(200)  NOT NULL,
  "account_number" varchar(50),
  "mobile_number" varchar(20),
  "mobile_provider" varchar(50),
  "bank_code" varchar(20),
  "bank_name" varchar(100),
  "is_verified" boolean  DEFAULT false,
  "verified_at" timestamp,
  "created_at" timestamp  DEFAULT now()  NOT NULL
);

ALTER TABLE "ab_assignments" ADD CONSTRAINT "ab_assignments_experiment_id_ab_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "ab_experiments" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ab_assignments" ADD CONSTRAINT "ab_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ab_events" ADD CONSTRAINT "ab_events_experiment_id_ab_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "ab_experiments" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ab_events" ADD CONSTRAINT "ab_events_assignment_id_ab_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "ab_assignments" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ab_experiments" ADD CONSTRAINT "ab_experiments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ach_payment_methods" ADD CONSTRAINT "ach_payment_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "africbdc_transfers" ADD CONSTRAINT "africbdc_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "agent_cashin_transactions" ADD CONSTRAINT "agent_cashin_transactions_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "agent_cashin_transactions" ADD CONSTRAINT "agent_cashin_transactions_worker_id_users_id_fk" FOREIGN KEY ("worker_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_agreement_doc_id_partner_digital_agreements_id_fk" FOREIGN KEY ("agreement_doc_id") REFERENCES "partner_digital_agreements" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_signer_user_id_users_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "agreement_templates" ADD CONSTRAINT "agreement_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "airflow_dag_runs" ADD CONSTRAINT "airflow_dag_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "api_key_rotation_log" ADD CONSTRAINT "api_key_rotation_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "api_key_usage_logs" ADD CONSTRAINT "api_key_usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "batch_payment_items" ADD CONSTRAINT "batch_payment_items_batch_id_batchPayments_id_fk" FOREIGN KEY ("batch_id") REFERENCES "batchPayments" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "batch_payment_items" ADD CONSTRAINT "batch_payment_items_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bdc_liquidity_requests" ADD CONSTRAINT "bdc_liquidity_requests_bdc_partner_id_bdc_partners_id_fk" FOREIGN KEY ("bdc_partner_id") REFERENCES "bdc_partners" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bdc_liquidity_requests" ADD CONSTRAINT "bdc_liquidity_requests_settlement_account_id_settlement_accounts_id_fk" FOREIGN KEY ("settlement_account_id") REFERENCES "settlement_accounts" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bdc_partners" ADD CONSTRAINT "bdc_partners_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bond_coupon_payments" ADD CONSTRAINT "bond_coupon_payments_subscription_id_bond_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "bond_subscriptions" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "bond_coupon_payments" ADD CONSTRAINT "bond_coupon_payments_bond_id_diaspora_bonds_id_fk" FOREIGN KEY ("bond_id") REFERENCES "diaspora_bonds" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bond_coupon_payments" ADD CONSTRAINT "bond_coupon_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bond_coupon_payments" ADD CONSTRAINT "bond_coupon_payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bond_secondary_market_orders" ADD CONSTRAINT "bond_secondary_market_orders_subscription_id_bond_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "bond_subscriptions" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bond_secondary_market_orders" ADD CONSTRAINT "bond_secondary_market_orders_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bond_secondary_market_orders" ADD CONSTRAINT "bond_secondary_market_orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bond_secondary_market_orders" ADD CONSTRAINT "bond_secondary_market_orders_bond_id_diaspora_bonds_id_fk" FOREIGN KEY ("bond_id") REFERENCES "diaspora_bonds" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bond_secondary_market_orders" ADD CONSTRAINT "bond_secondary_market_orders_settlement_tx_id_transactions_id_fk" FOREIGN KEY ("settlement_tx_id") REFERENCES "transactions" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bond_subscriptions" ADD CONSTRAINT "bond_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bond_subscriptions" ADD CONSTRAINT "bond_subscriptions_bond_id_diaspora_bonds_id_fk" FOREIGN KEY ("bond_id") REFERENCES "diaspora_bonds" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bond_subscriptions" ADD CONSTRAINT "bond_subscriptions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bricspay_transfers" ADD CONSTRAINT "bricspay_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bulk_payment_batches" ADD CONSTRAINT "bulk_payment_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "bulk_user_action_log" ADD CONSTRAINT "bulk_user_action_log_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "business_credit_scores" ADD CONSTRAINT "business_credit_scores_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "payroll_companies" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "business_savings_accounts" ADD CONSTRAINT "business_savings_accounts_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "payroll_companies" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "business_savings_accounts" ADD CONSTRAINT "business_savings_accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "business_savings_accounts" ADD CONSTRAINT "business_savings_accounts_product_id_business_savings_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "business_savings_products" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "business_savings_txns" ADD CONSTRAINT "business_savings_txns_account_id_business_savings_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "business_savings_accounts" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "carbon_credits" ADD CONSTRAINT "carbon_credits_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "cbdc_mint_burn_log" ADD CONSTRAINT "cbdc_mint_burn_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "cbdc_mint_burn_log" ADD CONSTRAINT "cbdc_mint_burn_log_authorized_by_users_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "cbn_compliance_exports" ADD CONSTRAINT "cbn_compliance_exports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "chargeback_cases" ADD CONSTRAINT "chargeback_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "chat_agent_status" ADD CONSTRAINT "chat_agent_status_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "chat_canned_responses" ADD CONSTRAINT "chat_canned_responses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "chat_session_meta" ADD CONSTRAINT "chat_session_meta_session_id_chatSessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "chatSessions" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chat_session_meta" ADD CONSTRAINT "chat_session_meta_assigned_agent_id_users_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "clearing_lines" ADD CONSTRAINT "clearing_lines_correspondent_bank_id_correspondent_banks_id_fk" FOREIGN KEY ("correspondent_bank_id") REFERENCES "correspondent_banks" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "community_activity_feed" ADD CONSTRAINT "community_activity_feed_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "community_funds" ADD CONSTRAINT "community_funds_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "compliance_alert_notes" ADD CONSTRAINT "compliance_alert_notes_alert_id_compliance_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "compliance_alerts" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "compliance_alert_notes" ADD CONSTRAINT "compliance_alert_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "compliance_alerts" ADD CONSTRAINT "compliance_alerts_related_user_id_users_id_fk" FOREIGN KEY ("related_user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "compliance_alerts" ADD CONSTRAINT "compliance_alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "compliance_alerts" ADD CONSTRAINT "compliance_alerts_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "compliance_email_config" ADD CONSTRAINT "compliance_email_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "compliance_email_config" ADD CONSTRAINT "compliance_email_config_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "compliance_reports" ADD CONSTRAINT "compliance_reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "compliance_watchlist" ADD CONSTRAINT "compliance_watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "compliance_watchlist" ADD CONSTRAINT "compliance_watchlist_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "contractor_invoices" ADD CONSTRAINT "contractor_invoices_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "contractors" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "contractor_invoices" ADD CONSTRAINT "contractor_invoices_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "payroll_companies" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "correspondent_risk_scores" ADD CONSTRAINT "correspondent_risk_scores_correspondent_bank_id_correspondent_banks_id_fk" FOREIGN KEY ("correspondent_bank_id") REFERENCES "correspondent_banks" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "corridor_margin_history" ADD CONSTRAINT "corridor_margin_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "payroll_companies" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_credit_score_id_business_credit_scores_id_fk" FOREIGN KEY ("credit_score_id") REFERENCES "business_credit_scores" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "cross_sell_offers" ADD CONSTRAINT "cross_sell_offers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ctr_auto_flags" ADD CONSTRAINT "ctr_auto_flags_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ctr_auto_flags" ADD CONSTRAINT "ctr_auto_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ctr_auto_flags" ADD CONSTRAINT "ctr_auto_flags_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "dbt_run_history" ADD CONSTRAINT "dbt_run_history_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "derisking_alerts" ADD CONSTRAINT "derisking_alerts_correspondent_bank_id_correspondent_banks_id_fk" FOREIGN KEY ("correspondent_bank_id") REFERENCES "correspondent_banks" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "derisking_alerts" ADD CONSTRAINT "derisking_alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "developer_sandbox_sessions" ADD CONSTRAINT "developer_sandbox_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "diaspora_canada_profiles" ADD CONSTRAINT "diaspora_canada_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "diaspora_collective_members" ADD CONSTRAINT "diaspora_collective_members_collective_id_diaspora_collectives_id_fk" FOREIGN KEY ("collective_id") REFERENCES "diaspora_collectives" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "diaspora_collective_members" ADD CONSTRAINT "diaspora_collective_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "diaspora_collectives" ADD CONSTRAINT "diaspora_collectives_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "diaspora_eu_profiles" ADD CONSTRAINT "diaspora_eu_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "diaspora_usa_profiles" ADD CONSTRAINT "diaspora_usa_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "doc_reminder_log" ADD CONSTRAINT "doc_reminder_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "doc_reminder_log" ADD CONSTRAINT "doc_reminder_log_document_id_document_vault_id_fk" FOREIGN KEY ("document_id") REFERENCES "document_vault" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "doc_reminder_prefs" ADD CONSTRAINT "doc_reminder_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_renewals" ADD CONSTRAINT "document_renewals_original_doc_id_document_vault_id_fk" FOREIGN KEY ("original_doc_id") REFERENCES "document_vault" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "document_renewals" ADD CONSTRAINT "document_renewals_new_doc_id_document_vault_id_fk" FOREIGN KEY ("new_doc_id") REFERENCES "document_vault" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "document_renewals" ADD CONSTRAINT "document_renewals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_vault" ADD CONSTRAINT "document_vault_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ecowas_compliance_checks" ADD CONSTRAINT "ecowas_compliance_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "embedded_payroll_api_keys" ADD CONSTRAINT "embedded_payroll_api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "embedded_payroll_requests" ADD CONSTRAINT "embedded_payroll_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "embedded_payroll_requests" ADD CONSTRAINT "embedded_payroll_requests_api_key_id_embedded_payroll_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "embedded_payroll_api_keys" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "entity_group_members" ADD CONSTRAINT "entity_group_members_group_id_entity_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "entity_groups" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "entity_group_members" ADD CONSTRAINT "entity_group_members_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "payroll_companies" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "entity_groups" ADD CONSTRAINT "entity_groups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "esg_reports" ADD CONSTRAINT "esg_reports_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "exchange_rate_alerts" ADD CONSTRAINT "exchange_rate_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_report_id_expense_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "expense_reports" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_policy_id_expense_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "expense_policies" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "expense_policies" ADD CONSTRAINT "expense_policies_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "payroll_companies" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "payroll_companies" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "family_budgets" ADD CONSTRAINT "family_budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "family_budgets" ADD CONSTRAINT "family_budgets_family_member_id_family_members_id_fk" FOREIGN KEY ("family_member_id") REFERENCES "family_members" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "flutterwave_transactions" ADD CONSTRAINT "flutterwave_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "form_m_documents" ADD CONSTRAINT "form_m_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "form_m_documents" ADD CONSTRAINT "form_m_documents_trade_payment_id_sme_trade_payments_id_fk" FOREIGN KEY ("trade_payment_id") REFERENCES "sme_trade_payments" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fund_proposals" ADD CONSTRAINT "fund_proposals_fund_id_community_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "community_funds" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fund_proposals" ADD CONSTRAINT "fund_proposals_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fund_votes" ADD CONSTRAINT "fund_votes_proposal_id_fund_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "fund_proposals" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fund_votes" ADD CONSTRAINT "fund_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fx_alert_trigger_history" ADD CONSTRAINT "fx_alert_trigger_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ghipss_transfers" ADD CONSTRAINT "ghipss_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "hnw_fx_rates" ADD CONSTRAINT "hnw_fx_rates_hnw_profile_id_hnw_profiles_id_fk" FOREIGN KEY ("hnw_profile_id") REFERENCES "hnw_profiles" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "hnw_portfolios" ADD CONSTRAINT "hnw_portfolios_hnw_profile_id_hnw_profiles_id_fk" FOREIGN KEY ("hnw_profile_id") REFERENCES "hnw_profiles" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "hnw_profiles" ADD CONSTRAINT "hnw_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "hnw_profiles" ADD CONSTRAINT "hnw_profiles_assigned_rm_id_users_id_fk" FOREIGN KEY ("assigned_rm_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "hnw_relationship_managers" ADD CONSTRAINT "hnw_relationship_managers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "immigrant_worker_profiles" ADD CONSTRAINT "immigrant_worker_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "interac_payment_methods" ADD CONSTRAINT "interac_payment_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "intercompany_transfers" ADD CONSTRAINT "intercompany_transfers_group_id_entity_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "entity_groups" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "intercompany_transfers" ADD CONSTRAINT "intercompany_transfers_from_company_id_payroll_companies_id_fk" FOREIGN KEY ("from_company_id") REFERENCES "payroll_companies" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "intercompany_transfers" ADD CONSTRAINT "intercompany_transfers_to_company_id_payroll_companies_id_fk" FOREIGN KEY ("to_company_id") REFERENCES "payroll_companies" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "intercompany_transfers" ADD CONSTRAINT "intercompany_transfers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "investment_orders" ADD CONSTRAINT "investment_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "investment_orders" ADD CONSTRAINT "investment_orders_asset_id_investment_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "investment_assets" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "investment_price_history" ADD CONSTRAINT "investment_price_history_asset_id_investment_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "investment_assets" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "investment_watchlist" ADD CONSTRAINT "investment_watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "investment_watchlist" ADD CONSTRAINT "investment_watchlist_asset_id_investment_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "investment_assets" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "invoice_financing_applications" ADD CONSTRAINT "invoice_financing_applications_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "invoice_financing_applications" ADD CONSTRAINT "invoice_financing_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "invoice_financing_repayments" ADD CONSTRAINT "invoice_financing_repayments_application_id_invoice_financing_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "invoice_financing_applications" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ip_login_history" ADD CONSTRAINT "ip_login_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kyc_lifecycle" ADD CONSTRAINT "kyc_lifecycle_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "kyc_lifecycle" ADD CONSTRAINT "kyc_lifecycle_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kyc_lifecycle_history" ADD CONSTRAINT "kyc_lifecycle_history_lifecycle_id_kyc_lifecycle_id_fk" FOREIGN KEY ("lifecycle_id") REFERENCES "kyc_lifecycle" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "kyc_lifecycle_history" ADD CONSTRAINT "kyc_lifecycle_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kyc_lifecycle_history" ADD CONSTRAINT "kyc_lifecycle_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kyc_liveness_audit" ADD CONSTRAINT "kyc_liveness_audit_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kyc_liveness_audit" ADD CONSTRAINT "kyc_liveness_audit_kyc_doc_id_kycDocuments_id_fk" FOREIGN KEY ("kyc_doc_id") REFERENCES "kycDocuments" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "lc_documents" ADD CONSTRAINT "lc_documents_lc_id_letters_of_credit_id_fk" FOREIGN KEY ("lc_id") REFERENCES "letters_of_credit" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "lc_documents" ADD CONSTRAINT "lc_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "lc_documents" ADD CONSTRAINT "lc_documents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "letters_of_credit" ADD CONSTRAINT "letters_of_credit_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "letters_of_credit" ADD CONSTRAINT "letters_of_credit_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_listing_id_market_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "market_listings" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "market_ratings" ADD CONSTRAINT "market_ratings_order_id_market_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "market_orders" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "market_ratings" ADD CONSTRAINT "market_ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "market_ratings" ADD CONSTRAINT "market_ratings_rated_user_id_users_id_fk" FOREIGN KEY ("rated_user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "mbridge_transfers" ADD CONSTRAINT "mbridge_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "merchant_kyb_reviews" ADD CONSTRAINT "merchant_kyb_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "merchant_kyb_reviews" ADD CONSTRAINT "merchant_kyb_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "mfa_settings" ADD CONSTRAINT "mfa_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "mortgage_applications" ADD CONSTRAINT "mortgage_applications_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "mortgage_applications" ADD CONSTRAINT "mortgage_applications_assigned_advisor_id_users_id_fk" FOREIGN KEY ("assigned_advisor_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "mortgage_repayments" ADD CONSTRAINT "mortgage_repayments_application_id_mortgage_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "mortgage_applications" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ngx_orders" ADD CONSTRAINT "ngx_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ngx_orders" ADD CONSTRAINT "ngx_orders_stock_id_ngx_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "ngx_stocks" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "nifi_pipeline_runs" ADD CONSTRAINT "nifi_pipeline_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "open_banking_consents" ADD CONSTRAINT "open_banking_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "outbound_annual_usage" ADD CONSTRAINT "outbound_annual_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "papss_transfers" ADD CONSTRAINT "papss_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "partner_api_keys" ADD CONSTRAINT "partner_api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "partner_api_keys" ADD CONSTRAINT "partner_api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "partner_api_keys" ADD CONSTRAINT "partner_api_keys_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "partner_application_comments" ADD CONSTRAINT "partner_application_comments_application_id_partner_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "partner_applications" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "partner_application_comments" ADD CONSTRAINT "partner_application_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_invite_code_id_partner_invite_codes_id_fk" FOREIGN KEY ("invite_code_id") REFERENCES "partner_invite_codes" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "partner_digital_agreements" ADD CONSTRAINT "partner_digital_agreements_agreement_id_revenue_share_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "revenue_share_agreements" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "partner_digital_agreements" ADD CONSTRAINT "partner_digital_agreements_template_id_agreement_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "agreement_templates" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "partner_digital_agreements" ADD CONSTRAINT "partner_digital_agreements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "partner_digital_agreements" ADD CONSTRAINT "partner_digital_agreements_platform_signed_by_users_id_fk" FOREIGN KEY ("platform_signed_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "partner_invite_codes" ADD CONSTRAINT "partner_invite_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "partner_webhooks" ADD CONSTRAINT "partner_webhooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "partner_webhooks" ADD CONSTRAINT "partner_webhooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payment_gateway_logs" ADD CONSTRAINT "payment_gateway_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_payer_user_id_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "paypal_transactions" ADD CONSTRAINT "paypal_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payroll_companies" ADD CONSTRAINT "payroll_companies_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payroll_disbursements" ADD CONSTRAINT "payroll_disbursements_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "payroll_runs" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payroll_employees" ADD CONSTRAINT "payroll_employees_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "payroll_companies" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payroll_employees" ADD CONSTRAINT "payroll_employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "payroll_runs" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_employee_id_payroll_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "payroll_employees" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "payroll_companies" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payroll_tax_filings" ADD CONSTRAINT "payroll_tax_filings_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "payroll_companies" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payroll_tax_filings" ADD CONSTRAINT "payroll_tax_filings_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "push_notification_preferences" ADD CONSTRAINT "push_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "rate_alert_history" ADD CONSTRAINT "rate_alert_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "real_estate_investments" ADD CONSTRAINT "real_estate_investments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "real_estate_investments" ADD CONSTRAINT "real_estate_investments_listing_id_real_estate_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "real_estate_listings" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "referral_bonuses" ADD CONSTRAINT "referral_bonuses_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "referral_bonuses" ADD CONSTRAINT "referral_bonuses_referred_id_users_id_fk" FOREIGN KEY ("referred_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "regulatory_reports" ADD CONSTRAINT "regulatory_reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "revenue_share_agreements" ADD CONSTRAINT "revenue_share_agreements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "revenue_share_agreements" ADD CONSTRAINT "revenue_share_agreements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "revenue_share_agreements" ADD CONSTRAINT "revenue_share_agreements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "revenue_share_ledger" ADD CONSTRAINT "revenue_share_ledger_agreement_id_revenue_share_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "revenue_share_agreements" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "revenue_share_ledger" ADD CONSTRAINT "revenue_share_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "revenue_share_ledger" ADD CONSTRAINT "revenue_share_ledger_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "revenue_share_ledger" ADD CONSTRAINT "revenue_share_ledger_payout_id_partner_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "partner_payouts" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "revenue_share_reports" ADD CONSTRAINT "revenue_share_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "revenue_share_reports" ADD CONSTRAINT "revenue_share_reports_agreement_id_revenue_share_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "revenue_share_agreements" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "revenue_share_reports" ADD CONSTRAINT "revenue_share_reports_applied_tier_id_revenue_share_tiers_id_fk" FOREIGN KEY ("applied_tier_id") REFERENCES "revenue_share_tiers" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "revenue_share_reports" ADD CONSTRAINT "revenue_share_reports_payout_id_partner_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "partner_payouts" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "revenue_share_tiers" ADD CONSTRAINT "revenue_share_tiers_agreement_id_revenue_share_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "revenue_share_agreements" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sanctions_checks" ADD CONSTRAINT "sanctions_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sanctions_checks" ADD CONSTRAINT "sanctions_checks_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sandbox_scenarios" ADD CONSTRAINT "sandbox_scenarios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "scheduled_transfers" ADD CONSTRAINT "scheduled_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "scheduled_transfers" ADD CONSTRAINT "scheduled_transfers_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "security_incidents" ADD CONSTRAINT "security_incidents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sepa_payment_methods" ADD CONSTRAINT "sepa_payment_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "settlement_accounts" ADD CONSTRAINT "settlement_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sla_incidents" ADD CONSTRAINT "sla_incidents_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "smart_routing_decisions" ADD CONSTRAINT "smart_routing_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sme_trade_bulk_batches" ADD CONSTRAINT "sme_trade_bulk_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sme_trade_payments" ADD CONSTRAINT "sme_trade_payments_batch_id_sme_trade_bulk_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "sme_trade_bulk_batches" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sme_trade_payments" ADD CONSTRAINT "sme_trade_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "split_bill_groups" ADD CONSTRAINT "split_bill_groups_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "startup_investments" ADD CONSTRAINT "startup_investments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "startup_investments" ADD CONSTRAINT "startup_investments_deal_id_startup_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "startup_deals" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_watchlists" ADD CONSTRAINT "stock_watchlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stock_watchlists" ADD CONSTRAINT "stock_watchlists_stock_id_ngx_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "ngx_stocks" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stripe_receipts" ADD CONSTRAINT "stripe_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "swift_transactions" ADD CONSTRAINT "swift_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "system_config_audit_log" ADD CONSTRAINT "system_config_audit_log_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "talent_bookings" ADD CONSTRAINT "talent_bookings_opportunity_id_talent_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "talent_opportunities" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "talent_bookings" ADD CONSTRAINT "talent_bookings_expert_user_id_users_id_fk" FOREIGN KEY ("expert_user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "talent_opportunities" ADD CONSTRAINT "talent_opportunities_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "talent_profiles" ADD CONSTRAINT "talent_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "tenant_feature_flags" ADD CONSTRAINT "tenant_feature_flags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "tenant_feature_flags" ADD CONSTRAINT "tenant_feature_flags_flag_id_feature_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "feature_flags" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "tenant_feature_flags" ADD CONSTRAINT "tenant_feature_flags_overridden_by_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "tenant_onboarding_sessions" ADD CONSTRAINT "tenant_onboarding_sessions_invite_code_id_partner_invite_codes_id_fk" FOREIGN KEY ("invite_code_id") REFERENCES "partner_invite_codes" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "tenant_onboarding_sessions" ADD CONSTRAINT "tenant_onboarding_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "tenant_onboarding_sessions" ADD CONSTRAINT "tenant_onboarding_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "tiered_kyc_sessions" ADD CONSTRAINT "tiered_kyc_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "transaction_exports" ADD CONSTRAINT "transaction_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "transfer_audit_trail" ADD CONSTRAINT "transfer_audit_trail_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "travel_rule_records" ADD CONSTRAINT "travel_rule_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "travel_rule_records" ADD CONSTRAINT "travel_rule_records_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "us_compliance_disclosures" ADD CONSTRAINT "us_compliance_disclosures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_feature_flags" ADD CONSTRAINT "user_feature_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "user_feature_flags" ADD CONSTRAINT "user_feature_flags_flag_id_feature_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "feature_flags" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "user_investments" ADD CONSTRAINT "user_investments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_investments" ADD CONSTRAINT "user_investments_asset_id_investment_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "investment_assets" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_lockouts" ADD CONSTRAINT "user_lockouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_notif_prefs" ADD CONSTRAINT "user_notif_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_onboarding_progress" ADD CONSTRAINT "user_onboarding_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "velocity_overrides" ADD CONSTRAINT "velocity_overrides_rule_id_velocity_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "velocity_rules" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "velocity_overrides" ADD CONSTRAINT "velocity_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "velocity_overrides" ADD CONSTRAINT "velocity_overrides_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "velocity_rules" ADD CONSTRAINT "velocity_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "velocity_whitelist" ADD CONSTRAINT "velocity_whitelist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "velocity_whitelist" ADD CONSTRAINT "velocity_whitelist_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "wallet_funding_events" ADD CONSTRAINT "wallet_funding_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "wallet_funding_events" ADD CONSTRAINT "wallet_funding_events_settlement_account_id_settlement_accounts_id_fk" FOREIGN KEY ("settlement_account_id") REFERENCES "settlement_accounts" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "webhook_retry_queue" ADD CONSTRAINT "webhook_retry_queue_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "webhook_deliveries" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "webhook_retry_queue" ADD CONSTRAINT "webhook_retry_queue_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "white_label_configs" ADD CONSTRAINT "white_label_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "xof_payout_accounts" ADD CONSTRAINT "xof_payout_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "auditLogs_userId_idx" ON "auditLogs" ("userId" NULLS LAST);
CREATE INDEX "auditLogs_createdAt_idx" ON "auditLogs" ("createdAt" NULLS LAST);
CREATE INDEX "beneficiaries_userId_idx" ON "beneficiaries" ("userId" NULLS LAST);
CREATE INDEX "cards_userId_idx" ON "cards" ("userId" NULLS LAST);
CREATE INDEX "cards_userId_status_idx" ON "cards" ("userId" NULLS LAST, "status" NULLS LAST);
CREATE INDEX "cbdcWallets_userId_idx" ON "cbdc_wallets" ("user_id" NULLS LAST);
CREATE INDEX "cbdcWallets_userId_currency_idx" ON "cbdc_wallets" ("user_id" NULLS LAST, "currency" NULLS LAST);
CREATE INDEX "idempotencyKeys_key_unique_idx" ON "idempotency_keys" ("key" NULLS LAST);
CREATE INDEX "idempotencyKeys_userId_idx" ON "idempotency_keys" ("user_id" NULLS LAST);
CREATE INDEX "idempotencyKeys_expiresAt_idx" ON "idempotency_keys" ("expires_at" NULLS LAST);
CREATE INDEX "kyc_liveness_audit_user_idx" ON "kyc_liveness_audit" ("user_id" NULLS LAST);
CREATE INDEX "kyc_liveness_audit_doc_idx" ON "kyc_liveness_audit" ("kyc_doc_id" NULLS LAST);
CREATE INDEX "kyc_liveness_audit_created_idx" ON "kyc_liveness_audit" ("created_at" NULLS LAST);
CREATE INDEX "kycDocuments_userId_idx" ON "kycDocuments" ("userId" NULLS LAST);
CREATE INDEX "kycDocuments_userId_status_idx" ON "kycDocuments" ("userId" NULLS LAST, "status" NULLS LAST);
CREATE INDEX "notifications_userId_idx" ON "notifications" ("userId" NULLS LAST);
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications" ("userId" NULLS LAST, "isRead" NULLS LAST);
CREATE INDEX "savingsGoals_userId_idx" ON "savingsGoals" ("userId" NULLS LAST);
CREATE INDEX "savingsGoals_userId_status_idx" ON "savingsGoals" ("userId" NULLS LAST, "status" NULLS LAST);
CREATE INDEX "transactions_userId_idx" ON "transactions" ("userId" NULLS LAST);
CREATE INDEX "transactions_userId_createdAt_idx" ON "transactions" ("userId" NULLS LAST, "createdAt" NULLS LAST);
CREATE INDEX "transactions_userId_status_idx" ON "transactions" ("userId" NULLS LAST, "status" NULLS LAST);
CREATE INDEX "transactions_reference_idx" ON "transactions" ("reference" NULLS LAST);
CREATE INDEX "transactions_idempotencyKey_idx" ON "transactions" ("idempotency_key" NULLS LAST);
CREATE INDEX "wallets_userId_idx" ON "wallets" ("userId" NULLS LAST);
CREATE INDEX "wallets_userId_currency_idx" ON "wallets" ("userId" NULLS LAST, "currency" NULLS LAST);

