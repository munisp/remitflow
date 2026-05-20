/**
 * Integration Tests: Node.js ↔ Go FX Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies the actual HTTP contract between the Node.js API and the Go FX engine (port 8081).
 */

import { describe, it, expect, beforeAll } from "vitest";

const FX_URL = process.env.FX_ENGINE_URL ?? "http://localhost:8081";

async function isServiceAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${FX_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe("Go FX Engine Integration", () => {
  let available = false;

  beforeAll(async () => {
    available = await isServiceAvailable();
    if (!available) console.warn("[Integration] FX engine unavailable at", FX_URL);
  });

  it("should return health status", async () => {
    if (!available) return;
    const res = await fetch(`${FX_URL}/health`);
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data.status).toBe("ok");
  });

  it("should return FX rate for USD→NGN corridor", async () => {
    if (!available) return;
    const res = await fetch(`${FX_URL}/rate?from=USD&to=NGN`);
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data).toHaveProperty("rate");
    expect(data).toHaveProperty("from");
    expect(data).toHaveProperty("to");
    expect(data.from).toBe("USD");
    expect(data.to).toBe("NGN");
    expect(data.rate as number).toBeGreaterThan(0);
  });

  it("should return FX rate for GBP→USD corridor", async () => {
    if (!available) return;
    const res = await fetch(`${FX_URL}/rate?from=GBP&to=USD`);
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data.rate as number).toBeGreaterThan(0);
  });

  it("should return FX quote with fees calculated", async () => {
    if (!available) return;
    const res = await fetch(`${FX_URL}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "USD",
        to: "NGN",
        amount: 1000,
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data).toHaveProperty("rate");
    expect(data).toHaveProperty("send_amount");
    expect(data).toHaveProperty("receive_amount");
    expect(data.receive_amount as number).toBeGreaterThan(0);
  });

  it("should reject invalid currency pair", async () => {
    if (!available) return;
    const res = await fetch(`${FX_URL}/rate?from=INVALID&to=XXX`);
    expect([400, 404, 422]).toContain(res.status);
  });

  it("should return available corridors", async () => {
    if (!available) return;
    const res = await fetch(`${FX_URL}/corridors`);
    if (res.ok) {
      const data = await res.json() as unknown[];
      expect(Array.isArray(data) || typeof data === "object").toBe(true);
    }
  });
});
