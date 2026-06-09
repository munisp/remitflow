/**
 * RemitFlow — Diaspora Bond & Investment Router
 * Full transaction lifecycle: browse → KYC check → subscribe → confirm →
 * coupon payment tracking → secondary market sell/buy
 * Bond pricing math embedded (Rust engine called when available, JS fallback)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb, createAuditLog } from "../db";
import {
  diasporaBonds,
  bondSubscriptions,
  bondCouponPayments,
  bondSecondaryMarketOrders,
  investmentOpportunities,
  users,
  wallets,
  transactions,
} from "../../drizzle/schema";
// alias for cleaner code
const bondSecondaryOrders = bondSecondaryMarketOrders;
import { eq, and, desc, sql, lt, gte, inArray, ne } from "drizzle-orm";

// ─── Bond Pricing Engine (JS fallback — Rust engine called when available) ───

const BOND_ENGINE_URL = process.env.BOND_ENGINE_URL || "http://localhost:8201";

interface BondPriceResult {
  cleanPrice: number;
  dirtyPrice: number;
  accruedInterest: number;
  yieldToMaturity: number;
  modifiedDuration: number;
  macaulayDuration: number;
  dv01: number;
  convexity: number;
}

function calcBondPrice(
  faceValue: number,
  couponRate: number,
  periodsPerYear: number,
  periodsRemaining: number,
  marketYield: number
): BondPriceResult {
  const c = (couponRate / periodsPerYear) * faceValue; // coupon payment
  const r = marketYield / periodsPerYear;              // period yield

  // Clean price via DCF
  let pv = 0;
  let duration = 0;
  let convexity = 0;
  for (let t = 1; t <= periodsRemaining; t++) {
    const cf = t === periodsRemaining ? c + faceValue : c;
    const disc = cf / Math.pow(1 + r, t);
    pv += disc;
    duration += (t / periodsPerYear) * disc;
    convexity += (t * (t + 1)) / Math.pow(1 + r, t + 2) * cf;
  }

  const cleanPrice = pv;
  const macaulayDuration = duration / cleanPrice;
  const modifiedDuration = macaulayDuration / (1 + r);
  const dv01 = (modifiedDuration * cleanPrice) / 10000;
  convexity = convexity / (cleanPrice * Math.pow(1 + r, 2));

  // Accrued interest (assume mid-period)
  const daysSinceCoupon = 30; // simplified
  const daysInPeriod = 365 / periodsPerYear;
  const accruedInterest = c * (daysSinceCoupon / daysInPeriod);

  return {
    cleanPrice,
    dirtyPrice: cleanPrice + accruedInterest,
    accruedInterest,
    yieldToMaturity: marketYield,
    modifiedDuration,
    macaulayDuration,
    dv01,
    convexity,
  };
}

async function getBondPrice(bond: any, marketYield?: number): Promise<BondPriceResult> {
  const yield_ = marketYield ?? Number(bond.couponRate) + 0.005; // spread over coupon
  const now = Date.now();
  const maturity = new Date(bond.maturityDate).getTime();
  const issued = new Date(bond.issueDate).getTime();
  const totalPeriods = Math.round(Number(bond.tenorYears) * Number(bond.couponFrequency));
  const elapsed = (now - issued) / (maturity - issued);
  const periodsRemaining = Math.max(1, Math.round(totalPeriods * (1 - elapsed)));

  // Try Rust engine first
  try {
    const res = await fetch(`${BOND_ENGINE_URL}/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        face_value: Number(bond.faceValueUsd),
        coupon_rate: Number(bond.couponRate),
        periods_per_year: Number(bond.couponFrequency),
        periods_remaining: periodsRemaining,
        market_yield: yield_,
      }),
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) return res.json();
  } catch { /* fall through to JS */ }

  return calcBondPrice(
    Number(bond.faceValueUsd),
    Number(bond.couponRate),
    Number(bond.couponFrequency),
    periodsRemaining,
    yield_
  );
}

// ─── Business Rules ───────────────────────────────────────────────────────────

const MIN_SUBSCRIPTION_USD = 500;
const MAX_SUBSCRIPTION_USD = 5_000_000;
const SECONDARY_MARKET_FEE_RATE = 0.005; // 0.5%
const EARLY_REDEMPTION_PENALTY_RATE = 0.02; // 2% of face value

function validateSubscriptionAmount(amount: number, bond: any): void {
  if (amount < MIN_SUBSCRIPTION_USD) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Minimum subscription is $${MIN_SUBSCRIPTION_USD.toLocaleString()} USD`,
    });
  }
  if (amount > MAX_SUBSCRIPTION_USD) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Maximum subscription is $${MAX_SUBSCRIPTION_USD.toLocaleString()} USD`,
    });
  }
  const remaining = Number(bond.targetAmountUsd) - Number(bond.raisedAmountUsd);
  if (amount > remaining) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Only $${remaining.toLocaleString()} USD remaining in this bond tranche`,
    });
  }
  if (bond.status !== "open") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Bond is not open for subscription (status: ${bond.status})`,
    });
  }
}

function calcNextCouponDate(bond: any): Date {
  const freq = Number(bond.couponFrequency); // per year
  const intervalDays = Math.round(365 / freq);
  const now = new Date();
  const issued = new Date(bond.issueDate);
  let next = new Date(issued);
  while (next <= now) {
    next = new Date(next.getTime() + intervalDays * 86400_000);
  }
  return next;
}

function calcCouponAmount(principalUsd: number, couponRate: number, frequency: number): number {
  return (principalUsd * couponRate) / frequency;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const diasporaBondRouter = router({

  // ── Browse Bonds ───────────────────────────────────────────────────────────

  listBonds: protectedProcedure
    .input(z.object({
      status: z.enum(["open", "closed", "matured", "all"]).default("open"),
      issuingCountry: z.string().optional(),
      minYield: z.number().optional(),
      maxTenor: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      const bonds = await db.select().from(diasporaBonds).orderBy(desc(diasporaBonds.createdAt));

      return bonds
        .filter((b: any) => input.status === "all" || b.status === input.status)
        .filter((b: any) => !input.issuingCountry || b.issuingCountry === input.issuingCountry)
        .filter((b: any) => !input.minYield || Number(b.couponRate) >= input.minYield)
        .filter((b: any) => !input.maxTenor || Number(b.tenorYears) <= input.maxTenor);
    }),

  getBond: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const [bond] = await db.select().from(diasporaBonds).where(eq(diasporaBonds.id, input.id));
      if (!bond) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      const pricing = await getBondPrice(bond);
      const fillPct = (Number(bond.raisedAmountUsd) / Number(bond.targetAmountUsd)) * 100;
      const nextCoupon = calcNextCouponDate(bond);

      return {
        ...bond,
        pricing,
        fillPercentage: Math.min(100, fillPct),
        nextCouponDate: nextCoupon,
        annualCouponUsd: Number(bond.faceValueUsd) * Number(bond.couponRate),
      };
    }),

  // ── Subscribe ──────────────────────────────────────────────────────────────

  getSubscriptionQuote: protectedProcedure
    .input(z.object({
      bondId: z.number(),
      amountUsd: z.number().positive(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      const [bond] = await db.select().from(diasporaBonds).where(eq(diasporaBonds.id, input.bondId));
      if (!bond) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      validateSubscriptionAmount(input.amountUsd, bond);

      const pricing = await getBondPrice(bond);
      const units = input.amountUsd / Number(bond.faceValueUsd);
      const periodsPerYear = Number(bond.couponFrequency);
      const couponPerPeriod = calcCouponAmount(input.amountUsd, Number(bond.couponRate), periodsPerYear);
      const annualCoupon = couponPerPeriod * periodsPerYear;
      const maturityDate = new Date(bond.maturityDate);
      const yearsToMaturity = (maturityDate.getTime() - Date.now()) / (365.25 * 86400_000);
      const totalCoupons = couponPerPeriod * Math.round(yearsToMaturity * periodsPerYear);
      const totalReturn = totalCoupons + input.amountUsd;
      const platformFee = input.amountUsd * 0.001; // 0.1% subscription fee

      return {
        bond: { id: bond.id, name: bond.bondName, issuer: bond.issuerName, couponRate: bond.couponRate },
        amountUsd: input.amountUsd,
        units,
        pricing,
        couponPerPeriod,
        annualCoupon,
        yearsToMaturity: Math.round(yearsToMaturity * 10) / 10,
        totalCouponsEstimate: totalCoupons,
        totalReturnEstimate: totalReturn,
        platformFee,
        nextCouponDate: calcNextCouponDate(bond),
        maturityDate,
      };
    }),

  subscribe: protectedProcedure
    .input(z.object({
      bondId: z.number(),
      amountUsd: z.number().positive(),
      paymentSource: z.enum(["wallet", "bank_transfer", "card"]).default("wallet"),
      acceptedTerms: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!input.acceptedTerms) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You must accept the bond subscription terms" });
      }

      const db = await getDb();
      const [bond] = await db.select().from(diasporaBonds).where(eq(diasporaBonds.id, input.bondId));
      if (!bond) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      validateSubscriptionAmount(input.amountUsd, bond);

      // Check KYC status
      const [user] = await db.select().from(users).where(eq(users.id, ctx.user.id));
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
      if (user.kycStatus !== "approved") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "KYC verification required before investing in diaspora bonds. Please complete your identity verification.",
        });
      }

      // Check wallet balance if paying from wallet
      if (input.paymentSource === "wallet") {
        const [wallet] = await db
          .select()
          .from(wallets)
          .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "USD")));
        if (!wallet || Number(wallet.balance) < input.amountUsd) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Insufficient USD wallet balance. Required: $${input.amountUsd.toFixed(2)}, Available: $${Number(wallet?.balance ?? 0).toFixed(2)}`,
          });
        }
      }

      // Pricing
      const pricing = await getBondPrice(bond);
      const units = input.amountUsd / Number(bond.faceValueUsd);
      const periodsPerYear = Number(bond.couponFrequency);
      const couponPerPeriod = calcCouponAmount(input.amountUsd, Number(bond.couponRate), periodsPerYear);
      const platformFee = input.amountUsd * 0.001;
      const nextCoupon = calcNextCouponDate(bond);

      // Create subscription
      const subscriptionRef = `BOND-${bond.id}-${ctx.user.id}-${Date.now().toString(36).toUpperCase()}`;
      const [subscription] = await db
        .insert(bondSubscriptions)
        .values({
          userId: ctx.user.id,
          bondId: input.bondId,
          subscriptionRef,
          principalUsd: String(input.amountUsd.toFixed(2)),
          units: String(units.toFixed(6)),
          purchasePrice: String(pricing.dirtyPrice.toFixed(4)),
          couponRateApplied: bond.couponRate,
          couponPerPeriod: String(couponPerPeriod.toFixed(2)),
          platformFee: String(platformFee.toFixed(2)),
          paymentSource: input.paymentSource,
          status: "pending_payment",
          nextCouponDate: nextCoupon,
          maturityDate: new Date(bond.maturityDate),
        })
        .returning();

      // Deduct from wallet immediately if wallet payment
      if (input.paymentSource === "wallet") {
        await db
          .update(wallets)
          .set({
            balance: sql`${wallets.balance} - ${input.amountUsd + platformFee}`,
            updatedAt: new Date(),
          })
          .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "USD")));

        // Confirm subscription
        await db
          .update(bondSubscriptions)
          .set({ status: "active", confirmedAt: new Date(), updatedAt: new Date() })
          .where(eq(bondSubscriptions.id, subscription.id));

        // Update bond raised amount
        await db
          .update(diasporaBonds)
          .set({
            raisedAmount: sql`${diasporaBonds.raisedAmount} + ${input.amountUsd}`,
            updatedAt: new Date(),
          })
          .where(eq(diasporaBonds.id, input.bondId));

        // Log transaction
        await db.insert(transactions).values({
          userId: ctx.user.id,
          type: "diaspora_bond_subscription",
          amount: String((input.amountUsd + platformFee).toFixed(2)),
          currency: "USD",
          status: "completed",
          reference: subscriptionRef,
          description: `Diaspora bond subscription: ${bond.bondName}`,
          metadata: { bondId: input.bondId, subscriptionId: subscription.id },
        }).returning();
      }

      return {
        subscription: { ...subscription, status: input.paymentSource === "wallet" ? "active" : "pending_payment" },
        bond: { id: bond.id, name: bond.bondName, issuer: bond.issuerName },
        quote: { amountUsd: input.amountUsd, units, couponPerPeriod, platformFee, nextCouponDate: nextCoupon },
      };
    }),

  confirmPayment: protectedProcedure
    .input(z.object({
      subscriptionId: z.number(),
      paymentReference: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [sub] = await db
        .select()
        .from(bondSubscriptions)
        .where(and(eq(bondSubscriptions.id, input.subscriptionId), eq(bondSubscriptions.userId, ctx.user.id)));
      if (!sub) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      if (sub.status !== "pending_payment") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Subscription already in status: ${sub.status}` });
      }

      const [updated] = await db
        .update(bondSubscriptions)
        .set({
          status: "active",
          confirmedAt: new Date(),
          paymentReference: input.paymentReference,
          updatedAt: new Date(),
        })
        .where(eq(bondSubscriptions.id, input.subscriptionId))
        .returning();

      // Update bond raised amount
      await db
        .update(diasporaBonds)
        .set({
          raisedAmount: sql`${diasporaBonds.raisedAmount} + ${sub.principalUsd}`,
          updatedAt: new Date(),
        })
        .where(eq(diasporaBonds.id, sub.bondId));

      return updated;
    }),

  // ── Portfolio ──────────────────────────────────────────────────────────────

  getMySubscriptions: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const subs = await db
      .select({
        subscription: bondSubscriptions,
        bond: diasporaBonds,
      })
      .from(bondSubscriptions)
      .leftJoin(diasporaBonds, eq(bondSubscriptions.bondId, diasporaBonds.id))
      .where(eq(bondSubscriptions.userId, ctx.user.id))
      .orderBy(desc(bondSubscriptions.createdAt));

    // Enrich with current pricing
    const enriched = await Promise.all(
      subs.map(async ({ subscription, bond }: { subscription: any; bond: any }) => {
        if (!bond) return { subscription, bond, currentValue: Number(subscription.principalUsd), pnl: 0 };
        const pricing = await getBondPrice(bond);
        const currentValue = Number(subscription.units) * pricing.dirtyPrice;
        const pnl = currentValue - Number(subscription.principalUsd);
        const pnlPct = (pnl / Number(subscription.principalUsd)) * 100;
        return { subscription, bond, currentValue, pnl, pnlPct, pricing };
      })
    );

    const totalInvested = enriched.reduce((s, e) => s + Number(e.subscription.principalUsd), 0);
    const totalCurrentValue = enriched.reduce((s, e) => s + e.currentValue, 0);
    const totalPnl = totalCurrentValue - totalInvested;

    return {
      subscriptions: enriched,
      summary: {
        totalInvested,
        totalCurrentValue,
        totalPnl,
        totalPnlPct: totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0,
        activeCount: enriched.filter((e) => e.subscription.status === "active").length,
        maturedCount: enriched.filter((e) => e.subscription.status === "matured").length,
      },
    };
  }),

  // ── Coupon Payments ────────────────────────────────────────────────────────

  getCouponHistory: protectedProcedure
    .input(z.object({ subscriptionId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [sub] = await db
        .select()
        .from(bondSubscriptions)
        .where(and(eq(bondSubscriptions.id, input.subscriptionId), eq(bondSubscriptions.userId, ctx.user.id)));
      if (!sub) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      const coupons = await db
        .select()
        .from(bondCouponPayments)
        .where(eq(bondCouponPayments.subscriptionId, input.subscriptionId))
        .orderBy(desc(bondCouponPayments.scheduledDate));

      const totalReceived = coupons
        .filter((c: any) => c.status === "paid")
        .reduce((s: any, c: any) => s + Number(c.grossAmount), 0);

      return { subscription: sub, coupons, totalReceived };
    }),

  processUpcomingCoupons: protectedProcedure
    .input(z.object({ bondId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Admin-level: process all due coupons for a bond
      const db = await getDb();
      const [bond] = await db.select().from(diasporaBonds).where(eq(diasporaBonds.id, input.bondId));
      if (!bond) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      const activeSubs = await db
        .select()
        .from(bondSubscriptions)
        .where(and(eq(bondSubscriptions.bondId, input.bondId), eq(bondSubscriptions.status, "active")));

      const now = new Date();
      const processed = [];

      for (const sub of activeSubs) {
        if (!sub.nextCouponDate || sub.nextCouponDate > now) continue;

        const couponAmount = calcCouponAmount(
          Number(sub.principalUsd),
          Number(sub.couponRateApplied),
          Number(bond.couponFrequency)
        );

        // Credit to user wallet
        await db
          .update(wallets)
          .set({
            balance: sql`${wallets.balance} + ${couponAmount}`,
            updatedAt: new Date(),
          })
          .where(and(eq(wallets.userId, sub.userId), eq(wallets.currency, "USD")));

        // Record coupon payment
        const [coupon] = await db
          .insert(bondCouponPayments)
          .values({
            subscriptionId: sub.id,
            bondId: input.bondId,
            scheduledDate: now,
            grossAmount: String(couponAmount.toFixed(2)),
            netAmount: String(couponAmount.toFixed(2)),
            couponNumber: 1,
            periodStart: now,
            periodEnd: now,
            userId: sub.userId,
            status: "paid",
            paidDate: now,
          })
          .returning();

        // Calculate next coupon date
        const intervalDays = Math.round(365 / Number(bond.couponFrequency));
        const nextCoupon = new Date(now.getTime() + intervalDays * 86400_000);

        await db
          .update(bondSubscriptions)
          .set({
            nextCouponDate: nextCoupon,
            totalCouponsReceived: sql`${bondSubscriptions.totalCouponsReceived} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(bondSubscriptions.id, sub.id));

        processed.push({ subscriptionId: sub.id, userId: sub.userId, couponAmount, coupon });
      }

      return { processed: processed.length, details: processed };
    }),

  // ── Secondary Market ───────────────────────────────────────────────────────

  listSecondaryOrders: protectedProcedure
    .input(z.object({
      bondId: z.number().optional(),
      side: z.enum(["buy", "sell", "all"]).default("all"),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const orders = await db
        .select({
          order: bondSecondaryOrders,
          bond: diasporaBonds,
        })
        .from(bondSecondaryOrders)
        .leftJoin(diasporaBonds, eq(bondSecondaryOrders.bondId, diasporaBonds.id))
        .where(eq(bondSecondaryOrders.status, "open"))
        .orderBy(desc(bondSecondaryOrders.createdAt));

      return orders
        .filter((o: any) => !input.bondId || o.order.bondId === input.bondId)
        .filter((o: any) => input.side === "all" || o.order.side === input.side)
        .map((o: any) => ({
          ...o.order,
          bondName: o.bond?.bondName,
          issuerName: o.bond?.issuerName,
          couponRate: o.bond?.couponRate,
        }));
    }),

  createSellOrder: protectedProcedure
    .input(z.object({
      subscriptionId: z.number(),
      unitsToSell: z.number().positive(),
      askPriceUsd: z.number().positive(),
      expiresInDays: z.number().int().min(1).max(30).default(7),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [sub] = await db
        .select()
        .from(bondSubscriptions)
        .where(and(eq(bondSubscriptions.id, input.subscriptionId), eq(bondSubscriptions.userId, ctx.user.id)));
      if (!sub) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      if (sub.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only active subscriptions can be listed for sale" });
      }
      if (input.unitsToSell > Number(sub.units)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot sell more units than held (${sub.units})` });
      }

      const [bond] = await db.select().from(diasporaBonds).where(eq(diasporaBonds.id, sub.bondId));
      if (!bond) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      const pricing = await getBondPrice(bond);
      const fairValue = pricing.dirtyPrice;
      const totalAsk = input.unitsToSell * input.askPriceUsd;
      const platformFee = totalAsk * SECONDARY_MARKET_FEE_RATE;

      const expiresAt = new Date(Date.now() + input.expiresInDays * 86400_000);
      const orderRef = `SELL-${sub.id}-${Date.now().toString(36).toUpperCase()}`;

      const [order] = await db
        .insert(bondSecondaryOrders)
        .values({
          bondId: sub.bondId,
          sellerUserId: ctx.user.id,
          sellerSubscriptionId: input.subscriptionId,
          side: "sell",
          units: String(input.unitsToSell),
          askPriceUsd: String(input.askPriceUsd.toFixed(4)),
          totalAskUsd: String(totalAsk.toFixed(2)),
          fairValueUsd: String(fairValue.toFixed(4)),
          platformFee: String(platformFee.toFixed(2)),
          orderRef,
          status: "open",
          expiresAt,
        })
        .returning();

      return {
        order,
        fairValue,
        premiumDiscount: ((input.askPriceUsd - fairValue) / fairValue) * 100,
        platformFee,
        netProceeds: totalAsk - platformFee,
      };
    }),

  fillBuyOrder: protectedProcedure
    .input(z.object({
      orderId: z.number(),
      unitsToFill: z.number().positive().optional(), // partial fill supported
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [order] = await db
        .select({ order: bondSecondaryOrders, bond: diasporaBonds })
        .from(bondSecondaryOrders)
        .leftJoin(diasporaBonds, eq(bondSecondaryOrders.bondId, diasporaBonds.id))
        .where(eq(bondSecondaryOrders.id, input.orderId))
        .then((rows: any) => rows);

      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      if (order.order.status !== "open") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Order is no longer open" });
      }
      if (order.order.sellerUserId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot buy your own sell order" });
      }
      if (order.order.expiresAt && order.order.expiresAt < new Date()) {
        const [_expired] = await db.update(bondSecondaryOrders).set({ status: "expired" }).where(eq(bondSecondaryOrders.id, input.orderId)).returning();
        throw new TRPCError({ code: "BAD_REQUEST", message: "Order has expired" });
      }

      const unitsToFill = input.unitsToFill ?? Number(order.order.units);
      if (unitsToFill > Number(order.order.units)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot fill more units than available in order" });
      }

      const totalCost = unitsToFill * Number(order.order.askPriceUsd);
      const platformFee = totalCost * SECONDARY_MARKET_FEE_RATE;
      const totalWithFee = totalCost + platformFee;

      // Check buyer wallet
      const [buyerWallet] = await db
        .select()
        .from(wallets)
        .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "USD")));
      if (!buyerWallet || Number(buyerWallet.balance) < totalWithFee) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient balance. Required: $${totalWithFee.toFixed(2)}, Available: $${Number(buyerWallet?.balance ?? 0).toFixed(2)}`,
        });
      }

      // Deduct from buyer
      await db
        .update(wallets)
        .set({ balance: sql`${wallets.balance} - ${totalWithFee}`, updatedAt: new Date() })
        .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "USD")));

      // Credit seller (net of fee)
      const sellerProceeds = totalCost - (totalCost * SECONDARY_MARKET_FEE_RATE);
      await db
        .update(wallets)
        .set({ balance: sql`${wallets.balance} + ${sellerProceeds}`, updatedAt: new Date() })
        .where(and(eq(wallets.userId, order.order.sellerUserId), eq(wallets.currency, "USD")));

      // Transfer subscription (or create new one for buyer)
      const bond = order.bond!;
      const nextCoupon = calcNextCouponDate(bond);
      const [newSub] = await db
        .insert(bondSubscriptions)
        .values({
          userId: ctx.user.id,
          bondId: order.order.bondId,
          subscriptionRef: `SEC-${order.order.orderRef}-${ctx.user.id}`,
          principalUsd: String(totalCost.toFixed(2)),
          units: String(unitsToFill.toFixed(6)),
          purchasePrice: String(order.order.askPriceUsd),
          couponRateApplied: bond.couponRate,
          couponPerPeriod: String(calcCouponAmount(totalCost, Number(bond.couponRate), Number(bond.couponFrequency)).toFixed(2)),
          platformFee: String(platformFee.toFixed(2)),
          paymentSource: "wallet",
          status: "active",
          confirmedAt: new Date(),
          nextCouponDate: nextCoupon,
          maturityDate: new Date(bond.maturityDate),
          acquiredViaSecondary: true,
        })
        .returning();

      // Close or partially fill order
      const remainingUnits = Number(order.order.units) - unitsToFill;
      if (remainingUnits < 0.000001) {
        await db
          .update(bondSecondaryOrders)
          .set({ status: "filled", filledAt: new Date(), buyerUserId: ctx.user.id, updatedAt: new Date() })
          .where(eq(bondSecondaryOrders.id, input.orderId));
      } else {
        await db
          .update(bondSecondaryOrders)
          .set({ units: String(remainingUnits.toFixed(6)), updatedAt: new Date() })
          .where(eq(bondSecondaryOrders.id, input.orderId));
      }

      return {
        newSubscription: newSub,
        totalCost,
        platformFee,
        sellerProceeds,
        unitsAcquired: unitsToFill,
      };
    }),

  // ── Early Redemption ───────────────────────────────────────────────────────

  requestEarlyRedemption: protectedProcedure
    .input(z.object({
      subscriptionId: z.number(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [sub] = await db
        .select()
        .from(bondSubscriptions)
        .where(and(eq(bondSubscriptions.id, input.subscriptionId), eq(bondSubscriptions.userId, ctx.user.id)));
      if (!sub) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      if (sub.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only active subscriptions can be redeemed early" });
      }

      const penalty = Number(sub.principalUsd) * EARLY_REDEMPTION_PENALTY_RATE;
      const redemptionAmount = Number(sub.principalUsd) - penalty;

      // Mark as redeemed
      await db
        .update(bondSubscriptions)
        .set({
          status: "redeemed",
          earlyRedemptionPenalty: String(penalty.toFixed(2)),
          redemptionAmount: String(redemptionAmount.toFixed(2)),
          redeemedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bondSubscriptions.id, input.subscriptionId));

      // Credit wallet
      await db
        .update(wallets)
        .set({ balance: sql`${wallets.balance} + ${redemptionAmount}`, updatedAt: new Date() })
        .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "USD")));

      // Update bond raised amount
      await db
        .update(diasporaBonds)
        .set({
          raisedAmount: sql`${diasporaBonds.raisedAmount} - ${sub.principalUsd}`,
          updatedAt: new Date(),
        })
        .where(eq(diasporaBonds.id, sub.bondId));

      return {
        subscriptionId: input.subscriptionId,
        principalUsd: Number(sub.principalUsd),
        penalty,
        penaltyRate: EARLY_REDEMPTION_PENALTY_RATE,
        redemptionAmount,
        creditedToWallet: true,
      };
    }),
});
