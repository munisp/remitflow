-- RemitFlow Migration 0059: Row-Level Security (RLS) Policies
-- Enables tenant isolation at the PostgreSQL level so no application-layer
-- bug can ever leak cross-tenant data.
--
-- Strategy:
--   1. Create a session-level config variable `app.current_tenant_id`
--   2. Create a session-level config variable `app.current_user_id`
--   3. Create a session-level config variable `app.bypass_rls` for service accounts
--   4. Enable RLS on all tenant-scoped tables
--   5. Create SELECT/INSERT/UPDATE/DELETE policies for each table
--
-- Usage in application:
--   SET LOCAL app.current_tenant_id = 'tenant-uuid';
--   SET LOCAL app.current_user_id   = '42';
--   SET LOCAL app.bypass_rls        = 'false';

-- ── Helper functions ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', TRUE), '')
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS INTEGER AS $$
  SELECT NULLIF(current_setting('app.current_user_id', TRUE), '')::INTEGER
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS BOOLEAN AS $$
  SELECT COALESCE(current_setting('app.bypass_rls', TRUE), 'false')::BOOLEAN
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- ── Audit trigger function ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_audit_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF column_exists(TG_TABLE_NAME, 'created_at') THEN
      NEW.created_at := COALESCE(NEW.created_at, NOW());
    END IF;
    IF column_exists(TG_TABLE_NAME, 'updated_at') THEN
      NEW.updated_at := NOW();
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF column_exists(TG_TABLE_NAME, 'updated_at') THEN
      NEW.updated_at := NOW();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Helper to check if a column exists in a table
CREATE OR REPLACE FUNCTION column_exists(p_table TEXT, p_column TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = p_table
      AND column_name  = p_column
  );
$$ LANGUAGE SQL STABLE;

-- ── Audit log table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  table_name  TEXT NOT NULL,
  operation   TEXT NOT NULL,  -- INSERT | UPDATE | DELETE
  row_id      TEXT,
  tenant_id   TEXT,
  user_id     INTEGER,
  old_data    JSONB,
  new_data    JSONB,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address  INET,
  session_id  TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_table_idx    ON audit_log(table_name);
CREATE INDEX IF NOT EXISTS audit_log_tenant_idx   ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS audit_log_user_idx     ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS audit_log_changed_idx  ON audit_log(changed_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_operation_idx ON audit_log(operation);

-- ── Generic audit trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (table_name, operation, row_id, tenant_id, user_id, old_data, new_data)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    CASE WHEN TG_OP = 'DELETE' THEN (row_to_json(OLD)->>'id')::TEXT
         ELSE (row_to_json(NEW)->>'id')::TEXT END,
    NULLIF(current_setting('app.current_tenant_id', TRUE), ''),
    NULLIF(current_setting('app.current_user_id', TRUE), '')::INTEGER,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN row_to_json(OLD)::JSONB ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN row_to_json(NEW)::JSONB ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Apply audit triggers to critical tables ───────────────────────────────────
DO $$ DECLARE
  t TEXT;
  critical_tables TEXT[] := ARRAY[
    'transfers', 'users', 'wallets', 'beneficiaries', 'kyc_records',
    'compliance_cases', 'stablecoin_transactions', 'onramp_transactions',
    'offramp_transactions', 'fx_hedging_positions', 'developer_api_keys',
    'gdpr_erasure_requests', 'webhook_endpoints'
  ];
BEGIN
  FOREACH t IN ARRAY critical_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('
        DROP TRIGGER IF EXISTS %I_audit ON %I;
        CREATE TRIGGER %I_audit
          AFTER INSERT OR UPDATE OR DELETE ON %I
          FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
      ', t||'_audit_trig', t, t||'_audit_trig', t);
    END IF;
  END LOOP;
END $$;

-- ── Enable RLS on tenant-scoped tables ────────────────────────────────────────
DO $$ DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'transfers', 'wallets', 'beneficiaries', 'kyc_records',
    'webhook_endpoints', 'webhook_delivery_logs', 'developer_api_keys',
    'fx_hedging_positions', 'cost_attribution_entries', 'chaos_experiments',
    'compliance_transaction_scores', 'slo_events', 'slo_reports'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    END IF;
  END LOOP;
END $$;

-- ── Canonical RLS policies across the mixed legacy schema ─────────────────────
-- Some pre-0051 relations use camelCase (`userId`), while newer relations use
-- snake_case (`user_id`). Resolve the physical column names before creating the
-- policy so PostgreSQL remains the final, fail-closed tenant-isolation boundary.
DO $$
DECLARE
  t TEXT;
  tenant_column TEXT;
  user_column TEXT;
  predicate TEXT;
  scoped_tables TEXT[] := ARRAY[
    'transfers', 'wallets', 'beneficiaries', 'kyc_records',
    'webhook_endpoints', 'developer_api_keys', 'fx_hedging_positions',
    'cost_attribution_entries', 'chaos_experiments',
    'compliance_transaction_scores', 'slo_events', 'slo_reports'
  ];
BEGIN
  FOREACH t IN ARRAY scoped_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = t
    ) THEN
      SELECT column_name INTO tenant_column
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = t
         AND column_name IN ('tenant_id', 'tenantId')
       ORDER BY CASE column_name WHEN 'tenant_id' THEN 0 ELSE 1 END
       LIMIT 1;
      SELECT column_name INTO user_column
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = t
         AND column_name IN ('user_id', 'userId')
       ORDER BY CASE column_name WHEN 'user_id' THEN 0 ELSE 1 END
       LIMIT 1;

      IF tenant_column IS NOT NULL OR user_column IS NOT NULL THEN
        predicate := 'app_bypass_rls()';
        IF tenant_column IS NOT NULL THEN
          predicate := predicate || format(' OR %I::text = app_current_tenant_id()', tenant_column);
        END IF;
        IF user_column IS NOT NULL THEN
          predicate := predicate || format(' OR %I::text = app_current_user_id()::text', user_column);
        END IF;
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        EXECUTE format(
          'CREATE POLICY tenant_isolation ON %I USING (%s) WITH CHECK (%s)',
          t,
          predicate,
          predicate
        );
      END IF;
    END IF;
  END LOOP;
END $$;

-- Delivery logs inherit ownership from their webhook endpoint; they have no direct
-- tenant or user column and therefore require a parent-scoped policy.
DO $$
DECLARE
  tenant_column TEXT;
  user_column TEXT;
  endpoint_predicate TEXT := 'app_bypass_rls()';
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'webhook_delivery_logs'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'webhook_endpoints'
  ) THEN
    SELECT column_name INTO tenant_column
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'webhook_endpoints'
       AND column_name IN ('tenant_id', 'tenantId')
     ORDER BY CASE column_name WHEN 'tenant_id' THEN 0 ELSE 1 END
     LIMIT 1;
    SELECT column_name INTO user_column
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'webhook_endpoints'
       AND column_name IN ('user_id', 'userId')
     ORDER BY CASE column_name WHEN 'user_id' THEN 0 ELSE 1 END
     LIMIT 1;
    IF tenant_column IS NOT NULL THEN
      endpoint_predicate := endpoint_predicate || format(' OR endpoint.%I::text = app_current_tenant_id()', tenant_column);
    END IF;
    IF user_column IS NOT NULL THEN
      endpoint_predicate := endpoint_predicate || format(' OR endpoint.%I::text = app_current_user_id()::text', user_column);
    END IF;
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON webhook_delivery_logs';
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON webhook_delivery_logs USING (EXISTS (SELECT 1 FROM webhook_endpoints AS endpoint WHERE endpoint.id = webhook_id AND (%s))) WITH CHECK (EXISTS (SELECT 1 FROM webhook_endpoints AS endpoint WHERE endpoint.id = webhook_id AND (%s)))',
      endpoint_predicate,
      endpoint_predicate
    );
  END IF;
END $$;

-- ── TypeScript RLS context helper (comment for application layer) ─────────────
-- In server/lib/rls-context.ts, wrap every DB transaction:
--
--   await db.transaction(async (tx) => {
--     await tx.execute(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);
--     await tx.execute(sql`SET LOCAL app.current_user_id   = ${userId}`);
--     await tx.execute(sql`SET LOCAL app.bypass_rls        = 'false'`);
--     // ... your queries
--   });
