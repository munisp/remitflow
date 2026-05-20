/**
 * RemitFlow Business Rules Engine
 * Centralizes all fee calculation, transfer limits, KYC tier enforcement,
 * corridor pricing, and compliance thresholds.
 */

// ─── KYC Tier Limits (daily / monthly / per-transaction in USD) ───────────────
export const KYC_TIER_LIMITS = {
  tier0: { daily: 0,       monthly: 0,       perTx: 0,       label: "Unverified" },
  tier1: { daily: 1_000,   monthly: 5_000,   perTx: 500,     label: "Basic KYC" },
  tier2: { daily: 10_000,  monthly: 50_000,  perTx: 5_000,   label: "Enhanced KYC" },
  tier3: { daily: 100_000, monthly: 500_000, perTx: 50_000,  label: "Full KYC" },
} as const;

export type KycTier = keyof typeof KYC_TIER_LIMITS;

// ─── CBN Tiered KYC (NGN) — CBN/DIR/GEN/CIR/04/010 ──────────────────────────
// Nigerian Naira limits per CBN circular
export const CBN_TIER_LIMITS_NGN = {
  tier1: {
    maxBalance: 300_000,
    dailyLimit: 50_000,
    label: "Basic (Mobile Money)",
    requiredDocs: ["phone", "name", "dob"],
    liveness: false,
    bvn: false,
    nin: false,
    address: false,
  },
  tier2: {
    maxBalance: 500_000,
    dailyLimit: 200_000,
    label: "Standard",
    requiredDocs: ["phone", "name", "dob", "bvn", "id_document"],
    liveness: true,
    bvn: true,
    nin: false,
    address: false,
  },
  tier3: {
    maxBalance: Infinity,
    dailyLimit: Infinity,
    label: "Enhanced (Full Banking)",
    requiredDocs: ["phone", "name", "dob", "bvn", "nin", "id_document", "utility_bill", "passport_photo", "signature"],
    liveness: true,
    bvn: true,
    nin: true,
    address: true,
  },
} as const;

export type CbnTier = keyof typeof CBN_TIER_LIMITS_NGN;

// ─── Product-Level KYC Requirements ──────────────────────────────────────────
export const PRODUCT_KYC_REQUIREMENTS = {
  savings_account:     { kycLevel: "basic",      tier: "tier1" as CbnTier, kybRequired: false },
  current_account:     { kycLevel: "standard",   tier: "tier2" as CbnTier, kybRequired: false },
  domiciliary_account: { kycLevel: "enhanced",   tier: "tier3" as CbnTier, kybRequired: false },
  fixed_deposit:       { kycLevel: "standard",   tier: "tier2" as CbnTier, kybRequired: false },
  corporate_account:   { kycLevel: "full_edd",   tier: "tier3" as CbnTier, kybRequired: true  },
  loan_personal:       { kycLevel: "enhanced",   tier: "tier2" as CbnTier, kybRequired: false },
  loan_sme:            { kycLevel: "enhanced",   tier: "tier3" as CbnTier, kybRequired: true  },
  loan_mortgage:       { kycLevel: "full_edd",   tier: "tier3" as CbnTier, kybRequired: true  },
} as const;

export type ProductType = keyof typeof PRODUCT_KYC_REQUIREMENTS;

// ─── KYC Risk Scoring Weights ────────────────────────────────────────────────
export const KYC_RISK_WEIGHTS = {
  pep_match: 40,
  sanctions_match: 40,
  adverse_media: 20,
  high_risk_country: 25,
  cash_intensive_business: 15,
  base_score_max: 20,
} as const;

export type RiskCategory = "low" | "medium" | "high" | "critical";

export function computeRiskCategory(score: number): RiskCategory {
  if (score < 25) return "low";
  if (score < 50) return "medium";
  if (score < 75) return "high";
  return "critical";
}

// ─── Loan KYC Level Determination ────────────────────────────────────────────
export function requiredKYCLevelForLoan(loanType: string, amount: number): string {
  if (loanType === "mortgage" || amount >= 50_000_000) return "full_edd";
  if (loanType === "sme" || loanType === "corporate" || amount >= 10_000_000) return "enhanced";
  return "enhanced"; // minimum for all loans
}

// ─── Account-Opening KYC Level ───────────────────────────────────────────────
export function kycLevelForTier(tier: CbnTier): string {
  switch (tier) {
    case "tier1": return "basic";
    case "tier2": return "standard";
    case "tier3": return "enhanced";
    default: return "standard";
  }
}

// ─── Fee Schedule ─────────────────────────────────────────────────────────────
// Tiered fee structure: lower fees for higher volumes
export interface FeeBreakdown {
  baseFee: number;       // flat fee in source currency
  percentageFee: number; // percentage of amount
  totalFee: number;      // total fee in source currency
  feeRate: number;       // effective rate (0.005 = 0.5%)
  discountApplied: boolean;
  discountReason?: string;
}

export function calculateFee(
  amountUSD: number,
  corridor: { from: string; to: string },
  userTier: KycTier = "tier1",
  isRecurring = false,
  isBatch = false
): FeeBreakdown {
  // Base fee tiers by amount (USD)
  let feeRate: number;
  if (amountUSD <= 100)        feeRate = 0.020; // 2.0% for micro-transfers
  else if (amountUSD <= 500)   feeRate = 0.015; // 1.5%
  else if (amountUSD <= 1_000) feeRate = 0.010; // 1.0%
  else if (amountUSD <= 5_000) feeRate = 0.007; // 0.7%
  else if (amountUSD <= 10_000) feeRate = 0.005; // 0.5%
  else                          feeRate = 0.003; // 0.3% for large transfers

  // Corridor-based adjustments
  const highCostCorridors = ["NG-US", "GH-UK", "KE-EU", "ZA-US"];
  const lowCostCorridors  = ["NG-GH", "KE-TZ", "UG-KE"];
  const corridorKey = `${corridor.from}-${corridor.to}`;
  if (highCostCorridors.includes(corridorKey)) feeRate *= 1.2;
  if (lowCostCorridors.includes(corridorKey))  feeRate *= 0.8;

  // Tier discounts
  const tierDiscounts: Record<KycTier, number> = {
    tier0: 0,
    tier1: 0,
    tier2: 0.10, // 10% discount for Enhanced KYC
    tier3: 0.20, // 20% discount for Full KYC
  };
  const tierDiscount = tierDiscounts[userTier] ?? 0;

  // Recurring payment discount: 15%
  const recurringDiscount = isRecurring ? 0.15 : 0;

  // Batch payment discount: 25%
  const batchDiscount = isBatch ? 0.25 : 0;

  // Apply best discount (not stacked)
  const bestDiscount = Math.max(tierDiscount, recurringDiscount, batchDiscount);
  const discountApplied = bestDiscount > 0;
  let discountReason: string | undefined;
  if (bestDiscount === batchDiscount && isBatch)       discountReason = "Batch payment (25% off)";
  else if (bestDiscount === recurringDiscount && isRecurring) discountReason = "Recurring payment (15% off)";
  else if (bestDiscount === tierDiscount && tierDiscount > 0) discountReason = `${KYC_TIER_LIMITS[userTier].label} (${Math.round(tierDiscount * 100)}% off)`;

  const effectiveRate = feeRate * (1 - bestDiscount);
  const baseFee = 0.50; // $0.50 flat minimum fee
  const percentageFee = amountUSD * effectiveRate;
  const totalFee = Math.max(baseFee, percentageFee);

  return {
    baseFee,
    percentageFee,
    totalFee,
    feeRate: effectiveRate,
    discountApplied,
    discountReason,
  };
}

// ─── Transfer Limit Enforcement ───────────────────────────────────────────────
export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  limit?: number;
  used?: number;
  remaining?: number;
}

export function checkTransferLimit(
  amountUSD: number,
  userTier: KycTier,
  dailyUsedUSD: number,
  monthlyUsedUSD: number
): LimitCheckResult {
  const limits = KYC_TIER_LIMITS[userTier];

  if (limits.perTx === 0) {
    return { allowed: false, reason: "Account not verified. Please complete KYC to send money." };
  }

  if (amountUSD > limits.perTx) {
    return {
      allowed: false,
      reason: `Transfer exceeds your per-transaction limit of $${limits.perTx.toLocaleString()} USD. Upgrade your KYC tier to increase limits.`,
      limit: limits.perTx,
      used: amountUSD,
    };
  }

  if (dailyUsedUSD + amountUSD > limits.daily) {
    const remaining = Math.max(0, limits.daily - dailyUsedUSD);
    return {
      allowed: false,
      reason: `Transfer would exceed your daily limit of $${limits.daily.toLocaleString()} USD. Remaining today: $${remaining.toLocaleString()}.`,
      limit: limits.daily,
      used: dailyUsedUSD,
      remaining,
    };
  }

  if (monthlyUsedUSD + amountUSD > limits.monthly) {
    const remaining = Math.max(0, limits.monthly - monthlyUsedUSD);
    return {
      allowed: false,
      reason: `Transfer would exceed your monthly limit of $${limits.monthly.toLocaleString()} USD. Remaining this month: $${remaining.toLocaleString()}.`,
      limit: limits.monthly,
      used: monthlyUsedUSD,
      remaining,
    };
  }

  return {
    allowed: true,
    limit: limits.perTx,
    used: amountUSD,
    remaining: limits.perTx - amountUSD,
  };
}

// ─── AML Thresholds ───────────────────────────────────────────────────────────
// Transactions above these thresholds require enhanced due diligence
export const AML_THRESHOLDS = {
  CTR_USD: 10_000,   // Currency Transaction Report threshold
  SAR_USD: 5_000,    // Suspicious Activity Report trigger
  EDD_USD: 3_000,    // Enhanced Due Diligence threshold
  TRAVEL_RULE_USD: 1_000, // FATF Travel Rule threshold
} as const;

export function getAmlFlags(amountUSD: number): string[] {
  const flags: string[] = [];
  if (amountUSD >= AML_THRESHOLDS.CTR_USD) flags.push("CTR_REQUIRED");
  if (amountUSD >= AML_THRESHOLDS.SAR_USD)  flags.push("SAR_REVIEW");
  if (amountUSD >= AML_THRESHOLDS.EDD_USD)  flags.push("EDD_REQUIRED");
  if (amountUSD >= AML_THRESHOLDS.TRAVEL_RULE_USD) flags.push("TRAVEL_RULE");
  return flags;
}

// ─── Corridor Pricing ─────────────────────────────────────────────────────────
export interface CorridorConfig {
  from: string;
  to: string;
  deliveryMethods: Array<"bank_transfer" | "mobile_money" | "cash_pickup" | "wallet">;
  estimatedTime: string;
  feeMultiplier: number;
  isActive: boolean;
  minAmount: number; // USD
  maxAmount: number; // USD
}

export const CORRIDOR_CONFIGS: CorridorConfig[] = [
  { from: "NG", to: "US", deliveryMethods: ["bank_transfer"], estimatedTime: "1-2 business days", feeMultiplier: 1.2, isActive: true, minAmount: 10, maxAmount: 50000 },
  { from: "NG", to: "UK", deliveryMethods: ["bank_transfer"], estimatedTime: "1-2 business days", feeMultiplier: 1.15, isActive: true, minAmount: 10, maxAmount: 50000 },
  { from: "NG", to: "GH", deliveryMethods: ["bank_transfer", "mobile_money"], estimatedTime: "Minutes", feeMultiplier: 0.8, isActive: true, minAmount: 1, maxAmount: 10000 },
  { from: "NG", to: "KE", deliveryMethods: ["bank_transfer", "mobile_money"], estimatedTime: "Minutes", feeMultiplier: 0.85, isActive: true, minAmount: 1, maxAmount: 10000 },
  { from: "KE", to: "TZ", deliveryMethods: ["mobile_money", "bank_transfer"], estimatedTime: "Minutes", feeMultiplier: 0.75, isActive: true, minAmount: 1, maxAmount: 5000 },
  { from: "GH", to: "UK", deliveryMethods: ["bank_transfer"], estimatedTime: "1-3 business days", feeMultiplier: 1.2, isActive: true, minAmount: 10, maxAmount: 50000 },
  { from: "ZA", to: "US", deliveryMethods: ["bank_transfer"], estimatedTime: "2-3 business days", feeMultiplier: 1.25, isActive: true, minAmount: 10, maxAmount: 50000 },
  { from: "US", to: "NG", deliveryMethods: ["bank_transfer", "mobile_money"], estimatedTime: "1-2 business days", feeMultiplier: 1.1, isActive: true, minAmount: 10, maxAmount: 50000 },
  { from: "UK", to: "NG", deliveryMethods: ["bank_transfer", "mobile_money"], estimatedTime: "1-2 business days", feeMultiplier: 1.1, isActive: true, minAmount: 10, maxAmount: 50000 },
  { from: "EU", to: "NG", deliveryMethods: ["bank_transfer"], estimatedTime: "1-3 business days", feeMultiplier: 1.15, isActive: true, minAmount: 10, maxAmount: 50000 },
];

export function getCorridorConfig(from: string, to: string): CorridorConfig | null {
  return CORRIDOR_CONFIGS.find(c => c.from === from && c.to === to) ?? null;
}

// ─── Dispute Resolution SLA ───────────────────────────────────────────────────
export const DISPUTE_SLA_HOURS = {
  urgent: 4,    // Fraud / unauthorized transaction
  high: 24,     // Failed transfer / wrong amount
  medium: 72,   // Delayed transfer
  low: 168,     // General inquiry
} as const;

export type DisputePriority = keyof typeof DISPUTE_SLA_HOURS;

export function getDisputePriority(category: string): DisputePriority {
  if (category === "fraud" || category === "unauthorized") return "urgent";
  if (category === "failed_transfer" || category === "wrong_amount") return "high";
  if (category === "delayed") return "medium";
  return "low";
}

export function getDisputeSlaDeadline(priority: DisputePriority, createdAt: Date): Date {
  const hours = DISPUTE_SLA_HOURS[priority];
  return new Date(createdAt.getTime() + hours * 3600 * 1000);
}

// ─── Rate Lock Pricing ────────────────────────────────────────────────────────
export const RATE_LOCK_FEES = {
  "1h":  { fee: 0,    label: "1 Hour",  description: "Free rate lock for 1 hour" },
  "4h":  { fee: 0.50, label: "4 Hours", description: "$0.50 for 4-hour rate lock" },
  "24h": { fee: 1.50, label: "24 Hours", description: "$1.50 for 24-hour rate lock" },
  "72h": { fee: 3.00, label: "3 Days",  description: "$3.00 for 3-day rate lock" },
} as const;

export type RateLockDuration = keyof typeof RATE_LOCK_FEES;

// ─── Referral Reward Tiers ────────────────────────────────────────────────────
export const REFERRAL_TIERS = [
  { name: "Bronze", minReferrals: 0,  reward: 5,   bonus: 0 },
  { name: "Silver", minReferrals: 5,  reward: 7.5, bonus: 10 },
  { name: "Gold",   minReferrals: 15, reward: 10,  bonus: 25 },
  { name: "Platinum", minReferrals: 30, reward: 15, bonus: 50 },
] as const;

export function getReferralTier(totalReferrals: number) {
  return [...REFERRAL_TIERS].reverse().find(t => totalReferrals >= t.minReferrals) ?? REFERRAL_TIERS[0];
}
