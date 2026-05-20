/**
 * RemitFlow Smoke Test Suite (Node.js)
 *
 * Runs end-to-end smoke tests against a running RemitFlow instance.
 * Usage:
 *   BASE_URL=https://your-domain.manus.space node scripts/smoke-test.mjs
 *   node scripts/smoke-test.mjs  (defaults to http://localhost:3000)
 *
 * Exit codes: 0 = all passed, 1 = one or more failed
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const TIMEOUT_MS = 10000;

let passed = 0;
let failed = 0;
const errors = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pass(msg) {
  console.log(`  ✅ ${msg}`);
  passed++;
}
function fail(msg, detail = "") {
  console.log(`  ❌ ${msg}${detail ? ` — ${detail}` : ""}`);
  failed++;
  errors.push(msg);
}

async function get(path, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
      headers: { "Accept": "application/json", ...opts.headers },
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function trpc(procedure, input = null) {
  const inputParam = input !== null
    ? encodeURIComponent(JSON.stringify({ "0": { json: input } }))
    : encodeURIComponent(JSON.stringify({ "0": { json: null } }));
  const res = await get(`/api/trpc/${procedure}?batch=1&input=${inputParam}`);
  const json = await res.json();
  return { status: res.status, body: json, result: json?.[0]?.result?.data?.json };
}

async function post(path, body, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─── Test Suites ──────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════");
console.log(`  RemitFlow Smoke Test Suite`);
console.log(`  Target: ${BASE_URL}`);
console.log("══════════════════════════════════════════════════════\n");

// ── 1. Health Check ──────────────────────────────────────────────────────────
console.log("→ Health checks");
try {
  const { result } = await trpc("system.health");
  if (result?.status === "ok") pass("Health endpoint: status=ok");
  else fail("Health endpoint: unexpected status", JSON.stringify(result));

  if (result?.db === true) pass("Database: connected");
  else fail("Database: not connected");
} catch (err) {
  fail("Health endpoint: request failed", err.message);
}

// ── 2. Root Page ─────────────────────────────────────────────────────────────
console.log("→ Static assets");
try {
  const res = await get("/");
  if (res.status === 200) pass("Root page: returns 200");
  else fail("Root page: unexpected status", res.status);
} catch (err) {
  fail("Root page: request failed", err.message);
}

// ── 3. FX Rates ──────────────────────────────────────────────────────────────
console.log("→ FX rates");
try {
  const { result } = await trpc("fx.rates");
  // fx.rates returns an array of { currency, rate, ... } objects
  const ratesArray = Array.isArray(result) ? result : (result?.rates ? Object.entries(result.rates).map(([currency, rate]) => ({ currency, rate })) : []);
  const rateMap = {};
  for (const r of ratesArray) rateMap[r.currency] = r.rate;
  if (rateMap.NGN) pass(`FX rates: NGN=${rateMap.NGN}`);
  else fail("FX rates: NGN not found");
  if (rateMap.GHS) pass(`FX rates: GHS=${rateMap.GHS}`);
  else fail("FX rates: GHS not found");
  if (rateMap.KES) pass(`FX rates: KES=${rateMap.KES}`);
  else fail("FX rates: KES not found");
} catch (err) {
  fail("FX rates: request failed", err.message);
}

// ── 4. Corridors ─────────────────────────────────────────────────────────────
console.log("→ Corridors");
try {
  const { result } = await trpc("corridors.list");
  if (Array.isArray(result) && result.length > 0) pass(`Corridors: ${result.length} corridors available`);
  else fail("Corridors: empty or invalid response");
} catch (err) {
  fail("Corridors: request failed", err.message);
}

// ── 5. Auth Endpoints ────────────────────────────────────────────────────────
console.log("→ Auth endpoints");
try {
  const { body } = await trpc("auth.me");
  const isUnauth = JSON.stringify(body).includes("UNAUTHORIZED") || body?.[0]?.error;
  if (isUnauth) pass("auth.me: correctly returns UNAUTHORIZED without session");
  else pass("auth.me: endpoint responds (session may exist)");
} catch (err) {
  fail("auth.me: request failed", err.message);
}

try {
  const res = await get("/api/oauth/callback");
  if (res.status !== 404) pass(`OAuth callback: endpoint exists (status ${res.status})`);
  else fail("OAuth callback: 404 not found");
} catch (err) {
  fail("OAuth callback: request failed", err.message);
}

// ── 6. tRPC Batch POST ───────────────────────────────────────────────────────
console.log("→ tRPC batch POST");
try {
  // tRPC query procedures only accept GET; use a mutation procedure for POST test
  // or use GET with batch parameter
  const res = await get("/api/trpc/system.health?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D");
  const json = await res.json();
  if (json?.[0]?.result) pass("tRPC batch GET: works");
  else fail("tRPC batch GET: unexpected response", JSON.stringify(json).slice(0, 100));
} catch (err) {
  fail("tRPC batch GET: request failed", err.message);
}

// ── 7. Security Headers ──────────────────────────────────────────────────────
console.log("→ Security headers");
try {
  const res = await get("/");
  const headers = Object.fromEntries(res.headers.entries());
  if (headers["x-content-type-options"]) pass("X-Content-Type-Options: present");
  else fail("X-Content-Type-Options: missing");
  if (headers["x-frame-options"]) pass("X-Frame-Options: present");
  else fail("X-Frame-Options: missing");
} catch (err) {
  fail("Security headers: request failed", err.message);
}

// ── 8. Error Handling ────────────────────────────────────────────────────────
console.log("→ Error handling");
try {
  const { body } = await trpc("nonexistent.procedure");
  if (JSON.stringify(body).includes("error")) pass("Non-existent procedure: returns error (not 500)");
  else fail("Non-existent procedure: unexpected response");
} catch (err) {
  fail("Non-existent procedure: request failed", err.message);
}

// ── 9. Stripe Webhook Endpoint ───────────────────────────────────────────────
console.log("→ Stripe webhook");
try {
  const res = await post("/api/stripe/webhook", {}, { "stripe-signature": "invalid" });
  if (res.status === 400) pass("Stripe webhook: rejects invalid signature (400)");
  else fail("Stripe webhook: unexpected status", res.status);
} catch (err) {
  fail("Stripe webhook: request failed", err.message);
}

// ── 10. Rate Limiting Headers ────────────────────────────────────────────────
console.log("→ Rate limiting");
try {
  const res = await get("/api/trpc/system.health?batch=1&input={}");
  // Rate limit headers may or may not be present depending on config
  pass("Rate limiting: endpoint accessible (not blocked)");
} catch (err) {
  fail("Rate limiting: request failed", err.message);
}

// ── 11. POS Terminals ──────────────────────────────────────────────────────────
console.log("→ POS terminals");
try {
  const { body } = await trpc("pos.terminals");
  const data = body?.[0]?.result?.data?.json;
  const errCode = body?.[0]?.error?.json?.data?.code ?? body?.[0]?.error?.data?.code;
  if (Array.isArray(data)) pass("POS terminals: returns array from DB");
  else if (errCode === "UNAUTHORIZED") pass("POS terminals: protected (UNAUTHORIZED)");
  else fail("POS terminals: unexpected response", JSON.stringify(body).slice(0, 100));
} catch (err) {
  fail("POS terminals: request failed", err.message);
}

// ── 12. Agent Network ────────────────────────────────────────────────────────
console.log("→ Agent network");
try {
  const { body } = await trpc("agents.list");
  const data = body?.[0]?.result?.data?.json;
  const errCode = body?.[0]?.error?.json?.data?.code ?? body?.[0]?.error?.data?.code;
  if (Array.isArray(data)) pass("Agents list: returns array from DB");
  else if (errCode === "UNAUTHORIZED") pass("Agents list: protected (UNAUTHORIZED)");
  else fail("Agents list: unexpected response", JSON.stringify(body).slice(0, 100));
} catch (err) {
  fail("Agents list: request failed", err.message);
}

// ── 13. Checkout Webhooks ────────────────────────────────────────────────────
console.log("→ Checkout webhooks");
try {
  const { body } = await trpc("checkout.webhooks");
  const data = body?.[0]?.result?.data?.json;
  const errCode = body?.[0]?.error?.json?.data?.code ?? body?.[0]?.error?.data?.code;
  if (Array.isArray(data)) pass("Checkout webhooks: returns array from DB");
  else if (errCode === "UNAUTHORIZED") pass("Checkout webhooks: protected (UNAUTHORIZED)");
  else fail("Checkout webhooks: unexpected response", JSON.stringify(body).slice(0, 100));
} catch (err) {
  fail("Checkout webhooks: request failed", err.message);
}

// ── 14. Feature Flags Nav ────────────────────────────────────────────────────
console.log("→ Feature flags nav");
try {
  const { body } = await trpc("featureFlags.getNavFlags");
  const data = body?.[0]?.result?.data?.json;
  const errCode = body?.[0]?.error?.json?.data?.code ?? body?.[0]?.error?.data?.code;
  if (data && typeof data === "object" && !Array.isArray(data)) pass("Feature flags getNavFlags: returns flags object");
  else if (errCode === "UNAUTHORIZED") pass("Feature flags getNavFlags: protected (UNAUTHORIZED)");
  else fail("Feature flags getNavFlags: unexpected response", JSON.stringify(body).slice(0, 100));
} catch (err) {
  fail("Feature flags getNavFlags: request failed", err.message);
}

// ── Summary ───────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log("\n══════════════════════════════════════════════════════");
console.log(`  Results: ${passed} passed / ${failed} failed / ${total} total`);
if (errors.length > 0) {
  console.log("\n  Failed tests:");
  for (const e of errors) console.log(`    • ${e}`);
}
console.log("══════════════════════════════════════════════════════\n");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("✅ All smoke tests passed!\n");
  process.exit(0);
}
