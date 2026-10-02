-- go-notification-hub persistence (W19): durable delivery audit records.
CREATE TABLE IF NOT EXISTS notification_deliveries (
    id         TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL DEFAULT 0,
    channel    TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT '',
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user ON notification_deliveries (user_id);
