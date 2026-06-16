/**
 * Query Logger — P2 Database 2.8
 * Captures slow queries, explains execution plans, alerts on N+1 patterns.
 */

interface QueryLog {
  query: string;
  params: unknown[];
  duration: number;
  timestamp: number;
  caller?: string;
  rowCount?: number;
}

const queryLogs: QueryLog[] = [];
const SLOW_THRESHOLD_MS = 100;
const MAX_LOG_SIZE = 10_000;
const nPlusOneTracker = new Map<string, { count: number; firstSeen: number }>();

export function logQuery(query: string, params: unknown[], durationMs: number, rowCount?: number): void {
  const entry: QueryLog = {
    query: query.slice(0, 500),
    params: params.slice(0, 10),
    duration: durationMs,
    timestamp: Date.now(),
    rowCount,
  };

  queryLogs.push(entry);
  if (queryLogs.length > MAX_LOG_SIZE) {
    queryLogs.splice(0, queryLogs.length - MAX_LOG_SIZE);
  }

  // Detect N+1 patterns
  const normalized = normalizeQuery(query);
  const existing = nPlusOneTracker.get(normalized);
  const now = Date.now();
  if (existing && now - existing.firstSeen < 1000) {
    existing.count++;
  } else {
    nPlusOneTracker.set(normalized, { count: 1, firstSeen: now });
  }
}

function normalizeQuery(query: string): string {
  return query
    .replace(/\$\d+/g, "?")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function getSlowQueries(thresholdMs = SLOW_THRESHOLD_MS, limit = 50): QueryLog[] {
  return queryLogs
    .filter((q) => q.duration >= thresholdMs)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, limit);
}

export function getNPlusOnePatterns(): Array<{ query: string; count: number }> {
  const results: Array<{ query: string; count: number }> = [];
  nPlusOneTracker.forEach((value, key) => {
    if (value.count >= 5) {
      results.push({ query: key, count: value.count });
    }
  });
  return results.sort((a, b) => b.count - a.count);
}

export function getQueryStats(): {
  totalQueries: number;
  slowQueries: number;
  avgDuration: number;
  p95Duration: number;
  nPlusOnePatterns: number;
} {
  const total = queryLogs.length;
  const slow = queryLogs.filter((q) => q.duration >= SLOW_THRESHOLD_MS).length;
  const durations = queryLogs.map((q) => q.duration).sort((a, b) => a - b);
  const avg = total > 0 ? durations.reduce((s, d) => s + d, 0) / total : 0;
  const p95 = total > 0 ? durations[Math.floor(total * 0.95)] ?? 0 : 0;
  const nPlus = getNPlusOnePatterns().length;

  return {
    totalQueries: total,
    slowQueries: slow,
    avgDuration: Math.round(avg * 100) / 100,
    p95Duration: p95,
    nPlusOnePatterns: nPlus,
  };
}

export function clearQueryLogs(): void {
  queryLogs.length = 0;
  nPlusOneTracker.clear();
}
