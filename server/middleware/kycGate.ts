/**
 * kycGate.ts — RemitFlow KYC/KYB Gate Middleware
 *
 * This middleware enforces KYC tier requirements on all sensitive operations.
 * It intercepts tRPC procedures and fires KYC/KYB triggers via the Go trigger engine.
 *
 * Trigger events handled:
 *  1. user_registration       — fires on first user creation
 *  2. first_transfer_attempt  — fires when KYC tier 0 user tries to transfer
 *  3. transaction_over_1000   — fires Travel Rule + CTR check
 *  4. transaction_over_10000  — fires mandatory CTR + EDD
 *  5. pep_match_detected      — fires EDD workflow
 *  6. sanctions_hit           — fires immediate freeze
 *  7. high_risk_score         — fires KYC re-review
 *  8. periodic_rekyc_due      — fires annual/risk-based re-KYC
 *  9. country_risk_change     — fires re-verification for affected users
 * 10. sar_filed               — fires freeze + manual review
 * 11. business_registration   — fires KYB initiation
 * 12. director_change         — fires KYB re-verification
 * 13. merchant_onboarding     — fires merchant KYB
 * 14. license_expiry          — fires KYB renewal
 * 15. beneficial_owner_change — fires UBO re-verification
 */

import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { users, kycLifecycle } from "../../drizzle/schema";
import { desc, eq } from "drizzle-orm";

// ── KYC Tier Definitions ─────────────────────────────────────────────────────

export const KYC_TIERS = {
  TIER_0: 0, // Unverified — email only
  TIER_1: 1, // Basic — phone + ID document
  TIER_2: 2, // Standard — full KYC (selfie + address)
  TIER_3: 3, // Enhanced — EDD (source of funds)
  TIER_4: 4, // Institutional — full KYB + compliance review
} as const;

export type KYCTier = (typeof KYC_TIERS)[keyof typeof KYC_TIERS];

export const KYC_TIER_LIMITS = {
  [KYC_TIERS.TIER_0]: { dailyLimit: 0, monthlyLimit: 0, singleTxLimit: 0 },
  [KYC_TIERS.TIER_1]: { dailyLimit: 500, monthlyLimit: 2000, singleTxLimit: 500 },
  [KYC_TIERS.TIER_2]: { dailyLimit: 5000, monthlyLimit: 20000, singleTxLimit: 5000 },
  [KYC_TIERS.TIER_3]: { dailyLimit: 50000, monthlyLimit: 200000, singleTxLimit: 50000 },
  [KYC_TIERS.TIER_4]: { dailyLimit: Infinity, monthlyLimit: Infinity, singleTxLimit: Infinity },
};

// ── Trigger Engine Client ─────────────────────────────────────────────────────

const TRIGGER_ENGINE_URL = process.env.KYC_TRIGGER_ENGINE_URL ?? "http://go-kyc-trigger-engine:8160";
const KYC_SCORER_URL = process.env.KYC_SCORER_URL ?? "http://python-kyc-trigger-scorer:8162";

interface KYCTriggerPayload {
  trigger_type: string;
  entity_type: "user" | "business";
  entity_id: string;
  user_id: string;
  business_id?: string;
  amount?: number;
  currency?: string;
  risk_score?: number;
  country?: string;
  metadata?: Record<string, unknown>;
  correlation_id: string;
  timestamp: string;
}

export async function fireTrigger(payload: KYCTriggerPayload): Promise<void> {
  try {
    const response = await fetch(`${TRIGGER_ENGINE_URL}/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.error(`[KYC Gate] Trigger engine error: ${response.status} for ${payload.trigger_type}`);
    }
  } catch (err) {
    // Non-blocking — log but don't fail the request
    console.error(`[KYC Gate] Failed to fire trigger ${payload.trigger_type}:`, err);
  }
}

// ── KYC Status Checker ────────────────────────────────────────────────────────

export interface KYCStatus {
  userId: string;
  kycTier: KYCTier;
  kycStatus: "pending" | "in_review" | "verified" | "rejected" | "frozen" | "expired";
  frozen: boolean;
  freezeReason?: string;
  requiresReKYC: boolean;
  kycExpiresAt?: Date;
}

/**
 * W13 fix (F-T6): `users` has NO kycStatus column — the previous version read
 * it (always undefined via the broken db-shim `db.query` proxy) and compared
 * the kycTier STRING enum ('tier0'..'tier3') against NUMERIC tiers, so every
 * gate evaluation was garbage. `users.kycTier` is the pgEnum source of truth
 * for the tier; lifecycle state (rejected/suspended/expired) comes from the
 * latest kyc_lifecycle row.
 */
const TIER_NAME_TO_LEVEL: Record<string, KYCTier> = {
  tier0: KYC_TIERS.TIER_0,
  tier1: KYC_TIERS.TIER_1,
  tier2: KYC_TIERS.TIER_2,
  tier3: KYC_TIERS.TIER_3,
  // Forward-compatible: enum tops out at tier3 today.
  tier4: KYC_TIERS.TIER_4,
};

export function kycTierNameToLevel(name: string | null | undefined): KYCTier {
  return TIER_NAME_TO_LEVEL[name ?? ""] ?? KYC_TIERS.TIER_0;
}

/**
 * Returns null only when the user does not exist.
 * Throws INTERNAL_SERVER_ERROR when the database is unavailable — fail closed.
 */
export async function getUserKYCStatus(userId: string | number): Promise<KYCStatus | null> {
  const numericUserId = Number(userId);
  if (!Number.isSafeInteger(numericUserId) || numericUserId <= 0) return null;

  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "KYC status unavailable — database unreachable. Action blocked.",
    });
  }

  const [user] = await db
    .select({ id: users.id, kycTier: users.kycTier })
    .from(users)
    .where(eq(users.id, numericUserId))
    .limit(1);

  if (!user) return null;

  // Latest lifecycle row supplies review state (rejected/suspended/expired).
  const [lifecycle] = await db
    .select({ stage: kycLifecycle.stage, rejectionReason: kycLifecycle.rejectionReason, expiresAt: kycLifecycle.expiresAt })
    .from(kycLifecycle)
    .where(eq(kycLifecycle.userId, numericUserId))
    .orderBy(desc(kycLifecycle.updatedAt))
    .limit(1);

  const stage = lifecycle?.stage;
  const kycStatus: KYCStatus["kycStatus"] =
    stage === "rejected" ? "rejected"
    : stage === "suspended" ? "frozen"
    : stage === "expired" ? "expired"
    : stage === "under_review" || stage === "documents_submitted" || stage === "additional_info_required" ? "in_review"
    : stage === "approved" ? "verified"
    : "pending";

  return {
    userId: String(userId),
    kycTier: kycTierNameToLevel(user.kycTier),
    kycStatus,
    frozen: kycStatus === "frozen",
    freezeReason: kycStatus === "frozen" ? (lifecycle?.rejectionReason ?? "compliance review") : undefined,
    requiresReKYC: kycStatus === "expired",
    kycExpiresAt: lifecycle?.expiresAt ?? undefined,
  };
}

// ── KYC Gate Middleware ───────────────────────────────────────────────────────

/**
 * Enforces minimum KYC tier on a tRPC procedure.
 * Usage: in a tRPC router, `await requireKYCTier(KYC_TIERS.TIER_1)(ctx.user.id)`
 * at the top of the mutation. Fails closed: throws when the user is missing,
 * frozen, rejected, below the required tier, or when the DB is unreachable.
 */
export function requireKYCTier(minimumTier: KYCTier) {
  return async (userId: string | number): Promise<void> => {
    const kycStatus = await getUserKYCStatus(userId);

    if (!kycStatus) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not found",
      });
    }

    if (kycStatus.frozen) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Account frozen: ${kycStatus.freezeReason ?? "compliance review"}. Contact support.`,
      });
    }

    if (kycStatus.kycStatus === "rejected") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "KYC verification was rejected. Please re-submit your documents.",
      });
    }

    if (kycStatus.kycTier < minimumTier) {
      // Fire first_transfer_attempt trigger if this is a Tier-0 user trying to transact
      if (kycStatus.kycTier === KYC_TIERS.TIER_0) {
        const uid = String(userId);
        void fireTrigger({
          trigger_type: "first_transfer_attempt",
          entity_type: "user",
          entity_id: uid,
          user_id: uid,
          correlation_id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          metadata: { required_tier: minimumTier, current_tier: kycStatus.kycTier },
        });
      }

      throw new TRPCError({
        code: "FORBIDDEN",
        message: `This action requires KYC Tier ${minimumTier}. Your current tier is ${kycStatus.kycTier}. Please complete identity verification.`,
      });
    }
  };
}

/**
 * Transaction amount gate — checks KYC tier limits and fires compliance triggers.
 */
export async function checkTransactionLimits(
  userId: string | number,
  amount: number,
  currency: string,
  correlationId?: string,
): Promise<void> {
  const corrId = correlationId ?? crypto.randomUUID();
  const uid = String(userId);
  const kycStatus = await getUserKYCStatus(userId);

  if (!kycStatus) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "User not found" });
  }

  if (kycStatus.frozen) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Account frozen: ${kycStatus.freezeReason ?? "compliance review"}`,
    });
  }

  const limits = KYC_TIER_LIMITS[kycStatus.kycTier];

  if (amount > limits.singleTxLimit) {
    // Fire trigger to escalate KYC tier
    void fireTrigger({
      trigger_type: kycStatus.kycTier === KYC_TIERS.TIER_0 ? "first_transfer_attempt" : "kyc_tier_upgrade_required",
      entity_type: "user",
      entity_id: uid,
      user_id: uid,
      amount,
      currency,
      correlation_id: corrId,
      timestamp: new Date().toISOString(),
      metadata: { current_tier: kycStatus.kycTier, limit: limits.singleTxLimit },
    });

    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Transaction amount $${amount} exceeds your KYC Tier ${kycStatus.kycTier} limit of $${limits.singleTxLimit}. Please upgrade your verification.`,
    });
  }

  // Fire compliance triggers based on amount thresholds (non-blocking)
  if (amount >= 10000) {
    void fireTrigger({
      trigger_type: "transaction_over_10000",
      entity_type: "user",
      entity_id: uid,
      user_id: uid,
      amount,
      currency,
      correlation_id: corrId,
      timestamp: new Date().toISOString(),
    });
  } else if (amount >= 1000) {
    void fireTrigger({
      trigger_type: "transaction_over_1000",
      entity_type: "user",
      entity_id: uid,
      user_id: uid,
      amount,
      currency,
      correlation_id: corrId,
      timestamp: new Date().toISOString(),
    });
  }
}

// ── Business Registration Trigger ─────────────────────────────────────────────

/**
 * Call this when a new business/merchant is registered.
 * Fires the business_registration KYB trigger.
 */
export async function onBusinessRegistered(
  businessId: string,
  userId: string,
  businessType: string,
  country?: string,
): Promise<void> {
  void fireTrigger({
    trigger_type: "business_registration",
    entity_type: "business",
    entity_id: businessId,
    user_id: userId,
    country,
    correlation_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    metadata: { business_type: businessType },
  });
}

// ── Director Change Trigger ───────────────────────────────────────────────────

export async function onDirectorChanged(
  businessId: string,
  userId: string,
  changeType: "added" | "removed" | "updated",
  directorName: string,
): Promise<void> {
  void fireTrigger({
    trigger_type: "director_change",
    entity_type: "business",
    entity_id: businessId,
    user_id: userId,
    correlation_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    metadata: { change_type: changeType, director_name: directorName },
  });
}

// ── Beneficial Ownership Change Trigger ───────────────────────────────────────

export async function onBeneficialOwnerChanged(
  businessId: string,
  userId: string,
  ownerName: string,
  ownershipPercentage: number,
): Promise<void> {
  if (ownershipPercentage >= 25) {
    void fireTrigger({
      trigger_type: "beneficial_owner_change",
      entity_type: "business",
      entity_id: businessId,
      user_id: userId,
      correlation_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      metadata: { owner_name: ownerName, ownership_percentage: ownershipPercentage },
    });
  }
}

// ── License Expiry Trigger ────────────────────────────────────────────────────

export async function onLicenseExpiring(
  businessId: string,
  userId: string,
  licenseType: string,
  expiryDate: Date,
): Promise<void> {
  void fireTrigger({
    trigger_type: "license_expiry",
    entity_type: "business",
    entity_id: businessId,
    user_id: userId,
    correlation_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    metadata: { license_type: licenseType, expiry_date: expiryDate.toISOString() },
  });
}

// ── SAR Filing Trigger ────────────────────────────────────────────────────────

export async function onSARFiled(userId: string, sarReference: string, reason: string): Promise<void> {
  void fireTrigger({
    trigger_type: "sar_filed",
    entity_type: "user",
    entity_id: userId,
    user_id: userId,
    correlation_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    metadata: { sar_reference: sarReference, reason },
  });
}

// ── Country Risk Change Trigger ───────────────────────────────────────────────

export async function onCountryRiskChanged(
  countryCode: string,
  previousRiskLevel: string,
  newRiskLevel: string,
): Promise<void> {
  // In production: query all users with this country and fire re-KYC triggers
  void fireTrigger({
    trigger_type: "country_risk_change",
    entity_type: "user",
    entity_id: `country:${countryCode}`,
    user_id: "system",
    country: countryCode,
    correlation_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    metadata: { previous_risk_level: previousRiskLevel, new_risk_level: newRiskLevel },
  });
}

// ── Express Middleware Compatibility Shim ─────────────────────────────────────
// Provides the kycGateMiddleware Express middleware function used by index.ts
import type { Request, Response, NextFunction } from "express";

/**
 * Express middleware that attaches KYC tier information to the request context.
 * Non-blocking — passes through even if KYC status cannot be determined.
 */
export function kycGateMiddleware(req: Request, _res: Response, next: NextFunction): void {
  // KYC enforcement is handled at the tRPC procedure level via requireKYCTier()
  // This middleware is a no-op pass-through for Express compatibility.
  next();
}
