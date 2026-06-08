/**
 * Push Notifications tRPC Router
 * Handles device subscription registration, preference management, and test notifications.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure ,
  auditedProcedure, auditedAdminProcedure, rateLimitedProcedure
} from "../_core/trpc";
import { getDb } from "../db.js";
import { sql } from "drizzle-orm";
import { pushSubscriptions } from "../../drizzle/schema.js";
import {
  sendPushToUser,
  sendPushToRole,
  getVapidPublicKey,
} from "../pushNotifications";

export const pushNotificationsRouter = router({
  /**
   * Get the VAPID public key for client-side subscription setup.
   */
  getVapidKey: protectedProcedure.query(() => {
    return { publicKey: getVapidPublicKey() };
  }),

  /**
   * Register a device push subscription.
   */
  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
        p256dhKey: z.string(),
        authKey: z.string(),
        deviceName: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await (await getDb())?.execute(sql`
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key, device_name)
        VALUES (${ctx.user.id}, ${input.endpoint}, ${input.p256dhKey}, ${input.authKey}, ${input.deviceName ?? "Browser"})
        ON CONFLICT (endpoint) DO UPDATE
          SET user_id = ${ctx.user.id},
              p256dh_key = ${input.p256dhKey},
              auth_key = ${input.authKey},
              is_active = TRUE,
              last_used_at = NOW()
      `);
      const ts = new Date();
      return { success: true, updatedAt: ts.toISOString(), serverTime: ts.getTime() };
    }),

  /**
   * Unregister a device push subscription.
   */
  unsubscribe: auditedProcedure
    .input(z.object({ endpoint: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await (await getDb())?.execute(sql`
        UPDATE push_subscriptions
        SET is_active = FALSE
        WHERE endpoint = ${input.endpoint} AND user_id = ${ctx.user.id}
      `);
      const ts = new Date();
      return { success: true, updatedAt: ts.toISOString(), serverTime: ts.getTime() };
    }),

  /**
   * List all active subscriptions for the current user.
   */
  listSubscriptions: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const rows = await (db as any).execute(sql`
      SELECT id, endpoint, device_name, is_active, created_at, last_used_at
      FROM push_subscriptions
      WHERE user_id = ${ctx.user.id}
      ORDER BY created_at DESC
    `);
    return rows as any[];
  }),

  /**
   * Get notification preferences for the current user.
   */
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const rows = await (db as any).execute(sql`
      SELECT preference_key, is_enabled
      FROM push_notification_preferences
      WHERE user_id = ${ctx.user.id}
    `);
    const prefs: Record<string, boolean> = {
      transfer_sent: true,
      transfer_delivered: true,
      transfer_failed: true,
      kyc_approved: true,
      kyc_rejected: true,
      fx_rate_alert: true,
      security_alert: true,
      compliance_flag: false,
    };
    for (const row of rows as any[]) {
      prefs[row.preference_key] = row.is_enabled;
    }
    return prefs;
  }),

  /**
   * Update notification preferences for the current user.
   */
  updatePreferences: protectedProcedure
    .input(
      z.object({
        preferences: z.record(z.string(), z.boolean()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      for (const [key, enabled] of Object.entries(input.preferences)) {
        await (db as any).execute(sql`
          INSERT INTO push_notification_preferences (user_id, preference_key, is_enabled)
          VALUES (${ctx.user.id}, ${key}, ${enabled})
          ON CONFLICT (user_id, preference_key) DO UPDATE SET is_enabled = ${enabled}
        `);
      }
      const ts = new Date();
      return { success: true, updatedAt: ts.toISOString(), serverTime: ts.getTime() };
    }),

  /**
   * Send a test notification to the current user's devices.
   */
  sendTest: auditedProcedure.mutation(async ({ ctx }) => {
    const result = await sendPushToUser(ctx.user.id, {
      title: "Test Notification 🔔",
      body: "Push notifications are working correctly on your device.",
      tag: "test",
      url: "/settings/notifications",
    });
    return result;
  }),

  /**
   * Admin: Send a broadcast notification to all users or a specific role.
   */
  broadcast: adminProcedure
    .input(
      z.object({
        title: z.string().min(1).max(100),
        body: z.string().min(1).max(500),
        url: z.string().optional(),
        targetRole: z.enum(["admin", "user", "all"]).default("all"),
      })
    )
    .mutation(async ({ input }) => {
      if (input.targetRole === "all") {
        const [adminResult, userResult] = await Promise.all([
          sendPushToRole("admin", { title: input.title, body: input.body, url: input.url }),
          sendPushToRole("user", { title: input.title, body: input.body, url: input.url }),
        ]);
        return {
          sent: adminResult.sent + userResult.sent,
          failed: adminResult.failed + userResult.failed,
        };
      } else {
        return sendPushToRole(input.targetRole, {
          title: input.title,
          body: input.body,
          url: input.url,
        });
      }
    }),

  /**
   * Admin: Get push notification statistics.
   */
  getStats: adminProcedure.query(async () => {
    try {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // Use drizzle ORM query instead of raw SQL execute
      const allSubs = await db.select().from(pushSubscriptions);
      const active = allSubs.filter((s: any) => s.isActive).length;
      const inactive = allSubs.filter((s: any) => !s.isActive).length;
      const uniqueUsers = new Set(allSubs.filter((s: any) => s.isActive).map((s: any) => s.userId)).size;
      const lastUsed = allSubs.reduce((max: any, s: any) => s.lastUsedAt && (!max || s.lastUsedAt > max) ? s.lastUsedAt : max, null);
      const result = [{ active_subscriptions: active, inactive_subscriptions: inactive, subscribed_users: uniqueUsers, last_notification_at: lastUsed }];
      const rows = (result as any)?.rows ?? (result as any) ?? [];
      const row = (rows as any[])[0] ?? {};
      return {
        active_subscriptions: Number(row.active_subscriptions ?? 0),
        inactive_subscriptions: Number(row.inactive_subscriptions ?? 0),
        subscribed_users: Number(row.subscribed_users ?? 0),
        last_notification_at: row.last_notification_at ?? null,
      };
    } catch {
      return {
        active_subscriptions: 0,
        inactive_subscriptions: 0,
        subscribed_users: 0,
        last_notification_at: null,
      };
    }
  }),
});
