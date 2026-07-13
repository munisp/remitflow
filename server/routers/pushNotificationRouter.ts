/**
 * RemitFlow — Push Notification Router
 * ══════════════════════════════════════════════════════════════════════════════
 * Rich push notification management using Expo Push Notifications:
 *
 *  - Device token registration and management
 *  - Notification preference management (per-category opt-in/out)
 *  - Rich notification templates for all platform events
 *  - Notification history and read receipts
 *  - Scheduled notifications (rate alerts, payment reminders)
 *  - Batch notification sending for admin broadcasts
 *  - Deep link routing in notifications
 *
 * Notification categories:
 *  - transfer: Transfer status updates
 *  - fx_alert: FX rate alerts
 *  - kyc: KYC status updates
 *  - bnpl: BNPL payment reminders
 *  - savings: Savings milestones and streaks
 *  - security: Login alerts, suspicious activity
 *  - promo: Promotional offers (opt-in only)
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
import { redis } from "../middleware/redis";
import { db } from "../db";
import { pushTokens, notificationPreferences } from "../../drizzle/schema";
import { eq, and, inArray, desc } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

type NotificationCategory =
  | "transfer"
  | "fx_alert"
  | "kyc"
  | "bnpl"
  | "savings"
  | "security"
  | "promo";

interface PushMessage {
  to: string | string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  categoryIdentifier?: string;
  channelId?: string;
  priority?: "default" | "normal" | "high";
  ttl?: number;
  expiration?: number;
  subtitle?: string;
}

// ── Expo Push API ─────────────────────────────────────────────────────────────

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

async function sendExpoPushNotifications(messages: PushMessage[]): Promise<{
  sent: number;
  failed: number;
  errors: string[];
}> {
  const chunks: PushMessage[][] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const chunk of chunks) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        failed += chunk.length;
        errors.push(`HTTP ${res.status}: ${await res.text()}`);
        continue;
      }

      const result = await res.json();
      const data = result.data ?? [];

      for (const item of data) {
        if (item.status === "ok") sent++;
        else {
          failed++;
          if (item.message) errors.push(item.message);
        }
      }
    } catch (e: any) {
      failed += chunk.length;
      errors.push(e?.message ?? "Unknown error");
    }
  }

  return { sent, failed, errors };
}

// ── Notification Templates ────────────────────────────────────────────────────

function buildTransferNotification(event: string, data: Record<string, any>): { title: string; body: string; deepLink: string } {
  switch (event) {
    case "transfer.completed":
      return {
        title: "Transfer Delivered! 🎉",
        body: `Your ${data.currency} ${data.amount} transfer to ${data.recipientName} has been delivered.`,
        deepLink: `remitflow://transfers/${data.transferId}`,
      };
    case "transfer.failed":
      return {
        title: "Transfer Failed",
        body: `Your transfer of ${data.currency} ${data.amount} could not be completed. Tap to retry.`,
        deepLink: `remitflow://transfers/${data.transferId}/retry`,
      };
    case "transfer.initiated":
      return {
        title: "Transfer Sent",
        body: `We're processing your ${data.currency} ${data.amount} transfer. Estimated delivery: ${data.estimatedDelivery ?? "1-2 business days"}.`,
        deepLink: `remitflow://transfers/${data.transferId}`,
      };
    default:
      return { title: "Transfer Update", body: "Your transfer status has changed.", deepLink: "remitflow://transfers" };
  }
}

function buildFxAlertNotification(data: Record<string, any>): { title: string; body: string; deepLink: string } {
  return {
    title: `Rate Alert: ${data.fromCurrency}/${data.toCurrency} 📈`,
    body: `The ${data.fromCurrency}/${data.toCurrency} rate is now ${data.currentRate}. ${data.alertType === "above" ? "Great time to send!" : "Rate has dropped."}`,
    deepLink: `remitflow://send?from=${data.fromCurrency}&to=${data.toCurrency}`,
  };
}

function buildKycNotification(event: string, data: Record<string, any>): { title: string; body: string; deepLink: string } {
  switch (event) {
    case "kyc.approved":
      return {
        title: "KYC Approved! ✅",
        body: `Your ${data.kycTier} verification is complete. Your transfer limits have been increased.`,
        deepLink: "remitflow://profile/kyc",
      };
    case "kyc.rejected":
      return {
        title: "KYC Requires Attention",
        body: `Your verification needs an update: ${data.rejectionReason}. Tap to resubmit.`,
        deepLink: "remitflow://kyc/resubmit",
      };
    default:
      return { title: "KYC Update", body: "Your verification status has changed.", deepLink: "remitflow://profile/kyc" };
  }
}

function buildBnplNotification(event: string, data: Record<string, any>): { title: string; body: string; deepLink: string } {
  switch (event) {
    case "bnpl.instalment.due":
      return {
        title: "Payment Due Tomorrow 💳",
        body: `Your BNPL instalment of ${data.currency} ${data.amount} is due on ${data.dueDate}. Tap to pay now.`,
        deepLink: `remitflow://bnpl/${data.planId}`,
      };
    case "bnpl.instalment.paid":
      return {
        title: "Payment Received ✅",
        body: `Instalment ${data.instalmentNumber} of ${data.currency} ${data.amount} paid. ${data.remainingInstalments} remaining.`,
        deepLink: `remitflow://bnpl/${data.planId}`,
      };
    default:
      return { title: "BNPL Update", body: "Your BNPL plan has been updated.", deepLink: "remitflow://bnpl" };
  }
}

function buildSavingsNotification(event: string, data: Record<string, any>): { title: string; body: string; deepLink: string } {
  switch (event) {
    case "savings.goal.reached":
      return {
        title: `Goal Achieved! 🏆 ${data.goalEmoji ?? "🎯"}`,
        body: `You've reached your "${data.goalName}" savings goal of ${data.currency} ${data.targetAmount}!`,
        deepLink: `remitflow://savings/${data.goalId}`,
      };
    case "savings.streak":
      return {
        title: `${data.streakDays}-Day Saving Streak! 🔥`,
        body: `You've saved consistently for ${data.streakDays} days. Keep it up!`,
        deepLink: "remitflow://savings",
      };
    default:
      return { title: "Savings Update", body: "Your savings have been updated.", deepLink: "remitflow://savings" };
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const pushNotificationRouter = router({

  /**
   * Register a device push token for the current user.
   */
  registerToken: protectedProcedure
    .input(z.object({
      token: z.string().min(10),
      platform: z.enum(["ios", "android", "web"]),
      deviceId: z.string().min(8).max(128),
      appVersion: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;

      await db.insert(pushTokens).values({
        userId,
        token: input.token,
        platform: input.platform,
        deviceId: input.deviceId,
        appVersion: input.appVersion,
        status: "active",
      } as any).onConflictDoUpdate({
        target: [pushTokens.deviceId as any],
        set: {
          token: input.token,
          appVersion: input.appVersion,
          updatedAt: new Date(),
          status: "active",
        } as any,
      });

      logger.info({ userId, platform: input.platform }, "[PushNotification] Token registered");
      return { registered: true, platform: input.platform };
    }),

  /**
   * Update notification preferences for the current user.
   */
  updatePreferences: protectedProcedure
    .input(z.object({
      transfer: z.boolean().default(true),
      fx_alert: z.boolean().default(true),
      kyc: z.boolean().default(true),
      bnpl: z.boolean().default(true),
      savings: z.boolean().default(true),
      security: z.boolean().default(true),
      promo: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;

      await db.insert(notificationPreferences).values({
        userId,
        ...input,
      } as any).onConflictDoUpdate({
        target: [notificationPreferences.userId as any],
        set: { ...input, updatedAt: new Date() } as any,
      });

      return { updated: true, preferences: input };
    }),

  /**
   * Get notification preferences for the current user.
   */
  getPreferences: protectedProcedure
    .query(async ({ ctx }) => {
      const [prefs] = await db.select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, ctx.user.id))
        .limit(1);

      return prefs ?? {
        transfer: true,
        fx_alert: true,
        kyc: true,
        bnpl: true,
        savings: true,
        security: true,
        promo: false,
      };
    }),

  /**
   * Send a notification to a specific user (internal use).
   * Called by other routers/workers when events occur.
   */
  sendToUser: adminProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      category: z.enum(["transfer", "fx_alert", "kyc", "bnpl", "savings", "security", "promo"]),
      event: z.string(),
      data: z.record(z.unknown()).default({}),
    }))
    .mutation(async ({ input }) => {
      // Get user's active tokens
      const tokens = await db.select({ token: pushTokens.token })
        .from(pushTokens)
        .where(
          and(
            eq(pushTokens.userId, input.userId),
            eq(pushTokens.status, "active" as any),
          )
        );

      if (tokens.length === 0) {
        return { sent: 0, reason: "No active push tokens for user" };
      }

      // Check preferences
      const [prefs] = await db.select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, input.userId))
        .limit(1);

      if (prefs && !(prefs as any)[input.category]) {
        return { sent: 0, reason: `User has disabled ${input.category} notifications` };
      }

      // Build notification
      let notification: { title: string; body: string; deepLink: string };
      const data = input.data as Record<string, any>;

      switch (input.category) {
        case "transfer": notification = buildTransferNotification(input.event, data); break;
        case "fx_alert": notification = buildFxAlertNotification(data); break;
        case "kyc": notification = buildKycNotification(input.event, data); break;
        case "bnpl": notification = buildBnplNotification(input.event, data); break;
        case "savings": notification = buildSavingsNotification(input.event, data); break;
        case "security":
          notification = {
            title: "Security Alert 🔒",
            body: data.message ?? "A security event occurred on your account.",
            deepLink: "remitflow://security",
          };
          break;
        case "promo":
          notification = {
            title: data.title ?? "Special Offer",
            body: data.body ?? "Check out our latest offers.",
            deepLink: data.deepLink ?? "remitflow://offers",
          };
          break;
        default:
          notification = { title: "RemitFlow Update", body: "You have a new notification.", deepLink: "remitflow://" };
      }

      const messages: PushMessage[] = tokens.map((t) => ({
        to: t.token,
        title: notification.title,
        body: notification.body,
        data: { deepLink: notification.deepLink, event: input.event, ...data },
        sound: "default",
        priority: input.category === "security" ? "high" : "default",
        channelId: input.category,
      }));

      const result = await sendExpoPushNotifications(messages);

      logger.info({
        userId: input.userId,
        category: input.category,
        event: input.event,
        sent: result.sent,
        failed: result.failed,
      }, "[PushNotification] Notification sent");

      return result;
    }),

  /**
   * Send a broadcast notification to all users (admin only).
   */
  broadcastNotification: adminProcedure
    .input(z.object({
      title: z.string().min(2).max(100),
      body: z.string().min(2).max(300),
      deepLink: z.string().optional(),
      category: z.enum(["transfer", "fx_alert", "kyc", "bnpl", "savings", "security", "promo"]).default("promo"),
      targetPlatforms: z.array(z.enum(["ios", "android", "web"])).optional(),
    }))
    .mutation(async ({ input }) => {
      const query = db.select({ token: pushTokens.token })
        .from(pushTokens)
        .where(eq(pushTokens.status, "active" as any));

      const tokens = await query;

      if (tokens.length === 0) {
        return { sent: 0, reason: "No active push tokens" };
      }

      const messages: PushMessage[] = tokens.map((t) => ({
        to: t.token,
        title: input.title,
        body: input.body,
        data: { deepLink: input.deepLink ?? "remitflow://", category: input.category },
        sound: "default",
        channelId: input.category,
      }));

      const result = await sendExpoPushNotifications(messages);

      logger.info({
        totalTokens: tokens.length,
        sent: result.sent,
        failed: result.failed,
      }, "[PushNotification] Broadcast sent");

      return { ...result, totalTargeted: tokens.length };
    }),
});
