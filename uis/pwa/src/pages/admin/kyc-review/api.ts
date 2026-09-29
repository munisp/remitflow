/**
 * Admin KYC review console — typed client wrapper over the PWA tRPC client.
 *
 * Server contract (verified against bdc-integration @ 944b2b7):
 *   admin.listPendingKyc        (server/routers.ts:4897, adminProcedure)
 *     input:  { page?: number (min 1, default 1), limit?: number (1..50, default 20),
 *               status?: "pending"|"under_review"|"approved"|"rejected"|"all" (default "pending") }
 *     output: { docs: PendingKycDoc[], total, page, pages }
 *   admin.getKycDocumentHistory (server/routers.ts:4846, adminProcedure)
 *     input:  { userId: number, docType?: string }
 *     output: { docs: KycDocumentRow[] }   // full kycDocuments rows
 *   admin.setKycUnderReview     (server/routers.ts:4968, adminProcedure)
 *     input:  { docId: number }
 *     output: { success, docId, status: "under_review" }
 *   admin.approveKyc            (server/routers.ts:4910, PBAC kycApproveProcedure
 *                                — policy "kyc.approve": admin or compliance_officer,
 *                                server/pbac.ts:205)
 *     input:  { docId: number, advanceTier?: boolean (default true) }
 *     output: { success, docId }
 *   admin.rejectKyc             (server/routers.ts:4948, adminProcedure)
 *     input:  { docId: number, reason: string (min 5, max 500) }
 *     output: { success, docId }
 *   captureSessions.list        (server/routers/kycCapture.ts:1133, adminProcedure)
 *     input:  { limit?: 1..100 (default 25), offset?: number (default 0),
 *               status?: "issued"|"in_progress"|"verified"|"failed"|"expired"|"manual_review",
 *               userId?: number }
 *     output: { total, limit, offset, sessions: CaptureSessionRow[] } // nonce stripped
 *
 * TOTP step-up: the PBAC middleware (server/pbac.ts:436-453) reads a raw
 * `totpCode` off the wire input whenever a policy decision requires MFA, and
 * fails closed with a "2FA_REQUIRED" FORBIDDEN error when the code is missing
 * or invalid. The console therefore collects a 6-digit code on approve/reject
 * (same pattern as pages/bdc/TotpField.tsx) and forwards it when entered;
 * zod schemas that do not declare `totpCode` strip it harmlessly.
 *
 * The PWA-local AppRouter contract (types/appRouter.ts) does not declare the
 * `admin` namespace, so this module casts the shared vanilla client to a
 * local structural type — the same convention as pages/bdc/api.ts and
 * pages/kyc/api.ts.
 */
import { trpcClient } from "../../../services/trpc";

// ── admin.listPendingKyc row (exact select list at server/routers.ts:4905) ──

export type KycDocQueueStatus = "pending" | "under_review" | "approved" | "rejected";
export type KycStatusFilter = KycDocQueueStatus | "all";

export interface PendingKycDoc {
  id: number;
  userId: number;
  docType: string;
  status: string | null;
  fileUrl: string | null;
  rejectionReason: string | null;
  reviewedAt: string | Date | null;
  createdAt: string | Date;
  /** leftJoin(users) — null when the user row is missing. */
  userName: string | null;
  userEmail: string | null;
  userKycTier: string | null;
}

export interface PendingKycListResponse {
  docs: PendingKycDoc[];
  total: number;
  page: number;
  pages: number;
}

// ── admin.getKycDocumentHistory row (full kycDocuments select, drizzle/schema.ts:207) ──

export interface KycDocumentRow {
  id: number;
  userId: number;
  docType: string;
  status: string | null;
  fileUrl: string | null;
  fileKey: string | null;
  rejectionReason: string | null;
  expiresAt: string | Date | null;
  reviewedAt: string | Date | null;
  supersededAt: string | Date | null;
  extractedData: unknown;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// ── captureSessions.list row (server/routers/kycCapture.ts:1133) ──

export type CaptureSessionStatus =
  | "issued"
  | "in_progress"
  | "verified"
  | "failed"
  | "expired"
  | "manual_review";

export interface CapturePipelineResultRow {
  id: string;
  userId: number | null;
  sessionId: string | null;
  /** 'ocr'|'mrz'|'authenticity'|'liveness'|'face_match'|'deepfake'|'nfc' */
  stage: string;
  model: string | null;
  success: boolean;
  simulated: boolean;
  score: number | null;
  details: unknown;
  createdAt: string | Date;
}

export interface CaptureSessionRow {
  id: string;
  userId: number;
  tenantId: number | null;
  status: CaptureSessionStatus | string;
  /** Server strips nonce from list/detail responses. */
  nonce?: undefined;
  challenge: unknown;
  docType: string | null;
  nfcSupported: boolean | null;
  verdict: unknown;
  createdAt: string | Date;
  expiresAt: string | Date;
  completedAt: string | Date | null;
  pipelineResults: CapturePipelineResultRow[];
  authenticity: unknown[];
}

export interface CaptureSessionListResponse {
  total: number;
  limit: number;
  offset: number;
  sessions: CaptureSessionRow[];
}

// ── Structural client ────────────────────────────────────────────────────────

export const adminKycApi = trpcClient as unknown as {
  admin: {
    listPendingKyc: {
      query: (i: {
        page?: number;
        limit?: number;
        status?: KycStatusFilter;
      }) => Promise<PendingKycListResponse>;
    };
    getKycDocumentHistory: {
      query: (i: { userId: number; docType?: string }) => Promise<{ docs: KycDocumentRow[] }>;
    };
    setKycUnderReview: {
      mutate: (i: { docId: number }) => Promise<{ success: boolean; docId: number; status: string }>;
    };
    approveKyc: {
      mutate: (i: {
        docId: number;
        advanceTier?: boolean;
        /** Optional step-up code — consumed by PBAC middleware when MFA is required. */
        totpCode?: string;
      }) => Promise<{ success: boolean; docId: number }>;
    };
    rejectKyc: {
      mutate: (i: {
        docId: number;
        reason: string;
        /** Optional step-up code — stripped by the zod schema if unused. */
        totpCode?: string;
      }) => Promise<{ success: boolean; docId: number }>;
    };
  };
  captureSessions: {
    list: {
      query: (i: {
        limit?: number;
        offset?: number;
        status?: CaptureSessionStatus;
        userId?: number;
      }) => Promise<CaptureSessionListResponse>;
    };
  };
};

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
