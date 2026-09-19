/**
 * RemitFlow — Multi-Tenancy Router (W13 rewrite)
 * ══════════════════════════════════════════════════════════════════════════════
 * Thin tRPC gateway over the tenant-management service
 * (services/tenant-management — Express). Real service contract (verified
 * against services/tenant-management/src):
 *
 *   Auth:     `Authorization: Bearer <TENANT_MANAGEMENT_API_TOKEN>` on EVERY
 *             call (middlewares/auth.ts requireServiceAuth — constant-time
 *             compare; the service refuses to boot without it in production).
 *   Routes:   POST /system/create-tenant        (requires x-tenant-id header)
 *             GET  /tenant/all
 *             GET  /tenant/:tenant_id
 *             PUT  /tenant/:tenant_id
 *             POST /tenant/:tenant_id/suspend
 *             POST /tenant/:tenant_id/unsuspend
 *             GET  /billing/                    (x-tenant-id scoped)
 *   Payload:  validations/index.ts PostCreateTenantSchema —
 *             { name, type: bank|microfinance|fintech|mto, cacCertificateUrl?,
 *               cbnLicenseUrl?, contact: { email, name, phone? }, branding?,
 *               features: [{ flag, config }], plan?, billingPeriod?,
 *               apiConfiguration? }
 *
 * W13 honesty rules (F-14): NO fabricated fallbacks. When the service is
 * unreachable or returns non-2xx the procedure throws UNAVAILABLE — nothing is
 * "queued", nothing returns fake `provisioning`/`updated:true`/`suspended:true`
 * payloads, and no Redis-only API keys are minted (no verifier exists, so the
 * generateApiKey procedure was deleted).
 *
 * NOTE: realm-per-tenant Keycloak provisioning and Permify RBAC are NOT
 * implemented by the service — earlier revisions of this file claimed
 * otherwise. Tenant lifecycle here is exactly what the service implements.
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { logger } from "../_core/logger";
import { getDb } from "../db";
import { tenantUsers } from "../../drizzle/schema";
import { getRedisClient } from "../middleware/redis";
import { sanitizeHtml } from "../_core/featurePersistence";
import { requireTotpStepUp } from "../_core/totpStepUp";
import { createAuditLog } from "../audit.service";

const redis = getRedisClient();

// ── Service config ────────────────────────────────────────────────────────────

const TENANT_SVC_URL = process.env.TENANT_MANAGEMENT_URL ?? "http://tenant-management:3010";
/** Service bearer token — must match the service's TENANT_MANAGEMENT_API_TOKEN. */
const TENANT_SVC_TOKEN = process.env.TENANT_MANAGEMENT_API_TOKEN ?? "";
const TENANT_CACHE_TTL = 300; // 5 minutes

// ── Types (service response shapes) ───────────────────────────────────────────

interface ServiceTenant {
  tenantId?: string;
  tenant_id?: string;
  name?: string;
  status?: string;
  plan?: string;
  [k: string]: unknown;
}

// ── Service caller (fail-closed, honest errors) ───────────────────────────────

/**
 * Call the tenant-management service with service auth. Throws UNAVAILABLE
 * when the token is unconfigured, the service is unreachable, or the response
 * is non-2xx — callers NEVER fabricate a success payload.
 */
async function tenantServiceCall<T>(
  path: string,
  opts: { method?: "GET" | "POST" | "PUT"; body?: unknown; tenantId?: string } = {},
): Promise<T> {
  if (!TENANT_SVC_TOKEN) {
    logger.error({ path }, "[MultiTenancy] TENANT_MANAGEMENT_API_TOKEN not configured — refusing service call (fail-closed)");
    throw new TRPCError({
      code: "UNAVAILABLE",
      message: "Tenant management service authentication is not configured",
    });
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TENANT_SVC_TOKEN}`,
  };
  if (opts.tenantId) headers["x-tenant-id"] = opts.tenantId;

  let res: Response;
  try {
    res = await fetch(`${TENANT_SVC_URL}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    logger.warn({ path, err: err instanceof Error ? err.message : String(err) }, "[MultiTenancy] tenant-management service unreachable");
    throw new TRPCError({
      code: "UNAVAILABLE",
      message: "Tenant management service is unavailable — operation not performed",
    });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    logger.warn({ path, status: res.status, detail: detail.slice(0, 300) }, "[MultiTenancy] tenant-management service rejected request");
    throw new TRPCError({
      code: res.status === 401 || res.status === 403 ? "FORBIDDEN" : "UNAVAILABLE",
      message: `Tenant management service rejected the request (HTTP ${res.status})`,
    });
  }
  return (await res.json().catch(() => ({}))) as T;
}

// ── Cache helpers (read-through cache for successful service reads only) ──────

async function getCachedTenant(tenantId: string): Promise<ServiceTenant | null> {
  try {
    if (!redis) return null;
    const cached = await redis.get(`tenant:config:${tenantId}`);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

async function cacheTenant(tenantId: string, config: ServiceTenant): Promise<void> {
  try {
    if (!redis) return;
    await redis.set(`tenant:config:${tenantId}`, JSON.stringify(config), "EX", TENANT_CACHE_TTL);
  } catch {
    // Non-fatal
  }
}

async function invalidateTenantConfigCache(tenantId: string): Promise<void> {
  try {
    if (redis) await redis.del(`tenant:config:${tenantId}`);
  } catch {
    // Redis unavailable — non-fatal
  }
}

/**
 * Scope check for per-tenant reads: global admin OR a tenant_users member of
 * the (numeric) local tenant id. Service-side string tenant ids that do not
 * map to a local tenants row require global admin (fail closed).
 */
async function assertTenantReadScope(user: { id: number; role: string }, tenantId: string): Promise<void> {
  if (user.role === "admin") return;
  const numericId = Number(tenantId);
  if (!Number.isInteger(numericId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied — tenant config requires membership" });
  }
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const [membership] = await db.select({ id: tenantUsers.id }).from(tenantUsers)
    .where(and(eq(tenantUsers.tenantId, numericId), eq(tenantUsers.userId, user.id)))
    .limit(1);
  if (!membership) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied — you are not a member of this tenant" });
  }
}

// ── tRPC Router ───────────────────────────────────────────────────────────────

export const multiTenancyRouter = router({
  /**
   * Get a tenant's configuration. W13 (F-24): was publicProcedure leaking any
   * tenant's config — now protected + membership/global-admin scoped, and fails
   * honestly (UNAVAILABLE) instead of returning a fabricated default config.
   */
  getTenantConfig: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1).max(100),
    }))
    .query(async ({ ctx, input }) => {
      await assertTenantReadScope(ctx.user, input.tenantId);

      const cached = await getCachedTenant(input.tenantId);
      if (cached) return cached;

      const result = await tenantServiceCall<{ tenant?: ServiceTenant } & ServiceTenant>(
        `/tenant/${encodeURIComponent(input.tenantId)}`,
        { tenantId: input.tenantId },
      );
      const tenant = (result.tenant ?? result) as ServiceTenant;
      await cacheTenant(input.tenantId, tenant);
      return tenant;
    }),

  /** List all tenants (admin only) — real service call, honest failure. */
  listTenants: adminProcedure
    .query(async () => {
      const result = await tenantServiceCall<{ tenants?: ServiceTenant[] } | ServiceTenant[]>("/tenant/all");
      return Array.isArray(result) ? result : (result.tenants ?? []);
    }),

  /**
   * Create a tenant via POST /system/create-tenant (real contract —
   * validations/index.ts PostCreateTenantSchema). The service-side tenant id
   * is supplied via the required x-tenant-id header (we use the slug).
   * Non-2xx → honest UNAVAILABLE. The fabricated "queued/provisioning"
   * fallback was deleted (F-14).
   */
  createTenant: adminProcedure
    .input(z.object({
      name: z.string().min(2).max(200),
      slug: z.string().min(2).max(63).regex(/^[a-z0-9-]+$/),
      type: z.enum(["bank", "microfinance", "fintech", "mto"]),
      contact: z.object({
        email: z.string().email(),
        name: z.string().min(2).max(200),
        phone: z.string().max(32).optional(),
      }),
      cacCertificateUrl: z.string().url().optional(),
      cbnLicenseUrl: z.string().url().optional(),
      branding: z.object({
        logoUrl: z.string().optional(),
        faviconUrl: z.string().optional(),
        primaryColor: z.string().optional(),
        secondaryColor: z.string().optional(),
        domain: z.string().optional(),
      }).optional(),
      features: z.array(z.object({
        flag: z.string().min(1).max(64),
        config: z.record(z.any()),
      })).default([]),
      plan: z.enum(["standard", "premium", "enterprise"]).optional(),
      billingPeriod: z.enum(["monthly", "annual"]).optional(),
      apiConfiguration: z.object({
        webhookUrl: z.string().optional(),
        callbackUrl: z.string().optional(),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { slug, ...payload } = input;
      const result = await tenantServiceCall<{
        status?: string;
        tenant?: ServiceTenant;
        billingProfile?: unknown;
      }>("/system/create-tenant", { method: "POST", body: payload, tenantId: slug });

      await createAuditLog({
        userId: ctx.user.id,
        action: "TENANT_CREATED_VIA_SERVICE",
        targetType: "tenants",
        description: `Tenant '${slug}' (${input.name}) created via tenant-management service`,
        metadata: { slug, name: input.name, type: input.type, plan: input.plan ?? null },
      });

      logger.info({ slug, tenant: result.tenant }, "[MultiTenancy] Tenant created via service");
      return {
        slug,
        tenant: result.tenant ?? null,
        billingProfileCreated: result.billingProfile != null,
        message: "Tenant created by the tenant-management service.",
      };
    }),

  /** Update tenant branding (PUT /tenant/:id { branding }) — honest failure. */
  updateBranding: adminProcedure
    .input(z.object({
      tenantId: z.string().min(1).max(100),
      logoUrl: z.string().url().optional(),
      primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      domain: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { tenantId, ...rawBranding } = input;
      // Sanitize text fields to prevent XSS
      const branding = {
        ...rawBranding,
        domain: rawBranding.domain ? sanitizeHtml(rawBranding.domain) : rawBranding.domain,
      };
      await tenantServiceCall(`/tenant/${encodeURIComponent(tenantId)}`, {
        method: "PUT",
        body: { branding },
        tenantId,
      });
      await invalidateTenantConfigCache(tenantId);
      logger.info({ tenantId }, "[MultiTenancy] Branding updated via service");
      return { updated: true, tenantId };
    }),

  /**
   * Update tenant feature flags (PUT /tenant/:id { features }) using the
   * service's real shape: [{ flag, config }].
   */
  updateFeatureFlags: adminProcedure
    .input(z.object({
      tenantId: z.string().min(1).max(100),
      features: z.array(z.object({
        flag: z.string().min(1).max(64),
        config: z.record(z.any()),
      })).min(1),
    }))
    .mutation(async ({ input }) => {
      await tenantServiceCall(`/tenant/${encodeURIComponent(input.tenantId)}`, {
        method: "PUT",
        body: { features: input.features },
        tenantId: input.tenantId,
      });
      await invalidateTenantConfigCache(input.tenantId);
      logger.info({ tenantId: input.tenantId, flags: input.features.map((f) => f.flag) }, "[MultiTenancy] Feature flags updated via service");
      return { updated: true, tenantId: input.tenantId, features: input.features };
    }),

  // NOTE: generateApiKey was DELETED (F-14) — it minted Redis-only keys with
  // no verifier anywhere, i.e. keys that authenticated nothing. A real
  // API-key path requires a verifier; partnerApiKeys (partnerApplications.ts)
  // is the canonical partner-key flow.

  /** Tenant billing info (GET /billing/, x-tenant-id scoped) — honest failure. */
  getBillingSummary: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      await assertTenantReadScope(ctx.user, input.tenantId);
      const result = await tenantServiceCall<{ billing_info?: unknown }>("/billing/", {
        tenantId: input.tenantId,
      });
      return { tenantId: input.tenantId, billingInfo: result.billing_info ?? null };
    }),

  /** Suspend a tenant (admin + TOTP) — POST /tenant/:id/suspend, honest failure. */
  suspendTenant: adminProcedure
    .input(z.object({
      tenantId: z.string().min(1).max(100),
      reason: z.string().min(10).max(500),
      totpCode: z.string().regex(/^\d{6}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "tenant suspension (service)");
      await tenantServiceCall(`/tenant/${encodeURIComponent(input.tenantId)}/suspend`, {
        method: "POST",
        body: { reason: input.reason },
        tenantId: input.tenantId,
      });
      await invalidateTenantConfigCache(input.tenantId);
      await createAuditLog({
        userId: ctx.user.id,
        action: "TENANT_SUSPENDED_VIA_SERVICE",
        targetType: "tenants",
        severity: "warning",
        description: `Tenant '${input.tenantId}' suspended via tenant-management service: ${input.reason}`,
        metadata: { tenantId: input.tenantId, reason: input.reason },
      });
      logger.warn({ tenantId: input.tenantId, reason: input.reason }, "[MultiTenancy] Tenant suspended via service");
      return { suspended: true, tenantId: input.tenantId };
    }),

  /** Unsuspend a tenant (admin + TOTP) — POST /tenant/:id/unsuspend. */
  unsuspendTenant: adminProcedure
    .input(z.object({
      tenantId: z.string().min(1).max(100),
      totpCode: z.string().regex(/^\d{6}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "tenant unsuspension (service)");
      await tenantServiceCall(`/tenant/${encodeURIComponent(input.tenantId)}/unsuspend`, {
        method: "POST",
        tenantId: input.tenantId,
      });
      await invalidateTenantConfigCache(input.tenantId);
      await createAuditLog({
        userId: ctx.user.id,
        action: "TENANT_UNSUSPENDED_VIA_SERVICE",
        targetType: "tenants",
        description: `Tenant '${input.tenantId}' unsuspended via tenant-management service`,
        metadata: { tenantId: input.tenantId },
      });
      logger.info({ tenantId: input.tenantId }, "[MultiTenancy] Tenant unsuspended via service");
      return { suspended: false, tenantId: input.tenantId };
    }),
});
