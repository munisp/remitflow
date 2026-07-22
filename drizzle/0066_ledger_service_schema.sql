-- Ledger service reconciliation schema, previously created opportunistically at runtime.
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id text PRIMARY KEY,
  user_id bigint,
  account_type smallint NOT NULL,
  currency varchar(12) NOT NULL,
  ledger integer NOT NULL DEFAULT 1,
  code smallint NOT NULL DEFAULT 1,
  debits_pending numeric(30, 0) NOT NULL DEFAULT 0,
  debits_posted numeric(30, 0) NOT NULL DEFAULT 0,
  credits_pending numeric(30, 0) NOT NULL DEFAULT 0,
  credits_posted numeric(30, 0) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_accounts_user_currency_idx ON ledger_accounts (user_id, currency, account_type);

CREATE TABLE IF NOT EXISTS ledger_transfers (
  id text PRIMARY KEY,
  debit_account_id text NOT NULL REFERENCES ledger_accounts(id),
  credit_account_id text NOT NULL REFERENCES ledger_accounts(id),
  amount numeric(30, 0) NOT NULL CHECK (amount > 0),
  pending_id text,
  ledger integer NOT NULL DEFAULT 1,
  code smallint NOT NULL DEFAULT 1,
  flags smallint NOT NULL DEFAULT 0,
  timeout integer NOT NULL DEFAULT 0,
  status varchar(32) NOT NULL DEFAULT 'posted' CHECK (status IN ('pending', 'posted', 'voided', 'failed')),
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_transfers_debit_idx ON ledger_transfers (debit_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_transfers_credit_idx ON ledger_transfers (credit_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_transfers_status_idx ON ledger_transfers (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_transfers_idempotency_idx ON ledger_transfers (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ledger_events (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  transfer_id text REFERENCES ledger_transfers(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_to_kafka boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_events_unpublished_idx ON ledger_events (created_at) WHERE published_to_kafka = false;
CREATE INDEX IF NOT EXISTS ledger_events_transfer_idx ON ledger_events (transfer_id, created_at DESC);
