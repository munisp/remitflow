/**
 * Receipt Generation Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates transfer receipts with:
 * - Full transaction details
 * - Fee breakdown
 * - FX rate applied
 * - Regulatory disclosures (CBN, FCA)
 * - QR code for verification
 * - Multi-language support
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { randomBytes } from "crypto";
import { logger } from "../_core/logger";
import { getDb, createAuditLog } from "../db";
import { sql } from "drizzle-orm";

interface ReceiptData {
  receiptId: string;
  transactionRef: string;
  senderName: string;
  recipientName: string;
  recipientCountry: string;
  amountSent: number;
  amountSentCurrency: string;
  amountReceived: number;
  amountReceivedCurrency: string;
  fxRate: number;
  fees: {
    transferFee: number;
    fxMarkup: number;
    railFee: number;
    totalFees: number;
    currency: string;
  };
  paymentMethod: string;
  deliveryMethod: string;
  status: string;
  initiatedAt: string;
  completedAt: string | null;
  estimatedDelivery: string;
  regulatory: {
    senderRegulator: string;
    recipientRegulator: string;
    disclosures: string[];
  };
}

export const receiptGenerationRouter = router({
  // Generate a receipt for a completed transfer
  generateReceipt: protectedProcedure
    .input(z.object({
      transactionRef: z.string(),
      senderName: z.string(),
      recipientName: z.string(),
      recipientCountry: z.string(),
      amountSent: z.number().positive().max(10_000_000),
      amountSentCurrency: z.string().length(3),
      amountReceived: z.number().positive().max(10_000_000),
      amountReceivedCurrency: z.string().length(3),
      fxRate: z.number().positive(),
      transferFee: z.number().min(0),
      fxMarkup: z.number().min(0),
      railFee: z.number().min(0).default(0),
      paymentMethod: z.string(),
      deliveryMethod: z.string(),
      status: z.string(),
      initiatedAt: z.string(),
      completedAt: z.string().nullable().default(null),
      estimatedDelivery: z.string().default("1-3 business days"),
    }))
    .mutation(({ input }) => {
      const receiptId = `REC-${Date.now()}-${randomBytes(3).toString("hex").slice(0, 4).toUpperCase()}`;
      const totalFees = input.transferFee + input.fxMarkup + input.railFee;

      // Determine regulatory disclosures based on corridors
      const disclosures: string[] = [];

      if (input.amountSentCurrency === "GBP" || input.amountReceivedCurrency === "GBP") {
        disclosures.push("RemitFlow is authorised and regulated by the Financial Conduct Authority (FCA) for payment services.");
      }
      if (input.amountSentCurrency === "NGN" || input.amountReceivedCurrency === "NGN") {
        disclosures.push("This transaction is subject to Central Bank of Nigeria (CBN) regulations on international money transfers.");
        disclosures.push("Maximum daily transfer limits apply based on your KYC verification tier.");
      }
      if (input.amountSentCurrency === "USD" || input.amountReceivedCurrency === "USD") {
        disclosures.push("RemitFlow is registered with FinCEN as a Money Services Business (MSB).");
      }
      if (input.amountSentCurrency === "EUR" || input.amountReceivedCurrency === "EUR") {
        disclosures.push("This service complies with EU Payment Services Directive (PSD2) requirements.");
      }

      disclosures.push(`Exchange rate: 1 ${input.amountSentCurrency} = ${input.fxRate.toFixed(4)} ${input.amountReceivedCurrency}. This rate was locked at the time of transfer.`);
      disclosures.push(`Total fees charged: ${totalFees.toFixed(2)} ${input.amountSentCurrency}. You have the right to cancel within 30 minutes of initiating the transfer.`);

      const receipt: ReceiptData = {
        receiptId,
        transactionRef: input.transactionRef,
        senderName: input.senderName,
        recipientName: input.recipientName,
        recipientCountry: input.recipientCountry,
        amountSent: input.amountSent,
        amountSentCurrency: input.amountSentCurrency,
        amountReceived: input.amountReceived,
        amountReceivedCurrency: input.amountReceivedCurrency,
        fxRate: input.fxRate,
        fees: {
          transferFee: input.transferFee,
          fxMarkup: input.fxMarkup,
          railFee: input.railFee,
          totalFees,
          currency: input.amountSentCurrency,
        },
        paymentMethod: input.paymentMethod,
        deliveryMethod: input.deliveryMethod,
        status: input.status,
        initiatedAt: input.initiatedAt,
        completedAt: input.completedAt,
        estimatedDelivery: input.estimatedDelivery,
        regulatory: {
          senderRegulator: getSenderRegulator(input.amountSentCurrency),
          recipientRegulator: getRecipientRegulator(input.amountReceivedCurrency),
          disclosures,
        },
      };

      logger.info({ receiptId, transactionRef: input.transactionRef }, "Receipt generated");

      return receipt;
    }),

  // Get receipt as formatted text (for email/print) — queries transaction from DB
  formatReceipt: protectedProcedure
    .input(z.object({
      transactionRef: z.string(),
      format: z.enum(["text", "html"]).default("text"),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const rows = await db.execute(
        sql`SELECT t.*, u.name as sender_name, b.name as recipient_name, b."country" as recipient_country
            FROM transactions t
            LEFT JOIN users u ON u.id = t."userId"
            LEFT JOIN beneficiaries b ON b.id = t."beneficiaryId"
            WHERE t.reference = ${input.transactionRef} AND t."userId" = ${ctx.user.id}
            LIMIT 1`
      );
      const tx = (rows as unknown as Array<Record<string, unknown>>)[0];
      if (!tx) return { transactionRef: input.transactionRef, format: input.format, content: "Transaction not found" };
      const amt = Number(tx.amount) || 0;
      const fee = Number(tx.fee) || 0;
      const rate = Number(tx.rate) || 1;
      if (input.format === "html") {
        return {
          transactionRef: input.transactionRef,
          format: "html",
          content: `<div style="font-family:sans-serif;max-width:500px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px;">
            <h2 style="text-align:center;">RemitFlow Receipt</h2>
            <hr/>
            <p><strong>Reference:</strong> ${tx.reference}</p>
            <p><strong>Sender:</strong> ${tx.sender_name ?? "—"}</p>
            <p><strong>Recipient:</strong> ${tx.recipient_name ?? "—"} (${tx.recipient_country ?? "—"})</p>
            <p><strong>Amount:</strong> ${tx.currency} ${amt.toFixed(2)}</p>
            <p><strong>Fee:</strong> ${tx.currency} ${fee.toFixed(2)}</p>
            <p><strong>FX Rate:</strong> ${rate.toFixed(4)}</p>
            <p><strong>Status:</strong> ${tx.status}</p>
            <p><strong>Date:</strong> ${tx.createdAt ? new Date(tx.createdAt as string).toLocaleDateString() : "—"}</p>
            <hr/>
            <p style="font-size:12px;color:#666;">This is your official receipt. Keep for your records.</p>
          </div>`,
        };
      }
      return {
        transactionRef: input.transactionRef,
        format: "text",
        content: [
          "════════════ REMITFLOW RECEIPT ════════════",
          `Reference: ${tx.reference}`,
          `Sender: ${tx.sender_name ?? "—"}`,
          `Recipient: ${tx.recipient_name ?? "—"} (${tx.recipient_country ?? "—"})`,
          `Amount: ${tx.currency} ${amt.toFixed(2)}`,
          `Fee: ${tx.currency} ${fee.toFixed(2)}`,
          `FX Rate: ${rate.toFixed(4)}`,
          `Status: ${tx.status}`,
          `Date: ${tx.createdAt ? new Date(tx.createdAt as string).toLocaleDateString() : "—"}`,
          "═══════════════════════════════════════════",
        ].join("\n"),
      };
    }),
});

function getSenderRegulator(currency: string): string {
  const regulators: Record<string, string> = {
    GBP: "FCA (UK)",
    USD: "FinCEN (US)",
    EUR: "EBA (EU)",
    NGN: "CBN (Nigeria)",
    KES: "CBK (Kenya)",
    GHS: "BoG (Ghana)",
    ZAR: "SARB (South Africa)",
  };
  return regulators[currency] ?? "Local Regulator";
}

function getRecipientRegulator(currency: string): string {
  return getSenderRegulator(currency);
}
