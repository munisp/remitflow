/**
 * W10-C1 / SPEC-wave10 — Permify authorization client.
 *
 * Thin, fail-closed wrapper around Permify's permission-check API:
 *   POST {PERMIFY_URL}/v1/tenants/t1/permissions/check
 *   Authorization: Bearer {PERMIFY_API_KEY}
 *
 * Discipline (non-negotiable):
 *   - PERMIFY_URL / PERMIFY_API_KEY unset      → DENY (return false) + warn
 *   - HTTP error / network error / timeout     → DENY (return false) + warn
 *   - Malformed response / unknown decision    → DENY (return false) + warn
 * There is NO path that returns true unless Permify explicitly answered
 * RESULT_ALLOWED. Callers treat false as a hard authorization denial.
 *
 * Constant-time handling: the allow/deny decision is derived by a
 * timing-safe comparison against the canonical "RESULT_ALLOWED" token so
 * response parsing does not short-circuit differently for allow vs deny,
 * and every denial path runs the same structured-warn sequence.
 */
import { timingSafeEqual } from "node:crypto";
import { logger } from "./logger.js";

const PERMIFY_TIMEOUT_MS = 5_000;
const PERMIFY_TENANT = "t1";

export interface PermifyCheckInput {
  /** Permify subject, e.g. "user:42" */
  subject: string;
  /** Permify action/permission, e.g. "approve" */
  action: string;
  /** Permify entity, e.g. "approval_request:17" */
  entity: string;
}

/** Constant-time string comparison (length-safe: unequal lengths => false). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    // Run a dummy compare so the timing profile matches the equal-length path.
    timingSafeEqual(bb, bb);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

interface PermifyCheckResponse {
  can?: string;
  result?: { can?: string };
}

/**
 * Check whether `subject` may perform `action` on `entity`.
 * Returns true ONLY on an explicit Permify RESULT_ALLOWED. Every failure
 * mode returns false (fail closed) and emits a structured warning.
 */
export async function checkPermission(input: PermifyCheckInput): Promise<boolean> {
  const baseUrl = process.env.PERMIFY_URL;
  const apiKey = process.env.PERMIFY_API_KEY;

  if (!baseUrl || !apiKey) {
    logger.warn(
      { subject: input.subject, action: input.action, entity: input.entity, reason: "permify_unconfigured" },
      "[Permify] PERMIFY_URL/PERMIFY_API_KEY unset — DENY (fail closed)",
    );
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PERMIFY_TIMEOUT_MS);
  try {
    const resp = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/tenants/${PERMIFY_TENANT}/permissions/check`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        metadata: { snap_token: "", schema_version: "", depth: 20 },
        entity: { type: input.entity.split(":")[0], id: input.entity.split(":").slice(1).join(":") },
        permission: input.action,
        subject: { type: input.subject.split(":")[0], id: input.subject.split(":").slice(1).join(":") },
      }),
    });

    if (!resp.ok) {
      logger.warn(
        { subject: input.subject, action: input.action, entity: input.entity, status: resp.status, reason: "permify_http_error" },
        "[Permify] permission check HTTP error — DENY (fail closed)",
      );
      return false;
    }

    let body: PermifyCheckResponse;
    try {
      body = (await resp.json()) as PermifyCheckResponse;
    } catch (err) {
      logger.warn(
        { subject: input.subject, action: input.action, entity: input.entity, err: err instanceof Error ? err.message : String(err), reason: "permify_bad_json" },
        "[Permify] permission check returned unparseable body — DENY (fail closed)",
      );
      return false;
    }

    const decision = body.can ?? body.result?.can ?? "";
    // Constant-time decision handling — only an exact canonical ALLOW token
    // authorizes; anything else (RESULT_DENIED, empty, unknown) denies.
    const allowed = safeEqual(decision, "RESULT_ALLOWED");
    if (!allowed) {
      logger.warn(
        { subject: input.subject, action: input.action, entity: input.entity, decision: decision || "empty", reason: "permify_denied" },
        "[Permify] permission check did not return RESULT_ALLOWED — DENY",
      );
    }
    return allowed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { subject: input.subject, action: input.action, entity: input.entity, err: msg, reason: controller.signal.aborted ? "permify_timeout" : "permify_network_error" },
      "[Permify] permission check failed (network/timeout) — DENY (fail closed)",
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export default { checkPermission };
