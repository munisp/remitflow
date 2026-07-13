-- ─── Migration 0056: Stablecoin On-Ramp / Off-Ramp / Reserve / Bridge ─────────
-- Adds 6 missing tables critical for production stablecoin operations.

-- On-Ramp Transactions
CREATE TABLE IF NOT EXISTS "onramp_transactions" (
  "id"                  SERIAL PRIMARY KEY,
  "user_id"             INTEGER NOT NULL REFERENCES "users"("id"),
  "tx_ref"              VARCHAR(100) NOT NULL UNIQUE,
  "fiat_currency"       VARCHAR(10) NOT NULL,
  "fiat_amount"         NUMERIC(18,2) NOT NULL,
  "stablecoin"          VARCHAR(20) NOT NULL,
  "stablecoin_amount"   NUMERIC(18,8) NOT NULL,
  "chain"               VARCHAR(50) NOT NULL DEFAULT 'ethereum',
  "provider"            VARCHAR(50) NOT NULL DEFAULT 'internal',
  "wallet_address"      VARCHAR(200),
  "fee"                 NUMERIC(18,8) DEFAULT 0,
  "fx_rate"             NUMERIC(18,8),
  "status"              VARCHAR(30) NOT NULL DEFAULT 'pending',
  "provider_ref"        VARCHAR(200),
  "chain_tx_hash"       VARCHAR(200),
  "kyc_tier"            VARCHAR(20),
  "travel_rule_applied" BOOLEAN DEFAULT FALSE,
  "depeg_warning"       BOOLEAN DEFAULT FALSE,
  "completed_at"        TIMESTAMPTZ,
  "created_at"          TIMESTAMPTZ DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_onramp_user_id"    ON "onramp_transactions"("user_id");
CREATE INDEX IF NOT EXISTS "idx_onramp_status"     ON "onramp_transactions"("status");
CREATE INDEX IF NOT EXISTS "idx_onramp_stablecoin" ON "onramp_transactions"("stablecoin");
CREATE INDEX IF NOT EXISTS "idx_onramp_created_at" ON "onramp_transactions"("created_at" DESC);

-- Off-Ramp Transactions
CREATE TABLE IF NOT EXISTS "offramp_transactions" (
  "id"                   SERIAL PRIMARY KEY,
  "user_id"              INTEGER NOT NULL REFERENCES "users"("id"),
  "tx_ref"               VARCHAR(100) NOT NULL UNIQUE,
  "stablecoin"           VARCHAR(20) NOT NULL,
  "stablecoin_amount"    NUMERIC(18,8) NOT NULL,
  "fiat_currency"        VARCHAR(10) NOT NULL,
  "fiat_amount"          NUMERIC(18,2) NOT NULL,
  "net_payout"           NUMERIC(18,2) NOT NULL,
  "fee"                  NUMERIC(18,8) DEFAULT 0,
  "fx_rate"              NUMERIC(18,8),
  "payout_rail"          VARCHAR(50) NOT NULL DEFAULT 'bank_transfer',
  "bank_account_id"      INTEGER,
  "mobile_money_number"  VARCHAR(30),
  "status"               VARCHAR(30) NOT NULL DEFAULT 'processing',
  "provider_ref"         VARCHAR(200),
  "kyc_tier"             VARCHAR(20),
  "travel_rule_applied"  BOOLEAN DEFAULT FALSE,
  "depeg_warning"        BOOLEAN DEFAULT FALSE,
  "completed_at"         TIMESTAMPTZ,
  "created_at"           TIMESTAMPTZ DEFAULT NOW(),
  "updated_at"           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_offramp_user_id"    ON "offramp_transactions"("user_id");
CREATE INDEX IF NOT EXISTS "idx_offramp_status"     ON "offramp_transactions"("status");
CREATE INDEX IF NOT EXISTS "idx_offramp_stablecoin" ON "offramp_transactions"("stablecoin");
CREATE INDEX IF NOT EXISTS "idx_offramp_created_at" ON "offramp_transactions"("created_at" DESC);

-- Stablecoin Reserves (Proof-of-Reserve)
CREATE TABLE IF NOT EXISTS "stablecoin_reserves" (
  "id"                SERIAL PRIMARY KEY,
  "symbol"            VARCHAR(20) NOT NULL,
  "on_chain_balance"  NUMERIC(28,8) NOT NULL DEFAULT 0,
  "platform_balance"  NUMERIC(28,8) NOT NULL DEFAULT 0,
  "reserve_ratio"     NUMERIC(10,6) NOT NULL DEFAULT 1.000000,
  "custodian"         VARCHAR(100),
  "attestation_url"   TEXT,
  "last_verified_at"  TIMESTAMPTZ,
  "status"            VARCHAR(30) NOT NULL DEFAULT 'unverified',
  "created_at"        TIMESTAMPTZ DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_stablecoin_reserves_symbol" ON "stablecoin_reserves"("symbol");

-- Seed initial reserve rows for all supported stablecoins
INSERT INTO "stablecoin_reserves" ("symbol", "status") VALUES
  ('USDC',  'unverified'),
  ('USDT',  'unverified'),
  ('DAI',   'unverified'),
  ('PYUSD', 'unverified'),
  ('EURC',  'unverified'),
  ('NGNT',  'unverified'),
  ('cUSD',  'unverified'),
  ('BUSD',  'unverified')
ON CONFLICT DO NOTHING;

-- Bridge Transactions
CREATE TABLE IF NOT EXISTS "bridge_transactions" (
  "id"                SERIAL PRIMARY KEY,
  "user_id"           INTEGER NOT NULL REFERENCES "users"("id"),
  "bridge_id"         VARCHAR(100) NOT NULL UNIQUE,
  "stablecoin"        VARCHAR(20) NOT NULL,
  "amount"            NUMERIC(18,8) NOT NULL,
  "net_amount"        NUMERIC(18,8) NOT NULL,
  "from_chain"        VARCHAR(50) NOT NULL,
  "to_chain"          VARCHAR(50) NOT NULL,
  "bridge_fee"        NUMERIC(18,8) DEFAULT 0,
  "gas_fee"           NUMERIC(18,8) DEFAULT 0,
  "source_tx_hash"    VARCHAR(200),
  "dest_tx_hash"      VARCHAR(200),
  "status"            VARCHAR(30) NOT NULL DEFAULT 'initiated',
  "estimated_minutes" INTEGER,
  "completed_at"      TIMESTAMPTZ,
  "created_at"        TIMESTAMPTZ DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_bridge_user_id"    ON "bridge_transactions"("user_id");
CREATE INDEX IF NOT EXISTS "idx_bridge_status"     ON "bridge_transactions"("status");
CREATE INDEX IF NOT EXISTS "idx_bridge_stablecoin" ON "bridge_transactions"("stablecoin");

-- Stablecoin De-Peg Events
CREATE TABLE IF NOT EXISTS "stablecoin_depeg_events" (
  "id"                SERIAL PRIMARY KEY,
  "symbol"            VARCHAR(20) NOT NULL,
  "price"             NUMERIC(10,6) NOT NULL,
  "target_price"      NUMERIC(10,6) NOT NULL DEFAULT 1.000000,
  "deviation_percent" NUMERIC(8,4) NOT NULL,
  "severity"          VARCHAR(20) NOT NULL DEFAULT 'warning',
  "source"            VARCHAR(50) DEFAULT 'oracle',
  "onramp_suspended"  BOOLEAN DEFAULT FALSE,
  "resolved_at"       TIMESTAMPTZ,
  "created_at"        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_depeg_symbol"     ON "stablecoin_depeg_events"("symbol");
CREATE INDEX IF NOT EXISTS "idx_depeg_created_at" ON "stablecoin_depeg_events"("created_at" DESC);

-- Stablecoin Yield Positions
CREATE TABLE IF NOT EXISTS "stablecoin_yield_positions" (
  "id"            SERIAL PRIMARY KEY,
  "user_id"       INTEGER NOT NULL REFERENCES "users"("id"),
  "stablecoin"    VARCHAR(20) NOT NULL,
  "protocol"      VARCHAR(100) NOT NULL,
  "chain"         VARCHAR(50) NOT NULL,
  "principal"     NUMERIC(18,8) NOT NULL,
  "current_value" NUMERIC(18,8) NOT NULL,
  "accrued_yield" NUMERIC(18,8) DEFAULT 0,
  "apy_percent"   NUMERIC(8,4),
  "status"        VARCHAR(30) NOT NULL DEFAULT 'active',
  "entered_at"    TIMESTAMPTZ DEFAULT NOW(),
  "exited_at"     TIMESTAMPTZ,
  "created_at"    TIMESTAMPTZ DEFAULT NOW(),
  "updated_at"    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_yield_user_id"    ON "stablecoin_yield_positions"("user_id");
CREATE INDEX IF NOT EXISTS "idx_yield_stablecoin" ON "stablecoin_yield_positions"("stablecoin");
CREATE INDEX IF NOT EXISTS "idx_yield_status"     ON "stablecoin_yield_positions"("status");
