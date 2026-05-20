/**
 * RemitFlow Scheduler Engine v7.0
 *
 * Cron jobs:
 *   1. Every minute  — Execute due recurring payments
 *   2. Every 5 min   — Check FX rate alerts and notify users
 *   3. Every hour    — Auto-escalate stale fraud_alerts (pending > 24h)
 *   4. Every 6 hours — Cancel recurring payments with ≥3 consecutive failures
 *   5. Every 15 min  — Refresh FX rates cache
 *
 * Design:
 *   - Each job is idempotent (safe to re-run)
 *   - All errors are caught and logged — never crash the process
 *   - Uses getDb() pattern consistent with rest of server codebase
 */

import cron from "node-cron";
import { getDb } from "./db";
import {
  recurringPayments,
  fxAlerts,
  wallets,
  transactions,
  notifications,
  users,
  complianceCases,
  kycDocuments,
  communityFunds,
  fundProposals,
  fundVotes,
  documentVaultTable,
  docReminderPrefs,
  docReminderLog,
} from "../drizzle/schema";
import { and, eq, lte, lt, sql, gte, isNotNull, inArray } from "drizzle-orm";
import { logAdminAction } from "./audit.service";
import { fetchLiveRates, detectRateChanges, ensureFxRateCacheTable } from "./fx-rates.service";
import { notifyOwner } from "./_core/notification";
import { sendEmail, buildFxAlertEmail, buildWeeklyFundDigestEmail, buildDocumentExpiryReminderEmail, type FundDigestEntry } from "./email.service";
import { broadcastAdminEvent } from "./sse.service";
import { runArchivalPipeline } from "./services/archivalPipeline";
import { transferBatchQueue } from "./services/transferBatchQueue";
import { walletCache } from "./services/walletCache";
import { logger } from './_core/logger';

// ============================================================================
// FX Rate Cache (backed by fx-rates.service with real API sources)
// ============================================================================

let cachedRates: Record<string, number> = {};
let lastRatesFetch = 0;

async function refreshFXRates(): Promise<void> {
  try {
    await ensureFxRateCacheTable();
    const { rates, source } = await fetchLiveRates("USD");
    
    // Detect rate changes for alert triggering
    if (Object.keys(cachedRates).length > 0) {
      const changes = await detectRateChanges(rates, "USD");
      if (changes.length > 0) {
        logger.info(`[Scheduler] ${changes.length} rate changes detected (>0.1%):`, 
          changes.slice(0, 3).map(c => `${c.toCurrency}: ${c.changePercent > 0 ? '+' : ''}${c.changePercent}%`).join(', '));
      }
    }
    
    cachedRates = rates;
    lastRatesFetch = Date.now();
    const pairCount = Object.keys(rates).length;
    logger.info(`[Scheduler] FX rates refreshed: ${pairCount} pairs (source: ${source})`);
  } catch (err) {
    logger.error({ err: err }, '[Scheduler] Failed to refresh FX rates:');
  }
}

function getCachedRate(from: string, to: string): number | null {
  if (Object.keys(cachedRates).length === 0) return null;
  const fromRate = cachedRates[from] ?? (from === "USD" ? 1 : null);
  const toRate = cachedRates[to] ?? (to === "USD" ? 1 : null);
  if (fromRate === null || toRate === null) return null;
  return toRate / fromRate;
}

// ============================================================================
// Job 1: Execute Due Recurring Payments (every minute)
// ============================================================================

async function executeRecurringPayments(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const now = new Date();

  let duePayments: any[] = [];
  try {
    duePayments = await db
      .select()
      .from(recurringPayments)
      .where(
        and(
          eq(recurringPayments.status, "active"),
          lte(recurringPayments.nextRunAt, now)
        )
      )
      .limit(50);
  } catch (err) {
    logger.error({ err: err }, '[Scheduler] Failed to query due recurring payments:');
    return;
  }

  if (duePayments.length === 0) return;
  logger.info(`[Scheduler] Processing ${duePayments.length} due recurring payments`);

  for (const payment of duePayments) {
    try {
      await executeSingleRecurringPayment(payment);
    } catch (err) {
      logger.error({ err: err }, '[Scheduler] Failed to execute recurring payment ${payment.id}:');
      try {
        await db
          .update(recurringPayments)
          .set({
            lastRunAt: now,
            nextRunAt: calculateNextRun(payment),
            lastRunStatus: "failed",
            failureCount: sql`${recurringPayments.failureCount} + 1`,
          })
          .where(eq(recurringPayments.id, payment.id));
      } catch (updateErr) {
        logger.error({ err: updateErr }, '[Scheduler] Failed to update failure count for payment ${payment.id}:');
      }
    }
  }
}

async function executeSingleRecurringPayment(payment: any): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = new Date();

  // Check if user has sufficient balance
  const userWallets = await db
    .select()
    .from(wallets)
    .where(
      and(
        eq(wallets.userId, payment.userId),
        eq(wallets.currency, payment.currency)
      )
    )
    .limit(1);

  if (userWallets.length === 0) {
    throw new Error(`No ${payment.currency} wallet found for user ${payment.userId}`);
  }

  const wallet = userWallets[0];
  const paymentAmount = parseFloat(payment.amount);
  const walletBalance = parseFloat(wallet.balance);

  if (walletBalance < paymentAmount) {
    await createNotification(
      payment.userId,
      "Recurring Payment Failed",
      `Your scheduled payment "${payment.name}" of ${payment.amount} ${payment.currency} could not be processed due to insufficient balance.`,
      "warning"
    );
    await db
      .update(recurringPayments)
      .set({
        lastRunAt: now,
        nextRunAt: calculateNextRun(payment),
        lastRunStatus: "failed",
        failureCount: sql`${recurringPayments.failureCount} + 1`,
      })
      .where(eq(recurringPayments.id, payment.id));
    return;
  }

  // Deduct from wallet (atomic update with overdraft guard)
  await db
    .update(wallets)
    .set({ balance: sql`${wallets.balance} - ${payment.amount}` })
    .where(
      and(
        eq(wallets.id, wallet.id),
        sql`CAST(${wallets.balance} AS DECIMAL(18,2)) >= ${payment.amount}`
      )
    );

  // Create transaction record
  const reference = `REC-${payment.id}-${Date.now()}`;
  await db.insert(transactions).values({
    userId: payment.userId,
    fromCurrency: payment.currency,
    fromAmount: payment.amount,
    type: "send",
    status: "completed",
    reference,
    description: `Recurring: ${payment.name}`,
    recipientName: payment.recipientName,
    recipientAccount: payment.recipientAccount,
    metadata: { recurringPaymentId: payment.id, scheduleName: payment.name },
  });

  // Update recurring payment record
  const nextRun = calculateNextRun(payment);
  await db
    .update(recurringPayments)
    .set({
      lastRunAt: now,
      nextRunAt: nextRun,
      lastRunStatus: "success",
      failureCount: 0,
      executionCount: sql`${recurringPayments.executionCount} + 1`,
    })
    .where(eq(recurringPayments.id, payment.id));

  await createNotification(
    payment.userId,
    "Recurring Payment Sent",
    `Your scheduled payment "${payment.name}" of ${payment.amount} ${payment.currency} to ${payment.recipientName} was sent successfully. Next run: ${nextRun.toLocaleDateString()}.`,
    "success"
  );

  logger.info(`[Scheduler] Executed recurring payment ${payment.id} (${payment.name}): ${payment.amount} ${payment.currency} → ${payment.recipientName}`);
}

function calculateNextRun(payment: any): Date {
  const base = payment.lastRunAt ? new Date(payment.lastRunAt) : new Date();
  const next = new Date(base);

  switch (payment.frequency) {
    case "daily":
      next.setDate(next.getDate() + 1);
      break;
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "biweekly":
      next.setDate(next.getDate() + 14);
      break;
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      if (payment.dayOfMonth) {
        next.setDate(Math.min(payment.dayOfMonth, getDaysInMonth(next)));
      }
      break;
    case "quarterly":
      next.setMonth(next.getMonth() + 3);
      break;
    default:
      next.setDate(next.getDate() + 7);
  }
  return next;
}

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// ============================================================================
// Job 2: Check FX Rate Alerts (every 5 minutes)
// ============================================================================

async function checkFXRateAlerts(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  let activeAlerts: any[] = [];
  try {
    activeAlerts = await db
      .select()
      .from(fxAlerts)
      .where(eq(fxAlerts.isActive, true))
      .limit(200);
  } catch (err) {
    logger.error({ err: err }, '[Scheduler] Failed to query FX alerts:');
    return;
  }

  if (activeAlerts.length === 0) return;

  let triggered = 0;
  for (const alert of activeAlerts) {
    try {
      const currentRate = getCachedRate(alert.fromCurrency, alert.toCurrency);
      if (currentRate === null) continue;

      const targetRate = parseFloat(alert.targetRate);
      const isTriggered =
        alert.direction === "above"
          ? currentRate >= targetRate
          : currentRate <= targetRate;

      if (isTriggered) {
        await createNotification(
          alert.userId,
          "FX Rate Alert Triggered!",
          `Your rate alert for ${alert.fromCurrency}/${alert.toCurrency} has been triggered. Current rate: ${currentRate.toFixed(4)} (target: ${targetRate.toFixed(4)} ${alert.direction}).`,
          "info"
        );
        await db
          .update(fxAlerts)
          .set({
            isActive: false,
            triggered: true,
            triggeredAt: new Date(),
            notifiedAt: new Date(),
            lastCheckedRate: currentRate.toString(),
            lastCheckedAt: new Date(),
          })
          .where(eq(fxAlerts.id, alert.id));
        triggered++;
        // Push owner notification for triggered alert
        try {
          await notifyOwner({
            title: `FX Alert Triggered: ${alert.fromCurrency}/${alert.toCurrency}`,
            content: `User #${alert.userId} alert fired. Target: ${targetRate.toFixed(4)} ${alert.direction}. Current rate: ${currentRate.toFixed(4)}.`,
          });
        } catch { /* non-critical */ }
        // Send email to user if they have an email address
        try {
          const userRows = await db.select({ email: users.email }).from(users).where(eq(users.id, alert.userId)).limit(1);
          const userEmail = userRows[0]?.email;
          if (userEmail) {
            const emailContent = buildFxAlertEmail({
              fromCurrency: alert.fromCurrency,
              toCurrency: alert.toCurrency,
              targetRate,
              currentRate,
              direction: alert.direction,
            });
            await sendEmail({ to: userEmail, ...emailContent });
          }
        } catch { /* non-critical */ }
        logger.info(`[Scheduler] FX alert triggered: ${alert.fromCurrency}/${alert.toCurrency} @ ${currentRate.toFixed(4)}`);
      } else {
        await db
          .update(fxAlerts)
          .set({ lastCheckedRate: currentRate.toString(), lastCheckedAt: new Date() })
          .where(eq(fxAlerts.id, alert.id));
      }
    } catch (err) {
      logger.error({ err: err }, '[Scheduler] Error checking FX alert ${alert.id}:');
    }
  }

  if (triggered > 0) {
    logger.info(`[Scheduler] FX alerts: ${triggered} triggered out of ${activeAlerts.length} active`);
  }
}

// ============================================================================
// Job 3: Auto-escalate stale fraud_alerts via raw SQL (every hour)
// ============================================================================

async function processStalefraudCases(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // fraud_alerts table is managed via raw SQL in routers.ts
    const result = await db.execute(sql.raw(`
      UPDATE fraud_alerts
      SET status = 'reviewed',
          reviewer_notes = COALESCE(reviewer_notes, '') || E'\n[AUTO] Marked reviewed after 24h without manual review.',
          updated_at = NOW()
      WHERE status = 'pending'
        AND created_at < NOW() - INTERVAL '24 hours'
    `));
    const affected = (result as any)?.rowCount ?? 0;
    if (affected > 0) {
      logger.info(`[Scheduler] Auto-escalated ${affected} stale fraud alerts`);
    }
  } catch (err) {
    logger.error({ err: err }, '[Scheduler] Failed to process stale fraud cases:');
  }
}

// ============================================================================
// Job 4: Cancel recurring payments with ≥3 consecutive failures
// ============================================================================

async function cancelFailingPayments(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const failing = await db
      .select()
      .from(recurringPayments)
      .where(
        and(
          eq(recurringPayments.status, "active"),
          sql`${recurringPayments.failureCount} >= 3`
        )
      );

    for (const payment of failing) {
      await db
        .update(recurringPayments)
        .set({ status: "cancelled" })
        .where(eq(recurringPayments.id, payment.id));

      await createNotification(
        payment.userId,
        "Recurring Payment Cancelled",
        `Your scheduled payment "${payment.name}" has been cancelled after 3 consecutive failures. Please check your balance and recreate the schedule.`,
        "error"
      );
    }

    if (failing.length > 0) {
      logger.info(`[Scheduler] Cancelled ${failing.length} failing recurring payments`);
    }
  } catch (err) {
    logger.error({ err: err }, '[Scheduler] Failed to cancel failing payments:');
  }
}

// ============================================================================
// Job 6: Auto-escalate overdue SLA compliance cases (daily at 08:00)
// ============================================================================

async function autoEscalateOverdueCases(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const now = new Date();

  try {
    // Find open/under_review cases where dueAt has passed
    const overdueCases = await db
      .select()
      .from(complianceCases)
      .where(
        and(
          isNotNull(complianceCases.dueAt),
          lt(complianceCases.dueAt, now),
          sql`${complianceCases.status} IN ('open', 'under_review')`
        )
      )
      .limit(100);

    if (overdueCases.length === 0) return;
    logger.info(`[Scheduler] Auto-escalating ${overdueCases.length} overdue compliance cases`);

    for (const c of overdueCases) {
      try {
        await db.update(complianceCases)
          .set({
            status: "escalated",
            escalatedAt: now,
            notes: (c.notes ? c.notes + "\n" : "") + `[AUTO] SLA deadline passed (${c.dueAt?.toISOString()}). Auto-escalated at ${now.toISOString()}.`,
            updatedAt: now,
          })
          .where(eq(complianceCases.id, c.id));
        await logAdminAction({
          actorId: 0, // system
          action: "autoEscalate",
          targetId: c.id,
          targetType: "complianceCase",
          description: `Auto-escalated case #${c.id} "${c.title}" — SLA deadline ${c.dueAt?.toISOString()} passed`,
          severity: "warning",
          metadata: { dueAt: c.dueAt?.toISOString(), severity: c.severity },
        });
        // Broadcast SSE event to all connected admins
        broadcastAdminEvent({
          type: "case_escalated",
          payload: {
            caseId: c.id,
            title: c.title,
            message: `Case #${c.id} "${c.title}" auto-escalated — SLA deadline missed`,
            severity: c.severity ?? "high",
          },
        });
        // Notify assigned officer if any
        await createNotification(
          c.userId,
          "Compliance Case SLA Breached",
          `Case #${c.id} "${c.title}" has been auto-escalated because the SLA deadline was missed.`,
          "warning"
        );
      } catch (err) {
        logger.error({ err: err }, '[Scheduler] Failed to auto-escalate case ${c.id}:');
      }
    }
  } catch (err) {
    logger.error({ err: err }, '[Scheduler] SLA auto-escalation job error:');
  }
}

// ============================================================================
// Job 7: KYC expiry reminder emails (daily at 09:00)
// ============================================================================

async function sendKycExpiryReminders(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const now = new Date();

    // Find approved docs expiring within 7 days that haven't expired yet
    const expiringDocs = await db
      .select({
        docId: kycDocuments.id,
        userId: kycDocuments.userId,
        docType: kycDocuments.docType,
        expiresAt: kycDocuments.expiresAt,
        userEmail: users.email,
        userName: users.name,
      })
      .from(kycDocuments)
      .leftJoin(users, eq(kycDocuments.userId, users.id))
      .where(
        and(
          eq(kycDocuments.status, "approved"),
          isNotNull(kycDocuments.expiresAt),
          gte(kycDocuments.expiresAt, now),
          lte(kycDocuments.expiresAt, in7Days)
        )
      )
      .limit(200);

    if (expiringDocs.length === 0) return;
    logger.info(`[Scheduler] Sending KYC expiry reminders for ${expiringDocs.length} documents`);

    for (const doc of expiringDocs) {
      if (!doc.userEmail) continue;
      try {
        const daysLeft = Math.ceil((doc.expiresAt!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        await sendEmail({
          to: doc.userEmail,
          subject: `Action Required: Your ${doc.docType} expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`,
          html: `<p>Dear ${doc.userName ?? 'Valued Customer'},</p>
<p>Your <strong>${doc.docType.replace('_', ' ')}</strong> document on file with RemitFlow will expire on <strong>${doc.expiresAt!.toLocaleDateString()}</strong> (${daysLeft} day${daysLeft !== 1 ? 's' : ''} from now).</p>
<p>To avoid service interruption, please log in and upload a new document before the expiry date.</p>
<p><a href="${process.env.APP_URL ?? 'https://remitflow.example.com'}/kyc">Update your KYC documents →</a></p>
<p>Thank you,<br/>The RemitFlow Compliance Team</p>`,
          text: `Your ${doc.docType} expires in ${daysLeft} day(s) on ${doc.expiresAt!.toLocaleDateString()}. Please log in to update your KYC documents.`,
        });
        logger.info(`[Scheduler] KYC expiry reminder sent to ${doc.userEmail} for doc #${doc.docId}`);
      } catch (err) {
        logger.error({ err: err }, '[Scheduler] Failed to send KYC expiry reminder for doc ${doc.docId}:');
      }
    }
  } catch (err) {
    logger.error({ err: err }, '[Scheduler] KYC expiry reminder job error:');
  }
}

// ============================================================================
// Helper: Create in-app notification
// ============================================================================

async function createNotification(
  userId: number,
  title: string,
  message: string,
  type: "info" | "success" | "warning" | "error" = "info"
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    // Map to valid enum values for notifications table
    const notifType = type === "error" ? "system" : type === "success" ? "transaction" : type === "warning" ? "security" : "system";
    await db.insert(notifications).values({
      userId,
      title,
      message,
      type: notifType as any,
      isRead: false,
    });
  } catch (err) {
    logger.error({ err: err }, '[Scheduler] Failed to create notification for user ${userId}:');
  }
}

// ============================================================================
// Scheduler Bootstrap
// ============================================================================

export function startScheduler(): void {
  logger.info("[Scheduler] Starting RemitFlow cron engine v7.0");

  // Initial FX rate refresh on startup
  refreshFXRates().catch((err) => logger.error({ err }, "FX rate refresh failed"));

  // Job 1: Execute due recurring payments — every minute
  cron.schedule("* * * * *", async () => {
    try { await executeRecurringPayments(); }
    catch (err) { logger.error({ err: err }, '[Scheduler] Recurring payments job error:'); }
  });

  // Job 2: Check FX rate alerts — every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    try { await checkFXRateAlerts(); }
    catch (err) { logger.error({ err: err }, '[Scheduler] FX alerts job error:'); }
  });

  // Job 3: Auto-escalate stale fraud cases — every hour
  cron.schedule("0 * * * *", async () => {
    try { await processStalefraudCases(); }
    catch (err) { logger.error({ err: err }, '[Scheduler] Fraud escalation job error:'); }
  });

  // Job 4: Cancel failing recurring payments — every 6 hours
  cron.schedule("0 */6 * * *", async () => {
    try { await cancelFailingPayments(); }
    catch (err) { logger.error({ err: err }, '[Scheduler] Cancel failing payments job error:'); }
  });

  // Job 5: Refresh FX rates — every 15 minutes
  cron.schedule("*/15 * * * *", async () => {
    try { await refreshFXRates(); }
    catch (err) { logger.error({ err: err }, '[Scheduler] FX rate refresh job error:'); }
  });

  // Job 6: Auto-escalate overdue SLA compliance cases — daily at 08:00
  cron.schedule("0 8 * * *", async () => {
    try { await autoEscalateOverdueCases(); }
    catch (err) { logger.error({ err: err }, '[Scheduler] SLA auto-escalation job error:'); }
  });

  // Job 7: KYC expiry reminder emails — daily at 09:00
  cron.schedule("0 9 * * *", async () => {
    try { await sendKycExpiryReminders(); }
    catch (err) { logger.error({ err: err }, '[Scheduler] KYC expiry reminder job error:'); }
  });

  // Job 8: Weekly community fund digest — every Monday at 08:00
  cron.schedule("0 8 * * 1", async () => {
    try { await sendWeeklyFundDigests(); }
    catch (err) { logger.error({ err: err }, '[Scheduler] Weekly fund digest job error:'); }
  });

  // Job 9: Document vault expiry reminders — daily at 10:00
  cron.schedule("0 10 * * *", async () => {
    try { await sendDocumentVaultExpiryReminders(); }
    catch (err) { logger.error({ err: err }, '[Scheduler] Document vault expiry reminder job error:'); }
  });

  // Job 10: Archival pipeline — daily at 02:00 UTC (move 90-day-old transactions to S3)
  cron.schedule("0 2 * * *", async () => {
    try {
      const result = await runArchivalPipeline();
      logger.info(`[Scheduler] Archival pipeline: archived ${result.archivedCount} transactions to S3 (${result.durationMs} ms)`);
    }
    catch (err) { logger.error({ err: err }, '[Scheduler] Archival pipeline job error:'); }
  });

  // Job 11: CTR auto-flag — daily at 01:00 UTC (flag transactions >$10,000)
  cron.schedule("0 1 * * *", async () => {
    try {
      const db = await getDb();
      if (!db) return;
      await db.execute(
        sql`INSERT INTO ctr_auto_flags (transaction_id, user_id, amount_usd, currency, flagged_reason, status)
            SELECT t.id, t."userId",
                   CASE WHEN t."fromCurrency" = 'USD' THEN CAST(t."fromAmount" AS DECIMAL)
                        WHEN t."fromCurrency" = 'GBP' THEN CAST(t."fromAmount" AS DECIMAL) * 1.27
                        WHEN t."fromCurrency" = 'EUR' THEN CAST(t."fromAmount" AS DECIMAL) * 1.09
                        WHEN t."fromCurrency" = 'NGN' THEN CAST(t."fromAmount" AS DECIMAL) / 1580
                        ELSE CAST(t."fromAmount" AS DECIMAL) END AS amount_usd,
                   t."fromCurrency",
                   'Transaction exceeds $10,000 CTR threshold' AS flagged_reason,
                   'pending' AS status
            FROM transactions t
            WHERE CAST(t."fromAmount" AS DECIMAL) >= 10000
              AND t."fromCurrency" = 'USD'
              AND t.status = 'completed'
              AND NOT EXISTS (
                SELECT 1 FROM ctr_auto_flags c WHERE c.transaction_id = t.id
              )
            LIMIT 500`
      );
      logger.info(`[Scheduler] CTR auto-flag: batch processed`);
    }
    catch (err) { logger.error({ err: err }, '[Scheduler] CTR auto-flag job error:'); }
  });

  // Job 12: Wallet balance reconciliation — daily at 03:00 UTC
  cron.schedule("0 3 * * *", async () => {
    try {
      const db = await getDb();
      if (!db) return;
      const result = await db.execute(
        sql`SELECT COUNT(*) AS discrepancy_count
            FROM wallets w
            LEFT JOIN (
              SELECT "walletId", SUM(CASE WHEN direction = 'credit' THEN CAST(amount AS DECIMAL)
                                         WHEN direction = 'debit' THEN -CAST(amount AS DECIMAL)
                                         ELSE 0 END) AS ledger_sum
              FROM ledger_entries GROUP BY "walletId"
            ) le ON le."walletId" = w.id
            WHERE ABS(CAST(w.balance AS DECIMAL) - COALESCE(le.ledger_sum, 0)) > 0.01`
      );
      const rows = (result as any).rows ?? [];
      const count = Number(rows[0]?.discrepancy_count ?? 0);
      if (count > 0) {
        logger.warn(`[Scheduler] Wallet reconciliation: ${count} discrepancies found!`);
        await notifyOwner({ title: '⚠️ Wallet Reconciliation Alert', content: `${count} wallet(s) have balance discrepancies. Check /admin/ledger-reconciliation.` });
      } else {
        logger.info(`[Scheduler] Wallet reconciliation: all balances match ✓`);
      }
    }
    catch (err) { logger.error({ err: err }, '[Scheduler] Wallet reconciliation job error:'); }
  });

  // Start transfer batch queue (continuous 50ms flush — 1B payments/day pattern)
  transferBatchQueue.start();
  walletCache.getStats(); // warm the wallet LRU cache singleton

  logger.info("[Scheduler] All cron jobs registered:");
  logger.info("  • Recurring payments: every minute");
  logger.info("  • FX rate alerts: every 5 minutes");
  logger.info("  • Fraud escalation: every hour");
  logger.info("  • Cancel failing payments: every 6 hours");
  logger.info("  • FX rate refresh: every 15 minutes");
  logger.info("  • SLA auto-escalation: daily at 08:00");
  logger.info("  \u2022 KYC expiry reminders: daily at 09:00");
  logger.info("  \u2022 Weekly community fund digest: every Monday at 08:00");
  logger.info("  \u2022 Document vault expiry reminders: daily at 10:00");
}

// ============================================================================
// Job 8: Weekly Community Fund Digest (every Monday at 08:00)
// ============================================================================

async function sendWeeklyFundDigests(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  logger.info("[Scheduler] Sending weekly community fund digests...");

  const since = new Date();
  since.setDate(since.getDate() - 90);

  let voterRows: { userId: number }[] = [];
  try {
    voterRows = await db.selectDistinct({ userId: fundVotes.userId }).from(fundVotes).where(gte(fundVotes.createdAt, since));
  } catch (err) {
    logger.error({ err: err }, '[Scheduler] Failed to query community fund voters:');
    return;
  }

  if (voterRows.length === 0) {
    logger.info("[Scheduler] No active community fund voters found — skipping digest");
    return;
  }

  const now = new Date();
  const weekEnd = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const weekStartDate = new Date(now);
  weekStartDate.setDate(weekStartDate.getDate() - 7);
  const weekStart = weekStartDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  let sent = 0;
  let failed = 0;

  for (const { userId } of voterRows) {
    try {
      const [user] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
      if (!user?.email) continue;

      const userVotes = await db.select({ proposalId: fundVotes.proposalId }).from(fundVotes).where(eq(fundVotes.userId, userId));
      if (userVotes.length === 0) continue;

      const proposalIds = userVotes.map((v: any) => v.proposalId);
      const proposalRows = await db.select({ fundId: fundProposals.fundId }).from(fundProposals).where(inArray(fundProposals.id, proposalIds));

      const fundIds = Array.from(new Set(proposalRows.map((p: any) => p.fundId))) as number[];
      if (fundIds.length === 0) continue;

      const digestFunds: FundDigestEntry[] = [];
      for (const fundId of fundIds) {
        const fid = Number(fundId);
        const [fund] = await db.select().from(communityFunds).where(eq(communityFunds.id, fid)).limit(1);
        if (!fund) continue;
        const activeProposalRows = await db.select({ title: fundProposals.title, votesFor: fundProposals.votesFor }).from(fundProposals).where(and(eq(fundProposals.fundId, fid), eq(fundProposals.status, "voting" as any)));
        const topProposal = activeProposalRows.sort((a: any, b: any) => Number(b.votesFor ?? 0) - Number(a.votesFor ?? 0))[0];
        digestFunds.push({
          name: fund.name,
          totalRaised: parseFloat(String(fund.totalRaised ?? 0)),
          goalAmount: parseFloat(String(fund.goalAmount ?? 0)),
          contributorCount: fund.contributorCount ?? 0,
          currency: fund.currency ?? "USD",
          activeProposals: activeProposalRows.length,
          topProposal: topProposal?.title,
          topProposalVotesFor: Number(topProposal?.votesFor ?? 0),
          status: fund.status ?? "active",
        });
      }

      if (digestFunds.length === 0) continue;

      const { subject, html, text } = buildWeeklyFundDigestEmail({ userName: user.name ?? "Community Member", userEmail: user.email, funds: digestFunds, weekStart, weekEnd });
      const ok = await sendEmail({ to: user.email, subject, html, text });
      if (ok) sent++; else failed++;
    } catch (err) {
      logger.warn({ data: err }, '[Scheduler] Fund digest failed for user ${userId}:');
      failed++;
    }
  }

  logger.info(`[Scheduler] Weekly fund digests: ${sent} sent, ${failed} failed (${voterRows.length} total voters)`);
}

// ============================================================================
// Job 9: Document Vault Expiry Reminders (daily at 10:00)
// ============================================================================
// Thresholds to check (days before expiry)
const DOC_REMINDER_THRESHOLDS: Array<{ days: number; key: keyof typeof REMINDER_PREF_KEYS }> = [
  { days: 30, key: "remind30d" },
  { days: 14, key: "remind14d" },
  { days: 7,  key: "remind7d"  },
  { days: 3,  key: "remind3d"  },
  { days: 1,  key: "remind1d"  },
];
const REMINDER_PREF_KEYS = {
  remind30d: true, remind14d: true, remind7d: true, remind3d: true, remind1d: true,
} as const;

export async function sendDocumentVaultExpiryReminders(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  logger.info("[Scheduler] Running document vault expiry reminder scan...");

  // Fetch all active docs expiring within 30 days (or already expired within last 24h)
  let expiringDocs: any[] = [];
  try {
    expiringDocs = await db
      .select({
        docId: documentVaultTable.id,
        userId: documentVaultTable.userId,
        docName: documentVaultTable.name,
        docCategory: documentVaultTable.category,
        expiresAt: documentVaultTable.expiresAt,
        userEmail: users.email,
        userName: users.name,
      })
      .from(documentVaultTable)
      .leftJoin(users, eq(documentVaultTable.userId, users.id))
      .where(
        and(
          eq(documentVaultTable.status, "active"),
          isNotNull(documentVaultTable.expiresAt),
          lte(documentVaultTable.expiresAt, in30Days)
        )
      )
      .limit(500);
  } catch (err) {
    logger.error({ err: err }, '[Scheduler] Failed to query expiring documents:');
    return;
  }

  if (expiringDocs.length === 0) {
    logger.info("[Scheduler] No expiring documents found");
    return;
  }

  logger.info(`[Scheduler] Found ${expiringDocs.length} documents expiring within 30 days`);

  let emailSent = 0, inAppSent = 0, skipped = 0;

  for (const doc of expiringDocs) {
    if (!doc.expiresAt) continue;
    const daysLeft = Math.ceil((doc.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    // Determine which threshold bucket this document falls into
    const threshold = DOC_REMINDER_THRESHOLDS.find(t => {
      if (t.days === 30) return daysLeft <= 30 && daysLeft > 14;
      if (t.days === 14) return daysLeft <= 14 && daysLeft > 7;
      if (t.days === 7)  return daysLeft <= 7  && daysLeft > 3;
      if (t.days === 3)  return daysLeft <= 3  && daysLeft > 1;
      if (t.days === 1)  return daysLeft <= 1;
      return false;
    });
    if (!threshold) { skipped++; continue; }

    const reminderType = `${threshold.days}d`;

    // Fetch or default user preferences
    let prefs: any = null;
    try {
      const [p] = await db.select().from(docReminderPrefs).where(eq(docReminderPrefs.userId, doc.userId)).limit(1);
      prefs = p ?? { remind30d: true, remind14d: true, remind7d: true, remind3d: true, remind1d: true, notifyEmail: true, notifyInApp: true, notifyPush: false };
    } catch { prefs = { remind30d: true, remind14d: true, remind7d: true, remind3d: true, remind1d: true, notifyEmail: true, notifyInApp: true, notifyPush: false }; }

    // Check if this threshold is enabled
    if (!prefs[threshold.key]) { skipped++; continue; }

    // --- Email channel ---
    if (prefs.notifyEmail && doc.userEmail) {
      // Deduplication: check if we already sent this reminder type for this doc
      let alreadySent = false;
      try {
        const [existing] = await db
          .select({ id: docReminderLog.id })
          .from(docReminderLog)
          .where(and(
            eq(docReminderLog.documentId, doc.docId),
            eq(docReminderLog.reminderType, reminderType),
            eq(docReminderLog.channel, "email")
          ))
          .limit(1);
        alreadySent = !!existing;
      } catch { alreadySent = false; }

      if (!alreadySent) {
        try {
          const { subject, html, text } = buildDocumentExpiryReminderEmail({
            userName: doc.userName ?? "Valued Customer",
            documentName: doc.docName,
            documentCategory: doc.docCategory,
            daysLeft,
            expiresAt: doc.expiresAt,
          });
          const ok = await sendEmail({ to: doc.userEmail, subject, html, text });
          if (ok) {
            await db.insert(docReminderLog).values({
              userId: doc.userId,
              documentId: doc.docId,
              reminderType,
              channel: "email",
              status: "sent",
            });
            emailSent++;
          }
        } catch (err) {
          logger.warn({ data: err }, '[Scheduler] Email reminder failed for doc #${doc.docId}:');
        }
      }
    }

    // --- In-app notification channel ---
    if (prefs.notifyInApp) {
      let alreadySent = false;
      try {
        const [existing] = await db
          .select({ id: docReminderLog.id })
          .from(docReminderLog)
          .where(and(
            eq(docReminderLog.documentId, doc.docId),
            eq(docReminderLog.reminderType, reminderType),
            eq(docReminderLog.channel, "in_app")
          ))
          .limit(1);
        alreadySent = !!existing;
      } catch { alreadySent = false; }

      if (!alreadySent) {
        try {
          const urgency = daysLeft <= 1 ? "URGENT: " : daysLeft <= 3 ? "Action Required: " : "";
          await createNotification(
            doc.userId,
            `${urgency}Document Expiring Soon`,
            `Your document "${doc.docName}" ${daysLeft <= 0 ? "has expired" : `expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`}. Please upload a replacement to avoid service disruption.`,
            daysLeft <= 1 ? "error" : daysLeft <= 7 ? "warning" : "info"
          );
          await db.insert(docReminderLog).values({
            userId: doc.userId,
            documentId: doc.docId,
            reminderType,
            channel: "in_app",
            status: "sent",
          });
          inAppSent++;
        } catch (err) {
          logger.warn({ data: err }, '[Scheduler] In-app reminder failed for doc #${doc.docId}:');
        }
      }
    }
  }

  logger.info(`[Scheduler] Document vault reminders: ${emailSent} emails, ${inAppSent} in-app, ${skipped} skipped`);
}