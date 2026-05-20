CREATE TYPE "public"."billing_fee_mode" AS ENUM('PERCENTAGE', 'FLAT', 'HYBRID');--> statement-breakpoint
CREATE TYPE "public"."billing_payout_method" AS ENUM('BANK_TRANSFER', 'MOBILE_MONEY', 'CASH_PICKUP', 'WALLET', 'CRYPTO');--> statement-breakpoint
CREATE TYPE "public"."billing_settlement_status" AS ENUM('PENDING', 'SETTLED', 'FAILED', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."billing_tenant_status" AS ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED');--> statement-breakpoint
CREATE TYPE "public"."billing_tenant_type" AS ENUM('IMTO_PARTNER', 'WHITE_LABEL', 'ENTERPRISE_SENDER');--> statement-breakpoint
CREATE TABLE "billing_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" varchar(100) NOT NULL,
	"actor_user_id" varchar(100) NOT NULL,
	"actor_role" varchar(50) NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"ip_address" varchar(45),
	"user_agent" text,
	"occurred_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_config_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"config_id" varchar(100) NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"version" varchar(50) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_by" varchar(100) NOT NULL,
	"change_reason" text,
	"changed_at_ms" bigint NOT NULL,
	"notification_sent" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"config_id" varchar(100) NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"version" varchar(50) DEFAULT '1.0.0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"fee_mode" "billing_fee_mode" DEFAULT 'PERCENTAGE' NOT NULL,
	"fee_percentage" numeric(8, 4),
	"flat_fee_minor" integer DEFAULT 0,
	"fee_cap_minor" integer DEFAULT 2000,
	"fee_floor_minor" integer DEFAULT 100,
	"fx_spread_percentage" numeric(8, 4) DEFAULT '0.8000' NOT NULL,
	"hedge_cost_percentage" numeric(8, 4) DEFAULT '0.1500' NOT NULL,
	"platform_fee_share_pct" numeric(8, 4) DEFAULT '40.0000' NOT NULL,
	"platform_fx_share_pct" numeric(8, 4) DEFAULT '100.0000' NOT NULL,
	"overhead_per_tx_minor" integer DEFAULT 50 NOT NULL,
	"updated_by" varchar(100) NOT NULL,
	"change_reason" text,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "billing_configs_config_id_unique" UNIQUE("config_id")
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" varchar(100) NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"transaction_id" varchar(100) NOT NULL,
	"corridor" varchar(10) NOT NULL,
	"send_currency" char(3) NOT NULL,
	"recv_currency" char(3) NOT NULL,
	"send_amount_minor" bigint NOT NULL,
	"recv_amount_minor" bigint NOT NULL,
	"transfer_fee_minor" bigint DEFAULT 0 NOT NULL,
	"platform_fee_share_minor" bigint DEFAULT 0 NOT NULL,
	"partner_fee_share_minor" bigint DEFAULT 0 NOT NULL,
	"fee_mode" "billing_fee_mode" NOT NULL,
	"mid_market_rate" numeric(20, 8) NOT NULL,
	"applied_rate" numeric(20, 8) NOT NULL,
	"fx_spread_minor" bigint DEFAULT 0 NOT NULL,
	"fx_hedge_cost_minor" bigint DEFAULT 0 NOT NULL,
	"net_fx_revenue_minor" bigint DEFAULT 0 NOT NULL,
	"payout_method" "billing_payout_method" DEFAULT 'BANK_TRANSFER' NOT NULL,
	"payout_cost_minor" bigint DEFAULT 0 NOT NULL,
	"allocated_overhead_minor" bigint DEFAULT 0 NOT NULL,
	"net_platform_profit_minor" bigint DEFAULT 0 NOT NULL,
	"settlement_status" "billing_settlement_status" DEFAULT 'PENDING' NOT NULL,
	"created_by_user_id" varchar(100) NOT NULL,
	"billing_config_version" varchar(50) NOT NULL,
	"event_timestamp_ms" bigint NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "billing_tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"tenant_name" varchar(255) NOT NULL,
	"tenant_type" "billing_tenant_type" NOT NULL,
	"status" "billing_tenant_status" DEFAULT 'PENDING' NOT NULL,
	"owner_email" varchar(255) NOT NULL,
	"owner_name" varchar(255),
	"keycloak_realm_id" varchar(100),
	"mojaloop_dfsp_id" varchar(50),
	"onboarded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_tenants_tenant_id_unique" UNIQUE("tenant_id")
);
