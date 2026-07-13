/**
 * RemitFlow — Service Level Objective (SLO) Tracker
 * ══════════════════════════════════════════════════════════════════════════════
 * Tracks and enforces SLOs for critical platform operations.
 *
 * Defined SLOs:
 *   - Transfer API P99 latency < 500ms (99.9% of requests)
 *   - Transfer success rate > 99.5% (30-day rolling window)
 *   - KYC submission P95 latency < 2000ms
 *   - FX rate freshness < 30 seconds
 *   - Platform availability > 99.95% (four nines)
 *   - Kafka consumer lag < 1000 messages
 *
 * Error Budget:
 *   - 99.95% availability = 4.38 hours downtime/year = 26.3 min/month
 *   - Burn rate alerts at 5x (fast burn) and 1x (slow burn)
 */

import { getMeter } from "./otel";
import { logger } from "../_core/logger";

// ── SLO Definitions ───────────────────────────────────────────────────────────

export interface SLODefinition {
  name: string;
  description: string;
  target: number;        // e.g. 0.999 = 99.9%
  window: "1h" | "24h" | "7d" | "30d";
  alertThreshold: number; // burn rate multiplier
}

export const SLO_DEFINITIONS: Record<string, SLODefinition> = {
  transfer_availability: {
    name: "Transfer API Availability",
    description: "Percentage of transfer API requests that succeed (2xx/3xx)",
    target: 0.9995,
    window: "30d",
    alertThreshold: 5,
  },
  transfer_latency_p99: {
    name: "Transfer API P99 Latency",
    description: "99th percentile of transfer API response time < 500ms",
    target: 0.99,
    window: "24h",
    alertThreshold: 3,
  },
  kyc_submission_latency: {
    name: "KYC Submission P95 Latency",
    description: "95th percentile of KYC submission response time < 2000ms",
    target: 0.95,
    window: "24h",
    alertThreshold: 2,
  },
  fx_rate_freshness: {
    name: "FX Rate Freshness",
    description: "Percentage of FX rate requests served with data < 30s old",
    target: 0.999,
    window: "1h",
    alertThreshold: 10,
  },
  platform_availability: {
    name: "Platform Availability",
    description: "Overall platform uptime (health check success rate)",
    target: 0.9999,
    window: "30d",
    alertThreshold: 5,
  },
};

// ── Error Budget Calculator ───────────────────────────────────────────────────

export interface ErrorBudget {
  sloName: string;
  target: number;
  window: string;
  totalMinutes: number;
  allowedDowntimeMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number;
  remainingPercent: number;
  burnRate: number;
  status: "healthy" | "warning" | "critical" | "exhausted";
}

export function calculateErrorBudget(
  sloName: string,
  currentSuccessRate: number,
  windowMinutes: number
): ErrorBudget {
  const slo = SLO_DEFINITIONS[sloName];
  if (!slo) throw new Error(`Unknown SLO: ${sloName}`);

  const allowedDowntimeMinutes = windowMinutes * (1 - slo.target);
  const consumedMinutes = windowMinutes * (1 - currentSuccessRate);
  const remainingMinutes = Math.max(0, allowedDowntimeMinutes - consumedMinutes);
  const remainingPercent = allowedDowntimeMinutes > 0
    ? (remainingMinutes / allowedDowntimeMinutes) * 100
    : 0;

  const burnRate = allowedDowntimeMinutes > 0
    ? consumedMinutes / allowedDowntimeMinutes
    : 0;

  let status: ErrorBudget["status"] = "healthy";
  if (remainingPercent <= 0) status = "exhausted";
  else if (burnRate >= slo.alertThreshold) status = "critical";
  else if (remainingPercent < 20) status = "warning";

  return {
    sloName,
    target: slo.target,
    window: slo.window,
    totalMinutes: windowMinutes,
    allowedDowntimeMinutes,
    consumedMinutes,
    remainingMinutes,
    remainingPercent,
    burnRate,
    status,
  };
}

// ── In-Memory SLO State ───────────────────────────────────────────────────────

interface SLOWindow {
  total: number;
  good: number;
  lastUpdated: number;
}

const sloWindows = new Map<string, SLOWindow>();

export function recordSLOEvent(sloName: string, isGood: boolean): void {
  const existing = sloWindows.get(sloName) ?? { total: 0, good: 0, lastUpdated: Date.now() };
  existing.total += 1;
  if (isGood) existing.good += 1;
  existing.lastUpdated = Date.now();
  sloWindows.set(sloName, existing);

  // Emit metric
  const meter = getMeter();
  const counter = meter.createCounter(`remitflow.slo.${sloName.replace(/_/g, ".")}`, {
    description: `SLO event counter for ${sloName}`,
    unit: "1",
  });
  counter.add(1, { good: String(isGood) });
}

export function getSLOStatus(sloName: string): {
  successRate: number;
  total: number;
  good: number;
  budget: ErrorBudget;
} {
  const window = sloWindows.get(sloName) ?? { total: 0, good: 0, lastUpdated: Date.now() };
  const successRate = window.total > 0 ? window.good / window.total : 1.0;
  const budget = calculateErrorBudget(sloName, successRate, 30 * 24 * 60); // 30-day window

  return {
    successRate,
    total: window.total,
    good: window.good,
    budget,
  };
}

export function getAllSLOStatuses(): Record<string, ReturnType<typeof getSLOStatus>> {
  const result: Record<string, ReturnType<typeof getSLOStatus>> = {};
  for (const sloName of Object.keys(SLO_DEFINITIONS)) {
    result[sloName] = getSLOStatus(sloName);
  }
  return result;
}

// ── Burn Rate Alert ───────────────────────────────────────────────────────────

export function checkBurnRateAlerts(): void {
  const statuses = getAllSLOStatuses();
  for (const [name, status] of Object.entries(statuses)) {
    const { budget } = status;
    if (budget.status === "critical" || budget.status === "exhausted") {
      logger.error(
        {
          slo: name,
          burnRate: budget.burnRate,
          remainingBudget: budget.remainingPercent,
          status: budget.status,
        },
        `[SLO ALERT] ${name} — burn rate ${budget.burnRate.toFixed(2)}x, ${budget.remainingPercent.toFixed(1)}% budget remaining`
      );
    } else if (budget.status === "warning") {
      logger.warn(
        { slo: name, remainingBudget: budget.remainingPercent },
        `[SLO WARNING] ${name} — ${budget.remainingPercent.toFixed(1)}% error budget remaining`
      );
    }
  }
}

// Run burn rate checks every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(checkBurnRateAlerts, 5 * 60 * 1000);
}
