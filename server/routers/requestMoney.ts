import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { z } from "zod";
import { paymentRequests, transactions } from "../../drizzle/schema.js";
import { getDb, createTransaction } from "../db.js";
import { protectedProcedure, publicProcedure, router, rateLimitedProcedure } from "../_core/trpc.js";
import { sendEmail } from "../email.service.js";

export const requestMoneyRouter = router({
  // Create a new payment request (Request Money)
  create: protectedProcedure
    .input(z.object({
      amount: z.number().positive().optional(),
      currency: z.string().default("USD"),
      description: z.string().max(256).optional(),
      expiresInHours: z.number().min(1).max(168).default(48),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + input.expiresInHours * 3600 * 1000);
      const [req] = await db.insert(paymentRequests).values({
        requesterId: ctx.user.id,
        amount: input.amount?.toString(),
        currency: input.currency,
        description: input.description,
        token,
        status: "pending",
        expiresAt,
      }).returning();
      const paymentLink = `${ctx.req.headers.origin || (process.env.APP_URL ?? "https://remitflow.example.com")}/pay/${token}`;
      return { id: req.id, token, paymentLink, expiresAt };
    }),

  // List all payment requests created by the current user
  list: protectedProcedure
    .input(z.object({
      status: z.enum(["pending", "paid", "expired", "cancelled"]).optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const conditions = [eq(paymentRequests.requesterId, ctx.user.id)];
      if (input.status) conditions.push(eq(paymentRequests.status, input.status));
      const rows = await db.select().from(paymentRequests)
        .where(and(...conditions))
        .orderBy(desc(paymentRequests.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      return rows;
    }),

  // Get a single payment request by token (public — for the payer to view)
  getByToken: publicProcedure
    .input(z.object({ token: z.string().length(64) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [req] = await db.select().from(paymentRequests)
        .where(eq(paymentRequests.token, input.token));
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Payment request not found" });
      if (req.status === "expired" || (req.expiresAt && req.expiresAt < new Date())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Payment request has expired" });
      }
      return req;
    }),

  // Pay a payment request (authenticated payer)
  pay: protectedProcedure
    .input(z.object({
      token: z.string().length(64),
      amount: z.number().positive().optional(), // override if request has no fixed amount
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [req] = await db.select().from(paymentRequests)
        .where(eq(paymentRequests.token, input.token));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });
      if (req.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "Payment request is no longer active" });
      if (req.expiresAt && req.expiresAt < new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "Payment request has expired" });
      const payAmount = input.amount ?? (req.amount ? Number(req.amount) : null);
      if (!payAmount) throw new TRPCError({ code: "BAD_REQUEST", message: "Amount is required" });
      // Create transaction for the payer
      const txRef = await createTransaction({
        userId: ctx.user.id,
        type: "send",
        status: "completed",
        fromCurrency: req.currency,
        fromAmount: payAmount.toString(),
        fee: "0",
        description: req.description ?? `Payment request #${req.id}`,
      });
      // Mark request as paid
      await db.update(paymentRequests)
        .set({ status: "paid", payerUserId: ctx.user.id, paidAt: new Date(), updatedAt: new Date() })
        .where(eq(paymentRequests.id, req.id));
      return { success: true, transactionRef: txRef };
    }),

  // Send a payment request via email to a specific recipient
  sendViaEmail: protectedProcedure
    .input(z.object({
      recipientEmail: z.string().email(),
      recipientName: z.string().min(1).max(100),
      amount: z.number().positive().optional(),
      currency: z.string().default("USD"),
      note: z.string().max(500).optional(),
      expiresInHours: z.number().min(1).max(168).default(48),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + input.expiresInHours * 3600 * 1000);
      const [req] = await db.insert(paymentRequests).values({
        requesterId: ctx.user.id,
        amount: input.amount?.toString(),
        currency: input.currency,
        description: input.note,
        token,
        status: "pending",
        expiresAt,
      } as any).returning();
      const paymentLink = `https://remitflow.example.com/pay/${token}`;
      const senderName = (ctx.user as any).name ?? "Someone";
      const amountStr = input.amount ? `${input.currency} ${input.amount.toFixed(2)}` : "an amount";
      const emailSent = await sendEmail({
        to: input.recipientEmail,
        subject: `${senderName} is requesting ${amountStr} via RemitFlow`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:auto"><h2 style="color:#1a56db">Payment Request</h2><p>Hi ${input.recipientName},</p><p><strong>${senderName}</strong> is requesting payment from you:</p>${input.amount ? `<p style="font-size:2rem;font-weight:bold;color:#1a56db">${input.currency} ${input.amount.toFixed(2)}</p>` : ""}${input.note ? `<p style="color:#374151">Note: ${input.note}</p>` : ""}<a href="${paymentLink}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Pay Now</a><p style="color:#6b7280;font-size:0.85rem">This link expires in ${input.expiresInHours} hours.</p></div>`,
        text: `${senderName} is requesting ${amountStr}. Pay here: ${paymentLink}`,
      });
      return { id: req.id, token, paymentLink, expiresAt, emailSent };
    }),

  // Cancel a payment request (requester only)
  cancel: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [req] = await db.select().from(paymentRequests)
        .where(and(eq(paymentRequests.id, input.id), eq(paymentRequests.requesterId, ctx.user.id)));
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });
      if (req.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "Only pending requests can be cancelled" });
      await db.update(paymentRequests)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(paymentRequests.id, input.id));
      const ts = new Date();
      return { success: true, updatedAt: ts.toISOString(), serverTime: ts.getTime() };
    }),
});
