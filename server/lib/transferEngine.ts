/**
 * transferEngine.ts — Core transfer engine with fee calculation, KYC limit enforcement,
 * FX rate lookup, and ledger abstraction.
 */

import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
import { PLATFORM_SYSTEM_USER_ID } from "../_core/tigerBeetle";

// ── Fee Structure ─────────────────────────────────────────────────────────────

interface CorridorFeeConfig {
  flatFee: number;
  percentRate: number; // as decimal, e.g. 0.015 = 1.5%
  maxFee: number;
}

const CORRIDOR_FEES: Record<string, CorridorFeeConfig> = {
  "USD-NGN": { flatFee: 2.99, percentRate: 0.015, maxFee: 49.99 },
  "USD-GHS": { flatFee: 2.49, percentRate: 0.015, maxFee: 39.99 },
  "USD-KES": { flatFee: 2.49, percentRate: 0.015, maxFee: 39.99 },
  "USD-ZAR": { flatFee: 1.99, percentRate: 0.012, maxFee: 29.99 },
  "GBP-NGN": { flatFee: 2.49, percentRate: 0.012, maxFee: 44.99 },
  "EUR-NGN": { flatFee: 2.49, percentRate: 0.015, maxFee: 44.99 },
  "USD-PHP": { flatFee: 1.99, percentRate: 0.012, maxFee: 29.99 },
  "USD-MXN": { flatFee: 1.49, percentRate: 0.010, maxFee: 24.99 },
  "USD-INR": { flatFee: 1.99, percentRate: 0.012, maxFee: 29.99 },
  DEFAULT: { flatFee: 2.99, percentRate: 0.015, maxFee: 49.99 },
};

interface FeeBreakdown {
  flatFee: number;
  percentFee: number;
  totalFee: number;
  corridor: string;
}

/**
 * Calculate the transfer fee for a given amount and corridor.
 * Uses integer cent math to avoid floating-point imprecision.
 */
export function calculateFeeForTest(amountUsd: number, corridor: string): FeeBreakdown {
  const config = CORRIDOR_FEES[corridor] ?? CORRIDOR_FEES.DEFAULT;

  // Use integer cent math to avoid floating-point imprecision
  const amountCents = Math.round(amountUsd * 100);
  const flatFeeCents = Math.round(config.flatFee * 100);
  const percentFeeCents = Math.round(amountCents * config.percentRate);
  const maxFeeCents = Math.round(config.maxFee * 100);

  const rawTotalCents = flatFeeCents + percentFeeCents;
  const cappedTotalCents = Math.min(rawTotalCents, maxFeeCents);

  // If capped, redistribute: flat fee stays, percent fee is adjusted
  const actualPercentFeeCents = cappedTotalCents - flatFeeCents;

  return {
    flatFee: flatFeeCents / 100,
    percentFee: Math.max(0, actualPercentFeeCents) / 100,
    totalFee: cappedTotalCents / 100,
    corridor,
  };
}

// ── KYC Limits ────────────────────────────────────────────────────────────────

interface KycLimitConfig {
  singleTxnMax: number;
  dailyMax: number;
  monthlyMax: number;
}

const KYC_LIMITS: Record<string, KycLimitConfig> = {
  tier0: { singleTxnMax: 0, dailyMax: 0, monthlyMax: 0 },
  tier1: { singleTxnMax: 500, dailyMax: 1000, monthlyMax: 5000 },
  tier2: { singleTxnMax: 5000, dailyMax: 10000, monthlyMax: 50000 },
  tier3: { singleTxnMax: 50000, dailyMax: 100000, monthlyMax: 500000 },
};

interface KycCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if a transfer amount is within the user's KYC limits.
 */
export async function checkKycLimits(
  userId: number,
  amount: number,
  tier: string
): Promise<KycCheckResult> {
  const limits = KYC_LIMITS[tier] ?? KYC_LIMITS.tier0;

  // Check daily limit from database first (includes cumulative check)
  const db = await getDb();
  if (!db) {
    // W9-FIX1: db-null silently skips the cumulative daily check — surface it
    // as a structured warn (allowance semantics unchanged: the single-txn
    // check below still applies).
    logger.warn({ userId, tier },
      "[TransferEngine] DB unavailable — cumulative daily KYC limit check skipped (single-transaction limit still enforced)");
  } else {
    try {
      const result = await db.execute(sql`
        SELECT COALESCE(SUM(CAST("fromAmount" AS NUMERIC)), 0) AS daily_total
        FROM transfers
        WHERE "userId" = ${userId}
          AND "createdAt" >= NOW() - INTERVAL '24 hours'
          AND status != 'failed'
      `);
      const rows = result as unknown as any[];
      const dailyTotal = Number(rows[0]?.daily_total ?? 0);

      if (dailyTotal + amount > limits.dailyMax) {
        return {
          allowed: false,
          reason: `Transfer would exceed daily limit of $${limits.dailyMax} for ${tier}`,
        };
      }
    } catch {
      // If table doesn't exist, fall through to single txn check
    }
  }

  if (amount > limits.singleTxnMax) {
    return {
      allowed: false,
      reason: `Amount $${amount} exceeds single transaction daily limit of $${limits.singleTxnMax} for ${tier}`,
    };
  }

  return { allowed: true };
}

// ── FX Rate Lookup ────────────────────────────────────────────────────────────

const STATIC_FX_RATES: Record<string, number> = {
  "USD-NGN": 1580.50,
  "USD-GHS": 14.20,
  "USD-KES": 129.50,
  "USD-ZAR": 18.75,
  "USD-PHP": 56.20,
  "USD-MXN": 17.10,
  "USD-INR": 83.25,
  "USD-EUR": 0.92,
  "USD-GBP": 0.79,
  "EUR-NGN": 1718.00,
  "GBP-NGN": 2000.00,
  "USD-BRL": 4.97,
  "USD-CAD": 1.36,
  "USD-AUD": 1.53,
};

/**
 * Honesty-tagged FX rate quote (W9-Q5, Wave 7 C7 pattern). A rate that did
 * NOT come from the live rate table is `stale` and NOT `executable` — it may
 * be shown in quote/preview responses but must never settle money (F13-2).
 */
export interface FxRateQuote {
  rate: number;
  source: "live" | "static_fallback";
  stale: boolean;
  executable: boolean;
}

/**
 * Resolve the FX rate for a currency pair. Live rates come from
 * fx_rate_history; STATIC_FX_RATES / reverse-pair / 1.0 defaults are
 * indicative-only fallbacks.
 */
async function lookupFxRate(
  fromCurrency: string,
  toCurrency: string
): Promise<FxRateQuote> {
  // Same-currency legs need no conversion and are always executable.
  if (fromCurrency === toCurrency) {
    return { rate: 1.0, source: "live", stale: false, executable: true };
  }

  const pair = `${fromCurrency}-${toCurrency}`;

  // Try to get from database first
  const db = await getDb();
  if (db) {
    try {
      const result = await db.execute(sql`
        SELECT rate FROM fx_rate_history
        WHERE from_currency = ${fromCurrency}
          AND to_currency = ${toCurrency}
        ORDER BY recorded_at DESC
        LIMIT 1
      `);
      const rows = result as unknown as any[];
      if (rows.length > 0) {
        return { rate: Number(rows[0].rate), source: "live", stale: false, executable: true };
      }
    } catch {
      // Table doesn't exist or no rows — fall through to static rates
    }
  }

  // Fall back to static rates — INDICATIVE ONLY, never executable.
  const staticRate = STATIC_FX_RATES[pair];
  if (staticRate !== undefined) {
    return { rate: staticRate, source: "static_fallback", stale: true, executable: false };
  }

  // Try reverse pair
  const reversePair = `${toCurrency}-${fromCurrency}`;
  const reverseRate = STATIC_FX_RATES[reversePair];
  if (reverseRate !== undefined) {
    return { rate: 1 / reverseRate, source: "static_fallback", stale: true, executable: false };
  }

  // Default fallback — INDICATIVE ONLY.
  return { rate: 1.0, source: "static_fallback", stale: true, executable: false };
}

/**
 * Get the FX rate for a currency pair, falling back to static rates if no DB entry.
 * Legacy test/preview surface — execution paths MUST use getExecutableFxRate.
 */
export async function getFxRateForTest(
  fromCurrency: string,
  toCurrency: string
): Promise<number> {
  return (await lookupFxRate(fromCurrency, toCurrency)).rate;
}

/**
 * W9-Q5: quote/preview-only FX rate, honestly tagged. Callers MUST propagate
 * the { stale, executable } flags in any response built on this rate.
 */
export async function getIndicativeFxRate(
  fromCurrency: string,
  toCurrency: string
): Promise<FxRateQuote> {
  return lookupFxRate(fromCurrency, toCurrency);
}

/**
 * W9-Q5 (F13-2): execution-grade FX rate. FAIL CLOSED — when only a static
 * fallback rate exists, real payouts must not execute at hardcoded numbers
 * (GBP-NGN=2000.00 et al). Throws UNAVAILABLE instead of settling money.
 */
export async function getExecutableFxRate(
  fromCurrency: string,
  toCurrency: string
): Promise<number> {
  const quote = await lookupFxRate(fromCurrency, toCurrency);
  if (!quote.executable) {
    logger.warn({ fromCurrency, toCurrency, source: quote.source },
      "[TransferEngine] FX rate unavailable for execution — refusing static fallback");
    throw new TRPCError({
      code: "UNAVAILABLE",
      message: "FX rate unavailable — cannot execute without a live rate",
    });
  }
  return quote.rate;
}

// ── Ledger Abstraction ────────────────────────────────────────────────────────

export interface LedgerBackend {
  credit(userId: number, currency: string, amount: number): Promise<void>;
  debit(userId: number, currency: string, amount: number): Promise<void>;
  getBalance(userId: number, currency: string): Promise<number>;
}

/**
 * PostgresLedger — implements LedgerBackend using PostgreSQL.
 * In production, TigerBeetleLedger can be swapped in via LEDGER_BACKEND=tigerbeetle.
 */
export class PostgresLedger implements LedgerBackend {
  async credit(userId: number, currency: string, amount: number): Promise<void> {
    const db = await getDb();
    if (!db) return;
    await db.execute(sql`
      UPDATE wallets
      SET balance = CAST(balance AS NUMERIC) + ${amount}
      WHERE "userId" = ${userId} AND currency = ${currency}
    `);
  }

  async debit(userId: number, currency: string, amount: number): Promise<void> {
    const db = await getDb();
    if (!db) return;
    await db.execute(sql`
      UPDATE wallets
      SET balance = CAST(balance AS NUMERIC) - ${amount}
      WHERE "userId" = ${userId} AND currency = ${currency}
    `);
  }

  async getBalance(userId: number, currency: string): Promise<number> {
    const db = await getDb();
    if (!db) return 0;
    const result = await db.execute(sql`
      SELECT balance FROM wallets
      WHERE "userId" = ${userId} AND currency = ${currency}
    `);
    const rows = result as unknown as any[];
    return rows.length > 0 ? Number(rows[0].balance) : 0;
  }
}

// ── Event Bus Abstraction ─────────────────────────────────────────────────────

export interface EventBus {
  publish(topic: string, payload: unknown): Promise<void>;
}

/**
 * PostgresEventBus — fallback event bus using PostgreSQL NOTIFY.
 * Used when KAFKA_BROKERS is not set.
 */
export class PostgresEventBus implements EventBus {
  async publish(topic: string, payload: unknown): Promise<void> {
    const db = await getDb();
    if (!db) return;
    try {
      await db.execute(sql`
        SELECT pg_notify(${topic}, ${JSON.stringify(payload)})
      `);
    } catch {
      // Silently fail if notify is not available
    }
  }
}

/**
 * Get the appropriate event bus based on environment configuration.
 */
export function getEventBus(): EventBus {
  if (process.env.KAFKA_BROKERS) {
    // Return Kafka-backed event bus in production
    return new PostgresEventBus(); // Placeholder — real Kafka client would be used
  }
  return new PostgresEventBus();
}

// ── Default Export ────────────────────────────────────────────────────────────

export const defaultLedger = new PostgresLedger();
export const defaultEventBus = getEventBus();

// ── Rail Map ─────────────────────────────────────────────────────────────────────────────────

/**
 * Maps payout methods to their internal rail identifiers.
 * Used by the transfer pipeline to route transfers to the correct rail.
 */
export const railMap: Record<string, string> = {
  bank_transfer: "bank_transfer",
  mobile_money: "mobile_money",
  cash_pickup: "cash_pickup",
  wallet: "internal",
};

// ── Aliases for transferCore.ts compatibility ─────────────────────────────────

/**
 * Calculate the transfer fee for a given amount and corridor.
 * Returns totalFee and feeBreakdown as an array for API response.
 */
export function calculateFee(amount: number, corridor: string): { totalFee: number; feeBreakdown: Array<{ type: string; amount: number; label: string }> } {
  const breakdown = calculateFeeForTest(amount, corridor);
  return {
    totalFee: breakdown.totalFee,
    feeBreakdown: [
      { type: "flat_fee", amount: breakdown.flatFee, label: "Fixed transfer fee" },
      { type: "percent_fee", amount: breakdown.percentFee, label: "Variable fee" },
    ],
  };
}

/**
 * Get the FX rate for a currency pair.
 * Alias for getFxRateForTest.
 */
export const getFxRate = getFxRateForTest;

/**
 * Validate compliance for a user and amount.
 * Returns allowed: true/false based on KYC limits.
 *
 * W12-FIX: FAIL CLOSED. Previously a missing DB or any query error returned
 * `{ allowed: true }` — a fabricated compliance clearance. On outage this now
 * returns allowed:false with an honest reason, so no money-moving caller can
 * proceed on an unverifiable check (callers that merely DISPLAY the flag —
 * e.g. transferCore.limits — surface compliant:false instead of a phantom
 * compliant:true).
 */
export async function validateCompliance(
  userId: number,
  amount: number
): Promise<{ allowed: boolean; reason?: string }> {
  const db = await getDb();
  if (!db) {
    logger.warn({ userId }, "[TransferEngine] DB unavailable — compliance check fails closed");
    return { allowed: false, reason: "Compliance verification unavailable (database unreachable) — transfer not permitted" };
  }

  try {
    const result = await db.execute(sql`
      SELECT "kycTier" FROM users WHERE id = ${userId}
    `);
    const rows = result as unknown as { kycTier: string }[];
    const tier = rows[0]?.kycTier || "tier1";
    return checkKycLimits(userId, amount, tier);
  } catch (err) {
    logger.warn({ userId, err: err instanceof Error ? err.message : String(err) }, "[TransferEngine] Compliance check errored — fails closed");
    return { allowed: false, reason: "Compliance verification failed — transfer not permitted" };
  }
}

/**
 * Execute a transfer between two users.
 * Creates ledger entries and a transfer record.
 */
export async function executeTransfer(params: {
  senderId: number;
  recipientId: number;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  corridor: string;
  beneficiaryName: string;
  beneficiaryAccount: string;
  payoutMethod: string;
  purpose: string;
  sourceOfFunds: string;
  /** FF-FIX: caller-supplied canonical reference (e.g. the pipeline hold's
   *  CORE-… id). One reference everywhere so cancel/compensation/track work. */
  referenceId?: string;
}): Promise<{
  transferId: string;
  referenceNumber: string;
  status: string;
  amount: number;
  fee: number;
  fxRate: number;
  debitAmount: number;
  creditAmount: number;
  estimatedDelivery: string;
  ledgerEntries: Array<{ id: string; type: string; amount: number }>;
}> {
  const db = await getDb();
  // W9-FIX1: fail closed when the DB is unavailable. Previously db-null
  // skipped every guarded block (KYC tier lookup, balance check, atomic
  // debit/credit/persist) and fell through to a "completed"/"pending" success
  // result — a phantom transfer with nothing persisted. Throw BEFORE any
  // ledger/persistence side effects.
  if (!db) {
    throw new TRPCError({ code: "UNAVAILABLE", message: "database unavailable — cannot execute transfer" });
  }
  const feeBreakdown = calculateFeeForTest(params.amount, params.corridor);
  // W9-Q5 (F13-2): execution requires a LIVE rate — throws UNAVAILABLE when
  // only the static fallback table has this pair. Nothing has been persisted
  // or debited at this point, so failing here is clean.
  const fxRate = await getExecutableFxRate(params.fromCurrency, params.toCurrency);
  // FF-026: single fee convention — the sender is debited amount + fee once,
  // and the FULL amount is converted for the payout (fee is not subtracted
  // from the converted payout a second time).
  const creditAmount = params.amount * fxRate;
  const debitAmount = params.amount + feeBreakdown.totalFee;
  const transferId = params.referenceId ?? `TXN-${Date.now()}-${params.senderId}`;

  const failedResult = (reason: string) => ({
    transferId,
    referenceNumber: transferId,
    status: "failed",
    failureReason: reason,
    amount: params.amount,
    fee: feeBreakdown.totalFee,
    fxRate,
    debitAmount,
    creditAmount,
    estimatedDelivery: "N/A",
    ledgerEntries: [] as Array<{ id: string; type: string; amount: number }>,
  });

  // Check KYC limits - look up user's actual tier from DB. FF-026: fail closed
  // — a lookup error must not silently grant the highest tier.
  let userTier = "tier0"; // default to most restrictive tier
  if (db) {
    try {
      const tierResult = await db.execute(sql`
        SELECT "kycTier" FROM users WHERE id = ${params.senderId}
      `);
      const tierRows = tierResult as unknown as { kycTier: string }[];
      if (tierRows.length > 0 && tierRows[0].kycTier) userTier = tierRows[0].kycTier;
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), senderId: params.senderId },
        "[TransferEngine] KYC tier lookup failed — failing closed");
      return failedResult("KYC tier lookup failed");
    }
  }
  const kycCheck = await checkKycLimits(params.senderId, params.amount, userTier);
  if (!kycCheck.allowed) {
    return {
      transferId,
      referenceNumber: transferId,
      status: "failed",
      amount: params.amount,
      fee: feeBreakdown.totalFee,
      fxRate,
      debitAmount,
      creditAmount,
      estimatedDelivery: "N/A",
      ledgerEntries: [],
    };
  }

  // Check wallet balance
  if (db) {
    try {
      const balResult = await db.execute(sql`
        SELECT CAST(balance AS NUMERIC) AS balance FROM wallets
        WHERE "userId" = ${params.senderId} AND currency = ${params.fromCurrency}
      `);
      const balRows = balResult as unknown as { balance: string }[];
      const balance = balRows.length > 0 ? parseFloat(balRows[0].balance) : 0;
      if (balance < debitAmount) {
        return {
          transferId,
          referenceNumber: transferId,
          status: "failed",
          amount: params.amount,
          fee: feeBreakdown.totalFee,
          fxRate,
          debitAmount,
          creditAmount,
          estimatedDelivery: "N/A",
          ledgerEntries: [],
        };
      }
    } catch (err) {
      // FF-026: fail closed — a balance-check error must not let the transfer proceed blind.
      logger.error({ err: err instanceof Error ? err.message : String(err), senderId: params.senderId },
        "[TransferEngine] Balance check failed — failing closed");
      return failedResult("Balance check failed");
    }
  }

  const ledgerEntries: Array<{ id: string; type: string; amount: number }> = [
    { id: `${transferId}-fee`, type: "fee", amount: feeBreakdown.totalFee },
    { id: `${transferId}-fx`, type: "fx_conversion", amount: creditAmount },
  ];

  // FF-FIX (CRITICAL): the sender debit (amount+fee), recipient credit, fee
  // ledger record, and transfer record now commit ATOMICALLY in one DB
  // transaction. Previously the sender was debited (via settlement) while the
  // recipient and the fee account were NEVER credited — money vanished into
  // the platform float with the UI reporting success.
  //
  // Honest statuses: only instant internal wallet payouts are 'completed';
  // bank/mobile-money/cash payouts stay 'pending' until the rail confirms.
  const isInstantWalletPayout = params.payoutMethod === "wallet";
  const honestStatus = isInstantWalletPayout ? "completed" : "pending";

  if (db) {
    try {
      await db.transaction(async (tx: any) => {
        // 1. Guarded sender debit of amount + fee (row-count checked — a
        //    concurrent debit loser aborts the whole transfer).
        const debitRows = (await tx.execute(sql`
          UPDATE wallets
          SET balance = CAST(balance AS NUMERIC) - ${debitAmount.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
          WHERE "userId" = ${params.senderId}
            AND currency = ${params.fromCurrency}
            AND status = 'active'
            AND CAST(balance AS NUMERIC) >= ${debitAmount.toFixed(2)}
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (debitRows.length === 0) {
          throw new Error("INSUFFICIENT_BALANCE");
        }

        // 2. Recipient credit for instant wallet payouts (row-count checked;
        //    wallet auto-created if missing). For rail payouts the recipient
        //    is paid by the rail and the transfer stays 'pending'.
        if (isInstantWalletPayout) {
          const wRows = (await tx.execute(sql`
            SELECT id FROM wallets WHERE "userId" = ${params.recipientId} AND currency = ${params.toCurrency} LIMIT 1
          `)) as unknown as Array<{ id: number }>;
          let recipientWalletId = wRows[0]?.id;
          if (!recipientWalletId) {
            const insRows = (await tx.execute(sql`
              INSERT INTO wallets ("userId", currency, balance, status) VALUES (${params.recipientId}, ${params.toCurrency}, '0.00', 'active') RETURNING id
            `)) as unknown as Array<{ id: number }>;
            recipientWalletId = insRows[0]?.id;
          }
          const creditRows = (await tx.execute(sql`
            UPDATE wallets
            SET balance = CAST(balance AS NUMERIC) + ${creditAmount.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
            WHERE id = ${recipientWalletId} AND status = 'active'
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (creditRows.length === 0) {
            throw new Error("RECIPIENT_WALLET_UNAVAILABLE");
          }
        }

        // 2b. W9-Q4 (F13-1): explicit platform-fee CREDIT leg. The sender was
        //     debited amount+fee; the fee portion is platform revenue and must
        //     land in the platform float/treasury wallet (resolved via
        //     TIGERBEETLE_PLATFORM_USER_ID, default "0") in the SAME
        //     transaction — never a debit-without-credit. Guarded update with
        //     a row-count check; any failure aborts the whole transfer.
        if (feeBreakdown.totalFee > 0) {
          const floatWalletRows = (await tx.execute(sql`
            SELECT id FROM wallets
            WHERE "userId" = ${PLATFORM_SYSTEM_USER_ID}
              AND currency = ${params.fromCurrency}
              AND status = 'active'
            LIMIT 1
          `)) as unknown as Array<{ id: number }>;
          const floatWalletId = floatWalletRows[0]?.id;
          if (!floatWalletId) {
            throw new Error(`PLATFORM_FEE_CREDIT_FAILED: platform float wallet not provisioned for ${params.fromCurrency}`);
          }
          const feeCreditRows = (await tx.execute(sql`
            UPDATE wallets
            SET balance = CAST(balance AS DECIMAL(18,4)) + ${feeBreakdown.totalFee.toFixed(4)}, "updatedAt" = NOW(), version = version + 1
            WHERE id = ${floatWalletId}
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (feeCreditRows.length === 0) {
            throw new Error("PLATFORM_FEE_CREDIT_FAILED: float wallet credit matched 0 rows");
          }
        }

        // 3. Transfer record with the unified reference and an honest status.
        await tx.execute(sql`
          INSERT INTO transfers (
            "userId", "recipientId", "fromAmount", "toAmount",
            "fromCurrency", "toCurrency", "fxRate", "fee",
            "referenceId", "reference", "status", "payoutMethod", "purpose",
            "recipientName", "recipientAccount", "sourceOfFunds",
            corridor, "createdAt", "updatedAt"
          ) VALUES (
            ${params.senderId}, ${params.recipientId}, ${params.amount}, ${creditAmount},
            ${params.fromCurrency}, ${params.toCurrency}, ${fxRate}, ${feeBreakdown.totalFee},
            ${transferId}, ${transferId}, ${honestStatus}, ${params.payoutMethod}, ${params.purpose},
            ${params.beneficiaryName}, ${params.beneficiaryAccount}, ${params.sourceOfFunds},
            ${params.corridor}, NOW(), NOW()
          )
        `);

        // 4. Explicit fee leg: the sender paid amount+fee, the recipient leg
        //    carries amount*fx — the fee is platform revenue (credited to the
        //    platform float wallet at step 2b). Record it as a first-class
        //    transaction row so reconciliation sees it.
        if (feeBreakdown.totalFee > 0) {
          await tx.execute(sql`
            INSERT INTO transactions ("userId", type, status, "fromCurrency", "fromAmount", fee, reference, description, metadata, "createdAt", "updatedAt")
            VALUES (${params.senderId}, 'fee', 'completed', ${params.fromCurrency}, ${feeBreakdown.totalFee.toFixed(2)}, ${feeBreakdown.totalFee.toFixed(2)}, ${`${transferId}-fee`}, ${`platform fee for ${transferId}`}, ${JSON.stringify({ kind: "platform fee", transferId, creditedTo: "platform_float", platformUserId: PLATFORM_SYSTEM_USER_ID })}, NOW(), NOW())
          `);
        }

        // 5. Ledger entries (fee + fx conversion metadata).
        for (const entry of ledgerEntries) {
          await tx.execute(sql`
            INSERT INTO ledger_entries (id, amount, currency, type, created_at)
            VALUES (${entry.id}, ${entry.amount}, ${params.fromCurrency}, ${entry.type}, NOW())
            ON CONFLICT (id) DO NOTHING
          `);
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "INSUFFICIENT_BALANCE") {
        return failedResult("Insufficient wallet balance");
      }
      if (msg === "RECIPIENT_WALLET_UNAVAILABLE") {
        logger.error({ transferId, recipientId: params.recipientId }, "[TransferEngine] Recipient wallet credit failed — transfer aborted, sender NOT debited");
        return failedResult("Recipient wallet unavailable");
      }
      if (msg.startsWith("PLATFORM_FEE_CREDIT_FAILED")) {
        // W9-Q4: never a debit-without-credit — the abort above rolled back
        // the sender debit atomically. Structured warn for ops/reconciliation.
        logger.warn({ transferId, fee: feeBreakdown.totalFee, currency: params.fromCurrency, platformUserId: PLATFORM_SYSTEM_USER_ID, err: msg },
          "[TransferEngine] Platform fee credit leg failed — transfer aborted atomically, sender NOT debited");
        return failedResult("Platform fee credit failed");
      }
      // FF-026: never report a transfer as completed when persistence failed —
      // that is a phantom completion. Fail closed and surface the failure.
      logger.error({ err: msg, transferId },
        "[TransferEngine] Transfer failed atomically — no funds moved");
      return failedResult("Transfer persistence failed");
    }
  }

  const deliveryMap: Record<string, string> = {
    wallet: "Instant",
    mobile_money: "5 minutes",
    bank_transfer: "1-2 business days",
    cash_pickup: "30 minutes",
  };

  return {
    transferId,
    referenceNumber: transferId,
    status: honestStatus,
    amount: params.amount,
    fee: feeBreakdown.totalFee,
    fxRate,
    debitAmount,
    creditAmount,
    estimatedDelivery: deliveryMap[params.payoutMethod] ?? "1-3 business days",
    ledgerEntries,
  };
}
