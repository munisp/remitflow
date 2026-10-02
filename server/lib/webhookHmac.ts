import crypto from "crypto";
import { logger } from "../_core/logger";
import { trackError } from "../middleware/businessMetrics";

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
  // wave12 G8 (B4): rail-initiated return webhooks — same fail-closed rules.
  nip: process.env.WEBHOOK_SECRET_NIP,
  mobilemoney: process.env.WEBHOOK_SECRET_MOBILEMONEY,
};

if (isProduction) {
  const missing = Object.entries(WEBHOOK_SECRETS).filter(([, v]) => !v).map(([k]) => `WEBHOOK_SECRET_${k.toUpperCase()}`);
  if (missing.length > 0) {
    throw new Error(`FATAL: webhook secrets not configured in production (fail-closed): ${missing.join(", ")}`);
  }
}

// W19-A: webhook replay-protection dedup is durably persisted in the
// webhook_processed_events table (migration 0098) with a 24h TTL via
// expires_at. The previous in-memory Map was lost on restart and diverged
// across replicas, reopening the replay window for payment webhooks.
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
 * Checks if a webhook event has already been processed (deduplication) and
 * atomically claims it if not. Uses the webhook_processed_events table with a
 * 24h window to prevent replay attacks (durable across restarts/replicas).
 *
 * FAIL-CLOSED (money path): if the dedup claim cannot be persisted (DB
 * unavailable), the event is treated as a duplicate so a payment webhook is
 * NEVER double-applied — the provider's retry will succeed once the DB is
 * back. The failure is logged and a metric emitted; never silently swallowed.
 */
export async function isWebhookDuplicate(provider: string, id: string): Promise<boolean> {
  if (!id) return false;

  const expiresAt = new Date(Date.now() + DEDUP_WINDOW_MS);
  try {
    const { requireDb } = await import("../db.js");
    const db = await requireDb();
    const { sql } = await import("drizzle-orm");
    const claimed = (await (db as any).execute(sql`
      INSERT INTO webhook_processed_events (provider, event_id, processed_at, expires_at)
      VALUES (${provider}, ${id}, NOW(), ${expiresAt})
      ON CONFLICT (provider, event_id) DO NOTHING
      RETURNING event_id
    `)) as unknown as Array<{ event_id: string }>;

    if (claimed.length === 0) {
      return true; // already processed within the window
    }

    // Opportunistic cleanup of expired rows (fail-open, observed).
    (db as any).execute(sql`DELETE FROM webhook_processed_events WHERE expires_at < NOW()`)
      .catch((err: unknown) => {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[webhookHmac] expired dedup-row cleanup failed (non-blocking)");
        trackError("persistence", "webhook_processed_events_cleanup");
      });

    return false;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), provider },
      "[webhookHmac] FAIL-CLOSED: dedup claim could not be persisted — treating event as duplicate (skipping processing)",
    );
    trackError("persistence", "webhook_processed_events_claim");
    return true;
  }
}
