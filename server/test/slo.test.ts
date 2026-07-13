/**
 * RemitFlow — SLO Tracker Unit Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  calculateErrorBudget,
  recordSLOEvent,
  getSLOStatus,
  getAllSLOStatuses,
  SLO_DEFINITIONS,
} from "../telemetry/slo";

describe("SLO Tracker", () => {
  describe("calculateErrorBudget", () => {
    it("returns healthy status when success rate equals target", () => {
      const budget = calculateErrorBudget("transfer_availability", 0.9995, 30 * 24 * 60);
      expect(budget.status).toBe("healthy");
      expect(budget.consumedMinutes).toBeCloseTo(0, 1);
      expect(budget.remainingPercent).toBeCloseTo(100, 1);
    });

    it("returns healthy status when success rate exceeds target", () => {
      const budget = calculateErrorBudget("transfer_availability", 0.9999, 30 * 24 * 60);
      expect(budget.status).toBe("healthy");
      expect(budget.remainingPercent).toBeGreaterThan(100);
    });

    it("returns exhausted status when success rate is far below target", () => {
      const budget = calculateErrorBudget("transfer_availability", 0.990, 30 * 24 * 60);
      expect(budget.status).toBe("exhausted");
      expect(budget.remainingMinutes).toBe(0);
    });

    it("calculates correct allowed downtime for 99.95% SLO over 30 days", () => {
      const windowMinutes = 30 * 24 * 60; // 43,200 minutes
      const budget = calculateErrorBudget("transfer_availability", 0.9995, windowMinutes);
      // 0.05% of 43,200 = 21.6 minutes allowed downtime
      expect(budget.allowedDowntimeMinutes).toBeCloseTo(21.6, 1);
    });

    it("calculates burn rate correctly", () => {
      // Consuming 5x the allowed downtime
      const windowMinutes = 30 * 24 * 60;
      const allowedFailureRate = 1 - 0.9995; // 0.0005
      const actualFailureRate = allowedFailureRate * 5; // 5x burn
      const successRate = 1 - actualFailureRate;
      const budget = calculateErrorBudget("transfer_availability", successRate, windowMinutes);
      expect(budget.burnRate).toBeCloseTo(5, 1);
    });

    it("returns critical status at 5x burn rate", () => {
      const windowMinutes = 30 * 24 * 60;
      const allowedFailureRate = 1 - 0.9995;
      const actualFailureRate = allowedFailureRate * 5.1;
      const budget = calculateErrorBudget("transfer_availability", 1 - actualFailureRate, windowMinutes);
      expect(budget.status).toBe("critical");
    });

    it("throws error for unknown SLO name", () => {
      expect(() => calculateErrorBudget("nonexistent_slo", 0.99, 1000)).toThrow("Unknown SLO");
    });
  });

  describe("SLO_DEFINITIONS", () => {
    it("defines all required SLOs", () => {
      expect(SLO_DEFINITIONS).toHaveProperty("transfer_availability");
      expect(SLO_DEFINITIONS).toHaveProperty("transfer_latency_p99");
      expect(SLO_DEFINITIONS).toHaveProperty("kyc_submission_latency");
      expect(SLO_DEFINITIONS).toHaveProperty("fx_rate_freshness");
      expect(SLO_DEFINITIONS).toHaveProperty("platform_availability");
    });

    it("transfer_availability target is 99.95%", () => {
      expect(SLO_DEFINITIONS.transfer_availability.target).toBe(0.9995);
    });

    it("platform_availability target is 99.99%", () => {
      expect(SLO_DEFINITIONS.platform_availability.target).toBe(0.9999);
    });

    it("all SLOs have positive alert thresholds", () => {
      for (const slo of Object.values(SLO_DEFINITIONS)) {
        expect(slo.alertThreshold).toBeGreaterThan(0);
      }
    });
  });

  describe("recordSLOEvent and getSLOStatus", () => {
    it("records good events and reflects in success rate", () => {
      // Record 100 good events
      for (let i = 0; i < 100; i++) {
        recordSLOEvent("transfer_availability", true);
      }
      const status = getSLOStatus("transfer_availability");
      expect(status.good).toBeGreaterThanOrEqual(100);
      expect(status.successRate).toBeGreaterThan(0);
    });

    it("records bad events and reduces success rate", () => {
      // Record 99 good + 1 bad
      for (let i = 0; i < 99; i++) {
        recordSLOEvent("fx_rate_freshness", true);
      }
      recordSLOEvent("fx_rate_freshness", false);

      const status = getSLOStatus("fx_rate_freshness");
      expect(status.total).toBeGreaterThanOrEqual(100);
      expect(status.successRate).toBeLessThan(1.0);
    });
  });

  describe("getAllSLOStatuses", () => {
    it("returns status for all defined SLOs", () => {
      const statuses = getAllSLOStatuses();
      for (const sloName of Object.keys(SLO_DEFINITIONS)) {
        expect(statuses).toHaveProperty(sloName);
        expect(statuses[sloName]).toHaveProperty("successRate");
        expect(statuses[sloName]).toHaveProperty("budget");
      }
    });
  });
});
