CREATE TYPE "public"."investment_asset_type" AS ENUM('stock', 'etf', 'commodity', 'crypto', 'mining_share', 'real_estate', 'bond', 'index_fund');--> statement-breakpoint
CREATE TYPE "public"."user_investment_status" AS ENUM('pending', 'active', 'sold', 'cancelled', 'matured');--> statement-breakpoint
CREATE TABLE "investment_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"name" varchar(200) NOT NULL,
	"asset_type" "investment_asset_type" NOT NULL,
	"exchange" varchar(50),
	"country" varchar(64),
	"sector" varchar(100),
	"current_price" numeric(18, 6) DEFAULT '0',
	"currency" varchar(10) DEFAULT 'USD',
	"price_change_24h" numeric(10, 4) DEFAULT '0',
	"price_change_pct_24h" numeric(10, 4) DEFAULT '0',
	"market_cap" numeric(24, 2),
	"volume_24h" numeric(24, 2),
	"description" text,
	"logo_url" text,
	"min_investment" numeric(18, 2) DEFAULT '10',
	"is_active" boolean DEFAULT true,
	"is_featured" boolean DEFAULT false,
	"tags" json DEFAULT '[]'::json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"order_type" varchar(10) DEFAULT 'buy',
	"quantity" numeric(18, 8) NOT NULL,
	"price_at_order" numeric(18, 6) NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'USD',
	"status" varchar(20) DEFAULT 'completed',
	"fee" numeric(10, 4) DEFAULT '0',
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"alert_price" numeric(18, 6),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_investments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"status" "user_investment_status" DEFAULT 'active',
	"quantity" numeric(18, 8) NOT NULL,
	"purchase_price" numeric(18, 6) NOT NULL,
	"current_value" numeric(18, 2),
	"currency" varchar(10) DEFAULT 'USD',
	"purchased_at" timestamp DEFAULT now() NOT NULL,
	"sold_at" timestamp,
	"sold_price" numeric(18, 6),
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investment_orders" ADD CONSTRAINT "investment_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_orders" ADD CONSTRAINT "investment_orders_asset_id_investment_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."investment_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_watchlist" ADD CONSTRAINT "investment_watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_watchlist" ADD CONSTRAINT "investment_watchlist_asset_id_investment_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."investment_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_investments" ADD CONSTRAINT "user_investments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_investments" ADD CONSTRAINT "user_investments_asset_id_investment_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."investment_assets"("id") ON DELETE no action ON UPDATE no action;