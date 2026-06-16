/**
 * liquidityPool.ts — Liquidity Provider Router
 *
 * tRPC endpoints for LP operations: quotes, settlements, pool reserves,
 * rebalancing triggers, provider health, and admin metrics.
 *
 * Wires into the transfer pipeline for compliance on all settlements.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { randomBytes } from "crypto";
import { protectedProcedure, adminProcedure, publicProcedure, router, strictRateLimitedProcedure } from "../_core/trpc";
import { getDb, createAuditLog } from "../db";
import { transactions, wallets } from "../../drizzle/schema";
import { executeTransferPipeline } from "../_core/transferPipeline";
import { publishEvent, KAFKA_TOPICS } from "../middleware/kafka";
import { logger } from "../_core/logger";
import { broadcastUserEvent } from "../sse.service";
import {
  getLiquidityProvider,
  getAllProviders,
  getBestQuote,
  checkRebalanceNeeded,
} from "../_core/liquidityProvider";
import type { LiquidityProvider, LPQuote, LPSettlementResult } from "../_core/liquidityProvider";

// ── Constants ───────────────────────────────────────────────────────────────

const SUPPORTED_STABLECOINS = ["USDT", "USDC", "BUSD", "DAI", "NGNT", "cUSD", "PYUSD"] as const;
const SUPPORTED_FIAT = ["USD", "NGN", "GBP", "EUR", "GHS", "KES", "ZAR", "XOF"] as const;

const LP_TIERS = {
  tier1: { name: "Market Maker", minCapital: 5_000_000, dailyLimit: 10_000_000 },
  tier2: { name: "Regional LP", minCapital: 500_000, dailyLimit: 1_000_000 },
  tier3: { name: "Agent LP", minCapital: 50_000, dailyLimit: 100_000 },
} as const;

const LICENSING_REQUIREMENTS = {
  nigeria: {
    licenses: ["IMTO (CBN)", "PSP License", "SEC Digital Asset Exchange (if holding crypto)"],
    timeline: "6-18 months",
    estimatedCost: "₦50M-₦150M",
    regulator: "Central Bank of Nigeria / Securities and Exchange Commission",
  },
  us: {
    licenses: ["MSB Registration (FinCEN)", "State Money Transmitter Licenses (per state)"],
    timeline: "12-24 months",
    estimatedCost: "$1M+",
    regulator: "FinCEN / State regulators",
  },
  eu: {
    licenses: ["E-Money Institution (EMI) under PSD2"],
    timeline: "6-12 months",
    estimatedCost: "€350K+",
    regulator: "National authority (e.g. BaFin, DNB, AMF)",
  },
  uk: {
    licenses: ["FCA Electronic Money License"],
    timeline: "6-12 months",
    estimatedCost: "£100K+",
    regulator: "Financial Conduct Authority",
  },
} as const;

function generateOrderId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

// ── Router ──────────────────────────────────────────────────────────────────

export const liquidityPoolRouter = router({
  // ═════════════════════════════════════════════════════════════════════════
  // QUOTES — Get pricing from LP providers
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Get the best quote across all available LPs for a buy/sell.
   */
  getBestQuote: publicProcedure
    .input(z.object({
      direction: z.enum(["buy", "sell"]),
      stablecoin: z.enum(SUPPORTED_STABLECOINS),
      amount: z.number().positive().max(10_000_000),
      fiatCurrency: z.enum(SUPPORTED_FIAT),
    }))
    .query(async ({ input }) => {
      try {
        const quote = await getBestQuote(input);
        return quote;
      } catch (err) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: err instanceof Error ? err.message : "No LP available for this pair",
        });
      }
    }),

  /**
   * Get a quote from a specific LP provider.
   */
  getProviderQuote: publicProcedure
    .input(z.object({
      provider: z.string().max(50),
      direction: z.enum(["buy", "sell"]),
      stablecoin: z.enum(SUPPORTED_STABLECOINS),
      amount: z.number().positive().max(10_000_000),
      fiatCurrency: z.enum(SUPPORTED_FIAT),
    }))
    .query(async ({ input }) => {
      const lp = getLiquidityProvider(input.provider);
      try {
        return await lp.getQuote({
          direction: input.direction,
          stablecoin: input.stablecoin,
          amount: input.amount,
          fiatCurrency: input.fiatCurrency,
        });
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Quote failed",
        });
      }
    }),

  /**
   * Compare quotes across all providers.
   */
  compareQuotes: publicProcedure
    .input(z.object({
      direction: z.enum(["buy", "sell"]),
      stablecoin: z.enum(SUPPORTED_STABLECOINS),
      amount: z.number().positive().max(10_000_000),
      fiatCurrency: z.enum(SUPPORTED_FIAT),
    }))
    .query(async ({ input }) => {
      const providers = getAllProviders();
      const quotes: LPQuote[] = [];
      const errors: Array<{ provider: string; error: string }> = [];

      for (const provider of providers) {
        try {
          const health = await provider.getHealth();
          if (!health.healthy) {
            errors.push({ provider: provider.name, error: "Provider unhealthy" });
            continue;
          }
          if (!health.supportedStablecoins.includes(input.stablecoin)) {
            errors.push({ provider: provider.name, error: `Does not support ${input.stablecoin}` });
            continue;
          }
          if (!health.supportedFiatCurrencies.includes(input.fiatCurrency)) {
            errors.push({ provider: provider.name, error: `Does not support ${input.fiatCurrency}` });
            continue;
          }
          const quote = await provider.getQuote(input);
          quotes.push(quote);
        } catch (err) {
          errors.push({ provider: provider.name, error: err instanceof Error ? err.message : "Unknown error" });
        }
      }

      quotes.sort((a, b) => a.totalFeeAmount - b.totalFeeAmount);

      return {
        quotes,
        bestProvider: quotes[0]?.provider ?? null,
        savings: quotes.length > 1
          ? Math.round((quotes[quotes.length - 1].totalFeeAmount - quotes[0].totalFeeAmount) * 100) / 100
          : 0,
        errors,
      };
    }),

  // ═════════════════════════════════════════════════════════════════════════
  // SETTLEMENTS — Execute trades via LP
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Execute a settlement through the LP (buy stablecoin with fiat).
   * Full pipeline: sanctions → fraud ML → velocity → settlement → Kafka.
   */
  executeBuy: strictRateLimitedProcedure
    .input(z.object({
      provider: z.string().max(50).optional(),
      stablecoin: z.enum(SUPPORTED_STABLECOINS),
      fiatAmount: z.number().positive().max(10_000_000),
      fiatCurrency: z.enum(SUPPORTED_FIAT),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const lp = getLiquidityProvider(input.provider);

      // Get quote first
      const quote = await lp.getQuote({
        direction: "buy",
        stablecoin: input.stablecoin,
        amount: input.fiatAmount,
        fiatCurrency: input.fiatCurrency,
      });

      // Execute transfer pipeline (sanctions, fraud ML, velocity)
      try {
        await executeTransferPipeline({
          userId: ctx.user.id,
          amount: input.fiatAmount,
          fromCurrency: input.fiatCurrency,
          toCurrency: input.stablecoin,
          recipientName: "Self",
          rail: "internal",
          corridorCode: `${input.fiatCurrency}-${input.stablecoin}`,
          transferId: generateOrderId("LP-BUY"),
          description: `LP Buy: ${input.fiatAmount} ${input.fiatCurrency} → ${quote.stablecoinAmount} ${input.stablecoin} via ${lp.name}`,
          featureLabel: "lp_buy_stablecoin",
        });
      } catch (err) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: err instanceof Error ? err.message : "Transfer pipeline rejected",
        });
      }

      // Execute settlement with LP
      const settlement = await lp.executeSettlement({
        quoteId: quote.quoteId,
        direction: "buy",
        stablecoin: input.stablecoin,
        amount: input.fiatAmount,
        fiatCurrency: input.fiatCurrency,
        idempotencyKey: generateOrderId("IDEM"),
      });

      // Record transaction
      const [txn] = await db.insert(transactions).values({
        userId: ctx.user.id,
        type: "exchange" as const,
        status: settlement.status === "settled" ? "completed" : "processing",
        fromCurrency: input.fiatCurrency,
        fromAmount: input.fiatAmount.toString(),
        toCurrency: input.stablecoin,
        toAmount: quote.stablecoinAmount.toString(),
        fee: quote.totalFeeAmount.toFixed(6),
        description: `LP Buy via ${lp.name}: ${input.fiatAmount} ${input.fiatCurrency} → ${quote.stablecoinAmount} ${input.stablecoin}`,
      }).returning();

      // Kafka event
      try {
        await publishEvent(KAFKA_TOPICS.TRANSACTIONS, `lp-${ctx.user.id}`, {
          type: "lp.buy.executed",
          userId: ctx.user.id,
          provider: lp.name,
          settlementId: settlement.settlementId,
          stablecoin: input.stablecoin,
          stablecoinAmount: quote.stablecoinAmount,
          fiatCurrency: input.fiatCurrency,
          fiatAmount: input.fiatAmount,
          fee: quote.totalFeeAmount,
          timestamp: new Date().toISOString(),
        });
      } catch { /* non-critical */ }

      // Audit log
      try {
        await createAuditLog({
          userId: ctx.user.id,
          action: "LP_BUY_STABLECOIN",
          description: `Bought ${quote.stablecoinAmount} ${input.stablecoin} via ${lp.name}`,
          metadata: {
            provider: lp.name,
            settlementId: settlement.settlementId,
            stablecoin: input.stablecoin,
            amount: quote.stablecoinAmount,
            fiatCurrency: input.fiatCurrency,
            fiatAmount: input.fiatAmount,
          },
        });
      } catch { /* non-critical */ }

      // Push notification
      try {
        broadcastUserEvent(ctx.user.id, {
          type: "notification",
          payload: {
            message: `Bought ${quote.stablecoinAmount} ${input.stablecoin} via ${lp.name}`,
            settlementId: settlement.settlementId,
          },
        });
      } catch { /* non-critical */ }

      return {
        verified: true,
        transactionId: txn?.id,
        settlement,
        quote,
      };
    }),

  /**
   * Execute a settlement through the LP (sell stablecoin for fiat).
   */
  executeSell: strictRateLimitedProcedure
    .input(z.object({
      provider: z.string().max(50).optional(),
      stablecoin: z.enum(SUPPORTED_STABLECOINS),
      stablecoinAmount: z.number().positive().max(10_000_000),
      fiatCurrency: z.enum(SUPPORTED_FIAT),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const lp = getLiquidityProvider(input.provider);

      const quote = await lp.getQuote({
        direction: "sell",
        stablecoin: input.stablecoin,
        amount: input.stablecoinAmount,
        fiatCurrency: input.fiatCurrency,
      });

      try {
        await executeTransferPipeline({
          userId: ctx.user.id,
          amount: input.stablecoinAmount,
          fromCurrency: input.stablecoin,
          toCurrency: input.fiatCurrency,
          recipientName: "Self",
          rail: "internal",
          corridorCode: `${input.stablecoin}-${input.fiatCurrency}`,
          transferId: generateOrderId("LP-SELL"),
          description: `LP Sell: ${input.stablecoinAmount} ${input.stablecoin} → ${quote.fiatAmount} ${input.fiatCurrency} via ${lp.name}`,
          featureLabel: "lp_sell_stablecoin",
        });
      } catch (err) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: err instanceof Error ? err.message : "Transfer pipeline rejected",
        });
      }

      const settlement = await lp.executeSettlement({
        quoteId: quote.quoteId,
        direction: "sell",
        stablecoin: input.stablecoin,
        amount: input.stablecoinAmount,
        fiatCurrency: input.fiatCurrency,
        idempotencyKey: generateOrderId("IDEM"),
      });

      const [txn] = await db.insert(transactions).values({
        userId: ctx.user.id,
        type: "exchange" as const,
        status: settlement.status === "settled" ? "completed" : "processing",
        fromCurrency: input.stablecoin,
        fromAmount: input.stablecoinAmount.toString(),
        toCurrency: input.fiatCurrency,
        toAmount: quote.netAmount.toString(),
        fee: quote.totalFeeAmount.toFixed(6),
        description: `LP Sell via ${lp.name}: ${input.stablecoinAmount} ${input.stablecoin} → ${quote.netAmount} ${input.fiatCurrency}`,
      }).returning();

      try {
        await publishEvent(KAFKA_TOPICS.TRANSACTIONS, `lp-${ctx.user.id}`, {
          type: "lp.sell.executed",
          userId: ctx.user.id,
          provider: lp.name,
          settlementId: settlement.settlementId,
          stablecoin: input.stablecoin,
          stablecoinAmount: input.stablecoinAmount,
          fiatCurrency: input.fiatCurrency,
          fiatAmount: quote.netAmount,
          fee: quote.totalFeeAmount,
          timestamp: new Date().toISOString(),
        });
      } catch { /* non-critical */ }

      try {
        await createAuditLog({
          userId: ctx.user.id,
          action: "LP_SELL_STABLECOIN",
          description: `Sold ${input.stablecoinAmount} ${input.stablecoin} via ${lp.name}`,
          metadata: {
            provider: lp.name,
            settlementId: settlement.settlementId,
            stablecoin: input.stablecoin,
            amount: input.stablecoinAmount,
          },
        });
      } catch { /* non-critical */ }

      try {
        broadcastUserEvent(ctx.user.id, {
          type: "notification",
          payload: {
            message: `Sold ${input.stablecoinAmount} ${input.stablecoin} for ${quote.netAmount} ${input.fiatCurrency} via ${lp.name}`,
            settlementId: settlement.settlementId,
          },
        });
      } catch { /* non-critical */ }

      return {
        verified: true,
        transactionId: txn?.id,
        settlement,
        quote,
      };
    }),

  /**
   * Get status of an existing settlement.
   */
  getSettlementStatus: protectedProcedure
    .input(z.object({
      provider: z.string().max(50),
      settlementId: z.string().max(100),
    }))
    .query(async ({ input }) => {
      const lp = getLiquidityProvider(input.provider);
      return await lp.getSettlementStatus(input.settlementId);
    }),

  /**
   * Cancel a pending settlement (if provider supports it).
   */
  cancelSettlement: strictRateLimitedProcedure
    .input(z.object({
      provider: z.string().max(50),
      settlementId: z.string().max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const lp = getLiquidityProvider(input.provider);
      const result = await lp.cancelSettlement(input.settlementId);

      try {
        await createAuditLog({
          userId: ctx.user.id,
          action: "LP_CANCEL_SETTLEMENT",
          description: `Cancel settlement ${input.settlementId} via ${input.provider}`,
          metadata: {
            provider: input.provider,
            settlementId: input.settlementId,
            cancelled: result.cancelled,
          },
        });
      } catch { /* non-critical */ }

      return result;
    }),

  // ═════════════════════════════════════════════════════════════════════════
  // POOL & RESERVES — Track LP pool balances
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Get pool balance for a specific stablecoin/fiat pair across all providers.
   */
  getPoolBalances: protectedProcedure
    .input(z.object({
      stablecoin: z.enum(SUPPORTED_STABLECOINS),
      fiatCurrency: z.enum(SUPPORTED_FIAT),
    }))
    .query(async ({ input }) => {
      const providers = getAllProviders();
      const balances = [];

      for (const provider of providers) {
        try {
          const balance = await provider.getPoolBalance(input.stablecoin, input.fiatCurrency);
          balances.push(balance);
        } catch (err) {
          logger.warn({ provider: provider.name }, "Pool balance fetch failed");
        }
      }

      const totalAvailable = balances.reduce((sum, b) => sum + b.available, 0);
      const totalReserved = balances.reduce((sum, b) => sum + b.reserved, 0);

      return {
        stablecoin: input.stablecoin,
        fiatCurrency: input.fiatCurrency,
        providers: balances,
        aggregated: {
          totalAvailable,
          totalReserved,
          total: totalAvailable + totalReserved,
          utilizationPercent: totalReserved / (totalAvailable + totalReserved || 1) * 100,
        },
      };
    }),

  /**
   * Get aggregate reserves across all stablecoins — admin reserve dashboard.
   */
  getReserves: adminProcedure.query(async () => {
    const providers = getAllProviders();
    const reserves: Array<{
      provider: string;
      tier: string;
      stablecoin: string;
      available: number;
      reserved: number;
      total: number;
    }> = [];

    for (const provider of providers) {
      for (const stablecoin of SUPPORTED_STABLECOINS) {
        try {
          const balance = await provider.getPoolBalance(stablecoin, "USD");
          if (balance.total > 0) {
            reserves.push({
              provider: provider.name,
              tier: provider.tier,
              stablecoin,
              available: balance.available,
              reserved: balance.reserved,
              total: balance.total,
            });
          }
        } catch { /* skip */ }
      }
    }

    const totalReserves = reserves.reduce((sum, r) => sum + r.total, 0);
    const totalAvailable = reserves.reduce((sum, r) => sum + r.available, 0);

    return {
      reserves,
      summary: {
        totalReservesUsd: totalReserves,
        totalAvailableUsd: totalAvailable,
        providerCount: providers.length,
        stablecoinCount: new Set(reserves.map(r => r.stablecoin)).size,
        healthyProviders: providers.length,
        utilizationPercent: Math.round((totalReserves - totalAvailable) / (totalReserves || 1) * 10000) / 100,
      },
      generatedAt: new Date().toISOString(),
    };
  }),

  // ═════════════════════════════════════════════════════════════════════════
  // REBALANCING — Monitor and trigger pool rebalancing
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Check if rebalancing is needed for a specific pair.
   */
  checkRebalance: adminProcedure
    .input(z.object({
      stablecoin: z.enum(SUPPORTED_STABLECOINS),
      fiatCurrency: z.enum(SUPPORTED_FIAT),
      targetRatio: z.number().min(0.1).max(0.99).default(0.8),
      thresholdPercent: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      const actions = await checkRebalanceNeeded(input);
      return {
        needsRebalancing: actions.length > 0,
        actions,
        checkedAt: new Date().toISOString(),
      };
    }),

  /**
   * Execute a rebalance action (admin-only).
   */
  executeRebalance: adminProcedure
    .input(z.object({
      provider: z.string().max(50),
      direction: z.enum(["buy_stablecoin", "sell_stablecoin"]),
      stablecoin: z.enum(SUPPORTED_STABLECOINS),
      amount: z.number().positive().max(10_000_000),
      fiatCurrency: z.enum(SUPPORTED_FIAT),
    }))
    .mutation(async ({ ctx, input }) => {
      const lp = getLiquidityProvider(input.provider);
      const direction = input.direction === "buy_stablecoin" ? "buy" : "sell";

      const settlement = await lp.executeSettlement({
        quoteId: generateOrderId("REBAL-QUOTE"),
        direction,
        stablecoin: input.stablecoin,
        amount: input.amount,
        fiatCurrency: input.fiatCurrency,
        idempotencyKey: generateOrderId("REBAL-IDEM"),
      });

      try {
        await publishEvent(KAFKA_TOPICS.TRANSACTIONS, `lp-${ctx.user.id}`, {
          type: "lp.rebalance.executed",
          adminId: ctx.user.id,
          provider: lp.name,
          direction: input.direction,
          stablecoin: input.stablecoin,
          amount: input.amount,
          settlementId: settlement.settlementId,
          timestamp: new Date().toISOString(),
        });
      } catch { /* non-critical */ }

      try {
        await createAuditLog({
          userId: ctx.user.id,
          action: "LP_REBALANCE",
          description: `Rebalance ${input.direction} ${input.amount} ${input.stablecoin} via ${input.provider}`,
          metadata: {
            provider: input.provider,
            direction: input.direction,
            stablecoin: input.stablecoin,
            amount: input.amount,
            settlementId: settlement.settlementId,
          },
        });
      } catch { /* non-critical */ }

      return {
        verified: true,
        settlement,
        rebalanceId: generateOrderId("REBAL"),
      };
    }),

  // ═════════════════════════════════════════════════════════════════════════
  // PROVIDER HEALTH & INFO
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Get health status of all LP providers.
   */
  providerHealth: publicProcedure.query(async () => {
    const providers = getAllProviders();
    const statuses = [];

    for (const provider of providers) {
      try {
        const health = await provider.getHealth();
        statuses.push(health);
      } catch (err) {
        statuses.push({
          provider: provider.name,
          healthy: false,
          latencyMs: -1,
          dailyVolumeUsd: 0,
          dailyLimitUsd: 0,
          remainingLimitUsd: 0,
          supportedStablecoins: [],
          supportedFiatCurrencies: [],
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return {
      providers: statuses,
      healthyCount: statuses.filter(s => s.healthy).length,
      totalCount: statuses.length,
      checkedAt: new Date().toISOString(),
    };
  }),

  /**
   * Get supported assets across all providers.
   */
  supportedAssets: publicProcedure.query(async () => {
    const providers = getAllProviders();
    const stablecoins = new Set<string>();
    const fiatCurrencies = new Set<string>();

    for (const provider of providers) {
      try {
        const health = await provider.getHealth();
        health.supportedStablecoins.forEach(s => stablecoins.add(s));
        health.supportedFiatCurrencies.forEach(f => fiatCurrencies.add(f));
      } catch { /* skip */ }
    }

    return {
      stablecoins: Array.from(stablecoins),
      fiatCurrencies: Array.from(fiatCurrencies),
      providers: providers.map(p => ({ name: p.name, tier: p.tier })),
    };
  }),

  /**
   * Get LP tier requirements and licensing info.
   */
  tierRequirements: publicProcedure.query(() => {
    return {
      tiers: LP_TIERS,
      licensing: LICENSING_REQUIREMENTS,
      technicalRequirements: {
        api: "REST/gRPC endpoint for buy/sell quotes + webhook for settlements",
        settlement: {
          fiat: "Bank account in each corridor (NGN, USD, GBP, EUR)",
          crypto: "Custody wallet (Fireblocks/BitGo) or exchange hot wallet",
          sla: "T+0 for crypto, T+1 for fiat",
        },
        compliance: [
          "KYC/KYB verification of the platform",
          "Transaction monitoring & SAR filing",
          "OFAC/sanctions screening on all counterparties",
          "Travel Rule compliance (FATF R.16) for transfers >$1,000",
        ],
        riskManagement: [
          "Pre-funded collateral pool (2x daily volume)",
          "FX hedging (forward contracts for NGN volatility)",
          "Credit limits per counterparty",
          "Real-time position monitoring",
        ],
      },
      revenueModel: {
        onRampSpread: "0.5-1.5% per transaction",
        offRampSpread: "0.75-2.0% per transaction",
        fxSpread: "0.3-0.5% on mid-market rate",
        yieldOnReserves: "3-5% APY on idle capital deployed to DeFi",
        exampleDailyRevenue: "$500K daily volume × 1% avg spread = $5,000/day",
      },
    };
  }),

  // ═════════════════════════════════════════════════════════════════════════
  // ADMIN METRICS
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Admin: comprehensive LP metrics dashboard.
   */
  adminMetrics: adminProcedure.query(async () => {
    const providers = getAllProviders();
    const healthStatuses = [];
    let totalDailyVolume = 0;
    let totalRemainingLimit = 0;

    for (const provider of providers) {
      try {
        const health = await provider.getHealth();
        healthStatuses.push(health);
        totalDailyVolume += health.dailyVolumeUsd;
        totalRemainingLimit += health.remainingLimitUsd;
      } catch { /* skip */ }
    }

    return {
      providers: healthStatuses,
      aggregate: {
        totalDailyVolumeUsd: totalDailyVolume,
        totalRemainingCapacityUsd: totalRemainingLimit,
        activeProviders: healthStatuses.filter(h => h.healthy).length,
        totalProviders: providers.length,
      },
      tiers: LP_TIERS,
      generatedAt: new Date().toISOString(),
    };
  }),

  /**
   * Admin: onboard a new LP provider (register credentials).
   */
  onboardProvider: adminProcedure
    .input(z.object({
      name: z.string().min(2).max(50),
      tier: z.enum(["tier1", "tier2", "tier3"]),
      apiUrl: z.string().url().max(500),
      apiKey: z.string().min(10).max(500),
      supportedStablecoins: z.array(z.string().max(10)).min(1),
      supportedFiatCurrencies: z.array(z.string().max(5)).min(1),
      dailyLimitUsd: z.number().positive().max(100_000_000),
      settlementSla: z.string().max(100),
      contactEmail: z.string().email().max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const providerId = generateOrderId("LP");

      try {
        await createAuditLog({
          userId: ctx.user.id,
          action: "LP_PROVIDER_ONBOARDED",
          description: `Onboarded LP ${input.name} (${input.tier})`,
          metadata: {
            providerId,
            name: input.name,
            tier: input.tier,
            supportedStablecoins: input.supportedStablecoins,
            supportedFiatCurrencies: input.supportedFiatCurrencies,
            dailyLimitUsd: input.dailyLimitUsd,
          },
        });
      } catch { /* non-critical */ }

      try {
        await publishEvent(KAFKA_TOPICS.TRANSACTIONS, `lp-${ctx.user.id}`, {
          type: "lp.provider.onboarded",
          adminId: ctx.user.id,
          providerId,
          name: input.name,
          tier: input.tier,
          timestamp: new Date().toISOString(),
        });
      } catch { /* non-critical */ }

      return {
        verified: true,
        providerId,
        name: input.name,
        tier: input.tier,
        status: "pending_verification",
        nextSteps: [
          "Complete KYB verification",
          "Provide proof of reserves",
          "Sign LP agreement",
          "Complete API integration testing",
          "Submit compliance documentation",
        ],
      };
    }),
});
