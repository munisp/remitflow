/**
 * RemitFlow — PBAC Engine Tests (vitest)
 *
 * Tests the Policy-Based Access Control engine for all major policies.
 * Runs in the Node.js environment without a live database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock external dependencies ──────────────────────────────────────────────
vi.mock("./middleware/permify", () => ({
  getPermifyClient: () => ({
    check: vi.fn().mockResolvedValue({ can: true }),
  }),
}));

vi.mock("./security.attacks", () => ({
  flagBeneficiarySwap: vi.fn().mockReturnValue(false),
  emitSecurityEvent: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue([]),
  }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
// We test the evaluatePolicy function directly
// Since pbac.ts uses dynamic imports, we test the logic by importing the module
import { evaluatePolicy } from "./pbac";

// ─── Helper: build a mock user ────────────────────────────────────────────────
function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    openId: "user_test_001",
    name: "Test User",
    email: "test@remitflow.com",
    role: "user" as const,
    kycTier: 1,
    twoFactorEnabled: false,
    twoFactorVerifiedAt: null,
    createdAt: new Date(Date.now() - 30 * 24 * 3600 * 1000), // 30 days ago
    ...overrides,
  };
}

// ─── transfer.send ────────────────────────────────────────────────────────────
describe("PBAC: transfer.send", () => {
  it("allows a KYC tier-1 user to send a small transfer", async () => {
    const result = await evaluatePolicy({
      user: makeUser({ kycTier: 1 }),
      resource: { type: "transfer", amount: 100, currency: "USD" },
      environment: {},
      action: "transfer.send",
    });
    expect(result.allowed).toBe(true);
  });

  it("denies a KYC tier-0 user from sending", async () => {
    const result = await evaluatePolicy({
      user: makeUser({ kycTier: 0 }),
      resource: { type: "transfer", amount: 50, currency: "USD" },
      environment: {},
      action: "transfer.send",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/kyc/i);
  });

  it("requires 2FA for transfers above $1000", async () => {
    // Use kycTier 2 ($10,000 daily limit) so the daily limit check doesn't block first
    const result = await evaluatePolicy({
      user: makeUser({ kycTier: 2, twoFactorEnabled: false }),
      resource: { type: "transfer", amount: 1500, currency: "USD" },
      environment: {},
      action: "transfer.send",
    });
    expect(result.allowed).toBe(false);
    expect(result.requiresMFA).toBe(true);
  });

  it("allows a 2FA-enabled user to send above $1000", async () => {
    // Use kycTier 2 ($10,000 daily limit) so the daily limit check doesn't block first
    const result = await evaluatePolicy({
      user: makeUser({ kycTier: 2, twoFactorEnabled: true, twoFactorVerifiedAt: new Date() }),
      resource: { type: "transfer", amount: 1500, currency: "USD" },
      environment: {},
      action: "transfer.send",
    });
    expect(result.allowed).toBe(true);
  });
});

// ─── transfer.bulkSend ────────────────────────────────────────────────────────
describe("PBAC: transfer.bulkSend", () => {
  it("denies a regular user from bulk sending", async () => {
    const result = await evaluatePolicy({
      user: makeUser({ kycTier: 2, role: "user" }),
      resource: { type: "transfer" },
      environment: {},
      action: "transfer.bulkSend",
    });
    expect(result.allowed).toBe(false);
  });

  it("allows an admin with KYC tier 2 to bulk send", async () => {
    const result = await evaluatePolicy({
      user: makeUser({ kycTier: 2, role: "admin", twoFactorEnabled: true, twoFactorVerifiedAt: new Date() }),
      resource: { type: "transfer" },
      environment: {},
      action: "transfer.bulkSend",
    });
    expect(result.allowed).toBe(true);
  });
});

// ─── kyc.approve ─────────────────────────────────────────────────────────────
describe("PBAC: kyc.approve", () => {
  it("denies a regular user from approving KYC", async () => {
    const result = await evaluatePolicy({
      user: makeUser({ role: "user" }),
      resource: { type: "kycDocument" },
      environment: {},
      action: "kyc.approve",
    });
    expect(result.allowed).toBe(false);
  });

  it("allows an admin to approve KYC", async () => {
    const result = await evaluatePolicy({
      user: makeUser({ role: "admin", twoFactorEnabled: true, twoFactorVerifiedAt: new Date() }),
      resource: { type: "kycDocument" },
      environment: {},
      action: "kyc.approve",
    });
    expect(result.allowed).toBe(true);
  });
});

// ─── admin.* ─────────────────────────────────────────────────────────────────
describe("PBAC: admin.*", () => {
  it("denies a regular user from admin actions", async () => {
    const result = await evaluatePolicy({
      user: makeUser({ role: "user" }),
      resource: { type: "system" },
      environment: {},
      action: "admin.viewUsers",
    });
    expect(result.allowed).toBe(false);
  });

  it("denies an admin without 2FA from admin actions", async () => {
    const result = await evaluatePolicy({
      user: makeUser({ role: "admin", twoFactorEnabled: false }),
      resource: { type: "system" },
      environment: {},
      action: "admin.viewUsers",
    });
    expect(result.allowed).toBe(false);
    expect(result.requiresMFA).toBe(true);
  });

  it("allows an admin with 2FA to perform admin actions", async () => {
    const result = await evaluatePolicy({
      user: makeUser({ role: "admin", twoFactorEnabled: true, twoFactorVerifiedAt: new Date() }),
      resource: { type: "system" },
      environment: {},
      action: "admin.viewUsers",
    });
    expect(result.allowed).toBe(true);
  });
});

// ─── report.export ────────────────────────────────────────────────────────────
describe("PBAC: report.export", () => {
  it("denies a regular user from exporting reports", async () => {
    const result = await evaluatePolicy({
      user: makeUser({ role: "user" }),
      resource: { type: "report" },
      environment: {},
      action: "report.export",
    });
    expect(result.allowed).toBe(false);
  });

  it("allows an admin to export reports", async () => {
    const result = await evaluatePolicy({
      user: makeUser({ role: "admin", twoFactorEnabled: true, twoFactorVerifiedAt: new Date() }),
      resource: { type: "report" },
      environment: {},
      action: "report.export",
    });
    expect(result.allowed).toBe(true);
  });
});

// ─── wallet.withdraw ─────────────────────────────────────────────────────────
describe("PBAC: wallet.withdraw", () => {
  it("denies withdrawal without KYC", async () => {
    const result = await evaluatePolicy({
      user: makeUser({ kycTier: 0 }),
      resource: { type: "wallet", amount: 100 },
      environment: {},
      action: "wallet.withdraw",
    });
    expect(result.allowed).toBe(false);
  });

  it("allows withdrawal with KYC tier 1", async () => {
    const result = await evaluatePolicy({
      user: makeUser({ kycTier: 1 }),
      resource: { type: "wallet", amount: 100 },
      environment: {},
      action: "wallet.withdraw",
    });
    expect(result.allowed).toBe(true);
  });
});

// ─── Default deny ────────────────────────────────────────────────────────────
describe("PBAC: default deny", () => {
  it("denies any unknown action by default (fail-closed)", async () => {
    const result = await evaluatePolicy({
      user: makeUser({ role: "user" }),
      resource: { type: "unknown" },
      environment: {},
      action: "unknown.action.xyz",
    });
    expect(result.allowed).toBe(false);
  });
});
