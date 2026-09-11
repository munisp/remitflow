/**
 * Investment Router — v74
 * Covers: NGX Stock Market, Real Estate (Fractional), Startup Deals, Portfolio,
 *         PayPal Topup, Flutterwave Topup
 */
import { z } from "zod";
import { auditedProcedure, auditedAdminProcedure, rateLimitedProcedure } from "../_core/trpc";
import { eq, desc, and, like, ilike, sql, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, publicProcedure, adminProcedure } from "../_core/trpc.js";
import { getDb, createAuditLog } from "../db.js";
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
import { executeTransferPipeline } from "../_core/transferPipeline.js";
import { publishEvent, KAFKA_TOPICS } from "../middleware/kafka.js";
import { broadcastUserEvent } from "../sse.service.js";
import { sendNotification } from "../notifications.service.js";
import { logger } from "../_core/logger.js";
import { assertInvestmentEligible } from "../_core/investmentGuard.js";
import { getBrokerAdapter, verifyBrokerWebhookSignature } from "../services/brokerAdapter.js";


async function getDbConn() {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateTxRef(prefix = "RF") {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

/**
 * W9/F11-5: canonical TOTP step-up (Wave 7 Contract 2) for admin lifecycle
 * confirmations. Enrolled admins MUST pass 2FA; fail closed when the
 * enrollment store is unavailable.
 */
async function requireTotpStepUp(userId: number, totpCode: string | undefined, actionLabel: string): Promise<void> {
  const { getTotpEnrollment, verifyTOTP } = await import("../totp");
  const enrollment = await getTotpEnrollment(userId);
  if (!enrollment.dbAvailable) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `2FA verification unavailable — ${actionLabel} blocked (fail-closed)` });
  }
  if (!enrollment.enabled || !enrollment.secret) {
    // W12: never waive — money-moving/lifecycle actions require enrollment.
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Two-factor authentication enrollment required before ${actionLabel}` });
  }
  if (!totpCode) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "2FA code required for this action" });
  const valid = await verifyTOTP(totpCode, enrollment.secret);
  if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid 2FA code" });
}

// ─── G3: Market-data staleness honesty ────────────────────────────────────────
// Prices older than 24h are stale. When NGX_FEED_URL is not configured there
// is no live feed at all — every price is seed/indicative and MUST be
// surfaced as such instead of pretending to be a live quote.
const PRICE_STALE_MS = 24 * 60 * 60 * 1000;

function currentPriceSource(): "seed" | "feed" {
  return process.env.NGX_FEED_URL ? "feed" : "seed";
}

function isPriceStale(lastUpdated: Date | string | null | undefined): boolean {
  const ts = lastUpdated ? new Date(lastUpdated).getTime() : NaN;
  if (!Number.isFinite(ts) || ts <= 0) return true; // fail closed: unknown age = stale
  return Date.now() - ts > PRICE_STALE_MS;
}

function withPriceHonesty<T extends { lastUpdated?: Date | string | null }>(stock: T) {
  return { ...stock, priceStale: isPriceStale(stock.lastUpdated), priceSource: currentPriceSource() };
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
      // G3: surface staleness/source — never present seed data as live quotes
      return stocks.map(withPriceHonesty);
    }),

  getById: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [stock] = await (await getDbConn())
        .select()
        .from(ngxStocks)
        .where(eq(ngxStocks.id, input.id));
      if (!stock) throw new TRPCError({ code: "NOT_FOUND", message: "Stock not found" });
      return withPriceHonesty(stock);
    }),

  getByTicker: publicProcedure
    .input(z.object({ ticker: z.string().max(20) }))
    .query(async ({ input }) => {
      const [stock] = await (await getDbConn())
        .select()
        .from(ngxStocks)
        .where(eq(ngxStocks.ticker, input.ticker.toUpperCase()));
      if (!stock) throw new TRPCError({ code: "NOT_FOUND", message: "Stock not found" });
      return withPriceHonesty(stock);
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
        // FF-FIX: strict unsigned decimals — sign-bearing strings previously
        // parsed to negative numbers and CREDITED the buyer (money creation).
        quantityUnits: z.string().regex(/^\d+(\.\d{1,4})?$/, "quantityUnits must be an unsigned decimal"),
        pricePerUnitNgn: z.string().regex(/^\d+(\.\d{1,4})?$/, "pricePerUnitNgn must be an unsigned decimal"),
        brokerName: z.enum(["Bamboo", "Trove", "Chaka", "Stanbic", "GTB"]).default("Bamboo"),
        notes: z.string().max(500).optional(),
        // Client retry dedupe. NOTE: full race-safety also needs a UNIQUE
        // constraint on ngx_orders.broker_reference (schema follow-up).
        idempotencyKey: z.string().max(90).optional(),
        // G4: TOTP confirmation — required (when the user is enrolled) for
        // sells of any size and buys above TOTP_THRESHOLD_NGN.
        totpCode: z.string().regex(/^\d{6}$/, "totpCode must be a 6-digit code").optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // G1: feature flag + tier2 KYC + growth plan — fail closed
      await assertInvestmentEligible(ctx);

      const db = await getDbConn();
      const [stock] = await db.select().from(ngxStocks).where(eq(ngxStocks.id, input.stockId));
      if (!stock) throw new TRPCError({ code: "NOT_FOUND", message: "Stock not found" });

      const qty = safeParseAmount(input.quantityUnits, { unsigned: true });
      const price = safeParseAmount(input.pricePerUnitNgn, { unsigned: true });
      const totalNgn = qty * price;
      if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price <= 0 || !Number.isFinite(totalNgn) || totalNgn <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "quantityUnits and pricePerUnitNgn must be positive amounts" });
      }
      let ngnRate = 1600;
      try {
        const fxRes = await fetch("https://open.er-api.com/v6/latest/USD");
        if (fxRes.ok) {
          const fxData = await fxRes.json() as { rates?: Record<string, number> };
          if (fxData.rates?.NGN) ngnRate = fxData.rates.NGN;
        }
      } catch { /* use fallback rate */ }
      const approxUsd = totalNgn / ngnRate;

      const isBuy = input.orderType === "buy" || input.orderType === "limit_buy";
      const isMarketOrder = input.orderType === "buy" || input.orderType === "sell";

      // G3: market orders execute against the displayed price — refuse to
      // trade on stale quotes. Limit orders may proceed (user sets the price).
      if (isMarketOrder && isPriceStale(stock.lastUpdated)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Price data stale — place a limit order or wait for feed refresh",
        });
      }

      // Idempotent replay: a client retry with the same key returns the first
      // order instead of double-debiting and double-ordering.
      const orderRef = input.idempotencyKey ? `NGX-${input.idempotencyKey}` : generateTxRef("NGX");
      if (input.idempotencyKey) {
        const [existingOrder] = await db.select().from(ngxOrders)
          .where(and(eq(ngxOrders.userId, ctx.user.id), eq(ngxOrders.brokerReference, orderRef)))
          .limit(1);
        if (existingOrder) {
          return {
            ...existingOrder,
            verified: true,
            idempotent: true,
            fraudScore: null,
            brokerStatus: existingOrder.status === "submitted" ? "submitted"
              : existingOrder.status === "pending_broker" ? "queued_for_ops"
              : undefined,
          };
        }
      }

      // G4: TOTP gate (mirrors p2pInstant.ts:446-458). Fail closed when the
      // enrollment lookup is unavailable; when the user IS enrolled, a valid
      // code is required for all sells (assets leave the account, any amount)
      // and for buys/limit_buys above ₦1,000,000 total.
      const TOTP_THRESHOLD_NGN = 1_000_000;
      const totpRequired = !isBuy || totalNgn > TOTP_THRESHOLD_NGN;
      if (totpRequired) {
        const { getTotpEnrollment, verifyTOTP } = await import("../totp");
        const enrollment = await getTotpEnrollment(ctx.user.id);
        if (!enrollment.dbAvailable) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "2FA verification unavailable — order blocked" });
        }
        if (enrollment.enabled && enrollment.secret) {
          if (!input.totpCode) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: isBuy
                ? `TOTP_REQUIRED: orders above ₦${TOTP_THRESHOLD_NGN.toLocaleString()} require your 6-digit 2FA code`
                : "TOTP_REQUIRED: sell orders require your 6-digit 2FA code",
            });
          }
          const valid = await verifyTOTP(input.totpCode, enrollment.secret);
          if (!valid) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Invalid TOTP code" });
          }
        }
        // Not enrolled: no silent bypass for existing behaviour — the check
        // only binds enrolled users (per spec). Enrollment is encouraged via
        // security settings.
      }

      // FF-FIX: run the pipeline (sanctions/fraud/TB hold) BEFORE any wallet
      // debit — a pipeline rejection can no longer strand a debit with no order.
      // FF-002: pass the NATIVE NGN amount — the pipeline converts to minor
      // units for the NGN TB ledger (566). Passing the USD estimate with
      // fromCurrency NGN under-held by ~1600x.
      const pipelineResult = await executeTransferPipeline({
        userId: ctx.user.id,
        amount: totalNgn,
        fromCurrency: "NGN",
        toCurrency: "NGN",
        recipientName: stock.ticker ?? "NGX Stock",
        rail: "internal",
        corridorCode: "NG",
        featureLabel: "ngx_stock_order",
        transferId: orderRef,
        description: `NGX ${input.orderType}: ${qty} units of ${stock.ticker} @ ₦${price}`,
        metadata: { stockId: input.stockId, orderType: input.orderType, brokerName: input.brokerName },
      });

      // FF-FIX: guarded debit + order insert in ONE transaction — an insert
      // failure rolls the debit back; a concurrent-debit loss (0 rows) aborts
      // the insert. No compensation path is needed because nothing commits
      // partially.
      const order = await db.transaction(async (tx: any) => {
        if (isBuy) {
          const debitRows = (await tx.execute(sql`
            UPDATE wallets
            SET balance = CAST(CAST(balance AS DECIMAL(18,4)) - ${totalNgn} AS VARCHAR),
                "updatedAt" = NOW(),
                version = version + 1
            WHERE "userId" = ${ctx.user.id}
              AND currency = 'NGN'
              AND status = 'active'
              AND CAST(balance AS DECIMAL(18,4)) >= ${totalNgn}
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (debitRows.length === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient NGN wallet balance" });
          }
        }
        const [o] = await tx
          .insert(ngxOrders)
          .values({
            userId: ctx.user.id,
            stockId: input.stockId,
            orderType: input.orderType,
            // G2: honest status — the order is NOT at the broker yet. It only
            // leaves pending_broker when a real broker API accepts it
            // (submitted) or ops reconcile it manually. Never "executed"
            // here; executed_at is set only by a verified broker fill
            // webhook (see brokerWebhook TODO below).
            status: "pending_broker",
            quantityUnits: input.quantityUnits,
            pricePerUnitNgn: input.pricePerUnitNgn,
            totalAmountNgn: totalNgn.toFixed(2),
            totalAmountUsd: approxUsd.toFixed(2),
            fxRateUsed: ngnRate.toFixed(6),
            brokerName: input.brokerName,
            brokerReference: orderRef,
            notes: input.notes,
          })
          .returning();
        return o;
      });

      // G2: AFTER the debit+insert commit, attempt real broker submission.
      // Funds stay debited either way — the wallet debit is the hold backing
      // the order. On non-acceptance the order stays pending_broker for ops;
      // cancelOrder refunds pending_broker orders in one transaction.
      const adapter = getBrokerAdapter(input.brokerName);
      const submit = await adapter.submitOrder({
        id: order.id,
        reference: orderRef,
        ticker: stock.ticker,
        orderType: input.orderType,
        quantityUnits: input.quantityUnits,
        pricePerUnitNgn: input.pricePerUnitNgn,
        totalAmountNgn: totalNgn.toFixed(2),
      });

      if (submit.accepted) {
        // Guarded transition — only flip pending_broker → submitted once.
        // When an idempotencyKey is in play, broker_reference doubles as the
        // replay key, so keep it and return the broker's reference in the
        // response payload only; otherwise store it on the row.
        const keepReplayRef = Boolean(input.idempotencyKey);
        const newBrokerRef = !keepReplayRef && submit.brokerReference ? submit.brokerReference : orderRef;
        const [submitted] = await db
          .update(ngxOrders)
          .set({ status: "submitted", brokerReference: newBrokerRef })
          .where(and(eq(ngxOrders.id, order.id), eq(ngxOrders.status, "pending_broker")))
          .returning();
        return {
          ...(submitted ?? order),
          status: submitted ? "submitted" : order.status,
          verified: true,
          fraudScore: pipelineResult.fraudScore,
          brokerStatus: "submitted" as const,
          brokerReference: submit.brokerReference ?? newBrokerRef,
        };
      }

      logger.warn(
        { orderId: order.id, broker: input.brokerName, reason: submit.reason },
        "[NGX] Broker did not accept order — queued for manual ops execution",
      );
      return {
        ...order,
        verified: true,
        fraudScore: pipelineResult.fraudScore,
        brokerStatus: "queued_for_ops" as const,
        brokerMessage: `Order accepted and funds held, but ${input.brokerName} did not confirm submission (${submit.reason ?? "unknown"}). Execution is queued for manual processing by operations.`,
      };
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
      // FF-013: transition atomically — only the caller that wins the
      // pending/pending_broker → cancelled UPDATE may refund. Concurrent
      // losers get 0 rows.
      // G2: pending_broker orders (queued for the broker, funds held) are
      // cancellable; the status transition AND the wallet refund commit in
      // ONE transaction so a refund can never be lost or doubled.
      // `submitted` orders are already at the broker — ops must recall them.
      const cancellableStatuses = ["pending", "pending_broker"];
      const order = await db.transaction(async (tx: any) => {
        const [o] = await tx
          .update(ngxOrders)
          .set({ status: "cancelled" })
          .where(and(
            eq(ngxOrders.id, input.orderId),
            eq(ngxOrders.userId, ctx.user.id),
            inArray(ngxOrders.status, cancellableStatuses),
          ))
          .returning();
        if (!o) return null;

        // Refund wallet if this was a buy order (funds were debited at order time)
        if (o.orderType === "buy" || o.orderType === "limit_buy") {
          const refundAmount = Number(o.totalAmountNgn);
          if (refundAmount > 0) {
            const refundRows = (await tx.execute(sql`
              UPDATE wallets SET balance = CAST(CAST(balance AS DECIMAL(18,4)) + ${refundAmount} AS VARCHAR), "updatedAt" = NOW()
              WHERE "userId" = ${ctx.user.id} AND currency = 'NGN'
              RETURNING id
            `)) as unknown as Array<{ id: number }>;
            if (refundRows.length === 0) {
              // No wallet to refund into — roll back BOTH the refund and the
              // status transition so the hold is never silently released.
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "NGN wallet unavailable — cancellation rolled back" });
            }
          }
        }
        return o;
      });
      if (!order) {
        const [existing] = await db
          .select()
          .from(ngxOrders)
          .where(and(eq(ngxOrders.id, input.orderId), eq(ngxOrders.userId, ctx.user.id)));
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: existing.status === "submitted"
            ? "Order already submitted to the broker — contact operations to recall it"
            : "Only pending or broker-queued orders can be cancelled",
        });
      }

      const refunded = order.orderType === "buy" || order.orderType === "limit_buy";
      return { ...order, refunded };
    }),

  // ─── G2: Broker webhook placeholder ─────────────────────────────────────────
  // TODO(G2): implement real fill ingestion — on an HMAC-verified "filled"
  // notification, set status='executed' + executed_at, release/settle the
  // wallet hold, and notify the user. Until then executions are reconciled
  // manually by operations; executedAt is NEVER set by placeOrder.
  brokerWebhook: publicProcedure
    .input(
      z.object({
        brokerName: z.enum(["Bamboo", "Trove", "Chaka", "Stanbic", "GTB"]),
        // hex HMAC-SHA256 of JSON.stringify(payload) with BROKER_<NAME>_API_KEY
        signature: z.string().max(256),
        payload: z.object({
          brokerReference: z.string().max(100).optional(),
          reference: z.string().max(100).optional(),
          status: z.string().max(30).optional(),
          executedAt: z.string().max(40).optional(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const envKey = input.brokerName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
      if (!process.env[`BROKER_${envKey}_API_KEY`]) {
        throw new TRPCError({ code: "NOT_IMPLEMENTED", message: `Broker ${input.brokerName} is not configured — webhook ingestion unavailable` });
      }
      const ok = verifyBrokerWebhookSignature(input.brokerName, JSON.stringify(input.payload), input.signature);
      if (!ok) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid broker webhook signature" });
      }
      // Signature verified, but fill processing is intentionally not
      // implemented yet — fail closed with 501 instead of pretending.
      throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Broker fill ingestion not yet implemented — executions are reconciled manually by operations" });
    }),

  // ─── G3: Price ingestion from the internal market-data feed ────────────────
  // Ops flow: cron calls the Go feed service /refresh → feed validates NGX
  // quotes and POSTs them here (admin-authenticated) → UPSERT by ticker with
  // lastUpdated=now (this is what flips priceStale back to false).
  // NOTE: no inbound internal-service-token pattern exists in the TS core
  // (X-Internal-Token is outbound-only), so per spec this is an admin
  // procedure. The feed caller must use an admin credential.
  ingestPrices: auditedAdminProcedure
    .input(
      z.object({
        prices: z
          .array(
            z.object({
              ticker: z.string().min(1).max(20),
              price_ngn: z.number(),
              previous_close_ngn: z.number().optional(),
              change_percent: z.number().optional(),
              market_cap_ngn: z.number().optional(),
            })
          )
          .min(1)
          .max(500),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDbConn();
      const TICKER_RE = /^[A-Z0-9.\-]{1,20}$/;
      let updated = 0;
      const rejectedTickers: Array<{ ticker: string; reason: string }> = [];

      await db.transaction(async (tx: any) => {
        for (const p of input.prices) {
          const ticker = p.ticker.toUpperCase().trim();
          // Fail closed per entry: bad ticker shape or non-positive price.
          if (!TICKER_RE.test(ticker)) {
            rejectedTickers.push({ ticker: p.ticker, reason: "invalid_ticker" });
            continue;
          }
          if (!Number.isFinite(p.price_ngn) || p.price_ngn <= 0) {
            rejectedTickers.push({ ticker, reason: "non_positive_price" });
            continue;
          }
          const set: Record<string, unknown> = {
            currentPriceNgn: p.price_ngn.toFixed(4),
            lastUpdated: new Date(),
          };
          if (p.previous_close_ngn != null && Number.isFinite(p.previous_close_ngn) && p.previous_close_ngn > 0) {
            set.previousCloseNgn = p.previous_close_ngn.toFixed(4);
          }
          if (p.change_percent != null && Number.isFinite(p.change_percent)) {
            set.changePercent = p.change_percent.toFixed(4);
          }
          if (p.market_cap_ngn != null && Number.isFinite(p.market_cap_ngn) && p.market_cap_ngn > 0) {
            set.marketCapNgn = p.market_cap_ngn.toFixed(2);
          }
          // UPDATE only — never invent new instruments from the feed. Unknown
          // tickers are rejected (new listings are an admin/onboarding act).
          const rows = await tx
            .update(ngxStocks)
            .set(set)
            .where(eq(ngxStocks.ticker, ticker))
            .returning({ id: ngxStocks.id });
          if (rows.length === 0) {
            rejectedTickers.push({ ticker, reason: "unknown_ticker" });
          } else {
            updated += 1;
          }
        }
      });

      return { updated, rejected: rejectedTickers.length, rejectedTickers };
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
        totpCode: z.string().regex(/^\d{6}$/).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // G1: feature flag + tier2 KYC + growth plan — fail closed
      await assertInvestmentEligible(ctx);

      // W12: canonical TOTP step-up (fail-closed) — wallet-debiting mutation.
      await requireTotpStepUp(ctx.user.id, input.totpCode, "real-estate investment");

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

      if (totalUsd <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Investment total must be positive" });
      }

      // FF-FIX: run the pipeline BEFORE any wallet debit — a pipeline rejection
      // (sanctions, TB outage, unprovisioned account) can no longer strand a
      // debit with no investment.
      const investRef = generateTxRef("RE-P");
      const pipelineResult = await executeTransferPipeline({
        userId: ctx.user.id,
        amount: totalUsd,
        fromCurrency: "USD",
        toCurrency: "USD",
        recipientName: listing.title ?? "Real Estate Investment",
        rail: "internal",
        corridorCode: "NG",
        featureLabel: "real_estate_invest",
        transferId: investRef,
        description: `Real estate: ${input.sharesCount} shares of ${listing.title}`,
        metadata: { listingId: input.listingId, sharesCount: input.sharesCount, ownershipPct },
      });

      // FF-FIX: guarded wallet debit + guarded shares decrement + investment
      // record in ONE transaction — no overdraft race, no oversold shares, no
      // orphaned debit on insert failure.
      const investment = await (await getDbConn()).transaction(async (tx: any) => {
        const debitRows = (await tx.execute(sql`
          UPDATE wallets
          SET balance = CAST(CAST(balance AS DECIMAL(18,4)) - ${totalUsd} AS VARCHAR),
              "updatedAt" = NOW(),
              version = version + 1
          WHERE "userId" = ${ctx.user.id}
            AND currency = 'USD'
            AND status = 'active'
            AND CAST(balance AS DECIMAL(18,4)) >= ${totalUsd}
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (debitRows.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient USD wallet balance" });
        }

        const shareRows = (await tx.execute(sql`
          UPDATE real_estate_listings
          SET available_shares = available_shares - ${input.sharesCount},
              status = CASE WHEN available_shares - ${input.sharesCount} <= 0 THEN 'funded' ELSE 'open' END,
              "updatedAt" = NOW()
          WHERE id = ${input.listingId}
            AND status = 'open'
            AND available_shares >= ${input.sharesCount}
          RETURNING available_shares
        `)) as unknown as Array<{ available_shares: number }>;
        if (shareRows.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Not enough shares available (concurrent purchase)" });
        }

        const [inv] = await tx
          .insert(realEstateInvestments)
          .values({
            userId: ctx.user.id,
            listingId: input.listingId,
            sharesOwned: input.sharesCount,
            pricePerSharePaid: pricePerShare.toFixed(2),
            totalInvestedUsd: totalUsd.toFixed(2),
            ownershipPct: ownershipPct.toFixed(6),
            // W7/B8: no SPV/purchase/custody exists yet — the ownership record
            // is NOT active until asset custody is confirmed.
            status: "pending_acquisition",
          })
          .returning();

        await tx.insert(transactions).values({
          userId: ctx.user.id,
          // W7/B8: was "topup" (money-in) for a wallet DEBIT — a lie in the
          // audit trail. tx_type enum has no "investment" value and schema
          // changes are out of scope; "withdrawal" is the honest money-out
          // direction. Description + channel carry the investment context.
          type: "withdrawal",
          status: "completed",
          fromCurrency: "USD",
          fromAmount: totalUsd.toFixed(2),
          toCurrency: "USD",
          toAmount: totalUsd.toFixed(2),
          description: `Real estate investment: ${listing.title} (${input.sharesCount} shares)`,
          reference: generateTxRef("RE"),
          channel: "real_estate",
        });
        return inv;
      });

      return {
        ...investment,
        verified: true,
        fraudScore: pipelineResult.fraudScore,
        // W7/B8: honesty — wallet was debited but no SPV purchase/custody
        // exists; ownership is pending acquisition, not active.
        custodyPending: true,
        note: "Funds debited and shares reserved — asset custody/acquisition is pending; this ownership record is not yet active.",
      };
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
      if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
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

  // ── W9/F11-5: admin custody confirmation. The ONLY path that flips a
  // real-estate holding out of `pending_acquisition` — nothing auto-flips.
  // Requires the SPV/custody reference + TOTP step-up for enrolled admins.
  confirmCustody: adminProcedure
    .input(z.object({
      holdingId: z.number().int().positive(),
      reference: z.string().min(3).max(200),
      totpCode: z.string().regex(/^\d{6}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "custody confirmation");
      const db = await getDbConn();
      const [holding] = await db
        .select()
        .from(realEstateInvestments)
        .where(eq(realEstateInvestments.id, input.holdingId))
        .limit(1);
      if (!holding) throw new TRPCError({ code: "NOT_FOUND", message: "Holding not found" });
      if (holding.status !== "pending_acquisition") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot confirm custody for holding in status: ${holding.status}` });
      }

      // Single-winner flip — two concurrent confirmations can't both activate.
      const flipped = await db
        .update(realEstateInvestments)
        .set({ status: "active" })
        .where(and(eq(realEstateInvestments.id, input.holdingId), eq(realEstateInvestments.status, "pending_acquisition")))
        .returning();
      if (flipped.length === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Custody was already confirmed by another admin" });
      }

      // Reference is recorded durably in the audit trail (the table has no
      // custody-reference column and schema changes are out of scope).
      await createAuditLog({
        userId: ctx.user.id,
        action: "REAL_ESTATE_CUSTODY_CONFIRMED",
        description: `Custody confirmed for real-estate holding ${input.holdingId} (user ${holding.userId}, listing ${holding.listingId}) — custody ref ${input.reference}`,
        targetId: input.holdingId,
        targetType: "real_estate_investment",
        metadata: { holdingId: input.holdingId, reference: input.reference, previousStatus: "pending_acquisition", newStatus: "active" },
      });

      return { holding: flipped[0], custodyConfirmed: true, reference: input.reference };
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
        totpCode: z.string().regex(/^\d{6}$/).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // G1: feature flag + tier2 KYC + growth plan — fail closed
      await assertInvestmentEligible(ctx);

      // W12: canonical TOTP step-up (fail-closed) — wallet-debiting mutation.
      await requireTotpStepUp(ctx.user.id, input.totpCode, "startup investment commitment");

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

      // Calculate equity
      const valuation = safeParseAmount(deal.valuationUsd ?? "0");
      const equityPct = valuation > 0 ? (input.amountUsd / valuation) * 100 : null;

      // FF-FIX: run the pipeline BEFORE any wallet debit — a pipeline rejection
      // can no longer strand a debit with no investment.
      const commitRef = generateTxRef("SI-P");
      const pipelineResult = await executeTransferPipeline({
        userId: ctx.user.id,
        amount: input.amountUsd,
        fromCurrency: "USD",
        toCurrency: "USD",
        recipientName: deal.companyName ?? "Startup Investment",
        rail: "internal",
        corridorCode: "NG",
        featureLabel: "startup_invest",
        transferId: commitRef,
        description: `Startup: $${input.amountUsd} into ${deal.companyName} (${deal.instrumentType})`,
        metadata: { dealId: input.dealId, instrumentType: deal.instrumentType, equityPct },
      });

      // FF-FIX: guarded wallet debit + raise update + investment record in ONE
      // transaction — no overdraft race and no orphaned debit on failure.
      const investment = await (await getDbConn()).transaction(async (tx: any) => {
        if (input.paymentMethod === "wallet") {
          const debitRows = (await tx.execute(sql`
            UPDATE wallets
            SET balance = CAST(CAST(balance AS DECIMAL(18,4)) - ${input.amountUsd} AS VARCHAR),
                "updatedAt" = NOW(),
                version = version + 1
            WHERE "userId" = ${ctx.user.id}
              AND currency = 'USD'
              AND status = 'active'
              AND CAST(balance AS DECIMAL(18,4)) >= ${input.amountUsd}
            RETURNING id
          `)) as unknown as Array<{ id: number }>;
          if (debitRows.length === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient USD wallet balance" });
          }
        }

        // Update raised so far
        const newRaised = safeParseAmount(deal.raisedSoFarUsd ?? "0") + input.amountUsd;
        const newStatus =
          newRaised >= safeParseAmount(deal.targetRaiseUsd) ? "funded" : deal.status;
        await tx
          .update(startupDeals)
          .set({ raisedSoFarUsd: newRaised.toFixed(2), status: newStatus })
          .where(eq(startupDeals.id, input.dealId));

        const [inv] = await tx
          .insert(startupInvestments)
          .values({
            userId: ctx.user.id,
            dealId: input.dealId,
            amountUsd: input.amountUsd.toFixed(2),
            instrumentType: deal.instrumentType,
            equityPct: equityPct !== null ? equityPct.toFixed(6) : null,
            // W7/B8 (verification round): a wallet debit proves funds moved,
            // but no SPV/escrow/custody of the startup asset exists — the
            // investment is NOT "confirmed". It stays pending acquisition
            // until real asset custody is confirmed (confirmedAt stays null).
            status: input.paymentMethod === "wallet" ? "pending_acquisition" : "pending",
            paymentMethod: input.paymentMethod,
            notes: input.notes,
            confirmedAt: null,
          })
          .returning();

        if (input.paymentMethod === "wallet") {
          await tx.insert(transactions).values({
            userId: ctx.user.id,
            // W7/B8: was "topup" (money-in) for a wallet DEBIT — a lie in the
            // audit trail. tx_type enum has no "investment" value and schema
            // changes are out of scope; "withdrawal" is the honest money-out
            // direction. Description + channel carry the investment context.
            type: "withdrawal",
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
        return inv;
      });

      return {
        ...investment,
        verified: true,
        fraudScore: pipelineResult.fraudScore,
        // W7/B8 (verification round): honesty — wallet was debited but no
        // SPV/escrow/custody of the startup asset exists; the investment is
        // pending acquisition, not confirmed.
        custodyPending: true,
        note: "Funds debited and commitment recorded — asset custody/acquisition is pending; this investment is not yet confirmed.",
      };
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
      if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      const [updated] = await (await getDbConn())
        .update(startupInvestments)
        .set({ agreementSigned: true })
        .where(eq(startupInvestments.id, input.investmentId))
        .returning();
      return updated;
    }),

  // ── W9/F11-5: admin custody confirmation. The ONLY path that flips a
  // startup holding out of `pending_acquisition` — nothing auto-flips.
  // Requires the SPV/custody reference + TOTP step-up for enrolled admins.
  // NOTE: startup holdings use `confirmed` (not `active`) as their live status
  // — that is what the portfolio summary counts and what `confirmedAt` backs.
  confirmCustody: adminProcedure
    .input(z.object({
      holdingId: z.number().int().positive(),
      reference: z.string().min(3).max(200),
      totpCode: z.string().regex(/^\d{6}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireTotpStepUp(ctx.user.id, input.totpCode, "custody confirmation");
      const db = await getDbConn();
      const [holding] = await db
        .select()
        .from(startupInvestments)
        .where(eq(startupInvestments.id, input.holdingId))
        .limit(1);
      if (!holding) throw new TRPCError({ code: "NOT_FOUND", message: "Holding not found" });
      if (holding.status !== "pending_acquisition" && holding.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot confirm custody for holding in status: ${holding.status}` });
      }

      // Single-winner flip — two concurrent confirmations can't both confirm.
      const flipped = await db
        .update(startupInvestments)
        .set({ status: "confirmed", confirmedAt: new Date() })
        .where(and(eq(startupInvestments.id, input.holdingId), inArray(startupInvestments.status, ["pending_acquisition", "pending"])))
        .returning();
      if (flipped.length === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Custody was already confirmed by another admin" });
      }

      // Reference is recorded durably in the audit trail (the table has no
      // custody-reference column and schema changes are out of scope).
      await createAuditLog({
        userId: ctx.user.id,
        action: "STARTUP_CUSTODY_CONFIRMED",
        description: `Custody confirmed for startup holding ${input.holdingId} (user ${holding.userId}, deal ${holding.dealId}) — custody ref ${input.reference}`,
        targetId: input.holdingId,
        targetType: "startup_investment",
        metadata: { holdingId: input.holdingId, reference: input.reference, previousStatus: holding.status, newStatus: "confirmed" },
      });

      return { holding: flipped[0], custodyConfirmed: true, reference: input.reference };
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
      // G1: feature flag + tier2 KYC + growth plan — fail closed
      await assertInvestmentEligible(ctx);

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
      }).returning();

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
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const captureData = (await captureRes.json()) as {
        status?: string;
        purchase_units?: { payments?: { captures?: { id: string; amount: { value: string } }[] } }[];
      };
      if (captureData.status !== "COMPLETED")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Payment not completed" });

      const capture = captureData.purchase_units?.[0]?.payments?.captures?.[0];
      const capturedAmount = safeParseAmount(capture?.amount?.value ?? "0");

      const [txRow] = await (await getDbConn())
        .select()
        .from(paypalTransactions)
        .where(and(eq(paypalTransactions.paypalOrderId, input.orderId), eq(paypalTransactions.userId, ctx.user.id)));
      if (!txRow) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      if (txRow.walletCredited) return { success: true, verified: true, amountUsd: safeParseAmount(txRow.amountUsd) };

      // FF-FIX: verify the captured amount matches the stored order before crediting.
      const expected = safeParseAmount(txRow.amountUsd);
      if (!Number.isFinite(capturedAmount) || capturedAmount <= 0 || Math.abs(capturedAmount - expected) > 0.01) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Captured amount $${capturedAmount} does not match order amount $${expected}` });
      }

      // Ensure the USD wallet exists before the atomic claim (a missing wallet
      // previously meant funds were marked credited but never arrived).
      let [wallet] = await (await getDbConn())
        .select()
        .from(wallets)
        .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "USD")))
        .limit(1);
      if (!wallet) {
        try {
          [wallet] = await (await getDbConn()).insert(wallets)
            .values({ userId: ctx.user.id, currency: "USD", balance: "0.00" })
            .returning();
        } catch {
          [wallet] = await (await getDbConn()).select().from(wallets)
            .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "USD"))).limit(1);
        }
      }
      if (!wallet) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "USD wallet unavailable" });

      // FF-FIX: atomic single-winner claim + wallet credit in ONE transaction.
      // A concurrent capture loses the claim (wallet_credited already true)
      // and rolls back — exactly one credit per PayPal order.
      await (await getDbConn()).transaction(async (tx: any) => {
        const claimRows = (await tx.execute(sql`
          UPDATE paypal_transactions
          SET status = 'captured', paypal_capture_id = ${capture?.id ?? null},
              wallet_credited = true, "updatedAt" = NOW()
          WHERE paypal_order_id = ${input.orderId}
            AND user_id = ${ctx.user.id}
            AND wallet_credited = false
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (claimRows.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Payment already credited" });
        }
        const creditRows = (await tx.execute(sql`
          UPDATE wallets
          SET balance = balance + ${expected}, "updatedAt" = NOW(), version = version + 1
          WHERE id = ${wallet.id} AND status = 'active'
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (creditRows.length === 0) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Wallet credit failed — claim rolled back" });
        }
      });

      // Kafka event for PayPal wallet topup
      publishEvent(KAFKA_TOPICS.PAYMENT_COMPLETED, `paypal:${input.orderId}`, {
        eventType: "paypal_topup_captured",
        userId: ctx.user.id,
        amountUsd: capturedAmount,
        orderId: input.orderId,
        captureId: capture?.id,
        timestamp: new Date().toISOString(),
      }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[PayPal] Kafka event failed"));

      broadcastUserEvent(ctx.user.id, {
        type: "transfer_received",
        payload: { title: "Wallet Topped Up", message: `$${capturedAmount.toFixed(2)} added via PayPal`, amount: capturedAmount },
      });

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
        redirectUrl: z.string().url().max(500).refine(
          (url) => { try { const h = new URL(url).hostname; return h.endsWith("remitflow.com") || h.endsWith("remitflow.app") || h === "localhost"; } catch { return false; } },
          { message: "Redirect URL must be on an allowed domain" }
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // G1: feature flag + tier2 KYC + growth plan — fail closed
      await assertInvestmentEligible(ctx);

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
      }).returning();

      return { paymentLink, txRef, flwRef };
    }),

  verifyPayment: auditedProcedure
    .input(z.object({ txRef: z.string().max(100) }))
    .mutation(async ({ ctx, input }) => {
      const [flwTx] = await (await getDbConn())
        .select()
        .from(flutterwaveTransactions)
        .where(and(eq(flutterwaveTransactions.txRef, input.txRef), eq(flutterwaveTransactions.userId, ctx.user.id)));
      if (!flwTx) throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
      if (flwTx.walletCredited) return { success: true, verified: true, amountUsd: safeParseAmount(flwTx.amountUsd) };
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
      // FF-FIX: verify provider-reported amount/currency against the stored
      // order before crediting (previously any verified amount was credited).
      const expectedAmount = safeParseAmount(flwTx.amountUsd);
      if (verifyData.data.currency !== "USD" || !Number.isFinite(amount) || amount <= 0 || Math.abs(amount - expectedAmount) > 0.01) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Verified amount/currency (${verifyData.data.currency} ${amount}) does not match order ($${expectedAmount})` });
      }

      // Ensure the USD wallet exists before the atomic claim.
      let [wallet] = await (await getDbConn())
        .select()
        .from(wallets)
        .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "USD")))
        .limit(1);
      if (!wallet) {
        try {
          [wallet] = await (await getDbConn()).insert(wallets)
            .values({ userId: ctx.user.id, currency: "USD", balance: "0.00" })
            .returning();
        } catch {
          [wallet] = await (await getDbConn()).select().from(wallets)
            .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, "USD"))).limit(1);
        }
      }
      if (!wallet) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "USD wallet unavailable" });

      // FF-FIX: atomic single-winner claim + wallet credit in ONE transaction —
      // exactly one credit per Flutterwave payment, even under concurrent
      // verify calls or webhook+manual-retry races.
      await (await getDbConn()).transaction(async (tx: any) => {
        const claimRows = (await tx.execute(sql`
          UPDATE flutterwave_transactions
          SET status = 'successful', wallet_credited = true, "updatedAt" = NOW()
          WHERE tx_ref = ${input.txRef}
            AND user_id = ${ctx.user.id}
            AND wallet_credited = false
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (claimRows.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Payment already credited" });
        }
        const creditRows = (await tx.execute(sql`
          UPDATE wallets
          SET balance = balance + ${expectedAmount}, "updatedAt" = NOW(), version = version + 1
          WHERE id = ${wallet.id} AND status = 'active'
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (creditRows.length === 0) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Wallet credit failed — claim rolled back" });
        }
      });

      // Kafka event for Flutterwave wallet topup
      publishEvent(KAFKA_TOPICS.PAYMENT_COMPLETED, `flw:${input.txRef}`, {
        eventType: "flutterwave_topup_verified",
        userId: ctx.user.id,
        amountUsd: amount,
        txRef: input.txRef,
        timestamp: new Date().toISOString(),
      }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Flutterwave] Kafka event failed"));

      broadcastUserEvent(ctx.user.id, {
        type: "transfer_received",
        payload: { title: "Wallet Topped Up", message: `$${amount.toFixed(2)} added via Flutterwave`, amount },
      });

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
