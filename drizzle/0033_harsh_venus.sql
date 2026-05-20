CREATE TYPE "public"."bdc_partner_status" AS ENUM('pending_review', 'approved', 'suspended', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."funding_source_type" AS ENUM('remittance_inflow', 'nfem_fx_conversion', 'internal_transfer', 'stripe_topup', 'crypto_conversion', 'agent_cash', 'other');--> statement-breakpoint
CREATE TYPE "public"."settlement_account_status" AS ENUM('active', 'pending_cbn_filing', 'filed', 'suspended', 'closed');--> statement-breakpoint
CREATE TABLE "bdc_liquidity_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"bdc_partner_id" integer NOT NULL,
	"settlement_account_id" integer,
	"requested_amount_usd" integer NOT NULL,
	"approved_amount_usd" integer,
	"bmatch_rate_at_request" varchar(30),
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"adb_transfer_reference" varchar(200),
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bdc_partners" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"cbn_licence_number" varchar(100) NOT NULL,
	"adb_name" varchar(200) NOT NULL,
	"adb_code" varchar(20),
	"contact_email" varchar(200),
	"contact_phone" varchar(50),
	"status" "bdc_partner_status" DEFAULT 'pending_review' NOT NULL,
	"max_daily_fx_usd" integer DEFAULT 100000 NOT NULL,
	"notes" text,
	"approved_by" integer,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bdc_partners_cbn_licence_number_unique" UNIQUE("cbn_licence_number")
);
--> statement-breakpoint
CREATE TABLE "bmatch_rate_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair" varchar(20) NOT NULL,
	"from_currency" varchar(10) NOT NULL,
	"to_currency" varchar(10) NOT NULL,
	"mid_rate" varchar(30) NOT NULL,
	"bid_rate" varchar(30),
	"ask_rate" varchar(30),
	"spread_bps" varchar(20),
	"platform_rate" varchar(30),
	"platform_spread_bps" varchar(20),
	"within_cbn_limit" boolean DEFAULT true NOT NULL,
	"source" varchar(100) DEFAULT 'adb_passthrough_simulated' NOT NULL,
	"session" varchar(20),
	"snapshot_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cbn_compliance_exports" (
	"id" serial PRIMARY KEY NOT NULL,
	"export_type" varchar(50) NOT NULL,
	"from_date" timestamp NOT NULL,
	"to_date" timestamp NOT NULL,
	"corridor" varchar(20),
	"record_count" integer DEFAULT 0 NOT NULL,
	"file_url" text,
	"file_key" text,
	"status" varchar(30) DEFAULT 'generated' NOT NULL,
	"generated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"corridor" varchar(20) NOT NULL,
	"adb_name" varchar(200) NOT NULL,
	"adb_code" varchar(20),
	"account_number" varchar(50) NOT NULL,
	"account_name" varchar(200) NOT NULL,
	"currency" varchar(10) DEFAULT 'NGN' NOT NULL,
	"status" "settlement_account_status" DEFAULT 'pending_cbn_filing' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"cbn_filed_at" timestamp,
	"cbn_reference_number" varchar(100),
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_funding_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"amount" varchar(30) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"funding_source_type" "funding_source_type" NOT NULL,
	"source_reference" varchar(200),
	"settlement_account_id" integer,
	"is_nfem_approved" boolean DEFAULT false NOT NULL,
	"blocked_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bdc_liquidity_requests" ADD CONSTRAINT "bdc_liquidity_requests_bdc_partner_id_bdc_partners_id_fk" FOREIGN KEY ("bdc_partner_id") REFERENCES "public"."bdc_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bdc_liquidity_requests" ADD CONSTRAINT "bdc_liquidity_requests_settlement_account_id_settlement_accounts_id_fk" FOREIGN KEY ("settlement_account_id") REFERENCES "public"."settlement_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bdc_partners" ADD CONSTRAINT "bdc_partners_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cbn_compliance_exports" ADD CONSTRAINT "cbn_compliance_exports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_accounts" ADD CONSTRAINT "settlement_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_funding_events" ADD CONSTRAINT "wallet_funding_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_funding_events" ADD CONSTRAINT "wallet_funding_events_settlement_account_id_settlement_accounts_id_fk" FOREIGN KEY ("settlement_account_id") REFERENCES "public"."settlement_accounts"("id") ON DELETE no action ON UPDATE no action;