/**
 * Admin insider-threat controls console — typed client wrapper over the PWA
 * tRPC client.
 *
 * Server contract (verified against audit/routers.json @ bdc-integration and
 * server/routers/insiderThreatControls.ts — 25 procs across 7 sub-routers;
 * this console wires the 12 adminProcedure procs only):
 *   insiderThreat.dashboard.overview        (query  admin, :666)
 *     input:  none
 *     output: { pendingMakerCheckerRequests, activeJITGrants, dlpBlockedEvents,
 *               pendingHighValueReversals, canaryAlertsTotal,
 *               webauthnKeysRegistered, geoTimeFenceActive, withinBusinessHours }
 *   insiderThreat.makerChecker.listPending  (query  admin, :265)
 *     input:  none
 *     output: { requests: MakerCheckerRequest[], total }
 *   insiderThreat.makerChecker.approve      (mutation admin, :222)
 *     input:  { requestId: string, mfaToken?: string }
 *     output: { approved: boolean, message: string }
 *   insiderThreat.makerChecker.reject       (mutation admin, :250)
 *     input:  { requestId: string, reason: string (5..500) }
 *     output: { rejected: true }
 *   insiderThreat.jitAccess.listActive      (query  admin, :337)
 *     input:  none
 *     output: { grants: JITAccessGrant[], total }
 *   insiderThreat.jitAccess.revoke          (mutation admin, :327)
 *     input:  { grantId: string }
 *     output: { revoked: true }
 *   insiderThreat.geoTimeFence.getConfig    (query  admin, :404)
 *     input:  none
 *     output: GeoTimeFence { allowedIPs, allowedCountries, businessHoursStart,
 *               businessHoursEnd, allowedDays, breakGlassEnabled }
 *   insiderThreat.geoTimeFence.breakGlass   (mutation admin, :383)
 *     input:  { reason: string (20..1000), incidentId?: string }
 *     output: { bypassId, expiresAt, auditNote, userId, reason }
 *   insiderThreat.dlp.getEvents             (query  admin, :478)
 *     input:  { limit?: 1..100 (default 50), blockedOnly?: boolean (default false) }
 *     output: { events: DLPEvent[], total }
 *   insiderThreat.delayedReversal.listPending (query admin, :624)
 *     input:  none
 *     output: { reversals: DelayedReversalRow[], total }
 *   insiderThreat.delayedReversal.cancel    (mutation admin, :610)
 *     input:  { reversalId: string, reason: string (min 5) }
 *     output: { cancelled: true }
 *   insiderThreat.canary.checkAlert         (query  admin, :637)
 *     input:  none
 *     output: { alerts: CanaryAlert[], total, tablesMonitored }
 *   insiderThreat.canary.triggerTest        (mutation admin, :645)
 *     input:  none
 *     output: { triggered: true, alertId }
 *
 * NOT wired here (by design — protectedProcedure user-scope, per SPEC-wave17
 * C2): makerChecker.submit / makerChecker.getStatus, jitAccess.request /
 * jitAccess.checkAccess, geoTimeFence.check, dlp.checkAccess, and all five
 * webauthn.* procs.
 *
 * TOTP step-up: the PBAC middleware reads a raw `totpCode` off the wire input
 * whenever a policy decision requires MFA and fails closed with a
 * "2FA_REQUIRED" FORBIDDEN error when the code is missing/invalid. The console
 * collects a 6-digit code via pages/bdc/TotpField.tsx on every admin mutation
 * (approve/reject, revoke, breakGlass, delayedReversal.cancel,
 * canary.triggerTest) and forwards it when entered; zod schemas that do not
 * declare `totpCode` strip it harmlessly.
 *
 * The PWA-local AppRouter contract (types/appRouter.ts) does not declare the
 * `insiderThreat` namespace, so this module casts the shared vanilla client to
 * a local structural type — the same convention as pages/admin/kyc-review/api.ts.
 */
import { trpcClient } from "../../../services/trpc";

// ── Row types (mirror server/routers/insiderThreatControls.ts:21-98) ─────────

export type MakerCheckerStatus = "pending" | "approved" | "rejected" | "expired";

export interface MakerCheckerRequest {
  id: string;
  operationType: string;
  requestedBy: number;
  requestedAt: string;
  payload: Record<string, unknown>;
  status: MakerCheckerStatus;
  approvedBy?: number;
  approvedAt?: string;
  rejectionReason?: string;
  expiresAt: string;
  riskScore: number;
  requiredApprovers: number;
  currentApprovals: number;
}

export interface JITAccessGrant {
  id: string;
  userId: number;
  privilege: string;
  grantedAt: string;
  expiresAt: string;
  grantedBy: number;
  reason: string;
  revoked: boolean;
  revokedAt?: string;
  actionsPerformed: number;
}

export interface GeoTimeFenceConfig {
  allowedIPs: string[];
  allowedCountries: string[];
  businessHoursStart: number; // UTC hour
  businessHoursEnd: number;
  allowedDays: number[]; // 0=Sunday .. 6=Saturday
  breakGlassEnabled: boolean;
}

export interface DLPEvent {
  id: string;
  userId: number;
  action: string;
  table: string;
  recordCount: number;
  timestamp: string;
  blocked: boolean;
  reason?: string;
}

export interface CanaryAlert {
  id: string;
  canaryRecordId: string;
  accessedBy: number;
  accessedAt: string;
  query: string;
  ipAddress: string;
  severity: "critical";
}

export interface DelayedReversalRow {
  id: string;
  transferRef: string;
  amount: number;
  requestedBy: number;
  requestedAt: string;
  executeAt: string;
  status: "pending" | "executed" | "cancelled";
}

export interface InsiderThreatOverview {
  pendingMakerCheckerRequests: number;
  activeJITGrants: number;
  dlpBlockedEvents: number;
  pendingHighValueReversals: number;
  canaryAlertsTotal: number;
  webauthnKeysRegistered: number;
  geoTimeFenceActive: boolean;
  withinBusinessHours: boolean;
}

export interface BreakGlassResult {
  bypassId: string;
  expiresAt: string;
  auditNote: string;
  userId: number;
  reason: string;
}

// ── Structural client ────────────────────────────────────────────────────────

export const insiderThreatApi = trpcClient as unknown as {
  insiderThreat: {
    dashboard: {
      overview: { query: () => Promise<InsiderThreatOverview> };
    };
    makerChecker: {
      listPending: {
        query: () => Promise<{ requests: MakerCheckerRequest[]; total: number }>;
      };
      approve: {
        mutate: (i: {
          requestId: string;
          mfaToken?: string;
          /** Optional step-up code — consumed by PBAC middleware when MFA is required. */
          totpCode?: string;
        }) => Promise<{ approved: boolean; message: string }>;
      };
      reject: {
        mutate: (i: {
          requestId: string;
          reason: string;
          /** Optional step-up code — stripped by the zod schema if unused. */
          totpCode?: string;
        }) => Promise<{ rejected: boolean }>;
      };
    };
    jitAccess: {
      listActive: {
        query: () => Promise<{ grants: JITAccessGrant[]; total: number }>;
      };
      revoke: {
        mutate: (i: {
          grantId: string;
          totpCode?: string;
        }) => Promise<{ revoked: boolean }>;
      };
    };
    geoTimeFence: {
      getConfig: { query: () => Promise<GeoTimeFenceConfig> };
      breakGlass: {
        mutate: (i: {
          reason: string;
          incidentId?: string;
          totpCode?: string;
        }) => Promise<BreakGlassResult>;
      };
    };
    dlp: {
      getEvents: {
        query: (i: { limit?: number; blockedOnly?: boolean }) => Promise<{
          events: DLPEvent[];
          total: number;
        }>;
      };
    };
    delayedReversal: {
      listPending: {
        query: () => Promise<{ reversals: DelayedReversalRow[]; total: number }>;
      };
      cancel: {
        mutate: (i: {
          reversalId: string;
          reason: string;
          totpCode?: string;
        }) => Promise<{ cancelled: boolean }>;
      };
    };
    canary: {
      checkAlert: {
        query: () => Promise<{ alerts: CanaryAlert[]; total: number; tablesMonitored: number }>;
      };
      triggerTest: {
        mutate: (i: { totpCode?: string }) => Promise<{ triggered: boolean; alertId: string }>;
      };
    };
  };
};

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
