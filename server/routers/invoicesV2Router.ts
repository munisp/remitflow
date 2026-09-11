/**
 * RemitFlow — Invoices V2 Router (W10 / SPEC-wave10 C2 — AR core)
 * ────────────────────────────────────────────────────────────────
 * Tenant-scoped CRUD on `invoices_v2` + `invoice_items` with:
 *   - totals computed SERVER-SIDE from line items (client totals ignored);
 *   - draft→sent lifecycle with single-use payment-link tokens
 *     (32-byte random; ONLY the sha256 hash is stored; raw token returned once);
 *   - recordPayment with guarded partial-payment accumulation inside
 *     db.transaction (status guard INSIDE the UPDATE, row-count checked);
 *   - void (non-paid only, revokes the payment link);
 *   - list with aging buckets (current / 0-30 / 31-60 / 61-90 / 90+) from dueDate;
 *   - Kafka `remitflow.invoices` lifecycle events.
 *
 * Shared helpers (`requireArDb`, `applyInvoicePaymentTx`, `recordInvoicePayment`,
 * `emitInvoiceEvent`) are exported for paymentLinks.ts / cardFunding.ts (W10-C2).
 */
import { createHash, randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { invoiceItems, invoicesV2 } from "../../drizzle/schema.js";
import { publishEvent } from "../middleware/kafka.js";
import { logger } from "../_core/logger.js";
import { ENV } from "../_core/env.js";
import { resolveTenantContext } from "../tenantMiddleware.js";
import { registerPurposeExecutor } from "./cardFunding.js";

export const INVOICES_TOPIC = "remitflow.invoices";

/** Statuses against which a payment may be recorded. */
export const PAYABLE_INVOICE_STATUSES = ["sent", "partially_paid", "overdue"] as const;

// ─── Decimal helpers (numeric(18,4) columns → quantize to 4dp) ───────────────
const DEC4 = 10_000;

export function toDec4(n: number): number {
  if (!Number.isFinite(n)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid monetary amount" });
  }
  return Math.round(n * DEC4) / DEC4;
}

function decStr(n: number): string {
  return toDec4(n).toFixed(4);
}

// ─── Shared infra ─────────────────────────────────────────────────────────────
export async function requireArDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  }
  return db;
}

/** Tenant scope is derived from the caller's SESSION, never from client input. */
async function resolveArTenantId(userId: number): Promise<number> {
  const session = await resolveTenantContext(userId);
  if (session.tenantId == null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No tenant membership — invoicing is unavailable for this account",
    });
  }
  return session.tenantId;
}

/** Canonical Wave-9/10 TOTP step-up — fail closed on lookup errors.
 * Mirrors paymentLinks.ts:162-173 / vendorBills.ts:133-148: when the caller
 * has TOTP enabled, a valid code is REQUIRED; when the 2FA store is
 * unavailable the action is blocked (never bypassed). */
async function totpStepUp(userId: number, totpCode: string | undefined, actionLabel: string): Promise<void> {
  const { getTotpEnrollment, verifyTOTP } = await import("../totp.js");
  const enrollment = await getTotpEnrollment(userId);
  if (!enrollment.dbAvailable) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `2FA verification unavailable — ${actionLabel} blocked` });
  }
  if (enrollment.enabled && enrollment.secret) {
    if (!totpCode) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "2FA code required for this action" });
    }
    const valid = await verifyTOTP(totpCode, enrollment.secret);
    if (!valid) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid 2FA code" });
    }
  }
}

/** Kafka emission is non-critical: warn-soft, never blocks the money path. */
export async function emitInvoiceEvent(
  eventType: string,
  inv: { id: number | string; tenantId: number; invoiceNumber: string; status: string; total: string | number; currency: string },
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    await publishEvent(INVOICES_TOPIC, `invoice:${inv.id}:${eventType}`, {
      eventType,
      invoiceId: Number(inv.id),
      tenantId: inv.tenantId,
      invoiceNumber: inv.invoiceNumber,
      status: inv.status,
      total: String(inv.total),
      currency: inv.currency,
      timestamp: new Date().toISOString(),
      ...extra,
    });
  } catch (err) {
    logger.warn("[InvoicesV2] Kafka emit failed (non-critical):", (err as Error)?.message);
  }
}

// ─── Totals (SERVER-SIDE — any client-supplied totals are ignored) ────────────
interface InvoiceItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

function computeTotals(items: InvoiceItemInput[], taxAmount: number) {
  const computed = items.map((it, i) => {
    const quantity = toDec4(it.quantity);
    const unitPrice = toDec4(it.unitPrice);
    if (!(quantity > 0)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Item ${i + 1}: quantity must be positive` });
    }
    if (unitPrice < 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Item ${i + 1}: unitPrice cannot be negative` });
    }
    return { ...it, quantity, unitPrice, amount: toDec4(quantity * unitPrice) };
  });
  const subtotal = toDec4(computed.reduce((acc, it) => acc + it.amount, 0));
  const tax = toDec4(taxAmount);
  if (tax < 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "taxAmount cannot be negative" });
  }
  return { items: computed, subtotal, taxAmount: tax, total: toDec4(subtotal + tax) };
}

// ─── Payment-link token helpers ───────────────────────────────────────────────
export function generatePaymentLinkToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashPaymentLinkToken(rawToken) };
}

export function hashPaymentLinkToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

// ─── Transactional email (Resend) — warn-soft, mirrors stripeWebhook.ts ──────
async function sendInvoiceEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const apiKey = ENV.resendApiKey;
  if (!apiKey) {
    logger.info("[InvoicesV2] Resend API key not configured — skipping invoice email");
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from: ENV.resendFromEmail, to: opts.to, subject: opts.subject, html: opts.html }),
    });
    if (!res.ok) {
      logger.warn(`[InvoicesV2] Resend error ${res.status}: ${await res.text().catch(() => "")}`);
    }
  } catch (err) {
    logger.warn("[InvoicesV2] Failed to send invoice email:", (err as Error)?.message);
  }
}

// ─── Guarded partial-payment accumulation (SPEC C2 core) ─────────────────────
type ArDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<ArDb["transaction"]>[0]>[0];

/**
 * Applies a payment to an invoice INSIDE an existing transaction.
 * The payable-status guard and the overpayment guard live INSIDE the UPDATE;
 * a concurrent void/payment race affects 0 rows and aborts (fail closed).
 * Caller is responsible for emitting Kafka events AFTER commit.
 */
export async function applyInvoicePaymentTx(
  tx: Tx,
  opts: { invoiceId: number; tenantId: number; amount: number },
): Promise<{ status: "partially_paid" | "paid"; amountPaid: string; total: string; currency: string; invoiceNumber: string }> {
  const amount = toDec4(opts.amount);
  if (!(amount > 0)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Payment amount must be positive" });
  }
  const rows = (await tx.execute(sql`
    UPDATE invoices_v2
    SET amount_paid = CAST(amount_paid AS DECIMAL(18,4)) + ${amount},
        updated_at = NOW()
    WHERE id = ${opts.invoiceId}
      AND tenant_id = ${opts.tenantId}
      AND status IN ('sent','partially_paid','overdue')
      AND CAST(amount_paid AS DECIMAL(18,4)) + ${amount} <= CAST(total AS DECIMAL(18,4)) + 0.0001
    RETURNING id, total, amount_paid, currency, invoice_number AS "invoiceNumber"
  `)) as unknown as Array<{ id: number | string; total: string; amount_paid: string; currency: string; invoiceNumber: string }>;

  if (rows.length === 0) {
    // Guard fired — distinguish the honest cause for the caller.
    const [inv] = await tx
      .select({ status: invoicesV2.status })
      .from(invoicesV2)
      .where(and(eq(invoicesV2.id, opts.invoiceId), eq(invoicesV2.tenantId, opts.tenantId)))
      .limit(1);
    if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
    if (!(PAYABLE_INVOICE_STATUSES as readonly string[]).includes(inv.status)) {
      throw new TRPCError({ code: "CONFLICT", message: `Invoice is ${inv.status} — cannot record a payment against it` });
    }
    throw new TRPCError({ code: "BAD_REQUEST", message: "Payment exceeds the remaining invoice balance" });
  }

  const row = rows[0];
  const paidNow = Number(row.amount_paid);
  const total = Number(row.total);
  const newStatus = paidNow + 0.0001 >= total ? "paid" : "partially_paid";
  // Auto-flip status (same tx); the same status guard prevents a lost-update race.
  await tx.execute(sql`
    UPDATE invoices_v2
    SET status = ${newStatus},
        paid_at = CASE WHEN ${newStatus} = 'paid' THEN NOW() ELSE paid_at END,
        updated_at = NOW()
    WHERE id = ${row.id}
      AND status IN ('sent','partially_paid','overdue')
  `);
  return {
    status: newStatus,
    amountPaid: String(row.amount_paid),
    total: String(row.total),
    currency: row.currency,
    invoiceNumber: row.invoiceNumber,
  };
}

/** Standalone guarded payment recording (own db.transaction) + Kafka events. */
export async function recordInvoicePayment(opts: {
  invoiceId: number;
  tenantId: number;
  amount: number;
  method: string;
  reference?: string;
}): Promise<{ status: "partially_paid" | "paid"; amountPaid: string; total: string; currency: string; invoiceNumber: string }> {
  const db = await requireArDb();
  const result = await db.transaction(async (tx) =>
    applyInvoicePaymentTx(tx, { invoiceId: opts.invoiceId, tenantId: opts.tenantId, amount: opts.amount }),
  );
  await emitInvoiceEvent(
    result.status === "paid" ? "invoice.paid" : "invoice.payment_recorded",
    {
      id: opts.invoiceId,
      tenantId: opts.tenantId,
      invoiceNumber: result.invoiceNumber,
      status: result.status,
      total: result.total,
      currency: result.currency,
    },
    { amountPaid: result.amountPaid, method: opts.method, reference: opts.reference ?? null },
  );
  return result;
}

// ─── Router ───────────────────────────────────────────────────────────────────
const itemSchema = z.object({
  description: z.string().min(1).max(512),
  quantity: z.number().positive().max(1_000_000_000),
  unitPrice: z.number().min(0).max(1_000_000_000_000),
});

export const invoicesV2Router = router({
  create: protectedProcedure
    .input(
      z.object({
        customerName: z.string().min(1).max(255),
        customerEmail: z.string().email().max(255).optional(),
        invoiceNumber: z.string().min(1).max(64).optional(),
        currency: z.string().length(3),
        dueDate: z.coerce.date().optional(),
        taxAmount: z.number().min(0).max(1_000_000_000_000).default(0),
        feeShifting: z.boolean().default(false),
        metadata: z.record(z.string(), z.unknown()).default({}),
        items: z.array(itemSchema).min(1).max(500),
        // NOTE: no client totals accepted — subtotal/total are computed server-side.
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireArDb();
      const tenantId = await resolveArTenantId(ctx.user.id);
      const totals = computeTotals(input.items, input.taxAmount);
      const invoiceNumber =
        input.invoiceNumber ??
        `INV-${tenantId}-${Date.now().toString(36).toUpperCase()}${randomBytes(2).toString("hex").toUpperCase()}`;
      const currency = input.currency.toUpperCase();

      try {
        const created = await db.transaction(async (tx) => {
          const [inv] = await tx
            .insert(invoicesV2)
            .values({
              tenantId,
              customerName: input.customerName,
              customerEmail: input.customerEmail ?? null,
              invoiceNumber,
              currency,
              subtotal: decStr(totals.subtotal),
              taxAmount: decStr(totals.taxAmount),
              total: decStr(totals.total),
              dueDate: input.dueDate ?? null,
              status: "draft",
              feeShifting: input.feeShifting,
              metadata: input.metadata,
              createdBy: ctx.user.id,
            })
            .returning();
          await tx.insert(invoiceItems).values(
            totals.items.map((it, i) => ({
              invoiceId: inv.id,
              description: it.description,
              quantity: decStr(it.quantity),
              unitPrice: decStr(it.unitPrice),
              amount: decStr(it.amount),
              sortOrder: i,
            })),
          );
          return inv;
        });
        await emitInvoiceEvent("invoice.created", created);
        return created;
      } catch (err) {
        if ((err as { code?: string })?.code === "23505") {
          throw new TRPCError({ code: "CONFLICT", message: `Invoice number '${invoiceNumber}' already exists for this tenant` });
        }
        throw err;
      }
    }),

  get: protectedProcedure
    .input(z.object({ invoiceId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = await requireArDb();
      const tenantId = await resolveArTenantId(ctx.user.id);
      const [inv] = await db
        .select()
        .from(invoicesV2)
        .where(and(eq(invoicesV2.id, input.invoiceId), eq(invoicesV2.tenantId, tenantId)))
        .limit(1);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      const items = await db
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, inv.id))
        .orderBy(invoiceItems.sortOrder);
      // Never leak the stored token hash to clients.
      const { paymentLinkTokenHash: _omit, ...safe } = inv;
      return { ...safe, items };
    }),

  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(["draft", "sent", "partially_paid", "paid", "overdue", "void"]).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }).optional(),
    )
    .query(async ({ input, ctx }) => {
      const db = await requireArDb();
      const tenantId = await resolveArTenantId(ctx.user.id);
      const conds = [eq(invoicesV2.tenantId, tenantId)];
      if (input?.status) conds.push(eq(invoicesV2.status, input.status));
      const rows = await db
        .select()
        .from(invoicesV2)
        .where(and(...conds))
        .orderBy(desc(invoicesV2.createdAt))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);

      // Aging buckets computed from dueDate over OPEN invoices.
      const now = Date.now();
      const aging = {
        current: { count: 0, amount: 0 },
        "0-30": { count: 0, amount: 0 },
        "31-60": { count: 0, amount: 0 },
        "61-90": { count: 0, amount: 0 },
        "90+": { count: 0, amount: 0 },
      } as Record<string, { count: number; amount: number }>;
      const DAY = 86_400_000;
      const items = rows.map((inv) => {
        const { paymentLinkTokenHash: _omit, ...safe } = inv;
        let bucket: string | null = null;
        if ((PAYABLE_INVOICE_STATUSES as readonly string[]).includes(inv.status)) {
          const outstanding = toDec4(Number(inv.total) - Number(inv.amountPaid));
          if (!inv.dueDate || inv.dueDate.getTime() >= now) {
            bucket = "current";
          } else {
            const days = Math.floor((now - inv.dueDate.getTime()) / DAY);
            bucket = days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
          }
          aging[bucket].count += 1;
          aging[bucket].amount = toDec4(aging[bucket].amount + outstanding);
        }
        return { ...safe, agingBucket: bucket };
      });
      return { items, aging };
    }),

  update: protectedProcedure
    .input(
      z.object({
        invoiceId: z.number().int().positive(),
        customerName: z.string().min(1).max(255).optional(),
        customerEmail: z.string().email().max(255).nullable().optional(),
        currency: z.string().length(3).optional(),
        dueDate: z.coerce.date().nullable().optional(),
        taxAmount: z.number().min(0).max(1_000_000_000_000).optional(),
        feeShifting: z.boolean().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        items: z.array(itemSchema).min(1).max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireArDb();
      const tenantId = await resolveArTenantId(ctx.user.id);
      const updated = await db.transaction(async (tx) => {
        const [inv] = await tx
          .select()
          .from(invoicesV2)
          .where(and(eq(invoicesV2.id, input.invoiceId), eq(invoicesV2.tenantId, tenantId)))
          .limit(1);
        if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
        if (inv.status !== "draft") {
          throw new TRPCError({ code: "CONFLICT", message: `Only draft invoices can be edited (status: ${inv.status})` });
        }
        const totals = input.items
          ? computeTotals(input.items, input.taxAmount ?? Number(inv.taxAmount))
          : null;
        const set: Partial<typeof invoicesV2.$inferInsert> = { updatedAt: new Date() };
        if (input.customerName !== undefined) set.customerName = input.customerName;
        if (input.customerEmail !== undefined) set.customerEmail = input.customerEmail;
        if (input.currency !== undefined) set.currency = input.currency.toUpperCase();
        if (input.dueDate !== undefined) set.dueDate = input.dueDate;
        if (input.feeShifting !== undefined) set.feeShifting = input.feeShifting;
        if (input.metadata !== undefined) set.metadata = input.metadata;
        if (totals) {
          set.subtotal = decStr(totals.subtotal);
          set.taxAmount = decStr(totals.taxAmount);
          set.total = decStr(totals.total);
        } else if (input.taxAmount !== undefined) {
          const tax = toDec4(input.taxAmount);
          set.taxAmount = decStr(tax);
          set.total = decStr(toDec4(Number(inv.subtotal) + tax));
        }
        // Guarded: re-check status='draft' inside the UPDATE (concurrent send race).
        const rows = await tx
          .update(invoicesV2)
          .set(set)
          .where(
            and(
              eq(invoicesV2.id, input.invoiceId),
              eq(invoicesV2.tenantId, tenantId),
              eq(invoicesV2.status, "draft"),
            ),
          )
          .returning({ id: invoicesV2.id });
        if (rows.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Invoice is no longer a draft — edit aborted" });
        }
        if (totals) {
          await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, input.invoiceId));
          await tx.insert(invoiceItems).values(
            totals.items.map((it, i) => ({
              invoiceId: input.invoiceId,
              description: it.description,
              quantity: decStr(it.quantity),
              unitPrice: decStr(it.unitPrice),
              amount: decStr(it.amount),
              sortOrder: i,
            })),
          );
        }
        const [fresh] = await tx.select().from(invoicesV2).where(eq(invoicesV2.id, input.invoiceId)).limit(1);
        return fresh;
      });
      await emitInvoiceEvent("invoice.updated", updated);
      const { paymentLinkTokenHash: _omit, ...safe } = updated;
      return safe;
    }),

  send: protectedProcedure
    .input(z.object({ invoiceId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireArDb();
      const tenantId = await resolveArTenantId(ctx.user.id);
      const [inv] = await db
        .select()
        .from(invoicesV2)
        .where(and(eq(invoicesV2.id, input.invoiceId), eq(invoicesV2.tenantId, tenantId)))
        .limit(1);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
      if (inv.status !== "draft") {
        throw new TRPCError({ code: "CONFLICT", message: `Only draft invoices can be sent (status: ${inv.status})` });
      }

      const { rawToken, tokenHash } = generatePaymentLinkToken();
      // Guarded draft→sent: a concurrent send/void affects 0 rows and aborts.
      const rows = (await db.execute(sql`
        UPDATE invoices_v2
        SET status = 'sent', sent_at = NOW(), payment_link_token_hash = ${tokenHash}, updated_at = NOW()
        WHERE id = ${inv.id} AND tenant_id = ${tenantId} AND status = 'draft'
        RETURNING id
      `)) as unknown as Array<{ id: number }>;
      if (rows.length === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Invoice is no longer a draft — send aborted" });
      }

      const paymentUrl = `${ENV.appUrl}/pl/${rawToken}`;
      if (inv.customerEmail) {
        await sendInvoiceEmail({
          to: inv.customerEmail,
          subject: `Invoice ${inv.invoiceNumber} — ${inv.total} ${inv.currency}`,
          html: `<p>You have received invoice <strong>${inv.invoiceNumber}</strong> for <strong>${inv.total} ${inv.currency}</strong>.</p><p>Pay securely here: <a href="${paymentUrl}">${paymentUrl}</a></p>`,
        });
      }
      await emitInvoiceEvent("invoice.sent", inv);
      // Raw token returned ONCE — only the sha256 hash is persisted.
      return { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, status: "sent" as const, paymentToken: rawToken, paymentUrl };
    }),

  recordPayment: protectedProcedure
    .input(
      z.object({
        invoiceId: z.number().int().positive(),
        amount: z.number().positive().max(1_000_000_000_000),
        method: z.enum(["wallet", "card", "bank", "cash", "other"]).default("other"),
        reference: z.string().max(255).optional(),
        // M11: optional TOTP step-up — REQUIRED when the caller has TOTP enabled.
        totpCode: z.string().regex(/^\d{6}$/).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = await resolveArTenantId(ctx.user.id);
      // M11: recording a payment flips financial state (amount_paid/status) —
      // force the canonical TOTP step-up for TOTP-enrolled callers.
      await totpStepUp(ctx.user.id, input.totpCode, "payment recording");
      return recordInvoicePayment({
        invoiceId: input.invoiceId,
        tenantId,
        amount: input.amount,
        method: input.method,
        reference: input.reference,
      });
    }),

  void: protectedProcedure
    .input(
      z.object({
        invoiceId: z.number().int().positive(),
        // M11: optional TOTP step-up — REQUIRED when the caller has TOTP enabled.
        totpCode: z.string().regex(/^\d{6}$/).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireArDb();
      const tenantId = await resolveArTenantId(ctx.user.id);
      // M11: voiding flips financial state (kills payability, revokes the
      // payment link) — force the canonical TOTP step-up for TOTP-enrolled callers.
      await totpStepUp(ctx.user.id, input.totpCode, "invoice void");
      // Non-paid only; voiding also revokes the payment link (hash cleared).
      const rows = (await db.execute(sql`
        UPDATE invoices_v2
        SET status = 'void', payment_link_token_hash = NULL, updated_at = NOW()
        WHERE id = ${input.invoiceId}
          AND tenant_id = ${tenantId}
          AND status NOT IN ('paid','void')
        RETURNING id, invoice_number AS "invoiceNumber", total, currency
      `)) as unknown as Array<{ id: number; invoiceNumber: string; total: string; currency: string }>;
      if (rows.length === 0) {
        const [inv] = await db
          .select({ status: invoicesV2.status })
          .from(invoicesV2)
          .where(and(eq(invoicesV2.id, input.invoiceId), eq(invoicesV2.tenantId, tenantId)))
          .limit(1);
        if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
        throw new TRPCError({ code: "CONFLICT", message: `Invoice is ${inv.status} — only non-paid invoices can be voided` });
      }
      await emitInvoiceEvent("invoice.voided", {
        id: rows[0].id,
        tenantId,
        invoiceNumber: rows[0].invoiceNumber,
        status: "void",
        total: rows[0].total,
        currency: rows[0].currency,
      });
      return { invoiceId: Number(rows[0].id), status: "void" as const };
    }),
});

// ─── W10-C2: plug the invoice purpose executor into cardFunding.execute ───────
// Registered here (owning module) so cardFunding.ts never imports this file —
// no circular dependency; C1's vendor-bill engine registers its own executor.
registerPurposeExecutor("invoice", {
  // Card→invoice posting is wallet-internal bookkeeping (reversible via a
  // correcting entry), so the chargeback hold is skipped per SPEC C2.
  irreversible: false,
  async execute(intent) {
    const db = await requireArDb();
    const invoiceId = Number(intent.purposeEntityId);
    const amount = toDec4(Number(intent.amount));
    // W10-FIX3-A (C-R3-2): per-intent payment attribution, merged into
    // invoices_v2.metadata INSIDE THE SAME db.transaction as the guarded
    // payment flip — if the flip loses the race (invoice already paid), the
    // attribution write rolls back with it. Written HERE in the executor
    // wrapper (never inside the shared applyInvoicePaymentTx) so wallet and
    // manual payments never carry card attribution.
    // W10-FIX4-A (H-R4-1): KEYED, non-destructive attribution shape —
    //   metadata.cardFunding.intents["<intentId>"] = { stripePaymentIntentId, appliedAt }
    // A top-level `|| '{"cardFunding":{...}}'` merge REPLACES the whole
    // cardFunding key, so a second intent's landing clobbered the first
    // intent's attribution (sweeper → wrongful refund of a standing payment).
    // Keyed by intent ID, any number of sibling intents coexist.
    const result = await db.transaction(async (tx) => {
      const flip = await applyInvoicePaymentTx(tx, { invoiceId, tenantId: intent.tenantId, amount });
      // The guarded flip UPDATE above holds the invoices_v2 row lock for the
      // rest of THIS transaction, so an in-tx read-modify-write of metadata
      // is race-safe (no concurrent writer can interleave).
      const [current] = await tx
        .select({ metadata: invoicesV2.metadata })
        .from(invoicesV2)
        .where(and(eq(invoicesV2.id, invoiceId), eq(invoicesV2.tenantId, intent.tenantId)))
        .limit(1);
      const metadata = ((current?.metadata ?? {}) ?? {}) as Record<string, unknown>;
      const cardFunding = ((metadata.cardFunding ?? {}) ?? {}) as Record<string, unknown>;
      const intents = ((cardFunding.intents ?? {}) ?? {}) as Record<string, unknown>;
      intents[String(Number(intent.id))] = {
        stripePaymentIntentId: intent.stripePaymentIntentId,
        appliedAt: new Date().toISOString(),
      };
      // Non-destructive deep merge: preserves every other metadata key, any
      // legacy cardFunding.intentId/stripePaymentIntentId/appliedAt fields,
      // and all pre-existing cardFunding.intents.* entries.
      const merged = {
        ...metadata,
        cardFunding: {
          ...cardFunding,
          intents,
        },
      };
      await tx
        .update(invoicesV2)
        .set({ metadata: merged as any, updatedAt: new Date() })
        .where(and(eq(invoicesV2.id, invoiceId), eq(invoicesV2.tenantId, intent.tenantId)));
      return flip;
    });
    // Kafka event AFTER commit (mirrors recordInvoicePayment).
    await emitInvoiceEvent(
      result.status === "paid" ? "invoice.paid" : "invoice.payment_recorded",
      {
        id: invoiceId,
        tenantId: intent.tenantId,
        invoiceNumber: result.invoiceNumber,
        status: result.status,
        total: result.total,
        currency: result.currency,
      },
      { amountPaid: result.amountPaid, method: "card", reference: intent.stripePaymentIntentId },
    );
    return { executed: true, detail: { invoiceStatus: result.status, amountPaid: result.amountPaid } };
  },
});
