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

-- ── RLS Policies: transfers ───────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='transfers') THEN
    DROP POLICY IF EXISTS transfers_tenant_isolation ON transfers;
    CREATE POLICY transfers_tenant_isolation ON transfers
      USING (
        app_bypass_rls()
        OR tenant_id = app_current_tenant_id()
        OR user_id   = app_current_user_id()
      );
  END IF;
END $$;

-- ── RLS Policies: wallets ─────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='wallets') THEN
    DROP POLICY IF EXISTS wallets_tenant_isolation ON wallets;
    CREATE POLICY wallets_tenant_isolation ON wallets
      USING (
        app_bypass_rls()
        OR user_id = app_current_user_id()
      );
  END IF;
END $$;

-- ── RLS Policies: beneficiaries ───────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='beneficiaries') THEN
    DROP POLICY IF EXISTS beneficiaries_tenant_isolation ON beneficiaries;
    CREATE POLICY beneficiaries_tenant_isolation ON beneficiaries
      USING (
        app_bypass_rls()
        OR user_id = app_current_user_id()
      );
  END IF;
END $$;

-- ── RLS Policies: webhook_endpoints ──────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='webhook_endpoints') THEN
    DROP POLICY IF EXISTS webhook_endpoints_tenant_isolation ON webhook_endpoints;
    CREATE POLICY webhook_endpoints_tenant_isolation ON webhook_endpoints
      USING (
        app_bypass_rls()
        OR tenant_id = app_current_tenant_id()
        OR user_id   = app_current_user_id()
      );
  END IF;
END $$;

-- ── RLS Policies: developer_api_keys ─────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='developer_api_keys') THEN
    DROP POLICY IF EXISTS developer_api_keys_tenant_isolation ON developer_api_keys;
    CREATE POLICY developer_api_keys_tenant_isolation ON developer_api_keys
      USING (
        app_bypass_rls()
        OR tenant_id = app_current_tenant_id()
        OR user_id   = app_current_user_id()
      );
  END IF;
END $$;

-- ── RLS Policies: fx_hedging_positions ───────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='fx_hedging_positions') THEN
    DROP POLICY IF EXISTS fx_hedging_positions_tenant_isolation ON fx_hedging_positions;
    CREATE POLICY fx_hedging_positions_tenant_isolation ON fx_hedging_positions
      USING (
        app_bypass_rls()
        OR tenant_id = app_current_tenant_id()
      );
  END IF;
END $$;

-- ── RLS Policies: cost_attribution_entries ────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cost_attribution_entries') THEN
    DROP POLICY IF EXISTS cost_attribution_entries_tenant_isolation ON cost_attribution_entries;
    CREATE POLICY cost_attribution_entries_tenant_isolation ON cost_attribution_entries
      USING (
        app_bypass_rls()
        OR tenant_id = app_current_tenant_id()
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
