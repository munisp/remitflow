import crypto from "crypto";

const WEBHOOK_SECRETS: Record<string, string> = {
  pix: process.env.WEBHOOK_SECRET_PIX ?? "dev-pix-secret",
  upi: process.env.WEBHOOK_SECRET_UPI ?? "dev-upi-secret",
  cips: process.env.WEBHOOK_SECRET_CIPS ?? "dev-cips-secret",
  mojaloop: process.env.WEBHOOK_SECRET_MOJALOOP ?? "dev-mojaloop-secret",
  swift: process.env.WEBHOOK_SECRET_SWIFT ?? "dev-swift-secret",
};

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
    return false;
  }

  // Allow unsigned payloads in dev mode (secrets prefixed dev-)
  if (secret.startsWith("dev-")) {
    return true;
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
