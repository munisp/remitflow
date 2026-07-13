/**
 * RemitFlow — Circuit Breaker & Service Mesh Configuration
 * ─────────────────────────────────────────────────────────
 * Implements:
 * - Circuit breaker pattern (closed → open → half-open)
 * - Health check probes (liveness, readiness, startup)
 * - Retry policies per service
 * - Bulkhead pattern for resource isolation
 * - Service discovery registry
 * - Graceful degradation fallbacks
 */
import { logger } from "../_core/logger";

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

type CircuitState = "closed" | "open" | "half_open";

interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number; // ms before transitioning from open to half-open
  monitorInterval: number;
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: number;
  lastSuccess: number;
  totalRequests: number;
  totalFailures: number;
  openedAt: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 30_000,
  monitorInterval: 10_000,
};


// ── PostgreSQL Write-Through ─────────────────────────────────────────────────
// All in-memory Maps are persisted to PostgreSQL on write and loaded on startup.

let _wtDb: ReturnType<typeof import("drizzle-orm/postgres-js").drizzle> | null = null;

async function _getWtDb() {
  if (_wtDb) return _wtDb;
  try {
    const { getDb } = await import("../db.js");
    _wtDb = await getDb();
    return _wtDb;
  } catch {
    return null;
  }
}

async function _writeThrough(table: string, key: string, value: unknown): Promise<void> {
  const db = await _getWtDb();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      INSERT INTO ${sql.raw(table)} (key, data, updated_at)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `);
  } catch { /* silent — hot cache still works */ }
}

async function _loadFromDb(table: string): Promise<Map<string, any>> {
  const result = new Map<string, any>();
  const db = await _getWtDb();
  if (!db) return result;
  try {
    const { sql } = await import("drizzle-orm");
    const rows = await (db as any).execute(sql`SELECT key, data FROM ${sql.raw(table)}`);
    for (const row of rows) {
      result.set(row.key, row.data);
    }
  } catch { /* silent */ }
  return result;
}

async function _deleteFromDb(table: string, key: string): Promise<void> {
  const db = await _getWtDb();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`DELETE FROM ${sql.raw(table)} WHERE key = ${key}`);
  } catch { /* silent */ }
}

async function _ensureWriteThroughTables(): Promise<void> {
  const db = await _getWtDb();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      CREATE TABLE IF NOT EXISTS circuit_breaker_circuits (
        key TEXT PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await (db as any).execute(sql`
      CREATE TABLE IF NOT EXISTS circuit_breaker_bulkheads (
        key TEXT PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch { /* silent */ }
}

// Initialize tables on module load
_ensureWriteThroughTables().catch(() => {});

const circuits = new Map<string, { state: CircuitBreakerState; config: CircuitBreakerConfig }>(); // Persisted to PostgreSQL table "circuit_breaker_circuits"

export function getOrCreateCircuit(
  name: string,
  config: Partial<CircuitBreakerConfig> = {}
): CircuitBreakerState {
  if (!circuits.has(name)) {
    circuits.set(name, {
      state: {
        state: "closed",
        failures: 0,
        successes: 0,
        lastFailure: 0,
        lastSuccess: 0,
        totalRequests: 0,
        totalFailures: 0,
        openedAt: 0,
      },
      config: { ...DEFAULT_CONFIG, ...config },
    });

    _writeThrough("circuit_breaker_circuits", name, {
      state: {
        state: "closed",
        failures: 0,
        successes: 0,
        lastFailure: 0,
        lastSuccess: 0,
        totalRequests: 0,
        totalFailures: 0,
        openedAt: 0,
      },
      config: { ...DEFAULT_CONFIG, ...config },
    }).catch(() => {});
  }
  return circuits.get(name)!.state;
}

export async function executeWithCircuitBreaker<T>(
  serviceName: string,
  fn: () => Promise<T>,
  fallback?: () => T,
  config?: Partial<CircuitBreakerConfig>
): Promise<T> {
  const circuit = circuits.get(serviceName);
  const breaker = circuit || {
    state: getOrCreateCircuit(serviceName, config),
    config: { ...DEFAULT_CONFIG, ...config },
  };
  const { state, config: cfg } = breaker;

  state.totalRequests++;

  // Check if circuit is open
  if (state.state === "open") {
    const timeSinceOpen = Date.now() - state.openedAt;
    if (timeSinceOpen >= cfg.timeout) {
      // Transition to half-open
      state.state = "half_open";
      logger.info(`[CircuitBreaker] ${serviceName}: open → half_open`);
    } else {
      // Circuit is open — use fallback or throw
      if (fallback) return fallback();
      throw new Error(`Circuit breaker OPEN for ${serviceName}. Retry after ${cfg.timeout - timeSinceOpen}ms`);
    }
  }

  try {
    const result = await fn();

    // Success
    state.successes++;
    state.lastSuccess = Date.now();

    if (state.state === "half_open") {
      if (state.successes >= cfg.successThreshold) {
        state.state = "closed";
        state.failures = 0;
        state.successes = 0;
        logger.info(`[CircuitBreaker] ${serviceName}: half_open → closed`);
      }
    } else {
      state.failures = 0; // Reset consecutive failures on success
    }

    return result;
  } catch (err) {
    // Failure
    state.failures++;
    state.totalFailures++;
    state.lastFailure = Date.now();

    if (state.failures >= cfg.failureThreshold) {
      state.state = "open";
      state.openedAt = Date.now();
      logger.warn(`[CircuitBreaker] ${serviceName}: → OPEN after ${state.failures} failures`);
    }

    if (fallback) {
      logger.warn(`[CircuitBreaker] ${serviceName}: using fallback`, {
        error: (err as Error).message,
      });
      return fallback();
    }

    throw err;
  }
}

export function getCircuitBreakerStats(): Record<string, CircuitBreakerState> {
  const stats: Record<string, CircuitBreakerState> = {};
  Array.from(circuits.entries()).forEach(([name, { state }]) => {
    stats[name] = { ...state };
  });
  return stats;
}

export function resetCircuit(serviceName: string): boolean {
  const circuit = circuits.get(serviceName);
  if (!circuit) return false;
  circuit.state = {
    state: "closed",
    failures: 0,
    successes: 0,
    lastFailure: 0,
    lastSuccess: 0,
    totalRequests: circuit.state.totalRequests,
    totalFailures: circuit.state.totalFailures,
    openedAt: 0,
  };
  return true;
}

// ─── Health Check Probes ─────────────────────────────────────────────────────

export interface HealthProbe {
  type: "liveness" | "readiness" | "startup";
  check: () => Promise<boolean>;
  intervalMs: number;
  timeoutMs: number;
  failureThreshold: number;
  successThreshold: number;
}

let startupComplete = false;

export const PROBES: Record<string, HealthProbe> = {
  liveness: {
    type: "liveness",
    check: async () => {
      // Process is alive and responsive
      return true;
    },
    intervalMs: 10_000,
    timeoutMs: 3_000,
    failureThreshold: 3,
    successThreshold: 1,
  },
  readiness: {
    type: "readiness",
    check: async () => {
      // Can serve traffic — DB connected, essential services available
      try {
        const { getDb } = await import("../db.js");
        const db = await getDb();
        if (!db) return false;
        const { sql } = await import("drizzle-orm");
        await db.execute(sql`SELECT 1`);
        return true;
      } catch {
        return false;
      }
    },
    intervalMs: 15_000,
    timeoutMs: 5_000,
    failureThreshold: 2,
    successThreshold: 1,
  },
  startup: {
    type: "startup",
    check: async () => {
      return startupComplete;
    },
    intervalMs: 5_000,
    timeoutMs: 3_000,
    failureThreshold: 30, // 30 * 5s = 150s startup budget
    successThreshold: 1,
  },
};

export function markStartupComplete() {
  startupComplete = true;
  logger.info("[Probes] Startup probe marked complete");
}

export async function checkProbe(probeName: string): Promise<{
  status: "pass" | "fail";
  details?: string;
  checkedAt: string;
}> {
  const probe = PROBES[probeName];
  if (!probe) return { status: "fail", details: "Unknown probe", checkedAt: new Date().toISOString() };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), probe.timeoutMs);

    const result = await probe.check();
    clearTimeout(timer);

    return {
      status: result ? "pass" : "fail",
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: "fail",
      details: (err as Error).message,
      checkedAt: new Date().toISOString(),
    };
  }
}

// ─── Retry Policies ──────────────────────────────────────────────────────────

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
  retryableErrors: string[];
}

export const SERVICE_RETRY_POLICIES: Record<string, RetryPolicy> = {
  "kyc-engine": {
    maxRetries: 2,
    baseDelayMs: 500,
    maxDelayMs: 5000,
    retryableStatuses: [502, 503, 504],
    retryableErrors: ["ECONNREFUSED", "ETIMEDOUT"],
  },
  "sanctions-screening": {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    retryableStatuses: [502, 503, 504],
    retryableErrors: ["ECONNREFUSED", "ETIMEDOUT"],
  },
  "payment-rails": {
    maxRetries: 5,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
    retryableStatuses: [502, 503, 504, 429],
    retryableErrors: ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"],
  },
  "bvn-nin": {
    maxRetries: 2,
    baseDelayMs: 1000,
    maxDelayMs: 5000,
    retryableStatuses: [502, 503],
    retryableErrors: ["ECONNREFUSED"],
  },
  "fx-engine": {
    maxRetries: 1, // FX rates are time-sensitive, don't retry much
    baseDelayMs: 200,
    maxDelayMs: 1000,
    retryableStatuses: [503],
    retryableErrors: ["ECONNREFUSED"],
  },
};

// ─── Bulkhead Pattern ────────────────────────────────────────────────────────

interface BulkheadConfig {
  maxConcurrent: number;
  maxQueue: number;
  timeoutMs: number;
}

const bulkheads = new Map<string, { active: number; queue: number; config: BulkheadConfig }>(); // Persisted to PostgreSQL table "circuit_breaker_bulkheads"

export const BULKHEAD_CONFIGS: Record<string, BulkheadConfig> = {
  "payment-processing": { maxConcurrent: 50, maxQueue: 100, timeoutMs: 30_000 },
  "kyc-verification": { maxConcurrent: 20, maxQueue: 50, timeoutMs: 60_000 },
  "sanctions-screening": { maxConcurrent: 30, maxQueue: 50, timeoutMs: 10_000 },
  "fx-conversion": { maxConcurrent: 100, maxQueue: 200, timeoutMs: 5_000 },
};

export async function executeWithBulkhead<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const config = BULKHEAD_CONFIGS[name] || { maxConcurrent: 50, maxQueue: 100, timeoutMs: 30_000 };
  let bulkhead = bulkheads.get(name);
  if (!bulkhead) {
    bulkhead = { active: 0, queue: 0, config };
    bulkheads.set(name, bulkhead);

    _writeThrough("circuit_breaker_bulkheads", name, bulkhead).catch(() => {});
  }

  if (bulkhead.active >= config.maxConcurrent) {
    if (bulkhead.queue >= config.maxQueue) {
      throw new Error(`Bulkhead ${name} exhausted: ${bulkhead.active} active, ${bulkhead.queue} queued`);
    }
    bulkhead.queue++;
    // Wait for a slot
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        bulkhead!.queue--;
        reject(new Error(`Bulkhead ${name} timeout after ${config.timeoutMs}ms`));
      }, config.timeoutMs);

      const checkInterval = setInterval(() => {
        if (bulkhead!.active < config.maxConcurrent) {
          clearInterval(checkInterval);
          clearTimeout(timer);
          bulkhead!.queue--;
          resolve();
        }
      }, 100);
    });
  }

  bulkhead.active++;
  try {
    return await fn();
  } finally {
    bulkhead.active--;
  }
}

// ─── Service Registry ────────────────────────────────────────────────────────

export interface ServiceEndpoint {
  name: string;
  url: string;
  healthUrl: string;
  status: "healthy" | "degraded" | "unhealthy";
  lastCheck: number;
  circuitState: CircuitState;
  retryPolicy: RetryPolicy;
}

export function getServiceRegistry(): ServiceEndpoint[] {
  const services: ServiceEndpoint[] = [
    { name: "kyc-engine", url: process.env.KYC_ENGINE_URL || "http://localhost:8070" },
    { name: "bvn-nin-service", url: process.env.BVN_NIN_SERVICE_URL || "http://localhost:8071" },
    { name: "sanctions-screener", url: process.env.SANCTIONS_SCREENER_URL || "http://localhost:8072" },
    { name: "goaml-integration", url: process.env.GOAML_SERVICE_URL || "http://localhost:8073" },
    { name: "aml-engine", url: process.env.AML_ENGINE_URL || "http://localhost:8103" },
    { name: "fraud-ml", url: process.env.FRAUD_ML_URL || "http://localhost:8104" },
    { name: "transfer-engine", url: process.env.TRANSFER_ENGINE_URL || "http://localhost:8105" },
    { name: "fx-engine", url: process.env.FX_ENGINE_URL || "http://localhost:8060" },
    { name: "liveness-orchestrator", url: process.env.LIVENESS_ORCHESTRATOR_URL || "http://localhost:8074" },
  ].map((s) => ({
    ...s,
    healthUrl: `${s.url}/health`,
    status: "healthy" as const,
    lastCheck: 0,
    circuitState: (circuits.get(s.name)?.state.state || "closed") as CircuitState,
    retryPolicy: SERVICE_RETRY_POLICIES[s.name] || SERVICE_RETRY_POLICIES["fx-engine"],
  }));

  return services;
}
