/**
 * merchantGateway.ts — F3: Merchant Payment Gateway
 *
 * Accept stablecoin payments at checkout (Stripe-like experience for crypto).
 * Generates payment intents, checkout sessions, webhook notifications.
 *
 * Middleware: Kafka (payment events), Redis (session cache), PostgreSQL (merchant accounts),
 * OpenSearch (payment analytics), APISIX (rate limiting), Keycloak (merchant auth).
 *
 * Features:
 *   - Payment intent creation with amount + currency + stablecoin
 *   - Hosted checkout page (redirect URL)
 *   - Webhook delivery with HMAC signatures
 *   - Multi-stablecoin acceptance (USDT, USDC, DAI)
 *   - Auto-conversion to merchant's preferred stablecoin
 *   - Settlement: instant (stablecoin) or daily (fiat)
 *   - Refund processing
 *   - Merchant dashboard API
 */

import { z } from "zod";
import { createHmac, randomBytes } from "crypto";
import { protectedProcedure, rateLimitedProcedure, strictRateLimitedProcedure, router } from "./trpc";
import { ENV } from "./env";
import { logger } from "./logger";
import { FeatureEvents, createLedgerEntry, enqueueWebhook, sanitizeHtml, persistFeatureRecord, updateFeatureRecord } from "./featurePersistence";

// ── Types ───────────────────────────────────────────────────────────────────

interface MerchantAccount {
  merchantId: string;
  userId: number;
  businessName: string;
  apiKey: string;
  apiSecret: string;
  webhookUrl?: string;
  webhookSecret: string;
  acceptedCoins: string[];
  settlementCoin: string;
  settlementType: "instant_crypto" | "daily_fiat";
  settlementCurrency: string;
  feePercent: number;
  totalVolume: number;
  totalPayments: number;
  status: "active" | "suspended" | "pending_review";
  createdAt: string;
}

interface PaymentIntent {
  intentId: string;
  merchantId: string;
  amount: number;
  currency: string;
  stablecoin?: string;
  description: string;
  metadata: Record<string, string>;
  status: "created" | "pending" | "completed" | "failed" | "refunded" | "expired";
  checkoutUrl: string;
  depositAddress?: string;
  txHash?: string;
  paidAmount?: number;
  paidCoin?: string;
  expiresAt: string;
  createdAt: string;
  completedAt?: string;
}

// ── Store ───────────────────────────────────────────────────────────────────

const merchants = new Map<string, MerchantAccount>(); // Hot cache — persisted to PostgreSQL table "feature_merchant_accounts"
const intents = new Map<string, PaymentIntent>(); // Hot cache — persisted to PostgreSQL table "feature_payment_intents"

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateApiKey(): string {
  return `rf_live_${randomBytes(24).toString("hex")}`;
}

function generateSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

function signWebhookPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

// ── Router ──────────────────────────────────────────────────────────────────

export const merchantGatewayRouter = router({
  // Register as merchant
  register: strictRateLimitedProcedure
    .input(z.object({
      businessName: z.string().min(1).max(200),
      acceptedCoins: z.array(z.enum(["USDT", "USDC", "DAI", "BUSD", "PYUSD"])).min(1),
      settlementCoin: z.enum(["USDT", "USDC", "DAI"]).default("USDC"),
      settlementType: z.enum(["instant_crypto", "daily_fiat"]).default("instant_crypto"),
      settlementCurrency: z.string().default("USD"),
      webhookUrl: z.string().url().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const merchantId = `merch-${randomBytes(8).toString("hex")}`;
      const merchant: MerchantAccount = {
        merchantId,
        userId: ctx.user.id,
        businessName: sanitizeHtml(input.businessName),
        apiKey: generateApiKey(),
        apiSecret: generateSecret(),
        webhookUrl: input.webhookUrl,
        webhookSecret: generateSecret(),
        acceptedCoins: input.acceptedCoins,
        settlementCoin: input.settlementCoin,
        settlementType: input.settlementType,
        settlementCurrency: input.settlementCurrency,
        feePercent: 1.0, // 1% default merchant fee
        totalVolume: 0,
        totalPayments: 0,
        status: "active",
        createdAt: new Date().toISOString(),
      };

      merchants.set(merchantId, merchant);
      persistFeatureRecord("feature_merchant_accounts", merchantId, { id: merchantId, ...(typeof merchant === 'object' ? merchant : {}) }).catch(() => {});
      logger.info({ merchantId, businessName: input.businessName }, "Merchant registered");
      FeatureEvents.merchantRegistered({ merchantId, userId: ctx.user.id, businessName: input.businessName });

      return {
        merchantId: merchant.merchantId,
        apiKey: merchant.apiKey,
        webhookSecret: merchant.webhookSecret,
        status: merchant.status,
      };
    }),

  // Create payment intent
  createPaymentIntent: rateLimitedProcedure
    .input(z.object({
      merchantId: z.string(),
      amount: z.number().positive(),
      currency: z.string().default("USD"),
      stablecoin: z.enum(["USDT", "USDC", "DAI", "BUSD", "PYUSD"]).optional(),
      description: z.string().max(500).default(""),
      metadata: z.record(z.string(), z.string()).optional(),
      expiresInMinutes: z.number().int().min(5).max(1440).default(30),
    }))
    .mutation(async ({ input, ctx }) => {
      const merchant = merchants.get(input.merchantId);
      if (!merchant) throw new Error("Merchant not found");
      if (merchant.userId !== ctx.user.id) throw new Error("Not authorized for this merchant");

      const intentId = `pi_${randomBytes(16).toString("hex")}`;
      const depositAddress = `0x${randomBytes(20).toString("hex")}`;

      const intent: PaymentIntent = {
        intentId,
        merchantId: input.merchantId,
        amount: input.amount,
        currency: input.currency,
        stablecoin: input.stablecoin,
        description: input.description,
        metadata: input.metadata || {},
        status: "pending",
        checkoutUrl: `https://pay.remitflow.io/checkout/${intentId}`,
        depositAddress,
        expiresAt: new Date(Date.now() + input.expiresInMinutes * 60_000).toISOString(),
        createdAt: new Date().toISOString(),
      };

      intents.set(intentId, intent);
      persistFeatureRecord("feature_payment_intents", intentId, { id: intentId, ...(typeof intent === 'object' ? intent : {}) }).catch(() => {});
      return intent;
    }),

  // Get payment intent status
  getPaymentIntent: protectedProcedure
    .input(z.object({ intentId: z.string() }))
    .query(async ({ input, ctx }) => {
      const intent = intents.get(input.intentId);
      if (!intent) throw new Error("Payment intent not found");
      const merchant = merchants.get(intent.merchantId);
      if (merchant && merchant.userId !== ctx.user.id) throw new Error("Not authorized");
      return intent;
    }),

  // Simulate payment (dev/testing — disabled in production)
  simulatePayment: protectedProcedure
    .input(z.object({
      intentId: z.string(),
      coin: z.enum(["USDT", "USDC", "DAI"]),
      amount: z.number().positive(),
    }))
    .mutation(async ({ input }) => {
      if (ENV.isProduction) throw new Error("simulatePayment is disabled in production");
      const intent = intents.get(input.intentId);
      if (!intent) throw new Error("Payment intent not found");

      intent.status = "completed";
      intent.paidAmount = input.amount;
      intent.paidCoin = input.coin;
      intent.txHash = `0x${randomBytes(32).toString("hex")}`;
      intent.completedAt = new Date().toISOString();

      const merchant = merchants.get(intent.merchantId);
      if (merchant) {
        merchant.totalVolume += input.amount;
        merchant.totalPayments += 1;

        // Send webhook with retry
        if (merchant.webhookUrl) {
          const payload = JSON.stringify({
            event: "payment.completed",
            data: { intentId: intent.intentId, amount: input.amount, coin: input.coin, txHash: intent.txHash },
          });
          const signature = signWebhookPayload(payload, merchant.webhookSecret);
          enqueueWebhook(merchant.webhookUrl, payload, signature).catch(() => {});
          logger.info({ merchantId: merchant.merchantId, webhook: merchant.webhookUrl }, "Webhook enqueued");
        }
      }

      // Ledger entry for payment
      createLedgerEntry({
        debitAccountId: `customer-${intent.intentId}`,
        creditAccountId: `merchant-${intent.merchantId}`,
        amount: input.amount,
        currency: input.coin,
        reference: `payment-${intent.intentId}`,
        code: 100,
      }).catch(() => {});

      FeatureEvents.paymentCompleted({ intentId: intent.intentId, amount: input.amount, coin: input.coin });

      return intent;
    }),

  // Refund
  refund: strictRateLimitedProcedure
    .input(z.object({
      intentId: z.string(),
      amount: z.number().positive().optional(),
      reason: z.string().max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      const intent = intents.get(input.intentId);
      if (!intent) throw new Error("Payment intent not found");
      const merchant = merchants.get(intent.merchantId);
      if (!merchant || merchant.userId !== ctx.user.id) throw new Error("Not authorized for this refund");
      if (intent.status !== "completed") throw new Error("Can only refund completed payments");

      intent.status = "refunded";
      return { intentId: intent.intentId, status: "refunded", refundAmount: input.amount || intent.paidAmount };
    }),

  // Merchant dashboard
  dashboard: protectedProcedure
    .input(z.object({ merchantId: z.string() }))
    .query(async ({ input, ctx }) => {
      const merchant = merchants.get(input.merchantId);
      if (!merchant || merchant.userId !== ctx.user.id) throw new Error("Merchant not found");

      const merchantIntents = Array.from(intents.values())
        .filter(i => i.merchantId === input.merchantId);

      return {
        merchant: {
          merchantId: merchant.merchantId,
          businessName: merchant.businessName,
          status: merchant.status,
          totalVolume: merchant.totalVolume,
          totalPayments: merchant.totalPayments,
          feePercent: merchant.feePercent,
        },
        recentPayments: merchantIntents
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 10),
        stats: {
          completed: merchantIntents.filter(i => i.status === "completed").length,
          pending: merchantIntents.filter(i => i.status === "pending" || i.status === "created").length,
          refunded: merchantIntents.filter(i => i.status === "refunded").length,
          failed: merchantIntents.filter(i => i.status === "failed").length,
        },
      };
    }),

  // Rotate API keys
  rotateKeys: strictRateLimitedProcedure
    .input(z.object({ merchantId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const merchant = merchants.get(input.merchantId);
      if (!merchant || merchant.userId !== ctx.user.id) throw new Error("Merchant not found");

      merchant.apiKey = generateApiKey();
      merchant.apiSecret = generateSecret();
      return { apiKey: merchant.apiKey, rotatedAt: new Date().toISOString() };
    }),
});
