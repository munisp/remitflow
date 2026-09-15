-- BDC adversarial-audit hardening (F2) — tenant-scoped idempotency uniqueness.
-- ADDITIVE ONLY in effect: drops two GLOBAL unique indexes created by
-- 0089_bdc_platform.sql and replaces them with composite (tenant_id,
-- idempotency_key) unique indexes. drizzle/schema.ts is read-only for this
-- wave, so the composite constraint lives here (schema.ts documents the
-- superseded global indexes at bdc_transactions / bdc_regulatory_returns).
--
-- Rationale: idempotency keys are client-supplied (buy/sell) or derived from
-- recipient references (IMTO). A global UNIQUE(idempotency_key) lets one
-- tenant's key permanently block another tenant's identical key (cross-tenant
-- denial + replay confusion). The application now also tenant-prefixes every
-- claim key; this composite index is the database-level backstop.

BEGIN;

-- bdc_transactions: global → per-tenant idempotency uniqueness.
DROP INDEX IF EXISTS bdc_transactions_idempotency_key_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS bdc_transactions_tenant_idempotency_key_uidx
  ON bdc_transactions (tenant_id, idempotency_key);

-- bdc_regulatory_returns: global → per-tenant idempotency uniqueness.
DROP INDEX IF EXISTS bdc_regulatory_returns_idempotency_key_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS bdc_regulatory_returns_tenant_idempotency_key_uidx
  ON bdc_regulatory_returns (tenant_id, idempotency_key);

COMMIT;
