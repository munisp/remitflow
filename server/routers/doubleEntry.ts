/**
 * Double-Entry Bookkeeping Verification Router
 * ─────────────────────────────────────────────────────────────────────────────
 * DB-backed (PostgreSQL) double-entry ledger.
 * Every financial transaction must have balanced debits and credits.
 * This router provides:
 * - Transaction balance verification
 * - Ledger integrity checks
 * - Reconciliation reports
 * - Anomaly detection (unbalanced entries)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { randomBytes } from "crypto";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { logger } from "../_core/logger";
import { getDb, createAuditLog } from "../db";
import { sql } from "drizzle-orm";
import { publishEvent, KAFKA_TOPICS } from "../middleware/kafka";

function generateEntryId(): string {
  return `le_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

export const doubleEntryRouter = router({
  // FF-023: arbitrary double-entry writes are restricted to admin/system
  // actors — user-written ledger_entries poison trial-balance/reconciliation.
  recordTransaction: adminProcedure
    .input(z.object({
      transactionId: z.string(),
      entries: z.array(z.object({
        accountId: z.string(),
        accountType: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
        debit: z.number().min(0),
        credit: z.number().min(0),
        currency: z.string().length(3),
        description: z.string().max(2000),
      })).min(2),
    }))
    .mutation(async ({ input }) => {
      let totalDebits = 0;
      let totalCredits = 0;

      for (const entry of input.entries) {
        totalDebits += entry.debit;
        totalCredits += entry.credit;

        if (entry.debit > 0 && entry.credit > 0) {
          return { success: false, error: "An entry cannot have both debit and credit" };
        }
        if (entry.debit === 0 && entry.credit === 0) {
          return { success: false, error: "An entry must have either debit or credit" };
        }
      }

      if (Math.abs(totalDebits - totalCredits) > 0.01) {
        logger.error({
          transactionId: input.transactionId, totalDebits, totalCredits,
          difference: totalDebits - totalCredits,
        }, "Unbalanced transaction rejected");
        return {
          success: false,
          error: `Transaction is not balanced. Debits: ${totalDebits}, Credits: ${totalCredits}, Difference: ${(totalDebits - totalCredits).toFixed(2)}`,
        };
      }

      const db = await getDb();
      const now = new Date().toISOString();
      const entries = input.entries.map((e) => ({
        id: generateEntryId(),
        transactionId: input.transactionId,
        accountId: e.accountId,
        accountType: e.accountType,
        debit: e.debit,
        credit: e.credit,
        currency: e.currency,
        description: e.description,
        timestamp: now,
      }));

      if (db) {
        for (const entry of entries) {
          await db.execute(sql`
            INSERT INTO ledger_entries (id, transaction_id, account_id, account_type, debit, credit, currency, description, created_at)
            VALUES (${entry.id}, ${entry.transactionId}, ${entry.accountId}, ${entry.accountType},
                    ${entry.debit}, ${entry.credit}, ${entry.currency}, ${entry.description}, ${entry.timestamp})
            ON CONFLICT DO NOTHING
          `);
        }
      }

      logger.info({
        transactionId: input.transactionId, entryCount: entries.length, totalDebits, totalCredits,
      }, "Balanced transaction recorded");

      // Kafka event for ledger entry recording
      publishEvent(KAFKA_TOPICS.TRANSACTIONS, `ledger:${input.transactionId}`, {
        eventType: "double_entry_recorded",
        transactionId: input.transactionId,
        entryCount: entries.length,
        totalDebits,
        totalCredits,
        timestamp: new Date().toISOString(),
      }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[DoubleEntry] Kafka event failed"));

      return { success: true, verified: true, transactionId: input.transactionId, entryCount: entries.length, totalDebits, totalCredits };
    }),

  verifyIntegrity: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const rows = await db.execute(sql`
      SELECT transaction_id,
             SUM(debit) as total_debits,
             SUM(credit) as total_credits,
             COUNT(*) as entry_count
      FROM ledger_entries
      GROUP BY transaction_id
      HAVING ABS(SUM(debit) - SUM(credit)) > 0.01
    `) as { rows: Array<{ transaction_id: string; total_debits: string; total_credits: string }> };

    const countResult = await db.execute(sql`
      SELECT COUNT(DISTINCT transaction_id) as tx_count, COUNT(*) as entry_count FROM ledger_entries
    `) as { rows: Array<{ tx_count: string; entry_count: string }> };

    const issues = (rows.rows ?? []).map((r: { transaction_id: string; total_debits: string; total_credits: string }) => ({
      transactionId: r.transaction_id,
      debits: Number(r.total_debits),
      credits: Number(r.total_credits),
      difference: Number(r.total_debits) - Number(r.total_credits),
    }));

    const counts = countResult.rows?.[0] ?? { tx_count: "0", entry_count: "0" };

    return {
      totalTransactions: Number(counts.tx_count),
      totalEntries: Number(counts.entry_count),
      balanced: issues.length === 0,
      issues,
    };
  }),

  getAccountBalance: protectedProcedure
    .input(z.object({ accountId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const result = await db.execute(sql`
        SELECT COALESCE(SUM(debit), 0) as total_debits,
               COALESCE(SUM(credit), 0) as total_credits,
               COUNT(*) as entry_count
        FROM ledger_entries WHERE account_id = ${input.accountId}
      `) as { rows: Array<{ total_debits: string; total_credits: string; entry_count: string }> };

      const row = result.rows?.[0] ?? { total_debits: "0", total_credits: "0", entry_count: "0" };
      const debits = Number(row.total_debits);
      const credits = Number(row.total_credits);

      return {
        accountId: input.accountId,
        totalDebits: debits,
        totalCredits: credits,
        balance: debits - credits,
        entryCount: Number(row.entry_count),
      };
    }),

  trialBalance: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const result = await db.execute(sql`
      SELECT account_id, account_type,
             SUM(debit) as total_debits,
             SUM(credit) as total_credits
      FROM ledger_entries
      GROUP BY account_id, account_type
      ORDER BY account_type, account_id
    `) as { rows: Array<{ account_id: string; account_type: string; total_debits: string; total_credits: string }> };

    let totalDebits = 0;
    let totalCredits = 0;
    const rows = (result.rows ?? []).map((r: { account_id: string; account_type: string; total_debits: string; total_credits: string }) => {
      const d = Number(r.total_debits);
      const c = Number(r.total_credits);
      totalDebits += d;
      totalCredits += c;
      return {
        accountId: r.account_id,
        accountType: r.account_type,
        debits: Math.round(d * 100) / 100,
        credits: Math.round(c * 100) / 100,
        balance: Math.round((d - c) * 100) / 100,
      };
    });

    return {
      accounts: rows,
      totalDebits: Math.round(totalDebits * 100) / 100,
      totalCredits: Math.round(totalCredits * 100) / 100,
      balanced: Math.abs(totalDebits - totalCredits) < 0.01,
    };
  }),
});
