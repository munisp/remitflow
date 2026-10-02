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

const counters = new Map<string, number>();

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
