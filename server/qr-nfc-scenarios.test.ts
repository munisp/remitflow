/**
 * QR Code & NFC Payment Production Scenarios
 *
 * S1: Merchant QR Payment Lifecycle
 * S2: Dynamic QR with Expiry & Multi-Format (deeplink, EMV, PIX)
 * S3: NFC Tap-to-Pay Terminal Lifecycle
 * S4: NFC Tag Provisioning & Payment
 * S5: HCE (Host Card Emulation) Peer-to-Peer
 * S6: Offline NFC Batch Settlement
 * S7: Security — Replay Protection, Self-Pay, Ownership
 * S8: QR/NFC Analytics & Fraud Detection
 */

import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ── Setup ────────────────────────────────────────────────────────────────────

function createCtx(id: number): TrpcContext {
  return {
    user: { id, openId: `qr-nfc-user-${id}`, name: `QR/NFC User ${id}`, email: `user${id}@test.com`, role: "user", kycTier: "tier3", createdAt: new Date() } as any,
  } as TrpcContext;
}

const qrCaller = appRouter.createCaller(createCtx(9101));
const nfcCaller = appRouter.createCaller(createCtx(9102));

// ── S1: Merchant QR Payment Lifecycle ────────────────────────────────────────

describe("S1: Merchant QR Payment Lifecycle", () => {
  let staticQR: any;
  let merchantProfile: any;

  it("registers a merchant QR profile", async () => {
    merchantProfile = await qrCaller.qrPayments.registerMerchantQR({
      merchantId: "merch-qr-001",
      businessName: "Lagos Suya Spot",
      businessCategory: "food_and_beverage",
      defaultCurrency: "NGN",
      acceptedCoins: ["USDC", "NGN", "USDT"],
      tillNumber: "TILL-001",
    });
    expect(merchantProfile.profileId).toMatch(/^mqr-/);
    expect(merchantProfile.businessName).toBe("Lagos Suya Spot");
    expect(merchantProfile.acceptedCoins).toContain("USDC");
  });

  it("creates a static QR code for the merchant", async () => {
    staticQR = await qrCaller.qrPayments.createStaticQR({
      currency: "NGN",
      merchantName: "Lagos Suya Spot",
      description: "Pay for suya",
      acceptedCoins: ["USDC", "NGN"],
    });
    expect(staticQR.qrId).toMatch(/^qr-/);
    expect(staticQR.type).toBe("static");
    expect(staticQR.status).toBe("active");
    expect(staticQR.payload).toContain("remitflow://pay");
    expect(staticQR.payload).toContain("sig=");
  });

  it("customer scans the static QR", async () => {
    const result = await nfcCaller.qrPayments.scanQR({ qrId: staticQR.qrId });
    expect(result.scan.scanId).toMatch(/^scan-/);
    expect(result.scan.resultAction).toBe("info_displayed"); // no amount on static
    expect(result.qrCode.scanCount).toBe(1);
  });

  it("merchant sees scan in analytics", async () => {
    const analytics = await qrCaller.qrPayments.getQRAnalytics();
    expect(analytics.totalQRCodes).toBeGreaterThanOrEqual(1);
    expect(analytics.totalScans).toBeGreaterThanOrEqual(1);
    expect(analytics.byType.static).toBeGreaterThanOrEqual(1);
  });

  it("lists merchant's QR codes", async () => {
    const codes = await qrCaller.qrPayments.listQRCodes();
    expect(Array.isArray(codes)).toBe(true);
    expect(codes.length).toBeGreaterThanOrEqual(1);
  });

  it("gets scan history for the QR code", async () => {
    const history = await qrCaller.qrPayments.getScanHistory({ qrId: staticQR.qrId });
    expect(history.totalScans).toBe(1);
    expect(history.scans.length).toBe(1);
  });
});

// ── S2: Dynamic QR with Multi-Format ─────────────────────────────────────────

describe("S2: Dynamic QR with Expiry & Multi-Format", () => {
  let deeplinkQR: any;
  let emvQR: any;
  let pixQR: any;

  it("creates a deeplink dynamic QR", async () => {
    deeplinkQR = await qrCaller.qrPayments.createDynamicQR({
      amount: 5000,
      currency: "NGN",
      description: "Lunch payment",
      expiryMinutes: 30,
      maxScans: 1,
      format: "deeplink",
    });
    expect(deeplinkQR.qrId).toMatch(/^qr-/);
    expect(deeplinkQR.type).toBe("dynamic");
    expect(deeplinkQR.amount).toBe(5000);
    expect(deeplinkQR.payload).toContain("remitflow://pay");
    expect(deeplinkQR.expiresAt).toBeTruthy();
    expect(deeplinkQR.maxScans).toBe(1);
  });

  it("creates an EMV format QR", async () => {
    emvQR = await qrCaller.qrPayments.createDynamicQR({
      amount: 10000,
      currency: "NGN",
      format: "emv",
      merchantName: "RemitFlow Merchant",
      merchantCity: "LAGOS",
      countryCode: "NG",
    });
    expect(emvQR.type).toBe("emv");
    expect(emvQR.payload).toContain("000201"); // EMV payload format indicator
  });

  it("creates a PIX format QR", async () => {
    pixQR = await qrCaller.qrPayments.createDynamicQR({
      amount: 250,
      currency: "BRL",
      format: "pix",
      merchantName: "RemitFlow Brasil",
      merchantCity: "SAO PAULO",
      description: "Pagamento teste",
    });
    expect(pixQR.type).toBe("pix");
    expect(pixQR.payload).toContain("br.gov.bcb.pix");
  });

  it("customer scans dynamic QR and payment is initiated", async () => {
    const result = await nfcCaller.qrPayments.scanQR({ qrId: deeplinkQR.qrId });
    expect(result.scan.resultAction).toBe("payment_initiated");
    expect(result.scan.paymentId).toMatch(/^qrpay-/);
    expect(result.qrCode.scanCount).toBe(1);
  });

  it("rejects second scan on single-use QR", async () => {
    await expect(nfcCaller.qrPayments.scanQR({ qrId: deeplinkQR.qrId }))
      .rejects.toThrow("consumed");
  });

  it("revokes a QR code", async () => {
    const result = await qrCaller.qrPayments.revokeQR({ qrId: emvQR.qrId });
    expect(result.status).toBe("revoked");
  });

  it("rejects scan on revoked QR", async () => {
    await expect(nfcCaller.qrPayments.scanQR({ qrId: emvQR.qrId }))
      .rejects.toThrow("revoked");
  });
});

// ── S3: NFC Tap-to-Pay Terminal Lifecycle ────────────────────────────────────

describe("S3: NFC Tap-to-Pay Terminal Lifecycle", () => {
  let terminal: any;

  it("registers an NFC terminal", async () => {
    terminal = await qrCaller.nfcPayments.registerTerminal({
      merchantId: "merch-nfc-001",
      terminalName: "POS Terminal - Counter 1",
      terminalType: "pos",
      supportedProtocols: ["ISO14443A", "NDEF"],
      maxTransactionAmount: 500000,
      currency: "NGN",
      location: { lat: 6.5244, lng: 3.3792, address: "Victoria Island, Lagos" },
    });
    expect(terminal.terminalId).toMatch(/^nfc-/);
    expect(terminal.status).toBe("active");
    expect(terminal.supportedProtocols).toContain("ISO14443A");
  });

  it("processes a tap-to-pay transaction", async () => {
    const tx = await nfcCaller.nfcPayments.tapToPay({
      terminalId: terminal.terminalId,
      amount: 2500,
      currency: "NGN",
      nonce: "nonce-tap-" + Date.now().toString(16) + "0001",
      cardType: "visa_contactless",
      cardLastFour: "4242",
    });
    expect(tx.txId).toMatch(/^nfctx-/);
    expect(tx.status).toBe("captured");
    expect(tx.authCode).toBeTruthy();
    expect(tx.method).toBe("tap_to_pay");
    expect(tx.amount).toBe(2500);
  });

  it("sends terminal heartbeat", async () => {
    const hb = await qrCaller.nfcPayments.terminalHeartbeat({
      terminalId: terminal.terminalId,
      firmwareVersion: "1.2.0",
      batteryLevel: 85,
    });
    expect(hb.terminalId).toBe(terminal.terminalId);
    expect(hb.lastHeartbeat).toBeTruthy();
  });

  it("lists terminals", async () => {
    const list = await qrCaller.nfcPayments.listTerminals();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects transaction exceeding terminal limit", async () => {
    await expect(nfcCaller.nfcPayments.tapToPay({
      terminalId: terminal.terminalId,
      amount: 600000, // exceeds 500K limit
      currency: "NGN",
      nonce: "nonce-tap-" + Date.now().toString(16) + "0002",
    })).rejects.toThrow("exceeds terminal limit");
  });
});

// ── S4: NFC Tag Provisioning & Payment ───────────────────────────────────────

describe("S4: NFC Tag Provisioning & Payment", () => {
  let tag: any;

  it("provisions an NFC tag", async () => {
    tag = await qrCaller.nfcPayments.provisionTag({
      tagType: "ntag215",
      linkedAccountId: "primary",
      maxAmount: 10000,
      currency: "NGN",
      dailyLimit: 50000,
    });
    expect(tag.tagId).toMatch(/^tag-/);
    expect(tag.status).toBe("active");
    expect(tag.ndefPayload).toContain("remitflow://nfc-pay");
    expect(tag.maxAmount).toBe(10000);
  });

  it("customer pays via NFC tag", async () => {
    const tx = await nfcCaller.nfcPayments.payViaTag({
      tagId: tag.tagId,
      amount: 5000,
      nonce: "nonce-tag-" + Date.now().toString(16) + "0001",
    });
    expect(tx.txId).toMatch(/^tagtx-/);
    expect(tx.status).toBe("captured");
    expect(tx.method).toBe("nfc_tag");
  });

  it("rejects payment exceeding tag max amount", async () => {
    await expect(nfcCaller.nfcPayments.payViaTag({
      tagId: tag.tagId,
      amount: 15000, // exceeds 10K tag limit
      nonce: "nonce-tag-" + Date.now().toString(16) + "0002",
    })).rejects.toThrow("exceeds tag limit");
  });

  it("locks an NFC tag", async () => {
    const result = await qrCaller.nfcPayments.lockTag({ tagId: tag.tagId });
    expect(result.status).toBe("locked");
  });

  it("rejects payment on locked tag", async () => {
    await expect(nfcCaller.nfcPayments.payViaTag({
      tagId: tag.tagId,
      amount: 1000,
      nonce: "nonce-tag-" + Date.now().toString(16) + "0003",
    })).rejects.toThrow("not active");
  });

  it("lists user's tags", async () => {
    const tags = await qrCaller.nfcPayments.listTags();
    expect(Array.isArray(tags)).toBe(true);
    expect(tags.length).toBeGreaterThanOrEqual(1);
  });
});

// ── S5: HCE (Host Card Emulation) Peer-to-Peer ──────────────────────────────

describe("S5: HCE Peer-to-Peer NFC Payment", () => {
  it("sends HCE payment between users", async () => {
    const tx = await nfcCaller.nfcPayments.hcePayment({
      receiverUserId: "9001",
      amount: 3000,
      currency: "NGN",
      nonce: "nonce-hce-" + Date.now().toString(16) + "0001",
    });
    expect(tx.txId).toMatch(/^hce-/);
    expect(tx.method).toBe("hce");
    expect(tx.status).toBe("captured");
    expect(tx.payeeId).toBe("9001");
  });

  it("rejects self-HCE payment", async () => {
    await expect(nfcCaller.nfcPayments.hcePayment({
      receiverUserId: "9102", // same as caller
      amount: 1000,
      currency: "NGN",
      nonce: "nonce-hce-" + Date.now().toString(16) + "0002",
    })).rejects.toThrow("Cannot pay yourself");
  });
});

// ── S6: Offline NFC Batch Settlement ─────────────────────────────────────────

describe("S6: Offline NFC Batch Settlement", () => {
  let terminal: any;

  it("registers terminal for offline use", async () => {
    terminal = await qrCaller.nfcPayments.registerTerminal({
      merchantId: "merch-offline-001",
      terminalName: "Offline POS",
      terminalType: "pos",
      currency: "NGN",
    });
    expect(terminal.terminalId).toBeTruthy();
  });

  it("settles offline batch", async () => {
    const result = await qrCaller.nfcPayments.syncOfflineTransactions({
      terminalId: terminal.terminalId,
      transactions: [
        { amount: 1000, currency: "NGN", nonce: "offline-" + Date.now().toString(16) + "a1", timestamp: new Date().toISOString() },
        { amount: 2500, currency: "NGN", nonce: "offline-" + Date.now().toString(16) + "a2", timestamp: new Date().toISOString() },
        { amount: 750,  currency: "NGN", nonce: "offline-" + Date.now().toString(16) + "a3", timestamp: new Date().toISOString() },
      ],
    });
    expect(result.offlineId).toMatch(/^offline-/);
    expect(result.settled).toBe(3);
    expect(result.duplicatesSkipped).toBe(0);
    expect(result.totalAmount).toBe(4250);
  });

  it("deduplicates replay transactions in offline batch", async () => {
    const nonce1 = "offline-replay-" + Date.now().toString(16);
    // First submission
    await qrCaller.nfcPayments.syncOfflineTransactions({
      terminalId: terminal.terminalId,
      transactions: [
        { amount: 500, currency: "NGN", nonce: nonce1, timestamp: new Date().toISOString() },
      ],
    });
    // Second submission with same nonce
    const result = await qrCaller.nfcPayments.syncOfflineTransactions({
      terminalId: terminal.terminalId,
      transactions: [
        { amount: 500, currency: "NGN", nonce: nonce1, timestamp: new Date().toISOString() },
      ],
    });
    expect(result.duplicatesSkipped).toBe(1);
    expect(result.settled).toBe(0);
  });
});

// ── S7: Security Tests ───────────────────────────────────────────────────────

describe("S7: Security — Replay, Self-Pay, Ownership", () => {
  it("rejects duplicate NFC nonce (replay attack)", async () => {
    const terminal = await qrCaller.nfcPayments.registerTerminal({
      merchantId: "merch-sec-001",
      terminalName: "Security Test Terminal",
      terminalType: "pos",
      currency: "NGN",
    });
    const nonce = "security-nonce-" + Date.now().toString(16);
    // First use
    await nfcCaller.nfcPayments.tapToPay({
      terminalId: terminal.terminalId,
      amount: 100,
      currency: "NGN",
      nonce,
    });
    // Replay attempt
    await expect(nfcCaller.nfcPayments.tapToPay({
      terminalId: terminal.terminalId,
      amount: 100,
      currency: "NGN",
      nonce,
    })).rejects.toThrow("Duplicate transaction nonce");
  });

  it("prevents scanning your own QR code", async () => {
    const qr = await qrCaller.qrPayments.createStaticQR({ currency: "NGN" });
    await expect(qrCaller.qrPayments.scanQR({ qrId: qr.qrId }))
      .rejects.toThrow("Cannot scan your own QR code");
  });

  it("prevents paying your own NFC tag", async () => {
    const tag = await qrCaller.nfcPayments.provisionTag({
      maxAmount: 5000, currency: "NGN", dailyLimit: 50000,
    });
    await expect(qrCaller.nfcPayments.payViaTag({
      tagId: tag.tagId,
      amount: 1000,
      nonce: "self-pay-" + Date.now().toString(16),
    })).rejects.toThrow("Cannot pay your own tag");
  });

  it("prevents cross-user QR code access", async () => {
    const qr = await qrCaller.qrPayments.createStaticQR({ currency: "NGN" });
    await expect(nfcCaller.qrPayments.getQR({ qrId: qr.qrId }))
      .rejects.toThrow("not found");
  });

  it("prevents cross-user tag lock", async () => {
    const tag = await qrCaller.nfcPayments.provisionTag({
      maxAmount: 5000, currency: "NGN", dailyLimit: 50000,
    });
    await expect(nfcCaller.nfcPayments.lockTag({ tagId: tag.tagId }))
      .rejects.toThrow("not found");
  });

  it("prevents cross-user terminal heartbeat", async () => {
    const terminal = await qrCaller.nfcPayments.registerTerminal({
      merchantId: "merch-xuser", terminalName: "Cross-user test", terminalType: "pos", currency: "NGN",
    });
    await expect(nfcCaller.nfcPayments.terminalHeartbeat({
      terminalId: terminal.terminalId,
    })).rejects.toThrow("not found");
  });

  it("prevents NFC refund by non-owner", async () => {
    const terminal = await qrCaller.nfcPayments.registerTerminal({
      merchantId: "merch-refund", terminalName: "Refund test", terminalType: "pos", currency: "NGN",
    });
    const tx = await nfcCaller.nfcPayments.tapToPay({
      terminalId: terminal.terminalId, amount: 500, currency: "NGN",
      nonce: "refund-nonce-" + Date.now().toString(16),
    });
    // nfcCaller (payer) cannot refund — only payee (qrCaller) can
    await expect(nfcCaller.nfcPayments.refundTransaction({ txId: tx.txId }))
      .rejects.toThrow("Not authorized");
  });
});

// ── S8: QR/NFC Analytics ─────────────────────────────────────────────────────

describe("S8: QR/NFC Analytics", () => {
  it("returns QR analytics for user", async () => {
    const analytics = await qrCaller.qrPayments.getQRAnalytics();
    expect(typeof analytics.totalQRCodes).toBe("number");
    expect(typeof analytics.activeQRCodes).toBe("number");
    expect(typeof analytics.totalScans).toBe("number");
    expect(typeof analytics.totalPayments).toBe("number");
    expect(typeof analytics.totalAmountReceived).toBe("number");
    expect(analytics.byType).toHaveProperty("static");
  });

  it("returns NFC analytics for user", async () => {
    const analytics = await qrCaller.nfcPayments.getAnalytics();
    expect(typeof analytics.totalTerminals).toBe("number");
    expect(typeof analytics.totalTags).toBe("number");
    expect(typeof analytics.totalTransactions).toBe("number");
    expect(typeof analytics.totalReceived).toBe("number");
    expect(analytics.byMethod).toBeDefined();
  });

  it("returns NFC transaction history", async () => {
    const history = await nfcCaller.nfcPayments.getTransactionHistory();
    expect(Array.isArray(history)).toBe(true);
    // nfcCaller (user 9002) should have transactions from the tests above
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it("reports lost NFC tag", async () => {
    const tag = await qrCaller.nfcPayments.provisionTag({
      maxAmount: 5000, currency: "NGN", dailyLimit: 50000,
    });
    const result = await qrCaller.nfcPayments.reportLostTag({ tagId: tag.tagId });
    expect(result.status).toBe("lost");
    expect(result.message).toContain("deactivated");
  });

  it("refunds an NFC transaction", async () => {
    const terminal = await qrCaller.nfcPayments.registerTerminal({
      merchantId: "merch-refund-2", terminalName: "Refund Terminal", terminalType: "pos", currency: "NGN",
    });
    const tx = await nfcCaller.nfcPayments.tapToPay({
      terminalId: terminal.terminalId, amount: 1500, currency: "NGN",
      nonce: "refund-ok-" + Date.now().toString(16),
    });
    // qrCaller is the payee (terminal owner) — authorized to refund
    const refund = await qrCaller.nfcPayments.refundTransaction({ txId: tx.txId });
    expect(refund.status).toBe("refunded");
    expect(refund.amount).toBe(1500);
  });

  it("rejects double refund", async () => {
    const terminal = await qrCaller.nfcPayments.registerTerminal({
      merchantId: "merch-double-ref", terminalName: "Double Refund Test", terminalType: "pos", currency: "NGN",
    });
    const tx = await nfcCaller.nfcPayments.tapToPay({
      terminalId: terminal.terminalId, amount: 800, currency: "NGN",
      nonce: "double-ref-" + Date.now().toString(16),
    });
    await qrCaller.nfcPayments.refundTransaction({ txId: tx.txId });
    await expect(qrCaller.nfcPayments.refundTransaction({ txId: tx.txId }))
      .rejects.toThrow("Already refunded");
  });
});
