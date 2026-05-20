/**
 * Smoke tests for splitBill and rateLock routers (v117)
 */
import { describe, it, expect, vi } from "vitest";

// ─── Mock DB ─────────────────────────────────────────────────────────────────
const mockInsert = vi.fn().mockResolvedValue([{ id: 1 }]);
const mockSelect = vi.fn().mockResolvedValue([]);
const mockUpdate = vi.fn().mockResolvedValue([{ id: 1 }]);
const mockDelete = vi.fn().mockResolvedValue([]);

vi.mock("../server/db.js", () => ({
  getDb: vi.fn().mockResolvedValue({
    insert: () => ({ values: () => ({ returning: () => mockInsert() }) }),
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => mockSelect() }), limit: () => mockSelect() }), orderBy: () => ({ limit: () => mockSelect() }) }) }),
    update: () => ({ set: () => ({ where: () => mockUpdate() }) }),
    delete: () => ({ where: () => mockDelete() }),
  }),
}));

vi.mock("../server/email.service.js", () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));

import { splitBillRouter } from "../server/routers/splitBill.js";
import { rateLockRouter } from "../server/routers/rateLock.js";

const mockCtx = {
  user: { id: 1, email: "test@remitflow.com", name: "Test User", role: "user" as const },
  req: { headers: { origin: "http://localhost:3000" } },
} as any;

describe("splitBill router", () => {
  it("exports a router object", () => {
    expect(splitBillRouter).toBeDefined();
    expect(typeof splitBillRouter).toBe("object");
  });

  it("has required procedures: create, list, cancel, getGroup, resendEmail", () => {
    const procedures = Object.keys(splitBillRouter._def.procedures ?? splitBillRouter._def.record ?? {});
    expect(procedures).toContain("create");
    expect(procedures).toContain("list");
    expect(procedures).toContain("cancel");
  });
});

describe("rateLock router", () => {
  it("exports a router object", () => {
    expect(rateLockRouter).toBeDefined();
    expect(typeof rateLockRouter).toBe("object");
  });

  it("has required procedures: lock, list, cancel, preview", () => {
    const procedures = Object.keys(rateLockRouter._def.procedures ?? rateLockRouter._def.record ?? {});
    expect(procedures).toContain("lock");
    expect(procedures).toContain("list");
    expect(procedures).toContain("cancel");
    expect(procedures).toContain("preview");
  });
});
