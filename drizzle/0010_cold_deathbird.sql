CREATE TABLE "daily_volume_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_date" varchar(10) NOT NULL,
	"total_transactions" integer DEFAULT 0 NOT NULL,
	"total_volume_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_fees_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"unique_senders" integer DEFAULT 0 NOT NULL,
	"top_corridor" varchar(20),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rate_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"from_currency" varchar(10) NOT NULL,
	"to_currency" varchar(10) NOT NULL,
	"target_rate" numeric(18, 6) NOT NULL,
	"direction" varchar(10) DEFAULT 'above' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"triggered_at" timestamp,
	"notification_sent" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"description" text,
	"discount_type" varchar(20) DEFAULT 'percentage' NOT NULL,
	"discount_value" numeric(10, 4) NOT NULL,
	"min_transfer_amount" numeric(18, 2) DEFAULT '0',
	"max_discount_amount" numeric(18, 2),
	"usage_limit" integer,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"per_user_limit" integer DEFAULT 1,
	"valid_from" timestamp DEFAULT now() NOT NULL,
	"valid_until" timestamp,
	"corridors" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"promo_code_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"transaction_id" integer,
	"discount_applied" numeric(18, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'USD' NOT NULL,
	"redeemed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"beneficiary_id" integer,
	"from_currency" varchar(10) NOT NULL,
	"to_currency" varchar(10) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"frequency" varchar(20) NOT NULL,
	"next_run_at" timestamp NOT NULL,
	"last_run_at" timestamp,
	"run_count" integer DEFAULT 0 NOT NULL,
	"max_runs" integer,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"description" text,
	"promo_code" varchar(50),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_notif_prefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"email_transactions" boolean DEFAULT true NOT NULL,
	"email_marketing" boolean DEFAULT false NOT NULL,
	"email_security" boolean DEFAULT true NOT NULL,
	"push_transactions" boolean DEFAULT true NOT NULL,
	"push_marketing" boolean DEFAULT false NOT NULL,
	"sms_transactions" boolean DEFAULT false NOT NULL,
	"fx_alert_enabled" boolean DEFAULT false NOT NULL,
	"fx_alert_threshold" numeric(10, 4),
	"fx_alert_currency" varchar(10),
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_notif_prefs_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "exchange_rate_alerts" ADD CONSTRAINT "exchange_rate_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_transfers" ADD CONSTRAINT "scheduled_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_transfers" ADD CONSTRAINT "scheduled_transfers_beneficiary_id_beneficiaries_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."beneficiaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notif_prefs" ADD CONSTRAINT "user_notif_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;