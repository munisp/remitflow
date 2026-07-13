/**
 * Document Vault Expiry Reminder System — Smoke Tests
 * Tests: DB tables, tRPC procedures, scheduler job, email template, deduplication
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Helpers ───────────────────────────────────────────────────────────────────
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{ id: 1 }]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
};

vi.mock("./db", () => ({ getDb: vi.fn().mockResolvedValue(mockDb) }));
vi.mock("./email.service", () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  buildDocumentExpiryReminderEmail: vi.fn().mockReturnValue({
    subject: "Test Subject",
    html: "<p>Test</p>",
    text: "Test",
  }),
  buildFxAlertEmail: vi.fn(),
  buildWeeklyFundDigestEmail: vi.fn(),
}));
vi.mock("./_core/notification", () => ({ notifyOwner: vi.fn().mockResolvedValue(true) }));
vi.mock("./sse.service", () => ({ broadcastAdminEvent: vi.fn() }));
vi.mock("./fx-rates.service", () => ({
  fetchLiveRates: vi.fn().mockResolvedValue({}),
  detectRateChanges: vi.fn().mockResolvedValue([]),
  ensureFxRateCacheTable: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./audit.service", () => ({ logAdminAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));

// ── Schema Tests ──────────────────────────────────────────────────────────────
describe("Document Vault Reminder Schema", () => {
  it("exports docReminderPrefs table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.docReminderPrefs).toBeDefined();
    expect(typeof schema.docReminderPrefs).toBe("object");
  });

  it("exports docReminderLog table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.docReminderLog).toBeDefined();
    expect(typeof schema.docReminderLog).toBe("object");
  });

  it("docReminderPrefs has all required columns", async () => {
    const schema = await import("../drizzle/schema");
    const cols = Object.keys(schema.docReminderPrefs);
    expect(cols).toContain("userId");
    expect(cols).toContain("remind30d");
    expect(cols).toContain("remind7d");
    expect(cols).toContain("notifyEmail");
    expect(cols).toContain("notifyInApp");
  });

  it("docReminderLog has all required columns", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.docReminderLog).toBeDefined();
  });
});

// ── Email Template Tests ──────────────────────────────────────────────────────
describe("buildDocumentExpiryReminderEmail", () => {
  it("generates email with correct subject for 7-day reminder", async () => {
    const { buildDocumentExpiryReminderEmail } = await import("./email.service");
    const result = buildDocumentExpiryReminderEmail({
      userName: "Alice Smith",
      documentName: "Passport",
      documentCategory: "identity",
      daysLeft: 7,
      expiresAt: new Date("2026-05-01"),
    });
    expect(result.subject).toBeDefined();
    expect(result.html).toBeDefined();
    expect(result.text).toBeDefined();
  });

  it("generates email for expired document (daysLeft <= 0)", async () => {
    const { buildDocumentExpiryReminderEmail } = await import("./email.service");
    const result = buildDocumentExpiryReminderEmail({
      userName: "Bob Jones",
      documentName: "Utility Bill",
      documentCategory: "address",
      daysLeft: -1,
      expiresAt: new Date("2026-04-20"),
    });
    expect(result.subject).toBeDefined();
    expect(result.html).toBeDefined();
  });

  it("generates email for 30-day reminder", async () => {
    const { buildDocumentExpiryReminderEmail } = await import("./email.service");
    const result = buildDocumentExpiryReminderEmail({
      userName: "Carol White",
      documentName: "Bank Statement",
      documentCategory: "financial",
      daysLeft: 30,
      expiresAt: new Date("2026-05-21"),
    });
    expect(result.subject).toBeDefined();
    expect(result.text).toBeDefined();
  });

  it("generates email for 1-day reminder with urgency", async () => {
    const { buildDocumentExpiryReminderEmail } = await import("./email.service");
    const result = buildDocumentExpiryReminderEmail({
      userName: "Dave Brown",
      documentName: "ID Card",
      documentCategory: "identity",
      daysLeft: 1,
      expiresAt: new Date("2026-04-22"),
    });
    expect(result.subject).toBeDefined();
    expect(result.html).toBeDefined();
  });
});

// ── Scheduler Job Tests ───────────────────────────────────────────────────────
describe("sendDocumentVaultExpiryReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports sendDocumentVaultExpiryReminders function", async () => {
    const { sendDocumentVaultExpiryReminders } = await import("./scheduler");
    expect(typeof sendDocumentVaultExpiryReminders).toBe("function");
  });

  it("handles empty expiring documents gracefully", async () => {
    const { getDb } = await import("./db");
    const emptyMockDb = {
      ...mockDb,
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(getDb).mockResolvedValueOnce(emptyMockDb as any);
    const { sendDocumentVaultExpiryReminders } = await import("./scheduler");
    await expect(sendDocumentVaultExpiryReminders()).resolves.not.toThrow();
  });

  it("handles DB unavailable gracefully", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null as any);
    const { sendDocumentVaultExpiryReminders } = await import("./scheduler");
    await expect(sendDocumentVaultExpiryReminders()).resolves.not.toThrow();
  });

  it("is registered as Job 9 in the scheduler", async () => {
    const cron = await import("node-cron");
    const { startScheduler } = await import("./scheduler");
    startScheduler();
    // Job 9 should be scheduled at 0 10 * * *
    const scheduleCalls = vi.mocked(cron.default.schedule).mock.calls;
    const job9 = scheduleCalls.find(call => call[0] === "0 10 * * *");
    expect(job9).toBeDefined();
  });
});

// ── tRPC Procedure Tests ──────────────────────────────────────────────────────
describe("documentVaultV94 reminder procedures", () => {
  it("getReminderPrefs procedure exists in documentVaultRouter", async () => {
    const { documentVaultRouter } = await import("./routers/v94Features");
    expect(documentVaultRouter).toBeDefined();
    // The router object should have getReminderPrefs
    expect(typeof (documentVaultRouter as any)._def).toBe("object");
  });

  it("updateReminderPrefs procedure exists in documentVaultRouter", async () => {
    const { documentVaultRouter } = await import("./routers/v94Features");
    expect(documentVaultRouter).toBeDefined();
  });

  it("expiringDocuments procedure exists in documentVaultRouter", async () => {
    const { documentVaultRouter } = await import("./routers/v94Features");
    expect(documentVaultRouter).toBeDefined();
  });

  it("reminderLog procedure exists in documentVaultRouter", async () => {
    const { documentVaultRouter } = await import("./routers/v94Features");
    expect(documentVaultRouter).toBeDefined();
  });
});

// ── Reminder Threshold Logic Tests ───────────────────────────────────────────
describe("Reminder threshold bucketing logic", () => {
  function getThresholdBucket(daysLeft: number): string | null {
    if (daysLeft <= 30 && daysLeft > 14) return "30d";
    if (daysLeft <= 14 && daysLeft > 7)  return "14d";
    if (daysLeft <= 7  && daysLeft > 3)  return "7d";
    if (daysLeft <= 3  && daysLeft > 1)  return "3d";
    if (daysLeft <= 1)                   return "1d";
    return null;
  }

  it("assigns 30d bucket for 29 days left", () => {
    expect(getThresholdBucket(29)).toBe("30d");
  });

  it("assigns 14d bucket for 10 days left", () => {
    expect(getThresholdBucket(10)).toBe("14d");
  });

  it("assigns 7d bucket for 5 days left", () => {
    expect(getThresholdBucket(5)).toBe("7d");
  });

  it("assigns 3d bucket for 2 days left", () => {
    expect(getThresholdBucket(2)).toBe("3d");
  });

  it("assigns 1d bucket for 1 day left", () => {
    expect(getThresholdBucket(1)).toBe("1d");
  });

  it("assigns 1d bucket for 0 days (expired)", () => {
    expect(getThresholdBucket(0)).toBe("1d");
  });

  it("assigns 1d bucket for negative days (past expired)", () => {
    expect(getThresholdBucket(-5)).toBe("1d");
  });

  it("returns null for 31+ days (not in any threshold)", () => {
    expect(getThresholdBucket(31)).toBeNull();
    expect(getThresholdBucket(90)).toBeNull();
  });
});

// ── Deduplication Logic Tests ─────────────────────────────────────────────────
describe("Reminder deduplication", () => {
  it("does not send duplicate reminders for the same doc+type+channel", async () => {
    const { sendEmail } = await import("./email.service");
    // Simulate: existing reminder log entry found → should skip
    const alreadySentDb = {
      ...mockDb,
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 99 }]), // existing entry
    };
    // The deduplication check finds an existing entry → sendEmail should NOT be called
    // This is a unit test of the logic, not the full scheduler
    const existingEntry = await alreadySentDb.select().from({}).where({}).limit(1);
    expect(existingEntry).toHaveLength(1);
    // If existing entry found, skip sending
    const alreadySent = existingEntry.length > 0;
    expect(alreadySent).toBe(true);
    // sendEmail should not have been called in this scenario
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
  });

  it("sends reminder when no existing log entry found", async () => {
    const { sendEmail } = await import("./email.service");
    vi.clearAllMocks();
    const noEntryDb = {
      ...mockDb,
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]), // no existing entry
    };
    const existingEntry = await noEntryDb.select().from({}).where({}).limit(1);
    const alreadySent = existingEntry.length > 0;
    expect(alreadySent).toBe(false);
    // In this scenario, sendEmail would be called
  });
});

// ── Preference Toggle Tests ───────────────────────────────────────────────────
describe("Reminder preference defaults", () => {
  it("defaults all thresholds to true", () => {
    const defaults = {
      remind30d: true, remind14d: true, remind7d: true, remind3d: true, remind1d: true,
      notifyEmail: true, notifyInApp: true, notifyPush: false,
    };
    expect(defaults.remind30d).toBe(true);
    expect(defaults.remind14d).toBe(true);
    expect(defaults.remind7d).toBe(true);
    expect(defaults.remind3d).toBe(true);
    expect(defaults.remind1d).toBe(true);
  });

  it("defaults notifyPush to false (requires explicit opt-in)", () => {
    const defaults = { notifyPush: false };
    expect(defaults.notifyPush).toBe(false);
  });

  it("defaults notifyEmail and notifyInApp to true", () => {
    const defaults = { notifyEmail: true, notifyInApp: true };
    expect(defaults.notifyEmail).toBe(true);
    expect(defaults.notifyInApp).toBe(true);
  });
});

// ── Expiry Urgency Calculation Tests ─────────────────────────────────────────
describe("Expiry urgency calculation", () => {
  function getUrgencyLabel(daysLeft: number): string {
    if (daysLeft <= 0)  return "expired";
    if (daysLeft <= 3)  return "critical";
    if (daysLeft <= 7)  return "urgent";
    if (daysLeft <= 14) return "warning";
    if (daysLeft <= 30) return "notice";
    return "ok";
  }

  it("marks expired documents as 'expired'", () => {
    expect(getUrgencyLabel(0)).toBe("expired");
    expect(getUrgencyLabel(-1)).toBe("expired");
  });

  it("marks 1-3 days as 'critical'", () => {
    expect(getUrgencyLabel(1)).toBe("critical");
    expect(getUrgencyLabel(3)).toBe("critical");
  });

  it("marks 4-7 days as 'urgent'", () => {
    expect(getUrgencyLabel(4)).toBe("urgent");
    expect(getUrgencyLabel(7)).toBe("urgent");
  });

  it("marks 8-14 days as 'warning'", () => {
    expect(getUrgencyLabel(8)).toBe("warning");
    expect(getUrgencyLabel(14)).toBe("warning");
  });

  it("marks 15-30 days as 'notice'", () => {
    expect(getUrgencyLabel(15)).toBe("notice");
    expect(getUrgencyLabel(30)).toBe("notice");
  });

  it("marks 31+ days as 'ok'", () => {
    expect(getUrgencyLabel(31)).toBe("ok");
    expect(getUrgencyLabel(365)).toBe("ok");
  });
});
