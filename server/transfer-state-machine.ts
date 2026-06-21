/**
 * Transfer State Machine
 * Implements the full lifecycle of a cross-border transfer with
 * deterministic state transitions, audit logging, and SSE notifications.
 *
 * States:
 *   initiated → fraud_check → aml_check → kyc_check →
 *   processing → partner_sent → completed
 *                                        ↘ failed
 *                                        ↘ cancelled (only from initiated/fraud_check)
 *                                        ↘ reversed  (only from completed, within 24h)
 */

import { sql, eq } from "drizzle-orm";
import crypto from "crypto";
import { getDb } from "./db.js";
import { transactions, auditLogs, notifications } from "../drizzle/schema.js";
import { broadcastUserEvent } from "./sse.service.js";
import { mojaloopTransfer, pixTransfer, upiTransfer, initiateTransfer } from "./_core/serviceRegistry.js";
import { logger } from './_core/logger';
import { sendEmail, buildTransferCompletedEmail, buildTransferFailedEmail } from "./email.service.js";
import { safeParseAmount } from "./lib/safeDecimal";
import { withTransferLock } from "./lib/transferLock.js";

export type TransferState =
  | "pending"      // initial DB state before pipeline starts
  | "initiated"    // pipeline has started (stored in metadata.pipelineState)
  | "fraud_check"
  | "aml_check"
  | "kyc_check"
  | "processing"
  | "partner_sent"
  | "completed"
  | "failed"
  | "cancelled"
  | "reversed";

export interface StateTransitionResult {
  success: boolean;
  previousState: TransferState;
  newState: TransferState;
  message: string;
  requiresManualReview?: boolean;
  estimatedCompletionMs?: number;
}

/** Valid transitions: from → [allowed next states] */
const VALID_TRANSITIONS: Record<TransferState, TransferState[]> = {
  pending:      ["initiated", "fraud_check", "cancelled"], // allow pending→fraud_check for direct pipeline start
  initiated:    ["fraud_check", "cancelled"],
  fraud_check:  ["aml_check", "failed", "cancelled"],
  aml_check:    ["kyc_check", "failed"],
  kyc_check:    ["processing", "failed"],
  processing:   ["partner_sent", "failed"],
  partner_sent: ["completed", "failed"],
  completed:    ["reversed"],
  failed:       [],
  cancelled:    [],
  reversed:     [],
};

/** Human-readable labels for each state */
export const STATE_LABELS: Record<TransferState, string> = {
  pending:      "Transfer Queued",
  initiated:    "Transfer Initiated",
  fraud_check:  "Fraud Screening",
  aml_check:    "AML Compliance Check",
  kyc_check:    "KYC Verification",
  processing:   "Processing Transfer",
  partner_sent: "Sent to Partner Network",
  completed:    "Transfer Completed",
  failed:       "Transfer Failed",
  cancelled:    "Transfer Cancelled",
  reversed:     "Transfer Reversed",
};

/** Estimated processing time in milliseconds for each state */
const STATE_DURATION_MS: Partial<Record<TransferState, number>> = {
  fraud_check:  2_000,
  aml_check:    3_000,
  kyc_check:    1_000,
  processing:   5_000,
  partner_sent: 30_000,
};

/**
 * Map a pipeline state to the DB tx_status enum value.
 * "initiated" is now a valid DB enum value (added in migration 0028).
 * Sub-states (fraud_check, aml_check, kyc_check, partner_sent) map to "processing".
 */
function toDbStatus(state: TransferState): "initiated" | "pending" | "processing" | "completed" | "failed" | "cancelled" | "reversed" {
  switch (state) {
    case "completed": return "completed";
    case "failed":    return "failed";
    case "cancelled": return "cancelled";
    case "reversed":  return "reversed";
    case "pending":   return "pending";
    case "initiated": return "initiated"; // now a real DB enum value (migration 0028)
    default:          return "processing"; // fraud_check, aml_check, kyc_check, partner_sent
  }
}

/**
 * Advance a transfer to the next state.
 * Validates the transition, updates the DB, logs the audit trail,
 * and pushes an SSE notification to the user.
 *
 * @param transferRef - The transaction reference string (e.g. "RF1234ABCD"), NOT the integer ID.
 */
export async function advanceTransferState(
  transferRef: string,
  userId: number,
  targetState: TransferState,
  options: {
    failureReason?: string;
    partnerReference?: string;
    requiresManualReview?: boolean;
  } = {}
): Promise<StateTransitionResult> {
  // For reversal transitions, acquire a distributed lock to prevent
  // race conditions with concurrent operations (e.g., agent disbursement)
  if (targetState === "reversed") {
    return withTransferLock(transferRef, "reverse transfer", () =>
      advanceTransferStateInternal(transferRef, userId, targetState, options)
    );
  }
  return advanceTransferStateInternal(transferRef, userId, targetState, options);
}

async function advanceTransferStateInternal(
  transferRef: string,
  userId: number,
  targetState: TransferState,
  options: {
    failureReason?: string;
    partnerReference?: string;
    requiresManualReview?: boolean;
  } = {}
): Promise<StateTransitionResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Fetch current state from metadata.pipelineState (or fall back to status column)
  const rows = await db.execute(
    sql`SELECT id, status, reference, metadata, channel FROM transactions WHERE reference = ${transferRef} LIMIT 1`
  );
  const txn = (rows as any[])[0];
  if (!txn) throw new Error(`Transfer ${transferRef} not found`);

  // FIX #6: Block reversal on cash_pickup transfers that have active pickup assignments
  if (targetState === "reversed") {
    const channel = txn.channel as string | undefined;
    const meta = typeof txn.metadata === "string" ? JSON.parse(txn.metadata || "{}") : (txn.metadata ?? {});
    const deliveryMethod = channel ?? (meta as Record<string, unknown>)?.deliveryMethod;
    if (deliveryMethod === "cash_pickup") {
      const pickupRows = await db.execute(
        sql`SELECT status FROM cash_pickup_assignments WHERE transfer_reference = ${transferRef} LIMIT 1`
      );
      const pickup = (pickupRows.rows ?? pickupRows)?.[0] as any;
      if (pickup && (pickup.status === "pending" || pickup.status === "completed")) {
        return {
          success: false,
          previousState: "completed" as TransferState,
          newState: "completed" as TransferState,
          message: pickup.status === "completed"
            ? "Cannot reverse: cash has already been disbursed to the recipient via agent pickup."
            : "Cannot reverse: a pickup assignment is pending. Cancel the pickup first.",
        };
      }
    }
  }

  // Determine current pipeline state from metadata, fall back to status
  let currentMeta: Record<string, unknown> = {};
  try {
    currentMeta = typeof txn.metadata === "string"
      ? JSON.parse(txn.metadata)
      : (txn.metadata ?? {});
  } catch { currentMeta = {}; }
  const currentState = (currentMeta.pipelineState as TransferState | undefined) ?? (txn.status as TransferState);

  const allowed = VALID_TRANSITIONS[currentState] ?? [];
  if (!allowed.includes(targetState)) {
    return {
      success: false,
      previousState: currentState,
      newState: currentState,
      message: `Invalid transition: ${currentState} → ${targetState}. Allowed: [${allowed.join(", ")}]`,
    };
  }

  const now = new Date();
  const dbStatus = toDbStatus(targetState);

  // Build updated metadata preserving existing fields
  const updatedMeta = {
    ...currentMeta,
    pipelineState: targetState,
    pipelineHistory: [
      ...((currentMeta.pipelineHistory as unknown[]) ?? []),
      {
        state: targetState,
        timestamp: now.toISOString(),
        message: STATE_LABELS[targetState],
        failureReason: options.failureReason,
        partnerReference: options.partnerReference,
      },
    ],
    failureReason: options.failureReason ?? currentMeta.failureReason,
    partnerReference: options.partnerReference ?? currentMeta.partnerReference,
  };

  // Update transaction: status (enum-safe) + metadata (pipeline state)
  await db.update(transactions)
    .set({
      status: dbStatus as any,
      metadata: updatedMeta,
      updatedAt: now,
    })
    .where(eq(transactions.reference, transferRef));

  // Insert audit log entry using correct Drizzle column names
  await db.insert(auditLogs).values({
    userId,
    action: "transfer_state_change",
    targetType: "transaction",
    targetId: txn.id,
    description: `Transfer ${transferRef}: ${currentState} → ${targetState}`,
    ipAddress: "system",
    severity: targetState === "failed" ? "critical" : "info",
    metadata: { from: currentState, to: targetState, ...options },
    createdAt: now,
  }).catch(() => {}); // Non-blocking

  // Push SSE notification to user
  const notifTitle = getNotificationTitle(targetState, txn.reference);
  const notifBody  = getNotificationBody(targetState, options);
  broadcastUserEvent(userId, {
    type: "transfer_update",
    payload: {
      transferRef,
      reference: txn.reference,
      state: targetState,
      label: STATE_LABELS[targetState],
      title: notifTitle,
      body: notifBody,
    },
  });

  // Persist in-app notification using correct column names (message not body)
  await db.insert(notifications).values({
    userId,
    type: "transaction" as any,
    title: notifTitle,
    message: notifBody,
    metadata: { transferRef, reference: txn.reference, state: targetState },
    isRead: false,
    createdAt: now,
  }).catch(() => {});

  // ─── Send email notification on terminal states (non-blocking) ────────────────
  if (targetState === "completed" || targetState === "failed") {
    // Fetch user email and transfer details for the email
    getDb().then(async (emailDb) => {
      if (!emailDb) return;
      try {
        const userRows = await emailDb.execute(
          sql`SELECT email, name FROM users WHERE id = ${userId} LIMIT 1`
        );
        const user = (userRows as any[])[0];
        if (!user?.email) return;
        const txRows = await emailDb.execute(
          sql`SELECT from_amount, from_currency, to_amount, to_currency, recipient_name FROM transactions WHERE reference = ${transferRef} LIMIT 1`
        );
        const tx = (txRows as any[])[0];
        if (!tx) return;
        if (targetState === "completed") {
          sendEmail({
            to: user.email,
            ...buildTransferCompletedEmail({
              userName: user.name ?? "Valued Customer",
              recipientName: tx.recipient_name ?? "Recipient",
              amount: Number(tx.from_amount),
              fromCurrency: tx.from_currency,
              toAmount: Number(tx.to_amount),
              toCurrency: tx.to_currency,
              reference: transferRef,
              completedAt: now.toLocaleString(),
            }),
          }).catch(() => {});
        } else if (targetState === "failed") {
          sendEmail({
            to: user.email,
            ...buildTransferFailedEmail({
              userName: user.name ?? "Valued Customer",
              recipientName: tx.recipient_name ?? "Recipient",
              amount: Number(tx.from_amount),
              fromCurrency: tx.from_currency,
              reference: transferRef,
              reason: options.failureReason,
            }),
          }).catch(() => {});
        }
      } catch { /* non-blocking */ }
    }).catch(() => {});
  }

  return {
    success: true,
    previousState: currentState,
    newState: targetState,
    message: STATE_LABELS[targetState],
    requiresManualReview: options.requiresManualReview,
    estimatedCompletionMs: STATE_DURATION_MS[targetState],
  };
}

/**
 * Run the full automated pipeline for a new transfer.
 * Advances through fraud_check → aml_check → kyc_check → processing → partner_sent
 * Each step is non-blocking and runs with realistic delays for simulation.
 *
 * @param transferRef - The transaction reference string (e.g. "RF1234ABCD"), NOT the integer ID.
 */
export async function runTransferPipeline(
  transferRef: string,
  userId: number,
  context: {
    fraudScore: number;   // 0-100, higher = riskier
    amlFlags: string[];
    kycTier: number;      // 0-3
    amountUSD: number;
  }
): Promise<void> {
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
  try {
    // Step 0: Mark as initiated (pipeline has started)
    await advanceTransferState(transferRef, userId, "initiated");
    // Step 1: Fraud check
    await advanceTransferState(transferRef, userId, "fraud_check");
    await delay(STATE_DURATION_MS.fraud_check!);
    if (context.fraudScore >= 80) {
      await advanceTransferState(transferRef, userId, "failed", {
        failureReason: `High fraud risk score (${context.fraudScore}/100). Transfer blocked.`,
        requiresManualReview: true,
      });
      return;
    }
    // Step 2: AML check
    // CTR_REQUIRED and TRAVEL_RULE are informational filing requirements — they
    // must NOT block the transfer.  Only genuinely suspicious flags (SAR_REVIEW
    // with high risk, or EDD_REQUIRED for sanctioned corridors) should hold.
    await advanceTransferState(transferRef, userId, "aml_check");
    await delay(STATE_DURATION_MS.aml_check!);
    const INFORMATIONAL_FLAGS = new Set(["CTR_REQUIRED", "TRAVEL_RULE"]);
    const blockingAmlFlags = context.amlFlags.filter(f => !INFORMATIONAL_FLAGS.has(f));
    if (blockingAmlFlags.length > 0 && context.amountUSD >= 10_000) {
      await advanceTransferState(transferRef, userId, "failed", {
        failureReason: `AML hold: ${blockingAmlFlags.join(", ")}. Manual review required.`,
        requiresManualReview: true,
      });
      return;
    }
    // Step 3: KYC check
    await advanceTransferState(transferRef, userId, "kyc_check");
    await delay(STATE_DURATION_MS.kyc_check!);
    if (context.kycTier === 0 && context.amountUSD > 500) {
      await advanceTransferState(transferRef, userId, "failed", {
        failureReason: "KYC verification required for transfers above $500. Please complete identity verification.",
      });
      return;
    }
    // Step 4: Processing
    await advanceTransferState(transferRef, userId, "processing");
    await delay(STATE_DURATION_MS.processing!);
    // Step 5: Partner sent — route to appropriate payment rail based on corridor
    const db5 = await getDb();
    let partnerRef = `RF-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    if (db5) {
      const [txRow] = await db5.select({
        toCurrency: transactions.toCurrency,
        recipientCountry: transactions.recipientCountry,
        toAmount: transactions.toAmount,
        recipientAccount: transactions.recipientAccount,
        recipientName: transactions.recipientName,
        recipientBank: transactions.recipientBank,
        fromCurrency: transactions.fromCurrency,
        channel: transactions.channel,
        metadata: transactions.metadata,
      }).from(transactions).where(eq(transactions.reference, transferRef)).limit(1);
      if (txRow) {
        const country = (txRow.recipientCountry ?? "").toLowerCase();
        const currency = (txRow.toCurrency ?? "").toUpperCase();
        const amount = safeParseAmount(txRow.toAmount ?? "0");
        // Detect cash_pickup delivery method from channel or metadata
        const metaObj = typeof txRow.metadata === "string" ? JSON.parse(txRow.metadata || "{}") : (txRow.metadata ?? {});
        const deliveryMethod = txRow.channel ?? (metaObj as Record<string, unknown>)?.deliveryMethod ?? "bank_transfer";
        try {
          const fromCur = (txRow.fromCurrency ?? "").toUpperCase();
          if (deliveryMethod === "cash_pickup") {
            // Cash pickup: do NOT route to external payment rail.
            // Funds stay on-platform until agent disburses via verifyAndDisburse.
            // Mark as awaiting_pickup — the agent's cashPickup.verifyAndDisburse will
            // call advanceTransferState(ref, "completed") after verification.
            partnerRef = `CP-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
            logger.info(`[TransferStateMachine] Cash pickup — awaiting agent disbursement for ${transferRef}`);
          } else
          if (fromCur === "CAD" && ["NGN","KES","GHS","TZS","UGX","XOF","ZAR","XAF"].includes(currency)) {
            // Mark Lane FX Bridge (Canadian corridor → African destination)
            const { initiateMarkLaneTransfer } = await import("./integrations/marklane/markLaneClient");
            const mlResult = await initiateMarkLaneTransfer({
              fromCurrency: "CAD",
              toCurrency: currency,
              amount,
              senderName: txRow.recipientName ?? "RemitFlow User",
              senderEmail: "",
              recipientName: txRow.recipientName ?? "Unknown",
              recipientAccount: txRow.recipientAccount ?? "unknown",
              recipientBank: txRow.recipientBank ?? "unknown",
              recipientCountry: country || "NG",
              corridor: `CA-${currency.slice(0, 2)}`,
              purpose: "remittance",
              idempotencyKey: transferRef,
            });
            partnerRef = mlResult.transferId;
          } else if (currency === "BRL" || country.includes("brazil")) {
            // PIX (Brazil)
            const pixResult = await pixTransfer({
              pixKey: txRow.recipientAccount ?? `cpf-${Date.now()}`,
              amount,
              description: `RemitFlow transfer ${transferRef}`,
            });
            partnerRef = pixResult.endToEndId;
          } else if (currency === "INR" || country.includes("india")) {
            // UPI (India)
            const upiResult = await upiTransfer({
              vpa: txRow.recipientAccount ?? `remitflow@upi`,
              amount,
              remarks: `RemitFlow ${transferRef}`,
            });
            partnerRef = upiResult.transactionId;
          } else if (["NGN","KES","GHS","TZS","UGX","XOF","ZAR","MWK","ZMW"].includes(currency) ||
                     ["nigeria","kenya","ghana","tanzania","uganda","senegal","cameroon","south africa"].some(c => country.includes(c))) {
            // Mojaloop (Africa)
            const mojaResult = await mojaloopTransfer({
              payerFsp: "remitflow",
              payeeFsp: txRow.recipientBank ?? "default-fsp",
              amount,
              currency,
              ilpPacket: Buffer.from(JSON.stringify({ ref: transferRef, account: txRow.recipientAccount })).toString("base64"),
            });
            partnerRef = mojaResult.transferId;
          } else {
            // Generic payment rail via transfer-engine
            const genericResult = await initiateTransfer({
              fromUserId: userId,
              fromCurrency: txRow.fromCurrency ?? "USD",
              toCurrency: currency,
              amount,
              rail: "swift",
            });
            partnerRef = genericResult.transferId;
          }
        } catch (railErr) {
          logger.error(`[TransferStateMachine] Payment rail error for ${transferRef}:`, railErr);
          await advanceTransferState(transferRef, userId, "failed", {
            failureReason: `Payment rail disbursement failed: ${railErr instanceof Error ? railErr.message : String(railErr)}. Funds will be returned to sender wallet.`,
            requiresManualReview: true,
          });
          return;
        }
      }
    }
    await advanceTransferState(transferRef, userId, "partner_sent", {
      partnerReference: partnerRef,
    });
    // partner_sent → completed is triggered by webhook/callback from partner network.
    // Do NOT auto-advance — the payment rail webhook handler calls
    // advanceTransferState(ref, userId, "completed") when settlement is confirmed.
  } catch (err) {
    logger.error(`[TransferStateMachine] Pipeline error for ${transferRef}:`, err);
    await advanceTransferState(transferRef, userId, "failed", {
      failureReason: "Internal processing error. Please contact support.",
    }).catch(() => {});
  }
}

function getNotificationTitle(state: TransferState, reference: string): string {
  const map: Partial<Record<TransferState, string>> = {
    fraud_check:  `Transfer ${reference} — Security Check`,
    aml_check:    `Transfer ${reference} — Compliance Review`,
    processing:   `Transfer ${reference} — Processing`,
    partner_sent: `Transfer ${reference} — On Its Way!`,
    completed:    `Transfer ${reference} — Delivered! ✓`,
    failed:       `Transfer ${reference} — Action Required`,
    cancelled:    `Transfer ${reference} — Cancelled`,
    reversed:     `Transfer ${reference} — Reversed`,
  };
  return map[state] ?? `Transfer ${reference} — ${STATE_LABELS[state]}`;
}

function getNotificationBody(state: TransferState, options: { failureReason?: string; partnerReference?: string }): string {
  const map: Partial<Record<TransferState, string>> = {
    fraud_check:  "We're running a quick security check on your transfer. This takes about 2 seconds.",
    aml_check:    "Compliance review in progress. Your transfer will continue shortly.",
    processing:   "Your transfer is being processed. Funds will arrive soon.",
    partner_sent: `Your transfer has been sent to our partner network. Reference: ${options.partnerReference ?? "pending"}.`,
    completed:    "Your transfer has been delivered successfully. The recipient should have the funds now.",
    failed:       options.failureReason ?? "Your transfer could not be completed. Please contact support.",
    cancelled:    "Your transfer has been cancelled. No funds were deducted.",
    reversed:     "Your transfer has been reversed. Funds will be returned to your wallet within 1-2 business days.",
  };
  return map[state] ?? STATE_LABELS[state];
}
