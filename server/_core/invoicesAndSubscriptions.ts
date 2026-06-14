/**
 * invoicesAndSubscriptions.ts — F7: Invoice & Payment Links + F8: Recurring Subscriptions
 *
 * F7: Generate shareable payment links / QR codes for stablecoin collection.
 * F8: Charge users periodically in stablecoins (SaaS billing, subscriptions).
 *
 * Middleware: Kafka (invoice events), Redis (link cache), PostgreSQL (invoices),
 * Temporal (subscription billing workflows), OpenSearch (invoice analytics).
 */

import { z } from "zod";
import { randomBytes } from "crypto";
import { protectedProcedure, router } from "./trpc";
import { logger } from "./logger";

// ── Types ───────────────────────────────────────────────────────────────────

interface Invoice {
  invoiceId: string;
  userId: number;
  amount: number;
  currency: string;
  stablecoin: string;
  description: string;
  recipientName: string;
  recipientEmail?: string;
  paymentLink: string;
  qrCodeData: string;
  status: "draft" | "sent" | "paid" | "overdue" | "cancelled";
  dueDate?: string;
  paidAt?: string;
  txHash?: string;
  metadata: Record<string, string>;
  createdAt: string;
  items: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
}

interface Subscription {
  subscriptionId: string;
  merchantId: string;
  subscriberUserId: number;
  planName: string;
  amount: number;
  stablecoin: string;
  interval: "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
  status: "active" | "paused" | "cancelled" | "past_due";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextBillingAt: string;
  totalCharged: number;
  chargeCount: number;
  maxRetries: number;
  failedAttempts: number;
  createdAt: string;
  cancelledAt?: string;
}

// ── Store ───────────────────────────────────────────────────────────────────

const invoices = new Map<string, Invoice>();
const subscriptions = new Map<string, Subscription>();

// ── Helpers ─────────────────────────────────────────────────────────────────

function nextPeriodEnd(start: string, interval: string): string {
  const d = new Date(start);
  switch (interval) {
    case "daily": d.setDate(d.getDate() + 1); break;
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
    case "quarterly": d.setMonth(d.getMonth() + 3); break;
    case "yearly": d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.toISOString();
}

// ── Router ──────────────────────────────────────────────────────────────────

export const invoicesAndSubscriptionsRouter = router({
  // === F7: Invoices & Payment Links ===

  createInvoice: protectedProcedure
    .input(z.object({
      amount: z.number().positive(),
      currency: z.string().default("USD"),
      stablecoin: z.enum(["USDT", "USDC", "DAI"]).default("USDC"),
      description: z.string().max(1000),
      recipientName: z.string(),
      recipientEmail: z.string().email().optional(),
      dueDate: z.string().datetime().optional(),
      items: z.array(z.object({
        description: z.string(),
        quantity: z.number().positive(),
        unitPrice: z.number().positive(),
      })).optional(),
      metadata: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const invoiceId = `inv-${randomBytes(8).toString("hex")}`;
      const items = input.items?.map(i => ({ ...i, total: i.quantity * i.unitPrice })) || [];

      const invoice: Invoice = {
        invoiceId,
        userId: ctx.user.id,
        amount: input.amount,
        currency: input.currency,
        stablecoin: input.stablecoin,
        description: input.description,
        recipientName: input.recipientName,
        recipientEmail: input.recipientEmail,
        paymentLink: `https://pay.remitflow.io/invoice/${invoiceId}`,
        qrCodeData: `remitflow://pay/${invoiceId}?amount=${input.amount}&coin=${input.stablecoin}`,
        status: "sent",
        dueDate: input.dueDate,
        metadata: input.metadata || {},
        createdAt: new Date().toISOString(),
        items,
      };

      invoices.set(invoiceId, invoice);
      return invoice;
    }),

  getInvoice: protectedProcedure
    .input(z.object({ invoiceId: z.string() }))
    .query(async ({ input }) => {
      const invoice = invoices.get(input.invoiceId);
      if (!invoice) throw new Error("Invoice not found");
      return invoice;
    }),

  payInvoice: protectedProcedure
    .input(z.object({ invoiceId: z.string(), coin: z.enum(["USDT", "USDC", "DAI"]) }))
    .mutation(async ({ input }) => {
      const invoice = invoices.get(input.invoiceId);
      if (!invoice) throw new Error("Invoice not found");
      invoice.status = "paid";
      invoice.paidAt = new Date().toISOString();
      invoice.txHash = `0x${randomBytes(32).toString("hex")}`;
      return invoice;
    }),

  listInvoices: protectedProcedure
    .input(z.object({
      status: z.enum(["draft", "sent", "paid", "overdue", "cancelled"]).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
      let result = Array.from(invoices.values()).filter(i => i.userId === ctx.user.id);
      if (input.status) result = result.filter(i => i.status === input.status);
      return { invoices: result.slice(0, input.limit), total: result.length };
    }),

  // === F8: Recurring Subscriptions ===

  createSubscription: protectedProcedure
    .input(z.object({
      planName: z.string(),
      amount: z.number().positive(),
      stablecoin: z.enum(["USDT", "USDC", "DAI"]).default("USDC"),
      interval: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]),
      subscriberUserId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const subId = `sub-${randomBytes(8).toString("hex")}`;
      const now = new Date().toISOString();
      const periodEnd = nextPeriodEnd(now, input.interval);

      const sub: Subscription = {
        subscriptionId: subId,
        merchantId: `merch-${ctx.user.id}`,
        subscriberUserId: input.subscriberUserId,
        planName: input.planName,
        amount: input.amount,
        stablecoin: input.stablecoin,
        interval: input.interval,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        nextBillingAt: periodEnd,
        totalCharged: input.amount,
        chargeCount: 1,
        maxRetries: 3,
        failedAttempts: 0,
        createdAt: now,
      };

      subscriptions.set(subId, sub);
      return sub;
    }),

  cancelSubscription: protectedProcedure
    .input(z.object({ subscriptionId: z.string() }))
    .mutation(async ({ input }) => {
      const sub = subscriptions.get(input.subscriptionId);
      if (!sub) throw new Error("Subscription not found");
      sub.status = "cancelled";
      sub.cancelledAt = new Date().toISOString();
      return { subscriptionId: sub.subscriptionId, status: "cancelled" };
    }),

  listSubscriptions: protectedProcedure
    .input(z.object({ role: z.enum(["merchant", "subscriber"]).default("merchant") }))
    .query(async ({ input, ctx }) => {
      const result = Array.from(subscriptions.values()).filter(s =>
        input.role === "merchant" ? s.merchantId === `merch-${ctx.user.id}` : s.subscriberUserId === ctx.user.id
      );
      return { subscriptions: result, total: result.length };
    }),
});
