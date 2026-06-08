/**
 * CSP Headers & Security Middleware Business Logic Tests
 * Tests: CSP directive generation, security headers, nonce handling
 */
import { describe, it, expect, vi } from "vitest";
import { cspMiddleware, corsConfig } from "../lib/cspHeaders";

function mockReqRes() {
  const headers: Record<string, string> = {};
  const req = { method: "GET", headers: {} } as any;
  const res = {
    locals: {},
    setHeader: vi.fn((name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    }),
  } as any;
  const next = vi.fn();
  return { req, res, next, headers };
}

describe("CSP Middleware — Header Generation", () => {
  it("should set Content-Security-Policy header", () => {
    const middleware = cspMiddleware();
    const { req, res, next, headers } = mockReqRes();
    middleware(req, res, next);
    expect(headers["content-security-policy"]).toBeDefined();
    expect(next).toHaveBeenCalled();
  });

  it("should include default-src 'self'", () => {
    const middleware = cspMiddleware();
    const { req, res, next, headers } = mockReqRes();
    middleware(req, res, next);
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
  });

  it("should include script-src with nonce (not unsafe-inline by default)", () => {
    const middleware = cspMiddleware();
    const { req, res, next, headers } = mockReqRes();
    middleware(req, res, next);
    const csp = headers["content-security-policy"];
    expect(csp).toContain("script-src");
    expect(csp).toMatch(/nonce-[A-Za-z0-9+/=]+/);
    // Extract script-src directive specifically
    const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1] ?? "";
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("should include unsafe-inline when explicitly enabled", () => {
    const middleware = cspMiddleware({ enableUnsafeInline: true });
    const { req, res, next, headers } = mockReqRes();
    middleware(req, res, next);
    const csp = headers["content-security-policy"];
    expect(csp).toContain("'unsafe-inline'");
  });

  it("should block frames (frame-src none, frame-ancestors none)", () => {
    const middleware = cspMiddleware();
    const { req, res, next, headers } = mockReqRes();
    middleware(req, res, next);
    const csp = headers["content-security-policy"];
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("should include upgrade-insecure-requests", () => {
    const middleware = cspMiddleware();
    const { req, res, next, headers } = mockReqRes();
    middleware(req, res, next);
    expect(headers["content-security-policy"]).toContain("upgrade-insecure-requests");
  });

  it("should set report-uri when configured", () => {
    const middleware = cspMiddleware({ reportUri: "https://csp-report.example.com/collect" });
    const { req, res, next, headers } = mockReqRes();
    middleware(req, res, next);
    expect(headers["content-security-policy"]).toContain("report-uri https://csp-report.example.com/collect");
  });

  it("should use report-only mode when configured", () => {
    const middleware = cspMiddleware({ reportOnly: true });
    const { req, res, next, headers } = mockReqRes();
    middleware(req, res, next);
    expect(headers["content-security-policy-report-only"]).toBeDefined();
    expect(headers["content-security-policy"]).toBeUndefined();
  });

  it("should store nonce in res.locals for template use", () => {
    const middleware = cspMiddleware();
    const { req, res, next } = mockReqRes();
    middleware(req, res, next);
    expect(res.locals.cspNonce).toBeDefined();
    expect(typeof res.locals.cspNonce).toBe("string");
    expect(res.locals.cspNonce.length).toBeGreaterThan(0);
  });
});

describe("Security Headers", () => {
  it("should set X-Content-Type-Options: nosniff", () => {
    const middleware = cspMiddleware();
    const { req, res, next, headers } = mockReqRes();
    middleware(req, res, next);
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });

  it("should set X-Frame-Options: DENY", () => {
    const middleware = cspMiddleware();
    const { req, res, next, headers } = mockReqRes();
    middleware(req, res, next);
    expect(headers["x-frame-options"]).toBe("DENY");
  });

  it("should set Strict-Transport-Security with includeSubDomains", () => {
    const middleware = cspMiddleware();
    const { req, res, next, headers } = mockReqRes();
    middleware(req, res, next);
    const hsts = headers["strict-transport-security"];
    expect(hsts).toContain("max-age=");
    expect(hsts).toContain("includeSubDomains");
    expect(hsts).toContain("preload");
  });

  it("should set Referrer-Policy", () => {
    const middleware = cspMiddleware();
    const { req, res, next, headers } = mockReqRes();
    middleware(req, res, next);
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("should restrict Permissions-Policy", () => {
    const middleware = cspMiddleware();
    const { req, res, next, headers } = mockReqRes();
    middleware(req, res, next);
    const pp = headers["permissions-policy"];
    expect(pp).toContain("camera=()");
    expect(pp).toContain("microphone=()");
    expect(pp).toContain("geolocation=()");
  });
});

describe("CORS Config", () => {
  it("should return CORS config with allowed origins", () => {
    const config = corsConfig(["https://app.remitflow.com", "https://admin.remitflow.com"]);
    expect(config).toBeDefined();
  });
});
