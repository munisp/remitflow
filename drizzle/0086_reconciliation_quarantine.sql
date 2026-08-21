-- Reconciliation discrepancy quarantine (FF-010): PG↔TB drift is recorded
-- here for manual review instead of auto-overwriting PG wallet balances.
CREATE TABLE IF NOT EXISTS reconciliation_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id bigint,
  user_id bigint NOT NULL,
  currency text NOT NULL,
  pg_balance text NOT NULL,
  tb_balance text NOT NULL,
  discrepancy text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS reconciliation_discrepancies_status_idx ON reconciliation_discrepancies (status) WHERE status = 'open';
