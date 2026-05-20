CREATE TABLE "cbn_corridors" (
	"id" serial PRIMARY KEY NOT NULL,
	"corridor" varchar(20) NOT NULL,
	"papss_enabled" boolean DEFAULT false NOT NULL,
	"exchange_rate" varchar(30),
	"transfer_fee_percent" varchar(10),
	"settlement_time_hours" integer DEFAULT 24,
	"min_amount_usd" integer DEFAULT 1,
	"max_amount_usd" integer DEFAULT 50000,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cbn_corridors_corridor_unique" UNIQUE("corridor")
);
