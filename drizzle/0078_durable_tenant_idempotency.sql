-- Durable, tenant-scoped idempotency for financial mutations.
-- New writes always include verified tenant and user scope; legacy rows remain readable
-- only for historical audit and cannot match the new composite reservation key.

ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS request_hash TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'processing',
  ADD COLUMN IF NOT EXISTS lock_token UUID,
  ADD COLUMN IF NOT EXISTS lock_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE idempotency_keys
SET state = CASE WHEN response_status IS NULL THEN 'failed' ELSE 'completed' END
WHERE state = 'processing' AND created_at < NOW() - INTERVAL '5 minutes';

ALTER TABLE idempotency_keys
  DROP CONSTRAINT IF EXISTS idempotency_keys_state_check;
ALTER TABLE idempotency_keys
  ADD CONSTRAINT idempotency_keys_state_check CHECK (state IN ('processing', 'completed', 'failed'));

DROP INDEX IF EXISTS "idempotencyKeys_key_unique_idx";
CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_tenant_user_operation_key_uidx
  ON idempotency_keys (tenant_id, user_id, operation, key)
  WHERE tenant_id IS NOT NULL AND user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idempotency_keys_tenant_state_idx
  ON idempotency_keys (tenant_id, state, lock_expires_at);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS idempotency_keys_tenant_isolation ON idempotency_keys;
CREATE POLICY idempotency_keys_tenant_isolation ON idempotency_keys
  USING (
    app_bypass_rls()
    OR tenant_id::TEXT = app_current_tenant_id()
    OR user_id = app_current_user_id()
  )
  WITH CHECK (
    app_bypass_rls()
    OR tenant_id::TEXT = app_current_tenant_id()
    OR user_id = app_current_user_id()
  );

DROP TRIGGER IF EXISTS idempotency_keys_audit_trig ON idempotency_keys;
CREATE TRIGGER idempotency_keys_audit_trig
  AFTER INSERT OR UPDATE OR DELETE ON idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
