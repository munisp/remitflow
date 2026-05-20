CREATE TYPE "public"."feature_flag_scope" AS ENUM('global', 'tenant', 'user');--> statement-breakpoint
CREATE TYPE "public"."tenant_plan" AS ENUM('starter', 'growth', 'enterprise', 'white_label');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'trial', 'churned');--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"scope" "feature_flag_scope" DEFAULT 'global' NOT NULL,
	"default_enabled" boolean DEFAULT true NOT NULL,
	"rollout_pct" integer DEFAULT 100 NOT NULL,
	"required_plan" "tenant_plan",
	"category" varchar(50) DEFAULT 'feature',
	"tags" json DEFAULT '[]'::json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "tenant_feature_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"flag_id" integer NOT NULL,
	"enabled" boolean NOT NULL,
	"overridden_by" integer,
	"reason" text,
	"expires_at" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(63) NOT NULL,
	"name" varchar(255) NOT NULL,
	"plan" "tenant_plan" DEFAULT 'starter' NOT NULL,
	"status" "tenant_status" DEFAULT 'trial' NOT NULL,
	"owner_id" integer,
	"logo_url" text,
	"favicon_url" text,
	"primary_color" varchar(7) DEFAULT '#7c3aed',
	"secondary_color" varchar(7) DEFAULT '#06b6d4',
	"accent_color" varchar(7) DEFAULT '#f59e0b',
	"brand_name" varchar(255),
	"support_email" varchar(255),
	"support_url" text,
	"custom_domain" varchar(255),
	"default_currency" varchar(10) DEFAULT 'USD',
	"default_locale" varchar(10) DEFAULT 'en',
	"allowed_countries" json DEFAULT '[]'::json,
	"max_users" integer DEFAULT 100,
	"max_monthly_volume" numeric(18, 2) DEFAULT '50000',
	"metadata" json DEFAULT '{}'::json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_feature_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"flag_id" integer NOT NULL,
	"enabled" boolean NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "white_label_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"onboarding_steps" json DEFAULT '[]'::json,
	"nav_sections" json DEFAULT '[]'::json,
	"terms_url" text,
	"privacy_url" text,
	"welcome_email_subject" varchar(255),
	"welcome_email_body" text,
	"show_powered_by" boolean DEFAULT true,
	"allow_self_registration" boolean DEFAULT true,
	"require_invite_code" boolean DEFAULT false,
	"ga_tracking_id" varchar(50),
	"intercom_app_id" varchar(50),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "white_label_configs_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "tenant_feature_flags" ADD CONSTRAINT "tenant_feature_flags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_feature_flags" ADD CONSTRAINT "tenant_feature_flags_flag_id_feature_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."feature_flags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_feature_flags" ADD CONSTRAINT "tenant_feature_flags_overridden_by_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_feature_flags" ADD CONSTRAINT "user_feature_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_feature_flags" ADD CONSTRAINT "user_feature_flags_flag_id_feature_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."feature_flags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "white_label_configs" ADD CONSTRAINT "white_label_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;