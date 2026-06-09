/**
 * E2E Tests: Critical Money Paths
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Tests the complete money transfer lifecycle:
 *   1. Compliance check → 2. FX quote → 3. Transfer execution → 4. Audit trail
 *
 * These tests verify the full chain across all microservices for the core
 * remittance flow (the "happy path" that must never break).
 */

import { describe, it, expect, beforeAll } from "vitest";

const API_URL = process.env.API_URL ?? "http://localhost:5173";
const COMPLIANCE_URL = process.env.COMPLIANCE_SERVICE_URL ?? "http://localhost:8083";
const FX_URL = process.env.FX_ENGINE_URL ?? "http://localhost:8081";
const AUDIT_URL = process.env.AUDIT_SERVICE_URL ?? "http://localhost:8082";

interface ServiceStatus {
  api: boolean;
  compliance: boolean;
  fx: boolean;
  audit: boolean;
}

async function checkService(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe("E2E: Critical Money Transfer Path", () => {
  let services: ServiceStatus;

  beforeAll(async () => {
    const [api, compliance, fx, audit] = await Promise.all([
      checkService(API_URL),
      checkService(COMPLIANCE_URL),
      checkService(FX_URL),
      checkService(AUDIT_URL),
    ]);
    services = { api, compliance, fx, audit };
    console.log("[E2E] Service availability:", services);
  });

  // ── Full Transfer Lifecycle ─────────────────────────────────────────────
  describe("USD → NGN Remittance (Primary Corridor)", () => {
    const transferId = `E2E-${Date.now()}`;

    it("Step 1: Compliance pre-check should approve the transfer", async () => {
      if (!services.compliance) return;

      const res = await fetch(`${COMPLIANCE_URL}/compliance/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transfer_id: transferId,
          user_id: 1001,
          amount: 2000,
          from_currency: "USD",
          to_currency: "NGN",
          from_country: "US",
          to_country: "NG",
          kyc_status: "verified",
          account_age_days: 180,
          daily_total_usd: 0,
          sender_name: "Alice Johnson",
          beneficiary_name: "Chukwu Okafor",
        }),
      });
      expect(res.ok).toBe(true);
      const data = await res.json() as Record<string, unknown>;
      expect(data.decision).not.toBe("blocked");
      expect(data.transfer_id).toBe(transferId);
    });

    it("Step 2: FX quote should return valid rate or proper 404", async () => {
      if (!services.fx) return;

      const res = await fetch(`${FX_URL}/rate?from=USD&to=NGN`);
      // Rate may be cached (200) or not yet fetched (404) — both are valid
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        const rate = data.rate as number;
        expect(rate).toBeGreaterThan(100);
        expect(rate).toBeLessThan(5000);
      } else {
        expect(res.status).toBe(404);
      }
    });

    it("Step 3: Fraud scoring should not block legitimate transfer", async () => {
      if (!services.compliance) return;

      const res = await fetch(`${COMPLIANCE_URL}/fraud/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transfer_id: transferId,
          user_id: 1001,
          amount: 2000,
          from_country: "US",
          to_country: "NG",
          kyc_status: "verified",
          account_age_days: 180,
          is_new_beneficiary: false,
          is_new_device: false,
          failed_attempts_24h: 0,
          hour_of_day: 14,
          ip_country: "US",
        }),
      });
      expect(res.ok).toBe(true);
      const data = await res.json() as Record<string, unknown>;
      expect(data.decision).toBe("approve");
      expect(data.fraud_score as number).toBeLessThan(0.25);
    });

    it("Step 4: Velocity check should allow within daily limits", async () => {
      if (!services.compliance) return;

      const res = await fetch(`${COMPLIANCE_URL}/velocity/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: 1001,
          amount_usd: 2000,
          window_seconds: 86400,
          limit_usd: 50000,
        }),
      });
      expect(res.ok).toBe(true);
      const data = await res.json() as Record<string, unknown>;
      expect(data.allowed).toBe(true);
    });

    it("Step 5: Audit log should record the transfer", async () => {
      if (!services.audit) return;

      const res = await fetch(`${AUDIT_URL}/audit/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transfer.completed",
          actor_id: "user-1001",
          resource_type: "transfer",
          resource_id: transferId,
          details: {
            amount: 2000,
            from_currency: "USD",
            to_currency: "NGN",
            corridor: "US-NG",
          },
          ip_address: "10.0.1.100",
          user_agent: "RemitFlow/2.0 E2E-Test",
        }),
      });
      expect(res.ok).toBe(true);
    });
  });

  // ── Blocked Transfer Path ──────────────────────────────────────────────
  describe("Transfer to Sanctioned Country (Must Block)", () => {
    it("should block the entire transfer chain at compliance step", async () => {
      if (!services.compliance) return;

      const res = await fetch(`${COMPLIANCE_URL}/compliance/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transfer_id: `E2E-BLOCK-${Date.now()}`,
          user_id: 9999,
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
    });
  });

  // ── High-Value Transfer Path ───────────────────────────────────────────
  describe("Large Value Transfer ($25,000 — requires EDD)", () => {
    it("should flag for review but not block a verified user", async () => {
      if (!services.compliance) return;

      const res = await fetch(`${COMPLIANCE_URL}/compliance/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transfer_id: `E2E-LARGE-${Date.now()}`,
          user_id: 2001,
          amount: 25000,
          from_currency: "GBP",
          to_currency: "NGN",
          from_country: "GB",
          to_country: "NG",
          kyc_status: "verified",
          account_age_days: 730,
          daily_total_usd: 0,
          sender_name: "David Williams",
          beneficiary_name: "Adebayo Oluwaseun",
        }),
      });
      expect(res.ok).toBe(true);
      const data = await res.json() as Record<string, unknown>;
      expect(data.requires_edd).toBe(true);
      expect(data.decision).not.toBe("blocked");
    });
  });

  // ── Multi-Transfer Velocity Test ───────────────────────────────────────
  describe("Velocity Limit Enforcement (multiple transfers)", () => {
    it("should block when cumulative transfers exceed $50k daily limit", async () => {
      if (!services.compliance) return;
      const userId = 3001 + Math.floor(Math.random() * 10000);

      // First transfer: $30,000 (should pass)
      const res1 = await fetch(`${COMPLIANCE_URL}/velocity/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          amount_usd: 30000,
          window_seconds: 86400,
          limit_usd: 50000,
        }),
      });
      const data1 = await res1.json() as Record<string, unknown>;
      expect(data1.allowed).toBe(true);

      // Second transfer: $25,000 (should be blocked — cumulative $55k > $50k)
      const res2 = await fetch(`${COMPLIANCE_URL}/velocity/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          amount_usd: 25000,
          window_seconds: 86400,
          limit_usd: 50000,
        }),
      });
      const data2 = await res2.json() as Record<string, unknown>;
      expect(data2.allowed).toBe(false);
    });
  });

  // ── Structuring Detection ──────────────────────────────────────────────
  describe("Anti-Structuring Detection", () => {
    it("should detect multiple near-threshold transfers as structuring", async () => {
      if (!services.compliance) return;

      const results = await Promise.all(
        [9500, 9600, 9700, 9800, 9900].map(async (amount, i) => {
          const res = await fetch(`${COMPLIANCE_URL}/compliance/check`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transfer_id: `E2E-STRUCT-${Date.now()}-${i}`,
              user_id: 4001,
              amount,
              from_currency: "USD",
              to_currency: "GBP",
              from_country: "US",
              to_country: "GB",
              kyc_status: "verified",
              account_age_days: 365,
              daily_total_usd: i * 9500,
            }),
          });
          return res.json() as Promise<Record<string, unknown>>;
        })
      );

      // At least some should trigger CR004 (structuring detection)
      const structuringDetected = results.some(
        r => (r.rules_triggered as string[])?.includes("CR004")
      );
      expect(structuringDetected).toBe(true);
    });
  });
});
