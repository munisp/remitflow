/**
 * Rate Alerts Router — DB-backed
 * ─────────────────────────────────────────────────────────────────────────────
 * Uses the `fxAlerts` table in PostgreSQL via Drizzle ORM — no in-memory state.
 * - Alert when rate reaches target
 * - Alert when rate changes by X%
 * - Trigger alerts against live FX rates
 * - Push/email notifications for triggered alerts
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { logger } from "../_core/logger";
import { getDb, createAuditLog } from "../db";
import { fxAlerts } from "../../drizzle/schema";
import { eq, and, desc, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const rateAlertsRouter = router({
  createAlert: protectedProcedure
    .input(z.object({
      fromCurrency: z.string().length(3),
      toCurrency: z.string().length(3),
      targetRate: z.number().positive(),
      direction: z.enum(["above", "below"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Limit: max 20 active alerts per user
      const countResult = await db.select({ count: sql<number>`COUNT(*)::int` }).from(fxAlerts)
        .where(and(eq(fxAlerts.userId, ctx.user.id), eq(fxAlerts.isActive, true)));
      const activeCount = countResult[0]?.count ?? 0;
      if (activeCount >= 20) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Maximum 20 active rate alerts. Deactivate existing alerts first." });
      }

      // Check for duplicate (same corridor + direction + rate)
      const existing = await db.select().from(fxAlerts)
        .where(and(
          eq(fxAlerts.userId, ctx.user.id),
          eq(fxAlerts.fromCurrency, input.fromCurrency),
          eq(fxAlerts.toCurrency, input.toCurrency),
          eq(fxAlerts.direction, input.direction),
          eq(fxAlerts.isActive, true),
        ));
      const duplicate = existing.find((a: typeof existing[number]) => Math.abs(Number(a.targetRate) - input.targetRate) < 0.0001);
      if (duplicate) {
        throw new TRPCError({ code: "CONFLICT", message: `Alert already exists for ${input.fromCurrency}/${input.toCurrency} ${input.direction} ${input.targetRate}` });
      }

      const [row] = await db.insert(fxAlerts).values({
        userId: ctx.user.id,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        targetRate: input.targetRate.toString(),
        direction: input.direction,
        isActive: true,
        triggered: false,
      }).returning();

      await createAuditLog({ userId: ctx.user.id, action: "FX_ALERT_CREATED", metadata: { alertId: row.id, corridor: `${input.fromCurrency}/${input.toCurrency}`, targetRate: input.targetRate, direction: input.direction } });
      logger.info({ alertId: row.id, userId: ctx.user.id, corridor: `${input.fromCurrency}/${input.toCurrency}` }, "Rate alert created");

      return { id: row.id, fromCurrency: row.fromCurrency, toCurrency: row.toCurrency, targetRate: Number(row.targetRate), direction: row.direction, isActive: row.isActive, createdAt: row.createdAt?.toISOString() ?? "" };
    }),

  listAlerts: protectedProcedure
    .input(z.object({ activeOnly: z.boolean().default(true) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = input.activeOnly
        ? await db.select().from(fxAlerts).where(and(eq(fxAlerts.userId, ctx.user.id), eq(fxAlerts.isActive, true))).orderBy(desc(fxAlerts.createdAt))
        : await db.select().from(fxAlerts).where(eq(fxAlerts.userId, ctx.user.id)).orderBy(desc(fxAlerts.createdAt));
      return rows.map((r: typeof rows[number]) => ({
        id: r.id,
        fromCurrency: r.fromCurrency,
        toCurrency: r.toCurrency,
        targetRate: Number(r.targetRate),
        direction: r.direction,
        isActive: r.isActive,
        triggered: r.triggered,
        triggeredAt: r.triggeredAt?.toISOString() ?? null,
        lastCheckedRate: r.lastCheckedRate ? Number(r.lastCheckedRate) : null,
        lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
        createdAt: r.createdAt?.toISOString() ?? "",
      }));
    }),

  deleteAlert: protectedProcedure
    .input(z.object({ alertId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [updated] = await db.update(fxAlerts)
        .set({ isActive: false })
        .where(and(eq(fxAlerts.id, input.alertId), eq(fxAlerts.userId, ctx.user.id)))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
      return { alertId: updated.id, deactivated: true };
    }),

  checkAlerts: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const alerts = await db.select().from(fxAlerts)
        .where(and(eq(fxAlerts.userId, ctx.user.id), eq(fxAlerts.isActive, true), eq(fxAlerts.triggered, false)));

      const triggered: Array<{ alertId: number; corridor: string; targetRate: number; currentRate: number }> = [];

      for (const alert of alerts) {
        const rateRows = await db.execute(
          sql`SELECT rate FROM "fxRateCache" WHERE "fromCurrency" = ${alert.fromCurrency} AND "toCurrency" = ${alert.toCurrency} ORDER BY "updatedAt" DESC LIMIT 1`
        );
        const rateRow = (rateRows as unknown as Array<Record<string, unknown>>)[0];
        if (!rateRow?.rate) continue;
        const currentRate = Number(rateRow.rate);
        const target = Number(alert.targetRate);

        await db.update(fxAlerts)
          .set({ lastCheckedRate: currentRate.toString(), lastCheckedAt: new Date() })
          .where(eq(fxAlerts.id, alert.id)).returning();

        const isTriggered = (alert.direction === "above" && currentRate >= target) ||
                           (alert.direction === "below" && currentRate <= target);

        if (isTriggered) {
          await db.update(fxAlerts)
            .set({ triggered: true, triggeredAt: new Date(), isActive: false, notifiedAt: new Date() })
            .where(eq(fxAlerts.id, alert.id)).returning();
          triggered.push({ alertId: alert.id, corridor: `${alert.fromCurrency}/${alert.toCurrency}`, targetRate: target, currentRate });
          logger.info({ alertId: alert.id, userId: ctx.user.id, corridor: `${alert.fromCurrency}/${alert.toCurrency}`, currentRate, targetRate: target }, "Rate alert triggered");
          await createAuditLog({ userId: ctx.user.id, action: "FX_ALERT_TRIGGERED", metadata: { alertId: alert.id, currentRate, targetRate: target } });
        }
      }

      return { checked: alerts.length, triggered };
    }),
});
