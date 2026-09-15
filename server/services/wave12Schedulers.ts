/**
 * wave12Schedulers.ts — node-cron registrations for SPEC-wave12 §7 (ORCH).
 * Jobs: pickup-authorization expiry sweep (hourly), teller-fraud nightly scan,
 * settled-reversal watchdog (daily, Temporal starter).
 * Pattern copied from bdcScheduler.ts: guarded ticks (no overlap), idempotent
 * start, callbacks never throw — telemetry must never block money paths.
 */
import cron, { type ScheduledTask } from "node-cron";
import { logger } from "../_core/logger";

let tasks: ScheduledTask[] = [];
let tickInFlight = false;

export function startWave12Schedulers(): void {
  if (tasks.length > 0) {
    logger.info("[wave12] Schedulers already registered — idempotent, ignoring");
    return;
  }
  const guarded = (name: string, fn: () => Promise<unknown>) => async () => {
    if (tickInFlight) {
      logger.warn(`[wave12] ${name}: previous tick still running — skipping`);
      return;
    }
    tickInFlight = true;
    try {
      const result = await fn();
      logger.info({ result }, `[wave12] ${name} tick complete`);
    } catch (err) {
      logger.error(
        { errMsg: (err as Error)?.message },
        `[wave12] ${name} tick FAILED — will retry next schedule (fail-soft, no money path affected)`,
      );
    } finally {
      tickInFlight = false;
    }
  };

  tasks = [
    // Hourly: expire pending pickup authorizations past expires_at (G9).
    cron.schedule(
      "12 * * * *",
      guarded("pickup-expiry-sweep", async () => {
        const { sweepExpiredPickupAuthorizations } = await import("../routers/bdc/pickup.js");
        return sweepExpiredPickupAuthorizations();
      }),
    ),
    // Nightly 03:40 WAT-offset: teller-fraud analytics scan (G10) — tenant-wide, fail-soft.
    cron.schedule(
      "40 2 * * *",
      guarded("teller-fraud-scan", async () => {
        const { runNightlyTellerFraudScan } = await import("../routers/bdc/analytics.js");
        return runNightlyTellerFraudScan();
      }),
    ),
    // Daily 06:10: settled-reversal watchdog via Temporal (G1) — alerts on approved-stuck>24h.
    cron.schedule(
      "10 6 * * *",
      guarded("reversal-watchdog", async () => {
        const { startBdcReversalWatchdog } = await import("../temporal/workflows-bdc.js");
        return startBdcReversalWatchdog();
      }),
    ),
  ];
  logger.info("[wave12] Schedulers registered (pickup-expiry, teller-fraud-scan, reversal-watchdog)");
}

export function stopWave12Schedulers(): void {
  for (const t of tasks) t.stop();
  tasks = [];
}
