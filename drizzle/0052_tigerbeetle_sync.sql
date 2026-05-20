-- 0052_tigerbeetle_sync.sql
-- Adds TigerBeetle account mapping to wallets table and ledger reconciliation audit table.
-- TigerBeetle = source of truth for balances, PostgreSQL = metadata + balance cache.

-- Add TigerBeetle account ID to wallets table
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS tb_account_id VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_wallets_tb_account_id ON wallets (tb_account_id) WHERE tb_account_id IS NOT NULL;

-- Ledger reconciliation audit trail
CREATE TABLE IF NOT EXISTS ledger_reconciliation_log (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id),
  pg_balance DECIMAL(18,6) NOT NULL,
  tb_balance DECIMAL(18,6) NOT NULL,
  discrepancy DECIMAL(18,6) NOT NULL,
  action VARCHAR(20) NOT NULL DEFAULT 'synced', -- synced | flagged | manual
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_recon_wallet ON ledger_reconciliation_log (wallet_id);
CREATE INDEX IF NOT EXISTS idx_ledger_recon_created ON ledger_reconciliation_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_recon_action ON ledger_reconciliation_log (action) WHERE action != 'synced';

-- Dual-write event log for tracking TigerBeetle ↔ PostgreSQL write consistency
CREATE TABLE IF NOT EXISTS ledger_dual_write_log (
  id SERIAL PRIMARY KEY,
  transfer_id VARCHAR(64) NOT NULL,
  tb_transfer_id VARCHAR(64),
  tb_success BOOLEAN NOT NULL DEFAULT false,
  pg_success BOOLEAN NOT NULL DEFAULT false,
  amount DECIMAL(18,6) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  from_wallet_id INTEGER,
  to_wallet_id INTEGER,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dual_write_transfer ON ledger_dual_write_log (transfer_id);
CREATE INDEX IF NOT EXISTS idx_dual_write_failed ON ledger_dual_write_log (created_at DESC) WHERE NOT (tb_success AND pg_success);
