import crypto from "crypto";
import { logger } from '../_core/logger';
/**
 * RemitFlow — Dapr Client (Production v2)
 *
 * Full Dapr sidecar integration:
 *   - Pub/Sub (publish + subscription handler registration)
 *   - State store (CRUD + bulk + transactions)
 *   - Service invocation
 *   - Distributed lock (via lock API alpha1)
 *   - Secret store (retrieve secrets from Dapr secret stores)
 *   - Actor invocation (virtual actor pattern)
 *   - Output bindings (Kafka, email, etc.)
 */

const DAPR_HTTP_PORT = process.env.DAPR_HTTP_PORT || "3500";
const DAPR_BASE_URL = `http://localhost:${DAPR_HTTP_PORT}`;
const PUBSUB_NAME = process.env.DAPR_PUBSUB_NAME || "remitflow-pubsub";
const STATE_STORE_NAME = process.env.DAPR_STATESTORE_NAME || "remitflow-statestore";
const SECRET_STORE_NAME = process.env.DAPR_SECRET_STORE || "kubernetes";
const LOCK_STORE_NAME = process.env.DAPR_LOCK_STORE || "remitflow-statestore";

// ── Dapr Client ───────────────────────────────────────────────────────────────

class DaprClient {
  private available = false;
  private checkedAt = 0;
  private metadata: Record<string, unknown> | null = null;

  constructor() {
    this.checkAvailability();
  }

  private async checkAvailability(): Promise<void> {
    if (Date.now() - this.checkedAt < 30_000 && this.checkedAt > 0) return;
    this.checkedAt = Date.now();
    try {
      const res = await fetch(`${DAPR_BASE_URL}/v1.0/healthz`, {
        signal: AbortSignal.timeout(1500),
      });
      this.available = res.ok;
      if (this.available) {
        const metaRes = await fetch(`${DAPR_BASE_URL}/v1.0/metadata`, { signal: AbortSignal.timeout(1500) });
        if (metaRes.ok) this.metadata = await metaRes.json() as Record<string, unknown>;
        logger.info("[DAPR] Sidecar connected");
      }
    } catch {
      this.available = false;
      logger.info("[DAPR] Sidecar not available, using direct messaging");
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  getMetadata(): Record<string, unknown> | null {
    return this.metadata;
  }

  // ── Pub/Sub ──────────────────────────────────────────────────────────────────

  async publish(topic: string, data: unknown, pubsubName = PUBSUB_NAME): Promise<boolean> {
    if (!this.available) return false;
    try {
      const res = await fetch(
        `${DAPR_BASE_URL}/v1.0/publish/${pubsubName}/${encodeURIComponent(topic)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
          signal: AbortSignal.timeout(3000),
        }
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Build subscription config for Express/Hono endpoint registration */
  getSubscriptions(): Array<{ pubsubname: string; topic: string; route: string }> {
    return [
      { pubsubname: PUBSUB_NAME, topic: "remitflow.transactions", route: "/dapr/sub/transactions" },
      { pubsubname: PUBSUB_NAME, topic: "remitflow.kyc.events", route: "/dapr/sub/kyc-events" },
      { pubsubname: PUBSUB_NAME, topic: "remitflow.fx.rates", route: "/dapr/sub/fx-rates" },
      { pubsubname: PUBSUB_NAME, topic: "remitflow.notifications.stream", route: "/dapr/sub/notifications" },
      { pubsubname: PUBSUB_NAME, topic: "remitflow.audit.stream", route: "/dapr/sub/audit" },
      { pubsubname: PUBSUB_NAME, topic: "remitflow.compliance.alert", route: "/dapr/sub/compliance" },
    ];
  }

  // ── State Store ──────────────────────────────────────────────────────────────

  async getState<T = unknown>(key: string): Promise<T | null> {
    if (!this.available) return null;
    try {
      const res = await fetch(
        `${DAPR_BASE_URL}/v1.0/state/${STATE_STORE_NAME}/${encodeURIComponent(key)}`,
        { signal: AbortSignal.timeout(2000) }
      );
      if (!res.ok || res.status === 204) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  async setState(key: string, value: unknown, ttl?: number): Promise<boolean> {
    if (!this.available) return false;
    try {
      const body = [{
        key,
        value,
        metadata: ttl ? { ttlInSeconds: ttl.toString() } : undefined,
      }];
      const res = await fetch(`${DAPR_BASE_URL}/v1.0/state/${STATE_STORE_NAME}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async deleteState(key: string): Promise<boolean> {
    if (!this.available) return false;
    try {
      const res = await fetch(
        `${DAPR_BASE_URL}/v1.0/state/${STATE_STORE_NAME}/${encodeURIComponent(key)}`,
        { method: "DELETE", signal: AbortSignal.timeout(2000) }
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Bulk state get — single round-trip */
  async getBulkState(keys: string[]): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>();
    if (!this.available || keys.length === 0) return result;
    try {
      const res = await fetch(`${DAPR_BASE_URL}/v1.0/state/${STATE_STORE_NAME}/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json() as Array<{ key: string; data: unknown }>;
        for (const item of data) {
          if (item.data) result.set(item.key, item.data);
        }
      }
    } catch { /* noop */ }
    return result;
  }

  /** State transaction — atomic multi-key operations */
  async executeStateTransaction(operations: Array<{ operation: "upsert" | "delete"; request: { key: string; value?: unknown } }>): Promise<boolean> {
    if (!this.available) return false;
    try {
      const res = await fetch(`${DAPR_BASE_URL}/v1.0/state/${STATE_STORE_NAME}/transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operations }),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Service Invocation ────────────────────────────────────────────────────────

  async invokeService<T = unknown>(
    appId: string,
    method: string,
    httpMethod: "GET" | "POST" | "PUT" | "DELETE" = "POST",
    data?: unknown,
    retries = 3
  ): Promise<T | null> {
    if (!this.available) return null;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch(
          `${DAPR_BASE_URL}/v1.0/invoke/${appId}/method/${method}`,
          {
            method: httpMethod,
            headers: data ? { "Content-Type": "application/json" } : undefined,
            body: data ? JSON.stringify(data) : undefined,
            signal: AbortSignal.timeout(5000),
          }
        );
        if (!res.ok) {
          lastError = new Error(`Dapr invoke ${appId}/${method} returned ${res.status}`);
          if (res.status >= 500) {
            await new Promise(r => setTimeout(r, (attempt + 1) * 200));
            continue;
          }
          return null;
        }
        return (await res.json()) as T;
      } catch (err) {
        lastError = err as Error;
        await new Promise(r => setTimeout(r, (attempt + 1) * 200));
      }
    }
    logger.warn(`[DAPR] invokeService ${appId}/${method} failed after ${retries} retries: ${lastError?.message}`);
    return null;
  }

  // ── Distributed Lock ──────────────────────────────────────────────────────────

  async acquireLock(resourceId: string, lockOwner: string, expiryInSeconds = 30): Promise<boolean> {
    if (!this.available) return false;
    try {
      const res = await fetch(`${DAPR_BASE_URL}/v1.0-alpha1/lock/${LOCK_STORE_NAME}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId, lockOwner, expiryInSeconds }),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const data = await res.json() as { success: boolean };
      return data.success;
    } catch {
      return false;
    }
  }

  async releaseLock(resourceId: string, lockOwner: string): Promise<boolean> {
    if (!this.available) return false;
    try {
      const res = await fetch(`${DAPR_BASE_URL}/v1.0-alpha1/unlock/${LOCK_STORE_NAME}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId, lockOwner }),
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Execute a function while holding a distributed lock */
  async withLock<T>(resourceId: string, fn: () => Promise<T>, expiryInSeconds = 30): Promise<T | null> {
    const owner = `remitflow-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
    const acquired = await this.acquireLock(resourceId, owner, expiryInSeconds);
    if (!acquired) {
      logger.warn(`[DAPR] Could not acquire lock: ${resourceId}`);
      return null;
    }
    try {
      return await fn();
    } finally {
      await this.releaseLock(resourceId, owner);
    }
  }

  // ── Secret Store ──────────────────────────────────────────────────────────────

  async getSecret(secretName: string, storeName = SECRET_STORE_NAME): Promise<Record<string, string> | null> {
    if (!this.available) return null;
    try {
      const res = await fetch(
        `${DAPR_BASE_URL}/v1.0/secrets/${storeName}/${encodeURIComponent(secretName)}`,
        { signal: AbortSignal.timeout(2000) }
      );
      if (!res.ok) return null;
      return await res.json() as Record<string, string>;
    } catch {
      return null;
    }
  }

  async getBulkSecrets(storeName = SECRET_STORE_NAME): Promise<Record<string, Record<string, string>> | null> {
    if (!this.available) return null;
    try {
      const res = await fetch(`${DAPR_BASE_URL}/v1.0/secrets/${storeName}/bulk`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      return await res.json() as Record<string, Record<string, string>>;
    } catch {
      return null;
    }
  }

  // ── Actor Invocation ──────────────────────────────────────────────────────────

  async invokeActor<T = unknown>(actorType: string, actorId: string, method: string, data?: unknown): Promise<T | null> {
    if (!this.available) return null;
    try {
      const res = await fetch(
        `${DAPR_BASE_URL}/v1.0/actors/${actorType}/${actorId}/method/${method}`,
        {
          method: "POST",
          headers: data ? { "Content-Type": "application/json" } : undefined,
          body: data ? JSON.stringify(data) : undefined,
          signal: AbortSignal.timeout(5000),
        }
      );
      if (!res.ok) return null;
      const text = await res.text();
      return text ? JSON.parse(text) as T : null;
    } catch {
      return null;
    }
  }

  async getActorState<T = unknown>(actorType: string, actorId: string, key: string): Promise<T | null> {
    if (!this.available) return null;
    try {
      const res = await fetch(
        `${DAPR_BASE_URL}/v1.0/actors/${actorType}/${actorId}/state/${key}`,
        { signal: AbortSignal.timeout(2000) }
      );
      if (!res.ok) return null;
      return await res.json() as T;
    } catch {
      return null;
    }
  }

  // ── Output Bindings ──────────────────────────────────────────────────────────

  async invokeBinding(bindingName: string, operation: string, data?: unknown, metadata?: Record<string, string>): Promise<unknown> {
    if (!this.available) return null;
    try {
      const res = await fetch(`${DAPR_BASE_URL}/v1.0/bindings/${bindingName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation, data, metadata }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let daprClient: DaprClient | null = null;

export function getDaprClient(): DaprClient {
  if (!daprClient) {
    daprClient = new DaprClient();
  }
  return daprClient;
}

// ── High-Level Dapr Helpers ───────────────────────────────────────────────────

export async function publishViaDapr(topic: string, data: unknown): Promise<boolean> {
  return getDaprClient().publish(topic, data);
}

export async function invokeRiskEngine(payload: {
  transactionId: string;
  userId: string;
  amount: number;
  currency: string;
  destinationCountry?: string;
}): Promise<{
  riskScore: number;
  riskLevel: string;
  decision: string;
  flags: string[];
} | null> {
  return getDaprClient().invokeService("risk-engine", "evaluate", "POST", payload);
}

export async function invokeFXEngine(
  baseCurrency: string,
  quoteCurrency: string
): Promise<{ rate: number; provider: string; timestamp: string } | null> {
  return getDaprClient().invokeService(
    "fx-engine",
    `rate/${baseCurrency}/${quoteCurrency}`,
    "GET"
  );
}

export async function invokeLedgerService(operation: {
  type: "debit" | "credit" | "transfer";
  accountId: string;
  amount: bigint;
  currency: string;
  reference: string;
}): Promise<{ success: boolean; ledgerId?: string } | null> {
  return getDaprClient().invokeService("ledger-service", "transfer", "POST", {
    ...operation,
    amount: operation.amount.toString(),
  });
}

/** Distributed lock for transfer idempotency */
export async function withTransferLock<T>(transferId: string, fn: () => Promise<T>): Promise<T | null> {
  return getDaprClient().withLock(`transfer:${transferId}`, fn, 60);
}

/** Distributed lock for wallet balance updates */
export async function withWalletLock<T>(walletId: number, fn: () => Promise<T>): Promise<T | null> {
  return getDaprClient().withLock(`wallet:${walletId}`, fn, 15);
}
