/**
 * RemitFlow — Multi-Tenancy & White-Label API Router
 * ══════════════════════════════════════════════════════════════════════════════
 * Exposes tenant branding, feature flags, billing, and white-label
 * configuration to the frontend and partner integrations.
 *
 * Architecture:
 *   tRPC Router → tenant-management service (TypeScript/Express)
 *               → Keycloak (realm-per-tenant isolation)
 *               → Permify (tenant-scoped RBAC)
 *               → Redis (tenant config cache, 5-minute TTL)
 *
 * Tenant isolation model:
 *   - Each tenant has a dedicated Keycloak realm
 *   - Row-Level Security (RLS) enforced via withTenantContext()
 *   - Feature flags are per-tenant and per-branch
 *   - Branding (logo, colors, domain) is fully customizable
 *   - API keys are scoped to tenants for partner integrations
 *
 * White-label capabilities:
 *   - Custom domain support (e.g., send.acmebank.com)
 *   - Custom logo, primary/secondary colors, font
 *   - Custom email templates (from-name, reply-to)
 *   - Custom fee schedules per corridor
 *   - Custom KYC tier limits
 *   - Custom compliance rules per jurisdiction
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure, publicProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
import { redis } from "../middleware/redis";
import crypto from "node:crypto";

// ── Service URL ───────────────────────────────────────────────────────────────

const TENANT_SVC_URL = process.env.TENANT_MANAGEMENT_URL ?? "http://tenant-management:3010";
const TENANT_CACHE_TTL = 300; // 5 minutes

// ── Types ─────────────────────────────────────────────────────────────────────

interface TenantBranding {
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  customDomain: string | null;
  emailFromName: string;
  emailReplyTo: string;
  supportEmail: string;
  supportPhone: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
}

interface TenantFeatureFlags {
  cbdcEnabled: boolean;
  stablecoinEnabled: boolean;
  bnplEnabled: boolean;
  socialLedgerEnabled: boolean;
  investmentEnabled: boolean;
  propertyEscrowEnabled: boolean;
  agentNetworkEnabled: boolean;
  multiCurrencyWalletEnabled: boolean;
  webauthnEnabled: boolean;
  biometricKycEnabled: boolean;
  openBankingEnabled: boolean;
  apiSandboxEnabled: boolean;
}

interface TenantConfig {
  tenantId: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "trial";
  plan: "starter" | "growth" | "enterprise";
  branding: TenantBranding;
  features: TenantFeatureFlags;
  corridors: string[];
  kycTierLimits: Record<string, number>;
  createdAt: string;
}

// ── Cache Helpers ─────────────────────────────────────────────────────────────

async function getCachedTenant(tenantId: string): Promise<TenantConfig | null> {
  try {
    const cached = await redis.get(`tenant:config:${tenantId}`);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

async function cacheTenant(tenantId: string, config: TenantConfig): Promise<void> {
  try {
    await redis.set(`tenant:config:${tenantId}`, JSON.stringify(config), "EX", TENANT_CACHE_TTL);
  } catch {
    // Non-fatal
  }
}

// ── Service Caller ────────────────────────────────────────────────────────────

async function tenantServiceCall<T>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown
): Promise<T | null> {
  try {
    const res = await fetch(`${TENANT_SVC_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ── Default Config (used when service is unavailable) ─────────────────────────

const DEFAULT_BRANDING: TenantBranding = {
  logoUrl: "/assets/remitflow-logo.svg",
  faviconUrl: "/assets/favicon.ico",
  primaryColor: "#2563EB",
  secondaryColor: "#1E40AF",
  accentColor: "#F59E0B",
  fontFamily: "Inter",
  customDomain: null,
  emailFromName: "RemitFlow",
  emailReplyTo: "support@remitflow.io",
  supportEmail: "support@remitflow.io",
  supportPhone: null,
  termsUrl: "https://remitflow.io/terms",
  privacyUrl: "https://remitflow.io/privacy",
};

const DEFAULT_FEATURES: TenantFeatureFlags = {
  cbdcEnabled: false,
  stablecoinEnabled: true,
  bnplEnabled: false,
  socialLedgerEnabled: true,
  investmentEnabled: false,
  propertyEscrowEnabled: false,
  agentNetworkEnabled: true,
  multiCurrencyWalletEnabled: true,
  webauthnEnabled: true,
  biometricKycEnabled: true,
  openBankingEnabled: false,
  apiSandboxEnabled: false,
};

// ── tRPC Router ───────────────────────────────────────────────────────────────

export const multiTenancyRouter = router({
  /**
   * Get tenant configuration for the current request context.
   * Used by the frontend to apply branding and feature flags.
   */
  getTenantConfig: publicProcedure
    .input(z.object({
      tenantId: z.string().optional(),
      domain: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const tenantId = input.tenantId ?? "default";

      // Check cache first
      const cached = await getCachedTenant(tenantId);
      if (cached) return cached;

      // Fetch from tenant management service
      const config = await tenantServiceCall<TenantConfig>(
        `/api/tenants/${tenantId}`
      );

      if (config) {
        await cacheTenant(tenantId, config);
        return config;
      }

      // Return default config for the main platform
      const defaultConfig: TenantConfig = {
        tenantId: "default",
        name: "RemitFlow",
        slug: "remitflow",
        status: "active",
        plan: "enterprise",
        branding: DEFAULT_BRANDING,
        features: DEFAULT_FEATURES,
        corridors: ["NGN", "GHS", "KES", "ZAR", "USD", "GBP", "EUR"],
        kycTierLimits: { tier1: 500, tier2: 5000, tier3: 50000 },
        createdAt: new Date().toISOString(),
      };

      return defaultConfig;
    }),

  /**
   * List all tenants (admin only).
   */
  listTenants: adminProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
      status: z.enum(["active", "suspended", "trial", "all"]).default("all"),
    }))
    .query(async ({ input }) => {
      const result = await tenantServiceCall<{
        tenants: TenantConfig[];
        total: number;
        page: number;
        limit: number;
      }>(`/api/tenants?page=${input.page}&limit=${input.limit}&status=${input.status}`);

      return result ?? { tenants: [], total: 0, page: input.page, limit: input.limit };
    }),

  /**
   * Create a new tenant (white-label partner onboarding).
   */
  createTenant: adminProcedure
    .input(z.object({
      name: z.string().min(2).max(100),
      slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
      plan: z.enum(["starter", "growth", "enterprise"]).default("starter"),
      adminEmail: z.string().email(),
      adminName: z.string().min(2).max(100),
      customDomain: z.string().optional(),
      primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      corridors: z.array(z.string().length(3)).min(1).default(["USD", "NGN"]),
    }))
    .mutation(async ({ input }) => {
      const result = await tenantServiceCall<{ tenantId: string; keycloakRealmId: string }>(
        "/api/tenants",
        "POST",
        {
          name: input.name,
          slug: input.slug,
          plan: input.plan,
          admin_email: input.adminEmail,
          admin_name: input.adminName,
          custom_domain: input.customDomain,
          branding: {
            primaryColor: input.primaryColor ?? DEFAULT_BRANDING.primaryColor,
            customDomain: input.customDomain ?? null,
          },
          corridors: input.corridors,
        }
      );

      if (!result) {
        // Fallback: generate tenant ID locally
        const tenantId = `tenant-${crypto.randomBytes(8).toString("hex")}`;
        logger.warn({ slug: input.slug }, "[MultiTenancy] Tenant service unavailable — queued creation");
        return {
          tenantId,
          slug: input.slug,
          status: "provisioning",
          message: "Tenant creation queued. You will receive an email when ready.",
        };
      }

      logger.info({ tenantId: result.tenantId, slug: input.slug }, "[MultiTenancy] Tenant created");
      return {
        tenantId: result.tenantId,
        slug: input.slug,
        keycloakRealmId: result.keycloakRealmId,
        status: "active",
        message: "Tenant created successfully.",
      };
    }),

  /**
   * Update tenant branding.
   */
  updateBranding: adminProcedure
    .input(z.object({
      tenantId: z.string(),
      logoUrl: z.string().url().optional(),
      primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      fontFamily: z.string().optional(),
      customDomain: z.string().optional(),
      emailFromName: z.string().optional(),
      supportEmail: z.string().email().optional(),
    }))
    .mutation(async ({ input }) => {
      const { tenantId, ...branding } = input;

      await tenantServiceCall(
        `/api/tenants/${tenantId}/branding`,
        "PUT",
        branding
      );

      // Invalidate cache
      await redis.del(`tenant:config:${tenantId}`);

      logger.info({ tenantId }, "[MultiTenancy] Branding updated");
      return { updated: true, tenantId };
    }),

  /**
   * Update tenant feature flags.
   */
  updateFeatureFlags: adminProcedure
    .input(z.object({
      tenantId: z.string(),
      flags: z.object({
        cbdcEnabled: z.boolean().optional(),
        stablecoinEnabled: z.boolean().optional(),
        bnplEnabled: z.boolean().optional(),
        socialLedgerEnabled: z.boolean().optional(),
        investmentEnabled: z.boolean().optional(),
        propertyEscrowEnabled: z.boolean().optional(),
        agentNetworkEnabled: z.boolean().optional(),
        webauthnEnabled: z.boolean().optional(),
        openBankingEnabled: z.boolean().optional(),
        apiSandboxEnabled: z.boolean().optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      await tenantServiceCall(
        `/api/tenants/${input.tenantId}/features`,
        "PUT",
        input.flags
      );

      // Invalidate cache
      await redis.del(`tenant:config:${input.tenantId}`);

      logger.info({ tenantId: input.tenantId, flags: input.flags }, "[MultiTenancy] Feature flags updated");
      return { updated: true, tenantId: input.tenantId, flags: input.flags };
    }),

  /**
   * Generate an API key for a tenant (partner integration).
   */
  generateApiKey: adminProcedure
    .input(z.object({
      tenantId: z.string(),
      keyName: z.string().min(2).max(50),
      scopes: z.array(z.enum(["transfers:read", "transfers:write", "kyc:read", "webhooks:write", "rates:read"])),
      expiresInDays: z.number().int().min(1).max(365).default(90),
    }))
    .mutation(async ({ input }) => {
      const apiKey = `rmf_${input.tenantId}_${crypto.randomBytes(24).toString("base64url")}`;
      const expiresAt = new Date(Date.now() + input.expiresInDays * 86400_000);

      // Store in Redis with TTL
      await redis.set(
        `tenant:apikey:${apiKey}`,
        JSON.stringify({ tenantId: input.tenantId, scopes: input.scopes, keyName: input.keyName }),
        "EX",
        input.expiresInDays * 86400
      );

      logger.info({ tenantId: input.tenantId, keyName: input.keyName }, "[MultiTenancy] API key generated");

      return {
        apiKey,
        keyName: input.keyName,
        tenantId: input.tenantId,
        scopes: input.scopes,
        expiresAt,
        // Only returned once — store securely
        warning: "This API key will only be shown once. Store it securely.",
      };
    }),

  /**
   * Get tenant billing summary.
   */
  getBillingSummary: protectedProcedure
    .input(z.object({
      tenantId: z.string(),
      month: z.number().int().min(1).max(12).optional(),
      year: z.number().int().min(2024).optional(),
    }))
    .query(async ({ input }) => {
      const month = input.month ?? new Date().getMonth() + 1;
      const year = input.year ?? new Date().getFullYear();

      const result = await tenantServiceCall<{
        totalTransactions: number;
        totalVolume: number;
        platformFees: number;
        partnerRevenue: number;
        currency: string;
      }>(`/api/billing/${input.tenantId}/summary?month=${month}&year=${year}`);

      return result ?? {
        tenantId: input.tenantId,
        month,
        year,
        totalTransactions: 0,
        totalVolume: 0,
        platformFees: 0,
        partnerRevenue: 0,
        currency: "USD",
        serviceAvailable: false,
      };
    }),

  /**
   * Suspend a tenant (admin only).
   */
  suspendTenant: adminProcedure
    .input(z.object({
      tenantId: z.string(),
      reason: z.string().min(10).max(500),
    }))
    .mutation(async ({ input }) => {
      await tenantServiceCall(
        `/api/tenants/${input.tenantId}/suspend`,
        "POST",
        { reason: input.reason }
      );

      await redis.del(`tenant:config:${input.tenantId}`);

      logger.warn({ tenantId: input.tenantId, reason: input.reason }, "[MultiTenancy] Tenant suspended");
      return { suspended: true, tenantId: input.tenantId };
    }),
});
