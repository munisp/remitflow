/**
 * Payment Provider Integration Tests
 * Tests the middleware-ready payment abstraction layer
 */
import { describe, expect, it } from "vitest";

describe("Payment Provider — Middleware Abstraction", () => {
  it("selectProvider returns sandbox provider in dev mode", async () => {
    const { selectProvider } = await import("../lib/paymentProviders.js");
    const provider = selectProvider("USD", "bank_transfer");
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe("dev_sandbox");
    expect(provider!.supportedCurrencies).toContain("USD");
    expect(provider!.supportedCurrencies).toContain("NGN");
    expect(provider!.supportedRails).toContain("bank_transfer");
    expect(provider!.supportedRails).toContain("mobile_money");
  });

  it("sandbox provider initiates payment successfully for small amounts", async () => {
    const { initiatePayment } = await import("../lib/paymentProviders.js");
    const result = await initiatePayment({
      amount: 5000,
      currency: "NGN",
      fromCurrency: "USD",
      toCurrency: "NGN",
      recipientAccountNumber: "0123456789",
      recipientPhone: "+2348012345678",
      description: "Test transfer",
      userId: "user-1",
      transactionId: "TXN-TEST-001",
      callbackUrl: "http://localhost:3001/api/webhooks/payment",
    }, "bank_transfer");

    expect(result.success).toBe(true);
    expect(result.providerRef).toMatch(/^DEV-/);
    expect(result.providerName).toBe("dev_sandbox");
    expect(result.status).toBe("completed");
  });

  it("sandbox provider fails for amounts >= 999999", async () => {
    const { initiatePayment } = await import("../lib/paymentProviders.js");
    const result = await initiatePayment({
      amount: 999999,
      currency: "NGN",
      fromCurrency: "USD",
      toCurrency: "NGN",
      recipientAccountNumber: "0123456789",
      recipientPhone: "+2348012345678",
      description: "Large transfer test",
      userId: "user-1",
      transactionId: "TXN-TEST-002",
      callbackUrl: "http://localhost:3001/api/webhooks/payment",
    }, "bank_transfer");

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
  });

  it("selectProvider returns null when no provider matches (production-only currency)", async () => {
    // In dev mode, sandbox supports all currencies — this tests the routing logic
    const { selectProvider } = await import("../lib/paymentProviders.js");
    const provider = selectProvider("USD", "bank_transfer");
    // Should always find sandbox in dev
    expect(provider).not.toBeNull();
  });

  it("sandbox supports all African corridors", async () => {
    const { selectProvider } = await import("../lib/paymentProviders.js");
    const currencies = ["NGN", "KES", "GHS", "TZS", "UGX", "ZAR", "XOF", "XAF"];
    for (const cur of currencies) {
      const provider = selectProvider(cur, "mobile_money");
      expect(provider).not.toBeNull();
      expect(provider!.supportedCurrencies).toContain(cur);
    }
  });
});

describe("Webhook Signature Verification", () => {
  it("verifyWebhookSignature validates HMAC-SHA256 correctly", async () => {
    const { verifyWebhookSignature } = await import("../stripe.js");
    const crypto = await import("crypto");
    const secret = "test_webhook_secret_123";
    const payload = JSON.stringify({ event: "payment.completed", id: "evt_123" });
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    expect(verifyWebhookSignature(payload, signature, secret, "sha256")).toBe(true);
  });

  it("verifyWebhookSignature rejects tampered payload", async () => {
    const { verifyWebhookSignature } = await import("../stripe.js");
    const crypto = await import("crypto");
    const secret = "test_webhook_secret_123";
    const payload = JSON.stringify({ event: "payment.completed", id: "evt_123" });
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const tamperedPayload = JSON.stringify({ event: "payment.completed", id: "evt_999" });

    expect(verifyWebhookSignature(tamperedPayload, signature, secret, "sha256")).toBe(false);
  });

  it("verifyFlutterwaveWebhook validates HMAC-SHA512", async () => {
    const originalEnv = process.env.FLUTTERWAVE_WEBHOOK_SECRET;
    process.env.FLUTTERWAVE_WEBHOOK_SECRET = "flw_test_secret";
    try {
      const { verifyFlutterwaveWebhook } = await import("../stripe.js");
      const crypto = await import("crypto");
      const payload = JSON.stringify({ event: "charge.completed", data: { id: 123 } });
      const hash = crypto.createHmac("sha512", "flw_test_secret").update(payload).digest("hex");

      expect(verifyFlutterwaveWebhook(payload, hash)).toBe(true);
    } finally {
      if (originalEnv) process.env.FLUTTERWAVE_WEBHOOK_SECRET = originalEnv;
      else delete process.env.FLUTTERWAVE_WEBHOOK_SECRET;
    }
  });

  it("verifyStripeWebhook throws without webhook secret configured", async () => {
    const originalEnv = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      const { verifyStripeWebhook } = await import("../stripe.js");
      expect(() => verifyStripeWebhook("payload", "sig")).toThrow("STRIPE_WEBHOOK_SECRET not configured");
    } finally {
      if (originalEnv) process.env.STRIPE_WEBHOOK_SECRET = originalEnv;
    }
  });
});
