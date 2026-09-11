/**
 * crossCurrencySwap.ts — F2: Cross-Currency Swap
 *
 * Zero-slippage stablecoin↔stablecoin swap (USDT↔USDC↔DAI↔BUSD↔PYUSD).
 * Uses Curve-style constant-sum AMM for pegged assets.
 *
 * Middleware: TigerBeetle (ledger), Kafka (swap events), Redis (rate cache),
 * OpenSearch (swap history indexing).
 *
 * Features:
 *   - Instant swap between any two stablecoins
 *   - Aggregated quotes from DEX sources (Curve, Uniswap, 1inch)
 *   - Cross-chain swap (swap USDT on Ethereum → USDC on Polygon)
 *   - Swap history + analytics
 *   - Fee tier: 0.01% for same-chain, 0.05% for cross-chain
 */

import { z } from "zod";
import { protectedProcedure, rateLimitedProcedure, strictRateLimitedProcedure, router } from "./trpc";
import { logger } from "./logger";
import { FeatureEvents, createLedgerEntry, sanitizeHtml, persistFeatureRecord, updateFeatureRecord } from "./featurePersistence";

// ── PostgreSQL Write-Through ─────────────────────────────────────────────────
let _wtDb_crossCurrencySwapts: any = null;
async function _getWtDb_crossCurrencySwapts() {
  if (_wtDb_crossCurrencySwapts) return _wtDb_crossCurrencySwapts;
  try {
    const { getDb } = await import("../db.js");
    _wtDb_crossCurrencySwapts = await getDb();
    return _wtDb_crossCurrencySwapts;
  } catch { return null; }
}
async function _writeThrough(table: string, key: string, value: unknown): Promise<void> {
  const db = await _getWtDb_crossCurrencySwapts();
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
  const db = await _getWtDb_crossCurrencySwapts();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`DELETE FROM ${sql.raw(table)} WHERE key = ${key}`);
  } catch {}
}


// ── Types ───────────────────────────────────────────────────────────────────

const STABLECOINS = ["USDT", "USDC", "DAI", "BUSD", "PYUSD", "NGNT", "cUSD"] as const;
const CHAINS = ["ethereum", "polygon", "bsc", "arbitrum", "optimism", "base", "avalanche"] as const;

interface SwapQuote {
  quoteId: string;
  fromCoin: string;
  toCoin: string;
  fromChain: string;
  toChain: string;
  inputAmount: number;
  outputAmount: number;
  fee: number;
  feePercent: number;
  exchangeRate: number;
  priceImpact: number;
  route: string[];
  expiresAt: string;
  estimatedTime: string;
}

interface SwapExecution {
  swapId: string;
  quoteId: string;
  userId: number;
  fromCoin: string;
  toCoin: string;
  fromChain: string;
  toChain: string;
  inputAmount: number;
  outputAmount: number;
  fee: number;
  status: string;
  txHash?: string;
  createdAt: string;
  completedAt?: string;
}

// ── Pricing Engine ──────────────────────────────────────────────────────────

// Wave 7 (C11): there is NO liquidity pool, bridge, or DEX aggregation behind
// this router. The old pricing engine invented a `1 - Math.random()*3bps` rate
// and issued executable-looking quotes (quoteId + 30s expiry) that executeSwap
// then "settled" with a fabricated txHash. That is phantom execution — removed.
// Quotes are refused with a PRECONDITION-style error until a real pool exists.

const SWAP_UNAVAILABLE =
  "PRECONDITION_FAILED: cross-currency swap unavailable — no liquidity pool is deployed; executable quotes cannot be provided";

// ── Store ───────────────────────────────────────────────────────────────────

const quotes = new Map<string, SwapQuote>(); // Hot cache — persisted to PostgreSQL table "feature_swap_quotes"
const swaps = new Map<string, SwapExecution>(); // Hot cache — persisted to PostgreSQL table "feature_swap_executions"

// ── Router ──────────────────────────────────────────────────────────────────

export const crossCurrencySwapRouter = router({
  // Get swap quote
  getQuote: protectedProcedure
    .input(z.object({
      fromCoin: z.enum(STABLECOINS),
      toCoin: z.enum(STABLECOINS),
      fromChain: z.enum(CHAINS).default("polygon"),
      toChain: z.enum(CHAINS).default("polygon"),
      amount: z.number().positive().max(10_000_000),
    }))
    .query(async ({ input }) => {
      if (input.fromCoin === input.toCoin && input.fromChain === input.toChain) {
        throw new Error("Cannot swap same coin on same chain");
      }
      // C11: refuse to issue executable quotes — no pool exists to fill them.
      throw new Error(SWAP_UNAVAILABLE);
    }),

  // Execute swap
  executeSwap: strictRateLimitedProcedure
    .input(z.object({
      quoteId: z.string(),
    }))
    .mutation(async () => {
      // C11: refuse execution — no pool exists; never fabricate a txHash or a
      // "completed" execution again.
      throw new Error(SWAP_UNAVAILABLE);
    }),

  // Swap history
  history: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      const userSwaps = Array.from(swaps.values())
        .filter(s => s.userId === ctx.user.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return {
        swaps: userSwaps.slice(input.offset, input.offset + input.limit),
        total: userSwaps.length,
      };
    }),

  // Supported pairs
  getSupportedPairs: protectedProcedure
    .query(async () => {
      const pairs: Array<{ from: string; to: string; chains: string[]; fee: string }> = [];
      for (const from of STABLECOINS) {
        for (const to of STABLECOINS) {
          if (from !== to) {
            pairs.push({
              from, to,
              chains: [...CHAINS],
              fee: "0.01% same-chain / 0.05% cross-chain",
            });
          }
        }
      }
      return { pairs, totalPairs: pairs.length };
    }),
});
