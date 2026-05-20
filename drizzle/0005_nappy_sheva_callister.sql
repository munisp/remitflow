CREATE TYPE "public"."api_key_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."gateway" AS ENUM('stripe', 'paypal', 'flutterwave', 'bank_transfer', 'mpesa', 'mojaloop');--> statement-breakpoint
CREATE TYPE "public"."gateway_tx_status" AS ENUM('initiated', 'pending', 'success', 'failed', 'refunded', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."payout_method" AS ENUM('bank_transfer', 'crypto', 'mobile_money', 'paypal');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."watchlist_status" AS ENUM('clear', 'flagged', 'blocked', 'under_review');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_status" AS ENUM('pending', 'delivered', 'failed', 'retrying');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" integer,
	"name" varchar(100) NOT NULL,
	"key_hash" varchar(128) NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"scopes" json DEFAULT '[]'::json,
	"status" "api_key_status" DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"ip_allowlist" json DEFAULT '[]'::json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "compliance_watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"name" varchar(200) NOT NULL,
	"date_of_birth" date,
	"nationality" varchar(3),
	"id_number" varchar(50),
	"status" "watchlist_status" DEFAULT 'clear' NOT NULL,
	"risk_score" integer DEFAULT 0 NOT NULL,
	"matched_lists" json DEFAULT '[]'::json,
	"notes" text,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rate_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_currency" varchar(10) NOT NULL,
	"to_currency" varchar(10) NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"source" varchar(50) DEFAULT 'api' NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"currency" varchar(10) DEFAULT 'USD' NOT NULL,
	"method" "payout_method" DEFAULT 'bank_transfer' NOT NULL,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"reference" varchar(64),
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"fee_revenue" numeric(18, 6) DEFAULT '0' NOT NULL,
	"revenue_share" numeric(5, 4) DEFAULT '0.3' NOT NULL,
	"notes" text,
	"processed_at" timestamp,
	"processed_by" integer,
	"metadata" json DEFAULT '{}'::json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "partner_payouts_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "payment_gateway_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"gateway" "gateway" NOT NULL,
	"gateway_tx_id" varchar(128),
	"amount" numeric(18, 6) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"status" "gateway_tx_status" DEFAULT 'initiated' NOT NULL,
	"direction" varchar(10) DEFAULT 'credit' NOT NULL,
	"metadata" json DEFAULT '{}'::json,
	"error_message" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"is_secret" boolean DEFAULT false NOT NULL,
	"updated_by" integer,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint_id" integer NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload" json DEFAULT '{}'::json,
	"status" "webhook_event_status" DEFAULT 'pending' NOT NULL,
	"response_status" integer,
	"response_body" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"delivered_at" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"user_id" integer,
	"url" text NOT NULL,
	"secret" varchar(64) NOT NULL,
	"events" json DEFAULT '[]'::json,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"last_delivered_at" timestamp,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_watchlist" ADD CONSTRAINT "compliance_watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_watchlist" ADD CONSTRAINT "compliance_watchlist_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_gateway_logs" ADD CONSTRAINT "payment_gateway_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;