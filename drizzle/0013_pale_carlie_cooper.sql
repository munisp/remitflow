CREATE TYPE "public"."partner_api_key_env" AS ENUM('sandbox', 'production');--> statement-breakpoint
CREATE TYPE "public"."partner_api_key_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."partner_application_status" AS ENUM('draft', 'submitted', 'under_review', 'additional_info_required', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."partner_application_type" AS ENUM('fintech_startup', 'bank', 'mfi', 'ngo', 'telecom', 'aggregator', 'enterprise', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_onboarding_status" AS ENUM('not_started', 'in_progress', 'completed', 'skipped');--> statement-breakpoint
CREATE TABLE "compliance_email_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"officer_name" varchar(255) NOT NULL,
	"officer_email" varchar(255) NOT NULL,
	"report_types" json DEFAULT '["CTR","SAR","FBAR"]'::json,
	"is_active" boolean DEFAULT true NOT NULL,
	"smtp_host" varchar(255) DEFAULT 'smtp.sendgrid.net',
	"smtp_port" integer DEFAULT 587,
	"smtp_user" varchar(255),
	"smtp_password_encrypted" text,
	"from_email" varchar(255) DEFAULT 'compliance@remitflow.com',
	"from_name" varchar(100) DEFAULT 'RemitFlow Compliance',
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"environment" "partner_api_key_env" DEFAULT 'sandbox' NOT NULL,
	"status" "partner_api_key_status" DEFAULT 'active' NOT NULL,
	"permissions" json DEFAULT '[]'::json,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"created_by" integer NOT NULL,
	"revoked_by" integer,
	"revoked_at" timestamp,
	"request_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_application_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"comment" text NOT NULL,
	"is_internal" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name" varchar(255) NOT NULL,
	"brand_name" varchar(255) NOT NULL,
	"slug" varchar(63) NOT NULL,
	"application_type" "partner_application_type" DEFAULT 'fintech_startup' NOT NULL,
	"contact_name" varchar(255) NOT NULL,
	"contact_email" varchar(255) NOT NULL,
	"contact_phone" varchar(30),
	"website" text,
	"country" varchar(3) NOT NULL,
	"registration_number" varchar(100),
	"tax_id" varchar(100),
	"incorporation_date" varchar(20),
	"business_description" text,
	"expected_monthly_volume" numeric(18, 2),
	"expected_user_count" integer,
	"target_corridors" json DEFAULT '[]'::json,
	"requested_plan" varchar(30) DEFAULT 'starter' NOT NULL,
	"has_aml_policy" boolean DEFAULT false,
	"has_kyc_process" boolean DEFAULT false,
	"is_regulated" boolean DEFAULT false,
	"regulatory_licenses" json DEFAULT '[]'::json,
	"business_reg_doc_url" text,
	"aml_policy_doc_url" text,
	"director_id_doc_url" text,
	"bank_statement_doc_url" text,
	"primary_color" varchar(7) DEFAULT '#7c3aed',
	"secondary_color" varchar(7) DEFAULT '#06b6d4',
	"logo_url" text,
	"status" "partner_application_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"review_notes" text,
	"rejection_reason" text,
	"additional_info_request" text,
	"additional_info_provided_at" timestamp,
	"approved_at" timestamp,
	"tenant_id" integer,
	"sla_signed_at" timestamp,
	"sla_version" varchar(20) DEFAULT 'v1.0',
	"invite_code_id" integer,
	"submitted_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "partner_applications_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "partner_webhooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"url" text NOT NULL,
	"events" json DEFAULT '[]'::json,
	"signing_secret" varchar(64) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_delivered_at" timestamp,
	"failure_count" integer DEFAULT 0,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_onboarding_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"status" "user_onboarding_status" DEFAULT 'not_started' NOT NULL,
	"profile_completed" boolean DEFAULT false,
	"bank_linked" boolean DEFAULT false,
	"kyc_started" boolean DEFAULT false,
	"kyc_completed" boolean DEFAULT false,
	"first_transfer_made" boolean DEFAULT false,
	"notifications_enabled" boolean DEFAULT false,
	"profile_completed_at" timestamp,
	"bank_linked_at" timestamp,
	"kyc_started_at" timestamp,
	"kyc_completed_at" timestamp,
	"first_transfer_at" timestamp,
	"completed_at" timestamp,
	"skipped_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_onboarding_progress_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "compliance_email_config" ADD CONSTRAINT "compliance_email_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_email_config" ADD CONSTRAINT "compliance_email_config_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_api_keys" ADD CONSTRAINT "partner_api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_api_keys" ADD CONSTRAINT "partner_api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_api_keys" ADD CONSTRAINT "partner_api_keys_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_application_comments" ADD CONSTRAINT "partner_application_comments_application_id_partner_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."partner_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_application_comments" ADD CONSTRAINT "partner_application_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_invite_code_id_partner_invite_codes_id_fk" FOREIGN KEY ("invite_code_id") REFERENCES "public"."partner_invite_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_webhooks" ADD CONSTRAINT "partner_webhooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_webhooks" ADD CONSTRAINT "partner_webhooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_onboarding_progress" ADD CONSTRAINT "user_onboarding_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;