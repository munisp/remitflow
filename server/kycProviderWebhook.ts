/**
 * KYC Provider Webhook Handler
 * Handles inbound webhook callbacks from Onfido, Sumsub (Sum&Substance), and Veriff.
 * Each provider uses a different signature verification scheme.
 *
 * Routes:
 *   POST /api/kyc/webhook/onfido   — Onfido HMAC-SHA256 X-SHA2-Signature
 *   POST /api/kyc/webhook/sumsub   — Sumsub HMAC-SHA256 X-Payload-Digest
 *   POST /api/kyc/webhook/veriff   — Veriff HMAC-SHA256 X-HMAC-SIGNATURE
 */

import type { Express, Request, Response } from "express";
import express from "express";
import crypto from "crypto";
import { getDb } from "./db";
import { broadcastAdminEvent, broadcastUserEvent } from "./sse.service";
import { createAuditLog } from "./db";
import { screenSanctions, runComplianceCheck } from "./_core/polyglotClient";
import { logger } from './_core/logger';

// ─── Provider Config (SEC-07: fail-closed, no default secrets) ───────────────
// A missing provider secret must REJECT all webhooks for that provider. The
// verification bypass is only available outside production behind the explicit
// ALLOW_INSECURE_WEBHOOKS=1 opt-in; in production a missing secret aborts boot.
const isProduction = process.env.NODE_ENV === "production";
const ALLOW_INSECURE_WEBHOOKS = !isProduction && process.env.ALLOW_INSECURE_WEBHOOKS === "1";

const ONFIDO_WEBHOOK_SECRET = process.env.ONFIDO_WEBHOOK_SECRET;
const SUMSUB_WEBHOOK_SECRET = process.env.SUMSUB_WEBHOOK_SECRET;
const VERIFF_WEBHOOK_SECRET = process.env.VERIFF_WEBHOOK_SECRET;

if (isProduction) {
  const missing = [
    ["ONFIDO_WEBHOOK_SECRET", ONFIDO_WEBHOOK_SECRET],
    ["SUMSUB_WEBHOOK_SECRET", SUMSUB_WEBHOOK_SECRET],
    ["VERIFF_WEBHOOK_SECRET", VERIFF_WEBHOOK_SECRET],
  ].filter(([, v]) => !v).map(([k]) => k as string);
  if (missing.length > 0) {
    throw new Error(`FATAL: KYC webhook secrets not configured in production (fail-closed): ${missing.join(", ")}`);
  }
}

// ─── Signature Verification Helpers ──────────────────────────────────────────

function verifyOnfidoSignature(rawBody: Buffer, signature: string): boolean {
  if (!ONFIDO_WEBHOOK_SECRET) return false; // fail-closed
  const expected = crypto
    .createHmac("sha256", ONFIDO_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function verifySumsubSignature(rawBody: Buffer, signature: string): boolean {
  if (!SUMSUB_WEBHOOK_SECRET) return false; // fail-closed
  const expected = crypto
    .createHmac("sha256", SUMSUB_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function verifyVeriffSignature(rawBody: Buffer, signature: string): boolean {
  if (!VERIFF_WEBHOOK_SECRET) return false; // fail-closed
  const expected = crypto
    .createHmac("sha256", VERIFF_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ─── KYC Status Mapping ───────────────────────────────────────────────────────

type KycOutcome = "approved" | "rejected" | "pending" | "resubmission_requested";

function mapOnfidoStatus(event: any): KycOutcome {
  const result = event?.payload?.object?.result ?? event?.payload?.result;
  if (result === "clear") return "approved";
  if (result === "consider" || result === "unidentified") return "rejected";
  if (result === "awaiting_applicant") return "resubmission_requested";
  return "pending";
}

function mapSumsubStatus(event: any): KycOutcome {
  const reviewResult = event?.reviewResult?.reviewAnswer;
  if (reviewResult === "GREEN") return "approved";
  if (reviewResult === "RED") return "rejected";
  if (reviewResult === "RETRY") return "resubmission_requested";
  return "pending";
}

function mapVeriffStatus(event: any): KycOutcome {
  const status = event?.verification?.status;
  if (status === "approved") return "approved";
  if (status === "declined" || status === "resubmission_requested") return "rejected";
  if (status === "review") return "pending";
  return "pending";
}

// ─── Core Handler ─────────────────────────────────────────────────────────────

async function processKycWebhook(
  provider: "onfido" | "sumsub" | "veriff",
  externalUserId: string | null,
  applicantId: string,
  outcome: KycOutcome,
  rawPayload: any,
): Promise<void> {
  const db = await getDb();
  if (!db) {
    logger.warn(`[KYC Webhook] DB unavailable — cannot process ${provider} event`);
    return;
  }

  // Find user by external ID or applicant ID stored in KYC documents
  let userId: number | null = null;
  if (externalUserId) {
    const [rows] = await db.execute(
      `SELECT user_id FROM kyc_documents WHERE extracted_data->>'$.externalId' = ? LIMIT 1`,
      [externalUserId]
    ) as any;
    userId = (rows as any[])[0]?.user_id ?? null;
  }
  if (!userId) {
    const [rows] = await db.execute(
      `SELECT user_id FROM kyc_documents WHERE extracted_data->>'$.applicantId' = ? LIMIT 1`,
      [applicantId]
    ) as any;
    userId = (rows as any[])[0]?.user_id ?? null;
  }

  // Update KYC document status
  const newDocStatus = outcome === "approved" ? "approved" : outcome === "rejected" ? "rejected" : "pending";
  if (userId) {
    await db.execute(
      `UPDATE kyc_documents SET status = ?, updated_at = NOW() WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
      [newDocStatus, userId]
    );

    // Update user KYC tier if approved
    if (outcome === "approved") {
      await db.execute(
        `UPDATE users SET kyc_tier = CASE WHEN kyc_tier IS NULL OR kyc_tier = 'tier0' THEN 'tier1' ELSE kyc_tier END, updated_at = NOW() WHERE id = ?`,
        [userId]
      );
      // ─── Post-approval AML/Sanctions screening (P1 fix) ───────────────────────────────
      // Non-blocking: run AML after responding to webhook provider
      setImmediate(async () => {
        try {
          const [userRows] = await db.execute(
            `SELECT name, email FROM users WHERE id = ? LIMIT 1`,
            [userId]
          ) as any;
          const user = (userRows as any[])[0];
          if (!user) return;
          const [sanctionsResult, complianceResult] = await Promise.allSettled([
            screenSanctions({ name: user.name ?? "" }),
            runComplianceCheck({ transferId: `kyc-${userId}-${Date.now()}`, userId: userId, amount: 0, fromCurrency: "USD", toCurrency: "USD", fromCountry: "NG", toCountry: "NG" }),
          ]);
          const sanctionsHit = sanctionsResult.status === "fulfilled" && sanctionsResult.value?.isSanctioned;
          const complianceFlag = complianceResult.status === "fulfilled" && complianceResult.value?.decision !== "approved";
          if (sanctionsHit || complianceFlag) {
            // Revert tier and flag for manual compliance review
            await db.execute(
              `UPDATE users SET kyc_tier = 'tier0', updated_at = NOW() WHERE id = ?`,
              [userId]
            );
            await createAuditLog({
              userId,
              action: "KYC_AML_FLAG",
              description: `Post-approval AML/sanctions screen flagged user — sanctions: ${sanctionsHit}, compliance: ${complianceFlag}. KYC tier reverted for manual review.`,
            });
            broadcastAdminEvent({
              type: "fraud_alert",
              payload: { userId, provider, applicantId, sanctionsHit, complianceFlag, timestamp: new Date().toISOString() },
            });
            broadcastUserEvent(userId, {
              type: "kyc_pending",
              payload: {
                provider, outcome: "pending",
                message: "Your account is under additional compliance review. Our team will contact you within 24 hours.",
              },
            });
          } else {
            await createAuditLog({
              userId,
              action: "KYC_AML_CLEAR",
              description: `Post-approval AML/sanctions screen passed — no flags detected.`,
            });
          }
        } catch (err) {
          logger.error({ err: err }, `[KYC Webhook] Post-approval AML screen error for userId=${userId}`);
        }
      });
    }

    // Audit log
    await createAuditLog({
      userId,
      action: `KYC_${outcome.toUpperCase()}_${provider.toUpperCase()}`,
      description: `KYC ${outcome} via ${provider} — applicant: ${applicantId}`,
    });

    // Broadcast SSE to admin clients
    broadcastAdminEvent({
      type: "kyc_provider_result",
      payload: {
        provider,
        userId,
        applicantId,
        outcome,
        timestamp: new Date().toISOString(),
      },
    });

    // Broadcast SSE to the user themselves
    broadcastUserEvent(userId, {
      type: outcome === "approved" ? "kyc_approved" : outcome === "rejected" ? "kyc_rejected" : "kyc_pending",
      payload: {
        provider,
        outcome,
        message:
          outcome === "approved"
            ? "Your identity verification has been approved!"
            : outcome === "rejected"
            ? "Your identity verification was not successful. Please resubmit."
            : "Your identity verification is under review.",
      },
    });
  }

  logger.info(`[KYC Webhook] ${provider} — applicantId=${applicantId} userId=${userId ?? "unknown"} outcome=${outcome}`);
}

// ─── Route Registration ───────────────────────────────────────────────────────

export function registerKycProviderWebhooks(app: Express): void {
  // Raw body parser for all KYC webhook routes (needed for HMAC verification)
  const rawBodyParser = express.raw({ type: "application/json" });

  // ── Onfido ──────────────────────────────────────────────────────────────────
  app.post("/api/kyc/webhook/onfido", rawBodyParser, async (req: Request, res: Response) => {
    const signature = (req.headers["x-sha2-signature"] as string) ?? "";
    const rawBody = req.body as Buffer;

    // SEC-07: always verify; bypass only via explicit dev-only opt-in
    if (!ALLOW_INSECURE_WEBHOOKS) {
      if (!verifyOnfidoSignature(rawBody, signature)) {
        logger.warn("[KYC Webhook] Onfido signature mismatch");
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    let event: any;
    try { event = JSON.parse(rawBody.toString()); } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    const applicantId = event?.payload?.object?.id ?? event?.payload?.applicant_id ?? "";
    const externalUserId = event?.payload?.object?.sandbox_result ?? null;
    const outcome = mapOnfidoStatus(event);

    await processKycWebhook("onfido", externalUserId, applicantId, outcome, event);
    return res.json({ received: true, provider: "onfido", outcome });
  });

  // ── Sumsub ──────────────────────────────────────────────────────────────────
  app.post("/api/kyc/webhook/sumsub", rawBodyParser, async (req: Request, res: Response) => {
    const signature = (req.headers["x-payload-digest"] as string) ?? "";
    const rawBody = req.body as Buffer;

    if (!ALLOW_INSECURE_WEBHOOKS) {
      if (!verifySumsubSignature(rawBody, signature)) {
        logger.warn("[KYC Webhook] Sumsub signature mismatch");
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    let event: any;
    try { event = JSON.parse(rawBody.toString()); } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    const applicantId = event?.applicantId ?? "";
    const externalUserId = event?.externalUserId ?? null;
    const outcome = mapSumsubStatus(event);

    await processKycWebhook("sumsub", externalUserId, applicantId, outcome, event);
    return res.json({ received: true, provider: "sumsub", outcome });
  });

  // ── Veriff ──────────────────────────────────────────────────────────────────
  app.post("/api/kyc/webhook/veriff", rawBodyParser, async (req: Request, res: Response) => {
    const signature = (req.headers["x-hmac-signature"] as string) ?? "";
    const rawBody = req.body as Buffer;

    if (!ALLOW_INSECURE_WEBHOOKS) {
      if (!verifyVeriffSignature(rawBody, signature)) {
        logger.warn("[KYC Webhook] Veriff signature mismatch");
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    let event: any;
    try { event = JSON.parse(rawBody.toString()); } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    const applicantId = event?.verification?.id ?? event?.id ?? "";
    const externalUserId = event?.verification?.vendorData ?? null;
    const outcome = mapVeriffStatus(event);

    await processKycWebhook("veriff", externalUserId, applicantId, outcome, event);
    return res.json({ received: true, provider: "veriff", outcome });
  });

  // ── Provider health check ────────────────────────────────────────────────────
  app.get("/api/kyc/webhook/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      providers: ["onfido", "sumsub", "veriff"],
      endpoints: {
        onfido: "/api/kyc/webhook/onfido",
        sumsub: "/api/kyc/webhook/sumsub",
        veriff: "/api/kyc/webhook/veriff",
      },
      configured: {
        onfido: ONFIDO_WEBHOOK_SECRET !== "onfido-dev-secret",
        sumsub: SUMSUB_WEBHOOK_SECRET !== "sumsub-dev-secret",
        veriff: VERIFF_WEBHOOK_SECRET !== "veriff-dev-secret",
      },
    });
  });

  logger.info("[KYC] Provider webhooks registered: /api/kyc/webhook/{onfido,sumsub,veriff}");
}
