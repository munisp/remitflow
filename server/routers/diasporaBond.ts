/**
 * RemitFlow — Diaspora Bond & Investment Router
 * Full transaction lifecycle: browse → KYC check → subscribe → confirm →
 * coupon payment tracking → secondary market sell/buy
 * Bond pricing math embedded (Rust engine called when available, JS fallback)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
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
  flutterwaveTransactions,
  paypalTransactions,
} from "../../drizzle/schema";
// alias for cleaner code
const bondSecondaryOrders = bondSecondaryMarketOrders;
import { eq, and, desc, sql, lt, gte, inArray, ne } from "drizzle-orm";
import { executeTransferPipeline } from "../_core/transferPipeline";
import { assertFeatureEligible } from "../_core/featureGuard";
import { PLATFORM_SYSTEM_USER_ID } from "../_core/tigerBeetle";
import { publishEvent, KAFKA_TOPICS } from "../middleware/kafka";
import { broadcastUserEvent } from "../sse.service";
import { sendNotification } from "../notifications.service";
import { logger } from "../_core/logger";

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
  // W9/Q9: no tenor_years column — derive tenor from issue/maturity dates.
  const tenorYears = Math.max(0.25, (maturity - issued) / (365.25 * 86400_000));
  const totalPeriods = Math.round(tenorYears * couponPeriodsPerYear(bond.couponFrequency));
  const elapsed = (now - issued) / (maturity - issued);
  const periodsRemaining = Math.max(1, Math.round(totalPeriods * (1 - elapsed)));

  // Try Rust engine first
  try {
    const res = await fetch(`${BOND_ENGINE_URL}/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        face_value: Number(bond.faceValue),
        coupon_rate: Number(bond.couponRate),
        periods_per_year: couponPeriodsPerYear(bond.couponFrequency),
        periods_remaining: periodsRemaining,
        market_yield: yield_,
      }),
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) return res.json();
  } catch { /* fall through to JS */ }

  return calcBondPrice(
    Number(bond.faceValue),
    Number(bond.couponRate),
    couponPeriodsPerYear(bond.couponFrequency),
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
  // W9/Q9: real columns are target_raise / raised_amount.
  const remaining = Number(bond.targetRaise ?? Infinity) - Number(bond.raisedAmount ?? 0);
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

// W9/Q9: coupon_frequency is the bondCouponFreqEnum ("monthly"|"quarterly"|"semi_annual"|"annual"),
// not a number — Number(enum) is NaN and silently zeroed all coupon math.
function couponPeriodsPerYear(freq: string | null | undefined): number {
  switch (freq) {
    case "monthly": return 12;
    case "quarterly": return 4;
    case "annual": return 1;
    case "semi_annual":
    default: return 2;
  }
}

function calcNextCouponDate(bond: any): Date {
  const freq = couponPeriodsPerYear(bond.couponFrequency); // per year
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
        // W9/Q9: no issuing_country column on diaspora_bonds — country eligibility lives in eligibleCountries.
        .filter((b: any) => !input.issuingCountry || (Array.isArray(b.eligibleCountries) && (b.eligibleCountries as string[]).includes(input.issuingCountry)))
        .filter((b: any) => !input.minYield || Number(b.couponRate) >= input.minYield)
        // W9/Q9: no tenor_years column — derive tenor from issue/maturity dates.
        .filter((b: any) => !input.maxTenor || ((new Date(b.maturityDate).getTime() - new Date(b.issueDate).getTime()) / (365.25 * 86400_000)) <= input.maxTenor);
    }),

  getBond: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const [bond] = await db.select().from(diasporaBonds).where(eq(diasporaBonds.id, input.id));
      if (!bond) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      const pricing = await getBondPrice(bond);
      const fillPct = (Number(bond.raisedAmount ?? 0) / Math.max(1, Number(bond.targetRaise ?? 0))) * 100;
      const nextCoupon = calcNextCouponDate(bond);

      return {
        ...bond,
        pricing,
        fillPercentage: Math.min(100, fillPct),
        nextCouponDate: nextCoupon,
        annualCouponUsd: Number(bond.faceValue) * Number(bond.couponRate),
      };
    }),

  // ── Subscribe ──────────────────────────────────────────────────────────────

  getSubscriptionQuote: protectedProcedure
    .input(z.object({
      bondId: z.number(),
      amountUsd: z.number().positive().max(10_000_000),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      const [bond] = await db.select().from(diasporaBonds).where(eq(diasporaBonds.id, input.bondId));
      if (!bond) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      validateSubscriptionAmount(input.amountUsd, bond);

      const pricing = await getBondPrice(bond);
      const units = input.amountUsd / Number(bond.faceValue);
      const periodsPerYear = couponPeriodsPerYear(bond.couponFrequency);
      const couponPerPeriod = calcCouponAmount(input.amountUsd, Number(bond.couponRate), periodsPerYear);
      const annualCoupon = couponPerPeriod * periodsPerYear;
      const maturityDate = new Date(bond.maturityDate);
      const yearsToMaturity = (maturityDate.getTime() - Date.now()) / (365.25 * 86400_000);
      const totalCoupons = couponPerPeriod * Math.round(yearsToMaturity * periodsPerYear);
      const totalReturn = totalCoupons + input.amountUsd;
      const platformFee = input.amountUsd * 0.001; // 0.1% subscription fee

      return {
        bond: { id: bond.id, name: bond.name, issuer: bond.issuer, couponRate: bond.couponRate },
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
      amountUsd: z.number().positive().max(10_000_000),
      paymentSource: z.enum(["wallet", "bank_transfer", "card"]).default("wallet"),
      acceptedTerms: z.boolean(),
      totpCode: z.string().regex(/^\d{6}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!input.acceptedTerms) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You must accept the bond subscription terms" });
      }

      // A5: enforce the declared investments gate (flag + KYC tier >= 2 + growth plan).
      await assertFeatureEligible(ctx, { flag: "investments", minKycTier: 2, minPlan: "growth", featureName: "Diaspora bond subscription" });

      // D-runner: TOTP step-up — enrolled users must pass 2FA to subscribe.
      {
        const { getTotpEnrollment, verifyTOTP } = await import("../totp");
        const enrollment = await getTotpEnrollment(ctx.user.id);
        if (!enrollment.dbAvailable) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "2FA verification unavailable — action blocked" });
        if (enrollment.enabled && enrollment.secret) {
          if (!input.totpCode) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "2FA code required for this action" });
          const valid = await verifyTOTP(input.totpCode, enrollment.secret);
          if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid 2FA code" });
        }
      }

      const db = await getDb();
      const [bond] = await db.select().from(diasporaBonds).where(eq(diasporaBonds.id, input.bondId));
      if (!bond) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      validateSubscriptionAmount(input.amountUsd, bond);

      // Check KYC status
      const [user] = await db.select().from(users).where(eq(users.id, ctx.user.id));
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
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
      // W9/Q9: bond_subscriptions.units is an INTEGER column — fractional
      // subscriptions cannot be persisted. Fail closed: the amount must be a
      // whole multiple of the face value (no silent rounding of money).
      const unitsRaw = input.amountUsd / Number(bond.faceValue);
      const units = Math.round(unitsRaw);
      if (!Number.isFinite(unitsRaw) || units <= 0 || Math.abs(unitsRaw - units) > 1e-9) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Subscription amount must be a whole multiple of the bond face value (${bond.faceValue} USD)`,
        });
      }
      const periodsPerYear = couponPeriodsPerYear(bond.couponFrequency);
      const couponPerPeriod = calcCouponAmount(input.amountUsd, Number(bond.couponRate), periodsPerYear);
      const platformFee = input.amountUsd * 0.001;
      const nextCoupon = calcNextCouponDate(bond);

      // Create subscription
      // W9/Q9: real bond_subscriptions columns only (no principal_usd /
      // coupon_rate_applied / payment_source / next_coupon_date / maturity_date).
      const subscriptionRef = `BOND-${bond.id}-${ctx.user.id}-${Date.now().toString(36).toUpperCase()}`;
      const [subscription] = await db
        .insert(bondSubscriptions)
        .values({
          userId: ctx.user.id,
          bondId: input.bondId,
          subscriptionRef,
          units,
          faceValue: String((units * Number(bond.faceValue)).toFixed(2)),
          purchasePrice: String(input.amountUsd.toFixed(2)),
          totalPaid: String((input.amountUsd + platformFee).toFixed(2)),
          currency: "USD",
          yieldAtPurchase: bond.couponRate,
          status: "pending_payment",
        })
        .returning();

      // FF-FIX: run the pipeline BEFORE any wallet debit — a pipeline
      // rejection (sanctions, TB outage, unprovisioned account) can no longer
      // strand a debit with no active subscription.
      const pipelineResult = await executeTransferPipeline({
        userId: ctx.user.id,
        amount: input.amountUsd,
        fromCurrency: "USD",
        toCurrency: "USD",
        recipientName: bond.issuer ?? "Diaspora Bond Issuer",
        rail: "internal",
        corridorCode: "NG",
        featureLabel: "diaspora_bond",
        transferId: subscriptionRef,
        description: `Bond subscription: ${bond.name} — ${units.toFixed(2)} units`,
        metadata: { bondId: input.bondId, principalUsd: input.amountUsd, paymentSource: input.paymentSource },
        skipVelocity: true,
      });

      // Deduct from wallet immediately if wallet payment — FF-FIX: debit +
      // activation + raised-amount bump + ledger log in ONE transaction so a
      // mid-flow failure can never orphan the debit.
      if (input.paymentSource === "wallet") {
        await db.transaction(async (tx: any) => {
          // FF-012: guarded debit with row-count check — concurrent subscribers
          // must not overdraw; the race loser updates 0 rows and is rejected.
          const bondDebit = await tx
            .update(wallets)
            .set({
              balance: sql`${wallets.balance} - ${input.amountUsd + platformFee}`,
              updatedAt: new Date(),
            })
            .where(and(
              eq(wallets.userId, ctx.user.id),
              eq(wallets.currency, "USD"),
              sql`CAST(${wallets.balance} AS NUMERIC) >= ${input.amountUsd + platformFee}`,
            ))
            .returning({ id: wallets.id });
          if (bondDebit.length === 0) {
            throw new TRPCError({ code: "CONFLICT", message: "Insufficient USD wallet balance (concurrent debit)" });
          }

          // B5: explicit credit leg — the debited principal+fee moves to the
          // platform float/treasury wallet in the SAME transaction. That float
          // is what funds coupons and early redemptions; without this leg the
          // principal was silently absorbed. Float wallet missing => abort, no
          // funds moved.
          const floatCredit = await tx
            .update(wallets)
            .set({
              balance: sql`${wallets.balance} + ${input.amountUsd + platformFee}`,
              updatedAt: new Date(),
            })
            .where(and(
              eq(wallets.userId, PLATFORM_SYSTEM_USER_ID),
              eq(wallets.currency, "USD"),
            ))
            .returning({ id: wallets.id });
          if (floatCredit.length === 0) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Platform float/treasury wallet not provisioned — subscription aborted, no funds moved" });
          }

          // Confirm subscription (single-winner: only from pending_payment)
          const activated = await tx
            .update(bondSubscriptions)
            .set({ status: "active", updatedAt: new Date() })
            .where(and(eq(bondSubscriptions.id, subscription.id), eq(bondSubscriptions.status, "pending_payment")))
            .returning({ id: bondSubscriptions.id });
          if (activated.length === 0) {
            throw new TRPCError({ code: "CONFLICT", message: "Subscription state changed concurrently" });
          }

          // Update bond raised amount
          await tx
            .update(diasporaBonds)
            .set({
              raisedAmount: sql`${diasporaBonds.raisedAmount} + ${input.amountUsd}`,
              updatedAt: new Date(),
            })
            .where(eq(diasporaBonds.id, input.bondId));

          // Log transaction
          await tx.insert(transactions).values({
            userId: ctx.user.id,
            // W9/Q9: tx_type enum has no "diaspora_bond_subscription" — maps to "withdrawal"; semantics kept in description/metadata
            type: "withdrawal",
            fromAmount: String((input.amountUsd + platformFee).toFixed(2)),
            fromCurrency: "USD",
            status: "completed",
            reference: subscriptionRef,
            description: `Diaspora bond subscription: ${bond.name}`,
            metadata: { originalType: "diaspora_bond_subscription", bondId: input.bondId, subscriptionId: subscription.id },
          });
        });
      }

      return {
        subscription: { ...subscription, status: input.paymentSource === "wallet" ? "active" : "pending_payment" },
        bond: { id: bond.id, name: bond.name, issuer: bond.issuer },
        quote: { amountUsd: input.amountUsd, units, couponPerPeriod, platformFee, nextCouponDate: nextCoupon },
        verified: true,
        fraudScore: pipelineResult.fraudScore,
      };
    }),

  confirmPayment: protectedProcedure
    .input(z.object({
      subscriptionId: z.number(),
      paymentReference: z.string().min(4).max(120),
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

      // FF-FIX (CRITICAL): never activate on a bare user-supplied string. The
      // reference must match a provider-VERIFIED payment belonging to this
      // user, with an amount covering the subscription principal. Anything
      // else requires admin approval (adminConfirmPayment).
      const principal = Number(sub.purchasePrice);
      let verified = false;
      const [flwTx] = await db
        .select()
        .from(flutterwaveTransactions)
        .where(and(
          eq(flutterwaveTransactions.userId, ctx.user.id),
          eq(flutterwaveTransactions.status, "successful"),
          sql`(${flutterwaveTransactions.txRef} = ${input.paymentReference} OR ${flutterwaveTransactions.flwRef} = ${input.paymentReference})`,
        ))
        .limit(1);
      if (flwTx && Math.abs(Number(flwTx.amountUsd) - principal) <= Math.max(0.01, principal * 0.005)) {
        verified = true;
      }
      if (!verified) {
        const [ppTx] = await db
          .select()
          .from(paypalTransactions)
          .where(and(
            eq(paypalTransactions.userId, ctx.user.id),
            eq(paypalTransactions.status, "captured"),
            eq(paypalTransactions.paypalOrderId, input.paymentReference),
          ))
          .limit(1);
        if (ppTx && Math.abs(Number(ppTx.amountUsd) - principal) <= Math.max(0.01, principal * 0.005)) {
          verified = true;
        }
      }
      if (!verified) {
        logger.warn({ userId: ctx.user.id, subscriptionId: input.subscriptionId, paymentReference: input.paymentReference }, "[Bond] confirmPayment rejected — no provider-verified payment for reference");
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Payment reference could not be verified against a completed Flutterwave/PayPal payment for the subscription amount. Off-rail payments (bank transfer / card) require admin verification.",
        });
      }

      // Guarded single-winner activation + raised-amount bump in ONE tx.
      const updated = await db.transaction(async (tx: any) => {
        // W9/Q9: bond_subscriptions has NO payment_reference column — the
        // single-use anchor is the audit row in transactions.reference.
        // (A UNIQUE constraint on transactions.reference remains the schema
        // follow-up — F14-6.)
        const reuse = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.reference, input.paymentReference))
          .limit(1);
        if (reuse.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Payment reference already consumed by another subscription" });
        }
        // Audit trail for the off-rail payment — doubles as the
        // reference-reuse marker checked above.
        const [auditTx] = await tx
          .insert(transactions)
          .values({
            userId: ctx.user.id,
            type: "withdrawal",
            status: "completed",
            fromCurrency: "USD",
            fromAmount: principal.toFixed(2),
            reference: input.paymentReference,
            description: `Diaspora bond subscription payment (provider-verified): ${sub.subscriptionRef}`,
            metadata: { originalType: "diaspora_bond_subscription", bondId: sub.bondId, subscriptionId: sub.id, rail: "off_rail" },
          })
          .returning({ id: transactions.id });
        const rows = await tx
          .update(bondSubscriptions)
          .set({
            status: "active",
            transactionId: auditTx?.id ?? null,
            updatedAt: new Date(),
          })
          .where(and(eq(bondSubscriptions.id, input.subscriptionId), eq(bondSubscriptions.status, "pending_payment")))
          .returning();
        if (rows.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Subscription was already activated concurrently" });
        }
        await tx
          .update(diasporaBonds)
          .set({
            raisedAmount: sql`${diasporaBonds.raisedAmount} + ${sub.purchasePrice}`,
            updatedAt: new Date(),
          })
          .where(eq(diasporaBonds.id, sub.bondId));
        return rows[0];
      });

      return updated;
    }),

  // Admin approval path for off-rail payment sources (bank transfer / card):
  // activates a pending_payment subscription after manual payment verification.
  adminConfirmPayment: adminProcedure
    .input(z.object({
      subscriptionId: z.number(),
      paymentReference: z.string().min(4).max(120),
      notes: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [sub] = await db
        .select()
        .from(bondSubscriptions)
        .where(eq(bondSubscriptions.id, input.subscriptionId));
      if (!sub) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      const updated = await db.transaction(async (tx: any) => {
        // W9/Q9: bond_subscriptions has NO payment_reference column — the
        // single-use anchor is the audit row in transactions.reference.
        const reuse = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.reference, input.paymentReference))
          .limit(1);
        if (reuse.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Payment reference already consumed by another subscription" });
        }
        const [auditTx] = await tx
          .insert(transactions)
          .values({
            userId: sub.userId,
            type: "withdrawal",
            status: "completed",
            fromCurrency: "USD",
            fromAmount: Number(sub.purchasePrice).toFixed(2),
            reference: input.paymentReference,
            description: `Diaspora bond subscription payment (admin-verified): ${sub.subscriptionRef}`,
            metadata: { originalType: "diaspora_bond_subscription", bondId: sub.bondId, subscriptionId: sub.id, rail: "off_rail", adminApprovedBy: ctx.user.id },
          })
          .returning({ id: transactions.id });
        const rows = await tx
          .update(bondSubscriptions)
          .set({
            status: "active",
            transactionId: auditTx?.id ?? null,
            updatedAt: new Date(),
          })
          .where(and(eq(bondSubscriptions.id, input.subscriptionId), eq(bondSubscriptions.status, "pending_payment")))
          .returning();
        if (rows.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: `Subscription is not pending_payment (status: ${sub.status})` });
        }
        await tx
          .update(diasporaBonds)
          .set({
            raisedAmount: sql`${diasporaBonds.raisedAmount} + ${sub.purchasePrice}`,
            updatedAt: new Date(),
          })
          .where(eq(diasporaBonds.id, sub.bondId));
        return rows[0];
      });
      logger.info({ adminId: ctx.user.id, subscriptionId: input.subscriptionId, paymentReference: input.paymentReference, notes: input.notes }, "[Bond] Admin-approved off-rail subscription activation");
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
        if (!bond) return { subscription, bond, currentValue: Number(subscription.purchasePrice), pnl: 0 };
        const pricing = await getBondPrice(bond);
        const currentValue = Number(subscription.units) * pricing.dirtyPrice;
        const pnl = currentValue - Number(subscription.purchasePrice);
        const pnlPct = (pnl / Number(subscription.purchasePrice)) * 100;
        return { subscription, bond, currentValue, pnl, pnlPct, pricing };
      })
    );

    const totalInvested = enriched.reduce((s, e) => s + Number(e.subscription.purchasePrice), 0);
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

  // FF-FIX: admin-only — this credits platform-funded coupons to every active
  // subscriber; it must not be callable by arbitrary users.
  processUpcomingCoupons: adminProcedure
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

      const periodsPerYear = couponPeriodsPerYear(bond.couponFrequency);
      const intervalDays = Math.round(365 / periodsPerYear);

      for (const sub of activeSubs) {
        // W9/Q9: bond_subscriptions has NO next_coupon_date / coupon_rate_applied
        // columns. The next due coupon is derived from purchased_at +
        // (totalCouponsReceived + 1) coupon periods; the coupon rate comes from
        // the bond row. Coupons stop at maturity.
        const received = Math.trunc(Number(sub.totalCouponsReceived ?? 0));
        const periodEnd = new Date(new Date(sub.purchasedAt).getTime() + (received + 1) * intervalDays * 86400_000);
        if (periodEnd > now) continue; // not yet due
        if (periodEnd > new Date(bond.maturityDate)) continue; // no coupons past maturity

        const couponAmount = calcCouponAmount(
          Number(sub.faceValue),
          Number(bond.couponRate),
          periodsPerYear
        );
        const periodStart = new Date(periodEnd.getTime() - intervalDays * 86400_000);

        // FF-FIX: single-winner nextCouponDate advance + row-count-checked
        // wallet credit + coupon record in ONE transaction. Concurrent
        // invocations lose the advance (0 rows) and skip; a missing wallet
        // rolls everything back so no "paid" coupon exists without money.
        const coupon = await db.transaction(async (tx: any) => {
          // Single-winner guard: only the invocation that observes
          // totalCouponsReceived = received may advance it (optimistic
          // concurrency — replaces the nonexistent next_coupon_date guard).
          const advance = await tx
            .update(bondSubscriptions)
            .set({
              totalCouponsReceived: String(received + 1),
              updatedAt: new Date(),
            })
            .where(and(
              eq(bondSubscriptions.id, sub.id),
              eq(bondSubscriptions.status, "active"),
              eq(bondSubscriptions.totalCouponsReceived, String(received)),
            ))
            .returning({ id: bondSubscriptions.id });
          if (advance.length === 0) return null; // another invocation won the race

          // B5: coupons are FUNDED — guarded debit of the platform
          // float/treasury wallet in the same transaction. Never mint unbacked
          // balance. Insufficient/missing float => throw; the whole coupon
          // (advance included) rolls back, nothing partial.
          const floatDebit = (await tx.execute(sql`
            UPDATE wallets
            SET balance = balance - ${couponAmount.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
            WHERE "userId" = ${PLATFORM_SYSTEM_USER_ID} AND currency = 'USD'
              AND CAST(balance AS numeric) >= ${couponAmount.toFixed(2)}
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (floatDebit.length === 0) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Platform float/treasury insufficient — coupon NOT paid for subscription ${sub.id}; fund the float wallet and retry` });
          }

          const creditRows = (await tx.execute(sql`
            UPDATE wallets
            SET balance = balance + ${couponAmount.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
            WHERE "userId" = ${sub.userId} AND currency = 'USD' AND status = 'active'
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (creditRows.length === 0) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `USD wallet unavailable for user ${sub.userId} — coupon NOT paid` });
          }

          const [c] = await tx
            .insert(bondCouponPayments)
            .values({
              subscriptionId: sub.id,
              bondId: input.bondId,
              scheduledDate: periodEnd,
              grossAmount: String(couponAmount.toFixed(2)),
              netAmount: String(couponAmount.toFixed(2)),
              couponNumber: received + 1,
              periodStart,
              periodEnd,
              userId: sub.userId,
              status: "paid",
              paidDate: now,
            })
            .returning();
          return c;
        });
        if (!coupon) continue; // lost the race — already processed

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
        .filter((o: any) => input.side === "all" || o.order.orderType === input.side)
        .map((o: any) => ({
          ...o.order,
          bondName: o.bond?.name,
          issuerName: o.bond?.issuer,
          couponRate: o.bond?.couponRate,
        }));
    }),

  createSellOrder: protectedProcedure
    .input(z.object({
      subscriptionId: z.number(),
      unitsToSell: z.number().positive(),
      askPriceUsd: z.number().positive().max(10_000_000),
      expiresInDays: z.number().int().min(1).max(30).default(7),
    }))
    .mutation(async ({ ctx, input }) => {
      // A5: enforce the declared investments gate (flag + KYC tier >= 2 + growth plan).
      await assertFeatureEligible(ctx, { flag: "investments", minKycTier: 2, minPlan: "growth", featureName: "Diaspora bond secondary market" });
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
      // W9-FIX3: the fee is paid by the BUYER on top of the ask (see
      // fillBuyOrder — the seller receives the FULL totalAsk). The quote must
      // not promise the seller netProceeds = ask - fee.
      const buyerPaidFee = totalAsk * SECONDARY_MARKET_FEE_RATE;

      const expiresAt = new Date(Date.now() + input.expiresInDays * 86400_000);

      // W9/Q9: bond_secondary_market_orders.units is an INTEGER column and has
      // no order_ref / side / seller_user_id / total_ask_usd / fair_value_usd /
      // platform_fee columns — real column names only. Fractional units cannot
      // be persisted: fail closed (no silent rounding of holdings).
      if (!Number.isInteger(input.unitsToSell) || input.unitsToSell <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Units to sell must be a positive whole number" });
      }
      const [order] = await db
        .insert(bondSecondaryOrders)
        .values({
          bondId: sub.bondId,
          subscriptionId: input.subscriptionId,
          sellerId: ctx.user.id,
          orderType: "sell",
          units: input.unitsToSell,
          askPrice: input.askPriceUsd.toFixed(2),
          totalValue: totalAsk.toFixed(2),
          currency: "USD",
          status: "open",
          expiresAt,
        })
        .returning();

      return {
        order,
        fairValue,
        premiumDiscount: ((input.askPriceUsd - fairValue) / fairValue) * 100,
        buyerPaidFee,
        // Seller netProceeds = the FULL ask amount — the platform fee is
        // charged to the buyer on top at fill time, not deducted from the ask.
        netProceeds: totalAsk,
      };
    }),

  fillBuyOrder: protectedProcedure
    .input(z.object({
      orderId: z.number(),
      unitsToFill: z.number().positive().optional(), // partial fill supported
    }))
    .mutation(async ({ ctx, input }) => {
      // A5: enforce the declared investments gate — this procedure debits the
      // buyer and credits the seller and previously had NO user check at all.
      await assertFeatureEligible(ctx, { flag: "investments", minKycTier: 2, minPlan: "growth", featureName: "Diaspora bond secondary market" });
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
      if (order.order.sellerId === ctx.user.id) {
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
      // W9/Q9: units is an INTEGER column — fractional fills cannot be persisted.
      if (!Number.isInteger(unitsToFill) || unitsToFill <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Units to fill must be a positive whole number" });
      }

      const totalCost = unitsToFill * Number(order.order.askPrice);
      const platformFee = totalCost * SECONDARY_MARKET_FEE_RATE;
      const totalWithFee = totalCost + platformFee;

      // FF-FIX: pipeline BEFORE any fund movement — a rejection can no longer
      // strand debits/credits with the order still open.
      const buyRef = `SEC-${order.order.id}-${ctx.user.id}`;
      const buyPipeline = await executeTransferPipeline({
        userId: ctx.user.id,
        amount: totalWithFee,
        fromCurrency: "USD",
        toCurrency: "USD",
        recipientName: `Bond Seller (User ${order.order.sellerId})`,
        rail: "internal",
        corridorCode: "NG",
        featureLabel: "diaspora_bond_secondary",
        transferId: buyRef,
        description: `Secondary market buy: ${unitsToFill.toFixed(2)} units of bond ${order.order.bondId}`,
        metadata: { orderId: input.orderId, askPrice: order.order.askPrice },
        skipVelocity: true,
      });

      const bond = order.bond!;
      const nextCoupon = calcNextCouponDate(bond);
      // W9-FIX2 (HIGH): the seller receives the FULL totalCost — the platform fee
      // is paid by the buyer on top and credited to the platform float wallet in
      // the fill transaction (no double fee, no vanished value).
      const sellerProceeds = totalCost;

      // FF-FIX (CRITICAL): the ENTIRE fill in ONE transaction —
      //   1. guarded single-winner order claim (status='open', enough units)
      //   2. guarded buyer debit (no overdraft race)
      //   3. seller credit, row-count checked
      //   4. DECREMENT the seller's subscription units (previously the seller
      //      kept an active full subscription after selling — the same units
      //      earned coupons and could be redeemed TWICE)
      //   5. buyer subscription insert
      //   6. order close/reduce
      const newSub = await db.transaction(async (tx: any) => {
        // 1. Claim the order — concurrent fills lose here.
        const claimRows = await tx
          .update(bondSecondaryOrders)
          .set({ status: "matched", updatedAt: new Date() })
          .where(and(
            eq(bondSecondaryOrders.id, input.orderId),
            eq(bondSecondaryOrders.status, "open"),
            sql`CAST(${bondSecondaryOrders.units} AS numeric) >= ${unitsToFill}`,
          ))
          .returning({ id: bondSecondaryOrders.id });
        if (claimRows.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Order was filled, reduced, or cancelled concurrently" });
        }

        // 2. Guarded buyer debit.
        const debitRows = (await tx.execute(sql`
          UPDATE wallets
          SET balance = balance - ${totalWithFee.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
          WHERE "userId" = ${ctx.user.id} AND currency = 'USD' AND status = 'active'
            AND CAST(balance AS numeric) >= ${totalWithFee.toFixed(2)}
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (debitRows.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Insufficient balance. Required: $${totalWithFee.toFixed(2)}` });
        }

        // 3. Seller credit of the FULL totalCost — row-count checked; aborts the
        // whole fill if the seller wallet is unavailable (buyer debit rolls back
        // too). W9-FIX2 (HIGH): the seller is NO LONGER charged a second fee —
        // previously sellerProceeds = totalCost - fee while the buyer already
        // paid totalCost + fee, so 2×fee vanished with no credit leg.
        const creditRows = (await tx.execute(sql`
          UPDATE wallets
          SET balance = balance + ${totalCost.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
          WHERE "userId" = ${order.order.sellerId} AND currency = 'USD' AND status = 'active'
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (creditRows.length === 0) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Seller wallet unavailable — fill aborted, no funds moved" });
        }

        // 3b. W9-FIX2 (HIGH): explicit platform-fee CREDIT leg. The buyer was
        // debited totalCost + platformFee; the seller received totalCost; the
        // platformFee portion is platform revenue and must land in the platform
        // float/treasury wallet in the SAME transaction (mirrors the primary
        // subscribe path B5 credit leg). Guarded update + row-count check —
        // any failure aborts the whole fill.
        // Conservation: buyerDebit(totalCost+fee) = sellerCredit(totalCost) + floatCredit(fee).
        if (platformFee > 0) {
          const feeCreditRows = (await tx.execute(sql`
            UPDATE wallets
            SET balance = balance + ${platformFee.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
            WHERE "userId" = ${PLATFORM_SYSTEM_USER_ID} AND currency = 'USD' AND status = 'active'
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (feeCreditRows.length === 0) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Platform float/treasury wallet not provisioned for fee credit — fill aborted, no funds moved" });
          }
        }

        // 4. Decrement the seller's subscription units (guarded) — sold units
        // must stop earning coupons and become ineligible for redemption.
        const subRows = (await tx.execute(sql`
          UPDATE bond_subscriptions
          SET units = units - ${unitsToFill},
              status = CASE WHEN units - ${unitsToFill} <= 0 THEN 'sold' ELSE status END,
              updated_at = NOW()
          WHERE id = ${order.order.subscriptionId}
            AND status = 'active'
            AND CAST(units AS numeric) >= ${unitsToFill}
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (subRows.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Seller subscription units insufficient — fill aborted, no funds moved" });
        }

        // 5. Buyer subscription.
        // W9/Q9: real bond_subscriptions columns only (integer units; no
        // principal_usd / coupon_rate_applied / payment_source / confirmed_at /
        // next_coupon_date / maturity_date / acquired_via_secondary).
        const [buyerSub] = await tx
          .insert(bondSubscriptions)
          .values({
            userId: ctx.user.id,
            bondId: order.order.bondId,
            subscriptionRef: `SEC-${order.order.id}-${ctx.user.id}-${Date.now().toString(36).toUpperCase()}`,
            units: unitsToFill,
            faceValue: String((unitsToFill * Number(bond.faceValue)).toFixed(2)),
            purchasePrice: String(totalCost.toFixed(2)),
            totalPaid: String(totalWithFee.toFixed(2)),
            currency: "USD",
            yieldAtPurchase: bond.couponRate,
            status: "active",
          })
          .returning();

        // 6. Close or partially fill the order.
        // W9/Q9: sm_order_status enum is ["open","matched","cancelled","expired"]
        // — "filled" is rejected; a fully-filled order is "matched".
        const remainingUnits = Number(order.order.units) - unitsToFill;
        if (remainingUnits < 1) {
          await tx
            .update(bondSecondaryOrders)
            .set({ status: "matched", matchedAt: new Date(), buyerId: ctx.user.id, updatedAt: new Date() })
            .where(eq(bondSecondaryOrders.id, input.orderId));
        } else {
          await tx
            .update(bondSecondaryOrders)
            .set({ status: "open", units: remainingUnits, updatedAt: new Date() })
            .where(eq(bondSecondaryOrders.id, input.orderId));
        }
        return buyerSub;
      });

      return {
        newSubscription: newSub,
        totalCost,
        platformFee,
        sellerProceeds,
        unitsAcquired: unitsToFill,
        verified: true,
        fraudScore: buyPipeline.fraudScore,
      };
    }),

  // ── Early Redemption ───────────────────────────────────────────────────────

  requestEarlyRedemption: protectedProcedure
    .input(z.object({
      subscriptionId: z.number(),
      reason: z.string().max(2000).optional(),
      totpCode: z.string().regex(/^\d{6}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // A5: enforce the declared investments gate (flag + KYC tier >= 2 + growth plan).
      await assertFeatureEligible(ctx, { flag: "investments", minKycTier: 2, minPlan: "growth", featureName: "Diaspora bond early redemption" });

      // D-runner: TOTP step-up — enrolled users must pass 2FA to redeem early.
      {
        const { getTotpEnrollment, verifyTOTP } = await import("../totp");
        const enrollment = await getTotpEnrollment(ctx.user.id);
        if (!enrollment.dbAvailable) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "2FA verification unavailable — action blocked" });
        if (enrollment.enabled && enrollment.secret) {
          if (!input.totpCode) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "2FA code required for this action" });
          const valid = await verifyTOTP(input.totpCode, enrollment.secret);
          if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid 2FA code" });
        }
      }

      const db = await getDb();
      const [sub] = await db
        .select()
        .from(bondSubscriptions)
        .where(and(eq(bondSubscriptions.id, input.subscriptionId), eq(bondSubscriptions.userId, ctx.user.id)));
      if (!sub) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      if (sub.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only active subscriptions can be redeemed early" });
      }

      const penalty = Number(sub.purchasePrice) * EARLY_REDEMPTION_PENALTY_RATE;
      const redemptionAmount = Number(sub.purchasePrice) - penalty;

      // FF-FIX: single-winner guarded transition + row-count-checked credit in
      // ONE transaction — concurrent redemption requests can no longer both
      // credit the wallet.
      await db.transaction(async (tx: any) => {
        // W9/Q9 (F14-2): subscription_status enum is ["pending_payment","active","matured","sold","cancelled"]
        // — "redeemed" is rejected by Postgres, so early redemption maps to "sold".
        // bond_subscriptions has no penalty/redemption-amount/redeemed-at/description columns;
        // the "early redemption" semantics are recorded on the audit transaction row below.
        const won = await tx
          .update(bondSubscriptions)
          .set({
            status: "sold",
            updatedAt: new Date(),
          })
          .where(and(eq(bondSubscriptions.id, input.subscriptionId), eq(bondSubscriptions.status, "active")))
          .returning({ id: bondSubscriptions.id });
        if (won.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Subscription was already redeemed or is no longer active" });
        }

        // B5: redemptions are FUNDED — guarded debit of the platform
        // float/treasury wallet in the same transaction. Never mint unbacked
        // balance. Insufficient/missing float => throw; the redemption rolls
        // back and the subscription stays active (nothing partial).
        const floatDebit = (await tx.execute(sql`
          UPDATE wallets
          SET balance = balance - ${redemptionAmount.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
          WHERE "userId" = ${PLATFORM_SYSTEM_USER_ID} AND currency = 'USD'
            AND CAST(balance AS numeric) >= ${redemptionAmount.toFixed(2)}
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (floatDebit.length === 0) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Platform float/treasury insufficient — redemption aborted, subscription still active" });
        }

        const creditRows = (await tx.execute(sql`
          UPDATE wallets
          SET balance = balance + ${redemptionAmount.toFixed(2)}, "updatedAt" = NOW(), version = version + 1
          WHERE "userId" = ${ctx.user.id} AND currency = 'USD' AND status = 'active'
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (creditRows.length === 0) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "USD wallet unavailable — redemption aborted, subscription still active" });
        }

        // W9/Q9: audit trail for the redemption credit — "early redemption" semantics
        // live here (bond_subscriptions has no description/penalty columns).
        await tx.insert(transactions).values({
          userId: ctx.user.id,
          type: "receive",
          fromAmount: redemptionAmount.toFixed(2),
          fromCurrency: "USD",
          status: "completed",
          reference: `BONDREDEEM-${input.subscriptionId}`,
          description: `Diaspora bond early redemption (${EARLY_REDEMPTION_PENALTY_RATE * 100}% penalty applied)`,
          metadata: { originalType: "diaspora_bond_early_redemption", subscriptionId: input.subscriptionId, penalty },
        });
      });

      await createAuditLog({ userId: ctx.user.id, action: "BOND_EARLY_REDEMPTION", metadata: { subscriptionId: input.subscriptionId, redemptionAmount, penalty, reason: input.reason } });
      return { subscriptionId: input.subscriptionId, redemptionAmount, penalty, status: "sold" };
    }),

  // ── Investment Opportunities ───────────────────────────────────────────────

  listInvestmentOpportunities: protectedProcedure
    .input(z.object({
      type: z.enum(["bond", "real_estate", "treasury_bill", "mutual_fund", "all"]).default("all"),
      minAmount: z.number().optional(),
      maxRisk: z.enum(["low", "medium", "high", "all"]).default("all"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      const opportunities = await db
        .select()
        .from(investmentOpportunities)
        .where(eq(investmentOpportunities.status, "active"))
        .orderBy(desc(investmentOpportunities.createdAt));

      const RISK_ORDER = ["low", "medium", "high"];
      return opportunities
        .filter((o: any) => input.type === "all" || o.type === input.type)
        .filter((o: any) => !input.minAmount || Number(o.minInvestment) <= input.minAmount)
        .filter((o: any) => input.maxRisk === "all" || RISK_ORDER.indexOf(o.riskLevel) <= RISK_ORDER.indexOf(input.maxRisk));
    }),
});
