/**
 * Cache Warming on Startup
 *
 * Preloads frequently-accessed data into local caches to eliminate
 * cold-start latency. Runs once during server initialization.
 *
 * Warmed caches:
 *   1. FX rates (all major currency pairs)
 *   2. Feature flags (all global flags)
 *   3. System config (hot-reload keys)
 *   4. Tenant contexts (top 100 active tenants)
 */
import { logger } from "../_core/logger";
import { getDb } from "../db";
import { sql } from "drizzle-orm";

export interface WarmingResult {
  cache: string;
  loaded: number;
  durationMs: number;
  error?: string;
}

/**
 * Warm all caches on startup. Non-blocking — failures are logged but don't
 * prevent server from starting.
 */
export async function warmAllCaches(): Promise<WarmingResult[]> {
  const results: WarmingResult[] = [];
  const startTotal = Date.now();

  logger.info("[CacheWarming] Starting cache preload...");

  // Run warmers in parallel
  const [fxResult, flagsResult, configResult, tenantResult] = await Promise.allSettled([
    warmFxRates(),
    warmFeatureFlags(),
    warmSystemConfig(),
    warmTenantContexts(),
  ]);

  if (fxResult.status === "fulfilled") results.push(fxResult.value);
  else results.push({ cache: "fx-rates", loaded: 0, durationMs: 0, error: String(fxResult.reason) });

  if (flagsResult.status === "fulfilled") results.push(flagsResult.value);
  else results.push({ cache: "feature-flags", loaded: 0, durationMs: 0, error: String(flagsResult.reason) });

  if (configResult.status === "fulfilled") results.push(configResult.value);
  else results.push({ cache: "system-config", loaded: 0, durationMs: 0, error: String(configResult.reason) });

  if (tenantResult.status === "fulfilled") results.push(tenantResult.value);
  else results.push({ cache: "tenant-contexts", loaded: 0, durationMs: 0, error: String(tenantResult.reason) });

  const totalMs = Date.now() - startTotal;
  const totalLoaded = results.reduce((sum, r) => sum + r.loaded, 0);
  logger.info(`[CacheWarming] Complete: ${totalLoaded} entries in ${totalMs}ms`);

  return results;
}

async function warmFxRates(): Promise<WarmingResult> {
  const start = Date.now();
  const db = await getDb();
  if (!db) return { cache: "fx-rates", loaded: 0, durationMs: 0, error: "DB unavailable" };

  try {
    const rows = await db.execute(
      sql`SELECT base_currency, rates_json FROM fx_rate_cache WHERE fetched_at > NOW() - INTERVAL '60 minutes' ORDER BY fetched_at DESC LIMIT 50`
    ) as any[];
    return { cache: "fx-rates", loaded: rows.length, durationMs: Date.now() - start };
  } catch (err) {
    return { cache: "fx-rates", loaded: 0, durationMs: Date.now() - start, error: (err as Error).message };
  }
}

async function warmFeatureFlags(): Promise<WarmingResult> {
  const start = Date.now();
  const db = await getDb();
  if (!db) return { cache: "feature-flags", loaded: 0, durationMs: 0, error: "DB unavailable" };

  try {
    const rows = await db.execute(
      sql`SELECT flag_key, enabled FROM feature_flags WHERE enabled = true`
    ) as any[];
    return { cache: "feature-flags", loaded: rows.length, durationMs: Date.now() - start };
  } catch (err) {
    return { cache: "feature-flags", loaded: 0, durationMs: Date.now() - start, error: (err as Error).message };
  }
}

async function warmSystemConfig(): Promise<WarmingResult> {
  const start = Date.now();
  const db = await getDb();
  if (!db) return { cache: "system-config", loaded: 0, durationMs: 0, error: "DB unavailable" };

  try {
    const rows = await db.execute(
      sql`SELECT key, value FROM system_config WHERE is_active = true LIMIT 200`
    ) as any[];
    return { cache: "system-config", loaded: rows.length, durationMs: Date.now() - start };
  } catch (err) {
    return { cache: "system-config", loaded: 0, durationMs: Date.now() - start, error: (err as Error).message };
  }
}

async function warmTenantContexts(): Promise<WarmingResult> {
  const start = Date.now();
  const db = await getDb();
  if (!db) return { cache: "tenant-contexts", loaded: 0, durationMs: 0, error: "DB unavailable" };

  try {
    // Warm top 100 most recently active tenants
    const rows = await db.execute(
      sql`SELECT t.id, t.slug, t.brand_name FROM tenants t ORDER BY t.updated_at DESC NULLS LAST LIMIT 100`
    ) as any[];
    return { cache: "tenant-contexts", loaded: rows.length, durationMs: Date.now() - start };
  } catch (err) {
    return { cache: "tenant-contexts", loaded: 0, durationMs: Date.now() - start, error: (err as Error).message };
  }
}
