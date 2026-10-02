-- W20-C (SPEC-wave20, Lane C): durable state for the INLINE saga fallback in
-- server/_core/fundFlowHardening.ts (DL-21). Previously, when Temporal was
-- unavailable executeCoordinatedTransaction ran the money saga fully in
-- memory — a process crash between debit_sender and compensation stranded
-- the debit with no durable record of what to undo.
--
-- Lane C may NOT touch drizzle/schema.ts (owned by Lane A); tables here are
-- created via raw SQL and accessed through drizzle `sql`` queries at the
-- call site. Additive only: CREATE TABLE/INDEX IF NOT EXISTS.
--
-- saga_instances: one row per coordinated transaction (inline path).
--   idempotency_key is the coordinator transactionId (CTX-*) — UNIQUE so a
--   caller retry re-attaches to the same saga instead of double-executing.
--   status: in_progress | completed | compensating | compensated | failed
--   current_step: name of the step last started (resume cursor on boot).
--
-- saga_steps: one row per (saga, step). Written BEFORE the step mutation
-- (intent), updated to completed/failed after. attempts counts executions;
-- compensated flips true once the compensation for that step succeeded, so
-- compensation itself is idempotent (check-before-act).

CREATE TABLE IF NOT EXISTS saga_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'in_progress',
  current_step TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saga_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saga_id UUID NOT NULL REFERENCES saga_instances(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  result JSONB,
  compensated BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent step upserts + boot-resume scans.
CREATE UNIQUE INDEX IF NOT EXISTS saga_steps_saga_step_uniq ON saga_steps (saga_id, step_name);
CREATE INDEX IF NOT EXISTS saga_instances_status_idx ON saga_instances (status) WHERE status IN ('in_progress', 'compensating', 'failed');
CREATE INDEX IF NOT EXISTS saga_steps_saga_idx ON saga_steps (saga_id);
