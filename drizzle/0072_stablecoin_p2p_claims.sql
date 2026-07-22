-- Durable P2P stablecoin claim lifecycle. Claims remain pending until an eligible recipient redeems them,
-- and the conditional update in the application service prevents double redemption.
CREATE TABLE IF NOT EXISTS stablecoin_p2p_claims (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_identifier TEXT NOT NULL,
  stablecoin TEXT NOT NULL,
  amount NUMERIC(24, 8) NOT NULL CHECK (amount > 0),
  claim_code TEXT NOT NULL UNIQUE,
  message TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'redeeming', 'claimed', 'expired', 'refunded')) DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  claimed_by_user_id TEXT,
  ledger_reference TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_stablecoin_p2p_claims_sender_status
  ON stablecoin_p2p_claims (sender_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stablecoin_p2p_claims_recipient_status
  ON stablecoin_p2p_claims (recipient_identifier, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_stablecoin_p2p_claims_expiry_pending
  ON stablecoin_p2p_claims (expires_at)
  WHERE status = 'pending';
