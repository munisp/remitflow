/**
 * RemitFlow — Failure Protection Router (TypeScript)
 *
 * "What If Things Go Wrong?" protections for all money-moving features:
 *   1. BNPL overdue + late fees + collection + merchant disputes
 *   2. Agent network float audit + customer cash disputes
 *   3. Cross-border transfer stuck escalation + auto-refund
 *   4. Global payroll partial failure + retry
 *   5. Real estate investor protection + developer default
 *   6. Diaspora bond issuer default + missed coupon
 *   7. Mortgage default detection + foreclosure
 *   8. Split bill deadline enforcement + auto-resolution
 *   9. Virtual card chargeback + unauthorized transaction disputes
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb, createAuditLog } from "../db";
import { eq, and, lt, sql, desc, inArray } from "drizzle-orm";
import {
  wallets, transactions, users, notifications,
} from "../../drizzle/schema";
import { logger } from "../_core/logger.js";
import { randomBytes } from "crypto";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

async function notify(db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>, userId: number, type: string, message: string) {
  try {
    await db.execute(sql`
      INSERT INTO notifications ("userId", type, message, "createdAt")
      VALUES (${userId}, ${type}, ${message}, NOW())
    `);
  } catch (e) {
    logger.warn({ userId, type }, "[FailureProtection] Notification insert failed (non-fatal)");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. BNPL FAILURE PROTECTION
// ═══════════════════════════════════════════════════════════════════════════════

export const bnplProtectionRouter = router({
  // Mark installments as overdue (called by scheduler or admin)
  markOverdue: adminProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    const result = await db.execute(sql`
      UPDATE bnpl_installments
      SET status = 'overdue', updated_at = NOW()
      WHERE status = 'pending'
        AND due_date < NOW()
      RETURNING id, plan_id, user_id, amount_ngn
    `);
    const overdue = result.rows as Array<{ id: number; plan_id: number; user_id: number; amount_ngn: number }>;

    // Apply late fees (2% per overdue period)
    for (const inst of overdue) {
      const lateFee = Number(inst.amount_ngn) * 0.02;
      await db.execute(sql`
        INSERT INTO bnpl_late_fees (installment_id, plan_id, user_id, fee_amount_ngn, reason, created_at)
        VALUES (${inst.id}, ${inst.plan_id}, ${inst.user_id}, ${lateFee}, 'overdue_penalty', NOW())
        ON CONFLICT DO NOTHING
      `);
      await notify(db, inst.user_id, "bnpl_overdue",
        `Your BNPL installment of ₦${Number(inst.amount_ngn).toLocaleString()} is overdue. A late fee of ₦${lateFee.toLocaleString()} has been applied. Please pay immediately to avoid collection escalation.`);
    }

    await createAuditLog({ userId: ctx.user.id, action: "BNPL_OVERDUE_SCAN", metadata: { count: overdue.length } });
    return { overdueCount: overdue.length, lateFeesApplied: overdue.length };
  }),

  // Escalate to collections (7+ days overdue)
  escalateToCollections: adminProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    const result = await db.execute(sql`
      SELECT bi.id, bi.plan_id, bi.user_id, bi.amount_ngn, bp.total_amount_ngn,
             EXTRACT(DAY FROM (NOW() - bi.due_date)) as days_overdue
      FROM bnpl_installments bi
      JOIN bnpl_plans bp ON bp.id = bi.plan_id
      WHERE bi.status = 'overdue'
        AND bi.due_date < NOW() - INTERVAL '7 days'
        AND NOT EXISTS (SELECT 1 FROM bnpl_collections WHERE installment_id = bi.id)
    `);
    const escalated = result.rows as Array<{ id: number; plan_id: number; user_id: number; days_overdue: number }>;

    for (const inst of escalated) {
      await db.execute(sql`
        INSERT INTO bnpl_collections (installment_id, plan_id, user_id, status, escalation_level, created_at)
        VALUES (${inst.id}, ${inst.plan_id}, ${inst.user_id}, 'active', 
          CASE WHEN ${inst.days_overdue} > 30 THEN 'legal' WHEN ${inst.days_overdue} > 14 THEN 'agency' ELSE 'internal' END,
          NOW())
      `);
      await notify(db, inst.user_id, "bnpl_collection",
        `URGENT: Your BNPL payment is ${inst.days_overdue} days overdue. This has been escalated to our collections team. Continued non-payment may affect your credit score and future borrowing ability.`);
    }

    return { escalatedCount: escalated.length };
  }),

  // Raise merchant dispute (goods not delivered)
  raiseMerchantDispute: protectedProcedure
    .input(z.object({
      planId: z.number(),
      disputeType: z.enum(["goods_not_received", "defective_goods", "wrong_item", "service_not_provided"]),
      description: z.string().min(10).max(2000),
      evidenceUrls: z.array(z.string().url()).max(5).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Verify plan belongs to user
      const planRows = await db.execute(sql`
        SELECT id, user_id, merchant_name, total_amount_ngn, status FROM bnpl_plans WHERE id = ${input.planId} AND user_id = ${ctx.user.id}
      `);
      const plan = (planRows.rows as Array<{ id: number; user_id: number; merchant_name: string; status: string }>)[0];
      if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "BNPL plan not found" });

      const disputeId = genId("BNPL-DSP");
      await db.execute(sql`
        INSERT INTO bnpl_merchant_disputes (dispute_id, plan_id, user_id, dispute_type, description, evidence_urls, status, created_at)
        VALUES (${disputeId}, ${input.planId}, ${ctx.user.id}, ${input.disputeType}, ${input.description}, ${JSON.stringify(input.evidenceUrls ?? [])}::jsonb, 'open', NOW())
      `);

      // Freeze installment payments during dispute
      await db.execute(sql`
        UPDATE bnpl_installments SET status = 'frozen' WHERE plan_id = ${input.planId} AND status IN ('pending', 'overdue')
      `);

      await createAuditLog({ userId: ctx.user.id, action: "BNPL_MERCHANT_DISPUTE_RAISED", metadata: { disputeId, planId: input.planId, type: input.disputeType } });
      return { disputeId, status: "open", installmentsFrozen: true, message: "Dispute raised. Installment payments paused during investigation." };
    }),

  // Admin resolve merchant dispute
  resolveMerchantDispute: adminProcedure
    .input(z.object({
      disputeId: z.string(),
      resolution: z.enum(["refund_buyer", "resume_payments", "partial_refund", "cancel_plan"]),
      refundAmountNgn: z.number().positive().max(10_000_000).optional(),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const disputeRows = await db.execute(sql`
        SELECT * FROM bnpl_merchant_disputes WHERE dispute_id = ${input.disputeId}
      `);
      const dispute = (disputeRows.rows as Array<{ plan_id: number; user_id: number }>)[0];
      if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      if (input.resolution === "refund_buyer" || input.resolution === "partial_refund") {
        // Refund amount = total paid so far (or partial)
        const paidRows = await db.execute(sql`
          SELECT COALESCE(SUM(amount_ngn), 0) as total_paid FROM bnpl_installments WHERE plan_id = ${dispute.plan_id} AND status = 'paid'
        `);
        const totalPaid = Number((paidRows.rows[0] as { total_paid: number }).total_paid);
        const refundAmount = input.refundAmountNgn ?? totalPaid;

        if (refundAmount > 0) {
          await db.execute(sql`
            UPDATE wallets SET balance = CAST(CAST(balance AS DECIMAL(18,4)) + ${refundAmount} AS VARCHAR), "updatedAt" = NOW()
            WHERE "userId" = ${dispute.user_id} AND currency = 'NGN'
          `);
        }
        await db.execute(sql`UPDATE bnpl_plans SET status = 'cancelled' WHERE id = ${dispute.plan_id}`);
        await notify(db, dispute.user_id, "bnpl_dispute_resolved",
          `Your BNPL dispute has been resolved in your favor. ₦${refundAmount.toLocaleString()} has been refunded to your wallet.`);
      } else if (input.resolution === "resume_payments") {
        await db.execute(sql`
          UPDATE bnpl_installments SET status = 'pending' WHERE plan_id = ${dispute.plan_id} AND status = 'frozen'
        `);
        await notify(db, dispute.user_id, "bnpl_dispute_resolved",
          "Your BNPL merchant dispute has been reviewed. Payments have been resumed as the merchant has fulfilled their obligations.");
      } else if (input.resolution === "cancel_plan") {
        await db.execute(sql`UPDATE bnpl_plans SET status = 'cancelled' WHERE id = ${dispute.plan_id}`);
        await db.execute(sql`UPDATE bnpl_installments SET status = 'cancelled' WHERE plan_id = ${dispute.plan_id} AND status IN ('pending', 'frozen')`);
      }

      await db.execute(sql`
        UPDATE bnpl_merchant_disputes SET status = 'resolved', resolution = ${input.resolution}, resolved_at = NOW(), admin_notes = ${input.notes ?? ''}
        WHERE dispute_id = ${input.disputeId}
      `);

      return { disputeId: input.disputeId, resolution: input.resolution };
    }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. AGENT NETWORK FAILURE PROTECTION
// ═══════════════════════════════════════════════════════════════════════════════

export const agentProtectionRouter = router({
  // Float reconciliation audit
  auditFloat: adminProcedure
    .input(z.object({ agentId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const query = input.agentId
        ? sql`
          SELECT aa.id, aa.user_id, aa.float_balance,
            (SELECT COALESCE(SUM(CASE WHEN type = 'cash_in' THEN amount ELSE -amount END), 0)
             FROM pos_transactions WHERE agent_id = aa.id AND created_at > aa.last_reconciled_at) as computed_delta,
            aa.float_balance - aa.opening_balance + 
            (SELECT COALESCE(SUM(CASE WHEN type = 'cash_out' THEN amount ELSE 0 END), 0) - 
                    COALESCE(SUM(CASE WHEN type = 'cash_in' THEN amount ELSE 0 END), 0)
             FROM pos_transactions WHERE agent_id = aa.id AND created_at > aa.last_reconciled_at) as discrepancy
          FROM agent_accounts aa WHERE aa.id = ${input.agentId}
        `
        : sql`
          SELECT aa.id, aa.user_id, aa.float_balance,
            aa.float_balance - aa.opening_balance as net_change
          FROM agent_accounts aa WHERE aa.status = 'active'
          ORDER BY aa.id
        `;
      const results = await db.execute(query);
      const discrepancies = (results.rows as Array<{ id: number; user_id: number; discrepancy?: number }>)
        .filter(r => r.discrepancy && Math.abs(Number(r.discrepancy)) > 100);

      for (const d of discrepancies) {
        await db.execute(sql`
          INSERT INTO agent_float_discrepancies (agent_id, discrepancy_amount, detected_at, status)
          VALUES (${d.id}, ${d.discrepancy}, NOW(), 'flagged')
          ON CONFLICT DO NOTHING
        `);
        await notify(db, d.user_id, "float_discrepancy",
          `ALERT: A float discrepancy of ₦${Math.abs(Number(d.discrepancy)).toLocaleString()} has been detected in your agent account. This is under investigation.`);
      }

      await createAuditLog({ userId: ctx.user.id, action: "AGENT_FLOAT_AUDIT", metadata: { discrepancies: discrepancies.length } });
      return { audited: results.rows.length, discrepanciesFound: discrepancies.length };
    }),

  // Customer raises dispute for cash transaction
  raiseCustomerDispute: protectedProcedure
    .input(z.object({
      transactionRef: z.string().min(5),
      disputeType: z.enum(["wrong_amount", "no_cash_received", "overcharged", "agent_fraud"]),
      expectedAmount: z.number().positive().max(10_000_000),
      receivedAmount: z.number().min(0),
      description: z.string().min(10).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Verify the transaction exists and belongs to user
      const txRows = await db.execute(sql`
        SELECT id, "userId", amount, type, status FROM transactions WHERE reference = ${input.transactionRef} AND "userId" = ${ctx.user.id}
      `);
      const tx = (txRows.rows as Array<{ id: number; userId: number; amount: string }>)[0];
      if (!tx) throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });

      const disputeId = genId("AGENT-DSP");
      await db.execute(sql`
        INSERT INTO agent_customer_disputes (dispute_id, transaction_ref, customer_id, dispute_type, expected_amount, received_amount, description, status, created_at)
        VALUES (${disputeId}, ${input.transactionRef}, ${ctx.user.id}, ${input.disputeType}, ${input.expectedAmount}, ${input.receivedAmount}, ${input.description}, 'open', NOW())
      `);

      // If fraud allegation, immediately freeze agent
      if (input.disputeType === "agent_fraud") {
        await db.execute(sql`
          UPDATE agent_accounts SET status = 'frozen', freeze_reason = 'fraud_investigation'
          WHERE id = (SELECT agent_id FROM pos_transactions WHERE reference = ${input.transactionRef} LIMIT 1)
        `);
      }

      await createAuditLog({ userId: ctx.user.id, action: "AGENT_CUSTOMER_DISPUTE", metadata: { disputeId, type: input.disputeType } });
      return { disputeId, status: "open", agentFrozen: input.disputeType === "agent_fraud" };
    }),

  // Admin resolve agent dispute
  resolveAgentDispute: adminProcedure
    .input(z.object({
      disputeId: z.string(),
      resolution: z.enum(["refund_customer", "dismiss", "suspend_agent", "terminate_agent"]),
      refundAmount: z.number().positive().max(10_000_000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const rows = await db.execute(sql`SELECT * FROM agent_customer_disputes WHERE dispute_id = ${input.disputeId}`);
      const dispute = (rows.rows as Array<{ customer_id: number; expected_amount: number; transaction_ref: string }>)[0];
      if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      if (input.resolution === "refund_customer") {
        const amount = input.refundAmount ?? dispute.expected_amount;
        await db.execute(sql`
          UPDATE wallets SET balance = CAST(CAST(balance AS DECIMAL(18,4)) + ${amount} AS VARCHAR), "updatedAt" = NOW()
          WHERE "userId" = ${dispute.customer_id} AND currency = 'NGN'
        `);
        await notify(db, dispute.customer_id, "agent_dispute_resolved",
          `Your agent cash dispute has been resolved. ₦${amount.toLocaleString()} has been refunded to your wallet.`);
      }

      if (input.resolution === "suspend_agent" || input.resolution === "terminate_agent") {
        const newStatus = input.resolution === "terminate_agent" ? "terminated" : "suspended";
        await db.execute(sql`
          UPDATE agent_accounts SET status = ${newStatus}
          WHERE id = (SELECT agent_id FROM pos_transactions WHERE reference = ${dispute.transaction_ref} LIMIT 1)
        `);
      }

      await db.execute(sql`
        UPDATE agent_customer_disputes SET status = 'resolved', resolution = ${input.resolution}, resolved_at = NOW()
        WHERE dispute_id = ${input.disputeId}
      `);
      return { disputeId: input.disputeId, resolution: input.resolution };
    }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. CROSS-BORDER TRANSFER STUCK ESCALATION
// ═══════════════════════════════════════════════════════════════════════════════

export const transferProtectionRouter = router({
  // Detect stuck transfers (no status update for >48h)
  detectStuck: adminProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    const result = await db.execute(sql`
      UPDATE transactions
      SET status = 'stuck', "updatedAt" = NOW()
      WHERE status = 'processing'
        AND "updatedAt" < NOW() - INTERVAL '48 hours'
      RETURNING id, "userId", amount, from_currency, to_currency, reference
    `);
    const stuck = result.rows as Array<{ id: number; userId: number; amount: string; reference: string }>;

    for (const tx of stuck) {
      await notify(db, tx.userId, "transfer_stuck",
        `Your transfer of ${tx.amount} (ref: ${tx.reference}) appears to be stuck. Our team is investigating. If not resolved within 5 business days, you will receive an automatic refund.`);
    }

    await createAuditLog({ userId: ctx.user.id, action: "STUCK_TRANSFER_SCAN", metadata: { count: stuck.length } });
    return { stuckCount: stuck.length };
  }),

  // Auto-refund stuck transfers after SLA (5 business days = 7 calendar days)
  autoRefundStuck: adminProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    const result = await db.execute(sql`
      SELECT id, "userId", amount, from_currency, reference
      FROM transactions
      WHERE status = 'stuck'
        AND "updatedAt" < NOW() - INTERVAL '7 days'
    `);
    const toRefund = result.rows as Array<{ id: number; userId: number; amount: string; from_currency: string; reference: string }>;
    let refunded = 0;

    for (const tx of toRefund) {
      const amount = Number(tx.amount);
      if (amount <= 0) continue;

      await db.execute(sql`
        UPDATE wallets SET balance = CAST(CAST(balance AS DECIMAL(18,4)) + ${amount} AS VARCHAR), "updatedAt" = NOW()
        WHERE "userId" = ${tx.userId} AND currency = ${tx.from_currency}
      `);
      await db.execute(sql`
        UPDATE transactions SET status = 'refunded', "updatedAt" = NOW() WHERE id = ${tx.id}
      `);
      await db.execute(sql`
        INSERT INTO transactions ("userId", type, status, amount, from_currency, to_currency, description, reference, "createdAt", "updatedAt")
        VALUES (${tx.userId}, 'refund', 'completed', ${tx.amount}, ${tx.from_currency}, ${tx.from_currency},
          ${'Auto-refund: transfer stuck beyond SLA (ref: ' + tx.reference + ')'},
          ${'AUTOREFUND-' + tx.reference}, NOW(), NOW())
      `);
      await notify(db, tx.userId, "auto_refund",
        `Your stuck transfer (ref: ${tx.reference}) has been automatically refunded. ${tx.amount} ${tx.from_currency} has been returned to your wallet.`);
      refunded++;
    }

    await createAuditLog({ userId: ctx.user.id, action: "STUCK_TRANSFER_AUTO_REFUND", metadata: { refunded } });
    return { refunded };
  }),

  // Manual escalation by user
  escalateTransfer: protectedProcedure
    .input(z.object({
      transactionId: z.number(),
      reason: z.enum(["delayed", "wrong_recipient", "wrong_amount", "not_received"]),
      description: z.string().min(10).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const txRows = await db.execute(sql`
        SELECT id, status, amount, from_currency, reference FROM transactions WHERE id = ${input.transactionId} AND "userId" = ${ctx.user.id}
      `);
      const tx = (txRows.rows as Array<{ id: number; status: string; reference: string }>)[0];
      if (!tx) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      if (tx.status === "completed" && input.reason !== "wrong_recipient" && input.reason !== "wrong_amount") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Completed transfers can only be escalated for wrong recipient or wrong amount" });
      }

      const escalationId = genId("ESC");
      await db.execute(sql`
        INSERT INTO transfer_escalations (escalation_id, transaction_id, user_id, reason, description, status, sla_deadline, created_at)
        VALUES (${escalationId}, ${input.transactionId}, ${ctx.user.id}, ${input.reason}, ${input.description}, 'open',
          NOW() + INTERVAL '5 days', NOW())
      `);

      return { escalationId, slaDeadline: "5 business days", message: "Your transfer has been escalated. If unresolved by the SLA deadline, an automatic refund will be processed." };
    }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. GLOBAL PAYROLL FAILURE PROTECTION
// ═══════════════════════════════════════════════════════════════════════════════

export const payrollProtectionRouter = router({
  // Retry individual failed payments in a payroll run
  retryFailedPayments: protectedProcedure
    .input(z.object({ runId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const failedRows = await db.execute(sql`
        SELECT pri.id, pri.employee_name, pri.net_amount_usd, pri.currency, pri.bank_account, pri.status, pri.failure_reason
        FROM payroll_run_items pri
        JOIN payroll_runs pr ON pr.id = pri.run_id
        WHERE pri.run_id = ${input.runId} AND pri.status = 'failed'
          AND pr.company_id IN (SELECT id FROM payroll_companies WHERE owner_id = ${ctx.user.id})
      `);
      const failed = failedRows.rows as Array<{ id: number; employee_name: string; net_amount_usd: number; status: string }>;
      if (failed.length === 0) return { retried: 0, message: "No failed payments to retry" };

      let retried = 0;
      for (const payment of failed) {
        await db.execute(sql`
          UPDATE payroll_run_items SET status = 'pending', failure_reason = NULL, retry_count = COALESCE(retry_count, 0) + 1, updated_at = NOW()
          WHERE id = ${payment.id} AND status = 'failed'
        `);
        retried++;
      }

      await createAuditLog({ userId: ctx.user.id, action: "PAYROLL_RETRY_FAILED", metadata: { runId: input.runId, retried } });
      return { retried, message: `${retried} failed payments queued for retry` };
    }),

  // Employee disputes payroll amount
  employeeDispute: protectedProcedure
    .input(z.object({
      runItemId: z.number(),
      disputeType: z.enum(["wrong_amount", "not_received", "wrong_currency", "unauthorized_deduction"]),
      expectedAmount: z.number().positive().max(10_000_000),
      receivedAmount: z.number().min(0),
      description: z.string().min(10).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const disputeId = genId("PAY-DSP");
      await db.execute(sql`
        INSERT INTO payroll_disputes (dispute_id, run_item_id, employee_user_id, dispute_type, expected_amount, received_amount, description, status, created_at)
        VALUES (${disputeId}, ${input.runItemId}, ${ctx.user.id}, ${input.disputeType}, ${input.expectedAmount}, ${input.receivedAmount}, ${input.description}, 'open', NOW())
      `);
      return { disputeId, status: "open", sla: "3 business days" };
    }),

  // Resolve payroll dispute (admin/employer)
  resolvePayrollDispute: adminProcedure
    .input(z.object({
      disputeId: z.string(),
      resolution: z.enum(["pay_difference", "full_repay", "dismiss", "adjust_next_run"]),
      adjustmentAmount: z.number().positive().max(10_000_000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const rows = await db.execute(sql`SELECT * FROM payroll_disputes WHERE dispute_id = ${input.disputeId}`);
      const dispute = (rows.rows as Array<{ employee_user_id: number; expected_amount: number; received_amount: number }>)[0];
      if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      if (input.resolution === "pay_difference" || input.resolution === "full_repay") {
        const amount = input.adjustmentAmount ?? (dispute.expected_amount - dispute.received_amount);
        if (amount > 0) {
          await db.execute(sql`
            UPDATE wallets SET balance = CAST(CAST(balance AS DECIMAL(18,4)) + ${amount} AS VARCHAR), "updatedAt" = NOW()
            WHERE "userId" = ${dispute.employee_user_id} AND currency = 'USD'
          `);
          await notify(db, dispute.employee_user_id, "payroll_dispute_resolved",
            `Your payroll dispute has been resolved. $${amount.toFixed(2)} has been credited to your wallet.`);
        }
      }

      await db.execute(sql`
        UPDATE payroll_disputes SET status = 'resolved', resolution = ${input.resolution}, resolved_at = NOW()
        WHERE dispute_id = ${input.disputeId}
      `);
      return { disputeId: input.disputeId, resolution: input.resolution };
    }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. REAL ESTATE INVESTOR PROTECTION
// ═══════════════════════════════════════════════════════════════════════════════

export const investorProtectionRouter = router({
  // Report developer default (admin action)
  reportDeveloperDefault: adminProcedure
    .input(z.object({
      listingId: z.number(),
      defaultType: z.enum(["abandoned_project", "bankrupt", "fraud", "breach_of_contract"]),
      description: z.string().min(10).max(5000),
      affectedInvestors: z.array(z.number()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const defaultId = genId("DEV-DEF");

      // Get all investors in this listing
      const investorRows = await db.execute(sql`
        SELECT user_id, shares, amount_invested_usd FROM real_estate_investments
        WHERE listing_id = ${input.listingId} AND status = 'active'
      `);
      const investors = investorRows.rows as Array<{ user_id: number; shares: number; amount_invested_usd: number }>;

      await db.execute(sql`
        INSERT INTO developer_defaults (default_id, listing_id, default_type, description, affected_investor_count, total_at_risk_usd, status, created_at)
        VALUES (${defaultId}, ${input.listingId}, ${input.defaultType}, ${input.description}, ${investors.length},
          (SELECT COALESCE(SUM(CAST(amount_invested_usd AS DECIMAL)), 0) FROM real_estate_investments WHERE listing_id = ${input.listingId} AND status = 'active'),
          'investigation', NOW())
      `);

      // Freeze all investment positions in this listing
      await db.execute(sql`
        UPDATE real_estate_investments SET status = 'frozen' WHERE listing_id = ${input.listingId} AND status = 'active'
      `);

      // Notify all affected investors
      for (const inv of investors) {
        await notify(db, inv.user_id, "developer_default",
          `IMPORTANT: The developer of a property you've invested in has been reported for ${input.defaultType.replace(/_/g, ' ')}. Your investment is currently frozen pending investigation. You will receive updates as the situation develops.`);
      }

      return { defaultId, affectedInvestors: investors.length, totalAtRiskUsd: investors.reduce((s, i) => s + Number(i.amount_invested_usd), 0) };
    }),

  // Initiate investor refund (liquidation)
  initiateInvestorRefund: adminProcedure
    .input(z.object({
      defaultId: z.string(),
      refundPercentage: z.number().min(0).max(100),
      reason: z.string().max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const defRows = await db.execute(sql`SELECT * FROM developer_defaults WHERE default_id = ${input.defaultId}`);
      const defaultCase = (defRows.rows as Array<{ listing_id: number }>)[0];
      if (!defaultCase) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      const investorRows = await db.execute(sql`
        SELECT user_id, amount_invested_usd FROM real_estate_investments WHERE listing_id = ${defaultCase.listing_id} AND status = 'frozen'
      `);
      const investors = investorRows.rows as Array<{ user_id: number; amount_invested_usd: number }>;
      let totalRefunded = 0;

      for (const inv of investors) {
        const refundAmount = Number(inv.amount_invested_usd) * (input.refundPercentage / 100);
        if (refundAmount > 0) {
          await db.execute(sql`
            UPDATE wallets SET balance = CAST(CAST(balance AS DECIMAL(18,4)) + ${refundAmount} AS VARCHAR), "updatedAt" = NOW()
            WHERE "userId" = ${inv.user_id} AND currency = 'USD'
          `);
          totalRefunded += refundAmount;
        }
        await notify(db, inv.user_id, "investment_refund",
          `Your investment in the defaulted property has been partially refunded. $${refundAmount.toFixed(2)} (${input.refundPercentage}% of your investment) has been credited to your wallet.`);
      }

      await db.execute(sql`
        UPDATE real_estate_investments SET status = 'liquidated' WHERE listing_id = ${defaultCase.listing_id} AND status = 'frozen'
      `);
      await db.execute(sql`
        UPDATE developer_defaults SET status = 'refunded', refund_percentage = ${input.refundPercentage} WHERE default_id = ${input.defaultId}
      `);

      return { investorsRefunded: investors.length, totalRefundedUsd: totalRefunded, refundPercentage: input.refundPercentage };
    }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. DIASPORA BOND ISSUER DEFAULT PROTECTION
// ═══════════════════════════════════════════════════════════════════════════════

export const bondProtectionRouter = router({
  // Report missed coupon payment
  reportMissedCoupon: adminProcedure
    .input(z.object({
      bondId: z.number(),
      couponPeriod: z.string(),
      expectedPaymentDate: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const incidentId = genId("BOND-MC");

      // Get all bondholders
      const holderRows = await db.execute(sql`
        SELECT user_id, principal_usd, coupon_rate FROM bond_subscriptions
        WHERE bond_id = ${input.bondId} AND status = 'active'
      `);
      const holders = holderRows.rows as Array<{ user_id: number; principal_usd: number; coupon_rate: number }>;

      await db.execute(sql`
        INSERT INTO bond_default_events (incident_id, bond_id, event_type, coupon_period, affected_holders, status, created_at)
        VALUES (${incidentId}, ${input.bondId}, 'missed_coupon', ${input.couponPeriod}, ${holders.length}, 'open', NOW())
      `);

      for (const holder of holders) {
        const expectedCoupon = Number(holder.principal_usd) * Number(holder.coupon_rate) / 100 / 4; // Quarterly
        await notify(db, holder.user_id, "bond_missed_coupon",
          `NOTICE: A coupon payment of ~$${expectedCoupon.toFixed(2)} for period ${input.couponPeriod} has been missed. The issuer has been given a 14-day grace period. If not resolved, bondholders committee will be convened.`);
      }

      return { incidentId, affectedHolders: holders.length, graceDeadline: "14 days" };
    }),

  // Declare issuer default
  declareDefault: adminProcedure
    .input(z.object({
      bondId: z.number(),
      defaultType: z.enum(["coupon_default", "principal_default", "cross_default"]),
      recoveryEstimatePct: z.number().min(0).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const defaultId = genId("BOND-DEF");

      // Mark bond as defaulted
      await db.execute(sql`
        UPDATE diaspora_bonds SET status = 'defaulted', updated_at = NOW() WHERE id = ${input.bondId}
      `);

      // Mark all subscriptions as impaired
      await db.execute(sql`
        UPDATE bond_subscriptions SET status = 'impaired', updated_at = NOW() WHERE bond_id = ${input.bondId} AND status = 'active'
      `);

      const holderRows = await db.execute(sql`
        SELECT user_id, principal_usd FROM bond_subscriptions WHERE bond_id = ${input.bondId}
      `);
      const holders = holderRows.rows as Array<{ user_id: number; principal_usd: number }>;

      for (const holder of holders) {
        await notify(db, holder.user_id, "bond_default",
          `IMPORTANT: The issuer of your diaspora bond has defaulted (${input.defaultType.replace(/_/g, ' ')}). Estimated recovery: ${input.recoveryEstimatePct}%. A bondholders committee is being formed. You will receive further instructions.`);
      }

      return { defaultId, bondId: input.bondId, affectedHolders: holders.length, recoveryEstimate: input.recoveryEstimatePct };
    }),

  // Distribute recovery proceeds
  distributeRecovery: adminProcedure
    .input(z.object({ bondId: z.number(), totalRecoveryUsd: z.number().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const holderRows = await db.execute(sql`
        SELECT user_id, principal_usd FROM bond_subscriptions WHERE bond_id = ${input.bondId} AND status = 'impaired'
      `);
      const holders = holderRows.rows as Array<{ user_id: number; principal_usd: string }>;
      const totalPrincipal = holders.reduce((s, h) => s + Number(h.principal_usd), 0);
      let distributed = 0;

      for (const holder of holders) {
        const share = (Number(holder.principal_usd) / totalPrincipal) * input.totalRecoveryUsd;
        await db.execute(sql`
          UPDATE wallets SET balance = CAST(CAST(balance AS DECIMAL(18,4)) + ${share} AS VARCHAR), "updatedAt" = NOW()
          WHERE "userId" = ${holder.user_id} AND currency = 'USD'
        `);
        await notify(db, holder.user_id, "bond_recovery",
          `Recovery distribution: $${share.toFixed(2)} has been credited to your USD wallet from the defaulted bond recovery proceedings.`);
        distributed += share;
      }

      await db.execute(sql`
        UPDATE bond_subscriptions SET status = 'recovered', updated_at = NOW() WHERE bond_id = ${input.bondId} AND status = 'impaired'
      `);

      return { holdersDistributed: holders.length, totalDistributedUsd: distributed };
    }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. MORTGAGE DEFAULT PROTECTION
// ═══════════════════════════════════════════════════════════════════════════════

export const mortgageProtectionRouter = router({
  // Detect missed mortgage repayments
  detectMissedPayments: adminProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    const result = await db.execute(sql`
      UPDATE mortgage_repayments
      SET status = 'overdue'
      WHERE status = 'scheduled'
        AND due_date < NOW()
      RETURNING id, application_id, amount_usd, due_date
    `);
    const overdue = result.rows as Array<{ id: number; application_id: number; amount_usd: number; due_date: string }>;

    // Group by application and count consecutive misses
    const byApp = new Map<number, number>();
    for (const r of overdue) {
      byApp.set(r.application_id, (byApp.get(r.application_id) ?? 0) + 1);
    }

    // Escalate based on consecutive misses
    for (const [appId, missCount] of Array.from(byApp.entries())) {
      const appRows = await db.execute(sql`SELECT applicant_id FROM mortgage_applications WHERE id = ${appId}`);
      const app = (appRows.rows as Array<{ applicant_id: number }>)[0];
      if (!app) continue;

      if (missCount >= 3) {
        // 3+ missed: initiate foreclosure warning
        await db.execute(sql`
          UPDATE mortgage_applications SET status = 'foreclosure_warning', updated_at = NOW() WHERE id = ${appId} AND status = 'active'
        `);
        await notify(db, app.applicant_id, "mortgage_foreclosure_warning",
          `CRITICAL: You have missed ${missCount} consecutive mortgage payments. Foreclosure proceedings will begin in 30 days unless all arrears are cleared. Contact support immediately.`);
      } else if (missCount >= 1) {
        await notify(db, app.applicant_id, "mortgage_overdue",
          `Your mortgage payment is overdue (${missCount} payment(s) missed). A late fee has been applied. Please pay immediately to avoid further penalties.`);
      }
    }

    return { overduePayments: overdue.length, applicationsAffected: byApp.size };
  }),

  // Borrower requests hardship arrangement
  requestHardship: protectedProcedure
    .input(z.object({
      applicationId: z.number(),
      hardshipType: z.enum(["job_loss", "medical", "natural_disaster", "reduced_income", "other"]),
      description: z.string().min(20).max(3000),
      proposedArrangement: z.enum(["payment_holiday", "reduced_payments", "term_extension", "interest_only"]),
      durationMonths: z.number().min(1).max(12),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const requestId = genId("HARDSHIP");
      await db.execute(sql`
        INSERT INTO mortgage_hardship_requests (request_id, application_id, user_id, hardship_type, description, proposed_arrangement, duration_months, status, created_at)
        VALUES (${requestId}, ${input.applicationId}, ${ctx.user.id}, ${input.hardshipType}, ${input.description}, ${input.proposedArrangement}, ${input.durationMonths}, 'pending', NOW())
      `);
      return { requestId, status: "pending", message: "Your hardship request has been submitted. A decision will be made within 5 business days." };
    }),

  // Admin approve/deny hardship
  resolveHardship: adminProcedure
    .input(z.object({
      requestId: z.string(),
      approved: z.boolean(),
      adjustedTerms: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const rows = await db.execute(sql`SELECT * FROM mortgage_hardship_requests WHERE request_id = ${input.requestId}`);
      const req = (rows.rows as Array<{ user_id: number; application_id: number; proposed_arrangement: string; duration_months: number }>)[0];
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      if (input.approved) {
        // Apply arrangement (e.g., pause payments for X months)
        await db.execute(sql`
          UPDATE mortgage_repayments SET status = 'deferred', updated_at = NOW()
          WHERE application_id = ${req.application_id} AND status IN ('scheduled', 'overdue')
            AND due_date <= NOW() + (${req.duration_months} || ' months')::INTERVAL
        `);
        await notify(db, req.user_id, "hardship_approved",
          `Your hardship request has been approved. A ${req.proposed_arrangement.replace(/_/g, ' ')} arrangement for ${req.duration_months} months has been applied to your mortgage.`);
      } else {
        await notify(db, req.user_id, "hardship_denied",
          "Your hardship request has been reviewed and unfortunately cannot be approved at this time. Please contact support to discuss alternative options.");
      }

      await db.execute(sql`
        UPDATE mortgage_hardship_requests SET status = ${input.approved ? 'approved' : 'denied'}, resolved_at = NOW()
        WHERE request_id = ${input.requestId}
      `);
      return { requestId: input.requestId, approved: input.approved };
    }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. SPLIT BILL DEADLINE ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════════

export const splitBillProtectionRouter = router({
  // Set payment deadline for split bill participants
  setDeadline: protectedProcedure
    .input(z.object({
      billId: z.number(),
      deadlineHours: z.number().min(1).max(168).default(48), // max 7 days
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const deadline = new Date(Date.now() + input.deadlineHours * 60 * 60 * 1000);
      await db.execute(sql`
        UPDATE split_bill_participants SET payment_deadline = ${deadline}, updated_at = NOW()
        WHERE bill_id = ${input.billId} AND status = 'pending'
      `);
      return { billId: input.billId, deadline: deadline.toISOString(), message: `Deadline set: ${input.deadlineHours}h for all pending participants` };
    }),

  // Process expired deadlines (redistribute or cancel unpaid shares)
  processExpiredDeadlines: adminProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    const result = await db.execute(sql`
      SELECT sbp.id, sbp.bill_id, sbp.user_id, sbp.amount, sb.creator_id
      FROM split_bill_participants sbp
      JOIN split_bills sb ON sb.id = sbp.bill_id
      WHERE sbp.status = 'pending'
        AND sbp.payment_deadline IS NOT NULL
        AND sbp.payment_deadline < NOW()
    `);
    const expired = result.rows as Array<{ id: number; bill_id: number; user_id: number; amount: number; creator_id: number }>;

    for (const item of expired) {
      // Mark as defaulted
      await db.execute(sql`
        UPDATE split_bill_participants SET status = 'defaulted', updated_at = NOW() WHERE id = ${item.id}
      `);
      // Notify the defaulter
      await notify(db, item.user_id, "split_bill_expired",
        `You missed the payment deadline for a split bill. The amount of ₦${Number(item.amount).toLocaleString()} has been marked as defaulted.`);
      // Notify the bill creator
      await notify(db, item.creator_id, "split_bill_participant_defaulted",
        `A participant in your split bill has missed their payment deadline (₦${Number(item.amount).toLocaleString()}). You may redistribute or absorb their share.`);
    }

    return { expiredCount: expired.length };
  }),

  // Send payment reminder/nudge
  sendReminder: protectedProcedure
    .input(z.object({ billId: z.number(), participantUserId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Verify caller is bill creator
      const billRows = await db.execute(sql`SELECT id FROM split_bills WHERE id = ${input.billId} AND creator_id = ${ctx.user.id}`);
      if ((billRows.rows as Array<unknown>).length === 0) throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });

      await notify(db, input.participantUserId, "split_bill_reminder",
        "Friendly reminder: you have a pending split bill payment. Please pay before the deadline to avoid being marked as defaulted.");
      return { sent: true };
    }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. VIRTUAL CARD CHARGEBACK PROTECTION
// ═══════════════════════════════════════════════════════════════════════════════

export const cardProtectionRouter = router({
  // Report unauthorized transaction
  reportUnauthorized: protectedProcedure
    .input(z.object({
      cardId: z.number(),
      transactionRef: z.string(),
      amount: z.number().positive().max(10_000_000),
      merchantName: z.string().max(200),
      disputeReason: z.enum(["unauthorized", "duplicate", "not_as_described", "cancelled_subscription", "counterfeit"]),
      description: z.string().min(10).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Verify card belongs to user
      const cardRows = await db.execute(sql`
        SELECT id, status FROM virtual_cards WHERE id = ${input.cardId} AND user_id = ${ctx.user.id}
      `);
      if ((cardRows.rows as Array<unknown>).length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      const chargebackId = genId("CB");

      // Auto-freeze card if unauthorized
      if (input.disputeReason === "unauthorized" || input.disputeReason === "counterfeit") {
        await db.execute(sql`
          UPDATE virtual_cards SET status = 'frozen', freeze_reason = 'chargeback_investigation' WHERE id = ${input.cardId}
        `);
      }

      await db.execute(sql`
        INSERT INTO card_chargebacks (chargeback_id, card_id, user_id, transaction_ref, amount, currency, merchant_name, reason, description, status, created_at)
        VALUES (${chargebackId}, ${input.cardId}, ${ctx.user.id}, ${input.transactionRef}, ${input.amount}, 'USD', ${input.merchantName}, ${input.disputeReason}, ${input.description}, 'open', NOW())
      `);

      await createAuditLog({ userId: ctx.user.id, action: "CARD_CHARGEBACK_FILED", metadata: { chargebackId, cardId: input.cardId, amount: input.amount } });
      return {
        chargebackId,
        status: "open",
        cardFrozen: input.disputeReason === "unauthorized" || input.disputeReason === "counterfeit",
        sla: "10 business days",
        message: "Chargeback filed. Provisional credit will be applied within 48 hours while we investigate.",
      };
    }),

  // Admin resolve chargeback
  resolveChargeback: adminProcedure
    .input(z.object({
      chargebackId: z.string(),
      resolution: z.enum(["refund_customer", "deny", "partial_refund"]),
      refundAmount: z.number().positive().max(10_000_000).optional(),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const rows = await db.execute(sql`SELECT * FROM card_chargebacks WHERE chargeback_id = ${input.chargebackId}`);
      const cb = (rows.rows as Array<{ user_id: number; amount: number; card_id: number }>)[0];
      if (!cb) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });

      if (input.resolution === "refund_customer" || input.resolution === "partial_refund") {
        const refund = input.refundAmount ?? cb.amount;
        await db.execute(sql`
          UPDATE wallets SET balance = CAST(CAST(balance AS DECIMAL(18,4)) + ${refund} AS VARCHAR), "updatedAt" = NOW()
          WHERE "userId" = ${cb.user_id} AND currency = 'USD'
        `);
        await notify(db, cb.user_id, "chargeback_resolved",
          `Your chargeback has been resolved in your favor. $${refund.toFixed(2)} has been refunded to your wallet.`);
      } else {
        await notify(db, cb.user_id, "chargeback_denied",
          "Your chargeback dispute has been reviewed and denied. Please contact support if you wish to appeal.");
      }

      // Unfreeze card if it was frozen for investigation
      await db.execute(sql`
        UPDATE virtual_cards SET status = 'active', freeze_reason = NULL WHERE id = ${cb.card_id} AND freeze_reason = 'chargeback_investigation'
      `);

      await db.execute(sql`
        UPDATE card_chargebacks SET status = 'resolved', resolution = ${input.resolution}, resolved_at = NOW(), admin_notes = ${input.notes ?? ''}
        WHERE chargeback_id = ${input.chargebackId}
      `);
      return { chargebackId: input.chargebackId, resolution: input.resolution };
    }),

  // Apply provisional credit (within 48h of filing)
  applyProvisionalCredit: adminProcedure
    .input(z.object({ chargebackId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const rows = await db.execute(sql`
        SELECT * FROM card_chargebacks WHERE chargeback_id = ${input.chargebackId} AND status = 'open' AND provisional_credit_applied = false
      `);
      const cb = (rows.rows as Array<{ user_id: number; amount: number }>)[0];
      if (!cb) throw new TRPCError({ code: "NOT_FOUND", message: "Chargeback not found or credit already applied" });

      await db.execute(sql`
        UPDATE wallets SET balance = CAST(CAST(balance AS DECIMAL(18,4)) + ${cb.amount} AS VARCHAR), "updatedAt" = NOW()
        WHERE "userId" = ${cb.user_id} AND currency = 'USD'
      `);
      await db.execute(sql`
        UPDATE card_chargebacks SET provisional_credit_applied = true, provisional_credit_at = NOW()
        WHERE chargeback_id = ${input.chargebackId}
      `);
      await notify(db, cb.user_id, "provisional_credit",
        `A provisional credit of $${cb.amount.toFixed(2)} has been applied to your wallet while we investigate your chargeback.`);

      return { chargebackId: input.chargebackId, provisionalAmount: cb.amount };
    }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMBINED ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

export const failureProtectionRouter = router({
  bnpl: bnplProtectionRouter,
  agent: agentProtectionRouter,
  transfer: transferProtectionRouter,
  payroll: payrollProtectionRouter,
  investor: investorProtectionRouter,
  bond: bondProtectionRouter,
  mortgage: mortgageProtectionRouter,
  splitBill: splitBillProtectionRouter,
  card: cardProtectionRouter,
});
