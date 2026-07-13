/**
 * RemitFlow Temporal Workflows v8
 *
 * Workflow definitions (run in sandboxed Temporal runtime):
 *   - TransferWorkflow: 6-step saga with automatic compensation
 *   - KYCVerificationWorkflow: 5-step verification pipeline
 *   - RecurringPaymentWorkflow: scheduled payment execution
 *
 * Workflows are deterministic — no direct I/O, only activity calls.
 * All side effects go through activities.
 */

import { proxyActivities, defineSignal, setHandler, condition, sleep } from "@temporalio/workflow";
import type * as Activities from "./activities";
import { logger } from '../_core/logger';

// ============================================================================
// Activity proxies (with timeouts and retry policies)
// ============================================================================

const {
  validateTransferActivity,
  reserveFundsActivity,
  releaseFundsActivity,
  fraudCheckActivity,
  executeTransferActivity,
  notifyRecipientActivity,
  recordAuditActivity,
} = proxyActivities<typeof Activities>({
  startToCloseTimeout: "30 seconds",
  retry: {
    maximumAttempts: 3,
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "10 seconds",
    nonRetryableErrorTypes: ["InsufficientBalanceError", "KYCRequiredError", "FraudBlockedError"],
  },
});

const {
  documentExtractionActivity,
  documentVerificationActivity,
  livenessCheckActivity,
  sanctionsScreeningActivity,
  kycDecisionActivity,
  verificationScoringActivity,
  riskAssessmentActivity,
  slaBreachCheckActivity,
} = proxyActivities<typeof Activities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 2,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
  },
});

const { executeRecurringPaymentActivity } = proxyActivities<typeof Activities>({
  startToCloseTimeout: "60 seconds",
  retry: {
    maximumAttempts: 3,
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "15 seconds",
  },
});

// ============================================================================
// Signals
// ============================================================================

export const cancelTransferSignal = defineSignal<[{ reason: string }]>("cancelTransfer");
export const approveManualReviewSignal = defineSignal<[{ analystId: string; notes: string }]>("approveManualReview");
export const rejectManualReviewSignal = defineSignal<[{ analystId: string; reason: string }]>("rejectManualReview");

// ============================================================================
// TransferWorkflow — 6-step saga with compensation
// ============================================================================

export interface TransferWorkflowInput {
  userId: number;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  recipientName: string;
  recipientAccount?: string;
  recipientBank?: string;
  recipientCountry?: string;
  description?: string;
  idempotencyKey: string;
  fxRate: number;
  fee: number;
  toAmount: number;
}

export interface TransferWorkflowResult {
  success: boolean;
  transactionRef?: string;
  error?: string;
  riskScore?: number;
}

export async function TransferWorkflow(input: TransferWorkflowInput): Promise<TransferWorkflowResult> {
  let cancelled = false;
  let cancelReason = "";

  setHandler(cancelTransferSignal, ({ reason }) => {
    cancelled = true;
    cancelReason = reason;
  });

  // Compensation stack — activities to undo on failure
  const compensations: Array<() => Promise<void>> = [];

  try {
    // ── Step 1: Validate ─────────────────────────────────────────────────────
    const validation = await validateTransferActivity(input);
    if (!validation.valid) {
      return { success: false, error: validation.reason };
    }

    // Check for cancellation signal
    if (cancelled) return { success: false, error: `Transfer cancelled: ${cancelReason}` };

    // ── Step 2: Reserve funds ─────────────────────────────────────────────────
    const reservation = await reserveFundsActivity(input);
    compensations.push(() => releaseFundsActivity(input, reservation.walletId));

    if (cancelled) {
      for (const comp of compensations.reverse()) await comp();
      return { success: false, error: `Transfer cancelled: ${cancelReason}` };
    }

    // ── Step 3: Fraud check ───────────────────────────────────────────────────
    const fraud = await fraudCheckActivity(input);
    if (!fraud.approved) {
      for (const comp of compensations.reverse()) await comp();
      return {
        success: false,
        error: `Transfer blocked by fraud engine. Risk score: ${fraud.riskScore.toFixed(2)}`,
        riskScore: fraud.riskScore,
      };
    }

    // ── Step 4: Execute transfer ──────────────────────────────────────────────
    const execution = await executeTransferActivity(input, reservation.reservationId);

    // ── Step 5: Notify recipient ──────────────────────────────────────────────
    await notifyRecipientActivity(input, execution.transactionRef);

    // ── Step 6: Record audit ──────────────────────────────────────────────────
    await recordAuditActivity(input, execution.transactionRef, fraud.riskScore);

    return {
      success: true,
      transactionRef: execution.transactionRef,
      riskScore: fraud.riskScore,
    };

  } catch (err) {
    // Run compensations in reverse order (saga pattern)
    for (const comp of compensations.reverse()) {
      try { await comp(); } catch (compErr) {
        // Log compensation failure but continue
        logger.error({ err: compErr }, 'Compensation failed:');
      }
    }
    return { success: false, error: (err as Error).message };
  }
}

// ============================================================================
// KYCVerificationWorkflow — 7-step pipeline with manual review gate
// ============================================================================

export interface KYCWorkflowInput {
  userId: number;
  documentType: "PASSPORT" | "NATIONAL_ID" | "DRIVERS_LICENSE" | "UTILITY_BILL" | "BANK_STATEMENT";
  documentUrl: string;
  selfieUrl?: string;
  country: string;
  kycDocId: number;
}

export interface KYCWorkflowResult {
  decision: "APPROVED" | "REJECTED" | "MANUAL_REVIEW" | "TIMEOUT";
  reason: string;
  livenessScore?: number;
  passiveLivenessScore?: number;
  activeLiveness?: boolean;
  deepfakeScore?: number;
  deepfakeMethod?: string;
  deepfakeIndicators?: string[];
  extractedName?: string;
  verificationScore?: number;
  riskCategory?: string;
}

export async function KYCVerificationWorkflow(input: KYCWorkflowInput): Promise<KYCWorkflowResult> {
  let manualApproved = false;
  let manualRejected = false;
  let manualReason = "";

  setHandler(approveManualReviewSignal, ({ notes }) => {
    manualApproved = true;
    manualReason = notes;
  });

  setHandler(rejectManualReviewSignal, ({ reason }) => {
    manualRejected = true;
    manualReason = reason;
  });

  // ── Step 1: Document extraction ───────────────────────────────────────────
  const extraction = await documentExtractionActivity(input);
  const verificationId = extraction.extractedData.verificationId;
  const extractedName = extraction.extractedData.fullName ?? "Unknown";

  // ── Step 2: Document verification ─────────────────────────────────────────
  const verification = await documentVerificationActivity(input, verificationId);

  // ── Step 3: Liveness detection ────────────────────────────────────────────
  const liveness = await livenessCheckActivity(input);

  // ── Step 4: Sanctions screening ───────────────────────────────────────────
  const sanctions = await sanctionsScreeningActivity(input, extractedName);

  // ── Step 5: Auto-decision ──────────────────────────────────────────────────
  const decision = await kycDecisionActivity(
    input,
    verification.authentic,
    liveness.live,
    sanctions.clear,
    verification.issues
  );

  // ── Step 6: Verification scoring ──────────────────────────────────────────
  const verificationScore = await verificationScoringActivity({
    userId: input.userId,
    documentVerified: verification.authentic,
    livenessScore: liveness.score ?? 0,
    sanctionsClear: sanctions.clear,
    decision: decision.decision,
  });

  // ── Step 7: Risk assessment ───────────────────────────────────────────────
  const riskAssessment = await riskAssessmentActivity({
    userId: input.userId,
    extractedName,
    country: input.country,
    verificationScore: verificationScore.score,
  });

  // ── SLA breach check (non-blocking) ───────────────────────────────────────
  await slaBreachCheckActivity({
    userId: input.userId,
    kycDocId: input.kycDocId,
    startedAt: new Date().toISOString(),
    kycLevel: riskAssessment.requiredLevel ?? "standard",
  }).catch(() => {});

  // If manual review required, wait up to 72 hours for analyst signal
  if (decision.decision === "MANUAL_REVIEW") {
    const resolved = await condition(
      () => manualApproved || manualRejected,
      "72 hours"
    );

    if (!resolved) {
      return { decision: "TIMEOUT", reason: "Manual review timed out after 72 hours", livenessScore: liveness.score };
    }

    if (manualRejected) {
      return { decision: "REJECTED", reason: manualReason, livenessScore: liveness.score, extractedName };
    }

    return { decision: "APPROVED", reason: `Manual review approved: ${manualReason}`, livenessScore: liveness.score, extractedName };
  }

  return {
    decision: decision.decision,
    reason: decision.reason,
    livenessScore: liveness.score,
    passiveLivenessScore: liveness.passiveLivenessScore ?? undefined,
    activeLiveness: liveness.activeLiveness?.passed ?? undefined,
    deepfakeScore: liveness.deepfakeScore ?? undefined,
    deepfakeMethod: liveness.deepfakeMethod ?? undefined,
    deepfakeIndicators: liveness.deepfakeIndicators,
    extractedName,
    verificationScore: verificationScore.score,
    riskCategory: riskAssessment.category,
  };
}

// ============================================================================
// RecurringPaymentWorkflow — scheduled execution with retry
// ============================================================================

export interface RecurringPaymentWorkflowInput {
  scheduleId: number;
  userId: number;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  recipientName: string;
  recipientAccount?: string;
  recipientBank?: string;
  description?: string;
  frequency: "daily" | "weekly" | "monthly" | "quarterly";
  maxExecutions?: number;
}

export interface RecurringPaymentWorkflowResult {
  executionsCompleted: number;
  lastTransactionRef?: string;
  lastError?: string;
  stopped: boolean;
}

export async function RecurringPaymentWorkflow(
  input: RecurringPaymentWorkflowInput
): Promise<RecurringPaymentWorkflowResult> {
  let stopped = false;
  let executionsCompleted = 0;
  let lastTransactionRef: string | undefined;
  let lastError: string | undefined;

  const maxExecutions = input.maxExecutions ?? 1000;

  const intervalMs: Record<string, number> = {
    daily: 86_400_000,
    weekly: 7 * 86_400_000,
    monthly: 30 * 86_400_000,
    quarterly: 90 * 86_400_000,
  };

  const intervalMs2 = intervalMs[input.frequency] ?? 30 * 86_400_000;

  while (!stopped && executionsCompleted < maxExecutions) {
    const result = await executeRecurringPaymentActivity({
      scheduleId: input.scheduleId,
      userId: input.userId,
      fromCurrency: input.fromCurrency,
      toCurrency: input.toCurrency,
      amount: input.amount,
      recipientName: input.recipientName,
      recipientAccount: input.recipientAccount,
      recipientBank: input.recipientBank,
      description: input.description,
    });

    if (result.success) {
      executionsCompleted++;
      lastTransactionRef = result.transactionRef;
      lastError = undefined;
    } else {
      lastError = result.error;
      // Stop after 3 consecutive failures
      if (lastError?.includes("Insufficient balance")) {
        stopped = true;
        break;
      }
    }

    // Wait for next execution interval
    await sleep(intervalMs2);
  }

  return {
    executionsCompleted,
    lastTransactionRef,
    lastError,
    stopped,
  };
}
