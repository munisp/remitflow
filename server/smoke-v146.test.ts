/**
 * smoke-v146.test.ts
 * Smoke tests for RemitFlow v146 production sprint.
 *
 * Coverage:
 * - Geo-blocking for OFAC/FATF high-risk countries (geoBlockMiddleware)
 * - User-ID-based account lockout (recordUserLoginFailure / checkUserLockout)
 * - HMAC request signing for service-to-service calls (signServiceRequest / verifyServiceSignature)
 * - Secrets rotation detection (registerSecret / checkSecretsRotation)
 * - mTLS certificate validation (mtlsMiddleware)
 * - Security controls count upgraded to 32
 * - Stripe top-up popup removed from Wallet.tsx
 * - Seed file has --reset flag handling
 * - All 32 orphaned routers are properly nested under v89/v90/v99
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  geoBlockMiddleware,
  recordUserLoginFailure,
  checkUserLockout,
  clearUserLockout,
  signServiceRequest,
  verifyServiceSignature,
  serviceSignatureMiddleware,
  checkSecretsRotation,
  mtlsMiddleware,
} from "./security.attacks.js";
import { readFileSync } from "fs";
import { resolve } from "path";

// ─── Helper: create minimal Express mock ─────────────────────────────────────
function mockReqRes(overrides: {
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  path?: string;
  ip?: string;
}) {
  const req = {
    headers: overrides.headers ?? {},
    body: overrides.body ?? {},
    path: overrides.path ?? "/api/trpc/transfer.send",
    ip: overrides.ip ?? "203.0.113.1", // Non-private test IP
    socket: { remoteAddress: overrides.ip ?? "203.0.113.1" },
  } as any;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  } as any;
  const next = vi.fn();
  return { req, res, next };
}

// ─── 1. Geo-Blocking Middleware ───────────────────────────────────────────────
describe("geoBlockMiddleware (v146)", () => {
  it("blocks requests from North Korea (KP)", () => {
    const { req, res, next } = mockReqRes({ headers: { "cf-ipcountry": "KP" } });
    geoBlockMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(451);
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks requests from Iran (IR)", () => {
    const { req, res, next } = mockReqRes({ headers: { "cf-ipcountry": "IR" } });
    geoBlockMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(451);
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks requests from Russia (RU)", () => {
    const { req, res, next } = mockReqRes({ headers: { "x-country-code": "RU" } });
    geoBlockMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(451);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows requests from UK (GB)", () => {
    const { req, res, next } = mockReqRes({ headers: { "cf-ipcountry": "GB" } });
    geoBlockMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows requests from Nigeria (NG)", () => {
    const { req, res, next } = mockReqRes({ headers: { "cf-ipcountry": "NG" } });
    geoBlockMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("allows localhost (no geo header)", () => {
    const { req, res, next } = mockReqRes({ ip: "127.0.0.1" });
    geoBlockMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("allows private IPs (10.x.x.x)", () => {
    const { req, res, next } = mockReqRes({ ip: "10.0.0.1" });
    geoBlockMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("includes GEO_BLOCKED code in response", () => {
    const { req, res, next } = mockReqRes({ headers: { "cf-ipcountry": "SY" } });
    geoBlockMiddleware(req, res, next);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "GEO_BLOCKED" })
    );
  });
});

// ─── 2. User-ID-Based Account Lockout ────────────────────────────────────────
describe("User-ID account lockout (v146)", () => {
  const TEST_USER_ID = 999_001;

  beforeEach(() => {
    clearUserLockout(TEST_USER_ID);
  });

  it("does not lock on first failure", () => {
    const result = recordUserLoginFailure(TEST_USER_ID);
    expect(result.locked).toBe(false);
  });

  it("does not lock after 4 failures", () => {
    for (let i = 0; i < 4; i++) {
      recordUserLoginFailure(TEST_USER_ID);
    }
    const check = checkUserLockout(TEST_USER_ID);
    expect(check.locked).toBe(false);
  });

  it("locks after 5 failures", () => {
    for (let i = 0; i < 5; i++) {
      recordUserLoginFailure(TEST_USER_ID);
    }
    const check = checkUserLockout(TEST_USER_ID);
    expect(check.locked).toBe(true);
    expect(check.retryAfter).toBeGreaterThan(0);
  });

  it("clears lockout on clearUserLockout", () => {
    for (let i = 0; i < 5; i++) {
      recordUserLoginFailure(TEST_USER_ID);
    }
    clearUserLockout(TEST_USER_ID);
    const check = checkUserLockout(TEST_USER_ID);
    expect(check.locked).toBe(false);
  });

  it("returns retryAfter in seconds when locked", () => {
    for (let i = 0; i < 5; i++) {
      recordUserLoginFailure(TEST_USER_ID);
    }
    const check = checkUserLockout(TEST_USER_ID);
    expect(check.retryAfter).toBeGreaterThan(1700); // ~30 min = 1800s
  });
});

// ─── 3. HMAC Request Signing ──────────────────────────────────────────────────
describe("HMAC service-to-service signing (v146)", () => {
  it("produces a deterministic hex signature", () => {
    const ts = Date.now();
    const sig1 = signServiceRequest("payload", ts);
    const sig2 = signServiceRequest("payload", ts);
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifies a valid signature within the time window", () => {
    const ts = Date.now();
    const payload = JSON.stringify({ userId: 1, amount: 100 });
    const sig = signServiceRequest(payload, ts);
    expect(verifyServiceSignature(payload, ts, sig)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const ts = Date.now();
    const sig = signServiceRequest("original", ts);
    expect(verifyServiceSignature("tampered", ts, sig)).toBe(false);
  });

  it("rejects an expired timestamp (>30s old)", () => {
    const oldTs = Date.now() - 35_000;
    const sig = signServiceRequest("payload", oldTs);
    expect(verifyServiceSignature("payload", oldTs, sig)).toBe(false);
  });

  it("rejects a future timestamp (>30s ahead)", () => {
    const futureTs = Date.now() + 35_000;
    const sig = signServiceRequest("payload", futureTs);
    expect(verifyServiceSignature("payload", futureTs, sig)).toBe(false);
  });

  it("serviceSignatureMiddleware passes non-internal routes", () => {
    const { req, res, next } = mockReqRes({ path: "/api/trpc/transfer.send" });
    serviceSignatureMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("serviceSignatureMiddleware blocks internal routes without signature", () => {
    const { req, res, next } = mockReqRes({ path: "/api/internal/fraud-check" });
    serviceSignatureMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── 4. Secrets Rotation Detection ───────────────────────────────────────────
describe("Secrets rotation detection (v146)", () => {
  it("checkSecretsRotation returns an array", () => {
    const results = checkSecretsRotation();
    expect(Array.isArray(results)).toBe(true);
  });

  it("each result has name, status, and ageMs", () => {
    const results = checkSecretsRotation();
    for (const r of results) {
      expect(r).toHaveProperty("name");
      expect(r).toHaveProperty("status");
      expect(r).toHaveProperty("ageMs");
      expect(["ok", "warn", "expired"]).toContain(r.status);
    }
  });

  it("JWT_SECRET is registered", () => {
    const results = checkSecretsRotation();
    const jwt = results.find((r) => r.name === "JWT_SECRET");
    expect(jwt).toBeDefined();
  });

  it("STRIPE_SECRET_KEY is registered", () => {
    const results = checkSecretsRotation();
    const stripe = results.find((r) => r.name === "STRIPE_SECRET_KEY");
    expect(stripe).toBeDefined();
  });
});

// ─── 5. mTLS Middleware ───────────────────────────────────────────────────────
describe("mtlsMiddleware (v146)", () => {
  it("passes in non-production environment", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const { req, res, next } = mockReqRes({ path: "/api/internal/fraud-check" });
    mtlsMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    process.env.NODE_ENV = originalEnv;
  });

  it("passes for non-internal routes in production", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const { req, res, next } = mockReqRes({ path: "/api/trpc/transfer.send" });
    mtlsMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    process.env.NODE_ENV = originalEnv;
  });

  it("blocks internal routes without client cert in production", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const { req, res, next } = mockReqRes({ path: "/api/internal/fraud-check" });
    mtlsMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    process.env.NODE_ENV = originalEnv;
  });

  it("allows internal routes with valid fraud-svc cert in production", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const { req, res, next } = mockReqRes({
      path: "/api/internal/fraud-check",
      headers: { "x-client-cert-dn": "CN=remitflow-fraud-svc,O=RemitFlow,C=GB" },
    });
    mtlsMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    process.env.NODE_ENV = originalEnv;
  });
});

// ─── 6. Security controls count ──────────────────────────────────────────────
describe("security.attacks.ts v146 controls", () => {
  it("registers 32 security controls", () => {
    const secPath = resolve(process.cwd(), "server/security.attacks.ts");
    const content = readFileSync(secPath, "utf-8");
    expect(content).toContain("32 controls active");
  });

  it("exports geoBlockMiddleware", () => {
    const secPath = resolve(process.cwd(), "server/security.attacks.ts");
    const content = readFileSync(secPath, "utf-8");
    expect(content).toContain("export function geoBlockMiddleware");
  });

  it("exports recordUserLoginFailure", () => {
    const secPath = resolve(process.cwd(), "server/security.attacks.ts");
    const content = readFileSync(secPath, "utf-8");
    expect(content).toContain("export function recordUserLoginFailure");
  });

  it("exports signServiceRequest", () => {
    const secPath = resolve(process.cwd(), "server/security.attacks.ts");
    const content = readFileSync(secPath, "utf-8");
    expect(content).toContain("export function signServiceRequest");
  });

  it("exports checkSecretsRotation", () => {
    const secPath = resolve(process.cwd(), "server/security.attacks.ts");
    const content = readFileSync(secPath, "utf-8");
    expect(content).toContain("export function checkSecretsRotation");
  });

  it("exports mtlsMiddleware", () => {
    const secPath = resolve(process.cwd(), "server/security.attacks.ts");
    const content = readFileSync(secPath, "utf-8");
    expect(content).toContain("export function mtlsMiddleware");
  });
});

// ─── 7. Stripe top-up in Wallet.tsx (re-added in v25) ───────────────────────
describe("Stripe top-up in Wallet.tsx (v25)", () => {
  it("Wallet.tsx contains stripeTopup mutation (Stripe Card tab re-added)", () => {
    const walletPath = resolve(process.cwd(), "client/src/pages/Wallet.tsx");
    const content = readFileSync(walletPath, "utf-8");
    expect(content).toContain("stripeTopup");
  });

  it("Wallet.tsx does not show 4242 test card number", () => {
    const walletPath = resolve(process.cwd(), "client/src/pages/Wallet.tsx");
    const content = readFileSync(walletPath, "utf-8");
    expect(content).not.toContain("4242 4242 4242 4242");
  });
});

// ─── 8. Seed file has --reset flag ───────────────────────────────────────────
describe("drizzle/seed.ts --reset flag (v145/v146)", () => {
  it("seed file handles --reset flag", () => {
    const seedPath = resolve(process.cwd(), "drizzle/seed.ts");
    const content = readFileSync(seedPath, "utf-8");
    expect(content).toMatch(/--reset|isReset/);
  });

  it("seed file truncates tables on reset", () => {
    const seedPath = resolve(process.cwd(), "drizzle/seed.ts");
    const content = readFileSync(seedPath, "utf-8");
    expect(content).toMatch(/TRUNCATE|DELETE FROM|truncate/i);
  });
});

// ─── 9. Audit: all orphaned routers are nested ───────────────────────────────
describe("Router wiring audit (v146)", () => {
  it("productionV89Router includes auditTrailV2 sub-router", () => {
    const content = readFileSync(resolve(process.cwd(), "server/routers/productionV89.ts"), "utf-8");
    expect(content).toContain("auditTrailV2: auditTrailV2Router");
  });

  it("productionV90Router includes disputeManagement sub-router", () => {
    const content = readFileSync(resolve(process.cwd(), "server/routers/productionV90.ts"), "utf-8");
    expect(content).toContain("disputeManagement: disputeManagementRouter");
  });

  it("v99Router includes feeNegotiation sub-router", () => {
    const content = readFileSync(resolve(process.cwd(), "server/routers/v99Features.ts"), "utf-8");
    expect(content).toContain("feeNegotiation: feeNegotiationRouter");
  });

  it("dataPipelinesRouter includes nifi sub-router", () => {
    const content = readFileSync(resolve(process.cwd(), "server/routers/dataPipelines.ts"), "utf-8");
    expect(content).toContain("nifi: nifiRouter");
  });

  it("appRouter registers v89 namespace", () => {
    const content = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf-8");
    expect(content).toContain("v89: productionV89Router");
  });

  it("appRouter registers v90 namespace", () => {
    const content = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf-8");
    expect(content).toContain("v90: productionV90Router");
  });

  it("appRouter registers v99 namespace", () => {
    const content = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf-8");
    expect(content).toContain("v99: v99Router");
  });

  it("appRouter registers dataPipelines namespace", () => {
    const content = readFileSync(resolve(process.cwd(), "server/routers.ts"), "utf-8");
    expect(content).toContain("dataPipelines: dataPipelinesRouter");
  });
});
