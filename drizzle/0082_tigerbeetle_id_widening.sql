-- TigerBeetle 128-bit ID reconciliation (audit TB4).
-- TigerBeetle account/transfer IDs are u128 — up to 39 decimal digits, far
-- beyond bigint (max ~9.2e18). The mirror tables stored them as bigint, which
-- silently rejected/overflowed every composite ID provisioned by
-- server/_core/tigerBeetle.ts (userId << 96 | ledger << 64 | timestamp).
-- This migration widens all TB id columns to TEXT (decimal string form) and
-- adds the columns the provisioning path actually needs.

-- ─── tigerbeetle_accounts ────────────────────────────────────────────────────
ALTER TABLE tigerbeetle_accounts
  DROP CONSTRAINT IF EXISTS tigerbeetle_accounts_tb_account_id_unique;
ALTER TABLE tigerbeetle_accounts
  ALTER COLUMN tb_account_id TYPE TEXT;
ALTER TABLE tigerbeetle_accounts
  ADD COLUMN IF NOT EXISTS flags INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS user_data_128 TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS tigerbeetle_accounts_tb_account_id_unique
  ON tigerbeetle_accounts (tb_account_id);
-- One TigerBeetle wallet account per (user, currency) — the provisioning
-- upsert in tigerBeetle.ts targets this key.
CREATE UNIQUE INDEX IF NOT EXISTS tigerbeetle_accounts_user_currency_uidx
  ON tigerbeetle_accounts (user_id, currency);

-- ─── tigerbeetle_transfers ───────────────────────────────────────────────────
ALTER TABLE tigerbeetle_transfers
  DROP CONSTRAINT IF EXISTS tigerbeetle_transfers_tb_transfer_id_unique;
ALTER TABLE tigerbeetle_transfers
  ALTER COLUMN tb_transfer_id TYPE TEXT,
  ALTER COLUMN debit_account_id TYPE TEXT,
  ALTER COLUMN credit_account_id TYPE TEXT;
-- Two-phase transfers: the pending hold this row posts/voids.
ALTER TABLE tigerbeetle_transfers
  ADD COLUMN IF NOT EXISTS pending_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS tigerbeetle_transfers_tb_transfer_id_unique
  ON tigerbeetle_transfers (tb_transfer_id);
