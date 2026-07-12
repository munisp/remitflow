-- RemitFlow: Integration Enhancement Migration
-- Adds missing constraints, indexes, and performance improvements
-- for all 12 infrastructure integrations.

-- ─── TigerBeetle ─────────────────────────────────────────────────────────────
-- Add FK from tigerbeetle_transfers to tigerbeetle_accounts
ALTER TABLE "tigerbeetle_transfers"
  ADD COLUMN IF NOT EXISTS "source_account_ref" integer REFERENCES "tigerbeetle_accounts"("id");

-- Add composite index for fast balance queries
CREATE INDEX IF NOT EXISTS "idx_tb_transfers_debit_credit" 
  ON "tigerbeetle_transfers" ("debit_account_id", "credit_account_id");

-- ─── Keycloak ─────────────────────────────────────────────────────────────────
-- Add index for active sessions
CREATE INDEX IF NOT EXISTS "idx_keycloak_sessions_active"
  ON "keycloak_sessions" ("user_id") WHERE "revoked_at" IS NULL;

-- ─── Temporal ─────────────────────────────────────────────────────────────────
-- Add index for running workflows
CREATE INDEX IF NOT EXISTS "idx_temporal_executions_running"
  ON "temporal_executions" ("status", "created_at") WHERE "status" = 'RUNNING';

-- ─── Permify ─────────────────────────────────────────────────────────────────
-- Add composite index for permission lookups
CREATE INDEX IF NOT EXISTS "idx_permify_audit_subject_permission"
  ON "permify_audit_logs" ("subject_id", "permission", "created_at");

-- ─── Fluvio ──────────────────────────────────────────────────────────────────
-- Add index for consumer group offset lookups
CREATE INDEX IF NOT EXISTS "idx_fluvio_offsets_consumer"
  ON "fluvio_offsets" ("consumer_group", "topic");

-- ─── OpenAppSec ──────────────────────────────────────────────────────────────
-- Add index for recent blocked events
CREATE INDEX IF NOT EXISTS "idx_openappsec_events_recent_blocks"
  ON "openappsec_events" ("action", "created_at") WHERE "action" = 'block';

-- ─── Lakehouse ───────────────────────────────────────────────────────────────
-- Add index for failed sync jobs
CREATE INDEX IF NOT EXISTS "idx_lakehouse_sync_failed"
  ON "lakehouse_sync_jobs" ("status", "created_at") WHERE "status" = 'failed';

-- ─── Outbox Events ────────────────────────────────────────────────────────────
-- Add index for pending outbox events (transactional outbox pattern)
CREATE INDEX IF NOT EXISTS "idx_outbox_events_pending"
  ON "outbox_events" ("status", "created_at") WHERE "status" = 'pending';

-- Add index for failed outbox events with retry count
CREATE INDEX IF NOT EXISTS "idx_outbox_events_retry"
  ON "outbox_events" ("status", "retry_count") WHERE "status" = 'failed' AND "retry_count" < 3;

-- ─── Idempotency Keys ────────────────────────────────────────────────────────
-- Add index for expiry cleanup
CREATE INDEX IF NOT EXISTS "idx_idempotency_keys_expiry"
  ON "idempotency_keys" ("expires_at") WHERE "expires_at" < NOW();

-- ─── Transactions ─────────────────────────────────────────────────────────────
-- Add partial index for pending transactions (most common query)
CREATE INDEX IF NOT EXISTS "idx_transactions_pending"
  ON "transactions" ("user_id", "created_at") WHERE "status" IN ('pending', 'processing');

-- Add index for failed transactions for reconciliation
CREATE INDEX IF NOT EXISTS "idx_transactions_failed"
  ON "transactions" ("created_at") WHERE "status" = 'failed';

-- ─── Wallets ──────────────────────────────────────────────────────────────────
-- Add partial index for active wallets
CREATE INDEX IF NOT EXISTS "idx_wallets_active"
  ON "wallets" ("user_id", "currency") WHERE "status" = 'active';

-- ─── KYC Documents ───────────────────────────────────────────────────────────
-- Add index for pending KYC review queue
CREATE INDEX IF NOT EXISTS "idx_kyc_documents_review_queue"
  ON "kycDocuments" ("status", "created_at") WHERE "status" = 'under_review';

-- ─── Compliance Cases ─────────────────────────────────────────────────────────
-- Add index for open compliance cases
CREATE INDEX IF NOT EXISTS "idx_compliance_cases_open"
  ON "complianceCases" ("status", "created_at") WHERE "status" IN ('open', 'under_review');

-- ─── Audit Logs ───────────────────────────────────────────────────────────────
-- Add index for critical audit events
CREATE INDEX IF NOT EXISTS "idx_audit_logs_critical"
  ON "auditLogs" ("severity", "created_at") WHERE "severity" = 'critical';

-- ─── Fraud Alerts ─────────────────────────────────────────────────────────────
-- Add index for unresolved fraud alerts
CREATE INDEX IF NOT EXISTS "idx_fraud_alerts_unresolved"
  ON "fraud_alerts" ("user_id", "created_at") WHERE "resolved_at" IS NULL;

-- ─── Notifications ────────────────────────────────────────────────────────────
-- Add partial index for unread notifications
CREATE INDEX IF NOT EXISTS "idx_notifications_unread"
  ON "notifications" ("user_id", "created_at") WHERE "isRead" = false;

-- ─── Savings Goals ────────────────────────────────────────────────────────────
-- Add partial index for active savings goals
CREATE INDEX IF NOT EXISTS "idx_savings_goals_active"
  ON "savingsGoals" ("user_id") WHERE "status" = 'active';

-- ─── FX Alerts ────────────────────────────────────────────────────────────────
-- Add partial index for active FX alerts
CREATE INDEX IF NOT EXISTS "idx_fx_alerts_active"
  ON "fxAlerts" ("user_id", "fromCurrency", "toCurrency") WHERE "isActive" = true AND "triggered" = false;

-- ─── Recurring Payments ───────────────────────────────────────────────────────
-- Add partial index for active recurring payments
CREATE INDEX IF NOT EXISTS "idx_recurring_payments_active"
  ON "recurringPayments" ("user_id", "nextRunAt") WHERE "status" = 'active';

-- ─── Sanctions Checks ────────────────────────────────────────────────────────
-- Add index for pending sanctions checks
CREATE INDEX IF NOT EXISTS "idx_sanctions_checks_pending"
  ON "sanctions_checks" ("created_at") WHERE "result" = 'pending_review';

-- ─── Beneficiaries ───────────────────────────────────────────────────────────
-- Add index for favorite beneficiaries
CREATE INDEX IF NOT EXISTS "idx_beneficiaries_favorites"
  ON "beneficiaries" ("user_id") WHERE "isFavorite" = true;

-- ─── Rate Locks ───────────────────────────────────────────────────────────────
-- Add partial index for active rate locks
CREATE INDEX IF NOT EXISTS "idx_rate_locks_active"
  ON "rate_locks" ("user_id", "expires_at") WHERE "status" = 'active';

-- ─── P2P Transfers ────────────────────────────────────────────────────────────
-- Add index for in-flight P2P transfers
CREATE INDEX IF NOT EXISTS "idx_p2p_transfers_inflight"
  ON "p2p_transfers" ("sender_id", "created_at") WHERE "status" NOT IN ('completed', 'failed', 'cancelled');

-- ─── Stablecoin Wallets ───────────────────────────────────────────────────────
-- Add index for active stablecoin wallets
CREATE INDEX IF NOT EXISTS "idx_stablecoin_wallets_active"
  ON "stablecoin_wallets" ("user_id") WHERE "status" = 'active';

-- ─── Temporal Executions ─────────────────────────────────────────────────────
-- Add index for workflow type lookups
CREATE INDEX IF NOT EXISTS "idx_temporal_executions_type"
  ON "temporal_executions" ("workflow_type", "status", "created_at");

-- ─── APISIX Route Logs ────────────────────────────────────────────────────────
-- Add index for recent route changes
CREATE INDEX IF NOT EXISTS "idx_apisix_route_logs_recent"
  ON "apisix_route_logs" ("created_at");

-- ─── Redis Cache Audit ────────────────────────────────────────────────────────
-- Add index for cache miss analysis
CREATE INDEX IF NOT EXISTS "idx_redis_cache_audit_miss"
  ON "redis_cache_audit" ("key_pattern", "miss_count");
