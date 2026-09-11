/**
 * RemitFlow — Payment Links Router (W10 / SPEC-wave10 C2)
 * ───────────────────────────────────────────────────────
 * PUBLIC tokenized invoice-payment endpoints (no session for resolve/payCard/
 * payBank; wallet payment requires an authenticated user):
 *   - Tokens are 32-byte random; ONLY the sha256 hash is stored on the invoice.
 *     Resolution re-hashes the presented token and confirms it against the
 *     stored hash with crypto.timingSafeEqual.
 *   - resolve → invoice summary WITHOUT internal ids (invoice number only).
 *   - payWallet → guarded wallet debit + guarded recordPayment in ONE
 *     db.transaction (canonical TOTP step-up).
 *   - payCard → creates a cardFunding intent (Stripe PaymentIntent); the
 *     payment executes ONLY after Stripe capture via cardFunding.confirmIntent
 *     (primary path) or processFundingWebhook (orchestrator-wired), then
 *     cardFunding.execute → registered invoice executor → recordPayment.
 *   - payBank → honest pending rail instructions from env config; fail closed
 *     (UNAVAILABLE) when unconfigured; never fabricates references.
 *   - Fee-shifting: when invoice.feeShifting, the card fee (CARD_FEE_PCT,
 *     default 2.9%) is added to the PAYER total and itemized in the response.
 *   - On success → Kafka invoice.paid + indexInvoice (C5's searchIndexer —
 *     non-critical, warn-soft).
 */
import { timingSafeEqual } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc.js";
import { invoiceItems, invoicesV2, transactions, wallets } from "../../drizzle/schema.js";
import { logger } from "../_core/logger.js";
import { auditCoreOperation } from "../middleware/coreAtomicity.js";
import { KAFKA_TOPICS } from "../middleware/kafka.js";
import {
  PAYABLE_INVOICE_STATUSES,
  applyInvoicePaymentTx,
  emitInvoiceEvent,
  hashPaymentLinkToken,
  requireArDb,
  toDec4,
} from "./invoicesV2Router.js";
import { CARD_FEE_PCT, createCardFundingIntent } from "./cardFunding.js";
import { indexInvoice } from "../services/searchIndexer.js";

type InvoiceRow = typeof invoicesV2.$inferSelect;

// ─── Token resolution (constant-time hash confirmation) ─────────────────────
async function resolveInvoiceByToken(rawToken: string): Promise<InvoiceRow> {
  const db = await requireArDb();
  const computedHash = hashPaymentLinkToken(rawToken);
  const [inv] = await db
    .select()
    .from(invoicesV2)
    .where(eq(invoicesV2.paymentLinkTokenHash, computedHash))
    .limit(1);
  if (!inv || !inv.paymentLinkTokenHash) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Invalid or expired payment link" });
  }
  // SPEC C2: confirm via constant-time compare (defense-in-depth on top of the
  // indexed lookup — guards against any future non-hashed lookup path).
  const a = Buffer.from(computedHash, "utf8");
  const b = Buffer.from(inv.paymentLinkTokenHash, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Invalid or expired payment link" });
  }
  return inv;
}

function assertPayable(inv: InvoiceRow): void {
  if (!(PAYABLE_INVOICE_STATUSES as readonly string[]).includes(inv.status)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Invoice ${inv.invoiceNumber} is ${inv.status} — it cannot be paid through this link`,
    });
  }
}

function outstanding(inv: InvoiceRow): number {
  return toDec4(Number(inv.total) - Number(inv.amountPaid));
}

function cardFeeFor(amount: number, feeShifting: boolean): number {
  return feeShifting ? toDec4(amount * CARD_FEE_PCT) : 0;
}

// ─── Search indexer (C5 owns server/services/searchIndexer.ts) ───────────────
// Static import (C5 has landed). Search is non-critical: indexInvoice is
// fail-soft internally, but keep a warn-soft guard so indexing can never
// block payment. The full invoice row is passed (indexer needs id+tenantId).
async function indexInvoiceSafe(inv: InvoiceRow): Promise<void> {
  try {
    await indexInvoice({ ...inv, id: Number(inv.id), tenantId: Number(inv.tenantId) });
  } catch (err) {
    logger.warn("[PaymentLinks] searchIndexer.indexInvoice unavailable (non-critical):", (err as Error)?.message);
  }
}

async function emitPaymentSuccess(inv: InvoiceRow, result: { status: string; amountPaid: string }, method: string): Promise<void> {
  await emitInvoiceEvent(
    result.status === "paid" ? "invoice.paid" : "invoice.payment_recorded",
    { id: inv.id, tenantId: inv.tenantId, invoiceNumber: inv.invoiceNumber, status: result.status, total: inv.total, currency: inv.currency },
    { amountPaid: result.amountPaid, method },
  );
  await indexInvoiceSafe(inv);
}

// ─── Router ───────────────────────────────────────────────────────────────────
export const paymentLinksRouter = router({
  /** PUBLIC: resolve a payment link token to a safe invoice summary. */
  resolve: publicProcedure
    .input(z.object({ token: z.string().min(16).max(128) }))
    .query(async ({ input }) => {
      const inv = await resolveInvoiceByToken(input.token);
      const db = await requireArDb();
      const items = await db
        .select({
          description: invoiceItems.description,
          quantity: invoiceItems.quantity,
          unitPrice: invoiceItems.unitPrice,
          amount: invoiceItems.amount,
        })
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, inv.id))
        .orderBy(invoiceItems.sortOrder);
      const due = outstanding(inv);
      const payable = (PAYABLE_INVOICE_STATUSES as readonly string[]).includes(inv.status) && due > 0;
      const fee = cardFeeFor(due, inv.feeShifting);
      return {
        // No internal ids beyond the invoice number (SPEC C2).
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customerName,
        currency: inv.currency,
        subtotal: inv.subtotal,
        taxAmount: inv.taxAmount,
        total: inv.total,
        amountPaid: inv.amountPaid,
        amountDue: due.toFixed(4),
        dueDate: inv.dueDate,
        status: inv.status,
        payable,
        feeShifting: inv.feeShifting,
        cardFee: inv.feeShifting
          ? { pct: CARD_FEE_PCT, amount: fee.toFixed(4), payerTotal: toDec4(due + fee).toFixed(4) }
          : null,
        items,
      };
    }),

  /** AUTH'D: pay the outstanding balance from the caller's wallet. */
  payWallet: protectedProcedure
    .input(
      z.object({
        token: z.string().min(16).max(128),
        totpCode: z.string().regex(/^\d{6}$/).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const inv = await resolveInvoiceByToken(input.token);
      assertPayable(inv);
      const amount = outstanding(inv);
      if (!(amount > 0)) {
        throw new TRPCError({ code: "CONFLICT", message: "Invoice is already fully paid" });
      }

      // Canonical TOTP step-up (SPEC-wave7 C2): money leaves the payer's wallet.
      const { getTotpEnrollment, verifyTOTP } = await import("../totp.js");
      const enrollment = await getTotpEnrollment(ctx.user.id);
      if (!enrollment.dbAvailable) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "2FA verification unavailable — payment blocked" });
      }
      if (enrollment.enabled && enrollment.secret) {
        if (!input.totpCode) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "2FA code required for this action" });
        }
        const valid = await verifyTOTP(input.totpCode, enrollment.secret);
        if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid 2FA code" });
      }

      // Deterministic per-payment reference (invoice id + stored token-hash
      // prefix): a retry of the same payment produces the same reference, so
      // the movement is detectable/reconcilable in `transactions`.
      const reference = `PAYLINK_${inv.id}_${(inv.paymentLinkTokenHash ?? "").slice(0, 16)}`;

      const db = await requireArDb();
      const result = await db.transaction(async (tx) => {
        // C1 ordering fix: the guarded invoice flip happens FIRST. If the
        // invoice is already paid (or a concurrent payment won the race), the
        // status/overpayment guard inside applyInvoicePaymentTx affects 0 rows
        // and throws → the whole db.transaction rolls back and NO wallet
        // movement occurs (no orphan debit, no double payment).
        const flip = await applyInvoicePaymentTx(tx, { invoiceId: Number(inv.id), tenantId: inv.tenantId, amount });

        const [wallet] = await tx
          .select({ id: wallets.id })
          .from(wallets)
          .where(and(eq(wallets.userId, ctx.user.id), eq(wallets.currency, inv.currency), eq(wallets.status, "active")))
          .limit(1);
        if (!wallet) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `No active ${inv.currency} wallet — payment blocked` });
        }
        // Guarded debit: the balance guard is INSIDE the UPDATE; a concurrent
        // debit that drops the balance below `amount` affects 0 rows and aborts.
        const debitRows = (await tx.execute(sql`
          UPDATE wallets
          SET balance = balance - ${amount},
              "updatedAt" = NOW(),
              version = version + 1
          WHERE id = ${wallet.id}
            AND CAST(balance AS DECIMAL(18,4)) >= ${amount}
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (debitRows.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient wallet balance for this payment" });
        }

        // C1 credit leg (same tx): credit the invoice creator's wallet for the
        // EXACT amount debited — wallet payments carry no card fee, so the
        // payer pays `total` and the merchant receives `total`. Create the
        // wallet if missing (stripeWebhook.ts top-up pattern: guarded UPDATE
        // first, INSERT when no wallet row exists).
        // M1-residual: wallets has NO unique constraint on (userId, currency)
        // and schema changes to existing tables are forbidden — two concurrent
        // first-time credits to the same merchant (two different invoices)
        // would both see 0 UPDATE rows and both INSERT (duplicate wallets,
        // split funds). Serialize per-wallet-identity creators with a
        // transaction-scoped advisory lock BEFORE update/insert.
        // hashtextextended(text, bigint) is a built-in PG10+ function.
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(hashtextextended(${'wallet:' + String(inv.createdBy) + ':' + inv.currency}, 42))
        `);
        const creditRows = (await tx.execute(sql`
          UPDATE wallets
          SET balance = balance + ${amount},
              "updatedAt" = NOW(),
              version = version + 1
          WHERE "userId" = ${inv.createdBy}
            AND currency = ${inv.currency}
          RETURNING id
        `)) as unknown as Array<{ id: number }>;
        if (creditRows.length === 0) {
          await tx.insert(wallets).values({
            userId: inv.createdBy,
            currency: inv.currency,
            balance: amount.toFixed(4), // numeric(18,2) — stored at column scale, same as the UPDATE path
            isDefault: false,
          } as any);
        }

        // C1 audit trail (same tx): enum-valid transactions rows for both legs
        // (txTypeEnum: send/receive), completed, deterministic reference.
        await tx.insert(transactions).values([
          {
            userId: ctx.user.id,
            type: "send",
            status: "completed",
            fromCurrency: inv.currency,
            fromAmount: amount.toFixed(4),
            toCurrency: inv.currency,
            toAmount: amount.toFixed(4),
            fee: "0",
            reference,
            description: `Payment-link wallet payment for invoice ${inv.invoiceNumber}`,
            metadata: { invoiceId: Number(inv.id), invoiceNumber: inv.invoiceNumber, tenantId: inv.tenantId, leg: "payer_debit" },
          } as any,
          {
            userId: inv.createdBy,
            type: "receive",
            status: "completed",
            fromCurrency: inv.currency,
            fromAmount: amount.toFixed(4),
            toCurrency: inv.currency,
            toAmount: amount.toFixed(4),
            fee: "0",
            reference,
            description: `Payment-link wallet receipt for invoice ${inv.invoiceNumber}`,
            metadata: { invoiceId: Number(inv.id), invoiceNumber: inv.invoiceNumber, tenantId: inv.tenantId, leg: "merchant_credit" },
          } as any,
        ]);

        return flip;
      });

      // Best-effort ledger/event backing AFTER commit (warn-soft, mirroring
      // stripeWebhook.ts): the atomic Postgres tx above is the correctness
      // boundary (the TB bridge is fail-open in non-prod); these calls make
      // both wallet legs reconcilable in the ledger/event stream.
      await auditCoreOperation({
        userId: ctx.user.id,
        action: "wallet.paylink.debit",
        description: `Payment-link wallet debit for invoice ${inv.invoiceNumber}: ${amount.toFixed(4)} ${inv.currency}`,
        amount,
        currency: inv.currency,
        featureLabel: "payment_link_wallet_payment",
        operationRef: `${reference}:send`,
        kafkaTopic: KAFKA_TOPICS.TRANSACTIONS,
        metadata: { invoiceId: Number(inv.id), invoiceNumber: inv.invoiceNumber, leg: "payer_debit" },
      }).catch((err) =>
        logger.warn("[PaymentLinks] payer-leg ledger/event recording failed (non-critical):", (err as Error)?.message),
      );
      await auditCoreOperation({
        userId: inv.createdBy,
        action: "wallet.paylink.credit",
        description: `Payment-link wallet credit for invoice ${inv.invoiceNumber}: ${amount.toFixed(4)} ${inv.currency}`,
        amount,
        currency: inv.currency,
        featureLabel: "payment_link_wallet_payment",
        operationRef: `${reference}:receive`,
        kafkaTopic: KAFKA_TOPICS.TRANSACTIONS,
        metadata: { invoiceId: Number(inv.id), invoiceNumber: inv.invoiceNumber, leg: "merchant_credit" },
      }).catch((err) =>
        logger.warn("[PaymentLinks] merchant-leg ledger/event recording failed (non-critical):", (err as Error)?.message),
      );

      await emitPaymentSuccess(inv, result, "wallet");
      return {
        invoiceNumber: inv.invoiceNumber,
        status: result.status,
        amountPaid: result.amountPaid,
        total: result.total,
        currency: inv.currency,
        paidAt: result.status === "paid" ? new Date().toISOString() : null,
      };
    }),

  /**
   * PUBLIC: card payment — creates a cardFunding intent (Stripe PaymentIntent).
   * NO payment is executed here: execution happens only after Stripe capture
   * (cardFunding.confirmIntent / processFundingWebhook) + cardFunding.execute.
   */
  payCard: publicProcedure
    .input(z.object({ token: z.string().min(16).max(128) }))
    .mutation(async ({ input }) => {
      const inv = await resolveInvoiceByToken(input.token);
      assertPayable(inv);
      const amount = outstanding(inv);
      if (!(amount > 0)) {
        throw new TRPCError({ code: "CONFLICT", message: "Invoice is already fully paid" });
      }
      // Fee-shifting: card fee is added to the PAYER total and itemized.
      const fee = cardFeeFor(amount, inv.feeShifting);
      const intent = await createCardFundingIntent({
        tenantId: inv.tenantId,
        userId: inv.createdBy,
        purpose: "invoice",
        purposeEntityId: String(inv.id),
        amount,
        currency: inv.currency,
        feeAmount: fee,
      });
      return {
        invoiceNumber: inv.invoiceNumber,
        status: "requires_confirmation" as const,
        honest: "No payment has executed — funds move only after Stripe confirms the card charge.",
        amount: amount.toFixed(4),
        feeShifting: inv.feeShifting,
        cardFee: fee.toFixed(4),
        payerTotal: intent.totalCharge.toFixed(4),
        currency: inv.currency,
        intentId: intent.intentId,
        stripePaymentIntentId: intent.stripePaymentIntentId,
        clientSecret: intent.clientSecret,
      };
    }),

  /**
   * PUBLIC: bank rail — returns honest pending instructions from env config
   * (BANK_RAIL_INSTRUCTIONS_JSON). Fail closed when unconfigured; no fake refs.
   */
  payBank: publicProcedure
    .input(z.object({ token: z.string().min(16).max(128) }))
    .mutation(async ({ input }) => {
      const inv = await resolveInvoiceByToken(input.token);
      assertPayable(inv);
      const amount = outstanding(inv);
      if (!(amount > 0)) {
        throw new TRPCError({ code: "CONFLICT", message: "Invoice is already fully paid" });
      }
      const raw = process.env.BANK_RAIL_INSTRUCTIONS_JSON;
      if (!raw) {
        throw new TRPCError({
          code: "UNAVAILABLE",
          message: "Bank-rail payment is not configured for this merchant (BANK_RAIL_INSTRUCTIONS_JSON unset)",
        });
      }
      let instructions: Record<string, unknown>;
      try {
        instructions = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Bank-rail configuration is invalid" });
      }
      return {
        invoiceNumber: inv.invoiceNumber,
        status: "pending" as const,
        honest:
          "This invoice is NOT paid yet. It is marked paid only when the bank transfer is received and reconciled by the merchant. No payment reference is generated until then.",
        amount: amount.toFixed(4),
        currency: inv.currency,
        // The ONLY reference is the real invoice number the payer must quote.
        reference: inv.invoiceNumber,
        instructions,
      };
    }),
});
