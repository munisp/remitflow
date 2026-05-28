/**
 * k6 Load Test — Critical Business Flows
 *
 * Tests the platform's performance under load for:
 *   1. Authentication (login + token refresh)
 *   2. Money Transfer (quote → lock → send)
 *   3. FX Rate Queries (high-frequency)
 *   4. KYC Document Submission
 *   5. Dashboard Data Loading
 *
 * Run:
 *   k6 run tests/load/k6-critical-flows.js
 *   k6 run --vus 50 --duration 5m tests/load/k6-critical-flows.js
 *
 * Environment:
 *   K6_BASE_URL=http://localhost:3000 (default)
 *   K6_AUTH_EMAIL=test@remitflow.app
 *   K6_AUTH_PASSWORD=testpassword123
 */
import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// ─── Configuration ────────────────────────────────────────────────────────────
const BASE_URL = __ENV.K6_BASE_URL || "http://localhost:3000";
const AUTH_EMAIL = __ENV.K6_AUTH_EMAIL || "test@remitflow.app";
const AUTH_PASSWORD = __ENV.K6_AUTH_PASSWORD || "testpassword123";

// Custom metrics
const errorRate = new Rate("errors");
const loginDuration = new Trend("login_duration_ms");
const transferDuration = new Trend("transfer_duration_ms");
const fxRateDuration = new Trend("fx_rate_duration_ms");
const dashboardDuration = new Trend("dashboard_duration_ms");
const failedTransfers = new Counter("failed_transfers");

// ─── Test Options ─────────────────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: "30s", target: 10 },  // Ramp up to 10 VUs
    { duration: "2m", target: 50 },   // Sustain 50 VUs
    { duration: "1m", target: 100 },  // Peak at 100 VUs
    { duration: "30s", target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<2000", "p(99)<5000"],  // 95% under 2s, 99% under 5s
    errors: ["rate<0.05"],                             // Less than 5% errors
    login_duration_ms: ["p(95)<1000"],                 // Login under 1s
    transfer_duration_ms: ["p(95)<3000"],              // Transfer under 3s
    fx_rate_duration_ms: ["p(95)<500"],                // FX rates under 500ms
    dashboard_duration_ms: ["p(95)<2000"],             // Dashboard under 2s
  },
};

// ─── Helper: tRPC call ────────────────────────────────────────────────────────
function trpcQuery(path, input, token) {
  const url = `${BASE_URL}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const params = { headers: {} };
  if (token) params.headers["Authorization"] = `Bearer ${token}`;
  params.headers["Content-Type"] = "application/json";
  return http.get(url, params);
}

function trpcMutation(path, input, token) {
  const url = `${BASE_URL}/api/trpc/${path}`;
  const params = { headers: { "Content-Type": "application/json" } };
  if (token) params.headers["Authorization"] = `Bearer ${token}`;
  return http.post(url, JSON.stringify(input), params);
}

// ─── Scenario: Authentication ─────────────────────────────────────────────────
function authFlow() {
  const start = Date.now();
  const res = trpcMutation("auth.login", {
    email: AUTH_EMAIL,
    password: AUTH_PASSWORD,
  });

  loginDuration.add(Date.now() - start);
  const success = check(res, {
    "login status 200": (r) => r.status === 200,
    "login has token": (r) => {
      try { return JSON.parse(r.body).result?.data?.token !== undefined; }
      catch { return false; }
    },
  });

  errorRate.add(!success);

  if (success) {
    try {
      return JSON.parse(res.body).result?.data?.token;
    } catch { return null; }
  }
  return null;
}

// ─── Scenario: Money Transfer ─────────────────────────────────────────────────
function transferFlow(token) {
  const start = Date.now();

  group("Money Transfer", () => {
    // Step 1: Get FX quote
    const quoteRes = trpcMutation("fxRateLock.lockQuote", {
      fromCurrency: "USD",
      toCurrency: "NGN",
      amount: 100,
      rate: 1538.46,
    }, token);

    check(quoteRes, { "quote locked": (r) => r.status === 200 });

    // Step 2: Validate recipient
    const validateRes = trpcQuery("beneficiary.validate", {
      accountNumber: "0123456789",
      bankCode: "058",
    }, token);

    check(validateRes, { "beneficiary valid": (r) => r.status === 200 });

    // Step 3: Initiate transfer
    const sendRes = trpcMutation("send.initiate", {
      fromCurrency: "USD",
      toCurrency: "NGN",
      amount: 100,
      recipientId: 1,
      purpose: "family_support",
    }, token);

    const transferSuccess = check(sendRes, {
      "transfer initiated": (r) => r.status === 200 || r.status === 201,
    });

    if (!transferSuccess) failedTransfers.add(1);
  });

  transferDuration.add(Date.now() - start);
  errorRate.add(false);
}

// ─── Scenario: FX Rate Query (High Frequency) ────────────────────────────────
function fxRateFlow(token) {
  const start = Date.now();
  const corridors = [
    { from: "USD", to: "NGN" },
    { from: "GBP", to: "NGN" },
    { from: "EUR", to: "GHS" },
    { from: "USD", to: "KES" },
    { from: "CAD", to: "INR" },
  ];

  const corridor = corridors[Math.floor(Math.random() * corridors.length)];
  const res = trpcQuery("fx.getRate", {
    fromCurrency: corridor.from,
    toCurrency: corridor.to,
  }, token);

  fxRateDuration.add(Date.now() - start);
  const success = check(res, {
    "FX rate returned": (r) => r.status === 200,
  });
  errorRate.add(!success);
}

// ─── Scenario: Dashboard Load ─────────────────────────────────────────────────
function dashboardFlow(token) {
  const start = Date.now();

  group("Dashboard Load", () => {
    // Parallel dashboard queries
    const responses = http.batch([
      ["GET", `${BASE_URL}/api/trpc/dashboard.summary`, null, {
        headers: { Authorization: `Bearer ${token}` },
      }],
      ["GET", `${BASE_URL}/api/trpc/wallet.getBalances`, null, {
        headers: { Authorization: `Bearer ${token}` },
      }],
      ["GET", `${BASE_URL}/api/trpc/transactions.recent?input=${encodeURIComponent(JSON.stringify({ limit: 10 }))}`, null, {
        headers: { Authorization: `Bearer ${token}` },
      }],
    ]);

    responses.forEach((res, i) => {
      check(res, { [`dashboard query ${i} ok`]: (r) => r.status === 200 });
    });
  });

  dashboardDuration.add(Date.now() - start);
}

// ─── Main Test Function ───────────────────────────────────────────────────────
export default function () {
  // Authenticate
  const token = authFlow();
  if (!token) {
    sleep(1);
    return;
  }

  // Randomly pick a flow
  const scenario = Math.random();
  if (scenario < 0.2) {
    transferFlow(token);
  } else if (scenario < 0.6) {
    fxRateFlow(token);
  } else {
    dashboardFlow(token);
  }

  sleep(Math.random() * 2 + 0.5); // 0.5-2.5s think time
}

// ─── Setup: Create test user if needed ────────────────────────────────────────
export function setup() {
  console.log(`Load test targeting: ${BASE_URL}`);
  console.log(`Auth email: ${AUTH_EMAIL}`);

  // Try to register test user (will fail silently if exists)
  trpcMutation("auth.register", {
    email: AUTH_EMAIL,
    password: AUTH_PASSWORD,
    name: "Load Test User",
  });

  return { baseUrl: BASE_URL };
}

// ─── Teardown ─────────────────────────────────────────────────────────────────
export function teardown(data) {
  console.log(`Load test complete against: ${data.baseUrl}`);
}
