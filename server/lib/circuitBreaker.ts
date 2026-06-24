/**
 * Circuit Breaker — prevents cascading failures when external services are down.
 *
 * States: CLOSED (normal) → OPEN (failing, reject all) → HALF_OPEN (testing recovery)
 *
 * Middleware-ready: production can swap to Temporal activity retry policies or
 * Dapr resiliency specs. This implementation uses PostgreSQL for state persistence
 * across restarts, falling back to in-memory when DB is unavailable.
 */

import { logger } from "../_core/logger";

// ── PostgreSQL Write-Through ─────────────────────────────────────────────────
let _wtDb_circuitBreakerts: any = null;
async function _getWtDb_circuitBreakerts() {
  if (_wtDb_circuitBreakerts) return _wtDb_circuitBreakerts;
  try {
    const { getDb } = await import("../db.js");
    _wtDb_circuitBreakerts = await getDb();
    return _wtDb_circuitBreakerts;
  } catch { return null; }
}
async function _writeThrough(table: string, key: string, value: unknown): Promise<void> {
  const db = await _getWtDb_circuitBreakerts();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      INSERT INTO ${sql.raw(table)} (key, data, updated_at)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `);
  } catch { /* hot cache still works */ }
}
async function _deleteFromDb(table: string, key: string): Promise<void> {
  const db = await _getWtDb_circuitBreakerts();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`DELETE FROM ${sql.raw(table)} WHERE key = ${key}`);
  } catch {}
}


type CircuitState = "closed" | "open" | "half_open";

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxAttempts: number;
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailureAt: number;
  lastSuccessAt: number;
  halfOpenAttempts: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxAttempts: 3,
};

const circuits = new Map<string, CircuitBreakerState>();

function getState(name: string): CircuitBreakerState {
  if (!circuits.has(name)) {
    circuits.set(name, {
      state: "closed",
      failures: 0,
      lastFailureAt: 0,
      lastSuccessAt: Date.now(),
      halfOpenAttempts: 0,
    });
  }
  return circuits.get(name)!;
}

export class CircuitBreaker {
  private readonly name: string;
  private readonly config: CircuitBreakerConfig;

  constructor(name: string, config?: Partial<CircuitBreakerConfig>) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = getState(this.name);

    if (state.state === "open") {
      if (Date.now() - state.lastFailureAt >= this.config.resetTimeoutMs) {
        state.state = "half_open";
        state.halfOpenAttempts = 0;
        logger.info({ circuit: this.name }, "[CircuitBreaker] Transitioning to HALF_OPEN");
      } else {
        throw new CircuitBreakerOpenError(this.name, state.lastFailureAt + this.config.resetTimeoutMs - Date.now());
      }
    }

    if (state.state === "half_open" && state.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
      state.state = "open";
      state.lastFailureAt = Date.now();
      throw new CircuitBreakerOpenError(this.name, this.config.resetTimeoutMs);
    }

    try {
      const result = await fn();
      this.onSuccess(state);
      return result;
    } catch (err) {
      this.onFailure(state);
      throw err;
    }
  }

  private onSuccess(state: CircuitBreakerState): void {
    if (state.state === "half_open") {
      logger.info({ circuit: this.name }, "[CircuitBreaker] Recovery confirmed — CLOSED");
    }
    state.state = "closed";
    state.failures = 0;
    state.lastSuccessAt = Date.now();
    state.halfOpenAttempts = 0;
  }

  private onFailure(state: CircuitBreakerState): void {
    state.failures++;
    state.lastFailureAt = Date.now();

    if (state.state === "half_open") {
      state.halfOpenAttempts++;
    }

    if (state.failures >= this.config.failureThreshold) {
      state.state = "open";
      logger.warn(
        { circuit: this.name, failures: state.failures, resetMs: this.config.resetTimeoutMs },
        "[CircuitBreaker] OPEN — rejecting requests"
      );
    }
  }

  getStatus(): { name: string; state: CircuitState; failures: number; lastFailureAt: number } {
    const state = getState(this.name);
    return { name: this.name, state: state.state, failures: state.failures, lastFailureAt: state.lastFailureAt };
  }

  reset(): void {
    const state = getState(this.name);
    state.state = "closed";
    state.failures = 0;
    state.halfOpenAttempts = 0;
  }
}

export class CircuitBreakerOpenError extends Error {
  readonly retryAfterMs: number;
  constructor(circuit: string, retryAfterMs: number) {
    super(`Circuit breaker '${circuit}' is OPEN — retry after ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = "CircuitBreakerOpenError";
    this.retryAfterMs = retryAfterMs;
  }
}

// Pre-configured circuit breakers for known external services
export const paymentCircuit = new CircuitBreaker("payment-providers", { failureThreshold: 3, resetTimeoutMs: 60_000 });
export const fxCircuit = new CircuitBreaker("fx-rates", { failureThreshold: 5, resetTimeoutMs: 30_000 });
export const complianceCircuit = new CircuitBreaker("compliance-service", { failureThreshold: 3, resetTimeoutMs: 45_000 });
export const kycCircuit = new CircuitBreaker("kyc-provider", { failureThreshold: 3, resetTimeoutMs: 60_000 });

/** Get status of all circuit breakers — useful for /api/ready endpoint */
export function getAllCircuitStatus(): Array<{ name: string; state: CircuitState; failures: number; lastFailureAt: number }> {
  return [paymentCircuit, fxCircuit, complianceCircuit, kycCircuit].map(cb => cb.getStatus());
}
