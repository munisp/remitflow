/**
 * RemitFlow — BVN/NIN Verification Router (proxies to Go service)
 * ────────────────────────────────────────────────────────────────
 * Wave-13 C6: reduced to the bvnNin sub-router only. The former
 * accountOpeningGate / enhancedKyb / kycVerificationScoring / sanctionsBatch /
 * goaml / kycEventConsumer / cbnTierLimits sub-routers had zero callers and
 * were deleted (enhancedKyb superseded by server/routers/merchantOnboarding.ts).
 *
 * Design principle: FAIL-CLOSED — if the verification service is unreachable,
 * the operation is BLOCKED, not allowed through.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { createAuditLog } from "../db";

const BVN_NIN_URL = process.env.BVN_NIN_SERVICE_URL || "http://localhost:8121";

// ─── Helper: Fail-closed fetch ───────────────────────────────────────────────
async function failClosedFetch<T>(
  url: string,
  options: RequestInit,
  fallbackOnError: "block" | "default",
  defaultValue?: T
): Promise<T> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) {
      if (fallbackOnError === "block") {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: `KYC gateway returned ${resp.status} — operation blocked (fail-closed)`,
        });
      }
      return defaultValue as T;
    }
    return (await resp.json()) as T;
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    if (fallbackOnError === "block") {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "KYC/KYB service unreachable — operation blocked (fail-closed)",
      });
    }
    return defaultValue as T;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BVN/NIN Verification Router (proxies to Go service)
// ═══════════════════════════════════════════════════════════════════════════════

export const bvnNinRouter = router({
  verifyBVN: protectedProcedure
    .input(
      z.object({
        bvn: z.string().length(11),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        dateOfBirth: z.string(),
        phoneNumber: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await failClosedFetch<{
        verified: boolean;
        match_score: number;
        verification_id: string;
        error?: string;
      }>(
        `${BVN_NIN_URL}/v1/bvn/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bvn: input.bvn,
            first_name: input.firstName,
            last_name: input.lastName,
            date_of_birth: input.dateOfBirth,
            phone_number: input.phoneNumber,
          }),
        },
        "block"
      );

      await createAuditLog({
        userId: ctx.user.id,
        action: "bvn.verified",
        targetType: "identity",
        description: result.verification_id,
        metadata: { verified: result.verified, matchScore: result.match_score },
      });

      return result;
    }),

  verifyNIN: protectedProcedure
    .input(
      z.object({
        nin: z.string().length(11),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        dateOfBirth: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await failClosedFetch<{
        verified: boolean;
        match_score: number;
        verification_id: string;
        error?: string;
      }>(
        `${BVN_NIN_URL}/v1/nin/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nin: input.nin,
            first_name: input.firstName,
            last_name: input.lastName,
            date_of_birth: input.dateOfBirth,
          }),
        },
        "block"
      );

      await createAuditLog({
        userId: ctx.user.id,
        action: "nin.verified",
        targetType: "identity",
        description: result.verification_id,
        metadata: { verified: result.verified, matchScore: result.match_score },
      });

      return result;
    }),

  crossMatch: protectedProcedure
    .input(z.object({ bvn: z.string().length(11), nin: z.string().length(11) }))
    .mutation(async ({ ctx, input }) => {
      return failClosedFetch(
        `${BVN_NIN_URL}/v1/bvn-nin/match`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
        "block"
      );
    }),
});
