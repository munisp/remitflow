import { router, protectedProcedure } from "../_core/trpc";
import { createAuditLog } from "../audit.service";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { immigrantWorkerKyc } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { safeParseAmount } from "../lib/safeDecimal";
import { executeTransferPipeline, settleTransferHold, compensateFailedTransfer } from "../_core/transferPipeline";
import { validateFile } from "../_core/serviceRegistry";
import { logger } from "../_core/logger";

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
      // W9/Q10 (F9-3): the selfie must pass the file scanner before it is
      // forwarded to the KYC service. Fail closed on any scan failure.
      try {
        const scan = await validateFile(input.selfieUrl);
        if (!scan.safe) {
          logger.warn({ userId: ctx.user.id, threats: scan.threats }, "[ImmigrantWorker] Unsafe selfie rejected");
          throw new TRPCError({ code: "BAD_REQUEST", message: `Selfie rejected by security scan: ${scan.threats.join(", ") || "unsafe content"}` });
        }
      } catch (scanErr: any) {
        if (scanErr instanceof TRPCError) throw scanErr;
        logger.warn({ userId: ctx.user.id, err: scanErr?.message }, "[ImmigrantWorker] Selfie scan failed — rejected (fail closed)");
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Your selfie could not be scanned for threats — please retry later." });
      }

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
        }).returning();
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
      // W9/Q10 (F9-3): every submitted document must pass the file scanner
      // before it is forwarded to the KYC service or referenced in the DB.
      // validateFile fails closed (throws when the scanner is unavailable) —
      // any scan failure/unsafe verdict rejects the upgrade.
      for (const [label, url] of [["document", input.documentUrl], ["utility bill", input.utilityBillUrl]] as const) {
        if (!url) continue;
        try {
          const scan = await validateFile(url);
          if (!scan.safe) {
            logger.warn({ userId: ctx.user.id, label, threats: scan.threats }, "[ImmigrantWorker] Unsafe KYC document rejected");
            throw new TRPCError({ code: "BAD_REQUEST", message: `${label} rejected by security scan: ${scan.threats.join(", ") || "unsafe content"}` });
          }
        } catch (scanErr: any) {
          if (scanErr instanceof TRPCError) throw scanErr;
          logger.warn({ userId: ctx.user.id, label, err: scanErr?.message }, "[ImmigrantWorker] Document scan failed — rejected (fail closed)");
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Your ${label} could not be scanned for threats — please retry later.` });
        }
      }

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
      totpCode: z.string().regex(/^\d{6}$/).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // W12: canonical TOTP step-up (fail-closed) — money-moving mutation.
      const { requireTotpStepUp } = await import("../_core/totpStepUp");
      await requireTotpStepUp(ctx.user.id, input.totpCode, "worker transfer");
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

      const transferId = `WRK-${Date.now()}-${ctx.user.id}`;
      const corridorCurrency = input.corridorCode === "GH" ? "GHS" : "XOF";

      // Execute unified transfer pipeline (sanctions, fraud ML, velocity, TigerBeetle, Kafka, notifications)
      const pipelineResult = await executeTransferPipeline({
        userId: ctx.user.id,
        amount: input.amountNgn,
        fromCurrency: "NGN",
        toCurrency: corridorCurrency,
        recipientName: input.recipientName,
        recipientAccount: input.recipientMobileMoney,
        rail: "mojaloop",
        corridorCode: input.corridorCode,
        featureLabel: "immigrant_worker",
        transferId,
        description: `Worker remittance to ${input.corridorCode}`,
        metadata: { mojaloopDfspId: input.mojaloopDfspId, kycTier: limitCheck.kyc_tier },
      });

      // FF-FIX: the pipeline TB hold was NEVER settled/compensated (orphaned).
      // Rail call failure → compensate (void hold); success → settle (post
      // hold + atomic PG debit, journaled).
      const releaseHold = (reason: string) =>
        pipelineResult.tigerBeetleRecorded
          ? compensateFailedTransfer({
              transferId, userId: ctx.user.id, amount: input.amountNgn, currency: "NGN",
              reason, stage: "settlement",
            }).catch((cErr) => logger.warn({ err: cErr instanceof Error ? cErr.message : String(cErr), transferId }, "[ImmigrantWorker] Hold release failed — reaper will reconcile"))
          : Promise.resolve();

      // Submit via XOF adapter
      let res: Response;
      try {
        res = await fetch(`${XOF_ADAPTER_URL}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transfer_id: transferId,
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
      } catch (fetchErr) {
        await releaseHold(`XOF adapter unreachable: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Transfer submission failed — no funds moved, hold released" });
      }

      if (!res.ok) {
        await releaseHold(`XOF adapter rejected submission: HTTP ${res.status}`);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Transfer submission failed" });
      }

      const result = await res.json();

      if (pipelineResult.tigerBeetleRecorded) {
        try {
          await settleTransferHold({ transferId, userId: ctx.user.id, amount: input.amountNgn, currency: "NGN" });
        } catch (settleErr) {
          logger.error({ err: settleErr instanceof Error ? settleErr.message : String(settleErr), transferId },
            "[ImmigrantWorker] CRITICAL: rail committed but settlement failed — MANUAL RECONCILIATION REQUIRED (journal marked reconcile_required)");
        }
      }

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

      return { ...result, verified: true, transferId, fraudScore: pipelineResult.fraudScore };
    }),
});
