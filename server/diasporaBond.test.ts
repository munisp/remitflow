/**
 * Diaspora Bond Router Tests
 * Tests cover: bond pricing, yield calculation, subscription validation,
 * coupon payment logic, secondary market pricing, and lock-up rules.
 */
import { describe, it, expect } from "vitest";

// ─── Bond Pricing Logic ───────────────────────────────────────────────────────

interface BondPriceResult {
  cleanPrice: number;
  accruedInterest: number;
  dirtyPrice: number;
  yieldToMaturity: number;
  duration: number;
  convexity: number;
}

function priceBond(params: {
  faceValue: number;
  couponRate: number;
  periodsPerYear: number;
  periodsRemaining: number;
  marketYield: number;
}): BondPriceResult {
  const { faceValue, couponRate, periodsPerYear, periodsRemaining, marketYield } = params;
  const couponPayment = (faceValue * couponRate) / periodsPerYear;
  const periodYield = marketYield / periodsPerYear;

  let cleanPrice = 0;
  let duration = 0;
  let convexity = 0;

  for (let t = 1; t <= periodsRemaining; t++) {
    const pv = couponPayment / Math.pow(1 + periodYield, t);
    cleanPrice += pv;
    duration += (t / periodsPerYear) * pv;
    convexity += (t * (t + 1)) / Math.pow(1 + periodYield, t + 2) * couponPayment;
  }
  const pvFace = faceValue / Math.pow(1 + periodYield, periodsRemaining);
  cleanPrice += pvFace;
  duration += (periodsRemaining / periodsPerYear) * pvFace;
  duration /= cleanPrice;
  convexity = (convexity + (periodsRemaining * (periodsRemaining + 1) * pvFace) / Math.pow(1 + periodYield, 2)) / (cleanPrice * Math.pow(1 + periodYield, 2));

  // Accrued interest: assume half period elapsed
  const accruedInterest = couponPayment * 0.5;
  const dirtyPrice = cleanPrice + accruedInterest;

  return {
    cleanPrice,
    accruedInterest,
    dirtyPrice,
    yieldToMaturity: marketYield,
    duration,
    convexity,
  };
}

describe("Diaspora Bond — Bond Pricing Engine", () => {
  it("should price a par bond correctly when coupon equals yield", () => {
    const result = priceBond({
      faceValue: 1000,
      couponRate: 0.10,
      periodsPerYear: 2,
      periodsRemaining: 10,
      marketYield: 0.10,
    });
    // When coupon rate == market yield, price should be close to par
    expect(result.cleanPrice).toBeCloseTo(1000, 0);
  });

  it("should price a premium bond when coupon > yield", () => {
    const result = priceBond({
      faceValue: 1000,
      couponRate: 0.12,
      periodsPerYear: 2,
      periodsRemaining: 10,
      marketYield: 0.08,
    });
    expect(result.cleanPrice).toBeGreaterThan(1000);
  });

  it("should price a discount bond when coupon < yield", () => {
    const result = priceBond({
      faceValue: 1000,
      couponRate: 0.06,
      periodsPerYear: 2,
      periodsRemaining: 10,
      marketYield: 0.10,
    });
    expect(result.cleanPrice).toBeLessThan(1000);
  });

  it("should have positive duration", () => {
    const result = priceBond({
      faceValue: 1000,
      couponRate: 0.10,
      periodsPerYear: 2,
      periodsRemaining: 10,
      marketYield: 0.10,
    });
    expect(result.duration).toBeGreaterThan(0);
  });

  it("should have dirty price = clean price + accrued interest", () => {
    const result = priceBond({
      faceValue: 1000,
      couponRate: 0.10,
      periodsPerYear: 2,
      periodsRemaining: 10,
      marketYield: 0.10,
    });
    expect(result.dirtyPrice).toBeCloseTo(result.cleanPrice + result.accruedInterest, 5);
  });
});

// ─── Subscription Validation ──────────────────────────────────────────────────

interface BondSubscription {
  userId: number;
  bondId: number;
  amountUsd: number;
  minInvestment: number;
  maxInvestment: number;
  availableUnits: number;
  faceValuePerUnit: number;
  lockupMonths: number;
  kycVerified: boolean;
  diasporaVerified: boolean;
}

function validateSubscription(sub: BondSubscription): string[] {
  const errors: string[] = [];
  if (!sub.kycVerified) errors.push("KYC verification required before investing in bonds");
  if (!sub.diasporaVerified) errors.push("Diaspora status verification required");
  if (sub.amountUsd < sub.minInvestment) {
    errors.push(`Minimum investment is $${sub.minInvestment.toLocaleString()}`);
  }
  if (sub.amountUsd > sub.maxInvestment) {
    errors.push(`Maximum investment is $${sub.maxInvestment.toLocaleString()}`);
  }
  const unitsRequested = sub.amountUsd / sub.faceValuePerUnit;
  if (unitsRequested > sub.availableUnits) {
    errors.push("Insufficient units available");
  }
  if (sub.amountUsd <= 0) {
    errors.push("Investment amount must be positive");
  }
  return errors;
}

describe("Diaspora Bond — Subscription Validation", () => {
  const validSub: BondSubscription = {
    userId: 1,
    bondId: 1,
    amountUsd: 5_000,
    minInvestment: 500,
    maxInvestment: 100_000,
    availableUnits: 1_000,
    faceValuePerUnit: 100,
    lockupMonths: 24,
    kycVerified: true,
    diasporaVerified: true,
  };

  it("should pass for a valid subscription", () => {
    expect(validateSubscription(validSub)).toHaveLength(0);
  });

  it("should reject if KYC not verified", () => {
    const errors = validateSubscription({ ...validSub, kycVerified: false });
    expect(errors).toContain("KYC verification required before investing in bonds");
  });

  it("should reject if diaspora status not verified", () => {
    const errors = validateSubscription({ ...validSub, diasporaVerified: false });
    expect(errors).toContain("Diaspora status verification required");
  });

  it("should reject if below minimum investment", () => {
    const errors = validateSubscription({ ...validSub, amountUsd: 100 });
    expect(errors.some(e => e.includes("Minimum investment"))).toBe(true);
  });

  it("should reject if above maximum investment", () => {
    const errors = validateSubscription({ ...validSub, amountUsd: 200_000 });
    expect(errors.some(e => e.includes("Maximum investment"))).toBe(true);
  });

  it("should reject if insufficient units available", () => {
    const errors = validateSubscription({ ...validSub, amountUsd: 200_000, maxInvestment: 500_000, availableUnits: 10 });
    expect(errors).toContain("Insufficient units available");
  });
});

// ─── Coupon Payment Logic ─────────────────────────────────────────────────────

interface CouponPayment {
  grossAmount: number;
  withholdingTaxRate: number;
  platformFeeRate: number;
}

function calculateNetCoupon(payment: CouponPayment): {
  grossAmount: number;
  withholdingTax: number;
  platformFee: number;
  netAmount: number;
} {
  const withholdingTax = payment.grossAmount * payment.withholdingTaxRate;
  const platformFee = payment.grossAmount * payment.platformFeeRate;
  const netAmount = payment.grossAmount - withholdingTax - platformFee;
  return {
    grossAmount: payment.grossAmount,
    withholdingTax,
    platformFee,
    netAmount,
  };
}

describe("Diaspora Bond — Coupon Payment Calculations", () => {
  it("should correctly deduct withholding tax and platform fee", () => {
    const result = calculateNetCoupon({
      grossAmount: 1000,
      withholdingTaxRate: 0.10,
      platformFeeRate: 0.005,
    });
    expect(result.withholdingTax).toBe(100);
    expect(result.platformFee).toBe(5);
    expect(result.netAmount).toBe(895);
  });

  it("should return full gross if no deductions", () => {
    const result = calculateNetCoupon({
      grossAmount: 500,
      withholdingTaxRate: 0,
      platformFeeRate: 0,
    });
    expect(result.netAmount).toBe(500);
  });

  it("should not produce negative net amount for reasonable rates", () => {
    const result = calculateNetCoupon({
      grossAmount: 200,
      withholdingTaxRate: 0.15,
      platformFeeRate: 0.01,
    });
    expect(result.netAmount).toBeGreaterThan(0);
  });
});

// ─── Secondary Market Rules ───────────────────────────────────────────────────

describe("Diaspora Bond — Secondary Market Business Rules", () => {
  interface SecondaryOrder {
    subscriptionId: number;
    askPriceUsd: number;
    originalPurchasePriceUsd: number;
    lockupEndDate: Date;
    currentDate: Date;
    units: number;
    minAskPrice: number;
    maxAskPrice: number;
  }

  function validateSecondaryOrder(order: SecondaryOrder): string[] {
    const errors: string[] = [];
    if (order.currentDate < order.lockupEndDate) {
      errors.push("Bond is still in lock-up period and cannot be listed on secondary market");
    }
    if (order.askPriceUsd < order.minAskPrice) {
      errors.push(`Ask price cannot be below floor price of $${order.minAskPrice}`);
    }
    if (order.askPriceUsd > order.maxAskPrice) {
      errors.push(`Ask price cannot exceed ceiling price of $${order.maxAskPrice}`);
    }
    if (order.units <= 0) {
      errors.push("Must list at least 1 unit");
    }
    return errors;
  }

  const pastDate = new Date("2024-01-01");
  const futureDate = new Date("2028-01-01");
  const now = new Date("2026-05-11");

  it("should allow listing after lock-up period", () => {
    const errors = validateSecondaryOrder({
      subscriptionId: 1,
      askPriceUsd: 1050,
      originalPurchasePriceUsd: 1000,
      lockupEndDate: pastDate,
      currentDate: now,
      units: 10,
      minAskPrice: 800,
      maxAskPrice: 1200,
    });
    expect(errors).toHaveLength(0);
  });

  it("should block listing during lock-up period", () => {
    const errors = validateSecondaryOrder({
      subscriptionId: 1,
      askPriceUsd: 1050,
      originalPurchasePriceUsd: 1000,
      lockupEndDate: futureDate,
      currentDate: now,
      units: 10,
      minAskPrice: 800,
      maxAskPrice: 1200,
    });
    expect(errors).toContain("Bond is still in lock-up period and cannot be listed on secondary market");
  });

  it("should reject ask price below floor", () => {
    const errors = validateSecondaryOrder({
      subscriptionId: 1,
      askPriceUsd: 500,
      originalPurchasePriceUsd: 1000,
      lockupEndDate: pastDate,
      currentDate: now,
      units: 10,
      minAskPrice: 800,
      maxAskPrice: 1200,
    });
    expect(errors.some(e => e.includes("floor price"))).toBe(true);
  });

  it("should reject ask price above ceiling", () => {
    const errors = validateSecondaryOrder({
      subscriptionId: 1,
      askPriceUsd: 2000,
      originalPurchasePriceUsd: 1000,
      lockupEndDate: pastDate,
      currentDate: now,
      units: 10,
      minAskPrice: 800,
      maxAskPrice: 1200,
    });
    expect(errors.some(e => e.includes("ceiling price"))).toBe(true);
  });
});
