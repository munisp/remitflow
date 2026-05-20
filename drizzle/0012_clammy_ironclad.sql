CREATE TYPE "public"."bulk_payment_batch_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."dispute_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."open_banking_consent_status" AS ENUM('awaiting_authorisation', 'authorised', 'rejected', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."regulatory_report_status" AS ENUM('pending', 'generating', 'ready', 'filed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."regulatory_report_type" AS ENUM('CTR', 'SAR', 'FBAR', 'ANNUAL_AML');--> statement-breakpoint
CREATE TYPE "public"."sanctions_check_result" AS ENUM('clear', 'hit', 'pending_review');--> statement-breakpoint
CREATE TABLE "bulk_payment_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"total_payments" integer DEFAULT 0 NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"pending" integer DEFAULT 0 NOT NULL,
	"status" "bulk_payment_batch_status" DEFAULT 'pending' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"total_amount" integer DEFAULT 0 NOT NULL,
	"success_rate" integer DEFAULT 0 NOT NULL,
	"estimated_completion_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_payment_batches_batch_id_unique" UNIQUE("batch_id")
);
--> statement-breakpoint
CREATE TABLE "fraud_model_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"model_name" text NOT NULL,
	"model_version" text NOT NULL,
	"triggered_by" text DEFAULT 'airflow' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"accuracy" integer,
	"f1_score" integer,
	"auc_roc" integer,
	"training_records" integer,
	"validation_records" integer,
	"duration_seconds" integer,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fraud_model_runs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "open_banking_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"consent_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"bank_id" text NOT NULL,
	"bank_name" text NOT NULL,
	"status" "open_banking_consent_status" DEFAULT 'awaiting_authorisation' NOT NULL,
	"permissions" text[],
	"expires_at" timestamp,
	"authorised_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "open_banking_consents_consent_id_unique" UNIQUE("consent_id")
);
--> statement-breakpoint
CREATE TABLE "regulatory_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"report_type" "regulatory_report_type" NOT NULL,
	"status" "regulatory_report_status" DEFAULT 'pending' NOT NULL,
	"format" text DEFAULT 'pdf' NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"generated_by" integer,
	"download_url" text,
	"filed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "regulatory_reports_report_id_unique" UNIQUE("report_id")
);
--> statement-breakpoint
CREATE TABLE "sanctions_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"screening_id" text NOT NULL,
	"user_id" integer,
	"entity_name" text NOT NULL,
	"entity_type" text DEFAULT 'individual' NOT NULL,
	"result" "sanctions_check_result" DEFAULT 'clear' NOT NULL,
	"risk_level" text DEFAULT 'low' NOT NULL,
	"lists_checked" text[],
	"match_details" text,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sanctions_checks_screening_id_unique" UNIQUE("screening_id")
);
--> statement-breakpoint
ALTER TABLE "bulk_payment_batches" ADD CONSTRAINT "bulk_payment_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_banking_consents" ADD CONSTRAINT "open_banking_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_reports" ADD CONSTRAINT "regulatory_reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanctions_checks" ADD CONSTRAINT "sanctions_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanctions_checks" ADD CONSTRAINT "sanctions_checks_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;