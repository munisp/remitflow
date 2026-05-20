CREATE TYPE "public"."payment_rail" AS ENUM('mojaloop', 'cips', 'upi', 'pix', 'swift', 'sepa', 'ach', 'bricspay', 'mbridge', 'ghipss', 'africbdc', 'papss');--> statement-breakpoint
CREATE TABLE "africbdc_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"transfer_id" varchar(100) NOT NULL,
	"cbdc_ref" varchar(100),
	"cbdc_type" varchar(20) NOT NULL,
	"send_amount" numeric(18, 6) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"country" varchar(3) NOT NULL,
	"sender_wallet" varchar(200) NOT NULL,
	"receiver_wallet" varchar(200) NOT NULL,
	"sender_name" varchar(200),
	"receiver_name" varchar(200),
	"purpose" varchar(100),
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"mojaloop_routed" boolean DEFAULT false,
	"cbdc_status" varchar(20),
	"error_message" text,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "africbdc_transfers_transfer_id_unique" UNIQUE("transfer_id")
);
--> statement-breakpoint
CREATE TABLE "bricspay_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"transfer_id" varchar(100) NOT NULL,
	"dcms_message_id" varchar(100),
	"sender_country" varchar(3) NOT NULL,
	"receiver_country" varchar(3) NOT NULL,
	"send_amount" numeric(18, 6) NOT NULL,
	"send_currency" varchar(10) NOT NULL,
	"receive_currency" varchar(10) NOT NULL,
	"receive_amount" numeric(18, 6),
	"exchange_rate" numeric(18, 8),
	"sender_vpa" varchar(200),
	"receiver_vpa" varchar(200) NOT NULL,
	"sender_name" varchar(200),
	"receiver_name" varchar(200),
	"purpose" varchar(50),
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"mojaloop_routed" boolean DEFAULT false,
	"error_message" text,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bricspay_transfers_transfer_id_unique" UNIQUE("transfer_id")
);
--> statement-breakpoint
CREATE TABLE "ghipss_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"transfer_id" varchar(100) NOT NULL,
	"ghipss_ref" varchar(100),
	"transfer_type" varchar(20) NOT NULL,
	"send_amount" numeric(18, 6) NOT NULL,
	"send_currency" varchar(10) NOT NULL,
	"receive_currency" varchar(10),
	"receive_amount" numeric(18, 6),
	"sender_account" varchar(200) NOT NULL,
	"receiver_account" varchar(200) NOT NULL,
	"receiver_bank" varchar(50),
	"receiver_msisdn" varchar(20),
	"sender_name" varchar(200),
	"receiver_name" varchar(200),
	"narration" varchar(500),
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"mojaloop_routed" boolean DEFAULT false,
	"papss_routed" boolean DEFAULT false,
	"error_message" text,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ghipss_transfers_transfer_id_unique" UNIQUE("transfer_id")
);
--> statement-breakpoint
CREATE TABLE "mbridge_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"transfer_id" varchar(100) NOT NULL,
	"dlt_tx_hash" varchar(100),
	"sender_country" varchar(3) NOT NULL,
	"receiver_country" varchar(3) NOT NULL,
	"send_amount" numeric(18, 6) NOT NULL,
	"send_cbdc" varchar(20) NOT NULL,
	"receive_cbdc" varchar(20) NOT NULL,
	"receive_amount" numeric(18, 6),
	"exchange_rate" numeric(18, 8),
	"sender_cbdc_address" varchar(200),
	"receiver_cbdc_address" varchar(200) NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"mojaloop_routed" boolean DEFAULT false,
	"settlement_time_ms" integer,
	"error_message" text,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mbridge_transfers_transfer_id_unique" UNIQUE("transfer_id")
);
--> statement-breakpoint
CREATE TABLE "papss_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"transfer_id" varchar(100) NOT NULL,
	"papss_ref" varchar(100),
	"sender_country" varchar(3) NOT NULL,
	"receiver_country" varchar(3) NOT NULL,
	"send_amount" numeric(18, 6) NOT NULL,
	"send_currency" varchar(10) NOT NULL,
	"receive_currency" varchar(10) NOT NULL,
	"receive_amount" numeric(18, 6),
	"exchange_rate" numeric(18, 8),
	"sender_account" varchar(200) NOT NULL,
	"receiver_account" varchar(200) NOT NULL,
	"sender_bank_code" varchar(20),
	"receiver_bank_code" varchar(20),
	"sender_name" varchar(200),
	"receiver_name" varchar(200),
	"narration" varchar(500),
	"corridor" varchar(10),
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"mojaloop_routed" boolean DEFAULT false,
	"ghipss_routed" boolean DEFAULT false,
	"netting_batch_id" varchar(100),
	"settled_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "papss_transfers_transfer_id_unique" UNIQUE("transfer_id")
);
--> statement-breakpoint
CREATE TABLE "rail_health_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"rail" "payment_rail" NOT NULL,
	"status" varchar(20) DEFAULT 'unknown' NOT NULL,
	"latency_ms" integer,
	"last_checked_at" timestamp DEFAULT now() NOT NULL,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
ALTER TABLE "africbdc_transfers" ADD CONSTRAINT "africbdc_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bricspay_transfers" ADD CONSTRAINT "bricspay_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ghipss_transfers" ADD CONSTRAINT "ghipss_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mbridge_transfers" ADD CONSTRAINT "mbridge_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "papss_transfers" ADD CONSTRAINT "papss_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;