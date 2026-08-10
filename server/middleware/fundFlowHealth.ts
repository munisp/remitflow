/**
 * fundFlowHealth.ts — Fund Flow Middleware Health Dashboard
 *
 * Aggregates health status from all 6 middleware components:
 *   1. Redis (Sentinel/Cluster/Standalone)
 *   2. TigerBeetle (ledger)
 *   3. Temporal (saga orchestration)
 *   4. Kafka (event streaming)
 *   5. Go Orchestrator (saga lifecycle)
 *   6. Rust Transaction Guard (receipt chain)
 *   7. Python Reconciliation Engine (DLQ, drift detection)
 *
 * Exposes a single endpoint that returns the health of all components
 * with a top-level "fund_flow_ready" boolean indicating whether fund
 * operations can proceed safely.
 */

import { logger } from "../_core/logger.js";
import { getRedisHealth, isFundFlowStrictMode } from "./redisHardened";
import { getTemporalHealth, isTemporalStrictMode } from "../temporal/temporalClient";

const GO_ORCHESTRATOR_URL = process.env.GO_ORCHESTRATOR_URL ?? "http://localhost:8150";
const RUST_GUARD_URL = process.env.RUST_GUARD_URL ?? "http://localhost:8160";
const PYTHON_RECONCILIATION_URL = process.env.PYTHON_RECONCILIATION_URL ?? "http://localhost:8170";

interface ServiceHealth {
  status: "healthy" | "degraded" | "unavailable";
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface FundFlowHealthReport {
  fundFlowReady: boolean;
  strictMode: {
    redis: boolean;
    tigerBeetle: boolean;
    temporal: boolean;
  };
  services: {
    redis: ServiceHealth;
    tigerBeetle: ServiceHealth;
    temporal: ServiceHealth;
    kafka: ServiceHealth;
    goOrchestrator: ServiceHealth;
    rustGuard: ServiceHealth;
    pythonReconciliation: ServiceHealth;
  };
  timestamp: string;
}

async function checkServiceHealth(url: string, name: string): Promise<ServiceHealth> {
  const start = performance.now();
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const latencyMs = Math.round(performance.now() - start);
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      return { status: "healthy", latencyMs, details: data };
    }
    return { status: "degraded", latencyMs, error: `HTTP ${res.status}` };
  } catch (err) {
    return {
      status: "unavailable",
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkTigerBeetleHealth(): Promise<ServiceHealth> {
  const tbAddr = process.env.TIGERBEETLE_ADDRESSES;
  if (!tbAddr) {
    return { status: "unavailable", error: "TIGERBEETLE_ADDRESSES not configured" };
  }

  try {
    const { TigerBeetleIntegration } = await import("./middlewareIntegration.js");
    const start = performance.now();
    const tb = new TigerBeetleIntegration();
    // Attempt a health check by looking up a non-existent account
    await tb.lookupAccounts([BigInt(0)]);
    return { status: "healthy", latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return { status: "unavailable", error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkKafkaHealth(): Promise<ServiceHealth> {
  const brokers = process.env.KAFKA_BROKERS;
  if (!brokers) {
    return { status: "unavailable", error: "KAFKA_BROKERS not configured" };
  }

  try {
    const { KafkaIntegration } = await import("./middlewareIntegration.js");
    const start = performance.now();
    const kafka = new KafkaIntegration();
    // Just checking if the module initializes without error
    return { status: "healthy", latencyMs: Math.round(performance.now() - start), details: { brokers } };
  } catch (err) {
    return { status: "unavailable", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Get comprehensive health status of all fund flow middleware components.
 */
export async function getFundFlowHealth(): Promise<FundFlowHealthReport> {
  const [redis, tigerBeetle, temporal, kafka, go, rust, python] = await Promise.all([
    getRedisHealth().then(h => ({
      status: h.connected ? "healthy" as const : "unavailable" as const,
      latencyMs: h.latencyMs,
      error: h.lastError ?? undefined,
      details: { mode: h.mode, sentinelHosts: h.sentinelHosts },
    })),
    checkTigerBeetleHealth(),
    Promise.resolve({
      ...getTemporalHealth(),
      status: getTemporalHealth().connected ? "healthy" as const : "unavailable" as const,
      details: {
        host: getTemporalHealth().host,
        namespace: getTemporalHealth().namespace,
        taskQueue: getTemporalHealth().taskQueue,
      },
    } as ServiceHealth),
    checkKafkaHealth(),
    checkServiceHealth(GO_ORCHESTRATOR_URL, "go-orchestrator"),
    checkServiceHealth(RUST_GUARD_URL, "rust-guard"),
    checkServiceHealth(PYTHON_RECONCILIATION_URL, "python-reconciliation"),
  ]);

  const redisStrictMode = isFundFlowStrictMode();
  const tbStrictMode = process.env.NODE_ENV === "production" || process.env.FUND_FLOW_TIGERBEETLE_STRICT === "true";
  const temporalStrictMode = isTemporalStrictMode();

  // Fund flow is ready if all strict-mode services are healthy
  const fundFlowReady =
    (!redisStrictMode || redis.status === "healthy") &&
    (!tbStrictMode || tigerBeetle.status === "healthy") &&
    (!temporalStrictMode || temporal.status === "healthy");

  return {
    fundFlowReady,
    strictMode: {
      redis: redisStrictMode,
      tigerBeetle: tbStrictMode,
      temporal: temporalStrictMode,
    },
    services: {
      redis,
      tigerBeetle,
      temporal,
      kafka,
      goOrchestrator: go,
      rustGuard: rust,
      pythonReconciliation: python,
    },
    timestamp: new Date().toISOString(),
  };
}
