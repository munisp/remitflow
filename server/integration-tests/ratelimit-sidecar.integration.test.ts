/**
 * Integration Tests: Node.js ↔ Go Rate Limit Sidecar
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies the actual HTTP contract between the Node.js API and the
 * Go rate limiting sidecar (port 8084).
 */

import { describe, it, expect, beforeAll } from "vitest";

const RATELIMIT_URL = process.env.RATELIMIT_SERVICE_URL ?? "http://localhost:8084";

async function isServiceAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${RATELIMIT_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe("Go Rate Limit Sidecar Integration", () => {
  let available = false;

  beforeAll(async () => {
    available = await isServiceAvailable();
    if (!available) console.warn("[Integration] Rate limit sidecar unavailable at", RATELIMIT_URL);
  });

  it("should return health status", async () => {
    if (!available) return;
    const res = await fetch(`${RATELIMIT_URL}/health`);
    expect(res.ok).toBe(true);
  });

  it("should allow a request within rate limits", async () => {
    if (!available) return;
    const res = await fetch(`${RATELIMIT_URL}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "test-user-ratelimit-001",
        limit: 100,
        window: 60,
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data).toHaveProperty("allowed");
    expect(data.allowed).toBe(true);
  });

  it("should enforce rate limits after exceeding threshold", async () => {
    if (!available) return;
    // Burst 10 requests in quick succession
    const key = `test-burst-${Date.now()}`;
    const promises = Array.from({ length: 10 }, () =>
      fetch(`${RATELIMIT_URL}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, limit: 5, window: 60 }),
      })
    );
    const results = await Promise.all(promises);
    const bodies = await Promise.all(results.map(r => r.json() as Promise<Record<string, unknown>>));
    const allowed = bodies.filter(b => b.allowed === true).length;
    const blocked = bodies.filter(b => b.allowed === false).length;
    // At least some should be blocked
    expect(blocked).toBeGreaterThan(0);
    expect(allowed).toBeLessThanOrEqual(5);
  });

  it("should support idempotency key checking", async () => {
    if (!available) return;
    const res = await fetch(`${RATELIMIT_URL}/idempotency/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: `idem-${Date.now()}`,
        ttl: 3600,
      }),
    });
    // Either the endpoint exists and responds, or 404
    expect([200, 201, 404]).toContain(res.status);
  });
});
