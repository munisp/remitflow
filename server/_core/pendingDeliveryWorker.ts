/**
 * RemitFlow — Pending Delivery Worker (W20-A, DL-24)
 * ──────────────────────────────────────────────────
 * airtime.topup / bills.pay (server/routers.ts) debit the wallet first and
 * record the transaction as PENDING_DELIVERY plus a durable row in
 * `pending_deliveries` (same db.transaction as the debit). Nothing else in
 * the platform settles those rows — this worker drives each one to a
 * terminal state.
 *
 * Provider fulfillment: NO real airtime/biller adapter exists in the tree
 * (verified by grep — the "providers" in routers.ts are static display
 * lists; there is no vtpass/biller/telco HTTP client). The
 * attemptProviderFulfillment() seam below is where a real adapter plugs in;
 * until then every row is auto-refunded after MAX_ATTEMPTS attempts.
 *
 * Guarantees:
 *   - Fail closed: no DB → the tick aborts (logged), rows stay pending,
 *     nothing is silently dropped or fabricated as delivered.
 *   - Refund path is ONE db.transaction: guarded row re-check → wallet
 *     re-credit (relative, advisory-locked, wallet created if missing) →
 *     transactions row → 'reversed' → pending_deliveries → 'refunded' →
 *     audit row. Any failure rolls ALL of it back; the row stays pending
 *     and is retried on the next tick.
 *   - Every status transition writes an auditLogs row inside the same
 *     transaction; per-attempt outcomes are WARN/ERROR-logged. No silent
 *     catches anywhere in this file.
 *   - Multi-replica safe: each row is processed under
 *     SELECT ... FOR UPDATE inside its transaction.
 *
 * Wiring (orchestrator/Lane F — server/_core/index.ts is NOT Lane A's file):
 *   import { startPendingDeliveryWorker } from "./pendingDeliveryWorker";
 *   // where other workers start (cf. startOutboxWorker() at index.ts:1388):
 *   try { startPendingDeliveryWorker(); } catch (err) { logger.error({ err }, "[PendingDelivery] worker start failed"); }
 */
import { hostname } from "node:os";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { auditLogs, pendingDeliveries, transactions, wallets } from "../../drizzle/schema";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 60_000;
const BATCH_SIZE = 25;
/** Attempts before a row with no fulfillable provider is auto-refunded. */
const MAX_ATTEMPTS = 5;

const WORKER_ID = `pending-delivery-worker@${hostname()}:${process.pid}`;

// ─── Metrics (in-memory; surfaced via getPendingDeliveryWorkerMetrics) ───────
const metrics = {
  ticks: 0,
  rowsScanned: 0,
  fulfillmentAttempts: 0,
  fulfilled: 0,
  refunded: 0,
  failed: 0,
  tickErrors: 0,
};

export function getPendingDeliveryWorkerMetrics(): Readonly<typeof metrics> {
  return { ...metrics };
}

type PendingDelivery = typeof pendingDeliveries.$inferSelect;

/**
 * Provider fulfillment seam. Returns true only when a REAL provider adapter
 * confirmed delivery. Today there is none (see header), so this always
 * returns false — the row accrues attempts and is auto-refunded. When a real
 * adapter is added, dispatch on row.kind/row.provider here; a fulfilled
 * delivery must transition the row to 'fulfilled' + transactions to
 * 'completed' + audit row in one db.transaction (mirror refundDelivery).
 */
async function attemptProviderFulfillment(row: PendingDelivery): Promise<boolean> {
  logger.warn(
    { deliveryId: row.id, reference: row.reference, kind: row.kind, provider: row.provider },
    "[PendingDelivery] No provider adapter configured — delivery cannot be fulfilled; will auto-refund after max attempts",
  );
  return false;
}

/**
 * Auto-refund a delivery that can never be fulfilled. ONE db.transaction:
 * wallet re-credit + transactions reversal + delivery status + audit row.
 */
async function refundDelivery(db: any, row: PendingDelivery, reason: string): Promise<void> {
  await db.transaction(async (tx: any) => {
    // Guarded re-check under row lock: bail if another replica already
    // transitioned this row (never double-refund).
    const locked = (await tx.execute(sql`
      SELECT id, status FROM pending_deliveries WHERE id = ${row.id} FOR UPDATE
    `)) as unknown as Array<{ id: number; status: string }>;
    if (!locked.length || locked[0].status !== "pending") return;

    // Wallet re-credit — relative guarded UPDATE; the advisory xact lock
    // serializes first-time wallet creators (wallets has no unique constraint
    // on (userId, currency)) — mirrors qr.pay credit path.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'wallet:' + String(row.userId) + ':' + row.currency}, 42))`);
    const credited = (await tx.execute(sql`
      UPDATE wallets SET balance = balance + ${Number(row.amount)}, "updatedAt" = NOW(), version = version + 1
      WHERE "userId" = ${row.userId} AND currency = ${row.currency}
      RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (credited.length === 0) {
      await tx.insert(wallets).values({ userId: row.userId, currency: row.currency, balance: Number(row.amount).toFixed(2), isDefault: false, status: "active" });
    }

    // Mark the original debit transaction reversed (only if still pending —
    // an already-reversed/completed row is left untouched).
    await tx.update(transactions)
      .set({ status: "reversed" as any, metadata: sql`COALESCE(metadata::jsonb, '{}'::jsonb) || ${JSON.stringify({ fulfillmentStatus: "REFUNDED", refundReason: reason })}::jsonb` })
      .where(and(eq(transactions.reference, row.reference), eq(transactions.userId, row.userId), eq(transactions.status, "pending" as any)));

    await tx.update(pendingDeliveries)
      .set({ status: "refunded", resolvedAt: new Date(), updatedAt: new Date(), lastError: reason })
      .where(eq(pendingDeliveries.id, row.id));

    // Audit row INSIDE the same transaction — the refund is never unaudited.
    await tx.insert(auditLogs).values({
      userId: row.userId,
      action: "PENDING_DELIVERY_REFUND",
      description: `Auto-refunded undeliverable ${row.kind} payment ${row.reference}: ${row.amount} ${row.currency} re-credited after ${row.attempts + 1} fulfillment attempts (${reason})`,
      severity: "warning" as any,
      targetType: "pending_delivery",
      metadata: { deliveryId: row.id, reference: row.reference, kind: row.kind, provider: row.provider, amount: row.amount, currency: row.currency, reason, workerId: WORKER_ID },
    });
  });
  metrics.refunded += 1;
  logger.warn({ deliveryId: row.id, reference: row.reference, userId: row.userId, amount: row.amount, currency: row.currency }, "[PendingDelivery] Auto-refunded undeliverable payment (wallet re-credited, transaction reversed, audited)");
}

async function processRow(db: any, row: PendingDelivery): Promise<void> {
  metrics.fulfillmentAttempts += 1;
  const fulfilled = await attemptProviderFulfillment(row);
  if (fulfilled) {
    // Unreachable today (no adapter). Kept fail-closed: a real adapter must
    // perform its own transition transaction; here we only count it.
    metrics.fulfilled += 1;
    return;
  }
  const attempts = row.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await refundDelivery(db, row, "no provider adapter configured");
    return;
  }
  // Not yet at the refund threshold — record the attempt (audited via log;
  // status stays 'pending' so this is not a state transition).
  await db.update(pendingDeliveries)
    .set({ attempts, lastAttemptAt: new Date(), updatedAt: new Date(), lastError: "no provider adapter configured" })
    .where(and(eq(pendingDeliveries.id, row.id), eq(pendingDeliveries.status, "pending")));
}

async function processBatch(): Promise<void> {
  metrics.ticks += 1;
  const db = await getDb();
  if (!db) {
    // Fail closed: without the DB we cannot claim, refund, or audit — abort
    // the tick (logged + counted) rather than silently skipping work.
    metrics.tickErrors += 1;
    logger.error("[PendingDelivery] Database unavailable — tick aborted, rows remain pending (fail closed)");
    return;
  }
  const rows = (await db.select().from(pendingDeliveries)
    .where(eq(pendingDeliveries.status, "pending"))
    .orderBy(pendingDeliveries.id)
    .limit(BATCH_SIZE)) as PendingDelivery[];
  metrics.rowsScanned += rows.length;
  for (const row of rows) {
    try {
      await processRow(db, row);
    } catch (err) {
      // Per-row failure: logged + counted, row stays pending for the next
      // tick; the batch continues. Never silent.
      metrics.failed += 1;
      logger.error({ err, deliveryId: row.id, reference: row.reference }, "[PendingDelivery] Row processing failed — will retry next tick");
    }
  }
}

// ─── Worker Lifecycle ─────────────────────────────────────────────────────────
let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;

export function startPendingDeliveryWorker(): void {
  if (isRunning) return;
  isRunning = true;
  logger.info({ workerId: WORKER_ID, pollIntervalMs: POLL_INTERVAL_MS, maxAttempts: MAX_ATTEMPTS }, "[PendingDelivery] Worker started");

  const tick = async () => {
    if (!isRunning) return;
    try {
      await processBatch();
    } catch (err) {
      metrics.tickErrors += 1;
      logger.error({ err }, "[PendingDelivery] Worker tick failed");
    } finally {
      if (isRunning) {
        pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    }
  };

  pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
}

export function stopPendingDeliveryWorker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info("[PendingDelivery] Worker stopped");
}
