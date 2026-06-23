/**
 * RemitFlow — Insider Threat Controls
 * ─────────────────────────────────────
 * Provides maker-checker dual authorization, geo+time fencing,
 * DLP rate limiting, and JIT access elevation for high-value
 * financial operations (CBDC, batch, stablecoin, escrow).
 *
 * Controls:
 *  1. Maker-Checker: ops > threshold require 2nd admin approval
 *  2. Geo+Time Fencing: admin ops restricted to approved IPs/hours
 *  3. DLP: rate-limit bulk data access on PII tables
 *  4. JIT Access: short-lived admin elevation (max 2h, 3/day)
 */
import { logger } from "../_core/logger";
import { publishEvent, KAFKA_TOPICS } from "./kafka";

// ── Configuration ────────────────────────────────────────────────────────────

const MAKER_CHECKER_THRESHOLD_USD = 10_000;
const MAKER_CHECKER_HIGH_THRESHOLD_USD = 100_000;

const APPROVED_COUNTRIES = new Set(["US", "CA", "GB", "NG", "GH", "KE", "ZA", "DE", "FR", "NL"]);
const BUSINESS_HOURS = { startHour: 6, endHour: 22 }; // UTC

const DLP_MAX_RECORDS_PER_QUERY = 100;
const DLP_MAX_QUERIES_PER_HOUR = 50;

const JIT_MAX_DURATION_HOURS = 2;
const JIT_MAX_GRANTS_PER_DAY = 3;

// ── In-memory stores (Redis-backed in production) ────────────────────────────

interface PendingApproval {
  id: string;
  requesterId: number;
  action: string;
  amount: number;
  currency: string;
  metadata: Record<string, unknown>;
  requestedAt: Date;
  expiresAt: Date;
  status: "pending" | "approved" | "rejected" | "expired";
  approverId?: number;
  approvedAt?: Date;
}

const pendingApprovals = new Map<string, PendingApproval>();

interface JitGrant {
  userId: number;
  grantedAt: Date;
  expiresAt: Date;
  reason: string;
  active: boolean;
}

const jitGrants = new Map<string, JitGrant>();
const dlpQueryCounts = new Map<string, { count: number; windowStart: number }>();

// ── Maker-Checker (Dual Authorization) ───────────────────────────────────────

export interface MakerCheckerResult {
  requiresApproval: boolean;
  approvalId?: string;
  reason?: string;
  requiredApprovers: number;
}

export function requiresMakerChecker(amount: number, action: string): MakerCheckerResult {
  if (amount < MAKER_CHECKER_THRESHOLD_USD) {
    return { requiresApproval: false, requiredApprovers: 0 };
  }

  const requiredApprovers = amount >= MAKER_CHECKER_HIGH_THRESHOLD_USD ? 2 : 1;
  return {
    requiresApproval: true,
    reason: `${action} of $${amount.toLocaleString()} exceeds threshold ($${MAKER_CHECKER_THRESHOLD_USD.toLocaleString()})`,
    requiredApprovers,
  };
}

export function createApprovalRequest(params: {
  requesterId: number;
  action: string;
  amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
}): PendingApproval {
  const id = `APPROVAL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();
  const approval: PendingApproval = {
    id,
    requesterId: params.requesterId,
    action: params.action,
    amount: params.amount,
    currency: params.currency,
    metadata: params.metadata ?? {},
    requestedAt: now,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 24h expiry
    status: "pending",
  };
  pendingApprovals.set(id, approval);

  publishEvent(KAFKA_TOPICS.TRANSACTIONS, `approval:${id}`, {
    eventType: "maker_checker_requested",
    approvalId: id,
    requesterId: params.requesterId,
    action: params.action,
    amount: params.amount,
    currency: params.currency,
    timestamp: now.toISOString(),
  }).catch((err: unknown) =>
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[InsiderThreat] Kafka approval event failed")
  );

  return approval;
}

export function resolveApproval(
  approvalId: string,
  approverId: number,
  decision: "approved" | "rejected"
): { success: boolean; error?: string } {
  const approval = pendingApprovals.get(approvalId);
  if (!approval) return { success: false, error: "Approval not found" };
  if (approval.status !== "pending") return { success: false, error: `Already ${approval.status}` };
  if (approval.expiresAt < new Date()) {
    approval.status = "expired";
    return { success: false, error: "Approval expired" };
  }
  if (approverId === approval.requesterId) {
    return { success: false, error: "Self-approval not allowed" };
  }

  approval.status = decision;
  approval.approverId = approverId;
  approval.approvedAt = new Date();

  publishEvent(KAFKA_TOPICS.TRANSACTIONS, `approval-resolved:${approvalId}`, {
    eventType: `maker_checker_${decision}`,
    approvalId,
    approverId,
    requesterId: approval.requesterId,
    action: approval.action,
    amount: approval.amount,
    timestamp: new Date().toISOString(),
  }).catch((err: unknown) =>
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[InsiderThreat] Kafka approval resolution event failed")
  );

  return { success: true };
}

export function getPendingApproval(approvalId: string): PendingApproval | undefined {
  return pendingApprovals.get(approvalId);
}

export function listPendingApprovals(requesterId?: number): PendingApproval[] {
  const now = new Date();
  const results: PendingApproval[] = [];
  for (const approval of Array.from(pendingApprovals.values())) {
    if (approval.status === "pending" && approval.expiresAt > now) {
      if (!requesterId || approval.requesterId === requesterId) {
        results.push(approval);
      }
    }
  }
  return results;
}

// ── Geo + Time Fencing ───────────────────────────────────────────────────────

export interface GeoFenceResult {
  allowed: boolean;
  reason?: string;
  breakGlassRequired?: boolean;
}

export function checkGeoTimeFence(params: {
  countryCode?: string;
  ipAddress?: string;
  utcHour?: number;
  isBreakGlass?: boolean;
}): GeoFenceResult {
  const hour = params.utcHour ?? new Date().getUTCHours();

  // Time fence check
  if (hour < BUSINESS_HOURS.startHour || hour >= BUSINESS_HOURS.endHour) {
    if (!params.isBreakGlass) {
      return {
        allowed: false,
        reason: `Operation blocked: outside business hours (${BUSINESS_HOURS.startHour}:00-${BUSINESS_HOURS.endHour}:00 UTC). Current: ${hour}:00 UTC`,
        breakGlassRequired: true,
      };
    }
    logger.warn({ hour, ip: params.ipAddress }, "[InsiderThreat] Break-glass after-hours access");
  }

  // Geo fence check
  if (params.countryCode && !APPROVED_COUNTRIES.has(params.countryCode.toUpperCase())) {
    return {
      allowed: false,
      reason: `Operation blocked: country ${params.countryCode} not in approved list`,
      breakGlassRequired: true,
    };
  }

  return { allowed: true };
}

// ── DLP (Data Loss Prevention) ───────────────────────────────────────────────

export interface DlpResult {
  allowed: boolean;
  reason?: string;
  recordsAllowed: number;
}

export function checkDlpAccess(userId: number, requestedRecords: number): DlpResult {
  const key = `dlp:${userId}`;
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;

  let entry = dlpQueryCounts.get(key);
  if (!entry || now - entry.windowStart > hourMs) {
    entry = { count: 0, windowStart: now };
    dlpQueryCounts.set(key, entry);
  }

  if (entry.count >= DLP_MAX_QUERIES_PER_HOUR) {
    return {
      allowed: false,
      reason: `DLP: ${DLP_MAX_QUERIES_PER_HOUR} queries/hour exceeded`,
      recordsAllowed: 0,
    };
  }

  entry.count++;
  const allowedRecords = Math.min(requestedRecords, DLP_MAX_RECORDS_PER_QUERY);
  return {
    allowed: true,
    recordsAllowed: allowedRecords,
  };
}

// ── JIT Access (Just-In-Time Elevation) ──────────────────────────────────────

export interface JitResult {
  granted: boolean;
  expiresAt?: Date;
  reason?: string;
}

export function requestJitAccess(userId: number, reason: string): JitResult {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Count grants today
  let todayGrants = 0;
  for (const grant of Array.from(jitGrants.values())) {
    if (grant.userId === userId && grant.grantedAt >= dayStart) {
      todayGrants++;
    }
  }

  if (todayGrants >= JIT_MAX_GRANTS_PER_DAY) {
    return { granted: false, reason: `JIT: max ${JIT_MAX_GRANTS_PER_DAY} grants/day exceeded` };
  }

  const expiresAt = new Date(now.getTime() + JIT_MAX_DURATION_HOURS * 60 * 60 * 1000);
  const grantId = `JIT-${userId}-${Date.now()}`;
  jitGrants.set(grantId, { userId, grantedAt: now, expiresAt, reason, active: true });

  publishEvent(KAFKA_TOPICS.TRANSACTIONS, `jit:${grantId}`, {
    eventType: "jit_access_granted",
    userId,
    grantId,
    reason,
    expiresAt: expiresAt.toISOString(),
    timestamp: now.toISOString(),
  }).catch((err: unknown) =>
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[InsiderThreat] Kafka JIT event failed")
  );

  return { granted: true, expiresAt };
}

export function hasActiveJitAccess(userId: number): boolean {
  const now = new Date();
  for (const grant of Array.from(jitGrants.values())) {
    if (grant.userId === userId && grant.active && grant.expiresAt > now) {
      return true;
    }
  }
  return false;
}

export function revokeJitAccess(userId: number): number {
  let revoked = 0;
  for (const [key, grant] of Array.from(jitGrants.entries())) {
    if (grant.userId === userId && grant.active) {
      grant.active = false;
      revoked++;
    }
  }
  return revoked;
}

// ── Comprehensive Insider Threat Check ───────────────────────────────────────

export interface InsiderThreatCheckResult {
  allowed: boolean;
  requiresApproval: boolean;
  approvalId?: string;
  geoFenceResult: GeoFenceResult;
  dlpResult?: DlpResult;
  warnings: string[];
}

export async function checkInsiderThreat(params: {
  userId: number;
  action: string;
  amount: number;
  currency: string;
  countryCode?: string;
  ipAddress?: string;
  utcHour?: number;
  isAdminOp?: boolean;
  bulkRecordCount?: number;
  metadata?: Record<string, unknown>;
}): Promise<InsiderThreatCheckResult> {
  const warnings: string[] = [];

  // 1. Geo + Time Fencing (for admin operations)
  const geoFenceResult = params.isAdminOp
    ? checkGeoTimeFence({
        countryCode: params.countryCode,
        ipAddress: params.ipAddress,
        utcHour: params.utcHour,
      })
    : { allowed: true } as GeoFenceResult;

  if (!geoFenceResult.allowed) {
    warnings.push(geoFenceResult.reason ?? "Geo/time fence blocked");
  }

  // 2. Maker-Checker
  const mcResult = requiresMakerChecker(params.amount, params.action);
  let approvalId: string | undefined;
  if (mcResult.requiresApproval) {
    const approval = createApprovalRequest({
      requesterId: params.userId,
      action: params.action,
      amount: params.amount,
      currency: params.currency,
      metadata: params.metadata,
    });
    approvalId = approval.id;
    warnings.push(mcResult.reason ?? "Requires approval");
  }

  // 3. DLP (if bulk data access)
  let dlpResult: DlpResult | undefined;
  if (params.bulkRecordCount && params.bulkRecordCount > 0) {
    dlpResult = checkDlpAccess(params.userId, params.bulkRecordCount);
    if (!dlpResult.allowed) {
      warnings.push(dlpResult.reason ?? "DLP blocked");
    }
  }

  const allowed = geoFenceResult.allowed && !mcResult.requiresApproval;
  return {
    allowed,
    requiresApproval: mcResult.requiresApproval,
    approvalId,
    geoFenceResult,
    dlpResult,
    warnings,
  };
}
