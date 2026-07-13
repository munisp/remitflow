/**
 * db-transaction.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides a typed wrapper around Drizzle's db.transaction() for financial
 * mutations that require ACID guarantees. All wallet credit/debit operations
 * that touch more than one table MUST use withTransaction().
 *
 * Usage:
 *   import { withTransaction } from "./db-transaction";
 *   const result = await withTransaction(async (tx) => {
 *     await tx.update(wallets)...
 *     await tx.insert(transactions)...
 *     return result;
 *   });
 */

import { getDb } from "./db";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../drizzle/schema";

type TxClient = Parameters<Parameters<PostgresJsDatabase<typeof schema>["transaction"]>[0]>[0];

/**
 * Execute a callback inside a database transaction.
 * If the callback throws, the transaction is automatically rolled back.
 * If the callback returns successfully, the transaction is committed.
 */
export async function withTransaction<T>(
  callback: (tx: TxClient) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(callback);
}

/**
 * Atomic wallet debit — deducts `amount` from wallet only if balance is
 * sufficient, using a single SQL UPDATE with a WHERE guard to prevent
 * race conditions. Returns the updated balance or null if insufficient funds.
 */
export async function atomicDebit(
  tx: TxClient,
  walletId: number,
  amount: number,
  precision = 4
): Promise<string | null> {
  const { eq, sql, and } = await import("drizzle-orm");
  const { wallets } = await import("../drizzle/schema");
  const [updated] = await tx
    .update(wallets)
    .set({
      balance: sql`CAST(CAST(${wallets.balance} AS DECIMAL(18,${precision})) - ${amount} AS VARCHAR)`,
    })
    .where(
      and(
        eq(wallets.id, walletId),
        sql`CAST(${wallets.balance} AS DECIMAL(18,${precision})) >= ${amount}`
      )
    )
    .returning({ balance: wallets.balance });
  return updated?.balance ?? null;
}

/**
 * Atomic wallet credit — adds `amount` to wallet balance atomically.
 * Returns the updated balance.
 */
export async function atomicCredit(
  tx: TxClient,
  walletId: number,
  amount: number,
  precision = 4
): Promise<string> {
  const { eq, sql } = await import("drizzle-orm");
  const { wallets } = await import("../drizzle/schema");
  const [updated] = await tx
    .update(wallets)
    .set({
      balance: sql`CAST(CAST(${wallets.balance} AS DECIMAL(18,${precision})) + ${amount} AS VARCHAR)`,
    })
    .where(eq(wallets.id, walletId))
    .returning({ balance: wallets.balance });
  if (!updated) throw new Error(`Wallet ${walletId} not found`);
  return updated.balance;
}
