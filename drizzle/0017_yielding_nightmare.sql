CREATE TABLE "bulk_user_action_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_id" integer NOT NULL,
	"action" varchar(50) NOT NULL,
	"target_user_ids" jsonb NOT NULL,
	"affected_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cbdc_mint_burn_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"currency" varchar(20) NOT NULL,
	"operation" varchar(10) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"balance_before" numeric(18, 2) NOT NULL,
	"balance_after" numeric(18, 2) NOT NULL,
	"authorized_by" integer,
	"transaction_ref" varchar(100),
	"reason" text,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_activity_feed" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"actor_name" varchar(200) NOT NULL,
	"actor_avatar" text,
	"activity_type" varchar(50) NOT NULL,
	"title" varchar(300) NOT NULL,
	"description" text,
	"amount" numeric(18, 2),
	"currency" varchar(10),
	"country" varchar(100),
	"sdg_goal" integer,
	"is_public" boolean DEFAULT true NOT NULL,
	"likes_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ctr_auto_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"amount_usd" numeric(18, 2),
	"flag_reason" varchar(200) NOT NULL,
	"report_type" varchar(20) DEFAULT 'CTR' NOT NULL,
	"status" varchar(30) DEFAULT 'pending_review' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"filed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_login_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"ip_address" varchar(45) NOT NULL,
	"user_agent" text,
	"country" varchar(100),
	"city" varchar(100),
	"is_success" boolean DEFAULT true NOT NULL,
	"is_suspicious" boolean DEFAULT false NOT NULL,
	"suspicious_reason" varchar(200),
	"device_fingerprint" varchar(200),
	"login_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kafka_consumer_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic" varchar(200) NOT NULL,
	"group_id" varchar(100) NOT NULL,
	"partition" integer DEFAULT 0 NOT NULL,
	"current_offset" bigint DEFAULT 0 NOT NULL,
	"log_end_offset" bigint DEFAULT 0 NOT NULL,
	"lag" bigint DEFAULT 0 NOT NULL,
	"messages_consumed" bigint DEFAULT 0 NOT NULL,
	"messages_per_second" numeric(10, 2) DEFAULT '0',
	"last_consumed_at" timestamp,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"error_message" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mojaloop_fsps" (
	"id" serial PRIMARY KEY NOT NULL,
	"fsp_id" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"country" varchar(10) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"endpoint" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"supported_schemes" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mojaloop_fsps_fsp_id_unique" UNIQUE("fsp_id")
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_retry_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"stripe_event_id" varchar(200) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"last_attempt_at" timestamp DEFAULT now() NOT NULL,
	"next_retry_at" timestamp,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_exports" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"format" varchar(10) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"filters" jsonb,
	"record_count" integer DEFAULT 0,
	"file_url" text,
	"file_size" integer,
	"expires_at" timestamp,
	"error_message" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "bulk_user_action_log" ADD CONSTRAINT "bulk_user_action_log_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cbdc_mint_burn_log" ADD CONSTRAINT "cbdc_mint_burn_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cbdc_mint_burn_log" ADD CONSTRAINT "cbdc_mint_burn_log_authorized_by_users_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_activity_feed" ADD CONSTRAINT "community_activity_feed_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ctr_auto_flags" ADD CONSTRAINT "ctr_auto_flags_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ctr_auto_flags" ADD CONSTRAINT "ctr_auto_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ctr_auto_flags" ADD CONSTRAINT "ctr_auto_flags_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_login_history" ADD CONSTRAINT "ip_login_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_exports" ADD CONSTRAINT "transaction_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;