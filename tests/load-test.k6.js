/**
 * RemitFlow — k6 Load Testing Suite
 * ────────────────────────────────────
 * Run: k6 run tests/load-test.k6.js
 * Environment:
 *   K6_BASE_URL=http://localhost:3000
 *   K6_AUTH_TOKEN=test-token
 */
import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// ─── Custom Metrics ──────────────────────────────────────────────────────────
const transferSuccess = new Rate("transfer_success_rate");
const kycLatency = new Trend("kyc_verification_latency", true);
const fxLatency = new Trend("fx_rate_latency", true);
const transferLatency = new Trend("transfer_latency", true);
const sanctionsLatency = new Trend("sanctions_check_latency", true);
const failedRequests = new Counter("failed_requests");

// ─── Configuration ───────────────────────────────────────────────────────────
const BASE_URL = __ENV.K6_BASE_URL || "http://localhost:3000";
const AUTH_TOKEN = __ENV.K6_AUTH_TOKEN || "test-token";

export const options = {
  scenarios: {
    // Normal load: 50 concurrent users for 5 minutes
    normal_load: {
      executor: "constant-vus",
      vus: 50,
      duration: "5m",
      gracefulStop: "30s",
      exec: "normalFlow",
    },
    // Spike test: ramp up to 200 users, then back down
    spike_test: {
      executor: "ramping-vus",
      startVUs: 10,
      stages: [
        { duration: "1m", target: 50 },
        { duration: "2m", target: 200 },
        { duration: "1m", target: 200 },
        { duration: "1m", target: 10 },
      ],
      gracefulStop: "30s",
      exec: "spikeFlow",
      startTime: "6m",
    },
    // Soak test: steady load for 30 minutes
    soak_test: {
      executor: "constant-vus",
      vus: 30,
      duration: "30m",
      gracefulStop: "1m",
      exec: "soakFlow",
      startTime: "12m",
    },
  },
  thresholds: {
    // SLO: 99.95% availability
    http_req_failed: ["rate<0.005"],
    // SLO: P99 latency under 2s
    http_req_duration: ["p(99)<2000", "p(95)<1000", "p(50)<500"],
    // Custom thresholds
    transfer_success_rate: ["rate>0.99"],
    kyc_verification_latency: ["p(99)<3000"],
    fx_rate_latency: ["p(95)<500"],
    transfer_latency: ["p(95)<1500"],
    sanctions_check_latency: ["p(99)<1000"],
  },
};

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${AUTH_TOKEN}`,
};

// ─── Normal Load Flow ────────────────────────────────────────────────────────
export function normalFlow() {
  group("Health Check", () => {
    const res = http.get(`${BASE_URL}/api/health`);
    check(res, { "health check OK": (r) => r.status === 200 });
  });

  group("FX Rate Lookup", () => {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/trpc/fxCalculator.getRate`,
      JSON.stringify({ json: { from: "NGN", to: "USD", amount: 50000 } }),
      { headers }
    );
    fxLatency.add(Date.now() - start);
    check(res, { "FX rate OK": (r) => r.status === 200 });
  });

  group("Transfer Initiation", () => {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/trpc/transfers.initiate`,
      JSON.stringify({
        json: {
          recipientId: Math.floor(Math.random() * 1000) + 1,
          amount: Math.floor(Math.random() * 10000) + 100,
          currency: "NGN",
          rail: "flutterwave",
          idempotencyKey: `k6-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        },
      }),
      { headers }
    );
    transferLatency.add(Date.now() - start);
    const success = res.status === 200;
    transferSuccess.add(success);
    if (!success) failedRequests.add(1);
  });

  sleep(Math.random() * 2 + 1); // 1-3 second think time
}

// ─── Spike Flow ──────────────────────────────────────────────────────────────
export function spikeFlow() {
  group("Concurrent Transfers", () => {
    const res = http.post(
      `${BASE_URL}/api/trpc/transfers.initiate`,
      JSON.stringify({
        json: {
          recipientId: 1,
          amount: 1000,
          currency: "NGN",
          rail: "internal",
          idempotencyKey: `k6-spike-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        },
      }),
      { headers }
    );
    check(res, { "spike transfer OK": (r) => r.status === 200 || r.status === 429 });
    if (res.status === 429) {
      // Rate limited — this is expected behavior under load
      check(res, { "rate limit has retry-after": (r) => r.headers["X-RateLimit-Reset"] !== undefined });
    }
  });

  sleep(0.5);
}

// ─── Soak Flow ───────────────────────────────────────────────────────────────
export function soakFlow() {
  group("KYC Status Check", () => {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/trpc/kycWorkflow.getWorkflowStatus`,
      JSON.stringify({ json: { sessionId: `soak-${Math.floor(Math.random() * 100)}` } }),
      { headers }
    );
    kycLatency.add(Date.now() - start);
    check(res, { "KYC status OK": (r) => r.status === 200 });
  });

  group("Sanctions Check", () => {
    const start = Date.now();
    const names = ["John Smith", "Jane Doe", "Ahmed Hassan", "Chen Wei", "Maria Garcia"];
    const res = http.post(
      `${BASE_URL}/api/trpc/sanctions.screen`,
      JSON.stringify({ json: { name: names[Math.floor(Math.random() * names.length)] } }),
      { headers }
    );
    sanctionsLatency.add(Date.now() - start);
    check(res, { "sanctions check OK": (r) => r.status === 200 });
  });

  group("Wallet Balance", () => {
    const res = http.post(
      `${BASE_URL}/api/trpc/wallets.balance`,
      JSON.stringify({ json: {} }),
      { headers }
    );
    check(res, { "wallet balance OK": (r) => r.status === 200 });
  });

  sleep(Math.random() * 3 + 2); // 2-5 second think time for soak
}

// ─── Summary Handler ─────────────────────────────────────────────────────────
export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    platform: "RemitFlow",
    scenarios: Object.keys(options.scenarios),
    results: {
      totalRequests: data.metrics.http_reqs?.values?.count || 0,
      failedRequests: data.metrics.http_req_failed?.values?.rate || 0,
      p50LatencyMs: data.metrics.http_req_duration?.values?.["p(50)"] || 0,
      p95LatencyMs: data.metrics.http_req_duration?.values?.["p(95)"] || 0,
      p99LatencyMs: data.metrics.http_req_duration?.values?.["p(99)"] || 0,
      transferSuccessRate: data.metrics.transfer_success_rate?.values?.rate || 0,
    },
    thresholds: data.root_group?.checks || {},
  };

  return {
    stdout: JSON.stringify(summary, null, 2),
    "load-test-results.json": JSON.stringify(data, null, 2),
  };
}
