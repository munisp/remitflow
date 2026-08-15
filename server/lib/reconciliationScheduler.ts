/**
 * Reconciliation Scheduler
 *
 * Runs the PG↔TigerBeetle balance reconciliation (server/ledger-sync.ts
 * reconcileBalances) on a fixed daily cadence — TigerBeetle is the source of
 * truth and this pass repairs any PostgreSQL cache drift from failed
 * dual-writes.
 *
 * Cadence: RECONCILIATION_INTERVAL_MS overrides the default 24h interval; the
 * first run is delayed RECONCILIATION_STARTUP_DELAY_MS (default 5 minutes) so
 * boot does not contend with migration/topic bootstrap.
 *
 * The scheduler never overlaps runs and never throws into the process: a
 * failing pass is logged and retried on the next tick.
 */

import { reconcileBalances } from "../ledger-sync";
import { logger } from "../_core/logger";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1_000; // daily
const STARTUP_DELAY_MS = Number(process.env.RECONCILIATION_STARTUP_DELAY_MS) || 5 * 60 * 1_000;
const BATCH_SIZE = Number(process.env.RECONCILIATION_BATCH_SIZE) || 500;

let intervalTimer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;
let running = false;

async function runPass(): Promise<void> {
  if (running) return;
  running = true;
  const startedAt = Date.now();
  try {
    const summary = await reconcileBalances({ batchSize: BATCH_SIZE });
    logger.info(
      { ...summary, results: undefined, durationMs: Date.now() - startedAt },
      "[Reconciliation] Scheduled pass complete",
    );
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[Reconciliation] Scheduled pass failed — will retry on next tick",
    );
  } finally {
    running = false;
  }
}

export function startReconciliationScheduler(): void {
  if (intervalTimer || startupTimer) return; // idempotent

  const intervalMs = Number(process.env.RECONCILIATION_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  startupTimer = setTimeout(() => {
    startupTimer = null;
    void runPass();
    intervalTimer = setInterval(() => void runPass(), intervalMs);
    intervalTimer.unref();
    logger.info({ intervalMs }, "[Reconciliation] Scheduler started");
  }, STARTUP_DELAY_MS);
  startupTimer.unref();
}

export function stopReconciliationScheduler(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}
