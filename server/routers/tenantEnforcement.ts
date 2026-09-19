/**
 * Tenant Feature Flag Enforcement Middleware
 * Wraps any tRPC procedure to check if the feature flag is enabled for the user's tenant.
 * Usage: tenantFlagProcedure("payments.send").query(...)
 *
 * W13 (F-15) rewrite — the previous version queried nonexistent columns
 * (ff.flag_key, tff.rollout_percentage, feature_flags.enabled) and FAILED OPEN
 * (`catch { return true }`, unknown flag → enabled). Real schema:
 *   feature_flags:        key (unique), default_enabled, rollout_pct, ...
 *   tenant_feature_flags: tenant_id, flag_id → feature_flags.id, enabled
 * Fail-closed policy: unknown flag → false; DB error → false (+ alert log).
 */
import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../_core/logger";
import { BoundedCache, registerCache } from "../lib/boundedCache";
import { resolveTenantContext } from "../tenantMiddleware";

// Cache feature flag lookups for 60 seconds — bounded LRU
const flagCache = new BoundedCache<string, boolean>({
  maxSize: 2000,
  defaultTtlMs: 60_000,
  name: "tenant-feature-flags",
});
registerCache(flagCache as unknown as BoundedCache<unknown, unknown>);

async function isFlagEnabled(flagKey: string, tenantId: number | null): Promise<boolean> {
  const cacheKey = `${tenantId ?? "global"}:${flagKey}`;
  const cached = flagCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const db = await getDb();
  if (!db) {
    // Fail CLOSED — a flag check that cannot run must deny the feature.
    logger.error({ flagKey, tenantId }, "[TenantEnforcement] DB unavailable — flag denied (fail-closed)");
    return false;
  }

  try {
    // Tenant-specific override first (join tenant_feature_flags.flag_id →
    // feature_flags.id; the override row's `enabled` wins).
    if (tenantId != null) {
      const tenantRows = (await db.execute(
        sql`SELECT tff.enabled
            FROM tenant_feature_flags tff
            JOIN feature_flags ff ON ff.id = tff.flag_id
            WHERE ff.key = ${flagKey} AND tff.tenant_id = ${tenantId}
            LIMIT 1`,
      )) as unknown as Array<{ enabled: boolean }>;
      if (tenantRows.length > 0) {
        const enabled = Boolean(tenantRows[0].enabled);
        flagCache.set(cacheKey, enabled);
        return enabled;
      }
    }

    // Fall back to the platform default. Unknown flag → FALSE (fail closed).
    const globalRows = (await db.execute(
      sql`SELECT default_enabled FROM feature_flags WHERE key = ${flagKey} LIMIT 1`,
    )) as unknown as Array<{ default_enabled: boolean }>;
    if (globalRows.length === 0) {
      logger.warn({ flagKey }, "[TenantEnforcement] unknown feature flag — denied (fail-closed)");
      flagCache.set(cacheKey, false);
      return false;
    }
    const enabled = Boolean(globalRows[0].default_enabled);
    flagCache.set(cacheKey, enabled);
    return enabled;
  } catch (err) {
    // Fail CLOSED + alert — a flag-evaluation error must never enable a feature.
    logger.error({ flagKey, tenantId, err: err instanceof Error ? err.message : String(err) },
      "[TenantEnforcement] flag evaluation failed — denied (fail-closed)");
    return false;
  }
}

/**
 * Create a protected procedure that enforces a feature flag.
 * If the flag is disabled for the user's tenant, throws FORBIDDEN.
 * W13: tenant is resolved via resolveTenantContext (users.tenant_id) — the old
 * code read ctx.user.tenantId, a field that does not exist on the session user.
 */
export function tenantFlagProcedure(flagKey: string) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    const tenantCtx = await resolveTenantContext(ctx.user.id);
    const enabled = await isFlagEnabled(flagKey, tenantCtx.tenantId);
    if (!enabled) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Feature '${flagKey}' is not available for your account. Contact your administrator.`,
      });
    }
    return next({ ctx });
  });
}

/** Invalidate the flag cache (call after admin toggles a flag) */
export function invalidateFlagCache(flagKey?: string, tenantId?: number) {
  if (flagKey && tenantId !== undefined) {
    flagCache.delete(`${tenantId}:${flagKey}`);
    flagCache.delete(`global:${flagKey}`);
  } else {
    flagCache.clear();
  }
}

export { flagCache as tenantFlagCache };
