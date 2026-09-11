/**
 * Feature Eligibility Guard (Wave 7 — Pattern A systemic fix)
 *
 * Generalized server-side gate for money-moving mutations, generalizing
 * investmentGuard.ts (DiasporaVest G1) to ANY feature whose NAV_RULES /
 * PLATFORM_FLAGS entry declares requiredKycTier / requiredPlan. Before Wave
 * 7 those declarations were enforced only in nav visibility — every router
 * except investment.ts ignored them.
 *
 * Checks, in order (fail closed on every step):
 *   1. Feature flag via isFeatureEnabled (if `flag` given).
 *   2. users.kycTier >= minKycTier (numeric parse; unknown => 0).
 *   3. Tenant plan >= minPlan (tenant_users -> tenants.plan; admins bypass
 *      the plan check only; no membership => "starter"; DB error => throw).
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { getDb } from "../db.js";
import { tenants, tenantUsers } from "../../drizzle/schema.js";
import { isFeatureEnabled } from "./platformHardeningV3.js";
import { logger } from "./logger.js";
import type { TrpcContext } from "./context";

const PLAN_RANK: Record<string, number> = { starter: 0, growth: 1, enterprise: 2, white_label: 3 };

/** Mirror of pbac.ts parseKycTier: "tier0".."tier3" => 0..3; unknown fails closed to 0. */
function parseKycTier(kycTier: unknown): number {
  if (typeof kycTier === "number" && Number.isFinite(kycTier)) return Math.max(0, Math.floor(kycTier));
  const n = Number(String(kycTier ?? "").replace(/^tier/i, ""));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

type AuthenticatedCtx = { user: NonNullable<TrpcContext["user"]> };

export interface FeatureRequirement {
  /** Feature flag key checked via isFeatureEnabled; omitted => skip flag check. */
  flag?: string;
  /** Minimum numeric KYC tier (0..3); omitted => skip. */
  minKycTier?: number;
  /** Minimum tenant plan; omitted => skip. Admins bypass the plan check only. */
  minPlan?: "starter" | "growth" | "enterprise" | "white_label";
  /** Human-readable feature name for error messages. */
  featureName: string;
}

export async function assertFeatureEligible(ctx: AuthenticatedCtx, req: FeatureRequirement): Promise<void> {
  const userId = ctx.user.id;
  const name = req.featureName || "This feature";

  // 1. Feature flag — fail closed on explicit false or a thrown error.
  if (req.flag) {
    let flagEnabled = false;
    try {
      flagEnabled = (await isFeatureEnabled(req.flag, { userId: String(userId) })) === true;
    } catch (err) {
      logger.warn({ userId, flag: req.flag, err: err instanceof Error ? err.message : String(err) }, "[FeatureGuard] flag check failed — failing closed");
      flagEnabled = false;
    }
    if (!flagEnabled) {
      throw new TRPCError({ code: "FORBIDDEN", message: `${name} is currently unavailable for this account` });
    }
  }

  // 2. KYC tier
  if (req.minKycTier !== undefined && req.minKycTier > 0) {
    const tier = parseKycTier((ctx.user as Record<string, unknown>).kycTier);
    if (tier < req.minKycTier) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Complete Tier ${req.minKycTier} KYC verification to access ${name}`,
      });
    }
  }

  // 3. Plan (tenant plan; admins bypass, mirroring featureFlags.ts nav resolution)
  if (req.minPlan) {
    if (ctx.user.role === "admin") return;
    const requiredRank = PLAN_RANK[req.minPlan] ?? 0;
    const db = await getDb();
    if (!db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Plan verification unavailable — ${name} blocked` });
    }
    let tenantPlan = "starter";
    try {
      const membership = await db
        .select({ tenantId: tenantUsers.tenantId })
        .from(tenantUsers)
        .where(eq(tenantUsers.userId, userId))
        .limit(1);
      if (membership.length > 0) {
        const [t] = await db
          .select({ plan: tenants.plan })
          .from(tenants)
          .where(eq(tenants.id, membership[0].tenantId))
          .limit(1);
        if (t?.plan) tenantPlan = t.plan;
      }
    } catch (err) {
      logger.warn({ userId, err: err instanceof Error ? err.message : String(err) }, "[FeatureGuard] plan lookup failed — failing closed");
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Plan verification unavailable — ${name} blocked` });
    }
    if ((PLAN_RANK[tenantPlan] ?? 0) < requiredRank) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `${name} requires the ${req.minPlan} plan or higher — upgrade your plan to continue`,
      });
    }
  }
}
