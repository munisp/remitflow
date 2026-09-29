-- 0094_perf_indexes.sql — Wave-14 C2: additive performance indexes (idempotent)
-- Every statement is CREATE INDEX IF NOT EXISTS against columns verified to
-- exist in drizzle/schema.ts at base d4cc958. No table/enum edits. Where a
-- proposed column does not exist in the schema, the index is skipped with a
-- comment (fail-safe: never guess column names).

-- BDC rate board (routers/bdc/rates.ts currentBoard): filters tenant_id +
-- status='published', orders by published_at DESC.
CREATE INDEX IF NOT EXISTS bdc_rate_quotes_board_idx
  ON bdc_rate_quotes (tenant_id, status, published_at DESC);

-- transfers (coreTransfers): lookup by referenceId (camelCase column, quoted).
CREATE INDEX IF NOT EXISTS transfers_reference_id_idx
  ON transfers ("referenceId");

-- outbound_transfers: per-user history ordered newest-first.
CREATE INDEX IF NOT EXISTS outbound_transfers_user_created_idx
  ON outbound_transfers (user_id, created_at DESC);

-- users: email lookup (login/admin search) and tenant scoping (W13 column).
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);
-- NOTE: users_tenant_id_idx already created in 0092_wave13.sql; repeated here
-- only for completeness — IF NOT EXISTS makes this a no-op where 0092 ran.
CREATE INDEX IF NOT EXISTS users_tenant_id_idx ON users (tenant_id);

-- tenant_users: reverse lookup user -> tenants.
CREATE INDEX IF NOT EXISTS tenant_users_user_idx ON tenant_users (user_id);

-- auditLogs: (tenant_id, created_at) SKIPPED — the auditLogs table has no
-- tenant_id column in drizzle/schema.ts (per-row tenancy is not modelled).
-- Per-user chronological audit access:
CREATE INDEX IF NOT EXISTS "auditLogs_user_created_idx"
  ON "auditLogs" ("userId", "createdAt");

-- fxAlerts: active-alert scan (scheduler) — partial index on live alerts only.
CREATE INDEX IF NOT EXISTS "fxAlerts_active_user_idx"
  ON "fxAlerts" ("userId") WHERE "isActive";

-- document_vault: per-user listing.
CREATE INDEX IF NOT EXISTS document_vault_user_idx
  ON document_vault (user_id);

-- recurringPayments: per-user listing + scheduler due-scan.
CREATE INDEX IF NOT EXISTS "recurringPayments_user_idx"
  ON "recurringPayments" ("userId");
CREATE INDEX IF NOT EXISTS "recurringPayments_due_idx"
  ON "recurringPayments" (status, "nextRunAt");

-- batch_payment_items: items-per-batch fan-out.
CREATE INDEX IF NOT EXISTS batch_payment_items_batch_idx
  ON batch_payment_items (batch_id);

-- virtualAccounts: per-user listing.
CREATE INDEX IF NOT EXISTS "virtualAccounts_user_idx"
  ON "virtualAccounts" ("userId");

-- referrals: both directions of the referral edge.
CREATE INDEX IF NOT EXISTS "referrals_referrer_idx"
  ON referrals ("referrerId");
CREATE INDEX IF NOT EXISTS "referrals_referred_idx"
  ON referrals ("referredId");

-- disputes: per-user dispute listing.
CREATE INDEX IF NOT EXISTS "disputes_user_idx"
  ON disputes ("userId");
