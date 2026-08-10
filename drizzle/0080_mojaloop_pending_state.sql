-- Durable pending-state tables for Mojaloop FSPIOP async callbacks.
-- Replaces the previous JSONB blob approach which attempted (and failed) to
-- serialize in-memory resolve/reject functions and timer handles. Only
-- serializable correlation state is stored; rows are re-registered with fresh
-- timeouts on process startup.

CREATE TABLE IF NOT EXISTS mojaloop_pending_transfers (
  transfer_id TEXT PRIMARY KEY,
  condition TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mojaloop_pending_transfers_expiry
  ON mojaloop_pending_transfers (expires_at);

CREATE TABLE IF NOT EXISTS mojaloop_pending_callbacks (
  correlation_id TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mojaloop_pending_callbacks_expiry
  ON mojaloop_pending_callbacks (expires_at);
