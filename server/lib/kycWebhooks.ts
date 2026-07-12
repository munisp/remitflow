/**
 * kycWebhooks.ts — Production KYC Webhook Processing
 *
 * Handles async verification callbacks from:
 *   - Onfido (document verification, facial similarity, AML)
 *   - Smile Identity (African ID verification, BVN, NIN)
 *
 * Webhook processing flow:
 *   1. Validate signature (HMAC-SHA256)
 *   2. Parse provider-specific payload
 *   3. Update verification status
 *   4. Trigger tier upgrade/downgrade
 *   5. Record compliance audit event
 *   6. Emit Kafka event for downstream consumers
 *
 * Tier Upgrade Rules:
 *   Tier 0 → 1: Email verified + basic info
 *   Tier 1 → 2: Government ID verified (document + liveness)
 *   Tier 2 → 3: Enhanced due diligence (proof of address + source of funds)
 */

import { createHmac } from "crypto";
import { logger } from "../_core/logger";
import { persistFeatureRecord, emitFeatureEvent } from "../_core/featurePersistence";
import { auditKYCVerification } from "./complianceAuditTrail";

// ── Types ───────────────────────────────────────────────────────────────────

export interface OnfidoWebhookPayload {
  payload: {
    resource_type: "check" | "report" | "workflow_run";
    action: "check.completed" | "check.started" | "check.reopened" | "report.completed" | "report.withdrawn" | "workflow_run.completed";
    object: {
      id: string;
      status: "complete" | "in_progress" | "withdrawn";
      result?: "clear" | "consider" | "unidentified";
      href: string;
      completed_at_iso8601?: string;
    };
  };
}

export interface SmileIdentityWebhookPayload {
  timestamp: string;
  signature: string;
  ResultCode: string;
  ResultText: string;
  SmileJobID: string;
  PartnerParams: {
    user_id: string;
    job_id: string;
    job_type: number;
  };
  Actions: {
    Verify_ID_Number: string;
    Return_Personal_Info: string;
    Human_Review_Compare?: string;
    Liveness_Check?: string;
    Document_Verification?: string;
    Selfie_Provided?: string;
  };
  FullData?: {
    DOB?: string;
    FullName?: string;
    IDNumber?: string;
    Photo?: string;
  };
  IsFinalResult: string;
  confidence_value?: string;
}

export interface KYCTierDecision {
  userId: number;
  previousTier: number;
  newTier: number;
  provider: string;
  checkId: string;
  reason: string;
  documentVerified: boolean;
  livenessVerified: boolean;
  amlCleared: boolean;
}

// ── Config ──────────────────────────────────────────────────────────────────

const ONFIDO_WEBHOOK_SECRET = process.env.ONFIDO_WEBHOOK_SECRET || "";
const SMILE_API_KEY = process.env.SMILE_API_KEY || "";

// ── Signature Verification ──────────────────────────────────────────────────

/**
 * Verify Onfido webhook HMAC-SHA256 signature.
 */
export function verifyOnfidoSignature(payload: string, signature: string): boolean {
  if (!ONFIDO_WEBHOOK_SECRET) {
    logger.warn("Onfido webhook secret not configured — skipping signature verification");
    return process.env.NODE_ENV !== "production"; // Allow in dev only
  }

  const expected = createHmac("sha256", ONFIDO_WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");

  return expected === signature;
}

/**
 * Verify Smile Identity webhook signature.
 */
export function verifySmileSignature(payload: string, signature: string): boolean {
  if (!SMILE_API_KEY) {
    logger.warn("Smile API key not configured — skipping signature verification");
    return process.env.NODE_ENV !== "production";
  }

  const expected = createHmac("sha256", SMILE_API_KEY)
    .update(payload)
    .digest("hex");

  return expected === signature;
}

// ── Onfido Webhook Processing ───────────────────────────────────────────────

/**
 * Process an Onfido webhook event and return tier decision.
 */
export async function processOnfidoWebhook(
  payload: OnfidoWebhookPayload,
  userId: number,
  currentTier: number,
): Promise<KYCTierDecision> {
  const { resource_type, action, object } = payload.payload;

  logger.info({ checkId: object.id, action, status: object.status, result: object.result },
    "Processing Onfido webhook");

  let documentVerified = false;
  let livenessVerified = false;
  let amlCleared = false;
  let newTier = currentTier;
  let reason = "";

  if (action === "check.completed") {
    if (object.result === "clear") {
      documentVerified = true;
      livenessVerified = true;
      amlCleared = true;
      newTier = Math.max(currentTier, 2); // Upgrade to Tier 2
      reason = "All Onfido checks passed (document + liveness + AML)";
    } else if (object.result === "consider") {
      documentVerified = true;
      livenessVerified = true;
      amlCleared = false; // AML needs manual review
      newTier = currentTier; // Hold at current tier
      reason = "Onfido checks need manual review (AML consideration)";
    } else {
      documentVerified = false;
      newTier = Math.min(currentTier, 0); // Downgrade if unidentified
      reason = `Onfido check failed: ${object.result}`;
    }
  }

  const decision: KYCTierDecision = {
    userId,
    previousTier: currentTier,
    newTier,
    provider: "onfido",
    checkId: object.id,
    reason,
    documentVerified,
    livenessVerified,
    amlCleared,
  };

  // Persist verification result
  await persistFeatureRecord("kyc_verifications", object.id, {
    id: object.id,
    userId,
    provider: "onfido",
    status: object.result || object.status,
    documentVerified,
    livenessVerified,
    amlCleared,
    previousTier: currentTier,
    newTier,
    reason,
    completedAt: object.completed_at_iso8601 || new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });

  // Record audit event
  await auditKYCVerification({
    userId,
    provider: "onfido",
    checkId: object.id,
    result: object.result === "clear" ? "approved" : object.result === "consider" ? "needs_review" : "declined",
    tier: newTier,
    jurisdiction: "GB", // Onfido is UK-based
    correlationId: object.id,
  });

  // Emit Kafka event
  emitFeatureEvent("kyc.verification", object.id, {
    event: "kyc.webhook.processed",
    userId,
    provider: "onfido",
    decision,
  });

  return decision;
}

// ── Smile Identity Webhook Processing ───────────────────────────────────────

/**
 * Process a Smile Identity webhook event and return tier decision.
 */
export async function processSmileWebhook(
  payload: SmileIdentityWebhookPayload,
  currentTier: number,
): Promise<KYCTierDecision> {
  const userId = parseInt(payload.PartnerParams.user_id, 10);
  const jobId = payload.PartnerParams.job_id;

  logger.info({ jobId, resultCode: payload.ResultCode, userId },
    "Processing Smile Identity webhook");

  const idVerified = payload.Actions.Verify_ID_Number === "Verified";
  const livenessVerified = payload.Actions.Liveness_Check === "Passed" || payload.Actions.Liveness_Check === "Verified";
  const documentVerified = payload.Actions.Document_Verification === "Passed" || idVerified;
  const humanReview = payload.Actions.Human_Review_Compare === "Passed";
  const confidence = parseFloat(payload.confidence_value || "0");

  let newTier = currentTier;
  let reason = "";
  let amlCleared = false;

  // Smile Identity result codes: 0220 = verified, 1220 = partial match
  if (payload.ResultCode === "0220" || payload.ResultCode === "0820") {
    // Full verification success
    newTier = Math.max(currentTier, 2);
    reason = "Smile Identity verification complete — ID number verified";
    amlCleared = true;
  } else if (payload.ResultCode === "1220") {
    // Partial match — needs human review
    newTier = currentTier;
    reason = `Smile Identity partial match (confidence: ${confidence}%) — manual review required`;
    amlCleared = false;
  } else {
    // Failed
    newTier = Math.min(currentTier, 0);
    reason = `Smile Identity verification failed: ${payload.ResultText}`;
    amlCleared = false;
  }

  const decision: KYCTierDecision = {
    userId,
    previousTier: currentTier,
    newTier,
    provider: "smile_identity",
    checkId: jobId,
    reason,
    documentVerified,
    livenessVerified,
    amlCleared,
  };

  // Persist verification result
  await persistFeatureRecord("kyc_verifications", jobId, {
    id: jobId,
    userId,
    provider: "smile_identity",
    status: payload.ResultCode === "0220" ? "approved" : payload.ResultCode === "1220" ? "needs_review" : "declined",
    documentVerified,
    livenessVerified,
    amlCleared,
    previousTier: currentTier,
    newTier,
    reason,
    resultCode: payload.ResultCode,
    confidence,
    completedAt: payload.timestamp,
    createdAt: new Date().toISOString(),
  });

  // Record audit event
  await auditKYCVerification({
    userId,
    provider: "smile_identity",
    checkId: jobId,
    result: payload.ResultCode === "0220" ? "approved" : payload.ResultCode === "1220" ? "needs_review" : "declined",
    tier: newTier,
    jurisdiction: "NG", // Smile Identity primarily serves Africa
    correlationId: jobId,
  });

  // Emit Kafka event
  emitFeatureEvent("kyc.verification", jobId, {
    event: "kyc.webhook.processed",
    userId,
    provider: "smile_identity",
    decision,
  });

  return decision;
}

// ── Tier Management ─────────────────────────────────────────────────────────

export interface TierLimits {
  tier: number;
  dailyLimit: number;
  monthlyLimit: number;
  singleTransactionLimit: number;
  maxBalance: number;
  currency: string;
  features: string[];
}

export const KYC_TIER_LIMITS: TierLimits[] = [
  { tier: 0, dailyLimit: 0, monthlyLimit: 0, singleTransactionLimit: 0, maxBalance: 0, currency: "USD", features: ["view_only"] },
  { tier: 1, dailyLimit: 500, monthlyLimit: 2000, singleTransactionLimit: 200, maxBalance: 5000, currency: "USD", features: ["view_only", "receive", "internal_transfer"] },
  { tier: 2, dailyLimit: 5000, monthlyLimit: 25000, singleTransactionLimit: 5000, maxBalance: 50000, currency: "USD", features: ["view_only", "receive", "internal_transfer", "send", "withdraw", "crypto_buy"] },
  { tier: 3, dailyLimit: 50000, monthlyLimit: 250000, singleTransactionLimit: 50000, maxBalance: 500000, currency: "USD", features: ["view_only", "receive", "internal_transfer", "send", "withdraw", "crypto_buy", "crypto_sell", "merchant", "batch_payout"] },
];

/**
 * Get transaction limits for a given KYC tier.
 */
export function getTierLimits(tier: number): TierLimits {
  return KYC_TIER_LIMITS[Math.min(tier, 3)] || KYC_TIER_LIMITS[0];
}

/**
 * Check if a transaction is within the user's tier limits.
 */
export function checkTierLimit(params: {
  tier: number;
  amount: number;
  dailyTotal: number;
  monthlyTotal: number;
}): { allowed: boolean; reason?: string } {
  const limits = getTierLimits(params.tier);

  if (params.amount > limits.singleTransactionLimit) {
    return { allowed: false, reason: `Amount exceeds single transaction limit (${limits.currency} ${limits.singleTransactionLimit.toLocaleString()})` };
  }
  if (params.dailyTotal + params.amount > limits.dailyLimit) {
    return { allowed: false, reason: `Would exceed daily limit (${limits.currency} ${limits.dailyLimit.toLocaleString()})` };
  }
  if (params.monthlyTotal + params.amount > limits.monthlyLimit) {
    return { allowed: false, reason: `Would exceed monthly limit (${limits.currency} ${limits.monthlyLimit.toLocaleString()})` };
  }

  return { allowed: true };
}
