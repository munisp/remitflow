/**
 * KYC camera-capture flow — typed client wrapper over the PWA tRPC client.
 *
 * Server contract (wave-15 SPEC §7, owner: K4, server router `kycCapture`):
 *   kycCapture.startSession          {docType, nfcSupported}
 *     → {sessionId, nonce, challenge: string[], expiresAt}
 *   kycCapture.submitDocument        {sessionId, nonce, docType, frames: base64-jpeg[≤6]}
 *     → {stage: 'document', ok, reason?}
 *   kycCapture.submitChallengeEvents {sessionId, nonce, events: [{seq,event,timestamp,payload}], sampledFrames: base64[]}
 *     → {ok, reason?}
 *   kycCapture.submitNfcData         — N/A on web (no NFC), intentionally unused.
 *   kycCapture.finalize              {sessionId, nonce}
 *     → {status: 'verified'|'failed'|'manual_review', verdict}
 *   kycCapture.getSession            {sessionId} → {status, verdict}
 *
 * Admin (wave-15 SPEC §7, captureSessions.*):
 *   captureSessions.list    {status?, limit?, cursor?} → {items, nextCursor?}
 *   captureSession.detail   {sessionId} → CaptureSessionDetail
 *
 * The PWA-local AppRouter contract (types/appRouter.ts) does not declare these
 * routers yet, so this module casts the shared vanilla client to a local
 * structural type — the same convention as pages/bdc/api.ts and KYC.tsx.
 */
import { trpcClient } from "../../services/trpc";

// ── Types mirroring the kycCapture contract (SPEC §7) ────────────────────────

export type CaptureDocType = "passport" | "national_id" | "drivers_license";

export interface StartSessionInput {
  docType: CaptureDocType;
  nfcSupported: boolean;
}

export interface StartSessionResponse {
  sessionId: string;
  nonce: string;
  /** Ordered challenge tokens issued by the server, e.g. ["blink","turn_left"]. */
  challenge: string[];
  expiresAt: string;
}

export interface SubmitDocumentInput {
  sessionId: string;
  nonce: string;
  docType: CaptureDocType;
  /** base64-encoded JPEG frames, at most 6 (we send a 3-frame burst). */
  frames: string[];
}

export interface SubmitDocumentResponse {
  stage: "document";
  ok: boolean;
  reason?: string;
}

export interface ChallengeEvent {
  seq: number;
  event: string;
  /** Epoch milliseconds when the event was detected client-side. */
  timestamp: number;
  /** Detector detail (blendshape scores etc.) — diagnostic only, never asserted as proof. */
  payload?: Record<string, unknown>;
}

export interface SubmitChallengeEventsInput {
  sessionId: string;
  nonce: string;
  events: ChallengeEvent[];
  /** 3–5 small base64 JPEG frames sampled during the challenge. */
  sampledFrames: string[];
}

export interface SubmitChallengeEventsResponse {
  ok: boolean;
  reason?: string;
}

export type CaptureVerdictStatus = "verified" | "failed" | "manual_review";

export interface FinalizeResponse {
  status: CaptureVerdictStatus;
  verdict?: string;
}

export interface GetSessionResponse {
  status: CaptureVerdictStatus | "pending" | "processing" | "expired";
  verdict?: string;
}

// ── Admin captureSessions contract (SPEC §7) ─────────────────────────────────

export interface CaptureSessionSummary {
  sessionId: string;
  userId?: string;
  docType?: string;
  status: string;
  verdict?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CaptureSessionListResponse {
  items: CaptureSessionSummary[];
  nextCursor?: string | null;
}

export interface CapturePipelineStageResult {
  stage: string;
  ok: boolean;
  reason?: string;
  score?: number;
  detail?: Record<string, unknown>;
}

export interface CaptureSessionDetail extends CaptureSessionSummary {
  challenge?: string[];
  events?: ChallengeEvent[];
  pipelineResults?: CapturePipelineStageResult[];
  expiresAt?: string;
}

// ── Structural client ────────────────────────────────────────────────────────

export const kycCaptureApi = trpcClient as unknown as {
  kycCapture: {
    startSession: { mutate: (i: StartSessionInput) => Promise<StartSessionResponse> };
    submitDocument: { mutate: (i: SubmitDocumentInput) => Promise<SubmitDocumentResponse> };
    submitChallengeEvents: {
      mutate: (i: SubmitChallengeEventsInput) => Promise<SubmitChallengeEventsResponse>;
    };
    finalize: { mutate: (i: { sessionId: string; nonce: string }) => Promise<FinalizeResponse> };
    getSession: { query: (i: { sessionId: string }) => Promise<GetSessionResponse> };
  };
  captureSessions: {
    list: {
      query: (i: {
        status?: string;
        limit?: number;
        cursor?: string;
      }) => Promise<CaptureSessionListResponse>;
    };
  };
  captureSession: {
    detail: { query: (i: { sessionId: string }) => Promise<CaptureSessionDetail> };
  };
};

/** Web has no NFC path — reported honestly to the server; submitNfcData is never called. */
export function detectNfcSupport(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
