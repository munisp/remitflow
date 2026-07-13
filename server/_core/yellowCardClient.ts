/**
 * yellowCardClient.ts — Yellow Card API Integration
 *
 * Africa-focused stablecoin on-ramp/off-ramp provider.
 * Supports NGN, GHS, KES, ZAR, XOF corridors with USDT/USDC.
 *
 * Yellow Card API docs: https://docs.yellowcard.io/
 *
 * Capabilities:
 *   - Get live rates for all supported corridors
 *   - Create payment (fiat → crypto on-ramp)
 *   - Create withdrawal (crypto → fiat off-ramp)
 *   - Get supported channels (bank transfer, mobile money, card)
 *   - Get payment status
 *   - Webhook event handling (payment.completed, withdrawal.completed)
 *
 * Auth: API Key + Secret (env: YELLOWCARD_API_KEY, YELLOWCARD_API_SECRET)
 * Base URL: https://api.yellowcard.io/v1 (production) or sandbox.yellowcard.io
 */

import { createHmac, randomBytes } from "crypto";
import { logger } from "./logger";

// ── Config ──────────────────────────────────────────────────────────────────

const YC_API_KEY = process.env.YELLOWCARD_API_KEY || "";
const YC_API_SECRET = process.env.YELLOWCARD_API_SECRET || "";
const YC_BASE_URL = process.env.YELLOWCARD_ENV === "production"
  ? "https://api.yellowcard.io/v1"
  : "https://sandbox.api.yellowcard.io/v1";

// ── Types ───────────────────────────────────────────────────────────────────

export interface YCRate {
  id: string;
  code: string;            // e.g. "NGN-USDT"
  buy: number;             // buy rate (user pays this many fiat per 1 USDT)
  sell: number;            // sell rate (user receives this many fiat per 1 USDT)
  currency: string;        // NGN, GHS, KES, ZAR
  crypto: string;          // USDT, USDC
  minBuy: number;
  maxBuy: number;
  minSell: number;
  maxSell: number;
  updatedAt: string;
}

export interface YCChannel {
  id: string;
  name: string;            // e.g. "Bank Transfer", "Mobile Money"
  type: string;            // "bank", "mobile_money", "card"
  currency: string;
  country: string;
  active: boolean;
  fields: Array<{
    name: string;
    label: string;
    type: string;
    required: boolean;
    options?: string[];
  }>;
}

export interface YCPayment {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "expired";
  type: "buy" | "sell";
  amount: number;
  currency: string;
  cryptoAmount: number;
  crypto: string;
  rate: number;
  fee: number;
  channelId: string;
  walletAddress?: string;
  reference: string;
  createdAt: string;
  updatedAt: string;
  paymentUrl?: string;
}

export interface YCWithdrawal {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  cryptoAmount: number;
  crypto: string;
  fiatAmount: number;
  currency: string;
  rate: number;
  fee: number;
  channelId: string;
  bankDetails?: {
    bankName: string;
    accountNumber: string;
    accountName: string;
  };
  mobileMoneyDetails?: {
    provider: string;
    phoneNumber: string;
  };
  reference: string;
  createdAt: string;
}

// ── HTTP Client ─────────────────────────────────────────────────────────────

function generateSignature(timestamp: string, method: string, path: string, body: string): string {
  if (!YC_API_SECRET) return "mock-signature";
  const message = `${timestamp}${method}${path}${body}`;
  return createHmac("sha256", YC_API_SECRET).update(message).digest("hex");
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";

async function ycRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  // FAIL-CLOSED: In production, missing API key is a fatal configuration error
  if (!YC_API_KEY) {
    if (IS_PRODUCTION) {
      throw new Error("[YellowCard] FAIL-CLOSED: YC_API_KEY not configured in production — cannot process off-ramp");
    }
    logger.warn("Yellow Card API key not configured — returning mock response (dev only)");
    return mockYCResponse(path, method) as T;
  }

  const url = `${YC_BASE_URL}${path}`;
  const timestamp = new Date().toISOString();
  const bodyStr = body ? JSON.stringify(body) : "";
  const signature = generateSignature(timestamp, method, path, bodyStr);

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "YC-Api-Key": YC_API_KEY,
      "YC-Timestamp": timestamp,
      "YC-Signature": signature,
    },
    body: body ? bodyStr : undefined,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, path, error: errorText }, "Yellow Card API error");
    throw new Error(`Yellow Card API ${response.status}: ${errorText}`);
  }

  return (await response.json()) as T;
}

// ── Mock Responses ──────────────────────────────────────────────────────────

function mockYCResponse(path: string, method: string): unknown {
  const id = randomBytes(8).toString("hex");

  if (path.includes("/rates")) {
    return [
      { id: "1", code: "NGN-USDT", buy: 1650, sell: 1580, currency: "NGN", crypto: "USDT", minBuy: 5000, maxBuy: 50000000, minSell: 10, maxSell: 100000, updatedAt: new Date().toISOString() },
      { id: "2", code: "NGN-USDC", buy: 1648, sell: 1578, currency: "NGN", crypto: "USDC", minBuy: 5000, maxBuy: 50000000, minSell: 10, maxSell: 100000, updatedAt: new Date().toISOString() },
      { id: "3", code: "GHS-USDT", buy: 16.2, sell: 15.5, currency: "GHS", crypto: "USDT", minBuy: 50, maxBuy: 500000, minSell: 10, maxSell: 50000, updatedAt: new Date().toISOString() },
      { id: "4", code: "KES-USDT", buy: 160, sell: 152, currency: "KES", crypto: "USDT", minBuy: 1000, maxBuy: 10000000, minSell: 10, maxSell: 50000, updatedAt: new Date().toISOString() },
      { id: "5", code: "ZAR-USDT", buy: 19.2, sell: 18.3, currency: "ZAR", crypto: "USDT", minBuy: 100, maxBuy: 5000000, minSell: 10, maxSell: 50000, updatedAt: new Date().toISOString() },
    ];
  }

  if (path.includes("/channels")) {
    return [
      { id: "ch-1", name: "Bank Transfer", type: "bank", currency: "NGN", country: "NG", active: true, fields: [{ name: "accountNumber", label: "Account Number", type: "string", required: true }, { name: "bankCode", label: "Bank Code", type: "string", required: true }] },
      { id: "ch-2", name: "Mobile Money", type: "mobile_money", currency: "GHS", country: "GH", active: true, fields: [{ name: "phoneNumber", label: "Phone Number", type: "string", required: true }, { name: "provider", label: "Provider", type: "select", required: true, options: ["MTN", "Vodafone", "AirtelTigo"] }] },
      { id: "ch-3", name: "M-Pesa", type: "mobile_money", currency: "KES", country: "KE", active: true, fields: [{ name: "phoneNumber", label: "Phone Number", type: "string", required: true }] },
    ];
  }

  if (path.includes("/payments") && method === "POST") {
    return {
      id: `yc-pay-${id}`, status: "pending", type: "buy",
      amount: 1600000, currency: "NGN", cryptoAmount: 1000, crypto: "USDT",
      rate: 1600, fee: 24000, channelId: "ch-1", reference: `RF-${id}`,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      paymentUrl: `https://sandbox.yellowcard.io/pay/${id}`,
    };
  }

  if (path.includes("/withdrawals") && method === "POST") {
    return {
      id: `yc-wd-${id}`, status: "pending",
      cryptoAmount: 500, crypto: "USDT", fiatAmount: 790000, currency: "NGN",
      rate: 1580, fee: 15800, channelId: "ch-1",
      bankDetails: { bankName: "First Bank", accountNumber: "0123456789", accountName: "Test User" },
      reference: `RF-WD-${id}`, createdAt: new Date().toISOString(),
    };
  }

  if (path.includes("/payments/") || path.includes("/withdrawals/")) {
    return {
      id: `yc-${id}`, status: "completed",
      amount: 1600000, currency: "NGN", cryptoAmount: 1000, crypto: "USDT",
      rate: 1600, fee: 24000, reference: `RF-${id}`,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
  }

  return { id, status: "mock" };
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function getRates(currency?: string): Promise<YCRate[]> {
  const path = currency ? `/rates?currency=${currency}` : "/rates";
  return ycRequest<YCRate[]>("GET", path);
}

export async function getChannels(country?: string): Promise<YCChannel[]> {
  const path = country ? `/channels?country=${country}` : "/channels";
  return ycRequest<YCChannel[]>("GET", path);
}

export async function createPayment(params: {
  amount: number;
  currency: string;
  crypto: string;
  channelId: string;
  walletAddress: string;
  network: string;
  customerEmail: string;
  customerName: string;
  idempotencyKey: string;
}): Promise<YCPayment> {
  return ycRequest<YCPayment>("POST", "/payments", {
    amount: params.amount,
    currency: params.currency,
    crypto: params.crypto,
    channelId: params.channelId,
    destination: {
      address: params.walletAddress,
      network: params.network,
    },
    customer: {
      email: params.customerEmail,
      name: params.customerName,
    },
    reference: params.idempotencyKey,
  });
}

export async function getPayment(paymentId: string): Promise<YCPayment> {
  return ycRequest<YCPayment>("GET", `/payments/${paymentId}`);
}

export async function createWithdrawal(params: {
  cryptoAmount: number;
  crypto: string;
  currency: string;
  channelId: string;
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
  phoneNumber?: string;
  provider?: string;
  customerEmail: string;
  customerName: string;
  idempotencyKey: string;
}): Promise<YCWithdrawal> {
  const destination: Record<string, unknown> = {};
  if (params.bankName) {
    destination.bankName = params.bankName;
    destination.accountNumber = params.accountNumber;
    destination.accountName = params.accountName;
  }
  if (params.phoneNumber) {
    destination.phoneNumber = params.phoneNumber;
    destination.provider = params.provider;
  }

  return ycRequest<YCWithdrawal>("POST", "/withdrawals", {
    cryptoAmount: params.cryptoAmount,
    crypto: params.crypto,
    currency: params.currency,
    channelId: params.channelId,
    destination,
    customer: {
      email: params.customerEmail,
      name: params.customerName,
    },
    reference: params.idempotencyKey,
  });
}

export async function getWithdrawal(withdrawalId: string): Promise<YCWithdrawal> {
  return ycRequest<YCWithdrawal>("GET", `/withdrawals/${withdrawalId}`);
}
