/**
 * RemitFlow — KYC Orchestration tRPC Router
 *
 * Exposes the full next-generation KYC pipeline to the TypeScript API layer.
 * Delegates heavy processing to the Go KYC Orchestrator, which coordinates:
 *   - Python KYC Pipeline (PaddleOCR + Docling + VLM + 6-layer liveness)
 *   - Rust Biometric Service (ArcFace matching + deduplication)
 *   - Python AML Scorer (sanctions + PEP + risk scoring)
 *   - Python Travel Rule (FATF compliance)
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { kycLifecycle, kycLifecycleHistory } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";

const KYC_ORCHESTRATOR_URL = process.env.KYC_ORCHESTRATOR_URL ?? "http://go-kyc-orchestrator:8150";
const KYC_PIPELINE_URL     = process.env.KYC_PIPELINE_URL     ?? "http://python-kyc-pipeline:8148";
const BIOMETRIC_URL        = process.env.BIOMETRIC_URL        ?? "http://rust-biometric:8149";

// ── Zod Schemas ───────────────────────────────────────────────────────────────
const DocTypeEnum = z.enum([
  "passport",
  "national_id",
  "drivers_license",
  "bvn",
  "nin",
  "utility_bill",
]);

const KYCSubmitInput = z.object({
  docType:        DocTypeEnum,
  docNumber:      z.string().optional(),
  docImageBase64: z.string().optional(),
  docBackBase64:  z.string().optional(),
  selfieBase64:   z.string().optional(),
  firstName:      z.string().min(1).max(100),
  lastName:       z.string().min(1).max(100),
  dateOfBirth:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: YYYY-MM-DD"),
  nationality:    z.string().length(2, "ISO 3166-1 alpha-2 country code"),
  address:        z.string().optional(),
  runLiveness:    z.boolean().default(true),
  runVLM:         z.boolean().default(true),
  runBiometric:   z.boolean().default(true),
  runAML:         z.boolean().default(true),
  transferAmount: z.number().optional(),
});

const LivenessCheckInput = z.object({
  selfieBase64:    z.string(),
  docImageBase64:  z.string().optional(),
  challengeFrames: z.array(z.object({
    challenge:    z.string(),
    imageBase64:  z.string(),
    timestampMs:  z.number(),
  })).optional(),
  sessionId:       z.string().optional(),
});

const ChallengeCreateInput = z.object({
  numChallenges: z.number().int().min(1).max(4).default(2),
});

// ── Helper: call downstream services ─────────────────────────────────────────
async function callService(url: string, body: unknown): Promise<unknown> {
  const resp = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new TRPCError({
      code:    "INTERNAL_SERVER_ERROR",
      message: `Downstream service error ${resp.status}: ${text.slice(0, 200)}`,
    });
  }

  return resp.json();
}

// ── Orchestrator response contract (services/go-kyc-orchestrator/main.go) ────
interface OrchestrationResult {
  orchestration_id?: string;
  final_status?: string; // "approved" | "rejected" | "manual_review"
  rejection_reasons?: string[];
  fraud_signals?: string[];
  stages?: Record<string, unknown>;
  processing_ms?: number;
  timestamp?: string;
  [key: string]: unknown;
}

// Map the orchestrator verdict onto the kyc_lifecycle stage enum.
// IMPORTANT (W13): an orchestrator "approved" verdict marks the LIFECYCLE
// stage approved but NEVER advances users.kycTier — the admin approveKyc
// path (routers.ts admin router) remains the only tier-advance mechanism.
const VERDICT_TO_STAGE = {
  approved: "approved",
  rejected: "rejected",
  manual_review: "under_review",
} as const;

type LifecycleStage = (typeof VERDICT_TO_STAGE)[keyof typeof VERDICT_TO_STAGE];

/**
 * Persist the orchestration verdict to kyc_lifecycle (+ history) in a single
 * transaction with a guarded single-winner stage transition.
 * Returns true when persisted; false when the DB is unavailable (callers
 * surface this honestly via the `persisted` response field).
 */
async function persistOrchestrationResult(
  userId: number,
  result: OrchestrationResult,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const toStage: LifecycleStage =
    VERDICT_TO_STAGE[result.final_status as keyof typeof VERDICT_TO_STAGE] ??
    "under_review";
  const rejectionReason =
    result.rejection_reasons && result.rejection_reasons.length > 0
      ? result.rejection_reasons.join("; ")
      : null;
  const now = new Date();

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: kycLifecycle.id, stage: kycLifecycle.stage })
      .from(kycLifecycle)
      .where(eq(kycLifecycle.userId, userId))
      .limit(1);

    if (!existing) {
      const [inserted] = await tx
        .insert(kycLifecycle)
        .values({
          userId,
          stage: toStage,
          submittedAt: now,
          ...(toStage === "under_review" ? { reviewStartedAt: now } : {}),
          ...(toStage === "rejected" ? { rejectedAt: now, rejectionReason } : {}),
          notes: `orchestration_id=${result.orchestration_id ?? "n/a"} final_status=${result.final_status ?? "unknown"}`,
          updatedAt: now,
        })
        .returning({ id: kycLifecycle.id });
      await tx.insert(kycLifecycleHistory).values({
        lifecycleId: inserted.id,
        userId,
        fromStage: "not_started",
        toStage,
        reason: rejectionReason ?? `Orchestrator verdict: ${result.final_status ?? "unknown"}`,
        metadata: { orchestrationId: result.orchestration_id ?? null, fraudSignals: result.fraud_signals ?? [] },
      });
      return;
    }

    if (existing.stage === toStage) {
      // Idempotent re-submission with the same verdict — nothing to do.
      return;
    }

    // Guarded single-winner transition: only one concurrent writer moves
    // the stage from its observed previous value.
    const updated = await tx
      .update(kycLifecycle)
      .set({
        stage: toStage,
        ...(toStage === "under_review" ? { reviewStartedAt: now } : {}),
        ...(toStage === "rejected" ? { rejectedAt: now, rejectionReason } : {}),
        ...(toStage === "approved" ? { approvedAt: now } : {}),
        notes: `orchestration_id=${result.orchestration_id ?? "n/a"} final_status=${result.final_status ?? "unknown"}`,
        updatedAt: now,
      })
      .where(and(eq(kycLifecycle.id, existing.id), eq(kycLifecycle.stage, existing.stage)))
      .returning({ id: kycLifecycle.id });

    if (updated.length !== 1) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "KYC lifecycle state changed concurrently — please retry.",
      });
    }

    await tx.insert(kycLifecycleHistory).values({
      lifecycleId: existing.id,
      userId,
      fromStage: existing.stage,
      toStage,
      reason: rejectionReason ?? `Orchestrator verdict: ${result.final_status ?? "unknown"}`,
      metadata: { orchestrationId: result.orchestration_id ?? null, fraudSignals: result.fraud_signals ?? [] },
    });
  });

  return true;
}

// ── Router ────────────────────────────────────────────────────────────────────
export const kycOrchestrationRouter = createTRPCRouter({

  /**
   * Submit a full KYC application.
   * Orchestrates document processing, liveness, biometrics, AML, and Travel Rule.
   * W13: the verdict is persisted to kyc_lifecycle; tier is NEVER advanced here.
   */
  submit: protectedProcedure
    .input(KYCSubmitInput)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;

      const payload = {
        user_id:          userId,
        doc_type:         input.docType,
        doc_number:       input.docNumber,
        doc_image_base64: input.docImageBase64,
        doc_back_base64:  input.docBackBase64,
        selfie_base64:    input.selfieBase64,
        first_name:       input.firstName,
        last_name:        input.lastName,
        date_of_birth:    input.dateOfBirth,
        nationality:      input.nationality,
        address:          input.address,
        run_liveness:     input.runLiveness,
        run_vlm:          input.runVLM,
        run_biometric:    input.runBiometric,
        run_aml:          input.runAML,
        run_travel_rule:  (input.transferAmount ?? 0) >= 1000,
        transfer_amount:  input.transferAmount,
      };

      const result = (await callService(
        `${KYC_ORCHESTRATOR_URL}/kyc/orchestrate`,
        payload,
      )) as OrchestrationResult;

      // Persist the verdict. If the DB is unavailable we do NOT pretend the
      // result was recorded — the honest `persisted: false` marker tells the
      // caller the verdict exists only in this response.
      const persisted = await persistOrchestrationResult(Number(userId), result);

      return {
        ...result,
        persisted,
        // Honest contract: submitting KYC never advances the tier by itself.
        tierAdvanced: false,
        tierAdvanceNote:
          "Tier upgrades require admin approval of your submitted documents.",
      };
    }),

  /**
   * Standalone liveness check (for re-verification flows).
   */
  checkLiveness: protectedProcedure
    .input(LivenessCheckInput)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;

      const payload = {
        user_id:          userId,
        selfie_base64:    input.selfieBase64,
        doc_image_base64: input.docImageBase64,
        challenge_frames: input.challengeFrames?.map(f => ({
          challenge:    f.challenge,
          image_base64: f.imageBase64,
          timestamp_ms: f.timestampMs,
        })),
        session_id: input.sessionId,
      };

      return callService(`${KYC_PIPELINE_URL}/liveness/check`, payload);
    }),

  /**
   * Create an active liveness challenge session.
   * Returns session_id and list of challenges (blink, turn_left, etc.)
   */
  createChallenge: protectedProcedure
    .input(ChallengeCreateInput)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      return callService(`${KYC_PIPELINE_URL}/liveness/challenge/create`, {
        user_id:        userId,
        num_challenges: input.numChallenges,
      });
    }),

  /**
   * Get KYC submission result by ID.
   */
  getResult: protectedProcedure
    .input(z.object({ submissionId: z.string() }))
    .query(async ({ input, ctx }) => {
      const resp = await fetch(`${KYC_PIPELINE_URL}/kyc/${input.submissionId}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        throw new TRPCError({ code: "NOT_FOUND", message: "KYC submission not found" });
      }
      return resp.json();
    }),

  /**
   * Get KYC history for the current user.
   */
  getHistory: protectedProcedure
    .query(async ({ ctx }) => {
      const userId = ctx.user.id;
      const resp = await fetch(`${KYC_PIPELINE_URL}/kyc/user/${userId}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to fetch KYC history" });
      }
      return resp.json();
    }),

  /**
   * Biometric face match — verify selfie against enrolled biometric profile.
   */
  biometricMatch: protectedProcedure
    .input(z.object({ selfieBase64: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      return callService(`${BIOMETRIC_URL}/biometric/match`, {
        user_id:      userId,
        image_base64: input.selfieBase64,
      });
    }),

  /**
   * Admin: Get KYC pipeline health status.
   */
  health: publicProcedure
    .query(async () => {
      const services = [
        { name: "kyc-pipeline",     url: `${KYC_PIPELINE_URL}/health` },
        { name: "biometric",        url: `${BIOMETRIC_URL}/health` },
        { name: "kyc-orchestrator", url: `${KYC_ORCHESTRATOR_URL}/health` },
      ];

      const results = await Promise.allSettled(
        services.map(async (svc) => {
          const resp = await fetch(svc.url, { signal: AbortSignal.timeout(5_000) });
          const data = await resp.json();
          return { name: svc.name, status: "healthy", data };
        })
      );

      return results.map((r, i) => ({
        service: services[i].name,
        status:  r.status === "fulfilled" ? "healthy" : "unhealthy",
        detail:  r.status === "fulfilled" ? r.value.data : (r.reason as Error).message,
      }));
    }),
});
