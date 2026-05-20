/**
 * Load Test Router — RemitFlow v98.3
 *
 * Runs real concurrent HTTP requests against the platform's own endpoints
 * and returns p50/p95/p99 latency percentiles, RPS, error rate.
 *
 * Based on the 80/20 Pareto skew pattern from the 1B Payments/Day benchmark:
 * https://backend.how/posts/1b-payments-per-day/
 */
import { z } from "zod";
import { router, adminProcedure, publicProcedure } from "../_core/trpc.js";
import { TRPCError } from "@trpc/server";
import { createAuditLog } from "../db.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LoadTestResult {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  durationMs: number;
  rps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  minMs: number;
  errorRate: number;
  buckets: { label: string; count: number; pct: number }[];
  endpointBreakdown: { endpoint: string; count: number; avgMs: number; errorCount: number }[];
  timestamp: string;
}

// ─── In-memory test state ─────────────────────────────────────────────────────

let activeTest: { running: boolean; startedAt: number; config: any } | null = null;
let lastResult: LoadTestResult | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute percentile from a sorted array.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

/**
 * Build latency histogram buckets.
 */
function buildBuckets(latencies: number[]): { label: string; count: number; pct: number }[] {
  const boundaries = [10, 25, 50, 100, 200, 500, 1000, Infinity];
  const labels = ["<10ms", "10-25ms", "25-50ms", "50-100ms", "100-200ms", "200-500ms", "500ms-1s", ">1s"];
  const counts = new Array(boundaries.length).fill(0);
  for (const l of latencies) {
    for (let i = 0; i < boundaries.length; i++) {
      if (l < boundaries[i]) { counts[i]++; break; }
    }
  }
  return labels.map((label, i) => ({
    label,
    count: counts[i],
    pct: latencies.length > 0 ? Math.round((counts[i] / latencies.length) * 100) : 0,
  }));
}

/**
 * Run a single HTTP request and return latency in ms.
 */
async function probe(url: string, timeoutMs = 10000): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    return { ok: res.ok, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

/**
 * 80/20 Pareto skew: 80% of requests go to the top 20% of endpoints (hot path).
 */
function pickEndpoint(endpoints: string[]): string {
  const hot = endpoints.slice(0, Math.max(1, Math.ceil(endpoints.length * 0.2)));
  const cold = endpoints.slice(hot.length);
  const ts = Date.now();
  if ((ts % 10) < 8 || cold.length === 0) {
    return hot[ts % hot.length];
  }
  return cold[ts % cold.length];
}

// ─── Default test endpoints (public, no auth required) ───────────────────────

const DEFAULT_ENDPOINTS = [
  "/api/trpc/v98.kafka.health",
  "/api/trpc/system.health",
  "/api/trpc/fx.liveRates",
  "/api/trpc/corridors.list",
  "/api/trpc/landing.stats",
];

// ─── Router ───────────────────────────────────────────────────────────────────

export const loadTestRouter = router({
  /**
   * Run a load test against the platform's own endpoints.
   * Uses 80/20 Pareto skew: 80% of traffic hits the top 20% of endpoints.
   */
  run: adminProcedure
    .input(z.object({
      workers: z.number().min(1).max(200).default(20),
      durationSeconds: z.number().min(5).max(300).default(30),
      targetUrl: z.string().url().optional(),
      endpoints: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (activeTest?.running) {
        throw new TRPCError({ code: "CONFLICT", message: "A load test is already running. Stop it first." });
      }

      // Determine base URL
      const origin = (ctx.req as any)?.headers?.origin ?? "http://localhost:3000";
      const baseUrl = input.targetUrl ?? origin;

      const endpoints = (input.endpoints ?? DEFAULT_ENDPOINTS).map(e =>
        e.startsWith("http") ? e : `${baseUrl}${e}`
      );

      activeTest = { running: true, startedAt: Date.now(), config: input };

      const latencies: number[] = [];
      const errorLatencies: number[] = [];
      const endpointMap = new Map<string, { count: number; totalMs: number; errors: number }>();

      const durationMs = input.durationSeconds * 1000;
      const endTime = Date.now() + durationMs;

      // Worker pool: each worker fires requests sequentially until time is up
      const workerFn = async () => {
        while (Date.now() < endTime && activeTest?.running) {
          const ep = pickEndpoint(endpoints);
          const key = new URL(ep).pathname;
          const { ok, latencyMs } = await probe(ep);
          latencies.push(latencyMs);
          if (!ok) errorLatencies.push(latencyMs);
          const cur = endpointMap.get(key) ?? { count: 0, totalMs: 0, errors: 0 };
          endpointMap.set(key, {
            count: cur.count + 1,
            totalMs: cur.totalMs + latencyMs,
            errors: cur.errors + (ok ? 0 : 1),
          });
        }
      };

      // Spawn workers
      const workers = Array.from({ length: input.workers }, () => workerFn());
      await Promise.all(workers);

      activeTest = null;

      if (latencies.length === 0) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No requests completed" });
      }

      const sorted = [...latencies].sort((a, b) => a - b);
      const actualDurationMs = Date.now() - (endTime - durationMs);

      const result: LoadTestResult = {
        totalRequests: latencies.length,
        successCount: latencies.length - errorLatencies.length,
        errorCount: errorLatencies.length,
        durationMs: actualDurationMs,
        rps: Math.round((latencies.length / actualDurationMs) * 1000),
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        p99Ms: percentile(sorted, 99),
        maxMs: sorted[sorted.length - 1],
        minMs: sorted[0],
        errorRate: Math.round((errorLatencies.length / latencies.length) * 10000) / 100,
        buckets: buildBuckets(latencies),
        endpointBreakdown: Array.from(endpointMap.entries()).map(([endpoint, s]) => ({
          endpoint,
          count: s.count,
          avgMs: Math.round(s.totalMs / s.count),
          errorCount: s.errors,
        })).sort((a, b) => b.count - a.count),
        timestamp: new Date().toISOString(),
      };

      lastResult = result;
      return result;
    }),

  /**
   * Stop a running load test.
   */
  stop: adminProcedure.mutation(() => {
    if (activeTest) activeTest.running = false;
    return { stopped: true };
  }),

  /**
   * Get the status of the current or last load test.
   */
  status: adminProcedure.query(() => {
    return {
      running: activeTest?.running ?? false,
      startedAt: activeTest?.startedAt ?? null,
      config: activeTest?.config ?? null,
      lastResult,
    };
  }),

  /**
   * Get the default test endpoints.
   */
  endpoints: publicProcedure.query(() => {
    return { endpoints: DEFAULT_ENDPOINTS };
  }),
});
