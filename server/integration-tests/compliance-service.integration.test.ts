/**
 * Integration Tests: Node.js ↔ Python Compliance Service
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These tests verify the actual HTTP contract between the Node.js API
 * and the Python compliance microservice (port 8083).
 *
 * Run with: npx vitest run server/integration-tests/
 * Requires: python compliance service running on localhost:8083
 */

import { describe, it, expect, beforeAll } from "vitest";

const COMPLIANCE_URL = process.env.COMPLIANCE_SERVICE_URL ?? "http://localhost:8083";

async function isServiceAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${COMPLIANCE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe("Python Compliance Service Integration", () => {
  let serviceAvailable = false;

  beforeAll(async () => {
    serviceAvailable = await isServiceAvailable();
    if (!serviceAvailable) {
      console.warn("[Integration] Compliance service unavailable at", COMPLIANCE_URL, "— tests will be skipped");
    }
  });

  // ── Health Check ─────────────────────────────────────────────────────────
  it("should return healthy status with version 2.0.0", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/health`);
    const data = await res.json() as Record<string, unknown>;
    expect(data.status).toBe("ok");
    expect(data.version).toBe("2.0.0");
    expect(data).toHaveProperty("sanctions_entries");
    expect(data).toHaveProperty("redis_connected");
  });

  // ── Compliance Check: Approved ───────────────────────────────────────────
  it("should approve a normal low-risk transfer", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/compliance/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transfer_id: "TXN-INT-001",
        user_id: 100,
        amount: 500,
        from_currency: "USD",
        to_currency: "NGN",
        from_country: "US",
        to_country: "NG",
        kyc_status: "verified",
        account_age_days: 365,
        daily_total_usd: 0,
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data.decision).toBe("approved");
    expect(data.risk_level).toBe("low");
    expect(data.transfer_id).toBe("TXN-INT-001");
    expect(data).toHaveProperty("checksum");
    expect(data).toHaveProperty("timestamp");
  });

  // ── Compliance Check: Blocked (sanctioned country) ──────────────────────
  it("should block transfers to sanctioned countries", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/compliance/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transfer_id: "TXN-INT-002",
        user_id: 101,
        amount: 100,
        from_currency: "USD",
        to_currency: "KPW",
        from_country: "US",
        to_country: "KP",
        kyc_status: "verified",
        account_age_days: 365,
        daily_total_usd: 0,
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data.decision).toBe("blocked");
    expect(data.risk_level).toBe("critical");
    expect((data.rules_triggered as string[]).includes("CR002")).toBe(true);
    expect(data.block_reason).toContain("sanctioned");
  });

  // ── Compliance Check: Review (large amount) ─────────────────────────────
  it("should flag large transfers for review with EDD required", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/compliance/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transfer_id: "TXN-INT-003",
        user_id: 102,
        amount: 15000,
        from_currency: "GBP",
        to_currency: "NGN",
        from_country: "GB",
        to_country: "NG",
        kyc_status: "verified",
        account_age_days: 365,
        daily_total_usd: 0,
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data.decision).toBe("review");
    expect(data.requires_edd).toBe(true);
    expect((data.rules_triggered as string[]).includes("CR001")).toBe(true);
  });

  // ── Compliance Check: Blocked (unverified KYC) ──────────────────────────
  it("should block unverified users attempting large transfers", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/compliance/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transfer_id: "TXN-INT-004",
        user_id: 103,
        amount: 1000,
        from_currency: "USD",
        to_currency: "NGN",
        from_country: "US",
        to_country: "NG",
        kyc_status: "pending",
        account_age_days: 10,
        daily_total_usd: 0,
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data.decision).toBe("blocked");
    expect((data.rules_triggered as string[]).includes("CR007")).toBe(true);
  });

  // ── Compliance Check: Structuring detection ─────────────────────────────
  it("should detect potential structuring (amount near $10k threshold)", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/compliance/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transfer_id: "TXN-INT-005",
        user_id: 104,
        amount: 9800,
        from_currency: "USD",
        to_currency: "GBP",
        from_country: "US",
        to_country: "GB",
        kyc_status: "verified",
        account_age_days: 365,
        daily_total_usd: 0,
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect((data.rules_triggered as string[]).includes("CR004")).toBe(true);
  });

  // ── Compliance Check: Velocity limit exceeded ───────────────────────────
  it("should block when daily velocity limit is exceeded", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/compliance/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transfer_id: "TXN-INT-006",
        user_id: 105,
        amount: 5000,
        from_currency: "USD",
        to_currency: "NGN",
        from_country: "US",
        to_country: "NG",
        kyc_status: "verified",
        account_age_days: 365,
        daily_total_usd: 48000,
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data.decision).toBe("blocked");
    expect((data.rules_triggered as string[]).includes("CR005")).toBe(true);
  });

  // ── Fraud Score: Low risk ───────────────────────────────────────────────
  it("should return low fraud score for normal transaction", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/fraud/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transfer_id: "TXN-INT-007",
        user_id: 200,
        amount: 500,
        from_country: "US",
        to_country: "GB",
        kyc_status: "verified",
        account_age_days: 365,
        is_new_beneficiary: false,
        is_new_device: false,
        failed_attempts_24h: 0,
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data.decision).toBe("approve");
    expect(data.risk_level).toBe("low");
    expect(data.fraud_score as number).toBeLessThan(0.25);
    expect(data).toHaveProperty("factors");
  });

  // ── Fraud Score: High risk ──────────────────────────────────────────────
  it("should return high fraud score for suspicious transaction", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/fraud/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transfer_id: "TXN-INT-008",
        user_id: 201,
        amount: 50000,
        from_country: "US",
        to_country: "AF",
        kyc_status: "pending",
        account_age_days: 3,
        is_new_beneficiary: true,
        is_new_device: true,
        failed_attempts_24h: 6,
        hour_of_day: 3,
        ip_country: "RU",
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(["block", "review"]).toContain(data.decision);
    expect(["high", "critical"]).toContain(data.risk_level);
    expect(data.fraud_score as number).toBeGreaterThan(0.45);
  });

  // ── Sanctions Screening: Clean name ─────────────────────────────────────
  it("should clear a non-sanctioned name", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/sanctions/screen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "John Smith",
        country: "US",
        entity_type: "individual",
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data.action).toBe("allow");
    expect(data.is_sanctioned).toBe(false);
    expect(data.risk_level).toBe("low");
  });

  // ── Sanctions Screening: Sanctioned country ─────────────────────────────
  it("should flag entities from sanctioned countries", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/sanctions/screen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Kim Jong Un",
        country: "KP",
        entity_type: "individual",
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data.action).toBe("block");
    expect(data.risk_level).toBe("critical");
  });

  // ── Velocity Check ──────────────────────────────────────────────────────
  it("should allow velocity check within limits", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/velocity/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: 300,
        amount_usd: 1000,
        window_seconds: 86400,
        limit_usd: 50000,
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data.allowed).toBe(true);
    expect(data).toHaveProperty("current_total");
    expect(data).toHaveProperty("remaining");
    expect(data).toHaveProperty("storage_backend");
  });

  // ── Compliance Rules ────────────────────────────────────────────────────
  it("should return compliance rules including CR009 (sanctions screening)", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/compliance/rules`);
    expect(res.ok).toBe(true);
    const data = await res.json() as { rules: Array<{ id: string; active: boolean }>; total: number };
    expect(data.total).toBeGreaterThanOrEqual(9);
    const cr009 = data.rules.find(r => r.id === "CR009");
    expect(cr009).toBeDefined();
    expect(cr009?.active).toBe(true);
  });

  // ── Sanctions Statistics ────────────────────────────────────────────────
  it("should return sanctions list statistics", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/sanctions/stats`);
    expect(res.ok).toBe(true);
    const data = await res.json() as Record<string, unknown>;
    expect(data).toHaveProperty("total_entries");
    expect(data).toHaveProperty("last_refresh");
    expect(data).toHaveProperty("feeds");
    expect(data).toHaveProperty("refresh_interval_secs");
  });

  // ── Prometheus Metrics ──────────────────────────────────────────────────
  it("should expose Prometheus metrics", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/metrics`);
    expect(res.ok).toBe(true);
    const text = await res.text();
    expect(text).toContain("remitflow_compliance_checks_total");
    expect(text).toContain("remitflow_sanctions_screens_total");
    expect(text).toContain("remitflow_sanctions_entries_total");
  });

  // ── Input Validation ────────────────────────────────────────────────────
  it("should reject invalid compliance request (negative amount)", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/compliance/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transfer_id: "TXN-INT-BAD",
        user_id: 999,
        amount: -100,
        from_currency: "USD",
        to_currency: "NGN",
        from_country: "US",
        to_country: "NG",
      }),
    });
    expect(res.status).toBe(422);
  });

  it("should reject invalid currency codes", async () => {
    if (!serviceAvailable) return;
    const res = await fetch(`${COMPLIANCE_URL}/compliance/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transfer_id: "TXN-INT-BAD2",
        user_id: 999,
        amount: 100,
        from_currency: "TOOLONG",
        to_currency: "N",
        from_country: "US",
        to_country: "NG",
      }),
    });
    expect(res.status).toBe(422);
  });
});
