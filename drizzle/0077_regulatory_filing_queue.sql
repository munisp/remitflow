-- Durable regulatory filing queue for SAR, STR, CTR, and LCTR submissions.
-- All filing attempts are retained; no provider outage is allowed to discard a report.

DO $$ BEGIN
  CREATE TYPE regulatory_filing_queue_status AS ENUM (
    'pending', 'processing', 'retry', 'submitted', 'dead_letter'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS regulatory_filing_queue (
  id BIGSERIAL PRIMARY KEY,
  report_id TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  report_type TEXT NOT NULL CHECK (report_type IN ('SAR', 'STR', 'CTR', 'LCTR')),
  jurisdiction TEXT NOT NULL CHECK (jurisdiction IN ('CA', 'US', 'GB', 'NG', 'GH', 'KE', 'ZA')),
  payload JSONB NOT NULL,
  status regulatory_filing_queue_status NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 32),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lock_token UUID,
  locked_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  provider_reference TEXT,
  last_http_status INTEGER,
  last_error TEXT,
  requeued_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  requeued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT regulatory_filing_queue_terminal_state CHECK (
    (status = 'submitted' AND submitted_at IS NOT NULL AND provider_reference IS NOT NULL)
    OR (status <> 'submitted')
  )
);

CREATE INDEX IF NOT EXISTS regulatory_filing_queue_due_idx
  ON regulatory_filing_queue (next_attempt_at, created_at)
  WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS regulatory_filing_queue_tenant_idx
  ON regulatory_filing_queue (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS regulatory_filing_queue_dead_letter_idx
  ON regulatory_filing_queue (tenant_id, requeued_at DESC)
  WHERE status = 'dead_letter';

ALTER TABLE regulatory_filing_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_filing_queue FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS regulatory_filing_queue_tenant_isolation ON regulatory_filing_queue;
CREATE POLICY regulatory_filing_queue_tenant_isolation ON regulatory_filing_queue
  USING (
    app_bypass_rls()
    OR tenant_id::TEXT = app_current_tenant_id()
    OR requested_by = app_current_user_id()
  )
  WITH CHECK (
    app_bypass_rls()
    OR tenant_id::TEXT = app_current_tenant_id()
    OR requested_by = app_current_user_id()
  );

DROP TRIGGER IF EXISTS regulatory_filing_queue_audit_trig ON regulatory_filing_queue;
CREATE TRIGGER regulatory_filing_queue_audit_trig
  AFTER INSERT OR UPDATE OR DELETE ON regulatory_filing_queue
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
