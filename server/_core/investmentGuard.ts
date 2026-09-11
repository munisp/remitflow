/**
 * Investment Eligibility Guard (G1 — DiasporaVest gap closure)
 *
 * Shared server-side guard for ALL money-moving investment mutations
 * (server/routers/investment.ts). Previously the tier2 KYC / growth plan /
 * feature-flag requirements declared in server/routers/featureFlags.ts
 * (NAV_RULES.investments) were enforced only in nav visibility — any
 * authenticated user could call the mutations directly.
 *
 * Checks, in order (fail closed on every step):
 *   1. Feature flag `investments` via isFeatureEnabled (platformHardeningV3).
 *   2. users.kycTier >= tier2 (numeric parse mirroring server/pbac.ts
 *      parseKycTier — unrecognized values fail closed to tier 0).
 *   3. Plan >= "growth". The only plan source in the schema is the TENANT
 *      plan (tenant_users -> tenants.plan); this mirrors the featureFlags
 *      nav resolution exactly: no tenant membership => "starter" => denied,
 *      admins bypass the plan check (they still need the flag + KYC tier).
 */
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { getDb } from "../db.js";
import { tenants, tenantUsers } from "../../drizzle/schema.js";
import { isFeatureEnabled } from "./platformHardeningV3.js";
import { logger } from "./logger.js";
import type { TrpcContext } from "./context";

// Mirrors featureFlags.ts NAV_RULES.investments: { requiredKycTier: "tier2", requiredPlan: "growth" }
const REQUIRED_KYC_TIER = 2;
const PLAN_RANK: Record<string, number> = { starter: 0, growth: 1, enterprise: 2, white_label: 3 };
const REQUIRED_PLAN_RANK = PLAN_RANK["growth"];

/**
 * Mirror of pbac.ts parseKycTier (not exported there). users.kycTier is the
 * string enum "tier0".."tier3"; anything unrecognized fails closed to 0.
 */
function parseKycTier(kycTier: unknown): number {
  if (typeof kycTier === "number" && Number.isFinite(kycTier)) return Math.max(0, Math.floor(kycTier));
  const n = Number(String(kycTier ?? "").replace(/^tier/i, ""));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

type AuthenticatedCtx = { user: NonNullable<TrpcContext["user"]> };

export async function assertInvestmentEligible(ctx: AuthenticatedCtx): Promise<void> {
  const userId = ctx.user.id;

  // 1. Feature flag — fail closed when the flag is off or the check errors.
  //    NOTE: isFeatureEnabled defaults to ENABLED when Unleash is not
  //    configured (platform-wide default-open policy); we fail closed only
  //    on an explicit `false` or a thrown error. Tightening the default is a
  //    platformHardeningV3 change, out of scope here.
  let flagEnabled = false;
  try {
    flagEnabled = (await isFeatureEnabled("investments", { userId: String(userId) })) === true;
  } catch (err) {
    logger.warn({ userId, err: err instanceof Error ? err.message : String(err) }, "[InvestGuard] feature flag check failed — failing closed");
    flagEnabled = false;
  }
  if (!flagEnabled) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Investments are currently unavailable for this account" });
  }

  // 2. KYC tier >= tier2
  const tier = parseKycTier((ctx.user as Record<string, unknown>).kycTier);
  if (tier < REQUIRED_KYC_TIER) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Complete Tier 2 KYC verification to access investments",
    });
  }

  // 3. Plan >= growth (tenant plan; admins bypass, mirroring featureFlags.ts)
  if (ctx.user.role === "admin") return;

  const db = await getDb();
  if (!db) {
    // Fail closed: plan cannot be verified without the DB.
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Plan verification unavailable — investment blocked" });
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
    logger.warn({ userId, err: err instanceof Error ? err.message : String(err) }, "[InvestGuard] plan lookup failed — failing closed");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Plan verification unavailable — investment blocked" });
  }
  if ((PLAN_RANK[tenantPlan] ?? 0) < REQUIRED_PLAN_RANK) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Investments require the Growth plan or higher — upgrade your plan to continue",
    });
  }
}
