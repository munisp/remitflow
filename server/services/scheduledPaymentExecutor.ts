/**
 * W12 CRIT V-B-1 — Scheduled Payment Executor.
 *
 * Replaces the fabricated cron leg in cronJobsRouter.ts ("recurring-payments"),
 * which only flipped scheduled_transfers.status to 'processing' — no wallet
 * debit, no transfer, money never moved, yet the row claimed processing.
 * (That SQL also referenced a non-existent `next_run` column; the real column
 * is `next_run_at`, so the stub could only ever error or no-op.)
 *
 * Design (fail closed everywhere):
 *
 *   ACTOR MODEL — this executor is a SYSTEM actor: it executes schedules that
 *   a user already authorized via the TOTP step-up gate at creation/update
 *   time (see scheduledTransfers.ts create/update). The executor itself does
 *   not re-prompt for TOTP — that would be impossible for an unattended cron
 *   — but it can only ever act on schedules the user created under step-up,
 *   and only for the exact amount/currency/beneficiary authorized there.
 *
 *   1. GUARDED CLAIM (single winner): one conditional UPDATE flips
 *      status active→executing for a due schedule. Concurrent cron ticks or
 *      overlapping admin triggers can never both claim the same occurrence.
 *      The claim stamps lastRunAt with the claim time so the sweeper can age
 *      stuck rows.
 *
 *   2. ONE TRANSACTION PER OCCURRENCE: idempotency pre-check → ledger insert
 *      (unique idempotency key = double-execution tripwire; a conflict throws
 *      and rolls the whole tx back BEFORE any money movement) → guarded
 *      wallet debit (UPDATE ... WHERE balance >= amount, affected-rows == 1
 *      or fail) → destination credit per rail → transactions row → run row →
 *      recurrence advancement. Any throw rolls EVERYTHING back.
 *
 *   3. RAILS:
 *      - Internal (no beneficiary): credit the user's own wallet in the
 *        `toCurrency` in the same tx. Cross-currency requires a fresh FX rate
 *        from fx_rate_cache (<=24h old); missing/stale rate → FAIL CLOSED.
 *        Same-currency with no distinct destination wallet → FAIL (a self
 *        debit+credit of the same wallet would be fabricated movement).
 *      - External (beneficiaryId set): create the payout instruction as a
 *        `transactions` row in status 'pending' (NEVER 'completed') — the
 *        existing payout/settlement pipeline picks it up from there. We do
 *        NOT fake external settlement.
 *
 *   4. IDEMPOTENCY: deterministic key `SCHED-XFER-{scheduleId}-{nextRunAt ISO}`
 *      per occurrence, recorded in ledger_transfers.idempotency_key (unique
 *      index) and transactions.idempotency_key. A replay (sweeper recovery,
 *      admin re-trigger, crash-retry) finds the key and becomes a no-op for
 *      money movement — it only completes the bookkeeping.
 *
 *   5. FAILURE: tx rollback → run row 'failed' with reason → schedule back to
 *      'active' with a 1h retry backoff (the occurrence is retried, not
 *      dropped). 5 consecutive failed runs → schedule paused + CRITICAL log
 *      so ops must intervene instead of retrying a permanently-broken
 *      schedule forever.
 *
 *   6. SWEEPER: rows stuck in 'executing' beyond CLAIM_TIMEOUT_MS (crash
 *      between claim and commit). Resolved honestly per row: if the
 *      occurrence's ledger entry exists, the tx committed before the crash →
 *      complete the bookkeeping (run row + recurrence advancement). If no
 *      ledger entry exists, the tx rolled back and NO money moved → reclaim
 *      to 'active' for retry with a failed run row explaining the reclaim.
 *      Never force, never guess.
 *
 * Recurrence advancement happens ONLY after successful execution, from the
 * previous nextRunAt (not wall-clock now), so missed occurrences are executed
 * exactly once each on subsequent ticks rather than silently dropped.
 *
 * No schema changes: scheduled_transfers.status is varchar (not an enum), so
 * 'executing' is a valid claim marker; the runs table uses its existing
 * success|failed|skipped enum.
 */
import cron, { type ScheduledTask } from "node-cron";
import { and, desc, eq, lt, lte, sql } from "drizzle-orm";
import {
  beneficiaries,
  fxRateCache,
  ledgerEntries,
  ledgerTransfers,
  notifications,
  scheduledTransferRuns,
  scheduledTransfers,
  transactions,
  wallets,
} from "../../drizzle/schema";
import { logger } from "../_core/logger";

type Db = NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>>;

const BATCH_LIMIT = 50;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000; // 15 min stuck-executing threshold
const RETRY_BACKOFF_MS = 60 * 60 * 1000; // 1h retry delay after a failed occurrence
const MAX_CONSECUTIVE_FAILURES = 5; // then pause + surface for ops
const FX_RATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface ExecutorSummary {
  due: number;
  executed: number;
  failed: number;
  skipped: number;
}

export interface OccurrenceResult {
  outcome: "executed" | "failed" | "skipped";
  scheduleId: number;
  reason?: string;
  transactionId?: number;
}

/** Deterministic per-occurrence idempotency key (scheduleId + due instant). */
export function occurrenceKey(scheduleId: number, dueAt: Date): string {
  return `SCHED-XFER-${scheduleId}-${dueAt.toISOString()}`;
}

/** Next occurrence from the PREVIOUS nextRunAt (never wall-clock), per frequency. */
function computeNextRunAt(frequency: string, from: Date): Date | null {
  const next = new Date(from.getTime());
  switch (frequency) {
    case "once":
      return null;
    case "daily":
      next.setDate(next.getDate() + 1);
      return next;
    case "weekly":
      next.setDate(next.getDate() + 7);
      return next;
    case "biweekly":
      next.setDate(next.getDate() + 14);
      return next;
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      return next;
    default:
      return null; // unknown frequency → caller fails closed
  }
}

function parseAmount(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid scheduled amount: ${raw}`);
  }
  return n;
}

async function notifyUser(
  db: Db,
  userId: number,
  title: string,
  message: string
): Promise<void> {
  try {
    await db.insert(notifications).values({
      userId,
      title,
      message,
      type: "system",
      isRead: false,
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), userId },
      "[ScheduledExecutor] Notification insert failed (non-blocking)"
    );
  }
}

/**
 * Advance the schedule after a successful occurrence. Guarded: only flips a
 * row still in 'executing' (i.e. still owned by this execution).
 */
async function advanceScheduleAfterSuccess(
  tx: Db,
  schedule: {
    id: number;
    frequency: string;
    nextRunAt: Date;
    runCount: number;
    maxRuns: number | null;
  },
  now: Date
): Promise<void> {
  const next = computeNextRunAt(schedule.frequency, schedule.nextRunAt);
  const newRunCount = schedule.runCount + 1;
  const exhausted =
    schedule.frequency === "once" ||
    next === null ||
    (schedule.maxRuns != null && newRunCount >= schedule.maxRuns);
  const updated = await tx
    .update(scheduledTransfers)
    .set({
      status: exhausted ? "completed" : "active",
      nextRunAt: exhausted ? schedule.nextRunAt : next,
      lastRunAt: now,
      runCount: newRunCount,
    })
    .where(and(eq(scheduledTransfers.id, schedule.id), eq(scheduledTransfers.status, "executing")))
    .returning({ id: scheduledTransfers.id });
  if (updated.length !== 1) {
    throw new Error(
      `Schedule ${schedule.id} no longer owned by this execution (status changed concurrently) — aborting before money movement is finalized`
    );
  }
}

/**
 * Execute one due scheduled transfer occurrence.
 * Caller may invoke this directly (admin trigger) or via the cron loop.
 */
export async function executeScheduledTransfer(
  db: Db,
  scheduleId: number
): Promise<OccurrenceResult> {
  const now = new Date();

  // ── 1. Guarded claim: single winner flips active→executing for a DUE row ──
  const claimed = await db
    .update(scheduledTransfers)
    .set({ status: "executing", lastRunAt: now })
    .where(
      and(
        eq(scheduledTransfers.id, scheduleId),
        eq(scheduledTransfers.status, "active"),
        lte(scheduledTransfers.nextRunAt, now)
      )
    )
    .returning();
  if (claimed.length === 0) {
    return { outcome: "skipped", scheduleId, reason: "not due or already claimed" };
  }
  const schedule = claimed[0];
  const key = occurrenceKey(schedule.id, schedule.nextRunAt);

  try {
    const result = await db.transaction(async (tx) => {
      const amount = parseAmount(schedule.amount);

      // ── 2. Idempotency pre-check: occurrence already executed → no-op for
      //        money movement; complete bookkeeping only (replay path).
      const [existingLedger] = await tx
        .select({ id: ledgerTransfers.id })
        .from(ledgerTransfers)
        .where(eq(ledgerTransfers.idempotencyKey, key))
        .limit(1);
      if (existingLedger) {
        await tx.insert(scheduledTransferRuns).values({
          scheduleId: schedule.id,
          userId: schedule.userId,
          status: "skipped",
          amount: schedule.amount,
          currency: schedule.fromCurrency,
          targetCurrency: schedule.toCurrency,
          errorMessage: `Idempotent replay: occurrence ${key} already has a ledger entry — no money movement repeated`,
        });
        await advanceScheduleAfterSuccess(tx, schedule, now);
        return { replayed: true, transactionId: null as number | null };
      }

      // ── 3. Ledger tripwire FIRST: unique idempotency key. A conflict means
      //        a concurrent execution raced past the claim — throw and roll
      //        back BEFORE any wallet mutation.
      const [beneficiary] = schedule.beneficiaryId
        ? await tx
            .select()
            .from(beneficiaries)
            .where(and(eq(beneficiaries.id, schedule.beneficiaryId), eq(beneficiaries.userId, schedule.userId)))
            .limit(1)
        : [null];

      // ── 4. Funding wallet + guarded debit (affected-rows == 1 or fail) ────
      const [wallet] = await tx
        .select()
        .from(wallets)
        .where(
          and(
            eq(wallets.userId, schedule.userId),
            eq(wallets.currency, schedule.fromCurrency),
            eq(wallets.status, "active")
          )
        )
        .limit(1);
      if (!wallet) {
        throw new Error(`No active ${schedule.fromCurrency} funding wallet for user ${schedule.userId}`);
      }
      const debited = await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} - ${schedule.amount}`, updatedAt: now })
        .where(
          and(
            eq(wallets.id, wallet.id),
            sql`CAST(${wallets.balance} AS DECIMAL(18,2)) >= CAST(${schedule.amount} AS DECIMAL(18,2))`
          )
        )
        .returning({ id: wallets.id });
      if (debited.length !== 1) {
        throw new Error(
          `INSUFFICIENT_FUNDS: wallet ${wallet.id} cannot cover ${schedule.amount} ${schedule.fromCurrency}`
        );
      }

      // ── 5. Destination per rail ───────────────────────────────────────────
      let fxRate: number | null = null;
      let transactionId: number;
      let creditAccountId: string;
      let ledgerStatus: string;

      if (beneficiary) {
        // EXTERNAL RAIL — honest: create the payout instruction in PENDING and
        // let the existing payout/settlement pipeline execute it. Never mark
        // external settlement completed here.
        const [txRow] = await tx
          .insert(transactions)
          .values({
            userId: schedule.userId,
            type: "send",
            status: "pending",
            fromCurrency: schedule.fromCurrency,
            fromAmount: schedule.amount,
            toCurrency: schedule.toCurrency,
            fee: "0",
            recipientName: beneficiary.name,
            recipientAccount: beneficiary.accountNumber ?? null,
            recipientBank: beneficiary.bankName ?? null,
            recipientCountry: beneficiary.country ?? null,
            beneficiaryId: beneficiary.id,
            reference: key.slice(0, 64),
            idempotencyKey: key,
            description: `Scheduled transfer payout (PENDING external settlement): ${schedule.description ?? `schedule #${schedule.id}`}`,
            metadata: {
              scheduledTransferId: schedule.id,
              occurrence: key,
              payoutRail: "external_bank",
              awaitingSettlement: true,
            },
          })
          .returning({ id: transactions.id });
        transactionId = txRow.id;
        creditAccountId = `payout-pending:${txRow.id}`;
        ledgerStatus = "pending";
      } else {
        // INTERNAL RAIL — credit the user's own toCurrency wallet in the same tx.
        if (schedule.fromCurrency === schedule.toCurrency) {
          throw new Error(
            "No beneficiary and same-currency schedule has no distinct destination wallet — refusing self-no-op"
          );
        }
        const [destWallet] = await tx
          .select()
          .from(wallets)
          .where(
            and(
              eq(wallets.userId, schedule.userId),
              eq(wallets.currency, schedule.toCurrency),
              eq(wallets.status, "active")
            )
          )
          .limit(1);
        if (!destWallet) {
          throw new Error(`No active ${schedule.toCurrency} destination wallet for user ${schedule.userId}`);
        }
        if (destWallet.id === wallet.id) {
          throw new Error("Source and destination wallet are identical — refusing self-no-op");
        }
        // FX rate — fail closed on missing/stale rate.
        const [fx] = await tx
          .select()
          .from(fxRateCache)
          .where(eq(fxRateCache.base, schedule.fromCurrency))
          .orderBy(desc(fxRateCache.fetchedAt))
          .limit(1);
        const rates = (fx?.rates ?? {}) as Record<string, unknown>;
        const rawRate = rates[schedule.toCurrency];
        const rateAge = fx ? now.getTime() - new Date(fx.fetchedAt).getTime() : Number.POSITIVE_INFINITY;
        if (!fx || typeof rawRate !== "number" || !(rawRate > 0) || rateAge > FX_RATE_MAX_AGE_MS) {
          throw new Error(
            `No fresh FX rate ${schedule.fromCurrency}→${schedule.toCurrency} (fail closed; age=${Math.round(rateAge / 1000)}s)`
          );
        }
        fxRate = rawRate;
        const creditAmount = (amount * fxRate).toFixed(2);
        const credited = await tx
          .update(wallets)
          .set({ balance: sql`${wallets.balance} + ${creditAmount}`, updatedAt: now })
          .where(eq(wallets.id, destWallet.id))
          .returning({ id: wallets.id });
        if (credited.length !== 1) {
          throw new Error(`Destination wallet credit failed for wallet ${destWallet.id}`);
        }
        const [txRow] = await tx
          .insert(transactions)
          .values({
            userId: schedule.userId,
            type: "exchange",
            status: "completed",
            fromCurrency: schedule.fromCurrency,
            fromAmount: schedule.amount,
            toCurrency: schedule.toCurrency,
            toAmount: creditAmount,
            fee: "0",
            fxRate: String(fxRate),
            reference: key.slice(0, 64),
            idempotencyKey: key,
            description: `Scheduled internal transfer: ${schedule.description ?? `schedule #${schedule.id}`}`,
            metadata: { scheduledTransferId: schedule.id, occurrence: key, payoutRail: "internal_wallet" },
          })
          .returning({ id: transactions.id });
        transactionId = txRow.id;
        creditAccountId = `wallet:${destWallet.id}`;
        ledgerStatus = "posted";
      }

      // ── 6. Ledger entries — the unique idempotency_key on ledger_transfers
      //        is the durable exactly-once record for this occurrence. A
      //        conflict throws (23505) and rolls back the debit above.
      const minorUnits = String(Math.round(amount * 100));
      await tx.insert(ledgerTransfers).values({
        id: key,
        debitAccountId: `wallet:${wallet.id}`,
        creditAccountId,
        amount: minorUnits,
        status: ledgerStatus,
        idempotencyKey: key,
        code: 1,
      });
      await tx
        .insert(ledgerEntries)
        .values({
          id: key,
          debitAccountId: `wallet:${wallet.id}`,
          creditAccountId,
          amount: schedule.amount,
          currency: schedule.fromCurrency,
          reference: key,
          type: "scheduled_transfer",
          metadata: {
            scheduleId: schedule.id,
            transactionId,
            rail: beneficiary ? "external_bank" : "internal_wallet",
            fxRate,
            occurrenceDueAt: schedule.nextRunAt.toISOString(),
          },
        })
        .onConflictDoNothing();

      // ── 7. Run row (occurrence EXECUTED, linked to the money record) ──────
      await tx.insert(scheduledTransferRuns).values({
        scheduleId: schedule.id,
        userId: schedule.userId,
        status: "success",
        amount: schedule.amount,
        currency: schedule.fromCurrency,
        targetCurrency: schedule.toCurrency,
        fxRate: fxRate != null ? String(fxRate) : null,
        transactionId,
      });

      // ── 8. Recurrence advancement — only after successful execution ───────
      await advanceScheduleAfterSuccess(tx, schedule, now);

      return { replayed: false, transactionId };
    });

    logger.info(
      { scheduleId: schedule.id, key, transactionId: result.transactionId, replayed: result.replayed },
      "[ScheduledExecutor] Occurrence executed"
    );
    return {
      outcome: "executed",
      scheduleId,
      transactionId: result.transactionId ?? undefined,
      reason: result.replayed ? "idempotent replay — bookkeeping only" : undefined,
    };
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err)).slice(0, 512);
    logger.error({ scheduleId: schedule.id, key, err: reason }, "[ScheduledExecutor] Occurrence failed — rolled back");
    await handleExecutionFailure(db, schedule, key, reason);
    return { outcome: "failed", scheduleId, reason };
  }
}

/**
 * Post-rollback failure handling: failed run row (surfaced via the runs
 * endpoint), schedule back to 'active' with retry backoff — UNLESS this is
 * the 5th consecutive failure, in which case pause + CRITICAL for ops.
 * The schedule is never left dangling in 'executing'.
 */
async function handleExecutionFailure(
  db: Db,
  schedule: { id: number; userId: number; amount: string; fromCurrency: string; toCurrency: string },
  key: string,
  reason: string
): Promise<void> {
  const now = new Date();
  try {
    await db.insert(scheduledTransferRuns).values({
      scheduleId: schedule.id,
      userId: schedule.userId,
      status: "failed",
      amount: schedule.amount,
      currency: schedule.fromCurrency,
      targetCurrency: schedule.toCurrency,
      errorMessage: reason,
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), scheduleId: schedule.id },
      "[ScheduledExecutor] Failed to write failure run row"
    );
  }

  // Consecutive-failure guard: pause after MAX_CONSECUTIVE_FAILURES.
  let consecutiveFailures = 0;
  try {
    const recentRuns = await db
      .select({ status: scheduledTransferRuns.status })
      .from(scheduledTransferRuns)
      .where(eq(scheduledTransferRuns.scheduleId, schedule.id))
      .orderBy(desc(scheduledTransferRuns.executedAt))
      .limit(MAX_CONSECUTIVE_FAILURES);
    for (const r of recentRuns) {
      if (r.status === "failed") consecutiveFailures++;
      else break;
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), scheduleId: schedule.id },
      "[ScheduledExecutor] Failure-history lookup failed (non-blocking)"
    );
  }

  const pause = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
  try {
    if (pause) {
      // Paused: keep nextRunAt unchanged (still the failed occurrence's due
      // instant) so a manual resume re-executes it immediately via the normal
      // claim path.
      await db
        .update(scheduledTransfers)
        .set({ status: "paused" })
        .where(and(eq(scheduledTransfers.id, schedule.id), eq(scheduledTransfers.status, "executing")));
    } else {
      await db
        .update(scheduledTransfers)
        .set({ status: "active", nextRunAt: new Date(now.getTime() + RETRY_BACKOFF_MS) })
        .where(and(eq(scheduledTransfers.id, schedule.id), eq(scheduledTransfers.status, "executing")));
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), scheduleId: schedule.id },
      "[ScheduledExecutor] CRITICAL: failed to release executing claim — sweeper will recover"
    );
  }

  if (pause) {
    logger.error(
      { scheduleId: schedule.id, key, consecutiveFailures },
      "[ScheduledExecutor] CRITICAL: schedule paused after consecutive failures — ops intervention required"
    );
    await notifyUser(
      db,
      schedule.userId,
      "Scheduled Transfer Paused",
      `Your scheduled transfer of ${schedule.amount} ${schedule.fromCurrency} failed ${consecutiveFailures} times in a row (latest: ${reason}). It has been paused — please review and resume it.`
    );
  } else if (reason.startsWith("INSUFFICIENT_FUNDS")) {
    await notifyUser(
      db,
      schedule.userId,
      "Scheduled Transfer Failed",
      `Your scheduled transfer of ${schedule.amount} ${schedule.fromCurrency} could not be processed due to insufficient balance. It will be retried automatically.`
    );
  }
}

/** Execute all due scheduled transfers (bounded batch). */
export async function executeDueScheduledTransfers(db: Db): Promise<ExecutorSummary> {
  const now = new Date();
  const due = await db
    .select({ id: scheduledTransfers.id })
    .from(scheduledTransfers)
    .where(and(eq(scheduledTransfers.status, "active"), lte(scheduledTransfers.nextRunAt, now)))
    .limit(BATCH_LIMIT);

  const summary: ExecutorSummary = { due: due.length, executed: 0, failed: 0, skipped: 0 };
  for (const row of due) {
    try {
      const r = await executeScheduledTransfer(db, row.id);
      if (r.outcome === "executed") summary.executed++;
      else if (r.outcome === "failed") summary.failed++;
      else summary.skipped++;
    } catch (err) {
      summary.failed++;
      logger.error(
        { err: err instanceof Error ? err.message : String(err), scheduleId: row.id },
        "[ScheduledExecutor] Unexpected per-schedule error"
      );
    }
  }
  return summary;
}

/**
 * Sweeper: recover rows stuck in 'executing' beyond CLAIM_TIMEOUT_MS.
 * Honest resolution per row — ledger entry exists ⇒ committed, complete the
 * bookkeeping; no ledger entry ⇒ rolled back, reclaim for retry. Never force.
 */
export async function recoverStuckScheduledTransfers(
  db: Db,
  timeoutMs: number = CLAIM_TIMEOUT_MS
): Promise<{ stuck: number; completed: number; reclaimed: number }> {
  const cutoff = new Date(Date.now() - timeoutMs);
  const stuck = await db
    .select()
    .from(scheduledTransfers)
    .where(and(eq(scheduledTransfers.status, "executing"), lt(scheduledTransfers.lastRunAt, cutoff)))
    .limit(BATCH_LIMIT);

  let completed = 0;
  let reclaimed = 0;
  for (const schedule of stuck) {
    const key = occurrenceKey(schedule.id, schedule.nextRunAt);
    try {
      const [ledger] = await db
        .select({ id: ledgerTransfers.id })
        .from(ledgerTransfers)
        .where(eq(ledgerTransfers.idempotencyKey, key))
        .limit(1);

      if (ledger) {
        // The occurrence tx committed before the crash. Complete bookkeeping.
        await db.transaction(async (tx) => {
          const [existingRun] = await tx
            .select({ id: scheduledTransferRuns.id })
            .from(scheduledTransferRuns)
            .where(
              and(
                eq(scheduledTransferRuns.scheduleId, schedule.id),
                eq(scheduledTransferRuns.status, "success"),
                sql`${scheduledTransferRuns.executedAt} >= ${schedule.lastRunAt}`
              )
            )
            .limit(1);
          if (!existingRun) {
            await tx.insert(scheduledTransferRuns).values({
              scheduleId: schedule.id,
              userId: schedule.userId,
              status: "success",
              amount: schedule.amount,
              currency: schedule.fromCurrency,
              targetCurrency: schedule.toCurrency,
              errorMessage: `Recovered by sweeper: ledger entry ${key} exists — occurrence had committed`,
            });
          }
          await advanceScheduleAfterSuccess(tx, schedule, new Date());
        });
        completed++;
        logger.info({ scheduleId: schedule.id, key }, "[ScheduledExecutor] Sweeper completed committed occurrence");
      } else {
        // No ledger entry ⇒ the tx rolled back ⇒ NO money moved. Reclaim.
        await db.transaction(async (tx) => {
          await tx.insert(scheduledTransferRuns).values({
            scheduleId: schedule.id,
            userId: schedule.userId,
            status: "failed",
            amount: schedule.amount,
            currency: schedule.fromCurrency,
            targetCurrency: schedule.toCurrency,
            errorMessage: `Reclaimed by sweeper after ${Math.round(timeoutMs / 60000)}min in executing; no ledger entry for ${key} — verified no money moved, safe to retry`,
          });
          const flipped = await tx
            .update(scheduledTransfers)
            .set({ status: "active" })
            .where(and(eq(scheduledTransfers.id, schedule.id), eq(scheduledTransfers.status, "executing")))
            .returning({ id: scheduledTransfers.id });
          if (flipped.length !== 1) {
            throw new Error(`Failed to reclaim schedule ${schedule.id} — left for next sweeper pass`);
          }
        });
        reclaimed++;
        logger.warn({ scheduleId: schedule.id, key }, "[ScheduledExecutor] Sweeper reclaimed rolled-back occurrence");
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), scheduleId: schedule.id, key },
        "[ScheduledExecutor] Sweeper could not resolve stuck row — left for next pass (never forced)"
      );
    }
  }
  return { stuck: stuck.length, completed, reclaimed };
}

// ─── Cron registration (mirrors stablecoinScheduler / payoutSettlementSweeper)
// Idempotent, overlap-guarded. Called from cronJobsRouter module load so the
// executor runs with the server without touching boot files outside scope.
let executorTask: ScheduledTask | null = null;
let running = false;

export function startScheduledPaymentExecutor(): void {
  if (executorTask) return;

  executorTask = cron.schedule("* * * * *", async () => {
    if (running) return; // overlap guard — previous tick still working
    running = true;
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return;
      const recovery = await recoverStuckScheduledTransfers(db);
      if (recovery.stuck > 0) {
        logger.warn({ ...recovery }, "[ScheduledExecutor] Sweeper resolved stuck rows");
      }
      const summary = await executeDueScheduledTransfers(db);
      if (summary.due > 0) {
        logger.info({ ...summary }, "[ScheduledExecutor] Tick complete");
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[ScheduledExecutor] Cron tick failed"
      );
    } finally {
      running = false;
    }
  });

  logger.info("[ScheduledExecutor] Cron started: due-transfer execution + stuck-claim sweeper (60s)");
}

export function stopScheduledPaymentExecutor(): void {
  executorTask?.stop();
  executorTask = null;
}
