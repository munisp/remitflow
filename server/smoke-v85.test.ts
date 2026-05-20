/**
 * RemitFlow v85 — Production Smoke Tests
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function makeCtx(overrides: Record<string, any> = {}): TrpcContext {
  const user = {
    id: 1, openId: "v85-smoke-user", email: "v85smoke@remitflow.test",
    name: "V85 Smoke User", loginMethod: "manus", role: "user" as const,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(), kycTier: "tier1",
    ...overrides,
  };
  return {
    user,
    req: { protocol: "https", headers: { origin: "https://remitflow.test" } } as TrpcContext["req"],
    res: { clearCookie: () => {}, setHeader: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const caller = appRouter.createCaller(makeCtx());
const adminCaller = appRouter.createCaller(makeCtx({ id: 2, email: "admin@remitflow.test", role: "admin" }));
const anonCaller = appRouter.createCaller({
  user: null,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: () => {}, setHeader: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
});

describe("sandboxScenarios", () => {
  it("list returns array", async () => { expect(Array.isArray(await caller.sandboxScenarios.list({}))).toBe(true); });
  it("create requires auth", async () => { await expect(anonCaller.sandboxScenarios.create({ name: "x", scenarioType: "transfer", payload: { a: "b" } })).rejects.toThrow(); });
  it("list with filter works", async () => { expect(Array.isArray(await caller.sandboxScenarios.list({ scenarioType: "transfer" }))).toBe(true); });
});

describe("complianceAlerts", () => {
  it("list requires auth", async () => { await expect(anonCaller.complianceAlerts.list({})).rejects.toThrow(); });
  it("list returns array", async () => { expect(Array.isArray(await caller.complianceAlerts.list({}))).toBe(true); });
  it("stats has correct shape", async () => {
    const s = await caller.complianceAlerts.stats();
    expect(s).toHaveProperty("open"); expect(s).toHaveProperty("critical");
  });
});

describe("securityEvents", () => {
  it("list requires auth", async () => { await expect(anonCaller.securityEvents.list()).rejects.toThrow(); });
  it("list returns array", async () => { expect(Array.isArray(await caller.securityEvents.list())).toBe(true); });
  it("stats has correct shape", async () => {
    const s = await caller.securityEvents.stats();
    expect(s).toHaveProperty("total"); expect(s).toHaveProperty("critical");
  });
});

describe("mfa", () => {
  it("status requires auth", async () => { await expect(anonCaller.mfa.status()).rejects.toThrow(); });
  it("status returns shape", async () => {
    const s = await caller.mfa.status();
    expect(s).toHaveProperty("enabled"); expect(typeof s.enabled).toBe("boolean");
  });
  it("enroll requires auth", async () => { await expect(anonCaller.mfa.enroll()).rejects.toThrow(); });
});

describe("globalSearch", () => {
  it("search requires auth", async () => { await expect(anonCaller.globalSearch.search({ query: "test" })).rejects.toThrow(); });
  it("search returns shape", async () => {
    const r = await caller.globalSearch.search({ query: "test" });
    expect(r).toHaveProperty("transactions"); expect(r).toHaveProperty("beneficiaries");
  });
  it("admin can search users", async () => {
    const r = await adminCaller.globalSearch.search({ query: "admin", types: ["users"] });
    expect(Array.isArray(r.users)).toBe(true);
  });
  it("non-admin gets empty users", async () => {
    const r = await caller.globalSearch.search({ query: "test", types: ["users"] });
    expect(r.users).toEqual([]);
  });
});

describe("transferAudit", () => {
  it("getTrail requires auth", async () => { await expect(anonCaller.transferAudit.getTrail({ transferId: 1 })).rejects.toThrow(); });
  it("getTrail returns array", async () => { expect(Array.isArray(await caller.transferAudit.getTrail({ transferId: 1 }))).toBe(true); });
  it("logTransition requires auth", async () => { await expect(anonCaller.transferAudit.logTransition({ transferId: 1, toStatus: "processing" })).rejects.toThrow(); });
});

describe("adminBulk", () => {
  it("bulkSuspendUsers requires admin", async () => { await expect(caller.adminBulk.bulkSuspendUsers({ userIds: [1] })).rejects.toThrow(); });
  it("exportUsers requires admin", async () => { await expect(caller.adminBulk.exportUsers({ format: "csv" })).rejects.toThrow(); });
  it("exportUsers csv works for admin", async () => {
    const r = await adminCaller.adminBulk.exportUsers({ format: "csv" });
    expect(r).toHaveProperty("data"); expect(r).toHaveProperty("count"); expect(r.format).toBe("csv");
  });
  it("exportUsers json works for admin", async () => {
    const r = await adminCaller.adminBulk.exportUsers({ format: "json" });
    expect(r.format).toBe("json");
  });
});

describe("receiptPdf", () => {
  it("generate requires auth", async () => { await expect(anonCaller.receiptPdf.generate({ receiptId: 1 })).rejects.toThrow(); });
  it("generate returns HTML", async () => {
    const r = await caller.receiptPdf.generate({ receiptId: 42 });
    expect(r.html).toContain("RemitFlow"); expect(r.html).toContain("42"); expect(r.filename).toContain("42");
  });
});

describe("feeEngine", () => {
  it("calculate is public", async () => {
    const r = await anonCaller.feeEngine.calculate({ fromCurrency: "USD", toCurrency: "NGN", amount: 500 });
    expect(r).toHaveProperty("fee"); expect(r).toHaveProperty("corridor"); expect(r).toHaveProperty("breakdown");
  });
  it("calculate returns sensible values", async () => {
    const r = await caller.feeEngine.calculate({ fromCurrency: "GBP", toCurrency: "KES", amount: 1000 });
    expect(r.totalAmount).toBeGreaterThan(1000); expect(r.fee).toBeGreaterThanOrEqual(0);
  });
  it("listRules requires auth", async () => { await expect(anonCaller.feeEngine.listRules()).rejects.toThrow(); });
  it("listRules returns array", async () => { expect(Array.isArray(await caller.feeEngine.listRules())).toBe(true); });
  it("upsertRule requires admin", async () => {
    await expect(caller.feeEngine.upsertRule({ name: "x", corridor: "USD-NGN", feeType: "flat", feeValue: 5, minAmount: 0, maxAmount: 10000 })).rejects.toThrow();
  });
});

describe("v85 auth guards", () => {
  it("sandboxScenarios.create requires auth", async () => { await expect(anonCaller.sandboxScenarios.create({ name: "x", scenarioType: "transfer", payload: { a: "b" } })).rejects.toThrow(); });
  it("complianceAlerts.acknowledge requires auth", async () => { await expect(anonCaller.complianceAlerts.acknowledge({ id: 1 })).rejects.toThrow(); });
  it("securityEvents.log requires auth", async () => { await expect(anonCaller.securityEvents.log({ eventType: "test", severity: "info" })).rejects.toThrow(); });
  it("mfa.status requires auth", async () => { await expect(anonCaller.mfa.status()).rejects.toThrow(); });
  it("transferAudit.logTransition requires auth", async () => { await expect(anonCaller.transferAudit.logTransition({ transferId: 1, toStatus: "done" })).rejects.toThrow(); });
  it("receiptPdf.generate requires auth", async () => { await expect(anonCaller.receiptPdf.generate({ receiptId: 1 })).rejects.toThrow(); });
  it("adminBulk.exportUsers requires auth", async () => { await expect(anonCaller.adminBulk.exportUsers({ format: "csv" })).rejects.toThrow(); });
});
