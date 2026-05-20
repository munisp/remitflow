CREATE TYPE "public"."chat_channel" AS ENUM('web', 'mobile', 'api', 'whatsapp', 'telegram');--> statement-breakpoint
CREATE TYPE "public"."chat_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."chat_session_status" AS ENUM('bot', 'queued', 'active', 'resolved', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."rev_share_ledger_type" AS ENUM('credit', 'debit', 'adjustment', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."rev_share_model" AS ENUM('percentage', 'flat_fee', 'tiered', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."rev_share_status" AS ENUM('draft', 'active', 'suspended', 'terminated');--> statement-breakpoint
CREATE TABLE "chat_agent_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"max_concurrent_chats" integer DEFAULT 5 NOT NULL,
	"active_chat_count" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"status_message" varchar(255),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_agent_status_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE "chat_canned_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"shortcut" varchar(50) NOT NULL,
	"content" text NOT NULL,
	"category" varchar(50) DEFAULT 'general',
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_canned_responses_shortcut_unique" UNIQUE("shortcut")
);
--> statement-breakpoint
CREATE TABLE "chat_session_meta" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"status" "chat_session_status" DEFAULT 'bot' NOT NULL,
	"priority" "chat_priority" DEFAULT 'normal' NOT NULL,
	"channel" "chat_channel" DEFAULT 'web' NOT NULL,
	"assigned_agent_id" integer,
	"queue_position" integer,
	"wait_time_seconds" integer,
	"first_response_at" timestamp,
	"resolved_at" timestamp,
	"satisfaction_score" integer,
	"satisfaction_comment" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"internal_notes" text,
	"escalated_at" timestamp,
	"escalated_reason" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_session_meta_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "revenue_share_agreements" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"model" "rev_share_model" DEFAULT 'percentage' NOT NULL,
	"status" "rev_share_status" DEFAULT 'draft' NOT NULL,
	"base_rate" numeric(7, 6) DEFAULT '0.300000' NOT NULL,
	"flat_fee_amount" numeric(18, 6) DEFAULT '0',
	"flat_fee_currency" varchar(10) DEFAULT 'USD',
	"min_payout_threshold" numeric(18, 2) DEFAULT '50.00',
	"payout_currency" varchar(10) DEFAULT 'USD',
	"payout_method" "payout_method" DEFAULT 'bank_transfer',
	"payout_frequency" varchar(20) DEFAULT 'monthly',
	"effective_from" timestamp DEFAULT now() NOT NULL,
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
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_share_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"agreement_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"type" "rev_share_ledger_type" NOT NULL,
	"transaction_id" integer,
	"gross_fee_revenue" numeric(18, 6) NOT NULL,
	"applied_rate" numeric(7, 6) NOT NULL,
	"partner_share" numeric(18, 6) NOT NULL,
	"platform_share" numeric(18, 6) NOT NULL,
	"currency" varchar(10) DEFAULT 'USD' NOT NULL,
	"period_month" integer NOT NULL,
	"period_year" integer NOT NULL,
	"payout_id" integer,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_share_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"agreement_id" integer NOT NULL,
	"period_month" integer NOT NULL,
	"period_year" integer NOT NULL,
	"total_transactions" integer DEFAULT 0 NOT NULL,
	"total_volume" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_fee_revenue" numeric(18, 6) DEFAULT '0' NOT NULL,
	"partner_earnings" numeric(18, 6) DEFAULT '0' NOT NULL,
	"platform_earnings" numeric(18, 6) DEFAULT '0' NOT NULL,
	"applied_tier_id" integer,
	"applied_rate" numeric(7, 6) NOT NULL,
	"payout_id" integer,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "revenue_share_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"agreement_id" integer NOT NULL,
	"tier_name" varchar(100) NOT NULL,
	"min_monthly_volume" numeric(18, 2) NOT NULL,
	"max_monthly_volume" numeric(18, 2),
	"rate" numeric(7, 6) NOT NULL,
	"bonus_rate" numeric(7, 6) DEFAULT '0',
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_agent_status" ADD CONSTRAINT "chat_agent_status_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_canned_responses" ADD CONSTRAINT "chat_canned_responses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session_meta" ADD CONSTRAINT "chat_session_meta_session_id_chatSessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chatSessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session_meta" ADD CONSTRAINT "chat_session_meta_assigned_agent_id_users_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_agreements" ADD CONSTRAINT "revenue_share_agreements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_agreements" ADD CONSTRAINT "revenue_share_agreements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_agreements" ADD CONSTRAINT "revenue_share_agreements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_ledger" ADD CONSTRAINT "revenue_share_ledger_agreement_id_revenue_share_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."revenue_share_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_ledger" ADD CONSTRAINT "revenue_share_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_ledger" ADD CONSTRAINT "revenue_share_ledger_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_ledger" ADD CONSTRAINT "revenue_share_ledger_payout_id_partner_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."partner_payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_reports" ADD CONSTRAINT "revenue_share_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_reports" ADD CONSTRAINT "revenue_share_reports_agreement_id_revenue_share_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."revenue_share_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_reports" ADD CONSTRAINT "revenue_share_reports_applied_tier_id_revenue_share_tiers_id_fk" FOREIGN KEY ("applied_tier_id") REFERENCES "public"."revenue_share_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_reports" ADD CONSTRAINT "revenue_share_reports_payout_id_partner_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."partner_payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_tiers" ADD CONSTRAINT "revenue_share_tiers_agreement_id_revenue_share_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."revenue_share_agreements"("id") ON DELETE cascade ON UPDATE no action;