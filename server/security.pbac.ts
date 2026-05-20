/**
 * security.pbac.ts
 * Policy-Based Access Control (PBAC) middleware for RemitFlow.
 * Integrates with Permify for fine-grained attribute-based authorization.
 *
 * PBAC policies are defined in permify/policies/v200-gap-policies.yaml
 * and evaluated server-side before any protected procedure executes.
 */
import { TRPCError } from '@trpc/server';
import type { TrpcContext as Context } from './_core/context';

// ── Policy definitions ────────────────────────────────────────────────────────
export const POLICIES = {
  // Transfer policies
  'transfer:create': { minKycTier: 1, maxAmountUsd: 50000 },
  'transfer:create:hnw': { minKycTier: 3, minAnnualVolumeUsd: 100000 },
  'transfer:create:sme': { minKycTier: 2, requiresFormM: true },
  'transfer:create:xof': { minKycTier: 1, corridors: ['TG', 'NE', 'ML', 'BJ', 'GH'] },

  // Admin policies
  'admin:read': { roles: ['admin', 'owner'] },
  'admin:write': { roles: ['admin', 'owner'] },
  'admin:delete': { roles: ['owner'] },
  'admin:compliance': { roles: ['admin', 'owner', 'compliance_officer'] },
  'admin:correspondent': { roles: ['admin', 'owner', 'treasury'] },

  // HNW policies
  'hnw:access': { roles: ['admin', 'owner'], kycTiers: ['HNW', 'UHNW'] },
  'hnw:negotiate_fx': { roles: ['admin', 'owner', 'rm'] },

  // Compliance policies
  'compliance:view_sar': { roles: ['admin', 'owner', 'compliance_officer', 'aml_analyst'] },
  'compliance:file_sar': { roles: ['compliance_officer', 'aml_analyst'] },
  'compliance:override_limit': { roles: ['admin', 'owner', 'compliance_officer'] },

  // Agent policies
  'agent:cash_in': { roles: ['agent', 'admin', 'owner'] },
  'agent:cash_out': { roles: ['agent', 'admin', 'owner'] },
  'agent:float_topup': { roles: ['admin', 'owner', 'treasury'] },

  // Tier 1 — Business Finance
  'expense:submit': { minKycTier: 1 },
  'expense:approve': { roles: ['admin', 'owner', 'finance_manager'] },
  'contractor:submit_invoice': { minKycTier: 1 },
  'contractor:approve_payment': { roles: ['admin', 'owner', 'finance_manager'] },
  'merchant_kyb:submit': { minKycTier: 1 },
  'merchant_kyb:admin_review': { roles: ['admin', 'owner', 'compliance_officer'] },
  'payroll_tax:calculate': { minKycTier: 1 },
  'payroll_tax:file': { minKycTier: 2 },

  // Tier 2 — Trade Finance
  'business_savings:open': { minKycTier: 2 },
  'business_savings:deposit': { minKycTier: 1 },
  'business_savings:withdraw': { minKycTier: 1 },
  'bond:buy': { minKycTier: 2, maxAmountUsd: 500000 },
  'bond:sell': { minKycTier: 2 },
  'lc:open': { minKycTier: 2, maxAmountUsd: 2000000 },
  'lc:upload_doc': { minKycTier: 1 },
  'invoice_financing:apply': { minKycTier: 2 },
  'payroll_run:create': { minKycTier: 1 },
  'payroll_run:approve': { roles: ['admin', 'owner', 'finance_manager'] },
  'payroll_run:disburse': { roles: ['admin', 'owner'] },

  // Tier 3 — Advanced Products
  'embedded_payroll:issue_key': { roles: ['admin', 'owner'] },
  'embedded_payroll:revoke_key': { roles: ['admin', 'owner'] },
  'diaspora_mortgage:apply': { minKycTier: 2 },
  'credit_scoring:request': { minKycTier: 1 },
  'credit_scoring:apply': { minKycTier: 2 },
  'esg:generate': { minKycTier: 1 },
  'esg:admin_review': { roles: ['admin', 'owner', 'compliance_officer'] },
} as const;

export type PolicyKey = keyof typeof POLICIES;

// ── PBAC check function ───────────────────────────────────────────────────────
export function checkPolicy(
  ctx: Context,
  policy: PolicyKey,
  resource?: { amountUsd?: number; corridor?: string; kycTier?: number }
): void {
  const user = ctx.user;
  if (!user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  }

  const p = POLICIES[policy] as any;

  // Role check
  if (p.roles && !p.roles.includes(user.role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Policy '${policy}' requires role: ${p.roles.join(' or ')}`,
    });
  }

  // KYC tier check
  if (p.minKycTier && resource?.kycTier !== undefined) {
    if (resource.kycTier < p.minKycTier) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Policy '${policy}' requires KYC tier ${p.minKycTier} or higher`,
      });
    }
  }

  // Amount check
  if (p.maxAmountUsd && resource?.amountUsd !== undefined) {
    if (resource.amountUsd > p.maxAmountUsd) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Transfer amount exceeds policy limit of $${p.maxAmountUsd.toLocaleString()}`,
      });
    }
  }

  // Corridor check
  if (p.corridors && resource?.corridor) {
    if (!p.corridors.includes(resource.corridor)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Corridor '${resource.corridor}' not permitted under policy '${policy}'`,
      });
    }
  }
}

// ── tRPC middleware factory ───────────────────────────────────────────────────
export function pbacMiddleware(policy: PolicyKey) {
  return async ({ ctx, next }: { ctx: Context; next: () => Promise<any> }) => {
    checkPolicy(ctx, policy);
    return next();
  };
}

// ── Admin-only procedure guard ────────────────────────────────────────────────
export function requireAdmin(ctx: Context): void {
  if (!ctx.user || !['admin', 'owner'].includes(ctx.user.role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
}

// ── Owner-only procedure guard ────────────────────────────────────────────────
export function requireOwner(ctx: Context): void {
  if (!ctx.user || ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner access required' });
  }
}

// ── Compliance officer guard ──────────────────────────────────────────────────
export function requireComplianceOfficer(ctx: Context): void {
  if (!ctx.user || !['admin', 'owner', 'compliance_officer', 'aml_analyst'].includes(ctx.user.role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Compliance officer access required' });
  }
}
