import { router, protectedProcedure } from "../_core/trpc";
import { randomBytes } from "crypto";
import { createAuditLog } from "../audit.service";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { diasporaProfiles, diasporaOfferClaims, transfers } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";

const OUTBOUND_SWIFT_URL = process.env.OUTBOUND_SWIFT_URL ?? "http://go-outbound-swift:8090";

async function getOrCreateDiasporaProfile(userId: number, region: string) {
  const db = await getDb();
  const [existing] = await db.select().from(diasporaProfiles)
    .where(and(eq(diasporaProfiles.userId, userId), eq(diasporaProfiles.diasporaRegion, region)));
  if (existing) return existing;

  await db.insert(diasporaProfiles).values({
    userId,
    diasporaRegion: region,
    countryOfResidence: region === "usa" ? "US" : "EU",
    homeCorridor: "NG",
    preferredPaymentRail: region === "usa" ? "ach" : "sepa",
    avgTransferAmountUsd: "0",
    transferFrequencyPerYear: "0",
    totalTransferredYtdUsd: "0",
    crossSellScore: "0",
    acquisitionChannel: "organic",
    createdAt: new Date(),
  }).returning();

  const [created] = await db.select().from(diasporaProfiles)
    .where(and(eq(diasporaProfiles.userId, userId), eq(diasporaProfiles.diasporaRegion, region)));
  return created;
}

export const diasporaUSARouter = router({
  getDiasporaProfile: protectedProcedure.query(async ({ ctx }) => {
    return getOrCreateDiasporaProfile(ctx.user.id, "usa");
  }),

  getAcquisitionOffers: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const claimed = await db.select().from(diasporaOfferClaims)
      .where(eq(diasporaOfferClaims.userId, ctx.user.id));
    const claimedTypes = new Set(claimed.map((c: any) => c.offerType));

    const allOffers = [
      {
        offerType: "zero_fee_first_transfer",
        title: "Zero Fees on Your First Transfer",
        description: "Send money to Nigeria for free on your first transfer. No fees, no catches.",
        value: "Save up to $25",
        expiresInDays: 30,
        ctaText: "Send Now — Free",
      },
      {
        offerType: "ach_cashback",
        title: "1% ACH Cashback",
        description: "Earn 1% cashback on every ACH transfer to Nigeria for your first 3 months.",
        value: "Up to $50 cashback",
        expiresInDays: 90,
        ctaText: "Activate Cashback",
      },
      {
        offerType: "referral_bonus",
        title: "Refer a Friend — Earn $10",
        description: "Invite friends in the USA to RemitFlow. Earn $10 for each friend who completes their first transfer.",
        value: "$10 per referral",
        expiresInDays: 365,
        ctaText: "Get Referral Code",
      },
    ];

    return allOffers.map(o => ({ ...o, claimed: claimedTypes.has(o.offerType) }));
  }),

  getAchRates: protectedProcedure.query(async () => {
    try {
      const res = await fetch(`${OUTBOUND_SWIFT_URL}/quote?corridor=US&rail=ach&amount=100`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return res.json();
    } catch { /* fall through */ }
    return {
      corridor: "US",
      rail: "ach",
      usd_per_ngn: 0.000617,
      fee_usd: 3.99,
      fee_pct: 0,
      settlement_time: "1-2 business days",
      min_amount_usd: 10,
      max_amount_usd: 10000,
      source: "fallback",
    };
  }),

  submitAchTransfer: protectedProcedure
    .input(z.object({
      amountUsd: z.number().positive().max(10_000),
      recipientRoutingNumber: z.string().length(9),
      recipientAccountNumber: z.string().min(4).max(17),
      recipientName: z.string().min(2).max(100),
      recipientBankName: z.string().min(2).max(100).optional(),
      memo: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const transferId = `ACH-${Date.now()}-${ctx.user.id}`;

      await db.insert(transfers).values({
        userId: ctx.user.id,
        transferType: "outbound",
        rail: "ach",
        corridorCode: "US",
        amountNgn: (input.amountUsd * 1620).toFixed(2),
        amountForeign: input.amountUsd.toFixed(2),
        foreignCurrency: "USD",
        recipientName: input.recipientName,
        recipientAccount: input.recipientAccountNumber,
        status: "pending",
        createdAt: new Date(),
      }).returning();

      return {
        transferId,
        status: "pending",
        estimatedSettlement: "1-2 business days",
        amountUsd: input.amountUsd,
      };
    }),

  getAchTransferHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      return db.select().from(transfers)
        .where(and(eq(transfers.userId, ctx.user.id), eq(transfers.rail, "ach")))
        .orderBy(desc(transfers.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  claimWelcomeOffer: protectedProcedure
    .input(z.object({ offerType: z.enum(["zero_fee_first_transfer", "ach_cashback", "referral_bonus"]) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const [existing] = await db.select().from(diasporaOfferClaims)
        .where(and(
          eq(diasporaOfferClaims.userId, ctx.user.id),
          eq(diasporaOfferClaims.offerType, input.offerType),
        ));
      if (existing) throw new TRPCError({ code: "BAD_REQUEST", message: "Offer already claimed" });

      await db.insert(diasporaOfferClaims).values({
        userId: ctx.user.id,
        offerType: input.offerType,
        diasporaRegion: "usa",
        status: "active",
        claimedAt: new Date(),
      }).returning();

      return { success: true, verified: true, offerType: input.offerType };
    }),

  getReferralCode: protectedProcedure.query(async ({ ctx }) => {
    const code = `RF-USA-${ctx.user.id}-${randomBytes(3).toString("hex").toUpperCase()}`;
    return { referralCode: code, shareUrl: `https://remitflow.app/join?ref=${code}` };
  }),
});
