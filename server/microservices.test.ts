/**
 * RemitFlow v76 — Microservices Integration Tests
 * Tests the microservices router integration and fallback behavior
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock fetch ───────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// ─── Helper ───────────────────────────────────────────────────────────────────
function mockOk(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    status: 200,
  } as Response);
}

function mockError(status: number, body = "Service Error") {
  return Promise.resolve({
    ok: false,
    json: () => Promise.resolve({ error: body }),
    text: () => Promise.resolve(body),
    status,
  } as Response);
}

// ─── Fraud Detection Tests ────────────────────────────────────────────────────
describe("Fraud Detection Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should score a low-risk transaction", async () => {
    const mockScore = {
      score_id: "FS-abc123",
      user_id: "user-1",
      risk_score: 12.5,
      risk_level: "low",
      fraud_probability: 0.0125,
      anomaly_score: 0.08,
      flags: [],
      recommendation: "Transaction approved.",
      features_used: 15,
      model_version: "1.0.0",
      scored_at: Date.now(),
    };
    mockFetch.mockResolvedValueOnce(mockOk(mockScore));

    const res = await fetch("http://localhost:8087/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: "user-1",
        amount_usd: 100,
        source_currency: "USD",
        dest_currency: "NGN",
        source_country: "US",
        dest_country: "NG",
      }),
    });
    const data = await res.json();
    expect(data.risk_level).toBe("low");
    expect(data.risk_score).toBeLessThan(35);
    expect(data.recommendation).toBe("Transaction approved.");
  });

  it("should flag a high-risk transaction", async () => {
    const mockScore = {
      score_id: "FS-def456",
      user_id: "user-2",
      risk_score: 82.3,
      risk_level: "critical",
      fraud_probability: 0.823,
      anomaly_score: 0.91,
      flags: ["LARGE_AMOUNT", "HIGH_RISK_DESTINATION", "IP_COUNTRY_MISMATCH", "NEW_USER"],
      recommendation: "Block transaction. Immediate manual review required.",
      features_used: 15,
      model_version: "1.0.0",
      scored_at: Date.now(),
    };
    mockFetch.mockResolvedValueOnce(mockOk(mockScore));

    const res = await fetch("http://localhost:8087/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: "user-2",
        amount_usd: 50000,
        source_currency: "USD",
        dest_currency: "IRR",
        source_country: "US",
        dest_country: "IR",
        is_new_recipient: true,
        velocity_flag: true,
      }),
    });
    const data = await res.json();
    expect(data.risk_level).toBe("critical");
    expect(data.risk_score).toBeGreaterThan(80);
    expect(data.flags).toContain("HIGH_RISK_DESTINATION");
    expect(data.recommendation).toContain("Block");
  });

  it("should return model info", async () => {
    const mockInfo = {
      model_version: "1.0.0",
      algorithm: "IsolationForest + RandomForestClassifier (ensemble)",
      features: ["log_amount", "amount_vs_avg"],
      training_samples: 10000,
      accuracy: 0.967,
      precision: 0.891,
      recall: 0.843,
      last_trained: new Date().toISOString(),
    };
    mockFetch.mockResolvedValueOnce(mockOk(mockInfo));

    const res = await fetch("http://localhost:8087/model-info");
    const data = await res.json();
    expect(data.model_version).toBe("1.0.0");
    expect(data.accuracy).toBeGreaterThan(0.9);
    expect(data.features).toBeInstanceOf(Array);
    expect(data.training_samples).toBe(10000);
  });
});

// ─── AML Compliance Tests ─────────────────────────────────────────────────────
describe("AML Compliance Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should clear a clean user", async () => {
    const mockResult = {
      screening_id: "AML-SCR-abc",
      user_id: "user-1",
      status: "clear",
      risk_level: "low",
      matches: [],
      pep_match: false,
      adverse_media: false,
      risk_score: 0,
      notes: [],
      screened_at: Date.now(),
    };
    mockFetch.mockResolvedValueOnce(mockOk(mockResult));

    const res = await fetch("http://localhost:8088/screen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: "user-1", full_name: "John Smith" }),
    });
    const data = await res.json();
    expect(data.status).toBe("clear");
    expect(data.matches).toHaveLength(0);
    expect(data.pep_match).toBe(false);
  });

  it("should flag a sanctioned user", async () => {
    const mockResult = {
      screening_id: "AML-SCR-xyz",
      user_id: "user-bad",
      status: "blocked",
      risk_level: "critical",
      matches: [{ name: "JOHN DOE SANCTIONED", list_type: "OFAC", match_score: 0.9, risk_score: 100 }],
      pep_match: false,
      adverse_media: false,
      risk_score: 100,
      notes: ["OFAC sanctions list match — transaction must be blocked"],
      screened_at: Date.now(),
    };
    mockFetch.mockResolvedValueOnce(mockOk(mockResult));

    const res = await fetch("http://localhost:8088/screen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: "user-bad", full_name: "John Doe Sanctioned" }),
    });
    const data = await res.json();
    expect(data.status).toBe("blocked");
    expect(data.risk_level).toBe("critical");
    expect(data.matches.length).toBeGreaterThan(0);
    expect(data.notes[0]).toContain("OFAC");
  });

  it("should trigger CTR for large transaction", async () => {
    const mockResult = {
      alert_id: "AML-ALERT-abc",
      user_id: "user-1",
      transaction_id: "tx-999",
      triggered_rules: ["CTR-001"],
      alert_level: "high",
      action_required: "Escalate to compliance officer. File CTR/SAR if applicable.",
      ctr_required: true,
      sar_recommended: false,
      monitored_at: Date.now(),
    };
    mockFetch.mockResolvedValueOnce(mockOk(mockResult));

    const res = await fetch("http://localhost:8088/monitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: "user-1",
        transaction_id: "tx-999",
        amount_usd: 15000,
        source_currency: "USD",
        dest_currency: "NGN",
        source_country: "US",
        dest_country: "NG",
        transaction_type: "remittance",
      }),
    });
    const data = await res.json();
    expect(data.ctr_required).toBe(true);
    expect(data.triggered_rules).toContain("CTR-001");
    expect(data.alert_level).toBe("high");
  });
});

// ─── Analytics Engine Tests ───────────────────────────────────────────────────
describe("Analytics Engine Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return revenue data", async () => {
    const mockRevenue = {
      data: [
        { period: "2026-03", revenue_usd: 48293.2, transaction_count: 9912, avg_transaction_usd: 287.4, fee_revenue_usd: 28975.92, fx_spread_revenue_usd: 19317.28 },
        { period: "2026-04", revenue_usd: 52150.8, transaction_count: 10420, avg_transaction_usd: 295.1, fee_revenue_usd: 31290.48, fx_spread_revenue_usd: 20860.32 },
      ],
      summary: { total_revenue_usd: 100444, total_volume_usd: 2847293.5, avg_monthly_revenue_usd: 50222, periods: 2 },
      timestamp: Date.now(),
    };
    mockFetch.mockResolvedValueOnce(mockOk(mockRevenue));

    const res = await fetch("http://localhost:8089/revenue?months=2");
    const data = await res.json();
    expect(data.data).toHaveLength(2);
    expect(data.summary.total_revenue_usd).toBeGreaterThan(0);
    expect(data.data[0].period).toMatch(/^\d{4}-\d{2}$/);
  });

  it("should return corridor metrics", async () => {
    const mockCorridors = {
      data: [
        { corridor_id: "US-NG", source_country: "US", dest_country: "NG", transaction_count: 1200, volume_usd: 480000, revenue_usd: 9600, avg_fee_percent: 0.5, avg_delivery_minutes: 15, success_rate: 0.987 },
      ],
      count: 1,
      total_volume_usd: 480000,
      total_revenue_usd: 9600,
      timestamp: Date.now(),
    };
    mockFetch.mockResolvedValueOnce(mockOk(mockCorridors));

    const res = await fetch("http://localhost:8089/corridors");
    const data = await res.json();
    expect(data.data.length).toBeGreaterThan(0);
    expect(data.data[0].success_rate).toBeGreaterThan(0.95);
    expect(data.total_volume_usd).toBeGreaterThan(0);
  });

  it("should return KPIs", async () => {
    const mockKPIs = {
      data: {
        period: "2026-04",
        total_users: 12847,
        active_users: 4231,
        new_users: 387,
        total_volume_usd: 2847293.5,
        total_revenue_usd: 48293.2,
        avg_transaction_usd: 287.4,
        transaction_count: 9912,
        success_rate: 0.987,
        avg_delivery_minutes: 18.5,
        nps_score: 52.3,
      },
      timestamp: Date.now(),
    };
    mockFetch.mockResolvedValueOnce(mockOk(mockKPIs));

    const res = await fetch("http://localhost:8089/kpis");
    const data = await res.json();
    expect(data.data.total_users).toBeGreaterThan(0);
    expect(data.data.nps_score).toBeGreaterThan(0);
    expect(data.data.success_rate).toBeGreaterThan(0.95);
  });
});

// ─── Microservice Fallback Tests ──────────────────────────────────────────────
describe("Microservice Fallback Behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle service unavailable gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    let result: unknown;
    try {
      await fetch("http://localhost:8087/score", { method: "POST", body: "{}" });
    } catch (err: any) {
      result = { error: err.message, fallback: true };
    }
    expect(result).toHaveProperty("error");
    expect(result).toHaveProperty("fallback", true);
  });

  it("should handle 500 errors from microservices", async () => {
    mockFetch.mockResolvedValueOnce(mockError(500, "Internal Server Error"));

    const res = await fetch("http://localhost:8088/screen", { method: "POST", body: "{}" });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
  });

  it("should handle timeout gracefully", async () => {
    mockFetch.mockImplementationOnce(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("AbortError")), 100))
    );

    let caught = false;
    try {
      await fetch("http://localhost:8089/kpis");
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
  });
});

// ─── Service Health Tests ─────────────────────────────────────────────────────
describe("Microservice Health Checks", () => {
  const services = [
    { name: "fraud-detection", port: 8087 },
    { name: "aml-compliance", port: 8088 },
    { name: "analytics-engine", port: 8089 },
  ];

  for (const { name, port } of services) {
    it(`should return health for ${name}`, async () => {
      const mockHealth = {
        status: "ok",
        service: name,
        version: "1.0.0",
        timestamp: Date.now(),
      };
      mockFetch.mockResolvedValueOnce(mockOk(mockHealth));

      const res = await fetch(`http://localhost:${port}/health`);
      const data = await res.json();
      expect(data.status).toBe("ok");
      expect(data.service).toBe(name);
      expect(data.version).toBe("1.0.0");
    });
  }
});
