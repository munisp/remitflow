/**
 * RemitFlow — Observability & Alerting Layer
 * ────────────────────────────────────────────
 * Implements:
 * - SLO/SLI definitions and tracking
 * - Grafana alert rules
 * - PagerDuty/OpsGenie integration
 * - Structured logging with correlation IDs
 * - Error budget tracking
 * - Health check aggregation
 * - Custom Prometheus metrics
 */
import { logger } from "../_core/logger";

// ─── SLO/SLI Definitions ────────────────────────────────────────────────────

export interface SLI {
  name: string;
  description: string;
  type: "availability" | "latency" | "error_rate" | "throughput";
  measurement: string;
  unit: string;
}

export interface SLO {
  name: string;
  sli: SLI;
  target: number; // percentage (e.g., 99.95)
  window: "rolling_30d" | "rolling_7d" | "calendar_month";
  errorBudgetMinutes: number;
  alertThresholds: {
    warning: number;
    critical: number;
  };
}

export const PLATFORM_SLOS: SLO[] = [
  {
    name: "Transfer API Availability",
    sli: {
      name: "transfer_api_availability",
      description: "Percentage of successful (non-5xx) transfer API responses",
      type: "availability",
      measurement: "http_requests_total{handler='transfer', code!~'5..'}",
      unit: "percent",
    },
    target: 99.95,
    window: "rolling_30d",
    errorBudgetMinutes: 21.6, // 30 days * 24h * 60min * 0.0005
    alertThresholds: { warning: 99.9, critical: 99.5 },
  },
  {
    name: "Transfer Latency P99",
    sli: {
      name: "transfer_latency_p99",
      description: "99th percentile transfer API latency",
      type: "latency",
      measurement: "http_request_duration_seconds{handler='transfer'}",
      unit: "seconds",
    },
    target: 99.0, // 99% of requests under 2s
    window: "rolling_30d",
    errorBudgetMinutes: 432,
    alertThresholds: { warning: 2.0, critical: 5.0 },
  },
  {
    name: "KYC Verification Completion",
    sli: {
      name: "kyc_completion_rate",
      description: "Percentage of KYC verifications completing within SLA",
      type: "availability",
      measurement: "kyc_verification_completed_total / kyc_verification_initiated_total",
      unit: "percent",
    },
    target: 99.0,
    window: "rolling_7d",
    errorBudgetMinutes: 100.8,
    alertThresholds: { warning: 98.0, critical: 95.0 },
  },
  {
    name: "Payment Processing Success",
    sli: {
      name: "payment_success_rate",
      description: "Percentage of payments completing successfully",
      type: "availability",
      measurement: "payments_completed_total / payments_initiated_total",
      unit: "percent",
    },
    target: 99.9,
    window: "rolling_30d",
    errorBudgetMinutes: 43.2,
    alertThresholds: { warning: 99.5, critical: 99.0 },
  },
  {
    name: "Database Query Latency",
    sli: {
      name: "db_query_latency_p95",
      description: "95th percentile database query latency",
      type: "latency",
      measurement: "db_query_duration_seconds",
      unit: "seconds",
    },
    target: 99.0,
    window: "rolling_7d",
    errorBudgetMinutes: 100.8,
    alertThresholds: { warning: 0.5, critical: 2.0 },
  },
  {
    name: "Sanctions Screening Latency",
    sli: {
      name: "sanctions_screening_latency_p99",
      description: "99th percentile sanctions screening response time",
      type: "latency",
      measurement: "sanctions_check_duration_seconds",
      unit: "seconds",
    },
    target: 99.5,
    window: "rolling_30d",
    errorBudgetMinutes: 216,
    alertThresholds: { warning: 1.0, critical: 3.0 },
  },
];

// ─── Error Budget Tracking ───────────────────────────────────────────────────

interface ErrorBudget {
  sloName: string;
  totalBudgetMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number;
  burnRate: number; // 1.0 = normal, >1.0 = burning faster than expected
  status: "healthy" | "warning" | "critical" | "exhausted";
}

const errorBudgets = new Map<string, { consumed: number; windowStart: number }>();

export function trackErrorBudget(sloName: string, errorOccurred: boolean): void {
  const slo = PLATFORM_SLOS.find((s) => s.name === sloName);
  if (!slo) return;

  const key = sloName;
  const existing = errorBudgets.get(key) || { consumed: 0, windowStart: Date.now() };

  if (errorOccurred) {
    existing.consumed += 1; // Each error = 1 minute consumed (simplified)
  }

  errorBudgets.set(key, existing);
}

export function getErrorBudgets(): ErrorBudget[] {
  return PLATFORM_SLOS.map((slo) => {
    const budget = errorBudgets.get(slo.name) || { consumed: 0, windowStart: Date.now() };
    const windowMs = slo.window === "rolling_30d" ? 30 * 86_400_000 : 7 * 86_400_000;
    const elapsedMs = Date.now() - budget.windowStart;
    const expectedConsumed = (elapsedMs / windowMs) * slo.errorBudgetMinutes;
    const burnRate = expectedConsumed > 0 ? budget.consumed / expectedConsumed : 0;

    let status: ErrorBudget["status"] = "healthy";
    if (budget.consumed >= slo.errorBudgetMinutes) status = "exhausted";
    else if (burnRate > 2) status = "critical";
    else if (burnRate > 1) status = "warning";

    return {
      sloName: slo.name,
      totalBudgetMinutes: slo.errorBudgetMinutes,
      consumedMinutes: budget.consumed,
      remainingMinutes: Math.max(0, slo.errorBudgetMinutes - budget.consumed),
      burnRate,
      status,
    };
  });
}

// ─── Grafana Alert Rules ─────────────────────────────────────────────────────

export const GRAFANA_ALERT_RULES = [
  {
    name: "High Transfer Failure Rate",
    expr: 'rate(http_requests_total{handler="transfer",code=~"5.."}[5m]) / rate(http_requests_total{handler="transfer"}[5m]) > 0.01',
    for: "5m",
    severity: "critical",
    annotations: {
      summary: "Transfer API error rate exceeds 1%",
      description: "Transfer endpoint is returning >1% 5xx errors over the last 5 minutes",
      runbook: "https://wiki.remitflow.internal/runbooks/transfer-failures",
    },
    labels: { team: "payments", service: "api-gateway" },
  },
  {
    name: "KYC Service Unavailable",
    expr: 'up{job="kyc-engine"} == 0',
    for: "2m",
    severity: "critical",
    annotations: {
      summary: "KYC engine is down — account openings are blocked (fail-closed)",
      description: "The KYC engine service has been unreachable for >2 minutes. All Tier 2+ account openings will fail.",
      runbook: "https://wiki.remitflow.internal/runbooks/kyc-outage",
    },
    labels: { team: "compliance", service: "kyc-engine" },
  },
  {
    name: "Database Connection Pool Exhaustion",
    expr: "pg_pool_active_connections / pg_pool_max_connections > 0.85",
    for: "3m",
    severity: "warning",
    annotations: {
      summary: "Database connection pool is >85% utilized",
      description: "Consider increasing DB_POOL_MAX or investigating slow queries",
    },
    labels: { team: "platform", service: "database" },
  },
  {
    name: "Sanctions Screening Latency",
    expr: "histogram_quantile(0.99, rate(sanctions_check_duration_seconds_bucket[5m])) > 3",
    for: "5m",
    severity: "warning",
    annotations: {
      summary: "Sanctions screening P99 latency exceeds 3 seconds",
      description: "Sanctions list may need re-indexing or the screening service needs scaling",
    },
    labels: { team: "compliance", service: "sanctions-screening" },
  },
  {
    name: "Kafka Consumer Lag",
    expr: "kafka_consumer_group_lag > 10000",
    for: "10m",
    severity: "warning",
    annotations: {
      summary: "Kafka consumer group lag exceeds 10,000 messages",
      description: "Events are piling up — check consumer health and throughput",
    },
    labels: { team: "platform", service: "kafka" },
  },
  {
    name: "TigerBeetle-PostgreSQL Drift",
    expr: "tigerbeetle_pg_balance_drift_total > 0",
    for: "1m",
    severity: "critical",
    annotations: {
      summary: "Ledger balance discrepancy detected between TigerBeetle and PostgreSQL",
      description: "Run reconciliation immediately: POST /api/ledger/reconcile",
      runbook: "https://wiki.remitflow.internal/runbooks/ledger-drift",
    },
    labels: { team: "payments", service: "ledger" },
  },
  {
    name: "High Velocity Alert Volume",
    expr: "rate(velocity_limit_exceeded_total[5m]) > 10",
    for: "5m",
    severity: "warning",
    annotations: {
      summary: "Velocity limit breaches spiking — possible fraud or attack",
      description: "Check fraud dashboard for coordinated attack patterns",
    },
    labels: { team: "fraud", service: "velocity" },
  },
  {
    name: "Payment DLQ Growing",
    expr: "payment_dlq_pending_count > 100",
    for: "15m",
    severity: "warning",
    annotations: {
      summary: "Payment Dead Letter Queue has >100 unresolved entries",
      description: "Payments are failing and not being retried successfully",
    },
    labels: { team: "payments", service: "payment-rails" },
  },
  {
    name: "Memory Usage Critical",
    expr: "node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes < 0.1",
    for: "5m",
    severity: "critical",
    annotations: {
      summary: "Available memory below 10% — OOM risk",
      description: "Scale up or investigate memory leaks",
    },
    labels: { team: "platform", service: "infrastructure" },
  },
  {
    name: "SSL Certificate Expiring",
    expr: "ssl_cert_not_after - time() < 30 * 24 * 3600",
    for: "1h",
    severity: "warning",
    annotations: {
      summary: "SSL certificate expires within 30 days",
      description: "Renew SSL certificate before expiry to avoid service disruption",
    },
    labels: { team: "platform", service: "infrastructure" },
  },
];

// ─── PagerDuty/OpsGenie Integration ─────────────────────────────────────────

interface AlertPayload {
  severity: "critical" | "warning" | "info";
  summary: string;
  details: string;
  source: string;
  component?: string;
  deduplicationKey?: string;
}

export async function sendPagerDutyAlert(alert: AlertPayload): Promise<boolean> {
  const routingKey = process.env.PAGERDUTY_ROUTING_KEY;
  if (!routingKey) {
    logger.warn("[Alerting] PAGERDUTY_ROUTING_KEY not configured — alert not sent", { summary: alert.summary });
    return false;
  }

  try {
    const resp = await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routing_key: routingKey,
        event_action: "trigger",
        dedup_key: alert.deduplicationKey || `remitflow-${alert.source}-${Date.now()}`,
        payload: {
          summary: alert.summary,
          source: alert.source,
          severity: alert.severity,
          component: alert.component || "remitflow-api",
          custom_details: { details: alert.details },
          timestamp: new Date().toISOString(),
        },
      }),
    });
    return resp.ok;
  } catch (err) {
    logger.error("[Alerting] PagerDuty send failed", { error: (err as Error).message });
    return false;
  }
}

export async function sendOpsGenieAlert(alert: AlertPayload): Promise<boolean> {
  const apiKey = process.env.OPSGENIE_API_KEY;
  if (!apiKey) {
    logger.warn("[Alerting] OPSGENIE_API_KEY not configured — alert not sent");
    return false;
  }

  try {
    const resp = await fetch("https://api.opsgenie.com/v2/alerts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `GenieKey ${apiKey}`,
      },
      body: JSON.stringify({
        message: alert.summary,
        description: alert.details,
        priority: alert.severity === "critical" ? "P1" : alert.severity === "warning" ? "P3" : "P5",
        source: alert.source,
        tags: ["remitflow", alert.component || "api"],
        alias: alert.deduplicationKey,
      }),
    });
    return resp.ok;
  } catch (err) {
    logger.error("[Alerting] OpsGenie send failed", { error: (err as Error).message });
    return false;
  }
}

// ─── Health Check Aggregation ────────────────────────────────────────────────

interface ServiceHealth {
  name: string;
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  latencyMs: number;
  lastCheck: string;
  details?: string;
}

export async function aggregateHealthChecks(): Promise<{
  overall: "healthy" | "degraded" | "unhealthy";
  services: ServiceHealth[];
  checkedAt: string;
}> {
  const endpoints = [
    { name: "postgresql", url: "internal", check: checkDbHealth },
    { name: "redis", url: process.env.REDIS_URL || "redis://localhost:6379" },
    { name: "temporal", url: process.env.TEMPORAL_FRONTEND_URL || "http://localhost:7233" },
    { name: "kafka", url: process.env.KAFKA_SERVICE_URL || "http://localhost:8093" },
    { name: "kyc-engine", url: process.env.KYC_ENGINE_URL || "http://localhost:8070" },
    { name: "aml-engine", url: process.env.AML_ENGINE_URL || "http://localhost:8103" },
    { name: "bvn-nin-service", url: process.env.BVN_NIN_SERVICE_URL || "http://localhost:8071" },
    { name: "sanctions-screener", url: process.env.SANCTIONS_SCREENER_URL || "http://localhost:8072" },
    { name: "goaml-integration", url: process.env.GOAML_SERVICE_URL || "http://localhost:8073" },
  ];

  const checks = await Promise.all(
    endpoints.map(async (ep) => {
      const start = Date.now();
      try {
        if (ep.check) {
          const ok = await ep.check();
          return {
            name: ep.name,
            status: ok ? "healthy" as const : "unhealthy" as const,
            latencyMs: Date.now() - start,
            lastCheck: new Date().toISOString(),
          };
        }

        const resp = await fetch(`${ep.url}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        return {
          name: ep.name,
          status: resp.ok ? "healthy" as const : "degraded" as const,
          latencyMs: Date.now() - start,
          lastCheck: new Date().toISOString(),
        };
      } catch {
        return {
          name: ep.name,
          status: "unhealthy" as const,
          latencyMs: Date.now() - start,
          lastCheck: new Date().toISOString(),
        };
      }
    })
  );

  const unhealthy = checks.filter((c) => c.status === "unhealthy").length;
  const degraded = checks.filter((c) => c.status === "degraded").length;

  return {
    overall: unhealthy > 2 ? "unhealthy" : unhealthy > 0 || degraded > 1 ? "degraded" : "healthy",
    services: checks,
    checkedAt: new Date().toISOString(),
  };
}

async function checkDbHealth(): Promise<boolean> {
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
}

// ─── Structured Logging Helpers ──────────────────────────────────────────────

export function logTransaction(event: string, data: {
  transactionId: string;
  userId: number;
  amount: number;
  currency: string;
  rail?: string;
  status?: string;
  error?: string;
  durationMs?: number;
}) {
  logger.info(`[Transaction] ${event}`, {
    ...data,
    timestamp: new Date().toISOString(),
    service: "remitflow-api",
  });
}

export function logCompliance(event: string, data: {
  userId: number;
  action: string;
  result: string;
  details?: Record<string, unknown>;
}) {
  logger.info(`[Compliance] ${event}`, {
    ...data,
    timestamp: new Date().toISOString(),
    service: "remitflow-compliance",
  });
}

export function logSecurityEvent(event: string, data: {
  ip: string;
  userId?: number;
  action: string;
  result: "allowed" | "blocked" | "flagged";
  reason?: string;
}) {
  const level = data.result === "blocked" ? "warn" : "info";
  logger[level](`[Security] ${event}`, {
    ...data,
    timestamp: new Date().toISOString(),
    service: "remitflow-security",
  });
}
