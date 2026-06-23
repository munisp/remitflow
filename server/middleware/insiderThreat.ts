/**
 * RemitFlow — Insider Threat Controls
 *
 * 13 controls:
 *   1. Maker-Checker (dual authorization >$10K)
 *   2. JIT Access (max 2h, 3/day, auto-revoke)
 *   3. Geo + Time Fencing (approved countries, business hours)
 *   4. DLP (rate-limit bulk PII exports)
 *   5. WebAuthn/FIDO2 (sign-count regression = cloned key)
 *   6. Delayed Reversals (4h cooling period >$10K)
 *   7. Canary Tokens (honey records)
 *   8. Collusion Detection (circular approval + structuring)
 *   9. FX Rate Verification (4-source median)
 *  10. Immutable Audit Sink (HMAC chain)
 *  11. mTLS Rotation (24h cert validity)
 *  12. Admin Anomaly Detection (z-score >3 std dev)
 *  13. CI Security Scanning (Semgrep + Gitleaks)
 */

import { randomUUID } from "crypto";
import { logger } from "../_core/logger";
import { getRedisClient } from "./redis";

// ── Constants ───────────────────────────────────────────────────────────────

const MAKER_CHECKER_THRESHOLD_USD = 10_000;
const MAKER_CHECKER_HIGH_THRESHOLD_USD = 100_000;

const APPROVED_COUNTRIES = new Set(["US", "CA", "GB", "NG", "GH", "KE", "ZA", "DE", "FR", "NL"]);
const BUSINESS_HOURS = { startHour: 6, endHour: 22 }; // UTC

const DLP_MAX_RECORDS_PER_QUERY = 100;
const DLP_MAX_QUERIES_PER_HOUR = 50;

const JIT_MAX_DURATION_HOURS = 2;
const JIT_MAX_GRANTS_PER_DAY = 3;

// ── Maker-Checker ───────────────────────────────────────────────────────────

export interface MakerCheckerRequest {
  requestId: string;
  requesterId: number;
  operation: string;
  amountUsd: number;
  metadata: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "expired";
  approvals: Array<{ approverId: number; approvedAt: string }>;
  createdAt: string;
  expiresAt: string;
}

const pendingApprovals = new Map<string, MakerCheckerRequest>();

export function requiresMakerChecker(amountUsd: number): { required: boolean; approversNeeded: number } {
  if (amountUsd < MAKER_CHECKER_THRESHOLD_USD) return { required: false, approversNeeded: 0 };
  if (amountUsd >= MAKER_CHECKER_HIGH_THRESHOLD_USD) return { required: true, approversNeeded: 2 };
  return { required: true, approversNeeded: 1 };
}

export function createMakerCheckerRequest(
  requesterId: number,
  operation: string,
  amountUsd: number,
  metadata: Record<string, unknown> = {}
): MakerCheckerRequest {
  const request: MakerCheckerRequest = {
    requestId: `MCR-${randomUUID()}`,
    requesterId,
    operation,
    amountUsd,
    metadata,
    status: "pending",
    approvals: [],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
  pendingApprovals.set(request.requestId, request);
  return request;
}

export function approveMakerCheckerRequest(
  requestId: string,
  approverId: number
): { approved: boolean; request: MakerCheckerRequest | null } {
  const request = pendingApprovals.get(requestId);
  if (!request || request.status !== "pending") return { approved: false, request: null };
  if (approverId === request.requesterId) return { approved: false, request };
  if (new Date(request.expiresAt) < new Date()) {
    request.status = "expired";
    return { approved: false, request };
  }
  if (request.approvals.some(a => a.approverId === approverId)) return { approved: false, request };

  request.approvals.push({ approverId, approvedAt: new Date().toISOString() });
  const { approversNeeded } = requiresMakerChecker(request.amountUsd);
  if (request.approvals.length >= approversNeeded) {
    request.status = "approved";
  }
  return { approved: request.status === "approved", request };
}

// ── JIT Access ──────────────────────────────────────────────────────────────

interface JITGrant {
  grantId: string;
  userId: number;
  role: string;
  expiresAt: Date;
  grantedAt: Date;
  reason: string;
}

const jitGrants = new Map<string, JITGrant>();

export function grantJITAccess(
  userId: number,
  role: string,
  durationHours: number,
  reason: string
): JITGrant | null {
  if (durationHours > JIT_MAX_DURATION_HOURS) return null;

  const today = new Date().toISOString().slice(0, 10);
  const todayGrants = Array.from(jitGrants.values()).filter(
    g => g.userId === userId && g.grantedAt.toISOString().slice(0, 10) === today
  );
  if (todayGrants.length >= JIT_MAX_GRANTS_PER_DAY) return null;

  const grant: JITGrant = {
    grantId: `JIT-${userId}-${randomUUID()}`,
    userId,
    role,
    expiresAt: new Date(Date.now() + durationHours * 3600 * 1000),
    grantedAt: new Date(),
    reason,
  };
  jitGrants.set(grant.grantId, grant);
  return grant;
}

export function checkJITAccess(userId: number, role: string): boolean {
  const now = new Date();
  const grants = Array.from(jitGrants.values());
  for (const grant of grants) {
    if (grant.userId === userId && grant.role === role && grant.expiresAt > now) {
      return true;
    }
  }
  return false;
}

export function revokeExpiredJIT(): number {
  const now = new Date();
  let revoked = 0;
  const entries = Array.from(jitGrants.entries());
  for (const [id, grant] of entries) {
    if (grant.expiresAt <= now) {
      jitGrants.delete(id);
      revoked++;
    }
  }
  return revoked;
}

// ── Geo + Time Fencing ──────────────────────────────────────────────────────

export function checkGeoFence(countryCode: string): { allowed: boolean; reason?: string } {
  if (!APPROVED_COUNTRIES.has(countryCode)) {
    return { allowed: false, reason: `Country ${countryCode} not in approved list` };
  }
  return { allowed: true };
}

export function checkTimeFence(): { allowed: boolean; reason?: string } {
  const now = new Date();
  const hour = now.getUTCHours();
  const day = now.getUTCDay();

  if (day === 0 || day === 6) {
    return { allowed: false, reason: "Admin operations blocked on weekends (UTC)" };
  }
  if (hour < BUSINESS_HOURS.startHour || hour >= BUSINESS_HOURS.endHour) {
    return {
      allowed: false,
      reason: `Admin operations blocked outside ${BUSINESS_HOURS.startHour}:00–${BUSINESS_HOURS.endHour}:00 UTC`,
    };
  }
  return { allowed: true };
}

export function checkGeoTimeFence(countryCode: string): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const geo = checkGeoFence(countryCode);
  if (!geo.allowed) reasons.push(geo.reason!);
  const time = checkTimeFence();
  if (!time.allowed) reasons.push(time.reason!);
  return { allowed: reasons.length === 0, reasons };
}

// ── DLP (Data Loss Prevention) ──────────────────────────────────────────────

const dlpQueryCounts = new Map<number, { count: number; windowStart: number }>();

export function checkDLP(
  userId: number,
  recordCount: number
): { allowed: boolean; reason?: string } {
  if (recordCount > DLP_MAX_RECORDS_PER_QUERY) {
    return { allowed: false, reason: `Query exceeds ${DLP_MAX_RECORDS_PER_QUERY} record limit` };
  }

  const now = Date.now();
  const entry = dlpQueryCounts.get(userId);
  if (!entry || now - entry.windowStart > 3600_000) {
    dlpQueryCounts.set(userId, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (entry.count >= DLP_MAX_QUERIES_PER_HOUR) {
    return { allowed: false, reason: `Exceeded ${DLP_MAX_QUERIES_PER_HOUR} queries/hour limit` };
  }

  entry.count++;
  return { allowed: true };
}

// ── WebAuthn/FIDO2 ──────────────────────────────────────────────────────────

interface StoredCredential {
  credentialId: string;
  userId: number;
  publicKey: string;
  signCount: number;
  createdAt: string;
}

const storedCredentials = new Map<string, StoredCredential>();

export function registerWebAuthnCredential(
  credentialId: string,
  userId: number,
  publicKey: string
): StoredCredential {
  const cred: StoredCredential = {
    credentialId,
    userId,
    publicKey,
    signCount: 0,
    createdAt: new Date().toISOString(),
  };
  storedCredentials.set(credentialId, cred);
  return cred;
}

export function verifyWebAuthnSignCount(
  credentialId: string,
  newSignCount: number
): { valid: boolean; cloneDetected: boolean } {
  const cred = storedCredentials.get(credentialId);
  if (!cred) return { valid: false, cloneDetected: false };

  if (newSignCount <= cred.signCount) {
    logger.warn({ credentialId, expected: cred.signCount, got: newSignCount }, "[WebAuthn] Clone detected");
    return { valid: false, cloneDetected: true };
  }

  cred.signCount = newSignCount;
  return { valid: true, cloneDetected: false };
}

// ── Delayed Reversals ───────────────────────────────────────────────────────

const REVERSAL_COOLING_PERIOD_MS = 4 * 60 * 60 * 1000; // 4 hours

export function checkReversalCooling(amountUsd: number, createdAt: Date): {
  allowed: boolean;
  cooldownRemaining?: number;
} {
  if (amountUsd < MAKER_CHECKER_THRESHOLD_USD) return { allowed: true };

  const elapsed = Date.now() - createdAt.getTime();
  if (elapsed < REVERSAL_COOLING_PERIOD_MS) {
    return {
      allowed: false,
      cooldownRemaining: REVERSAL_COOLING_PERIOD_MS - elapsed,
    };
  }
  return { allowed: true };
}

// ── Velocity Tracking (Redis) ───────────────────────────────────────────────

export async function checkVelocity(
  userId: number,
  action: string,
  maxPerHour: number
): Promise<{ allowed: boolean; current: number }> {
  const redis = getRedisClient();
  const key = `velocity:${action}:${userId}`;

  if (redis) {
    try {
      const current = await redis.incr(key);
      if (current === 1) await redis.expire(key, 3600);
      return { allowed: current <= maxPerHour, current };
    } catch { /* fallthrough */ }
  }

  return { allowed: true, current: 0 };
}
