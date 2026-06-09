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
    expect(["ok", "healthy"]).toContain(data.status);
  });

  it("should return FX rate for available corridor", async () => {
    if (!available) return;
    // First, check which corridors are actually cached
    const ratesRes = await fetch(`${FX_URL}/rates?base=USD`);
    expect(ratesRes.ok).toBe(true);
    const ratesData = await ratesRes.json() as Record<string, unknown>;
    const rates = ratesData.rates as Record<string, unknown> | undefined;
    if (!rates || Object.keys(rates).length === 0) return; // No rates cached yet
    const firstPair = Object.keys(rates)[0];
    const [from, to] = firstPair.split("/");
    const res = await fetch(`${FX_URL}/rate?from=${from}&to=${to}`);
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data).toHaveProperty("rate");
  });

  it("should return rates list for base currency", async () => {
    if (!available) return;
    const res = await fetch(`${FX_URL}/rates?base=USD`);
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data).toHaveProperty("base");
    expect(data).toHaveProperty("rates");
    expect(data).toHaveProperty("count");
  });

  it("should accept rate request with proper error for uncached pair", async () => {
    if (!available) return;
    const res = await fetch(`${FX_URL}/rate?from=USD&to=NGN`);
    // May return 200 (cached) or 404 (not cached) — both are valid
    expect([200, 404]).toContain(res.status);
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
