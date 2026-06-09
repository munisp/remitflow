/**
 * ledger-sync.ts — TigerBeetle ↔ PostgreSQL Ledger Synchronization
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Architecture:
 *   - TigerBeetle: Source of truth for all financial balances (double-entry ledger)
 *   - PostgreSQL: Stores transaction metadata, user info, and audit trails
 *
 * Flow:
 *   1. Financial mutations go to TigerBeetle FIRST (via createTransfer)
 *   2. On success, PostgreSQL metadata is updated (transaction record, wallet balance cache)
 *   3. Periodic reconciliation ensures PG balance cache matches TB
 *
 * Account Types (TigerBeetle):
 *   1000 = User Wallet (asset)
 *   2000 = Escrow/Hold (liability)
 *   3000 = Fee Revenue (income)
 *   4000 = Partner Earnings (liability)
 *   5000 = FX Gain/Loss (equity)
 *   9000 = Suspense/Clearing
 */

import { logger } from "./_core/logger.js";
import { getDb } from "./db.js";
import { eq, sql } from "drizzle-orm";
import { wallets, transactions } from "../drizzle/schema.js";
import { safeParseAmount } from "./lib/safeDecimal";

// ─── TigerBeetle Client ──────────────────────────────────────────────────────

const TB_ADDRESS = process.env.TIGERBEETLE_ADDRESS ?? "localhost:3000";
const TB_CLUSTER_ID = parseInt(process.env.TIGERBEETLE_CLUSTER_ID ?? "0", 10);
const TB_SERVICE_URL = process.env.TIGERBEETLE_SERVICE_URL ?? "http://tigerbeetle-service:8088";

// Amount scale factor: TigerBeetle uses u128 integers, we scale by 10^6 for 6 decimal places
const SCALE_FACTOR = 1_000_000;

interface TBTransferResult {
  success: boolean;
  transferId: string;
  error?: string;
  tbTimestamp?: number;
}

interface TBAccountBalance {
  accountId: string;
  debitsPosted: number;
  creditsPosted: number;
  debitsPending: number;
  creditsPending: number;
  balance: number;
  availableBalance: number;
}

interface ReconciliationResult {
  walletId: number;
  userId: number;
  currency: string;
  pgBalance: number;
  tbBalance: number;
  discrepancy: number;
  synced: boolean;
}

// ─── TigerBeetle HTTP Client (via Rust adapter service) ──────────────────────

async function tbCreateAccount(
  userId: number,
  currency: string,
  accountType: number = 1000,
): Promise<{ accountId: string; success: boolean }> {
  try {
    const resp = await fetch(`${TB_SERVICE_URL}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        currency,
        account_type: accountType,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      const err = await resp.text();
      logger.error({ userId, currency, status: resp.status, err }, "[Ledger] TB account creation failed");
      return { accountId: "", success: false };
    }
    const data = await resp.json() as { id: string };
    return { accountId: data.id, success: true };
  } catch (err) {
    logger.error({ err: (err as Error).message, userId }, "[Ledger] TB account creation error");
    return { accountId: "", success: false };
  }
}

async function tbCreateTransfer(
  debitAccountId: string,
  creditAccountId: string,
  amount: number,
  ledger: number,
  code: number,
  transferId?: string,
): Promise<TBTransferResult> {
  const scaledAmount = Math.round(amount * SCALE_FACTOR);
  try {
    const resp = await fetch(`${TB_SERVICE_URL}/transfers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: transferId,
        debit_account_id: debitAccountId,
        credit_account_id: creditAccountId,
        amount: scaledAmount,
        ledger,
        code,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      const err = await resp.text();
      return { success: false, transferId: transferId ?? "", error: err };
    }
    const data = await resp.json() as { id: string; timestamp: number };
    return { success: true, transferId: data.id, tbTimestamp: data.timestamp };
  } catch (err) {
    return { success: false, transferId: transferId ?? "", error: (err as Error).message };
  }
}

async function tbGetBalance(accountId: string): Promise<TBAccountBalance | null> {
  try {
    const resp = await fetch(`${TB_SERVICE_URL}/accounts/${accountId}/balance`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as {
      debits_posted: number;
      credits_posted: number;
      debits_pending: number;
      credits_pending: number;
    };
    const balance = (data.credits_posted - data.debits_posted) / SCALE_FACTOR;
    const available = (data.credits_posted - data.debits_posted - data.debits_pending) / SCALE_FACTOR;
    return {
      accountId,
      debitsPosted: data.debits_posted / SCALE_FACTOR,
      creditsPosted: data.credits_posted / SCALE_FACTOR,
      debitsPending: data.debits_pending / SCALE_FACTOR,
      creditsPending: data.credits_pending / SCALE_FACTOR,
      balance,
      availableBalance: available,
    };
  } catch {
    return null;
  }
}

// ─── Dual-Write Operations ───────────────────────────────────────────────────

/**
 * Execute a financial transfer with dual-write to TigerBeetle (ledger) and PostgreSQL (metadata).
 *
 * 1. Write to TigerBeetle first (source of truth)
 * 2. On TB success, update PostgreSQL wallet balance cache + transaction record
 * 3. If PG update fails, log for reconciliation (TB is still authoritative)
 */
export async function dualWriteTransfer(params: {
  fromWalletId: number;
  toWalletId: number;
  fromTbAccountId: string;
  toTbAccountId: string;
  amount: number;
  currency: string;
  ledger: number;
  code: number;
  metadata: {
    userId: number;
    type: string;
    description?: string;
    reference?: string;
  };
}): Promise<{
  success: boolean;
  transferId?: string;
  error?: string;
}> {
  const { fromWalletId, toWalletId, fromTbAccountId, toTbAccountId, amount, currency, ledger, code, metadata } = params;

  // Step 1: Write to TigerBeetle (source of truth)
  const tbResult = await tbCreateTransfer(fromTbAccountId, toTbAccountId, amount, ledger, code);
  if (!tbResult.success) {
    logger.error({ ...params, tbError: tbResult.error }, "[Ledger] TigerBeetle transfer failed — aborting");
    return { success: false, error: `Ledger error: ${tbResult.error}` };
  }

  logger.info({ transferId: tbResult.transferId, amount, currency }, "[Ledger] TB transfer committed");

  // Step 2: Update PostgreSQL metadata (best-effort, TB is authoritative)
  try {
    const db = await getDb();
    if (db) {
      await db.transaction(async (tx: any) => {
        // Update sender wallet balance cache
        await tx.update(wallets)
          .set({
            balance: sql`CAST(CAST(${wallets.balance} AS DECIMAL(18,6)) - ${amount} AS VARCHAR)`,
          })
          .where(eq(wallets.id, fromWalletId));

        // Update receiver wallet balance cache
        await tx.update(wallets)
          .set({
            balance: sql`CAST(CAST(${wallets.balance} AS DECIMAL(18,6)) + ${amount} AS VARCHAR)`,
          })
          .where(eq(wallets.id, toWalletId));
      });
    }
  } catch (pgErr) {
    // PG failure is non-fatal — TB is authoritative, reconciliation will fix PG
    logger.error(
      { err: (pgErr as Error).message, transferId: tbResult.transferId },
      "[Ledger] PostgreSQL metadata update failed — queued for reconciliation"
    );
  }

  return { success: true, transferId: tbResult.transferId };
}

/**
 * Create a TigerBeetle account for a new wallet and store the TB account ID in PostgreSQL.
 */
export async function createLedgerAccount(
  userId: number,
  walletId: number,
  currency: string,
  accountType: number = 1000,
): Promise<{ tbAccountId: string; success: boolean }> {
  const result = await tbCreateAccount(userId, currency, accountType);
  if (!result.success) {
    logger.warn({ userId, walletId, currency }, "[Ledger] Failed to create TB account — wallet will use PG-only mode");
    return { tbAccountId: "", success: false };
  }

  // Store TB account ID in PostgreSQL for future lookups
  try {
    const db = await getDb();
    if (db) {
      await db.update(wallets)
        .set({ tbAccountId: result.accountId } as any)
        .where(eq(wallets.id, walletId));
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[Ledger] Failed to store TB account ID in PG");
  }

  return { tbAccountId: result.accountId, success: true };
}

// ─── Reconciliation ──────────────────────────────────────────────────────────

/**
 * Reconcile PostgreSQL balance cache against TigerBeetle (source of truth).
 * Runs periodically to catch any PG drift from failed dual-writes.
 *
 * Strategy:
 *   1. For each wallet with a tbAccountId, fetch balance from TigerBeetle
 *   2. Compare with PG cached balance
 *   3. If discrepancy found, update PG to match TB
 *   4. Log all discrepancies for audit
 */
export async function reconcileBalances(options?: {
  batchSize?: number;
  dryRun?: boolean;
}): Promise<{
  checked: number;
  discrepancies: number;
  synced: number;
  results: ReconciliationResult[];
}> {
  const batchSize = options?.batchSize ?? 100;
  const dryRun = options?.dryRun ?? false;

  const db = await getDb();
  if (!db) return { checked: 0, discrepancies: 0, synced: 0, results: [] };

  // Fetch wallets that have TigerBeetle account IDs
  const walletsWithTb = await db
    .select({
      id: wallets.id,
      userId: wallets.userId,
      currency: wallets.currency,
      balance: wallets.balance,
      tbAccountId: sql<string>`COALESCE(${wallets}.tb_account_id, '')`,
    })
    .from(wallets)
    .where(sql`${wallets}.tb_account_id IS NOT NULL AND ${wallets}.tb_account_id != ''`)
    .limit(batchSize);

  const results: ReconciliationResult[] = [];
  let discrepancies = 0;
  let synced = 0;

  for (const w of walletsWithTb) {
    const tbBalance = await tbGetBalance(w.tbAccountId as string);
    if (!tbBalance) continue;

    const pgBal = safeParseAmount(String(w.balance) || "0");
    const tbBal = tbBalance.balance;
    const diff = Math.abs(pgBal - tbBal);

    const result: ReconciliationResult = {
      walletId: w.id,
      userId: w.userId,
      currency: w.currency,
      pgBalance: pgBal,
      tbBalance: tbBal,
      discrepancy: diff,
      synced: false,
    };

    // Tolerance: allow 0.01 difference due to floating point
    if (diff > 0.01) {
      discrepancies++;
      logger.warn(
        { walletId: w.id, pgBalance: pgBal, tbBalance: tbBal, diff },
        "[Reconciliation] Balance discrepancy detected — TB is authoritative"
      );

      if (!dryRun) {
        try {
          await db.update(wallets)
            .set({ balance: String(tbBal.toFixed(6)) })
            .where(eq(wallets.id, w.id));
          result.synced = true;
          synced++;
          logger.info({ walletId: w.id, oldBalance: pgBal, newBalance: tbBal }, "[Reconciliation] PG balance synced to TB");
        } catch (err) {
          logger.error({ err: (err as Error).message, walletId: w.id }, "[Reconciliation] Failed to sync PG balance");
        }
      }
    }

    results.push(result);
  }

  logger.info(
    { checked: walletsWithTb.length, discrepancies, synced, dryRun },
    "[Reconciliation] Balance reconciliation complete"
  );

  return { checked: walletsWithTb.length, discrepancies, synced, results };
}

/**
 * Check if TigerBeetle service is available.
 */
export async function isTigerBeetleAvailable(): Promise<boolean> {
  try {
    const resp = await fetch(`${TB_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export { tbGetBalance, SCALE_FACTOR, TB_SERVICE_URL };
