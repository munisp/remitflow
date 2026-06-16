/**
 * Fee Transparency Business Logic Tests
 * Tests: fee breakdown calculation, delivery options, competitor savings
 */
import { describe, it, expect } from "vitest";
import { calculateFeeBreakdown, getDeliveryOptions } from "../lib/feeTransparency";

describe("Fee Transparency — calculateFeeBreakdown", () => {
  it("should compute total fee as baseFee + fxMarkup + networkFee", () => {
    const result = calculateFeeBreakdown(500, "USD", "NGN", 2.5, 1600, 1584);
    expect(result.transferFee).toBe(2.5);
    expect(result.fxMarkup).toBeGreaterThan(0);
    expect(result.networkFee).toBe(0.5); // amount <= 1000 → $0.50
    expect(result.totalFee).toBe(
      result.transferFee + result.fxMarkup + result.networkFee
    );
  });

  it("should waive network fee for transfers > $1000", () => {
    const result = calculateFeeBreakdown(2000, "USD", "NGN", 3.0, 1600, 1584);
    expect(result.networkFee).toBe(0);
  });

  it("should charge $0.50 network fee for transfers <= $1000", () => {
    const result = calculateFeeBreakdown(1000, "GBP", "NGN", 2.0, 2080, 2060);
    expect(result.networkFee).toBe(0.5);
  });

  it("should calculate FX markup percentage correctly", () => {
    // mid=1600, applied=1584 → markup = |16|/1600 = 1%
    const result = calculateFeeBreakdown(1000, "USD", "NGN", 2.0, 1600, 1584);
    expect(result.fxMarkupPct).toBe(1);
    expect(result.fxMarkup).toBe(10); // 1000 * 0.01
  });

  it("should compute total cost as amount + totalFee", () => {
    const result = calculateFeeBreakdown(500, "USD", "NGN", 2.5, 1600, 1600);
    expect(result.totalCost).toBe(500 + result.totalFee);
  });

  it("should compute savings vs competitor using corridor-specific rates", () => {
    // USD-NGN competitor avg = 4.5%
    const result = calculateFeeBreakdown(1000, "USD", "NGN", 2.0, 1600, 1600);
    // Our fee: baseFee + fxMarkup + networkFee
    // Competitor: amount * competitorRate
    expect(result.savingsVsCompetitor).toBeGreaterThanOrEqual(0);
    expect(typeof result.savingsPct).toBe("number");
  });

  it("should use default competitor rate for unknown corridor", () => {
    const result = calculateFeeBreakdown(1000, "CHF", "ZAR", 3.0, 18.5, 18.5);
    // Default competitor = 5%
    expect(result.savingsVsCompetitor).toBeGreaterThanOrEqual(0);
    expect(typeof result.savingsPct).toBe("number");
  });

  it("should handle zero FX markup (mid == applied)", () => {
    const result = calculateFeeBreakdown(500, "USD", "NGN", 2.0, 1600, 1600);
    expect(result.fxMarkup).toBe(0);
    expect(result.fxMarkupPct).toBe(0);
  });

  it("should preserve mid and applied rate in output", () => {
    const result = calculateFeeBreakdown(100, "EUR", "NGN", 1.5, 1750, 1732.5);
    expect(result.midMarketRate).toBe(1750);
    expect(result.appliedRate).toBe(1732.5);
  });

  it("should round all money values to 2 decimal places", () => {
    const result = calculateFeeBreakdown(333, "USD", "KES", 1.99, 150.123, 148.999);
    const decimals = (n: number) => {
      const s = n.toString();
      const dot = s.indexOf(".");
      return dot === -1 ? 0 : s.length - dot - 1;
    };
    expect(decimals(result.transferFee)).toBeLessThanOrEqual(2);
    expect(decimals(result.fxMarkup)).toBeLessThanOrEqual(2);
    expect(decimals(result.totalFee)).toBeLessThanOrEqual(2);
    expect(decimals(result.totalCost)).toBeLessThanOrEqual(2);
  });
});

describe("Fee Transparency — getDeliveryOptions", () => {
  it("should return instant, standard, economy options for known corridor", () => {
    const options = getDeliveryOptions("USD", "NGN", 2.0);
    expect(options).toHaveLength(3);
    expect(options.map(o => o.speed)).toEqual(["instant", "standard", "economy"]);
  });

  it("should add surcharge to instant delivery", () => {
    const options = getDeliveryOptions("USD", "NGN", 2.0);
    const instant = options.find(o => o.speed === "instant")!;
    const standard = options.find(o => o.speed === "standard")!;
    expect(instant.additionalFee).toBeGreaterThan(standard.additionalFee);
  });

  it("should set economy as cheapest option", () => {
    const options = getDeliveryOptions("GBP", "NGN", 3.0);
    const economy = options.find(o => o.speed === "economy")!;
    // Economy has a discount (negative additionalFee)
    expect(economy.additionalFee).toBeLessThanOrEqual(0);
    expect(economy.totalFee).toBeLessThan(options.find(o => o.speed === "instant")!.totalFee);
  });

  it("should return delivery times in minutes", () => {
    const options = getDeliveryOptions("USD", "KES", 2.0);
    const instant = options.find(o => o.speed === "instant")!;
    expect(instant.estimatedMinutes).toBe(5); // USD-KES instant = 5 min
  });

  it("should use default speeds for unknown corridor", () => {
    const options = getDeliveryOptions("CHF", "ZAR", 1.0);
    expect(options).toHaveLength(3);
    const instant = options.find(o => o.speed === "instant")!;
    expect(instant.estimatedMinutes).toBe(15); // default instant = 15 min
  });
});
