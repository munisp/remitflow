-- Core runtime schema reconciliation.
-- This migration covers the highest-volume raw-SQL contracts that were not
-- represented by the canonical Drizzle schema at audit time. It is idempotent
-- so it can be applied safely to existing environments.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Durable double-entry audit mirror. TigerBeetle remains authoritative for
-- monetary state; this table stores business-level references and reconciliation metadata.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id text PRIMARY KEY,
  debit_account_id text,
  credit_account_id text,
  amount numeric(24, 8) NOT NULL CHECK (amount >= 0),
  currency varchar(12) NOT NULL,
  reference text,
  code integer,
  type varchar(64),
  transfer_id uuid,
  tigerbeetle_transfer_id numeric(39, 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ledger_entries_reference_idx ON ledger_entries (reference, created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_entries_transfer_idx ON ledger_entries (transfer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_entries_created_at_idx ON ledger_entries (created_at DESC);

-- Legacy raw-SQL transfer surface. Camel-cased names are intentionally preserved
-- because several active handlers use quoted column identifiers.
CREATE TABLE IF NOT EXISTS transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" bigint NOT NULL,
  "recipientId" bigint,
  "fromAmount" numeric(24, 8) NOT NULL CHECK ("fromAmount" > 0),
  "toAmount" numeric(24, 8),
  "fromCurrency" varchar(12) NOT NULL,
  "toCurrency" varchar(12),
  "fxRate" numeric(24, 12),
  fee numeric(24, 8) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  "referenceId" text NOT NULL,
  reference text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  "payoutMethod" varchar(64),
  purpose text,
  "recipientName" text,
  "recipientAccount" text,
  "sourceOfFunds" text,
  corridor varchar(64),
  failure_reason text,
  idempotency_key text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transfers_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded')),
  CONSTRAINT transfers_reference_unique UNIQUE (reference)
);
CREATE INDEX IF NOT EXISTS transfers_user_created_idx ON transfers ("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS transfers_user_status_created_idx ON transfers ("userId", status, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS transfers_recipient_created_idx ON transfers ("recipientId", "createdAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS transfers_idempotency_key_idx ON transfers (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_fcm_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL,
  token text NOT NULL,
  platform varchar(32),
  device_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  UNIQUE (user_id, token)
);
CREATE INDEX IF NOT EXISTS user_fcm_tokens_user_idx ON user_fcm_tokens (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL,
  session_token_hash text NOT NULL UNIQUE,
  ip_address inet,
  user_agent text,
  device_name text,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_sessions_user_active_idx ON user_sessions (user_id, last_active_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS user_sessions_expiry_idx ON user_sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS security_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  policy jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_policies_enabled_idx ON security_policies (enabled) WHERE enabled;

CREATE TABLE IF NOT EXISTS recurring_payment_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_payment_id uuid,
  user_id bigint NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status varchar(32) NOT NULL DEFAULT 'pending',
  scheduled_for timestamptz NOT NULL,
  executed_at timestamptz,
  reference text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS recurring_payment_executions_schedule_idx ON recurring_payment_executions (status, scheduled_for);
CREATE INDEX IF NOT EXISTS recurring_payment_executions_user_idx ON recurring_payment_executions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fx_rate_alert_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id bigint NOT NULL,
  from_currency varchar(12) NOT NULL,
  to_currency varchar(12) NOT NULL,
  target_rate numeric(24, 12) NOT NULL CHECK (target_rate > 0),
  direction varchar(16) NOT NULL CHECK (direction IN ('above', 'below')),
  active boolean NOT NULL DEFAULT true,
  triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fx_rate_alert_targets_active_pair_idx ON fx_rate_alert_targets (from_currency, to_currency) WHERE active;
CREATE INDEX IF NOT EXISTS fx_rate_alert_targets_user_idx ON fx_rate_alert_targets (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fx_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency varchar(12) NOT NULL,
  to_currency varchar(12) NOT NULL,
  rate numeric(24, 12) NOT NULL CHECK (rate > 0),
  source text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS fx_rates_pair_observed_idx ON fx_rates (from_currency, to_currency, observed_at DESC);

CREATE TABLE IF NOT EXISTS event_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type varchar(128) NOT NULL,
  aggregate_id text NOT NULL,
  version bigint NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aggregate_type, aggregate_id, version)
);
CREATE INDEX IF NOT EXISTS event_snapshots_aggregate_idx ON event_snapshots (aggregate_type, aggregate_id, version DESC);

CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  event_key text,
  payload jsonb NOT NULL,
  error_message text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_retry_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dead_letter_queue_retry_idx ON dead_letter_queue (next_retry_at, created_at) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS reconciliation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  reference text,
  status varchar(32) NOT NULL,
  expected_amount numeric(24, 8),
  actual_amount numeric(24, 8),
  discrepancy numeric(24, 8),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reconciliation_results_provider_status_idx ON reconciliation_results (provider, status, created_at DESC);
