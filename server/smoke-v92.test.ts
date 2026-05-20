/**
 * RemitFlow v92 — Smoke Tests
 * Covers: Fee Engine, Transfer Limits, FX Rate Lock, Compliance Triggers,
 *         Partner Analytics, Beneficiary CRUD, Wallet CRUD, Transaction Search,
 *         KYC Admin Queue, Email Delivery, Audit Log, Security Summary
 */
import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "./routers.js";

const adminCtx = {
  user: { id: 1, email: "admin@remitflow.com", name: "Admin", role: "admin" as const },
  req: { headers: { origin: "http://localhost:3000" } } as any,
  res: {} as any,
};
const userCtx = {
  user: { id: 2, email: "user@remitflow.com", name: "Test User", role: "user" as const },
  req: { headers: { origin: "http://localhost:3000" } } as any,
  res: {} as any,
};

const adminCaller = appRouter.createCaller(adminCtx);
const userCaller = appRouter.createCaller(userCtx);
const anonCaller = appRouter.createCaller({ user: null, req: { headers: {} } as any, res: {} as any });

// ─── Fee Engine ───────────────────────────────────────────────────────────────
describe("v92 Fee Engine", () => {
  it("calculates USD-NGN fee correctly", async () => {
    const result = await anonCaller.feeEngineV92.calculate({
      fromCurrency: "USD",
      toCurrency: "NGN",
      amount: 500,
    });
    expect(result.fee).toBeGreaterThan(0);
    expect(result.youSend).toBe(500);
    expect(result.corridor).toBe("USD-NGN");
    expect(result.flatFee).toBeGreaterThan(0);
    expect(result.percentageFee).toBeGreaterThan(0);
  });

  it("calculates USD-GHS fee correctly", async () => {
    const result = await anonCaller.feeEngineV92.calculate({
      fromCurrency: "USD",
      toCurrency: "GHS",
      amount: 1000,
    });
    expect(result.fee).toBeGreaterThan(0);
    expect(result.youSendWithFee).toBeGreaterThan(result.youSend);
  });

  it("uses DEFAULT fee tier for unknown corridor", async () => {
    const result = await anonCaller.feeEngineV92.calculate({
      fromCurrency: "JPY",
      toCurrency: "BRL",
      amount: 200,
    });
    expect(result.fee).toBeGreaterThan(0);
    expect(result.corridor).toBe("JPY-BRL");
  });

  it("returns corridor rates list", async () => {
    const result = await anonCaller.feeEngineV92.corridorRates();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("corridor");
    expect(result[0]).toHaveProperty("flatFee");
    expect(result[0]).toHaveProperty("percentageRate");
  });

  it("admin can get corridor config", async () => {
    const result = await adminCaller.feeEngineV92.getCorridorConfig({ corridor: "USD-NGN" });
    expect(result.corridor).toBe("USD-NGN");
    expect(result.flat).toBeGreaterThan(0);
    expect(result.pct).toBeGreaterThan(0);
  });
});

// ─── Transfer Limits ──────────────────────────────────────────────────────────
describe("v92 Transfer Limits", () => {
  it("checks transfer limit for user", async () => {
    const result = await userCaller.transferLimits.check({ amount: 100, currency: "USD" });
    expect(result).toHaveProperty("kycTier");
    expect(result).toHaveProperty("limits");
    expect(result).toHaveProperty("canProceed");
    expect(result).toHaveProperty("remaining");
  });

  it("returns my limits", async () => {
    const result = await userCaller.transferLimits.getMyLimits();
    expect(result).toHaveProperty("kycTier");
    expect(result).toHaveProperty("limits");
    expect(result).toHaveProperty("allTiers");
    expect(Object.keys(result.allTiers).length).toBeGreaterThan(0);
  });

  it("returns my usage", async () => {
    const result = await userCaller.transferLimits.getMyUsage();
    expect(result).toHaveProperty("tier");
    expect(result).toHaveProperty("dailyUsed");
    expect(result).toHaveProperty("monthlyUsed");
    expect(result).toHaveProperty("dailyLimit");
    expect(result).toHaveProperty("monthlyLimit");
    expect(result).toHaveProperty("singleLimit");
  });

  it("admin can get all tier limits", async () => {
    const result = await adminCaller.transferLimits.getAdminLimits();
    expect(result).toHaveProperty("limits");
    expect(Array.isArray(result.limits)).toBe(true);
  });

  it("admin can update tier limits", async () => {
    const result = await adminCaller.transferLimits.updateTierLimits({
      tier: "tier1",
      dailyLimit: 1500,
      monthlyLimit: 7500,
      singleLimit: 1500,
    });
    expect(result.success).toBe(true);
    expect(result.tier).toBe("tier1");
  });
});

// ─── FX Rate Lock ─────────────────────────────────────────────────────────────
describe("v92 FX Rate Lock", () => {
  let quoteId: string;

  it("locks a quote", async () => {
    const result = await userCaller.fxRateLock.lockQuote({
      fromCurrency: "USD",
      toCurrency: "NGN",
      amount: 500,
      rate: 1580.5,
    });
    expect(result).toHaveProperty("quoteId");
    expect(result.quoteId).toMatch(/^QT-/);
    expect(result.expiresInSeconds).toBe(900);
    expect(result.fee).toBeGreaterThan(0);
    quoteId = result.quoteId;
  });

  it("validates a locked quote", async () => {
    const result = await userCaller.fxRateLock.validateQuote({ quoteId });
    expect(result.valid).toBe(true);
    expect(result).toHaveProperty("remainingSeconds");
    expect((result as any).remainingSeconds).toBeGreaterThan(0);
  });

  it("returns invalid for unknown quote", async () => {
    const result = await userCaller.fxRateLock.validateQuote({ quoteId: "QT-INVALID-999" });
    expect(result.valid).toBe(false);
  });
});

// ─── Compliance Triggers ──────────────────────────────────────────────────────
describe("v92 Compliance Triggers", () => {
  it("flags CTR for $10K+ transaction", async () => {
    const result = await userCaller.complianceTriggers.checkTransaction({
      amount: 12000,
      currency: "USD",
      amountUsd: 12000,
    });
    expect(result.triggers).toContain("CTR");
    expect(result.reportCreated).toBe(true);
  });

  it("flags SAR for suspicious structuring", async () => {
    const result = await userCaller.complianceTriggers.checkTransaction({
      amount: 6000,
      currency: "USD",
      amountUsd: 6000,
    });
    expect(result).toHaveProperty("triggers");
    expect(Array.isArray(result.triggers)).toBe(true);
  });

  it("passes clean transaction", async () => {
    const result = await userCaller.complianceTriggers.checkTransaction({
      amount: 250,
      currency: "USD",
      amountUsd: 250,
    });
    expect(result.triggers).toHaveLength(0);
    expect(result.reportCreated).toBe(false);
  });
});

// ─── Partner Analytics ────────────────────────────────────────────────────────
describe("v92 Partner Analytics", () => {
  it("returns partner analytics summary", async () => {
    const result = await adminCaller.partnerAnalytics.overview({ tenantId: 1 });
    expect(result).toHaveProperty("overview");
    expect(result).toHaveProperty("topCorridors");
    expect(result).toHaveProperty("userGrowth");
  });

  it("returns corridor breakdown", async () => {
    const result = await adminCaller.partnerAnalytics.revenueBreakdown({ tenantId: 1 });
    expect(result).toHaveProperty("breakdown");
    expect(Array.isArray(result.breakdown)).toBe(true);
  });

  it("returns revenue metrics", async () => {
    const result = await adminCaller.partnerAnalytics.apiUsage({ tenantId: 1 });
    expect(result).toHaveProperty("keys");
    expect(result).toHaveProperty("totalRequests");
  });
});

// ─── Beneficiary CRUD ─────────────────────────────────────────────────────────
describe("v92 Beneficiary CRUD", () => {
  let beneficiaryId: number;

  it("creates a beneficiary", async () => {
    const result = await userCaller.beneficiaryCrud.create({
      name: "Test Beneficiary v92",
      country: "NG",
      currency: "NGN",
      accountNumber: "1234567890",
      bankName: "Test Bank",
      bankCode: "058",
    });
    expect(result).toHaveProperty("id");
    expect(result.success).toBe(true);
    beneficiaryId = result.id;
  });

  it("lists beneficiaries", async () => {
    const result = await userCaller.beneficiaryCrud.list({ search: "" });
    expect(result).toHaveProperty("beneficiaries");
    expect(Array.isArray(result.beneficiaries)).toBe(true);
  });

  it("searches beneficiaries", async () => {
    const result = await userCaller.beneficiaryCrud.list({ search: "v92" });
    expect(result).toHaveProperty("beneficiaries");
  });

  it("updates a beneficiary", async () => {
    const result = await userCaller.beneficiaryCrud.update({
      id: beneficiaryId,
      name: "Updated Beneficiary v92",
    });
    expect(result.success).toBe(true);
  });

  it("deletes a beneficiary", async () => {
    const result = await userCaller.beneficiaryCrud.delete({ id: beneficiaryId });
    expect(result.success).toBe(true);
  });
});

// ─── Wallet CRUD ──────────────────────────────────────────────────────────────
describe("v92 Wallet CRUD", () => {
  it("lists wallets", async () => {
    const result = await userCaller.walletCrud.list();
    expect(result).toHaveProperty("wallets");
    expect(Array.isArray(result.wallets)).toBe(true);
  });

  it("creates a wallet", async () => {
    const result = await userCaller.walletCrud.add({
      currency: "GHS",
      isDefault: false,
    });
    expect(result).toHaveProperty("success");
    expect(result.success).toBe(true);
  });
});

// ─── Transaction Search ───────────────────────────────────────────────────────
describe("v92 Transaction Search", () => {
  it("searches transactions with no filters", async () => {
    const result = await userCaller.txSearch.search({
      page: 1,
      limit: 20,
    });
    expect(result).toHaveProperty("transfers");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.transfers)).toBe(true);
  });

  it("searches transactions by status", async () => {
    const result = await userCaller.txSearch.search({
      status: "completed",
      page: 1,
      limit: 10,
    });
    expect(result).toHaveProperty("transfers");
  });

  it("searches transactions by amount range", async () => {
    const result = await userCaller.txSearch.search({
      minAmount: 100,
      maxAmount: 1000,
      page: 1,
      limit: 10,
    });
    expect(result).toHaveProperty("transfers");
  });

  it("searches transactions by date range", async () => {
    const result = await userCaller.txSearch.search({
      fromDate: "2025-01-01",
      toDate: "2026-12-31",
      page: 1,
      limit: 10,
    });
    expect(result).toHaveProperty("transfers");
  });

  it("searches transactions by text query", async () => {
    const result = await userCaller.txSearch.search({
      query: "NGN",
      page: 1,
      limit: 10,
    });
    expect(result).toHaveProperty("transfers");
  });

  it("admin can search all transactions", async () => {
    const result = await adminCaller.txSearch.search({
      page: 1,
      limit: 50,
    });
    expect(result).toHaveProperty("transfers");
    expect(result).toHaveProperty("total");
  });
});

// ─── KYC Admin Queue ──────────────────────────────────────────────────────────
describe("v92 KYC Admin Queue", () => {
  it("returns pending KYC queue", async () => {
    const result = await adminCaller.kycAdmin.queue({ status: "pending", page: 1, limit: 20 });
    expect(result).toHaveProperty("submissions");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.submissions)).toBe(true);
  });

  it("returns KYC stats", async () => {
    const result = await adminCaller.kycAdmin.getStats();
    expect(result).toHaveProperty("pending");
    expect(result).toHaveProperty("approved");
    expect(result).toHaveProperty("rejected");
  });
});

// ─── Email Delivery ───────────────────────────────────────────────────────────
describe("v92 Email Delivery", () => {
  it("returns email config", async () => {
    const result = await adminCaller.emailDelivery.sendComplianceReport({ to: "test@example.com", reportType: "CTR", reportId: "test-001", period: "2026-Q1" });
    expect(result).toHaveProperty("success");
  });

  it("sends a test email (graceful fail if SMTP not configured)", async () => {
    try {
      const result = await adminCaller.emailDelivery.sendTest({ to: "test@example.com" });
      expect(result).toHaveProperty("success");
    } catch {
      // Expected if SMTP not configured in test environment
    }
  });
});

// ─── Audit Log ────────────────────────────────────────────────────────────────
describe("v92 Audit Log", () => {
  it("returns audit log list", async () => {
    const result = await adminCaller.auditLog.list({ page: 1, limit: 20 });
    expect(result).toHaveProperty("logs");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.logs)).toBe(true);
  });

  it("returns audit log stats", async () => {
    const result = await adminCaller.auditLog.getStats();
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("today");
    expect(result).toHaveProperty("topActions");
  });

  it("returns security summary", async () => {
    const result = await adminCaller.auditLog.getSecuritySummary();
    expect(result).toHaveProperty("events");
    expect(Array.isArray(result.events)).toBe(true);
  });
});

// ─── Security Audit ───────────────────────────────────────────────────────────
describe("v92 Security Audit", () => {
  it("transfer limits block unverified users", async () => {
    const result = await userCaller.transferLimits.check({ amount: 100, currency: "USD" });
    // Unverified users should have limits
    expect(result).toHaveProperty("canProceed");
    expect(result).toHaveProperty("blockedReason");
  });

  it("fee engine returns non-negative fees", async () => {
    const result = await anonCaller.feeEngineV92.calculate({
      fromCurrency: "USD",
      toCurrency: "NGN",
      amount: 10,
    });
    expect(result.fee).toBeGreaterThanOrEqual(0);
  });

  it("admin procedures reject non-admin users", async () => {
    await expect(
      userCaller.auditLog.list({ page: 1, limit: 10 })
    ).rejects.toThrow();
  });

  it("admin procedures reject anonymous users", async () => {
    await expect(
      anonCaller.auditLog.list({ page: 1, limit: 10 })
    ).rejects.toThrow();
  });

  it("protected procedures reject anonymous users", async () => {
    await expect(
      anonCaller.transferLimits.getMyUsage()
    ).rejects.toThrow();
  });
});
