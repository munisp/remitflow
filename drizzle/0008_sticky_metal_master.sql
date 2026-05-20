CREATE TABLE "api_key_usage_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"endpoint" varchar(200) NOT NULL,
	"method" varchar(10) DEFAULT 'POST' NOT NULL,
	"status_code" integer DEFAULT 200 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"ip_address" varchar(50),
	"environment" varchar(10) DEFAULT 'live' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chargeback_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"transaction_id" integer,
	"stripe_charge_id" varchar(200),
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'USD' NOT NULL,
	"reason" varchar(100) NOT NULL,
	"status" varchar(30) DEFAULT 'open' NOT NULL,
	"evidence_url" text,
	"notes" text,
	"due_date" timestamp,
	"resolved_at" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_type" varchar(50) NOT NULL,
	"report_period" varchar(30) NOT NULL,
	"generated_by" integer NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"file_url" text,
	"summary" text,
	"total_transactions" integer DEFAULT 0,
	"total_volume" numeric(18, 2),
	"flagged_transactions" integer DEFAULT 0,
	"submitted_at" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "developer_sandbox_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_key" varchar(100) NOT NULL,
	"environment" varchar(20) DEFAULT 'sandbox' NOT NULL,
	"test_api_key" varchar(100),
	"request_count" integer DEFAULT 0 NOT NULL,
	"last_request_at" timestamp,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "developer_sandbox_sessions_session_key_unique" UNIQUE("session_key")
);
--> statement-breakpoint
CREATE TABLE "fx_alert_trigger_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"from_currency" varchar(10) NOT NULL,
	"to_currency" varchar(10) NOT NULL,
	"target_rate" numeric(18, 6) NOT NULL,
	"triggered_rate" numeric(18, 6) NOT NULL,
	"direction" varchar(10) DEFAULT 'above' NOT NULL,
	"notification_sent" boolean DEFAULT false NOT NULL,
	"triggered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"device_name" varchar(100) DEFAULT 'Browser',
	"is_active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "sla_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"severity" varchar(20) DEFAULT 'medium' NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"affected_service" varchar(100),
	"root_cause" text,
	"resolution" text,
	"reported_by" integer,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smart_routing_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" integer,
	"user_id" integer NOT NULL,
	"from_currency" varchar(10) NOT NULL,
	"to_currency" varchar(10) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"selected_provider" varchar(100) NOT NULL,
	"estimated_fee" numeric(18, 2),
	"estimated_time_seconds" integer,
	"score" numeric(5, 2),
	"decision_factors" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stripe_session_id" varchar(200) NOT NULL,
	"stripe_payment_intent_id" varchar(200),
	"amount_total" integer NOT NULL,
	"currency" varchar(10) DEFAULT 'usd' NOT NULL,
	"status" varchar(30) DEFAULT 'paid' NOT NULL,
	"product_name" varchar(200),
	"receipt_url" text,
	"metadata" text,
	"paid_at" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_receipts_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE "treasury_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"currency" varchar(10) NOT NULL,
	"balance" numeric(18, 2) NOT NULL,
	"locked_balance" numeric(18, 2) DEFAULT '0',
	"available_balance" numeric(18, 2) NOT NULL,
	"usd_equivalent" numeric(18, 2),
	"provider" varchar(100),
	"account_ref" varchar(200),
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_key_usage_logs" ADD CONSTRAINT "api_key_usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chargeback_cases" ADD CONSTRAINT "chargeback_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_reports" ADD CONSTRAINT "compliance_reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developer_sandbox_sessions" ADD CONSTRAINT "developer_sandbox_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_alert_trigger_history" ADD CONSTRAINT "fx_alert_trigger_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_incidents" ADD CONSTRAINT "sla_incidents_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_routing_decisions" ADD CONSTRAINT "smart_routing_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_receipts" ADD CONSTRAINT "stripe_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;