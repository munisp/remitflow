/**
 * Tenant Feature Flag Enforcement Middleware
 * Wraps any tRPC procedure to check if the feature flag is enabled for the user's tenant.
 * Usage: tenantFlagProcedure("payments.send").query(...)
 */
import { TRPCError } from "@trpc/server";
import { protectedProcedure ,
  auditedProcedure, rateLimitedProcedure
} from "../_core/trpc";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { BoundedCache, registerCache } from "../lib/boundedCache";

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
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" }); // Fail open if DB is unavailable

  try {
    // Check tenant-specific override first
    if (tenantId) {
      const tenantRows = await db.execute(
        sql`SELECT tff.enabled, tff.rollout_percentage
            FROM tenant_feature_flags tff
            JOIN feature_flags ff ON ff.id = tff.flag_id
            WHERE ff.flag_key = ${flagKey} AND tff.tenant_id = ${tenantId}
            LIMIT 1`
      ) as any[];
      if (tenantRows.length > 0) {
        const row = tenantRows[0];
        const enabled = Boolean(row.enabled);
        flagCache.set(cacheKey, enabled);
        return enabled;
      }
    }

    // Fall back to global flag default
    const globalRows = await db.execute(
      sql`SELECT enabled, rollout_percentage FROM feature_flags WHERE flag_key = ${flagKey} LIMIT 1`
    ) as any[];
    if (globalRows.length === 0) return true; // Unknown flag = enabled by default
    const row = globalRows[0];
    const enabled = Boolean(row.enabled);
    flagCache.set(cacheKey, enabled);
    return enabled;
  } catch {
    return true; // Fail open
  }
}

/**
 * Create a protected procedure that enforces a feature flag.
 * If the flag is disabled for the user's tenant, throws FORBIDDEN.
 */
export function tenantFlagProcedure(flagKey: string) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    const tenantId = (ctx.user as any).tenantId ?? null;
    const enabled = await isFlagEnabled(flagKey, tenantId);
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
