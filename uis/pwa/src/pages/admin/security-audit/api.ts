/**
 * Admin security audit console — typed client wrapper over the PWA tRPC client.
 *
 * Server contract (verified against audit/routers.json @ bdc-integration and
 * server/routers/securityAudit.ts — 16 procs; this console wires the 13
 * adminProcedure procs only):
 *   securityAudit.getVulnerabilityScore  (query  admin, securityAudit.ts:18)
 *     input:  none
 *     output: { score, grade, checks: VulnCheck[], summary, recommendations }
 *   securityAudit.getSecurityEvents      (query  admin, :54)
 *     input:  { limit?: 1..500 (default 100) }
 *     output: { events: SecurityEventRow[], total, byType: Record<string, number> }
 *   securityAudit.getPbacDenyEvents      (query  admin, :75)
 *     input:  { limit?: 1..500 (default 100) }
 *     output: { total, events: SiemEvent[] }   // SIEM buffer, type === "PBAC_DENY"
 *   securityAudit.getAnomalyAlerts       (query  admin, :84)
 *     input:  { limit?: 1..500 (default 100) }
 *     output: { total, events: SiemEvent[] }   // ATO/CREDENTIAL_STUFFING/BEC/VELOCITY/ROUND_TRIP
 *   securityAudit.getAllSiemEvents       (query  admin, :95)
 *     input:  { limit?: 1..1000 (default 200) }
 *     output: { total, byType: Record<string, number>, events: SiemEvent[] }
 *   securityAudit.getAuditReport         (query  admin, :124)
 *     input:  none
 *     output: AuditReport (sections + complianceStatus)
 *   securityAudit.secretsRotation        (query  admin, :221)
 *     input:  none
 *     output: { secrets: SecretRotationRow[], summary: { total, ok, warn, expired }, checkedAt }
 *   securityAudit.geoBlockStatus         (query  admin, :243)
 *     input:  none
 *     output: { blockedCountries, totalBlocked, recentBlockEvents, blockCountsByCountry, lastUpdated, feedSource }
 *   securityAudit.userLockoutStatus      (query  admin, :278)
 *     input:  none
 *     output: { lockouts: LockoutRow[], totalLockouts, activeLockouts, checkedAt }
 *   securityAudit.unlockUser             (mutation admin, :303)
 *     input:  { userId: number (int, positive) }
 *     output: { success: true, verified: true, userId }
 *   securityAudit.resetLoginAttempts     (mutation admin, :324)
 *     input:  { userId: number (int, positive) }
 *     output: { success: true, verified: true, userId }
 *   securityAudit.lockoutHistory         (query  admin, :345)
 *     input:  { userId: number (int, positive) }
 *     output: LockoutHistoryRow[]
 *   securityAudit.lockoutTrends          (query  admin, :361)
 *     input:  { days?: 7..365 (default 30) }
 *     output: { days, trends: Array<{ date: string, lockouts: number, attempts: number }> }
 *
 * NOT wired here (by design, per SPEC-wave17 C2):
 *   securityAudit.myEntitlements        (protectedProcedure — user-scope)
 *   securityAudit.requestSelfUnlock     (publicProcedure — locked-user self-service)
 *   securityAudit.verifySelfUnlock      (publicProcedure — locked-user self-service)
 *
 * TOTP step-up: the PBAC middleware reads a raw `totpCode` off the wire input
 * whenever a policy decision requires MFA and fails closed with a
 * "2FA_REQUIRED" FORBIDDEN error when the code is missing/invalid. The console
 * collects a 6-digit code via pages/bdc/TotpField.tsx and forwards it on the
 * unlockUser/resetLoginAttempts mutations when entered; zod schemas that do
 * not declare `totpCode` strip it harmlessly.
 *
 * The PWA-local AppRouter contract (types/appRouter.ts) does not declare the
 * `securityAudit` namespace, so this module casts the shared vanilla client to
 * a local structural type — the same convention as pages/admin/kyc-review/api.ts
 * and pages/bdc/api.ts.
 */
import { trpcClient } from "../../../services/trpc";

// ── getVulnerabilityScore / getAuditReport (server/middleware/security.ts:243) ──

export type VulnGrade = "A+" | "A" | "B" | "C" | "D" | "F";
export type VulnSeverity = "critical" | "high" | "medium" | "low";

export interface VulnCheck {
  name: string;
  passed: boolean;
  severity: VulnSeverity;
  description: string;
}

export interface VulnerabilityScoreResponse {
  score: number;
  grade: VulnGrade;
  checks: VulnCheck[];
  summary: {
    totalChecks: number;
    passed: number;
    failed: number;
    criticalIssues: number;
    highIssues: number;
  };
  recommendations: Array<{ check: string; severity: VulnSeverity; action: string }>;
}

export interface AuditReportSection {
  name: string;
  score: number;
  grade: string;
  checks: VulnCheck[];
}

export interface ComplianceStatusEntry {
  compliant: boolean;
  level?: string;
  notes: string;
}

export interface AuditReport {
  generatedAt: string;
  platform: string;
  overallScore: number;
  grade: string;
  sections: AuditReportSection[];
  complianceStatus: Record<string, ComplianceStatusEntry>;
}

// ── Event rows ───────────────────────────────────────────────────────────────

/** Row from middleware/security getSecurityEvents (auditLogs projection). */
export interface SecurityEventRow {
  type: string;
  ip?: string | null;
  path?: string | null;
  details?: string | null;
  timestamp?: string | Date | null;
}

/** In-memory SIEM event (server/security.attacks.ts emitSecurityEvent). */
export interface SiemEvent {
  type: string;
  severity: "low" | "medium" | "high" | "critical" | string;
  ts: number;
  userId?: number;
  ip?: string;
  path?: string;
  detail?: string;
}

// ── secretsRotation (securityAudit.ts:221) ───────────────────────────────────

export type SecretRotationStatus = "ok" | "warn" | "expired" | string;

export interface SecretRotationRow {
  name: string;
  status: SecretRotationStatus;
  ageMs: number;
  ageDays: number;
  expiresInDays: number;
}

export interface SecretsRotationResponse {
  secrets: SecretRotationRow[];
  summary: { total: number; ok: number; warn: number; expired: number };
  checkedAt: string;
}

// ── geoBlockStatus (securityAudit.ts:243) ────────────────────────────────────

export interface BlockedCountry {
  code: string;
  name: string;
  reason: string;
}

export interface GeoBlockStatusResponse {
  blockedCountries: BlockedCountry[];
  totalBlocked: number;
  recentBlockEvents: SiemEvent[];
  blockCountsByCountry: Record<string, number>;
  lastUpdated: string;
  feedSource: string;
}

// ── Lockouts (securityAudit.ts:278-366) ──────────────────────────────────────

export interface LockoutRow {
  id: number;
  userId: number;
  failedAttempts: number;
  isLocked: boolean;
  lockedAt: string | Date | null;
  lockExpiresAt: string | Date | null;
  lastFailedAt: string | Date | null;
  unlockedAt: string | Date | null;
  unlockedByAdminId: number | null;
}

export interface UserLockoutStatusResponse {
  lockouts: LockoutRow[];
  totalLockouts: number;
  activeLockouts: number;
  checkedAt: string;
}

export interface LockoutHistoryRow {
  userId: number;
  failedAttempts: number;
  lockedAt: string | null;
  lockExpiresAt: string | null;
  unlockedAt: string | null;
  unlockedByAdminId: number | null;
  updatedAt: string | null;
}

export interface LockoutTrendPoint {
  date: string;
  lockouts: number;
  attempts: number;
}

// ── Structural client ────────────────────────────────────────────────────────

export const securityAuditApi = trpcClient as unknown as {
  securityAudit: {
    getVulnerabilityScore: {
      query: () => Promise<VulnerabilityScoreResponse>;
    };
    getSecurityEvents: {
      query: (i: { limit?: number }) => Promise<{
        events: SecurityEventRow[];
        total: number;
        byType: Record<string, number>;
      }>;
    };
    getPbacDenyEvents: {
      query: (i: { limit?: number }) => Promise<{ total: number; events: SiemEvent[] }>;
    };
    getAnomalyAlerts: {
      query: (i: { limit?: number }) => Promise<{ total: number; events: SiemEvent[] }>;
    };
    getAllSiemEvents: {
      query: (i: { limit?: number }) => Promise<{
        total: number;
        byType: Record<string, number>;
        events: SiemEvent[];
      }>;
    };
    getAuditReport: {
      query: () => Promise<AuditReport>;
    };
    secretsRotation: {
      query: () => Promise<SecretsRotationResponse>;
    };
    geoBlockStatus: {
      query: () => Promise<GeoBlockStatusResponse>;
    };
    userLockoutStatus: {
      query: () => Promise<UserLockoutStatusResponse>;
    };
    unlockUser: {
      mutate: (i: {
        userId: number;
        /** Optional step-up code — consumed by PBAC middleware when MFA is required. */
        totpCode?: string;
      }) => Promise<{ success: boolean; verified: boolean; userId: number }>;
    };
    resetLoginAttempts: {
      mutate: (i: {
        userId: number;
        /** Optional step-up code — stripped by the zod schema if unused. */
        totpCode?: string;
      }) => Promise<{ success: boolean; verified: boolean; userId: number }>;
    };
    lockoutHistory: {
      query: (i: { userId: number }) => Promise<LockoutHistoryRow[]>;
    };
    lockoutTrends: {
      query: (i: { days?: number }) => Promise<{ days: number; trends: LockoutTrendPoint[] }>;
    };
  };
};

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
