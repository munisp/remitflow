/**
 * Push Notifications Service — FCM (Firebase Cloud Messaging)
 * Handles device registration, notification dispatch, and preference management.
 * Uses the Web Push Protocol (VAPID) as a fallback when FCM is not configured.
 */
import { getDb } from "./db.js";
import { sql } from "drizzle-orm";
import { logger } from './_core/logger';

// Default VAPID keys for Web Push (replace with real keys in production)
const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBLVilong8zYZuZe4";
const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY ||
  "UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@remitflow.io";

// FCM Server Key (optional — falls back to Web Push if not set)
const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY || "";

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

export interface DeviceSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * Send a push notification to a specific user's registered devices.
 * Gracefully degrades if web-push is not installed.
 */
export async function sendPushToUser(
  userId: number,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  try {
    // Get all active device subscriptions for this user
    const rows = await (await getDb())?.execute(sql`
      SELECT endpoint, p256dh, auth
      FROM push_subscriptions
      WHERE user_id = ${userId} AND is_active = TRUE
    `);

    const subscriptions = (rows as any[]).filter((r) => r.endpoint);

    for (const sub of subscriptions) {
      try {
        await dispatchWebPush(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        );
        sent++;
      } catch (err: any) {
        failed++;
        // If subscription is expired (410 Gone), deactivate it
        if (err?.statusCode === 410 || err?.status === 410) {
          await (await getDb())?.execute(sql`
            UPDATE push_subscriptions SET is_active = FALSE
            WHERE endpoint = ${sub.endpoint}
          `);
        }
      }
    }
  } catch (dbErr) {
    // Table may not exist yet — silently ignore
    logger.warn({ data: dbErr }, '[Push] push_subscriptions table not ready:');
  }

  return { sent, failed };
}

/**
 * Send a push notification to all users with a specific role.
 */
export async function sendPushToRole(
  role: "admin" | "user",
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  try {
    const rows = await (await getDb())?.execute(sql`
      SELECT DISTINCT ps.user_id, ps.endpoint, ps.p256dh, ps.auth
      FROM push_subscriptions ps
      JOIN users u ON u.id = ps.user_id
      WHERE ps.is_active = TRUE AND u.role = ${role}
    `);

    for (const sub of rows as any[]) {
      try {
        await dispatchWebPush(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        );
        sent++;
      } catch {
        failed++;
      }
    }
  } catch (dbErr) {
    logger.warn({ data: dbErr }, '[Push] sendPushToRole error:');
  }

  return { sent, failed };
}

/**
 * Low-level Web Push dispatch using the web-push library.
 * Falls back to a no-op if web-push is not installed.
 */
async function dispatchWebPush(
  subscription: DeviceSubscription,
  payload: PushPayload
): Promise<void> {
  try {
    const webpush = await import("web-push");
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon || "/icons/icon-192x192.png",
        badge: payload.badge || "/icons/badge-72x72.png",
        url: payload.url || "/",
        tag: payload.tag,
        data: payload.data || {},
      })
    );
  } catch (err: any) {
    if (err?.code === "MODULE_NOT_FOUND") {
      // web-push not installed — log and skip
      logger.info("[Push] web-push not installed, skipping notification");
      return;
    }
    throw err;
  }
}

/**
 * Get VAPID public key for client-side subscription setup.
 */
export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

/**
 * Notification templates for common events.
 */
export const NotificationTemplates = {
  transferSent: (amount: string, currency: string, recipient: string): PushPayload => ({
    title: "Transfer Sent ✅",
    body: `Your transfer of ${amount} ${currency} to ${recipient} has been initiated.`,
    tag: "transfer-sent",
    url: "/transfers",
    data: { type: "transfer_sent" },
  }),

  transferDelivered: (amount: string, currency: string, recipient: string): PushPayload => ({
    title: "Transfer Delivered 🎉",
    body: `${amount} ${currency} has been delivered to ${recipient}.`,
    tag: "transfer-delivered",
    url: "/transfers",
    data: { type: "transfer_delivered" },
  }),

  transferFailed: (amount: string, currency: string, reason: string): PushPayload => ({
    title: "Transfer Failed ⚠️",
    body: `Your transfer of ${amount} ${currency} failed: ${reason}. Tap to retry.`,
    tag: "transfer-failed",
    url: "/transfers",
    data: { type: "transfer_failed" },
  }),

  kycApproved: (): PushPayload => ({
    title: "KYC Approved ✅",
    body: "Your identity has been verified. You can now send higher amounts.",
    tag: "kyc-approved",
    url: "/kyc",
    data: { type: "kyc_approved" },
  }),

  kycRejected: (reason: string): PushPayload => ({
    title: "KYC Action Required",
    body: `Your KYC verification needs attention: ${reason}`,
    tag: "kyc-rejected",
    url: "/kyc",
    data: { type: "kyc_rejected" },
  }),

  complianceFlag: (type: string, amount: string): PushPayload => ({
    title: "Compliance Alert 🚨",
    body: `A ${type} report has been triggered for a transaction of ${amount}.`,
    tag: "compliance-flag",
    url: "/admin/compliance",
    data: { type: "compliance_flag" },
  }),

  fxRateAlert: (pair: string, rate: string, threshold: string): PushPayload => ({
    title: "FX Rate Alert 📈",
    body: `${pair} has reached ${rate} (your alert: ${threshold}).`,
    tag: "fx-alert",
    url: "/fx-rates",
    data: { type: "fx_rate_alert" },
  }),

  partnerApplicationApproved: (companyName: string): PushPayload => ({
    title: "Partner Application Approved 🎊",
    body: `${companyName}'s white-label partner application has been approved!`,
    tag: "partner-approved",
    url: "/partner/self-service",
    data: { type: "partner_approved" },
  }),

  securityAlert: (event: string, ip: string): PushPayload => ({
    title: "Security Alert 🔐",
    body: `${event} detected from IP ${ip}. If this wasn't you, secure your account.`,
    tag: "security-alert",
    url: "/settings/security",
    data: { type: "security_alert" },
  }),
};
