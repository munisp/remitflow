/**
 * Synthetic Monitoring — P2 Observability 7.6
 * Probes critical user journeys and API endpoints on a schedule.
 */

interface ProbeResult {
  probe: string;
  status: "pass" | "fail" | "timeout" | "degraded";
  latencyMs: number;
  statusCode?: number;
  timestamp: number;
  error?: string;
  region?: string;
}

interface ProbeDefinition {
  name: string;
  url: string;
  method: "GET" | "POST";
  expectedStatus: number;
  timeoutMs: number;
  intervalMs: number;
  headers?: Record<string, string>;
  body?: string;
}

const probeResults: ProbeResult[] = [];
const MAX_RESULTS = 10_000;

const DEFAULT_PROBES: ProbeDefinition[] = [
  { name: "health", url: "/api/trpc/system.health", method: "GET", expectedStatus: 200, timeoutMs: 5000, intervalMs: 30_000 },
  { name: "auth-login", url: "/api/trpc/auth.login", method: "POST", expectedStatus: 200, timeoutMs: 10_000, intervalMs: 60_000 },
  { name: "fx-rates", url: "/api/trpc/fx.rates", method: "GET", expectedStatus: 200, timeoutMs: 5000, intervalMs: 30_000 },
  { name: "dashboard", url: "/api/trpc/dashboard.summary", method: "GET", expectedStatus: 200, timeoutMs: 10_000, intervalMs: 60_000 },
  { name: "wallet-balance", url: "/api/trpc/wallet.list", method: "GET", expectedStatus: 200, timeoutMs: 5000, intervalMs: 60_000 },
  { name: "transfer-corridors", url: "/api/trpc/corridors.list", method: "GET", expectedStatus: 200, timeoutMs: 5000, intervalMs: 120_000 },
  { name: "kyc-status", url: "/api/trpc/kyc.getStatus", method: "GET", expectedStatus: 200, timeoutMs: 5000, intervalMs: 120_000 },
  { name: "notifications", url: "/api/trpc/notification.list", method: "GET", expectedStatus: 200, timeoutMs: 5000, intervalMs: 120_000 },
];

export function recordProbeResult(result: ProbeResult): void {
  probeResults.push(result);
  if (probeResults.length > MAX_RESULTS) {
    probeResults.splice(0, probeResults.length - MAX_RESULTS);
  }
}

export function getProbeResults(probeName?: string, limit = 100): ProbeResult[] {
  const filtered = probeName ? probeResults.filter((r) => r.probe === probeName) : probeResults;
  return filtered.slice(-limit);
}

export function getUptimeStats(probeName: string, windowMs = 86400_000): {
  uptime: number;
  avgLatency: number;
  p95Latency: number;
  failCount: number;
  totalChecks: number;
} {
  const cutoff = Date.now() - windowMs;
  const recent = probeResults.filter((r) => r.probe === probeName && r.timestamp >= cutoff);

  if (recent.length === 0) {
    return { uptime: 100, avgLatency: 0, p95Latency: 0, failCount: 0, totalChecks: 0 };
  }

  const passes = recent.filter((r) => r.status === "pass" || r.status === "degraded").length;
  const fails = recent.filter((r) => r.status === "fail" || r.status === "timeout").length;
  const latencies = recent.map((r) => r.latencyMs).sort((a, b) => a - b);
  const avg = latencies.reduce((s, l) => s + l, 0) / latencies.length;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

  return {
    uptime: Math.round((passes / recent.length) * 10000) / 100,
    avgLatency: Math.round(avg),
    p95Latency: p95,
    failCount: fails,
    totalChecks: recent.length,
  };
}

export function getOverallStatus(): {
  status: "healthy" | "degraded" | "down";
  probes: Array<{ name: string; status: string; lastCheck: number }>;
} {
  const probeStatus = DEFAULT_PROBES.map((p) => {
    const results = probeResults.filter((r) => r.probe === p.name);
    const last = results[results.length - 1];
    return {
      name: p.name,
      status: last?.status ?? "unknown",
      lastCheck: last?.timestamp ?? 0,
    };
  });

  const failCount = probeStatus.filter((p) => p.status === "fail" || p.status === "timeout").length;
  const overallStatus = failCount >= 3 ? "down" : failCount >= 1 ? "degraded" : "healthy";

  return { status: overallStatus, probes: probeStatus };
}

export function getProbeDefinitions(): ProbeDefinition[] {
  return [...DEFAULT_PROBES];
}
