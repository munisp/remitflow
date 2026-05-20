CREATE TYPE "public"."kyc_stage" AS ENUM('not_started', 'documents_submitted', 'under_review', 'additional_info_required', 'approved', 'rejected', 'expired', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."velocity_action" AS ENUM('block', 'flag', 'require_2fa', 'notify_admin');--> statement-breakpoint
CREATE TYPE "public"."velocity_window" AS ENUM('1h', '6h', '24h', '7d', '30d');--> statement-breakpoint
CREATE TABLE "api_key_rotation_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"old_key_id" integer NOT NULL,
	"new_key_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"reason" varchar(200),
	"rotated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_payment_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"recipient_name" varchar(200) NOT NULL,
	"recipient_account" varchar(100),
	"recipient_bank" varchar(100),
	"recipient_country" varchar(10),
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'USD' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"transaction_id" integer,
	"error_message" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_renewals" (
	"id" serial PRIMARY KEY NOT NULL,
	"original_doc_id" integer NOT NULL,
	"new_doc_id" integer,
	"user_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"initiated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "kyc_lifecycle" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stage" "kyc_stage" DEFAULT 'not_started' NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"submitted_at" timestamp,
	"review_started_at" timestamp,
	"reviewed_at" timestamp,
	"approved_at" timestamp,
	"rejected_at" timestamp,
	"expires_at" timestamp,
	"rejection_reason" text,
	"additional_info_required" text,
	"reviewed_by" integer,
	"risk_score" integer DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_lifecycle_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"lifecycle_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"from_stage" "kyc_stage" NOT NULL,
	"to_stage" "kyc_stage" NOT NULL,
	"changed_by" integer,
	"reason" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_config_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"config_key" varchar(100) NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by" integer,
	"change_reason" text,
	"reload_triggered" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "velocity_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" integer NOT NULL,
	"user_id" integer,
	"reason" text NOT NULL,
	"expires_at" timestamp,
	"granted_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "velocity_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"window" "velocity_window" DEFAULT '24h' NOT NULL,
	"max_count" integer,
	"max_amount" numeric(18, 2),
	"currency" varchar(10) DEFAULT 'USD',
	"action" "velocity_action" DEFAULT 'flag' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"applies_to" varchar(20) DEFAULT 'all',
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "velocity_whitelist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"reason" text NOT NULL,
	"added_by" integer NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_retry_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"delivery_id" integer NOT NULL,
	"endpoint_id" integer NOT NULL,
	"payload" json NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp NOT NULL,
	"last_attempt_at" timestamp,
	"last_error" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_key_rotation_log" ADD CONSTRAINT "api_key_rotation_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_payment_items" ADD CONSTRAINT "batch_payment_items_batch_id_batchPayments_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batchPayments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_payment_items" ADD CONSTRAINT "batch_payment_items_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_renewals" ADD CONSTRAINT "document_renewals_original_doc_id_document_vault_id_fk" FOREIGN KEY ("original_doc_id") REFERENCES "public"."document_vault"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_renewals" ADD CONSTRAINT "document_renewals_new_doc_id_document_vault_id_fk" FOREIGN KEY ("new_doc_id") REFERENCES "public"."document_vault"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_renewals" ADD CONSTRAINT "document_renewals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_lifecycle" ADD CONSTRAINT "kyc_lifecycle_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_lifecycle" ADD CONSTRAINT "kyc_lifecycle_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_lifecycle_history" ADD CONSTRAINT "kyc_lifecycle_history_lifecycle_id_kyc_lifecycle_id_fk" FOREIGN KEY ("lifecycle_id") REFERENCES "public"."kyc_lifecycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_lifecycle_history" ADD CONSTRAINT "kyc_lifecycle_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_lifecycle_history" ADD CONSTRAINT "kyc_lifecycle_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_config_audit_log" ADD CONSTRAINT "system_config_audit_log_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "velocity_overrides" ADD CONSTRAINT "velocity_overrides_rule_id_velocity_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."velocity_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "velocity_overrides" ADD CONSTRAINT "velocity_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "velocity_overrides" ADD CONSTRAINT "velocity_overrides_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "velocity_rules" ADD CONSTRAINT "velocity_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "velocity_whitelist" ADD CONSTRAINT "velocity_whitelist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "velocity_whitelist" ADD CONSTRAINT "velocity_whitelist_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_retry_queue" ADD CONSTRAINT "webhook_retry_queue_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_retry_queue" ADD CONSTRAINT "webhook_retry_queue_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;