/**
 * W13-C2 / SPEC-wave13 §4 — Merchant Onboarding router (canonical).
 *
 * Consolidates merchant KYB onboarding onto the real wave-13 schema
 * (merchants / merchant_directors / merchant_kyb_reviews / kyb_records):
 *
 *  - apply        — protected; sanctions-screens business + director names via
 *                   `screenSanctions` (server/_core/polyglotClient — the SAME
 *                   fail-closed client embeddedPayouts / BDC use; throws on
 *                   outage). Writes kybRecords + merchants + merchantKybReviews
 *                   + merchantDirectors in ONE db.transaction. Idempotent via
 *                   merchants_user_uniq / merchant_kyb_reviews_user_uniq
 *                   (23505 → replay returns current state).
 *                   Screening verdicts are recorded per director
 *                   ('clear'|'match'|'review'|'error'); a provider error
 *                   records 'error' and keeps the application pending — NEVER
 *                   auto-approves. A sanctions match puts the application on
 *                   the honest rejected path.
 *  - myStatus     — protected; caller's merchant + KYB review state.
 *  - adminList    — admin; review queue with merchant state.
 *  - adminReview  — admin + requireTotpStepUp; guarded
 *                   merchant_kyb_reviews pending→approved|rejected
 *                   (UPDATE ... WHERE status='pending' RETURNING, affected==1
 *                   else CONFLICT); same transaction updates kyb_records and
 *                   merchants (guarded pending_kyb→active|rejected). Wires the
 *                   previously-orphaned emitKybReviewed (tier-events.ts:76).
 *
 * Replaces the fabricated v100 applyAsMerchant/approveMerchant path (F-T8) and
 * provides the KYB flow that merchantGateway.register now requires.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { requireDb, createAuditLog } from "../db";
import {
  kybRecords,
  merchantDirectors,
  merchantKybReviews,
  merchants,
} from "../../drizzle/schema";
import { screenSanctions } from "../_core/polyglotClient";
import { requireTotpStepUp } from "../_core/totpStepUp";
import { emitKybReviewed, emitKybSubmitted } from "../middleware/tier-events";
import { logger } from "../_core/logger";

// ─── Screening ────────────────────────────────────────────────────────────────

type ScreeningVerdict = "clear" | "match" | "review" | "error";

interface ScreeningOutcome {
  verdict: ScreeningVerdict;
  detail?: string;
}

/**
 * Screen one name via the live sanctions provider. FAIL CLOSED on provider
 * error: verdict 'error' is recorded and the application stays pending —
 * an outage is never read as a pass.
 */
async function screenName(name: string, entityType: "individual" | "organization"): Promise<ScreeningOutcome> {
  try {
    const res = await screenSanctions({ name, entityType });
    if (res.isSanctioned || res.action === "block") {
      return { verdict: "match", detail: res.matchType ?? res.riskLevel };
    }
    if (res.action === "review") {
      return { verdict: "review", detail: res.riskLevel };
    }
    return { verdict: "clear" };
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), name, entityType },
      "[MerchantOnboarding] sanctions screening provider error — recording 'error' verdict (fail-closed)",
    );
    return { verdict: "error" };
  }
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "23505" || /duplicate key/i.test(e?.message ?? "");
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const merchantOnboardingRouter = router({
  apply: protectedProcedure
    .input(z.object({
      businessName: z.string().min(2).max(200),
      country: z.string().trim().min(2).max(2).transform((s) => s.toUpperCase()),
      registrationNumber: z.string().min(2).max(100),
      businessType: z.string().min(2).max(100),
      expectedMonthlyVolume: z.number().positive().max(1_000_000_000),
      website: z.string().url().max(300).optional(),
      directors: z.array(z.object({
        fullName: z.string().min(2).max(200),
        isUbo: z.boolean().default(false),
        ownershipPct: z.number().min(0).max(100).optional(),
        idDocUrl: z.string().url().max(2000).optional(),
      })).min(1).max(10),
      termsVersion: z.string().min(1).max(20),
      termsAccepted: z.literal(true),
      // TOTP is NOT required on apply (per SPEC §4.1) — only on admin review.
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();

      // Idempotency (merchants_user_uniq): a repeat apply returns current state.
      const [existing] = await db
        .select()
        .from(merchants)
        .where(eq(merchants.userId, ctx.user.id))
        .limit(1);
      if (existing) {
        return {
          alreadyApplied: true as const,
          merchantId: existing.id,
          status: existing.status,
          screening: null,
        };
      }

      // Sanctions-screen business name + every director BEFORE persisting the
      // decision. Provider errors → verdict 'error' (recorded), application
      // stays pending_kyb; matches → honest rejected path.
      const businessScreening = await screenName(input.businessName, "organization");
      const directorScreenings: ScreeningOutcome[] = [];
      for (const d of input.directors) {
        directorScreenings.push(await screenName(d.fullName, "individual"));
      }
      const matched =
        businessScreening.verdict === "match" ||
        directorScreenings.some((s) => s.verdict === "match");
      const screeningError =
        businessScreening.verdict === "error" ||
        directorScreenings.some((s) => s.verdict === "error");

      const finalStatus = matched ? ("rejected" as const) : ("pending_kyb" as const);
      const reviewStatus = matched ? ("rejected" as const) : ("pending" as const);
      const rejectionReason = matched
        ? "Sanctions screening match on business or director name"
        : null;

      let txResult: {
        merchantId: number;
        reviewId: number;
        kybRecordId: number;
      };
      try {
        txResult = await db.transaction(async (tx) => {
          const [kyb] = await tx.insert(kybRecords).values({
            userId: ctx.user.id,
            businessName: input.businessName,
            registrationNumber: input.registrationNumber,
            country: input.country,
            industry: input.businessType,
            website: input.website ?? null,
            status: matched ? "rejected" : "pending",
            riskRating: "medium",
            rejectionReason,
          }).returning({ id: kybRecords.id });

          const [merchant] = await tx.insert(merchants).values({
            userId: ctx.user.id,
            kybRecordId: kyb.id,
            businessName: input.businessName,
            country: input.country,
            status: finalStatus,
            termsAcceptedAt: new Date(),
            termsVersion: input.termsVersion,
          }).returning({ id: merchants.id });

          const [review] = await tx.insert(merchantKybReviews).values({
            userId: ctx.user.id,
            businessName: input.businessName,
            registrationNumber: input.registrationNumber,
            country: input.country,
            industry: input.businessType,
            website: input.website ?? null,
            expectedMonthlyVol: input.expectedMonthlyVolume.toFixed(2),
            directorIdDocUrl: input.directors.find((d) => d.idDocUrl)?.idDocUrl ?? null,
            status: reviewStatus,
            rejectionReason,
          }).returning({ id: merchantKybReviews.id });

          await tx.insert(merchantDirectors).values(
            input.directors.map((d, i) => ({
              merchantId: merchant.id,
              fullName: d.fullName,
              idDocUrl: d.idDocUrl ?? null,
              isUbo: d.isUbo,
              ownershipPct: d.ownershipPct != null ? d.ownershipPct.toFixed(2) : null,
              screeningVerdict: directorScreenings[i].verdict,
            })),
          );

          return { merchantId: merchant.id, reviewId: review.id, kybRecordId: kyb.id };
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          // Concurrent apply raced the unique index — replay honestly.
          const [current] = await db
            .select()
            .from(merchants)
            .where(eq(merchants.userId, ctx.user.id))
            .limit(1);
          if (current) {
            return {
              alreadyApplied: true as const,
              merchantId: current.id,
              status: current.status,
              screening: null,
            };
          }
        }
        throw err;
      }

      if (!matched) {
        emitKybSubmitted(ctx.user.id, txResult.reviewId, input.businessName);
      }

      await createAuditLog({
        userId: ctx.user.id,
        action: matched ? "MERCHANT_KYB_APPLY_REJECTED_SCREENING" : "MERCHANT_KYB_APPLY_SUBMITTED",
        targetType: "merchants",
        targetId: txResult.merchantId,
        severity: matched || screeningError ? "warning" : "info",
        description: matched
          ? "Merchant application rejected: sanctions screening match"
          : screeningError
            ? "Merchant application submitted; screening provider error — pending manual review"
            : "Merchant application submitted for KYB review",
        metadata: {
          merchantId: txResult.merchantId,
          reviewId: txResult.reviewId,
          businessScreening: businessScreening.verdict,
          directorVerdicts: directorScreenings.map((s) => s.verdict),
        },
      });

      return {
        alreadyApplied: false as const,
        merchantId: txResult.merchantId,
        reviewId: txResult.reviewId,
        status: finalStatus,
        screening: {
          business: businessScreening.verdict,
          directors: directorScreenings.map((s) => s.verdict),
          providerError: screeningError,
        },
        // Honest copy — no "verified" claims; screening 'review'/'error' stays pending.
        message: matched
          ? "Application rejected: sanctions screening match."
          : screeningError
            ? "Application received. Screening provider is temporarily unavailable — your application is pending manual review."
            : "Application received and pending KYB review.",
      };
    }),

  myStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const [merchant] = await db
      .select()
      .from(merchants)
      .where(eq(merchants.userId, ctx.user.id))
      .limit(1);
    if (!merchant) return { applied: false as const };

    const [review] = await db
      .select()
      .from(merchantKybReviews)
      .where(eq(merchantKybReviews.userId, ctx.user.id))
      .orderBy(desc(merchantKybReviews.createdAt))
      .limit(1);
    const directors = await db
      .select({
        id: merchantDirectors.id,
        fullName: merchantDirectors.fullName,
        isUbo: merchantDirectors.isUbo,
        screeningVerdict: merchantDirectors.screeningVerdict,
      })
      .from(merchantDirectors)
      .where(eq(merchantDirectors.merchantId, merchant.id));

    return {
      applied: true as const,
      merchant: {
        id: merchant.id,
        businessName: merchant.businessName,
        country: merchant.country,
        status: merchant.status,
        riskRating: merchant.riskRating,
        termsVersion: merchant.termsVersion,
        createdAt: merchant.createdAt,
      },
      review: review
        ? {
            id: review.id,
            status: review.status,
            rejectionReason: review.rejectionReason,
            reviewedAt: review.reviewedAt,
          }
        : null,
      directors,
    };
  }),

  adminList: adminProcedure
    .input(z.object({
      status: z.enum(["pending", "documents_requested", "under_review", "approved", "rejected", "suspended"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db
        .select({
          review: merchantKybReviews,
          merchantId: merchants.id,
          merchantStatus: merchants.status,
        })
        .from(merchantKybReviews)
        .leftJoin(merchants, eq(merchants.userId, merchantKybReviews.userId))
        .where(input?.status ? eq(merchantKybReviews.status, input.status) : undefined)
        .orderBy(desc(merchantKybReviews.createdAt))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);
      return rows.map((r) => ({
        ...r.review,
        merchantId: r.merchantId,
        merchantStatus: r.merchantStatus,
      }));
    }),

  adminReview: adminProcedure
    .input(z.object({
      reviewId: z.number().int().positive(),
      decision: z.enum(["approved", "rejected"]),
      riskRating: z.enum(["low", "medium", "high"]).default("medium"),
      rejectionReason: z.string().min(5).max(2000).optional(),
      notes: z.string().max(2000).optional(),
      totpCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.decision === "rejected" && !input.rejectionReason) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "rejectionReason is required when rejecting" });
      }
      await requireTotpStepUp(ctx.user.id, input.totpCode, "merchant KYB review");
      const db = await requireDb();

      const decided = await db.transaction(async (tx) => {
        // Guarded single-winner transition: pending → approved|rejected.
        const [review] = await tx
          .update(merchantKybReviews)
          .set({
            status: input.decision,
            reviewedBy: ctx.user.id,
            reviewedAt: new Date(),
            rejectionReason: input.decision === "rejected" ? input.rejectionReason! : null,
            riskRating: input.riskRating,
            notes: input.notes ?? null,
            updatedAt: new Date(),
          })
          .where(and(
            eq(merchantKybReviews.id, input.reviewId),
            eq(merchantKybReviews.status, "pending"),
          ))
          .returning();
        if (!review) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `KYB review ${input.reviewId} is not pending (already decided or unknown)`,
          });
        }

        // Same transaction: guarded merchant + kyb_records transitions.
        const nextMerchantStatus = input.decision === "approved" ? "active" : "rejected";
        const [merchant] = await tx
          .update(merchants)
          .set({
            status: nextMerchantStatus,
            riskRating: input.riskRating,
            updatedAt: new Date(),
          })
          .where(and(eq(merchants.userId, review.userId), eq(merchants.status, "pending_kyb")))
          .returning({ id: merchants.id });
        if (!merchant) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Merchant record is not pending_kyb — inconsistent state, review rolled back",
          });
        }

        await tx
          .update(kybRecords)
          .set({
            status: input.decision,
            riskRating: input.riskRating,
            reviewedBy: String(ctx.user.id),
            reviewedAt: new Date(),
            rejectionReason: input.decision === "rejected" ? input.rejectionReason! : null,
            updatedAt: new Date(),
          })
          .where(eq(kybRecords.userId, review.userId));

        return { review, merchantId: merchant.id };
      });

      // Wire the previously-orphaned KYB-reviewed event (tier-events.ts:76).
      emitKybReviewed(decided.review.id, input.decision, ctx.user.id);

      await createAuditLog({
        userId: ctx.user.id,
        action: input.decision === "approved" ? "MERCHANT_KYB_APPROVED" : "MERCHANT_KYB_REJECTED",
        targetType: "merchant_kyb_reviews",
        targetId: decided.review.id,
        severity: input.decision === "rejected" ? "warning" : "info",
        description: `Merchant KYB ${input.decision} for user ${decided.review.userId} (merchant ${decided.merchantId})`,
        metadata: {
          reviewId: decided.review.id,
          merchantId: decided.merchantId,
          decision: input.decision,
          riskRating: input.riskRating,
          rejectionReason: input.rejectionReason ?? null,
        },
      });

      return {
        reviewId: decided.review.id,
        merchantId: decided.merchantId,
        status: input.decision,
        merchantStatus: input.decision === "approved" ? ("active" as const) : ("rejected" as const),
      };
    }),
});

export type MerchantOnboardingRouter = typeof merchantOnboardingRouter;
