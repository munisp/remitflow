/**
 * Tenant-aware middleware for tRPC and Express.
 * - Resolves the calling user's tenant from the DB
 * - Checks per-tenant feature flag overrides
 * - Injects white-label CSS variables into the HTML shell
 */
import type { Request, Response, NextFunction } from "express";
import { getDb } from "./db.js";
import {
  tenants,
  tenantFeatureFlags,
  featureFlags,
  users,
} from "../drizzle/schema.js";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { BoundedCache, registerCache } from "./lib/boundedCache";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TenantContext {
  tenantId: number | null;
  tenantSlug: string;
  /** tenants.status ('trial'|'active'|'suspended'|'churned') — null when no tenant resolved. */
  tenantStatus: string | null;
  featureFlags: Record<string, boolean>;
  whiteLabelConfig: WhiteLabelConfig | null;
}

export interface WhiteLabelConfig {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  brandName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  supportEmail: string;
  customDomain: string | null;
}

// ─── Cache (TTL: 60 seconds) — bounded LRU ───────────────────────────────────

const CACHE_TTL = 60_000;
const tenantCache = new BoundedCache<number, TenantContext>({
  maxSize: 5000,
  defaultTtlMs: CACHE_TTL,
  name: "tenant-context",
});
registerCache(tenantCache as unknown as BoundedCache<unknown, unknown>);
const flagCache = new BoundedCache<string, Record<string, boolean>>({
  maxSize: 5000,
  defaultTtlMs: CACHE_TTL,
  name: "tenant-flags",
});
registerCache(flagCache as unknown as BoundedCache<unknown, unknown>);

// ─── Core resolver ────────────────────────────────────────────────────────────

/**
 * Resolve tenant context for a given userId.
 * Falls back to the default "remitflow-default" tenant.
 */
export async function resolveTenantContext(userId: number): Promise<TenantContext> {
  // Check cache (BoundedCache handles TTL)
  const cached = tenantCache.get(userId);
  if (cached) return cached;

  const db = await getDb();
  if (!db) {
    return { tenantId: null, tenantSlug: "remitflow-default", tenantStatus: null, featureFlags: {}, whiteLabelConfig: null };
  }

  // W13 (F-T1): resolve the caller's tenant via the real users.tenant_id
  // column (additive 0092_wave13.sql). Before this column existed every user
  // collapsed onto the default tenant, breaking BDC tenant isolation.
  const [userRow] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const tenantId: number | null = userRow?.tenantId ?? null;

  let tenant = null;
  if (tenantId) {
    [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  }
  if (!tenant) {
    [tenant] = await db.select().from(tenants).where(eq(tenants.slug, "remitflow-default")).limit(1);
  }

  // Resolve feature flags: platform defaults + tenant overrides.
  // Real columns: feature_flags.key / default_enabled; tenant overrides join
  // tenant_feature_flags.flag_id → feature_flags.id (there is no flag_key on
  // tenant_feature_flags).
  const platformFlags = await db.select().from(featureFlags);
  const flags: Record<string, boolean> = {};
  for (const f of platformFlags) {
    flags[f.key] = f.defaultEnabled ?? false;
  }

  if (tenant) {
    const overrides = await db
      .select({
        key: featureFlags.key,
        enabled: tenantFeatureFlags.enabled,
      })
      .from(tenantFeatureFlags)
      .innerJoin(featureFlags, eq(tenantFeatureFlags.flagId, featureFlags.id))
      .where(eq(tenantFeatureFlags.tenantId, tenant.id));
    for (const o of overrides) {
      flags[o.key] = o.enabled ?? flags[o.key];
    }
  }

  // Resolve white-label config. NOTE: white_label_configs has NO color/brand
  // columns (onboarding steps, nav sections, legal URLs only) — branding comes
  // from the tenants row. Earlier revisions read wl.primaryColor etc. which
  // do not exist.
  let whiteLabelConfig: WhiteLabelConfig | null = null;
  if (tenant) {
    whiteLabelConfig = {
      primaryColor: tenant.primaryColor ?? "#7c3aed",
      secondaryColor: tenant.secondaryColor ?? "#06b6d4",
      accentColor: tenant.accentColor ?? "#f59e0b",
      brandName: tenant.brandName ?? "RemitFlow",
      logoUrl: tenant.logoUrl ?? null,
      faviconUrl: tenant.faviconUrl ?? null,
      supportEmail: tenant.supportEmail ?? "support@remitflow.app",
      customDomain: tenant.customDomain ?? null,
    };
  }

  const ctx: TenantContext = {
    tenantId: tenant?.id ?? null,
    tenantSlug: tenant?.slug ?? "remitflow-default",
    tenantStatus: tenant?.status ?? null,
    featureFlags: flags,
    whiteLabelConfig,
  };

  tenantCache.set(userId, ctx);
  return ctx;
}

/**
 * Check if a feature flag is enabled for a user.
 * Uses cached tenant context.
 */
export async function isFeatureEnabled(userId: number, flagKey: string): Promise<boolean> {
  const ctx = await resolveTenantContext(userId);
  return ctx.featureFlags[flagKey] ?? false;
}

// ─── Express middleware: inject white-label CSS ───────────────────────────────

/**
 * GET /api/tenant/theme.css
 * Returns CSS custom properties for the calling user's tenant.
 * Used by the frontend to apply white-label branding at runtime.
 */
export async function tenantThemeCssHandler(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.setHeader("Content-Type", "text/css");
      return res.send("/* unauthenticated */");
    }

    const ctx = await resolveTenantContext(userId);
    const wl = ctx.whiteLabelConfig;

    const css = wl
      ? `
:root {
  --brand-primary: ${wl.primaryColor};
  --brand-secondary: ${wl.secondaryColor};
  --brand-accent: ${wl.accentColor};
  --brand-name: "${wl.brandName}";
}
`.trim()
      : "/* default theme */";

    res.setHeader("Content-Type", "text/css");
    res.setHeader("Cache-Control", "private, max-age=60");
    return res.send(css);
  } catch {
    res.setHeader("Content-Type", "text/css");
    return res.send("/* error */");
  }
}

/**
 * GET /api/tenant/config
 * Returns the current tenant's public config (brand name, colors, logo).
 */
export async function tenantConfigHandler(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.json({ brandName: "RemitFlow", primaryColor: "#7c3aed" });
    }
    const ctx = await resolveTenantContext(userId);
    return res.json({
      tenantSlug: ctx.tenantSlug,
      ...ctx.whiteLabelConfig,
      featureFlags: ctx.featureFlags,
    });
  } catch {
    return res.json({ brandName: "RemitFlow", primaryColor: "#7c3aed" });
  }
}

/**
 * Invalidate tenant cache for a user (call after tenant assignment changes).
 */
export function invalidateTenantCache(userId: number) {
  tenantCache.delete(userId);
}

/**
 * W13 (F-16): tenant-lifecycle money guard. Throws FORBIDDEN when the caller's
 * tenant is 'suspended' or 'churned'. 'trial' tenants are ALLOWED (documented
 * product decision: trial users may transact within their plan limits).
 * A user with no resolvable tenant (tenantId null) is NOT blocked here —
 * platform-default users have no tenant lifecycle state.
 * Wired into the canonical transfer creation path (_core/transferPipeline.ts).
 */
export async function assertTenantNotSuspended(userId: number): Promise<void> {
  const ctx = await resolveTenantContext(userId);
  if (ctx.tenantId == null) return;
  if (ctx.tenantStatus === "suspended" || ctx.tenantStatus === "churned") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Tenant '${ctx.tenantSlug}' is ${ctx.tenantStatus} — transfers are disabled. Contact support.`,
    });
  }
}

export { tenantCache, flagCache as tenantFlagCacheMap };
