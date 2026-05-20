/**
 * Split Bill Router
 * Allows a user to split a payment request among multiple participants.
 * Each participant gets their own unique payment link.
 */
import { router, protectedProcedure, rateLimitedProcedure } from "../_core/trpc.js";
import { z } from "zod";
import { getDb } from "../db.js";
import { splitBillGroups, splitBillParticipants } from "../../drizzle/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { sendEmail } from "../email.service.js";
import { TRPCError } from "@trpc/server";
import crypto from "crypto";

export const splitBillRouter = router({
  /** Create a split bill — one group, N participant shares */
  create: rateLimitedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        totalAmount: z.number().positive(),
        currency: z.string().length(3),
        participants: z
          .array(
            z.object({
              name: z.string().min(1),
              email: z.string().email().optional(),
              shareAmount: z.number().positive(),
            })
          )
          .min(2)
          .max(50),
        expiresInDays: z.number().int().min(1).max(30).default(7),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);
      const groupId = crypto.randomUUID();

      // Create the group record
      await db.insert(splitBillGroups).values({
        groupId,
        creatorId: ctx.user.id,
        title: input.title,
        totalAmount: input.totalAmount.toString(),
        currency: input.currency,
        note: input.note ?? null,
        status: "active",
        expiresAt,
      } as any);

      // Create one participant record per person
      const created: { id: number; token: string; name: string; email?: string; amount: number }[] = [];

      for (const p of input.participants) {
        const token = crypto.randomBytes(24).toString("hex");
        const [row] = await db
          .insert(splitBillParticipants)
          .values({
            groupId,
            name: p.name,
            email: p.email ?? null,
            shareAmount: p.shareAmount.toString(),
            token,
            status: "pending",
          } as any)
          .returning({ id: splitBillParticipants.id });

        created.push({ id: row.id, token, name: p.name, email: p.email, amount: p.shareAmount });
      }

      // Send emails to participants who have an email address
      for (const c of created) {
        if (c.email) {
          const payLink = `${ctx.req?.headers?.origin ?? "https://remitflow.app"}/pay-request?token=${c.token}`;
          await sendEmail({
            to: c.email,
            subject: `You owe ${input.currency} ${c.amount.toFixed(2)} — ${input.title}`,
            html: `
              <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
                <h2 style="color:#1a56db">Split Bill: ${input.title}</h2>
                <p>Hi ${c.name},</p>
                <p>You have been added to a split bill. Your share is:</p>
                <p style="font-size:2rem;font-weight:bold;color:#1a56db">${input.currency} ${c.amount.toFixed(2)}</p>
                <a href="${payLink}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">Pay Now</a>
                <p style="color:#6b7280;font-size:0.85rem">This link expires in ${input.expiresInDays} days.</p>
              </div>`,
            text: `Split Bill: ${input.title}\nYour share: ${input.currency} ${c.amount.toFixed(2)}\nPay here: ${payLink}`,
          }).catch(() => {/* email failure is non-fatal */});
        }
      }

      return { groupId, participants: created };
    }),

  /** List all split bill groups created by the current user */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    const groups = await db
      .select()
      .from(splitBillGroups)
      .where(eq(splitBillGroups.creatorId, ctx.user.id))
      .orderBy(desc(splitBillGroups.createdAt))
      .limit(50);

    // For each group, get participant counts
    const result = await Promise.all(
      groups.map(async (g: any) => {
        const participants = await db
          .select({ id: splitBillParticipants.id, status: splitBillParticipants.status })
          .from(splitBillParticipants)
          .where(eq(splitBillParticipants.groupId, g.groupId));
        return {
          ...g,
          participants: participants.length,
          paid: participants.filter((p: any) => p.status === "paid").length,
        };
      })
    );

    return result;
  }),

  /** Get details of a specific split bill group */
  getGroup: protectedProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [group] = await db
        .select()
        .from(splitBillGroups)
        .where(and(eq(splitBillGroups.groupId, input.groupId), eq(splitBillGroups.creatorId, ctx.user.id)));

      if (!group) throw new TRPCError({ code: "NOT_FOUND" });

      const participants = await db
        .select()
        .from(splitBillParticipants)
        .where(eq(splitBillParticipants.groupId, input.groupId));

      return { ...group, participantList: participants };
    }),

  /** Cancel a split bill group (expire all pending participants) */
  cancel: protectedProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Verify ownership
      const [group] = await db
        .select()
        .from(splitBillGroups)
        .where(and(eq(splitBillGroups.groupId, input.groupId), eq(splitBillGroups.creatorId, ctx.user.id)));

      if (!group) throw new TRPCError({ code: "NOT_FOUND" });

      // Update group status
      await db
        .update(splitBillGroups)
        .set({ status: "cancelled" } as any)
        .where(eq(splitBillGroups.groupId, input.groupId));

      // Expire pending participants
      const participants = await db
        .select()
        .from(splitBillParticipants)
        .where(eq(splitBillParticipants.groupId, input.groupId));

      let cancelled = 0;
      for (const p of participants) {
        if (p.status === "pending") {
          await db
            .update(splitBillParticipants)
            .set({ status: "expired" } as any)
            .where(eq(splitBillParticipants.id, p.id));
          cancelled++;
        }
      }

      return { cancelled };
    }),

  /** Resend email to a specific participant */
  resendEmail: protectedProcedure
    .input(z.object({ participantId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [participant] = await db
        .select()
        .from(splitBillParticipants)
        .where(eq(splitBillParticipants.id, input.participantId));

      if (!participant) throw new TRPCError({ code: "NOT_FOUND" });
      if (!participant.email) throw new TRPCError({ code: "BAD_REQUEST", message: "No email for this participant" });

      // Verify creator owns the group
      const [group] = await db
        .select()
        .from(splitBillGroups)
        .where(and(eq(splitBillGroups.groupId, participant.groupId), eq(splitBillGroups.creatorId, ctx.user.id)));

      if (!group) throw new TRPCError({ code: "FORBIDDEN" });

      const payLink = `${ctx.req?.headers?.origin ?? "https://remitflow.app"}/pay-request?token=${participant.token}`;
      await sendEmail({
        to: participant.email,
        subject: `Reminder: You owe ${group.currency} ${Number(participant.shareAmount).toFixed(2)} — ${group.title}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
            <h2 style="color:#1a56db">Payment Reminder: ${group.title}</h2>
            <p>Hi ${participant.name},</p>
            <p>This is a reminder that your payment is still pending:</p>
            <p style="font-size:2rem;font-weight:bold;color:#1a56db">${group.currency} ${Number(participant.shareAmount).toFixed(2)}</p>
            <a href="${payLink}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">Pay Now</a>
          </div>`,
        text: `Reminder: ${group.title}\nAmount due: ${group.currency} ${Number(participant.shareAmount).toFixed(2)}\nPay here: ${payLink}`,
      });

      return { sent: true };
    }),
});
