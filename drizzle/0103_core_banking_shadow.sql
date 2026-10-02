-- W20-E (SPEC-wave20, DL-06): core-banking shadow persistence for the legacy
-- REST dual-stack. server/_core/restCompatibilityProxy.ts proxies legacy PWA
-- REST calls (transactions / wallets / cards / disputes) to
-- CORE_BANKING_UPSTREAM_URL; without these tables none of those records ever
-- land in our Postgres. Every successful upstream READ/WRITE is shadow-
-- upserted (write-through) so the platform keeps a queryable copy.
--
-- Lane E may NOT touch drizzle/schema.ts (owned by Lane A); these tables are
-- raw SQL only and are accessed via sql`` queries in restCompatibilityProxy.ts.
-- Additive-only: CREATE TABLE/INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS cb_shadow_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  upstream_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cb_shadow_accounts_tenant_upstream_kind_uniq UNIQUE (tenant_id, upstream_id, kind)
);

CREATE TABLE IF NOT EXISTS cb_shadow_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  upstream_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cb_shadow_transactions_tenant_upstream_kind_uniq UNIQUE (tenant_id, upstream_id, kind)
);

CREATE TABLE IF NOT EXISTS cb_shadow_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  upstream_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cb_shadow_cards_tenant_upstream_kind_uniq UNIQUE (tenant_id, upstream_id, kind)
);

CREATE TABLE IF NOT EXISTS cb_shadow_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  upstream_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cb_shadow_disputes_tenant_upstream_kind_uniq UNIQUE (tenant_id, upstream_id, kind)
);

-- Reconciliation ledger for orphaned upstream writes: when the upstream WRITE
-- succeeded but the shadow upsert failed, the proxy inserts a row here (in
-- addition to a loud structured log) so a reconciler can re-pull the record
-- from the upstream by (table, upstream_id). Never silent.
CREATE TABLE IF NOT EXISTS cb_shadow_sync_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  shadow_table TEXT NOT NULL,
  upstream_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reconciled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS cb_shadow_accounts_tenant_idx ON cb_shadow_accounts (tenant_id, kind);
CREATE INDEX IF NOT EXISTS cb_shadow_transactions_tenant_idx ON cb_shadow_transactions (tenant_id, kind);
CREATE INDEX IF NOT EXISTS cb_shadow_cards_tenant_idx ON cb_shadow_cards (tenant_id, kind);
CREATE INDEX IF NOT EXISTS cb_shadow_disputes_tenant_idx ON cb_shadow_disputes (tenant_id, kind);
CREATE INDEX IF NOT EXISTS cb_shadow_sync_failures_pending_idx ON cb_shadow_sync_failures (reconciled_at) WHERE reconciled_at IS NULL;
