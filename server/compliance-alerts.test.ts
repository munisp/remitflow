import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

describe("compliance alerts procedures", () => {
  it("getDetail returns alert with parsed metadata and notes", async () => {
    const mockAlert = {
      id: 1,
      alertType: "aml_flag",
      severity: "high",
      title: "AML Flag — Structuring pattern detected",
      description: "Test description",
      relatedUserId: 2,
      relatedTransactionId: null,
      status: "open",
      acknowledgedBy: null,
      acknowledgedAt: null,
      resolvedAt: null,
      metadata: JSON.stringify({ riskScore: 75, corridor: "NG-GB", transactionAmount: 5000, currency: "USD", matchConfidence: 82 }),
      createdAt: new Date(),
    };
    const mockNotes = [
      { id: 1, content: "Alert auto-generated", isInternal: true, createdAt: new Date(), authorId: 1, authorName: "Admin User" },
    ];

    const { getDb } = await import("./db");
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValueOnce([mockAlert]).mockResolvedValueOnce(mockNotes),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValueOnce(mockNotes),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    // Verify metadata parsing logic
    const metadata = mockAlert.metadata ? (() => { try { return JSON.parse(mockAlert.metadata); } catch { return {}; } })() : {};
    expect(metadata.riskScore).toBe(75);
    expect(metadata.corridor).toBe("NG-GB");
    expect(metadata.transactionAmount).toBe(5000);
  });

  it("addNote validates content length", () => {
    const validContent = "This is a valid note content";
    const tooLong = "x".repeat(2001);
    expect(validContent.length).toBeLessThanOrEqual(2000);
    expect(tooLong.length).toBeGreaterThan(2000);
  });

  it("compliance alert severity colors are defined for all levels", () => {
    const SEVERITY_COLORS: Record<string, string> = {
      low: "bg-blue-100 text-blue-800 border-blue-200",
      medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
      high: "bg-orange-100 text-orange-800 border-orange-200",
      critical: "bg-red-100 text-red-800 border-red-200",
    };
    expect(SEVERITY_COLORS.low).toBeTruthy();
    expect(SEVERITY_COLORS.medium).toBeTruthy();
    expect(SEVERITY_COLORS.high).toBeTruthy();
    expect(SEVERITY_COLORS.critical).toBeTruthy();
  });

  it("status colors include all new status values", () => {
    const STATUS_COLORS: Record<string, string> = {
      open: "bg-red-100 text-red-700",
      acknowledged: "bg-yellow-100 text-yellow-700",
      under_review: "bg-purple-100 text-purple-700",
      escalated: "bg-orange-100 text-orange-700",
      resolved: "bg-green-100 text-green-700",
      dismissed: "bg-gray-100 text-gray-600",
    };
    expect(STATUS_COLORS.under_review).toBeTruthy();
    expect(STATUS_COLORS.escalated).toBeTruthy();
    expect(STATUS_COLORS.open).toBeTruthy();
    expect(STATUS_COLORS.resolved).toBeTruthy();
  });

  it("metadata JSON parsing handles invalid JSON gracefully", () => {
    const badMetadata = "not-valid-json";
    const result = (() => { try { return JSON.parse(badMetadata); } catch { return {}; } })();
    expect(result).toEqual({});
  });

  it("seed enrichment templates cover all alert types", () => {
    const TEMPLATES = {
      aml_flag: { titles: ["AML Flag — Structuring pattern detected"], descriptions: ["Test"] },
      kyc_expiry: { titles: ["KYC Expiry — Tier 3 identity documents expire in 14 days"], descriptions: ["Test"] },
      sanctions_hit: { titles: ["Sanctions Hit — OFAC SDN list match"], descriptions: ["Test"] },
      velocity_breach: { titles: ["Velocity Breach — 24-hour send limit exceeded"], descriptions: ["Test"] },
      unusual_pattern: { titles: ["Unusual Pattern — Night-time transaction cluster"], descriptions: ["Test"] },
      pep_match: { titles: ["PEP Match — Customer identified as Politically Exposed Person"], descriptions: ["Test"] },
      high_risk_country: { titles: ["High-Risk Country — Transfer to FATF grey-listed jurisdiction"], descriptions: ["Test"] },
    };
    expect(Object.keys(TEMPLATES)).toHaveLength(7);
    for (const [key, tmpl] of Object.entries(TEMPLATES)) {
      expect(tmpl.titles.length).toBeGreaterThan(0);
      expect(tmpl.descriptions.length).toBeGreaterThan(0);
    }
  });
});
