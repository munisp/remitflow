CREATE TYPE "public"."business_savings_status" AS ENUM('active', 'matured', 'withdrawn', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."business_savings_type" AS ENUM('instant_access', 'notice_30_day', 'fixed_30', 'fixed_90', 'fixed_180', 'fixed_365');--> statement-breakpoint
CREATE TYPE "public"."contractor_invoice_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."contractor_status" AS ENUM('active', 'inactive', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."credit_application_status" AS ENUM('draft', 'submitted', 'scoring', 'approved', 'rejected', 'disbursed', 'repaid', 'defaulted');--> statement-breakpoint
CREATE TYPE "public"."credit_score_status" AS ENUM('pending', 'calculated', 'expired', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."embedded_payroll_api_key_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."entity_group_status" AS ENUM('active', 'suspended', 'dissolved');--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM('travel', 'accommodation', 'meals', 'equipment', 'software', 'marketing', 'professional_services', 'utilities', 'office_supplies', 'training', 'other');--> statement-breakpoint
CREATE TYPE "public"."expense_policy_action" AS ENUM('auto_approve', 'require_review', 'reject');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('draft', 'submitted', 'under_review', 'approved', 'rejected', 'reimbursed');--> statement-breakpoint
CREATE TYPE "public"."intercompany_transfer_status" AS ENUM('pending', 'approved', 'processing', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."invoice_financing_status" AS ENUM('draft', 'submitted', 'under_review', 'approved', 'funded', 'repaying', 'repaid', 'defaulted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."lc_status" AS ENUM('draft', 'submitted', 'issued', 'advised', 'documents_presented', 'documents_checked', 'payment_authorised', 'settled', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lc_type" AS ENUM('sight', 'usance', 'standby', 'revolving');--> statement-breakpoint
CREATE TYPE "public"."merchant_kyb_status" AS ENUM('pending', 'documents_requested', 'under_review', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."mortgage_status" AS ENUM('enquiry', 'application', 'under_review', 'conditionally_approved', 'approved', 'offer_issued', 'completed', 'active', 'defaulted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."mortgage_type" AS ENUM('purchase', 'remortgage', 'equity_release', 'buy_to_let', 'diaspora_home_build');--> statement-breakpoint
CREATE TYPE "public"."tax_authority" AS ENUM('FIRS', 'HMRC', 'IRS', 'KRA', 'GRA', 'SARS', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."tax_filing_status" AS ENUM('draft', 'calculated', 'submitted', 'acknowledged', 'accepted', 'rejected', 'amended');--> statement-breakpoint
CREATE TABLE "business_credit_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"score" integer NOT NULL,
	"grade" varchar(5) NOT NULL,
	"transaction_volume" numeric(18, 2),
	"avg_monthly_volume" numeric(18, 2),
	"payroll_consistency" numeric(5, 2),
	"kyb_score" integer,
	"payment_history" numeric(5, 2),
	"utilization_ratio" numeric(5, 2),
	"account_age" integer,
	"max_credit_limit_usd" numeric(18, 2),
	"status" "credit_score_status" DEFAULT 'pending',
	"calculated_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_savings_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"owner_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"principal_usd" numeric(18, 2) NOT NULL,
	"current_balance_usd" numeric(18, 2) NOT NULL,
	"accrued_interest_usd" numeric(18, 2) DEFAULT '0',
	"start_date" timestamp NOT NULL,
	"maturity_date" timestamp,
	"last_interest_date" timestamp,
	"status" "business_savings_status" DEFAULT 'active',
	"auto_renew" boolean DEFAULT false,
	"withdrawn_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_savings_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"type" "business_savings_type" NOT NULL,
	"currency" varchar(8) DEFAULT 'USD',
	"annual_rate_pct" numeric(5, 2) NOT NULL,
	"min_deposit_usd" numeric(18, 2) DEFAULT '1000',
	"max_deposit_usd" numeric(18, 2) DEFAULT '10000000',
	"term_days" integer,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_savings_txns" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"type" varchar(30) NOT NULL,
	"amount_usd" numeric(18, 2) NOT NULL,
	"balance_after" numeric(18, 2) NOT NULL,
	"description" varchar(300),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carbon_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"credit_type" varchar(50) DEFAULT 'VCS',
	"vintage_year" integer,
	"quantity_tonnes" numeric(10, 3) NOT NULL,
	"price_per_tonne_usd" numeric(10, 2),
	"total_value_usd" numeric(18, 2),
	"registry_id" varchar(100),
	"project_name" varchar(300),
	"project_country" varchar(4),
	"status" varchar(20) DEFAULT 'active',
	"retired_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractor_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"contractor_id" integer NOT NULL,
	"owner_id" integer NOT NULL,
	"invoice_number" varchar(50) NOT NULL,
	"description" text NOT NULL,
	"line_items" json DEFAULT '[]'::json,
	"subtotal_usd" numeric(18, 2) NOT NULL,
	"tax_amount_usd" numeric(18, 2) DEFAULT '0',
	"total_usd" numeric(18, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"due_date" timestamp,
	"paid_at" timestamp,
	"status" "contractor_invoice_status" DEFAULT 'draft',
	"rejection_reason" text,
	"payment_ref" varchar(100),
	"attachment_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contractor_invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "contractors" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"company_id" integer,
	"full_name" varchar(200) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(30),
	"country" varchar(4) NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"bank_name" varchar(200),
	"bank_account" varchar(100),
	"bank_routing_code" varchar(50),
	"tax_id" varchar(100),
	"specialty" varchar(200),
	"hourly_rate_usd" numeric(10, 2),
	"status" "contractor_status" DEFAULT 'active',
	"kyc_verified" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"applicant_id" integer NOT NULL,
	"credit_score_id" integer,
	"requested_usd" numeric(18, 2) NOT NULL,
	"approved_usd" numeric(18, 2),
	"interest_rate_pct" numeric(5, 2),
	"term_months" integer,
	"purpose" varchar(300),
	"status" "credit_application_status" DEFAULT 'draft',
	"disbursed_at" timestamp,
	"repaid_at" timestamp,
	"rejection_reason" text,
	"reviewed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embedded_payroll_api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"key_hash" varchar(128) NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"label" varchar(200),
	"environment" varchar(10) DEFAULT 'sandbox',
	"status" "embedded_payroll_api_key_status" DEFAULT 'active',
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "embedded_payroll_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "embedded_payroll_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"api_key_id" integer NOT NULL,
	"external_run_id" varchar(100),
	"company_name" varchar(200) NOT NULL,
	"employee_count" integer NOT NULL,
	"total_amount_usd" numeric(18, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'USD',
	"payload_hash" varchar(128),
	"status" varchar(30) DEFAULT 'received',
	"processed_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_group_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"role" varchar(50) DEFAULT 'subsidiary',
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"name" varchar(300) NOT NULL,
	"description" text,
	"base_currency" varchar(8) DEFAULT 'USD',
	"status" "entity_group_status" DEFAULT 'active',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esg_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"reporting_period" varchar(20) NOT NULL,
	"total_remittance_usd" numeric(18, 2),
	"co2_offset_kg" numeric(18, 2),
	"financial_inclusion_count" integer,
	"women_beneficiaries" integer,
	"rural_reach" integer,
	"jobs_supported" integer,
	"sdg_goals" json DEFAULT '[]'::json,
	"carbon_cert_url" text,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"category" "expense_category" NOT NULL,
	"description" varchar(500) NOT NULL,
	"amount_usd" numeric(10, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'USD',
	"expense_date" timestamp NOT NULL,
	"receipt_url" text,
	"merchant_name" varchar(200),
	"policy_id" integer,
	"auto_approved" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"category" "expense_category" NOT NULL,
	"max_amount_usd" numeric(10, 2) NOT NULL,
	"requires_receipt" boolean DEFAULT true,
	"action" "expense_policy_action" DEFAULT 'require_review',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"submitted_by" integer NOT NULL,
	"approved_by" integer,
	"title" varchar(300) NOT NULL,
	"description" text,
	"total_amount_usd" numeric(18, 2) DEFAULT '0',
	"currency" varchar(8) DEFAULT 'USD',
	"status" "expense_status" DEFAULT 'draft',
	"rejection_reason" text,
	"reimbursed_at" timestamp,
	"payment_ref" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intercompany_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"from_company_id" integer NOT NULL,
	"to_company_id" integer NOT NULL,
	"amount_usd" numeric(18, 2) NOT NULL,
	"from_currency" varchar(8) NOT NULL,
	"to_currency" varchar(8) NOT NULL,
	"fx_rate" numeric(18, 8),
	"purpose" varchar(300),
	"status" "intercompany_transfer_status" DEFAULT 'pending',
	"approved_by" integer,
	"approved_at" timestamp,
	"completed_at" timestamp,
	"payment_ref" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_financing_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"applicant_id" integer NOT NULL,
	"invoice_number" varchar(100) NOT NULL,
	"debtor_name" varchar(300) NOT NULL,
	"debtor_country" varchar(4),
	"invoice_amount_usd" numeric(18, 2) NOT NULL,
	"advance_rate_pct" numeric(5, 2) DEFAULT '80',
	"advance_amount_usd" numeric(18, 2),
	"fee_rate_pct" numeric(5, 2) DEFAULT '2.5',
	"fee_amount_usd" numeric(18, 2),
	"invoice_due_date" timestamp NOT NULL,
	"invoice_doc_url" text,
	"contract_doc_url" text,
	"status" "invoice_financing_status" DEFAULT 'draft',
	"funded_at" timestamp,
	"repaid_at" timestamp,
	"reviewed_by" integer,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_financing_repayments" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"amount_usd" numeric(18, 2) NOT NULL,
	"payment_ref" varchar(100),
	"paid_at" timestamp DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "lc_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"lc_id" integer NOT NULL,
	"document_type" varchar(100) NOT NULL,
	"document_url" text NOT NULL,
	"uploaded_by" integer NOT NULL,
	"verified" boolean DEFAULT false,
	"verified_by" integer,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "letters_of_credit" (
	"id" serial PRIMARY KEY NOT NULL,
	"applicant_id" integer NOT NULL,
	"lc_number" varchar(50) NOT NULL,
	"lc_type" "lc_type" DEFAULT 'sight',
	"beneficiary_name" varchar(300) NOT NULL,
	"beneficiary_country" varchar(4) NOT NULL,
	"beneficiary_bank" varchar(300),
	"issuing_bank" varchar(300) DEFAULT 'RemitFlow Trade Finance',
	"amount_usd" numeric(18, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'USD',
	"goods_description" text NOT NULL,
	"shipment_port" varchar(200),
	"destination_port" varchar(200),
	"latest_ship_date" timestamp,
	"expiry_date" timestamp NOT NULL,
	"incoterms" varchar(20) DEFAULT 'CIF',
	"documents_required" json DEFAULT '[]'::json,
	"status" "lc_status" DEFAULT 'draft',
	"issued_at" timestamp,
	"settled_at" timestamp,
	"collateral_pct" numeric(5, 2) DEFAULT '10',
	"fee_amount_usd" numeric(18, 2),
	"reviewed_by" integer,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "letters_of_credit_lc_number_unique" UNIQUE("lc_number")
);
--> statement-breakpoint
CREATE TABLE "merchant_kyb_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"business_name" varchar(300) NOT NULL,
	"registration_number" varchar(100),
	"tax_id" varchar(100),
	"country" varchar(4) NOT NULL,
	"industry" varchar(100),
	"website" varchar(300),
	"expected_monthly_vol" numeric(18, 2),
	"business_reg_doc_url" text,
	"director_id_doc_url" text,
	"bank_statement_doc_url" text,
	"aml_policy_doc_url" text,
	"status" "merchant_kyb_status" DEFAULT 'pending',
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"rejection_reason" text,
	"risk_rating" varchar(20) DEFAULT 'medium',
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mortgage_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"applicant_id" integer NOT NULL,
	"mortgage_type" "mortgage_type" DEFAULT 'purchase',
	"property_country" varchar(4) NOT NULL,
	"property_address" text,
	"property_value_usd" numeric(18, 2) NOT NULL,
	"loan_amount_usd" numeric(18, 2) NOT NULL,
	"deposit_amount_usd" numeric(18, 2) NOT NULL,
	"ltv_pct" numeric(5, 2),
	"term_years" integer NOT NULL,
	"interest_rate_pct" numeric(5, 2),
	"monthly_payment_usd" numeric(18, 2),
	"applicant_country" varchar(4),
	"annual_income_usd" numeric(18, 2),
	"employment_status" varchar(50),
	"credit_score" integer,
	"status" "mortgage_status" DEFAULT 'enquiry',
	"assigned_advisor_id" integer,
	"offer_expires_at" timestamp,
	"completed_at" timestamp,
	"rejection_reason" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mortgage_repayments" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"due_date" timestamp NOT NULL,
	"paid_date" timestamp,
	"principal_usd" numeric(18, 2) NOT NULL,
	"interest_usd" numeric(18, 2) NOT NULL,
	"total_usd" numeric(18, 2) NOT NULL,
	"balance_after_usd" numeric(18, 2),
	"status" varchar(20) DEFAULT 'pending',
	"payment_ref" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_tax_filings" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"payroll_run_id" integer,
	"tax_authority" "tax_authority" NOT NULL,
	"jurisdiction" varchar(4) NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"total_gross_usd" numeric(18, 2) NOT NULL,
	"total_tax_usd" numeric(18, 2) NOT NULL,
	"total_pension_usd" numeric(18, 2) DEFAULT '0',
	"employee_count" integer NOT NULL,
	"filing_reference" varchar(100),
	"submitted_at" timestamp,
	"acknowledged_at" timestamp,
	"status" "tax_filing_status" DEFAULT 'draft',
	"filing_doc_url" text,
	"receipt_url" text,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_credit_scores" ADD CONSTRAINT "business_credit_scores_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."payroll_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_savings_accounts" ADD CONSTRAINT "business_savings_accounts_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."payroll_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_savings_accounts" ADD CONSTRAINT "business_savings_accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_savings_accounts" ADD CONSTRAINT "business_savings_accounts_product_id_business_savings_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."business_savings_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_savings_txns" ADD CONSTRAINT "business_savings_txns_account_id_business_savings_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."business_savings_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carbon_credits" ADD CONSTRAINT "carbon_credits_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_invoices" ADD CONSTRAINT "contractor_invoices_contractor_id_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_invoices" ADD CONSTRAINT "contractor_invoices_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."payroll_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."payroll_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_credit_score_id_business_credit_scores_id_fk" FOREIGN KEY ("credit_score_id") REFERENCES "public"."business_credit_scores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedded_payroll_api_keys" ADD CONSTRAINT "embedded_payroll_api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedded_payroll_requests" ADD CONSTRAINT "embedded_payroll_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedded_payroll_requests" ADD CONSTRAINT "embedded_payroll_requests_api_key_id_embedded_payroll_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."embedded_payroll_api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_group_members" ADD CONSTRAINT "entity_group_members_group_id_entity_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."entity_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_group_members" ADD CONSTRAINT "entity_group_members_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."payroll_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_groups" ADD CONSTRAINT "entity_groups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esg_reports" ADD CONSTRAINT "esg_reports_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_report_id_expense_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."expense_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_policy_id_expense_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."expense_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_policies" ADD CONSTRAINT "expense_policies_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."payroll_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."payroll_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_transfers" ADD CONSTRAINT "intercompany_transfers_group_id_entity_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."entity_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_transfers" ADD CONSTRAINT "intercompany_transfers_from_company_id_payroll_companies_id_fk" FOREIGN KEY ("from_company_id") REFERENCES "public"."payroll_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_transfers" ADD CONSTRAINT "intercompany_transfers_to_company_id_payroll_companies_id_fk" FOREIGN KEY ("to_company_id") REFERENCES "public"."payroll_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_transfers" ADD CONSTRAINT "intercompany_transfers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_financing_applications" ADD CONSTRAINT "invoice_financing_applications_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_financing_applications" ADD CONSTRAINT "invoice_financing_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_financing_repayments" ADD CONSTRAINT "invoice_financing_repayments_application_id_invoice_financing_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."invoice_financing_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lc_documents" ADD CONSTRAINT "lc_documents_lc_id_letters_of_credit_id_fk" FOREIGN KEY ("lc_id") REFERENCES "public"."letters_of_credit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lc_documents" ADD CONSTRAINT "lc_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lc_documents" ADD CONSTRAINT "lc_documents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters_of_credit" ADD CONSTRAINT "letters_of_credit_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters_of_credit" ADD CONSTRAINT "letters_of_credit_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_kyb_reviews" ADD CONSTRAINT "merchant_kyb_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_kyb_reviews" ADD CONSTRAINT "merchant_kyb_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortgage_applications" ADD CONSTRAINT "mortgage_applications_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortgage_applications" ADD CONSTRAINT "mortgage_applications_assigned_advisor_id_users_id_fk" FOREIGN KEY ("assigned_advisor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mortgage_repayments" ADD CONSTRAINT "mortgage_repayments_application_id_mortgage_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."mortgage_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_tax_filings" ADD CONSTRAINT "payroll_tax_filings_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."payroll_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_tax_filings" ADD CONSTRAINT "payroll_tax_filings_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;