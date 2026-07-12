/**
 * RemitFlow — Dapr Pub/Sub Integration
 * ──────────────────────────────────────
 * Provides type-safe Dapr pub/sub wrappers for all platform events.
 *
 * Topics:
 *   - transfer.initiated / transfer.completed / transfer.failed
 *   - kyc.verification.started / kyc.approved / kyc.rejected
 *   - user.provisioned / user.suspended
 *   - compliance.case.opened / compliance.case.resolved
 *   - fraud.alert.raised / fraud.alert.resolved
 *   - fx.rate.updated
 */
import { logger } from "../../_core/logger";

const DAPR_HTTP_PORT = process.env.DAPR_HTTP_PORT || "3500";
const PUBSUB_NAME = process.env.DAPR_PUBSUB_NAME || "remitflow-pubsub";
const BASE_URL = `http://localhost:${DAPR_HTTP_PORT}/v1.0/publish/${PUBSUB_NAME}`;

// ─── Event Types ──────────────────────────────────────────────────────────────
export interface TransferInitiatedEvent {
  userId: number;
  amount: string;
  fromCurrency: string;
  toCurrency: string;
  rail: string;
  workflowId: string;
  idempotencyKey: string;
  timestamp: string;
}

export interface TransferCompletedEvent {
  userId: number;
  transactionId: number;
  amount: string;
  fromCurrency: string;
  toCurrency: string;
  workflowId: string;
  timestamp: string;
}

export interface TransferFailedEvent {
  userId: number;
  transactionId?: number;
  amount: string;
  fromCurrency: string;
  toCurrency: string;
  error: string;
  workflowId: string;
  timestamp: string;
}

export interface KycVerificationEvent {
  userId: number;
  documentId: number;
  workflowId: string;
  timestamp: string;
}

export interface KycApprovedEvent {
  userId: number;
  documentId: number;
  newTier: string;
  timestamp: string;
}

export interface UserProvisionedEvent {
  userId: number;
  currencies: string[];
  timestamp: string;
}

export interface FraudAlertEvent {
  userId: number;
  alertId: number;
  riskScore: number;
  reason: string;
  timestamp: string;
}

export interface FxRateUpdatedEvent {
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  source: string;
  timestamp: string;
}

// ─── Publisher ────────────────────────────────────────────────────────────────
async function publish<T>(topic: string, data: T): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/${topic}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Dapr publish failed: HTTP ${res.status} — ${body}`);
    }
    logger.info({ topic }, "[Dapr] Event published");
  } catch (err) {
    logger.error({ err, topic }, "[Dapr] Event publish failed");
    // Do not throw — pub/sub failures should not block the main flow
    // The outbox pattern handles retries
  }
}

// ─── Typed Publishers ─────────────────────────────────────────────────────────
export const daprPublish = {
  transferInitiated: (data: TransferInitiatedEvent) => publish("transfer.initiated", data),
  transferCompleted: (data: TransferCompletedEvent) => publish("transfer.completed", data),
  transferFailed: (data: TransferFailedEvent) => publish("transfer.failed", data),
  kycVerificationStarted: (data: KycVerificationEvent) => publish("kyc.verification.started", data),
  kycApproved: (data: KycApprovedEvent) => publish("kyc.approved", data),
  kycRejected: (data: KycVerificationEvent) => publish("kyc.rejected", data),
  userProvisioned: (data: UserProvisionedEvent) => publish("user.provisioned", data),
  fraudAlertRaised: (data: FraudAlertEvent) => publish("fraud.alert.raised", data),
  fxRateUpdated: (data: FxRateUpdatedEvent) => publish("fx.rate.updated", data),
};

// ─── State Store ──────────────────────────────────────────────────────────────
const STATE_STORE_NAME = process.env.DAPR_STATE_STORE || "remitflow-state";
const STATE_BASE_URL = `http://localhost:${DAPR_HTTP_PORT}/v1.0/state/${STATE_STORE_NAME}`;

export async function daprSetState(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  try {
    const metadata = ttlSeconds ? { ttlInSeconds: String(ttlSeconds) } : {};
    const res = await fetch(STATE_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ key, value, metadata }]),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    logger.debug({ key }, "[Dapr] State set");
  } catch (err) {
    logger.error({ err, key }, "[Dapr] State set failed");
  }
}

export async function daprGetState<T>(key: string): Promise<T | null> {
  try {
    const res = await fetch(`${STATE_BASE_URL}/${key}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as T;
  } catch (err) {
    logger.error({ err, key }, "[Dapr] State get failed");
    return null;
  }
}

export async function daprDeleteState(key: string): Promise<void> {
  try {
    const res = await fetch(`${STATE_BASE_URL}/${key}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    logger.debug({ key }, "[Dapr] State deleted");
  } catch (err) {
    logger.error({ err, key }, "[Dapr] State delete failed");
  }
}
