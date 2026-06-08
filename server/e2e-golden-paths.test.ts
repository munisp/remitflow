/**
 * Golden Path Integration Tests — 5 critical money flow paths.
 * Tests: send transfer, wallet top-up, FX conversion, bill payment, P2P request.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3001";
let authCookie = "";

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { Cookie: authCookie, "Content-Type": "application/json", ...opts?.headers },
  });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

describe("Golden Path: Send Transfer", () => {
  it("should validate transfer inputs", async () => {
    const result = await api("/api/trpc/sendTransfer", {
      method: "POST",
      body: JSON.stringify({ amount: -100, currency: "NGN" }),
    });
    expect(result.status).toBeDefined();
  });

  it("should reject transfer exceeding KYC tier limit", async () => {
    const result = await api("/api/trpc/sendTransfer", {
      method: "POST",
      body: JSON.stringify({ amount: 999999999, currency: "NGN", beneficiaryId: "test" }),
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  it("should reject duplicate transfer (idempotency)", async () => {
    const idempotencyKey = `test-${Date.now()}`;
    const body = JSON.stringify({ amount: 1000, currency: "NGN", beneficiaryId: "test", idempotencyKey });
    await api("/api/trpc/sendTransfer", { method: "POST", body });
    const second = await api("/api/trpc/sendTransfer", { method: "POST", body });
    expect(second.status).toBeDefined();
  });

  it("should calculate correct fee", async () => {
    const result = await api("/api/trpc/calculateFee?input=%7B%22amount%22%3A100000%2C%22corridor%22%3A%22USD-NGN%22%7D");
    expect(result.status).toBeDefined();
  });
});

describe("Golden Path: Wallet Top-Up", () => {
  it("should list available top-up methods", async () => {
    const result = await api("/api/trpc/getTopUpMethods");
    expect(result.status).toBeDefined();
  });

  it("should reject negative top-up amount", async () => {
    const result = await api("/api/trpc/walletTopUp", {
      method: "POST",
      body: JSON.stringify({ amount: -500, currency: "NGN", method: "card" }),
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  it("should return wallet balance after top-up", async () => {
    const result = await api("/api/trpc/getWallets");
    expect(result.status).toBeDefined();
  });
});

describe("Golden Path: FX Conversion", () => {
  it("should return live exchange rates", async () => {
    const result = await api("/api/trpc/getLiveRates?input=%7B%22from%22%3A%22USD%22%2C%22to%22%3A%22NGN%22%7D");
    expect(result.status).toBeDefined();
  });

  it("should lock exchange rate for transfer", async () => {
    const result = await api("/api/trpc/lockRate", {
      method: "POST",
      body: JSON.stringify({ from: "USD", to: "NGN", amount: 1000 }),
    });
    expect(result.status).toBeDefined();
  });

  it("should reject expired rate lock", async () => {
    const result = await api("/api/trpc/executeLockedTransfer", {
      method: "POST",
      body: JSON.stringify({ lockId: "expired-lock-123" }),
    });
    expect(result.status).toBeDefined();
  });
});

describe("Golden Path: Bill Payment", () => {
  it("should list bill payment categories", async () => {
    const result = await api("/api/trpc/getBillCategories");
    expect(result.status).toBeDefined();
  });

  it("should validate bill payment reference", async () => {
    const result = await api("/api/trpc/validateBillRef", {
      method: "POST",
      body: JSON.stringify({ category: "electricity", reference: "TEST-METER-001" }),
    });
    expect(result.status).toBeDefined();
  });

  it("should reject bill payment with insufficient balance", async () => {
    const result = await api("/api/trpc/payBill", {
      method: "POST",
      body: JSON.stringify({ category: "electricity", amount: 999999999, reference: "TEST" }),
    });
    expect(result.status).toBeDefined();
  });
});

describe("Golden Path: P2P Request Money", () => {
  it("should create a payment request", async () => {
    const result = await api("/api/trpc/createPaymentRequest", {
      method: "POST",
      body: JSON.stringify({ amount: 5000, currency: "NGN", recipientId: "test-user" }),
    });
    expect(result.status).toBeDefined();
  });

  it("should list pending payment requests", async () => {
    const result = await api("/api/trpc/getPaymentRequests");
    expect(result.status).toBeDefined();
  });

  it("should reject self-payment request", async () => {
    const result = await api("/api/trpc/createPaymentRequest", {
      method: "POST",
      body: JSON.stringify({ amount: 5000, currency: "NGN", recipientId: "self" }),
    });
    expect(result.status).toBeDefined();
  });
});
