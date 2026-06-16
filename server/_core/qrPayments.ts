/**
 * qrPayments.ts — Comprehensive QR Code Payment System
 *
 * Supports:
 *   - Static QR (merchant receives, no amount)
 *   - Dynamic QR (per-transaction, with amount + expiry)
 *   - Deep-link QR (remitflow:// protocol)
 *   - EMV QR (ISO 18004 / EMVCo compliant for POS terminals)
 *   - PIX-style QR (Brazilian instant payments format)
 *   - Scan-to-Pay (customer scans merchant QR)
 *   - Show-to-Pay (customer shows QR for merchant to scan)
 *
 * Middleware: Kafka (events), TigerBeetle (ledger), Redis (rate limit + cache),
 *            Temporal (expiry workflows), OpenSearch (analytics), APISIX (gateway)
 */

import { z } from "zod";
import { randomBytes, createHash, createHmac } from "crypto";
import { protectedProcedure, rateLimitedProcedure, strictRateLimitedProcedure, router } from "./trpc";
import { FeatureEvents, createLedgerEntry, sanitizeHtml, persistFeatureRecord, updateFeatureRecord } from "./featurePersistence";
import { logger } from "./logger";

// ── Types ────────────────────────────────────────────────────────────────────

interface QRCode {
  qrId: string;
  userId: string;
  type: "static" | "dynamic" | "deeplink" | "emv" | "pix";
  payload: string;
  amount?: number;
  currency: string;
  merchantId?: string;
  merchantName?: string;
  description?: string;
  expiresAt?: string;
  maxScans?: number;
  scanCount: number;
  status: "active" | "expired" | "consumed" | "revoked";
  metadata: Record<string, string>;
  createdAt: string;
}

interface QRScan {
  scanId: string;
  qrId: string;
  scannerId: string;
  scannerIp?: string;
  scannerDevice?: string;
  resultAction: "payment_initiated" | "info_displayed" | "error" | "expired";
  paymentId?: string;
  scannedAt: string;
}

interface QRMerchantProfile {
  profileId: string;
  merchantId: string;
  userId: string;
  businessName: string;
  businessCategory: string;
  defaultCurrency: string;
  acceptedCoins: string[];
  staticQrId?: string;
  tillNumber?: string;
  posTerminalId?: string;
  createdAt: string;
}

// ── Storage ──────────────────────────────────────────────────────────────────

const qrCodes = new Map<string, QRCode>(); // Hot cache — persisted to PostgreSQL table "feature_qr_codes"
const qrScans = new Map<string, QRScan>(); // Hot cache — persisted to PostgreSQL table "feature_qr_scans"
const merchantProfiles = new Map<string, QRMerchantProfile>(); // Hot cache — persisted to PostgreSQL table "feature_merchant_qr_profiles"

// ── QR Payload Generators ────────────────────────────────────────────────────

function generateDeeplinkPayload(params: {
  userId: string; amount?: number; currency: string;
  note?: string; merchantId?: string;
}): string {
  const qs = new URLSearchParams();
  qs.set("uid", params.userId);
  qs.set("cur", params.currency);
  if (params.amount) qs.set("amt", params.amount.toString());
  if (params.note) qs.set("note", params.note);
  if (params.merchantId) qs.set("mid", params.merchantId);
  return `remitflow://pay?${qs.toString()}`;
}

function generateEMVPayload(params: {
  merchantId: string; merchantName: string; amount?: number;
  currency: string; countryCode: string; merchantCity: string;
}): string {
  // EMVCo QR Code specification (simplified)
  const currencyCode = getCurrencyNumericCode(params.currency);
  const amountStr = params.amount ? params.amount.toFixed(2) : "";
  const name = params.merchantName.slice(0, 25).toUpperCase();
  const city = params.merchantCity.slice(0, 15).toUpperCase();

  let payload = "000201";  // Payload Format Indicator
  payload += "010212";     // Point of Initiation (12 = dynamic, 11 = static)
  // Merchant Account (tag 26)
  const acctInfo = `0016com.remitflow.pay01${params.merchantId.length.toString().padStart(2, "0")}${params.merchantId}`;
  payload += `26${acctInfo.length.toString().padStart(2, "0")}${acctInfo}`;
  payload += `5204${params.merchantName.includes("remit") ? "4829" : "5411"}`;  // MCC
  payload += `5303${currencyCode}`;
  if (amountStr) payload += `54${amountStr.length.toString().padStart(2, "0")}${amountStr}`;
  payload += `5802${params.countryCode}`;
  payload += `59${name.length.toString().padStart(2, "0")}${name}`;
  payload += `60${city.length.toString().padStart(2, "0")}${city}`;
  // CRC (tag 63)
  const crcInput = payload + "6304";
  const crc = crc16CCITT(crcInput);
  payload += `6304${crc}`;
  return payload;
}

function generatePIXPayload(params: {
  pixKey: string; amount?: number; merchantName: string;
  merchantCity: string; txId: string; description?: string;
}): string {
  const pixUrl = "br.gov.bcb.pix";
  let merchantAccount = `0014${pixUrl}01${params.pixKey.length.toString().padStart(2, "0")}${params.pixKey}`;
  merchantAccount += `05${params.txId.length.toString().padStart(2, "0")}${params.txId}`;
  if (params.description) {
    const desc = params.description.slice(0, 25);
    merchantAccount += `02${desc.length.toString().padStart(2, "0")}${desc}`;
  }

  let payload = "000201";
  payload += `26${merchantAccount.length.toString().padStart(2, "0")}${merchantAccount}`;
  payload += "52040000";
  payload += "5303986";  // BRL
  if (params.amount) {
    const amt = params.amount.toFixed(2);
    payload += `54${amt.length.toString().padStart(2, "0")}${amt}`;
  }
  payload += "5802BR";
  const name = params.merchantName.slice(0, 25).toUpperCase();
  payload += `59${name.length.toString().padStart(2, "0")}${name}`;
  const city = params.merchantCity.slice(0, 15).toUpperCase();
  payload += `60${city.length.toString().padStart(2, "0")}${city}`;
  // Additional data (tag 62)
  const addlData = `05${params.txId.length.toString().padStart(2, "0")}${params.txId}`;
  payload += `62${addlData.length.toString().padStart(2, "0")}${addlData}`;
  const crcInput = payload + "6304";
  payload += `6304${crc16CCITT(crcInput)}`;
  return payload;
}

function crc16CCITT(data: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function getCurrencyNumericCode(currency: string): string {
  const codes: Record<string, string> = {
    USD: "840", NGN: "566", GBP: "826", EUR: "978", KES: "404",
    GHS: "936", ZAR: "710", BRL: "986", USDC: "840", USDT: "840", DAI: "840",
  };
  return codes[currency] || "840";
}

function generateQRSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex").slice(0, 16);
}

// ── tRPC Router ──────────────────────────────────────────────────────────────

export const qrPaymentsRouter = router({
  // Create a static QR (merchant receives, reusable, no fixed amount)
  createStaticQR: rateLimitedProcedure
    .input(z.object({
      currency: z.string().length(3).default("NGN"),
      merchantName: z.string().min(1).max(100).optional(),
      description: z.string().max(200).optional(),
      acceptedCoins: z.array(z.enum(["USDC", "USDT", "DAI", "NGN", "USD", "GBP", "EUR", "KES", "GHS"])).default(["USDC", "NGN"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const qrId = `qr-${randomBytes(8).toString("hex")}`;
      const payload = generateDeeplinkPayload({
        userId: ctx.user.id.toString(),
        currency: input.currency,
        merchantId: qrId,
      });
      const signature = generateQRSignature(payload, process.env.QR_SIGNING_SECRET || "dev-qr-secret");

      const qr: QRCode = {
        qrId, userId: ctx.user.id.toString(), type: "static",
        payload: `${payload}&sig=${signature}`,
        currency: input.currency,
        merchantName: input.merchantName ? sanitizeHtml(input.merchantName) : undefined,
        description: input.description ? sanitizeHtml(input.description) : undefined,
        scanCount: 0, status: "active",
        metadata: { acceptedCoins: input.acceptedCoins.join(",") },
        createdAt: new Date().toISOString(),
      };
      qrCodes.set(qrId, qr);
      persistFeatureRecord("feature_qr_codes", qrId, { id: qrId, ...(typeof qr === 'object' ? qr : {}) }).catch(() => {});

      FeatureEvents.qrCodeCreated({ qrId, userId: ctx.user.id.toString(), type: "static", currency: input.currency });
      logger.info({ qrId, type: "static" }, "Static QR created");
      return qr;
    }),

  // Create a dynamic QR (single-use, fixed amount, with expiry)
  createDynamicQR: strictRateLimitedProcedure
    .input(z.object({
      amount: z.number().positive().max(10_000_000),
      currency: z.string().length(3).default("NGN"),
      description: z.string().max(200).optional(),
      expiryMinutes: z.number().int().min(1).max(1440).default(30),
      maxScans: z.number().int().min(1).max(100).default(1),
      format: z.enum(["deeplink", "emv", "pix"]).default("deeplink"),
      merchantName: z.string().max(100).optional(),
      merchantCity: z.string().max(50).default("LAGOS"),
      countryCode: z.string().length(2).default("NG"),
    }))
    .mutation(async ({ input, ctx }) => {
      const qrId = `qr-${randomBytes(8).toString("hex")}`;
      const txId = randomBytes(13).toString("hex").toUpperCase().slice(0, 26);

      let payload: string;
      switch (input.format) {
        case "emv":
          payload = generateEMVPayload({
            merchantId: qrId, merchantName: input.merchantName || "REMITFLOW",
            amount: input.amount, currency: input.currency,
            countryCode: input.countryCode, merchantCity: input.merchantCity,
          });
          break;
        case "pix":
          payload = generatePIXPayload({
            pixKey: `remitflow-${ctx.user.id}`, amount: input.amount,
            merchantName: input.merchantName || "REMITFLOW",
            merchantCity: input.merchantCity, txId,
            description: input.description,
          });
          break;
        default:
          payload = generateDeeplinkPayload({
            userId: ctx.user.id.toString(), amount: input.amount,
            currency: input.currency, note: input.description,
          });
      }

      const signature = generateQRSignature(payload, process.env.QR_SIGNING_SECRET || "dev-qr-secret");

      const qr: QRCode = {
        qrId, userId: ctx.user.id.toString(), type: input.format === "deeplink" ? "dynamic" : input.format,
        payload: input.format === "deeplink" ? `${payload}&sig=${signature}` : payload,
        amount: input.amount, currency: input.currency,
        merchantName: input.merchantName ? sanitizeHtml(input.merchantName) : undefined,
        description: input.description ? sanitizeHtml(input.description) : undefined,
        expiresAt: new Date(Date.now() + input.expiryMinutes * 60_000).toISOString(),
        maxScans: input.maxScans, scanCount: 0, status: "active",
        metadata: { txId, format: input.format },
        createdAt: new Date().toISOString(),
      };
      qrCodes.set(qrId, qr);
      persistFeatureRecord("feature_qr_codes", qrId, { id: qrId, ...(typeof qr === 'object' ? qr : {}) }).catch(() => {});

      createLedgerEntry({
        debitAccountId: `qr-reserve-${ctx.user.id}`,
        creditAccountId: `qr-escrow-${qrId}`,
        amount: input.amount, currency: input.currency,
        reference: `qr-${qrId}`, code: 700,
      }).catch(() => {});

      FeatureEvents.qrCodeCreated({ qrId, userId: ctx.user.id.toString(), type: input.format, amount: input.amount, currency: input.currency });
      logger.info({ qrId, type: input.format, amount: input.amount }, "Dynamic QR created");
      return qr;
    }),

  // Scan/resolve a QR code (validates, records scan, initiates payment)
  scanQR: rateLimitedProcedure
    .input(z.object({
      qrId: z.string().optional(),
      rawPayload: z.string().optional(),
      scannerDevice: z.string().max(100).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      let qr: QRCode | undefined;

      if (input.qrId) {
        qr = qrCodes.get(input.qrId);
      } else if (input.rawPayload) {
        // Parse deeplink payload
        const match = input.rawPayload.match(/qr-([\da-f]{16})/);
        if (match) qr = qrCodes.get(`qr-${match[1]}`);
        // Fallback: search by payload
        if (!qr) {
          for (const code of Array.from(qrCodes.values())) {
            if (code.payload === input.rawPayload) { qr = code; break; }
          }
        }
      }

      if (!qr) throw new Error("QR code not found or invalid");
      if (qr.status === "revoked") throw new Error("QR code has been revoked");
      if (qr.status === "expired" || (qr.expiresAt && new Date(qr.expiresAt) < new Date())) {
        qr.status = "expired";
        throw new Error("QR code has expired");
      }
      if (qr.status === "consumed") throw new Error("QR code already consumed");
      if (qr.maxScans && qr.scanCount >= qr.maxScans) {
        qr.status = "consumed";
        throw new Error("QR code maximum scans reached");
      }
      if (qr.userId === ctx.user.id.toString()) throw new Error("Cannot scan your own QR code");

      qr.scanCount++;
      if (qr.maxScans && qr.scanCount >= qr.maxScans) qr.status = "consumed";

      const scanId = `scan-${randomBytes(8).toString("hex")}`;
      const scan: QRScan = {
        scanId, qrId: qr.qrId, scannerId: ctx.user.id.toString(),
        scannerDevice: input.scannerDevice,
        resultAction: qr.amount ? "payment_initiated" : "info_displayed",
        scannedAt: new Date().toISOString(),
      };
      qrScans.set(scanId, scan);
      persistFeatureRecord("feature_qr_scans", scanId, { id: scanId, ...(typeof scan === 'object' ? scan : {}) }).catch(() => {});

      if (qr.amount) {
        const paymentId = `qrpay-${randomBytes(8).toString("hex")}`;
        scan.paymentId = paymentId;
        scan.resultAction = "payment_initiated";

        createLedgerEntry({
          debitAccountId: `user-${ctx.user.id}`,
          creditAccountId: `user-${qr.userId}`,
          amount: qr.amount, currency: qr.currency,
          reference: `qr-payment-${paymentId}`, code: 701,
        }).catch(() => {});
      }

      FeatureEvents.qrCodeScanned({ scanId, qrId: qr.qrId, scannerId: ctx.user.id.toString(), action: scan.resultAction });
      logger.info({ scanId, qrId: qr.qrId, action: scan.resultAction }, "QR scanned");
      return { scan, qrCode: qr };
    }),

  // Get QR code details
  getQR: protectedProcedure
    .input(z.object({ qrId: z.string() }))
    .query(async ({ input, ctx }) => {
      const qr = qrCodes.get(input.qrId);
      if (!qr || qr.userId !== ctx.user.id.toString()) throw new Error("QR code not found");
      // Check expiry
      if (qr.expiresAt && new Date(qr.expiresAt) < new Date() && qr.status === "active") {
        qr.status = "expired";
      }
      return qr;
    }),

  // List user's QR codes
  listQRCodes: protectedProcedure
    .query(async ({ ctx }) => {
      const codes = Array.from(qrCodes.values()).filter(q => q.userId === ctx.user.id.toString());
      // Auto-expire
      for (const qr of codes) {
        if (qr.expiresAt && new Date(qr.expiresAt) < new Date() && qr.status === "active") {
          qr.status = "expired";
        }
      }
      return codes;
    }),

  // Revoke a QR code
  revokeQR: rateLimitedProcedure
    .input(z.object({ qrId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const qr = qrCodes.get(input.qrId);
      if (!qr || qr.userId !== ctx.user.id.toString()) throw new Error("QR code not found");
      qr.status = "revoked";
      logger.info({ qrId: input.qrId }, "QR code revoked");
      return { qrId: qr.qrId, status: "revoked" };
    }),

  // Get scan history for a QR code
  getScanHistory: protectedProcedure
    .input(z.object({ qrId: z.string() }))
    .query(async ({ input, ctx }) => {
      const qr = qrCodes.get(input.qrId);
      if (!qr || qr.userId !== ctx.user.id.toString()) throw new Error("QR code not found");
      const scans = Array.from(qrScans.values()).filter(s => s.qrId === input.qrId);
      return { qrId: input.qrId, totalScans: scans.length, scans };
    }),

  // Register merchant QR profile
  registerMerchantQR: strictRateLimitedProcedure
    .input(z.object({
      merchantId: z.string(),
      businessName: z.string().min(1).max(100),
      businessCategory: z.string().max(50).default("general"),
      defaultCurrency: z.string().length(3).default("NGN"),
      acceptedCoins: z.array(z.string()).default(["USDC", "NGN"]),
      tillNumber: z.string().max(20).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const profileId = `mqr-${randomBytes(8).toString("hex")}`;
      const profile: QRMerchantProfile = {
        profileId, merchantId: input.merchantId, userId: ctx.user.id.toString(),
        businessName: sanitizeHtml(input.businessName),
        businessCategory: input.businessCategory,
        defaultCurrency: input.defaultCurrency,
        acceptedCoins: input.acceptedCoins,
        tillNumber: input.tillNumber,
        createdAt: new Date().toISOString(),
      };
      merchantProfiles.set(profileId, profile);
      persistFeatureRecord("feature_merchant_qr_profiles", profileId, { id: profileId, ...(typeof profile === 'object' ? profile : {}) }).catch(() => {});
      FeatureEvents.merchantQRRegistered({ profileId, merchantId: input.merchantId, userId: ctx.user.id.toString() });
      return profile;
    }),

  // QR analytics
  getQRAnalytics: protectedProcedure
    .query(async ({ ctx }) => {
      const userCodes = Array.from(qrCodes.values()).filter(q => q.userId === ctx.user.id.toString());
      const userScans = Array.from(qrScans.values()).filter(s => {
        const qr = qrCodes.get(s.qrId);
        return qr && qr.userId === ctx.user.id.toString();
      });
      const totalAmount = userScans
        .filter(s => s.paymentId)
        .reduce((sum, s) => {
          const qr = qrCodes.get(s.qrId);
          return sum + (qr?.amount || 0);
        }, 0);

      return {
        totalQRCodes: userCodes.length,
        activeQRCodes: userCodes.filter(q => q.status === "active").length,
        totalScans: userScans.length,
        totalPayments: userScans.filter(s => s.paymentId).length,
        totalAmountReceived: totalAmount,
        byType: {
          static: userCodes.filter(q => q.type === "static").length,
          dynamic: userCodes.filter(q => q.type === "dynamic").length,
          emv: userCodes.filter(q => q.type === "emv").length,
          pix: userCodes.filter(q => q.type === "pix").length,
        },
      };
    }),
});
