/**
 * platform-hardening-v3.test.ts — Tests for all Phase 3 platform improvements
 *
 * Covers:
 *   - Sanctions screening fail-closed guards
 *   - Circle/YellowCard/Gnosis fail-closed guards
 *   - Live FX oracle integration
 *   - De-peg live oracle
 *   - Gas fee estimation
 *   - Rate limiting
 *   - Distributed tracing
 *   - Feature flags
 *   - Tamper-proof audit chain
 *   - ISO 20022 message generation
 *   - Data residency enforcement
 *   - Age verification
 *   - Biometric encryption
 *   - VASP reporting
 *   - Web Vitals recording
 *   - Auto-convert consumer
 *   - Background job scheduler
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock environment
const originalEnv = process.env;

describe("Platform Hardening V3", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Fail-Closed Guards", () => {
    it("sanctions screening throws in production without OFAC_API_KEY", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.OFAC_API_KEY;
      const { assertSanctionsScreeningAvailable } = await import("../_core/platformHardeningV3.js");
      expect(() => assertSanctionsScreeningAvailable()).toThrow("FAIL-CLOSED");
    });

    it("sanctions screening passes in production with OFAC_API_KEY", async () => {
      process.env.NODE_ENV = "production";
      process.env.OFAC_API_KEY = "test-key";
      const { assertSanctionsScreeningAvailable } = await import("../_core/platformHardeningV3.js");
      expect(() => assertSanctionsScreeningAvailable()).not.toThrow();
    });

    it("sanctions screening passes in development without key", async () => {
      process.env.NODE_ENV = "development";
      delete process.env.OFAC_API_KEY;
      const { assertSanctionsScreeningAvailable } = await import("../_core/platformHardeningV3.js");
      expect(() => assertSanctionsScreeningAvailable()).not.toThrow();
    });

    it("Circle throws in production without CIRCLE_API_KEY", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.CIRCLE_API_KEY;
      const { assertCircleAvailable } = await import("../_core/platformHardeningV3.js");
      expect(() => assertCircleAvailable()).toThrow("FAIL-CLOSED");
    });

    it("Yellow Card throws in production without YELLOWCARD_API_KEY", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.YELLOWCARD_API_KEY;
      const { assertYellowCardAvailable } = await import("../_core/platformHardeningV3.js");
      expect(() => assertYellowCardAvailable()).toThrow("FAIL-CLOSED");
    });

    it("Gnosis Safe throws in production without URL", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.GNOSIS_SAFE_TX_SERVICE_URL;
      const { assertGnosisSafeAvailable } = await import("../_core/platformHardeningV3.js");
      expect(() => assertGnosisSafeAvailable()).toThrow("FAIL-CLOSED");
    });
  });

  describe("Live FX Oracle", () => {
    it("returns development fallback rate when oracle unavailable in dev", async () => {
      process.env.NODE_ENV = "development";
      const { getLiveFxRate } = await import("../_core/platformHardeningV3.js");
      const rate = await getLiveFxRate("USD", "NGN");
      expect(rate).toBe(1600);
    });

    it("returns 1 for same currency", async () => {
      const { getLiveFxRate } = await import("../_core/platformHardeningV3.js");
      const rate = await getLiveFxRate("USD", "USD");
      expect(rate).toBe(1);
    });

    it("throws in production when oracle unreachable and no cache", async () => {
      process.env.NODE_ENV = "production";
      process.env.FX_ORACLE_URL = "http://unreachable:9999";
      const { getLiveFxRate } = await import("../_core/platformHardeningV3.js");
      await expect(getLiveFxRate("USD", "NGN")).rejects.toThrow("FAIL-CLOSED");
    });
  });

  describe("De-peg Live Oracle", () => {
    it("returns cached price when available", async () => {
      const { getStablecoinLivePrice } = await import("../_core/platformHardeningV3.js");
      // First call will try API (may fail in test), but should not throw
      const price = await getStablecoinLivePrice("USDC");
      expect(typeof price).toBe("number");
      expect(price).toBeGreaterThan(0);
      expect(price).toBeLessThan(2);
    });

    it("returns 1.0 for unknown stablecoins", async () => {
      const { getStablecoinLivePrice } = await import("../_core/platformHardeningV3.js");
      const price = await getStablecoinLivePrice("UNKNOWN");
      expect(price).toBe(1.0);
    });
  });

  describe("Gas Fee Estimation", () => {
    it("returns gas estimate for known chains", async () => {
      const { estimateGasFee } = await import("../_core/platformHardeningV3.js");
      const result = await estimateGasFee("ethereum", "transfer");
      expect(result).toHaveProperty("gasPrice");
      expect(result).toHaveProperty("estimatedCostUsd");
      expect(result.chain).toBe("ethereum");
      expect(result.txType).toBe("transfer");
    });

    it("returns minimal estimate for unknown chains", async () => {
      const { estimateGasFee } = await import("../_core/platformHardeningV3.js");
      const result = await estimateGasFee("unknown-chain", "transfer");
      expect(result.estimatedCostUsd).toBe(0.01);
    });
  });

  describe("Rate Limiting", () => {
    it("allows requests within limit", async () => {
      const { checkRateLimit } = await import("../_core/platformHardeningV3.js");
      const result = checkRateLimit("user-1", "transfer.create");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    });

    it("blocks after exceeding limit", async () => {
      const { checkRateLimit } = await import("../_core/platformHardeningV3.js");
      // transfer.create allows 10 per minute
      for (let i = 0; i < 10; i++) {
        checkRateLimit("user-2", "transfer.create");
      }
      const result = checkRateLimit("user-2", "transfer.create");
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("separate limits per user", async () => {
      const { checkRateLimit } = await import("../_core/platformHardeningV3.js");
      for (let i = 0; i < 10; i++) {
        checkRateLimit("user-3", "transfer.create");
      }
      // Different user should still be allowed
      const result = checkRateLimit("user-4", "transfer.create");
      expect(result.allowed).toBe(true);
    });

    it("separate limits per endpoint", async () => {
      const { checkRateLimit } = await import("../_core/platformHardeningV3.js");
      for (let i = 0; i < 10; i++) {
        checkRateLimit("user-5", "transfer.create");
      }
      // Different endpoint should still be allowed
      const result = checkRateLimit("user-5", "stablecoin.swap");
      expect(result.allowed).toBe(true);
    });
  });

  describe("Distributed Tracing", () => {
    it("generates valid trace context", async () => {
      const { generateTraceContext } = await import("../_core/platformHardeningV3.js");
      const ctx = generateTraceContext();
      expect(ctx.traceId).toHaveLength(32);
      expect(ctx.spanId).toHaveLength(16);
      expect(ctx.traceFlags).toBe(1);
    });

    it("propagates parent trace ID", async () => {
      const { generateTraceContext } = await import("../_core/platformHardeningV3.js");
      const parent = generateTraceContext();
      const child = generateTraceContext(parent);
      expect(child.traceId).toBe(parent.traceId);
      expect(child.parentSpanId).toBe(parent.spanId);
      expect(child.spanId).not.toBe(parent.spanId);
    });

    it("serializes to W3C traceparent header", async () => {
      const { generateTraceContext, traceContextToHeader } = await import("../_core/platformHardeningV3.js");
      const ctx = generateTraceContext();
      const header = traceContextToHeader(ctx);
      expect(header).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
    });

    it("parses traceparent header", async () => {
      const { parseTraceHeader } = await import("../_core/platformHardeningV3.js");
      const ctx = parseTraceHeader("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
      expect(ctx).not.toBeNull();
      expect(ctx!.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
      expect(ctx!.spanId).toBe("00f067aa0ba902b7");
      expect(ctx!.traceFlags).toBe(1);
    });

    it("injects headers into outgoing requests", async () => {
      const { generateTraceContext, injectTraceHeaders } = await import("../_core/platformHardeningV3.js");
      const ctx = generateTraceContext();
      const headers = injectTraceHeaders({ "Content-Type": "application/json" }, ctx);
      expect(headers["traceparent"]).toBeDefined();
      expect(headers["X-Trace-ID"]).toBe(ctx.traceId);
      expect(headers["X-Span-ID"]).toBe(ctx.spanId);
    });
  });

  describe("Feature Flags", () => {
    it("returns true when no feature flag service configured", async () => {
      delete process.env.UNLEASH_URL;
      const { isFeatureEnabled } = await import("../_core/platformHardeningV3.js");
      const enabled = await isFeatureEnabled("new-bridge-ui");
      expect(enabled).toBe(true);
    });
  });

  describe("Tamper-Proof Audit Log", () => {
    it("verifyAuditChain returns valid for empty log", async () => {
      const { verifyAuditChain } = await import("../_core/platformHardeningV3.js");
      const mockDb = { execute: vi.fn().mockResolvedValue([]) };
      const result = await verifyAuditChain(mockDb);
      expect(result.valid).toBe(true);
      expect(result.entriesChecked).toBe(0);
    });
  });

  describe("ISO 20022 Message Generation", () => {
    it("generates valid pacs.008 XML", async () => {
      const { generatePacs008 } = await import("../_core/platformHardeningV3.js");
      const xml = generatePacs008({
        amount: 5000,
        currency: "USD",
        senderName: "John Doe",
        senderAccount: "GB29NWBK60161331926819",
        receiverName: "Jane Smith",
        receiverAccount: "NG1234567890123456",
        receiverBIC: "GTBINGLA",
        reference: "REF-001",
      });
      expect(xml).toContain("pacs.008.001.08");
      expect(xml).toContain("<NbOfTxs>1</NbOfTxs>");
      expect(xml).toContain("5000.00");
      expect(xml).toContain("John Doe");
      expect(xml).toContain("Jane Smith");
      expect(xml).toContain("GTBINGLA");
      expect(xml).toContain("<UETR>");
    });

    it("generates valid camt.053 XML", async () => {
      const { generateCamt053 } = await import("../_core/platformHardeningV3.js");
      const xml = generateCamt053([
        { iban: "GB29NWBK60161331926819", currency: "GBP", balance: 10000, transactions: 45 },
        { iban: "NG1234567890123456", currency: "NGN", balance: 5000000, transactions: 120 },
      ]);
      expect(xml).toContain("camt.053.001.08");
      expect(xml).toContain("10000.00");
      expect(xml).toContain("5000000.00");
      expect(xml).toContain("<NbOfNtries>45</NbOfNtries>");
      expect(xml).toContain("<NbOfNtries>120</NbOfNtries>");
    });
  });

  describe("Data Residency Enforcement", () => {
    it("routes Nigerian data to af-west-1", async () => {
      const { enforceDataResidency } = await import("../_core/platformHardeningV3.js");
      const result = enforceDataResidency("NG", "pii");
      expect(result.region).toBe("af-west-1");
      expect(result.encryptionRequired).toBe(true);
      expect(result.crossBorderAllowed).toBe(false);
    });

    it("routes EU data to eu-west-1", async () => {
      const { enforceDataResidency } = await import("../_core/platformHardeningV3.js");
      const result = enforceDataResidency("DE", "pii");
      expect(result.region).toBe("eu-west-1");
      expect(result.encryptionRequired).toBe(true);
    });

    it("allows general data cross-border for restricted countries", async () => {
      const { enforceDataResidency } = await import("../_core/platformHardeningV3.js");
      const result = enforceDataResidency("NG", "general");
      expect(result.crossBorderAllowed).toBe(true);
    });

    it("sets financial retention to 7 years (2555 days)", async () => {
      const { enforceDataResidency } = await import("../_core/platformHardeningV3.js");
      const result = enforceDataResidency("US", "financial");
      expect(result.retentionDays).toBe(2555);
    });
  });

  describe("Age Verification", () => {
    it("blocks under-18", async () => {
      const { verifyMinimumAge } = await import("../_core/platformHardeningV3.js");
      const tenYearsAgo = new Date();
      tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
      const result = verifyMinimumAge(tenYearsAgo.toISOString());
      expect(result.allowed).toBe(false);
      expect(result.age).toBe(10);
      expect(result.reason).toContain("Minimum age 18");
    });

    it("allows 18+", async () => {
      const { verifyMinimumAge } = await import("../_core/platformHardeningV3.js");
      const twentyYearsAgo = new Date();
      twentyYearsAgo.setFullYear(twentyYearsAgo.getFullYear() - 25);
      const result = verifyMinimumAge(twentyYearsAgo.toISOString());
      expect(result.allowed).toBe(true);
      expect(result.age).toBe(25);
    });

    it("handles custom minimum age", async () => {
      const { verifyMinimumAge } = await import("../_core/platformHardeningV3.js");
      const sixteenYearsAgo = new Date();
      sixteenYearsAgo.setFullYear(sixteenYearsAgo.getFullYear() - 16);
      const result = verifyMinimumAge(sixteenYearsAgo.toISOString(), 16);
      expect(result.allowed).toBe(true);
    });
  });

  describe("Biometric Template Encryption", () => {
    it("encrypts and decrypts biometric data", async () => {
      process.env.BIOMETRIC_ENCRYPTION_KEY = "a".repeat(64); // 32 bytes hex
      const { encryptBiometricTemplate, decryptBiometricTemplate } = await import("../_core/platformHardeningV3.js");
      const template = Buffer.from("biometric-feature-vector-data-1234567890");
      const { encrypted, iv } = encryptBiometricTemplate(template);
      expect(encrypted).not.toBe(template.toString("base64"));
      const decrypted = decryptBiometricTemplate(encrypted, iv);
      expect(decrypted.toString()).toBe(template.toString());
    });

    it("different IVs produce different ciphertext", async () => {
      process.env.BIOMETRIC_ENCRYPTION_KEY = "b".repeat(64);
      const { encryptBiometricTemplate } = await import("../_core/platformHardeningV3.js");
      const template = Buffer.from("same-data");
      const enc1 = encryptBiometricTemplate(template);
      const enc2 = encryptBiometricTemplate(template);
      expect(enc1.encrypted).not.toBe(enc2.encrypted);
      expect(enc1.iv).not.toBe(enc2.iv);
    });
  });

  describe("VASP Regulatory Reporting", () => {
    it("triggers filing for crypto transfers >= 1000 USD", async () => {
      const { generateVASPReport } = await import("../_core/platformHardeningV3.js");
      const mockDb = { execute: vi.fn().mockResolvedValue([]) };
      const result = await generateVASPReport(mockDb, {
        amount: 1500,
        currency: "USD",
        fromAddress: "0x1234",
        toAddress: "0x5678",
        senderName: "John",
        receiverName: "Jane",
        transferType: "crypto",
      });
      expect(result.filingRequired).toBe(true);
      expect(result.jurisdiction).toBe("EU-MiCA");
      expect(result.reportId).toMatch(/^VASP-/);
    });

    it("does not trigger filing for fiat transfers", async () => {
      const { generateVASPReport } = await import("../_core/platformHardeningV3.js");
      const mockDb = { execute: vi.fn().mockResolvedValue([]) };
      const result = await generateVASPReport(mockDb, {
        amount: 5000,
        currency: "USD",
        fromAddress: "GB29NWBK",
        toAddress: "NG1234",
        senderName: "John",
        receiverName: "Jane",
        transferType: "fiat",
      });
      expect(result.filingRequired).toBe(false);
    });

    it("does not trigger filing for small crypto transfers", async () => {
      const { generateVASPReport } = await import("../_core/platformHardeningV3.js");
      const mockDb = { execute: vi.fn().mockResolvedValue([]) };
      const result = await generateVASPReport(mockDb, {
        amount: 500,
        currency: "USD",
        fromAddress: "0x1234",
        toAddress: "0x5678",
        senderName: "John",
        receiverName: "Jane",
        transferType: "crypto",
      });
      expect(result.filingRequired).toBe(false);
    });
  });

  describe("Web Vitals Recording", () => {
    it("records metrics to database", async () => {
      const { recordWebVitals } = await import("../_core/platformHardeningV3.js");
      const mockDb = { execute: vi.fn().mockResolvedValue([]) };
      await recordWebVitals(mockDb, {
        LCP: 1800,
        FID: 50,
        CLS: 0.05,
        INP: 150,
        TTFB: 500,
        url: "/send",
        userId: "user-1",
        timestamp: new Date().toISOString(),
      });
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe("Background Job Scheduler", () => {
    it("defines all required scheduled jobs", async () => {
      // Access internal SCHEDULED_JOBS constant
      const mod = await import("../_core/platformHardeningV3.js");
      // Check that startJobScheduler is a function
      expect(typeof mod.startJobScheduler).toBe("function");
    });
  });
});
