/**
 * v203 Form M UI — smoke tests
 * Verifies: listFormMHistory, listFormMDocumentsAdmin, updateFormMStatus, getFormMDocument
 */
import { describe, it, expect } from "vitest";
import { smeTradeRouter } from "./routers/smeTrade";

// ── helpers ──────────────────────────────────────────────────────────────────
function makeCtx(role: "user" | "admin" = "user", id = 1) {
  return {
    user: { id, role, name: "Test User", email: "test@example.com" },
    req: {} as any,
    res: {} as any,
  };
}

// ── procedure shape tests (no DB) ────────────────────────────────────────────
describe("smeTrade router — v203 Form M procedures", () => {
  it("exposes listFormMHistory procedure", () => {
    expect(smeTradeRouter._def.procedures).toHaveProperty("listFormMHistory");
  });

  it("exposes listFormMDocumentsAdmin procedure", () => {
    expect(smeTradeRouter._def.procedures).toHaveProperty("listFormMDocumentsAdmin");
  });

  it("exposes updateFormMStatus procedure", () => {
    expect(smeTradeRouter._def.procedures).toHaveProperty("updateFormMStatus");
  });

  it("exposes getFormMDocument procedure", () => {
    expect(smeTradeRouter._def.procedures).toHaveProperty("getFormMDocument");
  });

  it("listFormMHistory input schema accepts default values", () => {
    const proc = smeTradeRouter._def.procedures.listFormMHistory;
    const inputSchema = proc._def.inputs?.[0];
    if (inputSchema) {
      const parsed = inputSchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.limit).toBe(20);
        expect(parsed.data.offset).toBe(0);
        expect(parsed.data.status).toBe("all");
      }
    }
  });

  it("listFormMDocumentsAdmin input schema accepts default values", () => {
    const proc = smeTradeRouter._def.procedures.listFormMDocumentsAdmin;
    const inputSchema = proc._def.inputs?.[0];
    if (inputSchema) {
      const parsed = inputSchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.limit).toBe(50);
        expect(parsed.data.offset).toBe(0);
        expect(parsed.data.status).toBe("all");
      }
    }
  });

  it("listFormMDocumentsAdmin rejects non-admin callers (FORBIDDEN)", async () => {
    const caller = smeTradeRouter.createCaller(makeCtx("user"));
    await expect(caller.listFormMDocumentsAdmin({ limit: 10, offset: 0, status: "all" })).rejects.toThrow(/FORBIDDEN|Admin/i);
  });

  it("updateFormMStatus rejects non-admin callers (FORBIDDEN)", async () => {
    const caller = smeTradeRouter.createCaller(makeCtx("user"));
    await expect(caller.updateFormMStatus({ id: 1, status: "approved" })).rejects.toThrow(/FORBIDDEN|Admin/i);
  });

  it("updateFormMStatus input schema validates status enum", () => {
    const proc = smeTradeRouter._def.procedures.updateFormMStatus;
    const inputSchema = proc._def.inputs?.[0];
    if (inputSchema) {
      expect(inputSchema.safeParse({ id: 1, status: "invalid_status" }).success).toBe(false);
      expect(inputSchema.safeParse({ id: 1, status: "approved" }).success).toBe(true);
      expect(inputSchema.safeParse({ id: 1, status: "rejected" }).success).toBe(true);
      expect(inputSchema.safeParse({ id: 1, status: "pending" }).success).toBe(true);
      expect(inputSchema.safeParse({ id: 1, status: "validated" }).success).toBe(true);
    }
  });

  it("listFormMHistory status filter accepts all valid values", () => {
    const proc = smeTradeRouter._def.procedures.listFormMHistory;
    const inputSchema = proc._def.inputs?.[0];
    if (inputSchema) {
      for (const s of ["all", "pending", "validated", "approved", "rejected"]) {
        expect(inputSchema.safeParse({ status: s }).success).toBe(true);
      }
      expect(inputSchema.safeParse({ status: "unknown" }).success).toBe(false);
    }
  });

  it("listFormMDocumentsAdmin expiringWithinDays filter is optional", () => {
    const proc = smeTradeRouter._def.procedures.listFormMDocumentsAdmin;
    const inputSchema = proc._def.inputs?.[0];
    if (inputSchema) {
      expect(inputSchema.safeParse({}).success).toBe(true);
      expect(inputSchema.safeParse({ expiringWithinDays: 30 }).success).toBe(true);
      expect(inputSchema.safeParse({ expiringWithinDays: 0 }).success).toBe(false); // min 1
    }
  });

  it("getFormMDocument input requires positive integer id", () => {
    const proc = smeTradeRouter._def.procedures.getFormMDocument;
    const inputSchema = proc._def.inputs?.[0];
    if (inputSchema) {
      expect(inputSchema.safeParse({ id: 1 }).success).toBe(true);
      expect(inputSchema.safeParse({ id: 0 }).success).toBe(false);
      expect(inputSchema.safeParse({ id: -1 }).success).toBe(false);
      expect(inputSchema.safeParse({}).success).toBe(false);
    }
  });

  it("updateFormMStatus accepts optional note", () => {
    const proc = smeTradeRouter._def.procedures.updateFormMStatus;
    const inputSchema = proc._def.inputs?.[0];
    if (inputSchema) {
      expect(inputSchema.safeParse({ id: 1, status: "approved", note: "Looks good" }).success).toBe(true);
      expect(inputSchema.safeParse({ id: 1, status: "approved" }).success).toBe(true);
    }
  });
});
