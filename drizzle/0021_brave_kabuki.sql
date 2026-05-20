CREATE TYPE "public"."cron_job_status" AS ENUM('active', 'paused', 'error', 'running');--> statement-breakpoint
CREATE TABLE "api_changelogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" varchar(20) NOT NULL,
	"release_date" timestamp NOT NULL,
	"title" varchar(255) NOT NULL,
	"type" varchar(20) NOT NULL,
	"summary" text NOT NULL,
	"breaking_changes" text,
	"new_endpoints" text,
	"deprecated_endpoints" text,
	"bug_fixes" text,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_jobs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"schedule" varchar(100) NOT NULL,
	"status" "cron_job_status" DEFAULT 'active' NOT NULL,
	"last_run_at" timestamp,
	"last_run_status" varchar(20),
	"last_run_duration_ms" integer,
	"last_run_error" text,
	"next_run_at" timestamp,
	"run_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"category" varchar(50) DEFAULT 'general' NOT NULL,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(50) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"source_ip" varchar(45),
	"user_id" integer,
	"endpoint" varchar(255),
	"payload" text,
	"blocked" boolean DEFAULT true NOT NULL,
	"response_code" integer,
	"details" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "security_incidents" ADD CONSTRAINT "security_incidents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;