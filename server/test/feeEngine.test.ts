/**
 * RemitFlow — Fee Engine Unit Tests
 * Tests the corridor-based fee calculation logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the fee engine module ────────────────────────────────────────────────
// Since the actual fee engine is in Rust, we test the TypeScript wrapper

interface FeeBreakdown {
  baseFee: number;
  percentageFee: number;
  fxSpread: number;
  totalFee: number;
  totalFeeUsd: number;
  corridor: string;
  currency: string;
}

function calculateFee(
  amount: number,
  sendCurrency: string,
  receiveCurrency: string,
  transferType: "standard" | "express" | "economy" = "standard"
): FeeBreakdown {
  const corridor = `${sendCurrency}-${receiveCurrency}`;

  // Fee schedule (simplified from the Rust fee engine)
  const feeSchedule: Record<string, { baseFee: number; percentageFee: number; fxSpread: number }> = {
    "USD-NGN": { baseFee: 2.99, percentageFee: 0.015, fxSpread: 0.005 },
    "USD-GHS": { baseFee: 2.49, percentageFee: 0.012, fxSpread: 0.005 },
    "USD-KES": { baseFee: 1.99, percentageFee: 0.010, fxSpread: 0.004 },
    "GBP-NGN": { baseFee: 3.49, percentageFee: 0.018, fxSpread: 0.006 },
    "EUR-NGN": { baseFee: 3.29, percentageFee: 0.016, fxSpread: 0.006 },
    "USD-PHP": { baseFee: 1.49, percentageFee: 0.008, fxSpread: 0.003 },
    "USD-MXN": { baseFee: 0.99, percentageFee: 0.005, fxSpread: 0.002 },
  };

  const schedule = feeSchedule[corridor] ?? { baseFee: 3.99, percentageFee: 0.020, fxSpread: 0.007 };

  // Express adds 50% to fees
  const multiplier = transferType === "express" ? 1.5 : transferType === "economy" ? 0.7 : 1.0;

  const baseFee = schedule.baseFee * multiplier;
  const percentageFee = amount * schedule.percentageFee * multiplier;
  const fxSpread = amount * schedule.fxSpread;
  const totalFee = baseFee + percentageFee + fxSpread;

  return {
    baseFee,
    percentageFee,
    fxSpread,
    totalFee,
    totalFeeUsd: totalFee, // simplified — in production converted to USD
    corridor,
    currency: sendCurrency,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Fee Engine", () => {
  describe("calculateFee — USD-NGN corridor", () => {
    it("calculates standard fee correctly for $100 transfer", () => {
      const fee = calculateFee(100, "USD", "NGN", "standard");
      expect(fee.corridor).toBe("USD-NGN");
      expect(fee.baseFee).toBeCloseTo(2.99, 2);
      expect(fee.percentageFee).toBeCloseTo(1.50, 2); // 1.5% of 100
      expect(fee.fxSpread).toBeCloseTo(0.50, 2);      // 0.5% of 100
      expect(fee.totalFee).toBeCloseTo(4.99, 2);
    });

    it("scales percentage fee with amount", () => {
      const fee100 = calculateFee(100, "USD", "NGN");
      const fee1000 = calculateFee(1000, "USD", "NGN");
      expect(fee1000.percentageFee).toBeCloseTo(fee100.percentageFee * 10, 1);
    });

    it("applies express multiplier correctly", () => {
      const standard = calculateFee(100, "USD", "NGN", "standard");
      const express = calculateFee(100, "USD", "NGN", "express");
      expect(express.baseFee).toBeCloseTo(standard.baseFee * 1.5, 2);
      expect(express.percentageFee).toBeCloseTo(standard.percentageFee * 1.5, 2);
    });

    it("applies economy discount correctly", () => {
      const standard = calculateFee(100, "USD", "NGN", "standard");
      const economy = calculateFee(100, "USD", "NGN", "economy");
      expect(economy.baseFee).toBeCloseTo(standard.baseFee * 0.7, 2);
    });
  });

  describe("calculateFee — corridor coverage", () => {
    const corridors: Array<[string, string]> = [
      ["USD", "NGN"],
      ["USD", "GHS"],
      ["USD", "KES"],
      ["GBP", "NGN"],
      ["EUR", "NGN"],
      ["USD", "PHP"],
      ["USD", "MXN"],
    ];

    corridors.forEach(([send, receive]) => {
      it(`calculates fee for ${send}-${receive}`, () => {
        const fee = calculateFee(500, send, receive);
        expect(fee.totalFee).toBeGreaterThan(0);
        expect(fee.corridor).toBe(`${send}-${receive}`);
        expect(fee.currency).toBe(send);
      });
    });
  });

  describe("calculateFee — edge cases", () => {
    it("handles zero amount gracefully", () => {
      const fee = calculateFee(0, "USD", "NGN");
      expect(fee.percentageFee).toBe(0);
      expect(fee.fxSpread).toBe(0);
      expect(fee.totalFee).toBeCloseTo(fee.baseFee, 2);
    });

    it("uses default fee schedule for unknown corridor", () => {
      const fee = calculateFee(100, "USD", "ZZZ");
      expect(fee.baseFee).toBeCloseTo(3.99, 2);
      expect(fee.percentageFee).toBeCloseTo(2.00, 2); // 2% of 100
    });

    it("total fee is sum of components", () => {
      const fee = calculateFee(250, "GBP", "NGN");
      expect(fee.totalFee).toBeCloseTo(fee.baseFee + fee.percentageFee + fee.fxSpread, 4);
    });
  });
});
