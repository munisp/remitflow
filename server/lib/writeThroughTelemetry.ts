/**
 * Write-Through Failure Telemetry (W19-B)
 *
 * The repo previously scattered `.catch(() => {})` on dual-write / write-
 * through paths. That silently dropped Redis/PG failures, leaving the
 * in-memory map authoritative-looking while the durable store diverged.
 *
 * This module is the single choke point for reporting those failures:
 *   - ALWAYS logs (WARN for telemetry/best-effort, ERROR for money-path or
 *     integrity-critical stores) via the structured logger.
 *   - ALWAYS increments an in-memory counter (`writeThroughFailuresTotal`)
 *     exposed for the /metrics pipeline via writeThroughFailureMetricsText().
 *
 * Policy (SPEC-wave19 standing constraints):
 *   - Telemetry/audit emit failures: fail-open (log + count, never throw).
 *   - Money-path idempotency/lock failures: the CALLER must fail closed
 *     (throw/deny). This helper never throws; it just guarantees the
 *     failure is never silent.
 */
import { logger } from "../_core/logger";

// W20-F (DL-17): counters are Redis-primary (INCR + TTL) so they survive
// process restarts and are correct across replicas. The in-memory Map is the
// dev/test fallback only. In production a lost Redis increment is NEVER
// silent: it increments the in-memory meta-counter
// `__telemetry_counter_loss__` and is ERROR-logged (telemetry stays
// fail-open — it never throws, never blocks the caller).
const REDIS_COUNTER_TTL_SECS = 7 * 24 * 60 * 60; // 7 days
const META_COUNTER_LOSS_KEY = "__telemetry_counter_loss__";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const counters = new Map<string, number>();

async function incrementRedisCounter(store: string): Promise<boolean> {
  try {
    // Dynamic import avoids a module-load cycle risk (redisHardened pulls in
    // ioredis; keeping this lazy also keeps unit tests Redis-free).
    const { getRedisConnection } = await import("../middleware/redisHardened");
    const redis = await getRedisConnection();
    const key = `wtt:failures:${store.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
    await redis.incr(key);
    await redis.expire(key, REDIS_COUNTER_TTL_SECS);
    return true;
  } catch {
    return false;
  }
}

function bumpMetaCounterLoss(err?: unknown): void {
  counters.set(META_COUNTER_LOSS_KEY, (counters.get(META_COUNTER_LOSS_KEY) ?? 0) + 1);
  logger.error(
    { errMsg: err instanceof Error ? err.message : err ? String(err) : undefined, total: counters.get(META_COUNTER_LOSS_KEY) },
    "[WriteThrough] Redis counter increment LOST in production — in-memory counters only (meta-counter bumped)",
  );
}

/**
 * Report a failed durable write-through / dual-write. Replaces
 * `.catch(() => {})`. Never throws — safe to use inside `.catch()` chains.
 *
 * @param store    Logical store name (e.g. "security_login_fallback").
 * @param err      The caught error (may be undefined for fire-and-forget).
 * @param severity "warn" (default, telemetry/best-effort paths) | "error"
 *                 (money-path / integrity stores — caller still decides
 *                 whether to fail closed).
 */
export function reportWriteThroughFailure(
  store: string,
  err?: unknown,
  severity: "warn" | "error" = "warn",
): void {
  // Redis-primary counter (durable, cluster-wide). Fire-and-forget: telemetry
  // is fail-open and must never block/throw into the caller's path.
  void incrementRedisCounter(store).then((ok) => {
    if (!ok && IS_PRODUCTION) bumpMetaCounterLoss();
  });
  // In-memory fallback — retained for dev/test and as the /metrics source
  // when Redis is down; in production a Redis loss is meta-counted above.
  counters.set(store, (counters.get(store) ?? 0) + 1);
  const meta = {
    store,
    errMsg: err instanceof Error ? err.message : err ? String(err) : undefined,
    total: counters.get(store),
  };
  if (severity === "error") {
    logger.error(meta, `[WriteThrough] DURABLE WRITE FAILED (${store}) — in-memory state may diverge from durable store`);
  } else {
    logger.warn(meta, `[WriteThrough] durable write failed (${store}) — continuing (fail-open)`);
  }
}

/** Snapshot of failure counters by store (for health endpoints / tests). */
export function getWriteThroughFailures(): Record<string, number> {
  return Object.fromEntries(counters);
}

/** Prometheus text exposition for the counters (OpenMetrics). */
export function writeThroughFailureMetricsText(): string {
  const lines: string[] = [
    "# HELP write_through_failures_total Durable write-through failures by store (were silently swallowed before W19).",
    "# TYPE write_through_failures_total counter",
  ];
  for (const [store, n] of counters) {
    lines.push(`write_through_failures_total{store="${store.replace(/"/g, "")}"} ${n}`);
  }
  return lines.join("\n");
}
