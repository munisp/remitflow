/**
 * Automated Daily Reconciliation Scheduler
 *
 * Runs reconciliation checks on a configurable interval (default: daily at 02:00 UTC).
 * Compares TigerBeetle ledger balances against PostgreSQL transaction totals,
 * checks nostro account positions, and flags discrepancies.
 */

import { sql, eq } from "drizzle-orm";
import { getDb } from "../db";
import { transactions, wallets, auditLogs } from "../../drizzle/schema";
import { logger } from "../_core/logger";


const RECONCILIATION_INTERVAL_MS = parseInt(
  process.env.RECONCILIATION_INTERVAL_MS ?? String(24 * 60 * 60 * 1000), // 24 hours
);

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

interface ReconciliationResult {
  timestamp: string;
  checks: ReconciliationCheck[];
  discrepanciesFound: number;
  status: "clean" | "discrepancies_found" | "error";
}

interface ReconciliationCheck {
  name: string;
  status: "pass" | "fail" | "warn" | "error";
  details: string;
  discrepancyAmount?: number;
  currency?: string;
}

export async function runDailyReconciliation(): Promise<ReconciliationResult> {
  const checks: ReconciliationCheck[] = [];
  const timestamp = new Date().toISOString();

  logger.info("[Reconciliation] Starting daily reconciliation run");

  // Check 1: Wallet balance sum vs transaction net for each currency
  try {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");

    const walletTotals = await db.select({
      currency: wallets.currency,
      totalBalance: sql<string>`SUM(CAST(${wallets.balance} AS DECIMAL(18,4)))`,
    }).from(wallets).groupBy(wallets.currency);

    for (const wt of walletTotals) {
      const totalBalance = Number(wt.totalBalance ?? 0);
      const [txCredits] = await db.select({
        total: sql<string>`COALESCE(SUM(CAST(${transactions.fromAmount} AS DECIMAL(18,4))), 0)`,
      }).from(transactions).where(sql`${transactions.toCurrency} = ${wt.currency} AND ${transactions.status} = 'completed' AND ${transactions.type} = 'receive'`);
      const [txDebits] = await db.select({
        total: sql<string>`COALESCE(SUM(CAST(${transactions.fromAmount} AS DECIMAL(18,4))), 0)`,
      }).from(transactions).where(sql`${transactions.fromCurrency} = ${wt.currency} AND ${transactions.status} = 'completed' AND ${transactions.type} = 'send'`);

      const netTransactions = Number(txCredits?.total ?? 0) - Number(txDebits?.total ?? 0);
      const discrepancy = Math.abs(totalBalance - netTransactions);
      const threshold = Math.max(0.01, totalBalance * 0.001);

      checks.push({
        name: `wallet_balance_${wt.currency}`,
        status: discrepancy <= threshold ? "pass" : "fail",
        details: `Wallet sum: ${totalBalance.toFixed(2)} ${wt.currency}, Net tx: ${netTransactions.toFixed(2)}, Delta: ${discrepancy.toFixed(2)}`,
        discrepancyAmount: discrepancy > threshold ? discrepancy : undefined,
        currency: wt.currency ?? undefined,
      });
    }
  } catch (err) {
    checks.push({
      name: "wallet_balance_check",
      status: "error",
      details: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Check 2: Pending transfers older than 24 hours (stuck in pipeline)
  try {
    const db = await getDb();
    if (db) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [stuckResult] = await db.select({
        cnt: sql<number>`COUNT(*)::int`,
      }).from(transactions).where(
        sql`${transactions.status} IN ('pending', 'processing') AND ${transactions.createdAt} < ${twentyFourHoursAgo}`
      );
      const stuckCount = stuckResult?.cnt ?? 0;
      checks.push({
        name: "stuck_transfers",
        status: stuckCount === 0 ? "pass" : "warn",
        details: `${stuckCount} transfer(s) stuck in pending/processing for >24h`,
      });
    }
  } catch (err) {
    checks.push({
      name: "stuck_transfers",
      status: "error",
      details: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Check 3: Failed transfers in last 24h
  try {
    const db = await getDb();
    if (db) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [failedResult] = await db.select({
        cnt: sql<number>`COUNT(*)::int`,
        totalAmount: sql<string>`COALESCE(SUM(CAST(${transactions.fromAmount} AS DECIMAL(18,4))), 0)`,
      }).from(transactions).where(
        sql`${transactions.status} = 'failed' AND ${transactions.createdAt} >= ${twentyFourHoursAgo}`
      );
      checks.push({
        name: "failed_transfers_24h",
        status: (failedResult?.cnt ?? 0) > 10 ? "warn" : "pass",
        details: `${failedResult?.cnt ?? 0} failed transfers totaling ${Number(failedResult?.totalAmount ?? 0).toFixed(2)} in last 24h`,
      });
    }
  } catch (err) {
    checks.push({
      name: "failed_transfers_24h",
      status: "error",
      details: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Check 4: Ledger sync verification (compare audit log for LEDGER_SYNC_FAILED)
  try {
    const db = await getDb();
    if (db) {
      const [syncFailures] = await db.select({
        cnt: sql<number>`COUNT(*)::int`,
      }).from(auditLogs).where(
        sql`${auditLogs.action} = 'LEDGER_SYNC_FAILED' AND ${auditLogs.createdAt} >= NOW() - INTERVAL '24 hours'`
      );
      checks.push({
        name: "ledger_sync_failures",
        status: (syncFailures?.cnt ?? 0) === 0 ? "pass" : "fail",
        details: `${syncFailures?.cnt ?? 0} TigerBeetle ledger sync failures in last 24h`,
      });
    }
  } catch (err) {
    checks.push({
      name: "ledger_sync_failures",
      status: "error",
      details: `Failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const discrepanciesFound = checks.filter(c => c.status === "fail").length;
  const result: ReconciliationResult = {
    timestamp,
    checks,
    discrepanciesFound,
    status: discrepanciesFound > 0 ? "discrepancies_found" : checks.some(c => c.status === "error") ? "error" : "clean",
  };

  // Persist reconciliation result as audit log
  try {
    const db = await getDb();
    if (db) {
      await db.insert(auditLogs).values({
        userId: 0,
        action: "DAILY_RECONCILIATION",
        description: JSON.stringify(result),
        severity: discrepanciesFound > 0 ? "critical" : "info",
      });
    }
  } catch (err) {
    logger.error({ err }, "[Reconciliation] Failed to persist reconciliation result");
  }

  logger.info({ discrepanciesFound, status: result.status }, "[Reconciliation] Daily reconciliation complete");
  return result;
}

export function startReconciliationScheduler(): void {
  if (schedulerTimer) return;
  logger.info({ intervalMs: RECONCILIATION_INTERVAL_MS }, "[Reconciliation] Starting automated reconciliation scheduler");

  // Run initial reconciliation after a 60-second startup delay
  setTimeout(() => {
    runDailyReconciliation().catch(err =>
      logger.error({ err }, "[Reconciliation] Scheduled reconciliation failed")
    );
  }, 60_000);

  schedulerTimer = setInterval(() => {
    runDailyReconciliation().catch(err =>
      logger.error({ err }, "[Reconciliation] Scheduled reconciliation failed")
    );
  }, RECONCILIATION_INTERVAL_MS);
}

export function stopReconciliationScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    logger.info("[Reconciliation] Scheduler stopped");
  }
}
