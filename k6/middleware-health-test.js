/**
 * RemitFlow — k6 Load Test: Middleware Health & SSE Endpoints
 * ══════════════════════════════════════════════════════════════════════════════
 * Tests the health check endpoints and SSE connection stability.
 *
 * Usage:
 *   k6 run k6/middleware-health-test.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const healthCheckSuccess = new Rate("health_check_success");
const healthCheckDuration = new Trend("health_check_ms", true);

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export const options = {
  scenarios: {
    health_checks: {
      executor: "constant-vus",
      vus: 20,
      duration: "5m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<200"],
    http_req_failed: ["rate<0.001"],
    health_check_success: ["rate>0.999"],
    health_check_ms: ["p(95)<150"],
  },
};

export default function () {
  // Test basic health endpoint
  const start = Date.now();
  const healthRes = http.get(`${BASE_URL}/api/health`);
  healthCheckDuration.add(Date.now() - start);

  const healthOk = check(healthRes, {
    "health status 200": (r) => r.status === 200,
    "health response time < 200ms": () => Date.now() - start < 200,
  });
  healthCheckSuccess.add(healthOk);

  sleep(0.5);

  // Test middleware health endpoint
  const mwRes = http.get(`${BASE_URL}/api/middleware/health`);
  check(mwRes, {
    "middleware health status 200": (r) => r.status === 200,
    "middleware health has services": (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.services) || typeof body.status === "string";
      } catch { return false; }
    },
  });

  sleep(0.5);

  // Test FX rates SSE endpoint (just check it opens)
  const sseRes = http.get(`${BASE_URL}/api/sse/fx-rates`, {
    headers: { Accept: "text/event-stream" },
    timeout: "2s",
  });
  check(sseRes, {
    "SSE endpoint reachable": (r) => r.status === 200 || r.status === 204,
  });

  sleep(1);
}
