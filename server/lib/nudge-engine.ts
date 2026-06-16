/**
 * Smart Notification Nudge Engine — proactive user engagement.
 * Triggers: rate alerts, recurring reminders, balance thresholds,
 * KYC upgrades, inactivity re-engagement, corridor deals.
 */
import { z } from "zod";
import { getDb } from "../db";
import { users, transactions, wallets, fxAlerts, notifications, recurringPayments } from "../../drizzle/schema";
import { sql, eq, gte, lte, lt, count, and, desc, isNull } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const nudgeRuleSchema = z.object({
  type: z.enum([
    "rate_alert",
    "recurring_reminder",
    "balance_threshold",
    "kyc_upgrade",
    "inactivity",
    "corridor_deal",
    "transfer_eta",
  ]),
  enabled: z.boolean().default(true),
  channel: z.enum(["push", "email", "sms", "in_app"]).default("in_app"),
  threshold: z.number().optional(),
  corridorPair: z.string().optional(),
});

export const nudgeEngineRouter = router({
  getUserNudges: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const userId = ctx.user!.id;
    const nudges: Array<{ type: string; title: string; message: string; actionUrl: string; priority: number }> = [];

    // 1. Balance threshold nudge
    const lowBalanceWallets = await db
      .select({ currency: wallets.currency, balance: wallets.balance })
      .from(wallets)
      .where(and(eq(wallets.userId, userId), lt(wallets.balance, sql`5000`)));
    for (const w of lowBalanceWallets) {
      nudges.push({
        type: "balance_threshold",
        title: "Low balance",
        message: `Your ${w.currency} wallet is below ${w.currency === "NGN" ? "₦" : ""}5,000 — top up now?`,
        actionUrl: "/wallet",
        priority: 2,
      });
    }

    // 2. KYC upgrade nudge
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (user[0] && (!user[0].kycTier || user[0].kycTier === "tier0" || user[0].kycTier === "tier1")) {
      const tierName = user[0].kycTier ?? "tier0";
      const limits: Record<string, string> = { tier0: "₦50,000", tier1: "₦200,000", tier2: "₦2,000,000" };
      nudges.push({
        type: "kyc_upgrade",
        title: "Upgrade your account",
        message: `You're on ${tierName}. Upgrade to unlock ${limits[tierName === "tier0" ? "tier1" : "tier2"]}/month limits — takes 3 minutes`,
        actionUrl: "/kyc",
        priority: 3,
      });
    }

    // 3. Inactivity nudge
    const [lastTx] = await db
      .select({ lastDate: sql<Date>`MAX(${transactions.createdAt})` })
      .from(transactions)
      .where(eq(transactions.userId, userId));
    if (lastTx?.lastDate) {
      const daysSince = Math.floor((Date.now() - new Date(lastTx.lastDate).getTime()) / 86400000);
      if (daysSince > 30) {
        nudges.push({
          type: "inactivity",
          title: "We miss you!",
          message: `You haven't sent money in ${daysSince} days — need help with anything?`,
          actionUrl: "/send",
          priority: 1,
        });
      }
    }

    // 4. Recurring payment reminder
    const upcoming = await db
      .select()
      .from(recurringPayments)
      .where(and(eq(recurringPayments.userId, userId), eq(recurringPayments.status, "active")))
      .limit(5);
    for (const rp of upcoming) {
      if (rp.nextRunDate) {
        const daysUntil = Math.floor((new Date(rp.nextRunDate).getTime() - Date.now()) / 86400000);
        if (daysUntil <= 1 && daysUntil >= 0) {
          nudges.push({
            type: "recurring_reminder",
            title: "Upcoming payment",
            message: `Your recurring payment of ${rp.amount} ${rp.currency} is due ${daysUntil === 0 ? "today" : "tomorrow"}`,
            actionUrl: "/recurring",
            priority: 4,
          });
        }
      }
    }

    return nudges.sort((a, b) => b.priority - a.priority);
  }),

  getNudgeStats: adminProcedure.query(async () => {
    const db = await getDb();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const [sent] = await db
      .select({ count: count() })
      .from(notifications)
      .where(gte(notifications.createdAt, thirtyDaysAgo));
    const [read] = await db
      .select({ count: count() })
      .from(notifications)
      .where(and(gte(notifications.createdAt, thirtyDaysAgo), eq(notifications.isRead, true)));
    return {
      sent: sent?.count ?? 0,
      read: read?.count ?? 0,
      readRate: sent?.count ? ((read?.count ?? 0) / sent.count * 100).toFixed(1) : "0",
    };
  }),
});
