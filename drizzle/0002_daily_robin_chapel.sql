CREATE TABLE "investment_price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"open" numeric(18, 6) NOT NULL,
	"high" numeric(18, 6) NOT NULL,
	"low" numeric(18, 6) NOT NULL,
	"close" numeric(18, 6) NOT NULL,
	"volume" numeric(24, 2) DEFAULT '0',
	"timestamp" timestamp NOT NULL,
	"interval" varchar(10) DEFAULT '1d'
);
--> statement-breakpoint
ALTER TABLE "investment_price_history" ADD CONSTRAINT "investment_price_history_asset_id_investment_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."investment_assets"("id") ON DELETE no action ON UPDATE no action;