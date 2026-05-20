CREATE TYPE "public"."correspondent_risk" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."derisking_status" AS ENUM('active', 'watch', 'at_risk', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."eu_corridor" AS ENUM('IT', 'DE', 'FR', 'ES', 'NL', 'BE', 'PT', 'IE');--> statement-breakpoint
CREATE TYPE "public"."hnw_tier" AS ENUM('standard', 'premium', 'ultra');--> statement-breakpoint
CREATE TYPE "public"."id_doc_type" AS ENUM('ecowas_id', 'national_id', 'passport', 'drivers_license', 'nin_slip', 'voters_card');--> statement-breakpoint
CREATE TYPE "public"."kyc_tier_v2" AS ENUM('tier0', 'tier1', 'tier2', 'tier3');--> statement-breakpoint
CREATE TYPE "public"."trade_corridor" AS ENUM('CN', 'AE', 'IN', 'US', 'GB', 'DE', 'TR', 'BD');--> statement-breakpoint
CREATE TYPE "public"."trade_purpose" AS ENUM('goods_import', 'services_import', 'royalties', 'technical_fees', 'dividends', 'loan_repayment');--> statement-breakpoint
CREATE TYPE "public"."west_african_corridor" AS ENUM('GH', 'TG', 'NE', 'ML', 'BJ', 'CI', 'SN', 'BF');--> statement-breakpoint
CREATE TYPE "public"."xof_payout_method" AS ENUM('mobile_money', 'bank_account', 'cash_pickup', 'wallet');--> statement-breakpoint
CREATE TABLE "ach_payment_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"bank_name" varchar(200) NOT NULL,
	"routing_number" varchar(20) NOT NULL,
	"account_number_masked" varchar(20) NOT NULL,
	"account_type" varchar(20) NOT NULL,
	"plaid_account_id" varchar(200),
	"is_verified" boolean DEFAULT false,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_cashin_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"worker_id" integer NOT NULL,
	"amount_ngn" numeric(18, 2) NOT NULL,
	"destination_corridor" "west_african_corridor" NOT NULL,
	"payout_method" "xof_payout_method" NOT NULL,
	"beneficiary_mobile" varchar(20),
	"beneficiary_name" varchar(200),
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"agent_fee_ngn" numeric(10, 2),
	"tiger_beetle_debit_entry" bigint,
	"tiger_beetle_credit_entry" bigint,
	"mojaloop_transfer_id" varchar(200),
	"fluvio_offset" bigint,
	"reference" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "clearing_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"correspondent_bank_id" integer NOT NULL,
	"currency" varchar(10) NOT NULL,
	"limit_usd" numeric(18, 2) NOT NULL,
	"used_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"utilization_percent" numeric(5, 2),
	"alert_threshold_percent" integer DEFAULT 80 NOT NULL,
	"tiger_beetle_account_id" bigint,
	"redis_util_key" varchar(200),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correspondent_banks" (
	"id" serial PRIMARY KEY NOT NULL,
	"bank_name" varchar(200) NOT NULL,
	"swift_bic" varchar(20) NOT NULL,
	"country" varchar(5) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"nostro_account_number" varchar(50),
	"clearing_line_usd" numeric(18, 2),
	"used_line_usd" numeric(18, 2) DEFAULT '0',
	"settlement_cost_bps" integer DEFAULT 150 NOT NULL,
	"risk_score" "correspondent_risk" DEFAULT 'low' NOT NULL,
	"derisking_status" "derisking_status" DEFAULT 'active' NOT NULL,
	"last_review_date" timestamp,
	"next_review_date" timestamp,
	"open_search_doc_id" varchar(200),
	"tiger_beetle_account_id" bigint,
	"kafka_topic" varchar(200),
	"lakehouse_table_path" varchar(500),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "correspondent_banks_swift_bic_unique" UNIQUE("swift_bic")
);
--> statement-breakpoint
CREATE TABLE "correspondent_risk_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"correspondent_bank_id" integer NOT NULL,
	"score_date" timestamp DEFAULT now() NOT NULL,
	"overall_score" numeric(5, 4) NOT NULL,
	"aml_score" numeric(5, 4),
	"sanctions_score" numeric(5, 4),
	"financial_health_score" numeric(5, 4),
	"geopolitical_score" numeric(5, 4),
	"python_model_version" varchar(50),
	"open_search_doc_id" varchar(200),
	"lakehouse_row_id" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "derisking_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"correspondent_bank_id" integer NOT NULL,
	"alert_type" varchar(50) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"title" varchar(300) NOT NULL,
	"description" text,
	"is_acknowledged" boolean DEFAULT false,
	"acknowledged_by" integer,
	"acknowledged_at" timestamp,
	"kafka_event_id" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diaspora_canada_profiles" (
	"user_id" integer NOT NULL,
	"province" varchar(5),
	"interac_email" varchar(200),
	"interac_phone" varchar(30),
	"fintrac_reporting_ref" varchar(100),
	"keycloak_role_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "diaspora_canada_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "diaspora_eu_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"country" "eu_corridor" NOT NULL,
	"sepa_iban" varchar(50),
	"sepa_bic" varchar(20),
	"sepa_account_name" varchar(200),
	"psd2_consent_id" varchar(200),
	"psd2_consent_expiry" timestamp,
	"eba_compliance_ref" varchar(100),
	"keycloak_role_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "diaspora_eu_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "diaspora_usa_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "diaspora_usa_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "ecowas_compliance_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" integer,
	"user_id" integer NOT NULL,
	"corridor_code" "west_african_corridor" NOT NULL,
	"amount_ngn" numeric(18, 2) NOT NULL,
	"check_type" varchar(50) NOT NULL,
	"result" varchar(20) NOT NULL,
	"risk_score" numeric(5, 4),
	"details" jsonb,
	"open_search_doc_id" varchar(200),
	"tiger_beetle_entry_id" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_m_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"trade_payment_id" integer,
	"form_type" varchar(10) NOT NULL,
	"form_number" varchar(50),
	"document_url" varchar(500),
	"cbn_portal_ref" varchar(100),
	"validity_date" timestamp,
	"python_validation_result" jsonb,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hnw_fx_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"hnw_profile_id" integer NOT NULL,
	"currency_pair" varchar(10) NOT NULL,
	"base_rate" numeric(18, 8) NOT NULL,
	"negotiated_rate" numeric(18, 8) NOT NULL,
	"spread_bps" integer NOT NULL,
	"valid_from" timestamp NOT NULL,
	"valid_until" timestamp NOT NULL,
	"rust_engine_quote_id" varchar(200),
	"redis_rate_key" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hnw_portfolios" (
	"id" serial PRIMARY KEY NOT NULL,
	"hnw_profile_id" integer NOT NULL,
	"asset_class" varchar(50) NOT NULL,
	"asset_name" varchar(200) NOT NULL,
	"current_value_usd" numeric(18, 2) NOT NULL,
	"allocation_percent" numeric(5, 2),
	"yield_percent" numeric(5, 4),
	"open_search_doc_id" varchar(200),
	"tiger_beetle_account_id" bigint,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hnw_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tier" "hnw_tier" DEFAULT 'standard' NOT NULL,
	"annual_transfer_volume_usd" numeric(18, 2),
	"assigned_rm_id" integer,
	"negotiated_fx_spread_bps" integer DEFAULT 150,
	"priority_swift_enabled" boolean DEFAULT false,
	"dedicated_iban_enabled" boolean DEFAULT false,
	"keycloak_role_id" varchar(100),
	"permify_subject_id" varchar(100),
	"onboarded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hnw_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "hnw_relationship_managers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"email" varchar(200) NOT NULL,
	"phone" varchar(30),
	"calendar_url" varchar(500),
	"max_clients" integer DEFAULT 25 NOT NULL,
	"current_clients" integer DEFAULT 0 NOT NULL,
	"specialisations" text[],
	"dapr_actor_id" varchar(200),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hnw_relationship_managers_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "immigrant_worker_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"nationality_code" varchar(5) NOT NULL,
	"preferred_language" varchar(10) DEFAULT 'en',
	"employer_name" varchar(200),
	"employer_address" text,
	"work_permit_number" varchar(50),
	"work_permit_expiry" timestamp,
	"kyc_tier" "kyc_tier_v2" DEFAULT 'tier0' NOT NULL,
	"daily_limit_ngn" integer DEFAULT 50000 NOT NULL,
	"monthly_limit_ngn" integer DEFAULT 200000 NOT NULL,
	"keycloak_role_id" varchar(100),
	"permify_subject_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interac_payment_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"interac_email" varchar(200),
	"interac_phone" varchar(30),
	"bank_name" varchar(200),
	"transit_number" varchar(10),
	"institution_number" varchar(5),
	"account_number_masked" varchar(20),
	"is_verified" boolean DEFAULT false,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sepa_payment_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"iban" varchar(50) NOT NULL,
	"bic" varchar(20),
	"account_name" varchar(200) NOT NULL,
	"bank_name" varchar(200),
	"country" "eu_corridor" NOT NULL,
	"is_verified" boolean DEFAULT false,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sme_trade_bulk_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"batch_reference" varchar(100) NOT NULL,
	"total_payments" integer NOT NULL,
	"total_amount_ngn" numeric(18, 2) NOT NULL,
	"csv_file_url" varchar(500),
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"validation_errors" jsonb,
	"rust_processor_job_id" varchar(200),
	"temporal_workflow_id" varchar(200),
	"kafka_batch_id" varchar(200),
	"tiger_beetle_batch_id" varchar(200),
	"lakehouse_batch_path" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "sme_trade_bulk_batches_batch_reference_unique" UNIQUE("batch_reference")
);
--> statement-breakpoint
CREATE TABLE "sme_trade_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer,
	"user_id" integer NOT NULL,
	"corridor" "trade_corridor" NOT NULL,
	"purpose" "trade_purpose" NOT NULL,
	"amount_ngn" numeric(18, 2) NOT NULL,
	"amount_foreign" numeric(18, 2) NOT NULL,
	"foreign_currency" varchar(10) NOT NULL,
	"fx_rate" numeric(18, 8) NOT NULL,
	"beneficiary_name" varchar(200) NOT NULL,
	"beneficiary_bank" varchar(200),
	"beneficiary_swift" varchar(20),
	"beneficiary_account" varchar(50),
	"form_m_number" varchar(50),
	"form_a_number" varchar(50),
	"cbn_approval_ref" varchar(100),
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"swift_mt103_ref" varchar(100),
	"tiger_beetle_entry_id" bigint,
	"open_search_doc_id" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tiered_kyc_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_token" varchar(200) NOT NULL,
	"target_tier" "kyc_tier_v2" NOT NULL,
	"id_doc_type" "id_doc_type",
	"id_doc_number" varchar(100),
	"id_doc_front_url" varchar(500),
	"id_doc_back_url" varchar(500),
	"selfie_url" varchar(500),
	"liveness_score" numeric(5, 4),
	"ocr_data" jsonb,
	"rust_kyc_service_result" jsonb,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"redis_session_key" varchar(200),
	"temporal_workflow_id" varchar(200),
	"kafka_event_id" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "tiered_kyc_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "us_compliance_disclosures" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"disclosure_version" varchar(20) NOT NULL,
	"disclosure_type" varchar(50) NOT NULL,
	"accepted_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" varchar(50),
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "west_african_corridors" (
	"id" serial PRIMARY KEY NOT NULL,
	"corridor_code" "west_african_corridor" NOT NULL,
	"country_name" varchar(100) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"fx_rate_ngn" numeric(18, 6) NOT NULL,
	"fx_rate_updated_at" timestamp DEFAULT now() NOT NULL,
	"cbdc_enabled" boolean DEFAULT false,
	"mojaloop_enabled" boolean DEFAULT false,
	"min_transfer_ngn" integer DEFAULT 5000 NOT NULL,
	"max_transfer_ngn" integer DEFAULT 5000000 NOT NULL,
	"fee_percent" numeric(5, 4) DEFAULT '0.0150' NOT NULL,
	"settlement_hours" integer DEFAULT 24 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"kafka_topic" varchar(200),
	"dapr_app_id" varchar(100),
	"mojaloop_fsp_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xof_payout_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"corridor_code" "west_african_corridor" NOT NULL,
	"payout_method" "xof_payout_method" NOT NULL,
	"account_name" varchar(200) NOT NULL,
	"account_number" varchar(50),
	"mobile_number" varchar(20),
	"mobile_provider" varchar(50),
	"bank_code" varchar(20),
	"bank_name" varchar(100),
	"is_verified" boolean DEFAULT false,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ach_payment_methods" ADD CONSTRAINT "ach_payment_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_cashin_transactions" ADD CONSTRAINT "agent_cashin_transactions_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_cashin_transactions" ADD CONSTRAINT "agent_cashin_transactions_worker_id_users_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearing_lines" ADD CONSTRAINT "clearing_lines_correspondent_bank_id_correspondent_banks_id_fk" FOREIGN KEY ("correspondent_bank_id") REFERENCES "public"."correspondent_banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correspondent_risk_scores" ADD CONSTRAINT "correspondent_risk_scores_correspondent_bank_id_correspondent_banks_id_fk" FOREIGN KEY ("correspondent_bank_id") REFERENCES "public"."correspondent_banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derisking_alerts" ADD CONSTRAINT "derisking_alerts_correspondent_bank_id_correspondent_banks_id_fk" FOREIGN KEY ("correspondent_bank_id") REFERENCES "public"."correspondent_banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derisking_alerts" ADD CONSTRAINT "derisking_alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaspora_canada_profiles" ADD CONSTRAINT "diaspora_canada_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaspora_eu_profiles" ADD CONSTRAINT "diaspora_eu_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diaspora_usa_profiles" ADD CONSTRAINT "diaspora_usa_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecowas_compliance_checks" ADD CONSTRAINT "ecowas_compliance_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_m_documents" ADD CONSTRAINT "form_m_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_m_documents" ADD CONSTRAINT "form_m_documents_trade_payment_id_sme_trade_payments_id_fk" FOREIGN KEY ("trade_payment_id") REFERENCES "public"."sme_trade_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hnw_fx_rates" ADD CONSTRAINT "hnw_fx_rates_hnw_profile_id_hnw_profiles_id_fk" FOREIGN KEY ("hnw_profile_id") REFERENCES "public"."hnw_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hnw_portfolios" ADD CONSTRAINT "hnw_portfolios_hnw_profile_id_hnw_profiles_id_fk" FOREIGN KEY ("hnw_profile_id") REFERENCES "public"."hnw_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hnw_profiles" ADD CONSTRAINT "hnw_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hnw_profiles" ADD CONSTRAINT "hnw_profiles_assigned_rm_id_users_id_fk" FOREIGN KEY ("assigned_rm_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hnw_relationship_managers" ADD CONSTRAINT "hnw_relationship_managers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "immigrant_worker_profiles" ADD CONSTRAINT "immigrant_worker_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interac_payment_methods" ADD CONSTRAINT "interac_payment_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_payment_methods" ADD CONSTRAINT "sepa_payment_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sme_trade_bulk_batches" ADD CONSTRAINT "sme_trade_bulk_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sme_trade_payments" ADD CONSTRAINT "sme_trade_payments_batch_id_sme_trade_bulk_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."sme_trade_bulk_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sme_trade_payments" ADD CONSTRAINT "sme_trade_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiered_kyc_sessions" ADD CONSTRAINT "tiered_kyc_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "us_compliance_disclosures" ADD CONSTRAINT "us_compliance_disclosures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xof_payout_accounts" ADD CONSTRAINT "xof_payout_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;