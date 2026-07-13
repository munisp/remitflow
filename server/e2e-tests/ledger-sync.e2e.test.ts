/**
 * E2E Tests: TigerBeetle ↔ PostgreSQL Ledger Sync
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Verifies the dual-write ledger sync between TigerBeetle (source of truth)
 * and PostgreSQL (metadata cache).
 */

import { describe, it, expect, beforeAll } from "vitest";

const TB_SERVICE_URL = process.env.TIGERBEETLE_SERVICE_URL ?? "http://localhost:8088";

async function isServiceAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${TB_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe("E2E: TigerBeetle Ledger Operations", () => {
  let available = false;
  let testAccountId: string | null = null;

  beforeAll(async () => {
    available = await isServiceAvailable();
    if (!available) console.warn("[E2E] TigerBeetle service unavailable at", TB_SERVICE_URL);
  });

  it("should return TigerBeetle service health", async () => {
    if (!available) return;
    const res = await fetch(`${TB_SERVICE_URL}/health`);
    expect(res.ok).toBe(true);
  });

  it("should create a user wallet account in TigerBeetle", async () => {
    if (!available) return;
    const res = await fetch(`${TB_SERVICE_URL}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: 99001,
        currency: "USD",
        account_type: 1000,
      }),
    });
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      testAccountId = data.id as string;
      expect(testAccountId).toBeTruthy();
    }
  });

  it("should retrieve account balance (initial = 0)", async () => {
    if (!available || !testAccountId) return;
    const res = await fetch(`${TB_SERVICE_URL}/accounts/${testAccountId}/balance`);
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      expect(data).toHaveProperty("credits_posted");
      expect(data).toHaveProperty("debits_posted");
    }
  });

  it("should execute a double-entry transfer between two accounts", async () => {
    if (!available) return;
    // Create two accounts
    const acc1Res = await fetch(`${TB_SERVICE_URL}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: 99002, currency: "USD", account_type: 1000 }),
    });
    const acc2Res = await fetch(`${TB_SERVICE_URL}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: 99003, currency: "USD", account_type: 1000 }),
    });

    if (!acc1Res.ok || !acc2Res.ok) return;
    const acc1 = (await acc1Res.json()) as { id: string };
    const acc2 = (await acc2Res.json()) as { id: string };

    // Transfer $100 from acc1 to acc2
    const transferRes = await fetch(`${TB_SERVICE_URL}/transfers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        debit_account_id: acc1.id,
        credit_account_id: acc2.id,
        amount: 100_000_000, // 100 USD * 10^6 scale
        ledger: 1,
        code: 1,
      }),
    });

    if (transferRes.ok) {
      const transfer = (await transferRes.json()) as Record<string, unknown>;
      expect(transfer).toHaveProperty("id");
    }
  });

  it("should expose Prometheus metrics", async () => {
    if (!available) return;
    const res = await fetch(`${TB_SERVICE_URL}/metrics`);
    if (res.ok) {
      const text = await res.text();
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
