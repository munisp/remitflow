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
  whiteLabelConfigs,
  users,
} from "../drizzle/schema.js";
import { eq, and } from "drizzle-orm";
import { BoundedCache, registerCache } from "./lib/boundedCache";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TenantContext {
  tenantId: number | null;
  tenantSlug: string;
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
    return { tenantId: null, tenantSlug: "remitflow-default", featureFlags: {}, whiteLabelConfig: null };
  }

  // Find user's tenant
  const [tenantUser] = await db
    .select()
    .from(tenantFeatureFlags) // reuse join path
    .limit(0); // just to warm the connection

  // Get user record for tenant_id
  const [userRow] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const tenantId: number | null = (userRow as any)?.tenantId ?? null;

  let tenant = null;
  if (tenantId) {
    [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  }
  if (!tenant) {
    [tenant] = await db.select().from(tenants).where(eq(tenants.slug, "remitflow-default")).limit(1);
  }

  // Resolve feature flags: platform defaults + tenant overrides
  const platformFlags = await db.select().from(featureFlags);
  const flags: Record<string, boolean> = {};
  for (const f of platformFlags) {
    flags[f.key] = f.default_enabled ?? false;
  }

  if (tenant) {
    const overrides = await db
      .select()
      .from(tenantFeatureFlags)
      .where(eq(tenantFeatureFlags.tenantId, tenant.id));
    for (const o of overrides) {
      flags[o.flagKey] = o.enabled ?? flags[o.flagKey];
    }
  }

  // Resolve white-label config
  let whiteLabelConfig: WhiteLabelConfig | null = null;
  if (tenant) {
    const [wl] = await db
      .select()
      .from(whiteLabelConfigs)
      .where(eq(whiteLabelConfigs.tenantId, tenant.id))
      .limit(1);
    whiteLabelConfig = wl
      ? {
          primaryColor: wl.primaryColor ?? tenant.primary_color ?? "#7c3aed",
          secondaryColor: wl.secondaryColor ?? tenant.secondary_color ?? "#06b6d4",
          accentColor: wl.accentColor ?? tenant.accent_color ?? "#f59e0b",
          brandName: wl.brandName ?? tenant.brand_name ?? "RemitFlow",
          logoUrl: wl.logoUrl ?? null,
          faviconUrl: wl.faviconUrl ?? null,
          supportEmail: wl.supportEmail ?? tenant.support_email ?? "support@remitflow.app",
          customDomain: tenant.custom_domain ?? null,
        }
      : {
          primaryColor: tenant.primary_color ?? "#7c3aed",
          secondaryColor: tenant.secondary_color ?? "#06b6d4",
          accentColor: tenant.accent_color ?? "#f59e0b",
          brandName: tenant.brand_name ?? "RemitFlow",
          logoUrl: null,
          faviconUrl: null,
          supportEmail: tenant.support_email ?? "support@remitflow.app",
          customDomain: tenant.custom_domain ?? null,
        };
  }

  const ctx: TenantContext = {
    tenantId: tenant?.id ?? null,
    tenantSlug: tenant?.slug ?? "remitflow-default",
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

export { tenantCache, flagCache as tenantFlagCacheMap };
