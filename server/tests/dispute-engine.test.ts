/**
 * Dispute Engine Business Logic Tests
 * Tests: dispute lifecycle, SLA tracking, evidence management, resolution
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  createDispute,
  updateDisputeStatus,
  resolveDispute,
  addEvidence,
  getDispute,
  getUserDisputes,
  getDisputeStats,
  getSLABreaches,
} from "../lib/disputeEngine";

describe("Dispute Engine — createDispute", () => {
  it("should create a dispute with open status", () => {
    const dispute = createDispute({
      transactionId: "TXN-001",
      userId: 42,
      type: "unauthorized",
      amount: 500,
      currency: "USD",
      description: "Unauthorized debit from my account",
    });
    expect(dispute.id).toMatch(/^DSP-/);
    expect(dispute.status).toBe("open");
    expect(dispute.transactionId).toBe("TXN-001");
    expect(dispute.userId).toBe(42);
    expect(dispute.amount).toBe(500);
  });

  it("should set SLA deadline based on dispute type", () => {
    const urgentDispute = createDispute({
      transactionId: "TXN-002",
      userId: 1,
      type: "fraud",
      amount: 10000,
      currency: "USD",
      description: "Fraudulent transaction",
    });
    // Fraud SLA = 24 hours
    const hoursUntilDeadline =
      (urgentDispute.slaDeadline - urgentDispute.createdAt) / 3600_000;
    expect(hoursUntilDeadline).toBe(24);
  });

  it("should set longer SLA for service issues", () => {
    const dispute = createDispute({
      transactionId: "TXN-003",
      userId: 1,
      type: "service_issue",
      amount: 25,
      currency: "NGN",
      description: "Transfer delayed",
    });
    const hoursUntilDeadline =
      (dispute.slaDeadline - dispute.createdAt) / 3600_000;
    expect(hoursUntilDeadline).toBe(120); // 5 days
  });

  it("should initialize with empty evidence and creation timeline entry", () => {
    const dispute = createDispute({
      transactionId: "TXN-004",
      userId: 10,
      type: "not_received",
      amount: 100,
      currency: "GBP",
      description: "Money not received",
    });
    expect(dispute.evidence).toEqual([]);
    expect(dispute.timeline).toHaveLength(1);
    expect(dispute.timeline[0].action).toBe("created");
  });
});

describe("Dispute Engine — updateDisputeStatus", () => {
  let disputeId: string;

  beforeEach(() => {
    const d = createDispute({
      transactionId: "TXN-STATUS-TEST",
      userId: 5,
      type: "wrong_amount",
      amount: 200,
      currency: "EUR",
      description: "Wrong amount charged",
    });
    disputeId = d.id;
  });

  it("should update status and add timeline entry", () => {
    const updated = updateDisputeStatus(disputeId, "under_review", "agent:alice");
    expect(updated?.status).toBe("under_review");
    expect(updated!.timeline.length).toBeGreaterThan(1);
    expect(updated!.timeline[updated!.timeline.length - 1].by).toBe("agent:alice");
  });

  it("should return null for non-existent dispute", () => {
    expect(updateDisputeStatus("DSP-NONEXISTENT", "escalated", "system")).toBeNull();
  });
});

describe("Dispute Engine — resolveDispute", () => {
  let disputeId: string;

  beforeEach(() => {
    const d = createDispute({
      transactionId: "TXN-RESOLVE-TEST",
      userId: 7,
      type: "duplicate",
      amount: 150,
      currency: "USD",
      description: "Duplicate charge",
    });
    disputeId = d.id;
  });

  it("should resolve dispute with refund", () => {
    const resolved = resolveDispute(disputeId, "refunded", "agent:bob", 150, "Full refund");
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolution).toBe("refunded");
    expect(resolved?.resolutionAmount).toBe(150);
    expect(resolved?.resolvedAt).toBeDefined();
  });

  it("should support partial refund", () => {
    const resolved = resolveDispute(disputeId, "partially_refunded", "agent:carol", 75, "Half refund");
    expect(resolved?.resolution).toBe("partially_refunded");
    expect(resolved?.resolutionAmount).toBe(75);
  });
});

describe("Dispute Engine — evidence and lookup", () => {
  let disputeId: string;

  beforeEach(() => {
    const d = createDispute({
      transactionId: "TXN-EVIDENCE-TEST",
      userId: 99,
      type: "not_received",
      amount: 300,
      currency: "GHS",
      description: "No receipt",
    });
    disputeId = d.id;
  });

  it("should add evidence URLs", () => {
    const ok = addEvidence(disputeId, "https://evidence.com/screenshot.png", "user:99");
    expect(ok).toBe(true);
    const dispute = getDispute(disputeId);
    expect(dispute?.evidence).toContain("https://evidence.com/screenshot.png");
  });

  it("should return false for non-existent dispute", () => {
    expect(addEvidence("DSP-NOPE", "https://x.com", "user:1")).toBe(false);
  });

  it("should retrieve dispute by ID", () => {
    const d = getDispute(disputeId);
    expect(d).toBeDefined();
    expect(d!.id).toBe(disputeId);
  });

  it("should get disputes by user", () => {
    const d2 = createDispute({
      transactionId: "TXN-USER-2",
      userId: 99,
      type: "fraud",
      amount: 1000,
      currency: "USD",
      description: "Another dispute",
    });
    const userDisputes = getUserDisputes(99);
    expect(userDisputes.length).toBeGreaterThanOrEqual(2);
    expect(userDisputes.every(d => d.userId === 99)).toBe(true);
  });
});

describe("Dispute Engine — stats and SLA", () => {
  it("should compute dispute stats", () => {
    createDispute({
      transactionId: "TXN-STATS-1",
      userId: 50,
      type: "unauthorized",
      amount: 500,
      currency: "USD",
      description: "Stat test",
    });
    const stats = getDisputeStats();
    expect(stats.total).toBeGreaterThan(0);
    expect(typeof stats.open).toBe("number");
    expect(typeof stats.resolved).toBe("number");
    expect(typeof stats.slaBreaches).toBe("number");
    expect(typeof stats.avgResolutionHours).toBe("number");
  });

  it("should return SLA breaches as disputes past deadline", () => {
    const breaches = getSLABreaches();
    expect(Array.isArray(breaches)).toBe(true);
    // All returned disputes should have slaDeadline in the past
    for (const d of breaches) {
      expect(d.slaDeadline).toBeLessThan(Date.now());
    }
  });
});
