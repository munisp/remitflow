/**
 * fxRateCache.ts
 * IndexedDB-backed FX rate cache with 15-minute TTL and stale-while-revalidate.
 * Designed for offline/low-connectivity African market environments.
 */

import { get, set, del } from "idb-keyval";

export interface CachedRates {
  rates: Record<string, number>; // asset → USD rate
  baseCurrency: string;
  fetchedAt: number; // UTC ms
  source: "live" | "cached" | "stale";
}

const CACHE_KEY = "remitflow:fx-rates";
const DELTA_KEY = "remitflow:fx-rates-delta";
const TTL_MS = 15 * 60 * 1000; // 15 minutes
const STALE_WARN_MS = 30 * 60 * 1000; // 30 minutes — show warning

/**
 * Read cached rates from IndexedDB.
 * Returns null if no cache exists.
 */
export async function getCachedRates(): Promise<CachedRates | null> {
  try {
    const cached = await get<CachedRates>(CACHE_KEY);
    if (!cached) return null;

    const age = Date.now() - cached.fetchedAt;
    if (age < TTL_MS) {
      return { ...cached, source: "live" };
    } else if (age < STALE_WARN_MS) {
      return { ...cached, source: "cached" };
    } else {
      return { ...cached, source: "stale" };
    }
  } catch {
    return null;
  }
}

/**
 * Persist fresh rates to IndexedDB.
 */
export async function setCachedRates(
  rates: Record<string, number>,
  baseCurrency = "USD"
): Promise<void> {
  try {
    const entry: CachedRates = {
      rates,
      baseCurrency,
      fetchedAt: Date.now(),
      source: "live",
    };
    await set(CACHE_KEY, entry);
  } catch {
    // IndexedDB unavailable (private browsing) — silently ignore
  }
}

/**
 * Apply a delta update to the cached rates.
 * Only changed keys are updated; unchanged keys are preserved.
 */
export async function applyRateDelta(
  delta: Record<string, number>
): Promise<CachedRates | null> {
  try {
    const existing = await get<CachedRates>(CACHE_KEY);
    const merged = {
      ...(existing?.rates ?? {}),
      ...delta,
    };
    const updated: CachedRates = {
      rates: merged,
      baseCurrency: existing?.baseCurrency ?? "USD",
      fetchedAt: Date.now(),
      source: "live",
    };
    await set(CACHE_KEY, updated);
    // Track delta sequence for debugging
    const prev = (await get<number[]>(DELTA_KEY)) ?? [];
    await set(DELTA_KEY, [...prev.slice(-99), Object.keys(delta).length]);
    return updated;
  } catch {
    return null;
  }
}

/**
 * Clear the rate cache (e.g., on logout).
 */
export async function clearRateCache(): Promise<void> {
  try {
    await del(CACHE_KEY);
    await del(DELTA_KEY);
  } catch {
    // ignore
  }
}

/**
 * Get a single rate from cache (asset → USD).
 * Returns null if not cached.
 */
export async function getCachedRate(asset: string): Promise<number | null> {
  const cached = await getCachedRates();
  return cached?.rates[asset.toUpperCase()] ?? null;
}

/**
 * Compute cross-rate from cache: fromAsset → toAsset.
 * Uses USD as hub currency (hub-and-spoke).
 */
export async function getCrossRate(
  from: string,
  to: string
): Promise<{ rate: number; source: CachedRates["source"] } | null> {
  const cached = await getCachedRates();
  if (!cached) return null;

  const fromRate = cached.rates[from.toUpperCase()];
  const toRate = cached.rates[to.toUpperCase()];
  if (!fromRate || !toRate) return null;

  // fromAsset/USD ÷ toAsset/USD = fromAsset/toAsset cross-rate
  const rate = toRate / fromRate;
  return { rate, source: cached.source };
}
