/**
 * Business Metrics Middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * Tracks key business metrics:
 * - Transfer volume by corridor
 * - Revenue by fee type
 * - KYC conversion rates
 * - Active user counts
 * - Error rates by category
 *
 * Exports metrics in Prometheus format at /metrics
 */

import { logger } from "../_core/logger";

interface MetricCounter {
  name: string;
  help: string;
  labels: Record<string, string>;
  value: number;
}

interface MetricHistogram {
  name: string;
  help: string;
  labels: Record<string, string>;
  sum: number;
  count: number;
  buckets: Map<number, number>;
}

class MetricsRegistry {
  private counters = new Map<string, MetricCounter>();
  private histograms = new Map<string, MetricHistogram>();

  increment(name: string, labels: Record<string, string> = {}, value = 1): void {
    const key = `${name}:${JSON.stringify(labels)}`;
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this.counters.set(key, { name, help: "", labels, value });
    }
  }

  observe(name: string, labels: Record<string, string>, value: number, buckets = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]): void {
    const key = `${name}:${JSON.stringify(labels)}`;
    const existing = this.histograms.get(key);
    if (existing) {
      existing.sum += value;
      existing.count++;
      for (const b of buckets) {
        if (value <= b) {
          existing.buckets.set(b, (existing.buckets.get(b) ?? 0) + 1);
        }
      }
    } else {
      const h: MetricHistogram = {
        name, help: "", labels, sum: value, count: 1,
        buckets: new Map(buckets.map((b) => [b, value <= b ? 1 : 0])),
      };
      this.histograms.set(key, h);
    }
  }

  toPrometheus(): string {
    const lines: string[] = [];

    for (const [_, c] of Array.from(this.counters.entries())) {
      const labelStr = Object.entries(c.labels).map(([k, v]) => `${k}="${v}"`).join(",");
      lines.push(`${c.name}{${labelStr}} ${c.value}`);
    }

    for (const [_, h] of Array.from(this.histograms.entries())) {
      const labelStr = Object.entries(h.labels).map(([k, v]) => `${k}="${v}"`).join(",");
      for (const [b, count] of Array.from(h.buckets.entries())) {
        lines.push(`${h.name}_bucket{${labelStr},le="${b}"} ${count}`);
      }
      lines.push(`${h.name}_bucket{${labelStr},le="+Inf"} ${h.count}`);
      lines.push(`${h.name}_sum{${labelStr}} ${h.sum}`);
      lines.push(`${h.name}_count{${labelStr}} ${h.count}`);
    }

    return lines.join("\n");
  }
}

export const metrics = new MetricsRegistry();

// Business metric helpers
export function trackTransfer(corridor: string, amount: number, currency: string, status: string): void {
  metrics.increment("remitflow_transfers_total", { corridor, currency, status });
  metrics.increment("remitflow_transfer_volume", { corridor, currency }, amount);
}

export function trackFeeRevenue(corridor: string, feeType: string, amount: number, currency: string): void {
  metrics.increment("remitflow_fee_revenue_total", { corridor, fee_type: feeType, currency }, amount);
}

export function trackKycConversion(step: string, outcome: string): void {
  metrics.increment("remitflow_kyc_funnel_total", { step, outcome });
}

export function trackApiLatency(endpoint: string, method: string, durationMs: number): void {
  metrics.observe("remitflow_api_duration_seconds", { endpoint, method }, durationMs / 1000);
}

export function trackError(category: string, code: string): void {
  metrics.increment("remitflow_errors_total", { category, code });
}
