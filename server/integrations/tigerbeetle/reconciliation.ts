/**
 * RemitFlow — TigerBeetle Reconciliation Engine
 * ══════════════════════════════════════════════════════════════════════════════
 * Implements double-entry bookkeeping reconciliation between:
 *   - TigerBeetle ledger (source of truth for balances)
 *   - PostgreSQL p2p_transfers table (application-layer records)
 *   - Mojaloop settlement outcomes (external settlement layer)
 *
 * Reconciliation types:
 *   1. Account balance reconciliation (TB vs PostgreSQL)
 *   2. Transfer-level reconciliation (p2p_transfers vs TB settlement evidence)
 *   3. Settlement reconciliation (Mojaloop terminal states vs TB legs)
 *   4. Currency position reconciliation (nostro/vostro accounts)
 *
 * W23 Lane P revival: this module was dead code reading a non-existent
 * `transfers` table with a stubbed nostro check. It now reads p2p_transfers,
 * performs a real nostro balance comparison against a configured expectation
 * (honest "unconfigured" when none exists), and cross-checks Mojaloop terminal
 * outcomes (COMMITTED/ABORTED) against TigerBeetle settlement-leg evidence
 * (settlement_journal rows with tb references + tigerbeetle outbox events).
 *
 * Runs daily via server/lib/reconciliationScheduler.ts (alongside
 * ledger-sync.reconcileBalances) and on-demand.
 */

import { logger } from "../../_core/logger";
import { TRPCError } from "@trpc/server";
import { getDb } from "../../db";
import { sql } from "drizzle-orm";
import {
  getAccountBalance,
  tbNostroAccountId,
  TB_LEDGERS,
} from "../../_core/tigerBeetle";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReconciliationResult {
  runId: string;
  startedAt: Date;
  completedAt: Date;
  type: "account" | "transfer" | "settlement" | "currency_position" | "mojaloop_settlement";
  status: "clean" | "discrepancies_found" | "error";
  totalChecked: number;
  discrepancies: ReconciliationDiscrepancy[];
  summary: string;
}

export interface ReconciliationDiscrepancy {
  entityType: "account" | "transfer" | "settlement";
  entityId: string;
  field: string;
  expectedValue: string | number;
  actualValue: string | number;
  currency: string;
  severity: "low" | "medium" | "high" | "critical";
  autoResolved: boolean;
  resolutionNote?: string;
}

export interface AccountPosition {
  accountId: string;
  userId: number;
  currency: string;
  tbBalance: bigint;
  dbBalance: bigint;
  difference: bigint;
  lastReconciled: Date;
}

// ── Reconciliation Run ID ─────────────────────────────────────────────────────

function generateRunId(): string {
  return `RECON-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

// ── Account Balance Reconciliation ───────────────────────────────────────────

export async function reconcileAccountBalances(
  userIds?: number[]
): Promise<ReconciliationResult> {
  const runId = generateRunId();
  const startedAt = new Date();
  const discrepancies: ReconciliationDiscrepancy[] = [];

  logger.info({ runId, userIds: userIds?.length ?? "all" }, "[Reconciliation] Starting account balance reconciliation");

  const db = await getDb();
  if (!db) {
    return {
      runId,
      startedAt,
      completedAt: new Date(),
      type: "account",
      status: "error",
      totalChecked: 0,
      discrepancies: [],
      summary: "Database unavailable",
    };
  }

  try {
    // Fetch users with TigerBeetle accounts
    const userFilter = userIds && userIds.length > 0
      ? sql`WHERE id = ANY(${userIds})`
      : sql`WHERE tigerbeetle_wallet_account IS NOT NULL`;

    const users = await (db as any).execute(sql`
      SELECT id, tigerbeetle_wallet_account, tigerbeetle_escrow_account, tigerbeetle_fee_account
      FROM users
      ${userFilter}
      LIMIT 1000
    `);

    let totalChecked = 0;

    for (const user of users) {
      totalChecked++;

      // Get PostgreSQL balance from wallet_balances or computed from transfers
      let dbBalanceResult: any[];
      try {
        dbBalanceResult = await (db as any).execute(sql`
          SELECT
            currency,
            COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) as balance
          FROM wallet_transactions
          WHERE user_id = ${user.id}
          GROUP BY currency
        `);
      } catch (err) {
        // Never silent: a failed balance read makes this user's check unknown.
        logger.warn({ runId, userId: user.id, err: err instanceof Error ? err.message : String(err) }, "[Reconciliation] wallet_transactions read failed — skipping user (loud)");
        continue;
      }

      // Fetch TigerBeetle balance via bridge
      const tbBalance = await fetchTigerBeetleBalance(user.tigerbeetle_wallet_account);

      for (const dbRow of dbBalanceResult) {
        const dbBal = BigInt(Math.round(Number(dbRow.balance) * 100)); // cents
        const tbBal = tbBalance[dbRow.currency] ?? 0n;
        const diff = tbBal - dbBal;

        if (diff !== 0n) {
          const severity = Math.abs(Number(diff)) > 10000
            ? "critical"
            : Math.abs(Number(diff)) > 1000
            ? "high"
            : Math.abs(Number(diff)) > 100
            ? "medium"
            : "low";

          discrepancies.push({
            entityType: "account",
            entityId: String(user.id),
            field: "balance",
            expectedValue: String(dbBal),
            actualValue: String(tbBal),
            currency: dbRow.currency,
            severity,
            autoResolved: false,
          });

          logger.warn(
            { runId, userId: user.id, currency: dbRow.currency, diff: String(diff), severity },
            "[Reconciliation] Balance discrepancy detected"
          );
        }
      }
    }

    const status = discrepancies.length === 0 ? "clean" : "discrepancies_found";
    const completedAt = new Date();

    // Persist reconciliation run
    await persistReconciliationRun(db, runId, "account", status, totalChecked, discrepancies, startedAt, completedAt);

    logger.info(
      { runId, totalChecked, discrepancies: discrepancies.length, status },
      "[Reconciliation] Account balance reconciliation complete"
    );

    return {
      runId,
      startedAt,
      completedAt,
      type: "account",
      status,
      totalChecked,
      discrepancies,
      summary: `Checked ${totalChecked} accounts. Found ${discrepancies.length} discrepancies.`,
    };
  } catch (err) {
    logger.error({ runId, err }, "[Reconciliation] Account reconciliation failed");
    return {
      runId,
      startedAt,
      completedAt: new Date(),
      type: "account",
      status: "error",
      totalChecked: 0,
      discrepancies: [],
      summary: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Transfer-Level Reconciliation ────────────────────────────────────────────
// W23 Lane P: reads the REAL transfer table (p2p_transfers — the old code read
// a non-existent `transfers` table). The TigerBeetle bridge exposes no
// transfer-lookup endpoint, so "evidence of the TB posting" is checked on the
// PG side of the dual-write:
//   - settlement_journal rows (drizzle/0084) keyed `P2P_{id}` with a tb
//     reference in tb_pending_id and a terminal status (posted/refunded/voided);
//   - UNRESOLVED tigerbeetle outbox events (dual_write_failed still pending)
//     referencing P2P_{id}_SEND / _COMP / _SETTLE — a ledger write that failed
//     and has not been repaired yet.

const P2P_TERMINAL_STATUSES = ["completed", "compensated"] as const;

export async function reconcileTransfers(
  since?: Date
): Promise<ReconciliationResult> {
  const runId = generateRunId();
  const startedAt = new Date();
  const discrepancies: ReconciliationDiscrepancy[] = [];

  const db = await getDb();
  if (!db) {
    return {
      runId, startedAt, completedAt: new Date(),
      type: "transfer", status: "error",
      totalChecked: 0, discrepancies: [],
      summary: "Database unavailable",
    };
  }

  try {
    const cutoff = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h

    // Fetch terminal p2p transfers from PostgreSQL. A failed read fails the
    // run loudly (outer catch → status "error") — never silently zero-checked.
    const transfers = (await (db as any).execute(sql`
      SELECT id, send_amount, send_currency, receive_currency, status, rail::text AS rail,
             mojaloop_transfer_id, created_at
      FROM p2p_transfers
      WHERE created_at >= ${cutoff}
        AND status IN ('completed', 'compensated')
      ORDER BY id
      LIMIT 5000
    `)) as unknown as Array<{
      id: number; send_amount: string; send_currency: string; receive_currency: string | null;
      status: string; rail: string | null; mojaloop_transfer_id: string | null;
      created_at: Date;
    }>;

    let totalChecked = 0;

    for (const transfer of transfers) {
      totalChecked++;

      // 1. Unrepaired dual-write failures for any of this transfer's legs.
      const pendingOutbox = (await (db as any).execute(sql`
        SELECT aggregate_id, event_type, created_at FROM outbox_events
        WHERE aggregate_type = 'tigerbeetle'
          AND event_type = 'dual_write_failed'
          AND status IN ('pending', 'failed')
          AND position(${`P2P_${transfer.id}_`} in payload) > 0
        LIMIT 10
      `)) as unknown as Array<{ aggregate_id: string; event_type: string; created_at: Date }>;

      for (const ev of pendingOutbox) {
        discrepancies.push({
          entityType: "transfer",
          entityId: String(transfer.id),
          field: "tigerbeetle_dual_write",
          expectedValue: "posted",
          actualValue: `dual_write_failed (unrepaired, ref ${ev.aggregate_id})`,
          currency: transfer.send_currency,
          severity: "high",
          autoResolved: false,
          resolutionNote: "TigerBeetle leg failed and the outbox repair event is still unpublished — replay the outbox event",
        });
      }

      // 2. Cross-border (rail) transfers: a settlement leg must be evidenced
      //    in the settlement_journal once the transfer is terminal.
      if (transfer.rail && transfer.rail !== "internal") {
        const journal = (await (db as any).execute(sql`
          SELECT status, tb_pending_id FROM settlement_journal
          WHERE transfer_id = ${`P2P_${transfer.id}`}
          LIMIT 1
        `)) as unknown as Array<{ status: string; tb_pending_id: string | null }>;

        const row = journal[0];
        const expectedStatus = transfer.status === "completed" ? "posted" : "refunded";
        if (!row) {
          discrepancies.push({
            entityType: "transfer",
            entityId: String(transfer.id),
            field: "settlement_journal",
            expectedValue: expectedStatus,
            actualValue: "NO_JOURNAL_ROW",
            currency: transfer.send_currency,
            severity: "high",
            autoResolved: false,
            resolutionNote: `Terminal cross-border p2p transfer (${transfer.status}) has no settlement_journal row — TB settlement leg cannot be evidenced`,
          });
        } else if (transfer.status === "completed" && row.status !== "posted") {
          discrepancies.push({
            entityType: "transfer",
            entityId: String(transfer.id),
            field: "settlement_journal",
            expectedValue: "posted",
            actualValue: row.status,
            currency: transfer.send_currency,
            severity: row.status === "reconcile_required" || row.status === "post_failed" ? "high" : "medium",
            autoResolved: false,
            resolutionNote: `Completed transfer but settlement journal is '${row.status}' — TB settlement leg not confirmed posted`,
          });
        } else if (transfer.status === "compensated" && row.status !== "refunded" && row.status !== "voided") {
          discrepancies.push({
            entityType: "transfer",
            entityId: String(transfer.id),
            field: "settlement_journal",
            expectedValue: "refunded|voided",
            actualValue: row.status,
            currency: transfer.send_currency,
            severity: "high",
            autoResolved: false,
            resolutionNote: "Compensated transfer but settlement journal shows no reversal — TB reversal leg may be missing",
          });
        }
      }
      // Internal-rail transfers have no settlement_journal coverage — the
      // pending dual-write check above is their only TB evidence.
    }

    const status = discrepancies.length === 0 ? "clean" : "discrepancies_found";
    const completedAt = new Date();
    await persistReconciliationRun(db, runId, "transfer", status, totalChecked, discrepancies, startedAt, completedAt);

    logger.info(
      { runId, totalChecked, discrepancies: discrepancies.length, status },
      "[Reconciliation] Transfer reconciliation complete"
    );

    return {
      runId, startedAt, completedAt: new Date(),
      type: "transfer", status, totalChecked, discrepancies,
      summary: `Checked ${totalChecked} p2p_transfers. Found ${discrepancies.length} discrepancies.`,
    };
  } catch (err) {
    logger.error({ runId, err }, "[Reconciliation] Transfer reconciliation failed");
    return {
      runId, startedAt, completedAt: new Date(),
      type: "transfer", status: "error",
      totalChecked: 0, discrepancies: [],
      summary: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Currency Position Reconciliation ─────────────────────────────────────────
// W23 Lane P: REAL nostro check (the old `nostroBalance < expectedMinBalance * 0n`
// stub was always false). The nostro balance is read from the actual TigerBeetle
// NOSTRO account (tbNostroAccountId) and compared against the configured
// minimum expected position for that currency. Expectation source (first hit
// wins):
//   1. NOSTRO_MIN_BALANCES — JSON object, minor units: {"USD":"1000000",...}
//   2. NOSTRO_MIN_BALANCE_<CCY> — single-currency minor-units override
// With NO expectation source the check is honestly reported as UNCONFIGURED
// in the run summary (never a fake pass, never a fake comparison).

function configuredNostroMinimum(currency: string): bigint | null {
  const perCurrency = process.env[`NOSTRO_MIN_BALANCE_${currency}`];
  if (perCurrency) return BigInt(perCurrency);
  const json = process.env.NOSTRO_MIN_BALANCES;
  if (json) {
    try {
      const parsed = JSON.parse(json) as Record<string, string | number>;
      if (parsed[currency] !== undefined) return BigInt(parsed[currency]);
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "[Reconciliation] NOSTRO_MIN_BALANCES is not valid JSON — treating as unconfigured");
    }
  }
  return null;
}

export async function reconcileCurrencyPositions(): Promise<ReconciliationResult> {
  const runId = generateRunId();
  const startedAt = new Date();
  const discrepancies: ReconciliationDiscrepancy[] = [];

  const db = await getDb();
  if (!db) {
    return {
      runId, startedAt, completedAt: new Date(),
      type: "currency_position", status: "error",
      totalChecked: 0, discrepancies: [],
      summary: "Database unavailable",
    };
  }

  try {
    // Net sent volume per currency from the REAL table (p2p_transfers), last 24h.
    const positions = (await (db as any).execute(sql`
      SELECT
        send_currency as currency,
        SUM(CASE WHEN status = 'completed' THEN send_amount ELSE 0 END) as total_sent,
        COUNT(*) as transfer_count
      FROM p2p_transfers
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY send_currency
    `)) as unknown as Array<{ currency: string; total_sent: string; transfer_count: string }>;

    // Every currency with a TB ledger gets a nostro check when configured,
    // even without recent volume (a drained nostro matters at zero volume).
    const currencies = [...new Set([...positions.map(p => p.currency), ...Object.keys(TB_LEDGERS)])];
    const unconfigured: string[] = [];
    let totalChecked = 0;

    for (const currency of currencies) {
      const expectedMinBalance = configuredNostroMinimum(currency);
      if (expectedMinBalance === null) {
        unconfigured.push(currency);
        continue; // honest: no expectation source — nothing to compare against
      }
      totalChecked++;

      let nostroBalance: bigint;
      try {
        const bal = await getAccountBalance(BigInt(tbNostroAccountId(currency)));
        nostroBalance = bal.balance;
      } catch (err) {
        // Bridge/account read failed — the position is UNKNOWN, which is
        // itself a reportable condition (never silently skipped).
        logger.error({ runId, currency, err: err instanceof Error ? err.message : String(err) }, "[Reconciliation] Nostro balance read failed");
        discrepancies.push({
          entityType: "settlement",
          entityId: `nostro-${currency}`,
          field: "nostro_balance",
          expectedValue: `>= ${expectedMinBalance}`,
          actualValue: "UNREADABLE",
          currency,
          severity: "high",
          autoResolved: false,
          resolutionNote: "TigerBeetle nostro account balance could not be read — verify bridge health and provisioning",
        });
        continue;
      }

      if (nostroBalance < expectedMinBalance) {
        discrepancies.push({
          entityType: "settlement",
          entityId: `nostro-${currency}`,
          field: "nostro_balance",
          expectedValue: `>= ${expectedMinBalance}`,
          actualValue: String(nostroBalance),
          currency,
          severity: "high",
          autoResolved: false,
          resolutionNote: "Nostro account below configured minimum — funding required",
        });
        logger.warn({ runId, currency, nostroBalance: String(nostroBalance), expectedMinBalance: String(expectedMinBalance) }, "[Reconciliation] Nostro position below minimum");
      }
    }

    if (unconfigured.length > 0) {
      logger.warn({ runId, unconfigured }, "[Reconciliation] No nostro minimum configured for these currencies — check skipped honestly (set NOSTRO_MIN_BALANCES or NOSTRO_MIN_BALANCE_<CCY>)");
    }

    const status = discrepancies.length === 0 ? "clean" : "discrepancies_found";
    const completedAt = new Date();
    await persistReconciliationRun(db, runId, "currency_position", status, totalChecked, discrepancies, startedAt, completedAt);

    return {
      runId, startedAt, completedAt: new Date(),
      type: "currency_position", status, totalChecked, discrepancies,
      summary: `Checked ${totalChecked} nostro positions (${unconfigured.length} currencies unconfigured). Found ${discrepancies.length} discrepancies.${unconfigured.length > 0 ? ` Unconfigured: ${unconfigured.join(",")}` : ""}`,
    };
  } catch (err) {
    logger.error({ runId, err }, "[Reconciliation] Currency position reconciliation failed");
    return {
      runId, startedAt, completedAt: new Date(),
      type: "currency_position", status: "error",
      totalChecked: 0, discrepancies: [],
      summary: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Mojaloop ↔ TigerBeetle Settlement Reconciliation ─────────────────────────
// W23 Lane P: joins mojaloop_transfers terminal states (COMMITTED/ABORTED)
// against evidence of the corresponding TigerBeetle settlement legs:
//   - settlement_journal rows with tb references (tb_pending_id), linked via
//     p2p_transfers.mojaloop_transfer_id (journal id `P2P_{id}`), via
//     transactions.metadata->>'partnerReference' (journal id = tx reference),
//     or keyed directly by the Mojaloop transfer id;
//   - tigerbeetle outbox events whose payload references the transfer id
//     (dual_write_failed = leg failed but repair is queued;
//      mojaloop_terminal_state = durable terminal-state evidence, W23 webhook).
// Flags: COMMITTED without a posted settlement leg → HIGH; ABORTED without a
// reversal (journal refunded/voided or a compensation leg reference) → HIGH.

export async function reconcileMojaloopVsTigerBeetle(
  since?: Date,
): Promise<ReconciliationResult> {
  const runId = generateRunId();
  const startedAt = new Date();
  const discrepancies: ReconciliationDiscrepancy[] = [];

  logger.info({ runId }, "[Reconciliation] Starting Mojaloop↔TigerBeetle settlement reconciliation");

  const db = await getDb();
  if (!db) {
    return {
      runId, startedAt, completedAt: new Date(),
      type: "mojaloop_settlement", status: "error",
      totalChecked: 0, discrepancies: [],
      summary: "Database unavailable",
    };
  }

  try {
    const cutoff = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

    const terminal = (await (db as any).execute(sql`
      SELECT transfer_id, status, currency, amount, completed_at
      FROM mojaloop_transfers
      WHERE status IN ('COMMITTED', 'ABORTED')
        AND COALESCE(completed_at, created_at) >= ${cutoff}
      ORDER BY id
      LIMIT 5000
    `)) as unknown as Array<{ transfer_id: string; status: string; currency: string; amount: string; completed_at: Date | null }>;

    let totalChecked = 0;

    for (const mt of terminal) {
      if (!mt.transfer_id) continue;
      totalChecked++;
      const transferId = mt.transfer_id;

      // Settlement journal evidence linked through every known join path.
      const journalRows = (await (db as any).execute(sql`
        SELECT sj.transfer_id, sj.status, sj.tb_pending_id
        FROM settlement_journal sj
        WHERE sj.transfer_id IN (
          SELECT 'P2P_' || p.id::text FROM p2p_transfers p WHERE p.mojaloop_transfer_id = ${transferId}
          UNION
          SELECT t.reference FROM transactions t WHERE t.metadata->>'partnerReference' = ${transferId}
          UNION
          SELECT ${transferId}
        )
      `)) as unknown as Array<{ transfer_id: string; status: string; tb_pending_id: string | null }>;

      // Outbox evidence: any tigerbeetle event mentioning this transfer id.
      const outboxRows = (await (db as any).execute(sql`
        SELECT aggregate_id, event_type, status, payload
        FROM outbox_events
        WHERE aggregate_type = 'tigerbeetle'
          AND position(${transferId} in payload) > 0
        ORDER BY id DESC
        LIMIT 20
      `)) as unknown as Array<{ aggregate_id: string; event_type: string; status: string; payload: string }>;

      const hasDualWriteFailure = outboxRows.some(r => r.event_type === "dual_write_failed" && (r.status === "pending" || r.status === "failed"));

      if (mt.status === "COMMITTED") {
        const postedLeg = journalRows.find(r => r.status === "posted" && r.tb_pending_id);
        if (!postedLeg) {
          const failedLeg = outboxRows.find(r => r.event_type === "dual_write_failed");
          discrepancies.push({
            entityType: "settlement",
            entityId: transferId,
            field: "settlement_leg",
            expectedValue: "posted TB settlement leg",
            actualValue: failedLeg
              ? `leg failed — outbox repair queued (ref ${failedLeg.aggregate_id}, status ${failedLeg.status})`
              : "NO_SETTLEMENT_LEG",
            currency: mt.currency,
            severity: "high",
            autoResolved: false,
            resolutionNote: failedLeg
              ? "Settlement leg failed; replay the outbox dual_write_failed event to post it"
              : "Mojaloop COMMITTED but no TigerBeetle settlement leg evidence (journal or outbox) — funds may not have moved on the ledger",
          });
          logger.warn({ runId, transferId, currency: mt.currency, repairQueued: !!failedLeg }, "[Reconciliation] COMMITTED Mojaloop transfer without posted TB settlement leg");
        } else if (hasDualWriteFailure) {
          discrepancies.push({
            entityType: "settlement",
            entityId: transferId,
            field: "settlement_leg",
            expectedValue: "all legs posted",
            actualValue: "posted leg exists but a dual_write_failed repair is still pending",
            currency: mt.currency,
            severity: "medium",
            autoResolved: false,
            resolutionNote: "Replay the pending outbox dual_write_failed event",
          });
        }
      } else {
        // ABORTED: expect reversal evidence — journal refunded/voided, or a
        // compensation leg (`_COMP` reference) in the outbox payloads.
        const reversed = journalRows.some(r => r.status === "refunded" || r.status === "voided");
        const compLeg = outboxRows.some(r => r.aggregate_id.includes("_COMP") || r.payload.includes("_COMP"));
        if (!reversed && !compLeg) {
          discrepancies.push({
            entityType: "settlement",
            entityId: transferId,
            field: "reversal_leg",
            expectedValue: "TB reversal leg (journal refunded/voided or compensation dual-write)",
            actualValue: "NO_REVERSAL",
            currency: mt.currency,
            severity: "high",
            autoResolved: false,
            resolutionNote: "Mojaloop ABORTED but no TigerBeetle reversal evidence — a pending hold may never have been voided/refunded",
          });
          logger.warn({ runId, transferId, currency: mt.currency }, "[Reconciliation] ABORTED Mojaloop transfer without TB reversal evidence");
        }
      }
    }

    const status = discrepancies.length === 0 ? "clean" : "discrepancies_found";
    const completedAt = new Date();
    await persistReconciliationRun(db, runId, "mojaloop_settlement", status, totalChecked, discrepancies, startedAt, completedAt);

    logger.info(
      { runId, totalChecked, discrepancies: discrepancies.length, status },
      "[Reconciliation] Mojaloop↔TigerBeetle reconciliation complete"
    );

    return {
      runId, startedAt, completedAt: new Date(),
      type: "mojaloop_settlement", status, totalChecked, discrepancies,
      summary: `Checked ${totalChecked} terminal Mojaloop transfers. Found ${discrepancies.length} discrepancies.`,
    };
  } catch (err) {
    logger.error({ runId, err }, "[Reconciliation] Mojaloop↔TigerBeetle reconciliation failed");
    return {
      runId, startedAt, completedAt: new Date(),
      type: "mojaloop_settlement", status: "error",
      totalChecked: 0, discrepancies: [],
      summary: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Scheduled Reconciliation ──────────────────────────────────────────────────

export async function runScheduledReconciliation(): Promise<void> {
  logger.info("[Reconciliation] Starting scheduled reconciliation run");

  const [accountResult, transferResult, positionResult, mojaloopResult] = await Promise.allSettled([
    reconcileAccountBalances(),
    reconcileTransfers(),
    reconcileCurrencyPositions(),
    reconcileMojaloopVsTigerBeetle(),
  ]);

  const results = [accountResult, transferResult, positionResult, mojaloopResult];
  const totalDiscrepancies = results.reduce((acc, r) => {
    if (r.status === "fulfilled") return acc + r.value.discrepancies.length;
    return acc;
  }, 0);

  // Fail-open telemetry, never silent: a rejected leg is logged at error level.
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      logger.error({ leg: ["account", "transfer", "currency_position", "mojaloop_settlement"][i], err: r.reason instanceof Error ? r.reason.message : String(r.reason) }, "[Reconciliation] Scheduled leg rejected");
    }
  });

  logger.info(
    { totalDiscrepancies },
    `[Reconciliation] Scheduled run complete — ${totalDiscrepancies} total discrepancies`
  );
}

// ── User Account Reconciliation (existing function, enhanced) ─────────────────

export async function reconcileTigerBeetleAccounts(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    logger.warn({ userId }, "[TigerBeetle] Reconciliation skipped — database unavailable");
    return;
  }

  try {
    const res = await (db as any).execute(sql`
      SELECT tigerbeetle_wallet_account, tigerbeetle_escrow_account, tigerbeetle_fee_account
      FROM users WHERE id = ${userId}
    `);

    if (res.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

    const row = res[0];
    const tbWalletId = row.tigerbeetle_wallet_account;

    if (!tbWalletId) {
      logger.info({ userId }, "[TigerBeetle] User needs account provisioning");
      const { provisionTigerBeetleAccounts } = await import("../../_core/tigerBeetleProvisioning");
      await provisionTigerBeetleAccounts(userId, ["NGN", "USD"]);
      return;
    }

    // Run targeted reconciliation for this user
    await reconcileAccountBalances([userId]);
    logger.info({ userId, tbWalletId }, "[TigerBeetle] Account reconciled");
  } catch (err) {
    logger.error({ err, userId }, "[TigerBeetle] Reconciliation failed");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchTigerBeetleBalance(accountId: string): Promise<Record<string, bigint>> {
  try {
    const url = process.env.TB_BRIDGE_URL ?? "http://tb-bridge:8200";
    const res = await fetch(`${url}/accounts/${accountId}/balance`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn({ accountId, status: res.status }, "[Reconciliation] TB balance fetch returned non-OK — treating as unknown (empty)");
      return {};
    }
    const data = await res.json() as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, BigInt(String(v))])
    );
  } catch (err) {
    // Never silent: an unreachable bridge means the account check is unknown.
    logger.warn({ accountId, err: err instanceof Error ? err.message : String(err) }, "[Reconciliation] TB balance fetch failed — treating as unknown (empty)");
    return {};
  }
}

/**
 * Persist the run in reconciliation_runs (drizzle/0070: run_id, status,
 * accounts_checked, discrepancies_found, auto_resolved, summary jsonb).
 * Persistence failure is LOUD — the run result is still returned to the
 * caller, but an audit gap is an error, never a silent swallow.
 */
async function persistReconciliationRun(
  db: any,
  runId: string,
  type: string,
  status: string,
  totalChecked: number,
  discrepancies: ReconciliationDiscrepancy[],
  startedAt: Date,
  completedAt: Date,
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO reconciliation_runs (run_id, started_at, completed_at, accounts_checked, discrepancies_found, auto_resolved, status, summary)
      VALUES (
        ${runId}, ${startedAt.toISOString()}, ${completedAt.toISOString()}, ${totalChecked},
        ${discrepancies.length}, ${discrepancies.filter(d => d.autoResolved).length},
        ${status}, ${JSON.stringify({ type, discrepancies })}::jsonb
      )
      ON CONFLICT (run_id) DO NOTHING
    `);
  } catch (err) {
    logger.error(
      { runId, type, status, err: err instanceof Error ? err.message : String(err) },
      "[Reconciliation] FAILED to persist reconciliation run — audit gap, result kept in memory only"
    );
  }
}
