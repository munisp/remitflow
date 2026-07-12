-- P2P Instant Payments — alias directory, payment requests, and transfer ledger
-- These tables back server/routers/p2pInstant.ts (wired at appRouter.p2p) but were
-- never captured in a migration, so the feature would fail at runtime. Idempotent
-- so it is safe to (re)apply on any environment.

-- ── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "p2p_alias_type" AS ENUM('phone', 'email');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "p2p_alias_status" AS ENUM('active', 'pending_verification', 'suspended', 'deactivated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "p2p_request_status" AS ENUM('pending', 'approved', 'declined', 'expired', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "p2p_transfer_status" AS ENUM('initiated', 'alias_resolved', 'quoted', 'compliance_cleared', 'debited', 'fx_converted', 'settling', 'completed', 'failed', 'compensated', 'disputed', 'escrowed', 'streaming', 'scheduled', 'pending', 'cancelled', 'favorite');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "p2p_transfer_rail" AS ENUM('internal', 'mojaloop', 'papss', 'mpesa', 'upi', 'pix', 'sepa', 'fednow', 'swift', 'batch', 'ilp_stream', 'escrow', 'favorite', 'scheduled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── payment_aliases ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payment_aliases" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "alias_type" "p2p_alias_type" NOT NULL,
  "alias_value" varchar(320) NOT NULL,
  "normalized_value" varchar(320) NOT NULL,
  "currency" varchar(8) NOT NULL,
  "wallet_id" integer,
  "country" varchar(3) NOT NULL,
  "fsp_id" varchar(64) DEFAULT 'remitflow-fsp',
  "status" "p2p_alias_status" DEFAULT 'active' NOT NULL,
  "is_primary" boolean DEFAULT false,
  "verified_at" timestamp,
  "mojaloop_registered" boolean DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "payment_aliases_normalized_unique" ON "payment_aliases" USING btree ("normalized_value","alias_type");
CREATE INDEX IF NOT EXISTS "payment_aliases_user_idx" ON "payment_aliases" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "payment_aliases_country_idx" ON "payment_aliases" USING btree ("country");

-- ── p2p_payment_requests ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "p2p_payment_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "requester_id" integer NOT NULL,
  "requester_alias" varchar(320) NOT NULL,
  "payer_alias" varchar(320) NOT NULL,
  "payer_id" integer,
  "amount" numeric(18, 2) NOT NULL,
  "currency" varchar(8) NOT NULL,
  "note" varchar(500),
  "status" "p2p_request_status" DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp NOT NULL,
  "responded_at" timestamp,
  "transfer_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "p2p_payment_requests_payer_idx" ON "p2p_payment_requests" USING btree ("payer_alias");
CREATE INDEX IF NOT EXISTS "p2p_payment_requests_requester_idx" ON "p2p_payment_requests" USING btree ("requester_id");
CREATE INDEX IF NOT EXISTS "p2p_payment_requests_status_idx" ON "p2p_payment_requests" USING btree ("status");

-- ── p2p_transfers ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "p2p_transfers" (
  "id" serial PRIMARY KEY NOT NULL,
  "sender_id" integer NOT NULL,
  "sender_alias" varchar(320),
  "receiver_alias" varchar(320) NOT NULL,
  "receiver_id" integer,
  "receiver_fsp_id" varchar(64),
  "send_amount" numeric(18, 2) NOT NULL,
  "send_currency" varchar(8) NOT NULL,
  "receive_amount" numeric(18, 2),
  "receive_currency" varchar(8),
  "fx_rate" numeric(18, 8),
  "fee" numeric(18, 2) DEFAULT '0.00',
  "rail" "p2p_transfer_rail",
  "corridor_code" varchar(10),
  "status" "p2p_transfer_status" DEFAULT 'initiated' NOT NULL,
  "mojaloop_transfer_id" varchar(64),
  "ilp_condition" varchar(128),
  "ilp_fulfillment" varchar(128),
  "aml_check_id" varchar(64),
  "fraud_score" numeric(5, 4),
  "payment_request_id" integer,
  "note" varchar(500),
  "idempotency_key" varchar(128),
  "completed_at" timestamp,
  "failed_at" timestamp,
  "failure_reason" varchar(500),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "p2p_transfers_idempotency_key_unique" UNIQUE("idempotency_key")
);
CREATE INDEX IF NOT EXISTS "p2p_transfers_sender_idx" ON "p2p_transfers" USING btree ("sender_id");
CREATE INDEX IF NOT EXISTS "p2p_transfers_receiver_idx" ON "p2p_transfers" USING btree ("receiver_id");
CREATE INDEX IF NOT EXISTS "p2p_transfers_status_idx" ON "p2p_transfers" USING btree ("status");
CREATE INDEX IF NOT EXISTS "p2p_transfers_idempotency_idx" ON "p2p_transfers" USING btree ("idempotency_key");
CREATE INDEX IF NOT EXISTS "p2p_transfers_corridor_idx" ON "p2p_transfers" USING btree ("corridor_code");
