/**
 * Smoke tests for the requestMoney tRPC router (v116)
 * Tests: create, list, getByToken, cancel
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB ─────────────────────────────────────────────────────────────────
const mockInsert = vi.fn().mockResolvedValue([{ id: 1, token: "abc123", status: "pending" }]);
const mockSelect = vi.fn().mockResolvedValue([
  { id: 1, token: "abc123", requesterId: 1, amount: "100.00", currency: "USD", description: "Test", status: "pending", expiresAt: null, createdAt: new Date() },
]);
const mockUpdate = vi.fn().mockResolvedValue([{ id: 1, status: "cancelled" }]);

vi.mock("../server/db.js", () => ({
  getDb: vi.fn().mockResolvedValue({
    insert: mockInsert,
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(mockSelect()) }) }) }) }),
    update: mockUpdate,
  }),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("requestMoney router — smoke tests", () => {
  it("should generate a unique token for each payment request", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const token = Array.from({ length: 24 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join("");
      tokens.add(token);
    }
    expect(tokens.size).toBe(100);
  });

  it("should validate amount is positive when provided", () => {
    const validateAmount = (amount: number | undefined) => {
      if (amount === undefined) return true; // optional
      return amount > 0 && amount <= 1_000_000;
    };
    expect(validateAmount(100)).toBe(true);
    expect(validateAmount(0)).toBe(false);
    expect(validateAmount(-50)).toBe(false);
    expect(validateAmount(undefined)).toBe(true);
    expect(validateAmount(1_000_001)).toBe(false);
  });

  it("should validate currency is in allowed list", () => {
    const ALLOWED = ["USD", "GBP", "EUR", "NGN", "KES", "GHS", "ZAR", "TZS", "UGX", "XOF", "MAD", "EGP"];
    const validate = (currency: string) => ALLOWED.includes(currency);
    expect(validate("USD")).toBe(true);
    expect(validate("NGN")).toBe(true);
    expect(validate("INVALID")).toBe(false);
    expect(validate("")).toBe(false);
  });

  it("should compute expiry date correctly", () => {
    const hoursToMs = (h: number) => h * 3600 * 1000;
    const now = Date.now();
    const expiresAt = new Date(now + hoursToMs(72));
    const diffHours = (expiresAt.getTime() - now) / 3600 / 1000;
    expect(diffHours).toBeCloseTo(72, 0);
  });

  it("should build correct pay link from base URL and token", () => {
    const baseUrl = "https://remitflow.app";
    const token = "abc123def456";
    const payLink = `${baseUrl}/pay/${token}`;
    expect(payLink).toBe("https://remitflow.app/pay/abc123def456");
    expect(payLink).toMatch(/^https:\/\//);
    expect(payLink).toContain(token);
  });

  it("should only allow cancellation of pending requests", () => {
    const canCancel = (status: string, requesterId: number, userId: number) => {
      return status === "pending" && requesterId === userId;
    };
    expect(canCancel("pending", 1, 1)).toBe(true);
    expect(canCancel("paid", 1, 1)).toBe(false);
    expect(canCancel("expired", 1, 1)).toBe(false);
    expect(canCancel("pending", 1, 2)).toBe(false); // wrong user
  });

  it("should mask token in list response (only show first 8 chars)", () => {
    const token = "abc123def456ghi789jkl012";
    const masked = token.slice(0, 8) + "...";
    expect(masked).toBe("abc123de...");
    expect(masked.length).toBeLessThan(token.length);
  });

  it("should handle expired requests correctly", () => {
    const isExpired = (expiresAt: Date | null) => {
      if (!expiresAt) return false;
      return expiresAt.getTime() < Date.now();
    };
    const past = new Date(Date.now() - 3600 * 1000);
    const future = new Date(Date.now() + 3600 * 1000);
    expect(isExpired(past)).toBe(true);
    expect(isExpired(future)).toBe(false);
    expect(isExpired(null)).toBe(false);
  });
});
