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

const GO_RATELIMIT_URL = process.env.GO_RATELIMIT_URL ?? "http://localhost:8084";
const RUST_AUDIT_URL = process.env.RUST_AUDIT_URL ?? "http://localhost:8082";
const PYTHON_COMPLIANCE_URL = process.env.PYTHON_COMPLIANCE_URL ?? "http://localhost:8083";

const SIDECAR_TIMEOUT_MS = 2000; // 2 s — never block the main request

// ── Utility ───────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = SIDECAR_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
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
 * Send an audit event to the Rust audit-log service.
 * Fire-and-forget: never throws.
 */
export async function sendAuditLog(payload: AuditLogPayload): Promise<AuditLogResult | null> {
  try {
    const res = await fetchWithTimeout(`${RUST_AUDIT_URL}/audit/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return (await res.json()) as AuditLogResult;
  } catch {
    return null;
  }
}

/**
 * Send a batch of audit events to the Rust service.
 */
export async function sendAuditBatch(payloads: AuditLogPayload[]): Promise<void> {
  try {
    await fetchWithTimeout(`${RUST_AUDIT_URL}/audit/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloads),
    });
  } catch {
    // Non-critical
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
 * Falls back to `decision: approved` if the service is unavailable.
 */
export async function runComplianceCheck(input: ComplianceCheckInput): Promise<ComplianceCheckResult> {
  const fallback: ComplianceCheckResult = {
    transferId: input.transferId,
    decision: "approved",
    rulesTriggered: [],
    riskLevel: "low",
    requiresEdd: false,
    timestamp: new Date().toISOString(),
    checksum: "",
  };
  try {
    const res = await fetchWithTimeout(`${PYTHON_COMPLIANCE_URL}/compliance/check`, {
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
    if (!res.ok) return fallback;
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
  } catch {
    return fallback;
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
 * Falls back to `decision: approve` if the service is unavailable.
 */
export async function getFraudScore(input: FraudScoreInput): Promise<FraudScoreResult> {
  const fallback: FraudScoreResult = {
    transferId: input.transferId,
    fraudScore: 0,
    riskLevel: "low",
    decision: "approve",
    factors: [],
    timestamp: new Date().toISOString(),
  };
  try {
    const res = await fetchWithTimeout(`${PYTHON_COMPLIANCE_URL}/fraud/score`, {
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
    if (!res.ok) return fallback;
    const data = await res.json();
    return {
      transferId: data.transfer_id,
      fraudScore: data.fraud_score,
      riskLevel: data.risk_level,
      decision: data.decision,
      factors: data.factors ?? [],
      timestamp: data.timestamp,
    };
  } catch {
    return fallback;
  }
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
 * Screen a name against sanctions lists via the Python service.
 */
export async function screenSanctions(input: SanctionsScreenInput): Promise<SanctionsScreenResult> {
  const fallback: SanctionsScreenResult = {
    name: input.name,
    isSanctioned: false,
    riskLevel: "low",
    action: "allow",
  };
  try {
    const res = await fetchWithTimeout(`${PYTHON_COMPLIANCE_URL}/sanctions/screen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        country: input.country,
        entity_type: input.entityType ?? "individual",
      }),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    return {
      name: data.name,
      isSanctioned: data.is_sanctioned,
      matchType: data.match_type,
      riskLevel: data.risk_level,
      action: data.action,
    };
  } catch {
    return fallback;
  }
}
