// ============================================================================
// RemitFlow — PIX, UPI & CIPS Payment Rail Webhook Handlers
// Receives settlement confirmations from payment partners and advances
// transfer state from "partner_sent" → "completed".
//
//   POST /api/webhooks/pix    — PIX (Brazil) settlement callback
//   POST /api/webhooks/upi    — UPI (India) settlement callback
//   POST /api/webhooks/cips   — CIPS (China) settlement callback
// ============================================================================
import type { Express, Request, Response, NextFunction } from "express";
import { getDb, createAuditLog } from "./db.js";
import { transactions } from "../drizzle/schema.js";
import { sql } from "drizzle-orm";
import { logger } from "./_core/logger";
import { advanceTransferState } from "./transfer-state-machine.js";
import { verifyWebhookSignature, isWebhookDuplicate } from "./lib/webhookHmac.js";

// ─── Webhook Rate Limiter ──────────────────────────────────────────────────────
// Sliding window rate limiter for webhook endpoints to prevent replay attacks
// and DDoS via webhook flooding. 100 requests per minute per IP.
const webhookRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const WEBHOOK_RATE_LIMIT = 100;
const WEBHOOK_RATE_WINDOW_MS = 60_000;

function webhookRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const entry = webhookRateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    webhookRateLimitMap.set(ip, { count: 1, resetAt: now + WEBHOOK_RATE_WINDOW_MS });
    next();
    return;
  }

  entry.count++;
  if (entry.count > WEBHOOK_RATE_LIMIT) {
    logger.warn({ ip, count: entry.count }, "[Webhook] Rate limit exceeded");
    res.status(429).json({ error: "Too many webhook requests" });
    return;
  }

  next();
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  webhookRateLimitMap.forEach((entry, ip) => {
    if (now > entry.resetAt) webhookRateLimitMap.delete(ip);
  });
}, 300_000);

/**
 * Look up a transaction by its partner reference stored in metadata.
 * Returns the internal reference and userId needed to advance state.
 */
async function findTransactionByPartnerRef(
  partnerRef: string
): Promise<{ reference: string; userId: number } | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.execute(
    sql`SELECT reference, "userId" FROM transactions
        WHERE metadata->>'partnerReference' = ${partnerRef}
        LIMIT 1`
  );
  const row = (rows as any[])[0];
  if (!row) return null;
  return { reference: row.reference, userId: row.userId };
}

// ─── PIX Webhook ───────────────────────────────────────────────────────────────

interface PixWebhookPayload {
  endToEndId: string;
  status: "ACSC" | "RJCT" | "CANC" | "PDNG";
  txid?: string;
  valor?: number;
  horario?: { criacao?: string; liquidacao?: string };
  infoPagador?: string;
}

function handlePixCallback(app: Express) {
  app.post("/api/webhooks/pix", async (req: Request, res: Response) => {
    // HMAC signature verification
    const rawBody = JSON.stringify(req.body);
    if (!verifyWebhookSignature("pix", rawBody, req.headers as Record<string, string>)) {
      logger.warn({ ip: req.ip }, "[PIX Webhook] Invalid HMAC signature");
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    const payload = req.body as PixWebhookPayload;
    const { endToEndId, status } = payload;

    if (!endToEndId) {
      res.status(400).json({ error: "Missing endToEndId" });
      return;
    }

    // Deduplication check
    if (isWebhookDuplicate("pix", endToEndId)) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    logger.info(
      { endToEndId, status },
      "[PIX Webhook] Received settlement callback"
    );

    const txn = await findTransactionByPartnerRef(endToEndId);
    if (!txn) {
      logger.warn(
        { endToEndId },
        "[PIX Webhook] No matching transaction found"
      );
      res.status(200).json({ received: true, matched: false });
      return;
    }

    try {
      if (status === "ACSC") {
        // Settlement confirmed — advance to completed
        await advanceTransferState(txn.reference, txn.userId, "completed");
        await createAuditLog({
          userId: txn.userId,
          action: "PIX_SETTLEMENT_CONFIRMED",
          description: `PIX settlement confirmed for ${txn.reference} (endToEndId: ${endToEndId})`,
        });
        logger.info(
          { reference: txn.reference, endToEndId },
          "[PIX Webhook] Transfer completed via PIX settlement"
        );
      } else if (status === "RJCT" || status === "CANC") {
        // Settlement rejected or cancelled — fail the transfer
        await advanceTransferState(txn.reference, txn.userId, "failed", {
          failureReason: `PIX settlement ${status === "RJCT" ? "rejected" : "cancelled"} (endToEndId: ${endToEndId}). Funds will be returned to sender wallet.`,
          requiresManualReview: true,
        });
        await createAuditLog({
          userId: txn.userId,
          action: "PIX_SETTLEMENT_FAILED",
          description: `PIX settlement ${status} for ${txn.reference} (endToEndId: ${endToEndId})`,
        });
        logger.error(
          { reference: txn.reference, endToEndId, status },
          "[PIX Webhook] Transfer failed via PIX settlement"
        );
      }
      // PDNG — still pending, no state change needed
    } catch (err) {
      logger.error(
        { err, reference: txn.reference, endToEndId },
        "[PIX Webhook] Error processing callback"
      );
    }

    res.status(200).json({ received: true, matched: true });
  });
}

// ─── UPI Webhook ───────────────────────────────────────────────────────────────

interface UpiWebhookPayload {
  transactionId: string;
  status: "SUCCESS" | "FAILURE" | "PENDING" | "DEEMED";
  upiRefNum?: string;
  payerVpa?: string;
  payeeVpa?: string;
  amount?: number;
  remarks?: string;
  txnTimestamp?: string;
  responseCode?: string;
}

function handleUpiCallback(app: Express) {
  app.post("/api/webhooks/upi", async (req: Request, res: Response) => {
    // HMAC signature verification
    const rawBody = JSON.stringify(req.body);
    if (!verifyWebhookSignature("upi", rawBody, req.headers as Record<string, string>)) {
      logger.warn({ ip: req.ip }, "[UPI Webhook] Invalid HMAC signature");
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    const payload = req.body as UpiWebhookPayload;
    const { transactionId, status } = payload;

    if (!transactionId) {
      res.status(400).json({ error: "Missing transactionId" });
      return;
    }

    if (isWebhookDuplicate("upi", transactionId)) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    logger.info(
      { transactionId, status },
      "[UPI Webhook] Received settlement callback"
    );

    const txn = await findTransactionByPartnerRef(transactionId);
    if (!txn) {
      logger.warn(
        { transactionId },
        "[UPI Webhook] No matching transaction found"
      );
      res.status(200).json({ received: true, matched: false });
      return;
    }

    try {
      if (status === "SUCCESS") {
        await advanceTransferState(txn.reference, txn.userId, "completed");
        await createAuditLog({
          userId: txn.userId,
          action: "UPI_SETTLEMENT_CONFIRMED",
          description: `UPI settlement confirmed for ${txn.reference} (txnId: ${transactionId}, upiRef: ${payload.upiRefNum ?? "N/A"})`,
        });
        logger.info(
          { reference: txn.reference, transactionId },
          "[UPI Webhook] Transfer completed via UPI settlement"
        );
      } else if (status === "FAILURE") {
        await advanceTransferState(txn.reference, txn.userId, "failed", {
          failureReason: `UPI settlement failed (txnId: ${transactionId}, responseCode: ${payload.responseCode ?? "unknown"}). Funds will be returned to sender wallet.`,
          requiresManualReview: true,
        });
        await createAuditLog({
          userId: txn.userId,
          action: "UPI_SETTLEMENT_FAILED",
          description: `UPI settlement failed for ${txn.reference} (txnId: ${transactionId})`,
        });
        logger.error(
          { reference: txn.reference, transactionId, responseCode: payload.responseCode },
          "[UPI Webhook] Transfer failed via UPI settlement"
        );
      } else if (status === "DEEMED") {
        // DEEMED = auto-approved after timeout (NPCI rule)
        await advanceTransferState(txn.reference, txn.userId, "completed");
        await createAuditLog({
          userId: txn.userId,
          action: "UPI_SETTLEMENT_DEEMED",
          description: `UPI settlement deemed successful for ${txn.reference} (txnId: ${transactionId})`,
        });
      }
      // PENDING — no state change
    } catch (err) {
      logger.error(
        { err, reference: txn.reference, transactionId },
        "[UPI Webhook] Error processing callback"
      );
    }

    res.status(200).json({ received: true, matched: true });
  });
}

// ─── CIPS Webhook ──────────────────────────────────────────────────────────────

interface CipsWebhookPayload {
  transactionId: string;
  status: "ACSC" | "RJCT" | "PDNG" | "ACCP";
  statusReason?: string;
  msgId?: string;
  settlementDate?: string;
  amount?: number;
  currency?: string;
}

function handleCipsCallback(app: Express) {
  app.post("/api/webhooks/cips", async (req: Request, res: Response) => {
    const rawBody = JSON.stringify(req.body);
    if (!verifyWebhookSignature("cips", rawBody, req.headers as Record<string, string>)) {
      logger.warn({ ip: req.ip }, "[CIPS Webhook] Invalid HMAC signature");
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    const payload = req.body as CipsWebhookPayload;
    const { transactionId, status } = payload;

    if (!transactionId) {
      res.status(400).json({ error: "Missing transactionId" });
      return;
    }

    if (isWebhookDuplicate("cips", transactionId)) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    logger.info(
      { transactionId, status, msgId: payload.msgId },
      "[CIPS Webhook] Received settlement callback"
    );

    const txn = await findTransactionByPartnerRef(transactionId);
    if (!txn) {
      logger.warn(
        { transactionId },
        "[CIPS Webhook] No matching transaction found"
      );
      res.status(200).json({ received: true, matched: false });
      return;
    }

    try {
      if (status === "ACSC") {
        // Accepted Settlement Completed
        await advanceTransferState(txn.reference, txn.userId, "completed");
        await createAuditLog({
          userId: txn.userId,
          action: "CIPS_SETTLEMENT_CONFIRMED",
          description: `CIPS settlement confirmed for ${txn.reference} (txnId: ${transactionId}, msgId: ${payload.msgId ?? "N/A"})`,
        });
        logger.info(
          { reference: txn.reference, transactionId },
          "[CIPS Webhook] Transfer completed via CIPS settlement"
        );
      } else if (status === "RJCT") {
        // Rejected by CIPS Switch or beneficiary bank
        await advanceTransferState(txn.reference, txn.userId, "failed", {
          failureReason: `CIPS settlement rejected (txnId: ${transactionId}, reason: ${payload.statusReason ?? "unknown"}). Funds will be returned to sender wallet.`,
          requiresManualReview: true,
        });
        await createAuditLog({
          userId: txn.userId,
          action: "CIPS_SETTLEMENT_FAILED",
          description: `CIPS settlement rejected for ${txn.reference} (txnId: ${transactionId}, reason: ${payload.statusReason ?? "N/A"})`,
        });
        logger.error(
          { reference: txn.reference, transactionId, statusReason: payload.statusReason },
          "[CIPS Webhook] Transfer failed via CIPS settlement"
        );
      }
      // ACCP (accepted, pending) and PDNG — no state change
    } catch (err) {
      logger.error(
        { err, reference: txn.reference, transactionId },
        "[CIPS Webhook] Error processing callback"
      );
    }

    res.status(200).json({ received: true, matched: true });
  });
}

// ─── Mojaloop Webhook ────────────────────────────────────────────────────────
//   POST /api/webhooks/mojaloop — Mojaloop FSPIOP settlement callback
//   Forwarded from Go mojaloop-connector on transfer fulfil/abort.
// ──────────────────────────────────────────────────────────────────────────────

function handleMojaloopCallback(app: Express): void {
  app.post("/api/webhooks/mojaloop", async (req: Request, res: Response) => {
    const rawBody = JSON.stringify(req.body);
    if (!verifyWebhookSignature("mojaloop", rawBody, req.headers as Record<string, string>)) {
      logger.warn({ ip: req.ip }, "[Mojaloop Webhook] Invalid HMAC signature");
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    const { transferId, transferState, fulfilment, completedTimestamp } = req.body;

    if (!transferId) {
      res.status(400).json({ error: "Missing transferId" });
      return;
    }

    if (isWebhookDuplicate("mojaloop", transferId)) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    const tx = await findTransactionByPartnerRef(transferId);
    if (!tx) {
      logger.warn({ transferId }, "[Mojaloop Webhook] No matching transaction");
      res.status(200).json({ received: true, matched: false });
      return;
    }

    const state = transferState || "COMMITTED";
    const targetState = state === "COMMITTED" ? "completed" : "failed";

    try {
      await advanceTransferState(
        tx.reference,
        tx.userId,
        targetState,
        { failureReason: targetState === "failed" ? `Mojaloop ${state}` : undefined }
      );

      await createAuditLog({
        userId: tx.userId,
        action: "mojaloop_webhook_processed",
        description: `Transfer ${tx.reference} → ${targetState} via Mojaloop callback`,
        ipAddress: req.ip ?? "webhook",
      });

      logger.info(
        { transferId, reference: tx.reference, targetState },
        "[Mojaloop Webhook] Transfer state advanced"
      );
    } catch (err) {
      logger.error(
        { err, transferId, reference: tx.reference },
        "[Mojaloop Webhook] Error processing callback"
      );
    }

    res.status(200).json({ received: true, matched: true });
  });
}

// ─── SWIFT Webhook ─────────────────────────────────────────────────────────────
//   POST /api/webhooks/swift — SWIFT gpi tracking notification (camt.054)
//   Handles settlement confirmations from SWIFT gpi for international transfers.
// ──────────────────────────────────────────────────────────────────────────────

function handleSwiftCallback(app: Express): void {
  app.post("/api/webhooks/swift", async (req: Request, res: Response) => {
    const rawBody = JSON.stringify(req.body);
    if (!verifyWebhookSignature("swift", rawBody, req.headers as Record<string, string>)) {
      logger.warn({ ip: req.ip }, "[SWIFT Webhook] Invalid HMAC signature");
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    const { uetr, transactionStatus, completionTime } = req.body;

    if (!uetr) {
      res.status(400).json({ error: "Missing UETR (Unique End-to-End Transaction Reference)" });
      return;
    }

    if (isWebhookDuplicate("swift", uetr)) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    const tx = await findTransactionByPartnerRef(uetr);
    if (!tx) {
      logger.warn({ uetr }, "[SWIFT Webhook] No matching transaction");
      res.status(200).json({ received: true, matched: false });
      return;
    }

    // SWIFT gpi status codes: ACSC (accepted), RJCT (rejected), ACSP (pending)
    type SwiftState = "completed" | "failed" | "partner_sent";
    const statusMap: Record<string, SwiftState> = {
      ACSC: "completed",
      ACCC: "completed",
      RJCT: "failed",
      ACSP: "partner_sent",
    };
    const targetState: SwiftState = statusMap[transactionStatus] || "partner_sent";

    try {
      await advanceTransferState(
        tx.reference,
        tx.userId,
        targetState,
        { failureReason: targetState === "failed" ? `SWIFT gpi ${transactionStatus}` : undefined }
      );

      await createAuditLog({
        userId: tx.userId,
        action: "swift_webhook_processed",
        description: `Transfer ${tx.reference} → ${targetState} via SWIFT gpi (${transactionStatus})`,
        ipAddress: req.ip ?? "webhook",
      });

      logger.info(
        { uetr, reference: tx.reference, targetState, transactionStatus },
        "[SWIFT Webhook] Transfer state advanced"
      );
    } catch (err) {
      logger.error(
        { err, uetr, reference: tx.reference },
        "[SWIFT Webhook] Error processing callback"
      );
    }

    res.status(200).json({ received: true, matched: true });
  });
}

// ─── Registration ──────────────────────────────────────────────────────────────

export function registerPaymentRailWebhooks(app: Express): void {
  // Apply rate limiting to all webhook endpoints
  app.use("/api/webhooks", webhookRateLimiter);

  handlePixCallback(app);
  handleUpiCallback(app);
  handleCipsCallback(app);
  handleMojaloopCallback(app);
  handleSwiftCallback(app);
  logger.info(
    "[PaymentRails] Webhook handlers registered (rate-limited: %d/min) at /api/webhooks/{pix,upi,cips,mojaloop,swift}",
    WEBHOOK_RATE_LIMIT
  );
}
