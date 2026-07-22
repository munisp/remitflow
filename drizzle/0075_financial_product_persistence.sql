-- Durable configuration and catalogue contracts for financial products.
CREATE TABLE IF NOT EXISTS savings_roundup_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  round_up_to INTEGER NOT NULL CHECK (round_up_to IN (1, 5, 10)),
  savings_goal_id INTEGER REFERENCES "savingsGoals"(id),
  currency VARCHAR(8) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS autosave_rules (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  savings_goal_id INTEGER REFERENCES "savingsGoals"(id),
  amount NUMERIC(24, 8) NOT NULL CHECK (amount > 0),
  currency VARCHAR(8) NOT NULL,
  frequency VARCHAR(16) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  start_date TIMESTAMPTZ NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('active', 'paused', 'cancelled')) DEFAULT 'active',
  next_execution_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS autosave_rules_user_status_idx ON autosave_rules (user_id, status, next_execution_at);

CREATE TABLE IF NOT EXISTS savings_streaks (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  current_streak INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  longest_streak INTEGER NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
  last_save_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS investment_catalog_products (
  id TEXT PRIMARY KEY,
  currency VARCHAR(8) NOT NULL,
  name TEXT NOT NULL,
  issuer TEXT NOT NULL,
  minimum_amount NUMERIC(24, 8) NOT NULL CHECK (minimum_amount > 0),
  expected_yield NUMERIC(12, 6),
  term TEXT NOT NULL,
  risk_level VARCHAR(16) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  product_type VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('active', 'suspended', 'retired')) DEFAULT 'active',
  source TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS investment_catalog_currency_status_idx ON investment_catalog_products (currency, status, source_updated_at DESC);
