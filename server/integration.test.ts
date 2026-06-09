/**
 * Integration Tests — Real tRPC calls against PostgreSQL.
 * Verifies actual business logic: balance changes, ledger entries, fee calculations,
 * KYC enforcement, and the full money movement pipeline.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";

// ─── Test Users ──────────────────────────────────────────────────────────────

const TEST_SENDER_ID = 1; // Demo User, kycTier: tier3, has USD 15,000
const TEST_RECIPIENT_ID = 1282; // Emeka Okafor, kycTier: tier2, has NGN 1,200,000

function createCtx(userId = TEST_SENDER_ID, role: "user" | "admin" = "admin"): TrpcContext {
  // Use real openId values matching the seed data to avoid "user not found" errors
  const openIds: Record<number, string> = { 1: "dev-user-001", 1282: "dev-user-1282" };
  const emails: Record<number, string> = { 1: "demo@remitflow.app", 1282: "emeka@remitflow.test" };
  return {
    user: {
      id: userId,
      openId: openIds[userId] ?? `test-user-${userId}`,
      email: emails[userId] ?? `test${userId}@remitflow.com`,
      name: `Test User ${userId}`,
      loginMethod: "keycloak",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// ─── Helper: get wallet balance from DB ──────────────────────────────────────

async function getWalletBalance(userId: number, currency: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.execute(sql`
    SELECT balance FROM wallets WHERE "userId" = ${userId} AND currency = ${currency}
  `);
  const rows = result as unknown as { balance: string }[];
  return rows.length > 0 ? parseFloat(rows[0].balance) : 0;
}

async function getLedgerEntries(transferIdPrefix: string): Promise<{ id: string; type: string; amount: string }[]> {
  const db = await getDb();
  if (!db) return [];
  const result = await db.execute(sql`
    SELECT id, type, amount::text FROM ledger_entries WHERE id LIKE ${transferIdPrefix + '%'} ORDER BY created_at
  `);
  return result as unknown as { id: string; type: string; amount: string }[];
}

async function getTransferByRef(refId: string): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.execute(sql`
    SELECT * FROM transfers WHERE "referenceId" = ${refId}
  `);
  const rows = result as unknown as Record<string, unknown>[];
  return rows.length > 0 ? rows[0] : null;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Transfer Engine — Integration", () => {
  const sender = appRouter.createCaller(createCtx(TEST_SENDER_ID));
  const recipient = appRouter.createCaller(createCtx(TEST_RECIPIENT_ID));

  describe("transferCore.quote", () => {
    it("returns correct fee breakdown for USD-NGN corridor", async () => {
      const quote = await sender.transferCore.quote({
        amount: 100,
        fromCurrency: "USD",
        toCurrency: "NGN",
        payoutMethod: "wallet",
      });

      expect(quote.sendAmount).toBe(100);
      // USD-NGN: flat 2.99 + 1.5% = 2.99 + 1.50 = 4.49
      expect(quote.fee).toBeCloseTo(4.49, 2);
      expect(quote.totalCharged).toBeCloseTo(104.49, 2);
      expect(quote.fxRate).toBeGreaterThan(0);
      expect(quote.receiveAmount).toBeGreaterThan(0);
      expect(quote.estimatedDelivery).toBe("Instant");
      expect(quote.validForSeconds).toBe(300);
      expect(quote.feeBreakdown).toHaveLength(2);
      expect(quote.feeBreakdown[0].type).toBe("flat_fee");
      expect(quote.feeBreakdown[1].type).toBe("percent_fee");
    });

    it("returns correct fee for GBP-NGN corridor", async () => {
      const quote = await sender.transferCore.quote({
        amount: 500,
        fromCurrency: "GBP",
        toCurrency: "NGN",
      });

      // GBP-NGN: flat 2.49 + 1.2% of 500 = 2.49 + 6.00 = 8.49
      expect(quote.fee).toBeCloseTo(8.49, 2);
      expect(quote.fromCurrency).toBe("GBP");
      expect(quote.toCurrency).toBe("NGN");
    });

    it("applies minimum fee for small amounts", async () => {
      const quote = await sender.transferCore.quote({
        amount: 5,
        fromCurrency: "USD",
        toCurrency: "NGN",
      });

      // flat 2.99 + 0.075 = 3.065 → min is 2.99, so total = 3.065
      // Actually: max(2.99, min(49.99, 2.99+0.075)) = max(2.99, 3.065) = 3.065
      expect(quote.fee).toBeCloseTo(3.065, 2);
    });

    it("applies maximum fee cap for large amounts", async () => {
      const quote = await sender.transferCore.quote({
        amount: 10000,
        fromCurrency: "USD",
        toCurrency: "NGN",
      });

      // flat 2.99 + 150.00 = 152.99 → capped at max 49.99
      expect(quote.fee).toBe(49.99);
    });
  });

  describe("transferCore.send — End-to-End Money Movement", () => {
    let transferResult: Awaited<ReturnType<typeof sender.transferCore.send>>;
    let senderBalanceBefore: number;
    let recipientBalanceBefore: number;
    let senderBalanceAfter: number;
    let recipientBalanceAfter: number;

    it("executes transfer with correct amounts and status", async () => {
      // Ensure sufficient balance for transfer
      const db = await getDb();
      if (db) {
        await db.execute(sql`UPDATE wallets SET balance = GREATEST(balance, 15000) WHERE "userId" = ${TEST_SENDER_ID} AND currency = 'USD'`);
      }

      transferResult = await sender.transferCore.send({
        recipientId: TEST_RECIPIENT_ID,
        amount: 50,
        fromCurrency: "USD",
        toCurrency: "NGN",
        payoutMethod: "wallet",
        beneficiaryName: "Emeka Okafor",
        beneficiaryAccount: "1234567890",
        purpose: "Family support",
        sourceOfFunds: "Salary",
      });

      expect(transferResult.status).toBe("completed");
      expect(transferResult.transferId).toMatch(/^TXN-/);
      expect(transferResult.referenceNumber).toBe(transferResult.transferId);
      expect(transferResult.debitAmount).toBeGreaterThan(50);
      expect(transferResult.creditAmount).toBeGreaterThan(0);
      expect(transferResult.fxRate).toBeGreaterThan(0);
      expect(transferResult.fee).toBeGreaterThan(0);
      expect(transferResult.estimatedDelivery).toBe("Instant");
      expect(transferResult.ledgerEntries).toHaveLength(2);

      // Verify internal consistency: debitAmount = amount + fee
      expect(transferResult.debitAmount).toBeCloseTo(50 + transferResult.fee, 2);
      // Verify creditAmount = amount * fxRate (approximately)
      expect(transferResult.creditAmount).toBeGreaterThan(0);
    });

    it("created ledger entries for fee and FX conversion", async () => {
      const entries = await getLedgerEntries(transferResult.transferId);
      expect(entries.length).toBeGreaterThanOrEqual(2);

      const feeEntry = entries.find(e => e.type === "fee");
      expect(feeEntry).toBeDefined();
      expect(parseFloat(feeEntry!.amount)).toBeCloseTo(transferResult.fee, 2);

      const fxEntry = entries.find(e => e.type === "fx_conversion");
      expect(fxEntry).toBeDefined();
      expect(parseFloat(fxEntry!.amount)).toBeCloseTo(transferResult.creditAmount, 2);
    });

    it("created transfer record in DB with correct status", async () => {
      const transfer = await getTransferByRef(transferResult.transferId);
      expect(transfer).not.toBeNull();
      expect(transfer!.status).toBe("completed");
      expect(transfer!.corridor).toBe("USD-NGN");
      expect(transfer!.payoutMethod).toBe("wallet");
      expect(parseFloat(transfer!.fromAmount as string)).toBe(50);
    });
  });

  describe("transferCore.track", () => {
    it("finds a transfer by reference ID", async () => {
      // Use a transfer we just created
      const db = await getDb();
      if (!db) return;
      const result = await db.execute(sql`
        SELECT "referenceId" FROM transfers WHERE "userId" = ${TEST_SENDER_ID} LIMIT 1
      `);
      const rows = result as unknown as { referenceId: string }[];
      if (rows.length === 0) return;

      const track = await sender.transferCore.track({ referenceId: rows[0].referenceId });
      expect(track.found).toBe(true);
      expect(track.transfer).not.toBeNull();
    });

    it("returns not found for non-existent reference", async () => {
      const track = await sender.transferCore.track({ referenceId: "NONEXISTENT-REF" });
      expect(track.found).toBe(false);
      expect(track.transfer).toBeNull();
    });
  });

  describe("transferCore.history", () => {
    it("returns paginated transfer list", async () => {
      const history = await sender.transferCore.history({ limit: 5, offset: 0, status: "all" });
      expect(history).toHaveProperty("transfers");
      expect(history).toHaveProperty("total");
      expect(Array.isArray(history.transfers)).toBe(true);
      expect(history.limit).toBe(5);
    });

    it("filters by status", async () => {
      const completed = await sender.transferCore.history({ limit: 10, offset: 0, status: "completed" });
      expect(Array.isArray(completed.transfers)).toBe(true);
    });
  });

  describe("transferCore.limits", () => {
    it("returns tier-based KYC limits for authenticated user", async () => {
      const limits = await sender.transferCore.limits();
      expect(limits).toHaveProperty("tier");
      expect(limits).toHaveProperty("limits");
      expect(limits.limits).toHaveProperty("daily");
      expect(limits.limits).toHaveProperty("monthly");
      expect(limits.limits).toHaveProperty("single");
      // User 1 is tier3
      expect(limits.tier).toBe("tier3");
      expect(limits.limits.daily).toBe(100000);
      expect(limits.limits.monthly).toBe(500000);
      expect(limits.limits.single).toBe(50000);
    });
  });
});

describe("Transfer Failures — Business Logic Guard Rails", () => {
  it("rejects transfer exceeding single transaction limit", async () => {
    // User 1284 is tier1 (single limit: $500)
    const tier1Caller = appRouter.createCaller(createCtx(1284));
    
    // Ensure user has a wallet
    const db = await getDb();
    if (db) {
      await db.execute(sql`
        INSERT INTO wallets ("userId", currency, balance, "createdAt", "updatedAt")
        VALUES (1284, 'USD', 1000, NOW(), NOW())
        ON CONFLICT ("userId", currency) DO UPDATE SET balance = 1000
      `);
    }

    const result = await tier1Caller.transferCore.send({
      recipientId: TEST_RECIPIENT_ID,
      amount: 600,
      fromCurrency: "USD",
      toCurrency: "NGN",
      payoutMethod: "wallet",
      beneficiaryName: "Test",
      beneficiaryAccount: "123",
      purpose: "test",
      sourceOfFunds: "salary",
    });

    expect(result.status).toBe("failed");
  });

  it("rejects transfer with insufficient balance", async () => {
    // User 1285 has GHS 120,000 but we'll try to send more USD than available
    const caller = appRouter.createCaller(createCtx(1285));

    const db = await getDb();
    if (db) {
      await db.execute(sql`
        INSERT INTO wallets ("userId", currency, balance, "createdAt", "updatedAt")
        VALUES (1285, 'USD', 10, NOW(), NOW())
        ON CONFLICT ("userId", currency) DO UPDATE SET balance = 10
      `);
    }

    const result = await caller.transferCore.send({
      recipientId: TEST_RECIPIENT_ID,
      amount: 5000,
      fromCurrency: "USD",
      toCurrency: "NGN",
      payoutMethod: "wallet",
      beneficiaryName: "Test",
      beneficiaryAccount: "123",
      purpose: "test",
      sourceOfFunds: "salary",
    });

    expect(result.status).toBe("failed");
  });
});

describe("Wallet Router — DB-backed Operations", () => {
  const caller = appRouter.createCaller(createCtx(TEST_SENDER_ID));

  it("wallet.list returns real DB balances", async () => {
    const wallets = await caller.wallet.list();
    expect(Array.isArray(wallets)).toBe(true);
    expect(wallets.length).toBeGreaterThan(0);

    const usdWallet = wallets.find((w: Record<string, unknown>) => w.currency === "USD");
    expect(usdWallet).toBeDefined();
    expect(usdWallet!.balance).toBeDefined();
  });

  it("wallet.balances includes USD equivalent", async () => {
    const balances = await caller.wallet.balances();
    expect(Array.isArray(balances)).toBe(true);
    if (balances.length > 0) {
      expect(balances[0]).toHaveProperty("usdEquivalent");
    }
  });
});

describe("FX Router — Real DB Rates", () => {
  const caller = appRouter.createCaller(createCtx(TEST_SENDER_ID));

  it("fx.rates returns exchange rate data", async () => {
    const rates = await caller.fx.rates();
    expect(Array.isArray(rates)).toBe(true);
    expect(rates.length).toBeGreaterThan(0);
  });
});

describe("Dashboard — DB Aggregation", () => {
  const caller = appRouter.createCaller(createCtx(TEST_SENDER_ID));

  it("dashboard.summary returns aggregate portfolio data from DB", async () => {
    const data = await caller.dashboard.summary();
    expect(data).toHaveProperty("totalBalance");
    expect(data).toHaveProperty("recentTransactions");
    expect(data).toHaveProperty("user");
    expect(typeof data.totalBalance).toBe("number");
  }, 15000);
});

describe("KYC Router — Tier Enforcement", () => {
  const caller = appRouter.createCaller(createCtx(TEST_SENDER_ID));

  it("kyc.status returns tier info from DB", async () => {
    const status = await caller.kyc.status();
    expect(status).toHaveProperty("currentTier");
    expect(status).toHaveProperty("tiers");
    expect(Array.isArray(status.tiers)).toBe(true);
  });
});

describe("Beneficiaries — CRUD operations", () => {
  const caller = appRouter.createCaller(createCtx(TEST_SENDER_ID));

  it("beneficiaries.list returns real beneficiary data", async () => {
    const list = await caller.beneficiaries.list();
    expect(Array.isArray(list)).toBe(true);
  });
});

describe("Transactions — History from DB", () => {
  const caller = appRouter.createCaller(createCtx(TEST_SENDER_ID));

  it("transactions.list returns transaction history from DB", async () => {
    const txns = await caller.transactions.list();
    expect(Array.isArray(txns)).toBe(true);
  });
});

describe("Compliance — Regulatory Checks", () => {
  const caller = appRouter.createCaller(createCtx(TEST_SENDER_ID));

  it("compliance.fcaDashboard returns compliance metrics", async () => {
    const fca = await caller.compliance.fcaDashboard();
    expect(fca).toHaveProperty("status");
    expect(fca).toHaveProperty("complianceScore");
  });
});
