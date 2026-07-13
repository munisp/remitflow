/**
 * Mark Lane API Client — FX Liquidity Provider Integration
 *
 * Connects RemitFlow to Mark Lane's embedded API platform for:
 *   - CAD/USD/EUR FX rate quotes (spot + forward)
 *   - Cross-border transfer initiation (CAD → USD → African corridors)
 *   - KYC passport verification (FINTRAC ↔ CBN compliance bridge)
 *   - Webhook registration for transfer status updates
 *   - Settlement pre-funding and nostro balance queries
 *
 * Mark Lane is a FINTRAC-registered MSB (Money Services Business) in Canada.
 * All interactions comply with FINTRAC AML/ATF requirements.
 */

import { logger } from "../../_core/logger";
import { CircuitBreaker } from "../../lib/circuitBreaker";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MarkLaneFXQuote {
  quoteId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  inverseRate: number;
  spread: number;
  amount: number;
  convertedAmount: number;
  fee: number;
  netAmount: number;
  expiresAt: string;
  type: "spot" | "forward";
  forwardDate?: string;
  provider: "marklane";
}

export interface MarkLaneTransfer {
  transferId: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  fromCurrency: string;
  toCurrency: string;
  sendAmount: number;
  receiveAmount: number;
  fxRate: number;
  fee: number;
  reference: string;
  senderName: string;
  recipientName: string;
  recipientAccount: string;
  recipientBank: string;
  corridor: string;
  createdAt: string;
  completedAt?: string;
  failureReason?: string;
}

export interface MarkLaneKYCPassport {
  passportId: string;
  userId: string;
  sourceRegulator: "FINTRAC" | "CBN" | "FCA";
  targetRegulator: "FINTRAC" | "CBN" | "FCA";
  kycTier: number;
  verificationStatus: "pending" | "verified" | "rejected" | "expired";
  documents: {
    type: string;
    verified: boolean;
    verifiedAt: string;
    expiresAt: string;
  }[];
  amlScreening: {
    sanctionsCleared: boolean;
    pepScreened: boolean;
    lastScreenedAt: string;
  };
  validUntil: string;
  createdAt: string;
}

export interface MarkLaneNostroBalance {
  currency: string;
  available: number;
  reserved: number;
  total: number;
  lastUpdated: string;
  accountId: string;
}

export interface MarkLaneWebhookEvent {
  eventId: string;
  type: "transfer.completed" | "transfer.failed" | "transfer.processing" |
        "kyc.verified" | "kyc.rejected" | "settlement.completed" |
        "fx.rate_alert" | "nostro.low_balance";
  data: Record<string, unknown>;
  timestamp: string;
  signature: string;
}

interface MarkLaneConfig {
  baseUrl: string;
  apiKey: string;
  secretKey: string;
  webhookSecret: string;
  partnerId: string;
  environment: "sandbox" | "production";
}

// ─── Client ──────────────────────────────────────────────────────────────────

const circuitBreaker = new CircuitBreaker("marklane-api", { failureThreshold: 5, resetTimeoutMs: 30_000 });

function getConfig(): MarkLaneConfig {
  return {
    baseUrl: process.env.MARKLANE_API_URL || "https://api.marklane.io/v1",
    apiKey: process.env.MARKLANE_API_KEY || "",
    secretKey: process.env.MARKLANE_SECRET_KEY || "",
    webhookSecret: process.env.MARKLANE_WEBHOOK_SECRET || "",
    partnerId: process.env.MARKLANE_PARTNER_ID || "",
    environment: (process.env.MARKLANE_ENVIRONMENT as "sandbox" | "production") || "sandbox",
  };
}

async function markLaneRequest<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const config = getConfig();

  if (!config.apiKey) {
    logger.warn("Mark Lane API key not configured — using mock response");
    return mockResponse(path) as T;
  }

  return circuitBreaker.execute(async () => {
    const url = `${config.baseUrl}${path}`;
    const timestamp = Date.now().toString();

    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-ML-Api-Key": config.apiKey,
        "X-ML-Partner-Id": config.partnerId,
        "X-ML-Timestamp": timestamp,
        "X-ML-Environment": config.environment,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new Error(`Mark Lane API ${res.status}: ${errorBody}`);
    }

    return res.json() as Promise<T>;
  });
}

// ─── FX Rates ────────────────────────────────────────────────────────────────

export async function getMarkLaneFXQuote(
  fromCurrency: string,
  toCurrency: string,
  amount: number,
  type: "spot" | "forward" = "spot",
  forwardDate?: string,
): Promise<MarkLaneFXQuote> {
  logger.info("Requesting Mark Lane FX quote", {
    service: "marklane-client",
    from: fromCurrency,
    to: toCurrency,
    amount,
    type,
  });

  return markLaneRequest<MarkLaneFXQuote>("POST", "/fx/quote", {
    fromCurrency,
    toCurrency,
    amount,
    type,
    forwardDate,
  });
}

export async function getMarkLaneLiveRates(
  pairs: string[],
): Promise<Record<string, { bid: number; ask: number; mid: number; timestamp: string }>> {
  return markLaneRequest("GET", `/fx/rates?pairs=${pairs.join(",")}`);
}

export async function executeMarkLaneFXConversion(
  quoteId: string,
  idempotencyKey: string,
): Promise<{ conversionId: string; status: string; settledAmount: number }> {
  return markLaneRequest("POST", "/fx/execute", { quoteId, idempotencyKey });
}

// ─── Transfers ───────────────────────────────────────────────────────────────

export async function initiateMarkLaneTransfer(params: {
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  senderName: string;
  senderEmail: string;
  recipientName: string;
  recipientAccount: string;
  recipientBank: string;
  recipientCountry: string;
  corridor: string;
  purpose: string;
  idempotencyKey: string;
}): Promise<MarkLaneTransfer> {
  logger.info("Initiating Mark Lane transfer", {
    service: "marklane-client",
    corridor: params.corridor,
    amount: params.amount,
    from: params.fromCurrency,
    to: params.toCurrency,
  });

  return markLaneRequest<MarkLaneTransfer>("POST", "/transfers", params);
}

export async function getMarkLaneTransferStatus(
  transferId: string,
): Promise<MarkLaneTransfer> {
  return markLaneRequest<MarkLaneTransfer>("GET", `/transfers/${transferId}`);
}

export async function cancelMarkLaneTransfer(
  transferId: string,
  reason: string,
): Promise<{ status: string; refundAmount: number }> {
  return markLaneRequest("POST", `/transfers/${transferId}/cancel`, { reason });
}

// ─── KYC Passport ────────────────────────────────────────────────────────────

export async function requestKYCPassport(params: {
  userId: string;
  sourceRegulator: "FINTRAC" | "CBN" | "FCA";
  targetRegulator: "FINTRAC" | "CBN" | "FCA";
  kycTier: number;
  documents: { type: string; documentId: string; issuingCountry: string }[];
  consentToken: string;
}): Promise<MarkLaneKYCPassport> {
  logger.info("Requesting KYC passport", {
    service: "marklane-client",
    source: params.sourceRegulator,
    target: params.targetRegulator,
    tier: params.kycTier,
  });

  return markLaneRequest<MarkLaneKYCPassport>("POST", "/kyc/passport", params);
}

export async function verifyKYCPassport(
  passportId: string,
): Promise<MarkLaneKYCPassport> {
  return markLaneRequest<MarkLaneKYCPassport>("GET", `/kyc/passport/${passportId}`);
}

export async function revokeKYCPassport(
  passportId: string,
  reason: string,
): Promise<{ status: string }> {
  return markLaneRequest("POST", `/kyc/passport/${passportId}/revoke`, { reason });
}

// ─── Settlement / Nostro ─────────────────────────────────────────────────────

export async function getMarkLaneNostroBalances(): Promise<MarkLaneNostroBalance[]> {
  return markLaneRequest<MarkLaneNostroBalance[]>("GET", "/settlement/nostro/balances");
}

export async function requestMarkLanePrefunding(
  currency: string,
  amount: number,
): Promise<{ prefundingId: string; status: string; instructions: Record<string, string> }> {
  return markLaneRequest("POST", "/settlement/prefund", { currency, amount });
}

export async function getMarkLaneSettlementHistory(
  fromDate: string,
  toDate: string,
): Promise<{ settlements: { id: string; amount: number; currency: string; date: string; status: string }[] }> {
  return markLaneRequest("GET", `/settlement/history?from=${fromDate}&to=${toDate}`);
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

export async function registerMarkLaneWebhook(
  url: string,
  events: string[],
): Promise<{ webhookId: string; status: string }> {
  return markLaneRequest("POST", "/webhooks", { url, events });
}

export function verifyMarkLaneWebhookSignature(
  payload: string,
  signature: string,
): boolean {
  const config = getConfig();
  if (!config.webhookSecret) return false;

  const crypto = require("crypto");
  const expected = crypto
    .createHmac("sha256", config.webhookSecret)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex"),
  );
}

// ─── Mock Responses (Sandbox / No API Key) ───────────────────────────────────

function mockResponse(path: string): unknown {
  const now = new Date().toISOString();
  const expiry = new Date(Date.now() + 300_000).toISOString();

  if (path.includes("/fx/quote")) {
    return {
      quoteId: `mlq-${Date.now().toString(36)}`,
      fromCurrency: "CAD",
      toCurrency: "USD",
      rate: 0.7350,
      inverseRate: 1.3605,
      spread: 0.0015,
      amount: 1000,
      convertedAmount: 735.0,
      fee: 5.0,
      netAmount: 730.0,
      expiresAt: expiry,
      type: "spot",
      provider: "marklane",
    } satisfies MarkLaneFXQuote;
  }

  if (path.includes("/cancel")) {
    return { status: "cancelled", refundAmount: 1000 };
  }

  if (path.includes("/revoke")) {
    return { status: "revoked" };
  }

  if (path.includes("/settlement/history")) {
    return { settlements: [{ id: "s-1", amount: 50000, currency: "CAD", date: now, status: "completed" }] };
  }

  if (path.includes("/transfers")) {
    return {
      transferId: `mlt-${Date.now().toString(36)}`,
      status: "pending",
      fromCurrency: "CAD",
      toCurrency: "NGN",
      sendAmount: 1000,
      receiveAmount: 1_100_000,
      fxRate: 1100,
      fee: 15,
      reference: `RF-ML-${Date.now()}`,
      senderName: "Test User",
      recipientName: "Test Recipient",
      recipientAccount: "0123456789",
      recipientBank: "058",
      corridor: "CA-NG",
      createdAt: now,
    } satisfies MarkLaneTransfer;
  }

  if (path.includes("/kyc/passport")) {
    return {
      passportId: `mlp-${Date.now().toString(36)}`,
      userId: "test-user",
      sourceRegulator: "FINTRAC",
      targetRegulator: "CBN",
      kycTier: 2,
      verificationStatus: "verified",
      documents: [
        { type: "passport", verified: true, verifiedAt: now, expiresAt: "2028-01-01" },
        { type: "proof_of_address", verified: true, verifiedAt: now, expiresAt: "2027-01-01" },
      ],
      amlScreening: {
        sanctionsCleared: true,
        pepScreened: true,
        lastScreenedAt: now,
      },
      validUntil: "2027-01-01",
      createdAt: now,
    } satisfies MarkLaneKYCPassport;
  }

  if (path.includes("/nostro/balances")) {
    return [
      { currency: "CAD", available: 500_000, reserved: 50_000, total: 550_000, lastUpdated: now, accountId: "ml-nostro-cad" },
      { currency: "USD", available: 350_000, reserved: 25_000, total: 375_000, lastUpdated: now, accountId: "ml-nostro-usd" },
    ] satisfies MarkLaneNostroBalance[];
  }

  if (path.includes("/settlement/prefund")) {
    return {
      prefundingId: `mlpf-${Date.now().toString(36)}`,
      status: "pending",
      instructions: { bank: "Royal Bank of Canada", transit: "12345", account: "9876543", reference: `PF-${Date.now()}` },
    };
  }

  if (path.includes("/webhooks")) {
    return { webhookId: `mlwh-${Date.now().toString(36)}`, status: "active" };
  }

  if (path.includes("/fx/rates")) {
    return {
      "CAD/USD": { bid: 0.7345, ask: 0.7355, mid: 0.7350, timestamp: now },
      "CAD/NGN": { bid: 1095, ask: 1105, mid: 1100, timestamp: now },
      "CAD/GHS": { bid: 10.85, ask: 10.95, mid: 10.90, timestamp: now },
      "CAD/KES": { bid: 100.5, ask: 101.5, mid: 101.0, timestamp: now },
    };
  }

  return { status: "ok", mock: true };
}
