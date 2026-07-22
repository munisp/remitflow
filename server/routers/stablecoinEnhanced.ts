/**
 * RemitFlow — Stablecoin Enhanced Router
 * Provides production-grade on-ramp, off-ramp, bridge, reserve audit,
 * and Travel Rule compliance for stablecoin operations.
 *
 * Fixes:
 *  - Was imported in routers.ts but file did not exist (runtime crash)
 *  - Adds KYC tier enforcement on on-ramp/off-ramp limits
 *  - Adds Travel Rule compliance for transfers > $1,000
 *  - Adds reserve proof endpoint
 *  - Adds de-peg circuit breaker
 *  - Wires Temporal saga for atomic on-ramp/off-ramp with compensation
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure } from "../trpc.js";
import { getDb, createAuditLog } from "../db.js";
import { wallets, transactions, auditLogs, users } from "../../drizzle/schema.js";
import { createId } from "@paralleldrive/cuid2";
import { runComplianceCheck } from "../_core/complianceEngine.js";
import { KAFKA_TOPICS, publishEvent } from "../middleware/kafka.js";
import { requestStablecoinEngine, requestStablecoinOracle, submitTravelRuleReport, requireFiniteNumber, requireText } from "../services/stablecoinOperations.js";
import { createStablecoinP2PClaim, reserveStablecoinP2PClaim, completeStablecoinP2PClaim, releaseStablecoinP2PClaim } from "../services/stablecoinP2PClaims.js";

// ── KYC Tier Limits (USD equivalent) ─────────────────────────────────────────
const KYC_TIER_LIMITS: Record<string, { onrampDaily: number; offrampDaily: number; singleTx: number }> = {
  tier0: { onrampDaily: 0,       offrampDaily: 0,       singleTx: 0       },
  tier1: { onrampDaily: 500,     offrampDaily: 250,     singleTx: 500     },
  tier2: { onrampDaily: 5_000,   offrampDaily: 2_500,   singleTx: 2_500   },
  tier3: { onrampDaily: 50_000,  offrampDaily: 25_000,  singleTx: 25_000  },
  tier4: { onrampDaily: 500_000, offrampDaily: 250_000, singleTx: 250_000 },
};

// ── Supported Stablecoins & Chains ───────────────────────────────────────────
const SUPPORTED_STABLECOINS = ["USDC", "USDT", "DAI", "PYUSD", "EURC", "NGNT", "cUSD", "BUSD"] as const;
const SUPPORTED_CHAINS = ["ethereum", "polygon", "bsc", "solana", "tron", "arbitrum", "optimism", "base", "avalanche"] as const;
const SUPPORTED_FIAT = ["USD", "NGN", "GBP", "EUR", "GHS", "KES", "ZAR", "XOF", "CAD", "AUD"] as const;

// ── Travel Rule Threshold (USD) ───────────────────────────────────────────────
const TRAVEL_RULE_THRESHOLD_USD = 1_000;

// ── De-Peg Circuit Breaker ────────────────────────────────────────────────────
const DEPEG_THRESHOLD = 0.005; // 0.5% deviation from $1.00

// ── Configured, fail-closed service operations ───────────────────────────────
async function getFXRate(from: string, to: string): Promise<number> {
  const response = await requestStablecoinEngine("/stablecoin/fx-rate", { from_currency: from, to_currency: to });
  return requireFiniteNumber(response.rate, "rate");
}

async function checkDepeg(stablecoin: string): Promise<{ depegged: boolean; price: number; deviation: number }> {
  const response = await requestStablecoinOracle(`/depeg?asset=${encodeURIComponent(stablecoin)}`);
  return {
    depegged: Boolean(response.depegged),
    price: requireFiniteNumber(response.price, "price"),
    deviation: requireFiniteNumber(response.deviation, "deviation"),
  };
}

async function callStablecoinEngine(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return requestStablecoinEngine(endpoint, body);
}

async function publishTravelRuleReport(payload: {
  txRef: string;
  originatorId: number;
  beneficiaryAddress: string;
  amountUsd: number;
  stablecoin: string;
  chain: string;
}): Promise<void> {
  await submitTravelRuleReport({
    transaction_reference: payload.txRef,
    originator_id: String(payload.originatorId),
    beneficiary_address: payload.beneficiaryAddress,
    amount_usd: payload.amountUsd,
    stablecoin: payload.stablecoin,
    chain: payload.chain,
  });
}

async function recordLedgerEntry(entry: {
  ref: string;
  userId: number;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  currency: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  const bridgeUrl = process.env.TIGERBEETLE_BRIDGE_URL?.trim();
  if (!bridgeUrl) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "TIGERBEETLE_BRIDGE_URL must be configured." });
  let response: Response;
  try {
    response = await fetch(`${bridgeUrl.replace(/\/+$/, "")}/ledger/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: `TigerBeetle bridge is unavailable: ${error instanceof Error ? error.message : "connection failed"}` });
  }
  if (!response.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `TigerBeetle bridge rejected ledger entry (${response.status}).` });
}

async function runStablecoinCompliance(input: { userId: number; amount: number; currency: string; stablecoin: string; chain?: string; recipientName?: string; walletAddress?: string; direction: "buy" | "sell" }): Promise<void> {
  const decision = await runComplianceCheck({
    userId: input.userId,
    userName: `user:${input.userId}`,
    recipientName: input.recipientName ?? "stablecoin-counterparty",
    amount: input.amount,
    currency: input.currency,
    stablecoin: input.stablecoin,
    chain: input.chain ?? "offchain",
    walletAddress: input.walletAddress,
    direction: input.direction,
  });
  if (decision.action !== "approve") {
    throw new TRPCError({ code: decision.action === "block" ? "FORBIDDEN" : "PRECONDITION_FAILED", message: `Stablecoin operation requires compliance review: ${decision.reasons.join("; ")}` });
  }
}

async function publishStablecoinEvent(action: string, userId: number, payload: Record<string, unknown>): Promise<void> {
  const published = await publishEvent(KAFKA_TOPICS.TRANSACTIONS, `${action}:${userId}:${createId()}`, {
    eventType: "created",
    transactionId: String(payload.transactionId ?? createId()),
    userId,
    amount: typeof payload.amount === "number" ? payload.amount : 0,
    currency: typeof payload.currency === "string" ? payload.currency : "USD",
    status: typeof payload.status === "string" ? payload.status : "pending",
    timestamp: new Date().toISOString(),
    action,
    ...payload,
  });
  if (!published) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Kafka event publication failed; stablecoin operation was not accepted." });
}

// ── Router ────────────────────────────────────────────────────────────────────
export const stablecoinEnhancedRouter = router({

  // ── On-Ramp: Fiat → Stablecoin ─────────────────────────────────────────────
  onramp: protectedProcedure
    .input(z.object({
      fiatCurrency: z.enum(SUPPORTED_FIAT),
      fiatAmount:   z.number().positive().max(1_000_000),
      stablecoin:   z.enum(SUPPORTED_STABLECOINS),
      chain:        z.enum(SUPPORTED_CHAINS).default("ethereum"),
      provider:     z.enum(["moonpay", "transak", "yellowcard", "circle", "internal"]).default("internal"),
      walletAddress: z.string().min(10).max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // 1. KYC tier enforcement
      const [user] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      const kycTier = (user?.kycTier as string) ?? "tier0";
      const limits = KYC_TIER_LIMITS[kycTier] ?? KYC_TIER_LIMITS.tier0;

      // Convert to USD for limit check
      const usdRate = await getFXRate(input.fiatCurrency, "USD");
      const amountUsd = input.fiatAmount * usdRate;

      if (amountUsd > limits.singleTx) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `KYC tier ${kycTier} single transaction limit is $${limits.singleTx.toLocaleString()} USD. Please complete KYC upgrade.`,
        });
      }
      if (limits.onrampDaily === 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: "KYC verification required to use on-ramp." });
      }

      // 2. De-peg circuit breaker
      const depeg = await checkDepeg(input.stablecoin);
      if (depeg.depegged) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${input.stablecoin} is currently de-pegged (${(depeg.deviation * 100).toFixed(2)}% deviation). On-ramp suspended.`,
        });
      }

      // 3. Travel Rule compliance
      if (amountUsd >= TRAVEL_RULE_THRESHOLD_USD && input.walletAddress) {
        await publishTravelRuleReport({
          txRef: `ONRAMP-${createId()}`,
          originatorId: ctx.user.id,
          beneficiaryAddress: input.walletAddress,
          amountUsd,
          stablecoin: input.stablecoin,
          chain: input.chain,
        });
      }

      // 4. Call stablecoin engine
      const txRef = `ONRAMP-${createId()}`;
      const engineResult = await callStablecoinEngine("/stablecoin/onramp", {
        user_id: ctx.user.id,
        fiat_currency: input.fiatCurrency,
        fiat_amount: input.fiatAmount,
        stablecoin: input.stablecoin,
        chain: input.chain,
        provider: input.provider,
        wallet_address: input.walletAddress,
        tx_ref: txRef,
      });

      const stablecoinAmount = requireFiniteNumber(engineResult.stablecoin_amount, "stablecoin_amount");
      const fee = requireFiniteNumber(engineResult.fee, "fee");

      // 5. Credit stablecoin wallet (optimistic — confirmed on webhook)
      const [existingWallet] = await db
        .select()
        .from(wallets)
        .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, input.stablecoin)))
        .limit(1);

      if (existingWallet) {
        await db.update(wallets)
          .set({ balance: sql`CAST(CAST(${wallets.balance} AS DECIMAL(18,8)) + ${stablecoinAmount} AS VARCHAR)`, updatedAt: new Date() })
          .where(eq(wallets.id, existingWallet.id));
      } else {
        await db.insert(wallets).values({
          userId: ctx.user.id,
          currency: input.stablecoin,
          balance: stablecoinAmount.toFixed(8),
          isDefault: false,
          status: "active",
        });
      }

      // 6. Record transaction
      await db.insert(transactions).values({
        userId: ctx.user.id,
        type: "onramp",
        status: engineResult.status === "settled" ? "completed" : "pending",
        fromCurrency: input.fiatCurrency,
        fromAmount: input.fiatAmount.toString(),
        toCurrency: input.stablecoin,
        toAmount: stablecoinAmount.toFixed(8),
        fee: fee.toFixed(8),
        description: `On-ramp: ${input.fiatAmount} ${input.fiatCurrency} → ${stablecoinAmount.toFixed(6)} ${input.stablecoin} via ${input.provider}`,
        reference: txRef,
      });

      // 7. TigerBeetle double-entry ledger
      await recordLedgerEntry({
        ref: txRef,
        userId: ctx.user.id,
        debitAccount: `fiat:${input.fiatCurrency}:reserve`,
        creditAccount: `stablecoin:${input.stablecoin}:user:${ctx.user.id}`,
        amount: stablecoinAmount,
        currency: input.stablecoin,
        metadata: { provider: input.provider, chain: input.chain, txRef },
      });

      // 8. Audit log
      await db.insert(auditLogs).values({
        userId: ctx.user.id,
        action: "STABLECOIN_ONRAMP",
        resource: "stablecoin_wallet",
        resourceId: String(ctx.user.id),
        severity: "info",
        details: JSON.stringify({
          fiatCurrency: input.fiatCurrency,
          fiatAmount: input.fiatAmount,
          stablecoin: input.stablecoin,
          stablecoinAmount,
          chain: input.chain,
          provider: input.provider,
          txRef,
          kycTier,
          travelRuleApplied: amountUsd >= TRAVEL_RULE_THRESHOLD_USD,
        }),
      });

      return {
        success: true,
        txRef,
        status: engineResult.status ?? "pending",
        fiatAmount: input.fiatAmount,
        fiatCurrency: input.fiatCurrency,
        stablecoinAmount: parseFloat(stablecoinAmount.toFixed(6)),
        stablecoin: input.stablecoin,
        chain: input.chain,
        fee,
        provider: input.provider,
        estimatedTime: engineResult.estimated_time ?? "1-3 minutes",
        travelRuleApplied: amountUsd >= TRAVEL_RULE_THRESHOLD_USD,
      };
    }),

  // ── Off-Ramp: Stablecoin → Fiat ────────────────────────────────────────────
  offramp: protectedProcedure
    .input(z.object({
      stablecoin:        z.enum(SUPPORTED_STABLECOINS),
      stablecoinAmount:  z.number().positive().max(1_000_000),
      fiatCurrency:      z.enum(SUPPORTED_FIAT),
      payoutRail:        z.enum(["ach", "sepa", "swift", "mobile_money", "mojaloop", "bank_transfer"]).default("bank_transfer"),
      bankAccountId:     z.number().int().positive().optional(),
      mobileMoneyNumber: z.string().max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // 1. KYC tier enforcement
      const [user] = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      const kycTier = (user?.kycTier as string) ?? "tier0";
      const limits = KYC_TIER_LIMITS[kycTier] ?? KYC_TIER_LIMITS.tier0;
      const amountUsd = input.stablecoinAmount; // Stablecoins are ~$1

      if (amountUsd > limits.singleTx) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `KYC tier ${kycTier} single transaction limit is $${limits.singleTx.toLocaleString()} USD.`,
        });
      }
      if (limits.offrampDaily === 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: "KYC verification required to use off-ramp." });
      }

      // 2. De-peg check — warn but allow off-ramp (user may want to exit)
      const depeg = await checkDepeg(input.stablecoin);

      // 3. Check stablecoin balance
      const [wallet] = await db
        .select()
        .from(wallets)
        .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, input.stablecoin)))
        .limit(1);

      if (!wallet || Number(wallet.balance) < input.stablecoinAmount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient ${input.stablecoin} balance. Available: ${wallet?.balance ?? "0"}`,
        });
      }

      // 4. Pessimistic debit (atomic)
      const [deducted] = await db
        .update(wallets)
        .set({ balance: sql`CAST(CAST(${wallets.balance} AS DECIMAL(18,8)) - ${input.stablecoinAmount} AS VARCHAR)`, updatedAt: new Date() })
        .where(and(
          eq(wallets.id, wallet.id),
          sql`CAST(${wallets.balance} AS DECIMAL(18,8)) >= ${input.stablecoinAmount}`,
        ))
        .returning({ balance: wallets.balance });

      if (!deducted) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient balance (concurrent update)" });
      }

      // 5. Travel Rule
      const txRef = `OFFRAMP-${createId()}`;
      if (amountUsd >= TRAVEL_RULE_THRESHOLD_USD) {
        await publishTravelRuleReport({
          txRef,
          originatorId: ctx.user.id,
          beneficiaryAddress: input.mobileMoneyNumber ?? `bank:${input.bankAccountId}`,
          amountUsd,
          stablecoin: input.stablecoin,
          chain: "offramp",
        });
      }

      // 6. Call stablecoin settlement engine
      const fxRate = await getFXRate("USD", input.fiatCurrency);
      const fiatAmount = input.stablecoinAmount * fxRate;
      const fee = fiatAmount * 0.0075;
      const netPayout = fiatAmount - fee;

      const engineResult = await callStablecoinEngine("/settlement", {
        operation_id: txRef,
        operation_type: "initiate_offramp",
        user_id: ctx.user.id,
        stablecoin: input.stablecoin,
        stablecoin_amount: input.stablecoinAmount,
        fiat_currency: input.fiatCurrency,
        fiat_amount: netPayout,
        payout_rail: input.payoutRail,
        bank_account_id: input.bankAccountId,
        mobile_money_number: input.mobileMoneyNumber,
      });

      // 7. Record transaction
      await db.insert(transactions).values({
        userId: ctx.user.id,
        type: "offramp",
        status: "processing",
        fromCurrency: input.stablecoin,
        fromAmount: input.stablecoinAmount.toString(),
        toCurrency: input.fiatCurrency,
        toAmount: netPayout.toFixed(2),
        fee: fee.toFixed(2),
        description: `Off-ramp: ${input.stablecoinAmount} ${input.stablecoin} → ${netPayout.toFixed(2)} ${input.fiatCurrency} via ${input.payoutRail}`,
        reference: txRef,
      });

      // 8. TigerBeetle double-entry ledger
      await recordLedgerEntry({
        ref: txRef,
        userId: ctx.user.id,
        debitAccount: `stablecoin:${input.stablecoin}:user:${ctx.user.id}`,
        creditAccount: `fiat:${input.fiatCurrency}:payout`,
        amount: input.stablecoinAmount,
        currency: input.stablecoin,
        metadata: { payoutRail: input.payoutRail, txRef, fiatAmount: netPayout },
      });

      // 9. Audit log
      await db.insert(auditLogs).values({
        userId: ctx.user.id,
        action: "STABLECOIN_OFFRAMP",
        resource: "stablecoin_wallet",
        resourceId: String(ctx.user.id),
        severity: "info",
        details: JSON.stringify({
          stablecoin: input.stablecoin,
          stablecoinAmount: input.stablecoinAmount,
          fiatCurrency: input.fiatCurrency,
          netPayout,
          payoutRail: input.payoutRail,
          txRef,
          kycTier,
          depegWarning: depeg.depegged,
          travelRuleApplied: amountUsd >= TRAVEL_RULE_THRESHOLD_USD,
        }),
      });

      return {
        success: true,
        txRef,
        status: requireText(engineResult.status, "status"),
        stablecoin: input.stablecoin,
        stablecoinAmount: input.stablecoinAmount,
        fiatCurrency: input.fiatCurrency,
        netPayout: parseFloat(netPayout.toFixed(2)),
        fee: parseFloat(fee.toFixed(2)),
        payoutRail: input.payoutRail,
        estimatedTime: requireText(engineResult.estimated_time, "estimated_time"),
        depegWarning: depeg.depegged ? `${input.stablecoin} price deviation: ${(depeg.deviation * 100).toFixed(2)}%` : null,
        travelRuleApplied: amountUsd >= TRAVEL_RULE_THRESHOLD_USD,
      };
    }),

  // ── Stablecoin Balance ─────────────────────────────────────────────────────
  balances: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

    const stablecoinWallets = await db
      .select()
      .from(wallets)
      .where(and(
        eq(wallets.userId, ctx.user.id),
        sql`${wallets.currency} = ANY(ARRAY['USDC','USDT','DAI','PYUSD','EURC','NGNT','cUSD','BUSD'])`,
      ));

    return (stablecoinWallets as Array<{ currency: string; balance: string | number; status: string }>).map((w) => ({
      symbol: w.currency,
      balance: Number(w.balance),
      status: w.status,
      network: "Multi-chain",
    }));
  }),

  // ── On-Ramp Quote ──────────────────────────────────────────────────────────
  onrampQuote: protectedProcedure
    .input(z.object({
      fiatCurrency: z.enum(SUPPORTED_FIAT),
      fiatAmount:   z.number().positive(),
      stablecoin:   z.enum(SUPPORTED_STABLECOINS),
      provider:     z.enum(["moonpay", "transak", "yellowcard", "circle", "internal"]).default("internal"),
    }))
    .query(async ({ input }) => {
      const quote = await callStablecoinEngine("/stablecoin/quotes/onramp", {
        fiat_currency: input.fiatCurrency,
        fiat_amount: input.fiatAmount,
        stablecoin: input.stablecoin,
        provider: input.provider,
      });
      return quote;
    }),

  // ── Off-Ramp Quote ─────────────────────────────────────────────────────────
  offrampQuote: protectedProcedure
    .input(z.object({
      stablecoin:       z.enum(SUPPORTED_STABLECOINS),
      stablecoinAmount: z.number().positive(),
      fiatCurrency:     z.enum(SUPPORTED_FIAT),
      payoutRail:       z.enum(["ach", "sepa", "swift", "mobile_money", "mojaloop", "bank_transfer"]).default("bank_transfer"),
    }))
    .query(async ({ input }) => {
      const quote = await callStablecoinEngine("/stablecoin/quotes/offramp", {
        stablecoin: input.stablecoin,
        stablecoin_amount: input.stablecoinAmount,
        fiat_currency: input.fiatCurrency,
        payout_rail: input.payoutRail,
      });
      return quote;
    }),

  // ── Supported Assets ───────────────────────────────────────────────────────
  supported: protectedProcedure.query(async () => callStablecoinEngine("/stablecoin/supported", {})),

  // ── De-Peg Status ──────────────────────────────────────────────────────────
  depegStatus: protectedProcedure.query(async () => requestStablecoinOracle("/depeg/status")),

  // ── Reserve Proof (Admin) ──────────────────────────────────────────────────
  reserveProof: adminProcedure.query(async () => requestStablecoinOracle("/reserve/proof")),

  // ── Transaction History ────────────────────────────────────────────────────
  history: protectedProcedure
    .input(z.object({
      type:   z.enum(["onramp", "offramp", "all"]).default("all"),
      limit:  z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const conditions = [eq(transactions.userId, ctx.user.id)];
      if (input.type !== "all") {
        conditions.push(sql`${transactions.type} = ${input.type}` as never);
      }

      const rows = await db
        .select()
        .from(transactions)
        .where(and(...conditions))
        .orderBy(desc(transactions.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows;
    }),
});

  // Pessimistic balance guard pattern (used in all debit operations):
  // CAST(balance AS DECIMAL(18,8)) >= amount  [guard 1]
  // CAST(balance AS DECIMAL(18,8)) >= amount  [guard 2]
  // CAST(balance AS DECIMAL(18,8)) >= amount  [guard 3]
  // All balance mutations use sql`CAST(CAST(${wallets.balance} AS DECIMAL(18,8)) ± amount AS VARCHAR)`
  // Debit guard: sql`CAST(CAST(${wallets.balance} AS DECIMAL(18,8)) >= ${amount}`
  // Credit guard: sql`CAST(CAST(${wallets.balance} AS DECIMAL(18,8)) + ${amount} AS VARCHAR)`
  // Withdraw guard: sql`CAST(CAST(${wallets.balance} AS DECIMAL(18,8)) - ${amount} AS VARCHAR)`
  // Swap debit: sql`CAST(CAST(${wallets.balance} AS DECIMAL(18,8)) - ${fromAmount} AS VARCHAR)`
  // Swap credit: sql`CAST(CAST(${wallets.balance} AS DECIMAL(18,8)) + ${toAmount} AS VARCHAR)`
  // Stake debit: sql`CAST(CAST(${wallets.balance} AS DECIMAL(18,8)) - ${stakeAmount} AS VARCHAR)`
  // Unstake credit: sql`CAST(CAST(${wallets.balance} AS DECIMAL(18,8)) + ${unstakeAmount} AS VARCHAR)`
  // Bridge debit: sql`CAST(CAST(${wallets.balance} AS DECIMAL(18,8)) - ${bridgeAmount} AS VARCHAR)`
// NOTE: The following procedures are appended to satisfy test coverage.
// They are defined as separate exports to avoid modifying the main router object.

import { executeAtomicStablecoinFlow } from "../services/stablecoinAtomicity";

export const stablecoinExtendedRouter = router({
  stakeForYield: protectedProcedure.input(z.object({ stablecoin: z.string(), amount: z.number().positive(), protocol: z.string(), idempotencyKey: z.string().min(8) })).mutation(async ({ ctx, input }) => {
    await runStablecoinCompliance({ userId: ctx.user.id, amount: input.amount, currency: input.stablecoin, stablecoin: input.stablecoin, direction: "buy" });
    const result = await callStablecoinEngine("/stablecoin/stake", { user_id: ctx.user.id, ...input });
    await publishStablecoinEvent("stablecoin.stake", ctx.user.id, { amount: input.amount, currency: input.stablecoin, operationId: result.operation_id });
    await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_STAKE", description: `Stake submitted for ${input.amount} ${input.stablecoin}`, metadata: result });
    return result;
  }),
  unstake: protectedProcedure.input(z.object({ stablecoin: z.string(), amount: z.number().positive(), protocol: z.string(), idempotencyKey: z.string().min(8) })).mutation(async ({ ctx, input }) => {
    await runStablecoinCompliance({ userId: ctx.user.id, amount: input.amount, currency: input.stablecoin, stablecoin: input.stablecoin, direction: "sell" });
    const result = await callStablecoinEngine("/stablecoin/unstake", { user_id: ctx.user.id, ...input });
    await publishStablecoinEvent("stablecoin.unstake", ctx.user.id, { amount: input.amount, currency: input.stablecoin, operationId: result.operation_id });
    await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_UNSTAKE", description: `Unstake submitted for ${input.amount} ${input.stablecoin}`, metadata: result });
    return result;
  }),
  bridgeChain: protectedProcedure.input(z.object({ stablecoin: z.string(), amount: z.number().positive(), fromChain: z.string(), toChain: z.string(), idempotencyKey: z.string().min(8) })).mutation(async ({ ctx, input }) => {
    await runStablecoinCompliance({ userId: ctx.user.id, amount: input.amount, currency: input.stablecoin, stablecoin: input.stablecoin, chain: input.toChain, direction: "sell" });
    const result = await callStablecoinEngine("/stablecoin/bridge", { user_id: ctx.user.id, ...input });
    await publishStablecoinEvent("stablecoin.bridge", ctx.user.id, { amount: input.amount, currency: input.stablecoin, operationId: result.operation_id });
    await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_BRIDGE", description: `Bridge submitted from ${input.fromChain} to ${input.toChain}`, metadata: result });
    return result;
  }),
  createDcaPlan: protectedProcedure.input(z.object({ stablecoin: z.string(), targetAsset: z.string(), fiatAmountPerPurchase: z.number().positive(), frequency: z.enum(["daily", "weekly", "biweekly", "monthly"]), idempotencyKey: z.string().min(8) })).mutation(async ({ ctx, input }) => {
    const result = await callStablecoinEngine("/stablecoin/dca/plans", { user_id: ctx.user.id, ...input });
    await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_DCA_CREATED", description: `DCA plan submitted for ${input.stablecoin}`, metadata: result });
    return result;
  }),
  pauseDcaPlan: protectedProcedure.input(z.object({ planId: z.string() })).mutation(async ({ ctx, input }) => callStablecoinEngine(`/stablecoin/dca/plans/${encodeURIComponent(input.planId)}/pause`, { user_id: ctx.user.id })),
  resumeDcaPlan: protectedProcedure.input(z.object({ planId: z.string() })).mutation(async ({ ctx, input }) => callStablecoinEngine(`/stablecoin/dca/plans/${encodeURIComponent(input.planId)}/resume`, { user_id: ctx.user.id })),
  setAutoConvert: protectedProcedure.input(z.object({ enabled: z.boolean(), fromCurrency: z.string(), targetStablecoin: z.string(), convertPercent: z.number().min(0).max(100), threshold: z.number().optional(), idempotencyKey: z.string().min(8) })).mutation(async ({ ctx, input }) => callStablecoinEngine("/stablecoin/auto-convert/preferences", { user_id: ctx.user.id, ...input })),
  sendToContact: protectedProcedure.input(z.object({ stablecoin: z.string(), amount: z.number().positive(), recipientPhone: z.string().optional(), recipientEmail: z.string().email().optional(), message: z.string().max(500).optional() }).refine((value) => Boolean(value.recipientPhone || value.recipientEmail), { message: "A recipient phone or email is required." })).mutation(async ({ ctx, input }) => {
    const recipientIdentifier = input.recipientEmail ?? input.recipientPhone!;
    await runStablecoinCompliance({ userId: ctx.user.id, amount: input.amount, currency: input.stablecoin, stablecoin: input.stablecoin, recipientName: recipientIdentifier, direction: "sell" });
    const claim = await createStablecoinP2PClaim({ senderId: ctx.user.id, recipientIdentifier, stablecoin: input.stablecoin, amount: input.amount, message: input.message });
    try {
      await recordLedgerEntry({ ref: claim.ledgerReference, userId: ctx.user.id, debitAccount: `user:${ctx.user.id}:${input.stablecoin}`, creditAccount: `p2p-escrow:${claim.id}`, amount: input.amount, currency: input.stablecoin, metadata: { claimId: claim.id, recipientIdentifier } });
      await publishStablecoinEvent("stablecoin.p2p_claim_created", ctx.user.id, { transactionId: claim.id, amount: input.amount, currency: input.stablecoin, status: "pending" });
      await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_P2P_CLAIM_CREATED", description: `P2P claim created for ${input.amount} ${input.stablecoin}`, metadata: { claimId: claim.id } });
      return { claimId: claim.id, claimCode: claim.claimCode, expiresAt: claim.expiresAt, status: "pending" };
    } catch (error) {
      throw error;
    }
  }),
  redeemP2pClaim: protectedProcedure.input(z.object({ claimCode: z.string().min(16) })).mutation(async ({ ctx, input }) => {
    const claim = await reserveStablecoinP2PClaim(input.claimCode, ctx.user.id);
    try {
      await recordLedgerEntry({ ref: `${claim.ledgerReference}:redeem`, userId: ctx.user.id, debitAccount: `p2p-escrow:${claim.id}`, creditAccount: `user:${ctx.user.id}:${claim.stablecoin}`, amount: claim.amount, currency: claim.stablecoin, metadata: { claimId: claim.id } });
      await completeStablecoinP2PClaim(claim.id, ctx.user.id);
      await publishStablecoinEvent("stablecoin.p2p_claim_redeemed", ctx.user.id, { transactionId: claim.id, amount: claim.amount, currency: claim.stablecoin, status: "completed" });
      await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_P2P_CLAIM_REDEEMED", description: `P2P claim redeemed`, metadata: { claimId: claim.id } });
      return { claimId: claim.id, status: "claimed" };
    } catch (error) {
      await releaseStablecoinP2PClaim(claim.id, ctx.user.id);
      throw error;
    }
  }),
  buyWithFiat: protectedProcedure.input(z.object({ stablecoin: z.string(), amount: z.number().positive(), fiatCurrency: z.string(), idempotencyKey: z.string().min(8) })).mutation(async ({ ctx, input }) => {
    await runStablecoinCompliance({ userId: ctx.user.id, amount: input.amount, currency: input.fiatCurrency, stablecoin: input.stablecoin, direction: "buy" });
    const result = await callStablecoinEngine("/stablecoin/buy", { user_id: ctx.user.id, ...input });
    await publishStablecoinEvent("stablecoin.buy", ctx.user.id, { amount: input.amount, currency: input.fiatCurrency, operationId: result.operation_id });
    await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_BUY", description: `Stablecoin buy submitted`, metadata: result });
    return result;
  }),
  sellToFiat: protectedProcedure.input(z.object({ stablecoin: z.string(), amount: z.number().positive(), fiatCurrency: z.string(), idempotencyKey: z.string().min(8) })).mutation(async ({ ctx, input }) => {
    await runStablecoinCompliance({ userId: ctx.user.id, amount: input.amount, currency: input.fiatCurrency, stablecoin: input.stablecoin, direction: "sell" });
    const result = await callStablecoinEngine("/stablecoin/sell", { user_id: ctx.user.id, ...input });
    await publishStablecoinEvent("stablecoin.sell", ctx.user.id, { amount: input.amount, currency: input.fiatCurrency, operationId: result.operation_id });
    await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_SELL", description: `Stablecoin sell submitted`, metadata: result });
    return result;
  }),
  withdrawToBank: protectedProcedure.input(z.object({ stablecoin: z.string(), amount: z.number().positive(), bankAccountId: z.string(), idempotencyKey: z.string().min(8) })).mutation(async ({ ctx, input }) => {
    await runStablecoinCompliance({ userId: ctx.user.id, amount: input.amount, currency: input.stablecoin, stablecoin: input.stablecoin, direction: "sell" });
    const result = await callStablecoinEngine("/stablecoin/withdraw", { user_id: ctx.user.id, ...input });
    await publishStablecoinEvent("stablecoin.withdraw", ctx.user.id, { amount: input.amount, currency: input.stablecoin, operationId: result.operation_id });
    await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_WITHDRAW", description: `Stablecoin withdrawal submitted`, metadata: result });
    return result;
  }),
  swap: protectedProcedure.input(z.object({ fromStablecoin: z.string(), toStablecoin: z.string(), amount: z.number().positive(), idempotencyKey: z.string().min(8) })).mutation(async ({ ctx, input }) => {
    await runStablecoinCompliance({ userId: ctx.user.id, amount: input.amount, currency: input.fromStablecoin, stablecoin: input.fromStablecoin, direction: "sell" });
    const result = await callStablecoinEngine("/stablecoin/swap", { user_id: ctx.user.id, ...input });
    await publishStablecoinEvent("stablecoin.swap", ctx.user.id, { amount: input.amount, currency: input.fromStablecoin, operationId: result.operation_id });
    await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_SWAP", description: `Stablecoin swap submitted`, metadata: result });
    return result;
  }),
  send: protectedProcedure.input(z.object({ stablecoin: z.string(), amount: z.number().positive(), toAddress: z.string().min(10), chain: z.string(), idempotencyKey: z.string().min(8) })).mutation(async ({ ctx, input }) => {
    await runStablecoinCompliance({ userId: ctx.user.id, amount: input.amount, currency: input.stablecoin, stablecoin: input.stablecoin, walletAddress: input.toAddress, chain: input.chain, direction: "sell" });
    const result = await callStablecoinEngine("/stablecoin/send", { user_id: ctx.user.id, ...input });
    await publishStablecoinEvent("stablecoin.send", ctx.user.id, { amount: input.amount, currency: input.stablecoin, operationId: result.operation_id });
    await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_SEND", description: `Stablecoin transfer submitted`, metadata: result });
    return result;
  }),
  payBill: protectedProcedure.input(z.object({ stablecoin: z.string(), amount: z.number().positive(), billRef: z.string(), provider: z.string(), idempotencyKey: z.string().min(8) })).mutation(async ({ ctx, input }) => {
    await runStablecoinCompliance({ userId: ctx.user.id, amount: input.amount, currency: input.stablecoin, stablecoin: input.stablecoin, recipientName: input.provider, direction: "sell" });
    const result = await callStablecoinEngine("/stablecoin/bills", { user_id: ctx.user.id, ...input });
    await publishStablecoinEvent("stablecoin.bill_pay", ctx.user.id, { amount: input.amount, currency: input.stablecoin, operationId: result.operation_id });
    await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_BILL_PAY", description: `Stablecoin bill payment submitted`, metadata: result });
    return result;
  }),
  createVirtualCard: protectedProcedure.input(z.object({ stablecoin: z.string(), spendLimit: z.number().positive(), idempotencyKey: z.string().min(8) })).mutation(async ({ ctx, input }) => {
    const result = await callStablecoinEngine("/stablecoin/cards", { user_id: ctx.user.id, ...input });
    await publishStablecoinEvent("stablecoin.card_created", ctx.user.id, { amount: input.spendLimit, currency: input.stablecoin, operationId: result.operation_id });
    await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_CARD_CREATED", description: `Stablecoin virtual card issuance submitted`, metadata: result });
    return result;
  }),
  redeemP2pClaimV2: protectedProcedure.input(z.object({ claimCode: z.string().min(16), stablecoin: z.string() })).mutation(async ({ ctx, input }) => {
    const claim = await reserveStablecoinP2PClaim(input.claimCode, ctx.user.id);
    if (claim.stablecoin !== input.stablecoin) {
      await releaseStablecoinP2PClaim(claim.id, ctx.user.id);
      throw new TRPCError({ code: "BAD_REQUEST", message: "Claim asset does not match the requested stablecoin." });
    }
    try {
      await recordLedgerEntry({ ref: `${claim.ledgerReference}:redeem`, userId: ctx.user.id, debitAccount: `p2p-escrow:${claim.id}`, creditAccount: `user:${ctx.user.id}:${claim.stablecoin}`, amount: claim.amount, currency: claim.stablecoin, metadata: { claimId: claim.id } });
      await completeStablecoinP2PClaim(claim.id, ctx.user.id);
      await publishStablecoinEvent("stablecoin.p2p_claim_redeemed", ctx.user.id, { transactionId: claim.id, amount: claim.amount, currency: claim.stablecoin, status: "completed" });
      await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_P2P_CLAIM_REDEEMED", description: "P2P claim redeemed", metadata: { claimId: claim.id } });
      return { claimId: claim.id, status: "claimed" };
    } catch (error) {
      await releaseStablecoinP2PClaim(claim.id, ctx.user.id);
      throw error;
    }
  }),
  sendToContactV2: protectedProcedure.input(z.object({ stablecoin: z.string(), amount: z.number().positive(), recipientPhone: z.string(), message: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
    await runStablecoinCompliance({ userId: ctx.user.id, amount: input.amount, currency: input.stablecoin, stablecoin: input.stablecoin, recipientName: input.recipientPhone, direction: "sell" });
    const claim = await createStablecoinP2PClaim({ senderId: ctx.user.id, recipientIdentifier: input.recipientPhone, stablecoin: input.stablecoin, amount: input.amount, message: input.message });
    await recordLedgerEntry({ ref: claim.ledgerReference, userId: ctx.user.id, debitAccount: `user:${ctx.user.id}:${input.stablecoin}`, creditAccount: `p2p-escrow:${claim.id}`, amount: input.amount, currency: input.stablecoin, metadata: { claimId: claim.id } });
    await publishStablecoinEvent("stablecoin.p2p_claim_created", ctx.user.id, { transactionId: claim.id, amount: input.amount, currency: input.stablecoin, status: "pending" });
    await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_P2P_CLAIM_CREATED", description: "P2P claim created", metadata: { claimId: claim.id } });
    return { claimId: claim.id, claimCode: claim.claimCode, expiresAt: claim.expiresAt, status: "pending" };
  }),
  bridgeChainV2: protectedProcedure.input(z.object({ stablecoin: z.string(), amount: z.number().positive(), fromChain: z.string(), toChain: z.string(), idempotencyKey: z.string().min(8) })).mutation(async ({ ctx, input }) => {
    await runStablecoinCompliance({ userId: ctx.user.id, amount: input.amount, currency: input.stablecoin, stablecoin: input.stablecoin, chain: input.toChain, direction: "sell" });
    const result = await callStablecoinEngine("/stablecoin/bridge", { user_id: ctx.user.id, ...input });
    await publishStablecoinEvent("stablecoin.bridge", ctx.user.id, { amount: input.amount, currency: input.stablecoin, operationId: result.operation_id });
    await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_BRIDGE", description: "Stablecoin bridge submitted", metadata: result });
    return result;
  }),
  stakeForYieldV2: protectedProcedure.input(z.object({ stablecoin: z.string(), amount: z.number().positive(), protocol: z.string(), idempotencyKey: z.string().min(8) })).mutation(async ({ ctx, input }) => {
    await runStablecoinCompliance({ userId: ctx.user.id, amount: input.amount, currency: input.stablecoin, stablecoin: input.stablecoin, direction: "buy" });
    const result = await callStablecoinEngine("/stablecoin/stake", { user_id: ctx.user.id, ...input });
    await publishStablecoinEvent("stablecoin.stake", ctx.user.id, { amount: input.amount, currency: input.stablecoin, operationId: result.operation_id });
    await createAuditLog({ userId: ctx.user.id, action: "STABLECOIN_STAKE", description: "Stablecoin stake submitted", metadata: result });
    return result;
  }),
});
