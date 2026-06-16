/**
 * RemitFlow FX Rate Service v8
 *
 * Multi-source FX rate provider with automatic fallback chain:
 *   1. Open Exchange Rates (primary — free tier, 1000 req/month)
 *   2. Frankfurter API (secondary — free, ECB rates, no key needed)
 *   3. ExchangeRate-API (tertiary — free tier, 1500 req/month)
 *   4. Static fallback rates (always available)
 *
 * Features:
 *   - Redis caching (15-minute TTL)
 *   - gRPC FX service integration (when Rust FX service is running)
 *   - Rate change detection for FX alert triggering
 *   - Bid/ask spread calculation
 *   - Historical rate snapshots
 */

import { getDb } from "./db";
import { sql } from "drizzle-orm";
import { fxGetRate as grpcFxGetRate } from "./grpc-client";
import { circuitBreakers } from "./services/circuitBreaker";
import { logger } from './_core/logger';

// ============================================================================
// Static fallback rates (USD base, updated April 2026)
// ============================================================================

export const STATIC_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.9215,
  GBP: 0.7925,
  JPY: 149.5,
  CAD: 1.36,
  AUD: 1.53,
  CHF: 0.895,
  CNY: 7.24,
  INR: 83.1,
  SGD: 1.34,
  HKD: 7.82,
  SEK: 10.4,
  NOK: 10.6,
  DKK: 6.88,
  PLN: 3.97,
  CZK: 22.8,
  HUF: 356,
  RON: 4.58,
  TRY: 30.5,
  BRL: 4.97,
  MXN: 17.2,
  ZAR: 18.7,
  NGN: 1538.46,
  KES: 130.5,
  GHS: 12.4,
  TZS: 2580,
  UGX: 3750,
  RWF: 1285,
  XOF: 605,
  XAF: 605,
  EGP: 30.9,
  MAD: 10.1,
  ETB: 56.8,
  SAR: 3.75,
  AED: 3.67,
  PKR: 279,
  BDT: 110,
  THB: 35.1,
  MYR: 4.72,
  IDR: 15750,
  PHP: 56.2,
  TWD: 31.8,
};

// ============================================================================
// In-memory rate cache (supplement to Redis) — bounded LRU
// ============================================================================
import { BoundedCache, registerCache } from "./lib/boundedCache";

interface RateCache {
  rates: Record<string, number>;
  base: string;
  fetchedAt: number;
  source: string;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const memCache = new BoundedCache<string, RateCache>({
  maxSize: 200,
  defaultTtlMs: CACHE_TTL_MS,
  name: "fx-rates-mem",
});
registerCache(memCache as unknown as BoundedCache<unknown, unknown>);

// ============================================================================
// Source 1: Open Exchange Rates
// ============================================================================

async function fetchFromOpenExchangeRates(base = "USD"): Promise<Record<string, number> | null> {
  const appId = process.env.OPEN_EXCHANGE_RATES_APP_ID;
  if (!appId) return null;

  try {
    const res = await circuitBreakers.fxProvider.execute(() =>
      fetch(
        `https://openexchangerates.org/api/latest.json?app_id=${appId}&base=${base}&prettyprint=false`,
        { signal: AbortSignal.timeout(5000) }
      )
    );
    if (!res.ok) return null;
    const data = await res.json() as { rates?: Record<string, number> };
    if (data.rates && Object.keys(data.rates).length > 10) {
      logger.info(`[FX] Fetched ${Object.keys(data.rates).length} rates from Open Exchange Rates`);
      return data.rates;
    }
    return null;
  } catch (err) {
    logger.warn("[FX] Open Exchange Rates failed:", (err as Error).message);
    return null;
  }
}

// ============================================================================
// Source 2: Frankfurter API (European Central Bank rates, free, no key)
// ============================================================================

async function fetchFromFrankfurter(base = "USD"): Promise<Record<string, number> | null> {
  try {
    const res = await circuitBreakers.fxProvider.execute(() =>
      fetch(
        `https://api.frankfurter.app/latest?from=${base}`,
        { signal: AbortSignal.timeout(5000) }
      )
    );
    if (!res.ok) return null;
    const data = await res.json() as { rates?: Record<string, number> };
    if (data.rates && Object.keys(data.rates).length > 5) {
      // Add base currency itself
      const rates = { ...data.rates, [base]: 1 };
      logger.info(`[FX] Fetched ${Object.keys(rates).length} rates from Frankfurter (ECB)`);
      return rates;
    }
    return null;
  } catch (err) {
    logger.warn("[FX] Frankfurter API failed:", (err as Error).message);
    return null;
  }
}

// ============================================================================
// Source 3: ExchangeRate-API (free tier, no key for basic endpoint)
// ============================================================================

async function fetchFromExchangeRateAPI(base = "USD"): Promise<Record<string, number> | null> {
  try {
    const res = await circuitBreakers.fxProvider.execute(() =>
      fetch(
        `https://open.er-api.com/v6/latest/${base}`,
        { signal: AbortSignal.timeout(5000) }
      )
    );
    if (!res.ok) return null;
    const data = await res.json() as { rates?: Record<string, number>; result?: string };
    if (data.result === "success" && data.rates && Object.keys(data.rates).length > 10) {
      logger.info(`[FX] Fetched ${Object.keys(data.rates).length} rates from ExchangeRate-API`);
      return data.rates;
    }
    return null;
  } catch (err) {
    logger.warn("[FX] ExchangeRate-API failed:", (err as Error).message);
    return null;
  }
}

// ============================================================================
// Main rate fetcher with fallback chain
// ============================================================================

export async function fetchLiveRates(base = "USD"): Promise<{ rates: Record<string, number>; source: string }> {
  // Helper: ensure static rates are always present as base layer
  function mergeWithStatic(r: Record<string, number>): Record<string, number> {
    const bRate = STATIC_RATES[base] ?? 1;
    const staticBase = Object.fromEntries(
      Object.entries(STATIC_RATES).map(([c, v]) => [c, v / bRate])
    );
    return { ...staticBase, ...r };
  }

  // Check memory cache first (BoundedCache handles TTL internally)
  const cached = memCache.get(base);
  if (cached) {
    return { rates: mergeWithStatic(cached.rates), source: `${cached.source} (cached)` };
  }

  // Check DB cache (written by scheduler)
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.execute(
        sql`SELECT rates_json, fetched_at FROM fx_rate_cache WHERE base_currency = ${base} AND fetched_at > NOW() - INTERVAL '15 minutes' LIMIT 1`
      );
      const row = (rows as any[])?.[0];
      if (row?.rates_json) {
        const rates = mergeWithStatic(JSON.parse(row.rates_json));
        memCache.set(base, { rates, base, fetchedAt: Date.now(), source: "db-cache" });
        return { rates, source: "db-cache" };
      }
    }
  } catch { /* ignore cache miss */ }

  // Try gRPC FX service first (Rust service — most accurate)
  const grpcPairs = ["EUR", "GBP", "NGN", "KES", "GHS", "ZAR", "INR", "JPY"];
  const grpcRates: Record<string, number> = { [base]: 1 };
  let grpcSuccess = false;

  for (const target of grpcPairs) {
    if (target === base) continue;
    const grpcRate = await grpcFxGetRate(base, target).catch(() => null);
    if (grpcRate) {
      grpcRates[target] = grpcRate.rate;
      grpcSuccess = true;
    }
  }

  // Try external APIs in fallback order
  let rates: Record<string, number> | null = null;
  let source = "static-fallback";

  rates = await fetchFromOpenExchangeRates(base);
  if (rates) { source = "open-exchange-rates"; }

  if (!rates) {
    rates = await fetchFromExchangeRateAPI(base);
    if (rates) { source = "exchangerate-api"; }
  }

  if (!rates) {
    rates = await fetchFromFrankfurter(base);
    if (rates) { source = "frankfurter-ecb"; }
  }

  if (!rates) {
    // Convert static rates to requested base
    const baseRate = STATIC_RATES[base] ?? 1;
    rates = Object.fromEntries(
      Object.entries(STATIC_RATES).map(([currency, rate]) => [currency, rate / baseRate])
    );
    source = "static-fallback";
  }

  // Always ensure static fallback currencies are present as a base layer
  // (e.g. NGN is not in ECB/Frankfurter but is in our static rates)
  const baseRate = STATIC_RATES[base] ?? 1;
  const staticConverted = Object.fromEntries(
    Object.entries(STATIC_RATES).map(([currency, rate]) => [currency, rate / baseRate])
  );
  // Merge: static as base layer, live rates override on top
  rates = { ...staticConverted, ...rates };

  // Merge gRPC rates (override with more accurate values if available)
  if (grpcSuccess) {
    rates = { ...rates, ...grpcRates };
    source = `${source}+grpc`;
  }

  // Save to memory cache
  memCache.set(base, { rates, base, fetchedAt: Date.now(), source });

  // Save to DB cache (non-blocking)
  saveRatesToDB(base, rates).catch(() => {});

  return { rates, source };
}

// ============================================================================
// DB cache persistence
// ============================================================================

async function saveRatesToDB(base: string, rates: Record<string, number>): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const ratesJson = JSON.stringify(rates);
    await db.execute(
      sql`INSERT INTO fx_rate_cache (base_currency, rates_json, fetched_at)
          VALUES (${base}, ${ratesJson}, NOW())
          ON CONFLICT (base_currency) DO UPDATE SET rates_json = ${ratesJson}, fetched_at = NOW()`
    );
  } catch { /* non-critical */ }
}

// ============================================================================
// Rate change detection for FX alerts
// ============================================================================

export interface RateChange {
  fromCurrency: string;
  toCurrency: string;
  previousRate: number;
  currentRate: number;
  changePercent: number;
  direction: "up" | "down";
}

export async function detectRateChanges(
  currentRates: Record<string, number>,
  base = "USD"
): Promise<RateChange[]> {
  const changes: RateChange[] = [];

  try {
    const db = await getDb();
    if (!db) return changes;

    // Get previous rates from DB
    const rows = await db.execute(
      sql`SELECT rates_json FROM fx_rate_cache 
          WHERE base_currency = ${base} 
          AND fetched_at < NOW() - INTERVAL '5 minutes'
          ORDER BY fetched_at DESC LIMIT 1`
    );
    const row = (rows as any[])?.[0];
    if (!row?.rates_json) return changes;

    const previousRates: Record<string, number> = JSON.parse(row.rates_json);

    for (const [currency, currentRate] of Object.entries(currentRates)) {
      const previousRate = previousRates[currency];
      if (!previousRate || previousRate === 0) continue;

      const changePercent = ((currentRate - previousRate) / previousRate) * 100;
      if (Math.abs(changePercent) >= 0.1) { // Only report changes >= 0.1%
        changes.push({
          fromCurrency: base,
          toCurrency: currency,
          previousRate,
          currentRate,
          changePercent: Math.round(changePercent * 100) / 100,
          direction: changePercent > 0 ? "up" : "down",
        });
      }
    }
  } catch { /* non-critical */ }

  return changes;
}

// ============================================================================
// Get a single pair rate with bid/ask spread
// ============================================================================

export interface PairRate {
  fromCurrency: string;
  toCurrency: string;
  mid: number;
  bid: number;
  ask: number;
  spread: number;
  source: string;
  timestamp: string;
}

export async function getPairRate(fromCurrency: string, toCurrency: string): Promise<PairRate> {
  // Try gRPC first
  const grpcRate = await grpcFxGetRate(fromCurrency, toCurrency).catch(() => null);
  if (grpcRate) {
    return {
      fromCurrency,
      toCurrency,
      mid: grpcRate.rate,
      bid: grpcRate.bid,
      ask: grpcRate.ask,
      spread: grpcRate.spread,
      source: grpcRate.source,
      timestamp: grpcRate.timestamp,
    };
  }

  // Fall back to live rates
  const { rates, source } = await fetchLiveRates("USD");
  const fromRate = rates[fromCurrency] ?? 1;
  const toRate = rates[toCurrency] ?? 1;
  const mid = toRate / fromRate;
  const spreadBps = 30; // 30 basis points (0.3%)
  const halfSpread = mid * (spreadBps / 10000) / 2;

  return {
    fromCurrency,
    toCurrency,
    mid,
    bid: mid - halfSpread,
    ask: mid + halfSpread,
    spread: spreadBps,
    source,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Ensure fx_rate_cache table exists
// ============================================================================

export async function ensureFxRateCacheTable(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS fx_rate_cache (
        id SERIAL PRIMARY KEY,
        base_currency VARCHAR(10) NOT NULL UNIQUE,
        rates_json TEXT NOT NULL,
        fetched_at TIMESTAMP NOT NULL
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_fx_fetched_at ON fx_rate_cache (fetched_at)`);
  } catch { /* table may already exist */ }
}
