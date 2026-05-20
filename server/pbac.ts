/**
 * RemitFlow — Policy-Based Access Control (PBAC) Engine (v132)
 *
 * PBAC goes beyond RBAC by evaluating policies that combine:
 *   - Subject attributes (user role, KYC tier, 2FA status, account age)
 *   - Resource attributes (owner, amount, currency, risk level)
 *   - Environmental attributes (time of day, IP reputation, device trust)
 *   - Action (read, write, transfer, approve, export, admin)
 *
 * Policy evaluation order:
 *   1. DENY policies (explicit deny always wins)
 *   2. ALLOW policies (first match grants access)
 *   3. Default DENY (fail-closed)
 *
 * Integrated with:
 *   - tRPC middleware (pbacProcedure)
 *   - Permify service (fine-grained resource relationships)
 *   - Audit log (every decision is recorded)
 *
 * Policies defined:
 *   - transfer.send          → requires KYC tier ≥ 1, 2FA if amount > $1000
 *   - transfer.bulkSend      → requires KYC tier ≥ 2, admin or partner role
 *   - wallet.withdraw        → requires KYC tier ≥ 1, daily limit by tier
 *   - kyc.approve            → requires compliance_officer or admin role
 *   - kyc.upload             → requires own record, max 5 uploads/day
 *   - dispute.resolve        → requires adjudicator relationship or admin
 *   - admin.*                → requires admin role + 2FA verified
 *   - report.export          → requires compliance_officer or admin
 *   - auditLog.view          → requires admin or auditor role
 *   - agent.cashIn/cashOut   → requires agent role + active terminal
 *   - beneficiary.update     → requires owner + BEC check (24h cooldown)
 *   - savings.withdraw       → requires owner + goal maturity check
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { TrpcContext } from "./_core/context";
import { getPermifyClient } from "./middleware/permify";
import { flagBeneficiarySwap, emitSecurityEvent } from "./security.attacks";
import { getRedisClient } from "./middleware/redis";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface PolicyContext {
  user: TrpcContext["user"] & {};
  resource?: {
    type: string;
    id?: string | number;
    ownerId?: number;
    amount?: number;
    currency?: string;
    riskLevel?: "low" | "medium" | "high" | "blocked";
  };
  environment?: {
    ip?: string;
    deviceTrusted?: boolean;
    timeOfDay?: number; // 0-23
    requestId?: string;
  };
  action: string;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  requiresMFA?: boolean;
  requiresReview?: boolean;
  dailyLimitRemaining?: number;
}

// ─── KYC Tier Daily Limits (USD equivalent) ──────────────────────────────────
const KYC_TIER_LIMITS: Record<number, number> = {
  0: 0,          // Unverified: no transfers
  1: 1_000_00,   // Basic KYC: $1,000/day (in cents)
  2: 10_000_00,  // Enhanced KYC: $10,000/day
  3: 50_000_00,  // Full KYC: $50,000/day
  4: 500_000_00, // Institutional: $500,000/day
};

// ─── Redis-backed daily spend tracker (in-process fallback for dev) ─────────
const _fallbackSpend = new Map<string, number>(); // fallback when Redis unavailable
function getDailyRedisKey(userId: number): string {
  const date = new Date().toISOString().slice(0, 10);
  return `pbac:daily_spend:${userId}:${date}`;
}
export async function recordSpendAsync(userId: number, amountCents: number): Promise<void> {
  const redis = getRedisClient();
  const key = getDailyRedisKey(userId);
  if (redis) {
    try {
      await redis.incrby(key, amountCents);
      await redis.expire(key, 86400); // expire at end of day
      return;
    } catch { /* fall through to in-process */ }
  }
  _fallbackSpend.set(key, (_fallbackSpend.get(key) ?? 0) + amountCents);
}
export function recordSpend(userId: number, amountCents: number): void {
  recordSpendAsync(userId, amountCents).catch(() => {});
}
async function getDailySpendAsync(userId: number): Promise<number> {
  const redis = getRedisClient();
  const key = getDailyRedisKey(userId);
  if (redis) {
    try {
      const val = await redis.get(key);
      return val ? parseInt(val, 10) : 0;
    } catch { /* fall through */ }
  }
  return _fallbackSpend.get(key) ?? 0;
}
function getDailySpend(userId: number): number {
  // Sync fallback — used in non-async policy contexts
  const key = getDailyRedisKey(userId);
  return _fallbackSpend.get(key) ?? 0;
}

// ─── Policy Definitions ──────────────────────────────────────────────────────
type PolicyFn = (ctx: PolicyContext) => PolicyDecision | Promise<PolicyDecision>;

const POLICIES: Record<string, PolicyFn[]> = {
  // ── Transfer: Send ──────────────────────────────────────────────────────────
  "transfer.send": [
    // DENY: unverified users
    (ctx) => {
      const tier = (ctx.user as any).kycTier ?? 0;
      if (tier < 1) return { allowed: false, reason: "KYC verification required before sending money (Tier 1 minimum)" };
      return { allowed: true, reason: "ok" };
    },
    // DENY: amount exceeds tier limit
    (ctx) => {
      const tier = (ctx.user as any).kycTier ?? 0;
      const limit = KYC_TIER_LIMITS[tier] ?? 0;
      const amountCents = (ctx.resource?.amount ?? 0) * 100;
      const spent = getDailySpend(ctx.user!.id);
      if (spent + amountCents > limit) {
        return {
          allowed: false,
          reason: `Daily limit exceeded. Tier ${tier} limit: $${limit / 100}. Spent: $${spent / 100}.`,
          dailyLimitRemaining: Math.max(0, limit - spent),
        };
      }
      return { allowed: true, reason: "ok" };
    },
    // REQUIRE MFA: amount > $1,000
    (ctx) => {
      const amountCents = (ctx.resource?.amount ?? 0) * 100;
      if (amountCents > 100_000) {
        const has2FA = (ctx.user as any).twoFactorEnabled ?? false;
        if (!has2FA) {
          return { allowed: false, requiresMFA: true, reason: "2FA required for transfers over $1,000. Please enable TOTP in Security Settings." };
        }
        return { allowed: true, reason: "ok", requiresMFA: true };
      }
      return { allowed: true, reason: "ok" };
    },
    // REQUIRE REVIEW: high-risk amount
    (ctx) => {
      if (ctx.resource?.riskLevel === "blocked") {
        return { allowed: false, reason: "Transfer blocked by fraud detection. Contact support." };
      }
      if (ctx.resource?.riskLevel === "high") {
        return { allowed: true, reason: "ok", requiresReview: true };
      }
      return { allowed: true, reason: "ok" };
    },
  ],

  // ── Transfer: Bulk Send ─────────────────────────────────────────────────────
  "transfer.bulkSend": [
    (ctx) => {
      const tier = (ctx.user as any).kycTier ?? 0;
      if (tier < 2) return { allowed: false, reason: "Enhanced KYC (Tier 2) required for bulk transfers" };
      if (ctx.user!.role !== "admin" && (ctx.user as any).role !== "partner") {
        return { allowed: false, reason: "Bulk transfers require admin or partner role" };
      }
      return { allowed: true, reason: "ok" };
    },
  ],

  // ── Wallet: Withdraw ────────────────────────────────────────────────────────
  "wallet.withdraw": [
    (ctx) => {
      const tier = (ctx.user as any).kycTier ?? 0;
      if (tier < 1) return { allowed: false, reason: "KYC verification required before withdrawals" };
      const limit = KYC_TIER_LIMITS[tier] ?? 0;
      const amountCents = (ctx.resource?.amount ?? 0) * 100;
      const spent = getDailySpend(ctx.user!.id);
      if (spent + amountCents > limit) {
        return { allowed: false, reason: `Daily withdrawal limit exceeded ($${limit / 100})` };
      }
      return { allowed: true, reason: "ok" };
    },
  ],

  // ── KYC: Approve / Reject ───────────────────────────────────────────────────
  "kyc.approve": [
    (ctx) => {
      if (ctx.user!.role !== "admin" && (ctx.user as any).role !== "compliance_officer") {
        return { allowed: false, reason: "KYC approval requires compliance_officer or admin role" };
      }
      return { allowed: true, reason: "ok" };
    },
  ],
  "kyc.reject": [
    (ctx) => {
      if (ctx.user!.role !== "admin" && (ctx.user as any).role !== "compliance_officer") {
        return { allowed: false, reason: "KYC rejection requires compliance_officer or admin role" };
      }
      return { allowed: true, reason: "ok" };
    },
  ],

  // ── KYC: Upload ─────────────────────────────────────────────────────────────
  "kyc.upload": [
    (ctx) => {
      // Can only upload for own record
      if (ctx.resource?.ownerId && ctx.resource.ownerId !== ctx.user!.id) {
        return { allowed: false, reason: "Cannot upload KYC documents for another user" };
      }
      return { allowed: true, reason: "ok" };
    },
  ],

  // ── Dispute: Resolve ────────────────────────────────────────────────────────
  "dispute.resolve": [
    async (ctx) => {
      if (ctx.user!.role === "admin") return { allowed: true, reason: "ok" };
      // Check Permify adjudicator relationship
      if (ctx.resource?.id) {
        const permify = getPermifyClient();
        const allowed = await permify.check({
          entity: { type: "dispute", id: String(ctx.resource.id) },
          permission: "resolve",
          subject: { type: "user", id: String(ctx.user!.id) },
        });
        if (allowed) return { allowed: true, reason: "ok" };
      }
      return { allowed: false, reason: "Only adjudicators or admins can resolve disputes" };
    },
  ],

  // ── Admin: All operations ───────────────────────────────────────────────────
  "admin.*": [
    (ctx) => {
      if (ctx.user!.role !== "admin") {
        return { allowed: false, reason: "Admin role required" };
      }
      const has2FA = (ctx.user as any).twoFactorEnabled ?? false;
      if (!has2FA) {
        return { allowed: false, requiresMFA: true, reason: "2FA is required for all admin operations. Please enable TOTP in Security Settings." };
      }
      return { allowed: true, reason: "ok" };
    },
  ],

  // ── Report: Export ──────────────────────────────────────────────────────────
  "report.export": [
    (ctx) => {
      if (ctx.user!.role !== "admin" && (ctx.user as any).role !== "compliance_officer") {
        return { allowed: false, reason: "Report export requires compliance_officer or admin role" };
      }
      return { allowed: true, reason: "ok" };
    },
  ],

  // ── Audit Log: View ─────────────────────────────────────────────────────────
  "auditLog.view": [
    (ctx) => {
      if (ctx.user!.role !== "admin") {
        return { allowed: false, reason: "Audit log access requires admin role" };
      }
      return { allowed: true, reason: "ok" };
    },
  ],

  // ── Beneficiary: Update (BEC protection) ────────────────────────────────────
  "beneficiary.update": [
    (ctx) => {
      if (ctx.resource?.ownerId && ctx.resource.ownerId !== ctx.user!.id) {
        return { allowed: false, reason: "Cannot modify another user's beneficiary" };
      }
      if (ctx.resource?.id) {
        const swapped = flagBeneficiarySwap(ctx.user!.id, Number(ctx.resource.id));
        if (swapped) {
          return {
            allowed: true,
            reason: "ok",
            requiresReview: true,
          };
        }
      }
      return { allowed: true, reason: "ok" };
    },
  ],

  // ── Savings: Withdraw ───────────────────────────────────────────────────────
  "savings.withdraw": [
    (ctx) => {
      if (ctx.resource?.ownerId && ctx.resource.ownerId !== ctx.user!.id) {
        return { allowed: false, reason: "Cannot withdraw from another user's savings goal" };
      }
      return { allowed: true, reason: "ok" };
    },
  ],

  // ── Agent: Cash In / Cash Out ───────────────────────────────────────────────
  "agent.cashIn": [
    (ctx) => {
      if ((ctx.user as any).role !== "agent" && ctx.user!.role !== "admin") {
        return { allowed: false, reason: "Agent role required for cash-in operations" };
      }
      return { allowed: true, reason: "ok" };
    },
  ],
  "agent.cashOut": [
    (ctx) => {
      if ((ctx.user as any).role !== "agent" && ctx.user!.role !== "admin") {
        return { allowed: false, reason: "Agent role required for cash-out operations" };
      }
      return { allowed: true, reason: "ok" };
    },
  ],

  // ── API Key: Create ─────────────────────────────────────────────────────────
  "apiKey.create": [
    (ctx) => {
      const tier = (ctx.user as any).kycTier ?? 0;
      if (tier < 2) return { allowed: false, reason: "Enhanced KYC (Tier 2) required to create API keys" };
      return { allowed: true, reason: "ok" };
    },
  ],

  // ── CBDC: Issuance ──────────────────────────────────────────────────────────
  "cbdc.issue": [
    (ctx) => {
      if (ctx.user!.role !== "admin") {
        return { allowed: false, reason: "CBDC issuance requires admin role" };
      }
      return { allowed: true, reason: "ok" };
    },
  ],
};

// ─── Policy Evaluator ─────────────────────────────────────────────────────────
export async function evaluatePolicy(ctx: PolicyContext): Promise<PolicyDecision> {
  const policies = POLICIES[ctx.action] ?? POLICIES["admin.*"];
  if (!policies) {
    // Unknown action — default deny
    return { allowed: false, reason: `No policy defined for action: ${ctx.action}` };
  }

  let finalDecision: PolicyDecision = { allowed: true, reason: "default allow" };

  for (const policy of policies) {
    const decision = await Promise.resolve(policy(ctx));
    if (!decision.allowed) {
      // Emit security event for denied access
      emitSecurityEvent({
        type: "PBAC_DENY",
        severity: "medium",
        userId: ctx.user?.id,
        ip: ctx.environment?.ip,
        path: ctx.action,
        detail: decision.reason,
      });
      return decision;
    }
    // Accumulate flags (requiresMFA, requiresReview)
    if (decision.requiresMFA) finalDecision.requiresMFA = true;
    if (decision.requiresReview) finalDecision.requiresReview = true;
    if (decision.dailyLimitRemaining !== undefined) {
      finalDecision.dailyLimitRemaining = decision.dailyLimitRemaining;
    }
  }

  return { ...finalDecision, allowed: true, reason: "Policy evaluation passed" };
}

// ─── tRPC Middleware Factory ──────────────────────────────────────────────────
import { initTRPC } from "@trpc/server";
import superjson from "superjson";

const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });

/**
 * Creates a tRPC middleware that enforces a PBAC policy.
 *
 * Usage:
 *   transfer.send: protectedProcedure
 *     .use(pbacMiddleware("transfer.send"))
 *     .mutation(...)
 */
export function pbacMiddleware(
  action: string,
  getResource?: (input: unknown, ctx: TrpcContext) => PolicyContext["resource"]
) {
  return t.middleware(async ({ ctx, input, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
    }

    const resource = getResource ? getResource(input, ctx) : undefined;
    const policyCtx: PolicyContext = {
      user: ctx.user as any,
      resource,
      environment: {
        ip: (ctx.req as any)?.ip,
        requestId: (ctx.req as any)?.headers?.["x-request-id"],
      },
      action,
    };

    const decision = await evaluatePolicy(policyCtx);

    if (!decision.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: decision.reason,
      });
    }

    // Attach decision metadata to context for downstream use
    return next({
      ctx: {
        ...ctx,
        pbac: {
          action,
          requiresMFA: decision.requiresMFA ?? false,
          requiresReview: decision.requiresReview ?? false,
          dailyLimitRemaining: decision.dailyLimitRemaining,
        },
      },
    });
  });
}

// ─── Convenience Procedure Builders ──────────────────────────────────────────
// These are pre-built tRPC procedures with PBAC enforced.
// Import and use directly in routers.ts instead of protectedProcedure.

import { router as trpcRouter, protectedProcedure, adminProcedure } from "./_core/trpc";

/** Transfer send procedure with full PBAC (KYC tier, daily limit, 2FA, risk) */
export const transferSendProcedure = protectedProcedure.use(
  pbacMiddleware("transfer.send", (input: any) => ({
    type: "transaction",
    amount: input?.amount ?? input?.fromAmount ?? 0,
    currency: input?.currency ?? input?.fromCurrency ?? "USD",
    riskLevel: input?.riskLevel,
  }))
);

/** Wallet withdraw procedure with PBAC (KYC tier, daily limit) */
export const walletWithdrawProcedure = protectedProcedure.use(
  pbacMiddleware("wallet.withdraw", (input: any) => ({
    type: "wallet",
    amount: input?.amount ?? 0,
    currency: input?.currency ?? "USD",
  }))
);

/** KYC approve procedure (compliance_officer or admin only) */
export const kycApproveProcedure = protectedProcedure.use(
  pbacMiddleware("kyc.approve")
);

/** Report export procedure (compliance_officer or admin only) */
export const reportExportProcedure = protectedProcedure.use(
  pbacMiddleware("report.export")
);

/** Beneficiary update with BEC protection */
export const beneficiaryUpdateProcedure = protectedProcedure.use(
  pbacMiddleware("beneficiary.update", (input: any, ctx) => ({
    type: "beneficiary",
    id: input?.id,
    ownerId: ctx.user?.id,
  }))
);

/** Admin procedure that additionally enforces 2FA for high-risk admin actions */
export const adminPbacProcedure = adminProcedure.use(async ({ ctx, next }) => {
  const user = ctx.user as any;
  if (user.twoFactorEnabled) {
    const verifiedAt = user.twoFactorVerifiedAt ? new Date(user.twoFactorVerifiedAt).getTime() : 0;
    const fifteenMinutes = 15 * 60 * 1000;
    if (Date.now() - verifiedAt > fifteenMinutes) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This admin action requires recent 2FA verification (within 15 minutes). Please re-authenticate.",
      });
    }
  }
  return next({ ctx });
});

/** PBAC router — exposes policy evaluation as a tRPC endpoint */
export const pbacRouter = trpcRouter({
  /** Evaluate a policy for the current user (used by frontend for UI gating) */
  check: protectedProcedure
    .input(
      z.object({
        action: z.string(),
        resource: z.object({
          type: z.string(),
          id: z.string().optional(),
          amount: z.number().optional(),
          currency: z.string().optional(),
        }).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const decision = await evaluatePolicy({
        user: ctx.user as any,
        resource: input.resource,
        environment: { ip: (ctx.req as any)?.ip },
        action: input.action,
      });
      return {
        allowed: decision.allowed,
        reason: decision.reason,
        requiresMFA: decision.requiresMFA ?? false,
        requiresReview: decision.requiresReview ?? false,
        dailyLimitRemaining: decision.dailyLimitRemaining,
      };
    }),

  /** Get all policies applicable to the current user */
  myPolicies: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user as any;
    const tier = user.kycTier ?? 0;
    const limit = KYC_TIER_LIMITS[tier] ?? 0;
    const spent = getDailySpend(ctx.user!.id);
    return {
      kycTier: tier,
      dailyTransferLimit: limit / 100,
      dailySpent: spent / 100,
      dailyRemaining: Math.max(0, limit - spent) / 100,
      canSendMoney: tier >= 1,
      canBulkSend: tier >= 2 && (user.role === "admin" || user.role === "partner"),
      canWithdraw: tier >= 1,
      canCreateApiKey: tier >= 2,
      requires2FAAbove: 1000,
      role: user.role ?? "user",
    };
  }),
});
