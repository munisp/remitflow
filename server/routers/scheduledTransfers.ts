/**
 * Scheduled Transfers Router (v117)
 * Full CRUD for recurring/scheduled transfer management.
 * Wraps the scheduledTransfers DB table with proper tRPC procedures.
 */
import { router, protectedProcedure, rateLimitedProcedure } from "../_core/trpc.js";
import { z } from "zod";
import { getDb } from "../db.js";
import { scheduledTransfers, scheduledTransferRuns } from "../../drizzle/schema.js";
import { eq, and, desc, gte } from "drizzle-orm";
import { sendEmail } from "../email.service.js";
import { TRPCError } from "@trpc/server";

const frequencyEnum = z.enum(["once", "daily", "weekly", "biweekly", "monthly"]);

export const scheduledTransfersV117Router = router({
  /** Create a new scheduled / recurring transfer */
  create: rateLimitedProcedure
    .input(
      z.object({
        beneficiaryId: z.number().int().positive().optional(),
        fromCurrency: z.string().length(3),
        toCurrency: z.string().length(3),
        amount: z.number().positive(),
        frequency: frequencyEnum,
        startDate: z.string().datetime(), // ISO string
        maxRuns: z.number().int().positive().optional(),
        description: z.string().max(200).optional(),
        promoCode: z.string().max(50).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const nextRunAt = new Date(input.startDate);
      const [row] = await db
        .insert(scheduledTransfers)
        .values({
          userId: ctx.user.id,
          beneficiaryId: input.beneficiaryId ?? null,
          fromCurrency: input.fromCurrency,
          toCurrency: input.toCurrency,
          amount: input.amount.toString(),
          frequency: input.frequency,
          nextRunAt,
          maxRuns: input.maxRuns ?? null,
          status: "active",
          description: input.description ?? null,
          promoCode: input.promoCode ?? null,
        })
        .returning();

      // Send confirmation email
      const user = ctx.user as { email?: string; name?: string };
      if (user.email) {
        await sendEmail({
          to: user.email,
          subject: `Scheduled Transfer Created — ${input.fromCurrency} ${input.amount} (${input.frequency})`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:auto">
              <h2 style="color:#1a56db">Scheduled Transfer Confirmed</h2>
              <p>Hi ${user.name ?? "there"},</p>
              <p>Your scheduled transfer has been set up:</p>
              <table style="width:100%;border-collapse:collapse">
                <tr><td style="padding:8px;border:1px solid #e5e7eb">Amount</td><td style="padding:8px;border:1px solid #e5e7eb"><strong>${input.fromCurrency} ${input.amount.toFixed(2)}</strong></td></tr>
                <tr><td style="padding:8px;border:1px solid #e5e7eb">To</td><td style="padding:8px;border:1px solid #e5e7eb"><strong>${input.toCurrency}</strong></td></tr>
                <tr><td style="padding:8px;border:1px solid #e5e7eb">Frequency</td><td style="padding:8px;border:1px solid #e5e7eb"><strong>${input.frequency}</strong></td></tr>
                <tr><td style="padding:8px;border:1px solid #e5e7eb">First Run</td><td style="padding:8px;border:1px solid #e5e7eb"><strong>${nextRunAt.toLocaleDateString()}</strong></td></tr>
              </table>
            </div>`,
          text: `Scheduled Transfer: ${input.fromCurrency} ${input.amount} → ${input.toCurrency} (${input.frequency}). First run: ${nextRunAt.toLocaleDateString()}.`,
        });
      }

      return row;
    }),

  /** List all scheduled transfers for the current user */
  list: protectedProcedure
    .input(z.object({ status: z.enum(["active", "paused", "completed", "cancelled", "all"]).default("all") }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const query = db
        .select()
        .from(scheduledTransfers)
        .where(
          input.status === "all"
            ? eq(scheduledTransfers.userId, ctx.user.id)
            : and(eq(scheduledTransfers.userId, ctx.user.id), eq(scheduledTransfers.status, input.status))
        )
        .orderBy(desc(scheduledTransfers.createdAt))
        .limit(100);
      return query;
    }),

  /** Get a single scheduled transfer */
  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [row] = await db
        .select()
        .from(scheduledTransfers)
        .where(and(eq(scheduledTransfers.id, input.id), eq(scheduledTransfers.userId, ctx.user.id)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return row;
    }),

  /** Update a scheduled transfer (amount, frequency, next run date) */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        amount: z.number().positive().optional(),
        frequency: frequencyEnum.optional(),
        nextRunAt: z.string().datetime().optional(),
        maxRuns: z.number().int().positive().nullable().optional(),
        description: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const updates: Record<string, unknown> = {};
      if (input.amount !== undefined) updates.amount = input.amount.toString();
      if (input.frequency !== undefined) updates.frequency = input.frequency;
      if (input.nextRunAt !== undefined) updates.nextRunAt = new Date(input.nextRunAt);
      if (input.maxRuns !== undefined) updates.maxRuns = input.maxRuns;
      if (input.description !== undefined) updates.description = input.description;
      const [row] = await db
        .update(scheduledTransfers)
        .set(updates)
        .where(and(eq(scheduledTransfers.id, input.id), eq(scheduledTransfers.userId, ctx.user.id)))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return row;
    }),

  /** Pause a scheduled transfer */
  pause: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [row] = await db
        .update(scheduledTransfers)
        .set({ status: "paused" })
        .where(and(eq(scheduledTransfers.id, input.id), eq(scheduledTransfers.userId, ctx.user.id)))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return row;
    }),

  /** Resume a paused scheduled transfer */
  resume: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [row] = await db
        .update(scheduledTransfers)
        .set({ status: "active" })
        .where(and(eq(scheduledTransfers.id, input.id), eq(scheduledTransfers.userId, ctx.user.id)))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return row;
    }),

  /** Cancel a scheduled transfer */
  cancel: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [row] = await db
        .update(scheduledTransfers)
        .set({ status: "cancelled" })
        .where(and(eq(scheduledTransfers.id, input.id), eq(scheduledTransfers.userId, ctx.user.id)))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return row;
    }),

  /** Get run history for a scheduled transfer */
  runs: protectedProcedure
    .input(z.object({ scheduleId: z.number().int().positive(), limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      return db
        .select()
        .from(scheduledTransferRuns)
        .where(
          and(
            eq(scheduledTransferRuns.scheduleId, input.scheduleId),
            eq(scheduledTransferRuns.userId, ctx.user.id)
          )
        )
        .orderBy(desc(scheduledTransferRuns.executedAt))
        .limit(input.limit);
    }),
});
