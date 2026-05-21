/**
 * Rate Alerts Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Allows users to set FX rate alerts:
 * - Alert when rate reaches target
 * - Alert when rate changes by X%
 * - Daily rate summary emails
 * - Push notifications for triggered alerts
 */

import { z } from "zod";
import { randomBytes } from "crypto";
import { router, publicProcedure } from "../_core/trpc";
import { logger } from "../_core/logger";
import { createAuditLog } from "../db";

interface RateAlert {
  id: string;
  userId: number;
  fromCurrency: string;
  toCurrency: string;
  alertType: "target" | "change_pct" | "daily_summary";
  targetRate?: number;
  changePct?: number;
  currentRate: number;
  isActive: boolean;
  triggeredAt?: string;
  createdAt: string;
  notificationMethod: "email" | "push" | "both";
}

// In-memory store (production: PostgreSQL + scheduled worker)
const rateAlerts = new Map<string, RateAlert>();

export const rateAlertsRouter = router({
  // Create a rate alert
  createAlert: publicProcedure
    .input(z.object({
      userId: z.number(),
      fromCurrency: z.string().length(3),
      toCurrency: z.string().length(3),
      alertType: z.enum(["target", "change_pct", "daily_summary"]),
      targetRate: z.number().positive().optional(),
      changePct: z.number().min(0.1).max(50).optional(),
      currentRate: z.number().positive(),
      notificationMethod: z.enum(["email", "push", "both"]).default("both"),
    }))
    .mutation(({ input }) => {
      const id = `alert_${Date.now()}_${randomBytes(3).toString("hex")}`;

      if (input.alertType === "target" && !input.targetRate) {
        return { success: false, reason: "Target rate required for target alerts" };
      }
      if (input.alertType === "change_pct" && !input.changePct) {
        return { success: false, reason: "Change percentage required for change alerts" };
      }

      const alert: RateAlert = {
        id,
        userId: input.userId,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        alertType: input.alertType,
        targetRate: input.targetRate,
        changePct: input.changePct,
        currentRate: input.currentRate,
        isActive: true,
        createdAt: new Date().toISOString(),
        notificationMethod: input.notificationMethod,
      };

      rateAlerts.set(id, alert);
      logger.info({ alertId: id, pair: `${input.fromCurrency}/${input.toCurrency}` }, "Rate alert created");

      return {
        success: true,
        alertId: id,
        message: input.alertType === "target"
          ? `Alert set for ${input.fromCurrency}/${input.toCurrency} at ${input.targetRate}`
          : input.alertType === "change_pct"
          ? `Alert set for ${input.changePct}% change in ${input.fromCurrency}/${input.toCurrency}`
          : `Daily summary enabled for ${input.fromCurrency}/${input.toCurrency}`,
      };
    }),

  // List user's rate alerts
  listAlerts: publicProcedure
    .input(z.object({ userId: z.number() }))
    .query(({ input }) => {
      const userAlerts: RateAlert[] = [];
      for (const [_, alert] of Array.from(rateAlerts.entries())) {
        if (alert.userId === input.userId) {
          userAlerts.push(alert);
        }
      }
      return { alerts: userAlerts, count: userAlerts.length };
    }),

  // Delete an alert
  deleteAlert: publicProcedure
    .input(z.object({ alertId: z.string() }))
    .mutation(({ input }) => {
      const deleted = rateAlerts.delete(input.alertId);
      return { success: deleted };
    }),

  // Toggle alert active/inactive
  toggleAlert: publicProcedure
    .input(z.object({ alertId: z.string() }))
    .mutation(({ input }) => {
      const alert = rateAlerts.get(input.alertId);
      if (!alert) return { success: false, reason: "Alert not found" };
      alert.isActive = !alert.isActive;
      return { success: true, isActive: alert.isActive };
    }),
});
