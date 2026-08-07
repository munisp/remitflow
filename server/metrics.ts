/**
 * Prometheus metrics endpoint for RemitFlow
 * Exposes /metrics in OpenMetrics format for Prometheus scraping
 */
import { Request, Response } from "express";
import { getDb } from "./db";
import { sql } from "drizzle-orm";

// ─── In-memory counters (reset on restart, Prometheus handles persistence) ───
const counters = {
  http_requests_total: new Map<string, number>(),
  trpc_calls_total: new Map<string, number>(),
  transfer_total: 0,
  transfer_success: 0,
  transfer_failed: 0,
  kyc_submissions: 0,
  fraud_alerts_raised: 0,
  fraud_alerts_blocked: 0,
  fx_rate_fetches: 0,
  scheduler_executions: 0,
  regulatory_filing_outcomes: new Map<string, number>(),
};

const histograms = {
  http_request_duration_ms: [] as number[],
  transfer_processing_ms: [] as number[],
};

// ─── Increment helpers ────────────────────────────────────────────────────────
export function incHttpRequest(method: string, path: string, status: number) {
  const key = `${method}:${path}:${status}`;
  counters.http_requests_total.set(key, (counters.http_requests_total.get(key) ?? 0) + 1);
}

export function incTrpcCall(procedure: string, success: boolean) {
  const key = `${procedure}:${success ? "ok" : "err"}`;
  counters.trpc_calls_total.set(key, (counters.trpc_calls_total.get(key) ?? 0) + 1);
}

export function incTransfer(success: boolean, durationMs?: number) {
  counters.transfer_total++;
  if (success) counters.transfer_success++;
  else counters.transfer_failed++;
  if (durationMs !== undefined) histograms.transfer_processing_ms.push(durationMs);
}

export function incKycSubmission() { counters.kyc_submissions++; }
export function incFraudAlert(blocked = false) {
  counters.fraud_alerts_raised++;
  if (blocked) counters.fraud_alerts_blocked++;
}
export function incFxFetch() { counters.fx_rate_fetches++; }
export function incSchedulerExecution() { counters.scheduler_executions++; }
export function incRegulatoryFilingOutcome(outcome: "queued" | "submitted" | "retry" | "dead_letter" | "requeued") {
  counters.regulatory_filing_outcomes.set(outcome, (counters.regulatory_filing_outcomes.get(outcome) ?? 0) + 1);
}

// ─── Histogram helpers ────────────────────────────────────────────────────────
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ─── DB metrics query ─────────────────────────────────────────────────────────
async function getRegulatoryFilingMetrics() {
  try {
    const db = await getDb();
    if (!db) return null;
    const result = await db.execute(sql.raw(`
      SELECT status, COUNT(*)::int AS count
      FROM regulatory_filing_queue
      GROUP BY status
    `));
    return (result as any).rows ?? result ?? [];
  } catch {
    return null;
  }
}

async function getDbMetrics() {
  try {
    const db = await getDb();
    if (!db) return null;
    const [rows] = await db.execute(sql.raw(`
      SELECT
        (SELECT COUNT(*) FROM users) as user_count,
        (SELECT COUNT(*) FROM transactions WHERE status = 'completed') as completed_txns,
        (SELECT COUNT(*) FROM transactions WHERE status = 'pending') as pending_txns,
        (SELECT COUNT(*) FROM transactions WHERE status = 'failed') as failed_txns,
        (SELECT COALESCE(SUM(CAST(from_amount AS DECIMAL(18,2))), 0) FROM transactions WHERE status = 'completed' AND type = 'send') as total_volume,
        (SELECT COUNT(*) FROM fraud_alerts WHERE status = 'pending') as open_fraud_alerts,
        (SELECT COUNT(*) FROM kyc_documents WHERE status = 'pending') as pending_kyc,
        (SELECT COUNT(*) FROM recurring_payments WHERE status = 'active') as active_schedules,
        (SELECT COUNT(*) FROM fx_alerts WHERE is_active = 1) as active_fx_alerts,
        (SELECT COUNT(*) FROM wallets) as total_wallets
    `));
    return (rows as any[])[0] ?? null;
  } catch {
    return null;
  }
}

// ─── Format OpenMetrics output ────────────────────────────────────────────────
function formatCounter(name: string, help: string, value: number, labels?: string): string {
  const labelStr = labels ? `{${labels}}` : "";
  return `# HELP ${name} ${help}\n# TYPE ${name} counter\n${name}${labelStr} ${value}\n`;
}

function formatGauge(name: string, help: string, value: number, labels?: string): string {
  const labelStr = labels ? `{${labels}}` : "";
  return `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name}${labelStr} ${value}\n`;
}

// ─── Metrics handler ──────────────────────────────────────────────────────────
export async function metricsHandler(_req: Request, res: Response) {
  const [dbMetrics, regulatoryFilingMetrics] = await Promise.all([getDbMetrics(), getRegulatoryFilingMetrics()]);
  const lines: string[] = [];

  // Process info
  lines.push(formatGauge("process_uptime_seconds", "Process uptime in seconds", process.uptime()));
  lines.push(formatGauge("nodejs_heap_used_bytes", "Node.js heap used bytes", process.memoryUsage().heapUsed));
  lines.push(formatGauge("nodejs_heap_total_bytes", "Node.js heap total bytes", process.memoryUsage().heapTotal));
  lines.push(formatGauge("nodejs_rss_bytes", "Node.js resident set size bytes", process.memoryUsage().rss));

  // HTTP metrics
  lines.push("# HELP http_requests_total Total HTTP requests\n# TYPE http_requests_total counter");
  for (const [key, count] of Array.from(counters.http_requests_total.entries())) {
    const [method, path, status] = key.split(":");
    lines.push(`http_requests_total{method="${method}",path="${path}",status="${status}"} ${count}`);
  }
  lines.push("");

  // tRPC metrics
  lines.push("# HELP trpc_calls_total Total tRPC procedure calls\n# TYPE trpc_calls_total counter");
  for (const [key, count] of Array.from(counters.trpc_calls_total.entries())) {
    const [procedure, result] = key.split(":");
    lines.push(`trpc_calls_total{procedure="${procedure}",result="${result}"} ${count}`);
  }
  lines.push("");

  // Transfer metrics
  lines.push(formatCounter("remitflow_transfers_total", "Total transfer attempts", counters.transfer_total));
  lines.push(formatCounter("remitflow_transfers_success_total", "Successful transfers", counters.transfer_success));
  lines.push(formatCounter("remitflow_transfers_failed_total", "Failed transfers", counters.transfer_failed));

  // Transfer latency histogram
  if (histograms.transfer_processing_ms.length > 0) {
    const p50 = percentile(histograms.transfer_processing_ms, 50);
    const p95 = percentile(histograms.transfer_processing_ms, 95);
    const p99 = percentile(histograms.transfer_processing_ms, 99);
    const mean = avg(histograms.transfer_processing_ms);
    lines.push(`# HELP remitflow_transfer_duration_ms Transfer processing duration\n# TYPE remitflow_transfer_duration_ms summary`);
    lines.push(`remitflow_transfer_duration_ms{quantile="0.5"} ${p50}`);
    lines.push(`remitflow_transfer_duration_ms{quantile="0.95"} ${p95}`);
    lines.push(`remitflow_transfer_duration_ms{quantile="0.99"} ${p99}`);
    lines.push(`remitflow_transfer_duration_ms_mean ${mean}`);
    lines.push(`remitflow_transfer_duration_ms_count ${histograms.transfer_processing_ms.length}`);
    lines.push("");
  }

  // KYC / Fraud / FX metrics
  lines.push(formatCounter("remitflow_kyc_submissions_total", "Total KYC submissions", counters.kyc_submissions));
  lines.push(formatCounter("remitflow_fraud_alerts_total", "Total fraud alerts raised", counters.fraud_alerts_raised));
  lines.push(formatCounter("remitflow_fraud_blocked_total", "Total transfers blocked by fraud", counters.fraud_alerts_blocked));
  lines.push(formatCounter("remitflow_fx_fetches_total", "Total FX rate fetch operations", counters.fx_rate_fetches));
  lines.push(formatCounter("remitflow_scheduler_executions_total", "Total scheduler job executions", counters.scheduler_executions));
  lines.push("# HELP remitflow_regulatory_filing_outcomes_total Regulatory filing queue lifecycle outcomes\n# TYPE remitflow_regulatory_filing_outcomes_total counter");
  for (const [outcome, count] of Array.from(counters.regulatory_filing_outcomes.entries())) {
    lines.push(`remitflow_regulatory_filing_outcomes_total{outcome="${outcome}"} ${count}`);
  }
  lines.push("");
  if (regulatoryFilingMetrics) {
    lines.push("# HELP remitflow_regulatory_filing_queue_depth Regulatory filing queue rows by lifecycle state\n# TYPE remitflow_regulatory_filing_queue_depth gauge");
    for (const row of regulatoryFilingMetrics as Array<{ status: string; count: number }>) {
      lines.push(`remitflow_regulatory_filing_queue_depth{status="${row.status}"} ${Number(row.count)}`);
    }
    lines.push("");
  }

  // DB-derived gauges
  if (dbMetrics) {
    lines.push(formatGauge("remitflow_users_total", "Total registered users", Number(dbMetrics.user_count ?? 0)));
    lines.push(formatGauge("remitflow_transactions_completed_total", "Completed transactions", Number(dbMetrics.completed_txns ?? 0)));
    lines.push(formatGauge("remitflow_transactions_pending_total", "Pending transactions", Number(dbMetrics.pending_txns ?? 0)));
    lines.push(formatGauge("remitflow_transactions_failed_total", "Failed transactions", Number(dbMetrics.failed_txns ?? 0)));
    lines.push(formatGauge("remitflow_total_volume_ngn", "Total transfer volume (NGN equivalent)", Number(dbMetrics.total_volume ?? 0)));
    lines.push(formatGauge("remitflow_fraud_alerts_open", "Open fraud alerts awaiting review", Number(dbMetrics.open_fraud_alerts ?? 0)));
    lines.push(formatGauge("remitflow_kyc_pending", "KYC documents pending review", Number(dbMetrics.pending_kyc ?? 0)));
    lines.push(formatGauge("remitflow_active_schedules", "Active recurring payment schedules", Number(dbMetrics.active_schedules ?? 0)));
    lines.push(formatGauge("remitflow_active_fx_alerts", "Active FX rate alerts", Number(dbMetrics.active_fx_alerts ?? 0)));
    lines.push(formatGauge("remitflow_total_wallets", "Total wallets across all users", Number(dbMetrics.total_wallets ?? 0)));
  }

  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(lines.join("\n") + "\n");
}
