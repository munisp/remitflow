/**
 * Investment Router — v74
 * Covers: NGX Stock Market, Real Estate (Fractional), Startup Deals, Portfolio,
 *         PayPal Topup, Flutterwave Topup
 */
import { z } from "zod";
import { auditedProcedure, auditedAdminProcedure, rateLimitedProcedure } from "../_core/trpc";
import { eq, desc, and, like, ilike, sql, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { subtractMoney, addMoney, compareMoney, multiplyMoney, safeParseAmount } from "../lib/safeDecimal.js";
import {
  ngxStocks,
  stockWatchlists,
  ngxOrders,
  realEstateListings,
  realEstateInvestments,
  startupDeals,
  startupInvestments,
  paypalTransactions,
  flutterwaveTransactions,
  wallets,
  transactions,
  users,
} from "../../drizzle/schema.js";
import crypto from "crypto";


async function getDbConn() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateTxRef(prefix = "RF") {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

// ─── NGX Stock Router ─────────────────────────────────────────────────────────
export const ngxStockRouter = router({
  list: publicProcedure
    .input(
      z.object({
        search: z.string().max(100).optional(),
        sector: z.string().max(100).optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const conditions = [eq(ngxStocks.isActive, true)];
      if (input.sector) conditions.push(eq(ngxStocks.sector, input.sector));
      if (input.search) {
        conditions.push(
          sql`(${ngxStocks.ticker} ILIKE ${`%${input.search}%`} OR ${ngxStocks.name} ILIKE ${`%${input.search}%`})`
        );
      }
      const stocks = await (await getDbConn())
        .select()
        .from(ngxStocks)
        .where(and(...conditions))
        .orderBy(desc(ngxStocks.marketCapNgn))
        .limit(input.limit)
        .offset(input.offset);
      return stocks;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [stock] = await (await getDbConn())
        .select()
        .from(ngxStocks)
        .where(eq(ngxStocks.id, input.id));
      if (!stock) throw new TRPCError({ code: "NOT_FOUND", message: "Stock not found" });
      return stock;
    }),

  getByTicker: publicProcedure
    .input(z.object({ ticker: z.string().max(20) }))
    .query(async ({ input }) => {
      const [stock] = await (await getDbConn())
        .select()
        .from(ngxStocks)
        .where(eq(ngxStocks.ticker, input.ticker.toUpperCase()));
      if (!stock) throw new TRPCError({ code: "NOT_FOUND", message: "Stock not found" });
      return stock;
    }),

  sectors: publicProcedure.query(async () => {
    const rows = await (await getDbConn())
      .selectDistinct({ sector: ngxStocks.sector })
      .from(ngxStocks)
      .where(eq(ngxStocks.isActive, true))
      .orderBy(ngxStocks.sector);
    return rows.map((r: any) => r.sector);
  }),

  // Watchlist
  getWatchlist: protectedProcedure.query(async ({ ctx }) => {
    const items = await (await getDbConn())
      .select({
        id: stockWatchlists.id,
        stockId: stockWatchlists.stockId,
        alertPriceNgn: stockWatchlists.alertPriceNgn,
        notes: stockWatchlists.notes,
        createdAt: stockWatchlists.createdAt,
        ticker: ngxStocks.ticker,
        name: ngxStocks.name,
        sector: ngxStocks.sector,
        currentPriceNgn: ngxStocks.currentPriceNgn,
        changePercent: ngxStocks.changePercent,
      })
      .from(stockWatchlists)
      .innerJoin(ngxStocks, eq(stockWatchlists.stockId, ngxStocks.id))
      .where(eq(stockWatchlists.userId, ctx.user.id))
      .orderBy(desc(stockWatchlists.createdAt));
    return items;
  }),

  addToWatchlist: protectedProcedure
    .input(
      z.object({
        stockId: z.number().int().positive(),
        alertPriceNgn: z.string().optional(),
        notes: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check stock exists
      const [stock] = await (await getDbConn()).select().from(ngxStocks).where(eq(ngxStocks.id, input.stockId));
      if (!stock) throw new TRPCError({ code: "NOT_FOUND", message: "Stock not found" });
      // Check not already in watchlist
      const [existing] = await (await getDbConn())
        .select()
        .from(stockWatchlists)
        .where(and(eq(stockWatchlists.userId, ctx.user.id), eq(stockWatchlists.stockId, input.stockId)));
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Already in watchlist" });
      const [item] = await (await getDbConn())
        .insert(stockWatchlists)
        .values({
          userId: ctx.user.id,
          stockId: input.stockId,
          alertPriceNgn: input.alertPriceNgn,
          notes: input.notes,
        })
        .returning();
      return item;
    }),

  removeFromWatchlist: auditedProcedure
    .input(z.object({ watchlistId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [item] = await (await getDbConn())
        .select()
        .from(stockWatchlists)
        .where(and(eq(stockWatchlists.id, input.watchlistId), eq(stockWatchlists.userId, ctx.user.id)));
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Watchlist item not found" });
      await (await getDbConn()).delete(stockWatchlists).where(eq(stockWatchlists.id, input.watchlistId));
      return { success: true, updatedAt: new Date().toISOString(), serverTime: Date.now(), verified: true };
    }),

  // Orders
  placeOrder: protectedProcedure
    .input(
      z.object({
        stockId: z.number().int().positive(),
        orderType: z.enum(["buy", "sell", "limit_buy", "limit_sell"]),
        quantityUnits: z.string().min(1),
        pricePerUnitNgn: z.string().min(1),
        brokerName: z.enum(["Bamboo", "Trove", "Chaka", "Stanbic", "GTB"]).default("Bamboo"),
        notes: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDbConn();
      const [stock] = await db.select().from(ngxStocks).where(eq(ngxStocks.id, input.stockId));
      if (!stock) throw new TRPCError({ code: "NOT_FOUND", message: "Stock not found" });

      const qty = safeParseAmount(input.quantityUnits);
      const price = safeParseAmount(input.pricePerUnitNgn);
      const totalNgn = qty * price;
      let ngnRate = 1600;
      try {
        const fxRes = await fetch("https://open.er-api.com/v6/latest/USD");
        if (fxRes.ok) {
          const fxData = await fxRes.json() as { rates?: Record<string, number> };
          if (fxData.rates?.NGN) ngnRate = fxData.rates.NGN;
        }
      } catch { /* use fallback rate */ }
      const approxUsd = totalNgn / ngnRate;

      if (input.orderType === "buy" || input.orderType === "limit_buy") {
        const [wallet] = await db.select().from(wallets).where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "NGN"))).limit(1);
        if (!wallet || Number(wallet.balance) < totalNgn) throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient NGN wallet balance" });
        await db.execute(sql`
          UPDATE wallets SET balance = CAST(CAST(balance AS DECIMAL(18,4)) - ${totalNgn} AS VARCHAR)
          WHERE id = ${wallet.id} AND CAST(balance AS DECIMAL(18,4)) >= ${totalNgn}
        `);
      }

      const [order] = await db
        .insert(ngxOrders)
        .values({
          userId: ctx.user.id,
          stockId: input.stockId,
          orderType: input.orderType,
          status: "pending",
          quantityUnits: input.quantityUnits,
          pricePerUnitNgn: input.pricePerUnitNgn,
          totalAmountNgn: totalNgn.toFixed(2),
          totalAmountUsd: approxUsd.toFixed(2),
          fxRateUsed: ngnRate.toFixed(6),
          brokerName: input.brokerName,
          notes: input.notes,
        })
        .returning();
      return order;
    }),

  getOrders: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(ngxOrders.userId, ctx.user.id)];
      if (input.status) conditions.push(eq(ngxOrders.status, input.status));
      const orders = await (await getDbConn())
        .select({
          id: ngxOrders.id,
          orderType: ngxOrders.orderType,
          status: ngxOrders.status,
          quantityUnits: ngxOrders.quantityUnits,
          pricePerUnitNgn: ngxOrders.pricePerUnitNgn,
          totalAmountNgn: ngxOrders.totalAmountNgn,
          totalAmountUsd: ngxOrders.totalAmountUsd,
          brokerName: ngxOrders.brokerName,
          executedAt: ngxOrders.executedAt,
          createdAt: ngxOrders.createdAt,
          ticker: ngxStocks.ticker,
          stockName: ngxStocks.name,
        })
        .from(ngxOrders)
        .innerJoin(ngxStocks, eq(ngxOrders.stockId, ngxStocks.id))
        .where(and(...conditions))
        .orderBy(desc(ngxOrders.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      return orders;
    }),

  cancelOrder: auditedProcedure
    .input(z.object({ orderId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbConn();
      const [order] = await db
        .select()
        .from(ngxOrders)
        .where(and(eq(ngxOrders.id, input.orderId), eq(ngxOrders.userId, ctx.user.id)));
      if (!order) throw new TRPCError({ code: "NOT_FOUND" });
      if (order.status !== "pending")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only pending orders can be cancelled" });

      // Refund wallet if this was a buy order (funds were debited at order time)
      if (order.orderType === "buy" || order.orderType === "limit_buy") {
        const refundAmount = Number(order.totalAmountNgn);
        if (refundAmount > 0) {
          await db.execute(sql`
            UPDATE wallets SET balance = CAST(CAST(balance AS DECIMAL(18,4)) + ${refundAmount} AS VARCHAR), "updatedAt" = NOW()
            WHERE "userId" = ${ctx.user.id} AND currency = 'NGN'
          `);
        }
      }

      const [updated] = await db
        .update(ngxOrders)
        .set({ status: "cancelled" })
        .where(eq(ngxOrders.id, input.orderId))
        .returning();
      return { ...updated, refunded: order.orderType === "buy" || order.orderType === "limit_buy" };
    }),
});

// ─── Real Estate Router ───────────────────────────────────────────────────────
export const realEstateRouter = router({
  listListings: publicProcedure
    .input(
      z.object({
        search: z.string().max(200).optional(),
        propertyType: z.string().max(50).optional(),
        city: z.string().max(100).optional(),
        status: z.string().max(30).optional(),
        isFeatured: z.boolean().optional(),
        minReturnPct: z.number().optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const conditions: ReturnType<typeof eq>[] = [];
      if (input.propertyType) conditions.push(eq(realEstateListings.propertyType, input.propertyType));
      if (input.city) conditions.push(eq(realEstateListings.city, input.city));
      if (input.status) conditions.push(eq(realEstateListings.status, input.status));
      if (input.isFeatured !== undefined) conditions.push(eq(realEstateListings.isFeatured, input.isFeatured));
      if (input.search) {
        conditions.push(
          sql`(${realEstateListings.title} ILIKE ${`%${input.search}%`} OR ${realEstateListings.location} ILIKE ${`%${input.search}%`})`
        );
      }
      const listings = await (await getDbConn())
        .select()
        .from(realEstateListings)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(realEstateListings.isFeatured), desc(realEstateListings.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      return listings;
    }),

  getListing: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [listing] = await (await getDbConn())
        .select()
        .from(realEstateListings)
        .where(eq(realEstateListings.id, input.id));
      if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "Listing not found" });
      return listing;
    }),

  invest: protectedProcedure
    .input(
      z.object({
        listingId: z.number().int().positive(),
        sharesCount: z.number().int().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [listing] = await (await getDbConn())
        .select()
        .from(realEstateListings)
        .where(eq(realEstateListings.id, input.listingId));
      if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "Listing not found" });
      if (listing.status !== "open")
        throw new TRPCError({ code: "BAD_REQUEST", message: "This listing is not open for investment" });
      if (listing.availableShares < input.sharesCount)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Not enough shares available" });

      const pricePerShare = safeParseAmount(listing.pricePerShareUsd);
      const totalUsd = pricePerShare * input.sharesCount;
      const ownershipPct = (input.sharesCount / listing.totalShares) * 100;

      // Check wallet balance
      const [wallet] = await (await getDbConn())
        .select()
        .from(wallets)
        .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "USD")));
      if (!wallet || compareMoney(wallet.balance, totalUsd) < 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient USD wallet balance" });
      }

      // Debit wallet using safe decimal math
      await (await getDbConn())
        .update(wallets)
        .set({ balance: subtractMoney(wallet.balance, totalUsd) })
        .where(eq(wallets.id, wallet.id));

      // Reduce available shares
      await (await getDbConn())
        .update(realEstateListings)
        .set({
          availableShares: listing.availableShares - input.sharesCount,
          status: listing.availableShares - input.sharesCount === 0 ? "funded" : "open",
        })
        .where(eq(realEstateListings.id, input.listingId));

      // Create investment record
      const [investment] = await (await getDbConn())
        .insert(realEstateInvestments)
        .values({
          userId: ctx.user.id,
          listingId: input.listingId,
          sharesOwned: input.sharesCount,
          pricePerSharePaid: pricePerShare.toFixed(2),
          totalInvestedUsd: totalUsd.toFixed(2),
          ownershipPct: ownershipPct.toFixed(6),
          status: "active",
        })
        .returning();

      // Record transaction
      await (await getDbConn()).insert(transactions).values({
        userId: ctx.user.id,
        type: "topup",
        status: "completed",
        fromCurrency: "USD",
        fromAmount: totalUsd.toFixed(2),
        toCurrency: "USD",
        toAmount: totalUsd.toFixed(2),
        description: `Real estate investment: ${listing.title} (${input.sharesCount} shares)`,
        reference: generateTxRef("RE"),
        channel: "real_estate",
      });

      return investment;
    }),

  getMyInvestments: protectedProcedure.query(async ({ ctx }) => {
    const investments = await (await getDbConn())
      .select({
        id: realEstateInvestments.id,
        sharesOwned: realEstateInvestments.sharesOwned,
        totalInvestedUsd: realEstateInvestments.totalInvestedUsd,
        ownershipPct: realEstateInvestments.ownershipPct,
        status: realEstateInvestments.status,
        returnsPaidUsd: realEstateInvestments.returnsPaidUsd,
        investedAt: realEstateInvestments.investedAt,
        listingId: realEstateListings.id,
        title: realEstateListings.title,
        city: realEstateListings.city,
        state: realEstateListings.state,
        propertyType: realEstateListings.propertyType,
        expectedAnnualReturnPct: realEstateListings.expectedAnnualReturnPct,
        listingStatus: realEstateListings.status,
      })
      .from(realEstateInvestments)
      .innerJoin(realEstateListings, eq(realEstateInvestments.listingId, realEstateListings.id))
      .where(eq(realEstateInvestments.userId, ctx.user.id))
      .orderBy(desc(realEstateInvestments.investedAt));
    return investments;
  }),

  roiCalculator: publicProcedure
    .input(
      z.object({
        listingId: z.number().int().positive(),
        sharesCount: z.number().int().min(1),
        holdYears: z.number().min(1).max(30).default(5),
      })
    )
    .query(async ({ input }) => {
      const [listing] = await (await getDbConn())
        .select()
        .from(realEstateListings)
        .where(eq(realEstateListings.id, input.listingId));
      if (!listing) throw new TRPCError({ code: "NOT_FOUND" });
      const invested = safeParseAmount(listing.pricePerShareUsd) * input.sharesCount;
      const annualReturn = safeParseAmount(listing.expectedAnnualReturnPct ?? "12") / 100;
      const rentalYield = safeParseAmount(listing.rentalYieldPct ?? "8") / 100;
      const appreciation = safeParseAmount(listing.appreciationPct ?? "4") / 100;
      const totalReturn = invested * Math.pow(1 + annualReturn, input.holdYears) - invested;
      const rentalIncome = invested * rentalYield * input.holdYears;
      const capitalGain = invested * Math.pow(1 + appreciation, input.holdYears) - invested;
      return {
        investedUsd: invested.toFixed(2),
        projectedTotalReturnUsd: totalReturn.toFixed(2),
        rentalIncomeUsd: rentalIncome.toFixed(2),
        capitalGainUsd: capitalGain.toFixed(2),
        totalValueAtExitUsd: (invested + totalReturn).toFixed(2),
        annualReturnPct: (annualReturn * 100).toFixed(2),
        holdYears: input.holdYears,
      };
    }),
});

// ─── Startup Router ───────────────────────────────────────────────────────────
export const startupRouter = router({
  listDeals: publicProcedure
    .input(
      z.object({
        search: z.string().max(200).optional(),
        sector: z.string().max(100).optional(),
        stage: z.string().max(50).optional(),
        status: z.string().max(30).optional(),
        isFeatured: z.boolean().optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const conditions: ReturnType<typeof eq>[] = [];
      if (input.sector) conditions.push(eq(startupDeals.sector, input.sector));
      if (input.stage) conditions.push(eq(startupDeals.stage, input.stage));
      if (input.status) conditions.push(eq(startupDeals.status, input.status));
      if (input.isFeatured !== undefined) conditions.push(eq(startupDeals.isFeatured, input.isFeatured));
      if (input.search) {
        conditions.push(
          sql`(${startupDeals.companyName} ILIKE ${`%${input.search}%`} OR ${startupDeals.tagline} ILIKE ${`%${input.search}%`})`
        );
      }
      const deals = await (await getDbConn())
        .select()
        .from(startupDeals)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(startupDeals.isFeatured), desc(startupDeals.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      return deals;
    }),

  getDeal: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [deal] = await (await getDbConn()).select().from(startupDeals).where(eq(startupDeals.id, input.id));
      if (!deal) throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
      return deal;
    }),

  commit: protectedProcedure
    .input(
      z.object({
        dealId: z.number().int().positive(),
        amountUsd: z.number().min(100).max(1_000_000),
        paymentMethod: z.enum(["wallet", "bank_transfer", "card"]).default("wallet"),
        notes: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [deal] = await (await getDbConn()).select().from(startupDeals).where(eq(startupDeals.id, input.dealId));
      if (!deal) throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
      if (deal.status !== "open")
        throw new TRPCError({ code: "BAD_REQUEST", message: "This deal is not open for investment" });
      const minTicket = safeParseAmount(deal.minimumTicketUsd);
      if (input.amountUsd < minTicket)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Minimum investment is $${minTicket.toLocaleString()}`,
        });

      // Check wallet if paying from wallet
      if (input.paymentMethod === "wallet") {
        const [wallet] = await (await getDbConn())
          .select()
          .from(wallets)
          .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "USD")));
        if (!wallet || compareMoney(wallet.balance, input.amountUsd) < 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient USD wallet balance" });
        }
        await (await getDbConn())
          .update(wallets)
          .set({ balance: subtractMoney(wallet.balance, input.amountUsd) })
          .where(eq(wallets.id, wallet.id));
      }

      // Calculate equity
      const valuation = safeParseAmount(deal.valuationUsd ?? "0");
      const equityPct = valuation > 0 ? (input.amountUsd / valuation) * 100 : null;

      // Update raised so far
      const newRaised = safeParseAmount(deal.raisedSoFarUsd ?? "0") + input.amountUsd;
      const newStatus =
        newRaised >= safeParseAmount(deal.targetRaiseUsd) ? "funded" : deal.status;
      await (await getDbConn())
        .update(startupDeals)
        .set({ raisedSoFarUsd: newRaised.toFixed(2), status: newStatus })
        .where(eq(startupDeals.id, input.dealId));

      const [investment] = await (await getDbConn())
        .insert(startupInvestments)
        .values({
          userId: ctx.user.id,
          dealId: input.dealId,
          amountUsd: input.amountUsd.toFixed(2),
          instrumentType: deal.instrumentType,
          equityPct: equityPct !== null ? equityPct.toFixed(6) : null,
          status: input.paymentMethod === "wallet" ? "confirmed" : "pending",
          paymentMethod: input.paymentMethod,
          notes: input.notes,
          confirmedAt: input.paymentMethod === "wallet" ? new Date() : null,
        })
        .returning();

      if (input.paymentMethod === "wallet") {
        await (await getDbConn()).insert(transactions).values({
          userId: ctx.user.id,
          type: "topup",
          status: "completed",
          fromCurrency: "USD",
          fromAmount: input.amountUsd.toFixed(2),
          toCurrency: "USD",
          toAmount: input.amountUsd.toFixed(2),
          description: `Startup investment: ${deal.companyName} (${deal.instrumentType})`,
          reference: generateTxRef("SI"),
          channel: "startup_invest",
        });
      }

      return investment;
    }),

  getMyInvestments: protectedProcedure.query(async ({ ctx }) => {
    const investments = await (await getDbConn())
      .select({
        id: startupInvestments.id,
        amountUsd: startupInvestments.amountUsd,
        instrumentType: startupInvestments.instrumentType,
        equityPct: startupInvestments.equityPct,
        status: startupInvestments.status,
        paymentMethod: startupInvestments.paymentMethod,
        agreementSigned: startupInvestments.agreementSigned,
        investedAt: startupInvestments.investedAt,
        dealId: startupDeals.id,
        companyName: startupDeals.companyName,
        sector: startupDeals.sector,
        stage: startupDeals.stage,
        dealStatus: startupDeals.status,
        logoUrl: startupDeals.logoUrl,
      })
      .from(startupInvestments)
      .innerJoin(startupDeals, eq(startupInvestments.dealId, startupDeals.id))
      .where(eq(startupInvestments.userId, ctx.user.id))
      .orderBy(desc(startupInvestments.investedAt));
    return investments;
  }),

  signAgreement: auditedProcedure
    .input(z.object({ investmentId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [inv] = await (await getDbConn())
        .select()
        .from(startupInvestments)
        .where(
          and(eq(startupInvestments.id, input.investmentId), eq(startupInvestments.userId, ctx.user.id))
        );
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
      const [updated] = await (await getDbConn())
        .update(startupInvestments)
        .set({ agreementSigned: true })
        .where(eq(startupInvestments.id, input.investmentId))
        .returning();
      return updated;
    }),
});

// ─── Portfolio Router ─────────────────────────────────────────────────────────
export const portfolioRouter = router({
  summary: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    // Stock orders
    const stockOrders = await (await getDbConn())
      .select({
        totalUsd: sql<string>`COALESCE(SUM(${ngxOrders.totalAmountUsd}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(ngxOrders)
      .where(
        and(
          eq(ngxOrders.userId, userId),
          eq(ngxOrders.orderType, "buy"),
          eq(ngxOrders.status, "executed")
        )
      );

    // Real estate investments
    const reInvestments = await (await getDbConn())
      .select({
        totalUsd: sql<string>`COALESCE(SUM(${realEstateInvestments.totalInvestedUsd}), 0)`,
        count: sql<number>`COUNT(*)`,
        returnsPaid: sql<string>`COALESCE(SUM(${realEstateInvestments.returnsPaidUsd}), 0)`,
      })
      .from(realEstateInvestments)
      .where(and(eq(realEstateInvestments.userId, userId), eq(realEstateInvestments.status, "active")));

    // Startup investments
    const startupInvs = await (await getDbConn())
      .select({
        totalUsd: sql<string>`COALESCE(SUM(${startupInvestments.amountUsd}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(startupInvestments)
      .where(and(eq(startupInvestments.userId, userId), eq(startupInvestments.status, "confirmed")));

    const stockTotal = safeParseAmount(stockOrders[0]?.totalUsd ?? "0");
    const reTotal = safeParseAmount(reInvestments[0]?.totalUsd ?? "0");
    const startupTotal = safeParseAmount(startupInvs[0]?.totalUsd ?? "0");
    const grandTotal = stockTotal + reTotal + startupTotal;

    return {
      grandTotalUsd: grandTotal.toFixed(2),
      stocks: {
        totalUsd: stockTotal.toFixed(2),
        count: Number(stockOrders[0]?.count ?? 0),
        allocationPct: grandTotal > 0 ? ((stockTotal / grandTotal) * 100).toFixed(1) : "0",
      },
      realEstate: {
        totalUsd: reTotal.toFixed(2),
        count: Number(reInvestments[0]?.count ?? 0),
        returnsPaidUsd: safeParseAmount(reInvestments[0]?.returnsPaid ?? "0").toFixed(2),
        allocationPct: grandTotal > 0 ? ((reTotal / grandTotal) * 100).toFixed(1) : "0",
      },
      startups: {
        totalUsd: startupTotal.toFixed(2),
        count: Number(startupInvs[0]?.count ?? 0),
        allocationPct: grandTotal > 0 ? ((startupTotal / grandTotal) * 100).toFixed(1) : "0",
      },
    };
  }),
});

// ─── PayPal Topup Router ──────────────────────────────────────────────────────
export const paypalTopupRouter = router({
  createOrder: protectedProcedure
    .input(
      z.object({
        amountUsd: z.number().min(10).max(50000),
        returnUrl: z.string().url().max(500),
        cancelUrl: z.string().url().max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const clientId = process.env.PAYPAL_CLIENT_ID ?? "AYSq3RDGsmBLJE-otTkBtM-jBRd1TCQwFf9RGfwgnMhmFvwg6pg2a6BTkP73oF5xSHCwWkKnSgSYGiIB";
      const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? "";
      const baseUrl = process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com";

      // Get access token
      let accessToken: string;
      try {
        const authRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        });
        const authData = (await authRes.json()) as { access_token?: string };
        if (!authData.access_token) throw new Error("No access token");
        accessToken = authData.access_token;
      } catch (authErr) {
        const msg = authErr instanceof Error ? authErr.message : String(authErr);
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `PayPal authentication failed: ${msg}. Please configure PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.`,
        });
      }

      // Create order
      const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              amount: { currency_code: "USD", value: input.amountUsd.toFixed(2) },
              description: `RemitFlow Wallet Top-up — $${input.amountUsd}`,
              custom_id: ctx.user.id.toString(),
            },
          ],
          application_context: {
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
            brand_name: "RemitFlow",
            user_action: "PAY_NOW",
          },
        }),
      });
      const orderData = (await orderRes.json()) as {
        id?: string;
        links?: { rel: string; href: string }[];
      };
      if (!orderData.id) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "PayPal order creation failed" });

      const approvalLink = orderData.links?.find((l) => l.rel === "approve")?.href ?? "";
      await (await getDbConn()).insert(paypalTransactions).values({
        userId: ctx.user.id,
        paypalOrderId: orderData.id,
        amountUsd: input.amountUsd.toFixed(2),
        status: "created",
      });

      return { orderId: orderData.id, approvalUrl: approvalLink };
    }),

  captureOrder: auditedProcedure
    .input(z.object({ orderId: z.string().max(100) }))
    .mutation(async ({ ctx, input }) => {
      const clientId = process.env.PAYPAL_CLIENT_ID ?? "";
      const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? "";
      const baseUrl = process.env.PAYPAL_BASE_URL ?? "https://api-m.sandbox.paypal.com";

      const authRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      const { access_token } = (await authRes.json()) as { access_token: string };

      const captureRes = await fetch(`${baseUrl}/v2/checkout/orders/${input.orderId}/capture`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      });
      const captureData = (await captureRes.json()) as {
        status?: string;
        purchase_units?: { payments?: { captures?: { id: string; amount: { value: string } }[] } }[];
      };
      if (captureData.status !== "COMPLETED")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Payment not completed" });

      const capture = captureData.purchase_units?.[0]?.payments?.captures?.[0];
      const capturedAmount = safeParseAmount(capture?.amount?.value ?? "0");

      const [tx] = await (await getDbConn())
        .select()
        .from(paypalTransactions)
        .where(and(eq(paypalTransactions.paypalOrderId, input.orderId), eq(paypalTransactions.userId, ctx.user.id)));
      if (!tx) throw new TRPCError({ code: "NOT_FOUND" });
      if (tx.walletCredited) return { success: true, verified: true, amountUsd: capturedAmount };
      // Credit wallet
      const [wallet] = await (await getDbConn())
        .select()
        .from(wallets)
        .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "USD")));
      if (wallet) {
        await (await getDbConn())
          .update(wallets)
          .set({ balance: addMoney(wallet.balance, capturedAmount) })
          .where(eq(wallets.id, wallet.id));
      }
      await (await getDbConn())
        .update(paypalTransactions)
        .set({ status: "captured", paypalCaptureId: capture?.id, walletCredited: true })
        .where(eq(paypalTransactions.paypalOrderId, input.orderId));

      return { success: true, verified: true, amountUsd: capturedAmount };
    }),

  getHistory: protectedProcedure.query(async ({ ctx }) => {
    return (await getDbConn())
      .select()
      .from(paypalTransactions)
      .where(eq(paypalTransactions.userId, ctx.user.id))
      .orderBy(desc(paypalTransactions.createdAt))
      .limit(50);
  }),
});

// ─── Flutterwave Topup Router ─────────────────────────────────────────────────
export const flutterwaveTopupRouter = router({
  createPaymentLink: protectedProcedure
    .input(
      z.object({
        amountUsd: z.number().min(5).max(50000),
        redirectUrl: z.string().url().max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const secretKey = process.env.FLW_SECRET_KEY;
      if (!secretKey) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Flutterwave API key not configured" });
      const baseUrl = "https://api.flutterwave.com/v3";
      const txRef = generateTxRef("FLW");

      const [user] = await (await getDbConn()).select().from(users).where(eq(users.id, ctx.user.id));

      // Try to create real Flutterwave payment link
      let paymentLink: string;
      let flwRef: string;

      try {
        const res = await fetch(`${baseUrl}/payments`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tx_ref: txRef,
            amount: input.amountUsd,
            currency: "USD",
            redirect_url: input.redirectUrl,
            customer: {
              email: user?.email ?? "customer@remitflow.com",
              name: user?.name ?? "RemitFlow User",
            },
            customizations: {
              title: "RemitFlow Wallet Top-up",
              description: `Add $${input.amountUsd} to your RemitFlow wallet`,
              logo: "https://remitflow.example.com/logo.png",
            },
          }),
        });
        const data = (await res.json()) as { status: string; data?: { link: string; flw_ref?: string } };
        if (data.status === "success" && data.data?.link) {
          paymentLink = data.data.link;
          flwRef = data.data.flw_ref ?? txRef;
        } else {
          throw new Error("Flutterwave API error");
        }
      } catch (flwErr) {
        const msg = flwErr instanceof Error ? flwErr.message : String(flwErr);
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `Flutterwave payment initiation failed: ${msg}. Please configure FLW_SECRET_KEY with a valid Flutterwave secret key.`,
        });
      }

      await (await getDbConn()).insert(flutterwaveTransactions).values({
        userId: ctx.user.id,
        flwRef,
        txRef,
        amountUsd: input.amountUsd.toFixed(2),
        paymentLink,
        status: "pending",
      });

      return { paymentLink, txRef, flwRef };
    }),

  verifyPayment: auditedProcedure
    .input(z.object({ txRef: z.string().max(100) }))
    .mutation(async ({ ctx, input }) => {
      const [tx] = await (await getDbConn())
        .select()
        .from(flutterwaveTransactions)
        .where(and(eq(flutterwaveTransactions.txRef, input.txRef), eq(flutterwaveTransactions.userId, ctx.user.id)));
      if (!tx) throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
      if (tx.walletCredited) return { success: true, verified: true, amountUsd: safeParseAmount(tx.amountUsd) };
      // Verify payment with Flutterwave API
      const secretKey = process.env.FLW_SECRET_KEY ?? "";
      const verifyRes = await fetch(
        `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${input.txRef}`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      const verifyData = (await verifyRes.json()) as {
        status: string;
        data?: { status: string; amount: number; currency: string };
      };

      if (verifyData.status !== "success" || verifyData.data?.status !== "successful") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Payment not yet completed" });
      }

      const amount = verifyData.data.amount;
      const [wallet] = await (await getDbConn())
        .select()
        .from(wallets)
        .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "USD")));
      if (wallet) {
        await (await getDbConn())
          .update(wallets)
          .set({ balance: addMoney(wallet.balance, amount) })
          .where(eq(wallets.id, wallet.id));
      }
      await (await getDbConn())
        .update(flutterwaveTransactions)
        .set({ status: "successful", walletCredited: true })
        .where(eq(flutterwaveTransactions.txRef, input.txRef));

      return { success: true, verified: true, amountUsd: amount };
    }),

  getHistory: protectedProcedure.query(async ({ ctx }) => {
    return (await getDbConn())
      .select()
      .from(flutterwaveTransactions)
      .where(eq(flutterwaveTransactions.userId, ctx.user.id))
      .orderBy(desc(flutterwaveTransactions.createdAt))
      .limit(50);
  }),
});
