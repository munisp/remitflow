-- Virtual cards, card transaction history, and BNPL contracts used by production routers.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS virtual_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL,
  card_number_masked varchar(32) NOT NULL,
  card_type varchar(32) NOT NULL,
  network varchar(32) NOT NULL,
  currency varchar(12) NOT NULL,
  balance numeric(24, 8) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  spending_limit numeric(24, 8),
  status varchar(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'cancelled', 'expired')),
  freeze_reason text,
  expiry_month integer CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year integer,
  provider text,
  provider_card_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS virtual_cards_user_status_idx ON virtual_cards (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS virtual_cards_provider_idx ON virtual_cards (provider, provider_card_id);

CREATE TABLE IF NOT EXISTS card_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES virtual_cards(id),
  user_id bigint NOT NULL,
  amount numeric(24, 8) NOT NULL,
  currency varchar(12) NOT NULL,
  direction varchar(16) NOT NULL DEFAULT 'debit' CHECK (direction IN ('debit', 'credit', 'reversal', 'fee')),
  merchant_name text,
  merchant_category text,
  description text,
  status varchar(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'reversed', 'failed', 'declined')),
  provider_reference text UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS card_transactions_card_created_idx ON card_transactions (card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS card_transactions_user_created_idx ON card_transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bnpl_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" bigint NOT NULL,
  plan_id text,
  requested_amount numeric(24, 8) NOT NULL CHECK (requested_amount > 0),
  total_amount numeric(24, 8),
  currency varchar(12) NOT NULL,
  installments integer NOT NULL CHECK (installments > 0),
  monthly_payment numeric(24, 8),
  status varchar(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'active', 'completed', 'defaulted', 'cancelled')),
  purpose text,
  first_due_date date,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bnpl_applications_user_created_idx ON bnpl_applications ("userId", created_at DESC);
CREATE INDEX IF NOT EXISTS bnpl_applications_status_idx ON bnpl_applications (status, created_at DESC);

CREATE TABLE IF NOT EXISTS bnpl_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id text,
  application_id uuid REFERENCES bnpl_applications(id),
  user_id bigint,
  installment_number integer NOT NULL CHECK (installment_number > 0),
  amount_ngn numeric(24, 8),
  amount numeric(24, 8),
  due_date date NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'frozen', 'cancelled')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_ngn IS NOT NULL OR amount IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS bnpl_installments_plan_status_idx ON bnpl_installments (plan_id, status, due_date);
CREATE INDEX IF NOT EXISTS bnpl_installments_application_status_idx ON bnpl_installments (application_id, status, due_date);
CREATE INDEX IF NOT EXISTS bnpl_installments_due_idx ON bnpl_installments (status, due_date) WHERE status IN ('pending', 'overdue');

CREATE TABLE IF NOT EXISTS card_chargebacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES virtual_cards(id),
  card_transaction_id uuid REFERENCES card_transactions(id),
  user_id bigint NOT NULL,
  amount numeric(24, 8) NOT NULL CHECK (amount > 0),
  currency varchar(12) NOT NULL,
  reason text,
  status varchar(32) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'won', 'lost', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS card_chargebacks_card_status_idx ON card_chargebacks (card_id, status, created_at DESC);
