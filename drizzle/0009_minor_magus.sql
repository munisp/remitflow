CREATE TABLE "compliance_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_type" varchar(50) NOT NULL,
	"severity" varchar(20) DEFAULT 'medium' NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"related_user_id" integer,
	"related_transaction_id" integer,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"acknowledged_by" integer,
	"acknowledged_at" timestamp,
	"resolved_at" timestamp,
	"metadata" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"corridor" varchar(20) NOT NULL,
	"min_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"max_amount" numeric(18, 2),
	"fee_type" varchar(20) DEFAULT 'percentage' NOT NULL,
	"fee_percentage" numeric(5, 4) DEFAULT '0',
	"fee_fixed" numeric(18, 2) DEFAULT '0',
	"min_fee" numeric(18, 2) DEFAULT '0',
	"max_fee" numeric(18, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"totp_secret" varchar(100),
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"backup_codes" text,
	"enrolled_at" timestamp,
	"last_used_at" timestamp,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "sandbox_scenarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"scenario_type" varchar(50) DEFAULT 'transfer' NOT NULL,
	"payload" text NOT NULL,
	"tags" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"event_type" varchar(80) NOT NULL,
	"severity" varchar(20) DEFAULT 'info' NOT NULL,
	"ip_address" varchar(50),
	"user_agent" text,
	"location" varchar(100),
	"details" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_audit_trail" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"from_status" varchar(30),
	"to_status" varchar(30) NOT NULL,
	"triggered_by" varchar(50) NOT NULL,
	"reason" text,
	"metadata" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compliance_alerts" ADD CONSTRAINT "compliance_alerts_related_user_id_users_id_fk" FOREIGN KEY ("related_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_alerts" ADD CONSTRAINT "compliance_alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_settings" ADD CONSTRAINT "mfa_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_scenarios" ADD CONSTRAINT "sandbox_scenarios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_audit_trail" ADD CONSTRAINT "transfer_audit_trail_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;