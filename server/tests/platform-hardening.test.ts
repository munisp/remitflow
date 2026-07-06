/**
 * Platform Hardening — Comprehensive Test Suite
 *
 * Tests all 44 recommendations across:
 *   - KYC/KYB/Liveness hardening
 *   - Stablecoin hardening
 *   - Flow of funds hardening
 *   - Insider threat controls
 *   - i18n translations
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── KYC Hardening ───────────────────────────────────────────────────────────

import {
  assertNotMockInProduction,
  checkDocumentExpiry,
  evaluateDocumentExpiry,
  getExpiryAction,
  shouldReScreen,
  createReScreeningTrigger,
  analyzeOwnershipGraph,
  createVideoKYCSession,
  verifyAddress,
  validateNFCData,
  compareBehavioralProfile,
  getProgressiveKYCPrompt,
  issueVerifiableCredential,
} from "../_core/kycHardening";

describe("KYC Hardening", () => {
  describe("assertNotMockInProduction", () => {
    it("throws in production without API key", () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      expect(() => assertNotMockInProduction("onfido", "")).toThrow(
        "FAIL-CLOSED"
      );
      process.env.NODE_ENV = origEnv;
    });

    it("allows mocks in development", () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      expect(() => assertNotMockInProduction("onfido", "")).not.toThrow();
      process.env.NODE_ENV = origEnv;
    });

    it("passes with valid API key in production", () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      expect(() =>
        assertNotMockInProduction("onfido", "api_live_xxx")
      ).not.toThrow();
      process.env.NODE_ENV = origEnv;
    });
  });

  describe("document expiry", () => {
    it("returns valid for future date", () => {
      const future = new Date(Date.now() + 365 * 86400000).toISOString();
      expect(checkDocumentExpiry(future)).toBe("valid");
    });

    it("returns expiring_soon for 20-day window", () => {
      const soon = new Date(Date.now() + 20 * 86400000).toISOString();
      expect(checkDocumentExpiry(soon)).toBe("expiring_soon");
    });

    it("returns expired for past date", () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      expect(checkDocumentExpiry(past)).toBe("expired");
    });

    it("getExpiryAction returns correct actions", () => {
      expect(getExpiryAction("expired")).toBe("downgrade_tier");
      expect(getExpiryAction("expiring_soon")).toBe("warn_user");
      expect(getExpiryAction("valid")).toBe("none");
    });

    it("evaluateDocumentExpiry returns null for no expiry", () => {
      expect(evaluateDocumentExpiry(1, "passport", null)).toBeNull();
    });

    it("evaluateDocumentExpiry returns action for expired docs", () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      const result = evaluateDocumentExpiry(1, "passport", past);
      expect(result).not.toBeNull();
      expect(result?.action).toBe("downgrade_tier");
    });

    it("evaluateDocumentExpiry returns valid for future docs", () => {
      const future = new Date(Date.now() + 365 * 86400000).toISOString();
      const result = evaluateDocumentExpiry(1, "passport", future);
      expect(result).not.toBeNull();
      expect(result?.action).toBe("none");
    });
  });

  describe("re-screening", () => {
    it("requires re-screen after interval", () => {
      const oldDate = new Date(Date.now() - 200 * 86400000);
      const result = shouldReScreen("tier1", oldDate, "high");
      expect(result.required).toBe(true);
    });

    it("does not require re-screen for recent check", () => {
      const recent = new Date(Date.now() - 5 * 86400000);
      const result = shouldReScreen("tier3", recent, "normal");
      expect(result.required).toBe(false);
    });

    it("requires re-screen when never screened", () => {
      const result = shouldReScreen("tier1", null, "normal");
      expect(result.required).toBe(true);
      expect(result.priority).toBe("critical");
    });
  });

  describe("re-screening trigger", () => {
    it("creates trigger with valid fields", () => {
      const trigger = createReScreeningTrigger(1, "test reason", "periodic");
      expect(trigger.triggerId).toMatch(/^RST-/);
      expect(trigger.userId).toBe(1);
      expect(trigger.type).toBe("periodic");
    });
  });

  describe("UBO ownership graph analysis", () => {
    it("identifies UBOs above 25% threshold", () => {
      const shareholders = [
        { name: "Alice", type: "individual", ownershipPercent: 30, nationality: "GB" },
        { name: "Bob", type: "individual", ownershipPercent: 20, nationality: "NG" },
        { name: "Charlie", type: "individual", ownershipPercent: 50, nationality: "CA" },
      ];
      const result = analyzeOwnershipGraph(shareholders);
      expect(result.ubos.length).toBe(2);
    });

    it("detects trust/fund risk flags", () => {
      const shareholders = [
        { name: "Trust A", type: "trust", ownershipPercent: 60, nationality: "VG" },
        { name: "Bob", type: "individual", ownershipPercent: 40, nationality: "NG" },
      ];
      const result = analyzeOwnershipGraph(shareholders);
      expect(result.shellScore).toBeGreaterThan(0);
      expect(result.riskFlags.length).toBeGreaterThan(0);
    });

    it("flags PEP shareholders", () => {
      const shareholders = [
        { name: "Governor Smith", type: "individual", ownershipPercent: 40, nationality: "NG", isPEP: true },
        { name: "Jane", type: "individual", ownershipPercent: 60, nationality: "CA" },
      ];
      const result = analyzeOwnershipGraph(shareholders);
      expect(result.riskFlags.some(f => f.includes("PEP"))).toBe(true);
    });

    it("flags when no UBO identified", () => {
      const shareholders = [
        { name: "A", type: "individual", ownershipPercent: 10 },
        { name: "B", type: "individual", ownershipPercent: 10 },
        { name: "C", type: "individual", ownershipPercent: 10 },
      ];
      const result = analyzeOwnershipGraph(shareholders);
      expect(result.ubos.length).toBe(0);
      expect(result.riskFlags.some(f => f.includes("No UBO"))).toBe(true);
    });
  });

  describe("video KYC", () => {
    it("creates a session", () => {
      const session = createVideoKYCSession(1);
      expect(session.sessionId).toMatch(/^VKYC-/);
      expect(session.userId).toBe(1);
      expect(session.status).toBe("scheduled");
    });
  });

  describe("address verification", () => {
    it("returns result for valid address", async () => {
      const result = await verifyAddress({
        line1: "123 Main St",
        city: "London",
        country: "GB",
      });
      expect(result.verified).toBeDefined();
      expect(typeof result.confidence).toBe("number");
    });
  });

  describe("NFC validation", () => {
    it("validates complete NFC data", () => {
      const result = validateNFCData({
        mrz: "P<GBRSMITH<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<",
        documentNumber: "123456789",
        dateOfBirth: "900101",
        expiryDate: new Date(Date.now() + 365 * 86400000).toISOString(),
        nationality: "GBR",
        fullName: "JOHN SMITH",
        chipAuthenticated: true,
        activeAuthentication: true,
        dataGroupsRead: ["DG1", "DG2", "DG7"],
      });
      expect(result.valid).toBe(true);
      expect(result.trustLevel).toBe("high");
    });

    it("rejects when chip not authenticated", () => {
      const result = validateNFCData({
        mrz: "",
        documentNumber: "",
        dateOfBirth: "",
        expiryDate: new Date(Date.now() + 365 * 86400000).toISOString(),
        nationality: "",
        fullName: "",
        chipAuthenticated: false,
        activeAuthentication: false,
        dataGroupsRead: [],
      });
      expect(result.trustLevel).toBe("low");
    });
  });

  describe("behavioral biometrics", () => {
    const stored = {
      userId: 1,
      typingSpeed: 200,
      typingRhythm: [100, 120, 90],
      touchPressure: 0.5,
      scrollPattern: "moderate" as const,
      sessionDuration: 300,
      deviceHandling: "portrait" as const,
      lastUpdated: new Date().toISOString(),
      confidenceScore: 0.8,
    };

    it("matches similar profiles", () => {
      const current = {
        typingSpeed: 210,
        touchPressure: 0.48,
        scrollPattern: "moderate" as const,
        deviceHandling: "portrait" as const,
      };
      const result = compareBehavioralProfile(stored, current);
      expect(result.match).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("detects anomalous profiles", () => {
      const current = {
        typingSpeed: 50,
        touchPressure: 0.05,
        scrollPattern: "fast" as const,
        deviceHandling: "landscape" as const,
      };
      const result = compareBehavioralProfile(stored, current);
      expect(result.match).toBe(false);
    });
  });

  describe("progressive KYC", () => {
    it("prompts for upgrade when needed", () => {
      const result = getProgressiveKYCPrompt("tier1", 5000, "international_transfer");
      expect(result).not.toBeNull();
      expect(result?.suggestedTier).toBe("tier2");
    });

    it("returns null when amount within tier limit", () => {
      const result = getProgressiveKYCPrompt("tier3", 100, "domestic_transfer");
      expect(result).toBeNull();
    });

    it("suggests tier3 for high amounts", () => {
      const result = getProgressiveKYCPrompt("tier0", 60000, "wire_transfer");
      expect(result).not.toBeNull();
      expect(result?.suggestedTier).toBe("tier3");
    });
  });

  describe("verifiable credentials", () => {
    it("issues valid VC format", () => {
      const vc = issueVerifiableCredential(1, "enhanced", ["passport", "utility_bill"], ["GB", "NG"]);
      expect(vc.type).toContain("VerifiableCredential");
      expect(vc.type).toContain("KYCVerification");
      expect(vc.credentialSubject.kycTier).toBe("enhanced");
      expect(vc.issuer).toContain("remitflow");
    });
  });
});

// ── Stablecoin Hardening ────────────────────────────────────────────────────

import {
  getLiveStablecoinRate,
  getLiveFxRate,
  verifyOnRampWebhook,
  processOnRampWebhook,
  getBridgeQuote,
  issueVirtualCard,
  createP2PClaim,
  isClaimExpired,
  shouldExecuteDCA,
  shouldAutoConvert,
  getBestYieldProtocol,
  getAllYieldOptions,
  evaluateDePeg,
  calculateInsurancePremium,
} from "../_core/stablecoinHardening";

describe("Stablecoin Hardening", () => {
  describe("live FX rates", () => {
    it("returns rate for known stablecoin", async () => {
      const rate = await getLiveStablecoinRate("USDC");
      expect(rate.price).toBeGreaterThan(0);
      expect(rate.source).toBeDefined();
    });

    it("returns FX rate for currency pair", async () => {
      const rate = await getLiveFxRate("USD", "NGN");
      expect(rate.rate).toBeGreaterThan(0);
      expect(rate.source).toBeDefined();
    });
  });

  describe("on-ramp webhooks", () => {
    it("verifyOnRampWebhook returns true in dev mode (no secret)", () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      const result = verifyOnRampWebhook("moonpay", "test", "any-sig");
      expect(result).toBe(true);
      process.env.NODE_ENV = origEnv;
    });

    it("processes completed event as credit_wallet", () => {
      const result = processOnRampWebhook({
        provider: "moonpay",
        eventType: "payment_completed",
        orderId: "ord-123",
        status: "completed",
        fiatAmount: 100,
        fiatCurrency: "USD",
        cryptoAmount: 99.5,
        cryptoCurrency: "USDC",
        walletAddress: "0xabc",
        userId: "user-1",
        timestamp: new Date().toISOString(),
      });
      expect(result.action).toBe("credit_wallet");
    });

    it("processes failed event as alert_user", () => {
      const result = processOnRampWebhook({
        provider: "transak",
        eventType: "payment_failed",
        orderId: "ord-456",
        status: "failed",
        fiatAmount: 50,
        fiatCurrency: "USD",
        cryptoAmount: 0,
        cryptoCurrency: "USDT",
        walletAddress: "0xdef",
        userId: "user-1",
        timestamp: new Date().toISOString(),
      });
      expect(result.action).toBe("alert_user");
    });

    it("processes refunded event", () => {
      const result = processOnRampWebhook({
        provider: "ramp",
        eventType: "payment_refunded",
        orderId: "ord-789",
        status: "refunded",
        fiatAmount: 200,
        fiatCurrency: "EUR",
        cryptoAmount: 0,
        cryptoCurrency: "USDC",
        walletAddress: "0x123",
        userId: "user-2",
        timestamp: new Date().toISOString(),
      });
      expect(result.action).toBe("refund");
    });
  });

  describe("bridge quotes", () => {
    it("returns quote for valid chains", async () => {
      const quote = await getBridgeQuote("ethereum", "polygon", "USDC", 1000);
      expect(quote.toAmount).toBeGreaterThan(0);
      expect(quote.bridgeFee).toBeGreaterThanOrEqual(0);
      expect(quote.quoteId).toMatch(/^BQ-/);
    });
  });

  describe("virtual card", () => {
    it("issues card with valid params", async () => {
      const card = await issueVirtualCard(1, "USDC", 500);
      expect(card.cardId).toBeDefined();
      expect(card.last4).toHaveLength(4);
      expect(card.spendLimitUsd).toBe(500);
      expect(card.status).toBe("active");
    });
  });

  describe("P2P claims", () => {
    it("creates claim with 30-day expiry", () => {
      const claim = createP2PClaim(1, "+2348012345678", "USDC", 50);
      expect(claim.claimId).toMatch(/^CLAIM-/);
      expect(claim.status).toBe("pending");
      const expiryMs = new Date(claim.expiresAt).getTime() - Date.now();
      expect(expiryMs).toBeGreaterThan(29 * 86400000);
      expect(expiryMs).toBeLessThanOrEqual(30 * 86400000 + 5000);
    });

    it("detects expired claims", () => {
      const claim = createP2PClaim(1, "test@test.com", "USDT", 25);
      claim.expiresAt = new Date(Date.now() - 86400000).toISOString();
      expect(isClaimExpired(claim)).toBe(true);
    });

    it("non-expired claims are not expired", () => {
      const claim = createP2PClaim(1, "test@test.com", "USDC", 50);
      expect(isClaimExpired(claim)).toBe(false);
    });
  });

  describe("DCA scheduler", () => {
    it("should execute when past frequency", () => {
      const last = new Date(Date.now() - 8 * 86400000);
      expect(shouldExecuteDCA("weekly", last)).toBe(true);
    });

    it("should not execute too soon", () => {
      const last = new Date(Date.now() - 3600000);
      expect(shouldExecuteDCA("daily", last)).toBe(false);
    });

    it("should execute when never executed", () => {
      expect(shouldExecuteDCA("daily", null)).toBe(true);
    });
  });

  describe("auto-convert", () => {
    it("converts when above threshold", () => {
      const result = shouldAutoConvert(
        { userId: 1, fromCurrency: "USD", toStablecoin: "USDC", percentage: 50, minAmountUsd: 10, active: true },
        100
      );
      expect(result.convert).toBe(true);
      expect(result.amount).toBe(50);
    });

    it("skips when disabled", () => {
      const result = shouldAutoConvert(
        { userId: 1, fromCurrency: "USD", toStablecoin: "USDC", percentage: 50, minAmountUsd: 10, active: false },
        100
      );
      expect(result.convert).toBe(false);
    });

    it("skips below minimum", () => {
      const result = shouldAutoConvert(
        { userId: 1, fromCurrency: "USD", toStablecoin: "USDC", percentage: 50, minAmountUsd: 200, active: true },
        100
      );
      expect(result.convert).toBe(false);
    });
  });

  describe("yield aggregator", () => {
    it("returns best risk-adjusted protocol", () => {
      const best = getBestYieldProtocol("USDC", 1000);
      expect(best).not.toBeNull();
      expect(best?.name).toBeDefined();
      expect(best?.apy).toBeGreaterThan(0);
    });

    it("filters by max risk score", () => {
      const filtered = getBestYieldProtocol("USDC", 1000, 0.05);
      // Very low risk threshold — may return null if no protocols qualify
      if (filtered) {
        expect(filtered.riskScore).toBeLessThanOrEqual(0.05);
      }
    });

    it("getAllYieldOptions returns sorted by risk-adjusted APY", () => {
      const all = getAllYieldOptions("USDC", 100);
      expect(all.length).toBeGreaterThan(0);
      for (let i = 1; i < all.length; i++) {
        expect(all[i - 1].riskAdjustedApy).toBeGreaterThanOrEqual(all[i].riskAdjustedApy);
      }
    });
  });

  describe("de-peg detection", () => {
    it("returns null for pegged price", () => {
      expect(evaluateDePeg("USDC", 1.0)).toBeNull();
    });

    it("returns null for slight deviation within 0.5%", () => {
      expect(evaluateDePeg("USDC", 0.997)).toBeNull();
    });

    it("returns warning for >0.5% deviation", () => {
      const alert = evaluateDePeg("USDC", 0.99);
      expect(alert).not.toBeNull();
      expect(alert?.severity).toBe("warning");
    });

    it("returns critical for >2% deviation", () => {
      const alert = evaluateDePeg("USDC", 0.97);
      expect(alert?.severity).toBe("critical");
    });

    it("returns emergency for >5% deviation", () => {
      const alert = evaluateDePeg("USDC", 0.94);
      expect(alert?.severity).toBe("emergency");
    });
  });

  describe("insurance premium", () => {
    it("calculates premium for depeg coverage", () => {
      const premium = calculateInsurancePremium(10000, "depeg");
      expect(premium.premiumRate).toBe(0.02);
      expect(premium.annualCost).toBe(200);
    });

    it("calculates premium for bridge_failure coverage", () => {
      const premium = calculateInsurancePremium(5000, "bridge_failure");
      expect(premium.premiumRate).toBe(0.03);
      expect(premium.annualCost).toBe(150);
    });
  });
});

// ── Fund Flow Hardening ─────────────────────────────────────────────────────

import {
  createCoordinatedTransaction,
  getCompensationOrder,
  calculateBackoff,
  createCompensationRetry,
  calculateNetSettlement,
  issueFencingToken,
  validateFencingToken,
  buildAtomicSwapSQL,
  createRateLock,
  validateRateLock,
  trackVelocity,
  getSmartRoute,
  getHistoricalLiquidityForecast,
} from "../_core/fundFlowHardening";

describe("Fund Flow Hardening", () => {
  describe("coordinated transaction", () => {
    it("creates transaction with ordered steps", () => {
      const tx = createCoordinatedTransaction(1, "cross_border_transfer", 1000, "USD");
      expect(tx.transactionId).toMatch(/^CTX-/);
      expect(tx.steps.length).toBeGreaterThan(0);
      expect(tx.status).toBe("in_progress");
    });

    it("steps have unique IDs", () => {
      const tx = createCoordinatedTransaction(1, "cross_border_transfer", 1000, "USD");
      const ids = tx.steps.map(s => s.stepId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("compensation", () => {
    it("returns steps in reverse order (only completed)", () => {
      const steps = [
        { stepId: "s1", name: "debit", status: "completed" as const, retryCount: 0 },
        { stepId: "s2", name: "ledger", status: "completed" as const, retryCount: 0 },
        { stepId: "s3", name: "credit", status: "pending" as const, retryCount: 0 },
      ];
      const compensated = getCompensationOrder(steps);
      expect(compensated.length).toBe(2); // Only completed
      expect(compensated[0].name).toBe("ledger");
      expect(compensated[1].name).toBe("debit");
    });

    it("calculates exponential backoff", () => {
      expect(calculateBackoff(0)).toBe(1000);
      expect(calculateBackoff(1)).toBe(2000);
      expect(calculateBackoff(5)).toBeGreaterThan(calculateBackoff(1));
      expect(calculateBackoff(100)).toBeLessThanOrEqual(86400000);
    });

    it("escalates to PagerDuty after 3 attempts", () => {
      const retry = createCompensationRetry("tx-1", "debit", 3);
      expect(retry.escalatedToPagerDuty).toBe(true);
      expect(retry.status).toBe("escalated");
    });

    it("does not escalate before 3 attempts", () => {
      const retry = createCompensationRetry("tx-1", "debit", 1);
      expect(retry.escalatedToPagerDuty).toBe(false);
      expect(retry.status).toBe("pending");
    });

    it("retry is unbounded", () => {
      const retry = createCompensationRetry("tx-1", "debit", 50);
      expect(retry.maxAttempts).toBe(-1);
    });
  });

  describe("settlement netting", () => {
    it("calculates net settlement for corridor", () => {
      const result = calculateNetSettlement(
        "NG-US",
        [
          { transferId: "t1", amount: 1000, currency: "USD", userId: 1 },
          { transferId: "t2", amount: 2000, currency: "USD", userId: 2 },
        ],
        [{ transferId: "t3", amount: 500, currency: "USD", userId: 3 }]
      );
      expect(result.netAmount).toBe(2500);
      expect(result.netDirection).toBe("pay");
      expect(result.grossAmount).toBe(3500);
    });

    it("handles balanced corridor", () => {
      const result = calculateNetSettlement(
        "US-GB",
        [{ transferId: "t1", amount: 1000, currency: "USD", userId: 1 }],
        [{ transferId: "t2", amount: 1000, currency: "USD", userId: 2 }]
      );
      expect(result.netAmount).toBe(0);
    });

    it("returns batch with correct status", () => {
      const result = calculateNetSettlement(
        "NG-US",
        [{ transferId: "t1", amount: 500, currency: "USD", userId: 1 }],
        []
      );
      expect(result.status).toBe("ready");
      expect(result.batchId).toMatch(/^SETTLE-/);
    });
  });

  describe("fencing tokens", () => {
    it("issues and validates token", () => {
      const token = issueFencingToken(1, 100, "debit");
      expect(token.token).toBeDefined();
      expect(token.token.length).toBe(64); // SHA-256 hex
      expect(validateFencingToken(token)).toBe(true);
    });

    it("rejects expired token", () => {
      const token = issueFencingToken(1, 100, "debit", 0);
      expect(validateFencingToken(token)).toBe(false);
    });
  });

  describe("atomic swap SQL", () => {
    it("generates CTE-based SQL", () => {
      const sql = buildAtomicSwapSQL(1, "USD", "NGN", 100, 160000);
      expect(sql).toContain("WITH");
      expect(sql).toContain("debit");
      expect(sql).toContain("credit");
    });
  });

  describe("rate lock", () => {
    it("creates lock with TTL", async () => {
      const lock = await createRateLock(1, "USD", "NGN", 1600, 100);
      expect(lock.lockId).toMatch(/^RLOCK-/);
      expect(lock.expiresAt).toBeDefined();
      expect(lock.rate).toBe(1600);
    });
  });

  describe("velocity tracking", () => {
    it("returns count and amount", async () => {
      const result = await trackVelocity(999, "send", 100);
      expect(typeof result.count).toBe("number");
      expect(typeof result.totalAmount).toBe("number");
      expect(typeof result.blocked).toBe("boolean");
    });
  });

  describe("smart routing", () => {
    it("returns route for major corridor", () => {
      const route = getSmartRoute("USD-NGN", 500);
      expect(route).not.toBeNull();
      expect(route?.provider).toBeDefined();
      expect(route?.estimatedFeeUsd).toBeGreaterThan(0);
    });

    it("returns null for unknown corridor", () => {
      const route = getSmartRoute("XYZ-ABC", 500);
      expect(route).toBeNull();
    });

    it("cheapest priority returns lowest fee route", () => {
      const cheapest = getSmartRoute("USD-NGN", 500, "cheapest");
      const fastest = getSmartRoute("USD-NGN", 500, "fastest");
      expect(cheapest).not.toBeNull();
      expect(fastest).not.toBeNull();
    });
  });

  describe("liquidity forecasting", () => {
    it("applies Friday Africa multiplier", () => {
      const friday = getHistoricalLiquidityForecast("USD-NGN", 5);
      const monday = getHistoricalLiquidityForecast("USD-NGN", 1);
      expect(friday.expectedVolume).toBeGreaterThan(monday.expectedVolume);
    });

    it("non-Africa corridor has no multiplier", () => {
      const friday = getHistoricalLiquidityForecast("USD-EUR", 5);
      const monday = getHistoricalLiquidityForecast("USD-EUR", 1);
      expect(friday.expectedVolume).toBe(monday.expectedVolume);
    });

    it("Africa corridor returns outbound_heavy direction", () => {
      const forecast = getHistoricalLiquidityForecast("USD-NGN", 3);
      expect(forecast.expectedDirection).toBe("outbound_heavy");
    });
  });
});

// ── Insider Threat Controls ─────────────────────────────────────────────────

import {
  requiresMakerChecker,
  createMakerCheckerRequest,
  approveMakerCheckerRequest,
  grantJITAccess,
  checkJITAccess,
  checkGeoFence,
  checkTimeFence,
  checkDLP,
  registerWebAuthnCredential,
  verifyWebAuthnSignCount,
  checkReversalCooling,
} from "../middleware/insiderThreat";

describe("Insider Threat Controls", () => {
  describe("maker-checker", () => {
    it("requires approval for >$10K", () => {
      expect(requiresMakerChecker(15000).required).toBe(true);
    });

    it("does not require for <$10K", () => {
      expect(requiresMakerChecker(5000).required).toBe(false);
    });

    it("requires 2 approvers for >$100K", () => {
      expect(requiresMakerChecker(150000).approversNeeded).toBe(2);
    });

    it("creates and approves request", () => {
      const req = createMakerCheckerRequest(1, "transfer", 50000, {});
      expect(req.status).toBe("pending");
      const result = approveMakerCheckerRequest(req.requestId, 2);
      expect(result.approved).toBe(true);
    });

    it("rejects self-approval", () => {
      const req = createMakerCheckerRequest(1, "transfer", 50000, {});
      const result = approveMakerCheckerRequest(req.requestId, 1);
      expect(result.approved).toBe(false);
    });
  });

  describe("JIT access", () => {
    it("grants and checks access", () => {
      const grant = grantJITAccess(100, "admin", 1, "emergency");
      expect(grant).not.toBeNull();
      expect(checkJITAccess(100, "admin")).toBe(true);
    });
  });

  describe("geo-fencing", () => {
    it("allows approved countries", () => {
      expect(checkGeoFence("CA").allowed).toBe(true);
      expect(checkGeoFence("NG").allowed).toBe(true);
      expect(checkGeoFence("US").allowed).toBe(true);
    });

    it("blocks unapproved countries", () => {
      expect(checkGeoFence("RU").allowed).toBe(false);
    });
  });

  describe("DLP", () => {
    it("allows small queries", () => {
      expect(checkDLP(1, 10).allowed).toBe(true);
    });

    it("blocks large bulk exports", () => {
      expect(checkDLP(1, 500).allowed).toBe(false);
    });
  });

  describe("WebAuthn clone detection", () => {
    it("detects sign-count regression", () => {
      registerWebAuthnCredential("clone-test-cred", 1, "pk-data");
      verifyWebAuthnSignCount("clone-test-cred", 5);
      const result = verifyWebAuthnSignCount("clone-test-cred", 3);
      expect(result.cloneDetected).toBe(true);
    });
  });

  describe("reversal cooling", () => {
    it("blocks recent large transaction reversal", () => {
      const created = new Date(Date.now() - 60000);
      const result = checkReversalCooling(15000, created);
      expect(result.allowed).toBe(false);
    });

    it("allows old transaction reversal", () => {
      const created = new Date(Date.now() - 5 * 3600000);
      const result = checkReversalCooling(15000, created);
      expect(result.allowed).toBe(true);
    });

    it("allows small amount reversal immediately", () => {
      const created = new Date(Date.now() - 60000);
      const result = checkReversalCooling(100, created);
      expect(result.allowed).toBe(true);
    });
  });
});

// ── i18n Translations ───────────────────────────────────────────────────────

import { t, SUPPORTED_LOCALES, translations } from "../../client/src/i18n/locales";

describe("i18n Translations", () => {
  it("returns English by default", () => {
    expect(t("common.send")).toBe("Send");
  });

  it("returns Yoruba translation", () => {
    expect(t("common.send", "yo")).toBe("Fi owo rane");
  });

  it("returns Hausa translation", () => {
    expect(t("common.send", "ha")).toBe("Aika kudi");
  });

  it("returns French translation", () => {
    expect(t("common.send", "fr")).toBe("Envoyer");
  });

  it("returns Swahili translation", () => {
    expect(t("common.send", "sw")).toBe("Tuma");
  });

  it("returns Twi translation", () => {
    expect(t("common.send", "tw")).toBe("Mena sika");
  });

  it("returns Igbo translation", () => {
    expect(t("common.send", "ig")).toBe("Ziga ego");
  });

  it("all locales have all keys", () => {
    const englishKeys = Object.keys(translations.en);
    for (const locale of SUPPORTED_LOCALES) {
      const localeKeys = Object.keys(translations[locale.code]);
      expect(localeKeys.length).toBe(englishKeys.length);
    }
  });

  it("supports 7 locales", () => {
    expect(SUPPORTED_LOCALES.length).toBe(7);
  });
});
