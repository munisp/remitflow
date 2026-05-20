CREATE TYPE "public"."bond_coupon_freq" AS ENUM('monthly', 'quarterly', 'semi_annual', 'annual');--> statement-breakpoint
CREATE TYPE "public"."bond_status" AS ENUM('upcoming', 'open', 'closed', 'matured', 'defaulted');--> statement-breakpoint
CREATE TYPE "public"."bond_type" AS ENUM('fgn_diaspora', 'eurobond', 'corporate', 'sukuk', 'green_bond', 'infrastructure');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'contractor', 'intern');--> statement-breakpoint
CREATE TYPE "public"."payroll_company_status" AS ENUM('active', 'suspended', 'pending_kyb');--> statement-breakpoint
CREATE TYPE "public"."payroll_frequency" AS ENUM('weekly', 'bi_weekly', 'semi_monthly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."payroll_item_status" AS ENUM('pending', 'processing', 'paid', 'failed', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."payroll_jurisdiction" AS ENUM('NG', 'GB', 'US', 'CA', 'DE', 'FR', 'IT', 'AE', 'GH', 'KE', 'ZA');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_status" AS ENUM('draft', 'pending_approval', 'approved', 'processing', 'disbursed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sm_order_status" AS ENUM('open', 'matched', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."sm_order_type" AS ENUM('sell', 'buy');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('pending_payment', 'active', 'matured', 'sold', 'cancelled');--> statement-breakpoint
CREATE TABLE "bond_coupon_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"bond_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"coupon_number" integer NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"scheduled_date" timestamp NOT NULL,
	"paid_date" timestamp,
	"gross_amount" numeric(18, 2) NOT NULL,
	"withholding_tax" numeric(18, 2) DEFAULT '0',
	"net_amount" numeric(18, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'USD',
	"status" varchar(20) DEFAULT 'scheduled',
	"transaction_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bond_secondary_market_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"seller_id" integer NOT NULL,
	"buyer_id" integer,
	"bond_id" integer NOT NULL,
	"order_type" "sm_order_type" DEFAULT 'sell',
	"units" integer NOT NULL,
	"ask_price" numeric(18, 2) NOT NULL,
	"bid_price" numeric(18, 2),
	"matched_price" numeric(18, 2),
	"total_value" numeric(18, 2),
	"currency" varchar(8) DEFAULT 'USD',
	"status" "sm_order_status" DEFAULT 'open',
	"expires_at" timestamp,
	"matched_at" timestamp,
	"settlement_tx_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bond_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"bond_id" integer NOT NULL,
	"subscription_ref" varchar(80) NOT NULL,
	"units" integer NOT NULL,
	"face_value" numeric(18, 2) NOT NULL,
	"purchase_price" numeric(18, 2) NOT NULL,
	"total_paid" numeric(18, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'USD',
	"status" "subscription_status" DEFAULT 'pending_payment',
	"transaction_id" integer,
	"total_coupons_received" numeric(18, 2) DEFAULT '0',
	"maturity_proceeds" numeric(18, 2),
	"accrued_interest" numeric(18, 2) DEFAULT '0',
	"current_value" numeric(18, 2),
	"yield_at_purchase" numeric(6, 4),
	"purchased_at" timestamp DEFAULT now() NOT NULL,
	"matured_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bond_subscriptions_subscription_ref_unique" UNIQUE("subscription_ref")
);
--> statement-breakpoint
CREATE TABLE "diaspora_bonds" (
	"id" serial PRIMARY KEY NOT NULL,
	"isin" varchar(20),
	"name" varchar(300) NOT NULL,
	"issuer" varchar(200) NOT NULL,
	"bond_type" "bond_type" NOT NULL,
	"currency" varchar(8) DEFAULT 'USD',
	"face_value" numeric(18, 2) NOT NULL,
	"min_subscription" numeric(18, 2) DEFAULT '500',
	"max_subscription" numeric(18, 2),
	"coupon_rate" numeric(6, 4) NOT NULL,
	"coupon_frequency" "bond_coupon_freq" DEFAULT 'semi_annual',
	"issue_date" timestamp NOT NULL,
	"maturity_date" timestamp NOT NULL,
	"offer_open_date" timestamp NOT NULL,
	"offer_close_date" timestamp NOT NULL,
	"target_raise" numeric(18, 2),
	"raised_amount" numeric(18, 2) DEFAULT '0',
	"total_units" integer,
	"available_units" integer,
	"status" "bond_status" DEFAULT 'upcoming',
	"rating_agency" varchar(50),
	"credit_rating" varchar(10),
	"prospectus_url" text,
	"image_url" text,
	"description" text,
	"eligible_countries" json DEFAULT '[]'::json,
	"is_tax_exempt" boolean DEFAULT false,
	"yield_to_maturity" numeric(6, 4),
	"duration" numeric(8, 4),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "diaspora_bonds_isin_unique" UNIQUE("isin")
);
--> statement-breakpoint
CREATE TABLE "payroll_companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"registration_number" varchar(100),
	"tax_id" varchar(100),
	"country" varchar(4) NOT NULL,
	"base_currency" varchar(8) DEFAULT 'USD',
	"status" "payroll_company_status" DEFAULT 'active',
	"logo_url" text,
	"total_employees" integer DEFAULT 0,
	"monthly_payroll_usd" numeric(18, 2) DEFAULT '0',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_disbursements" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"batch_reference" varchar(80) NOT NULL,
	"rail" varchar(30) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"item_count" integer DEFAULT 0,
	"status" varchar(20) DEFAULT 'pending',
	"external_ref" varchar(200),
	"sent_at" timestamp,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"user_id" integer,
	"employee_code" varchar(50) NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"email" varchar(200) NOT NULL,
	"phone" varchar(30),
	"job_title" varchar(150),
	"department" varchar(100),
	"employment_type" "employment_type" DEFAULT 'full_time',
	"jurisdiction" "payroll_jurisdiction" NOT NULL,
	"country" varchar(4) NOT NULL,
	"gross_salary" numeric(18, 2) NOT NULL,
	"salary_currency" varchar(8) DEFAULT 'USD',
	"bank_name" varchar(150),
	"bank_account" varchar(100),
	"bank_routing_code" varchar(50),
	"mobile_money_num" varchar(30),
	"preferred_channel" varchar(20) DEFAULT 'bank',
	"tax_code" varchar(50),
	"national_id" varchar(100),
	"start_date" timestamp,
	"end_date" timestamp,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_run_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"gross_salary" numeric(18, 2) NOT NULL,
	"gross_currency" varchar(8) NOT NULL,
	"gross_usd" numeric(18, 2) NOT NULL,
	"fx_rate" numeric(18, 8) DEFAULT '1',
	"income_tax" numeric(18, 2) DEFAULT '0',
	"social_security" numeric(18, 2) DEFAULT '0',
	"pension" numeric(18, 2) DEFAULT '0',
	"nhf" numeric(18, 2) DEFAULT '0',
	"nhis" numeric(18, 2) DEFAULT '0',
	"other_deductions" numeric(18, 2) DEFAULT '0',
	"total_deductions" numeric(18, 2) DEFAULT '0',
	"net_pay" numeric(18, 2) NOT NULL,
	"net_currency" varchar(8) NOT NULL,
	"net_usd" numeric(18, 2) NOT NULL,
	"remit_fee" numeric(18, 2) DEFAULT '0',
	"status" "payroll_item_status" DEFAULT 'pending',
	"transaction_id" integer,
	"disbursed_at" timestamp,
	"failure_reason" text,
	"tax_breakdown" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"run_reference" varchar(80) NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"pay_date" timestamp NOT NULL,
	"frequency" "payroll_frequency" NOT NULL,
	"status" "payroll_run_status" DEFAULT 'draft',
	"total_gross_usd" numeric(18, 2) DEFAULT '0',
	"total_tax_usd" numeric(18, 2) DEFAULT '0',
	"total_deduct_usd" numeric(18, 2) DEFAULT '0',
	"total_net_usd" numeric(18, 2) DEFAULT '0',
	"total_fee_usd" numeric(18, 2) DEFAULT '0',
	"employee_count" integer DEFAULT 0,
	"approved_by_user_id" integer,
	"approved_at" timestamp,
	"disbursed_at" timestamp,
	"notes" text,
	"engine_response" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_run_reference_unique" UNIQUE("run_reference")
);
--> statement-breakpoint
CREATE TABLE "payroll_tax_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"jurisdiction" "payroll_jurisdiction" NOT NULL,
	"tax_year" integer NOT NULL,
	"brackets" json NOT NULL,
	"social_security_rate" numeric(6, 4) DEFAULT '0',
	"medicare_rate" numeric(6, 4) DEFAULT '0',
	"pension_employee_rate" numeric(6, 4) DEFAULT '0',
	"pension_employer_rate" numeric(6, 4) DEFAULT '0',
	"nhf_rate" numeric(6, 4) DEFAULT '0',
	"nhis_rate" numeric(6, 4) DEFAULT '0',
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bond_coupon_payments" ADD CONSTRAINT "bond_coupon_payments_subscription_id_bond_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."bond_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_coupon_payments" ADD CONSTRAINT "bond_coupon_payments_bond_id_diaspora_bonds_id_fk" FOREIGN KEY ("bond_id") REFERENCES "public"."diaspora_bonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_coupon_payments" ADD CONSTRAINT "bond_coupon_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_coupon_payments" ADD CONSTRAINT "bond_coupon_payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_secondary_market_orders" ADD CONSTRAINT "bond_secondary_market_orders_subscription_id_bond_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."bond_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_secondary_market_orders" ADD CONSTRAINT "bond_secondary_market_orders_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_secondary_market_orders" ADD CONSTRAINT "bond_secondary_market_orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_secondary_market_orders" ADD CONSTRAINT "bond_secondary_market_orders_bond_id_diaspora_bonds_id_fk" FOREIGN KEY ("bond_id") REFERENCES "public"."diaspora_bonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_secondary_market_orders" ADD CONSTRAINT "bond_secondary_market_orders_settlement_tx_id_transactions_id_fk" FOREIGN KEY ("settlement_tx_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_subscriptions" ADD CONSTRAINT "bond_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_subscriptions" ADD CONSTRAINT "bond_subscriptions_bond_id_diaspora_bonds_id_fk" FOREIGN KEY ("bond_id") REFERENCES "public"."diaspora_bonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_subscriptions" ADD CONSTRAINT "bond_subscriptions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_companies" ADD CONSTRAINT "payroll_companies_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_disbursements" ADD CONSTRAINT "payroll_disbursements_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_employees" ADD CONSTRAINT "payroll_employees_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."payroll_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_employees" ADD CONSTRAINT "payroll_employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_employee_id_payroll_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."payroll_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_payroll_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."payroll_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;