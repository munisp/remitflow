CREATE TABLE "correspondent_banks_v200" (
	"id" serial PRIMARY KEY NOT NULL,
	"correspondent_id" varchar(100) NOT NULL,
	"bank_name" varchar(200) NOT NULL,
	"swift_code" varchar(11) NOT NULL,
	"country_code" varchar(2),
	"currency" varchar(3),
	"clearing_line_usd" numeric(18, 2) DEFAULT '0',
	"nostro_balance_usd" numeric(18, 2) DEFAULT '0',
	"vostro_balance_usd" numeric(18, 2) DEFAULT '0',
	"utilization_pct" numeric(5, 2) DEFAULT '0',
	"fee_bps" numeric(6, 2) DEFAULT '50',
	"settlement_rail" varchar(20) DEFAULT 'swift',
	"status" varchar(20) DEFAULT 'active',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "correspondent_banks_v200_correspondent_id_unique" UNIQUE("correspondent_id")
);
--> statement-breakpoint
CREATE TABLE "correspondent_settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"correspondent_id" varchar(100) NOT NULL,
	"direction" varchar(30) NOT NULL,
	"amount_usd" numeric(18, 2),
	"currency" varchar(3),
	"status" varchar(20) DEFAULT 'pending',
	"reference" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diaspora_offer_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"offer_type" varchar(50) NOT NULL,
	"diaspora_region" varchar(20),
	"status" varchar(20) DEFAULT 'active',
	"claimed_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "diaspora_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"diaspora_region" varchar(20) NOT NULL,
	"country_of_residence" varchar(2),
	"home_corridor" varchar(5) DEFAULT 'NG',
	"preferred_payment_rail" varchar(20),
	"avg_transfer_amount_usd" numeric(12, 2) DEFAULT '0',
	"transfer_frequency_per_year" numeric(5, 1) DEFAULT '0',
	"total_transferred_ytd_usd" numeric(18, 2) DEFAULT '0',
	"cross_sell_score" numeric(4, 3) DEFAULT '0',
	"acquisition_channel" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hnw_client_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"aum_tier" varchar(20) DEFAULT 'standard',
	"negotiated_spread_bps" numeric(6, 2) DEFAULT '150.00',
	"rm_name" varchar(100),
	"rm_email" varchar(200),
	"rm_phone" varchar(30),
	"max_rate_lock_amount_ngn" numeric(18, 2),
	"preferred_currencies" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "hnw_client_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "hnw_rate_locks" (
	"id" serial PRIMARY KEY NOT NULL,
	"lock_id" varchar(100) NOT NULL,
	"user_id" integer NOT NULL,
	"corridor_code" varchar(5) NOT NULL,
	"amount_ngn" numeric(18, 2),
	"fx_rate" numeric(18, 8),
	"spread_bps" numeric(6, 2),
	"status" varchar(20) DEFAULT 'active',
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hnw_rate_locks_lock_id_unique" UNIQUE("lock_id")
);
--> statement-breakpoint
CREATE TABLE "hnw_rm_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"message" text NOT NULL,
	"preferred_contact_time" varchar(100),
	"topic" varchar(50) DEFAULT 'general',
	"status" varchar(20) DEFAULT 'pending',
	"rm_response" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "hnw_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" varchar(100) NOT NULL,
	"user_id" integer NOT NULL,
	"rate_lock_id" varchar(100),
	"corridor_code" varchar(5) NOT NULL,
	"amount_ngn" numeric(18, 2),
	"fx_rate" numeric(18, 8),
	"recipient_swift" varchar(11),
	"recipient_account" varchar(34),
	"recipient_name" varchar(100),
	"purpose_code" varchar(10) DEFAULT 'PER',
	"status" varchar(30) DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hnw_transfers_transfer_id_unique" UNIQUE("transfer_id")
);
--> statement-breakpoint
CREATE TABLE "immigrant_worker_kyc" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kyc_tier" varchar(20) DEFAULT 'tier1',
	"nin" varchar(11),
	"bvn" varchar(11),
	"selfie_verified" boolean DEFAULT false,
	"document_type" varchar(50),
	"document_verified" boolean DEFAULT false,
	"monthly_limit_usd" numeric(12, 2) DEFAULT '500.00',
	"monthly_used_usd" numeric(12, 2) DEFAULT '0.00',
	"annual_limit_usd" numeric(12, 2) DEFAULT '5000.00',
	"annual_used_usd" numeric(12, 2) DEFAULT '0.00',
	"verification_provider" varchar(50),
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "immigrant_worker_kyc_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "sme_trade_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" varchar(100) NOT NULL,
	"user_id" integer NOT NULL,
	"corridor_code" varchar(5) NOT NULL,
	"total_payments" integer DEFAULT 0,
	"total_amount_usd" numeric(18, 2),
	"form_m_number" varchar(30),
	"batch_reference" varchar(100),
	"status" varchar(30) DEFAULT 'processing',
	"succeeded" integer DEFAULT 0,
	"failed" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "sme_trade_batches_batch_id_unique" UNIQUE("batch_id")
);
--> statement-breakpoint
CREATE TABLE "outbound_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"transfer_type" varchar(20) DEFAULT 'outbound',
	"rail" varchar(20),
	"corridor_code" varchar(5),
	"amount_ngn" numeric(18, 2),
	"amount_foreign" numeric(18, 2),
	"foreign_currency" varchar(3),
	"fx_rate" numeric(18, 8),
	"fees_ngn" numeric(18, 2),
	"recipient_name" varchar(100),
	"recipient_account" varchar(34),
	"recipient_swift" varchar(11),
	"purpose_code" varchar(10),
	"status" varchar(30) DEFAULT 'pending',
	"external_ref" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "west_africa_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" varchar(100) NOT NULL,
	"user_id" integer NOT NULL,
	"corridor_code" varchar(5) NOT NULL,
	"amount_ngn" numeric(18, 2),
	"amount_xof" numeric(18, 2),
	"fx_rate" numeric(18, 8),
	"fees_ngn" numeric(18, 2),
	"recipient_mobile_money" varchar(30) NOT NULL,
	"recipient_name" varchar(100) NOT NULL,
	"mojaloop_dfsp_id" varchar(50),
	"mojaloop_txn_id" varchar(100),
	"purpose_code" varchar(10) DEFAULT 'FAM',
	"status" varchar(30) DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "west_africa_transfers_transfer_id_unique" UNIQUE("transfer_id")
);
