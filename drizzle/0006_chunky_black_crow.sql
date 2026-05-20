CREATE TABLE "flutterwave_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"flw_ref" varchar(100) NOT NULL,
	"tx_ref" varchar(100) NOT NULL,
	"amount_usd" numeric(18, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'USD' NOT NULL,
	"payment_link" text,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"wallet_credited" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "flutterwave_transactions_flw_ref_unique" UNIQUE("flw_ref"),
	CONSTRAINT "flutterwave_transactions_tx_ref_unique" UNIQUE("tx_ref")
);
--> statement-breakpoint
CREATE TABLE "ngx_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stock_id" integer NOT NULL,
	"order_type" varchar(20) NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"quantity_units" numeric(18, 6) NOT NULL,
	"price_per_unit_ngn" numeric(18, 4) NOT NULL,
	"total_amount_ngn" numeric(24, 2) NOT NULL,
	"total_amount_usd" numeric(18, 2),
	"fx_rate_used" numeric(18, 6),
	"broker_reference" varchar(100),
	"broker_name" varchar(100) DEFAULT 'Bamboo' NOT NULL,
	"executed_at" timestamp,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ngx_stocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" varchar(20) NOT NULL,
	"name" varchar(200) NOT NULL,
	"sector" varchar(100) NOT NULL,
	"exchange" varchar(20) DEFAULT 'NGX' NOT NULL,
	"current_price_ngn" numeric(18, 4) NOT NULL,
	"previous_close_ngn" numeric(18, 4),
	"change_percent" numeric(8, 4),
	"market_cap_ngn" numeric(24, 2),
	"pe_ratio" numeric(10, 2),
	"dividend_yield" numeric(8, 4),
	"week_52_high" numeric(18, 4),
	"week_52_low" numeric(18, 4),
	"description" text,
	"logo_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ngx_stocks_ticker_unique" UNIQUE("ticker")
);
--> statement-breakpoint
CREATE TABLE "paypal_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"paypal_order_id" varchar(100) NOT NULL,
	"paypal_capture_id" varchar(100),
	"amount_usd" numeric(18, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'USD' NOT NULL,
	"status" varchar(30) DEFAULT 'created' NOT NULL,
	"wallet_credited" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "paypal_transactions_paypal_order_id_unique" UNIQUE("paypal_order_id")
);
--> statement-breakpoint
CREATE TABLE "real_estate_investments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"listing_id" integer NOT NULL,
	"shares_owned" integer NOT NULL,
	"price_per_share_paid" numeric(18, 2) NOT NULL,
	"total_invested_usd" numeric(18, 2) NOT NULL,
	"ownership_pct" numeric(8, 6) NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"returns_paid_usd" numeric(18, 2) DEFAULT '0',
	"last_return_date" timestamp,
	"invested_at" timestamp DEFAULT now() NOT NULL,
	"exited_at" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "real_estate_listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(300) NOT NULL,
	"description" text NOT NULL,
	"property_type" varchar(50) NOT NULL,
	"location" varchar(200) NOT NULL,
	"city" varchar(100) NOT NULL,
	"state" varchar(100) NOT NULL,
	"total_value_ngn" numeric(24, 2) NOT NULL,
	"total_value_usd" numeric(18, 2) NOT NULL,
	"minimum_investment_usd" numeric(18, 2) NOT NULL,
	"total_shares" integer NOT NULL,
	"available_shares" integer NOT NULL,
	"price_per_share_usd" numeric(18, 2) NOT NULL,
	"expected_annual_return_pct" numeric(8, 2),
	"rental_yield_pct" numeric(8, 2),
	"appreciation_pct" numeric(8, 2),
	"tenure_years" integer,
	"status" varchar(30) DEFAULT 'open' NOT NULL,
	"image_urls" json DEFAULT '[]'::json,
	"documents" json DEFAULT '[]'::json,
	"developer_name" varchar(200),
	"developer_rating" numeric(3, 1),
	"completion_date" timestamp,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "startup_deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name" varchar(200) NOT NULL,
	"tagline" varchar(300) NOT NULL,
	"description" text NOT NULL,
	"sector" varchar(100) NOT NULL,
	"stage" varchar(50) NOT NULL,
	"location" varchar(200) NOT NULL,
	"founded_year" integer,
	"team_size" integer,
	"target_raise_usd" numeric(18, 2) NOT NULL,
	"raised_so_far_usd" numeric(18, 2) DEFAULT '0',
	"minimum_ticket_usd" numeric(18, 2) NOT NULL,
	"valuation_usd" numeric(24, 2),
	"equity_offered_pct" numeric(8, 4),
	"instrument_type" varchar(50) DEFAULT 'SAFE' NOT NULL,
	"status" varchar(30) DEFAULT 'open' NOT NULL,
	"website_url" text,
	"pitch_deck_url" text,
	"logo_url" text,
	"image_urls" json DEFAULT '[]'::json,
	"highlights" json DEFAULT '[]'::json,
	"risks" json DEFAULT '[]'::json,
	"metrics" json DEFAULT '[]'::json,
	"closing_date" timestamp,
	"is_featured" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "startup_investments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"deal_id" integer NOT NULL,
	"amount_usd" numeric(18, 2) NOT NULL,
	"instrument_type" varchar(50) NOT NULL,
	"equity_pct" numeric(10, 6),
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"payment_method" varchar(50) DEFAULT 'wallet',
	"agreement_signed" boolean DEFAULT false NOT NULL,
	"agreement_url" text,
	"notes" text,
	"invested_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	"exited_at" timestamp,
	"exit_value_usd" numeric(18, 2),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_watchlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stock_id" integer NOT NULL,
	"alert_price_ngn" numeric(18, 4),
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flutterwave_transactions" ADD CONSTRAINT "flutterwave_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ngx_orders" ADD CONSTRAINT "ngx_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ngx_orders" ADD CONSTRAINT "ngx_orders_stock_id_ngx_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."ngx_stocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paypal_transactions" ADD CONSTRAINT "paypal_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_investments" ADD CONSTRAINT "real_estate_investments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_investments" ADD CONSTRAINT "real_estate_investments_listing_id_real_estate_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."real_estate_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_investments" ADD CONSTRAINT "startup_investments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "startup_investments" ADD CONSTRAINT "startup_investments_deal_id_startup_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."startup_deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_watchlists" ADD CONSTRAINT "stock_watchlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_watchlists" ADD CONSTRAINT "stock_watchlists_stock_id_ngx_stocks_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."ngx_stocks"("id") ON DELETE no action ON UPDATE no action;