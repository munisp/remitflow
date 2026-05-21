/**
 * Double-Entry Bookkeeping Verification Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Every financial transaction must have balanced debits and credits.
 * This router provides:
 * - Transaction balance verification
 * - Ledger integrity checks
 * - Reconciliation reports
 * - Anomaly detection (unbalanced entries)
 */

import { z } from "zod";
import { randomBytes } from "crypto";
import { router, publicProcedure } from "../_core/trpc";
import { logger } from "../_core/logger";
import { createAuditLog } from "../db";

interface LedgerEntry {
  id: string;
  transactionId: string;
  accountId: string;
  accountType: "asset" | "liability" | "equity" | "revenue" | "expense";
  debit: number;
  credit: number;
  currency: string;
  description: string;
  timestamp: string;
}

// In-memory ledger for verification (production: TigerBeetle + PostgreSQL)
const ledger: LedgerEntry[] = [];

function generateEntryId(): string {
  return `le_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

export const doubleEntryRouter = router({
  // Record a balanced transaction (debits must equal credits)
  recordTransaction: publicProcedure
    .input(z.object({
      transactionId: z.string(),
      entries: z.array(z.object({
        accountId: z.string(),
        accountType: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
        debit: z.number().min(0),
        credit: z.number().min(0),
        currency: z.string().length(3),
        description: z.string(),
      })).min(2),
    }))
    .mutation(({ input }) => {
      // Verify balance: total debits must equal total credits
      let totalDebits = 0;
      let totalCredits = 0;

      for (const entry of input.entries) {
        totalDebits += entry.debit;
        totalCredits += entry.credit;

        if (entry.debit > 0 && entry.credit > 0) {
          return {
            success: false,
            error: "An entry cannot have both debit and credit",
          };
        }
        if (entry.debit === 0 && entry.credit === 0) {
          return {
            success: false,
            error: "An entry must have either debit or credit",
          };
        }
      }

      // Allow for floating point rounding (max 0.01 difference)
      if (Math.abs(totalDebits - totalCredits) > 0.01) {
        logger.error({
          transactionId: input.transactionId,
          totalDebits,
          totalCredits,
          difference: totalDebits - totalCredits,
        }, "Unbalanced transaction rejected");

        return {
          success: false,
          error: `Transaction is not balanced. Debits: ${totalDebits}, Credits: ${totalCredits}, Difference: ${(totalDebits - totalCredits).toFixed(2)}`,
        };
      }

      // Record entries
      const entries: LedgerEntry[] = input.entries.map((e) => ({
        id: generateEntryId(),
        transactionId: input.transactionId,
        accountId: e.accountId,
        accountType: e.accountType,
        debit: e.debit,
        credit: e.credit,
        currency: e.currency,
        description: e.description,
        timestamp: new Date().toISOString(),
      }));

      ledger.push(...entries);

      logger.info({
        transactionId: input.transactionId,
        entryCount: entries.length,
        totalDebits,
        totalCredits,
      }, "Balanced transaction recorded");

      return {
        success: true,
        transactionId: input.transactionId,
        entryCount: entries.length,
        totalDebits,
        totalCredits,
      };
    }),

  // Verify ledger integrity (all transactions balanced)
  verifyIntegrity: publicProcedure.query(() => {
    const txGroups = new Map<string, LedgerEntry[]>();
    for (const entry of ledger) {
      const group = txGroups.get(entry.transactionId) ?? [];
      group.push(entry);
      txGroups.set(entry.transactionId, group);
    }

    const issues: Array<{ transactionId: string; debits: number; credits: number; difference: number }> = [];

    for (const [txId, entries] of Array.from(txGroups.entries())) {
      const debits = entries.reduce((sum: number, e: LedgerEntry) => sum + e.debit, 0);
      const credits = entries.reduce((sum: number, e: LedgerEntry) => sum + e.credit, 0);
      if (Math.abs(debits - credits) > 0.01) {
        issues.push({ transactionId: txId, debits, credits, difference: debits - credits });
      }
    }

    return {
      totalTransactions: txGroups.size,
      totalEntries: ledger.length,
      balanced: issues.length === 0,
      issues,
    };
  }),

  // Get account balance
  getAccountBalance: publicProcedure
    .input(z.object({ accountId: z.string() }))
    .query(({ input }) => {
      const entries = ledger.filter((e) => e.accountId === input.accountId);
      const totalDebits = entries.reduce((sum: number, e: LedgerEntry) => sum + e.debit, 0);
      const totalCredits = entries.reduce((sum: number, e: LedgerEntry) => sum + e.credit, 0);

      return {
        accountId: input.accountId,
        totalDebits,
        totalCredits,
        balance: totalDebits - totalCredits,
        entryCount: entries.length,
      };
    }),

  // Trial balance report
  trialBalance: publicProcedure.query(() => {
    const accounts = new Map<string, { debits: number; credits: number; type: string }>();

    for (const entry of ledger) {
      const acc = accounts.get(entry.accountId) ?? { debits: 0, credits: 0, type: entry.accountType };
      acc.debits += entry.debit;
      acc.credits += entry.credit;
      accounts.set(entry.accountId, acc);
    }

    let totalDebits = 0;
    let totalCredits = 0;
    const rows: Array<{ accountId: string; accountType: string; debits: number; credits: number; balance: number }> = [];

    for (const [id, acc] of Array.from(accounts.entries())) {
      totalDebits += acc.debits;
      totalCredits += acc.credits;
      rows.push({
        accountId: id,
        accountType: acc.type,
        debits: Math.round(acc.debits * 100) / 100,
        credits: Math.round(acc.credits * 100) / 100,
        balance: Math.round((acc.debits - acc.credits) * 100) / 100,
      });
    }

    return {
      accounts: rows,
      totalDebits: Math.round(totalDebits * 100) / 100,
      totalCredits: Math.round(totalCredits * 100) / 100,
      balanced: Math.abs(totalDebits - totalCredits) < 0.01,
    };
  }),
});
