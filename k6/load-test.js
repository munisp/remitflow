/**
 * RemitFlow — k6 Load Testing Suite
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Runs against the RemitFlow API to validate performance under load.
 * Tests critical financial paths: auth, transfers, FX rates, wallets, KYC.
 *
 * Usage:
 *   k6 run k6/load-test.js                      # Default (smoke test)
 *   k6 run --env STAGE=load k6/load-test.js     # Load test (100 VUs)
 *   k6 run --env STAGE=stress k6/load-test.js   # Stress test (500 VUs)
 *   k6 run --env STAGE=spike k6/load-test.js    # Spike test (1000 VUs burst)
 *   k6 run --env STAGE=soak k6/load-test.js     # Soak test (50 VUs, 30 min)
 *
 * Environment variables:
 *   BASE_URL    - API base URL (default: http://localhost:5000)
 *   AUTH_TOKEN  - Bearer token for authenticated requests
 *   STAGE       - Test profile: smoke|load|stress|spike|soak
 */
import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// ─── Custom Metrics ───────────────────────────────────────────────────────────

const errorRate = new Rate("errors");
const transferLatency = new Trend("transfer_latency", true);
const fxLatency = new Trend("fx_rate_latency", true);
const authLatency = new Trend("auth_latency", true);
const walletLatency = new Trend("wallet_latency", true);
const p99Latency = new Trend("p99_latency", true);
const successfulTransfers = new Counter("successful_transfers");

// ─── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "test-bearer-token";
const STAGE = __ENV.STAGE || "smoke";

const SCENARIOS = {
  smoke: {
    executor: "constant-vus",
    vus: 5,
    duration: "1m",
  },
  load: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "2m", target: 50 },
      { duration: "5m", target: 100 },
      { duration: "2m", target: 100 },
      { duration: "1m", target: 0 },
    ],
  },
  stress: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "2m", target: 100 },
      { duration: "5m", target: 300 },
      { duration: "3m", target: 500 },
      { duration: "2m", target: 500 },
      { duration: "3m", target: 0 },
    ],
  },
  spike: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "30s", target: 10 },
      { duration: "10s", target: 1000 },
      { duration: "1m", target: 1000 },
      { duration: "30s", target: 10 },
      { duration: "1m", target: 0 },
    ],
  },
  soak: {
    executor: "constant-vus",
    vus: 50,
    duration: "30m",
  },
};

export const options = {
  scenarios: {
    default: SCENARIOS[STAGE] || SCENARIOS.smoke,
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1500"],
    errors: ["rate<0.01"], // Less than 1% error rate
    transfer_latency: ["p(95)<800", "p(99)<2000"],
    fx_rate_latency: ["p(95)<200", "p(99)<500"],
    auth_latency: ["p(95)<300", "p(99)<800"],
    wallet_latency: ["p(95)<200", "p(99)<500"],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders() {
  return {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "X-Request-ID": `k6-${__VU}-${__ITER}-${Date.now()}`,
    },
  };
}

function tRPCQuery(path, input = {}) {
  const encodedInput = encodeURIComponent(JSON.stringify({ json: input }));
  return `${BASE_URL}/api/trpc/${path}?input=${encodedInput}`;
}

function tRPCMutation(path, input = {}) {
  return {
    url: `${BASE_URL}/api/trpc/${path}`,
    body: JSON.stringify({ json: input }),
  };
}

// ─── Test Scenarios ───────────────────────────────────────────────────────────

export default function () {
  // Weighted random selection of user flows
  const flows = [
    { weight: 30, fn: transferFlow },
    { weight: 25, fn: fxRateFlow },
    { weight: 20, fn: walletFlow },
    { weight: 10, fn: authFlow },
    { weight: 10, fn: complianceFlow },
    { weight: 5, fn: adminFlow },
  ];

  const totalWeight = flows.reduce((sum, f) => sum + f.weight, 0);
  let random = Math.random() * totalWeight;
  for (const flow of flows) {
    random -= flow.weight;
    if (random <= 0) {
      flow.fn();
      return;
    }
  }
  transferFlow(); // fallback
}

// ─── Transfer Flow (Core Financial Path) ─────────────────────────────────────

function transferFlow() {
  group("Transfer Flow", () => {
    // 1. Get FX rate
    let res = http.get(tRPCQuery("fx.rates", { from: "USD", to: "NGN" }), authHeaders());
    check(res, { "FX rate success": (r) => r.status === 200 });
    fxLatency.add(res.timings.duration);
    sleep(0.5);

    // 2. Initiate transfer
    const { url, body } = tRPCMutation("transfer.send", {
      beneficiaryId: 1,
      amount: Math.floor(Math.random() * 10000) + 100,
      fromCurrency: "USD",
      toCurrency: "NGN",
      paymentMethod: "wallet",
      purpose: "family_support",
    });
    res = http.post(url, body, authHeaders());
    const transferSuccess = check(res, { "Transfer initiated": (r) => r.status === 200 });
    transferLatency.add(res.timings.duration);
    p99Latency.add(res.timings.duration);
    errorRate.add(!transferSuccess);
    if (transferSuccess) successfulTransfers.add(1);
    sleep(1);

    // 3. Check transfer status
    res = http.get(tRPCQuery("transfer.list", { limit: 5 }), authHeaders());
    check(res, { "Transfer list success": (r) => r.status === 200 });
    sleep(0.5);
  });
}

// ─── FX Rate Flow ────────────────────────────────────────────────────────────

function fxRateFlow() {
  group("FX Rate Flow", () => {
    const corridors = [
      { from: "USD", to: "NGN" },
      { from: "GBP", to: "KES" },
      { from: "EUR", to: "GHS" },
      { from: "USD", to: "ZAR" },
      { from: "CAD", to: "NGN" },
    ];

    for (const corridor of corridors) {
      const res = http.get(
        tRPCQuery("fx.rates", corridor),
        authHeaders()
      );
      check(res, { "FX rate fetched": (r) => r.status === 200 });
      fxLatency.add(res.timings.duration);
      errorRate.add(res.status !== 200);
      sleep(0.2);
    }
  });
}

// ─── Wallet Flow ─────────────────────────────────────────────────────────────

function walletFlow() {
  group("Wallet Flow", () => {
    // List wallets
    let res = http.get(tRPCQuery("wallet.list"), authHeaders());
    check(res, { "Wallet list success": (r) => r.status === 200 });
    walletLatency.add(res.timings.duration);
    sleep(0.5);

    // Get balance
    res = http.get(tRPCQuery("wallet.balance", { currency: "USD" }), authHeaders());
    check(res, { "Wallet balance success": (r) => r.status === 200 });
    walletLatency.add(res.timings.duration);
    sleep(0.3);

    // Transaction history
    res = http.get(tRPCQuery("wallet.transactions", { limit: 20 }), authHeaders());
    check(res, { "Wallet transactions success": (r) => r.status === 200 });
    walletLatency.add(res.timings.duration);
    errorRate.add(res.status !== 200);
  });
}

// ─── Auth Flow ───────────────────────────────────────────────────────────────

function authFlow() {
  group("Auth Flow", () => {
    // Login
    const { url, body } = tRPCMutation("auth.login", {
      email: `loadtest-${__VU}@remitflow.test`,
      password: "LoadTest2026!",
    });
    let res = http.post(url, body, { headers: { "Content-Type": "application/json" } });
    check(res, { "Auth login responded": (r) => r.status === 200 || r.status === 401 });
    authLatency.add(res.timings.duration);
    sleep(1);

    // Get profile
    res = http.get(tRPCQuery("auth.me"), authHeaders());
    check(res, { "Auth me success": (r) => r.status === 200 });
    authLatency.add(res.timings.duration);
    errorRate.add(res.status !== 200);
  });
}

// ─── Compliance Flow ─────────────────────────────────────────────────────────

function complianceFlow() {
  group("Compliance Flow", () => {
    // KYC status
    let res = http.get(tRPCQuery("kyc.status"), authHeaders());
    check(res, { "KYC status success": (r) => r.status === 200 });
    sleep(0.5);

    // Beneficiary list
    res = http.get(tRPCQuery("beneficiary.list", { limit: 10 }), authHeaders());
    check(res, { "Beneficiary list success": (r) => r.status === 200 });
    errorRate.add(res.status !== 200);
  });
}

// ─── Admin Flow ──────────────────────────────────────────────────────────────

function adminFlow() {
  group("Admin Flow", () => {
    // System health
    let res = http.get(tRPCQuery("systemHealth.getStatus"), authHeaders());
    check(res, { "System health success": (r) => r.status === 200 });
    sleep(0.3);

    // Fee rules list
    res = http.get(tRPCQuery("feeRulesEngine.list"), authHeaders());
    check(res, { "Fee rules success": (r) => r.status === 200 });
    sleep(0.3);

    // Secrets rotation status
    res = http.get(tRPCQuery("secretsRotation.getStatus"), authHeaders());
    check(res, { "Secrets status success": (r) => r.status === 200 });
    errorRate.add(res.status !== 200);
  });
}

// ─── Lifecycle Hooks ──────────────────────────────────────────────────────────

export function handleSummary(data) {
  return {
    "k6/results/summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}

function textSummary(data, opts) {
  const metrics = data.metrics || {};
  const lines = [
    "═══════════════════════════════════════════════════════════════",
    "  RemitFlow Load Test Results",
    "═══════════════════════════════════════════════════════════════",
    `  Stage: ${STAGE}`,
    `  Duration: ${Math.round((data.state?.testRunDurationMs || 0) / 1000)}s`,
    `  VUs: ${data.metrics?.vus?.values?.max || 0} max`,
    "───────────────────────────────────────────────────────────────",
    `  HTTP Reqs:        ${metrics.http_reqs?.values?.count || 0}`,
    `  Avg Duration:     ${Math.round(metrics.http_req_duration?.values?.avg || 0)}ms`,
    `  P95 Duration:     ${Math.round(metrics.http_req_duration?.values?.["p(95)"] || 0)}ms`,
    `  P99 Duration:     ${Math.round(metrics.http_req_duration?.values?.["p(99)"] || 0)}ms`,
    `  Error Rate:       ${((metrics.errors?.values?.rate || 0) * 100).toFixed(2)}%`,
    `  Transfers:        ${metrics.successful_transfers?.values?.count || 0}`,
    "───────────────────────────────────────────────────────────────",
    `  Transfer P95:     ${Math.round(metrics.transfer_latency?.values?.["p(95)"] || 0)}ms`,
    `  FX Rate P95:      ${Math.round(metrics.fx_rate_latency?.values?.["p(95)"] || 0)}ms`,
    `  Auth P95:         ${Math.round(metrics.auth_latency?.values?.["p(95)"] || 0)}ms`,
    `  Wallet P95:       ${Math.round(metrics.wallet_latency?.values?.["p(95)"] || 0)}ms`,
    "═══════════════════════════════════════════════════════════════",
  ];
  return lines.join("\n") + "\n";
}
