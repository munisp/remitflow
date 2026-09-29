/**
 * RemitFlow — KYC Capture Session tRPC Router (Wave-15, SPEC-wave15 §6)
 *
 * Server-side capture-session API for the open-source-first OpenKYC pipeline:
 *   startSession          — issue a single-active capture session (nonce + randomized challenge)
 *   submitDocument        — document frames → python-kyc-pipeline (OCR + MRZ + authenticity)
 *   submitChallengeEvents — liveness challenge events → python-kyc-liveness /challenge/validate
 *   submitNfcData         — optional NFC passive auth → python-csca-store
 *   finalize              — aggregate stage verdicts; guarded lifecycle 'approved' on verified
 *
 * Standing constraints honored here:
 *   - FAIL CLOSED everywhere: downstream service errors abort the step with an
 *     honest error; nothing is marked passed on absence of evidence.
 *   - db.transaction wraps every multi-write sequence.
 *   - Single active session per user via guarded UPDATE (status IN issued/in_progress).
 *   - Nonce replay protection: timing-safe nonce comparison per mutation +
 *     single-submission guards (guarded status transitions / existing-row checks).
 *   - Tier advancement is UNCHANGED: finalize may move kyc_lifecycle to
 *     'approved' (pre-verified badge for admins) but NEVER touches users.kycTier.
 *     Admin approveKyc remains the only tier-advance mechanism (W13 contract).
 *   - NEVER auto-verify on simulated pipeline results.
 */

import { randomBytes, randomInt, timingSafeEqual } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  router,
  protectedProcedure,
  adminProcedure,
  strictRateLimitedProcedure,
} from "../trpc";
import { getDb } from "../db";
import { resolveTenantContext } from "../tenantMiddleware";
import {
  kycCaptureSessions,
  kycChallengeEvents,
  kycPipelineResults,
  documentAuthenticity,
  kycLifecycle,
  kycLifecycleHistory,
} from "../../drizzle/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

// ── Service endpoints (repo convention: env override ?? in-cluster default) ──
const KYC_PIPELINE_URL   = process.env.KYC_PIPELINE_URL   ?? "http://python-kyc-pipeline:8148";
const KYC_LIVENESS_URL   = process.env.KYC_LIVENESS_URL
  ?? process.env.PYTHON_KYC_LIVENESS_URL
  ?? "http://python-kyc-liveness:8090";
const RUST_BIOMETRIC_URL = process.env.RUST_BIOMETRIC_URL
  ?? process.env.BIOMETRIC_URL
  ?? "http://rust-biometric:8149";
// CSCA store has NO implicit default: when unconfigured the NFC path reports
// an honest "unavailable" and the session continues without NFC (SPEC §6).
const CSCA_STORE_URL     = process.env.CSCA_STORE_URL ?? "";

// ── Tunables ──────────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_FRAMES = 6;
// Each frame ≤ 2 MiB decoded → base64 length ≤ ceil(2MiB/3)*4 (+ padding slack).
const MAX_FRAME_B64_LEN = 2_796_204;
// Face-match policy band (env-configured): score >= threshold → pass;
// threshold-band <= score < threshold → marginal (manual_review); below → fail.
const FACE_MATCH_THRESHOLD = Number(process.env.KYC_FACE_MATCH_THRESHOLD ?? "0.6");
const FACE_MATCH_MARGINAL_BAND = Number(process.env.KYC_FACE_MATCH_MARGINAL_BAND ?? "0.1");

const CHALLENGE_POOL = ["blink", "turnLeft", "turnRight", "smile", "jawOpen"] as const;

// ── Client event-shape normalization (R2a) ────────────────────────────────────
// PWA sends {seq, event: '<challenge-token>', timestamp};
// RN sends {seq, event: 'step_started'|'step_completed', step: '<token>', at}.
// Normalize at ingest (zod layer) so downstream ALWAYS sees:
//   event       — a CHALLENGE_POOL token, or 'frame' (informational, ignored
//                 for challenge-order matching)
//   timestampMs — epoch ms (from timestampMs | timestamp | at), or null
// Never reject these client shapes.
//
// Mapping rule (wave-15 R2a RN seam fix):
//   - raw.event === 'step_started' → ALWAYS 'frame' (informational). RN pushes
//     BOTH step_started and step_completed per step; mapping both to the step
//     token would duplicate movements and break the challenge-order check.
//   - A CHALLENGE_POOL token in raw.event passes through unchanged (PWA).
//   - Otherwise (e.g. 'step_completed'), a CHALLENGE_POOL token in raw.step
//     becomes the event.
//   - Everything else → 'frame'.
function normalizeChallengeEvent(raw: unknown): Record<string, unknown> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawEvent = typeof r.event === "string" ? r.event : null;
  const rawStep = typeof r.step === "string" ? r.step : null;
  const eventName =
    rawEvent === "step_started"
      ? "frame" // informational — never maps to the step token
      : rawEvent && (CHALLENGE_POOL as readonly string[]).includes(rawEvent)
        ? rawEvent
        : rawStep && (CHALLENGE_POOL as readonly string[]).includes(rawStep)
          ? rawStep
          : "frame"; // informational — ignored for order matching
  const ts = r.timestampMs ?? r.timestamp ?? r.at ?? null;
  let timestampMs: number | null = null;
  if (typeof ts === "number" && Number.isFinite(ts)) {
    timestampMs = ts;
  } else if (typeof ts === "string") {
    // Accept epoch-ms strings and ISO-8601 alike.
    if (ts.trim() !== "" && Number.isFinite(Number(ts))) timestampMs = Number(ts);
    else {
      const parsed = Date.parse(ts);
      timestampMs = Number.isFinite(parsed) ? parsed : null;
    }
  }
  return {
    seq: r.seq,
    event: eventName,
    payload: r.payload,
    timestampMs,
    rawEvent,
    rawStep,
  };
}

const ChallengeEventSchema = z.preprocess(
  normalizeChallengeEvent,
  z.object({
    seq: z.coerce.number().int().min(0),
    event: z.string().min(1).max(32),
    payload: z.record(z.string(), z.unknown()).optional(),
    timestampMs: z.number().nullable().optional(),
    rawEvent: z.string().nullable().optional(),
    rawStep: z.string().nullable().optional(),
  }),
);

const DocTypeEnum = z.enum([
  "passport",
  "national_id",
  "drivers_license",
  "bvn",
  "nin",
  "utility_bill",
]);

type CaptureSession = typeof kycCaptureSessions.$inferSelect;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Randomized ordered challenge of 2–4 steps drawn via crypto RNG (Fisher–Yates). */
function randomChallenge(): string[] {
  const count = 2 + randomInt(3); // 2..4 inclusive
  const pool = [...CHALLENGE_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** Timing-safe nonce comparison (both sides hex, fixed-length column). */
function nonceMatches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Fail-closed downstream call — transport/HTTP errors abort the operation. */
async function callDownstream<T>(url: string, body: unknown, timeoutMs = 60_000): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: `KYC downstream service unreachable (${url}) — step blocked (fail-closed)`,
      cause: err,
    });
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: `KYC downstream service error ${resp.status} (${url}) — step blocked (fail-closed): ${text.slice(0, 200)}`,
    });
  }
  return (await resp.json()) as T;
}

function requireDb(db: Awaited<ReturnType<typeof getDb>>): NonNullable<Awaited<ReturnType<typeof getDb>>> {
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — fail-closed" });
  }
  return db;
}

/**
 * Load + validate a capture session for the calling user.
 * Enforces ownership, nonce (timing-safe), and expiry. Expired sessions are
 * lazily transitioned to 'expired' (guarded) before the error is raised.
 */
async function loadValidSession(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  sessionId: string,
  userId: number,
  nonce: string,
): Promise<CaptureSession> {
  const [session] = await db
    .select()
    .from(kycCaptureSessions)
    .where(eq(kycCaptureSessions.id, sessionId))
    .limit(1);

  if (!session) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Capture session not found" });
  }
  if (session.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Capture session belongs to a different user" });
  }
  if (!nonceMatches(session.nonce, nonce)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Invalid session nonce" });
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    // Lazily expire (guarded: only if still open) — fail closed for the caller.
    await db
      .update(kycCaptureSessions)
      .set({ status: "expired" })
      .where(and(
        eq(kycCaptureSessions.id, session.id),
        inArray(kycCaptureSessions.status, ["issued", "in_progress"]),
      ));
    throw new TRPCError({ code: "BAD_REQUEST", message: "Capture session expired — start a new session" });
  }
  return session;
}

type Verdict = Record<string, unknown>;

/** Drizzle transaction handle (matches db.transaction callback parameter). */
type DbTx = Parameters<
  Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]
>[0];

function readVerdict(session: CaptureSession): Verdict {
  return (session.verdict && typeof session.verdict === "object"
    ? session.verdict
    : {}) as Verdict;
}

/** True when the value is a plausible base64 frame within the size guard. */
function isBoundedFrame(v: unknown): v is string {
  return typeof v === "string" && v.length >= 16 && v.length <= MAX_FRAME_B64_LEN;
}

/**
 * Defensively extract a document portrait from the pipeline response.
 * Services evolve independently, so check several likely field names at the
 * top level and inside ocr.fields / mrz before concluding none was returned.
 * Size-guarded with the same MAX_FRAME_B64_LEN bound as client frames.
 */
function extractDocumentPortrait(result: DocumentPipelineResult): string | null {
  const top = result as Record<string, unknown>;
  const ocrFields = (result.ocr?.fields ?? {}) as Record<string, unknown>;
  const mrzBlock = (result.mrz ?? {}) as Record<string, unknown>;
  const candidates: unknown[] = [
    top.portrait_base64, top.portraitBase64, top.face_image, top.faceImage,
    top.face_image_base64, top.document_portrait, top.documentPortrait,
    top.photo_base64, top.photoBase64, top.portrait,
    ocrFields.portrait_base64, ocrFields.portraitBase64, ocrFields.face_image,
    ocrFields.faceImage, ocrFields.photo_base64, ocrFields.photo, ocrFields.portrait,
    mrzBlock.portrait_base64, mrzBlock.face_image, mrzBlock.photo_base64, mrzBlock.photo,
  ];
  for (const c of candidates) {
    if (isBoundedFrame(c)) return c;
  }
  return null;
}

/**
 * Guarded kyc_lifecycle transition to 'approved' (+ history), reusing the
 * exact single-winner pattern from kycOrchestration.persistOrchestrationResult.
 * Runs inside the caller's transaction. NEVER touches users.kycTier.
 */
async function transitionLifecycleToApproved(
  tx: DbTx,
  userId: number,
  sessionId: string,
): Promise<void> {
  const now = new Date();
  const note = `capture_session=${sessionId} source=kycCapture.finalize (pre-verified badge — tier unchanged)`;

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
        stage: "approved",
        submittedAt: now,
        approvedAt: now,
        notes: note,
        updatedAt: now,
      })
      .returning({ id: kycLifecycle.id });
    await tx.insert(kycLifecycleHistory).values({
      lifecycleId: inserted.id,
      userId,
      fromStage: "not_started",
      toStage: "approved",
      reason: "Capture session verified (document + liveness + face match)",
      metadata: { captureSessionId: sessionId },
    });
    return;
  }

  if (existing.stage === "approved") return; // idempotent

  const updated = await tx
    .update(kycLifecycle)
    .set({ stage: "approved", approvedAt: now, notes: note, updatedAt: now })
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
    toStage: "approved",
    reason: "Capture session verified (document + liveness + face match)",
    metadata: { captureSessionId: sessionId },
  });
}

// ── Downstream response contracts (defensive — services evolve independently) ─
interface DocumentPipelineResult {
  ocr?: { success?: boolean; extracted?: boolean; fields?: Record<string, unknown>; model?: string; simulated?: boolean; error?: string };
  mrz?: { present?: boolean; valid?: boolean; checksum_valid?: boolean; model?: string; simulated?: boolean; error?: string };
  authenticity?: { verdict?: "low" | "medium" | "high"; risk_score?: number; signals?: Record<string, unknown>; model?: string; simulated?: boolean };
  simulated?: boolean;
}

interface LivenessValidateResult {
  passed?: boolean;
  verdict?: string; // 'pass' | 'fail'
  score?: number;
  model?: string;
  simulated?: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

interface NfcPassiveAuthResult {
  pa_valid?: boolean;
  aa_valid?: boolean;
  simulated?: boolean;
  details?: Record<string, unknown>;
  error?: string;
  // csca-store reports e.g. 'aa_not_evaluable' here when the chip supplied no
  // DG15 / AA could not be evaluated — persisted verbatim for manual review.
  errors?: string[];
  aa_status?: string;
}

interface BiometricMatchResult {
  matched?: boolean;
  similarity?: number;
  threshold?: number;
  profile_id?: string;
}

// ── User-facing router ────────────────────────────────────────────────────────
export const kycCaptureRouter = router({

  /**
   * Issue a new capture session. Expires any existing open session for the
   * user (guarded update) so there is at most ONE active session per user.
   * Rate-limited (strict) via the repo's standard rate-limit procedure.
   */
  startSession: strictRateLimitedProcedure
    .input(z.object({
      docType: DocTypeEnum,
      nfcSupported: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const db = requireDb(await getDb());

      const nonce = randomBytes(32).toString("hex"); // 64 hex chars
      const challenge = randomChallenge();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

      // Best-effort tenant attribution (column nullable; tenant GUC already
      // enforced fail-closed upstream in the middleware chain).
      let tenantId: number | null = null;
      try {
        tenantId = (await resolveTenantContext(userId)).tenantId;
      } catch {
        tenantId = null;
      }

      const session = await db.transaction(async (tx) => {
        // Single-active-session-per-user: expire any open session (guarded).
        await tx
          .update(kycCaptureSessions)
          .set({ status: "expired" })
          .where(and(
            eq(kycCaptureSessions.userId, userId),
            inArray(kycCaptureSessions.status, ["issued", "in_progress"]),
          ));

        const [row] = await tx
          .insert(kycCaptureSessions)
          .values({
            userId,
            tenantId,
            status: "issued",
            nonce,
            challenge,
            docType: input.docType,
            nfcSupported: input.nfcSupported,
            expiresAt,
          })
          .returning();
        return row;
      });

      return {
        sessionId: session.id,
        nonce,
        challenge,
        expiresAt: session.expiresAt,
      };
    }),

  /**
   * Poll a capture session's current state. Ownership-checked; the nonce is
   * never returned (only the mutating procedures require it). Server-persisted
   * biometric evidence (documentPortrait / challengeFrame) is stripped from
   * the verdict and reported as presence booleans to keep polling light.
   */
  getSession: protectedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
    }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const db = requireDb(await getDb());

      const [session] = await db
        .select()
        .from(kycCaptureSessions)
        .where(eq(kycCaptureSessions.id, input.sessionId))
        .limit(1);

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Capture session not found" });
      }
      if (session.userId !== userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Capture session belongs to a different user" });
      }

      const { documentPortrait, challengeFrame, ...verdictRest } = readVerdict(session);
      return {
        sessionId: session.id,
        status: session.status,
        verdict: {
          ...verdictRest,
          documentPortraitPresent: isBoundedFrame(documentPortrait),
          challengeFramePresent: isBoundedFrame(challengeFrame),
        },
        expiresAt: session.expiresAt,
        completedAt: session.completedAt ?? null,
        // Honest contract: capture sessions never advance the tier.
        tierAdvanced: false,
      };
    }),

  /**
   * Submit document capture frames → OCR + MRZ + authenticity.
   * Hard-fail ONLY on MRZ/checksum/OCR extraction failure; authenticity
   * verdict 'high' alone → manual_review (uncertified heuristic signal).
   */
  submitDocument: protectedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      nonce: z.string().min(32).max(64),
      docType: DocTypeEnum,
      frames: z.array(z.string().min(16).max(MAX_FRAME_B64_LEN)).min(1).max(MAX_FRAMES),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const db = requireDb(await getDb());
      const session = await loadValidSession(db, input.sessionId, userId, input.nonce);

      // Replay protection: document may be submitted exactly once — guarded
      // transition issued → in_progress is the single-winner gate.
      const claimed = await db
        .update(kycCaptureSessions)
        .set({ status: "in_progress" })
        .where(and(eq(kycCaptureSessions.id, session.id), eq(kycCaptureSessions.status, "issued")))
        .returning({ id: kycCaptureSessions.id });
      if (claimed.length !== 1) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Document already submitted or session not open (status=${session.status})`,
        });
      }

      const result = await callDownstream<DocumentPipelineResult>(
        `${KYC_PIPELINE_URL}/document/verify`,
        {
          session_id: session.id,
          user_id: userId,
          doc_type: input.docType,
          frames: input.frames,
        },
        120_000,
      );

      const ocr = result.ocr ?? {};
      const mrz = result.mrz ?? {};
      const auth = result.authenticity ?? {};
      const simulated = Boolean(result.simulated || ocr.simulated || mrz.simulated || auth.simulated);

      const ocrFailed = ocr.success === false || ocr.extracted === false;
      const mrzFailed = mrz.valid === false || mrz.checksum_valid === false;
      const mrzPass = mrz.present === true && mrz.valid === true && mrz.checksum_valid !== false;
      const authVerdict = auth.verdict ?? null;

      const hardReasons: string[] = [];
      if (ocrFailed) hardReasons.push(`OCR extraction failed${ocr.error ? `: ${ocr.error}` : ""}`);
      if (mrzFailed) hardReasons.push(`MRZ/checksum validation failed${mrz.error ? `: ${mrz.error}` : ""}`);

      const nextStatus =
        hardReasons.length > 0 ? "failed"
        : authVerdict === "high" ? "manual_review"
        : "in_progress";

      const docVerdict: Verdict = {
        docType: input.docType,
        ocrPass: !ocrFailed,
        mrzPass,
        mrzPresent: mrz.present === true,
        authenticityVerdict: authVerdict,
        authenticityRiskScore: auth.risk_score ?? null,
        simulated,
        ...(hardReasons.length > 0 ? { failureReasons: hardReasons } : {}),
        ...(authVerdict === "high" && hardReasons.length === 0
          ? { reviewReason: "authenticity heuristic verdict 'high' — uncertified signal, routed to manual review" }
          : {}),
      };

      // Persist the document portrait (when the pipeline returned one) so
      // finalize can run the face match even when the client cannot resend
      // the portrait (PWA/RN clients send only {sessionId, nonce}).
      const documentPortrait = extractDocumentPortrait(result);

      const priorVerdict = readVerdict(session);
      const mergedVerdict: Verdict = {
        ...priorVerdict,
        document: docVerdict,
        ...(documentPortrait ? { documentPortrait } : {}),
      };

      await db.transaction(async (tx) => {
        // documentAuthenticity row — only when the pipeline returned a real signal.
        if (authVerdict) {
          await tx.insert(documentAuthenticity).values({
            sessionId: session.id,
            userId,
            signals: auth.signals ?? {},
            riskScore: auth.risk_score ?? (authVerdict === "high" ? 1 : authVerdict === "medium" ? 0.5 : 0),
            verdict: authVerdict,
          });
        }

        // kycPipelineResults rows for each stage that reported.
        const rows: (typeof kycPipelineResults.$inferInsert)[] = [];
        if (result.ocr) {
          rows.push({
            userId, sessionId: session.id, stage: "ocr",
            model: ocr.model ?? null, success: !ocrFailed,
            simulated: Boolean(ocr.simulated ?? result.simulated ?? false),
            details: { fields: ocr.fields ?? null, error: ocr.error ?? null },
          });
        }
        if (result.mrz) {
          rows.push({
            userId, sessionId: session.id, stage: "mrz",
            model: mrz.model ?? null, success: !mrzFailed && mrz.present === true,
            simulated: Boolean(mrz.simulated ?? result.simulated ?? false),
            details: { present: mrz.present ?? null, valid: mrz.valid ?? null, checksumValid: mrz.checksum_valid ?? null, error: mrz.error ?? null },
          });
        }
        if (result.authenticity) {
          rows.push({
            userId, sessionId: session.id, stage: "authenticity",
            model: auth.model ?? null, success: authVerdict !== "high",
            simulated: Boolean(auth.simulated ?? result.simulated ?? false),
            score: auth.risk_score ?? null,
            details: { verdict: authVerdict, signals: auth.signals ?? null },
          });
        }
        if (rows.length > 0) await tx.insert(kycPipelineResults).values(rows);

        await tx
          .update(kycCaptureSessions)
          .set({
            status: nextStatus,
            verdict: mergedVerdict,
            ...(nextStatus === "failed" ? { completedAt: new Date() } : {}),
          })
          .where(eq(kycCaptureSessions.id, session.id));
      });

      // Response shape (residual #6): clients require ok + reason alongside
      // the existing fields. ok ⟺ the document stage passed cleanly.
      const ok = nextStatus === "in_progress";
      const reason = ok
        ? undefined
        : hardReasons.length > 0
          ? hardReasons.join("; ")
          : (docVerdict.reviewReason as string | undefined)
            ?? "document stage routed to manual review";

      return {
        sessionId: session.id,
        status: nextStatus,
        ok,
        ...(reason ? { reason } : {}),
        document: docVerdict,
        // Honest contract: capture sessions never advance the tier.
        tierAdvanced: false,
      };
    }),

  /**
   * Submit ordered liveness challenge events → python-kyc-liveness
   * /challenge/validate. Fail → session 'failed'.
   */
  submitChallengeEvents: protectedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      nonce: z.string().min(32).max(64),
      // Accepts PWA ({seq,event,timestamp}) and RN ({seq,event,step,at})
      // shapes alike — normalized in the zod layer (see normalizeChallengeEvent).
      events: z.array(ChallengeEventSchema).min(1).max(64),
      sampledFrames: z.array(z.string().max(MAX_FRAME_B64_LEN)).max(MAX_FRAMES).default([]),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const db = requireDb(await getDb());
      const session = await loadValidSession(db, input.sessionId, userId, input.nonce);

      if (session.status !== "issued" && session.status !== "in_progress") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Session not open for challenge events (status=${session.status})`,
        });
      }

      const incomingSeqs = input.events.map(e => e.seq);
      if (new Set(incomingSeqs).size !== incomingSeqs.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Duplicate seq in challenge events" });
      }
      // Seq reindexing (wave-15 R2a RN seam fix): clients number events
      // 0-based (PWA) or 1-based (RN SelfieChallengeStep). Sort by the
      // incoming seq, then REASSIGN a dense 0..n-1 sequence so the liveness
      // seq check (seqs[0]===0, strictly increasing) holds for both clients.
      // The client's original seq is preserved in payload.rawSeq for audit.
      const ordered = [...input.events]
        .sort((a, b) => a.seq - b.seq)
        .map((e, i) => ({
          ...e,
          seq: i,
          payload: { ...(e.payload ?? {}), rawSeq: e.seq },
        }));

      // Replay protection: challenge events may be submitted exactly once.
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(kycChallengeEvents)
        .where(eq(kycChallengeEvents.sessionId, session.id));
      if (count > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Challenge events already submitted for this session" });
      }

      // Persist the ordered events first (transaction), then validate.
      await db.transaction(async (tx) => {
        await tx.insert(kycChallengeEvents).values(
          ordered.map(e => ({
            sessionId: session.id,
            seq: e.seq,
            event: e.event,
            payload: {
              ...(e.payload ?? {}),
              ...(e.timestampMs != null ? { timestampMs: e.timestampMs } : {}),
              // Audit trail: keep the client's raw fields when normalization
              // rewrote the event name (e.g. RN step_completed/step tokens).
              ...(e.rawEvent && e.rawEvent !== e.event ? { rawEvent: e.rawEvent } : {}),
              ...(e.rawStep ? { rawStep: e.rawStep } : {}),
            },
          })),
        );
      });

      const result = await callDownstream<LivenessValidateResult>(
        `${KYC_LIVENESS_URL}/challenge/validate`,
        {
          session_id: session.id,
          user_id: userId,
          nonce: input.nonce,
          challenge: session.challenge,
          events: ordered.map(e => ({
            seq: e.seq, event: e.event, payload: e.payload ?? null, timestamp_ms: e.timestampMs ?? null,
          })),
          sampled_frames: input.sampledFrames,
        },
        120_000,
      );

      const livenessPass = result.passed === true || result.verdict === "pass";
      const simulated = Boolean(result.simulated);
      const priorVerdict = readVerdict(session);
      const livenessVerdict: Verdict = {
        pass: livenessPass,
        score: result.score ?? null,
        simulated,
        reason: result.reason ?? null,
      };
      // Persist the first sampled challenge frame (already size-bounded by the
      // input schema's MAX_FRAME_B64_LEN guard) so finalize can face-match even
      // when the client cannot resend frames (PWA/RN send only {sessionId, nonce}).
      const challengeFrame = input.sampledFrames.length > 0 && isBoundedFrame(input.sampledFrames[0])
        ? input.sampledFrames[0]
        : null;
      const mergedVerdict: Verdict = {
        ...priorVerdict,
        liveness: livenessVerdict,
        ...(challengeFrame ? { challengeFrame } : {}),
      };
      const nextStatus = livenessPass ? session.status === "issued" ? "in_progress" : session.status : "failed";

      await db.transaction(async (tx) => {
        await tx.insert(kycPipelineResults).values({
          userId,
          sessionId: session.id,
          stage: "liveness",
          model: result.model ?? null,
          success: livenessPass,
          simulated,
          score: result.score ?? null,
          details: { reason: result.reason ?? null, ...(result.details ?? {}) },
        });

        await tx
          .update(kycCaptureSessions)
          .set({
            status: nextStatus,
            verdict: mergedVerdict,
            ...(nextStatus === "failed" ? { completedAt: new Date() } : {}),
          })
          .where(eq(kycCaptureSessions.id, session.id));
      });

      return {
        sessionId: session.id,
        status: nextStatus,
        ok: livenessPass,
        ...(!livenessPass
          ? { reason: result.reason ?? "liveness challenge failed" }
          : {}),
        liveness: livenessVerdict,
        tierAdvanced: false,
      };
    }),

  /**
   * Optional NFC path: passive authentication via python-csca-store.
   * paValid + aaValid → NFC stage pass (MRZ-equivalent hard proof).
   * Service down/unconfigured → honest error payload; the session CONTINUES
   * without NFC (it can still verify via MRZ).
   */
  submitNfcData: protectedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      nonce: z.string().min(32).max(64),
      dg1: z.string().min(16),
      dg2Portrait: z.string().min(16),
      sod: z.string().min(16),
      aaSignature: z.string().min(16),
      // Optional AA inputs (base64): DG15 (chip public key) and the AA
      // challenge. When absent, AA may be 'not evaluable' — recorded
      // distinctly in the verdict (nfcPass stays strict pa_valid && aa_valid).
      dg15: z.string().min(16).optional(),
      aaChallenge: z.string().min(16).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const db = requireDb(await getDb());
      const session = await loadValidSession(db, input.sessionId, userId, input.nonce);

      if (session.status !== "issued" && session.status !== "in_progress") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Session not open for NFC submission (status=${session.status})`,
        });
      }

      if (!CSCA_STORE_URL) {
        return {
          sessionId: session.id,
          nfcPass: false,
          available: false,
          error: "NFC passive-auth service not configured (CSCA_STORE_URL unset) — session continues without NFC",
        };
      }

      let result: NfcPassiveAuthResult;
      try {
        result = await callDownstream<NfcPassiveAuthResult>(
          `${CSCA_STORE_URL}/nfc/passive-auth`,
          {
            session_id: session.id,
            user_id: userId,
            dg1: input.dg1,
            dg2_portrait: input.dg2Portrait,
            sod: input.sod,
            aa_signature: input.aaSignature,
            ...(input.dg15 ? { dg15: input.dg15 } : {}),
            ...(input.aaChallenge ? { aa_challenge: input.aaChallenge } : {}),
          },
          60_000,
        );
      } catch (err) {
        // Honest degradation: NFC is an optional stage — report and continue.
        return {
          sessionId: session.id,
          nfcPass: false,
          available: false,
          error: `NFC passive-auth service unreachable — session continues without NFC (${(err as Error).message})`,
        };
      }

      // Strict rule UNCHANGED: NFC pass ⟺ pa_valid && aa_valid. When AA is not
      // evaluable (chip supplied no DG15), that is recorded distinctly in the
      // verdict — never silently treated as a pass — so manual_review sees
      // "PA passed, AA not evaluable" honestly.
      const nfcPass = result.pa_valid === true && result.aa_valid === true;
      const simulated = Boolean(result.simulated);
      const serviceErrors = Array.isArray(result.errors) ? result.errors : [];
      const aaNotEvaluable =
        result.aa_valid !== true &&
        (result.aa_status === "aa_not_evaluable" ||
          result.error === "aa_not_evaluable" ||
          serviceErrors.includes("aa_not_evaluable"));
      const priorVerdict = readVerdict(session);
      const nfcVerdict: Verdict = {
        pass: nfcPass,
        paValid: result.pa_valid === true,
        aaValid: result.aa_valid === true,
        aaStatus: result.aa_valid === true
          ? "aa_valid"
          : aaNotEvaluable ? "aa_not_evaluable" : "aa_invalid",
        dg15Supplied: input.dg15 != null,
        simulated,
        errors: serviceErrors,
        ...(result.error ? { error: result.error } : {}),
        // Full service response persisted verbatim — manual review sees
        // exactly what csca-store reported (incl. aa_not_evaluable nuance).
        serviceResponse: result,
      };

      // R3a: persist the NFC DG2 portrait as documentPortrait (same key the
      // finalize stored-evidence fallback reads) when no portrait is stored
      // yet — makes the NFC path face-matchable even before the pipeline
      // emits portraits. Bounded by the existing frame-size guard.
      const nfcPortrait = isBoundedFrame(input.dg2Portrait) ? input.dg2Portrait : null;
      const storePortrait = nfcPortrait != null && !isBoundedFrame(priorVerdict.documentPortrait);

      const mergedVerdict: Verdict = {
        ...priorVerdict,
        nfc: nfcVerdict,
        ...(storePortrait ? { documentPortrait: nfcPortrait } : {}),
      };

      await db.transaction(async (tx) => {
        await tx.insert(kycPipelineResults).values({
          userId,
          sessionId: session.id,
          stage: "nfc",
          model: "csca-passive-auth",
          success: nfcPass,
          simulated,
          details: {
            paValid: result.pa_valid ?? null,
            aaValid: result.aa_valid ?? null,
            aaStatus: nfcVerdict.aaStatus,
            dg15Supplied: input.dg15 != null,
            errors: serviceErrors,
            ...(result.details ?? {}),
          },
        });
        await tx
          .update(kycCaptureSessions)
          .set({ verdict: mergedVerdict })
          .where(eq(kycCaptureSessions.id, session.id));
      });

      return { sessionId: session.id, nfcPass, available: true, nfc: nfcVerdict };
    }),

  /**
   * Finalize the session: aggregate stage verdicts.
   *   verified  ⟺ (mrz_pass OR nfc_pass) AND liveness_pass AND face_match_pass
   *               AND no simulated pipeline result was relied upon.
   *   Any hard failure → 'failed'; heuristic-only borderline (authenticity
   *   'medium', face-match score within the marginal band, missing face-match
   *   evidence) → 'manual_review'.
   * On verified: guarded kyc_lifecycle transition to 'approved' (pre-verified
   * badge) — users.kycTier is NEVER advanced here (W13 contract).
   */
  finalize: protectedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      nonce: z.string().min(32).max(64),
      // Face-match evidence: document portrait vs a challenge frame. Optional —
      // when absent, the server-persisted evidence (verdict.documentPortrait /
      // verdict.challengeFrame) is used instead; if neither exists, face_match
      // is 'not_run' and the session can at best reach manual_review
      // (never auto-verified without face match).
      docPortraitBase64: z.string().max(MAX_FRAME_B64_LEN).optional(),
      challengeFrameBase64: z.string().max(MAX_FRAME_B64_LEN).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const db = requireDb(await getDb());
      const session = await loadValidSession(db, input.sessionId, userId, input.nonce);

      // Idempotent: an already-finalized session returns its stored verdict.
      if (session.status === "verified" || session.status === "failed" || session.status === "manual_review") {
        return {
          sessionId: session.id,
          status: session.status,
          verdict: readVerdict(session),
          idempotent: true,
          tierAdvanced: false,
        };
      }
      if (session.status !== "in_progress") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Session cannot be finalized from status=${session.status} — submit a document first`,
        });
      }

      const verdict = readVerdict(session);
      const docV = (verdict.document ?? {}) as Verdict;
      const livV = (verdict.liveness ?? {}) as Verdict;
      const nfcV = (verdict.nfc ?? {}) as Verdict;

      const mrzPass = docV.mrzPass === true;
      const nfcPass = nfcV.pass === true;
      const livenessPass = livV.pass === true;
      const authVerdict = typeof docV.authenticityVerdict === "string" ? docV.authenticityVerdict : null;

      // ── Face match (K4 orchestrates rust-biometric directly) ──────────────
      let faceMatchPass = false;
      let faceMatchStatus: "pass" | "marginal" | "fail" | "not_run" = "not_run";
      let faceMatchScore: number | null = null;
      let faceMatchSimulated = false;
      let faceMatchEvidence: "client" | "stored" | "mixed" | "none" = "none";

      // Evidence resolution: client-supplied inputs take precedence; fall back
      // per-side to the server-persisted evidence captured during
      // submitDocument (verdict.documentPortrait) and submitChallengeEvents
      // (verdict.challengeFrame). PWA/RN clients send only {sessionId, nonce},
      // so the stored path is what makes face match reachable for them.
      const storedPortrait = isBoundedFrame(verdict.documentPortrait) ? verdict.documentPortrait : null;
      const storedChallengeFrame = isBoundedFrame(verdict.challengeFrame) ? verdict.challengeFrame : null;
      const docPortrait = input.docPortraitBase64 ?? storedPortrait;
      const challengeFrame = input.challengeFrameBase64 ?? storedChallengeFrame;

      if (docPortrait && challengeFrame) {
        faceMatchEvidence =
          input.docPortraitBase64 && input.challengeFrameBase64 ? "client"
          : !input.docPortraitBase64 && !input.challengeFrameBase64 ? "stored"
          : "mixed";
        // Enroll the document portrait, then match the challenge frame.
        await callDownstream(`${RUST_BIOMETRIC_URL}/biometric/enroll`, {
          user_id: userId,
          image_base64: docPortrait,
          doc_type: session.docType ?? undefined,
        });
        const match = await callDownstream<BiometricMatchResult>(
          `${RUST_BIOMETRIC_URL}/biometric/match`,
          { user_id: userId, image_base64: challengeFrame },
        );
        faceMatchScore = match.similarity ?? null;
        const threshold = FACE_MATCH_THRESHOLD;
        if (faceMatchScore != null && faceMatchScore >= threshold) {
          faceMatchPass = true;
          faceMatchStatus = "pass";
        } else if (faceMatchScore != null && faceMatchScore >= threshold - FACE_MATCH_MARGINAL_BAND) {
          faceMatchStatus = "marginal";
        } else {
          faceMatchStatus = "fail";
        }
      }

      const simulatedAnywhere =
        docV.simulated === true || livV.simulated === true || nfcV.simulated === true || faceMatchSimulated;

      // ── Decision ────────────────────────────────────────────────────────────
      const hardFailures: string[] = [];
      if (livenessPass !== true && livV.pass === false) hardFailures.push("liveness challenge failed");
      if (faceMatchStatus === "fail") hardFailures.push(`face match below threshold-band (score=${faceMatchScore})`);
      if (Array.isArray(docV.failureReasons) && docV.failureReasons.length > 0) {
        hardFailures.push(...(docV.failureReasons as string[]));
      }

      const reviewReasons: string[] = [];
      if (authVerdict === "medium") reviewReasons.push("authenticity heuristic 'medium' — uncertified signal");
      if (authVerdict === "high") reviewReasons.push("authenticity heuristic 'high' — uncertified signal");
      if (faceMatchStatus === "marginal") reviewReasons.push(`face match marginal (score=${faceMatchScore}, threshold=${FACE_MATCH_THRESHOLD})`);
      if (faceMatchStatus === "not_run") {
        // Honest reason: face match cannot run without BOTH sides of evidence,
        // from either the client inputs or the server-persisted verdict.
        const missing: string[] = [];
        if (!docPortrait) missing.push("document portrait");
        if (!challengeFrame) missing.push("challenge frame");
        reviewReasons.push(
          `face match not run — no ${missing.join(" and ")} available (neither supplied by client nor captured server-side)`,
        );
      }
      if (!mrzPass && !nfcPass) reviewReasons.push("no MRZ or NFC hard proof of document");
      if (livV.pass === undefined) reviewReasons.push("liveness not submitted");
      if (simulatedAnywhere) reviewReasons.push("simulated pipeline result present — auto-verify disabled");

      let finalStatus: "verified" | "failed" | "manual_review";
      if (hardFailures.length > 0) {
        finalStatus = "failed";
      } else if ((mrzPass || nfcPass) && livenessPass && faceMatchPass && !simulatedAnywhere) {
        finalStatus = "verified";
      } else {
        finalStatus = "manual_review";
      }

      const finalVerdict: Verdict = {
        ...verdict,
        faceMatch: {
          status: faceMatchStatus,
          score: faceMatchScore,
          threshold: FACE_MATCH_THRESHOLD,
          marginalBand: FACE_MATCH_MARGINAL_BAND,
          simulated: faceMatchSimulated,
          evidenceSource: faceMatchEvidence,
        },
        aggregate: {
          mrzPass, nfcPass, livenessPass, faceMatchPass,
          authenticityVerdict: authVerdict,
          simulated: simulatedAnywhere,
          hardFailures,
          reviewReasons,
          decidedAt: new Date().toISOString(),
        },
      };

      const now = new Date();
      await db.transaction(async (tx) => {
        // Persist face-match stage result when it ran.
        if (faceMatchStatus !== "not_run") {
          await tx.insert(kycPipelineResults).values({
            userId,
            sessionId: session.id,
            stage: "face_match",
            model: "rust-biometric",
            success: faceMatchPass,
            simulated: faceMatchSimulated,
            score: faceMatchScore,
            details: { status: faceMatchStatus, threshold: FACE_MATCH_THRESHOLD },
          });
        }

        // Guarded single-winner finalize.
        const updated = await tx
          .update(kycCaptureSessions)
          .set({ status: finalStatus, verdict: finalVerdict, completedAt: now })
          .where(and(eq(kycCaptureSessions.id, session.id), eq(kycCaptureSessions.status, "in_progress")))
          .returning({ id: kycCaptureSessions.id });
        if (updated.length !== 1) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Capture session state changed concurrently — re-fetch and retry finalize.",
          });
        }

        // Pre-verified badge: guarded lifecycle transition to 'approved'.
        // kycTier is deliberately UNTOUCHED — admin approveKyc is the only
        // tier-advance mechanism (W13 contract).
        if (finalStatus === "verified") {
          await transitionLifecycleToApproved(tx, userId, session.id);
        }
      });

      return {
        sessionId: session.id,
        status: finalStatus,
        verdict: finalVerdict,
        idempotent: false,
        // Honest contract: verification never advances the tier by itself.
        tierAdvanced: false,
        tierAdvanceNote: "Tier upgrades require admin approval of your submitted documents.",
      };
    }),
});

// ── Admin routers (registered in routers.ts near the kyc entries) ────────────

/** captureSessions.list — paginated, joined with pipeline results + authenticity. */
export const captureSessionsRouter = router({
  list: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).default(0),
      status: z.enum(["issued", "in_progress", "verified", "failed", "expired", "manual_review"]).optional(),
      userId: z.number().int().optional(),
    }))
    .query(async ({ input }) => {
      const db = requireDb(await getDb());

      const conditions = [];
      if (input.status) conditions.push(eq(kycCaptureSessions.status, input.status));
      if (input.userId != null) conditions.push(eq(kycCaptureSessions.userId, input.userId));
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const sessions = await db
        .select()
        .from(kycCaptureSessions)
        .where(where)
        .orderBy(desc(kycCaptureSessions.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(kycCaptureSessions)
        .where(where);

      const ids = sessions.map(s => s.id);
      const [results, authenticity] = ids.length > 0
        ? await Promise.all([
            db.select().from(kycPipelineResults).where(inArray(kycPipelineResults.sessionId, ids)),
            db.select().from(documentAuthenticity).where(inArray(documentAuthenticity.sessionId, ids)),
          ])
        : [[], []];

      return {
        total,
        limit: input.limit,
        offset: input.offset,
        sessions: sessions.map(s => ({
          ...s,
          // Never leak the session nonce to list views.
          nonce: undefined,
          pipelineResults: results.filter(r => r.sessionId === s.id),
          authenticity: authenticity.filter(a => a.sessionId === s.id),
        })),
      };
    }),
});

/** captureSession.detail — full session with events, pipeline results, authenticity. */
export const captureSessionRouter = router({
  detail: adminProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = requireDb(await getDb());

      const [session] = await db
        .select()
        .from(kycCaptureSessions)
        .where(eq(kycCaptureSessions.id, input.sessionId))
        .limit(1);
      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Capture session not found" });
      }

      const [events, results, authenticity] = await Promise.all([
        db.select().from(kycChallengeEvents)
          .where(eq(kycChallengeEvents.sessionId, session.id))
          .orderBy(kycChallengeEvents.seq),
        db.select().from(kycPipelineResults)
          .where(eq(kycPipelineResults.sessionId, session.id)),
        db.select().from(documentAuthenticity)
          .where(eq(documentAuthenticity.sessionId, session.id)),
      ]);

      return {
        session: { ...session, nonce: undefined }, // nonce never leaves the server
        challengeEvents: events,
        pipelineResults: results,
        authenticity,
      };
    }),
});
