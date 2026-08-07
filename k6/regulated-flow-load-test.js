import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "").replace(/\/$/, "");
const TENANT_ID = __ENV.REMITFLOW_TEST_TENANT_ID || "";
const TOKEN = __ENV.REMITFLOW_LOAD_TEST_TOKEN || "";
const SCENARIO = __ENV.SCENARIO || "smoke";
const APPROVED = __ENV.REMITFLOW_CONTROLLED_TEST_APPROVED === "true";
const SANDBOX = __ENV.REGULATORY_PROVIDER_MODE === "sandbox";

if (!APPROVED || !BASE_URL || !TENANT_ID || !TOKEN) {
  throw new Error("Controlled RemitFlow load testing requires REMITFLOW_CONTROLLED_TEST_APPROVED=true, BASE_URL, REMITFLOW_TEST_TENANT_ID, and REMITFLOW_LOAD_TEST_TOKEN.");
}
if (/prod(uction)?/i.test(BASE_URL) && __ENV.REMITFLOW_PRODUCTION_CHANGE_APPROVED !== "true") {
  throw new Error("Refusing an unapproved production target. Use a dedicated staging/canary URL or provide the explicit change-control approval.");
}
if (SCENARIO === "highscale" && __ENV.REMITFLOW_HIGHSCALE_APPROVED !== "true") {
  throw new Error("The 5,000-VU profile requires REMITFLOW_HIGHSCALE_APPROVED=true and an attached capacity approval.");
}

const profiles = {
  smoke: { executor: "constant-vus", vus: 5, duration: "1m" },
  staged: { executor: "ramping-vus", startVUs: 0, stages: [{ duration: "2m", target: 50 }, { duration: "5m", target: 200 }, { duration: "2m", target: 0 }] },
  highscale: { executor: "ramping-vus", startVUs: 0, stages: [{ duration: "5m", target: 500 }, { duration: "10m", target: 2000 }, { duration: "10m", target: 5000 }, { duration: "5m", target: 0 }] },
};

const queueReadSuccess = new Rate("regulated_queue_read_success");
const queueReadLatency = new Trend("regulated_queue_read_latency_ms", true);
const tenantIsolationFailures = new Counter("regulated_tenant_isolation_failures");
const controlledSarQueued = new Counter("controlled_sar_queued");

export const options = {
  scenarios: { regulated_queue: profiles[SCENARIO] || profiles.smoke },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    regulated_queue_read_success: ["rate>0.99"],
    regulated_queue_read_latency_ms: ["p(95)<500", "p(99)<1200"],
    regulated_tenant_isolation_failures: ["count==0"],
  },
};

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "X-Tenant-ID": TENANT_ID,
  "Content-Type": "application/json",
};

function queueSummary() {
  const start = Date.now();
  const response = http.get(`${BASE_URL}/api/trpc/compliance.reporting.queueSummary`, { headers });
  queueReadLatency.add(Date.now() - start);
  const ok = check(response, {
    "regulatory queue summary returns 200": (r) => r.status === 200,
    "regulatory queue summary is a tRPC response": (r) => r.body.includes("result"),
  });
  queueReadSuccess.add(ok);
}

function proveTenantBoundary() {
  const response = http.get(`${BASE_URL}/api/trpc/compliance.reporting.queueSummary`, {
    headers: { ...headers, "X-Tenant-ID": `${TENANT_ID}-unauthorized` },
  });
  const isolated = response.status === 401 || response.status === 403 || response.status === 404;
  if (!isolated) tenantIsolationFailures.add(1);
  check(response, { "cross-tenant queue request is denied": () => isolated });
}

function queueControlledSar() {
  if (__ENV.REMITFLOW_MUTATION_TEST_APPROVED !== "true") return;
  if (!SANDBOX) throw new Error("Controlled SAR submission requires REGULATORY_PROVIDER_MODE=sandbox.");
  const reference = `LOAD-SAR-${__VU}-${__ITER}-${Date.now()}`;
  const payload = {
    json: {
      subject: { type: "entity", entityName: "RemitFlow controlled staging test", country: "CA", accountNumbers: [`sandbox-${__VU}`] },
      transactions: [{ id: reference, date: new Date().toISOString(), amount: 1, currency: "CAD", type: "wire", direction: "internal" }],
      indicators: ["structuring"],
      narrative: `Controlled staging load-validation report ${reference}. This sandbox-only record validates the durable regulatory queue and must not be routed to a live regulator.`,
      jurisdiction: "CA",
      dateRange: { from: new Date(Date.now() - 60_000).toISOString(), to: new Date().toISOString() },
    },
  };
  const response = http.post(`${BASE_URL}/api/trpc/compliance.reporting.fileSAR`, JSON.stringify(payload), { headers });
  const ok = check(response, {
    "controlled SAR queues successfully": (r) => r.status === 200 && r.body.includes("queueId"),
  });
  if (ok) controlledSarQueued.add(1);
}

export default function () {
  queueSummary();
  if (__ITER % 10 === 0) proveTenantBoundary();
  if (__ITER % 25 === 0) queueControlledSar();
  sleep(0.2);
}
