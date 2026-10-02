-- W20-A (SPEC-wave20, lane A): DL-23/DL-24 money-mutation idempotency +
-- pending-delivery tracking. Additive-only; mirrors drizzle/schema.ts
-- (paymentIdempotencyKeys, pendingDeliveries).
--
-- payment_idempotency_keys: durable idempotency arbiter for money mutations
-- (wallet.withdraw, savings withdraw/topups, airtime.topup, bills.pay,
-- qr.pay, transfer.send fallback). The key row is claimed with
-- INSERT ... ON CONFLICT DO NOTHING in the SAME db.transaction as the debit
-- and marked completed with the serialized response before commit.
-- tenant_id defaults to the platform default tenant 1 (routers.ts:4601
-- convention) and is NOT NULL so UNIQUE(tenant_id, key) cannot be bypassed
-- by NULL tenant rows.
--
-- pending_deliveries: tracks airtime/bill debits recorded as
-- PENDING_DELIVERY (routers.ts airtime.topup / bills.pay) until the
-- pendingDeliveryWorker fulfills them via a provider adapter (none exists
-- today) or auto-refunds after max attempts — refund + status transition +
-- audit row in one transaction.

CREATE TABLE IF NOT EXISTS payment_idempotency_keys (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
  key VARCHAR(200) NOT NULL,
  user_id INTEGER NOT NULL,
  procedure VARCHAR(100) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
  response_json JSONB,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_idempotency_keys_tenant_key_uidx
  ON payment_idempotency_keys (tenant_id, key);
CREATE INDEX IF NOT EXISTS payment_idempotency_keys_user_idx
  ON payment_idempotency_keys (user_id);

CREATE TABLE IF NOT EXISTS pending_deliveries (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER NOT NULL,
  kind VARCHAR(20) NOT NULL,
  reference VARCHAR(100) NOT NULL,
  currency VARCHAR(8) NOT NULL,
  amount VARCHAR(40) NOT NULL,
  provider VARCHAR(100),
  destination VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMP,
  last_error TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  resolved_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS pending_deliveries_reference_uidx
  ON pending_deliveries (reference);
CREATE INDEX IF NOT EXISTS pending_deliveries_status_idx
  ON pending_deliveries (status);
CREATE INDEX IF NOT EXISTS pending_deliveries_user_idx
  ON pending_deliveries (user_id);
