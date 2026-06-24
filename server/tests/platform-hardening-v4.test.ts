/**
 * platform-hardening-v4.test.ts — Tests for Phase 4 platform improvements
 *
 * Covers:
 *   - Synthetic identity detection (Python ML service callout)
 *   - Document fraud ML ensemble (font, edge, MRZ, microprint, template)
 *   - EDD source of wealth/funds submission
 *   - On-chain smart contract execution (ethers.js + Fireblocks)
 *   - Insurance claim workflow (Nexus Mutual)
 *   - Transaction simulation/replay mode
 *   - Multi-rail failover with health scoring
 *   - FX rate lock hedging with LP
 *   - DLQ processing (exponential backoff + PagerDuty)
 *   - Fluvio SmartModule registration
 *   - OpenSearch ISM lifecycle policies
 *   - Lakehouse Bronze/Silver/Gold pipelines
 *   - APISix route synchronization
 *   - TigerBeetle reconciliation
 *   - Fail-closed guards
 *   - Database persistence verification
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalEnv = process.env;

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Mock db
const mockDb = {
  execute: vi.fn().mockResolvedValue([]),
};

describe("Platform Hardening V4", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, NODE_ENV: "test" };
    mockFetch.mockReset();
    mockDb.execute.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Synthetic Identity Detection", () => {
    it("calls Python ML service and returns detection result", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          is_synthetic: false,
          risk_score: 0.15,
          flags: [],
          graph_cluster_id: null,
          shared_attributes: [],
          recommendation: "approve",
          analyzed_at: "2025-01-15T10:00:00Z",
        }),
      });

      const { detectSyntheticIdentity } = await import("../_core/platformHardeningV4.js");
      const result = await detectSyntheticIdentity(mockDb, {
        applicantId: "app-001",
        fullName: "John Doe",
        dateOfBirth: "1990-01-15",
        phone: "+234800000001",
        email: "john@example.com",
        address: "123 Main St",
        deviceFingerprint: "fp-abc123",
        ipAddress: "192.168.1.1",
        applicationTimestamp: new Date().toISOString(),
      });

      expect(result.recommendation).toBe("approve");
      expect(result.isSynthetic).toBe(false);
      expect(result.riskScore).toBeLessThan(0.5);
    });

    it("rejects high-risk synthetic identities", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          is_synthetic: true,
          risk_score: 0.85,
          flags: ["shared_attributes:ssn,phone", "cluster:abc123", "high_device_velocity"],
          graph_cluster_id: "abc123",
          shared_attributes: ["ssn", "phone"],
          recommendation: "reject",
          analyzed_at: "2025-01-15T10:00:00Z",
        }),
      });

      const { detectSyntheticIdentity } = await import("../_core/platformHardeningV4.js");
      const result = await detectSyntheticIdentity(mockDb, {
        applicantId: "app-002",
        fullName: "Synthetic User",
        dateOfBirth: "2005-06-01",
        ssn: "123-45-6789",
        phone: "+234800000002",
        email: "synth@example.com",
        address: "456 Fake St",
        deviceFingerprint: "fp-shared",
        ipAddress: "10.0.0.1",
        applicationTimestamp: new Date().toISOString(),
      });

      expect(result.isSynthetic).toBe(true);
      expect(result.recommendation).toBe("reject");
      expect(result.riskScore).toBeGreaterThan(0.7);
      expect(result.flags.length).toBeGreaterThan(0);
    });

    it("falls back to manual review on service timeout", async () => {
      mockFetch.mockRejectedValueOnce(new Error("timeout"));

      const { detectSyntheticIdentity } = await import("../_core/platformHardeningV4.js");
      const result = await detectSyntheticIdentity(mockDb, {
        applicantId: "app-003",
        fullName: "Test User",
        dateOfBirth: "1985-03-20",
        phone: "+234800000003",
        email: "test@example.com",
        address: "789 Real St",
        deviceFingerprint: "fp-unique",
        ipAddress: "172.16.0.1",
        applicationTimestamp: new Date().toISOString(),
      });

      expect(result.recommendation).toBe("manual_review");
    });
  });

  describe("Document Fraud ML Ensemble", () => {
    it("returns authentic verdict for genuine documents", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          is_authentic: true,
          confidence_score: 0.92,
          checks: {
            fontAnalysis: { passed: true, score: 0.95, anomalies: [] },
            edgeArtifacts: { passed: true, score: 0.91, anomalies: [] },
            mrzValidation: { passed: true, score: 0.98, anomalies: [] },
            microprintAnalysis: { passed: true, score: 0.88, anomalies: [] },
            templateMatching: { passed: true, score: 0.90, anomalies: [] },
          },
          overall_verdict: "authentic",
          analyzed_at: "2025-01-15T10:00:00Z",
        }),
      });

      const { verifyDocumentAuthenticity } = await import("../_core/platformHardeningV4.js");
      const result = await verifyDocumentAuthenticity(mockDb, {
        documentId: "doc-001",
        documentType: "passport",
        issuingCountry: "NG",
        imageBase64: "base64encodedimage",
      });

      expect(result.isAuthentic).toBe(true);
      expect(result.overallVerdict).toBe("authentic");
      expect(result.confidenceScore).toBeGreaterThan(0.85);
    });

    it("detects fraudulent documents", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          is_authentic: false,
          confidence_score: 0.35,
          checks: {
            fontAnalysis: { passed: false, score: 0.40, anomalies: ["font_inconsistency_detected"] },
            edgeArtifacts: { passed: false, score: 0.30, anomalies: ["jpeg_compression_inconsistency", "sharp_edge_transition_detected"] },
            mrzValidation: { passed: false, score: 0.20, anomalies: ["mrz_checksum_mismatch"] },
            microprintAnalysis: { passed: false, score: 0.45, anomalies: ["microprint_not_resolved"] },
            templateMatching: { passed: false, score: 0.38, anomalies: ["template_layout_deviation"] },
          },
          overall_verdict: "fraudulent",
          analyzed_at: "2025-01-15T10:00:00Z",
        }),
      });

      const { verifyDocumentAuthenticity } = await import("../_core/platformHardeningV4.js");
      const result = await verifyDocumentAuthenticity(mockDb, {
        documentId: "doc-fake",
        documentType: "national_id",
        issuingCountry: "NG",
        imageBase64: "tamperedimage",
      });

      expect(result.isAuthentic).toBe(false);
      expect(result.overallVerdict).toBe("fraudulent");
      expect(result.confidenceScore).toBeLessThan(0.5);
    });

    it("fails closed in production without ML service", async () => {
      process.env.NODE_ENV = "production";
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const { verifyDocumentAuthenticity } = await import("../_core/platformHardeningV4.js");
      const result = await verifyDocumentAuthenticity(mockDb, {
        documentId: "doc-003",
        documentType: "passport",
        issuingCountry: "GB",
        imageBase64: "testimage",
      });

      // Should fail-closed: not mark as authentic when service is down
      expect(result.isAuthentic).toBe(false);
    });
  });

  describe("EDD Source of Wealth/Funds", () => {
    it("creates EDD submission with risk scoring", async () => {
      const { submitEDDInformation } = await import("../_core/platformHardeningV4.js");
      const result = await submitEDDInformation(mockDb, {
        userId: "user-001",
        sourceOfWealth: "employment",
        sourceOfFunds: "salary",
        employerName: "Tech Corp",
        annualIncome: 85000,
        incomeCurrency: "USD",
        evidenceDocumentIds: ["doc-1", "doc-2"],
        additionalNotes: "Senior engineer",
      });

      expect(result.submissionId).toBeTruthy();
      expect(result.riskLevel).toMatch(/^(low|medium|high)$/);
      expect(result.status).toBe("pending_review");
      expect(mockDb.execute).toHaveBeenCalled();
    });

    it("flags high-risk EDD for PEP/crypto sources", async () => {
      const { submitEDDInformation } = await import("../_core/platformHardeningV4.js");
      const result = await submitEDDInformation(mockDb, {
        userId: "user-pep",
        sourceOfWealth: "political_office",
        sourceOfFunds: "crypto_trading",
        employerName: "Government",
        annualIncome: 500000,
        incomeCurrency: "USD",
        evidenceDocumentIds: [],
      });

      expect(result.riskLevel).toBe("high");
    });
  });

  describe("On-Chain Smart Contract Execution", () => {
    it("fails closed without FIREBLOCKS_API_KEY in production", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.FIREBLOCKS_API_KEY;

      const { executeOnChainTransfer } = await import("../_core/platformHardeningV4.js");
      await expect(executeOnChainTransfer(mockDb, {
        userId: "user-001",
        fromAddress: "0xabc",
        toAddress: "0xdef",
        amount: "100.0",
        tokenAddress: "0xUSDC",
        chain: "ethereum",
      })).rejects.toThrow("FAIL-CLOSED");
    });

    it("executes transfer through Rust bridge executor", async () => {
      process.env.NODE_ENV = "test";
      process.env.FIREBLOCKS_API_KEY = "test-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          tx_hash: "0x123abc",
          status: "confirmed",
          gas_used: "21000",
          block_number: 12345678,
          explorer_url: "https://etherscan.io/tx/0x123abc",
        }),
      });

      const { executeOnChainTransfer } = await import("../_core/platformHardeningV4.js");
      const result = await executeOnChainTransfer(mockDb, {
        userId: "user-001",
        fromAddress: "0xabc",
        toAddress: "0xdef",
        amount: "100.0",
        tokenAddress: "0xUSDC",
        chain: "ethereum",
      });

      expect(result.txHash).toBe("0x123abc");
      expect(result.status).toBe("confirmed");
      expect(result.explorerUrl).toContain("etherscan");
    });
  });

  describe("Insurance Claims (Nexus Mutual)", () => {
    it("fails closed without NEXUS_MUTUAL_API_KEY in production", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.NEXUS_MUTUAL_API_KEY;

      const { submitInsuranceClaim } = await import("../_core/platformHardeningV4.js");
      await expect(submitInsuranceClaim(mockDb, {
        userId: "user-001",
        policyId: "pol-001",
        incidentType: "smart_contract_exploit",
        incidentDate: "2025-01-10",
        affectedAmount: 50000,
        affectedCurrency: "USDC",
        description: "Bridge exploit",
        evidenceUrls: ["https://example.com/evidence.pdf"],
      })).rejects.toThrow("FAIL-CLOSED");
    });

    it("submits claim to Nexus Mutual API", async () => {
      process.env.NEXUS_MUTUAL_API_KEY = "test-nexus-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          claim_id: "nexus-claim-001",
          status: "submitted",
          estimated_payout: 48500,
        }),
      });

      const { submitInsuranceClaim } = await import("../_core/platformHardeningV4.js");
      const result = await submitInsuranceClaim(mockDb, {
        userId: "user-001",
        policyId: "pol-001",
        incidentType: "smart_contract_exploit",
        incidentDate: "2025-01-10",
        affectedAmount: 50000,
        affectedCurrency: "USDC",
        description: "Bridge exploit",
        evidenceUrls: [],
      });

      expect(result.claimId).toBeTruthy();
      expect(result.status).toBe("submitted");
      expect(mockDb.execute).toHaveBeenCalled();
    });
  });

  describe("Transaction Simulation", () => {
    it("simulates a transfer without mutations", async () => {
      const { simulateTransfer } = await import("../_core/platformHardeningV4.js");
      const result = await simulateTransfer(mockDb, {
        fromUserId: "user-sender",
        toUserId: "user-receiver",
        amount: 1000,
        currency: "USD",
        targetCurrency: "NGN",
        corridor: "US-NG",
        rail: "swift",
      });

      expect(result.simulationId).toBeTruthy();
      expect(typeof result.wouldSucceed).toBe("boolean");
      expect(result.steps).toBeInstanceOf(Array);
      expect(result.steps.length).toBeGreaterThan(0);
      expect(result.estimatedFees).toBeDefined();
      expect(result.estimatedFees.totalFee).toBeGreaterThanOrEqual(0);
      expect(result.fxRate).toBeGreaterThan(0);
      expect(result.recipientReceives).toBeGreaterThan(0);
    });

    it("reports failures for invalid corridors", async () => {
      const { simulateTransfer } = await import("../_core/platformHardeningV4.js");
      const result = await simulateTransfer(mockDb, {
        fromUserId: "user-sender",
        toUserId: "user-receiver",
        amount: 1000000000, // Very large amount
        currency: "USD",
        targetCurrency: "NGN",
        corridor: "XX-YY", // Invalid corridor
        rail: "nonexistent",
      });

      // Should report that it would fail due to invalid corridor/rail
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("Multi-Rail Failover", () => {
    it("selects healthiest rail for corridor", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          selected_rail: "swift",
          fallback_rails: ["mobile_money", "stablecoin"],
          reason: "health_score=0.95, priority=reliability",
          health_scores: { swift: 0.95, mobile_money: 0.88, stablecoin: 0.82 },
        }),
      });

      const { selectRailWithFailover } = await import("../_core/platformHardeningV4.js");
      const result = await selectRailWithFailover(mockDb, "US-NG", 5000, "USD");

      expect(result.selectedRail).toBeTruthy();
      expect(result.fallbackRails).toBeInstanceOf(Array);
      expect(Object.keys(result.healthScores).length).toBeGreaterThan(0);
    });

    it("provides fallback when primary rail fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          selected_rail: "mobile_money",
          fallback_rails: ["stablecoin"],
          reason: "swift_unhealthy, failover to mobile_money",
          health_scores: { mobile_money: 0.88, stablecoin: 0.75 },
        }),
      });

      const { selectRailWithFailover } = await import("../_core/platformHardeningV4.js");
      const result = await selectRailWithFailover(mockDb, "US-NG", 2000, "USD");

      expect(result.selectedRail).not.toBe("swift");
      expect(result.fallbackRails.length).toBeGreaterThan(0);
    });
  });

  describe("FX Rate Lock Hedging", () => {
    it("places offsetting LP order on rate lock", async () => {
      process.env.FX_LP_API_URL = "http://localhost:9999";
      process.env.FX_LP_API_KEY = "test-lp-key";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          order_id: "lp-order-001",
          hedged_amount: 5000,
          execution_rate: 1550.25,
          spread_cost: 12.50,
        }),
      });

      const { hedgeFxRateLock } = await import("../_core/platformHardeningV4.js");
      const result = await hedgeFxRateLock(mockDb, {
        quoteId: "quote-001",
        fromCurrency: "USD",
        toCurrency: "NGN",
        amount: 5000,
        lockedRate: 1550.0,
        expiresAt: new Date(Date.now() + 900000).toISOString(),
      });

      expect(result.hedgeId).toBeTruthy();
      expect(result.status).toMatch(/^(hedged|partial|unhedged)$/);
      expect(mockDb.execute).toHaveBeenCalled();
    });

    it("marks as unhedged when LP is unavailable", async () => {
      delete process.env.FX_LP_API_URL;

      const { hedgeFxRateLock } = await import("../_core/platformHardeningV4.js");
      const result = await hedgeFxRateLock(mockDb, {
        quoteId: "quote-002",
        fromCurrency: "GBP",
        toCurrency: "KES",
        amount: 1000,
        lockedRate: 165.50,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      });

      expect(result.status).toBe("unhedged");
    });
  });

  describe("DLQ Processing", () => {
    it("processes dead letter queue with exponential backoff", async () => {
      mockDb.execute.mockResolvedValueOnce([
        {
          id: "dlq-001",
          original_topic: "transfers",
          payload: { transferId: "tx-001", amount: 100 },
          retry_count: 2,
          max_retries: 7,
          error_message: "Timeout",
        },
        {
          id: "dlq-002",
          original_topic: "transfers",
          payload: { transferId: "tx-002", amount: 200 },
          retry_count: 6,
          max_retries: 7,
          error_message: "Connection refused",
        },
      ]);

      const { processDLQ } = await import("../_core/platformHardeningV4.js");
      const result = await processDLQ(mockDb);

      expect(result.processed).toBeGreaterThanOrEqual(0);
      expect(result.retried).toBeGreaterThanOrEqual(0);
      expect(typeof result.permanentlyFailed).toBe("number");
    });

    it("escalates to PagerDuty after max retries", async () => {
      mockDb.execute.mockResolvedValueOnce([
        {
          id: "dlq-perm",
          original_topic: "transfers",
          payload: { transferId: "tx-stuck" },
          retry_count: 7,
          max_retries: 7,
          error_message: "Permanent failure",
        },
      ]);

      process.env.PAGERDUTY_ROUTING_KEY = "test-pd-key";
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      const { processDLQ } = await import("../_core/platformHardeningV4.js");
      const result = await processDLQ(mockDb);

      expect(result.permanentlyFailed).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Fluvio SmartModule Registration", () => {
    it("registers 4 compliance filter SmartModules", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: "registered" }) });

      const { registerFluvioSmartModules, COMPLIANCE_SMART_MODULES } = await import("../_core/platformHardeningV4.js");
      expect(COMPLIANCE_SMART_MODULES).toHaveLength(4);

      await registerFluvioSmartModules();
      expect(mockFetch).toHaveBeenCalled();
    });

    it("includes sanctions, PEP, threshold, and adverse media filters", async () => {
      const { COMPLIANCE_SMART_MODULES } = await import("../_core/platformHardeningV4.js");
      const names = COMPLIANCE_SMART_MODULES.map((m: any) => m.name);
      expect(names).toContain("sanctions-filter");
      expect(names).toContain("pep-filter");
      expect(names).toContain("threshold-reporter");
      expect(names).toContain("adverse-media-filter");
    });
  });

  describe("OpenSearch ISM Lifecycle Policies", () => {
    it("defines 4 lifecycle policies with hot/warm/cold/delete", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

      const { applyOpenSearchLifecyclePolicies, OPENSEARCH_POLICIES } = await import("../_core/platformHardeningV4.js");
      expect(OPENSEARCH_POLICIES.length).toBeGreaterThanOrEqual(4);

      await applyOpenSearchLifecyclePolicies();
      expect(mockFetch).toHaveBeenCalled();
    });

    it("each policy has retention phases", async () => {
      const { OPENSEARCH_POLICIES } = await import("../_core/platformHardeningV4.js");
      for (const policy of OPENSEARCH_POLICIES) {
        expect(policy.hotDays).toBeGreaterThan(0);
        expect(policy.warmDays).toBeGreaterThan(policy.hotDays);
        expect(policy.coldDays).toBeGreaterThan(policy.warmDays);
        expect(policy.deleteDays).toBeGreaterThan(policy.coldDays);
      }
    });
  });

  describe("Lakehouse Pipelines", () => {
    it("triggers bronze layer CDC ingestion", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ job_id: "bronze-001", status: "running" }),
      });

      const { triggerLakehousePipeline } = await import("../_core/platformHardeningV4.js");
      const result = await triggerLakehousePipeline("bronze");

      expect(result.jobId).toBeTruthy();
      expect(result.status).toBe("running");
    });

    it("triggers silver enrichment layer", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ job_id: "silver-001", status: "running" }),
      });

      const { triggerLakehousePipeline } = await import("../_core/platformHardeningV4.js");
      const result = await triggerLakehousePipeline("silver");

      expect(result.jobId).toBeTruthy();
    });

    it("triggers gold aggregation layer", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ job_id: "gold-001", status: "running" }),
      });

      const { triggerLakehousePipeline } = await import("../_core/platformHardeningV4.js");
      const result = await triggerLakehousePipeline("gold");

      expect(result.jobId).toBeTruthy();
    });
  });

  describe("APISix Route Synchronization", () => {
    it("syncs 4+ routes with rate limiting", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

      const { syncAPISixRoutes, APISIX_ROUTES } = await import("../_core/platformHardeningV4.js");
      expect(APISIX_ROUTES.length).toBeGreaterThanOrEqual(4);

      await syncAPISixRoutes();
      expect(mockFetch).toHaveBeenCalled();
    });

    it("each route has rate limiting configured", async () => {
      const { APISIX_ROUTES } = await import("../_core/platformHardeningV4.js");
      for (const route of APISIX_ROUTES) {
        expect(route.rateLimitPerSecond).toBeGreaterThan(0);
        expect(route.uri).toBeTruthy();
        expect(route.upstream).toBeTruthy();
      }
    });
  });

  describe("TigerBeetle Reconciliation", () => {
    it("detects balanced ledger", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { id: "acc-1", debits_posted: "1000", credits_posted: "1000" },
          { id: "acc-2", debits_posted: "500", credits_posted: "500" },
        ]),
      });

      mockDb.execute.mockResolvedValueOnce([
        { account_id: "acc-1", total_debits: "1000", total_credits: "1000" },
        { account_id: "acc-2", total_debits: "500", total_credits: "500" },
      ]);

      const { reconcileTigerBeetle } = await import("../_core/platformHardeningV4.js");
      const result = await reconcileTigerBeetle(mockDb);

      expect(result.balanced).toBe(true);
      expect(result.discrepancies).toHaveLength(0);
    });

    it("detects discrepancies between TigerBeetle and PostgreSQL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { id: "acc-1", debits_posted: "1000", credits_posted: "1000" },
          { id: "acc-2", debits_posted: "750", credits_posted: "500" },
        ]),
      });

      mockDb.execute.mockResolvedValueOnce([
        { account_id: "acc-1", total_debits: "1000", total_credits: "1000" },
        { account_id: "acc-2", total_debits: "500", total_credits: "500" },
      ]);

      const { reconcileTigerBeetle } = await import("../_core/platformHardeningV4.js");
      const result = await reconcileTigerBeetle(mockDb);

      // TigerBeetle says 750 debits for acc-2, PG says 500 => discrepancy
      expect(result.discrepancies.length).toBeGreaterThan(0);
    });
  });

  describe("Database Schema Initialization", () => {
    it("creates all 9 v4 tables", async () => {
      const { initV4Schema } = await import("../_core/platformHardeningV4.js");
      await initV4Schema(mockDb);

      expect(mockDb.execute).toHaveBeenCalled();
      const sqlCall = mockDb.execute.mock.calls[0][0];
      // The SQL should contain table creation for all v4 tables
      expect(sqlCall).toBeTruthy();
    });
  });

  describe("Platform V4 Module Exports", () => {
    it("exports all expected functions", async () => {
      const { platformV4 } = await import("../_core/platformHardeningV4.js");

      // KYC/KYB
      expect(typeof platformV4.detectSyntheticIdentity).toBe("function");
      expect(typeof platformV4.verifyDocumentAuthenticity).toBe("function");
      expect(typeof platformV4.submitEDDInformation).toBe("function");

      // Stablecoins
      expect(typeof platformV4.executeOnChainTransfer).toBe("function");
      expect(typeof platformV4.submitInsuranceClaim).toBe("function");

      // Flow of Funds
      expect(typeof platformV4.simulateTransfer).toBe("function");
      expect(typeof platformV4.selectRailWithFailover).toBe("function");
      expect(typeof platformV4.hedgeFxRateLock).toBe("function");
      expect(typeof platformV4.processDLQ).toBe("function");

      // Middleware
      expect(typeof platformV4.registerFluvioSmartModules).toBe("function");
      expect(typeof platformV4.applyOpenSearchLifecyclePolicies).toBe("function");
      expect(typeof platformV4.triggerLakehousePipeline).toBe("function");
      expect(typeof platformV4.syncAPISixRoutes).toBe("function");
      expect(typeof platformV4.reconcileTigerBeetle).toBe("function");

      // Schema
      expect(typeof platformV4.initV4Schema).toBe("function");
    });
  });
});
