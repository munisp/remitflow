/**
 * RemitFlow — Polyglot Microservices Client
 * ──────────────────────────────────────────
 * Typed HTTP clients for the three polyglot sidecar services:
 *
 *   Go  Rate-Limit Sidecar  → http://localhost:8084
 *   Rust Audit-Log Service  → http://localhost:8082
 *   Python Compliance Svc   → http://localhost:8083
 *
 * All calls are fire-and-forget safe: if a sidecar is unavailable,
 * the function resolves with a safe default so the main flow continues.
 */

import { context as otelContext, propagation, defaultTextMapSetter } from "@opentelemetry/api";
import { getRequestTenantContext } from "./tenantGuc";

// ── W3C trace-context + tenant propagation (W12-F) ────────────────────────────
// The polyglot sidecars already EXTRACT W3C traceparent/tracestate and
// X-Tenant-Id (Go otelMiddlewareRoute, Rust HeaderExtractor, Python
// set_tenant) but the TS outbound clients previously injected nothing, so
// cross-service traces and tenant attribution were severed here. Same
// mechanism as server/middleware/kafka.ts injectTraceContext.
// FAIL-SOFT: never throws, never blocks a money path — with no active span
// or tenant the headers are simply omitted (receivers start a root span).

/**
 * Build W3C traceparent/tracestate + X-Tenant-Id headers from the active
 * OTel context and request tenant context. Returns {} on any failure.
 */
function telemetryHeaders(): Record<string, string> {
  try {
    const carrier: Record<string, string> = {};
    propagation.inject(otelContext.active(), carrier, defaultTextMapSetter);
    const tenantId = getRequestTenantContext()?.tenantId;
    if (tenantId) carrier["X-Tenant-Id"] = tenantId;
    return carrier;
  } catch {
    return {}; // fail-soft: propagation must never break the request path
  }
}

const GO_RATELIMIT_URL = process.env.GO_RATELIMIT_URL ?? "http://localhost:8084";
const RUST_AUDIT_URL = process.env.RUST_AUDIT_URL ?? "http://localhost:8082";
const PYTHON_COMPLIANCE_URL = process.env.PYTHON_COMPLIANCE_URL ?? "http://localhost:8083";

const SIDECAR_TIMEOUT_MS = 2000; // 2 s — never block the main request

// ── Utility ───────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = SIDECAR_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Inject trace/tenant context on EVERY outbound sidecar call (W12-F).
    // Caller-supplied headers (e.g. Content-Type) win on conflict.
    const headers: Record<string, string> = {
      ...telemetryHeaders(),
      ...((options.headers ?? {}) as Record<string, string>),
    };
    return await fetch(url, { ...options, headers, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// ── Go Rate-Limit Sidecar ─────────────────────────────────────────────────────

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  resetAt: string;
  retryAfterMs: number;
}

/**
 * Check rate limit via the Go sidecar.
 * Falls back to `allowed: true` if the sidecar is unavailable.
 */
export async function checkRateLimit(
  key: string,
  limit = 60,
  windowSecs = 60
): Promise<RateLimitCheckResult> {
  try {
    const res = await fetchWithTimeout(`${GO_RATELIMIT_URL}/ratelimit/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, limit, windowSecs }),
    });
    if (!res.ok) return { allowed: true, remaining: limit, resetAt: "", retryAfterMs: 0 };
    return (await res.json()) as RateLimitCheckResult;
  } catch {
    // Sidecar unavailable — fail open (log in production)
    return { allowed: true, remaining: limit, resetAt: "", retryAfterMs: 0 };
  }
}

export interface ValidateResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate input against a named schema via the Go sidecar.
 * Falls back to `valid: true` if the sidecar is unavailable.
 */
export async function validateInput(schema: string, input: unknown): Promise<ValidateResult> {
  try {
    const res = await fetchWithTimeout(`${GO_RATELIMIT_URL}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema, input }),
    });
    if (!res.ok) return { valid: true, errors: [] };
    return (await res.json()) as ValidateResult;
  } catch {
    return { valid: true, errors: [] };
  }
}

export interface IdempotencyCheckResult {
  exists: boolean;
  result?: unknown;
}

/**
 * Check idempotency key via the Go sidecar.
 */
export async function checkIdempotency(key: string): Promise<IdempotencyCheckResult> {
  try {
    const res = await fetchWithTimeout(`${GO_RATELIMIT_URL}/idempotency/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) return { exists: false };
    return (await res.json()) as IdempotencyCheckResult;
  } catch {
    return { exists: false };
  }
}

/**
 * Store idempotency result via the Go sidecar.
 */
export async function storeIdempotency(key: string, result: unknown, ttlSecs = 86400): Promise<void> {
  try {
    await fetchWithTimeout(`${GO_RATELIMIT_URL}/idempotency/store`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, result, ttlSecs }),
    });
  } catch {
    // Non-critical — ignore
  }
}

// ── Rust Audit-Log Service ────────────────────────────────────────────────────

export interface AuditLogPayload {
  userId?: number;
  action: string;
  resource: string;
  resourceId?: string;
  ipAddress?: string;
  details?: unknown;
  severity?: "info" | "warning" | "critical";
  success?: boolean;
  errorMessage?: string;
}

export interface AuditLogResult {
  id: string;
  checksum: string;
  timestamp: string;
  status: string;
}

/**
 * Send an audit event. Wave 7 (C12): the rust-audit-service target was a
 * deleted Dockerfile-only scaffold — events posted to it vanished silently.
 * Events are now written to the local TS audit trail (auditLogs table, same
 * helper the routers use). Still fire-and-forget: never throws. Returns null
 * because there is no external service id/checksum to report — callers must
 * not expect one.
 */
export async function sendAuditLog(payload: AuditLogPayload): Promise<AuditLogResult | null> {
  try {
    if (typeof payload.userId !== "number") return null; // auditLogs.userId is NOT NULL — skip anonymous events honestly
    const { createAuditLog } = await import("../db.js");
    await createAuditLog({
      userId: payload.userId,
      action: payload.action,
      description: [
        payload.resource && `resource=${payload.resource}`,
        payload.resourceId && `id=${payload.resourceId}`,
        payload.success === false && "FAILED",
        payload.errorMessage,
      ].filter(Boolean).join(" ") || payload.action,
      ipAddress: payload.ipAddress,
      severity: payload.severity ?? "info",
      metadata: payload.details === undefined ? undefined : { details: payload.details },
    });
    return null;
  } catch {
    return null; // best-effort — audit failure must never break the request path
  }
}

/**
 * Send a batch of audit events (routed to the local TS audit trail, see sendAuditLog).
 */
export async function sendAuditBatch(payloads: AuditLogPayload[]): Promise<void> {
  for (const payload of payloads) {
    await sendAuditLog(payload);
  }
}

// ── Python Compliance Service ─────────────────────────────────────────────────

export interface ComplianceCheckInput {
  transferId: string;
  userId: number;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  fromCountry: string;
  toCountry: string;
  kycStatus?: string;
  accountAgeDays?: number;
  dailyTotalUsd?: number;
  beneficiaryName?: string;
  senderName?: string;
}

export interface ComplianceCheckResult {
  transferId: string;
  decision: "approved" | "review" | "blocked";
  rulesTriggered: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresEdd: boolean;
  blockReason?: string;
  reviewReason?: string;
  timestamp: string;
  checksum: string;
}

/**
 * Run AML/KYC compliance check via the Python service.
 * FAIL CLOSED (Wave 7 verification): any outage or non-OK response THROWS —
 * never fabricates `decision: "approved"` (consumed in the transfer.send gate).
 */
export async function runComplianceCheck(input: ComplianceCheckInput): Promise<ComplianceCheckResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${PYTHON_COMPLIANCE_URL}/compliance/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transfer_id: input.transferId,
        user_id: input.userId,
        amount: input.amount,
        from_currency: input.fromCurrency,
        to_currency: input.toCurrency,
        from_country: input.fromCountry,
        to_country: input.toCountry,
        kyc_status: input.kycStatus ?? "verified",
        account_age_days: input.accountAgeDays ?? 365,
        daily_total_usd: input.dailyTotalUsd ?? 0,
        beneficiary_name: input.beneficiaryName,
        sender_name: input.senderName,
      }),
    });
  } catch (err) {
    throw new Error(`compliance check unavailable — failing closed (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!res.ok) {
    throw new Error(`compliance check failed: HTTP ${res.status} — failing closed`);
  }
  {
    const data = await res.json();
    return {
      transferId: data.transfer_id,
      decision: data.decision,
      rulesTriggered: data.rules_triggered ?? [],
      riskLevel: data.risk_level,
      requiresEdd: data.requires_edd,
      blockReason: data.block_reason,
      reviewReason: data.review_reason,
      timestamp: data.timestamp,
      checksum: data.checksum,
    };
  }
}

export interface FraudScoreInput {
  transferId: string;
  userId: number;
  amount: number;
  fromCountry: string;
  toCountry: string;
  hourOfDay?: number;
  isNewBeneficiary?: boolean;
  isNewDevice?: boolean;
  failedAttempts24h?: number;
  kycStatus?: string;
  accountAgeDays?: number;
  ipCountry?: string;
  velocityScore?: number;
}

export interface FraudScoreResult {
  transferId: string;
  fraudScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  decision: "approve" | "review" | "block";
  factors: Array<{ factor: string; weight: number; description: string }>;
  timestamp: string;
}

/**
 * Get fraud risk score via the Python service.
 * FAIL CLOSED (Wave 7 verification): any outage or non-OK response THROWS —
 * never fabricates `decision: "approve"`.
 */
export async function getFraudScore(input: FraudScoreInput): Promise<FraudScoreResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${PYTHON_COMPLIANCE_URL}/fraud/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transfer_id: input.transferId,
        user_id: input.userId,
        amount: input.amount,
        from_country: input.fromCountry,
        to_country: input.toCountry,
        hour_of_day: input.hourOfDay ?? new Date().getHours(),
        is_new_beneficiary: input.isNewBeneficiary ?? false,
        is_new_device: input.isNewDevice ?? false,
        failed_attempts_24h: input.failedAttempts24h ?? 0,
        kyc_status: input.kycStatus ?? "verified",
        account_age_days: input.accountAgeDays ?? 365,
        ip_country: input.ipCountry,
        velocity_score: input.velocityScore ?? 0,
      }),
    });
  } catch (err) {
    throw new Error(`fraud scoring unavailable — failing closed (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!res.ok) {
    throw new Error(`fraud scoring failed: HTTP ${res.status} — failing closed`);
  }
  const data = await res.json();
  return {
    transferId: data.transfer_id,
    fraudScore: data.fraud_score,
    riskLevel: data.risk_level,
    decision: data.decision,
    factors: data.factors ?? [],
    timestamp: data.timestamp,
  };
}

export interface SanctionsScreenInput {
  name: string;
  country?: string;
  entityType?: string;
}

export interface SanctionsScreenResult {
  name: string;
  isSanctioned: boolean;
  matchType?: string;
  riskLevel: string;
  action: "allow" | "block" | "review";
}

/**
 * Screen a name against sanctions lists via the Python compliance service.
 *
 * Wave 7 verification round: this is the REAL sanctions gate in the live money
 * path (p2pInstant, globalPayroll.disburseRun, transferPipeline, transfer.send,
 * Wave-10 embeddedPayouts.requestPayout).
 * FAIL CLOSED: any outage, non-OK response, OR an HTTP 200 with a malformed
 * body (missing/invalid decision fields) THROWS — never fabricates
 * `{isSanctioned:false, riskLevel:"low", action:"allow"}`. Only an explicit,
 * well-formed negative clears. Every call site was verified to treat a throw
 * as fail-closed (embeddedPayouts, globalPayroll, p2pInstant, smeTrade,
 * kycProviderWebhook, transferPipeline, routers.ts).
 */
export async function screenSanctions(input: SanctionsScreenInput): Promise<SanctionsScreenResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${PYTHON_COMPLIANCE_URL}/sanctions/screen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        country: input.country,
        entity_type: input.entityType ?? "individual",
      }),
    });
  } catch (err) {
    throw new Error(`sanctions screening unavailable — failing closed (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!res.ok) {
    throw new Error(`sanctions screening failed: HTTP ${res.status} — failing closed`);
  }
  const data = await res.json().catch(() => null);
  // FAIL CLOSED on malformed bodies (M10): an HTTP 200 without the expected
  // decision fields is a screening ERROR, not a negative. An undefined
  // is_sanctioned previously let screening PASS on a broken response.
  if (
    data === null || typeof data !== "object" ||
    typeof (data as Record<string, unknown>).is_sanctioned !== "boolean" ||
    !["allow", "block", "review"].includes(String((data as Record<string, unknown>).action)) ||
    typeof (data as Record<string, unknown>).risk_level !== "string" ||
    (data as Record<string, unknown>).risk_level === ""
  ) {
    throw new Error("sanctions screening returned a malformed response (missing decision fields) — failing closed");
  }
  return {
    name: typeof data.name === "string" ? data.name : input.name,
    isSanctioned: data.is_sanctioned,
    matchType: typeof data.match_type === "string" ? data.match_type : undefined,
    riskLevel: data.risk_level,
    action: data.action,
  };
}
