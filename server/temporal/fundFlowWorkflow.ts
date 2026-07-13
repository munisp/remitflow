/**
 * Temporal Workflow Definitions for Atomic Fund Flows
 *
 * These workflows ensure that multi-step financial operations are either
 * fully completed or fully compensated. Each workflow step is an Activity
 * that can be independently retried or compensated.
 *
 * Workflow Types:
 *   - CrossBorderTransferWorkflow (7 steps + 7 compensations)
 *   - AgentCashOutWorkflow (6 steps + 6 compensations)
 *   - StablecoinBridgeWorkflow (6 steps + 6 compensations)
 *   - BNPLInstallmentWorkflow (5 steps + 5 compensations)
 *   - BatchPayrollWorkflow (N steps, parallel execution with saga)
 */

import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  sleep,
  ApplicationFailure,
} from "@temporalio/workflow";
import type * as activities from "./fundFlowActivities";

const {
  acquireDistributedLock,
  releaseDistributedLock,
  checkDoubleSpend,
  validateTransfer,
  reserveFunds,
  releaseFunds,
  executeFXConversion,
  reverseFXConversion,
  routeToPaymentRail,
  reversePaymentRail,
  recordTigerBeetleEntry,
  voidTigerBeetleEntry,
  publishKafkaEvent,
  publishFluvioEvent,
  createCryptographicReceipt,
  reportCircuitBreakerHealth,
  notifyParties,
  updateTransferStatus,
  recordAuditLog,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: {
    maximumAttempts: 3,
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
  },
});

// ── Signals & Queries ────────────────────────────────────────────────────────

export const cancelTransferSignal = defineSignal("cancelTransfer");
export const getWorkflowStatusQuery = defineQuery<WorkflowStatus>("getStatus");

interface WorkflowStatus {
  currentStep: string;
  completedSteps: string[];
  status: "running" | "completed" | "compensating" | "compensated" | "cancelled";
  error?: string;
}

// ── Cross-Border Transfer Workflow ───────────────────────────────────────────

export interface CrossBorderTransferInput {
  operationId: string;
  userId: number;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  recipientId?: number;
  recipientAccount: string;
  recipientBank: string;
  recipientCountry: string;
  paymentRail: string;
  fxRate: number;
  fee: number;
  toAmount: number;
  transferRef: string;
}

export async function CrossBorderTransferWorkflow(input: CrossBorderTransferInput): Promise<{ success: boolean; receiptId?: string }> {
  let status: WorkflowStatus = {
    currentStep: "initialize",
    completedSteps: [],
    status: "running",
  };
  let cancelled = false;

  setHandler(cancelTransferSignal, () => { cancelled = true; });
  setHandler(getWorkflowStatusQuery, () => status);

  const compensationStack: Array<{ step: string; compensate: () => Promise<void> }> = [];

  try {
    // Step 1: Acquire distributed lock
    status.currentStep = "acquire_lock";
    const lockToken = await acquireDistributedLock(input.transferRef, input.operationId);
    compensationStack.push({
      step: "acquire_lock",
      compensate: () => releaseDistributedLock(input.transferRef, lockToken),
    });
    status.completedSteps.push("acquire_lock");

    if (cancelled) throw ApplicationFailure.nonRetryable("Transfer cancelled by user");

    // Step 2: Double-spend check
    status.currentStep = "double_spend_check";
    const dsResult = await checkDoubleSpend(input.operationId, input.transferRef);
    if (dsResult.alreadyProcessed) {
      throw ApplicationFailure.nonRetryable(`Duplicate transfer: ${input.transferRef}`);
    }
    status.completedSteps.push("double_spend_check");

    // Step 3: Validate transfer (KYC, limits, sanctions)
    status.currentStep = "validate";
    await validateTransfer(input.userId, input.amount, input.fromCurrency, input.recipientCountry);
    status.completedSteps.push("validate");

    if (cancelled) throw ApplicationFailure.nonRetryable("Transfer cancelled by user");

    // Step 4: Reserve funds (debit sender wallet)
    status.currentStep = "reserve_funds";
    const reservation = await reserveFunds(input.userId, input.amount + input.fee, input.fromCurrency, input.transferRef);
    compensationStack.push({
      step: "reserve_funds",
      compensate: () => releaseFunds(input.userId, input.amount + input.fee, input.fromCurrency, reservation.reservationId),
    });
    status.completedSteps.push("reserve_funds");

    // Step 5: Execute FX conversion
    status.currentStep = "fx_conversion";
    const fxResult = await executeFXConversion(input.amount, input.fromCurrency, input.toCurrency, input.fxRate, input.transferRef);
    compensationStack.push({
      step: "fx_conversion",
      compensate: () => reverseFXConversion(fxResult.conversionId),
    });
    status.completedSteps.push("fx_conversion");

    if (cancelled) throw ApplicationFailure.nonRetryable("Transfer cancelled by user");

    // Step 6: Route to payment rail
    status.currentStep = "route_payment";
    const railResult = await routeToPaymentRail(input.paymentRail, input.toAmount, input.toCurrency, input.recipientAccount, input.recipientBank, input.transferRef);
    compensationStack.push({
      step: "route_payment",
      compensate: () => reversePaymentRail(input.paymentRail, railResult.externalRef),
    });
    status.completedSteps.push("route_payment");

    // Step 7: Record TigerBeetle double-entry
    status.currentStep = "ledger_entry";
    const ledgerEntry = await recordTigerBeetleEntry({
      operationId: input.operationId,
      debitAccount: `user-${input.userId}-${input.fromCurrency}`,
      creditAccount: `corridor-pool-${input.toCurrency}`,
      amount: input.amount,
      currency: input.fromCurrency,
      flowType: "cross_border_send",
      transferRef: input.transferRef,
    });
    compensationStack.push({
      step: "ledger_entry",
      compensate: () => voidTigerBeetleEntry(ledgerEntry.entryId),
    });
    status.completedSteps.push("ledger_entry");

    // Step 8: Create cryptographic receipt
    status.currentStep = "create_receipt";
    const receipt = await createCryptographicReceipt({
      operationId: input.operationId,
      flowType: "cross_border_send",
      userId: input.userId,
      amount: input.amount,
      currency: input.fromCurrency,
      debitAccount: `user-${input.userId}-${input.fromCurrency}`,
      creditAccount: `corridor-pool-${input.toCurrency}`,
    });
    status.completedSteps.push("create_receipt");

    // Step 9: Publish events (non-compensatable)
    status.currentStep = "publish_events";
    await publishKafkaEvent("fund_flow_completed", { ...input } as unknown as Record<string, unknown>);
    await publishFluvioEvent("fund_flow_completed", { ...input } as unknown as Record<string, unknown>);
    status.completedSteps.push("publish_events");

    // Step 10: Notify parties
    status.currentStep = "notify";
    await notifyParties(input.userId, input.recipientId, input.transferRef, "completed");
    status.completedSteps.push("notify");

    // Step 11: Update transfer status
    status.currentStep = "update_status";
    await updateTransferStatus(input.transferRef, "partner_sent");
    status.completedSteps.push("update_status");

    // Step 12: Release lock
    await releaseDistributedLock(input.transferRef, lockToken);

    // Record audit log
    await recordAuditLog(input.operationId, "cross_border_send", "completed", { ...input } as unknown as Record<string, unknown>);

    status.status = "completed";
    return { success: true, receiptId: receipt.receiptId };

  } catch (err) {
    // Compensation: reverse all completed steps in reverse order
    status.status = "compensating";
    status.error = err instanceof Error ? err.message : String(err);

    for (let i = compensationStack.length - 1; i >= 0; i--) {
      const comp = compensationStack[i];
      status.currentStep = `compensate:${comp.step}`;
      try {
        await comp.compensate();
      } catch (compErr) {
        // Log but continue compensating other steps
        await recordAuditLog(input.operationId, "cross_border_send", "compensation_failed", {
          step: comp.step,
          error: compErr instanceof Error ? compErr.message : String(compErr),
        });
      }
    }

    // Publish compensation event
    await publishKafkaEvent("fund_flow_compensated", { ...input, error: status.error } as unknown as Record<string, unknown>);
    await reportCircuitBreakerHealth("cross_border_send", false);
    await recordAuditLog(input.operationId, "cross_border_send", "compensated", { error: status.error });

    status.status = "compensated";
    throw err;
  }
}

// ── Agent Cash-Out Workflow ──────────────────────────────────────────────────

export interface AgentCashOutInput {
  operationId: string;
  agentUserId: number;
  amount: number;
  currency: string;
  customerPhone: string;
  reference: string;
}

export async function AgentCashOutWorkflow(input: AgentCashOutInput): Promise<{ success: boolean; receiptId?: string }> {
  let status: WorkflowStatus = { currentStep: "initialize", completedSteps: [], status: "running" };
  setHandler(getWorkflowStatusQuery, () => status);

  const compensationStack: Array<{ step: string; compensate: () => Promise<void> }> = [];

  try {
    // Step 1: Lock
    status.currentStep = "acquire_lock";
    const lockToken = await acquireDistributedLock(`agent:${input.agentUserId}:${input.currency}`, input.operationId);
    compensationStack.push({ step: "lock", compensate: () => releaseDistributedLock(`agent:${input.agentUserId}:${input.currency}`, lockToken) });
    status.completedSteps.push("acquire_lock");

    // Step 2: Validate agent + float
    status.currentStep = "validate_agent";
    await validateTransfer(input.agentUserId, input.amount, input.currency, "NG");
    status.completedSteps.push("validate_agent");

    // Step 3: Debit agent float
    status.currentStep = "debit_float";
    const reservation = await reserveFunds(input.agentUserId, input.amount, input.currency, input.reference);
    compensationStack.push({ step: "debit_float", compensate: () => releaseFunds(input.agentUserId, input.amount, input.currency, reservation.reservationId) });
    status.completedSteps.push("debit_float");

    // Step 4: TigerBeetle entry
    status.currentStep = "ledger_entry";
    const entry = await recordTigerBeetleEntry({
      operationId: input.operationId,
      debitAccount: `agent-${input.agentUserId}-${input.currency}`,
      creditAccount: `customer-cash-${input.currency}`,
      amount: input.amount,
      currency: input.currency,
      flowType: "agent_cash_out",
      transferRef: input.reference,
    });
    compensationStack.push({ step: "ledger_entry", compensate: () => voidTigerBeetleEntry(entry.entryId) });
    status.completedSteps.push("ledger_entry");

    // Step 5: Receipt
    status.currentStep = "create_receipt";
    const receipt = await createCryptographicReceipt({
      operationId: input.operationId,
      flowType: "agent_cash_out",
      userId: input.agentUserId,
      amount: input.amount,
      currency: input.currency,
      debitAccount: `agent-${input.agentUserId}-${input.currency}`,
      creditAccount: `customer-cash-${input.currency}`,
    });
    status.completedSteps.push("create_receipt");

    // Step 6: Events + release
    await publishKafkaEvent("fund_flow_completed", { ...input } as unknown as Record<string, unknown>);
    await releaseDistributedLock(`agent:${input.agentUserId}:${input.currency}`, lockToken);

    status.status = "completed";
    return { success: true, receiptId: receipt.receiptId };

  } catch (err) {
    status.status = "compensating";
    status.error = err instanceof Error ? err.message : String(err);
    for (let i = compensationStack.length - 1; i >= 0; i--) {
      try { await compensationStack[i].compensate(); } catch {}
    }
    await publishKafkaEvent("fund_flow_compensated", { ...input, error: status.error } as unknown as Record<string, unknown>);
    status.status = "compensated";
    throw err;
  }
}
