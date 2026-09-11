/**
 * totpStepUp.ts — Canonical TOTP step-up gate for money-moving mutations
 * (SPEC-wave7 Contract 2).
 *
 * This is a thin, fail-closed wrapper over the REAL verifier in
 * server/totp.ts (getTotpEnrollment + verifyTOTP; secrets encrypted at rest
 * via secretBox). It does NOT implement a second TOTP mechanism — it only
 * standardises the enforcement posture that cardFunding.execute /
 * investment.ts apply inline:
 *
 *   - enrollment store unavailable   → deny (INTERNAL_SERVER_ERROR)
 *   - user not enrolled              → deny (PRECONDITION_FAILED, honest
 *                                      "enroll first" error — never waived)
 *   - enrolled, no/invalid code      → deny (PRECONDITION_FAILED / UNAUTHORIZED)
 *
 * Also provides requireKycTierForAmount, the transferEngine-equivalent KYC
 * tier check (server/lib/transferEngine.ts:476-504) for direct-wallet
 * mutations that bypass the transfer pipeline. NOTE: the unused
 * requireKYCTier in server/middleware/kycGate.ts is NOT functional — it
 * calls db.query.users.findFirst through the db-shim Proxy, which returns a
 * function for `db.query`, so `.users.findFirst` throws a synchronous
 * TypeError. Do not use it; use this helper instead.
 */
import { TRPCError } from "@trpc/server";

/**
 * Require a valid TOTP step-up for a money-moving action.
 * @param userId      authenticated user id (ctx.user.id)
 * @param totpCode    optional 6-digit code from the request input
 * @param actionLabel human label for error messages (e.g. "escrow creation")
 */
export async function requireTotpStepUp(
  userId: number,
  totpCode: string | undefined,
  actionLabel: string,
): Promise<void> {
  const { getTotpEnrollment, verifyTOTP } = await import("../totp");
  const enrollment = await getTotpEnrollment(userId);
  if (!enrollment.dbAvailable) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `2FA verification unavailable — ${actionLabel} blocked (fail-closed)`,
    });
  }
  if (!enrollment.enabled || !enrollment.secret) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Two-factor authentication enrollment required before ${actionLabel}`,
    });
  }
  if (!totpCode) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "2FA code required for this action",
    });
  }
  const valid = await verifyTOTP(totpCode, enrollment.secret);
  if (!valid) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid 2FA code" });
  }
}

/**
 * transferEngine-equivalent KYC tier gate for direct-wallet mutations that
 * bypass executeTransferPipeline. Mirrors server/lib/transferEngine.ts:476-504:
 * look up users.kycTier (fail closed on lookup error / DB down), then run the
 * canonical checkKycLimits (single-txn + cumulative daily limits).
 */
export async function requireKycTierForAmount(
  userId: number,
  amount: number,
  actionLabel: string,
): Promise<void> {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `KYC verification unavailable — ${actionLabel} blocked (fail-closed)`,
    });
  }
  const { sql } = await import("drizzle-orm");
  let userTier = "tier0"; // default to most restrictive tier
  try {
    const tierResult = await db.execute(sql`
      SELECT "kycTier" FROM users WHERE id = ${userId}
    `);
    const tierRows = tierResult as unknown as { kycTier: string }[];
    if (tierRows.length > 0 && tierRows[0].kycTier) userTier = tierRows[0].kycTier;
  } catch {
    // FF-026: a lookup error must not silently grant the highest tier.
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `KYC tier lookup failed — ${actionLabel} blocked (fail-closed)`,
    });
  }
  const { checkKycLimits } = await import("../lib/transferEngine");
  const kycCheck = await checkKycLimits(userId, amount, userTier);
  if (!kycCheck.allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: kycCheck.reason ?? `KYC limits exceeded for ${actionLabel}`,
    });
  }
}
