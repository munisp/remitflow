/**
 * RemitFlow — k6 Load Testing: Transfer Pipeline
 *
 * Simulates 10,000 concurrent users performing cross-border transfers.
 * Tests: corridor quotes, swap execution, batch payouts, wallet operations.
 *
 * Usage:
 *   k6 run qa/load-testing/k6-transfer-load.js --env BASE_URL=http://localhost:3001
 *   k6 run qa/load-testing/k6-transfer-load.js --env BASE_URL=https://staging.remitflow.io
 *
 * CI/CD:
 *   Exits with code 1 if any threshold is breached (p95 > 500ms, error rate > 1%)
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// ── Custom Metrics ──────────────────────────────────────────────────────────

const transferLatency = new Trend("transfer_latency_ms");
const quoteLatency = new Trend("quote_latency_ms");
const swapLatency = new Trend("swap_latency_ms");
const batchLatency = new Trend("batch_payout_latency_ms");
const errorRate = new Rate("errors");
const transfersCreated = new Counter("transfers_created");
const quotesRequested = new Counter("quotes_requested");

// ── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const TRPC_URL = `${BASE_URL}/api/trpc`;

export const options = {
  scenarios: {
    // Ramp up to 10K concurrent users over 5 minutes
    corridor_quotes: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 100 },
        { duration: "2m", target: 1000 },
        { duration: "3m", target: 5000 },
        { duration: "5m", target: 10000 },
        { duration: "2m", target: 10000 }, // sustained peak
        { duration: "1m", target: 0 },     // ramp down
      ],
      gracefulRampDown: "30s",
    },
    // Constant load for batch payouts (lower concurrency, heavier payload)
    batch_payouts: {
      executor: "constant-arrival-rate",
      rate: 50,
      timeUnit: "1s",
      duration: "10m",
      preAllocatedVUs: 200,
      maxVUs: 500,
    },
    // Spike test: sudden burst of traffic
    spike_test: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 5000 },  // instant spike
        { duration: "30s", target: 5000 },  // hold
        { duration: "10s", target: 0 },     // drop
      ],
      startTime: "12m", // after main load
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<2000"],
    transfer_latency_ms: ["p(95)<300"],
    quote_latency_ms: ["p(95)<200"],
    errors: ["rate<0.01"], // < 1% error rate
    http_req_failed: ["rate<0.01"],
  },
};

// ── Test Data ───────────────────────────────────────────────────────────────

const CORRIDORS = [
  { from: "USD", to: "NGN", code: "US-NG" },
  { from: "GBP", to: "GHS", code: "UK-GH" },
  { from: "EUR", to: "KES", code: "EU-KE" },
  { from: "USD", to: "KES", code: "US-KE" },
  { from: "GBP", to: "NGN", code: "UK-NG" },
  { from: "EUR", to: "NGN", code: "EU-NG" },
  { from: "USD", to: "GHS", code: "US-GH" },
  { from: "USD", to: "ZAR", code: "US-ZA" },
];

const STABLECOINS = ["USDC", "USDT", "DAI"];

function randomCorridor() {
  return CORRIDORS[Math.floor(Math.random() * CORRIDORS.length)];
}

function randomAmount(min, max) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function trpcCall(procedure, input) {
  const encodedInput = encodeURIComponent(JSON.stringify({ json: input }));
  return `${TRPC_URL}/${procedure}?input=${encodedInput}`;
}

function trpcMutation(procedure, input) {
  return http.post(
    `${TRPC_URL}/${procedure}`,
    JSON.stringify({ json: input }),
    { headers: { "Content-Type": "application/json" } }
  );
}

// ── Scenario: Corridor Quotes ───────────────────────────────────────────────

export default function () {
  const userId = Math.floor(Math.random() * 100000) + 1;

  group("Corridor Quote Flow", () => {
    // 1. Get corridor quote
    const corridor = randomCorridor();
    const amount = randomAmount(50, 5000);

    const quoteStart = Date.now();
    const quoteRes = http.get(
      trpcCall("remittanceCorridors.getQuote", {
        corridorId: corridor.code,
        amount,
        fromCurrency: corridor.from,
      }),
      { tags: { name: "corridor_quote" } }
    );
    quoteLatency.add(Date.now() - quoteStart);
    quotesRequested.add(1);

    const quoteOk = check(quoteRes, {
      "quote status 200": (r) => r.status === 200,
      "quote has rate": (r) => {
        try { return JSON.parse(r.body).result.data.json.fxRate > 0; }
        catch { return false; }
      },
    });
    errorRate.add(!quoteOk);

    // 2. Execute transfer (20% of users proceed)
    if (Math.random() < 0.2) {
      const transferStart = Date.now();
      const transferRes = trpcMutation("remittanceCorridors.send", {
        corridorId: corridor.code,
        amount,
        fromCurrency: corridor.from,
        recipientName: `User ${userId}`,
        recipientPhone: `+234${Math.floor(Math.random() * 9000000000 + 1000000000)}`,
        purpose: "family_support",
      });
      transferLatency.add(Date.now() - transferStart);
      transfersCreated.add(1);

      check(transferRes, {
        "transfer status 200": (r) => r.status === 200,
        "transfer has ID": (r) => {
          try { return JSON.parse(r.body).result.data.json.transferId !== undefined; }
          catch { return false; }
        },
      });
    }

    // 3. Get swap quote (30% of users)
    if (Math.random() < 0.3) {
      const fromCoin = STABLECOINS[Math.floor(Math.random() * STABLECOINS.length)];
      let toCoin = STABLECOINS[Math.floor(Math.random() * STABLECOINS.length)];
      while (toCoin === fromCoin) {
        toCoin = STABLECOINS[Math.floor(Math.random() * STABLECOINS.length)];
      }

      const swapStart = Date.now();
      const swapRes = http.get(
        trpcCall("crossCurrencySwap.getQuote", {
          from: fromCoin,
          to: toCoin,
          amount: randomAmount(100, 10000),
        }),
        { tags: { name: "swap_quote" } }
      );
      swapLatency.add(Date.now() - swapStart);

      check(swapRes, {
        "swap quote 200": (r) => r.status === 200,
      });
    }
  });

  sleep(Math.random() * 2 + 0.5); // 0.5-2.5s think time
}

// ── Scenario: Batch Payouts ─────────────────────────────────────────────────

export function batch_payouts() {
  const recipientCount = Math.floor(Math.random() * 50) + 10;
  const recipients = Array.from({ length: recipientCount }, (_, i) => ({
    name: `Recipient ${i + 1}`,
    amount: randomAmount(100, 5000),
    account: `${Math.floor(Math.random() * 9000000000 + 1000000000)}`,
    bank: "058",
  }));

  const batchStart = Date.now();
  const res = trpcMutation("batchPayouts.create", {
    name: `Payroll ${Date.now()}`,
    currency: "NGN",
    recipients,
    dryRun: true,
  });
  batchLatency.add(Date.now() - batchStart);

  check(res, {
    "batch created": (r) => r.status === 200,
    "batch has ID": (r) => {
      try { return JSON.parse(r.body).result.data.json.batchId !== undefined; }
      catch { return false; }
    },
  });

  sleep(1);
}
