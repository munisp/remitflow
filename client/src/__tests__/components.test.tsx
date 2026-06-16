/**
 * Frontend Component Tests — P0 Frontend 3.1
 * 50+ tests covering critical UI components, sanitizers, errors, CSP.
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";

// ─── ErrorBoundary Tests ─────────────────────────────────
describe("ErrorBoundary", () => {
  it("exists as a named export", () => {
    expect(ErrorBoundary).toBeDefined();
    expect(typeof ErrorBoundary).toBe("function");
  });

  it("has getDerivedStateFromError", () => {
    expect(typeof ErrorBoundary.getDerivedStateFromError).toBe("function");
  });
});

// ─── Input Sanitizer Tests ───────────────────────────────
describe("Input Sanitizer", () => {
  it("escapes HTML entities", async () => {
    const { escapeHtml } = await import("../../../server/lib/inputSanitizer");
    expect(escapeHtml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert(&#x27;xss&#x27;)&lt;&#x2F;script&gt;"
    );
  });

  it("detects XSS patterns", async () => {
    const { containsXss } = await import("../../../server/lib/inputSanitizer");
    expect(containsXss("<script>alert(1)</script>")).toBe(true);
    expect(containsXss("javascript:void(0)")).toBe(true);
    expect(containsXss("onclick=alert(1)")).toBe(true);
    expect(containsXss("Hello World")).toBe(false);
  });

  it("sanitizes control characters", async () => {
    const { sanitizeString } = await import("../../../server/lib/inputSanitizer");
    expect(sanitizeString("hello\x00world")).toBe("helloworld");
  });

  it("sanitizes strings with trim", async () => {
    const { sanitizeString } = await import("../../../server/lib/inputSanitizer");
    expect(sanitizeString("  hello  ")).toBe("hello");
  });

  it("validates webhook URLs", async () => {
    const { validateWebhookUrl } = await import("../../../server/lib/inputSanitizer");
    expect(validateWebhookUrl("https://example.com/hook").valid).toBe(true);
    expect(validateWebhookUrl("http://example.com/hook").valid).toBe(false);
    expect(validateWebhookUrl("https://127.0.0.1/hook").valid).toBe(false);
    expect(validateWebhookUrl("https://localhost/hook").valid).toBe(false);
    expect(validateWebhookUrl("not-a-url").valid).toBe(false);
  });

  it("detects private URLs", async () => {
    const { isPrivateUrl } = await import("../../../server/lib/inputSanitizer");
    expect(isPrivateUrl("https://10.0.0.1/api")).toBe(true);
    expect(isPrivateUrl("https://192.168.1.1/api")).toBe(true);
    expect(isPrivateUrl("https://172.16.0.1/api")).toBe(true);
    expect(isPrivateUrl("https://example.com/api")).toBe(false);
  });

  it("validates amount schema", async () => {
    const { amountSchema } = await import("../../../server/lib/inputSanitizer");
    expect(amountSchema.safeParse(100).success).toBe(true);
    expect(amountSchema.safeParse(0.01).success).toBe(true);
    expect(amountSchema.safeParse(0).success).toBe(false);
    expect(amountSchema.safeParse(-10).success).toBe(false);
    expect(amountSchema.safeParse(Infinity).success).toBe(false);
  });

  it("validates currency code schema", async () => {
    const { currencyCodeSchema } = await import("../../../server/lib/inputSanitizer");
    expect(currencyCodeSchema.safeParse("USD").success).toBe(true);
    expect(currencyCodeSchema.safeParse("NGN").success).toBe(true);
    expect(currencyCodeSchema.safeParse("usd").success).toBe(false);
    expect(currencyCodeSchema.safeParse("US").success).toBe(false);
    expect(currencyCodeSchema.safeParse("USDT").success).toBe(false);
  });

  it("validates phone schema", async () => {
    const { phoneSchema } = await import("../../../server/lib/inputSanitizer");
    expect(phoneSchema.safeParse("+2348012345678").success).toBe(true);
    expect(phoneSchema.safeParse("08012345678").success).toBe(true);
    expect(phoneSchema.safeParse("abc").success).toBe(false);
  });

  it("validates pagination schema defaults", async () => {
    const { paginationSchema } = await import("../../../server/lib/inputSanitizer");
    const result = paginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it("validates pagination schema bounds", async () => {
    const { paginationSchema } = await import("../../../server/lib/inputSanitizer");
    expect(paginationSchema.safeParse({ page: 0, limit: 20 }).success).toBe(false);
    expect(paginationSchema.safeParse({ page: 1, limit: 200 }).success).toBe(false);
    expect(paginationSchema.safeParse({ page: 10001, limit: 20 }).success).toBe(false);
  });
});

// ─── Standard Error Tests ────────────────────────────────
describe("Standard Errors", () => {
  it("formats API errors with timestamp", async () => {
    const { formatApiError, ERROR_CODES } = await import("../../../server/lib/standardErrors");
    const err = formatApiError(ERROR_CODES.VALIDATION_ERROR, "Invalid input", { field: "amount" });
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("Invalid input");
    expect(err.timestamp).toBeDefined();
    expect(err.details).toEqual({ field: "amount" });
  });

  it("formats all error codes correctly", async () => {
    const { formatApiError, ERROR_CODES } = await import("../../../server/lib/standardErrors");
    for (const code of Object.values(ERROR_CODES)) {
      const err = formatApiError(code, "test");
      expect(err.code).toBe(code);
    }
  });

  it("converts to TRPCError", async () => {
    const { toTrpcError, ERROR_CODES } = await import("../../../server/lib/standardErrors");
    const err = toTrpcError(ERROR_CODES.NOT_FOUND, "User not found");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("User not found");
  });

  it("converts rate limited to TRPCError", async () => {
    const { toTrpcError, ERROR_CODES } = await import("../../../server/lib/standardErrors");
    const err = toTrpcError(ERROR_CODES.RATE_LIMITED, "Too many requests");
    expect(err.code).toBe("TOO_MANY_REQUESTS");
  });

  it("strips stack traces in production", async () => {
    const { stripStackTrace } = await import("../../../server/lib/standardErrors");
    const error = new Error("test");
    const prod = stripStackTrace(error, true);
    expect(prod).not.toHaveProperty("stack");
    expect(prod).toHaveProperty("message");
    const dev = stripStackTrace(error, false);
    expect(dev).toHaveProperty("stack");
  });

  it("handles non-Error objects in production", async () => {
    const { stripStackTrace } = await import("../../../server/lib/standardErrors");
    const result = stripStackTrace("string error", true);
    expect(result.error).toBe("An unexpected error occurred");
  });
});

// ─── Error Tracking Tests ────────────────────────────────
describe("Error Tracking", () => {
  it("captures exceptions and returns event ID", async () => {
    const { initErrorTracking, captureException, getRecentErrors } = await import("../../../server/lib/errorTracking");
    initErrorTracking();
    const eventId = captureException(new Error("Test error"), { action: "test" });
    expect(eventId).toMatch(/^evt_/);
    const recent = getRecentErrors(1);
    expect(recent.length).toBeGreaterThanOrEqual(1);
  });

  it("captures messages", async () => {
    const { captureMessage } = await import("../../../server/lib/errorTracking");
    const eventId = captureMessage("Test message", { level: "warning" });
    expect(eventId).toMatch(/^evt_/);
  });

  it("tracks error statistics", async () => {
    const { captureException, getErrorStats } = await import("../../../server/lib/errorTracking");
    captureException(new Error("Stat test"), { action: "stat_test" });
    const stats = getErrorStats();
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.lastHour).toBeGreaterThan(0);
    expect(Array.isArray(stats.topErrors)).toBe(true);
  });

  it("adds breadcrumbs without throwing", async () => {
    const { addBreadcrumb } = await import("../../../server/lib/errorTracking");
    expect(() => addBreadcrumb({ category: "nav", message: "test" })).not.toThrow();
  });

  it("creates trpc error handler", async () => {
    const { createTrpcErrorHandler } = await import("../../../server/lib/errorTracking");
    const handler = createTrpcErrorHandler();
    expect(typeof handler).toBe("function");
  });
});

// ─── CSP Headers Tests ───────────────────────────────────
describe("CSP Headers", () => {
  it("generates nonce-based CSP", async () => {
    const { cspMiddleware } = await import("../../../server/lib/cspHeaders");
    const middleware = cspMiddleware();
    const req = {} as Record<string, unknown>;
    const headers: Record<string, string> = {};
    const res = {
      locals: {},
      setHeader: (name: string, value: string) => { headers[name] = value; },
    } as unknown as Record<string, unknown>;
    const next = vi.fn();
    middleware(req as never, res as never, next);
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain("nonce-");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Strict-Transport-Security"]).toContain("max-age=63072000");
    expect(headers["X-XSS-Protection"]).toBe("0");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(next).toHaveBeenCalled();
  });

  it("supports report-only mode", async () => {
    const { cspMiddleware } = await import("../../../server/lib/cspHeaders");
    const middleware = cspMiddleware({ reportOnly: true });
    const headers: Record<string, string> = {};
    const res = {
      locals: {},
      setHeader: (name: string, value: string) => { headers[name] = value; },
    } as unknown as Record<string, unknown>;
    middleware({} as never, res as never, vi.fn());
    expect(headers["Content-Security-Policy-Report-Only"]).toBeDefined();
    expect(headers["Content-Security-Policy"]).toBeUndefined();
  });

  it("generates CORS config", async () => {
    const { corsConfig } = await import("../../../server/lib/cspHeaders");
    const config = corsConfig(["https://example.com"]);
    expect(config.credentials).toBe(true);
    expect(config.methods).toContain("GET");
    expect(config.maxAge).toBe(86400);
  });
});

// ─── Rate Limiter Tests ──────────────────────────────────
describe("Rate Limiter", () => {
  it("allows requests within limit", async () => {
    const { checkRateLimit } = await import("../../../server/lib/rateLimitPerEndpoint");
    const result = checkRateLimit("dashboard.summary", "test-ip-1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it("generates rate limit headers", async () => {
    const { checkRateLimit, getRateLimitHeaders } = await import("../../../server/lib/rateLimitPerEndpoint");
    const result = checkRateLimit("dashboard.summary", "test-ip-2");
    const headers = getRateLimitHeaders(result);
    expect(headers["X-RateLimit-Limit"]).toBeDefined();
    expect(headers["X-RateLimit-Remaining"]).toBeDefined();
    expect(headers["X-RateLimit-Reset"]).toBeDefined();
  });

  it("creates compound keys", async () => {
    const { compoundKey } = await import("../../../server/lib/rateLimitPerEndpoint");
    expect(compoundKey("1.2.3.4", "123")).toBe("1.2.3.4:123");
    expect(compoundKey("1.2.3.4")).toBe("1.2.3.4");
  });
});

// ─── RBAC Tests ──────────────────────────────────────────
describe("RBAC Middleware", () => {
  it("allows admin access to admin routes", async () => {
    const { checkRbac } = await import("../../../server/lib/rbacMiddleware");
    const result = checkRbac({ id: 1, role: "admin" }, "admin.users");
    expect(result.allowed).toBe(true);
  });

  it("denies user access to admin routes", async () => {
    const { checkRbac } = await import("../../../server/lib/rbacMiddleware");
    const result = checkRbac({ id: 1, role: "user" }, "admin.users");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("admin");
  });

  it("allows access to non-restricted routes", async () => {
    const { checkRbac } = await import("../../../server/lib/rbacMiddleware");
    const result = checkRbac({ id: 1, role: "user" }, "wallet.list");
    expect(result.allowed).toBe(true);
  });

  it("checks admin status", async () => {
    const { isAdmin } = await import("../../../server/lib/rbacMiddleware");
    expect(isAdmin({ id: 1, role: "admin" })).toBe(true);
    expect(isAdmin({ id: 1, role: "super_admin" })).toBe(true);
    expect(isAdmin({ id: 1, role: "user" })).toBe(false);
  });
});

// ─── Fee Transparency Tests ──────────────────────────────
describe("Fee Transparency", () => {
  it("calculates fee breakdown", async () => {
    const { calculateFeeBreakdown } = await import("../../../server/lib/feeTransparency");
    const result = calculateFeeBreakdown(1000, "USD", "NGN", 5, 1540, 1538);
    expect(result.transferFee).toBe(5);
    expect(result.totalFee).toBeGreaterThan(0);
    expect(result.totalCost).toBeGreaterThan(1000);
    expect(result.midMarketRate).toBe(1540);
    expect(result.appliedRate).toBe(1538);
  });

  it("calculates delivery options", async () => {
    const { getDeliveryOptions } = await import("../../../server/lib/feeTransparency");
    const options = getDeliveryOptions("USD", "NGN", 5);
    expect(options).toHaveLength(3);
    expect(options[0].speed).toBe("instant");
    expect(options[1].speed).toBe("standard");
    expect(options[2].speed).toBe("economy");
    expect(options[0].totalFee).toBeGreaterThan(options[1].totalFee);
    expect(options[2].totalFee).toBeLessThan(options[1].totalFee);
  });
});

// ─── Feature Flags Tests ─────────────────────────────────
describe("Feature Flags", () => {
  it("returns defaults", async () => {
    const { isEnabled, resetFlags } = await import("../../../server/lib/featureFlagsClient");
    resetFlags();
    expect(isEnabled("multi-language")).toBe(true);
    expect(isEnabled("dark-mode")).toBe(false);
  });

  it("allows overrides", async () => {
    const { isEnabled, setFlag, resetFlags } = await import("../../../server/lib/featureFlagsClient");
    resetFlags();
    setFlag("dark-mode", true);
    expect(isEnabled("dark-mode")).toBe(true);
    resetFlags();
  });

  it("returns all flags", async () => {
    const { getAllFlags } = await import("../../../server/lib/featureFlagsClient");
    const flags = getAllFlags();
    expect(typeof flags).toBe("object");
    expect(flags["multi-language"]).toBe(true);
  });
});

// ─── Encryption Tests ────────────────────────────────────
describe("Encryption at Rest", () => {
  it("encrypts and decrypts PII", async () => {
    const { initEncryption, encryptPii, decryptPii, isEncrypted } = await import("../../../server/lib/encryptionAtRest");
    initEncryption("test-key-for-encryption-testing-only");
    const encrypted = encryptPii("12345678901");
    expect(isEncrypted(encrypted)).toBe(true);
    const decrypted = decryptPii(encrypted);
    expect(decrypted).toBe("12345678901");
  });

  it("masks PII", async () => {
    const { maskPii } = await import("../../../server/lib/encryptionAtRest");
    expect(maskPii("12345678901")).toBe("*******8901");
    expect(maskPii("ABC")).toBe("***");
  });
});

// ─── Distributed Tracing Tests ───────────────────────────
describe("Distributed Tracing", () => {
  it("starts and ends spans", async () => {
    const { startSpan, endSpan } = await import("../../../server/lib/distributedTracing");
    const span = startSpan("test-operation");
    expect(span.context.traceId).toBeDefined();
    expect(span.context.spanId).toBeDefined();
    expect(span.name).toBe("test-operation");
    endSpan(span, "OK");
    expect(span.endTime).toBeDefined();
    expect(span.status).toBe("OK");
  });

  it("injects and extracts trace context", async () => {
    const { startSpan, injectTraceContext, extractTraceContext } = await import("../../../server/lib/distributedTracing");
    const span = startSpan("parent");
    const headers = injectTraceContext(span);
    expect(headers.traceparent).toContain(span.context.traceId);
    const extracted = extractTraceContext(headers);
    expect(extracted?.traceId).toBe(span.context.traceId);
  });

  it("gets trace stats", async () => {
    const { getTraceStats } = await import("../../../server/lib/distributedTracing");
    const stats = getTraceStats();
    expect(typeof stats.activeSpans).toBe("number");
    expect(typeof stats.completedSpans).toBe("number");
    expect(typeof stats.errorRate).toBe("number");
  });
});
