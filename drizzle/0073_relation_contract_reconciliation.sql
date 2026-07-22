-- Reconcile relation definitions with the canonical physical schema.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS "beneficiaryId" INTEGER REFERENCES beneficiaries(id);
CREATE INDEX IF NOT EXISTS transactions_beneficiary_id_idx
  ON transactions ("beneficiaryId");

ALTER TABLE pos_terminals
  ADD COLUMN IF NOT EXISTS agent_id INTEGER REFERENCES agent_accounts(id);
CREATE INDEX IF NOT EXISTS pos_terminals_agent_id_idx
  ON pos_terminals (agent_id);

-- scheduled_transfer_runs already stores scheduleId; its Drizzle relation now targets
-- scheduled_transfers rather than the unrelated recurring_payments table.
