import { logger } from '../_core/logger';
/**
 * RemitFlow — Dapr Client
 * Pub/Sub, state management, and service invocation via Dapr sidecar
 */

const DAPR_HTTP_PORT = process.env.DAPR_HTTP_PORT || "3500";
const DAPR_BASE_URL = `http://localhost:${DAPR_HTTP_PORT}/v1.0`;
const PUBSUB_NAME = "remitflow-pubsub";
const STATE_STORE_NAME = "remitflow-statestore";

// ── Dapr Client ───────────────────────────────────────────────────────────────

class DaprClient {
  private available = false;

  constructor() {
    this.checkAvailability();
  }

  private async checkAvailability(): Promise<void> {
    try {
      const res = await fetch(`${DAPR_BASE_URL}/healthz`, {
        signal: AbortSignal.timeout(1000),
      });
      this.available = res.ok;
      if (this.available) {
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

  // ── Pub/Sub ──────────────────────────────────────────────────────────────────

  async publish(topic: string, data: unknown): Promise<boolean> {
    if (!this.available) return false;

    try {
      const res = await fetch(
        `${DAPR_BASE_URL}/publish/${PUBSUB_NAME}/${encodeURIComponent(topic)}`,
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

  // ── State Store ──────────────────────────────────────────────────────────────

  async getState<T = unknown>(key: string): Promise<T | null> {
    if (!this.available) return null;

    try {
      const res = await fetch(
        `${DAPR_BASE_URL}/state/${STATE_STORE_NAME}/${encodeURIComponent(key)}`,
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
      const body = [
        {
          key,
          value,
          metadata: ttl ? { ttlInSeconds: ttl.toString() } : undefined,
        },
      ];

      const res = await fetch(`${DAPR_BASE_URL}/state/${STATE_STORE_NAME}`, {
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
        `${DAPR_BASE_URL}/state/${STATE_STORE_NAME}/${encodeURIComponent(key)}`,
        {
          method: "DELETE",
          signal: AbortSignal.timeout(2000),
        }
      );
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
    data?: unknown
  ): Promise<T | null> {
    if (!this.available) return null;

    try {
      const res = await fetch(
        `${DAPR_BASE_URL}/invoke/${appId}/method/${method}`,
        {
          method: httpMethod,
          headers: data ? { "Content-Type": "application/json" } : undefined,
          body: data ? JSON.stringify(data) : undefined,
          signal: AbortSignal.timeout(5000),
        }
      );
      if (!res.ok) return null;
      return (await res.json()) as T;
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
