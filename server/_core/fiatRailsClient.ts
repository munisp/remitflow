/**
 * fiatRailsClient.ts — Fiat Payment Rails Integration
 *
 * Abstraction layer for fiat deposit/withdrawal across multiple rails:
 *   - ACH (US domestic, 1-3 day settlement)
 *   - SEPA (EU, same-day / instant via SEPA Instant)
 *   - SWIFT (global, 1-5 days)
 *   - NIBSS/NIP (Nigeria Instant Payment, sub-5 seconds)
 *   - M-Pesa (Kenya/Tanzania, instant)
 *   - Mobile Money (Ghana, Côte d'Ivoire)
 *   - Mojaloop (interoperable payment switch)
 *   - PAPSS (Pan-African Payment & Settlement System)
 *
 * Each rail returns a unified PayoutResult. The router selects the optimal
 * rail based on corridor, speed, and cost.
 */

import { randomBytes } from "crypto";
import { logger } from "./logger";

// ── Types ───────────────────────────────────────────────────────────────────

export type PayoutRail =
  | "ach"
  | "sepa"
  | "sepa_instant"
  | "swift"
  | "nibss_nip"
  | "mpesa"
  | "mobile_money"
  | "mojaloop"
  | "papss";

export interface PayoutRequest {
  rail: PayoutRail;
  amount: number;
  currency: string;
  recipientName: string;
  recipientAccount: string;
  recipientBank?: string;
  recipientBankCode?: string;
  recipientPhoneNumber?: string;
  recipientCountry: string;
  description: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface PayoutResult {
  payoutId: string;
  rail: PayoutRail;
  status: "submitted" | "processing" | "completed" | "failed" | "returned";
  amount: number;
  currency: string;
  fee: number;
  recipientName: string;
  trackingReference: string;
  estimatedArrival: string;
  submittedAt: string;
}

export interface DepositInstruction {
  rail: PayoutRail;
  currency: string;
  bankName: string;
  accountNumber: string;
  routingNumber?: string;
  swiftCode?: string;
  iban?: string;
  reference: string;
  instructions: string;
}

export interface RailCapability {
  rail: PayoutRail;
  name: string;
  currencies: string[];
  countries: string[];
  settlementTime: string;
  feePercent: number;
  feeFixed: number;
  minAmount: number;
  maxAmount: number;
  available: boolean;
}

// ── Rail Capabilities ───────────────────────────────────────────────────────

export const RAIL_CAPABILITIES: RailCapability[] = [
  {
    rail: "ach", name: "ACH (US Domestic)", currencies: ["USD"],
    countries: ["US"], settlementTime: "1-3 business days",
    feePercent: 0, feeFixed: 0.50, minAmount: 1, maxAmount: 1_000_000, available: true,
  },
  {
    rail: "sepa", name: "SEPA Credit Transfer", currencies: ["EUR"],
    countries: ["DE", "FR", "NL", "IT", "ES", "BE", "AT", "PT", "IE", "FI"],
    settlementTime: "1 business day", feePercent: 0, feeFixed: 0.20,
    minAmount: 0.01, maxAmount: 999_999_999, available: true,
  },
  {
    rail: "sepa_instant", name: "SEPA Instant", currencies: ["EUR"],
    countries: ["DE", "FR", "NL", "IT", "ES", "BE", "AT", "PT", "IE", "FI"],
    settlementTime: "< 10 seconds", feePercent: 0.1, feeFixed: 0.50,
    minAmount: 0.01, maxAmount: 100_000, available: true,
  },
  {
    rail: "swift", name: "SWIFT International", currencies: ["USD", "EUR", "GBP", "NGN", "GHS", "KES", "ZAR"],
    countries: ["*"], settlementTime: "1-5 business days",
    feePercent: 0, feeFixed: 25, minAmount: 100, maxAmount: 10_000_000, available: true,
  },
  {
    rail: "nibss_nip", name: "NIBSS Instant Payment (Nigeria)", currencies: ["NGN"],
    countries: ["NG"], settlementTime: "< 5 seconds",
    feePercent: 0, feeFixed: 10, minAmount: 100, maxAmount: 10_000_000, available: true,
  },
  {
    rail: "mpesa", name: "M-Pesa", currencies: ["KES"],
    countries: ["KE", "TZ"], settlementTime: "< 30 seconds",
    feePercent: 0.5, feeFixed: 0, minAmount: 10, maxAmount: 300_000, available: true,
  },
  {
    rail: "mobile_money", name: "Mobile Money (West Africa)", currencies: ["GHS", "XOF"],
    countries: ["GH", "CI", "SN", "BF"], settlementTime: "< 60 seconds",
    feePercent: 0.5, feeFixed: 0, minAmount: 1, maxAmount: 50_000, available: true,
  },
  {
    rail: "mojaloop", name: "Mojaloop Switch", currencies: ["NGN", "GHS", "KES", "ZAR", "XOF"],
    countries: ["NG", "GH", "KE", "ZA", "CI"], settlementTime: "< 10 seconds",
    feePercent: 0.1, feeFixed: 0, minAmount: 1, maxAmount: 5_000_000, available: true,
  },
  {
    rail: "papss", name: "PAPSS (Pan-African)", currencies: ["NGN", "GHS", "KES", "ZAR", "XOF", "EGP"],
    countries: ["NG", "GH", "KE", "ZA", "CI", "EG"], settlementTime: "< 2 minutes",
    feePercent: 0.2, feeFixed: 0, minAmount: 10, maxAmount: 10_000_000, available: true,
  },
];

// ── Rail Selection ──────────────────────────────────────────────────────────

export function selectBestRail(currency: string, country: string, amount: number): RailCapability | null {
  const eligible = RAIL_CAPABILITIES.filter(r =>
    r.available &&
    r.currencies.includes(currency) &&
    (r.countries.includes("*") || r.countries.includes(country)) &&
    amount >= r.minAmount &&
    amount <= r.maxAmount,
  );

  if (eligible.length === 0) return null;

  // Prefer fastest, then cheapest
  eligible.sort((a, b) => {
    const speedOrder: Record<string, number> = {
      "< 5 seconds": 1, "< 10 seconds": 2, "< 30 seconds": 3,
      "< 60 seconds": 4, "< 2 minutes": 5,
      "1 business day": 10, "1-3 business days": 20, "1-5 business days": 30,
    };
    const aSpeed = speedOrder[a.settlementTime] || 50;
    const bSpeed = speedOrder[b.settlementTime] || 50;
    if (aSpeed !== bSpeed) return aSpeed - bSpeed;

    const aFee = a.feeFixed + amount * (a.feePercent / 100);
    const bFee = b.feeFixed + amount * (b.feePercent / 100);
    return aFee - bFee;
  });

  return eligible[0];
}

export function calculateFee(rail: RailCapability, amount: number): number {
  return Math.round((rail.feeFixed + amount * (rail.feePercent / 100)) * 100) / 100;
}

// ── Payout Execution ────────────────────────────────────────────────────────

export async function executePayout(req: PayoutRequest): Promise<PayoutResult> {
  const payoutId = `PO-${req.rail.toUpperCase()}-${randomBytes(6).toString("hex")}`;
  const railConfig = RAIL_CAPABILITIES.find(r => r.rail === req.rail);
  const fee = railConfig ? calculateFee(railConfig, req.amount) : 0;

  logger.info({
    payoutId, rail: req.rail, amount: req.amount,
    currency: req.currency, recipient: req.recipientName,
  }, "Payout submitted");

  // In production, this dispatches to the appropriate payment processor:
  //   ACH → Stripe/Plaid/Column
  //   SEPA → Stripe/CurrencyCloud/Banking Circle
  //   SWIFT → Correspondent bank API
  //   NIBSS → Paystack/Flutterwave
  //   M-Pesa → Safaricom Daraja API
  //   Mojaloop → Mojaloop FSPIOP API
  //   PAPSS → PAPSS gateway

  return {
    payoutId,
    rail: req.rail,
    status: "submitted",
    amount: req.amount,
    currency: req.currency,
    fee,
    recipientName: req.recipientName,
    trackingReference: `RF-${payoutId}`,
    estimatedArrival: railConfig?.settlementTime || "unknown",
    submittedAt: new Date().toISOString(),
  };
}

// ── Deposit Instructions ────────────────────────────────────────────────────

export function getDepositInstructions(
  currency: string,
  userId: string,
): DepositInstruction[] {
  const reference = `REMIT-${userId}-${randomBytes(4).toString("hex").toUpperCase()}`;

  const instructions: DepositInstruction[] = [];

  if (currency === "USD") {
    instructions.push({
      rail: "ach",
      currency: "USD",
      bankName: "Column Bank (RemitFlow Settlement)",
      accountNumber: "****7890",
      routingNumber: "021000021",
      reference,
      instructions: `Send ACH transfer to the account above with reference: ${reference}. Funds arrive in 1-3 business days.`,
    });
  }

  if (currency === "EUR") {
    instructions.push({
      rail: "sepa",
      currency: "EUR",
      bankName: "Banking Circle (RemitFlow)",
      accountNumber: "****4567",
      iban: "NL****BCIR0****4567",
      swiftCode: "BCIRNL2A",
      reference,
      instructions: `Send SEPA transfer with reference: ${reference}. SEPA Instant also available.`,
    });
  }

  if (currency === "NGN") {
    instructions.push({
      rail: "nibss_nip",
      currency: "NGN",
      bankName: "First Bank (RemitFlow Collection)",
      accountNumber: "****1234",
      reference,
      instructions: `Transfer via any Nigerian bank with reference: ${reference}. Instant confirmation.`,
    });
  }

  if (currency === "KES") {
    instructions.push({
      rail: "mpesa",
      currency: "KES",
      bankName: "M-Pesa Business",
      accountNumber: "****5678",
      reference,
      instructions: `Send via M-Pesa to business number with reference: ${reference}.`,
    });
  }

  if (currency === "GHS") {
    instructions.push({
      rail: "mobile_money",
      currency: "GHS",
      bankName: "MTN Mobile Money",
      accountNumber: "****9012",
      reference,
      instructions: `Send via MTN MoMo with reference: ${reference}.`,
    });
  }

  return instructions;
}

export function getSupportedRails(): RailCapability[] {
  return RAIL_CAPABILITIES.filter(r => r.available);
}

export function getRailsByCurrency(currency: string): RailCapability[] {
  return RAIL_CAPABILITIES.filter(r => r.available && r.currencies.includes(currency));
}
