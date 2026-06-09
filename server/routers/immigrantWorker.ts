import { router, protectedProcedure } from "../_core/trpc";
import { createAuditLog } from "../audit.service";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { immigrantWorkerKyc } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { safeParseAmount } from "../lib/safeDecimal";

const KYC_SERVICE_URL = process.env.IMMIGRANT_WORKER_KYC_URL ?? "http://rust-immigrant-worker-kyc:8099";
const XOF_ADAPTER_URL = process.env.XOF_ADAPTER_URL ?? "http://go-xof-adapter:8095";

async function callKycService(path: string, body?: object) {
  const res = await fetch(`${KYC_SERVICE_URL}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "Service error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `KYC service error: ${err}` });
  }
  return res.json();
}

export const immigrantWorkerRouter = router({
  submitSimplifiedKyc: protectedProcedure
    .input(z.object({
      nin: z.string().length(11, "NIN must be 11 digits"),
      selfieUrl: z.string().url(),
      phoneNumber: z.string().min(11).max(15),
      employerName: z.string().min(2).max(100).optional(),
      workState: z.string().min(2).max(50).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await callKycService("/kyc/submit", {
        user_id: ctx.user.id,
        nin: input.nin,
        selfie_url: input.selfieUrl,
        phone_number: input.phoneNumber,
        employer_name: input.employerName,
        work_state: input.workState,
      });

      const db = await getDb();
      const existing = await db.select().from(immigrantWorkerKyc)
        .where(eq(immigrantWorkerKyc.userId, ctx.user.id));

      if (existing.length === 0) {
        await db.insert(immigrantWorkerKyc).values({
          userId: ctx.user.id,
          kycTier: "tier1",
          nin: input.nin,
          selfieVerified: result.selfie_verified ?? false,
          monthlyLimitUsd: "500.00",
          monthlyUsedUsd: "0.00",
          annualLimitUsd: "5000.00",
          annualUsedUsd: "0.00",
          verificationProvider: result.provider ?? "internal",
          verifiedAt: result.verified ? new Date() : null,
          createdAt: new Date(),
        });
      }

      return result;
    }),

  getKycStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const [record] = await db.select().from(immigrantWorkerKyc)
      .where(eq(immigrantWorkerKyc.userId, ctx.user.id));
    if (!record) return { kycTier: "none", verified: false };
    return record;
  }),

  upgradeKycTier: protectedProcedure
    .input(z.object({
      documentType: z.enum(["national_id", "passport", "drivers_license", "voters_card"]),
      documentUrl: z.string().url(),
      utilityBillUrl: z.string().url().optional(),
      bvn: z.string().length(11).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await callKycService("/kyc/upgrade", {
        user_id: ctx.user.id,
        document_type: input.documentType,
        document_url: input.documentUrl,
        utility_bill_url: input.utilityBillUrl,
        bvn: input.bvn,
      });

      if (result.approved) {
        const db = await getDb();
        const newTier = result.new_tier ?? "tier2";
        const newMonthlyLimit = newTier === "tier2" ? "2000.00" : "10000.00";
        const newAnnualLimit = newTier === "tier2" ? "20000.00" : "100000.00";

        await db.update(immigrantWorkerKyc)
          .set({
            kycTier: newTier,
            documentType: input.documentType,
            documentVerified: true,
            bvn: input.bvn,
            monthlyLimitUsd: newMonthlyLimit,
            annualLimitUsd: newAnnualLimit,
            verifiedAt: new Date(),
          })
          .where(eq(immigrantWorkerKyc.userId, ctx.user.id)).returning();
      }

      return result;
    }),

  getMonthlyLimit: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const [record] = await db.select().from(immigrantWorkerKyc)
      .where(eq(immigrantWorkerKyc.userId, ctx.user.id));
    if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "KYC record not found. Please complete KYC first." });

    const monthlyLimit = safeParseAmount(record.monthlyLimitUsd ?? "500");
    const monthlyUsed = safeParseAmount(record.monthlyUsedUsd ?? "0");
    const annualLimit = safeParseAmount(record.annualLimitUsd ?? "5000");
    const annualUsed = safeParseAmount(record.annualUsedUsd ?? "0");

    return {
      kycTier: record.kycTier,
      monthly: {
        limit: monthlyLimit,
        used: monthlyUsed,
        remaining: Math.max(0, monthlyLimit - monthlyUsed),
        percentUsed: Math.min(100, (monthlyUsed / monthlyLimit) * 100),
      },
      annual: {
        limit: annualLimit,
        used: annualUsed,
        remaining: Math.max(0, annualLimit - annualUsed),
        percentUsed: Math.min(100, (annualUsed / annualLimit) * 100),
      },
    };
  }),

  submitWorkerTransfer: protectedProcedure
    .input(z.object({
      amountNgn: z.number().positive().max(1_000_000),
      recipientMobileMoney: z.string().min(10).max(20),
      corridorCode: z.enum(["TG", "NE", "ML", "BJ", "GH"]),
      recipientName: z.string().min(2).max(100),
      mojaloopDfspId: z.string().min(2).max(50),
    }))
    .mutation(async ({ input, ctx }) => {
      // Check KYC and limits
      const limitCheck = await callKycService("/check-limit", {
        user_id: ctx.user.id,
        amount_ngn: input.amountNgn,
      });
      if (!limitCheck.allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: limitCheck.reason ?? "Monthly transfer limit exceeded. Please upgrade your KYC tier.",
        });
      }

      // Submit via XOF adapter
      const res = await fetch(`${XOF_ADAPTER_URL}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transfer_id: `WRK-${Date.now()}-${ctx.user.id}`,
          corridor_code: input.corridorCode,
          amount_ngn: input.amountNgn,
          recipient_mobile_money: input.recipientMobileMoney,
          recipient_name: input.recipientName,
          mojaloop_dfsp_id: input.mojaloopDfspId,
          purpose_code: "FAM",
          user_id: ctx.user.id,
          kyc_tier: limitCheck.kyc_tier,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Transfer submission failed" });
      }

      const result = await res.json();

      // Update monthly usage
      const db = await getDb();
      const [record] = await db.select().from(immigrantWorkerKyc)
        .where(eq(immigrantWorkerKyc.userId, ctx.user.id));
      if (record) {
        const amountUsd = input.amountNgn / 1620;
        const newMonthlyUsed = safeParseAmount(record.monthlyUsedUsd ?? "0") + amountUsd;
        const newAnnualUsed = safeParseAmount(record.annualUsedUsd ?? "0") + amountUsd;
        await db.update(immigrantWorkerKyc)
          .set({
            monthlyUsedUsd: newMonthlyUsed.toFixed(2),
            annualUsedUsd: newAnnualUsed.toFixed(2),
          })
          .where(eq(immigrantWorkerKyc.userId, ctx.user.id)).returning();
      }

      return result;
    }),
});
