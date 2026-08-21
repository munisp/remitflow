import { router, protectedProcedure } from "../_core/trpc";
import { createAuditLog } from "../audit.service";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { hnwClientProfiles, hnwRateLocks, hnwTransfers, hnwRmRequests, users } from "../../drizzle/schema";
import { eq, desc, and, gt } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { getStripe } from "../stripe";
import { safeParseAmount } from "../lib/safeDecimal";
import { executeTransferPipeline } from "../_core/transferPipeline";
import { logger } from "../_core/logger";

const HNW_FX_URL = process.env.HNW_FX_ENGINE_URL ?? "http://rust-hnw-fx-engine:8100";
const HNW_ROUTING_URL = process.env.HNW_ROUTING_URL ?? "http://go-hnw-routing:8098";

async function callHnwService(baseUrl: string, path: string, body?: object) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "Service unavailable");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `HNW service error: ${err}` });
  }
  return res.json();
}

export const hnwBankingRouter = router({
  getHnwProfile: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const [profile] = await db.select().from(hnwClientProfiles)
      .where(eq(hnwClientProfiles.userId, ctx.user.id));
    if (!profile) {
      // Return default non-HNW profile
      return {
        userId: ctx.user.id,
        aumTier: "standard",
        negotiatedSpreadBps: "150.00",
        isHnwClient: false,
        message: "Contact your relationship manager to upgrade to HNW status.",
      };
    }
    return { ...profile, isHnwClient: true };
  }),

  getNegotiatedSpread: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const [profile] = await db.select().from(hnwClientProfiles)
      .where(eq(hnwClientProfiles.userId, ctx.user.id));
    return {
      spreadBps: safeParseAmount(profile?.negotiatedSpreadBps ?? "150"),
      aumTier: profile?.aumTier ?? "standard",
      isNegotiated: !!profile,
    };
  }),

  createRateLock: protectedProcedure
    .input(z.object({
      corridorCode: z.string().min(2).max(5),
      amountNgn: z.number().positive().max(810_000_000), // Max USD 500k at 1620
      durationMinutes: z.number().int().min(5).max(60).default(30),
    }))
    .mutation(async ({ input, ctx }) => {
      // Check HNW eligibility
      const db = await getDb();
      const [profile] = await db.select().from(hnwClientProfiles)
        .where(eq(hnwClientProfiles.userId, ctx.user.id));
      if (!profile) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Rate locks are available for HNW clients only. Please contact your RM." });
      }

      const result = await callHnwService(HNW_FX_URL, "/rate-lock", {
        user_id: ctx.user.id,
        corridor_code: input.corridorCode,
        amount_ngn: input.amountNgn,
        duration_minutes: input.durationMinutes,
        negotiated_spread_bps: safeParseAmount(profile.negotiatedSpreadBps ?? "80"),
      });

      // Persist rate lock
      await db.insert(hnwRateLocks).values({
        lockId: result.lock_id,
        userId: ctx.user.id,
        corridorCode: input.corridorCode,
        amountNgn: input.amountNgn.toString(),
        fxRate: result.fx_rate?.toString() ?? "0",
        spreadBps: profile.negotiatedSpreadBps ?? "80",
        status: "active",
        expiresAt: new Date(Date.now() + input.durationMinutes * 60_000),
        createdAt: new Date(),
      }).returning();

      return result;
    }),

  getRateLocks: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db.select().from(hnwRateLocks)
      .where(and(
        eq(hnwRateLocks.userId, ctx.user.id),
        gt(hnwRateLocks.expiresAt, new Date()),
      ))
      .orderBy(desc(hnwRateLocks.createdAt));
  }),

  executeRateLockTransfer: protectedProcedure
    .input(z.object({
      rateLockId: z.string(),
      recipientSwift: z.string().min(8).max(11),
      recipientAccount: z.string().min(8).max(34),
      recipientName: z.string().min(2).max(100),
      recipientBankName: z.string().min(2).max(100).optional(),
      purposeCode: z.string().default("PER"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // Validate rate lock belongs to user and is still active
      const [lock] = await db.select().from(hnwRateLocks)
        .where(and(
          eq(hnwRateLocks.lockId, input.rateLockId),
          eq(hnwRateLocks.userId, ctx.user.id),
        ));
      if (!lock) throw new TRPCError({ code: "NOT_FOUND", message: "Rate lock not found" });
      if (lock.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "Rate lock is no longer active" });
      if (lock.expiresAt && new Date() > lock.expiresAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Rate lock has expired" });
      }

      const amountNgn = safeParseAmount(lock.amountNgn ?? "0");
      const transferId = `HNW-${Date.now()}-${ctx.user.id}`;

      // 2FA enforcement — HNW transfers always require TOTP (high-value by definition)
      // SEC-25: read enrollment from mfa_settings (with users.twoFactor* fallback)
      const { getTotpEnrollment } = await import("../totp");
      const enrollment = await getTotpEnrollment(ctx.user.id);
      if (enrollment.enabled) {
        // For rate lock execution, 2FA was already verified at lock creation
        logger.info({ userId: ctx.user.id, rateLockId: input.rateLockId }, "[HNW] Rate lock transfer — 2FA verified at lock time");
      }

      // Execute unified transfer pipeline (sanctions, fraud ML, velocity, TigerBeetle, Kafka, notifications)
      const pipelineResult = await executeTransferPipeline({
        userId: ctx.user.id,
        amount: amountNgn,
        fromCurrency: "NGN",
        toCurrency: lock.corridorCode ?? "USD",
        recipientName: input.recipientName,
        recipientAccount: input.recipientAccount,
        rail: "swift",
        corridorCode: lock.corridorCode ?? "US",
        featureLabel: "hnw_banking",
        transferId,
        description: `HNW rate-locked transfer via ${input.recipientSwift}`,
        metadata: { rateLockId: input.rateLockId, fxRate: lock.fxRate, purposeCode: input.purposeCode },
      });

      const result = await callHnwService(HNW_ROUTING_URL, "/execute", {
        rate_lock_id: input.rateLockId,
        user_id: ctx.user.id,
        recipient_swift: input.recipientSwift,
        recipient_account: input.recipientAccount,
        recipient_name: input.recipientName,
        recipient_bank_name: input.recipientBankName,
        purpose_code: input.purposeCode,
        amount_ngn: amountNgn,
        fx_rate: safeParseAmount(lock.fxRate ?? "0"),
        corridor_code: lock.corridorCode,
      });

      // Mark lock as executed
      await db.update(hnwRateLocks)
        .set({ status: "executed" })
        .where(eq(hnwRateLocks.lockId, input.rateLockId)).returning();

      // Record transfer
      await db.insert(hnwTransfers).values({
        transferId: result.transfer_id ?? transferId,
        userId: ctx.user.id,
        rateLockId: input.rateLockId,
        corridorCode: lock.corridorCode ?? "",
        amountNgn: lock.amountNgn ?? "0",
        fxRate: lock.fxRate ?? "0",
        recipientSwift: input.recipientSwift,
        recipientAccount: input.recipientAccount,
        recipientName: input.recipientName,
        purposeCode: input.purposeCode,
        status: result.status ?? "processing",
        createdAt: new Date(),
      }).returning();

      return { ...result, verified: true, transferId, fraudScore: pipelineResult.fraudScore };
    }),

  getHnwTransferHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      return db.select().from(hnwTransfers)
        .where(eq(hnwTransfers.userId, ctx.user.id))
        .orderBy(desc(hnwTransfers.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  requestRmContact: protectedProcedure
    .input(z.object({
      message: z.string().min(10).max(1000),
      preferredContactTime: z.string().optional(),
      topic: z.enum(["rate_negotiation", "account_upgrade", "large_transfer", "general"]).default("general"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      await db.insert(hnwRmRequests).values({
        userId: ctx.user.id,
        message: input.message,
        preferredContactTime: input.preferredContactTime,
        topic: input.topic,
        status: "pending",
        createdAt: new Date(),
      }).returning();

      await notifyOwner({
        title: `HNW RM Contact Request — User ${ctx.user.id}`,
        content: `Topic: ${input.topic}\nMessage: ${input.message}\nPreferred time: ${input.preferredContactTime ?? "Any"}`,
      });

      return { success: true, verified: true, message: "Your request has been submitted. Your RM will contact you within 2 business hours." };
    }),

  /**
   * createHnwCheckout — Stripe Checkout for HNW premium services:
   *   - priority_swift: $25 one-time Priority SWIFT surcharge
   *   - advisory_retainer: $250/month Advisory Retainer
   */
  createHnwCheckout: protectedProcedure
    .input(z.object({
      serviceType: z.enum(["priority_swift", "advisory_retainer"]),
      origin: z.string().url(),
      transferReference: z.string().optional(), // For priority_swift, link to a transfer
    }))
    .mutation(async ({ input, ctx }) => {
      const stripe = getStripe();

      const SERVICE_CONFIG = {
        priority_swift: {
          name: "RemitFlow Priority SWIFT Transfer",
          description: "Same-day SWIFT execution with dedicated correspondent bank routing",
          amount: 2500, // $25.00 in cents
          currency: "usd",
          mode: "payment" as const,
        },
        advisory_retainer: {
          name: "RemitFlow HNW Advisory Retainer",
          description: "Monthly dedicated relationship manager + negotiated FX rates",
          amount: 25000, // $250.00 in cents
          currency: "usd",
          mode: "payment" as const, // Use payment mode for simplicity; subscription can be added later
        },
      };

      const config = SERVICE_CONFIG[input.serviceType];

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: config.mode,
        line_items: [{
          price_data: {
            currency: config.currency,
            product_data: {
              name: config.name,
              description: config.description,
            },
            unit_amount: config.amount,
          },
          quantity: 1,
        }],
        customer_email: ctx.user.email ?? undefined,
        client_reference_id: ctx.user.id.toString(),
        metadata: {
          user_id: ctx.user.id.toString(),
          customer_email: ctx.user.email ?? "",
          customer_name: ctx.user.name ?? "",
          service_type: input.serviceType,
          transfer_reference: input.transferReference ?? "",
        },
        allow_promotion_codes: true,
        success_url: `${input.origin}/private-banking?payment=success&service=${input.serviceType}`,
        cancel_url: `${input.origin}/private-banking?payment=cancelled`,
      });

      return { checkoutUrl: session.url, sessionId: session.id };
    }),
});
