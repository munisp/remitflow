/**
 * Firebase Cloud Messaging (FCM) Helper
 * Sends push notifications via FCM HTTP v1 API.
 * Falls back gracefully if FIREBASE_SERVER_KEY is not configured.
 */
import { ENV as env } from "./env.js";
import { logger } from "./logger.js";

const FCM_ENDPOINT = "https://fcm.googleapis.com/fcm/send";

export interface FCMPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: Record<string, string>;
  clickAction?: string;
}

export interface FCMResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a push notification to a single FCM device token.
 */
export async function sendFCMNotification(
  deviceToken: string,
  payload: FCMPayload
): Promise<FCMResult> {
  const serverKey = env ? (env as any).FIREBASE_SERVER_KEY : undefined;
  if (!serverKey) {
    logger.warn("[FCM] FIREBASE_SERVER_KEY not configured — push notification skipped");
    return { success: false, error: "FCM not configured" };
  }

  try {
    const body = {
      to: deviceToken,
      notification: {
        title: payload.title,
        body: payload.body,
        icon: payload.icon ?? "/icons/icon-192x192.png",
        badge: payload.badge ?? "/icons/badge-72x72.png",
        click_action: payload.clickAction ?? "/",
      },
      data: payload.data ?? {},
      priority: "high",
    };

    const response = await fetch(FCM_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `key=${serverKey}`,
      },
      body: JSON.stringify(body),
    });

    const result = await response.json() as any;
    if (result.success === 1) {
      return { success: true, messageId: result.results?.[0]?.message_id };
    }
    return { success: false, error: result.results?.[0]?.error ?? "Unknown FCM error" };
  } catch (err: any) {
    logger.error("[FCM] Error sending notification:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send a push notification to multiple FCM device tokens (multicast).
 */
export async function sendFCMMulticast(
  deviceTokens: string[],
  payload: FCMPayload
): Promise<{ successCount: number; failureCount: number }> {
  const serverKey = env ? (env as any).FIREBASE_SERVER_KEY : undefined;
  if (!serverKey || deviceTokens.length === 0) {
    return { successCount: 0, failureCount: deviceTokens.length };
  }

  try {
    const body = {
      registration_ids: deviceTokens,
      notification: {
        title: payload.title,
        body: payload.body,
        icon: payload.icon ?? "/icons/icon-192x192.png",
        badge: payload.badge ?? "/icons/badge-72x72.png",
        click_action: payload.clickAction ?? "/",
      },
      data: payload.data ?? {},
      priority: "high",
    };

    const response = await fetch(FCM_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `key=${serverKey}`,
      },
      body: JSON.stringify(body),
    });

    const result = await response.json() as any;
    return {
      successCount: result.success ?? 0,
      failureCount: result.failure ?? deviceTokens.length,
    };
  } catch (err: any) {
    logger.error("[FCM] Multicast error:", err.message);
    return { successCount: 0, failureCount: deviceTokens.length };
  }
}
