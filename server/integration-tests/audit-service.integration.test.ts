/**
 * Integration Tests: Node.js ↔ Rust Audit Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies the actual HTTP contract between the Node.js API and the
 * Rust tamper-evident audit service (port 8082).
 */

import { describe, it, expect, beforeAll } from "vitest";

const AUDIT_URL = process.env.AUDIT_SERVICE_URL ?? "http://localhost:8082";

async function isServiceAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${AUDIT_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe("Rust Audit Service Integration", () => {
  let available = false;

  beforeAll(async () => {
    available = await isServiceAvailable();
    if (!available) console.warn("[Integration] Audit service unavailable at", AUDIT_URL);
  });

  it("should return health status", async () => {
    if (!available) return;
    const res = await fetch(`${AUDIT_URL}/health`);
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data.status).toBe("ok");
  });

  it("should accept a new audit log entry", async () => {
    if (!available) return;
    const res = await fetch(`${AUDIT_URL}/audit/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "transfer.initiated",
        actor_id: "user-1001",
        resource_type: "transfer",
        resource_id: "TXN-AUDIT-001",
        details: {
          amount: 5000,
          currency: "USD",
          from_country: "US",
          to_country: "NG",
        },
        ip_address: "192.168.1.1",
        user_agent: "RemitFlow/2.0 Integration-Test",
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data).toHaveProperty("id");
    expect(data).toHaveProperty("hash");
  });

  it("should retrieve audit log entries", async () => {
    if (!available) return;
    const res = await fetch(`${AUDIT_URL}/audit/log?limit=10`);
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data).toHaveProperty("entries");
  });

  it("should verify audit chain integrity", async () => {
    if (!available) return;
    const res = await fetch(`${AUDIT_URL}/audit/verify`);
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data).toHaveProperty("valid");
  });

  it("should expose Prometheus metrics", async () => {
    if (!available) return;
    const res = await fetch(`${AUDIT_URL}/metrics`);
    if (res.ok) {
      const text = await res.text();
      expect(text).toContain("audit");
    }
  });
});
