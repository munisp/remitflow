/**
 * Admin feature flags console — typed client wrapper over the PWA tRPC client.
 *
 * Server contract (verified against audit/routers.json @ bdc-integration and
 * server/routers/featureFlags.ts — 10 procs; this console wires the 2
 * read-side protectedProcedure procs and all 6 adminProcedure mutations):
 *   featureFlags.list                  (query  protected, :85)
 *     input:  { category?: string, search?: string, tenantId?: number } | undefined
 *     output: FeatureFlagRow[]  // feature_flags row + effectiveEnabled,
 *                               // tenantOverride, userOverride overlays
 *   featureFlags.categories            (query  protected, :295)
 *     input:  none
 *     output: string[]
 *   featureFlags.toggle                (mutation admin, :173)
 *     input:  { flagId: number, enabled: boolean, rolloutPct?: 0..100 }
 *     output: { success: true, updatedAt, serverTime, verified: true }
 *   featureFlags.setTenantOverride     (mutation admin, :195)
 *     input:  { tenantId: number, flagId: number, enabled: boolean,
 *               reason?: string (max 2000), expiresAt?: string }
 *     output: { success: true, id, updatedAt, serverTime, verified: true }
 *   featureFlags.removeTenantOverride  (mutation admin, :227)
 *     input:  { tenantId: number, flagId: number }
 *     output: { success: true, updatedAt, serverTime, verified: true }
 *   featureFlags.setUserOverride       (mutation admin, :240)
 *     input:  { userId: number, flagId: number, enabled: boolean }
 *     output: { success: true, id, updatedAt, serverTime, verified: true }
 *   featureFlags.upsert                (mutation admin, :258)
 *     input:  { id?: number, key: 2..100, name: 2..255, description?: max 2000,
 *               scope?: "global"|"tenant"|"user" (default "global"),
 *               defaultEnabled?: boolean (default true),
 *               rolloutPct?: 0..100 (default 100), category?: string
 *               (default "feature"), tags?: string[] (default []) }
 *     output: { id: number }
 *   featureFlags.delete                (mutation admin, :284)
 *     input:  { id: number }
 *     output: { success: true, updatedAt, serverTime, verified: true }
 *
 * NOT wired here (user-scope readers, per SPEC-wave17 C2):
 *   featureFlags.check        (protected — single-flag gate used by user UIs)
 *   featureFlags.getNavFlags  (protected — per-user nav resolution)
 *
 * TOTP step-up: the PBAC middleware reads a raw `totpCode` off the wire input
 * whenever a policy decision requires MFA and fails closed with a
 * "2FA_REQUIRED" FORBIDDEN error when the code is missing/invalid. The console
 * collects a 6-digit code via pages/bdc/TotpField.tsx on every admin mutation
 * and forwards it when entered; zod schemas that do not declare `totpCode`
 * strip it harmlessly.
 *
 * The PWA-local AppRouter contract (types/appRouter.ts) does not declare the
 * `featureFlags` namespace, so this module casts the shared vanilla client to
 * a local structural type — the same convention as pages/admin/kyc-review/api.ts.
 */
import { trpcClient } from "../../../services/trpc";

// ── feature_flags row (drizzle/schema.ts:1222) + list() overlays (:131-136) ──

export type FeatureFlagScope = "global" | "tenant" | "user";

export interface FeatureFlagRow {
  id: number;
  key: string;
  name: string;
  description: string | null;
  scope: FeatureFlagScope | string;
  defaultEnabled: boolean;
  rolloutPct: number;
  requiredPlan: string | null;
  category: string | null;
  tags: string[] | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  /** Overlay added by featureFlags.list: user override ?? tenant override ?? default. */
  effectiveEnabled: boolean;
  /** Tenant override value when a tenantId filter was passed, else null. */
  tenantOverride: boolean | null;
  /** Current admin user's override value, else null. */
  userOverride: boolean | null;
}

export interface MutationOk {
  success: boolean;
  updatedAt: string;
  serverTime: number;
  verified: boolean;
}

// ── Structural client ────────────────────────────────────────────────────────

export const featureFlagsApi = trpcClient as unknown as {
  featureFlags: {
    list: {
      query: (i?: {
        category?: string;
        search?: string;
        tenantId?: number;
      }) => Promise<FeatureFlagRow[]>;
    };
    categories: { query: () => Promise<string[]> };
    toggle: {
      mutate: (i: {
        flagId: number;
        enabled: boolean;
        rolloutPct?: number;
        /** Optional step-up code — consumed by PBAC middleware when MFA is required. */
        totpCode?: string;
      }) => Promise<MutationOk>;
    };
    setTenantOverride: {
      mutate: (i: {
        tenantId: number;
        flagId: number;
        enabled: boolean;
        reason?: string;
        expiresAt?: string;
        totpCode?: string;
      }) => Promise<MutationOk & { id: number }>;
    };
    removeTenantOverride: {
      mutate: (i: {
        tenantId: number;
        flagId: number;
        totpCode?: string;
      }) => Promise<MutationOk>;
    };
    setUserOverride: {
      mutate: (i: {
        userId: number;
        flagId: number;
        enabled: boolean;
        totpCode?: string;
      }) => Promise<MutationOk & { id: number }>;
    };
    upsert: {
      mutate: (i: {
        id?: number;
        key: string;
        name: string;
        description?: string;
        scope?: FeatureFlagScope;
        defaultEnabled?: boolean;
        rolloutPct?: number;
        category?: string;
        tags?: string[];
        totpCode?: string;
      }) => Promise<{ id: number }>;
    };
    delete: {
      mutate: (i: { id: number; totpCode?: string }) => Promise<MutationOk>;
    };
  };
};

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
