-- Canonical integration indexes across the retained mixed-case legacy schema.
-- Column names are resolved against information_schema by exact name, then by snake/camel-insensitive normalization.
-- The former NOW()-based expiry predicate is replaced with an immutable non-null predicate; expiry filtering remains in the query.

DO $$
DECLARE
  target record;
  source_column text;
  resolved_column text;
  mapped_columns text[];
  rendered_columns text;
  rendered_predicate text;
  can_create boolean;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
    ('idx_tb_transfers_debit_credit', 'tigerbeetle_transfers', ARRAY['debit_account_id', 'credit_account_id'], NULL, false),
    ('idx_keycloak_sessions_active', 'keycloak_sessions', ARRAY['user_id'], '"revoked_at" IS NULL', false),
    ('idx_temporal_executions_running', 'temporal_executions', ARRAY['status', 'created_at'], '"status" = ''RUNNING''', false),
    ('idx_permify_audit_subject_permission', 'permify_audit_logs', ARRAY['subject_id', 'permission', 'created_at'], NULL, false),
    ('idx_fluvio_offsets_consumer', 'fluvio_offsets', ARRAY['consumer_group', 'topic'], NULL, false),
    ('idx_openappsec_events_recent_blocks', 'openappsec_events', ARRAY['action', 'created_at'], '"action" = ''block''', false),
    ('idx_lakehouse_sync_failed', 'lakehouse_sync_jobs', ARRAY['status', 'created_at'], '"status" = ''failed''', false),
    ('idx_outbox_events_pending', 'outbox_events', ARRAY['status', 'created_at'], '"status" = ''pending''', false),
    ('idx_outbox_events_retry', 'outbox_events', ARRAY['status', 'retry_count'], '"status" = ''failed'' AND "retry_count" < 3', false),
    ('idx_idempotency_keys_expiry', 'idempotency_keys', ARRAY['expires_at'], '"expires_at" IS NOT NULL', false),
    ('idx_transactions_pending', 'transactions', ARRAY['user_id', 'created_at'], '"status" IN (''pending'', ''processing'')', false),
    ('idx_transactions_failed', 'transactions', ARRAY['created_at'], '"status" = ''failed''', false),
    ('idx_wallets_active', 'wallets', ARRAY['user_id', 'currency'], '"status" = ''active''', false),
    ('idx_kyc_documents_review_queue', 'kycDocuments', ARRAY['status', 'created_at'], '"status" = ''under_review''', false),
    ('idx_compliance_cases_open', 'complianceCases', ARRAY['status', 'created_at'], '"status" IN (''open'', ''under_review'')', false),
    ('idx_audit_logs_critical', 'auditLogs', ARRAY['severity', 'created_at'], '"severity" = ''critical''', false),
    ('idx_fraud_alerts_unresolved', 'fraud_alerts', ARRAY['user_id', 'created_at'], '"resolved_at" IS NULL', false),
    ('idx_notifications_unread', 'notifications', ARRAY['user_id', 'created_at'], '"isRead" = false', false),
    ('idx_savings_goals_active', 'savingsGoals', ARRAY['user_id'], '"status" = ''active''', false),
    ('idx_fx_alerts_active', 'fxAlerts', ARRAY['user_id', 'fromCurrency', 'toCurrency'], '"isActive" = true AND "triggered" = false', false),
    ('idx_recurring_payments_active', 'recurringPayments', ARRAY['user_id', 'nextRunAt'], '"status" = ''active''', false),
    ('idx_sanctions_checks_pending', 'sanctions_checks', ARRAY['created_at'], '"result" = ''pending_review''', false),
    ('idx_beneficiaries_favorites', 'beneficiaries', ARRAY['user_id'], '"isFavorite" = true', false),
    ('idx_rate_locks_active', 'rate_locks', ARRAY['user_id', 'expires_at'], '"status" = ''active''', false),
    ('idx_p2p_transfers_inflight', 'p2p_transfers', ARRAY['sender_id', 'created_at'], '"status" NOT IN (''completed'', ''failed'', ''cancelled'')', false),
    ('idx_stablecoin_wallets_active', 'stablecoin_wallets', ARRAY['user_id'], '"status" = ''active''', false),
    ('idx_temporal_executions_type', 'temporal_executions', ARRAY['workflow_type', 'status', 'created_at'], NULL, false),
    ('idx_apisix_route_logs_recent', 'apisix_route_logs', ARRAY['created_at'], NULL, false),
    ('idx_redis_cache_audit_miss', 'redis_cache_audit', ARRAY['key_pattern', 'miss_count'], NULL, false)
    ) AS requested(index_name, table_name, columns, predicate, is_unique)
  LOOP
    mapped_columns := ARRAY[]::text[];
    can_create := true;

    FOREACH source_column IN ARRAY target.columns LOOP
      SELECT columns.column_name
        INTO resolved_column
        FROM information_schema.columns AS columns
       WHERE columns.table_schema = 'public'
         AND columns.table_name = target.table_name
         AND (
           columns.column_name = source_column
           OR lower(replace(columns.column_name, '_', '')) = lower(replace(source_column, '_', ''))
         )
       ORDER BY CASE WHEN columns.column_name = source_column THEN 0 ELSE 1 END
       LIMIT 1;
      IF resolved_column IS NULL THEN
        can_create := false;
        EXIT;
      END IF;
      mapped_columns := array_append(mapped_columns, resolved_column);
    END LOOP;

    rendered_predicate := target.predicate;
    IF can_create AND rendered_predicate IS NOT NULL THEN
      FOR source_column IN
        SELECT DISTINCT (match)[1]
          FROM regexp_matches(rendered_predicate, '"([^"]+)"', 'g') AS match
      LOOP
        SELECT columns.column_name
          INTO resolved_column
          FROM information_schema.columns AS columns
         WHERE columns.table_schema = 'public'
           AND columns.table_name = target.table_name
           AND (
             columns.column_name = source_column
             OR lower(replace(columns.column_name, '_', '')) = lower(replace(source_column, '_', ''))
           )
         ORDER BY CASE WHEN columns.column_name = source_column THEN 0 ELSE 1 END
         LIMIT 1;
        IF resolved_column IS NULL THEN
          can_create := false;
          EXIT;
        END IF;
        rendered_predicate := replace(rendered_predicate, format('"%s"', source_column), quote_ident(resolved_column));
      END LOOP;
    END IF;

    IF can_create THEN
      SELECT string_agg(quote_ident(column_name), ', ')
        INTO rendered_columns
        FROM unnest(mapped_columns) AS column_name;
      EXECUTE format(
        'CREATE %sINDEX IF NOT EXISTS %I ON %I.%I (%s)%s',
        CASE WHEN target.is_unique THEN 'UNIQUE ' ELSE '' END,
        target.index_name,
        'public',
        target.table_name,
        rendered_columns,
        CASE WHEN rendered_predicate IS NULL THEN '' ELSE ' WHERE ' || rendered_predicate END
      );
    END IF;
  END LOOP;
END $$;
