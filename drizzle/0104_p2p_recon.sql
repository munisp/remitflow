-- W21 Lane G: P2P UNCERTAIN reaper support.
-- p2p_transfers previously had NO metadata column, so the cross-border
-- UNCERTAIN-park state (rail outcome unknown; funds debited, never completed,
-- never refunded) was encoded as a "RECON:" marker string in failure_reason.
-- This migration adds a real metadata column so the park state is structured
-- data, and a partial index for the reconciliation worker's 60s scan.
-- Additive + idempotent only.

ALTER TABLE p2p_transfers
  ADD COLUMN IF NOT EXISTS metadata jsonb;

-- Partial index for the reaper scan: settling rows only (the parked set is
-- tiny vs the full table; completed/failed rows never match).
CREATE INDEX IF NOT EXISTS p2p_transfers_settling_recon_idx
  ON p2p_transfers (status)
  WHERE status = 'settling';
