-- Canonical schema contract reconciliation.
--
-- The platform historically mixed camelCase Drizzle physical tables with
-- snake_case raw SQL from services. These simple updatable views provide a
-- stable snake_case contract without duplicating financial data.

ALTER TABLE fraud_alerts
  ADD COLUMN IF NOT EXISTS model_version varchar(96);

CREATE INDEX IF NOT EXISTS idx_fraud_alerts_model_version_created_at
  ON fraud_alerts (model_version, created_at DESC)
  WHERE model_version IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('public.fx_rate_cache') IS NULL THEN
    EXECUTE 'CREATE VIEW fx_rate_cache AS
      SELECT id, "baseCurrency" AS base_currency, rates, "fetchedAt" AS fetched_at
      FROM "fxRateCache"';
  END IF;

  IF to_regclass('public.audit_logs') IS NULL THEN
    EXECUTE 'CREATE VIEW audit_logs AS
      SELECT id, "userId" AS user_id, "targetId" AS target_id, "targetType" AS target_type,
             action, description, "ipAddress" AS ip_address, "userAgent" AS user_agent,
             severity, metadata, "createdAt" AS created_at
      FROM "auditLogs"';
  END IF;

  IF to_regclass('public.recurring_payments') IS NULL THEN
    EXECUTE 'CREATE VIEW recurring_payments AS
      SELECT id, "userId" AS user_id, name, "recipientName" AS recipient_name,
             "recipientAccount" AS recipient_account, "recipientBank" AS recipient_bank,
             amount, currency, "targetCurrency" AS target_currency, description, frequency,
             timezone, "startDate" AS start_date, "endDate" AS end_date,
             "nextRunAt" AS next_run_at, "lastRunAt" AS last_run_at, status,
             "lastRunStatus" AS last_run_status, "failureCount" AS failure_count,
             "executionCount" AS execution_count, "createdAt" AS created_at,
             "updatedAt" AS updated_at
      FROM "recurringPayments"';
  END IF;

  IF to_regclass('public.kyc_documents') IS NULL THEN
    EXECUTE 'CREATE VIEW kyc_documents AS
      SELECT id, "userId" AS user_id, "docType" AS doc_type, status,
             "fileUrl" AS file_url, "fileKey" AS file_key,
             "rejectionReason" AS rejection_reason, "expiresAt" AS expires_at,
             "reviewedAt" AS reviewed_at, "supersededAt" AS superseded_at,
             "extractedData" AS extracted_data, "createdAt" AS created_at,
             "updatedAt" AS updated_at
      FROM "kycDocuments"';
  END IF;

  IF to_regclass('public.savings_goals') IS NULL THEN
    EXECUTE 'CREATE VIEW savings_goals AS
      SELECT id, "userId" AS user_id, name, emoji, "targetAmount" AS target_amount,
             "currentAmount" AS current_amount, currency, "targetDate" AS target_date,
             "autoSave" AS auto_save, "autoSaveAmount" AS auto_save_amount, purpose,
             status, "createdAt" AS created_at, "updatedAt" AS updated_at
      FROM "savingsGoals"';
  END IF;

  IF to_regclass('public.fx_alerts') IS NULL THEN
    EXECUTE 'CREATE VIEW fx_alerts AS
      SELECT id, "userId" AS user_id, "fromCurrency" AS from_currency,
             "toCurrency" AS to_currency, "targetRate" AS target_rate, direction,
             "isActive" AS is_active, triggered, "triggeredAt" AS triggered_at,
             "notifiedAt" AS notified_at, "lastCheckedRate" AS last_checked_rate,
             "lastCheckedAt" AS last_checked_at, "createdAt" AS created_at
      FROM "fxAlerts"';
  END IF;

  IF to_regclass('public.notification_preferences') IS NULL THEN
    EXECUTE 'CREATE VIEW notification_preferences AS
      SELECT id, "userId" AS user_id, category, "emailEnabled" AS email_enabled,
             "inAppEnabled" AS in_app_enabled, "pushEnabled" AS push_enabled,
             "createdAt" AS created_at, "updatedAt" AS updated_at
      FROM "notificationPreferences"';
  END IF;
END
$$;

COMMENT ON COLUMN fraud_alerts.model_version IS
  'Version of the persisted AML CPU model used to produce the alert.';
