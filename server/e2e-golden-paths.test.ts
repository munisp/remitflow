/**
 * Golden Path Integration Tests — 5 critical money flow paths.
 * Uses tRPC caller pattern against real PostgreSQL.
 */
import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createCtx(userId = 1): TrpcContext {
  const openIds: Record<number, string> = { 1: "dev-user-001", 1282: "dev-user-1282" };
  const emails: Record<number, string> = { 1: "demo@remitflow.app", 1282: "emeka@remitflow.test" };
  return {
    user: {
      id: userId,
      openId: openIds[userId] ?? `test-user-${userId}`,
      email: emails[userId] ?? `test${userId}@remitflow.com`,
      name: `Test User ${userId}`,
      loginMethod: "keycloak",
      role: "admin" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const caller = appRouter.createCaller(createCtx());

describe("Golden Path: Send Transfer", () => {
  it("should get transfer quote with fee calculation", async () => {
    const quote = await caller.transferCore.quote({
      amount: 100,
      fromCurrency: "USD",
      toCurrency: "NGN",
      payoutMethod: "wallet",
    });
    expect(quote).toHaveProperty("fee");
    expect(quote).toHaveProperty("fxRate");
    expect(quote).toHaveProperty("receiveAmount");
    expect(quote.fee).toBeGreaterThan(0);
  });

  it("should execute transfer and return completed status", async () => {
    const result = await caller.transferCore.send({
      recipientId: 1282,
      amount: 10,
      fromCurrency: "USD",
      toCurrency: "NGN",
      payoutMethod: "wallet",
      beneficiaryName: "Test Recipient",
      beneficiaryAccount: "1234567890",
      purpose: "Family support",
      sourceOfFunds: "Salary",
    });
    expect(result.status).toBe("completed");
    expect(result.transferId).toMatch(/^TXN-/);
    expect(result.ledgerEntries.length).toBeGreaterThan(0);
  });

  it("should track transfer by reference ID", async () => {
    const result = await caller.transferCore.send({
      recipientId: 1282,
      amount: 5,
      fromCurrency: "USD",
      toCurrency: "NGN",
      payoutMethod: "wallet",
      beneficiaryName: "Track Test",
      beneficiaryAccount: "0000000001",
      purpose: "Test tracking",
      sourceOfFunds: "Salary",
    });
    const tracked = await caller.transferCore.track({ referenceId: result.referenceNumber });
    expect(tracked.found).toBe(true);
  });

  it("should calculate correct fee for USD-NGN", async () => {
    const quote = await caller.transferCore.quote({
      amount: 100,
      fromCurrency: "USD",
      toCurrency: "NGN",
    });
    // USD-NGN: flat $2.99 + 1.5% of $100 = $2.99 + $1.50 = $4.49
    expect(quote.fee).toBeCloseTo(4.49, 2);
  });
});

describe("Golden Path: Wallet Operations", () => {
  it("should list user wallets with balances", async () => {
    const wallets = await caller.wallet.list();
    expect(Array.isArray(wallets)).toBe(true);
    expect(wallets.length).toBeGreaterThan(0);
    expect(wallets[0]).toHaveProperty("currency");
    expect(wallets[0]).toHaveProperty("balance");
  });

  it("should return wallet balances with USD equivalent", async () => {
    const balances = await caller.wallet.balances();
    expect(Array.isArray(balances)).toBe(true);
    if (balances.length > 0) {
      expect(balances[0]).toHaveProperty("usdEquivalent");
    }
  });

  it("should list wallet transaction history", async () => {
    const history = await caller.wallet.history();
    expect(Array.isArray(history)).toBe(true);
  });
});

describe("Golden Path: FX Conversion", () => {
  it("should return exchange rates from DB", async () => {
    const rates = await caller.fx.rates();
    expect(Array.isArray(rates)).toBe(true);
    expect(rates.length).toBeGreaterThan(0);
  });

  it("should provide rate in transfer quote", async () => {
    const quote = await caller.transferCore.quote({
      amount: 1000,
      fromCurrency: "USD",
      toCurrency: "NGN",
    });
    expect(quote.fxRate).toBeGreaterThan(1000); // USD-NGN should be >1000
    expect(quote.receiveAmount).toBeGreaterThan(quote.sendAmount);
  });

  it("should provide transfer history with FX info", async () => {
    const history = await caller.transferCore.history({ limit: 5, offset: 0, status: "all" });
    expect(history).toHaveProperty("transfers");
    expect(history).toHaveProperty("total");
  });
});

describe("Golden Path: Bill Payment", () => {
  it("should list bill payment categories", async () => {
    const categories = await caller.bills.categories();
    expect(Array.isArray(categories)).toBe(true);
    expect(categories[0]).toHaveProperty("name");
    expect(categories[0]).toHaveProperty("providers");
  });
});

describe("Golden Path: P2P Request Money", () => {
  it("should list beneficiaries for P2P", async () => {
    const beneficiaries = await caller.beneficiaries.list();
    expect(Array.isArray(beneficiaries)).toBe(true);
  });

  it("should get user's KYC tier and transfer limits", async () => {
    const limits = await caller.transferCore.limits();
    expect(limits).toHaveProperty("tier");
    expect(limits).toHaveProperty("limits");
    expect(limits.limits.daily).toBeGreaterThan(0);
  });
});
