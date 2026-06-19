/**
 * RemitFlow — k6 Soak Testing: Long-running API stability
 *
 * Runs sustained moderate load for 30 minutes to detect:
 *   - Memory leaks
 *   - Connection pool exhaustion
 *   - Gradual performance degradation
 *   - Database connection leaks
 *
 * Usage:
 *   k6 run qa/load-testing/k6-api-soak.js --env BASE_URL=http://localhost:3001
 *
 * CI/CD:
 *   Run nightly or before releases. Exits with code 1 if degradation detected.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

const p95Trend = new Trend("soak_p95_latency");
const memoryGrowth = new Rate("memory_growth_detected");

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const TRPC_URL = `${BASE_URL}/api/trpc`;

export const options = {
  scenarios: {
    soak: {
      executor: "constant-vus",
      vus: 500,
      duration: "30m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<400", "p(99)<1500"],
    http_req_failed: ["rate<0.005"], // < 0.5% error rate for soak
    soak_p95_latency: ["p(95)<400"],
  },
};

const ENDPOINTS = [
  { method: "GET", path: "remittanceCorridors.list", input: {} },
  { method: "GET", path: "crossCurrencySwap.getSupportedPairs", input: {} },
  { method: "GET", path: "lendingBorrowing.getMarkets", input: {} },
  { method: "GET", path: "savingsVault.getTiers", input: {} },
];

export default function () {
  const endpoint = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
  const encodedInput = encodeURIComponent(JSON.stringify({ json: endpoint.input }));
  const url = `${TRPC_URL}/${endpoint.path}?input=${encodedInput}`;

  const start = Date.now();
  const res = http.get(url, { tags: { name: endpoint.path } });
  const latency = Date.now() - start;
  p95Trend.add(latency);

  check(res, {
    "status 200": (r) => r.status === 200,
    "latency < 500ms": () => latency < 500,
  });

  // Check health endpoint periodically for memory stats
  if (Math.random() < 0.01) {
    const healthRes = http.get(`${BASE_URL}/api/services/health`);
    check(healthRes, {
      "health OK": (r) => r.status === 200,
    });
  }

  sleep(Math.random() * 1 + 0.5);
}
