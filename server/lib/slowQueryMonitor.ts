/**
 * Slow Query Monitor — P1
 *
 * Monitors PostgreSQL query performance via pg_stat_statements.
 * Exposes slow queries as Prometheus metrics and logs alerts.
 *
 * Requirements:
 *   - PostgreSQL with pg_stat_statements extension enabled
 *   - shared_preload_libraries = 'pg_stat_statements' in postgresql.conf
 *   - CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
 *
 * Features:
 *   - Periodic polling (every 5 minutes)
 *   - Slow query threshold alerting (default: 500ms total_exec_time)
 *   - Top-N slowest queries report
 *   - Prometheus metrics export
 *   - N+1 query pattern detection (high calls + low mean_exec_time)
 */
import { logger } from "../_core/logger";

interface SlowQuery {
  queryId: string;
  query: string;
  calls: number;
  totalExecTimeMs: number;
  meanExecTimeMs: number;
  maxExecTimeMs: number;
  rows: number;
  sharedBlksHit: number;
  sharedBlksRead: number;
  hitRatio: number;
}

interface SlowQueryConfig {
  intervalMs: number;
  slowThresholdMs: number;
  topN: number;
  n1DetectionThreshold: number; // calls > this with mean < 10ms = potential N+1
}

const DEFAULT_CONFIG: SlowQueryConfig = {
  intervalMs: 5 * 60 * 1000, // 5 minutes
  slowThresholdMs: 500,
  topN: 20,
  n1DetectionThreshold: 1000,
};

// Metrics storage
let lastSlowQueries: SlowQuery[] = [];
let lastN1Candidates: SlowQuery[] = [];
let lastPollTimestamp = 0;
let pollCount = 0;
let alertCount = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * SQL to query pg_stat_statements for slow queries.
 */
const SLOW_QUERY_SQL = `
SELECT
  queryid::text as query_id,
  LEFT(query, 200) as query,
  calls,
  total_exec_time as total_exec_time_ms,
  mean_exec_time as mean_exec_time_ms,
  max_exec_time as max_exec_time_ms,
  rows,
  shared_blks_hit,
  shared_blks_read,
  CASE
    WHEN (shared_blks_hit + shared_blks_read) > 0
    THEN shared_blks_hit::float / (shared_blks_hit + shared_blks_read)
    ELSE 1.0
  END as hit_ratio
FROM pg_stat_statements
WHERE userid = (SELECT usesysid FROM pg_user WHERE usename = current_user)
  AND total_exec_time > $1
ORDER BY total_exec_time DESC
LIMIT $2;
`;

const N1_DETECTION_SQL = `
SELECT
  queryid::text as query_id,
  LEFT(query, 200) as query,
  calls,
  total_exec_time as total_exec_time_ms,
  mean_exec_time as mean_exec_time_ms,
  max_exec_time as max_exec_time_ms,
  rows,
  shared_blks_hit,
  shared_blks_read,
  CASE
    WHEN (shared_blks_hit + shared_blks_read) > 0
    THEN shared_blks_hit::float / (shared_blks_hit + shared_blks_read)
    ELSE 1.0
  END as hit_ratio
FROM pg_stat_statements
WHERE userid = (SELECT usesysid FROM pg_user WHERE usename = current_user)
  AND calls > $1
  AND mean_exec_time < 10
ORDER BY calls DESC
LIMIT 20;
`;

/**
 * Poll pg_stat_statements for slow queries.
 * Accepts a database query executor function.
 */
export async function pollSlowQueries(
  dbQuery: (sql: string, params: any[]) => Promise<{ rows: any[] }>,
  config: Partial<SlowQueryConfig> = {}
): Promise<{ slow: SlowQuery[]; n1Candidates: SlowQuery[] }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  pollCount++;
  lastPollTimestamp = Date.now();

  try {
    // Query slow queries
    const slowResult = await dbQuery(SLOW_QUERY_SQL, [cfg.slowThresholdMs, cfg.topN]);
    lastSlowQueries = slowResult.rows.map((row: any) => ({
      queryId: row.query_id,
      query: row.query,
      calls: Number(row.calls),
      totalExecTimeMs: Math.round(Number(row.total_exec_time_ms)),
      meanExecTimeMs: Math.round(Number(row.mean_exec_time_ms) * 100) / 100,
      maxExecTimeMs: Math.round(Number(row.max_exec_time_ms)),
      rows: Number(row.rows),
      sharedBlksHit: Number(row.shared_blks_hit),
      sharedBlksRead: Number(row.shared_blks_read),
      hitRatio: Math.round(Number(row.hit_ratio) * 10000) / 100,
    }));

    // N+1 detection
    const n1Result = await dbQuery(N1_DETECTION_SQL, [cfg.n1DetectionThreshold]);
    lastN1Candidates = n1Result.rows.map((row: any) => ({
      queryId: row.query_id,
      query: row.query,
      calls: Number(row.calls),
      totalExecTimeMs: Math.round(Number(row.total_exec_time_ms)),
      meanExecTimeMs: Math.round(Number(row.mean_exec_time_ms) * 100) / 100,
      maxExecTimeMs: Math.round(Number(row.max_exec_time_ms)),
      rows: Number(row.rows),
      sharedBlksHit: Number(row.shared_blks_hit),
      sharedBlksRead: Number(row.shared_blks_read),
      hitRatio: Math.round(Number(row.hit_ratio) * 10000) / 100,
    }));

    // Alert on critical slow queries (>5s total)
    const critical = lastSlowQueries.filter((q) => q.totalExecTimeMs > 5000);
    if (critical.length > 0) {
      alertCount += critical.length;
      logger.warn({
        criticalQueries: critical.length,
        worstQuery: critical[0]?.query.substring(0, 100),
        worstTime: critical[0]?.totalExecTimeMs,
      }, "[SlowQueryMonitor] Critical slow queries detected");
    }

    // Alert on N+1 patterns
    if (lastN1Candidates.length > 0) {
      logger.info({
        n1Candidates: lastN1Candidates.length,
        topOffender: lastN1Candidates[0]?.query.substring(0, 100),
        topCalls: lastN1Candidates[0]?.calls,
      }, "[SlowQueryMonitor] Potential N+1 query patterns detected");
    }

    return { slow: lastSlowQueries, n1Candidates: lastN1Candidates };
  } catch (err) {
    // pg_stat_statements not enabled — log warning
    if ((err as Error).message?.includes("pg_stat_statements")) {
      logger.warn("[SlowQueryMonitor] pg_stat_statements extension not available");
    } else {
      logger.error({ err }, "[SlowQueryMonitor] Error polling slow queries");
    }
    return { slow: [], n1Candidates: [] };
  }
}

/**
 * Start periodic slow query monitoring.
 */
export function startSlowQueryMonitor(
  dbQuery: (sql: string, params: any[]) => Promise<{ rows: any[] }>,
  config: Partial<SlowQueryConfig> = {}
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (timer) {
    logger.warn("[SlowQueryMonitor] Already running");
    return;
  }

  logger.info({
    intervalMs: cfg.intervalMs,
    slowThresholdMs: cfg.slowThresholdMs,
  }, "[SlowQueryMonitor] Starting periodic monitoring");

  // Initial poll
  pollSlowQueries(dbQuery, cfg).catch(() => {});

  timer = setInterval(() => {
    pollSlowQueries(dbQuery, cfg).catch(() => {});
  }, cfg.intervalMs);
}

/**
 * Stop periodic monitoring.
 */
export function stopSlowQueryMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info("[SlowQueryMonitor] Stopped");
  }
}

/**
 * Generate Prometheus metrics for slow queries.
 */
export function generateSlowQueryMetrics(): string {
  const lines: string[] = [];

  lines.push("# HELP remitflow_slow_query_total_exec_time_ms Total execution time of slow queries");
  lines.push("# TYPE remitflow_slow_query_total_exec_time_ms gauge");
  for (const q of lastSlowQueries.slice(0, 10)) {
    const label = q.query.replace(/["\n\r\\]/g, "").substring(0, 80);
    lines.push(`remitflow_slow_query_total_exec_time_ms{query="${label}"} ${q.totalExecTimeMs}`);
  }

  lines.push("# HELP remitflow_slow_query_monitor_polls_total Number of polling cycles");
  lines.push("# TYPE remitflow_slow_query_monitor_polls_total counter");
  lines.push(`remitflow_slow_query_monitor_polls_total ${pollCount}`);

  lines.push("# HELP remitflow_slow_query_alerts_total Number of critical alerts fired");
  lines.push("# TYPE remitflow_slow_query_alerts_total counter");
  lines.push(`remitflow_slow_query_alerts_total ${alertCount}`);

  lines.push("# HELP remitflow_n1_candidate_count Number of potential N+1 query patterns");
  lines.push("# TYPE remitflow_n1_candidate_count gauge");
  lines.push(`remitflow_n1_candidate_count ${lastN1Candidates.length}`);

  lines.push("# HELP remitflow_slow_query_last_poll_timestamp Unix timestamp of last poll");
  lines.push("# TYPE remitflow_slow_query_last_poll_timestamp gauge");
  lines.push(`remitflow_slow_query_last_poll_timestamp ${lastPollTimestamp}`);

  return lines.join("\n") + "\n";
}

/**
 * Get slow query report as JSON (for tRPC/admin endpoint).
 */
export function getSlowQueryReport(): {
  slow: SlowQuery[];
  n1Candidates: SlowQuery[];
  meta: { pollCount: number; alertCount: number; lastPoll: number };
} {
  return {
    slow: lastSlowQueries,
    n1Candidates: lastN1Candidates,
    meta: {
      pollCount,
      alertCount,
      lastPoll: lastPollTimestamp,
    },
  };
}
