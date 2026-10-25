-- W22-M: durable Circle CCTP (Cross-Chain Transfer Protocol) transfers.
-- Raw SQL, additive-only (CREATE TABLE/INDEX IF NOT EXISTS). Mirrors no
-- drizzle/schema.ts entity — schema.ts intentionally untouched per lane scope.
--
-- CCTP flow: USDC is burned on the source chain, Circle's iris attestation
-- service (https://iris-api[-sandbox].circle.com/attestations/{messageHash})
-- signs the burn message after finality, and the attestation authorizes the
-- mint on the destination chain. Every attestation poll/update for a burn is
-- persisted here so polling can resume after a restart (see
-- server/_core/circleCctp.ts resumeIncompleteCctpTransfers).

CREATE TABLE IF NOT EXISTS cctp_transfers (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER,
  burn_tx_hash TEXT NOT NULL,
  message_hash TEXT,
  source_chain VARCHAR(32) NOT NULL,
  dest_chain VARCHAR(32) NOT NULL,
  amount NUMERIC(30, 8) NOT NULL,
  -- Honest iris states only: pending_confirmations | complete | failed
  -- ('pending_confirmations' also covers "burn observed, message hash not
  -- yet known"). Never fabricated.
  status TEXT NOT NULL DEFAULT 'pending_confirmations',
  attestation TEXT,
  last_error TEXT,
  poll_count INTEGER NOT NULL DEFAULT 0,
  last_polled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cctp_transfers_tenant_burn_unique UNIQUE (tenant_id, burn_tx_hash)
);

CREATE INDEX IF NOT EXISTS cctp_transfers_status_idx
  ON cctp_transfers (status);
CREATE INDEX IF NOT EXISTS cctp_transfers_message_hash_idx
  ON cctp_transfers (message_hash);
CREATE INDEX IF NOT EXISTS cctp_transfers_tenant_idx
  ON cctp_transfers (tenant_id);
