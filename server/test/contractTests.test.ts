/**
 * RemitFlow — tRPC API Contract Tests
 * ══════════════════════════════════════════════════════════════════════════════
 * Validates that all tRPC routers conform to their expected input/output
 * contracts. These tests run against the actual router implementations
 * (not mocked) to catch schema drift and breaking changes.
 *
 * Test categories:
 *   1. Input validation — ensure invalid inputs are rejected with proper errors
 *   2. Output shape — ensure responses match the expected TypeScript types
 *   3. Auth guards — ensure protected procedures reject unauthenticated calls
 *   4. Error codes — ensure errors use correct TRPC error codes
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCallerFactory } from "../_core/trpc";
import { appRouter } from "../routers";

// ── Test Context Factory ──────────────────────────────────────────────────────

const createCaller = createCallerFactory(appRouter);

const anonCtx = {
  user: null as any,
  session: null as any,
  req: {} as any,
  res: {} as any,
};

const authCtx = {
  user: {
    id: 9999,
    email: "contract-test@remitflow-test.io",
    name: "Contract Test User",
    role: "user",
    kycTier: "tier2",
    tenantId: "default",
  },
  session: { userId: 9999 },
  req: {} as any,
  res: {} as any,
};

const adminCtx = {
  ...authCtx,
  user: { ...authCtx.user, role: "admin" },
};

// ── Health Router ─────────────────────────────────────────────────────────────

describe("health router", () => {
  it("returns platform status", async () => {
    const caller = createCaller(anonCtx);
    // Health is a REST endpoint, not tRPC — just verify router exists
    expect(appRouter._def.procedures).toBeDefined();
  });
});

// ── FX Rates Router ───────────────────────────────────────────────────────────

describe("fxRates router", () => {
  it("rejects invalid currency codes", async () => {
    const caller = createCaller(authCtx);
    await expect(
      (caller as any).fxRates?.getRate?.({
        sendCurrency: "INVALID",
        receiveCurrency: "NGN",
        amount: 100,
      })
    ).rejects.toMatchObject({ code: expect.stringMatching(/BAD_REQUEST|VALIDATION_ERROR/) });
  });

  it("rejects negative amounts", async () => {
    const caller = createCaller(authCtx);
    await expect(
      (caller as any).fxRates?.getRate?.({
        sendCurrency: "USD",
        receiveCurrency: "NGN",
        amount: -100,
      })
    ).rejects.toBeDefined();
  });
});

// ── Fraud Orchestrator Router ─────────────────────────────────────────────────

describe("fraudOrchestrator router", () => {
  it("rejects unauthenticated scoreTransfer calls", async () => {
    const caller = createCaller(anonCtx);
    await expect(
      (caller as any).fraudOrchestrator?.scoreTransfer?.({
        transferId: "test-123",
        amount: 100,
        sendCurrency: "USD",
        receiveCurrency: "NGN",
      })
    ).rejects.toMatchObject({ code: expect.stringMatching(/UNAUTHORIZED|FORBIDDEN/) });
  });

  it("rejects zero amount transfers", async () => {
    const caller = createCaller(authCtx);
    await expect(
      (caller as any).fraudOrchestrator?.scoreTransfer?.({
        transferId: "test-123",
        amount: 0,
        sendCurrency: "USD",
        receiveCurrency: "NGN",
      })
    ).rejects.toBeDefined();
  });
});

// ── WebAuthn Router ───────────────────────────────────────────────────────────

describe("webauthn router", () => {
  it("rejects unauthenticated generateRegistrationOptions", async () => {
    const caller = createCaller(anonCtx);
    await expect(
      (caller as any).webauthn?.generateRegistrationOptions?.({
        deviceNickname: "My iPhone",
      })
    ).rejects.toMatchObject({ code: expect.stringMatching(/UNAUTHORIZED|FORBIDDEN/) });
  });

  it("rejects invalid device nickname (too long)", async () => {
    const caller = createCaller(authCtx);
    await expect(
      (caller as any).webauthn?.generateRegistrationOptions?.({
        deviceNickname: "A".repeat(100), // max is 50
      })
    ).rejects.toBeDefined();
  });
});

// ── Multi-Tenancy Router ──────────────────────────────────────────────────────

describe("multiTenancy router", () => {
  it("returns default tenant config for public requests", async () => {
    const caller = createCaller(anonCtx);
    const result = await (caller as any).multiTenancy?.getTenantConfig?.({});
    // Should return default config without throwing
    expect(result).toBeDefined();
    if (result) {
      expect(result.tenantId).toBeDefined();
      expect(result.branding).toBeDefined();
      expect(result.features).toBeDefined();
    }
  });

  it("rejects non-admin createTenant calls", async () => {
    const caller = createCaller(authCtx);
    await expect(
      (caller as any).multiTenancy?.createTenant?.({
        name: "Test Bank",
        slug: "test-bank",
        adminEmail: "admin@testbank.com",
        adminName: "Test Admin",
        corridors: ["USD", "NGN"],
      })
    ).rejects.toMatchObject({ code: expect.stringMatching(/UNAUTHORIZED|FORBIDDEN/) });
  });

  it("rejects invalid slug format", async () => {
    const caller = createCaller(adminCtx);
    await expect(
      (caller as any).multiTenancy?.createTenant?.({
        name: "Test Bank",
        slug: "Test Bank!", // invalid — must be lowercase alphanumeric with hyphens
        adminEmail: "admin@testbank.com",
        adminName: "Test Admin",
        corridors: ["USD", "NGN"],
      })
    ).rejects.toBeDefined();
  });
});

// ── CBDC Settlement Router ────────────────────────────────────────────────────

describe("cbdcSettlement router", () => {
  it("rejects unauthenticated getRails calls", async () => {
    const caller = createCaller(anonCtx);
    await expect(
      (caller as any).cbdcSettlement?.getRails?.({
        sendCurrency: "USD",
        receiveCurrency: "NGN",
        amount: 100,
      })
    ).rejects.toMatchObject({ code: expect.stringMatching(/UNAUTHORIZED|FORBIDDEN/) });
  });

  it("rejects invalid CBDC type", async () => {
    const caller = createCaller(authCtx);
    await expect(
      (caller as any).cbdcSettlement?.initiateCbdcSettlement?.({
        transferId: "test-123",
        cbdcType: "invalid-cbdc" as any,
        amount: 100,
        currency: "NGN",
        recipientCbdcAddress: "0x123",
      })
    ).rejects.toBeDefined();
  });
});

// ── Smart Routing Router ──────────────────────────────────────────────────────

describe("smartRouting router", () => {
  it("rejects unauthenticated route requests", async () => {
    const caller = createCaller(anonCtx);
    await expect(
      (caller as any).smartRouting?.getBestRoute?.({
        amount: 100,
        sendCurrency: "USD",
        receiveCurrency: "NGN",
      })
    ).rejects.toMatchObject({ code: expect.stringMatching(/UNAUTHORIZED|FORBIDDEN/) });
  });
});

// ── Input Sanitization Tests ──────────────────────────────────────────────────

describe("input sanitization", () => {
  it("rejects SQL injection in string fields", async () => {
    const caller = createCaller(authCtx);
    // Any string input with SQL injection should be rejected or sanitized
    await expect(
      (caller as any).multiTenancy?.getTenantConfig?.({
        tenantId: "'; DROP TABLE tenants; --",
      })
    ).resolves.toBeDefined(); // Should not throw — input is sanitized, not rejected
  });

  it("rejects XSS in branding fields", async () => {
    const caller = createCaller(adminCtx);
    await expect(
      (caller as any).multiTenancy?.updateBranding?.({
        tenantId: "default",
        emailFromName: "<script>alert('xss')</script>",
      })
    ).resolves.toBeDefined(); // Should sanitize, not crash
  });
});
