-- Outbox worker lease columns (audit PG3/PG6).
-- The outbox worker claims batches with SELECT ... FOR UPDATE SKIP LOCKED and
-- stamps each claimed row with a lease (locked_at/locked_by). Delivery then
-- happens outside the claim transaction; a crashed worker's lease expires
-- after the visibility timeout and the row becomes claimable again.
-- Dead-lettered rows (status='dead_letter') keep their last error in
-- error_message and can be redriven via requeueDeadLetters().

ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by VARCHAR(128);

-- Hot path for the claim query: pending rows in FIFO order.
CREATE INDEX IF NOT EXISTS outbox_events_claim_idx
  ON outbox_events (created_at)
  WHERE status = 'pending';

-- Redrive/admin path: find dead letters quickly.
CREATE INDEX IF NOT EXISTS outbox_events_dead_letter_idx
  ON outbox_events (failed_at)
  WHERE status = 'dead_letter';
