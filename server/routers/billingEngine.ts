/**
 * RemitFlow — Billing Engine
 * P27 (Go migration): This is the TypeScript reference implementation.
 * The Go service in services/go-billing/ is the authoritative production
 * implementation. Both operate against the same DB schema.
 *
 * Handles: subscription billing, usage-based invoicing, tier management,
 * upgrade/downgrade proration, dunning (payment retry), and revenue reporting.
 */

import { getDb } from "./db";
import { logger } from './_core/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BillingPlan {
  code: string;
  name: string;
  monthlyFeeUsd: number;
  annualFeeUsd: number;
  features: string[];
  transferLimitUsd: number;
  fxMarkupPct: number;
  settlementSpeed: string;
  supportTier: string;
  isActive: boolean;
}

export interface Subscription {
  id: string;
  userId: number;
  planCode: string;
  billingCycle: "monthly" | "annual";
  status: "active" | "cancelled" | "past_due" | "trialing" | "paused";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelledAt: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  userId: number;
  periodStart: string;
  periodEnd: string;
  baseAmountUsd: number;
  usageAmountUsd: number;
  discountAmountUsd: number;
  taxAmountUsd: number;
  totalAmountUsd: number;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  dueAt: string;
  paidAt: string | null;
  createdAt: string;
}

export interface UsageSummary {
  userId: number;
  periodStart: string;
  periodEnd: string;
  totalTransferCount: number;
  totalTransferVolumeUsd: number;
  totalFeesPaidUsd: number;
  totalFxMarginUsd: number;
  corridorsUsed: string[];
  averageTransactionUsd: number;
  largestTransactionUsd: number;
}

// ── Plan Catalog ──────────────────────────────────────────────────────────────

export const PLANS: Record<string, BillingPlan> = {
  free: {
    code: "free",
    name: "Free",
    monthlyFeeUsd: 0,
    annualFeeUsd: 0,
    features: ["P2P transfers", "1 corridor", "Standard settlement", "Community support"],
    transferLimitUsd: 1_000,
    fxMarkupPct: 1.5,
    settlementSpeed: "T+1",
    supportTier: "community",
    isActive: true,
  },
  plus: {
    code: "plus",
    name: "Plus",
    monthlyFeeUsd: 9.99,
    annualFeeUsd: 99,
    features: ["Unlimited corridors", "Instant settlement", "Priority support", "Virtual cards", "Budgeting tools"],
    transferLimitUsd: 10_000,
    fxMarkupPct: 0.75,
    settlementSpeed: "instant",
    supportTier: "priority",
    isActive: true,
  },
  pro: {
    code: "pro",
    name: "Pro",
    monthlyFeeUsd: 24.99,
    annualFeeUsd: 249,
    features: ["Everything in Plus", "Agent network access", "Bulk payouts", "API access", "Dedicated account manager"],
    transferLimitUsd: 100_000,
    fxMarkupPct: 0.35,
    settlementSpeed: "instant",
    supportTier: "dedicated",
    isActive: true,
  },
  business: {
    code: "business",
    name: "Business",
    monthlyFeeUsd: 99,
    annualFeeUsd: 999,
    features: ["Everything in Pro", "Multi-user", "KYB onboarding", "Custom corridors", "SLA 99.9%", "White-label API"],
    transferLimitUsd: 1_000_000,
    fxMarkupPct: 0.15,
    settlementSpeed: "instant",
    supportTier: "enterprise",
    isActive: true,
  },
};

// ── Subscription Manager ─────────────────────────────────────────────────────

/**
 * Get or create a subscription for a user.
 */
export async function getSubscription(userId: number): Promise<Subscription | null> {
  const db = await getDb();
  const { sql } = await import("drizzle-orm");
  const rows = await (db as any).execute(sql`
    SELECT * FROM subscriptions WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT 1
  `);
  return (rows as any)?.[0] ?? null;
}

/**
 * Create a new subscription for a user.
 */
export async function createSubscription(
  userId: number,
  planCode: string,
  billingCycle: "monthly" | "annual" = "monthly"
): Promise<Subscription> {
  const plan = PLANS[planCode];
  if (!plan) throw new Error(`Unknown plan: ${planCode}`);

  const now = new Date();
  const periodEnd = new Date(now);
  if (billingCycle === "monthly") {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  } else {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  }

  const db = await getDb();
  const { sql } = await import("drizzle-orm");
  const id = crypto.randomUUID();
  await (db as any).execute(sql`
    INSERT INTO subscriptions (
      id, user_id, plan_code, billing_cycle, status,
      current_period_start, current_period_end,
      cancel_at_period_end, created_at
    ) VALUES (
      ${id}, ${userId}, ${planCode}, ${billingCycle}, ${plan.monthlyFeeUsd > 0 ? "trialing" : "active"},
      ${now.toISOString()}, ${periodEnd.toISOString()},
      false, ${now.toISOString()}
    )
  `);

  return {
    id,
    userId,
    planCode,
    billingCycle,
    status: plan.monthlyFeeUsd > 0 ? "trialing" : "active",
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: periodEnd.toISOString(),
    cancelledAt: null,
    cancelAtPeriodEnd: false,
    createdAt: now.toISOString(),
  };
}

/**
 * Change a user's plan (upgrade or downgrade) with proration.
 */
export async function changePlan(
  userId: number,
  newPlanCode: string,
  billingCycle: "monthly" | "annual" = "monthly"
): Promise<{ subscription: Subscription; prorationCreditUsd: number; effectiveAt: string }> {
  const plan = PLANS[newPlanCode];
  if (!plan) throw new Error(`Unknown plan: ${newPlanCode}`);

  const existing = await getSubscription(userId);
  if (!existing) {
    const sub = await createSubscription(userId, newPlanCode, billingCycle);
    return { subscription: sub, prorationCreditUsd: 0, effectiveAt: sub.currentPeriodStart };
  }

  const oldPlan = PLANS[existing.planCode];
  if (!oldPlan) throw new Error(`Current plan not found: ${existing.planCode}`);

  // Calculate proration credit for unused time on current plan
  const now = new Date();
  const periodEnd = new Date(existing.currentPeriodEnd);
  const periodStart = new Date(existing.currentPeriodStart);
  const totalMs = periodEnd.getTime() - periodStart.getTime();
  const remainingMs = periodEnd.getTime() - now.getTime();
  const prorationCreditUsd = totalMs > 0
    ? Math.round((remainingMs / totalMs) * (existing.billingCycle === "annual" ? oldPlan.annualFeeUsd : oldPlan.monthlyFeeUsd) * 100) / 100
    : 0;

  // Update subscription
  const newPeriodEnd = new Date(now);
  if (billingCycle === "monthly") {
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
  } else {
    newPeriodEnd.setFullYear(newPeriodEnd.getFullYear() + 1);
  }

  const db = await getDb();
  const { sql } = await import("drizzle-orm");
  await (db as any).execute(sql`
    UPDATE subscriptions SET
      plan_code = ${newPlanCode},
      billing_cycle = ${billingCycle},
      current_period_start = ${now.toISOString()},
      current_period_end = ${newPeriodEnd.toISOString()},
      cancel_at_period_end = false
    WHERE user_id = ${userId}
  `);

  // Record proration credit as a negative line item on the next invoice
  if (prorationCreditUsd > 0) {
    await (db as any).execute(sql`
      INSERT INTO invoice_adjustments (user_id, subscription_id, amount_usd, reason, created_at)
      VALUES (${userId}, ${existing.id}, ${-prorationCreditUsd}, 'proration_credit', ${now.toISOString()})
    `).catch(() => {});
  }

  const updated: Subscription = {
    ...existing,
    planCode: newPlanCode,
    billingCycle,
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: newPeriodEnd.toISOString(),
    cancelAtPeriodEnd: false,
  };

  return { subscription: updated, prorationCreditUsd, effectiveAt: now.toISOString() };
}

/**
 * Cancel a subscription (effective at period end).
 */
export async function cancelSubscription(userId: number): Promise<void> {
  const db = await getDb();
  const { sql } = await import("drizzle-orm");
  await (db as any).execute(sql`
    UPDATE subscriptions SET
      cancel_at_period_end = true,
      cancelled_at = NOW()
    WHERE user_id = ${userId} AND status = 'active'
  `);
}

// ── Usage Tracker ─────────────────────────────────────────────────────────────

/**
 * Record a transfer for usage-based billing.
 */
export async function recordUsage(
  userId: number,
  amountUsd: number,
  corridor: string,
  feePaidUsd: number,
  fxMarginUsd: number
): Promise<void> {
  const db = await getDb();
  const { sql } = await import("drizzle-orm");
  const now = new Date().toISOString();

  await (db as any).execute(sql`
    INSERT INTO billing_usage (user_id, transfer_count, transfer_volume_usd, fees_paid_usd, fx_margin_usd, corridors, recorded_at)
    VALUES (${userId}, 1, ${amountUsd}, ${feePaidUsd}, ${fxMarginUsd}, ${corridor}, ${now})
    ON CONFLICT (user_id, DATE_TRUNC('month', recorded_at))
    DO UPDATE SET
      transfer_count = billing_usage.transfer_count + 1,
      transfer_volume_usd = billing_usage.transfer_volume_usd + ${amountUsd},
      fees_paid_usd = billing_usage.fees_paid_usd + ${feePaidUsd},
      fx_margin_usd = billing_usage.fx_margin_usd + ${fxMarginUsd},
      corridors = CASE
        WHEN billing_usage.corridors LIKE ${'%' + corridor + '%'} THEN billing_usage.corridors
        ELSE billing_usage.corridors || ',' || ${corridor}
      END
  `).catch(() => {});
}

/**
 * Get usage summary for the current billing period.
 */
export async function getUsageSummary(userId: number): Promise<UsageSummary> {
  const db = await getDb();
  const { sql } = await import("drizzle-orm");

  const sub = await getSubscription(userId);
  const periodStart = sub?.currentPeriodStart ?? new Date(new Date().setDate(1)).toISOString();
  const periodEnd = sub?.currentPeriodEnd ?? new Date(new Date().setMonth(new Date().getMonth() + 1, 1)).toISOString();

  const rows = await (db as any).execute(sql`
    SELECT
      COUNT(*)::int AS transfer_count,
      COALESCE(SUM(transfer_volume_usd), 0)::float AS total_volume,
      COALESCE(SUM(fees_paid_usd), 0)::float AS total_fees,
      COALESCE(SUM(fx_margin_usd), 0)::float AS total_fx_margin,
      COALESCE(MAX(transfer_volume_usd), 0)::float AS largest_tx
    FROM billing_usage
    WHERE user_id = ${userId}
      AND recorded_at >= ${periodStart}
      AND recorded_at < ${periodEnd}
  `);

  const row = (rows as any)?.[0];
  const count = row?.transfer_count ?? 0;

  return {
    userId,
    periodStart,
    periodEnd,
    totalTransferCount: count,
    totalTransferVolumeUsd: row?.total_volume ?? 0,
    totalFeesPaidUsd: row?.total_fees ?? 0,
    totalFxMarginUsd: row?.total_fx_margin ?? 0,
    corridorsUsed: [],
    averageTransactionUsd: count > 0 ? (row?.total_volume ?? 0) / count : 0,
    largestTransactionUsd: row?.largest_tx ?? 0,
  };
}

// ── Invoice Generator ────────────────────────────────────────────────────────

/**
 * Generate an invoice for a user's current billing period.
 */
export async function generateInvoice(userId: number): Promise<Invoice> {
  const sub = await getSubscription(userId);
  if (!sub) throw new Error(`No subscription found for user ${userId}`);

  const plan = PLANS[sub.planCode];
  if (!plan) throw new Error(`Unknown plan: ${sub.planCode}`);

  const usage = await getUsageSummary(userId);
  const baseAmount = sub.billingCycle === "annual" ? plan.annualFeeUsd : plan.monthlyFeeUsd;

  // Usage-based charges (if plan has usage billing)
  const usageAmount = plan.code === "business" ? Math.max(0, usage.totalFeesPaidUsd - baseAmount) : 0;

  // Proration credits
  const db = await getDb();
  const { sql } = await import("drizzle-orm");
  const adjustments = await (db as any).execute(sql`
    SELECT COALESCE(SUM(amount_usd), 0)::float AS total
    FROM invoice_adjustments
    WHERE user_id = ${userId} AND applied = false
  `).catch(() => [{ total: 0 }]);
  const discountAmount = Math.abs((adjustments as any)?.[0]?.total ?? 0);

  const subtotal = baseAmount + usageAmount - discountAmount;
  const taxAmount = Math.round(subtotal * 0.0 * 100) / 100; // 0% tax for now
  const totalAmount = Math.max(0, subtotal + taxAmount);

  const now = new Date();
  const dueAt = new Date(now);
  dueAt.setDate(dueAt.getDate() + 7);

  const id = crypto.randomUUID();
  await (db as any).execute(sql`
    INSERT INTO invoices (
      id, subscription_id, user_id, period_start, period_end,
      base_amount_usd, usage_amount_usd, discount_amount_usd, tax_amount_usd,
      total_amount_usd, status, due_at, created_at
    ) VALUES (
      ${id}, ${sub.id}, ${userId}, ${sub.currentPeriodStart}, ${sub.currentPeriodEnd},
      ${baseAmount}, ${usageAmount}, ${discountAmount}, ${taxAmount},
      ${totalAmount}, ${totalAmount === 0 ? "paid" : "open"}, ${dueAt.toISOString()}, ${now.toISOString()}
    )
  `);

  // Mark adjustments as applied
  await (db as any).execute(sql`
    UPDATE invoice_adjustments SET applied = true WHERE user_id = ${userId} AND applied = false
  `).catch(() => {});

  return {
    id,
    subscriptionId: sub.id,
    userId,
    periodStart: sub.currentPeriodStart,
    periodEnd: sub.currentPeriodEnd,
    baseAmountUsd: baseAmount,
    usageAmountUsd: usageAmount,
    discountAmountUsd: discountAmount,
    taxAmountUsd: taxAmount,
    totalAmountUsd: totalAmount,
    status: totalAmount === 0 ? "paid" : "open",
    dueAt: dueAt.toISOString(),
    paidAt: totalAmount === 0 ? now.toISOString() : null,
    createdAt: now.toISOString(),
  };
}

/**
 * Get invoices for a user.
 */
export async function getInvoices(userId: number, limit = 12): Promise<Invoice[]> {
  const db = await getDb();
  const { sql } = await import("drizzle-orm");
  const rows = await (db as any).execute(sql`
    SELECT * FROM invoices WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT ${limit}
  `);
  return (rows as any) ?? [];
}

// ── Dunning (Payment Retry) ───────────────────────────────────────────────────

/**
 * Process dunning for overdue invoices.
 * Retry schedule: day 3, day 5, day 7, then mark uncollectible.
 */
export async function processDunning(): Promise<{ retried: number; cancelled: number }> {
  const db = await getDb();
  const { sql } = await import("drizzle-orm");

  const overdue = await (db as any).execute(sql`
    SELECT i.id, i.user_id, i.total_amount_usd, i.due_at,
           s.id AS subscription_id, s.plan_code
    FROM invoices i
    JOIN subscriptions s ON s.id = i.subscription_id
    WHERE i.status = 'open' AND i.due_at < NOW()
  `);

  let retried = 0;
  let cancelled = 0;

  for (const inv of (overdue as any) ?? []) {
    const daysOverdue = Math.floor((Date.now() - new Date(inv.due_at).getTime()) / 86400_000);

    if (daysOverdue >= 7) {
      // Mark uncollectible, suspend subscription
      await (db as any).execute(sql`
        UPDATE invoices SET status = 'uncollectible' WHERE id = ${inv.id}
      `);
      await (db as any).execute(sql`
        UPDATE subscriptions SET status = 'past_due' WHERE id = ${inv.subscription_id}
      `);
      cancelled++;
      logger.warn({ invoiceId: inv.id, userId: inv.user_id }, "[Billing] Invoice marked uncollectible");
    } else if (daysOverdue >= 3 || daysOverdue >= 5) {
      // In production: trigger Stripe payment retry
      // For now: log the retry attempt
      retried++;
      logger.info({ invoiceId: inv.id, userId: inv.user_id, daysOverdue }, "[Billing] Dunning retry triggered");
    }
  }

  return { retried, cancelled };
}

// ── Revenue Report ────────────────────────────────────────────────────────────

/**
 * Get MRR and revenue metrics.
 */
export async function getRevenueMetrics(): Promise<{
  mrr: number;
  arr: number;
  activeSubscriptions: number;
  churnRate: number;
  planBreakdown: Record<string, number>;
}> {
  const db = await getDb();
  const { sql } = await import("drizzle-orm");

  const subs = await (db as any).execute(sql`
    SELECT plan_code, billing_cycle, COUNT(*)::int AS count
    FROM subscriptions WHERE status IN ('active', 'trialing')
    GROUP BY plan_code, billing_cycle
  `);

  let mrr = 0;
  const planBreakdown: Record<string, number> = {};

  for (const row of (subs as any) ?? []) {
    const plan = PLANS[row.plan_code];
    if (!plan) continue;
    const monthlyValue = row.billing_cycle === "annual" ? plan.annualFeeUsd / 12 : plan.monthlyFeeUsd;
    mrr += monthlyValue * row.count;
    planBreakdown[row.plan_code] = (planBreakdown[row.plan_code] ?? 0) + row.count;
  }

  const totalSubs = Object.values(planBreakdown).reduce((a, b) => a + b, 0);

  // Calculate churn (cancelled in last 30 days / active 30 days ago)
  const churned = await (db as any).execute(sql`
    SELECT COUNT(*)::int AS count FROM subscriptions
    WHERE status = 'cancelled' AND cancelled_at > NOW() - INTERVAL '30 days'
  `);
  const churnCount = (churned as any)?.[0]?.count ?? 0;
  const churnRate = totalSubs > 0 ? churnCount / totalSubs : 0;

  return {
    mrr: Math.round(mrr * 100) / 100,
    arr: Math.round(mrr * 12 * 100) / 100,
    activeSubscriptions: totalSubs,
    churnRate: Math.round(churnRate * 10000) / 10000,
    planBreakdown,
  };
}
