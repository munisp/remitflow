CREATE TABLE "partner_invite_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"description" text,
	"created_by" integer NOT NULL,
	"max_uses" integer DEFAULT 1,
	"used_count" integer DEFAULT 0 NOT NULL,
	"plan" varchar(20) DEFAULT 'starter' NOT NULL,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" json DEFAULT '{}'::json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "partner_invite_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "tenant_onboarding_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_token" varchar(64) NOT NULL,
	"invite_code_id" integer NOT NULL,
	"user_id" integer,
	"tenant_id" integer,
	"step" integer DEFAULT 1 NOT NULL,
	"data" json DEFAULT '{}'::json,
	"status" varchar(20) DEFAULT 'in_progress' NOT NULL,
	"completed_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_onboarding_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "travel_rule_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"transaction_id" integer,
	"direction" varchar(10) DEFAULT 'outbound' NOT NULL,
	"originator_name" varchar(255) NOT NULL,
	"originator_account" varchar(100),
	"originator_address" text,
	"originator_country" varchar(3),
	"beneficiary_name" varchar(255) NOT NULL,
	"beneficiary_account" varchar(100),
	"beneficiary_address" text,
	"beneficiary_country" varchar(3),
	"amount" numeric(18, 2) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"vasp" varchar(255),
	"vasp_lei" varchar(20),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"threshold" numeric(18, 2) DEFAULT '1000',
	"reported_at" timestamp,
	"acknowledged_at" timestamp,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner_invite_codes" ADD CONSTRAINT "partner_invite_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_onboarding_sessions" ADD CONSTRAINT "tenant_onboarding_sessions_invite_code_id_partner_invite_codes_id_fk" FOREIGN KEY ("invite_code_id") REFERENCES "public"."partner_invite_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_onboarding_sessions" ADD CONSTRAINT "tenant_onboarding_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_onboarding_sessions" ADD CONSTRAINT "tenant_onboarding_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_rule_records" ADD CONSTRAINT "travel_rule_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_rule_records" ADD CONSTRAINT "travel_rule_records_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;