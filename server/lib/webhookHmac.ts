/**
 * webhookHmac.ts — HMAC signature verification for payment rail webhooks
 *
 * Each payment rail partner signs webhook payloads with a shared secret.
 * This module verifies signatures to prevent replay attacks and forgery.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "../_core/logger.js";

/** Per-rail HMAC secrets (loaded from env, with fallback for dev) */
const WEBHOOK_SECRETS: Record<string, string> = {
  pix:      process.env.WEBHOOK_SECRET_PIX      ?? "dev-pix-secret-change-in-prod",
  upi:      process.env.WEBHOOK_SECRET_UPI      ?? "dev-upi-secret-change-in-prod",
  cips:     process.env.WEBHOOK_SECRET_CIPS     ?? "dev-cips-secret-change-in-prod",
  mojaloop: process.env.WEBHOOK_SECRET_MOJALOOP ?? "dev-mojaloop-secret-change-in-prod",
  swift:    process.env.WEBHOOK_SECRET_SWIFT    ?? "dev-swift-secret-change-in-prod",
};

/**
 * Compute HMAC-SHA256 signature for a payload.
 */
export function computeHmac(rail: string, payload: string): string {
  const secret = WEBHOOK_SECRETS[rail];
  if (!secret) throw new Error(`No HMAC secret configured for rail: ${rail}`);
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Verify HMAC signature from a webhook request.
 * Returns true if valid, false if invalid or missing.
 *
 * Checks headers: X-Webhook-Signature, X-Hub-Signature-256, X-Signature
 */
export function verifyWebhookSignature(
  rail: string,
  rawBody: string,
  headers: Record<string, string | string[] | undefined>
): boolean {
  const secret = WEBHOOK_SECRETS[rail];
  if (!secret) {
    logger.warn({ rail }, "[WebhookHMAC] No secret configured — skipping verification in dev mode");
    return true; // Allow in dev mode when no secrets are configured
  }

  // Skip verification if using dev secrets (not production)
  if (secret.startsWith("dev-")) {
    return true;
  }

  const signatureHeader =
    (headers["x-webhook-signature"] as string) ??
    (headers["x-hub-signature-256"] as string) ??
    (headers["x-signature"] as string);

  if (!signatureHeader) {
    logger.warn({ rail }, "[WebhookHMAC] Missing signature header");
    return false;
  }

  // Handle "sha256=<hex>" format (GitHub/PIX style)
  const signature = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;

  const expected = computeHmac(rail, rawBody);

  try {
    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

/** Idempotency cache: stores processed webhook IDs to prevent replay */
const processedWebhooks = new Map<string, number>();
const WEBHOOK_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if a webhook has already been processed (deduplication).
 * Returns true if this is a duplicate (already processed).
 */
export function isWebhookDuplicate(rail: string, webhookId: string): boolean {
  const key = `${rail}:${webhookId}`;
  const processed = processedWebhooks.get(key);
  if (processed && Date.now() - processed < WEBHOOK_DEDUP_WINDOW_MS) {
    logger.warn({ rail, webhookId }, "[WebhookHMAC] Duplicate webhook detected");
    return true;
  }
  processedWebhooks.set(key, Date.now());
  return false;
}

// Clean up stale dedup entries every hour
setInterval(() => {
  const cutoff = Date.now() - WEBHOOK_DEDUP_WINDOW_MS;
  processedWebhooks.forEach((ts, key) => {
    if (ts < cutoff) processedWebhooks.delete(key);
  });
}, 3_600_000);
