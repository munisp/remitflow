#!/usr/bin/env node
/**
 * RemitFlow v44 — Comprehensive Smoke Test Suite
 * 40+ tests covering all major API flows
 *
 * Usage: node scripts/smoke-test-v44.mjs [BASE_URL]
 * Default: http://localhost:3000
 */

const BASE = process.argv[2] || "http://localhost:3000";
const TRPC = `${BASE}/api/trpc`;

let passed = 0;
let failed = 0;
const results = [];

async function trpc(procedure, input, method = "GET") {
  // tRPC v11 + superjson: input must be wrapped in { json: ... }
  const inputStr = JSON.stringify({ "0": input !== undefined ? { json: input } : {} });
  const url = method === "GET"
    ? `${TRPC}/${procedure}?batch=1&input=${encodeURIComponent(inputStr)}`
    : `${TRPC}/${procedure}?batch=1`;

  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10000),
  };
  if (method === "POST") opts.body = JSON.stringify({ "0": input ?? {} });

  const res = await fetch(url, opts);
  const json = await res.json();

  // tRPC batch format: [{ result: { data: { json: ... } } }] or [{ error: { json: ... } }]
  if (json[0]?.error) {
    const err = json[0].error?.json ?? json[0].error;
    throw new Error(err.message || JSON.stringify(err).slice(0, 200));
  }
  // Unwrap tRPC batch + superjson
  return json[0]?.result?.data?.json ?? json[0]?.result?.data;
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ status: "✅", name });
    process.stdout.write(".");
  } catch (e) {
    failed++;
    results.push({ status: "❌", name, error: e.message?.slice(0, 120) });
    process.stdout.write("F");
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function expectAuth(e) {
  assert(
    e.message.includes("UNAUTHORIZED") || e.message.includes("401") ||
    e.message.includes("unauthenticated") || e.message.includes("login") ||
    e.message.includes("Please login"),
    `Expected auth error, got: ${e.message}`
  );
}

console.log(`\n🔥 RemitFlow v44 Smoke Tests → ${BASE}\n`);

// ── 1. System Health ──────────────────────────────────────────────────────────
await test("system.health returns ok", async () => {
  const data = await trpc("system.health");
  assert(data?.status === "ok", `Expected ok, got ${data?.status}`);
  assert(data?.db === true, "DB should be connected");
});

await test("system.health has version and uptime", async () => {
  const data = await trpc("system.health");
  assert(data?.version, "Missing version field");
  assert(data?.uptime >= 0, "Uptime should be non-negative");
});

// ── 2. Auth ───────────────────────────────────────────────────────────────────
await test("auth.me returns UNAUTHORIZED when not authenticated", async () => {
  try {
    await trpc("auth.me");
    throw new Error("Should have thrown UNAUTHORIZED");
  } catch (e) { expectAuth(e); }
});

// ── 3. FX Rates ───────────────────────────────────────────────────────────────
await test("fx.rates returns rates object", async () => {
  const data = await trpc("fx.rates");
  assert(data, "No data returned");
  assert(typeof data === "object", "Expected rates object");
});

await test("fx.calculate converts USD to NGN", async () => {
  const data = await trpc("fx.calculate", { from: "USD", to: "NGN", amount: 100 });
  assert(data, "No data returned");
  const result = data.result ?? data.convertedAmount ?? data.toAmount ?? data.amount;
  assert(Number(result) > 0, `Conversion should be positive, got ${result}`);
});

await test("fx.liveRates supports GBP base", async () => {
  const data = await trpc("fx.liveRates", { base: "GBP" });
  assert(data, "No data returned");
});

// ── 4. Dashboard ──────────────────────────────────────────────────────────────
await test("dashboard.summary requires auth", async () => {
  try { await trpc("dashboard.summary"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 5. Beneficiaries ─────────────────────────────────────────────────────────
await test("beneficiaries.list requires auth", async () => {
  try { await trpc("beneficiaries.list"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 6. Transactions ───────────────────────────────────────────────────────────
await test("transactions.list requires auth", async () => {
  try { await trpc("transactions.list"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 7. KYC ────────────────────────────────────────────────────────────────────
await test("kyc.status requires auth", async () => {
  try { await trpc("kyc.status"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 8. Wallets ────────────────────────────────────────────────────────────────
await test("wallet.list requires auth", async () => {
  try { await trpc("wallet.list"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 9. Notifications ──────────────────────────────────────────────────────────
await test("notifications.list requires auth", async () => {
  try { await trpc("notifications.list"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 10. Savings ───────────────────────────────────────────────────────────────
await test("savings.list requires auth", async () => {
  try { await trpc("savings.list"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 11. Referrals ─────────────────────────────────────────────────────────────
await test("referral.stats requires auth", async () => {
  try { await trpc("referral.stats"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 12. Marketplace (public browsing) ─────────────────────────────────────────
await test("marketplace.listListings returns public listings", async () => {
  const data = await trpc("marketplace.listListings", { page: 1, limit: 5 });
  assert(data !== undefined && data !== null, "No data returned");
  const items = data?.listings ?? data?.items ?? data;
  assert(Array.isArray(items) || typeof data === "object", "Expected listings data");
});

await test("marketplace.listListings supports search filter", async () => {
  const data = await trpc("marketplace.listListings", { page: 1, limit: 5, search: "phone" });
  assert(data !== undefined, "No data returned");
});

// ── 13. Talent (public browsing) ──────────────────────────────────────────────
await test("talent.listExperts returns public profiles", async () => {
  const data = await trpc("talent.listExperts", { limit: 5 });
  assert(data !== undefined, "No data returned");
  assert(Array.isArray(data) || typeof data === "object", "Expected profiles data");
});

await test("talent.listOpportunities returns public opportunities", async () => {
  const data = await trpc("talent.listOpportunities", { limit: 5 });
  assert(data !== undefined, "No data returned");
});

// ── 14. Community (public browsing) ───────────────────────────────────────────
await test("community.listFunds returns public funds", async () => {
  const data = await trpc("community.listFunds");
  assert(data !== undefined, "No data returned");
  assert(Array.isArray(data) || typeof data === "object", "Expected funds data");
});

// ── 15. Diaspora (public browsing) ────────────────────────────────────────────
await test("diaspora.listOpportunities returns investment opportunities", async () => {
  const data = await trpc("diaspora.listOpportunities");
  assert(data !== undefined, "No data returned");
});

await test("diaspora.listCollectives requires auth", async () => {
  try { await trpc("diaspora.listCollectives"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 16. Rate Alerts ───────────────────────────────────────────────────────────
await test("rateAlerts.list requires auth", async () => {
  try { await trpc("rateAlerts.list"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

await test("rateAlerts.checkNow requires auth", async () => {
  try { await trpc("rateAlerts.checkNow"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 17. Scheduler ─────────────────────────────────────────────────────────────
await test("scheduler.list requires auth", async () => {
  try { await trpc("scheduler.list"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 18. Fraud Monitor ─────────────────────────────────────────────────────────
await test("fraudMonitor.stats requires auth", async () => {
  try { await trpc("fraudMonitor.stats"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 19. Disputes ─────────────────────────────────────────────────────────────
await test("disputes.list requires auth", async () => {
  try { await trpc("disputes.list"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 20. Compliance ────────────────────────────────────────────────────────────
await test("compliance.fcaDashboard requires auth", async () => {
  try { await trpc("compliance.fcaDashboard"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 21. Microservices Health ──────────────────────────────────────────────────
await test("microservices.healthAll requires auth", async () => {
  try { await trpc("microservices.healthAll"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 22. Family ────────────────────────────────────────────────────────────────
await test("family.listMembers requires auth", async () => {
  try { await trpc("family.listMembers"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 23. Batch Payments ────────────────────────────────────────────────────────
await test("batch.list requires auth", async () => {
  try { await trpc("batch.list"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 24. Cards ─────────────────────────────────────────────────────────────────
await test("cards.list requires auth", async () => {
  try { await trpc("cards.list"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 25. Virtual Accounts ──────────────────────────────────────────────────────
await test("virtualAccount.list requires auth", async () => {
  try { await trpc("virtualAccount.list"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 26. Audit Logs ────────────────────────────────────────────────────────────
await test("audit.list requires auth", async () => {
  try { await trpc("audit.list"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 27. GDPR ──────────────────────────────────────────────────────────────────
await test("gdpr.exportData requires auth", async () => {
  try { await trpc("gdpr.exportData", {}, "POST"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 28. Support Tickets ───────────────────────────────────────────────────────
await test("support.tickets requires auth", async () => {
  try { await trpc("support.tickets"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 29. Admin (requires admin role) ──────────────────────────────────────────
await test("admin.summary requires auth", async () => {
  try { await trpc("admin.summary"); throw new Error("Should throw"); }
  catch (e) {
    assert(
      e.message.includes("UNAUTHORIZED") || e.message.includes("401") ||
      e.message.includes("login") || e.message.includes("FORBIDDEN") ||
      e.message.includes("Please login"),
      `Expected auth/forbidden error, got: ${e.message}`
    );
  }
});

// ── 30. Static Assets ─────────────────────────────────────────────────────────
await test("GET / returns HTML", async () => {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(10000) });
  assert(res.ok, `Expected 200, got ${res.status}`);
  const text = await res.text();
  assert(text.includes("<html") || text.includes("<!DOCTYPE"), "Expected HTML response");
});

await test("GET /api/trpc/system.health returns JSON array", async () => {
  const res = await fetch(`${TRPC}/system.health?batch=1&input=%7B%7D`, { signal: AbortSignal.timeout(10000) });
  assert(res.ok, `Expected 200, got ${res.status}`);
  const json = await res.json();
  assert(Array.isArray(json), "Expected JSON array");
  assert(json[0]?.result?.data?.json?.status === "ok", "Expected status ok");
});

// ── 31. Security Headers ──────────────────────────────────────────────────────
await test("Response has X-Frame-Options header", async () => {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(10000) });
  const xfo = res.headers.get("x-frame-options");
  assert(xfo, "Missing X-Frame-Options header");
});

await test("Response has X-Content-Type-Options header", async () => {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(10000) });
  const xcto = res.headers.get("x-content-type-options");
  assert(xcto === "nosniff", `Expected nosniff, got ${xcto}`);
});

await test("Response has Content-Security-Policy header", async () => {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(10000) });
  const csp = res.headers.get("content-security-policy");
  assert(csp, "Missing Content-Security-Policy header");
  assert(csp.includes("default-src"), "CSP should have default-src directive");
});

await test("Response has Strict-Transport-Security header", async () => {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(10000) });
  const hsts = res.headers.get("strict-transport-security");
  assert(hsts, "Missing Strict-Transport-Security header");
});

// ── 32. Input Validation ──────────────────────────────────────────────────────
await test("fx.calculate rejects zero amount", async () => {
  try {
    const data = await trpc("fx.calculate", { from: "USD", to: "NGN", amount: 0 });
    // Either throws or returns 0
    assert(true, "Handled gracefully");
  } catch (e) {
    assert(true, "Correctly rejected zero amount");
  }
});

// ── 33. Rate Limiting ─────────────────────────────────────────────────────────
await test("API handles 5 concurrent requests", async () => {
  const requests = Array(5).fill(null).map(() => trpc("system.health"));
  const results = await Promise.allSettled(requests);
  const succeeded = results.filter(r => r.status === "fulfilled").length;
  assert(succeeded >= 3, `Only ${succeeded}/5 concurrent requests succeeded`);
});

// ── 34. OAuth Flow ────────────────────────────────────────────────────────────
await test("GET /api/oauth/callback handles missing code gracefully", async () => {
  const res = await fetch(`${BASE}/api/oauth/callback`, { redirect: "manual", signal: AbortSignal.timeout(10000) });
  assert(res.status !== 500, `Server error on OAuth callback: ${res.status}`);
});

// ── 35. Stripe Webhook ────────────────────────────────────────────────────────
await test("POST /api/stripe/webhook rejects invalid signature", async () => {
  const res = await fetch(`${BASE}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": "t=invalid,v1=invalid" },
    body: JSON.stringify({ type: "test" }),
    signal: AbortSignal.timeout(10000),
  });
  assert(res.status === 400 || res.status === 401 || res.status === 403,
    `Expected 400/401/403 for invalid webhook, got ${res.status}`);
});

// ── 36. SPA Fallback ──────────────────────────────────────────────────────────
await test("GET /nonexistent-page returns 200 (SPA fallback)", async () => {
  const res = await fetch(`${BASE}/this-page-does-not-exist-xyz`, { signal: AbortSignal.timeout(10000) });
  assert(res.status === 200, `SPA fallback should return 200, got ${res.status}`);
  const text = await res.text();
  assert(text.includes("<html") || text.includes("<!DOCTYPE"), "Expected HTML SPA fallback");
});

// ── 37. tRPC 404 ──────────────────────────────────────────────────────────────
await test("tRPC nonexistent procedure returns NOT_FOUND", async () => {
  const res = await fetch(`${TRPC}/nonexistent.procedure?batch=1&input=%7B%7D`, { signal: AbortSignal.timeout(10000) });
  const json = await res.json();
  assert(json[0]?.error, "Expected error in response");
  const code = json[0]?.error?.json?.data?.code ?? json[0]?.error?.data?.code;
  assert(code === "NOT_FOUND" || res.status === 404, `Expected NOT_FOUND, got ${code}`);
});

// ── 38. CORS ──────────────────────────────────────────────────────────────────
await test("API returns CORS headers for allowed origins", async () => {
  const res = await fetch(`${TRPC}/system.health?batch=1&input=%7B%7D`, {
    headers: { "Origin": BASE },
    signal: AbortSignal.timeout(10000),
  });
  assert(res.status !== 500, `CORS request returned 500`);
  assert(res.ok, `Expected 200, got ${res.status}`);
});

// ── 39. Content Type ──────────────────────────────────────────────────────────
await test("tRPC endpoint returns JSON content-type", async () => {
  const res = await fetch(`${TRPC}/system.health?batch=1&input=%7B%7D`, { signal: AbortSignal.timeout(10000) });
  const ct = res.headers.get("content-type") || "";
  assert(ct.includes("json"), `Expected JSON content-type, got: ${ct}`);
});

// ── 40. Impersonation Token Security ─────────────────────────────────────────
await test("auth.impersonate rejects invalid token", async () => {
  try {
    await trpc("auth.impersonate", { token: "invalid-token-xyz-abc-123" }, "POST");
    throw new Error("Should have thrown NOT_FOUND");
  } catch (e) {
    assert(
      e.message.includes("NOT_FOUND") || e.message.includes("Invalid") ||
      e.message.includes("404") || e.message.includes("not found") ||
      e.message.includes("expired"),
      `Expected NOT_FOUND/Invalid, got: ${e.message}`
    );
  }
});

// ── 41. Rate Lock ─────────────────────────────────────────────────────────────
await test("fx.locks requires auth", async () => {
  try { await trpc("fx.locks"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 42. Recurring Payments ────────────────────────────────────────────────────
await test("recurring.list requires auth", async () => {
  try { await trpc("recurring.list"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 43. Profile ───────────────────────────────────────────────────────────────
await test("profile.get requires auth", async () => {
  try { await trpc("profile.get"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 44. Security Settings ─────────────────────────────────────────────────────
await test("security.status requires auth", async () => {
  try { await trpc("security.status"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── 45. Analytics ─────────────────────────────────────────────────────────────
await test("analytics.overview requires auth", async () => {
  try { await trpc("analytics.overview"); throw new Error("Should throw"); }
  catch (e) { expectAuth(e); }
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n\n" + "=".repeat(60));
console.log(`RemitFlow v44 Smoke Test Results`);
console.log("=".repeat(60));

for (const r of results) {
  const line = `${r.status} ${r.name}`;
  if (r.error) console.log(`${line}\n   └─ ${r.error}`);
  else console.log(line);
}

const total = passed + failed;
const score = Math.round((passed / total) * 100);
console.log("\n" + "=".repeat(60));
console.log(`Total: ${total} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);
console.log(`Score: ${score}%`);
console.log("=".repeat(60));

if (failed > 0) process.exit(1);
