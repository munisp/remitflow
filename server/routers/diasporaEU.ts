import { router, protectedProcedure } from "../_core/trpc";
import { createAuditLog } from "../audit.service";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { diasporaProfiles, diasporaOfferClaims, transfers } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";

const OUTBOUND_SWIFT_URL = process.env.OUTBOUND_SWIFT_URL ?? "http://go-outbound-swift:8090";

const euCountrySchema = z.enum(["IT", "DE", "FR", "ES", "NL", "BE", "PT", "CA"]);

export const diasporaEURouter = router({
  getDiasporaProfile: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const [existing] = await db.select().from(diasporaProfiles)
      .where(and(eq(diasporaProfiles.userId, ctx.user.id), eq(diasporaProfiles.diasporaRegion, "eu")));
    if (existing) return existing;

    await db.insert(diasporaProfiles).values({
      userId: ctx.user.id,
      diasporaRegion: "eu",
      countryOfResidence: "IT",
      homeCorridor: "NG",
      preferredPaymentRail: "sepa",
      avgTransferAmountUsd: "0",
      transferFrequencyPerYear: "0",
      totalTransferredYtdUsd: "0",
      crossSellScore: "0",
      acquisitionChannel: "organic",
      createdAt: new Date(),
    }).returning();

    const [created] = await db.select().from(diasporaProfiles)
      .where(and(eq(diasporaProfiles.userId, ctx.user.id), eq(diasporaProfiles.diasporaRegion, "eu")));
    return created;
  }),

  getSepaRates: protectedProcedure
    .input(z.object({ destinationCountry: euCountrySchema }))
    .query(async ({ input }) => {
      try {
        const res = await fetch(
          `${OUTBOUND_SWIFT_URL}/quote?corridor=${input.destinationCountry}&rail=sepa&amount=100`,
          { signal: AbortSignal.timeout(10_000) }
        );
        if (res.ok) return res.json();
      } catch { /* fall through */ }

      const rates: Record<string, { fee_eur: number; fee_pct: number; settlement_time: string }> = {
        IT: { fee_eur: 2.99, fee_pct: 0, settlement_time: "Instant (SEPA Instant)" },
        DE: { fee_eur: 2.99, fee_pct: 0, settlement_time: "Instant (SEPA Instant)" },
        FR: { fee_eur: 2.99, fee_pct: 0, settlement_time: "Instant (SEPA Instant)" },
        ES: { fee_eur: 2.99, fee_pct: 0, settlement_time: "1 business day" },
        NL: { fee_eur: 2.99, fee_pct: 0, settlement_time: "Instant (SEPA Instant)" },
        BE: { fee_eur: 2.99, fee_pct: 0, settlement_time: "1 business day" },
        PT: { fee_eur: 2.99, fee_pct: 0, settlement_time: "1 business day" },
        CA: { fee_eur: 4.99, fee_pct: 0, settlement_time: "1-3 business days (EFT)" },
      };

      const r = rates[input.destinationCountry] ?? rates.IT;
      return {
        corridor: input.destinationCountry,
        rail: input.destinationCountry === "CA" ? "eft" : "sepa",
        eur_per_ngn: 0.000571,
        ...r,
        min_amount_eur: 10,
        max_amount_eur: 50000,
        source: "fallback",
      };
    }),

  getCanadaEftRates: protectedProcedure.query(async () => {
    return {
      corridor: "CA",
      rail: "eft",
      cad_per_ngn: 0.000837,
      fee_cad: 4.99,
      fee_pct: 0,
      settlement_time: "1-3 business days",
      min_amount_cad: 10,
      max_amount_cad: 25000,
      source: "fallback",
    };
  }),

  submitSepaTransfer: protectedProcedure
    .input(z.object({
      amountEur: z.number().positive().max(50_000),
      recipientIban: z.string().min(15).max(34),
      recipientBic: z.string().min(8).max(11),
      recipientName: z.string().min(2).max(100),
      destinationCountry: euCountrySchema,
      reference: z.string().max(140).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const transferId = `SEPA-${Date.now()}-${ctx.user.id}`;
      const isCanada = input.destinationCountry === "CA";
      const rail = isCanada ? "eft" : "sepa";

      await db.insert(transfers).values({
        userId: ctx.user.id,
        transferType: "outbound",
        rail,
        corridorCode: input.destinationCountry,
        amountNgn: (input.amountEur * 1750).toFixed(2),
        amountForeign: input.amountEur.toFixed(2),
        foreignCurrency: isCanada ? "CAD" : "EUR",
        recipientName: input.recipientName,
        recipientAccount: input.recipientIban,
        status: "pending",
        createdAt: new Date(),
      }).returning();

      return {
        transferId,
        status: "pending",
        rail,
        estimatedSettlement: isCanada ? "1-3 business days" : "Instant",
        amountEur: input.amountEur,
      };
    }),

  getSepaTransferHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      return db.select().from(transfers)
        .where(and(eq(transfers.userId, ctx.user.id), eq(transfers.rail, "sepa")))
        .orderBy(desc(transfers.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  getItalyCorridorStats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const italyTransfers = await db.select().from(transfers)
      .where(and(eq(transfers.userId, ctx.user.id), eq(transfers.corridorCode, "IT")));
    return {
      totalTransfers: italyTransfers.length,
      totalAmountEur: italyTransfers.reduce((s: any, t: any) => s + parseFloat(t.amountForeign ?? "0"), 0),
      avgAmountEur: italyTransfers.length > 0
        ? italyTransfers.reduce((s: any, t: any) => s + parseFloat(t.amountForeign ?? "0"), 0) / italyTransfers.length
        : 0,
    };
  }),

  getAcquisitionOffers: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const claimed = await db.select().from(diasporaOfferClaims)
      .where(and(eq(diasporaOfferClaims.userId, ctx.user.id), eq(diasporaOfferClaims.diasporaRegion, "eu")));
    const claimedTypes = new Set(claimed.map((c: any) => c.offerType));

    const offers = [
      {
        offerType: "zero_fee_first_transfer",
        title: "Zero Fees on Your First SEPA Transfer",
        description: "Send money to Nigeria for free on your first transfer via SEPA.",
        value: "Save up to €5",
        expiresInDays: 30,
        ctaText: "Send Now — Free",
      },
      {
        offerType: "sepa_instant_promo",
        title: "Free SEPA Instant for 3 Months",
        description: "Upgrade to SEPA Instant transfers at no extra cost for your first 3 months.",
        value: "Instant settlement",
        expiresInDays: 90,
        ctaText: "Activate Instant",
      },
      {
        offerType: "referral_bonus",
        title: "Refer a Friend — Earn €10",
        description: "Invite friends in Europe to RemitFlow. Earn €10 for each friend who completes their first transfer.",
        value: "€10 per referral",
        expiresInDays: 365,
        ctaText: "Get Referral Code",
      },
    ];

    return offers.map(o => ({ ...o, claimed: claimedTypes.has(o.offerType) }));
  }),

  claimWelcomeOffer: protectedProcedure
    .input(z.object({ offerType: z.enum(["zero_fee_first_transfer", "sepa_instant_promo", "referral_bonus"]) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const [existing] = await db.select().from(diasporaOfferClaims)
        .where(and(
          eq(diasporaOfferClaims.userId, ctx.user.id),
          eq(diasporaOfferClaims.offerType, input.offerType),
          eq(diasporaOfferClaims.diasporaRegion, "eu"),
        ));
      if (existing) throw new TRPCError({ code: "BAD_REQUEST", message: "Offer already claimed" });

      await db.insert(diasporaOfferClaims).values({
        userId: ctx.user.id,
        offerType: input.offerType,
        diasporaRegion: "eu",
        status: "active",
        claimedAt: new Date(),
      });

      return { success: true, verified: true, offerType: input.offerType };
    }),
});
