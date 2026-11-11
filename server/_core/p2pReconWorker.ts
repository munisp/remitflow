/**
 * RemitFlow — P2P UNCERTAIN Reconciliation Worker (W21 Lane G)
 * ─────────────────────────────────────────────────────────────
 * Cross-border P2P sends (server/routers/p2pInstant.ts) can end with the rail
 * outcome UNCERTAIN: the sender was debited, the Mojaloop transfer MAY have
 * committed, and the row is PARKED in p2p_transfers status='settling' with
 * structured park state in the `metadata` jsonb column
 * (drizzle/0104_p2p_recon.sql — replaces the W10 "RECON:" failure_reason
 * string-marker hack). Nothing else in the platform resolves those rows —
 * this worker drives each parked transfer to a terminal state.
 *
 * Per parked row (every 60s tick, rows parked ≥60s):
 *   1. Reconcile against the switch via getTransferStatus(mojaloopTransferId).
 *   2. COMMITTED → ONE db.transaction: guarded 'settling'→'completed'
 *      transition + sender transactions row + audit row (mirrors the
 *      completion path in p2pInstant.ts sendByAlias).
 *   3. ABORTED  → ONE db.transaction: guarded single-winner
 *      'settling'→'compensated' claim + row-count-checked wallet re-credit +
 *      failed transactions row + audit row, then the TigerBeetle reversal
 *      dual-write (mirrors the ABORTED compensation path in p2pInstant.ts).
 *   4. Still UNCERTAIN / unreachable → increment metadata.reconAttempts.
 *      After MAX_RECON_ATTEMPTS (20) the row is ESCALATED: CRITICAL log +
 *      ops alert (Kafka compliance-alert topic) + audit row, left PARKED,
 *      and retried at a lower frequency (ESCALATED_RETRY_INTERVAL_MS).
 *      A parked row is NEVER auto-refunded and NEVER silently dropped.
 *
 * Guarantees:
 *   - Fail closed: no DB → tick aborts (logged); a rail query failure leaves
 *     the row parked. No silent catches.
 *   - Single-winner: every terminal transition is a guarded UPDATE keyed on
 *     status='settling' inside a transaction — a concurrent completion,
 *     refund, or admin action wins and the worker's claim matches 0 rows.
 *   - Legacy rows parked with the old failure_reason "RECON:" marker are
 *     handled identically (metadata defaults apply).
 *
 * Wiring (orchestrator — server/_core/index.ts is NOT Lane G's file):
 *   import { startP2PReconWorker } from "./p2pReconWorker";
 *   // where other workers start (cf. startPendingDeliveryWorker()):
 *   try { startP2PReconWorker(); } catch (err) { logger.error({ err }, "[P2PRecon] worker start failed"); }
 */
import { hostname } from "node:os";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, insertOutboxEvent } from "../db";
import { auditLogs, transactions } from "../../drizzle/schema";
import { logger } from "./logger";
import { getTransferStatus } from "../mojaloop.service";
import { publishEvent, KAFKA_TOPICS } from "../middleware/kafka";
import { recordTigerBeetleDualWrite } from "./fundFlowHardening";
import { atomicTransfer, compositeAccountId, toMinorUnits, TB_ACCOUNT_CODES, TB_LEDGERS, PLATFORM_SYSTEM_USER_ID } from "./tigerBeetle";
// W23-O: namespace import so the module still compiles while the parallel
// Lane P branch adds the export; the call site below verifies it exists at
// runtime and fails OPEN (loud + outbox) if it does not.
import * as tigerBeetleCore from "./tigerBeetle";

const POLL_INTERVAL_MS = 60_000;
/** A row must be parked at least this long before the first reconciliation. */
const MIN_PARK_AGE_MS = 60_000;
const BATCH_SIZE = 25;
/** Reconciliation attempts before escalation. */
const MAX_RECON_ATTEMPTS = 20;
/** Escalated rows are retried at this lower frequency. */
const ESCALATED_RETRY_INTERVAL_MS = 10 * 60_000;

const WORKER_ID = `p2p-recon-worker@${hostname()}:${process.pid}`;

// ─── Metrics (in-memory; surfaced via getP2PReconWorkerMetrics) ─────────────
const metrics = {
  ticks: 0,
  rowsScanned: 0,
  completed: 0,
  compensated: 0,
  stillUncertain: 0,
  escalated: 0,
  failed: 0,
  tickErrors: 0,
};

export function getP2PReconWorkerMetrics(): Readonly<typeof metrics> {
  return { ...metrics };
}

interface ParkedRow {
  id: number;
  senderId: number;
  sendAmount: string;
  sendCurrency: string;
  receiveAmount: string | null;
  receiveCurrency: string | null;
  fee: string | null;
  rail: string | null;
  mojaloopTransferId: string | null;
  metadata: { parked?: boolean; reconAttempts?: number; escalated?: boolean; lastReconAt?: string | null; reason?: string; tbSuspMoved?: boolean } | null;
  updatedAt: Date;
}

// ─── W23-O: TigerBeetle settlement legs + settlement_journal coverage ───────

/**
 * Deterministic 128-bit TB transfer id for a P2P reference — byte-identical
 * derivation to tbTransferId() in fundFlowHardening.ts (which is private
 * there), so ids are consistent platform-wide and replays dedupe in TB.
 */
function p2pTbTransferId(reference: string): bigint {
  const hex = createHash("sha256").update(`tb:${reference}`).digest("hex").slice(0, 31);
  return BigInt(`0x${hex}`);
}

/**
 * COMMITTED settlement leg: move the parked value OUT of the platform
 * SETTLEMENT pool into the NOSTRO account for the destination currency, so
 * cross-border value actually leaves SETTLEMENT instead of parking forever.
 *
 * recordTigerBeetleDualWrite (fundFlowHardening.ts — not this lane's file)
 * cannot express this leg: it composes BOTH accounts from (userId, code,
 * ledger) and has no raw-account target, and the NOSTRO account is only
 * addressable via Lane P's tbNostroAccountId(currency). This mirrors that
 * helper exactly: deterministic id (replay-safe), NEVER throws (fail-open —
 * PG stays source of truth), loud log + PG outbox event on failure so the
 * reconciliation sweep can repair the missed ledger write.
 *
 * NOTE (single-ledger constraint): one TB transfer cannot span ledgers. Per
 * the W23 plan the leg is posted on the DESTINATION currency ledger; when
 * sendCurrency != receiveCurrency the SETTLEMENT account on that ledger is
 * not the account holding the park and TB will reject it — the failure lands
 * in the outbox and the journal row records posted=false so reconciliation
 * catches it. Same-currency corridors settle cleanly.
 */
export async function recordP2PSettlementToNostro(params: {
  /** Deterministic reference: `P2P_{id}_SETTLE`. */
  reference: string;
  /** Amount in MAJOR units (totalDebit: principal + fee). */
  amount: number;
  /** Destination (receive) currency — selects the NOSTRO account/ledger. */
  currency: string;
  mojaloopTransferId: string | null;
}): Promise<{ posted: boolean; tbTransferId: string }> {
  const { reference, amount, currency, mojaloopTransferId } = params;
  const id = p2pTbTransferId(reference);
  try {
    const ledger = TB_LEDGERS[currency];
    if (!ledger) throw new Error(`unknown TB ledger for currency ${currency}`);
    const tbNostroAccountId = (tigerBeetleCore as unknown as { tbNostroAccountId?: (currency: string) => string | bigint }).tbNostroAccountId;
    if (typeof tbNostroAccountId !== "function") {
      throw new Error("tbNostroAccountId is not exported from server/_core/tigerBeetle.ts yet (parallel Lane P dependency) — settlement leg deferred to reconciliation");
    }
    const fromAccountId = BigInt(compositeAccountId(PLATFORM_SYSTEM_USER_ID, TB_ACCOUNT_CODES.SETTLEMENT, ledger));
    const toAccountId = BigInt(tbNostroAccountId(currency));
    await atomicTransfer({
      id,
      fromAccountId,
      toAccountId,
      amount: toMinorUnits(amount),
      currency,
      code: TB_ACCOUNT_CODES.SETTLEMENT,
    });
    logger.info({ reference, tbTransferId: id.toString(), amount, currency, mojaloopTransferId }, "[TigerBeetle] P2P settlement leg posted: SETTLEMENT → NOSTRO");
    return { posted: true, tbTransferId: id.toString() };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // LOUD, never silent (fail-open for the money path — PG already committed
    // and remains authoritative; the ledger write must be repaired).
    logger.error({ reference, amount, currency, mojaloopTransferId, errMsg }, "[TigerBeetle] P2P settlement leg FAILED — PG committed, funds remain parked in SETTLEMENT; queued for reconciliation");
    try {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable for outbox fallback");
      await insertOutboxEvent(db, {
        aggregateId: reference,
        aggregateType: "tigerbeetle",
        eventType: "dual_write_failed",
        payload: {
          reference,
          leg: "p2p_settlement_out",
          amount,
          currency,
          fromUserId: PLATFORM_SYSTEM_USER_ID,
          fromCode: TB_ACCOUNT_CODES.SETTLEMENT,
          toPool: "NOSTRO",
          mojaloopTransferId,
          error: errMsg,
          failedAt: new Date().toISOString(),
        },
      });
    } catch (outboxErr) {
      logger.error({ reference, err: outboxErr instanceof Error ? outboxErr.message : String(outboxErr) }, "[TigerBeetle] CRITICAL: P2P settlement-leg outbox fallback ALSO failed — manual reconciliation required");
    }
    return { posted: false, tbTransferId: id.toString() };
  }
}

/**
 * settlement_journal coverage for cross-border P2P (drizzle/0084): the row is
 * inserted as 'debited' by the router in the SAME transaction as the wallet
 * debit; terminal paths move it to 'posted' (+ the TB leg id in
 * tb_pending_id) / 'refunded' / 'reconcile_required'. Never throws — the PG
 * money transition already committed; a journal update failure is logged
 * LOUDLY and leaves the row in 'debited', which the reconciliation sweep
 * (settlement_journal_status_idx) picks up.
 */
export async function updateP2PSettlementJournal(
  db: any,
  p2pTransferId: number,
  status: "posted" | "refunded" | "reconcile_required" | "post_failed",
  tbLegTransferId?: string,
): Promise<void> {
  const journalId = `P2P_${p2pTransferId}`;
  try {
    await db.execute(sql`
      UPDATE settlement_journal
      SET status = ${status},
          tb_pending_id = COALESCE(${tbLegTransferId ?? null}, tb_pending_id),
          updated_at = NOW()
      WHERE transfer_id = ${journalId}
    `);
  } catch (err) {
    logger.error({ err, p2pTransferId, journalId, status }, "[P2P] settlement_journal update FAILED — journal left in prior state for the reconciliation sweep");
  }
}

/** Persist the TB settlement-leg reference on the transfer row (0107 column). */
async function setP2PTbSettlementRef(db: any, p2pTransferId: number, reference: string): Promise<void> {
  try {
    await db.execute(sql`UPDATE p2p_transfers SET tb_settlement_ref = ${reference} WHERE id = ${p2pTransferId}`);
  } catch (err) {
    logger.error({ err, p2pTransferId, reference }, "[P2P] tb_settlement_ref update FAILED — reference recoverable from settlement_journal");
  }
}

/**
 * COMMITTED: guarded completion — mirrors the COMMITTED branch in
 * p2pInstant.ts sendByAlias (status update + sender transactions row),
 * plus an audit row, atomically.
 */
async function completeParked(db: any, row: ParkedRow, mojaloopTransferId: string): Promise<boolean> {
  const totalDebit = Number(row.sendAmount) + Number(row.fee ?? 0);
  const receiveAmount = Number(row.receiveAmount ?? 0);
  const won = await db.transaction(async (tx: any) => {
    const claim = (await tx.execute(sql`
      UPDATE p2p_transfers
      SET status = 'completed', completed_at = NOW(),
          mojaloop_transfer_id = ${mojaloopTransferId},
          metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ parked: false, resolvedBy: WORKER_ID, resolvedAt: new Date().toISOString(), railFinalState: "COMMITTED" })}::jsonb,
          updated_at = NOW()
      WHERE id = ${row.id} AND status = 'settling'
      RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (claim.length === 0) return false; // another path resolved it — never clobber

    await tx.insert(transactions).values({
      userId: row.senderId, type: "send", status: "completed",
      fromCurrency: row.sendCurrency, fromAmount: totalDebit.toFixed(2),
      toCurrency: row.receiveCurrency ?? row.sendCurrency, toAmount: receiveAmount.toFixed(2),
      fee: Number(row.fee ?? 0).toFixed(2), reference: `P2P_${row.id}_SEND`,
      description: `P2P cross-border via ${row.rail ?? "rail"} — completed after rail reconciliation`,
      metadata: { p2pTransferId: row.id, rail: row.rail, mojaloopTransferId, leg: "sender_debit", reconciled: true, sendAmount: Number(row.sendAmount).toFixed(2), sendCurrency: row.sendCurrency },
    } as any);

    await tx.insert(auditLogs).values({
      userId: row.senderId,
      action: "P2P_RECON_COMPLETED",
      description: `Parked cross-border P2P transfer ${row.id} confirmed COMMITTED by the rail — marked completed (${row.sendAmount} ${row.sendCurrency})`,
      severity: "info" as any,
      targetType: "p2p_transfer",
      metadata: { p2pTransferId: row.id, mojaloopTransferId, workerId: WORKER_ID },
    });
    return true;
  });

  if (won) {
    // W23-O: the rail COMMITTED — the parked value must actually LEAVE the
    // platform SETTLEMENT pool. Post the settlement leg SETTLEMENT → NOSTRO
    // (destination currency) with a deterministic id (`P2P_{id}_SETTLE` →
    // replay-safe in TB) and mojaloopTransferId carried in the outbox/journal
    // evidence. Fail-open: on failure the journal row records posted=false
    // ('post_failed') so reconciliation catches the miss.
    const settleRef = `P2P_${row.id}_SETTLE`;
    const leg = await recordP2PSettlementToNostro({
      reference: settleRef,
      amount: totalDebit,
      currency: row.receiveCurrency ?? row.sendCurrency,
      mojaloopTransferId,
    });
    await setP2PTbSettlementRef(db, row.id, settleRef);
    await updateP2PSettlementJournal(db, row.id, leg.posted ? "posted" : "post_failed", leg.tbTransferId);
  }
  return won;
}

/**
 * ABORTED: guarded single-winner compensation — mirrors the ABORTED branch in
 * p2pInstant.ts sendByAlias (claim → row-count-checked wallet credit → failed
 * transactions row), plus an audit row, atomically; then the TigerBeetle
 * reversal dual-write (fail-open, outbox-backed, same as the router path).
 */
async function compensateParked(db: any, row: ParkedRow, mojaloopTransferId: string | null, reason: string): Promise<boolean> {
  const totalDebit = Number(row.sendAmount) + Number(row.fee ?? 0);
  const receiveAmount = Number(row.receiveAmount ?? 0);
  const won = await db.transaction(async (tx: any) => {
    const claim = (await tx.execute(sql`
      UPDATE p2p_transfers
      SET status = 'compensated', failed_at = NOW(),
          failure_reason = ${reason.slice(0, 500)},
          mojaloop_transfer_id = COALESCE(${mojaloopTransferId}, mojaloop_transfer_id),
          metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ parked: false, resolvedBy: WORKER_ID, resolvedAt: new Date().toISOString(), railFinalState: "ABORTED" })}::jsonb,
          updated_at = NOW()
      WHERE id = ${row.id} AND status = 'settling'
      RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (claim.length === 0) return false;

    const credit = (await tx.execute(sql`
      UPDATE wallets SET balance = balance + ${totalDebit.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
      WHERE "userId" = ${row.senderId} AND currency = ${row.sendCurrency} AND status = 'active'
      RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (credit.length === 0) {
      // Roll back BOTH the claim and the credit attempt: never mark a
      // transfer 'compensated' without the money actually returning.
      throw new Error("Compensation credit failed — sender wallet unavailable; left parked for retry");
    }

    await tx.insert(transactions).values({
      userId: row.senderId, type: "send", status: "failed",
      fromCurrency: row.sendCurrency, fromAmount: totalDebit.toFixed(2),
      toCurrency: row.receiveCurrency ?? row.sendCurrency, toAmount: receiveAmount.toFixed(2),
      fee: Number(row.fee ?? 0).toFixed(2), reference: `P2P_${row.id}_SEND`,
      description: `P2P cross-border via ${row.rail ?? "rail"} — FAILED (sender compensated after rail reconciliation)`,
      metadata: { p2pTransferId: row.id, rail: row.rail, mojaloopTransferId, leg: "sender_debit", compensated: true, reconciled: true, sendAmount: Number(row.sendAmount).toFixed(2), sendCurrency: row.sendCurrency },
    } as any);

    await tx.insert(auditLogs).values({
      userId: row.senderId,
      action: "P2P_RECON_COMPENSATED",
      description: `Parked cross-border P2P transfer ${row.id} confirmed ABORTED by the rail — ${totalDebit.toFixed(2)} ${row.sendCurrency} re-credited to sender (${reason})`,
      severity: "warning" as any,
      targetType: "p2p_transfer",
      metadata: { p2pTransferId: row.id, mojaloopTransferId, amount: totalDebit, currency: row.sendCurrency, reason, workerId: WORKER_ID },
    });
    return true;
  });

  if (won) {
    // TigerBeetle reversal of the settlement park (mirrors the router's
    // ABORTED path; deterministic id → idempotent; fail-open w/ outbox).
    await recordTigerBeetleDualWrite({ reference: `P2P_${row.id}_COMP`, fromCode: TB_ACCOUNT_CODES.SETTLEMENT, toUserId: row.senderId, toCode: TB_ACCOUNT_CODES.USER_WALLET, amount: totalDebit, currency: row.sendCurrency });
    // W23-O: settlement_journal coverage — the parked debit was refunded.
    await updateP2PSettlementJournal(db, row.id, "refunded");
    // Honest user notification — the sender was told "reconciliation in
    // progress"; now they get the truth.
    await publishEvent(KAFKA_TOPICS.NOTIFICATIONS, String(row.senderId), {
      userId: row.senderId, type: "p2p_sent",
      title: "Payment Failed",
      message: `Your payment of ${row.sendCurrency} ${Number(row.sendAmount).toLocaleString()} could not be completed — funds were returned to your wallet.`,
      timestamp: new Date().toISOString(),
    });
  }
  return won;
}

/** Escalate a row that has stayed UNCERTAIN past MAX_RECON_ATTEMPTS. */
async function escalate(db: any, row: ParkedRow, reason: string): Promise<void> {
  metrics.escalated += 1;
  logger.error(
    { transferId: row.id, senderId: row.senderId, amount: row.sendAmount, currency: row.sendCurrency, mojaloopTransferId: row.mojaloopTransferId, attempts: row.metadata?.reconAttempts ?? 0, reason },
    "[P2PRecon] CRITICAL: parked cross-border transfer UNRESOLVED after max reconciliation attempts — funds remain debited; OPS ACTION REQUIRED; row stays parked and keeps retrying at reduced frequency",
  );
  // W23-O: segregate the parked value in TB — move SETTLEMENT → SUSPENSE so
  // the unresolved amount is visibly isolated for ops. Check-before-act via
  // metadata.tbSuspMoved (the deterministic TB id `P2P_{id}_SUSP` also makes
  // any retry a no-op in TigerBeetle). Fail-open via the dual-write helper
  // (outbox on failure); the journal row goes 'reconcile_required' either way.
  const totalDebit = Number(row.sendAmount) + Number(row.fee ?? 0);
  const alreadyMoved = row.metadata?.tbSuspMoved === true;
  if (!alreadyMoved) {
    await recordTigerBeetleDualWrite({
      reference: `P2P_${row.id}_SUSP`,
      fromCode: TB_ACCOUNT_CODES.SETTLEMENT,
      toCode: TB_ACCOUNT_CODES.SUSPENSE,
      amount: totalDebit,
      currency: row.sendCurrency,
    });
  }
  await db.transaction(async (tx: any) => {
    await tx.execute(sql`
      UPDATE p2p_transfers
      SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ escalated: true, escalatedAt: new Date().toISOString(), ...(alreadyMoved ? {} : { tbSuspMoved: true, tbSuspRef: `P2P_${row.id}_SUSP` }) })}::jsonb,
          updated_at = updated_at
      WHERE id = ${row.id} AND status = 'settling'
    `);
    await tx.insert(auditLogs).values({
      userId: row.senderId,
      action: "P2P_RECON_ESCALATED",
      description: `Parked cross-border P2P transfer ${row.id} still UNCERTAIN after ${MAX_RECON_ATTEMPTS} reconciliation attempts — escalated to ops (${row.sendAmount} ${row.sendCurrency})`,
      severity: "critical" as any,
      targetType: "p2p_transfer",
      metadata: { p2pTransferId: row.id, mojaloopTransferId: row.mojaloopTransferId, amount: row.sendAmount, currency: row.sendCurrency, reason, workerId: WORKER_ID },
    });
  });
  await publishEvent(KAFKA_TOPICS.COMPLIANCE_ALERT, `p2p_recon:${row.id}`, {
    alertType: "P2P_RECON_UNRESOLVED",
    p2pTransferId: row.id,
    senderId: row.senderId,
    amount: row.sendAmount,
    currency: row.sendCurrency,
    mojaloopTransferId: row.mojaloopTransferId,
    attempts: row.metadata?.reconAttempts ?? 0,
    reason,
    timestamp: new Date().toISOString(),
  }).catch((err: any) => logger.error({ err, transferId: row.id }, "[P2PRecon] Escalation alert publish failed (row still escalated in DB + audit log)"));
  // W23-O: journal coverage — an escalated row needs manual reconciliation.
  await updateP2PSettlementJournal(db, row.id, "reconcile_required");
}

async function processRow(db: any, row: ParkedRow): Promise<void> {
  const attempts = row.metadata?.reconAttempts ?? 0;
  const escalated = row.metadata?.escalated === true;
  // Escalated rows retry at a lower frequency.
  if (escalated && row.metadata?.lastReconAt && Date.now() - new Date(row.metadata.lastReconAt).getTime() < ESCALATED_RETRY_INTERVAL_MS) {
    return;
  }
  if (!row.mojaloopTransferId) {
    // Cannot reconcile without a rail reference — count the attempt; the
    // escalation path (below) surfaces rows stuck this way to ops.
    logger.warn({ transferId: row.id }, "[P2PRecon] Parked row has no mojaloop_transfer_id — cannot query rail; attempt counted");
    await recordAttempt(db, row.id, attempts, "no mojaloop_transfer_id");
    if (attempts + 1 >= MAX_RECON_ATTEMPTS && !escalated) await escalate(db, row, "no mojaloop_transfer_id");
    return;
  }

  let recon;
  try {
    recon = await getTransferStatus(row.mojaloopTransferId);
  } catch (err: any) {
    // Rail unreachable: leave parked, count the attempt, never silent.
    metrics.stillUncertain += 1;
    logger.warn({ err: err?.message, transferId: row.id }, "[P2PRecon] Rail status query failed — row stays parked");
    await recordAttempt(db, row.id, attempts, err?.message ?? "status query failed");
    if (attempts + 1 >= MAX_RECON_ATTEMPTS && !escalated) await escalate(db, row, "rail status query repeatedly failing");
    return;
  }

  if (recon.transferState === "COMMITTED") {
    const done = await completeParked(db, row, recon.transferId);
    if (done) {
      metrics.completed += 1;
      logger.info({ transferId: row.id, mojaloopTransferId: recon.transferId }, "[P2PRecon] Parked transfer confirmed COMMITTED — marked completed");
    }
    return;
  }
  if (recon.transferState === "ABORTED") {
    const reason = recon.errorInformation?.errorDescription ?? "Transfer aborted by rail";
    const won = await compensateParked(db, row, recon.transferId, reason);
    if (won) {
      metrics.compensated += 1;
      logger.info({ transferId: row.id, mojaloopTransferId: recon.transferId }, "[P2PRecon] Parked transfer confirmed ABORTED — sender compensated");
    }
    return;
  }
  // Still UNCERTAIN / RESERVED / RECEIVED: stay parked, count the attempt.
  metrics.stillUncertain += 1;
  await recordAttempt(db, row.id, attempts, `rail state ${recon.transferState}`);
  if (attempts + 1 >= MAX_RECON_ATTEMPTS && !escalated) await escalate(db, row, `rail state stuck at ${recon.transferState}`);
}

async function recordAttempt(db: any, id: number, attempts: number, lastError: string): Promise<void> {
  await db.execute(sql`
    UPDATE p2p_transfers
    SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ reconAttempts: attempts + 1, lastReconAt: new Date().toISOString(), lastReconError: lastError.slice(0, 300) })}::jsonb,
        updated_at = updated_at
    WHERE id = ${id} AND status = 'settling'
  `);
}

async function processBatch(): Promise<void> {
  metrics.ticks += 1;
  const db = await getDb();
  if (!db) {
    // Fail closed: without the DB we cannot claim, complete, refund, or
    // audit — abort the tick (logged + counted) rather than skipping silently.
    metrics.tickErrors += 1;
    logger.error("[P2PRecon] Database unavailable — tick aborted, rows remain parked (fail closed)");
    return;
  }
  const rows = (await db.execute(sql`
    SELECT id, sender_id AS "senderId", send_amount AS "sendAmount", send_currency AS "sendCurrency",
           receive_amount AS "receiveAmount", receive_currency AS "receiveCurrency",
           fee, rail::text AS rail, mojaloop_transfer_id AS "mojaloopTransferId",
           metadata, updated_at AS "updatedAt"
    FROM p2p_transfers
    WHERE status = 'settling'
      AND updated_at < NOW() - (${MIN_PARK_AGE_MS} || ' milliseconds')::interval
    ORDER BY id
    LIMIT ${BATCH_SIZE}
  `)) as unknown as ParkedRow[];
  metrics.rowsScanned += rows.length;
  for (const row of rows) {
    try {
      await processRow(db, row);
    } catch (err) {
      // Per-row failure: logged + counted, row stays parked for the next
      // tick; the batch continues. Never silent.
      metrics.failed += 1;
      logger.error({ err, transferId: row.id }, "[P2PRecon] Row processing failed — will retry next tick");
    }
  }
}

// ─── Worker Lifecycle ─────────────────────────────────────────────────────────
let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;

export function startP2PReconWorker(): void {
  if (isRunning) return;
  isRunning = true;
  logger.info({ workerId: WORKER_ID, pollIntervalMs: POLL_INTERVAL_MS, minParkAgeMs: MIN_PARK_AGE_MS, maxAttempts: MAX_RECON_ATTEMPTS }, "[P2PRecon] Worker started");

  const tick = async () => {
    if (!isRunning) return;
    try {
      await processBatch();
    } catch (err) {
      metrics.tickErrors += 1;
      logger.error({ err }, "[P2PRecon] Worker tick failed");
    } finally {
      if (isRunning) {
        pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    }
  };

  pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
}

export function stopP2PReconWorker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info("[P2PRecon] Worker stopped");
}
