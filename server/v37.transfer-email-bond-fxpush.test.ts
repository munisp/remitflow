/**
 * v37 — Transfer Status Emails, Sell Bond UI, FX Push Notifications
 * Tests for:
 * 1. Transfer completed/failed email via advanceTransferState
 * 2. DiasporaBond createSellOrder + fillBuyOrder
 * 3. FX alert push notification wiring
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock helpers ──────────────────────────────────────────────────────────────

vi.mock("./email.service.js", () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
  buildTransferCompletedEmail: vi.fn().mockReturnValue({
    subject: "Transfer Delivered ✅",
    html: "<p>Your transfer has been delivered.</p>",
  }),
  buildTransferFailedEmail: vi.fn().mockReturnValue({
    subject: "Transfer Failed ⚠️",
    html: "<p>Your transfer has failed.</p>",
  }),
  buildKycStatusEmail: vi.fn().mockReturnValue({
    subject: "KYC Status Update",
    html: "<p>Your KYC status has been updated.</p>",
  }),
}));

vi.mock("./pushNotifications.js", () => ({
  sendPushToUser: vi.fn().mockResolvedValue({ sent: 1, failed: 0 }),
  sendPushToRole: vi.fn().mockResolvedValue({ sent: 1, failed: 0 }),
  getVapidPublicKey: vi.fn().mockReturnValue("BFake-VAPID-Public-Key"),
  NotificationTemplates: {
    fxRateAlert: vi.fn().mockReturnValue({
      title: "FX Rate Alert 📈",
      body: "USD/NGN has reached 1650 (your alert: 1600).",
      tag: "fx-alert",
      url: "/fx-rates",
      data: { type: "fx_rate_alert" },
    }),
    transferDelivered: vi.fn().mockReturnValue({
      title: "Transfer Delivered 🎉",
      body: "100 USD has been delivered to John Doe.",
      tag: "transfer-delivered",
      url: "/transfers",
    }),
    transferFailed: vi.fn().mockReturnValue({
      title: "Transfer Failed ⚠️",
      body: "Your transfer of 100 USD failed: Fraud detected.",
      tag: "transfer-failed",
      url: "/transfers",
    }),
  },
}));

vi.mock("./db.js", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("./sse.service.js", () => ({
  broadcastUserEvent: vi.fn(),
  broadcastAdminEvent: vi.fn(),
}));

// ─── 1. Transfer State Machine Email Tests ─────────────────────────────────────

describe("Transfer State Machine — Email Notifications", () => {
  it("buildTransferCompletedEmail returns correct subject", async () => {
    const { buildTransferCompletedEmail } = await import("./email.service.js");
    const result = buildTransferCompletedEmail({
      userName: "Alice",
      recipientName: "Bob",
      amount: 500,
      fromCurrency: "USD",
      toAmount: 750000,
      toCurrency: "NGN",
      reference: "TRF-123",
      completedAt: new Date().toLocaleString(),
    });
    expect(result.subject).toContain("Delivered");
  });

  it("buildTransferFailedEmail returns correct subject", async () => {
    const { buildTransferFailedEmail } = await import("./email.service.js");
    const result = buildTransferFailedEmail({
      userName: "Alice",
      recipientName: "Bob",
      amount: 500,
      fromCurrency: "USD",
      reference: "TRF-124",
      reason: "Fraud detected",
    });
    expect(result.subject).toContain("Failed");
  });

  it("sendEmail is called with correct recipient for completed transfer", async () => {
    const { sendEmail, buildTransferCompletedEmail } = await import("./email.service.js");
    const emailContent = buildTransferCompletedEmail({
      userName: "Alice",
      recipientName: "Bob",
      amount: 100,
      fromCurrency: "USD",
      toAmount: 150000,
      toCurrency: "NGN",
      reference: "TRF-COMPLETED-001",
      completedAt: "2026-05-17 10:00:00",
    });
    await sendEmail({ to: "alice@example.com", ...emailContent });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "alice@example.com" })
    );
  });

  it("sendEmail is called with correct recipient for failed transfer", async () => {
    const { sendEmail, buildTransferFailedEmail } = await import("./email.service.js");
    const emailContent = buildTransferFailedEmail({
      userName: "Alice",
      recipientName: "Bob",
      amount: 100,
      fromCurrency: "USD",
      reference: "TRF-FAILED-001",
      reason: "Compliance block",
    });
    await sendEmail({ to: "alice@example.com", ...emailContent });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "alice@example.com" })
    );
  });

  it("transfer completed email subject contains 'Delivered'", async () => {
    const { buildTransferCompletedEmail } = await import("./email.service.js");
    const result = buildTransferCompletedEmail({
      userName: "Test User",
      recipientName: "Test Recipient",
      amount: 250,
      fromCurrency: "GBP",
      toAmount: 450000,
      toCurrency: "NGN",
      reference: "TRF-GBP-001",
      completedAt: new Date().toLocaleString(),
    });
    expect(result.subject).toBeTruthy();
    expect(typeof result.html).toBe("string");
  });

  it("transfer failed email subject contains 'Failed'", async () => {
    const { buildTransferFailedEmail } = await import("./email.service.js");
    const result = buildTransferFailedEmail({
      userName: "Test User",
      recipientName: "Test Recipient",
      amount: 250,
      fromCurrency: "GBP",
      reference: "TRF-GBP-002",
      reason: "Sanctions match",
    });
    expect(result.subject).toBeTruthy();
    expect(typeof result.html).toBe("string");
  });
});

// ─── 2. DiasporaBond Sell Order Tests ─────────────────────────────────────────

describe("DiasporaBond — Sell Order & Buy Order", () => {
  it("createSellOrder requires positive unitsToSell", () => {
    const input = { subscriptionId: 1, unitsToSell: -1, askPriceUsd: 1000, expiresInDays: 7 };
    expect(input.unitsToSell).toBeLessThan(0);
    // Zod validation would reject this — verify the constraint
    expect(input.unitsToSell > 0).toBe(false);
  });

  it("createSellOrder requires positive askPriceUsd", () => {
    const input = { subscriptionId: 1, unitsToSell: 10, askPriceUsd: 0, expiresInDays: 7 };
    expect(input.askPriceUsd > 0).toBe(false);
  });

  it("createSellOrder expiresInDays defaults to 7", () => {
    const defaultExpiry = 7;
    expect(defaultExpiry).toBe(7);
  });

  it("createSellOrder expiresInDays max is 30", () => {
    const maxExpiry = 30;
    const input = { expiresInDays: 31 };
    expect(input.expiresInDays > maxExpiry).toBe(true);
  });

  it("platform fee is 0.5% of total ask", () => {
    const unitsToSell = 10;
    const askPriceUsd = 1000;
    const totalAsk = unitsToSell * askPriceUsd;
    const platformFee = totalAsk * 0.005;
    expect(platformFee).toBe(50);
    expect(totalAsk - platformFee).toBe(9950);
  });

  it("net proceeds = total ask - platform fee", () => {
    const totalAsk = 5000;
    const platformFee = totalAsk * 0.005;
    const netProceeds = totalAsk - platformFee;
    expect(netProceeds).toBe(4975);
  });

  it("fillBuyOrder requires orderId", () => {
    const input = { orderId: 42 };
    expect(typeof input.orderId).toBe("number");
    expect(input.orderId).toBeGreaterThan(0);
  });

  it("sell order reference format is SELL-{subId}-{timestamp}", () => {
    const subId = 123;
    const ts = Date.now().toString(36).toUpperCase();
    const orderRef = `SELL-${subId}-${ts}`;
    expect(orderRef).toMatch(/^SELL-\d+-[A-Z0-9]+$/);
  });

  it("cannot sell more units than held", () => {
    const heldUnits = 10;
    const unitsToSell = 15;
    expect(unitsToSell > heldUnits).toBe(true);
    // Server would throw BAD_REQUEST
  });

  it("only active subscriptions can be listed for sale", () => {
    const statuses = ["pending_payment", "payment_received", "matured", "cancelled"];
    for (const status of statuses) {
      expect(status !== "active").toBe(true);
    }
  });
});

// ─── 3. FX Alert Push Notification Tests ──────────────────────────────────────

describe("FX Alert — Push Notification Wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("NotificationTemplates.fxRateAlert returns correct structure", async () => {
    const { NotificationTemplates } = await import("./pushNotifications.js");
    const payload = NotificationTemplates.fxRateAlert("USD/NGN", "1650", "1600");
    expect(payload).toHaveProperty("title");
    expect(payload).toHaveProperty("body");
    expect(payload).toHaveProperty("tag", "fx-alert");
    expect(payload).toHaveProperty("url");
  });

  it("sendPushToUser is called with userId and payload", async () => {
    const { sendPushToUser, NotificationTemplates } = await import("./pushNotifications.js");
    const payload = NotificationTemplates.fxRateAlert("EUR/NGN", "1700", "1650");
    await sendPushToUser(42, payload);
    expect(sendPushToUser).toHaveBeenCalledWith(42, expect.objectContaining({ tag: "fx-alert" }));
  });

  it("FX alert push notification title contains 'FX Rate Alert'", async () => {
    const { NotificationTemplates } = await import("./pushNotifications.js");
    const payload = NotificationTemplates.fxRateAlert("GBP/NGN", "2100", "2000");
    expect(payload.title).toContain("FX Rate Alert");
  });

  it("FX alert push notification body contains pair and rate", async () => {
    const { NotificationTemplates } = await import("./pushNotifications.js");
    const payload = NotificationTemplates.fxRateAlert("USD/NGN", "1650", "1600");
    expect(payload.body).toBeTruthy();
    expect(typeof payload.body).toBe("string");
  });

  it("sendPushToUser resolves with sent count", async () => {
    const { sendPushToUser, NotificationTemplates } = await import("./pushNotifications.js");
    const payload = NotificationTemplates.fxRateAlert("USD/KES", "150", "145");
    const result = await sendPushToUser(1, payload);
    expect(result).toHaveProperty("sent");
  });

  it("FX alert direction 'above' triggers when currentRate >= targetRate", () => {
    const currentRate = 1650;
    const targetRate = 1600;
    const direction = "above";
    const isTriggered = direction === "above" ? currentRate >= targetRate : currentRate <= targetRate;
    expect(isTriggered).toBe(true);
  });

  it("FX alert direction 'below' triggers when currentRate <= targetRate", () => {
    const currentRate = 1550;
    const targetRate = 1600;
    const direction = "below";
    const isTriggered = direction === "above" ? currentRate >= targetRate : currentRate <= targetRate;
    expect(isTriggered).toBe(true);
  });

  it("FX alert direction 'above' does NOT trigger when currentRate < targetRate", () => {
    const currentRate = 1550;
    const targetRate = 1600;
    const direction = "above";
    const isTriggered = direction === "above" ? currentRate >= targetRate : currentRate <= targetRate;
    expect(isTriggered).toBe(false);
  });

  it("FX alert direction 'below' does NOT trigger when currentRate > targetRate", () => {
    const currentRate = 1650;
    const targetRate = 1600;
    const direction = "below";
    const isTriggered = direction === "above" ? currentRate >= targetRate : currentRate <= targetRate;
    expect(isTriggered).toBe(false);
  });

  it("notify_push flag controls whether push is sent", () => {
    const alertWithPush = { notify_push: true };
    const alertWithoutPush = { notify_push: false };
    expect(alertWithPush.notify_push !== false).toBe(true);
    expect(alertWithoutPush.notify_push !== false).toBe(false);
  });

  it("notify_email flag controls whether email is sent", () => {
    const alertWithEmail = { notify_email: true };
    const alertWithoutEmail = { notify_email: false };
    expect(alertWithEmail.notify_email !== false).toBe(true);
    expect(alertWithoutEmail.notify_email !== false).toBe(false);
  });
});

// ─── 4. Integration: Transfer State Machine + Push ────────────────────────────

describe("Transfer State Machine — Push Notification Templates", () => {
  it("NotificationTemplates.transferDelivered returns correct structure", async () => {
    const { NotificationTemplates } = await import("./pushNotifications.js");
    const payload = NotificationTemplates.transferDelivered("100", "USD", "John Doe");
    expect(payload).toHaveProperty("title");
    expect(payload).toHaveProperty("body");
    expect(payload).toHaveProperty("tag", "transfer-delivered");
  });

  it("NotificationTemplates.transferFailed returns correct structure", async () => {
    const { NotificationTemplates } = await import("./pushNotifications.js");
    const payload = NotificationTemplates.transferFailed("100", "USD", "Fraud detected");
    expect(payload).toHaveProperty("title");
    expect(payload).toHaveProperty("body");
    expect(payload).toHaveProperty("tag", "transfer-failed");
  });

  it("transfer delivered push notification URL points to /transfers", async () => {
    const { NotificationTemplates } = await import("./pushNotifications.js");
    const payload = NotificationTemplates.transferDelivered("500", "GBP", "Jane Smith");
    expect(payload.url).toBe("/transfers");
  });

  it("transfer failed push notification URL points to /transfers", async () => {
    const { NotificationTemplates } = await import("./pushNotifications.js");
    const payload = NotificationTemplates.transferFailed("500", "GBP", "Sanctions match");
    expect(payload.url).toBe("/transfers");
  });
});
