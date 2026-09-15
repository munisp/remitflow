/**
 * BDC Scheduler (bdc-integration wave) — node-cron registrations for the BDC
 * bounded context, boot-registered from server/_core/index.ts in the same
 * guarded, non-blocking style as the W10 schedulers.
 *
 * Jobs:
 *   1. bdc-quote-expiry      (hourly)         — bulk-expire published rate
 *      quotes past expiresAt. Mirrors bdc.rates.expireStale but runs without
 *      a caller context; SQL-level sweep, audit-logged.
 *   2. bdc-eod-close         (15:05 UTC daily = 16:05 WAT) — per active BDC
 *      tenant: record-then-report position snapshot + sweep expired NFEM
 *      batches (status 'selling' past deadlineAt → 'expired' + alert event).
 *      This is the safety net behind the Temporal 24h lifecycle workflow:
 *      if Temporal is down, the 24h liquidation rule is still enforced.
 *   3. bdc-settlement-recon  (06:30 UTC daily) — starts the Temporal
 *      bdcSettlementReconWorkflow per distinct IMTO code. Fail-soft: when
 *      Temporal is unavailable the tick is skipped with a loud WARN.
 *
 * Discipline: every tick is tenant-filtered, overlap-guarded, and never
 * throws out of the cron callback (a failed tick logs loudly and waits for
 * the next one). Telemetry failures are no-op WARNs — nothing here blocks
 * money paths.
 */
import cron, { type ScheduledTask } from "node-cron";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { logger } from "../_core/logger";

let tasks: ScheduledTask[] = [];
let tickInFlight = false;

/** Expire published BDC rate quotes whose expiresAt has passed. */
async function sweepExpiredQuotes(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = (await db.execute(sql`
    UPDATE bdc_rate_quotes
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'published' AND expires_at IS NOT NULL AND expires_at < NOW()
    RETURNING id
  `)) as unknown as Array<{ id: number }>;
  return rows.length;
}

/** Per-tenant EOD close: snapshot (record-then-report) + expired-batch sweep. */
async function runEodClose(): Promise<{ tenants: number; expiredBatches: number }> {
  const db = await getDb();
  if (!db) return { tenants: 0, expiredBatches: 0 };

  // 1. Expired NFEM batches → 'expired' (the 24h rule's non-Temporal net).
  const expired = (await db.execute(sql`
    UPDATE bdc_nfem_purchase_batches
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'selling' AND deadline_at IS NOT NULL AND deadline_at < NOW()
    RETURNING id, tenant_id, amount_usd
  `)) as unknown as Array<{ id: number; tenant_id: number; amount_usd: string }>;
  if (expired.length > 0) {
    logger.warn(
      { expired: expired.map((b) => ({ batchId: b.id, tenantId: b.tenant_id, amountUsd: b.amount_usd })) },
      "[BDC] EOD sweep: NFEM batches exceeded 24h liquidation deadline — force liquidation required",
    );
    try {
      const { KAFKA_TOPICS, publishEvent } = await import("../middleware/kafka.js");
      for (const b of expired) {
        await publishEvent(KAFKA_TOPICS.BDC_NFEM_ALERTS, `bdc-nfem-expired-${b.id}`, {
          type: "NFEM_BATCH_EXPIRED",
          batchId: b.id,
          tenantId: b.tenant_id,
          amountUsd: b.amount_usd,
          source: "bdc-scheduler-eod",
          task: { type: "manual_liquidation", batchId: b.id },
        });
      }
    } catch (err) {
      logger.warn({ errMsg: (err as Error)?.message }, "[BDC] EOD Kafka alert publish failed (non-blocking)");
    }
  }

  // 2. Position snapshot per active operator (record-then-report), computed
  //    via the SAME computePosition used by bdc.sourcing.positionNow/eodClose
  //    (TB balances, ≤1s staleness) — the cron path never estimates positions.
  const tenants = (await db.execute(sql`
    SELECT tenant_id FROM bdc_operator_profiles WHERE license_status <> 'pending'
  `)) as unknown as Array<{ tenant_id: number }>;
  let snapshotted = 0;
  const { computePosition } = await import("../routers/bdc/sourcing.js");
  const { bdcPositionSnapshots } = await import("../../drizzle/schema.js");
  for (const { tenant_id: tenantId } of tenants) {
    try {
      const pos = await computePosition(db, tenantId);
      const centsToMajor = (c: bigint) => (Number(c) / 100).toFixed(2);
      await db.insert(bdcPositionSnapshots).values({
        tenantId,
        nopUsd: centsToMajor(pos.nopUsdMinor),
        nopPct: pos.nopPct.toFixed(2),
        borrowing: centsToMajor(pos.borrowingUsdMinor),
        borrowingPct: pos.borrowingPct.toFixed(2),
        breachFlags: pos.breaches as unknown as Record<string, unknown>[],
      });
      snapshotted++;
      if (pos.breaches.length > 0) {
        logger.warn({ tenantId, breaches: pos.breaches, rateStale: pos.rateStale }, "[BDC] EOD position BREACH detected");
        try {
          const { KAFKA_TOPICS, publishEvent } = await import("../middleware/kafka.js");
          await publishEvent(KAFKA_TOPICS.BDC_POSITION_BREACH, `bdc-pos-breach-${tenantId}-${Date.now()}`, {
            type: "BDC_POSITION_BREACH",
            tenantId,
            breaches: pos.breaches,
            source: "bdc-scheduler-eod",
          });
        } catch (err) {
          logger.warn({ errMsg: (err as Error)?.message }, "[BDC] EOD breach alert publish failed (non-blocking)");
        }
      }
    } catch (err) {
      logger.warn({ errMsg: (err as Error)?.message, tenantId }, "[BDC] EOD snapshot failed for tenant (non-blocking)");
    }
  }
  return { tenants: snapshotted, expiredBatches: expired.length };
}

/** Kick the daily settlement-recon workflow per distinct IMTO code. */
async function runSettlementRecon(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const codes = (await db.execute(sql`
    SELECT DISTINCT imto_code FROM bdc_imto_settlements WHERE status = 'accrued'
  `)) as unknown as Array<{ imto_code: string }>;
  let started = 0;
  try {
    const { startBdcSettlementRecon } = await import("../temporal/workflows-bdc.js");
    // reconcileActivity (server/temporal/activities-bdc.ts) requires YYYY-MM
    // (/^\d{4}-\d{2}$/) — a YYYY-MM-DD period would fail the workflow input
    // validation on every daily tick (F5).
    const period = new Date().toISOString().slice(0, 7);
    for (const { imto_code } of codes) {
      if (await startBdcSettlementRecon(imto_code, period)) started++;
    }
  } catch (err) {
    logger.warn({ errMsg: (err as Error)?.message }, "[BDC] Settlement recon workflow start failed — Temporal unavailable; manual reconcileSettlements remains available");
  }
  return started;
}

export function startBdcSchedulers(): void {
  if (tasks.length > 0) {
    logger.info("[BDC] Schedulers already running — start is idempotent, ignoring");
    return;
  }
  const guarded = (name: string, fn: () => Promise<unknown>) => async () => {
    if (tickInFlight) {
      logger.warn(`[BDC] ${name}: previous tick still running — skipping (overlap guard)`);
      return;
    }
    tickInFlight = true;
    try {
      const result = await fn();
      logger.info({ result }, `[BDC] ${name} tick complete`);
    } catch (err) {
      logger.error({ errMsg: (err as Error)?.message }, `[BDC] ${name} tick FAILED (will retry next schedule):`);
    } finally {
      tickInFlight = false;
    }
  };

  tasks = [
    cron.schedule("0 * * * *", guarded("bdc-quote-expiry", async () => ({ expired: await sweepExpiredQuotes() }))),
    // 16:05 WAT = 15:05 UTC (WAT is UTC+1, no DST)
    cron.schedule("5 15 * * *", guarded("bdc-eod-close", runEodClose)),
    cron.schedule("30 6 * * *", guarded("bdc-settlement-recon", async () => ({ started: await runSettlementRecon() }))),
  ];
  logger.info("[BDC] Schedulers started (quote-expiry hourly, eod-close 16:05 WAT, settlement-recon daily)");
}

export function stopBdcSchedulers(): void {
  for (const t of tasks) t.stop();
  tasks = [];
}
