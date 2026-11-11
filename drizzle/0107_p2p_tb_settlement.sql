-- W23 Lane O: P2P cross-border TigerBeetle settlement legs.
-- On Mojaloop COMMITTED the value parked in the TB SETTLEMENT pool must
-- actually leave it (SETTLEMENT → NOSTRO, deterministic reference
-- `P2P_{id}_SETTLE`). This column records that TB leg reference on the
-- transfer row so ops/reconciliation can join p2p_transfers ↔ TB transfers
-- ↔ settlement_journal without re-deriving the hash. settlement_journal
-- itself (drizzle/0084) is reused unchanged — the router inserts the
-- 'debited' row in the same transaction as the wallet debit.
-- Additive + idempotent only; no schema.ts change in this lane.

ALTER TABLE p2p_transfers
  ADD COLUMN IF NOT EXISTS tb_settlement_ref text;

-- Lookup by TB leg reference (only completed cross-border rows carry one).
CREATE INDEX IF NOT EXISTS p2p_transfers_tb_settlement_ref_idx
  ON p2p_transfers (tb_settlement_ref)
  WHERE tb_settlement_ref IS NOT NULL;
