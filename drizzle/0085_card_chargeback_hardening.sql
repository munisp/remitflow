-- Chargeback hardening (FF-008): columns the cardProtection router uses,
-- aligned onto the migration-0065 card_chargebacks table.
ALTER TABLE card_chargebacks ADD COLUMN IF NOT EXISTS chargeback_id text;
ALTER TABLE card_chargebacks ADD COLUMN IF NOT EXISTS transaction_ref text;
ALTER TABLE card_chargebacks ADD COLUMN IF NOT EXISTS merchant_name text;
ALTER TABLE card_chargebacks ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE card_chargebacks ADD COLUMN IF NOT EXISTS resolution text;
ALTER TABLE card_chargebacks ADD COLUMN IF NOT EXISTS admin_notes text;
ALTER TABLE card_chargebacks ADD COLUMN IF NOT EXISTS provisional_credit_applied boolean NOT NULL DEFAULT false;
ALTER TABLE card_chargebacks ADD COLUMN IF NOT EXISTS provisional_credit_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS card_chargebacks_chargeback_id_uidx ON card_chargebacks (chargeback_id) WHERE chargeback_id IS NOT NULL;
-- Widen the status CHECK to include the states the router transitions through.
ALTER TABLE card_chargebacks DROP CONSTRAINT IF EXISTS card_chargebacks_status_check;
ALTER TABLE card_chargebacks ADD CONSTRAINT card_chargebacks_status_check
  CHECK (status IN ('open', 'under_review', 'won', 'lost', 'cancelled', 'resolved'));
