-- Developer platform, outbox, and push-notification contract reconciliation.
ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS outbox_events_next_retry_idx
  ON outbox_events (status, next_retry_at);

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS key_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS test_mode BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE api_keys
  SET key_id = COALESCE(key_id, CONCAT('key_', id::text))
  WHERE key_id IS NULL;
ALTER TABLE api_keys
  ALTER COLUMN key_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_id_unique_idx ON api_keys (key_id);

CREATE TABLE IF NOT EXISTS push_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  platform VARCHAR(16) NOT NULL,
  device_id VARCHAR(128),
  app_version VARCHAR(64),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_tokens_user_active_idx ON push_tokens (user_id, is_active);
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS app_version VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_user_category_unique_idx
  ON "notificationPreferences" ("userId", category);
