/**
 * fundFlowIntegration.ts — Wires the Atomicity Middleware into All 14 Fund Flow Paths
 *
 * This module provides wrapper functions that ensure every financial mutation
 * flows through the full atomicity stack:
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  Client Request (APISix circuit breaker / rate limit) │
 *   └──────────────────────┬──────────────────────────────┘
 *                          │
 *   ┌──────────────────────▼──────────────────────────────┐
 *   │  1. Redis Idempotency Check (24h window)             │
 *   ├──────────────────────────────────────────────────────┤
 *   │  2. Redis Distributed Lock (30s TTL, fencing token)  │
 *   ├──────────────────────────────────────────────────────┤
 *   │  3. Rust Transaction Guard — double-spend check      │
 *   ├──────────────────────────────────────────────────────┤
 *   │  4. PostgreSQL BEGIN SERIALIZABLE                    │
 *   │     └─ Wallet debit with WHERE balance >= amount     │
 *   │     └─ Transaction record                            │
 *   ├──────────────────────────────────────────────────────┤
 *   │  5. TigerBeetle Double-Entry (debit + credit)        │
 *   ├──────────────────────────────────────────────────────┤
 *   │  6. Kafka Event (audit trail)                        │
 *   │  7. Fluvio Event (real-time streaming)               │
 *   ├──────────────────────────────────────────────────────┤
 *   │  8. Temporal Saga (for multi-step: cross-border,     │
 *   │     stablecoin bridge, BNPL installments)            │
 *   ├──────────────────────────────────────────────────────┤
 *   │  9. Rust Transaction Guard — receipt (hash chain)    │
 *   ├──────────────────────────────────────────────────────┤
 *   │  10. Redis Store Idempotency Result                  │
 *   │  11. Release Lock                                    │
 *   └─────────────────────────────────────────────────────┘
 *
 * If any step 4-8 fails:
 *   - Temporal compensates (releases funds, reverses credits)
 *   - Kafka publishes fund_flow_failed event
 *   - Python reconciliation engine picks up from DLQ
 *   - Go orchestrator reports circuit breaker state to APISix
 */

import { TRPCError } from "@trpc/server";
import { randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { logger } from "../_core/logger.js";
import { getDb } from "../db";
import {
  withAtomicFundFlow,
  type AtomicOperation,
  type AtomicResult,
  type FundFlowType,
  publishFundFlowEvent,
  recordDoubleEntry,
} from "./fundFlowAtomicity";
import { publishEvent, KAFKA_TOPICS } from "./kafka";

// ── W20 telemetry counters (fail-open, never silent) ─────────────────────────

export const fundFlowIntegrationMetrics = {
  /** Orchestrator outages that forced a saga_pending_registrations row. */
  sagaPendingRegistrations: 0,
  /** Failures persisting the pending-registration row itself. */
  sagaRegistrationPersistErrors: 0,
  /** Python-reconciliation HTTP fallback failures (was: silently swallowed). */
  dlqHttpFallbackFailures: 0,
  /** Kafka FUND_FLOW_DLQ publish failures. */
  dlqKafkaPublishFailures: 0,
};

export function getFundFlowIntegrationMetrics(): Readonly<typeof fundFlowIntegrationMetrics> {
  return { ...fundFlowIntegrationMetrics };
}

// ── Configuration ────────────────────────────────────────────────────────────

const GO_ORCHESTRATOR_URL = process.env.GO_ORCHESTRATOR_URL ?? "http://localhost:8150";
const RUST_GUARD_URL = process.env.RUST_GUARD_URL ?? "http://localhost:8160";
const PYTHON_RECONCILIATION_URL = process.env.PYTHON_RECONCILIATION_URL ?? "http://localhost:8170";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FundFlowParams {
  userId: number;
  amount: number;
  currency: string;
  flowType: FundFlowType;
  /** Idempotency key — must be unique per operation */
  idempotencyKey?: string;
  /** Transfer reference (for transfers, agent cash-out, etc.) */
  transferRef?: string;
  /** Counterparty user ID (recipient, agent, etc.) */
  counterpartyId?: number;
  /** Account to debit (format: "user-{userId}-{currency}") */
  debitAccount?: string;
  /** Account to credit */
  creditAccount?: string;
  /** Balance before operation (for receipt chain) */
  balancePre?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface FundFlowResult<T> {
  success: boolean;
  data?: T;
  receiptId?: string;
  ledgerEntryId?: string;
  sagaId?: string;
  error?: string;
}

// ── Main Integration Function ────────────────────────────────────────────────

/**
 * executeAtomicFundFlow — the single entry point for ALL fund-moving operations.
 *
 * Wraps any financial mutation with:
 *   - Distributed lock (prevents concurrent modifications)
 *   - Idempotency (prevents duplicate processing)
 *   - Double-spend check (Rust guard)
 *   - TigerBeetle double-entry
 *   - Kafka/Fluvio event streaming
 *   - Go saga orchestration
 *   - Rust cryptographic receipt
 *   - Compensation on failure
 *
 * Usage:
 * ```ts
 * const result = await executeAtomicFundFlow(
 *   { userId, amount, currency, flowType: "agent_cash_out", transferRef: ref },
 *   async () => {
 *     // Your actual business logic here (wallet debit, etc.)
 *     return { txId, reference };
 *   },
 *   async () => {
 *     // Compensation logic (reverse the debit)
 *   }
 * );
 * ```
 */
export async function executeAtomicFundFlow<T>(
  params: FundFlowParams,
  operation: () => Promise<T>,
  compensate?: () => Promise<void>,
): Promise<FundFlowResult<T>> {
  const operationId = params.idempotencyKey ?? randomBytes(16).toString("hex");
  const debitAccount = params.debitAccount ?? `user-${params.userId}-${params.currency}`;
  const creditAccount = params.creditAccount ?? `platform-${params.currency}`;

  // Step 1: Double-spend check via Rust Transaction Guard (best-effort)
  const doubleSpendResult = await checkDoubleSpend(operationId, params.transferRef ?? operationId);
  if (doubleSpendResult?.already_processed) {
    logger.warn({ operationId }, "[FundFlow] Double-spend detected, blocking operation");
    return {
      success: false,
      error: `Operation already processed (receipt: ${doubleSpendResult.original_receipt})`,
    };
  }

  // Step 2: Start saga tracking via Go Orchestrator (best-effort)
  const sagaId = await startSaga(params, operationId);

  // W20 DL-22: an orchestrator outage must NEVER leave sagaId silently null —
  // without a saga id, later compensation is a no-op and funds can be left
  // held. Persist a saga_pending_registrations row so a reconciler can attach
  // compensation once the orchestrator recovers.
  if (!sagaId) {
    fundFlowIntegrationMetrics.sagaPendingRegistrations++;
    logger.warn(
      { operationId, flowType: params.flowType, userId: params.userId },
      "[FundFlow] Orchestrator unavailable — recording saga_pending_registrations row for later compensation attach",
    );
    try {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await (db as any).execute(sql`
        INSERT INTO saga_pending_registrations (operation_id, flow_type, user_id, amount, currency, transfer_ref, status, created_at)
        VALUES (${operationId}, ${params.flowType}, ${params.userId}, ${params.amount}, ${params.currency}, ${params.transferRef ?? null}, 'pending', NOW())
        ON CONFLICT (operation_id) DO NOTHING
      `);
    } catch (err) {
      // Fail-open for the operation itself (withAtomicFundFlow fails closed on
      // its own DB writes), but NEVER silent: log + counter.
      fundFlowIntegrationMetrics.sagaRegistrationPersistErrors++;
      logger.error(
        { operationId, err: err instanceof Error ? err.message : String(err) },
        "[FundFlow] CRITICAL: could not persist saga_pending_registrations row — compensation unattached, MANUAL RECONCILIATION REQUIRED",
      );
    }
  } else {
    // W20 DL-10: produce FUND_FLOW_SAGAS lifecycle events (best-effort telemetry).
    publishEvent(KAFKA_TOPICS.FUND_FLOW_SAGAS, operationId, {
      sagaId,
      operationId,
      flowType: params.flowType,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      phase: "started",
      timestamp: new Date().toISOString(),
    }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[FundFlow] saga-started event publish failed"));
  }

  // Step 3: Execute with full atomicity (lock + idempotency + ledger + events)
  const atomicOp: AtomicOperation = {
    operationId,
    flowType: params.flowType,
    userId: params.userId,
    amount: params.amount,
    currency: params.currency,
    counterpartyId: params.counterpartyId,
    transferRef: params.transferRef,
    metadata: params.metadata,
  };

  const result = await withAtomicFundFlow<T>(
    atomicOp,
    operation,
    {
      recordLedger: true,
      debitAccount,
      creditAccount,
      compensate: async () => {
        // Compensate via saga orchestrator
        if (sagaId) await compensateSaga(sagaId, "Operation failed");
        if (compensate) await compensate();
      },
    },
  );

  if (result.success && result.data) {
    // Step 4: Create cryptographic receipt via Rust Transaction Guard
    const receiptId = await createReceipt({
      operationId,
      flowType: params.flowType,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      debitAccount,
      creditAccount,
      balancePre: params.balancePre ?? 0,
      balancePost: (params.balancePre ?? 0) - params.amount,
    });

    // Step 5: Mark saga completed
    if (sagaId) {
      await completeSaga(sagaId);
      publishEvent(KAFKA_TOPICS.FUND_FLOW_SAGAS, operationId, {
        sagaId, operationId, flowType: params.flowType, userId: params.userId,
        amount: params.amount, currency: params.currency, phase: "completed",
        timestamp: new Date().toISOString(),
      }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[FundFlow] saga-completed event publish failed"));
    }

    // Step 6: Report circuit breaker success
    await reportCircuitBreaker(params.flowType, true);

    return {
      success: true,
      data: result.data,
      receiptId,
      ledgerEntryId: result.ledgerEntryId,
      sagaId,
    };
  }

  // On failure: report to circuit breaker + DLQ
  await reportCircuitBreaker(params.flowType, false);
  await submitToDLQ(params, operationId, result.error ?? "Unknown error");

  return {
    success: false,
    error: result.error,
    sagaId,
  };
}

// ── Service Calls (best-effort, non-blocking) ────────────────────────────────

async function checkDoubleSpend(
  operationId: string,
  transferRef: string,
): Promise<{ already_processed: boolean; original_receipt?: string } | null> {
  try {
    const res = await fetch(`${RUST_GUARD_URL}/double-spend/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation_id: operationId, transfer_ref: transferRef }),
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) return await res.json() as { already_processed: boolean; original_receipt?: string };
  } catch {
    // Rust guard unavailable — proceed without (defense in depth, not single point)
  }
  return null;
}

async function createReceipt(params: {
  operationId: string;
  flowType: string;
  userId: number;
  amount: number;
  currency: string;
  debitAccount: string;
  creditAccount: string;
  balancePre: number;
  balancePost: number;
}): Promise<string | undefined> {
  try {
    const res = await fetch(`${RUST_GUARD_URL}/receipt/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation_id: params.operationId,
        flow_type: params.flowType,
        user_id: params.userId,
        amount: params.amount,
        currency: params.currency,
        debit_account: params.debitAccount,
        credit_account: params.creditAccount,
        balance_pre: params.balancePre,
        balance_post: params.balancePost,
      }),
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const data = await res.json() as { receipt_id: string };
      return data.receipt_id;
    }
  } catch {
    // Non-critical — receipt is for audit, not blocking
  }
  return undefined;
}

async function startSaga(params: FundFlowParams, operationId: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${GO_ORCHESTRATOR_URL}/saga/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId,
        flowType: params.flowType,
        userId: params.userId,
        amount: params.amount,
        currency: params.currency,
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json() as { sagaId: string };
      return data.sagaId;
    }
  } catch {
    // Go orchestrator unavailable — proceed without saga tracking
  }
  return undefined;
}

async function completeSaga(sagaId: string): Promise<void> {
  try {
    await fetch(`${GO_ORCHESTRATOR_URL}/saga/${sagaId}/step-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepName: "complete" }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Non-blocking
  }
}

async function compensateSaga(sagaId: string, reason: string): Promise<void> {
  try {
    await fetch(`${GO_ORCHESTRATOR_URL}/saga/${sagaId}/compensate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ failedStep: "execute", reason }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Non-blocking
  }
}

async function reportCircuitBreaker(service: string, success: boolean): Promise<void> {
  try {
    await fetch(`${GO_ORCHESTRATOR_URL}/circuit-breaker/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service, success }),
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    // Non-blocking
  }
}

async function submitToDLQ(params: FundFlowParams, operationId: string, error: string): Promise<void> {
  // Submit to Python reconciliation engine's DLQ (best-effort HTTP fallback).
  // W20 DL-07: the engine may be an orphan — a failure here is logged and
  // counted, NEVER swallowed, because the Kafka DLQ below is the durable path.
  try {
    const res = await fetch(`${PYTHON_RECONCILIATION_URL}/dlq/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation_id: operationId,
        flow_type: params.flowType,
        error,
        event: { userId: params.userId, amount: params.amount, currency: params.currency },
      }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      fundFlowIntegrationMetrics.dlqHttpFallbackFailures++;
      logger.warn({ operationId, status: res.status }, "[FundFlow] Python reconciliation DLQ fallback rejected submission — relying on Kafka DLQ");
    }
  } catch (err) {
    fundFlowIntegrationMetrics.dlqHttpFallbackFailures++;
    logger.warn({ operationId, err: err instanceof Error ? err.message : String(err) }, "[FundFlow] Python reconciliation DLQ fallback unreachable — relying on Kafka DLQ");
  }

  // Also publish to Kafka fund flow DLQ (durable — drained into
  // fund_flow_dlq_events by server/_core/fundFlowDlqConsumer.ts).
  try {
    const published = await publishEvent(
      KAFKA_TOPICS.FUND_FLOW_DLQ,
      operationId,
      {
        operationId,
        flowType: params.flowType,
        userId: params.userId,
        amount: params.amount,
        currency: params.currency,
        error,
        failedAt: new Date().toISOString(),
      }
    );
    if (!published) {
      fundFlowIntegrationMetrics.dlqKafkaPublishFailures++;
      logger.error({ operationId }, "[FundFlow] CRITICAL: Kafka fund-flow DLQ publish returned false — failure event may be lost, MANUAL RECONCILIATION REQUIRED");
    }
  } catch (err) {
    fundFlowIntegrationMetrics.dlqKafkaPublishFailures++;
    logger.error({ operationId, err: err instanceof Error ? err.message : String(err) }, "[FundFlow] CRITICAL: Kafka fund-flow DLQ publish failed — failure event may be lost, MANUAL RECONCILIATION REQUIRED");
  }
}

// ── Convenience Wrappers for Common Fund Flows ───────────────────────────────

/**
 * Atomic agent cash-out operation.
 */
export async function atomicAgentCashOut<T>(
  userId: number,
  amount: number,
  currency: string,
  reference: string,
  operation: () => Promise<T>,
  compensate?: () => Promise<void>,
): Promise<FundFlowResult<T>> {
  return executeAtomicFundFlow(
    {
      userId,
      amount,
      currency,
      flowType: "agent_cash_out",
      transferRef: reference,
      idempotencyKey: `cashout:${reference}`,
      debitAccount: `agent-${userId}-${currency}`,
      creditAccount: `customer-float-${currency}`,
    },
    operation,
    compensate,
  );
}

/**
 * Atomic P2P transfer.
 */
export async function atomicP2PTransfer<T>(
  senderId: number,
  recipientId: number,
  amount: number,
  currency: string,
  reference: string,
  operation: () => Promise<T>,
  compensate?: () => Promise<void>,
): Promise<FundFlowResult<T>> {
  return executeAtomicFundFlow(
    {
      userId: senderId,
      amount,
      currency,
      flowType: "p2p_instant",
      counterpartyId: recipientId,
      transferRef: reference,
      idempotencyKey: `p2p:${reference}`,
      debitAccount: `user-${senderId}-${currency}`,
      creditAccount: `user-${recipientId}-${currency}`,
    },
    operation,
    compensate,
  );
}

/**
 * Atomic cross-border send.
 */
export async function atomicCrossBorderSend<T>(
  userId: number,
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  reference: string,
  operation: () => Promise<T>,
  compensate?: () => Promise<void>,
): Promise<FundFlowResult<T>> {
  return executeAtomicFundFlow(
    {
      userId,
      amount,
      currency: fromCurrency,
      flowType: "cross_border_send",
      transferRef: reference,
      idempotencyKey: `xborder:${reference}`,
      debitAccount: `user-${userId}-${fromCurrency}`,
      creditAccount: `corridor-pool-${toCurrency}`,
      metadata: { fromCurrency, toCurrency },
    },
    operation,
    compensate,
  );
}

/**
 * Atomic stablecoin transfer.
 */
export async function atomicStablecoinTransfer<T>(
  userId: number,
  amount: number,
  currency: string,
  chain: string,
  reference: string,
  operation: () => Promise<T>,
  compensate?: () => Promise<void>,
): Promise<FundFlowResult<T>> {
  return executeAtomicFundFlow(
    {
      userId,
      amount,
      currency,
      flowType: "stablecoin_transfer",
      transferRef: reference,
      idempotencyKey: `stable:${reference}`,
      metadata: { chain },
    },
    operation,
    compensate,
  );
}

/**
 * Atomic savings deposit/withdraw.
 */
export async function atomicSavingsOperation<T>(
  userId: number,
  amount: number,
  currency: string,
  type: "savings_deposit" | "savings_withdraw",
  reference: string,
  operation: () => Promise<T>,
  compensate?: () => Promise<void>,
): Promise<FundFlowResult<T>> {
  return executeAtomicFundFlow(
    {
      userId,
      amount,
      currency,
      flowType: type,
      transferRef: reference,
      idempotencyKey: `savings:${type}:${reference}`,
      debitAccount: type === "savings_deposit" ? `user-${userId}-${currency}` : `savings-vault-${userId}-${currency}`,
      creditAccount: type === "savings_deposit" ? `savings-vault-${userId}-${currency}` : `user-${userId}-${currency}`,
    },
    operation,
    compensate,
  );
}

/**
 * Atomic BNPL installment.
 */
export async function atomicBNPLInstallment<T>(
  userId: number,
  amount: number,
  currency: string,
  planId: string,
  operation: () => Promise<T>,
  compensate?: () => Promise<void>,
): Promise<FundFlowResult<T>> {
  return executeAtomicFundFlow(
    {
      userId,
      amount,
      currency,
      flowType: "bnpl_installment",
      transferRef: `bnpl:${planId}`,
      idempotencyKey: `bnpl:${planId}:${Date.now()}`,
      debitAccount: `user-${userId}-${currency}`,
      creditAccount: `merchant-bnpl-pool-${currency}`,
    },
    operation,
    compensate,
  );
}
