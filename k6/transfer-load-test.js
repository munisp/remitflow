/**
 * RemitFlow — k6 Load Test: Transfer API Critical Path
 * ══════════════════════════════════════════════════════════════════════════════
 * Tests the full transfer initiation flow under realistic load conditions.
 *
 * Test scenarios:
 *   1. Smoke test    — 5 VUs for 1 minute (baseline sanity check)
 *   2. Load test     — ramp to 100 VUs over 5 minutes (normal load)
 *   3. Stress test   — ramp to 500 VUs over 10 minutes (peak load)
 *   4. Soak test     — 50 VUs for 30 minutes (sustained load)
 *
 * SLO thresholds:
 *   - p95 response time < 500ms
 *   - p99 response time < 1000ms
 *   - Error rate < 1%
 *   - Transfer initiation success rate > 99%
 *
 * Usage:
 *   k6 run k6/transfer-load-test.js                    # default (load test)
 *   k6 run --env SCENARIO=smoke k6/transfer-load-test.js
 *   k6 run --env SCENARIO=stress k6/transfer-load-test.js
 *   k6 run --env SCENARIO=soak k6/transfer-load-test.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import { SharedArray } from "k6/data";

// ── Custom Metrics ────────────────────────────────────────────────────────────

const transferSuccessRate = new Rate("transfer_success_rate");
const transferDuration = new Trend("transfer_duration_ms", true);
const fxRateLatency = new Trend("fx_rate_latency_ms", true);
const kycCheckLatency = new Trend("kyc_check_latency_ms", true);
const fraudScoreLatency = new Trend("fraud_score_latency_ms", true);
const transfersInitiated = new Counter("transfers_initiated");
const transfersFailed = new Counter("transfers_failed");

// ── Configuration ─────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const SCENARIO = __ENV.SCENARIO || "load";

// ── Test Data ─────────────────────────────────────────────────────────────────

const corridors = [
  { send: "USD", receive: "NGN", minAmount: 10, maxAmount: 500 },
  { send: "GBP", receive: "GHS", minAmount: 5, maxAmount: 300 },
  { send: "EUR", receive: "KES", minAmount: 10, maxAmount: 400 },
  { send: "USD", receive: "ZAR", minAmount: 20, maxAmount: 1000 },
  { send: "USD", receive: "GHS", minAmount: 10, maxAmount: 500 },
];

// ── Scenarios ─────────────────────────────────────────────────────────────────

const scenarios = {
  smoke: {
    executor: "constant-vus",
    vus: 5,
    duration: "1m",
  },
  load: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "2m", target: 20 },
      { duration: "5m", target: 100 },
      { duration: "2m", target: 100 },
      { duration: "1m", target: 0 },
    ],
  },
  stress: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "2m", target: 50 },
      { duration: "3m", target: 200 },
      { duration: "3m", target: 500 },
      { duration: "2m", target: 500 },
      { duration: "2m", target: 0 },
    ],
  },
  soak: {
    executor: "constant-vus",
    vus: 50,
    duration: "30m",
  },
  spike: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "10s", target: 0 },
      { duration: "1m", target: 1000 }, // sudden spike
      { duration: "3m", target: 1000 },
      { duration: "10s", target: 0 },
    ],
  },
};

export const options = {
  scenarios: {
    default: scenarios[SCENARIO] || scenarios.load,
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    http_req_failed: ["rate<0.01"],
    transfer_success_rate: ["rate>0.99"],
    transfer_duration_ms: ["p(95)<800"],
    fx_rate_latency_ms: ["p(95)<200"],
  },
};

// ── Auth Helper ───────────────────────────────────────────────────────────────

function getAuthToken() {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({
      email: `loadtest+${Math.floor(Math.random() * 1000)}@remitflow-test.io`,
      password: "LoadTest@123!",
    }),
    { headers: { "Content-Type": "application/json" } }
  );

  if (res.status === 200) {
    try {
      return JSON.parse(res.body).token;
    } catch {
      return null;
    }
  }
  return null;
}

// ── Main Test Function ────────────────────────────────────────────────────────

export default function () {
  const token = getAuthToken();
  if (!token) {
    sleep(1);
    return;
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const corridor = corridors[Math.floor(Math.random() * corridors.length)];
  const amount = corridor.minAmount + Math.random() * (corridor.maxAmount - corridor.minAmount);

  // ── Group 1: FX Rate Check ────────────────────────────────────────────────

  group("fx_rate_check", () => {
    const start = Date.now();
    const res = http.get(
      `${BASE_URL}/api/trpc/fxRates.getRate?input=${encodeURIComponent(JSON.stringify({
        sendCurrency: corridor.send,
        receiveCurrency: corridor.receive,
        amount,
      }))}`,
      { headers }
    );

    fxRateLatency.add(Date.now() - start);

    check(res, {
      "fx rate status 200": (r) => r.status === 200,
      "fx rate has result": (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.result?.data?.rate > 0;
        } catch {
          return false;
        }
      },
    });
  });

  sleep(0.5);

  // ── Group 2: Fraud Pre-Score ──────────────────────────────────────────────

  group("fraud_pre_score", () => {
    const start = Date.now();
    const transferId = `LT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const res = http.post(
      `${BASE_URL}/api/trpc/fraudOrchestrator.scoreTransfer`,
      JSON.stringify({
        json: {
          transferId,
          amount,
          sendCurrency: corridor.send,
          receiveCurrency: corridor.receive,
        },
      }),
      { headers }
    );

    fraudScoreLatency.add(Date.now() - start);

    check(res, {
      "fraud score status 200": (r) => r.status === 200,
      "fraud score has decision": (r) => {
        try {
          const body = JSON.parse(r.body);
          return ["allow", "review", "hold", "block"].includes(body.result?.data?.decision);
        } catch {
          return false;
        }
      },
    });
  });

  sleep(0.3);

  // ── Group 3: Transfer Initiation ──────────────────────────────────────────

  group("transfer_initiation", () => {
    const start = Date.now();

    const res = http.post(
      `${BASE_URL}/api/trpc/transfers.initiate`,
      JSON.stringify({
        json: {
          sendAmount: parseFloat(amount.toFixed(2)),
          sendCurrency: corridor.send,
          receiveCurrency: corridor.receive,
          recipientId: `test-recipient-${Math.floor(Math.random() * 100)}`,
          purpose: "family_support",
          idempotencyKey: `lt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
      }),
      { headers }
    );

    const duration = Date.now() - start;
    transferDuration.add(duration);
    transfersInitiated.add(1);

    const success = check(res, {
      "transfer initiation status 200": (r) => r.status === 200,
      "transfer has ID": (r) => {
        try {
          const body = JSON.parse(r.body);
          return !!body.result?.data?.transferId;
        } catch {
          return false;
        }
      },
      "transfer duration < 800ms": () => duration < 800,
    });

    transferSuccessRate.add(success);
    if (!success) transfersFailed.add(1);
  });

  sleep(1 + Math.random() * 2);
}

// ── Setup & Teardown ──────────────────────────────────────────────────────────

export function setup() {
  console.log(`Starting RemitFlow load test: scenario=${SCENARIO}, base_url=${BASE_URL}`);
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Load test completed in ${duration.toFixed(1)}s`);
}
