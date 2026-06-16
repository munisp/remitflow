/**
 * markLaneRouter.ts — tRPC Router for Mark Lane Integration
 *
 * Provides endpoints for:
 *   - Canadian corridor FX quotes (CAD→USD→NGN/GHS/KES/ZAR)
 *   - Transfer initiation via Mark Lane's on-ramp
 *   - KYC passport management (FINTRAC ↔ CBN/FCA bridge)
 *   - Nostro balance monitoring
 *   - Webhook ingestion for transfer status updates
 *   - FX professional channel management
 *
 * All endpoints use DB write-through (PostgreSQL), TigerBeetle ledger
 * entries for financial mutations, and Kafka event emission.
 */

import { z } from "zod";
import { randomBytes } from "crypto";
import { router, protectedProcedure, rateLimitedProcedure, strictRateLimitedProcedure } from "../../_core/trpc";
import { logger } from "../../_core/logger";
import { FeatureEvents, createLedgerEntry, sanitizeHtml, persistFeatureRecord } from "../../_core/featurePersistence";
import {
  getMarkLaneFXQuote,
  getMarkLaneLiveRates,
  initiateMarkLaneTransfer,
  getMarkLaneTransferStatus,
  cancelMarkLaneTransfer,
  requestKYCPassport,
  verifyKYCPassport,
  revokeKYCPassport,
  getMarkLaneNostroBalances,
  requestMarkLanePrefunding,
  getMarkLaneSettlementHistory,
  registerMarkLaneWebhook,
  verifyMarkLaneWebhookSignature,
  type MarkLaneFXQuote,
  type MarkLaneTransfer,
  type MarkLaneKYCPassport,
} from "./markLaneClient";

// ─── Supported Corridors ─────────────────────────────────────────────────────

const MARKLANE_CORRIDORS = [
  { id: "CA-NG", from: "CAD", to: "NGN", fromCountry: "Canada", toCountry: "Nigeria", rail: "NIBSS", deliveryTime: "30min" },
  { id: "CA-GH", from: "CAD", to: "GHS", fromCountry: "Canada", toCountry: "Ghana", rail: "GhIPSS", deliveryTime: "1hr" },
  { id: "CA-KE", from: "CAD", to: "KES", fromCountry: "Canada", toCountry: "Kenya", rail: "M-Pesa", deliveryTime: "10min" },
  { id: "CA-ZA", from: "CAD", to: "ZAR", fromCountry: "Canada", toCountry: "South Africa", rail: "SARB", deliveryTime: "2hr" },
  { id: "CA-SN", from: "CAD", to: "XOF", fromCountry: "Canada", toCountry: "Senegal", rail: "PAPSS", deliveryTime: "4hr" },
  { id: "CA-TZ", from: "CAD", to: "TZS", fromCountry: "Canada", toCountry: "Tanzania", rail: "M-Pesa", deliveryTime: "10min" },
  { id: "CA-UG", from: "CAD", to: "UGX", fromCountry: "Canada", toCountry: "Uganda", rail: "MTN MoMo", deliveryTime: "15min" },
  { id: "CA-CM", from: "CAD", to: "XAF", fromCountry: "Canada", toCountry: "Cameroon", rail: "PAPSS", deliveryTime: "4hr" },
] as const;

// ─── In-Memory Cache (write-through to PostgreSQL) ───────────────────────────

const quoteCache = new Map<string, MarkLaneFXQuote & { userId: string }>();
const transferCache = new Map<string, MarkLaneTransfer & { userId: string; remitflowTransferId: string }>();
const kycPassportCache = new Map<string, MarkLaneKYCPassport>();
const fxProfessionalCache = new Map<string, {
  id: string;
  userId: string;
  name: string;
  email: string;
  markLanePartnerId: string;
  status: "active" | "pending" | "suspended";
  corridors: string[];
  commissionRate: number;
  totalVolume: number;
  totalCommissions: number;
  createdAt: string;
}>();

// ─── Router ──────────────────────────────────────────────────────────────────

export const markLaneRouter = router({

  // ── Corridor Discovery ───────────────────────────────────────────────────

  listCorridors: protectedProcedure.query(() => {
    return {
      corridors: MARKLANE_CORRIDORS.map((c) => ({
        ...c,
        provider: "marklane" as const,
        status: "active" as const,
        fintracCompliant: true,
      })),
      count: MARKLANE_CORRIDORS.length,
    };
  }),

  getCorridorDetails: protectedProcedure
    .input(z.object({ corridorId: z.string() }))
    .query(({ input }) => {
      const corridor = MARKLANE_CORRIDORS.find((c) => c.id === input.corridorId);
      if (!corridor) throw new Error("Corridor not found");

      return {
        ...corridor,
        provider: "marklane" as const,
        status: "active" as const,
        fintracCompliant: true,
        limits: {
          minAmount: 10,
          maxAmount: 50_000,
          dailyLimit: 250_000,
          monthlyLimit: 1_000_000,
        },
        fees: {
          flatFee: 5,
          percentageFee: 0.25,
          currency: corridor.from,
        },
        compliance: {
          sourceRegulator: "FINTRAC",
          targetRegulator: corridor.toCountry === "Nigeria" ? "CBN"
            : corridor.toCountry === "Ghana" ? "BoG"
            : corridor.toCountry === "Kenya" ? "CBK"
            : corridor.toCountry === "South Africa" ? "SARB"
            : "Local",
          kycRequired: true,
          minKycTier: 1,
        },
      };
    }),

  // ── FX Quotes ────────────────────────────────────────────────────────────

  getQuote: rateLimitedProcedure
    .input(z.object({
      corridorId: z.string(),
      amount: z.number().positive().max(50_000),
      type: z.enum(["spot", "forward"]).default("spot"),
      forwardDate: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const corridor = MARKLANE_CORRIDORS.find((c) => c.id === input.corridorId);
      if (!corridor) throw new Error("Invalid corridor");

      const userId = ctx.user.id.toString();

      const quote = await getMarkLaneFXQuote(
        corridor.from,
        corridor.to,
        input.amount,
        input.type,
        input.forwardDate,
      );

      quoteCache.set(quote.quoteId, { ...quote, userId });

      await persistFeatureRecord("marklane_quotes", quote.quoteId, {
        ...quote,
        userId,
        corridorId: input.corridorId,
      });

      FeatureEvents.markLaneQuoteCreated({
        quoteId: quote.quoteId,
        userId,
        corridor: input.corridorId,
        amount: input.amount,
        rate: quote.rate,
      });

      return quote;
    }),

  getLiveRates: protectedProcedure
    .input(z.object({
      pairs: z.array(z.string()).min(1).max(10).default(["CAD/USD", "CAD/NGN", "CAD/GHS", "CAD/KES"]),
    }))
    .query(async ({ input }) => {
      const rates = await getMarkLaneLiveRates(input.pairs);
      return { rates, provider: "marklane", fetchedAt: new Date().toISOString() };
    }),

  // ── Transfers ────────────────────────────────────────────────────────────

  initiateTransfer: strictRateLimitedProcedure
    .input(z.object({
      quoteId: z.string(),
      recipientName: z.string().min(2).max(100),
      recipientAccount: z.string().min(5).max(34),
      recipientBank: z.string(),
      recipientCountry: z.string().length(2),
      purpose: z.enum([
        "family_support", "education", "medical", "business_payment",
        "salary", "investment", "gift", "other",
      ]),
      idempotencyKey: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id.toString();
      const quote = quoteCache.get(input.quoteId);
      if (!quote) throw new Error("Quote not found or expired");
      if (quote.userId !== userId) throw new Error("Unauthorized — quote belongs to another user");

      if (new Date(quote.expiresAt) < new Date()) {
        throw new Error("Quote has expired — please request a new quote");
      }

      const idempotencyKey = input.idempotencyKey ?? randomBytes(16).toString("hex");
      const remitflowTransferId = `rf-ml-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;

      const corridorId = input.recipientCountry === "NG" ? "CA-NG"
        : input.recipientCountry === "GH" ? "CA-GH"
        : input.recipientCountry === "KE" ? "CA-KE"
        : "CA-ZA";

      const transfer = await initiateMarkLaneTransfer({
        fromCurrency: quote.fromCurrency,
        toCurrency: quote.toCurrency,
        amount: quote.amount,
        senderName: ctx.user.name ?? "RemitFlow User",
        senderEmail: ctx.user.email ?? "",
        recipientName: sanitizeHtml(input.recipientName),
        recipientAccount: input.recipientAccount,
        recipientBank: input.recipientBank,
        recipientCountry: input.recipientCountry,
        corridor: corridorId,
        purpose: input.purpose,
        idempotencyKey,
      });

      const enrichedTransfer = {
        ...transfer,
        userId,
        remitflowTransferId,
      };
      transferCache.set(transfer.transferId, enrichedTransfer);

      await createLedgerEntry({
        debitAccountId: `user:${userId}:${quote.fromCurrency}`,
        creditAccountId: `marklane:nostro:${quote.fromCurrency}`,
        amount: Math.round(quote.amount * 100),
        currency: quote.fromCurrency,
        reference: remitflowTransferId,
        code: 200,
      });

      await persistFeatureRecord("marklane_transfers", remitflowTransferId, enrichedTransfer);

      FeatureEvents.markLaneTransferInitiated({
        transferId: remitflowTransferId,
        markLaneTransferId: transfer.transferId,
        userId,
        corridor: transfer.corridor,
        sendAmount: transfer.sendAmount,
        receiveAmount: transfer.receiveAmount,
        fxRate: transfer.fxRate,
      });

      return {
        remitflowTransferId,
        markLaneTransferId: transfer.transferId,
        status: transfer.status,
        sendAmount: transfer.sendAmount,
        sendCurrency: transfer.fromCurrency,
        receiveAmount: transfer.receiveAmount,
        receiveCurrency: transfer.toCurrency,
        fxRate: transfer.fxRate,
        fee: transfer.fee,
        reference: transfer.reference,
        estimatedDelivery: MARKLANE_CORRIDORS.find((c) => c.id === transfer.corridor)?.deliveryTime ?? "unknown",
      };
    }),

  getTransferStatus: protectedProcedure
    .input(z.object({ transferId: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id.toString();
      const cached = transferCache.get(input.transferId);
      if (cached && cached.userId !== userId) {
        throw new Error("Unauthorized — transfer belongs to another user");
      }

      const transfer = await getMarkLaneTransferStatus(input.transferId);
      return transfer;
    }),

  cancelTransfer: protectedProcedure
    .input(z.object({
      transferId: z.string(),
      reason: z.string().min(5).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id.toString();
      const cached = transferCache.get(input.transferId);
      if (cached && cached.userId !== userId) {
        throw new Error("Unauthorized — transfer belongs to another user");
      }

      const result = await cancelMarkLaneTransfer(input.transferId, sanitizeHtml(input.reason));

      if (cached) {
        await createLedgerEntry({
          debitAccountId: `marklane:nostro:${cached.fromCurrency}`,
          creditAccountId: `user:${userId}:${cached.fromCurrency}`,
          amount: Math.round(result.refundAmount * 100),
          currency: cached.fromCurrency,
          reference: `${cached.remitflowTransferId}-reversal`,
          code: 201,
        });
      }

      FeatureEvents.markLaneTransferCancelled({
        transferId: input.transferId,
        userId,
        reason: input.reason,
        refundAmount: result.refundAmount,
      });

      return result;
    }),

  listTransfers: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      status: z.enum(["pending", "processing", "completed", "failed", "cancelled"]).optional(),
    }))
    .query(({ ctx, input }) => {
      const userId = ctx.user.id.toString();
      const userTransfers = Array.from(transferCache.values())
        .filter((t) => t.userId === userId)
        .filter((t) => !input.status || t.status === input.status)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return {
        transfers: userTransfers.slice(input.offset, input.offset + input.limit),
        total: userTransfers.length,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  // ── KYC Passport ─────────────────────────────────────────────────────────

  requestKYCPassport: strictRateLimitedProcedure
    .input(z.object({
      targetRegulator: z.enum(["FINTRAC", "CBN", "FCA"]),
      kycTier: z.number().min(1).max(3),
      documents: z.array(z.object({
        type: z.string(),
        documentId: z.string(),
        issuingCountry: z.string().length(2),
      })),
      consentToken: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id.toString();

      const passport = await requestKYCPassport({
        userId,
        sourceRegulator: "CBN",
        targetRegulator: input.targetRegulator,
        kycTier: input.kycTier,
        documents: input.documents,
        consentToken: input.consentToken,
      });

      kycPassportCache.set(passport.passportId, passport);

      await persistFeatureRecord("marklane_kyc_passports", passport.passportId, {
        ...passport,
        remitflowUserId: userId,
      });

      FeatureEvents.markLaneKYCPassportRequested({
        passportId: passport.passportId,
        userId,
        sourceRegulator: "CBN",
        targetRegulator: input.targetRegulator,
        tier: input.kycTier,
      });

      return passport;
    }),

  verifyKYCPassport: protectedProcedure
    .input(z.object({ passportId: z.string() }))
    .query(async ({ input }) => {
      const passport = await verifyKYCPassport(input.passportId);
      return passport;
    }),

  revokeKYCPassport: protectedProcedure
    .input(z.object({
      passportId: z.string(),
      reason: z.string().min(5).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id.toString();
      const result = await revokeKYCPassport(input.passportId, sanitizeHtml(input.reason));

      FeatureEvents.markLaneKYCPassportRevoked({
        passportId: input.passportId,
        userId,
        reason: input.reason,
      });

      return result;
    }),

  // ── Nostro / Settlement ──────────────────────────────────────────────────

  getNostroBalances: protectedProcedure.query(async () => {
    const balances = await getMarkLaneNostroBalances();
    return {
      balances,
      provider: "marklane",
      fetchedAt: new Date().toISOString(),
    };
  }),

  requestPrefunding: strictRateLimitedProcedure
    .input(z.object({
      currency: z.enum(["CAD", "USD"]),
      amount: z.number().positive().max(1_000_000),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id.toString();
      const result = await requestMarkLanePrefunding(input.currency, input.amount);

      await persistFeatureRecord("marklane_prefunding", result.prefundingId, {
        ...result,
        userId,
        currency: input.currency,
        amount: input.amount,
        requestedAt: new Date().toISOString(),
      });

      FeatureEvents.markLanePrefundingRequested({
        prefundingId: result.prefundingId,
        userId,
        currency: input.currency,
        amount: input.amount,
      });

      return result;
    }),

  getSettlementHistory: protectedProcedure
    .input(z.object({
      fromDate: z.string(),
      toDate: z.string(),
    }))
    .query(async ({ input }) => {
      return getMarkLaneSettlementHistory(input.fromDate, input.toDate);
    }),

  // ── FX Professional Channel ──────────────────────────────────────────────

  registerFXProfessional: strictRateLimitedProcedure
    .input(z.object({
      name: z.string().min(2).max(100),
      email: z.string().email(),
      corridors: z.array(z.string()).min(1),
      commissionRate: z.number().min(0).max(1).default(0.15),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id.toString();
      const id = `mlfx-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;

      const professional = {
        id,
        userId,
        name: sanitizeHtml(input.name),
        email: input.email,
        markLanePartnerId: `ML-${randomBytes(8).toString("hex").toUpperCase()}`,
        status: "pending" as const,
        corridors: input.corridors,
        commissionRate: input.commissionRate,
        totalVolume: 0,
        totalCommissions: 0,
        createdAt: new Date().toISOString(),
      };

      fxProfessionalCache.set(id, professional);

      await persistFeatureRecord("marklane_fx_professionals", id, professional);

      FeatureEvents.markLaneFXProfessionalRegistered({
        professionalId: id,
        userId,
        corridors: input.corridors,
      });

      return professional;
    }),

  getFXProfessionalProfile: protectedProcedure
    .input(z.object({ professionalId: z.string() }))
    .query(({ ctx, input }) => {
      const userId = ctx.user.id.toString();
      const professional = fxProfessionalCache.get(input.professionalId);
      if (!professional) throw new Error("FX professional not found");
      if (professional.userId !== userId) throw new Error("Unauthorized");
      return professional;
    }),

  listFXProfessionals: protectedProcedure.query(({ ctx }) => {
    const userId = ctx.user.id.toString();
    const professionals = Array.from(fxProfessionalCache.values())
      .filter((p) => p.userId === userId);
    return { professionals, count: professionals.length };
  }),

  // ── Webhook Ingestion ────────────────────────────────────────────────────

  registerWebhook: strictRateLimitedProcedure
    .input(z.object({
      callbackUrl: z.string().url(),
      events: z.array(z.enum([
        "transfer.completed", "transfer.failed", "transfer.processing",
        "kyc.verified", "kyc.rejected", "settlement.completed",
        "fx.rate_alert", "nostro.low_balance",
      ])),
    }))
    .mutation(async ({ input }) => {
      const result = await registerMarkLaneWebhook(input.callbackUrl, input.events);

      FeatureEvents.markLaneWebhookRegistered({
        webhookId: result.webhookId,
        callbackUrl: input.callbackUrl,
        events: input.events,
      });

      return result;
    }),

  handleWebhook: protectedProcedure
    .input(z.object({
      payload: z.string(),
      signature: z.string(),
    }))
    .mutation(async ({ input }) => {
      const isValid = verifyMarkLaneWebhookSignature(input.payload, input.signature);
      if (!isValid) {
        logger.warn("Invalid Mark Lane webhook signature");
        throw new Error("Invalid webhook signature");
      }

      const event = JSON.parse(input.payload) as {
        eventId: string;
        type: string;
        data: Record<string, unknown>;
        timestamp: string;
      };

      logger.info("Processing Mark Lane webhook", {
        service: "marklane-webhook",
        eventType: event.type,
        eventId: event.eventId,
      });

      switch (event.type) {
        case "transfer.completed": {
          const transferId = event.data.transferId as string;
          const cached = transferCache.get(transferId);
          if (cached) {
            cached.status = "completed";
            cached.completedAt = event.timestamp;

            await createLedgerEntry({
              debitAccountId: `marklane:nostro:${cached.toCurrency}`,
              creditAccountId: `recipient:${cached.recipientAccount}:${cached.toCurrency}`,
              amount: Math.round(cached.receiveAmount * 100),
              currency: cached.toCurrency,
              reference: `${cached.remitflowTransferId}-settlement`,
              code: 202,
            });
          }
          break;
        }
        case "transfer.failed": {
          const transferId = event.data.transferId as string;
          const cached = transferCache.get(transferId);
          if (cached) {
            cached.status = "failed";
            cached.failureReason = event.data.reason as string;

            await createLedgerEntry({
              debitAccountId: `marklane:nostro:${cached.fromCurrency}`,
              creditAccountId: `user:${cached.userId}:${cached.fromCurrency}`,
              amount: Math.round(cached.sendAmount * 100),
              currency: cached.fromCurrency,
              reference: `${cached.remitflowTransferId}-reversal`,
              code: 203,
            });
          }
          break;
        }
        case "kyc.verified":
        case "kyc.rejected": {
          const passportId = event.data.passportId as string;
          const cached = kycPassportCache.get(passportId);
          if (cached) {
            cached.verificationStatus = event.type === "kyc.verified" ? "verified" : "rejected";
          }
          break;
        }
        case "nostro.low_balance": {
          logger.warn("Mark Lane nostro balance low", {
            service: "marklane-webhook",
            currency: event.data.currency,
            available: event.data.available,
          });
          break;
        }
      }

      FeatureEvents.markLaneWebhookProcessed({
        eventId: event.eventId,
        webhookType: event.type,
        data: event.data,
      });

      return { received: true, eventId: event.eventId };
    }),

  // ── Analytics ────────────────────────────────────────────────────────────

  getAnalytics: protectedProcedure
    .input(z.object({
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
    }))
    .query(({ ctx }) => {
      const userId = ctx.user.id.toString();
      const userTransfers = Array.from(transferCache.values())
        .filter((t) => t.userId === userId);

      const completed = userTransfers.filter((t) => t.status === "completed");
      const failed = userTransfers.filter((t) => t.status === "failed");

      const volumeByCorridorMap: Record<string, { count: number; volume: number }> = {};
      for (const t of userTransfers) {
        const entry = volumeByCorridorMap[t.corridor] ?? { count: 0, volume: 0 };
        entry.count++;
        entry.volume += t.sendAmount;
        volumeByCorridorMap[t.corridor] = entry;
      }

      return {
        totalTransfers: userTransfers.length,
        completedTransfers: completed.length,
        failedTransfers: failed.length,
        successRate: userTransfers.length > 0
          ? (completed.length / userTransfers.length) * 100
          : 0,
        totalVolume: userTransfers.reduce((sum, t) => sum + t.sendAmount, 0),
        averageAmount: userTransfers.length > 0
          ? userTransfers.reduce((sum, t) => sum + t.sendAmount, 0) / userTransfers.length
          : 0,
        volumeByCorridor: volumeByCorridorMap,
        currency: "CAD",
      };
    }),
});
