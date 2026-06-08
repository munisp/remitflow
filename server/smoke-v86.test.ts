/**
 * RemitFlow v86 Smoke Tests
 * Covers: promoCodesAdmin, promoValidate, fxCalculator, scheduledTransfersV2, notifPrefs
 */
import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function makeCtx(overrides: Record<string, any> = {}): TrpcContext {
  const user = {
    id: 1,
    openId: "smoke-v86-user",
    email: "smoke-v86@remitflow.test",
    name: "Smoke V86",
    loginMethod: "keycloak",
    role: "admin" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return {
    user,
    req: { protocol: "https", headers: { origin: "https://remitflow.test" } } as TrpcContext["req"],
    res: { clearCookie: () => {}, setHeader: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const adminCaller = appRouter.createCaller(makeCtx());
const publicCaller = appRouter.createCaller({
  user: null,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: () => {}, setHeader: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
});

// ─── Promo Codes Admin ────────────────────────────────────────────────────────
describe("promoCodesAdmin", () => {
  it("list returns paginated result", async () => {
    const result = await adminCaller.promoCodesAdmin.list({});
    expect(result).toHaveProperty("items");
    expect(Array.isArray(result.items)).toBe(true);
    expect(result).toHaveProperty("total");
  });

  it("create returns new promo code", async () => {
    const result = await adminCaller.promoCodesAdmin.create({
      code: `SMOKE${Date.now()}`,
      description: "Smoke test promo",
      discountType: "percentage",
      discountValue: 10,
      usageLimit: 100,
      perUserLimit: 1,
    });
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("code");
  });

  it("stats returns usage statistics", async () => {
    const result = await adminCaller.promoCodesAdmin.stats();
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("active");
  });
});

// ─── Promo Validate ───────────────────────────────────────────────────────────
describe("promoValidate", () => {
  it("validate returns valid=false for unknown code", async () => {
    const result = await adminCaller.promoValidate.validate({
      code: "NONEXISTENT999",
      amount: 100,
      fromCurrency: "USD",
    });
    expect(result.valid).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

// ─── FX Calculator ────────────────────────────────────────────────────────────
describe("fxCalculator", () => {
  it("convert returns exchange calculation for USD→NGN", async () => {
    const result = await publicCaller.fxCalculator.convert({
      amount: 100,
      fromCurrency: "USD",
      toCurrency: "NGN",
    });
    expect(result).toHaveProperty("convertedAmount");
    expect(result).toHaveProperty("rate");
    expect(result).toHaveProperty("finalFee");
    expect(result.convertedAmount).toBeGreaterThan(0);
  });

  it("convert GBP→KES returns positive amount", async () => {
    const result = await publicCaller.fxCalculator.convert({
      amount: 50,
      fromCurrency: "GBP",
      toCurrency: "KES",
    });
    expect(result.fromCurrency).toBe("GBP");
    expect(result.toCurrency).toBe("KES");
    expect(result.convertedAmount).toBeGreaterThan(0);
  });

  it("supportedPairs returns currencies list", async () => {
    const result = await publicCaller.fxCalculator.supportedPairs();
    expect(Array.isArray(result.currencies)).toBe(true);
    expect(result.currencies.length).toBeGreaterThan(0);
  });
});

// ─── Scheduled Transfers V2 ───────────────────────────────────────────────────
describe("scheduledTransfersV2", () => {
  it("list returns array", async () => {
    const result = await adminCaller.scheduledTransfersV2.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("create returns new scheduled transfer", async () => {
    const result = await adminCaller.scheduledTransfersV2.create({
      fromCurrency: "USD",
      toCurrency: "NGN",
      amount: 100,
      frequency: "monthly",
      startDate: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("status");
  });

  it("pause and resume work correctly", async () => {
    const created = await adminCaller.scheduledTransfersV2.create({
      fromCurrency: "GBP",
      toCurrency: "GHS",
      amount: 50,
      frequency: "weekly",
      startDate: new Date(Date.now() + 86400000).toISOString(),
    });
    const paused = await adminCaller.scheduledTransfersV2.pause({ id: created.id });
    expect(paused.success).toBe(true);
    const resumed = await adminCaller.scheduledTransfersV2.resume({ id: created.id });
    expect(resumed.success).toBe(true);
    await adminCaller.scheduledTransfersV2.cancel({ id: created.id });
  });
});

// ─── Notification Preferences ─────────────────────────────────────────────────
describe("notifPrefs", () => {
  it("get returns preferences object", async () => {
    const result = await adminCaller.notifPrefs.get();
    expect(result).toHaveProperty("emailTransactions");
    expect(result).toHaveProperty("pushTransactions");
    expect(result).toHaveProperty("smsTransactions");
  });

  it("update returns success", async () => {
    const result = await adminCaller.notifPrefs.update({
      emailTransactions: true,
      emailMarketing: false,
      emailSecurity: true,
      pushTransactions: true,
      pushMarketing: false,
      smsTransactions: false,
    });
    expect(result).toHaveProperty("success");
    expect(result.success).toBe(true);
  });
});
