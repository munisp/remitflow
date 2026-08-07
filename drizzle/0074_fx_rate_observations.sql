-- FX rate time-series contract for AI commentary and historical analytics.
CREATE TABLE IF NOT EXISTS fx_rates (
  id SERIAL PRIMARY KEY,
  from_currency VARCHAR(8) NOT NULL,
  to_currency VARCHAR(8) NOT NULL,
  rate NUMERIC(24, 10) NOT NULL CHECK (rate > 0),
  source VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fx_rates_pair_observed_at_idx
  ON fx_rates (from_currency, to_currency, observed_at DESC);
