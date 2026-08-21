import crypto from "crypto";

// SEC-06: fail-closed secret resolution. In production a missing
// WEBHOOK_SECRET_* must reject every webhook for that rail — never fall back
// to a known "dev-*" secret. The dev bypass (accepting unsigned webhooks when
// the secret is unset) is only available outside production AND behind the
// explicit ALLOW_INSECURE_WEBHOOKS=1 opt-in.
const isProduction = process.env.NODE_ENV === "production";
const ALLOW_INSECURE_WEBHOOKS = !isProduction && process.env.ALLOW_INSECURE_WEBHOOKS === "1";

const WEBHOOK_SECRETS: Record<string, string | undefined> = {
  pix: process.env.WEBHOOK_SECRET_PIX,
  upi: process.env.WEBHOOK_SECRET_UPI,
  cips: process.env.WEBHOOK_SECRET_CIPS,
  mojaloop: process.env.WEBHOOK_SECRET_MOJALOOP,
  swift: process.env.WEBHOOK_SECRET_SWIFT,
};

if (isProduction) {
  const missing = Object.entries(WEBHOOK_SECRETS).filter(([, v]) => !v).map(([k]) => `WEBHOOK_SECRET_${k.toUpperCase()}`);
  if (missing.length > 0) {
    throw new Error(`FATAL: webhook secrets not configured in production (fail-closed): ${missing.join(", ")}`);
  }
}

// In-memory deduplication store with 24h window
const processedWebhooks = new Map<string, number>();

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Verifies a webhook HMAC signature using timing-safe comparison.
 * Supports sha256= prefix format (GitHub/PIX style).
 */
export function verifyWebhookSignature(
  provider: string,
  payload: string | Buffer,
  headers: Record<string, string>
): boolean {
  const secret = WEBHOOK_SECRETS[provider];

  if (!secret) {
    // Fail-closed: no secret configured. The ONLY exception is an explicit
    // dev-only opt-in (ALLOW_INSECURE_WEBHOOKS=1, never honored in production).
    if (ALLOW_INSECURE_WEBHOOKS) {
      return true;
    }
    return false;
  }

  // Check multiple signature header formats
  const rawSignature =
    headers["x-webhook-signature"] ||
    headers["x-hub-signature-256"] ||
    headers["x-signature"] ||
    "";

  if (!rawSignature) {
    return false;
  }

  // Strip sha256= prefix if present
  const signature = rawSignature.startsWith("sha256=")
    ? rawSignature.slice(7)
    : rawSignature;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}

/**
 * Checks if a webhook event has already been processed (deduplication).
 * Uses a 24h window to prevent replay attacks.
 */
export function isWebhookDuplicate(provider: string, id: string): boolean {
  if (!id) return false;

  const key = `${provider}:${id}`;
  const now = Date.now();

  // Clean up expired entries
  for (const [k, timestamp] of processedWebhooks.entries()) {
    if (now - timestamp > DEDUP_WINDOW_MS) {
      processedWebhooks.delete(k);
    }
  }

  if (processedWebhooks.has(key)) {
    return true;
  }

  processedWebhooks.set(key, now);
  return false;
}
