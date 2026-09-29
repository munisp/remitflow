-- wave-18 (coder C): Insider Threat Controls — durable persistence.
-- Replaces the in-memory Map stores in server/routers/insiderThreatControls.ts
-- (makerChecker, jitAccess, webauthn, dlp, delayedReversal, canary, geoTimeFence)
-- with real PostgreSQL tables. ADDITIVE ONLY: CREATE ... IF NOT EXISTS; no
-- ALTER/DROP of existing objects.

-- ── 1. Maker-Checker dual authorization requests ─────────────────────────────
CREATE TABLE IF NOT EXISTS insider_maker_checker_requests (
  id text PRIMARY KEY,                          -- 'mc_<hex>' app-generated id
  tenant_id integer,
  operation_type varchar(40) NOT NULL,          -- 'transfer_reversal'|'wallet_adjustment'|'agent_float_topup'|'fx_rate_override'|'user_role_change'|'bulk_data_export'
  requested_by integer NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,   -- includes justification
  status varchar(16) NOT NULL DEFAULT 'pending',-- 'pending'|'approved'|'rejected'|'expired'
  approved_by integer,
  approved_at timestamptz,
  rejection_reason text,
  expires_at timestamptz NOT NULL,
  risk_score integer NOT NULL DEFAULT 0,
  required_approvers integer NOT NULL DEFAULT 1,
  current_approvals integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS insider_mc_requests_status_idx ON insider_maker_checker_requests (status);
CREATE INDEX IF NOT EXISTS insider_mc_requests_requester_idx ON insider_maker_checker_requests (requested_by);
CREATE INDEX IF NOT EXISTS insider_mc_requests_tenant_idx ON insider_maker_checker_requests (tenant_id);

-- ── 2. JIT (Just-In-Time) privileged access grants ───────────────────────────
CREATE TABLE IF NOT EXISTS insider_jit_access_grants (
  id text PRIMARY KEY,                          -- 'jit_<hex>'
  tenant_id integer,
  user_id integer NOT NULL,
  privilege varchar(40) NOT NULL,               -- 'admin_panel'|'bulk_export'|'user_management'|'fx_override'|'system_config'
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  granted_by integer NOT NULL,
  reason text NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  actions_performed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS insider_jit_grants_user_idx ON insider_jit_access_grants (user_id);
CREATE INDEX IF NOT EXISTS insider_jit_grants_active_idx ON insider_jit_access_grants (revoked, expires_at);
CREATE INDEX IF NOT EXISTS insider_jit_grants_tenant_idx ON insider_jit_access_grants (tenant_id);

-- ── 3. DLP (Data Loss Prevention) access events ──────────────────────────────
CREATE TABLE IF NOT EXISTS insider_dlp_events (
  id text PRIMARY KEY,                          -- 'dlp_<hex>'
  tenant_id integer,
  user_id integer NOT NULL,
  action varchar(32) NOT NULL,                  -- 'query'|'bulk_query'
  table_name varchar(128) NOT NULL,
  record_count integer NOT NULL DEFAULT 0,
  blocked boolean NOT NULL DEFAULT false,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now() -- event timestamp
);
CREATE INDEX IF NOT EXISTS insider_dlp_events_user_idx ON insider_dlp_events (user_id);
CREATE INDEX IF NOT EXISTS insider_dlp_events_blocked_idx ON insider_dlp_events (blocked);
CREATE INDEX IF NOT EXISTS insider_dlp_events_created_idx ON insider_dlp_events (created_at);
CREATE INDEX IF NOT EXISTS insider_dlp_events_tenant_idx ON insider_dlp_events (tenant_id);

-- ── 4. WebAuthn/FIDO2 hardware security key credentials ──────────────────────
CREATE TABLE IF NOT EXISTS insider_webauthn_credentials (
  id text PRIMARY KEY,                          -- 'wak_<hex>'
  user_id integer NOT NULL,
  credential_id text NOT NULL,
  public_key text NOT NULL,
  sign_count integer NOT NULL DEFAULT 0,
  name varchar(50) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS insider_webauthn_creds_cred_uniq ON insider_webauthn_credentials (credential_id);
CREATE INDEX IF NOT EXISTS insider_webauthn_creds_user_idx ON insider_webauthn_credentials (user_id);

-- ── 5. WebAuthn challenges (short-TTL rows; consumed once, expired rows pruned) ─
CREATE TABLE IF NOT EXISTS insider_webauthn_challenges (
  id text PRIMARY KEY,                          -- 'wch_<hex>'
  user_id integer NOT NULL,
  challenge text NOT NULL,
  kind varchar(16) NOT NULL,                    -- 'register'|'authenticate'
  expires_at timestamptz NOT NULL,              -- 5 minute TTL
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS insider_webauthn_challenges_user_idx ON insider_webauthn_challenges (user_id);
CREATE INDEX IF NOT EXISTS insider_webauthn_challenges_expiry_idx ON insider_webauthn_challenges (expires_at);

-- ── 6. Time-delayed high-value reversals ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS insider_delayed_reversals (
  id text PRIMARY KEY,                          -- 'rev_<hex>'
  tenant_id integer,
  transfer_ref varchar(200) NOT NULL,
  amount numeric(18, 8) NOT NULL,
  reason text,
  requested_by integer NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  execute_at timestamptz NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',-- 'pending'|'executed'|'cancelled'
  cancelled_reason text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS insider_delayed_reversals_status_idx ON insider_delayed_reversals (status);
CREATE INDEX IF NOT EXISTS insider_delayed_reversals_tenant_idx ON insider_delayed_reversals (tenant_id);

-- ── 7. Canary token alerts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insider_canary_alerts (
  id text PRIMARY KEY,                          -- 'canary_<hex>'
  tenant_id integer,
  canary_record_id varchar(200) NOT NULL,
  accessed_by integer NOT NULL,
  accessed_at timestamptz NOT NULL DEFAULT now(),
  query text NOT NULL,
  ip_address varchar(64) NOT NULL,
  severity varchar(16) NOT NULL DEFAULT 'critical',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS insider_canary_alerts_created_idx ON insider_canary_alerts (created_at);
CREATE INDEX IF NOT EXISTS insider_canary_alerts_tenant_idx ON insider_canary_alerts (tenant_id);

-- ── 8. Geo + Time fence configuration (singleton row, id = 1) ────────────────
CREATE TABLE IF NOT EXISTS insider_geo_time_fence_config (
  id integer PRIMARY KEY DEFAULT 1,
  allowed_ips jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_countries jsonb NOT NULL DEFAULT '["CA","NG","US","GB","KE","GH","ZA"]'::jsonb,
  business_hours_start integer NOT NULL DEFAULT 6,   -- UTC hour
  business_hours_end integer NOT NULL DEFAULT 22,    -- UTC hour
  allowed_days jsonb NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb, -- 0=Sunday
  break_glass_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insider_geo_time_fence_singleton CHECK (id = 1)
);

-- ── 9. Break-glass bypass audit events ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS insider_break_glass_events (
  id text PRIMARY KEY,                          -- 'bg_<hex>'
  user_id integer NOT NULL,
  reason text NOT NULL,
  incident_id varchar(200),
  expires_at timestamptz NOT NULL,              -- 1 hour bypass window
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS insider_break_glass_events_user_idx ON insider_break_glass_events (user_id);
CREATE INDEX IF NOT EXISTS insider_break_glass_events_created_idx ON insider_break_glass_events (created_at);

-- ── Row-Level Security (0059 conventions) ────────────────────────────────────
-- Tenant/user isolation via app.current_tenant_id / app.current_user_id GUCs,
-- bypassable by service accounts. Helpers were created in 0059; guard in case
-- this migration is applied to a database where 0059 has not run yet.
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'insider_maker_checker_requests',
    'insider_jit_access_grants',
    'insider_dlp_events',
    'insider_delayed_reversals',
    'insider_canary_alerts'
  ];
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'app_bypass_rls'
  ) THEN
    FOREACH t IN ARRAY tables LOOP
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR tenant_id::text = app_current_tenant_id()) WITH CHECK (app_bypass_rls() OR tenant_id::text = app_current_tenant_id())',
        t
      );
    END LOOP;
  END IF;
END $$;
