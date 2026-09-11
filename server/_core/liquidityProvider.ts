/**
 * liquidityProvider.ts — Liquidity Provider abstraction layer
 *
 * Uniform interface for sourcing stablecoin ↔ fiat liquidity.
 * Providers: YellowCard (Africa), Circle (USDC issuer), Mock (dev/test).
 *
 * Architecture:
 *   - Each provider implements LiquidityProvider interface
 *   - Factory selects provider based on LP_PROVIDER env var
 *   - All providers emit Kafka events for settlement tracking
 *   - Reserve tracking via pool balance queries
 *   - Rebalancing triggers when pool imbalance > threshold
 */

import { randomBytes } from "crypto";
import { logger } from "./logger";

// ── Types ───────────────────────────────────────────────────────────────────

export interface LPQuote {
  quoteId: string;
  provider: string;
  /** true when the quote was produced by the sandbox/mock provider (never in production). */
  simulated?: boolean;
  direction: "buy" | "sell";
  stablecoin: string;
  stablecoinAmount: number;
  fiatCurrency: string;
  fiatAmount: number;
  fxRate: number;
  providerFeePercent: number;
  providerFeeAmount: number;
  platformFeePercent: number;
  platformFeeAmount: number;
  totalFeeAmount: number;
  netAmount: number;
  expiresAt: string;
  settlementTime: string;
}

export interface LPSettlementResult {
  settlementId: string;
  provider: string;
  // NOTE (W7/B2): "unknown" added — a provider that has no live integration (or a
  // sandbox) must never auto-report "settled"; it reports "unknown" or throws.
  status: "pending" | "processing" | "settled" | "failed" | "unknown";
  /** true when the artifact was produced by the sandbox/mock provider (never in production). */
  simulated?: boolean;
  direction: "buy" | "sell";
  stablecoin: string;
  stablecoinAmount: number;
  fiatCurrency: string;
  fiatAmount: number;
  txHash?: string;
  settledAt?: string;
  estimatedSettlement: string;
}

export interface LPPoolBalance {
  provider: string;
  stablecoin: string;
  /** true when the balance is a sandbox simulation (never in production). */
  simulated?: boolean;
  available: number;
  reserved: number;
  total: number;
  fiatCurrency: string;
  fiatAvailable: number;
  lastUpdated: string;
}

export interface LPHealthStatus {
  provider: string;
  healthy: boolean;
  /** true when the health data comes from the sandbox/mock provider. */
  simulated?: boolean;
  latencyMs: number;
  lastTradeAt?: string;
  dailyVolumeUsd: number;
  dailyLimitUsd: number;
  remainingLimitUsd: number;
  supportedStablecoins: string[];
  supportedFiatCurrencies: string[];
}

export interface RebalanceAction {
  actionId: string;
  direction: "buy_stablecoin" | "sell_stablecoin";
  stablecoin: string;
  amount: number;
  reason: string;
  urgency: "low" | "medium" | "high" | "critical";
  estimatedCostUsd: number;
}

export interface LiquidityProvider {
  name: string;
  tier: "tier1" | "tier2" | "tier3";

  getQuote(params: {
    direction: "buy" | "sell";
    stablecoin: string;
    amount: number;
    fiatCurrency: string;
  }): Promise<LPQuote>;

  executeSettlement(params: {
    quoteId: string;
    direction: "buy" | "sell";
    stablecoin: string;
    amount: number;
    fiatCurrency: string;
    idempotencyKey: string;
  }): Promise<LPSettlementResult>;

  getPoolBalance(stablecoin: string, fiatCurrency: string): Promise<LPPoolBalance>;

  getHealth(): Promise<LPHealthStatus>;

  getSettlementStatus(settlementId: string): Promise<LPSettlementResult>;

  cancelSettlement(settlementId: string): Promise<{ cancelled: boolean; reason: string }>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

const FX_RATES: Record<string, number> = {
  USD: 1, NGN: 1600, GBP: 0.79, EUR: 0.92, GHS: 15.5,
  KES: 155, ZAR: 18.5, XOF: 605, INR: 83, BRL: 4.95,
};

function getFxRate(from: string, to: string): number {
  const fromRate = FX_RATES[from] ?? 1;
  const toRate = FX_RATES[to] ?? 1;
  return toRate / fromRate;
}

const isProd = (): boolean => process.env.NODE_ENV === "production";

/** Contract 4 kill-switch: the mock LP must never serve production traffic. */
function assertMockAllowed(): void {
  if (isProd()) {
    throw new Error("liquidityProvider refuses to run with mock provider in production");
  }
}

/**
 * W7/B2: thrown by providers that have NO live HTTP integration. They must
 * never fabricate quotes, settlements, txHashes, pool balances, or statuses.
 */
function providerNotImplemented(provider: string, op: string): Error {
  return new Error(`UNAVAILABLE: ${provider} provider integration not implemented (${op}) — no live API egress, refusing to fabricate a result`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MOCK PROVIDER (dev/test — no external calls)
// ═══════════════════════════════════════════════════════════════════════════

export class MockLiquidityProvider implements LiquidityProvider {
  name = "mock";
  tier = "tier3" as const;

  private poolBalances: Record<string, number> = {
    USDT: 100_000, USDC: 100_000, BUSD: 50_000, DAI: 50_000,
    PYUSD: 25_000, NGNT: 10_000_000, cUSD: 50_000,
  };
  private dailyVolume = 0;

  async getQuote(params: { direction: "buy" | "sell"; stablecoin: string; amount: number; fiatCurrency: string }): Promise<LPQuote> {
    assertMockAllowed();
    const stablecoinUsdRate = params.stablecoin === "NGNT" ? 1 / 1600 : 1.0;
    const fxRate = getFxRate("USD", params.fiatCurrency);
    const providerFeePercent = params.direction === "buy" ? 0.5 : 0.75;

    let stablecoinAmount: number;
    let fiatAmount: number;

    if (params.direction === "buy") {
      fiatAmount = params.amount;
      const usdValue = fiatAmount / fxRate;
      stablecoinAmount = usdValue / stablecoinUsdRate;
    } else {
      stablecoinAmount = params.amount;
      const usdValue = stablecoinAmount * stablecoinUsdRate;
      fiatAmount = usdValue * fxRate;
    }

    const providerFee = fiatAmount * (providerFeePercent / 100);
    const platformFeePercent = 0.25;
    const platformFee = fiatAmount * (platformFeePercent / 100);
    const totalFee = providerFee + platformFee;
    const netAmount = params.direction === "buy"
      ? stablecoinAmount - (stablecoinAmount * (providerFeePercent + platformFeePercent) / 100)
      : fiatAmount - totalFee;

    return {
      quoteId: generateId("sandbox-quote"),
      provider: this.name,
      simulated: true,
      direction: params.direction,
      stablecoin: params.stablecoin,
      stablecoinAmount: Math.round(stablecoinAmount * 1e6) / 1e6,
      fiatCurrency: params.fiatCurrency,
      fiatAmount: Math.round(fiatAmount * 100) / 100,
      fxRate: Math.round((fxRate / stablecoinUsdRate) * 1e8) / 1e8,
      providerFeePercent,
      providerFeeAmount: Math.round(providerFee * 100) / 100,
      platformFeePercent,
      platformFeeAmount: Math.round(platformFee * 100) / 100,
      totalFeeAmount: Math.round(totalFee * 100) / 100,
      netAmount: Math.round(netAmount * 1e6) / 1e6,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      settlementTime: "instant",
    };
  }

  async executeSettlement(params: { quoteId: string; direction: "buy" | "sell"; stablecoin: string; amount: number; fiatCurrency: string; idempotencyKey: string }): Promise<LPSettlementResult> {
    assertMockAllowed();
    const fxRate = getFxRate("USD", params.fiatCurrency);
    const stablecoinUsdRate = params.stablecoin === "NGNT" ? 1 / 1600 : 1.0;

    let stablecoinAmount: number;
    let fiatAmount: number;

    if (params.direction === "buy") {
      fiatAmount = params.amount;
      stablecoinAmount = (fiatAmount / fxRate) / stablecoinUsdRate;
    } else {
      stablecoinAmount = params.amount;
      fiatAmount = stablecoinAmount * stablecoinUsdRate * fxRate;
    }

    if (params.direction === "buy") {
      const pool = this.poolBalances[params.stablecoin] ?? 0;
      if (pool < stablecoinAmount) {
        return {
          settlementId: generateId("sandbox-settle"),
          provider: this.name,
          simulated: true,
          status: "failed",
          direction: params.direction,
          stablecoin: params.stablecoin,
          stablecoinAmount,
          fiatCurrency: params.fiatCurrency,
          fiatAmount,
          estimatedSettlement: "N/A",
        };
      }

      this.poolBalances[params.stablecoin] = pool - stablecoinAmount;
    } else {
      this.poolBalances[params.stablecoin] = (this.poolBalances[params.stablecoin] ?? 0) + stablecoinAmount;
    }

    this.dailyVolume += stablecoinAmount * stablecoinUsdRate;

    logger.info({ provider: this.name, direction: params.direction, stablecoin: params.stablecoin, stablecoinAmount, fiatAmount }, "LP settlement executed");

    return {
      settlementId: generateId("sandbox-settle"),
      provider: this.name,
      simulated: true,
      status: "settled",
      direction: params.direction,
      stablecoin: params.stablecoin,
      stablecoinAmount: Math.round(stablecoinAmount * 1e6) / 1e6,
      fiatCurrency: params.fiatCurrency,
      fiatAmount: Math.round(fiatAmount * 100) / 100,
      // W7/B2: clearly-marked sandbox artifact — never a real-looking 0x hash.
      txHash: `sandbox-tx-${randomBytes(16).toString("hex")}`,
      settledAt: new Date().toISOString(),
      estimatedSettlement: "instant (simulated)",
    };
  }

  async getPoolBalance(stablecoin: string, fiatCurrency: string): Promise<LPPoolBalance> {
    assertMockAllowed();
    const balance = this.poolBalances[stablecoin] ?? 0;
    return {
      provider: this.name,
      simulated: true,
      stablecoin,
      available: balance,
      reserved: 0,
      total: balance,
      fiatCurrency,
      fiatAvailable: balance * getFxRate("USD", fiatCurrency),
      lastUpdated: new Date().toISOString(),
    };
  }

  async getHealth(): Promise<LPHealthStatus> {
    assertMockAllowed();
    return {
      provider: this.name,
      simulated: true,
      healthy: true,
      latencyMs: 1,
      dailyVolumeUsd: this.dailyVolume,
      dailyLimitUsd: 1_000_000,
      remainingLimitUsd: 1_000_000 - this.dailyVolume,
      supportedStablecoins: ["USDT", "USDC", "BUSD", "DAI", "NGNT", "cUSD", "PYUSD"],
      supportedFiatCurrencies: ["USD", "NGN", "GBP", "EUR", "GHS", "KES", "ZAR"],
    };
  }

  async getSettlementStatus(settlementId: string): Promise<LPSettlementResult> {
    assertMockAllowed();
    // W7/B2 (Contract 4): the sandbox has no chain/provider to confirm against —
    // it must NEVER auto-report "settled". Report "unknown" honestly.
    return {
      settlementId,
      provider: this.name,
      simulated: true,
      status: "unknown",
      direction: "buy",
      stablecoin: "USDC",
      stablecoinAmount: 0,
      fiatCurrency: "USD",
      fiatAmount: 0,
      estimatedSettlement: "unknown (simulated provider cannot confirm settlement)",
    };
  }

  async cancelSettlement(_settlementId: string): Promise<{ cancelled: boolean; reason: string }> {
    assertMockAllowed();
    return { cancelled: false, reason: "Mock settlements are simulated and cannot be cancelled" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// YELLOW CARD PROVIDER (Africa-focused: NGN, GHS, KES, ZAR)
// ═══════════════════════════════════════════════════════════════════════════

export class YellowCardProvider implements LiquidityProvider {
  name = "yellowcard";
  tier = "tier2" as const;

  private apiUrl: string;
  private apiKey: string;
  private dailyVolume = 0;

  constructor() {
    this.apiUrl = process.env.YELLOWCARD_API_URL ?? "https://sandbox.yellowcard.engineering/v1";
    this.apiKey = process.env.YELLOWCARD_API_KEY ?? "";
    if (!this.apiKey) logger.warn("YELLOWCARD_API_KEY not set — YellowCard LP has no live integration and will refuse all operations (UNAVAILABLE)");
  }

  async getQuote(_params: { direction: "buy" | "sell"; stablecoin: string; amount: number; fiatCurrency: string }): Promise<LPQuote> {
    // W7/B2: this provider has NO HTTP integration. A locally-computed quote
    // with a fabricated "YC-QUOTE" id would be a phantom provider artifact —
    // fail closed instead of returning one.
    throw providerNotImplemented(this.name, "getQuote");
  }

  async executeSettlement(_params: { quoteId: string; direction: "buy" | "sell"; stablecoin: string; amount: number; fiatCurrency: string; idempotencyKey: string }): Promise<LPSettlementResult> {
    // W7/B2: no live API — never fabricate a settlement id or 0x txHash.
    throw providerNotImplemented(this.name, "executeSettlement");
  }

  async getPoolBalance(_stablecoin: string, _fiatCurrency: string): Promise<LPPoolBalance> {
    // W7/B2: previously returned hardcoded 500k/550k balances that fed the admin
    // treasury dashboard. No real balance source exists — fail closed (callers
    // catch and skip this provider rather than display phantom liquidity).
    throw providerNotImplemented(this.name, "getPoolBalance");
  }

  async getHealth(): Promise<LPHealthStatus> {
    return {
      provider: this.name,
      // Honest: no live integration exists, so this provider is not usable.
      healthy: false,
      latencyMs: 0,
      dailyVolumeUsd: this.dailyVolume,
      dailyLimitUsd: 500_000,
      remainingLimitUsd: 500_000 - this.dailyVolume,
      supportedStablecoins: ["USDT", "USDC"],
      supportedFiatCurrencies: ["NGN", "GHS", "KES", "ZAR", "XOF"],
    };
  }

  async getSettlementStatus(_settlementId: string): Promise<LPSettlementResult> {
    // W7/B2: previously always answered "settled". No real provider exists to
    // confirm anything — fail closed instead of phantom confirmation.
    throw providerNotImplemented(this.name, "getSettlementStatus");
  }

  async cancelSettlement(_settlementId: string): Promise<{ cancelled: boolean; reason: string }> {
    // W7/B2: previously claimed { cancelled: true } with no provider call.
    throw providerNotImplemented(this.name, "cancelSettlement");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CIRCLE PROVIDER (USDC issuer — direct mint/redeem for institutional)
// ═══════════════════════════════════════════════════════════════════════════

export class CircleProvider implements LiquidityProvider {
  name = "circle";
  tier = "tier1" as const;

  private apiUrl: string;
  private apiKey: string;
  private dailyVolume = 0;

  constructor() {
    this.apiUrl = process.env.CIRCLE_API_URL ?? "https://api-sandbox.circle.com/v1";
    this.apiKey = process.env.CIRCLE_API_KEY ?? "";
    if (!this.apiKey) logger.warn("CIRCLE_API_KEY not set — Circle LP has no live integration and will refuse all operations (UNAVAILABLE)");
  }

  async getQuote(params: { direction: "buy" | "sell"; stablecoin: string; amount: number; fiatCurrency: string }): Promise<LPQuote> {
    if (params.stablecoin !== "USDC") {
      throw new Error("Circle only supports USDC");
    }
    // W7/B2: this provider has NO HTTP integration. A locally-computed quote
    // with a fabricated "CIRCLE-QUOTE" id would be a phantom provider artifact —
    // fail closed instead of returning one.
    throw providerNotImplemented(this.name, "getQuote");
  }

  async executeSettlement(_params: { quoteId: string; direction: "buy" | "sell"; stablecoin: string; amount: number; fiatCurrency: string; idempotencyKey: string }): Promise<LPSettlementResult> {
    // W7/B2: no live API — never fabricate a settlement id or 0x txHash.
    throw providerNotImplemented(this.name, "executeSettlement");
  }

  async getPoolBalance(_stablecoin: string, _fiatCurrency: string): Promise<LPPoolBalance> {
    // W7/B2: previously returned hardcoded 10M/11M balances that fed the admin
    // treasury dashboard. No real balance source exists — fail closed (callers
    // catch and skip this provider rather than display phantom liquidity).
    throw providerNotImplemented(this.name, "getPoolBalance");
  }

  async getHealth(): Promise<LPHealthStatus> {
    return {
      provider: this.name,
      // Honest: no live integration exists, so this provider is not usable.
      healthy: false,
      latencyMs: 0,
      dailyVolumeUsd: this.dailyVolume,
      dailyLimitUsd: 10_000_000,
      remainingLimitUsd: 10_000_000 - this.dailyVolume,
      supportedStablecoins: ["USDC"],
      supportedFiatCurrencies: ["USD", "EUR", "GBP"],
    };
  }

  async getSettlementStatus(_settlementId: string): Promise<LPSettlementResult> {
    // W7/B2: previously always answered "settled". No real provider exists to
    // confirm anything — fail closed instead of phantom confirmation.
    throw providerNotImplemented(this.name, "getSettlementStatus");
  }

  async cancelSettlement(settlementId: string): Promise<{ cancelled: boolean; reason: string }> {
    logger.info({ provider: this.name, settlementId }, "Circle cancel requested");
    return { cancelled: false, reason: "Circle settlements cannot be cancelled once submitted" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER FACTORY + SMART ROUTER
// ═══════════════════════════════════════════════════════════════════════════

const providers: Record<string, LiquidityProvider> = {
  mock: new MockLiquidityProvider(),
  yellowcard: new YellowCardProvider(),
  circle: new CircleProvider(),
};

/**
 * Providers eligible to serve traffic right now. In production the mock
 * provider is excluded everywhere (Contract 4 kill-switch) so no dashboard,
 * quote router, or rebalance check can surface simulated liquidity as real.
 */
function activeProviders(): LiquidityProvider[] {
  return Object.values(providers).filter((p) => !(isProd() && p.name === "mock"));
}

export function getLiquidityProvider(name?: string): LiquidityProvider {
  const providerName = name ?? process.env.LP_PROVIDER ?? "mock";
  // Contract 4 kill-switch — fail closed, never silently serve mock in prod.
  if (isProd() && providerName === "mock") {
    throw new Error("liquidityProvider refuses to run with mock provider in production");
  }
  const provider = providers[providerName];
  if (!provider) {
    if (isProd()) {
      throw new Error(`Unknown LP provider "${providerName}" — refusing to fall back to mock in production`);
    }
    logger.warn({ requested: providerName }, "Unknown LP provider, falling back to mock");
    return providers.mock;
  }
  return provider;
}

export function getAllProviders(): LiquidityProvider[] {
  return activeProviders();
}

/**
 * Smart LP router — selects the best provider for a given trade.
 * Priority: lowest fee → highest available liquidity → lowest latency.
 */
export async function getBestQuote(params: {
  direction: "buy" | "sell";
  stablecoin: string;
  amount: number;
  fiatCurrency: string;
}): Promise<LPQuote & { alternatives: LPQuote[] }> {
  const quotes: LPQuote[] = [];

  for (const provider of activeProviders()) {
    try {
      const health = await provider.getHealth();
      if (!health.healthy) continue;
      if (!health.supportedStablecoins.includes(params.stablecoin)) continue;
      if (!health.supportedFiatCurrencies.includes(params.fiatCurrency)) continue;

      const quote = await provider.getQuote(params);
      quotes.push(quote);
    } catch (err) {
      logger.warn({ provider: provider.name, error: err }, "LP quote failed");
    }
  }

  if (quotes.length === 0) {
    throw new Error(`No liquidity providers available for ${params.stablecoin}/${params.fiatCurrency}`);
  }

  // Sort by lowest total fee
  quotes.sort((a, b) => a.totalFeeAmount - b.totalFeeAmount);

  return {
    ...quotes[0],
    alternatives: quotes.slice(1),
  };
}

/**
 * Check if pool rebalancing is needed.
 * Returns rebalance actions if pool imbalance exceeds threshold.
 */
export async function checkRebalanceNeeded(params: {
  stablecoin: string;
  fiatCurrency: string;
  targetRatio: number;
  thresholdPercent: number;
}): Promise<RebalanceAction[]> {
  const actions: RebalanceAction[] = [];

  for (const provider of activeProviders()) {
    try {
      const pool = await provider.getPoolBalance(params.stablecoin, params.fiatCurrency);
      const total = pool.total;
      if (total === 0) continue;

      const ratio = pool.available / total;
      const deviation = Math.abs(ratio - params.targetRatio) / params.targetRatio;

      if (deviation > params.thresholdPercent / 100) {
        const amountToRebalance = Math.abs(pool.available - total * params.targetRatio);
        const direction = ratio > params.targetRatio ? "sell_stablecoin" : "buy_stablecoin";
        const urgency = deviation > 0.5 ? "critical" : deviation > 0.3 ? "high" : deviation > 0.15 ? "medium" : "low";

        actions.push({
          actionId: generateId("REBAL"),
          direction,
          stablecoin: params.stablecoin,
          amount: Math.round(amountToRebalance * 100) / 100,
          reason: `Pool ${direction === "sell_stablecoin" ? "over-supplied" : "under-supplied"} by ${(deviation * 100).toFixed(1)}%`,
          urgency,
          estimatedCostUsd: amountToRebalance * 0.005,
        });
      }
    } catch (err) {
      logger.warn({ provider: provider.name, error: err }, "Pool balance check failed");
    }
  }

  return actions;
}
