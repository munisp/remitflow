// ============================================================================
// RemitFlow — PIX, UPI & CIPS Payment Rail Webhook Handlers
// Receives settlement confirmations from payment partners and advances
// transfer state from "partner_sent" → "completed".
//
//   POST /api/webhooks/pix    — PIX (Brazil) settlement callback
//   POST /api/webhooks/upi    — UPI (India) settlement callback
//   POST /api/webhooks/cips   — CIPS (China) settlement callback
// ============================================================================
import type { Express, Request, Response } from "express";
import { getDb, createAuditLog } from "./db.js";
import { transactions } from "../drizzle/schema.js";
import { sql } from "drizzle-orm";
import { logger } from "./_core/logger";
import { advanceTransferState } from "./transfer-state-machine.js";

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
    const payload = req.body as PixWebhookPayload;
    const { endToEndId, status } = payload;

    if (!endToEndId) {
      res.status(400).json({ error: "Missing endToEndId" });
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
    const payload = req.body as UpiWebhookPayload;
    const { transactionId, status } = payload;

    if (!transactionId) {
      res.status(400).json({ error: "Missing transactionId" });
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
    const payload = req.body as CipsWebhookPayload;
    const { transactionId, status } = payload;

    if (!transactionId) {
      res.status(400).json({ error: "Missing transactionId" });
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

// ─── Registration ──────────────────────────────────────────────────────────────

export function registerPaymentRailWebhooks(app: Express): void {
  handlePixCallback(app);
  handleUpiCallback(app);
  handleCipsCallback(app);
  logger.info(
    "[PaymentRails] Webhook handlers registered at /api/webhooks/pix, /api/webhooks/upi, /api/webhooks/cips"
  );
}
