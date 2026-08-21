-- Settlement journal (FF-001): exactly-once record for transfer settlement.
-- The journal row is the idempotency key for the PG wallet debit that
-- accompanies posting a TigerBeetle pending hold. status transitions:
--   debited → posted | post_failed | reconcile_required | refunded | voided
CREATE TABLE IF NOT EXISTS settlement_journal (
  transfer_id text PRIMARY KEY,
  user_id integer NOT NULL,
  amount_minor text NOT NULL,
  currency text NOT NULL,
  status text NOT NULL,
  tb_pending_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS settlement_journal_status_idx ON settlement_journal (status) WHERE status IN ('debited', 'post_failed');
