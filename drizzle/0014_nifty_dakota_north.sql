CREATE TYPE "public"."ab_event_type" AS ENUM('impression', 'click', 'conversion', 'signup', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."ab_experiment_status" AS ENUM('draft', 'running', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."document_vault_category" AS ENUM('identity', 'address', 'financial', 'compliance', 'contract', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_vault_status" AS ENUM('active', 'expired', 'archived', 'shared');--> statement-breakpoint
CREATE TYPE "public"."rate_alert_history_status" AS ENUM('triggered', 'snoozed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."referral_bonus_status" AS ENUM('pending', 'approved', 'paid', 'expired', 'rejected');--> statement-breakpoint
CREATE TABLE "ab_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"experiment_id" integer NOT NULL,
	"user_id" integer,
	"session_id" varchar(128),
	"variant_id" varchar(64) NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ab_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"experiment_id" integer NOT NULL,
	"assignment_id" integer,
	"variant_id" varchar(64) NOT NULL,
	"event_type" "ab_event_type" NOT NULL,
	"metadata" json DEFAULT '{}'::json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ab_experiments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"status" "ab_experiment_status" DEFAULT 'draft' NOT NULL,
	"variants" json DEFAULT '[]'::json,
	"target_page" varchar(200),
	"start_date" timestamp,
	"end_date" timestamp,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_vault" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category" "document_vault_category" DEFAULT 'other' NOT NULL,
	"status" "document_vault_status" DEFAULT 'active' NOT NULL,
	"file_url" text NOT NULL,
	"file_key" varchar(500) NOT NULL,
	"mime_type" varchar(100),
	"file_size" integer,
	"is_encrypted" boolean DEFAULT false,
	"expires_at" timestamp,
	"shared_with" json DEFAULT '[]'::json,
	"tags" json DEFAULT '[]'::json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_alert_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"from_currency" varchar(10) NOT NULL,
	"to_currency" varchar(10) NOT NULL,
	"target_rate" numeric(18, 6) NOT NULL,
	"actual_rate" numeric(18, 6) NOT NULL,
	"direction" varchar(10) DEFAULT 'above',
	"status" "rate_alert_history_status" DEFAULT 'triggered' NOT NULL,
	"notification_sent" boolean DEFAULT false,
	"snoozed_until" timestamp,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_bonuses" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_id" integer NOT NULL,
	"referred_id" integer NOT NULL,
	"referral_code" varchar(32) NOT NULL,
	"referrer_bonus" numeric(18, 2) DEFAULT '0',
	"referred_bonus" numeric(18, 2) DEFAULT '0',
	"currency" varchar(10) DEFAULT 'USD',
	"status" "referral_bonus_status" DEFAULT 'pending' NOT NULL,
	"trigger_event" varchar(100) DEFAULT 'first_transfer',
	"paid_at" timestamp,
	"expires_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ab_assignments" ADD CONSTRAINT "ab_assignments_experiment_id_ab_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."ab_experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ab_assignments" ADD CONSTRAINT "ab_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ab_events" ADD CONSTRAINT "ab_events_experiment_id_ab_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."ab_experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ab_events" ADD CONSTRAINT "ab_events_assignment_id_ab_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."ab_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ab_experiments" ADD CONSTRAINT "ab_experiments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_vault" ADD CONSTRAINT "document_vault_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_alert_history" ADD CONSTRAINT "rate_alert_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_bonuses" ADD CONSTRAINT "referral_bonuses_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_bonuses" ADD CONSTRAINT "referral_bonuses_referred_id_users_id_fk" FOREIGN KEY ("referred_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;