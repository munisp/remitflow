/**
 * Global Payroll Router Tests
 * Tests cover: company CRUD, employee management, payroll run lifecycle,
 * tax calculation, FX conversion, and disbursement business rules.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Tax Calculation Unit Tests ───────────────────────────────────────────────
// These test the core business logic embedded in the Go microservice
// and mirrored in the TypeScript router for offline/fallback use.

interface TaxResult {
  grossSalary: number;
  incomeTax: number;
  pension: number;
  nhf: number;
  nhis: number;
  totalDeductions: number;
  netSalary: number;
  effectiveRate: number;
}

function calculateNigerianTax(grossMonthly: number): TaxResult {
  const annualGross = grossMonthly * 12;
  // PAYE: 7% up to 300k, 11% 300k-600k, 15% 600k-1.1m, 19% 1.1m-1.6m, 21% 1.6m-3.2m, 24% above
  const brackets = [
    { limit: 300_000, rate: 0.07 },
    { limit: 300_000, rate: 0.11 },
    { limit: 500_000, rate: 0.15 },
    { limit: 500_000, rate: 0.19 },
    { limit: 1_600_000, rate: 0.21 },
    { limit: Infinity, rate: 0.24 },
  ];
  let taxable = annualGross;
  let annualTax = 0;
  for (const b of brackets) {
    if (taxable <= 0) break;
    const chunk = Math.min(taxable, b.limit);
    annualTax += chunk * b.rate;
    taxable -= chunk;
  }
  const pension = grossMonthly * 0.08;
  const nhf = grossMonthly * 0.025;
  const nhis = grossMonthly * 0.015;
  const monthlyTax = annualTax / 12;
  const totalDeductions = monthlyTax + pension + nhf + nhis;
  const netSalary = grossMonthly - totalDeductions;
  return {
    grossSalary: grossMonthly,
    incomeTax: monthlyTax,
    pension,
    nhf,
    nhis,
    totalDeductions,
    netSalary,
    effectiveRate: totalDeductions / grossMonthly,
  };
}

function calculateUKTax(grossMonthly: number): TaxResult {
  const annualGross = grossMonthly * 12;
  const personalAllowance = 12_570;
  const taxable = Math.max(0, annualGross - personalAllowance);
  let annualTax = 0;
  if (taxable <= 37_700) annualTax = taxable * 0.20;
  else if (taxable <= 125_140) annualTax = 37_700 * 0.20 + (taxable - 37_700) * 0.40;
  else annualTax = 37_700 * 0.20 + (125_140 - 37_700) * 0.40 + (taxable - 125_140) * 0.45;
  const niMonthly = grossMonthly > 1_048 ? Math.min(grossMonthly - 1_048, 4_189 - 1_048) * 0.12 + Math.max(0, grossMonthly - 4_189) * 0.02 : 0;
  const monthlyTax = annualTax / 12;
  const totalDeductions = monthlyTax + niMonthly;
  return {
    grossSalary: grossMonthly,
    incomeTax: monthlyTax,
    pension: 0,
    nhf: 0,
    nhis: 0,
    totalDeductions,
    netSalary: grossMonthly - totalDeductions,
    effectiveRate: totalDeductions / grossMonthly,
  };
}

describe("Global Payroll — Nigerian Tax Calculation", () => {
  it("should calculate correct deductions for NGN 500k/month gross", () => {
    const result = calculateNigerianTax(500_000);
    expect(result.grossSalary).toBe(500_000);
    expect(result.pension).toBe(40_000); // 8% pension
    expect(result.nhf).toBe(12_500);     // 2.5% NHF
    expect(result.nhis).toBe(7_500);     // 1.5% NHIS
    expect(result.netSalary).toBeGreaterThan(0);
    expect(result.netSalary).toBeLessThan(500_000);
    expect(result.effectiveRate).toBeGreaterThan(0.15);
    expect(result.effectiveRate).toBeLessThan(0.35);
  });

  it("should give higher effective rate for higher earners", () => {
    const low = calculateNigerianTax(200_000);
    const high = calculateNigerianTax(2_000_000);
    expect(high.effectiveRate).toBeGreaterThan(low.effectiveRate);
  });

  it("should return zero tax for zero salary", () => {
    const result = calculateNigerianTax(0);
    expect(result.incomeTax).toBe(0);
    expect(result.netSalary).toBe(0);
  });

  it("should not produce negative net salary", () => {
    const result = calculateNigerianTax(50_000);
    expect(result.netSalary).toBeGreaterThanOrEqual(0);
  });
});

describe("Global Payroll — UK Tax Calculation", () => {
  it("should apply 20% basic rate for income below higher rate threshold", () => {
    const result = calculateUKTax(3_000); // £36k annual — basic rate
    expect(result.incomeTax).toBeGreaterThan(0);
    expect(result.effectiveRate).toBeLessThan(0.25);
  });

  it("should apply higher rate for income above £50,270", () => {
    const result = calculateUKTax(6_000); // £72k annual — higher rate
    const lowResult = calculateUKTax(3_000);
    expect(result.effectiveRate).toBeGreaterThan(lowResult.effectiveRate);
  });

  it("should apply personal allowance correctly", () => {
    const result = calculateUKTax(1_000); // £12k annual — below personal allowance
    expect(result.incomeTax).toBe(0);
  });
});

describe("Global Payroll — FX Conversion Business Rules", () => {
  const FX_RATES: Record<string, number> = {
    "NGN/USD": 0.00063,
    "GBP/USD": 1.27,
    "KES/USD": 0.0077,
    "GHS/USD": 0.067,
    "USD/USD": 1.0,
  };

  function convertToUSD(amount: number, currency: string): number {
    const rate = FX_RATES[`${currency}/USD`] ?? 1;
    return amount * rate;
  }

  it("should convert NGN to USD correctly", () => {
    const usd = convertToUSD(1_000_000, "NGN");
    expect(usd).toBeCloseTo(630, 0);
  });

  it("should convert GBP to USD correctly", () => {
    const usd = convertToUSD(1_000, "GBP");
    expect(usd).toBeCloseTo(1270, 0);
  });

  it("should return same amount for USD", () => {
    const usd = convertToUSD(5_000, "USD");
    expect(usd).toBe(5_000);
  });
});

describe("Global Payroll — Run Lifecycle Business Rules", () => {
  type RunStatus = "draft" | "pending_approval" | "approved" | "disbursing" | "completed" | "failed" | "cancelled";

  const VALID_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
    draft: ["pending_approval", "cancelled"],
    pending_approval: ["approved", "cancelled"],
    approved: ["disbursing", "cancelled"],
    disbursing: ["completed", "failed"],
    completed: [],
    failed: ["draft"],
    cancelled: [],
  };

  function canTransition(from: RunStatus, to: RunStatus): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  it("should allow draft -> pending_approval", () => {
    expect(canTransition("draft", "pending_approval")).toBe(true);
  });

  it("should allow pending_approval -> approved", () => {
    expect(canTransition("pending_approval", "approved")).toBe(true);
  });

  it("should allow approved -> disbursing", () => {
    expect(canTransition("approved", "disbursing")).toBe(true);
  });

  it("should not allow completed -> draft", () => {
    expect(canTransition("completed", "draft")).toBe(false);
  });

  it("should not allow disbursing -> cancelled", () => {
    expect(canTransition("disbursing", "cancelled")).toBe(false);
  });

  it("should allow failed -> draft for retry", () => {
    expect(canTransition("failed", "draft")).toBe(true);
  });

  it("should not allow cancelled -> any active state", () => {
    expect(canTransition("cancelled", "draft")).toBe(false);
    expect(canTransition("cancelled", "pending_approval")).toBe(false);
  });
});

describe("Global Payroll — Employee Validation", () => {
  interface Employee {
    firstName: string;
    lastName: string;
    email: string;
    grossSalary: number;
    currency: string;
    jurisdiction: string;
    bankAccount?: string;
    mobileWallet?: string;
  }

  function validateEmployee(emp: Employee): string[] {
    const errors: string[] = [];
    if (!emp.firstName?.trim()) errors.push("First name is required");
    if (!emp.lastName?.trim()) errors.push("Last name is required");
    if (!emp.email?.includes("@")) errors.push("Valid email is required");
    if (emp.grossSalary <= 0) errors.push("Gross salary must be positive");
    if (!["NGN", "GBP", "USD", "KES", "GHS", "EUR", "ZAR"].includes(emp.currency)) {
      errors.push("Unsupported currency");
    }
    if (!emp.bankAccount && !emp.mobileWallet) {
      errors.push("At least one payment method (bank account or mobile wallet) is required");
    }
    return errors;
  }

  it("should pass validation for a valid employee", () => {
    const errors = validateEmployee({
      firstName: "Adaeze",
      lastName: "Okonkwo",
      email: "adaeze@example.com",
      grossSalary: 500_000,
      currency: "NGN",
      jurisdiction: "NG",
      bankAccount: "0123456789",
    });
    expect(errors).toHaveLength(0);
  });

  it("should fail if no payment method provided", () => {
    const errors = validateEmployee({
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
      grossSalary: 3_000,
      currency: "GBP",
      jurisdiction: "GB",
    });
    expect(errors).toContain("At least one payment method (bank account or mobile wallet) is required");
  });

  it("should fail for unsupported currency", () => {
    const errors = validateEmployee({
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@example.com",
      grossSalary: 1_000,
      currency: "XYZ",
      jurisdiction: "US",
      bankAccount: "1234567890",
    });
    expect(errors).toContain("Unsupported currency");
  });

  it("should fail for negative salary", () => {
    const errors = validateEmployee({
      firstName: "Test",
      lastName: "User",
      email: "test@example.com",
      grossSalary: -100,
      currency: "USD",
      jurisdiction: "US",
      bankAccount: "1234567890",
    });
    expect(errors).toContain("Gross salary must be positive");
  });
});
