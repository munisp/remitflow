CREATE TYPE "public"."cross_sell_offer_status" AS ENUM('pending', 'shown', 'accepted', 'dismissed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."cross_sell_offer_type" AS ENUM('savings_account', 'diaspora_bond', 'insurance', 'investment_fund', 'credit_card');--> statement-breakpoint
CREATE TABLE "cross_sell_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"offer_type" "cross_sell_offer_type" NOT NULL,
	"score" numeric(5, 4) NOT NULL,
	"segment" varchar(30),
	"headline" varchar(200),
	"body" text,
	"cta_label" varchar(100),
	"cta_url" varchar(500),
	"status" "cross_sell_offer_status" DEFAULT 'pending' NOT NULL,
	"shown_at" timestamp,
	"responded_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_annual_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"purpose_code" varchar(20) NOT NULL,
	"calendar_year" integer NOT NULL,
	"used_usd" numeric(18, 2) DEFAULT '0.00' NOT NULL,
	"last_transaction_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cross_sell_offers" ADD CONSTRAINT "cross_sell_offers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_annual_usage" ADD CONSTRAINT "outbound_annual_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;