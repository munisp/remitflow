/**
 * RemitFlow — Graceful Degradation Framework
 *
 * Per-service fallback strategies when downstream dependencies are unavailable.
 * Each service has a degraded-mode response that allows the platform to keep
 * functioning with reduced capability rather than failing entirely.
 */
import { logger } from "../_core/logger";
import { getRedisClient } from "../middleware/redis";

// ── Types ────────────────────────────────────────────────────────────────────

type DependencyStatus = "healthy" | "degraded" | "unavailable";

interface DependencyHealth {
  name: string;
  status: DependencyStatus;
  lastCheck: number;
  lastHealthy: number;
  consecutiveFailures: number;
  degradedSince: number | null;
}

interface DegradedResponse<T> {
  data: T;
  degraded: boolean;
  reason?: string;
  fallbackSource?: string;
}

// ── Dependency Registry ──────────────────────────────────────────────────────

const dependencies = new Map<string, DependencyHealth>();
const CHECK_INTERVAL_MS = 30_000;

function getDep(name: string): DependencyHealth {
  if (!dependencies.has(name)) {
    dependencies.set(name, {
      name,
      status: "healthy",
      lastCheck: 0,
      lastHealthy: Date.now(),
      consecutiveFailures: 0,
      degradedSince: null,
    });
  }
  return dependencies.get(name)!;
}

export function markHealthy(name: string): void {
  const dep = getDep(name);
  if (dep.status !== "healthy") {
    logger.info({ dependency: name }, "[Degradation] dependency recovered");
  }
  dep.status = "healthy";
  dep.lastCheck = Date.now();
  dep.lastHealthy = Date.now();
  dep.consecutiveFailures = 0;
  dep.degradedSince = null;
}

export function markDegraded(name: string, reason?: string): void {
  const dep = getDep(name);
  dep.consecutiveFailures++;
  dep.lastCheck = Date.now();

  if (dep.consecutiveFailures >= 5) {
    dep.status = "unavailable";
    dep.degradedSince = dep.degradedSince || Date.now();
    logger.error({ dependency: name, failures: dep.consecutiveFailures, reason }, "[Degradation] dependency UNAVAILABLE");
  } else if (dep.consecutiveFailures >= 2) {
    dep.status = "degraded";
    dep.degradedSince = dep.degradedSince || Date.now();
    logger.warn({ dependency: name, failures: dep.consecutiveFailures, reason }, "[Degradation] dependency degraded");
  }
}

export function getDependencyStatus(name: string): DependencyStatus {
  return getDep(name).status;
}

export function getAllDependencyHealth(): DependencyHealth[] {
  const result: DependencyHealth[] = [];
  dependencies.forEach((v) => result.push(v));
  return result;
}

// ── Degraded Execution ───────────────────────────────────────────────────────

/**
 * Execute with degradation: try the primary function, fall back to degraded response.
 */
export async function withDegradation<T>(
  dependencyName: string,
  primary: () => Promise<T>,
  fallback: () => T | Promise<T>,
  options: { fallbackSource?: string } = {},
): Promise<DegradedResponse<T>> {
  try {
    const data = await primary();
    markHealthy(dependencyName);
    return { data, degraded: false };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    markDegraded(dependencyName, reason);
    try {
      const data = await fallback();
      return {
        data,
        degraded: true,
        reason: `${dependencyName} unavailable: ${reason}`,
        fallbackSource: options.fallbackSource || "local-cache",
      };
    } catch (fallbackErr) {
      logger.error({
        dependency: dependencyName,
        primaryError: reason,
        fallbackError: (fallbackErr as Error).message,
      }, "[Degradation] both primary and fallback failed");
      throw err; // re-throw original
    }
  }
}

// ── Service-Specific Fallback Strategies ─────────────────────────────────────

export const FALLBACK_STRATEGIES = {
  redis: {
    description: "In-memory cache with limited capacity",
    action: "Use process-local Map with 1000-entry LRU eviction",
  },
  postgres: {
    description: "Read-only mode from most recent cache",
    action: "Return cached data with degraded flag, reject writes",
  },
  kafka: {
    description: "Write to outbox table for later replay",
    action: "Store events in outbox_events table, replay when Kafka recovers",
  },
  "fraud-ml": {
    description: "Flag transactions for manual review",
    action: "Return HIGH risk score, route to compliance queue",
  },
  "kyc-engine": {
    description: "Queue KYC submissions for later processing",
    action: "Accept submission, persist to DB, process when service recovers",
  },
  mojaloop: {
    description: "Queue transfers for later submission",
    action: "Persist to outbox_events with retry, return PENDING status",
  },
  opensearch: {
    description: "Queue audit logs for later indexing",
    action: "Write to PostgreSQL audit_logs, bulk-index when OpenSearch recovers",
  },
  tigerbeetle: {
    description: "Write to PostgreSQL shadow ledger",
    action: "Dual-write to PG ledger_entries, reconcile when TB recovers",
  },
  permify: {
    description: "Deny by default in production",
    action: "Reject access requests when Permify unavailable (fail-closed)",
  },
  apisix: {
    description: "Direct routing bypass",
    action: "Route requests directly to upstream services",
  },
  keycloak: {
    description: "Validate JWT locally with cached public key",
    action: "Use cached JWKS for token verification",
  },
  fluvio: {
    description: "Redirect to Kafka topic",
    action: "Publish to equivalent Kafka topic when Fluvio unavailable",
  },
} as const;

// ── Readiness check incorporating degradation state ──────────────────────────

export function isSystemHealthy(): { healthy: boolean; degradedServices: string[]; unavailableServices: string[] } {
  const degraded: string[] = [];
  const unavailable: string[] = [];

  dependencies.forEach((dep) => {
    if (dep.status === "degraded") degraded.push(dep.name);
    if (dep.status === "unavailable") unavailable.push(dep.name);
  });

  // System is healthy if no critical services are unavailable
  const CRITICAL = new Set(["postgres", "redis"]);
  const criticalDown = unavailable.some((s) => CRITICAL.has(s));

  return {
    healthy: !criticalDown,
    degradedServices: degraded,
    unavailableServices: unavailable,
  };
}
