CREATE TYPE "public"."pipeline_run_status" AS ENUM('pending', 'running', 'success', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "airflow_dag_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"dag_id" varchar(100) NOT NULL,
	"run_id" varchar(100),
	"status" "pipeline_run_status" DEFAULT 'pending' NOT NULL,
	"triggered_by" integer,
	"conf" json,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"duration_ms" integer,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "dbt_run_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" varchar(100),
	"model_select" varchar(255),
	"status" "pipeline_run_status" DEFAULT 'pending' NOT NULL,
	"triggered_by" integer,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"duration_ms" integer,
	"models_run" integer DEFAULT 0,
	"models_error" integer DEFAULT 0,
	"error_message" text,
	"results" json
);
--> statement-breakpoint
CREATE TABLE "nifi_pipeline_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"pipeline_id" varchar(100) NOT NULL,
	"pipeline_name" varchar(255),
	"status" "pipeline_run_status" DEFAULT 'pending' NOT NULL,
	"triggered_by" integer,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"duration_ms" integer,
	"records_processed" integer DEFAULT 0,
	"error_message" text,
	"metadata" json
);
--> statement-breakpoint
CREATE TABLE "tenant_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" varchar(100) NOT NULL,
	"tenant_name" varchar(255) NOT NULL,
	"primary_color" varchar(20) DEFAULT '#6366f1',
	"secondary_color" varchar(20) DEFAULT '#8b5cf6',
	"logo_url" text,
	"favicon_url" text,
	"custom_domain" varchar(255),
	"support_email" varchar(255),
	"support_phone" varchar(50),
	"default_currency" varchar(10) DEFAULT 'USD',
	"allowed_currencies" json,
	"max_transfer_limit" numeric(18, 2) DEFAULT '50000',
	"kyc_required" boolean DEFAULT true,
	"mfa_required" boolean DEFAULT false,
	"webhook_url" text,
	"webhook_secret" varchar(255),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_configs_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "airflow_dag_runs" ADD CONSTRAINT "airflow_dag_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dbt_run_history" ADD CONSTRAINT "dbt_run_history_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nifi_pipeline_runs" ADD CONSTRAINT "nifi_pipeline_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;