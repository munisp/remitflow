-- ============================================================
-- Migration 0057: Stablecoin Innovation Tables
-- RemitFlow — DeFi Yield, Multi-Chain Bridge, AMM, CBDC, Oracle
-- ============================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE yield_position_status AS ENUM ('active','withdrawn','emergency_exit','liquidated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE bridge_tx_status AS ENUM ('pending','source_confirmed','bridge_in_flight','dest_confirmed','completed','failed','refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cbdc_tx_type AS ENUM ('transfer','swap','mbridge_transfer','mint','burn','programmable_lock','programmable_release');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE programmable_condition_type AS ENUM ('time_lock','escrow','conditional_release','multi_sig');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE circuit_breaker_severity AS ENUM ('ok','warning','critical','suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE amm_protocol AS ENUM ('uniswap-v2','uniswap-v3','curve','balancer','pancakeswap','quickswap');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- DeFi Yield Positions
CREATE TABLE IF NOT EXISTS defi_yield_positions (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          INTEGER NOT NULL,
  protocol_id      TEXT NOT NULL,
  protocol_name    TEXT NOT NULL,
  chain            TEXT NOT NULL,
  symbol           TEXT NOT NULL,
  principal        NUMERIC(28,8) NOT NULL,
  current_value    NUMERIC(28,8) NOT NULL,
  accrued_yield    NUMERIC(28,8) NOT NULL DEFAULT 0,
  apy              NUMERIC(10,4) NOT NULL,
  risk_score       NUMERIC(5,2),
  auto_compound    BOOLEAN NOT NULL DEFAULT FALSE,
  last_compound_at TIMESTAMPTZ,
  status           yield_position_status NOT NULL DEFAULT 'active',
  entered_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exited_at        TIMESTAMPTZ,
  metadata         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS defi_yield_user_idx     ON defi_yield_positions(user_id);
CREATE INDEX IF NOT EXISTS defi_yield_protocol_idx ON defi_yield_positions(protocol_id);
CREATE INDEX IF NOT EXISTS defi_yield_status_idx   ON defi_yield_positions(status);
CREATE INDEX IF NOT EXISTS defi_yield_symbol_idx   ON defi_yield_positions(symbol);

-- Yield Auto-Compound Audit Log
CREATE TABLE IF NOT EXISTS yield_compound_log (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id   TEXT NOT NULL REFERENCES defi_yield_positions(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL,
  yield_earned  NUMERIC(28,8) NOT NULL,
  new_value     NUMERIC(28,8) NOT NULL,
  apy_at_time   NUMERIC(10,4),
  compounded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS yield_compound_position_idx ON yield_compound_log(position_id);
CREATE INDEX IF NOT EXISTS yield_compound_user_idx     ON yield_compound_log(user_id);

-- Multi-Chain Bridge Transactions
CREATE TABLE IF NOT EXISTS chain_bridge_transactions (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       INTEGER NOT NULL,
  protocol_id   TEXT NOT NULL,
  protocol_name TEXT NOT NULL,
  from_chain    TEXT NOT NULL,
  to_chain      TEXT NOT NULL,
  token         TEXT NOT NULL,
  amount        NUMERIC(28,8) NOT NULL,
  fee_usd       NUMERIC(14,4),
  gas_usd       NUMERIC(14,4),
  recipient     TEXT NOT NULL,
  src_tx_hash   TEXT,
  dst_tx_hash   TEXT,
  htlc_hash     TEXT,
  status        bridge_tx_status NOT NULL DEFAULT 'pending',
  retry_count   INTEGER NOT NULL DEFAULT 0,
  webhook_url   TEXT,
  error_message TEXT,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bridge_tx_user_idx       ON chain_bridge_transactions(user_id);
CREATE INDEX IF NOT EXISTS bridge_tx_status_idx     ON chain_bridge_transactions(status);
CREATE INDEX IF NOT EXISTS bridge_tx_from_chain_idx ON chain_bridge_transactions(from_chain);
CREATE INDEX IF NOT EXISTS bridge_tx_to_chain_idx   ON chain_bridge_transactions(to_chain);
CREATE INDEX IF NOT EXISTS bridge_tx_src_hash_idx   ON chain_bridge_transactions(src_tx_hash);

-- AMM Swap Execution Log
CREATE TABLE IF NOT EXISTS amm_swap_log (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          INTEGER NOT NULL,
  pool_id          TEXT NOT NULL,
  protocol         amm_protocol NOT NULL,
  chain            TEXT NOT NULL,
  token_in         TEXT NOT NULL,
  token_out        TEXT NOT NULL,
  amount_in        NUMERIC(28,8) NOT NULL,
  amount_out       NUMERIC(28,8) NOT NULL,
  price_impact_pct NUMERIC(8,4),
  fee_paid         NUMERIC(14,8),
  slippage_pct     NUMERIC(8,4),
  mev_protected    BOOLEAN NOT NULL DEFAULT FALSE,
  split_routing    BOOLEAN NOT NULL DEFAULT FALSE,
  tx_hash          TEXT,
  executed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS amm_swap_user_idx  ON amm_swap_log(user_id);
CREATE INDEX IF NOT EXISTS amm_swap_pool_idx  ON amm_swap_log(pool_id);
CREATE INDEX IF NOT EXISTS amm_swap_chain_idx ON amm_swap_log(chain);

-- AMM Liquidity Positions
CREATE TABLE IF NOT EXISTS amm_liquidity_positions (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       INTEGER NOT NULL,
  pool_id       TEXT NOT NULL,
  protocol      amm_protocol NOT NULL,
  chain         TEXT NOT NULL,
  token_a       TEXT NOT NULL,
  token_b       TEXT NOT NULL,
  amount_a      NUMERIC(28,8) NOT NULL,
  amount_b      NUMERIC(28,8) NOT NULL,
  share_pct     NUMERIC(10,6),
  fees_earned   NUMERIC(28,8) NOT NULL DEFAULT 0,
  in_range      BOOLEAN NOT NULL DEFAULT TRUE,
  tick_lower    INTEGER,
  tick_upper    INTEGER,
  last_rebal_at TIMESTAMPTZ,
  entered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exited_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS amm_lp_user_idx ON amm_liquidity_positions(user_id);
CREATE INDEX IF NOT EXISTS amm_lp_pool_idx ON amm_liquidity_positions(pool_id);

-- CBDC Wallet Balances
CREATE TABLE IF NOT EXISTS cbdc_wallet_balances (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    INTEGER NOT NULL,
  cbdc_code  TEXT NOT NULL,
  cbdc_name  TEXT NOT NULL,
  country    TEXT NOT NULL,
  currency   TEXT NOT NULL,
  balance    NUMERIC(28,8) NOT NULL DEFAULT 0,
  usd_value  NUMERIC(14,4),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cbdc_wallet_user_idx ON cbdc_wallet_balances(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS cbdc_wallet_unique ON cbdc_wallet_balances(user_id, cbdc_code);

-- CBDC Transaction Log
CREATE TABLE IF NOT EXISTS cbdc_transaction_log (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     INTEGER NOT NULL,
  tx_type     cbdc_tx_type NOT NULL,
  from_cbdc   TEXT,
  to_cbdc     TEXT,
  from_asset  TEXT,
  to_asset    TEXT,
  amount_in   NUMERIC(28,8) NOT NULL,
  amount_out  NUMERIC(28,8),
  usd_value   NUMERIC(14,4),
  recipient   TEXT,
  protocol    TEXT,
  tx_hash     TEXT,
  status      TEXT NOT NULL DEFAULT 'completed',
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cbdc_tx_user_idx   ON cbdc_transaction_log(user_id);
CREATE INDEX IF NOT EXISTS cbdc_tx_type_idx   ON cbdc_transaction_log(tx_type);
CREATE INDEX IF NOT EXISTS cbdc_tx_status_idx ON cbdc_transaction_log(status);

-- Programmable CBDC Conditions
CREATE TABLE IF NOT EXISTS programmable_cbdc_conditions (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         INTEGER NOT NULL,
  cbdc_code       TEXT NOT NULL,
  amount          NUMERIC(28,8) NOT NULL,
  condition_type  programmable_condition_type NOT NULL,
  unlock_at       TIMESTAMPTZ,
  condition_data  JSONB,
  status          TEXT NOT NULL DEFAULT 'locked',
  released_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS prog_cbdc_user_idx   ON programmable_cbdc_conditions(user_id);
CREATE INDEX IF NOT EXISTS prog_cbdc_status_idx ON programmable_cbdc_conditions(status);

-- Price Oracle Snapshots
CREATE TABLE IF NOT EXISTS price_oracle_snapshots (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol          TEXT NOT NULL,
  price           NUMERIC(28,12) NOT NULL,
  twap_1h         NUMERIC(28,12),
  twap_4h         NUMERIC(28,12),
  twap_24h        NUMERIC(28,12),
  deviation_pct   NUMERIC(8,4),
  severity        circuit_breaker_severity NOT NULL DEFAULT 'ok',
  circuit_breaker BOOLEAN NOT NULL DEFAULT FALSE,
  source_count    INTEGER NOT NULL DEFAULT 3,
  sources         JSONB,
  snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS oracle_snapshot_symbol_idx   ON price_oracle_snapshots(symbol);
CREATE INDEX IF NOT EXISTS oracle_snapshot_time_idx     ON price_oracle_snapshots(snapshot_at DESC);
CREATE INDEX IF NOT EXISTS oracle_snapshot_severity_idx ON price_oracle_snapshots(severity);

-- Depeg Circuit Breaker Events
CREATE TABLE IF NOT EXISTS depeg_circuit_breaker_events (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  deviation_pct   NUMERIC(8,4),
  price_at_event  NUMERIC(28,12),
  severity        circuit_breaker_severity NOT NULL,
  reason          TEXT,
  auto_reset_at   TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS depeg_cb_symbol_idx ON depeg_circuit_breaker_events(symbol);
CREATE INDEX IF NOT EXISTS depeg_cb_type_idx   ON depeg_circuit_breaker_events(event_type);

-- mBridge Cross-Border Settlement Log
CREATE TABLE IF NOT EXISTS mbridge_settlement_log (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     INTEGER NOT NULL,
  from_cbdc   TEXT NOT NULL,
  to_cbdc     TEXT NOT NULL,
  amount_in   NUMERIC(28,8) NOT NULL,
  amount_out  NUMERIC(28,8) NOT NULL,
  usd_value   NUMERIC(14,4),
  recipient   TEXT NOT NULL,
  purpose     TEXT,
  tx_hash     TEXT,
  status      TEXT NOT NULL DEFAULT 'completed',
  settled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mbridge_user_idx      ON mbridge_settlement_log(user_id);
CREATE INDEX IF NOT EXISTS mbridge_from_cbdc_idx ON mbridge_settlement_log(from_cbdc);
CREATE INDEX IF NOT EXISTS mbridge_to_cbdc_idx   ON mbridge_settlement_log(to_cbdc);

-- ML Depeg Predictions
CREATE TABLE IF NOT EXISTS ml_depeg_predictions (
  id                          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol                      TEXT NOT NULL,
  model_version               TEXT NOT NULL,
  prediction_horizon_minutes  INTEGER NOT NULL,
  predicted_price             NUMERIC(28,12),
  predicted_deviation_pct     NUMERIC(8,4),
  depeg_probability           NUMERIC(5,4),
  confidence                  NUMERIC(5,4),
  features                    JSONB,
  predicted_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until                 TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ml_depeg_symbol_idx    ON ml_depeg_predictions(symbol);
CREATE INDEX IF NOT EXISTS ml_depeg_predicted_idx ON ml_depeg_predictions(predicted_at DESC);
