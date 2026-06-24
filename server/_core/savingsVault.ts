/**
 * savingsVault.ts — F9: Stablecoin Savings Vault
 *
 * Fixed-term deposits with guaranteed APY (30/60/90 day lock).
 * Time-locked stablecoin deposits earning yield from platform treasury.
 *
 * Middleware: TigerBeetle (interest ledger), Temporal (maturity workflows),
 * Kafka (deposit/maturity events), PostgreSQL (vault records).
 */

import { z } from "zod";
import { randomBytes } from "crypto";
import { protectedProcedure, rateLimitedProcedure, strictRateLimitedProcedure, router } from "./trpc";
import { logger } from "./logger";
import { FeatureEvents, createLedgerEntry, sanitizeHtml, persistFeatureRecord, updateFeatureRecord } from "./featurePersistence";

// ── PostgreSQL Write-Through ─────────────────────────────────────────────────
let _wtDb_savingsVaultts: any = null;
async function _getWtDb_savingsVaultts() {
  if (_wtDb_savingsVaultts) return _wtDb_savingsVaultts;
  try {
    const { getDb } = await import("../db.js");
    _wtDb_savingsVaultts = await getDb();
    return _wtDb_savingsVaultts;
  } catch { return null; }
}
async function _writeThrough(table: string, key: string, value: unknown): Promise<void> {
  const db = await _getWtDb_savingsVaultts();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      INSERT INTO ${sql.raw(table)} (key, data, updated_at)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `);
  } catch { /* hot cache still works */ }
}
async function _deleteFromDb(table: string, key: string): Promise<void> {
  const db = await _getWtDb_savingsVaultts();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`DELETE FROM ${sql.raw(table)} WHERE key = ${key}`);
  } catch {}
}


// ── Constants ───────────────────────────────────────────────────────────────

const VAULT_TIERS: Record<number, { apy: number; minDeposit: number; maxDeposit: number }> = {
  30:  { apy: 4.0, minDeposit: 100, maxDeposit: 1_000_000 },
  60:  { apy: 5.5, minDeposit: 100, maxDeposit: 1_000_000 },
  90:  { apy: 7.0, minDeposit: 100, maxDeposit: 1_000_000 },
  180: { apy: 8.5, minDeposit: 500, maxDeposit: 5_000_000 },
  365: { apy: 10.0, minDeposit: 1000, maxDeposit: 10_000_000 },
};

// ── Types ───────────────────────────────────────────────────────────────────

interface SavingsDeposit {
  depositId: string;
  userId: number;
  stablecoin: string;
  principal: number;
  interestEarned: number;
  apy: number;
  termDays: number;
  startDate: string;
  maturityDate: string;
  status: "active" | "matured" | "withdrawn" | "early_withdrawal";
  earlyWithdrawalPenalty: number;
  withdrawnAt?: string;
  createdAt: string;
}

// ── Store ───────────────────────────────────────────────────────────────────

const deposits = new Map<string, SavingsDeposit>(); // Hot cache — persisted to PostgreSQL table "feature_savings_deposits"

// ── Router ──────────────────────────────────────────────────────────────────

export const savingsVaultRouter = router({
  // Get available tiers
  getTiers: protectedProcedure
    .query(async () => {
      return Object.entries(VAULT_TIERS).map(([days, tier]) => ({
        termDays: parseInt(days),
        apy: tier.apy,
        minDeposit: tier.minDeposit,
        maxDeposit: tier.maxDeposit,
        earlyWithdrawalPenalty: 2.0, // 2% penalty
      }));
    }),

  // Create deposit
  deposit: strictRateLimitedProcedure
    .input(z.object({
      stablecoin: z.enum(["USDT", "USDC", "DAI", "BUSD", "PYUSD"]),
      amount: z.number().positive(),
      termDays: z.number().refine(d => d in VAULT_TIERS, "Invalid term"),
    }))
    .mutation(async ({ input, ctx }) => {
      const tier = VAULT_TIERS[input.termDays];
      if (input.amount < tier.minDeposit) throw new Error(`Minimum deposit: $${tier.minDeposit}`);
      if (input.amount > tier.maxDeposit) throw new Error(`Maximum deposit: $${tier.maxDeposit}`);

      const depositId = `sav-${randomBytes(8).toString("hex")}`;
      const now = new Date();
      const maturity = new Date(now.getTime() + input.termDays * 86400_000);
      const interestEarned = input.amount * (tier.apy / 100) * (input.termDays / 365);

      const deposit: SavingsDeposit = {
        depositId,
        userId: ctx.user.id,
        stablecoin: input.stablecoin,
        principal: input.amount,
        interestEarned: Math.round(interestEarned * 100) / 100,
        apy: tier.apy,
        termDays: input.termDays,
        startDate: now.toISOString(),
        maturityDate: maturity.toISOString(),
        status: "active",
        earlyWithdrawalPenalty: 2.0,
        createdAt: now.toISOString(),
      };

      deposits.set(depositId, deposit);
      _writeThrough("feature_savings_deposits", String(depositId), deposit).catch(() => {});
      persistFeatureRecord("feature_savings_deposits", depositId, { id: depositId, ...(typeof deposit === 'object' ? deposit : {}) }).catch(() => {});
      logger.info({ depositId, amount: input.amount, term: input.termDays, apy: tier.apy }, "Savings deposit created");
      FeatureEvents.savingsDeposited({ depositId, userId: ctx.user.id, amount: input.amount, term: input.termDays });
      createLedgerEntry({ debitAccountId: `user-${ctx.user.id}-${input.stablecoin}`, creditAccountId: `savings-vault-${input.stablecoin}`, amount: input.amount, currency: input.stablecoin, reference: `deposit-${depositId}`, code: 400 }).catch(() => {});

      return deposit;
    }),

  // Withdraw (at maturity or early with penalty)
  withdraw: strictRateLimitedProcedure
    .input(z.object({ depositId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const deposit = deposits.get(input.depositId);
      if (!deposit || deposit.userId !== ctx.user.id) throw new Error("Deposit not found");
      if (deposit.status !== "active") throw new Error("Deposit is not active");

      const now = new Date();
      const isEarly = now < new Date(deposit.maturityDate);

      let payout = deposit.principal + deposit.interestEarned;
      let penalty = 0;
      if (isEarly) {
        penalty = deposit.principal * (deposit.earlyWithdrawalPenalty / 100);
        payout = deposit.principal - penalty;
        deposit.status = "early_withdrawal";
        deposit.interestEarned = -penalty;
      } else {
        deposit.status = "matured";
      }

      deposit.withdrawnAt = now.toISOString();
      const netAmount = Math.round(payout * 100) / 100;
      return {
        depositId: deposit.depositId,
        status: deposit.status,
        principal: deposit.principal,
        penalty: Math.round(penalty * 100) / 100,
        netAmount,
        payout: netAmount,
        early: isEarly,
      };
    }),

  // Get user deposits
  getDeposits: protectedProcedure
    .query(async ({ ctx }) => {
      const userDeposits = Array.from(deposits.values()).filter(d => d.userId === ctx.user.id);
      const totalDeposited = userDeposits.filter(d => d.status === "active").reduce((s, d) => s + d.principal, 0);
      const totalInterest = userDeposits.filter(d => d.status === "active").reduce((s, d) => s + d.interestEarned, 0);

      return { deposits: userDeposits, summary: { totalDeposited, totalInterest, activeCount: userDeposits.filter(d => d.status === "active").length } };
    }),
});
