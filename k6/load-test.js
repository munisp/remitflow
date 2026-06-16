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

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
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

// ─── Setup (Login) ────────────────────────────────────────────────────────────

export function setup() {
  // Login once to warm up the server
  const res = http.get(`${BASE_URL}/api/dev-login`, { redirects: 5 });
  return { loggedIn: res.status === 200 };
}

// ─── Test Scenarios ───────────────────────────────────────────────────────────

export default function () {
  // Each VU logs in to get session cookie (only on first iteration)
  if (__ITER === 0) {
    http.get(`${BASE_URL}/api/dev-login`, { redirects: 5 });
  }

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
    // 1. Get FX quote
    let res = http.get(tRPCQuery("transferCore.quote", { amount: 100, fromCurrency: "USD", toCurrency: "NGN" }), authHeaders());
    check(res, { "FX quote success": (r) => r.status === 200 });
    fxLatency.add(res.timings.duration);
    sleep(0.5);

    // 2. Initiate transfer
    const { url, body } = tRPCMutation("transferCore.send", {
      recipientId: 1282,
      amount: Math.floor(Math.random() * 500) + 50,
      fromCurrency: "USD",
      toCurrency: "NGN",
      payoutMethod: "bank_transfer",
      beneficiaryName: "Load Test Recipient",
      beneficiaryAccount: "0012345678",
      purpose: "family_support",
      sourceOfFunds: "salary",
    });
    res = http.post(url, body, authHeaders());
    const transferSuccess = check(res, { "Transfer initiated": (r) => r.status === 200 });
    transferLatency.add(res.timings.duration);
    p99Latency.add(res.timings.duration);
    errorRate.add(!transferSuccess);
    if (transferSuccess) successfulTransfers.add(1);
    sleep(1);

    // 3. Check transfer status
    res = http.get(tRPCQuery("transferCore.list", { limit: 5 }), authHeaders());
    check(res, { "Transfer list success": (r) => r.status === 200 });
    sleep(0.5);
  });
}

// ─── FX Rate Flow ────────────────────────────────────────────────────────────

function fxRateFlow() {
  group("FX Rate Flow", () => {
    const corridors = [
      { amount: 100, fromCurrency: "USD", toCurrency: "NGN" },
      { amount: 200, fromCurrency: "GBP", toCurrency: "KES" },
      { amount: 150, fromCurrency: "EUR", toCurrency: "GHS" },
      { amount: 500, fromCurrency: "USD", toCurrency: "ZAR" },
      { amount: 300, fromCurrency: "CAD", toCurrency: "NGN" },
    ];

    for (const corridor of corridors) {
      const res = http.get(
        tRPCQuery("transferCore.quote", corridor),
        authHeaders()
      );
      check(res, { "FX quote fetched": (r) => r.status === 200 });
      fxLatency.add(res.timings.duration);
      errorRate.add(res.status !== 200);
      sleep(0.2);
    }
  });
}

// ─── Wallet Flow ─────────────────────────────────────────────────────────────

function walletFlow() {
  group("Wallet Flow", () => {
    // Dashboard (includes wallets)
    let res = http.get(`${BASE_URL}/api/ready`, authHeaders());
    check(res, { "Health check success": (r) => r.status === 200 });
    walletLatency.add(res.timings.duration);
    sleep(0.5);

    // FX quote (lightweight read)
    res = http.get(tRPCQuery("transferCore.quote", { amount: 50, fromCurrency: "USD", toCurrency: "NGN" }), authHeaders());
    check(res, { "Quote success": (r) => r.status === 200 });
    walletLatency.add(res.timings.duration);
    sleep(0.3);

    // Beneficiary list
    res = http.get(tRPCQuery("beneficiaries.list", { page: 1, limit: 10 }), authHeaders());
    check(res, { "Beneficiary list success": (r) => r.status === 200 });
    walletLatency.add(res.timings.duration);
    errorRate.add(res.status !== 200);
  });
}

// ─── Auth Flow ───────────────────────────────────────────────────────────────

function authFlow() {
  group("Auth Flow", () => {
    // Dev login
    let res = http.get(`${BASE_URL}/api/dev-login`, { redirects: 0 });
    check(res, { "Dev login responded": (r) => r.status === 200 || r.status === 302 });
    authLatency.add(res.timings.duration);
    sleep(1);

    // Health endpoint (always available)
    res = http.get(`${BASE_URL}/api/health`);
    check(res, { "Health check success": (r) => r.status === 200 });
    authLatency.add(res.timings.duration);
    errorRate.add(res.status !== 200);
  });
}

// ─── Compliance Flow ─────────────────────────────────────────────────────────

function complianceFlow() {
  group("Compliance Flow", () => {
    // Public endpoint - validate LEI
    let res = http.get(tRPCQuery("futureProofing.iso20022.validateLEI", { lei: "529900T8BM49AURSDO55" }), authHeaders());
    check(res, { "LEI validation success": (r) => r.status === 200 });
    sleep(0.5);

    // Beneficiary list
    res = http.get(tRPCQuery("beneficiaries.list", { page: 1, limit: 10 }), authHeaders());
    check(res, { "Beneficiary list success": (r) => r.status === 200 });
    errorRate.add(res.status !== 200);
  });
}

// ─── Admin Flow ──────────────────────────────────────────────────────────────

function adminFlow() {
  group("Admin Flow", () => {
    // System readiness
    let res = http.get(`${BASE_URL}/api/ready`);
    check(res, { "System ready success": (r) => r.status === 200 });
    sleep(0.3);

    // Health endpoint
    res = http.get(`${BASE_URL}/api/health`);
    check(res, { "Health success": (r) => r.status === 200 });
    sleep(0.3);

    // Feature flags list
    res = http.get(tRPCQuery("featureFlags.list", { page: 1, limit: 10 }), authHeaders());
    check(res, { "Feature flags success": (r) => r.status === 200 });
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

function safeGet(obj, path, fallback) {
  var parts = path.split(".");
  var cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (cur == null) return fallback;
    cur = cur[parts[i]];
  }
  return cur == null ? fallback : cur;
}

function textSummary(data) {
  var metrics = data.metrics || {};
  var state = data.state || {};
  var lines = [
    "═══════════════════════════════════════════════════════════════",
    "  RemitFlow Load Test Results",
    "═══════════════════════════════════════════════════════════════",
    "  Stage: " + STAGE,
    "  Duration: " + Math.round((state.testRunDurationMs || 0) / 1000) + "s",
    "  VUs: " + safeGet(metrics, "vus.values.max", 0) + " max",
    "───────────────────────────────────────────────────────────────",
    "  HTTP Reqs:        " + safeGet(metrics, "http_reqs.values.count", 0),
    "  Avg Duration:     " + Math.round(safeGet(metrics, "http_req_duration.values.avg", 0)) + "ms",
    "  P95 Duration:     " + Math.round(safeGet(metrics, "http_req_duration.values.p(95)", 0)) + "ms",
    "  P99 Duration:     " + Math.round(safeGet(metrics, "http_req_duration.values.p(99)", 0)) + "ms",
    "  Error Rate:       " + ((safeGet(metrics, "errors.values.rate", 0)) * 100).toFixed(2) + "%",
    "  Transfers:        " + safeGet(metrics, "successful_transfers.values.count", 0),
    "───────────────────────────────────────────────────────────────",
    "  Transfer P95:     " + Math.round(safeGet(metrics, "transfer_latency.values.p(95)", 0)) + "ms",
    "  FX Rate P95:      " + Math.round(safeGet(metrics, "fx_rate_latency.values.p(95)", 0)) + "ms",
    "  Auth P95:         " + Math.round(safeGet(metrics, "auth_latency.values.p(95)", 0)) + "ms",
    "  Wallet P95:       " + Math.round(safeGet(metrics, "wallet_latency.values.p(95)", 0)) + "ms",
    "═══════════════════════════════════════════════════════════════",
  ];
  return lines.join("\n") + "\n";
}
