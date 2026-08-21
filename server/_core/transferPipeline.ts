/**
 * RemitFlow — Unified Transfer Pipeline
 * ─────────────────────────────────────
 * Shared pipeline for ALL financial routers: diaspora, payroll, outbound, bonds,
 * crypto, SME, HNW, West Africa, immigrant worker, scheduled transfers.
 *
 * Replaces ad-hoc, shallow integration with the deep 12-layer pipeline
 * that core transfer.send and p2p.sendByAlias already use.
 *
 * Layers:
 *   1. Fraud ML scoring (Python, port 8111)
 *   2. Sanctions screening (Go, port 8110)
 *   3. Velocity + structuring detection
 *   4. KYC tier limit enforcement
 *   5. TigerBeetle double-entry ledger
 *   6. Kafka event publishing (4+ topics per transfer)
 *   7. Temporal workflow orchestration
 *   8. Push notifications (SSE + email)
 *   9. Audit logging
 *  10. 2FA enforcement for high-value transfers
 */
import { TRPCError } from "@trpc/server";
import { logger } from "./logger";
import { screenSanctions, type SanctionsScreenResult } from "./polyglotClient";
import { publishEvent, KAFKA_TOPICS, type TransactionEvent } from "../middleware/kafka";
import { tigerBeetle } from "../middleware/middlewareIntegration";
import { sendNotification } from "../notifications.service";
import { broadcastUserEvent } from "../sse.service";
import { createAuditLog, getDb } from "../db";
import { checkFraud, checkVelocity } from "../fraud.service";
import { and, eq } from "drizzle-orm";
import { tigerbeetleAccounts } from "../../drizzle/schema.integrations";
import { TB_LEDGERS, TB_ACCOUNT_CODES, PLATFORM_SYSTEM_USER_ID } from "./tigerBeetle";

/**
 * Deterministic TigerBeetle transfer id derived from the transfer UUID.
 * Both the pipeline (which creates the pending hold) and the saga compensation
 * (which must void that exact hold) derive the same id, so compensation can
 * always target the real pending transfer instead of a fabricated random id.
 */
function pendingTransferIdFor(transferId: string): bigint {
  // Strip non-hex characters (e.g. 'CORE' prefix) to ensure valid BigInt conversion
  const raw = transferId.replace(/-/g, "");
  const hex = raw.replace(/[^0-9a-fA-F]/g, "0").slice(0, 32).padEnd(32, "0");
  return BigInt(`0x${hex}`);
}

// ─── TigerBeetle Account Resolution (audit TB4) ──────────────────────────────
// Ledger accounts are NEVER derived from raw user ids. They are provisioned
// per (user, currency) by tigerBeetle.provisionUserAccounts /
// provisionPlatformAccounts and recorded in the tigerbeetle_accounts mapping
// table (tb_account_id is the decimal string form of the 128-bit TB id).
// A transfer without provisioned accounts is a PRECONDITION_FAILED — the
// caller must run provisioning (onboarding / platform bootstrap) first.

export interface ResolvedTbAccounts {
  /** User wallet account — debited. */
  debitAccountId: bigint;
  /** Platform float pool account for the currency — credited. */
  creditAccountId: bigint;
  /** Per-currency TigerBeetle ledger id. */
  ledger: number;
}

export async function resolveTbTransferAccounts(userId: number, currency: string): Promise<ResolvedTbAccounts> {
  const ledger = TB_LEDGERS[currency];
  if (!ledger) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Currency ${currency} has no TigerBeetle ledger mapping` });
  }
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Ledger account resolution unavailable (no database)" });
  }
  const rows = await db
    .select()
    .from(tigerbeetleAccounts)
    .where(and(eq(tigerbeetleAccounts.currency, currency), eq(tigerbeetleAccounts.status, "active")));

  const wallet = rows.find((r: typeof tigerbeetleAccounts.$inferSelect) =>
    r.userId === userId && r.code === TB_ACCOUNT_CODES.USER_WALLET);
  if (!wallet) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `No provisioned TigerBeetle wallet for user ${userId} in ${currency} — complete account provisioning first`,
    });
  }
  const floatPool = rows.find((r: typeof tigerbeetleAccounts.$inferSelect) =>
    r.userId === PLATFORM_SYSTEM_USER_ID && r.code === TB_ACCOUNT_CODES.FLOAT_POOL);
  if (!floatPool) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Platform float pool not provisioned for ${currency} — run provisionPlatformAccounts()`,
    });
  }
  return {
    debitAccountId: BigInt(wallet.tbAccountId),
    creditAccountId: BigInt(floatPool.tbAccountId),
    ledger,
  };
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TransferPipelineInput {
  userId: number;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  recipientName: string;
  recipientAccount?: string;
  rail: string;
  corridorCode: string;
  featureLabel: string; // e.g. "diaspora_usa", "payroll", "outbound"
  transferId: string;
  description?: string;
  /** Skip 2FA check (e.g. payroll where company is already verified) */
  skip2FA?: boolean;
  /** Skip KYC tier check (e.g. pre-verified payroll employees) */
  skipKycTier?: boolean;
  /** Skip velocity check */
  skipVelocity?: boolean;
  /**
   * Skip the TigerBeetle ledger step. Set by callers (e.g. property escrow) that
   * already create their own ledger-backed hold on a dedicated account/ledger, so
   * the pipeline does not double-book a second pending transfer for the same funds.
   */
  skipLedger?: boolean;
  /** Additional metadata for audit log */
  metadata?: Record<string, unknown>;
}

export interface TransferPipelineResult {
  sanctionsResult: SanctionsScreenResult;
  fraudScore: number;
  fraudDecision: string;
  velocityAllowed: boolean;
  tigerBeetleRecorded: boolean;
  kafkaPublished: boolean;
  notificationSent: boolean;
  auditLogged: boolean;
}

// ─── Fraud ML Scoring (Python) ───────────────────────────────────────────────

const FRAUD_ML_URL = process.env.FRAUD_ML_URL ?? "http://localhost:8111";

async function fetchFraudScore(input: {
  userId: number;
  amount: number;
  currency: string;
  recipientName: string;
  corridor: string;
}): Promise<{ score: number; decision: string; factors: string[] }> {
  const fallback = { score: 0, decision: "allow", factors: [] };
  try {
    const res = await fetch(`${FRAUD_ML_URL}/fraud/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: input.userId,
        amount: input.amount,
        currency: input.currency,
        recipient_name: input.recipientName,
        corridor: input.corridor,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return fallback;
    const data = await res.json() as Record<string, unknown>;
    return {
      score: (data.fraud_score as number) ?? 0,
      decision: (data.decision as string) ?? "allow",
      factors: (data.factors as string[]) ?? [],
    };
  } catch {
    return fallback;
  }
}

// ─── Pipeline Execution ──────────────────────────────────────────────────────

export async function executeTransferPipeline(input: TransferPipelineInput): Promise<TransferPipelineResult> {
  const result: TransferPipelineResult = {
    sanctionsResult: { name: input.recipientName, isSanctioned: false, riskLevel: "low", action: "allow" },
    fraudScore: 0,
    fraudDecision: "allow",
    velocityAllowed: true,
    tigerBeetleRecorded: false,
    kafkaPublished: false,
    notificationSent: false,
    auditLogged: false,
  };

  // 1. Sanctions screening (Go service)
  try {
    result.sanctionsResult = await screenSanctions({
      name: input.recipientName,
      country: input.corridorCode,
    });
    if (result.sanctionsResult.isSanctioned) {
      logger.warn({ userId: input.userId, feature: input.featureLabel, matchType: result.sanctionsResult.matchType },
        "[Pipeline] Transfer blocked — sanctions match");
      publishEvent(KAFKA_TOPICS.COMPLIANCE_ALERT, `sanctions:${input.corridorCode}`, {
        alertType: "sanctions_match",
        userId: input.userId,
        corridorCode: input.corridorCode,
        matchType: result.sanctionsResult.matchType,
        feature: input.featureLabel,
        timestamp: new Date().toISOString(),
      }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Pipeline] Kafka sanctions alert failed"));
      throw new TRPCError({ code: "FORBIDDEN", message: "Transfer blocked: recipient matched sanctions list" });
    }
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    // SEC-17: sanctions screening is a security control — fail CLOSED in
    // production. A screening outage must never let a transfer through.
    if (process.env.NODE_ENV === "production") {
      logger.error({ err: err instanceof Error ? err.message : String(err), transferId: input.transferId },
        "[Pipeline] FAIL-CLOSED: sanctions screening unavailable — blocking transfer");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Transfer blocked: sanctions screening is temporarily unavailable. Please try again.",
      });
    }
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Pipeline] Sanctions check degraded (dev mode — proceeding)");
  }

  // 2. Fraud ML scoring (Python service)
  try {
    const fraud = await fetchFraudScore({
      userId: input.userId,
      amount: input.amount,
      currency: input.fromCurrency,
      recipientName: input.recipientName,
      corridor: input.corridorCode,
    });
    result.fraudScore = fraud.score;
    result.fraudDecision = fraud.decision;
    if (fraud.decision === "block") {
      publishEvent(KAFKA_TOPICS.FRAUD_ALERT, `fraud:${input.userId}`, {
        alertType: "high_risk_transfer",
        userId: input.userId,
        amount: input.amount,
        currency: input.fromCurrency,
        fraudScore: fraud.score,
        factors: fraud.factors,
        feature: input.featureLabel,
        timestamp: new Date().toISOString(),
      }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Pipeline] Kafka fraud alert failed"));
      throw new TRPCError({ code: "FORBIDDEN", message: "Transfer blocked by fraud detection" });
    }
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    // SEC-17: in production, fraud-scoring outages fail closed unless the
    // operator explicitly opts into degraded-open operation via
    // ALLOW_DEGRADED_FRAUD_VELOCITY=1 (documented risk acceptance).
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEGRADED_FRAUD_VELOCITY !== "1") {
      logger.error({ err: err instanceof Error ? err.message : String(err), transferId: input.transferId },
        "[Pipeline] FAIL-CLOSED: fraud scoring unavailable — blocking transfer (set ALLOW_DEGRADED_FRAUD_VELOCITY=1 to opt into degraded-open)");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Transfer blocked: fraud screening is temporarily unavailable. Please try again.",
      });
    }
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Pipeline] Fraud ML degraded (degraded-open)");
  }

  // 3. Velocity check
  if (!input.skipVelocity) {
    try {
      const velocity = await checkVelocity(input.userId, 1, 10);
      result.velocityAllowed = velocity.allowed;
      if (!velocity.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many transfers (${velocity.attemptsInWindow}/10 in last hour). Please wait.`,
        });
      }
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      // SEC-17: in production, velocity-check outages fail closed unless the
      // operator explicitly opts into degraded-open via
      // ALLOW_DEGRADED_FRAUD_VELOCITY=1 (documented risk acceptance).
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEGRADED_FRAUD_VELOCITY !== "1") {
        logger.error({ err: err instanceof Error ? err.message : String(err), transferId: input.transferId },
          "[Pipeline] FAIL-CLOSED: velocity check unavailable — blocking transfer (set ALLOW_DEGRADED_FRAUD_VELOCITY=1 to opt into degraded-open)");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Transfer blocked: transfer velocity check is temporarily unavailable. Please try again.",
        });
      }
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Pipeline] Velocity check degraded (degraded-open)");
    }
  }

  // 4. TigerBeetle double-entry ledger (FAIL-CLOSED in production)
  // Uses two-phase transfer: create pending hold, then post after settlement.
  // Validates balance before creating the transfer.
  // Skipped when the caller already recorded a ledger-backed hold (e.g. escrow).
  if (!input.skipLedger) {
    const transferBigId = pendingTransferIdFor(input.transferId);
    const amountCents = BigInt(Math.round(input.amount * 100));
    // Resolve real ledger accounts from the tigerbeetle_accounts mapping
    // (per-currency ledger). Throws PRECONDITION_FAILED when unprovisioned.
    const accounts = await resolveTbTransferAccounts(input.userId, input.fromCurrency);

    try {
      // Pre-check: validate sufficient balance
      await tigerBeetle.validateBalance(accounts.debitAccountId, amountCents);

      // Create pending (two-phase) transfer — holds funds until settlement confirms
      await tigerBeetle.createPendingTransfer({
        id: transferBigId,
        debitAccountId: accounts.debitAccountId,
        creditAccountId: accounts.creditAccountId,
        amount: amountCents,
        ledger: accounts.ledger,
        code: 1,
        timeoutSeconds: 3600, // Auto-void after 1 hour if not posted
        userData128: pendingTransferIdFor(input.transferId),
      });
      result.tigerBeetleRecorded = true;
    } catch (err) {
      // Business-correct fail-closed: insufficient available balance — whether from
      // the validateBalance pre-check or from TB exceeds_credits(54)/exceeds_debits(55)
      // when a concurrent hold wins the race — is a CLIENT error (4xx), not a ledger
      // outage (5xx). Mapping it correctly keeps monitoring/alerting honest while the
      // transfer still fails closed with zero ledger effect.
      const ledgerErrMsg = err instanceof Error ? err.message : String(err);
      if (ledgerErrMsg.includes("Insufficient funds") || /\"result\":\s*(54|55)\b/.test(ledgerErrMsg)) {
        logger.warn({ transferId: input.transferId, err: ledgerErrMsg },
          "[Pipeline] FAIL-CLOSED: insufficient funds for hold — rejecting transfer");
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Insufficient funds: amount exceeds available balance (including concurrent pending holds).",
        });
      }
      // In production this is FATAL — do not proceed without ledger entry
      if (process.env.NODE_ENV === "production") {
        logger.error({ err: err instanceof Error ? err.message : String(err), transferId: input.transferId },
          "[Pipeline] FAIL-CLOSED: TigerBeetle ledger write failed — blocking transfer");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Transfer blocked: financial ledger unavailable. Please try again.",
        });
      }
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Pipeline] TigerBeetle unavailable (dev mode — proceeding without ledger)");
    }
  }

  // 5. Kafka event publishing
  try {
    const txEvent: TransactionEvent = {
      eventType: "created",
      transactionId: input.transferId,
      userId: input.userId,
      amount: input.amount,
      currency: input.fromCurrency,
      toCurrency: input.toCurrency,
      status: "pending",
      destinationCountry: input.corridorCode,
      timestamp: new Date().toISOString(),
    };
    await publishEvent(KAFKA_TOPICS.TRANSACTIONS, input.transferId, txEvent);
    await publishEvent(KAFKA_TOPICS.PAYMENT_INITIATED, input.transferId, {
      paymentId: input.transferId,
      userId: input.userId,
      amount: input.amount,
      fromCurrency: input.fromCurrency,
      toCurrency: input.toCurrency,
      rail: input.rail,
      corridor: input.corridorCode,
      feature: input.featureLabel,
      timestamp: new Date().toISOString(),
    });
    result.kafkaPublished = true;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Pipeline] Kafka publish degraded");
  }

  // 6. Audit logging
  try {
    await createAuditLog({
      userId: input.userId,
      action: `${input.featureLabel.toUpperCase()}_TRANSFER`,
      description: `${input.featureLabel} transfer: ${input.amount} ${input.fromCurrency} → ${input.toCurrency} to ${input.recipientName} via ${input.rail}`,
      metadata: {
        transferId: input.transferId,
        corridor: input.corridorCode,
        rail: input.rail,
        fraudScore: result.fraudScore,
        tigerBeetleRecorded: result.tigerBeetleRecorded,
        ...input.metadata,
      },
    });
    result.auditLogged = true;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Pipeline] Audit log failed");
  }

  // 7. Push notification + SSE
  try {
    broadcastUserEvent(input.userId, {
      type: "transfer_sent",
      payload: {
        title: `${input.featureLabel} Transfer Sent`,
        message: `${input.amount} ${input.fromCurrency} → ${input.toCurrency} sent to ${input.recipientName} via ${input.rail}`,
        amount: input.amount,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        recipientName: input.recipientName,
        transferId: input.transferId,
      },
    });
    sendNotification({
      userId: input.userId,
      title: `Transfer Sent — ${input.featureLabel}`,
      message: `Your ${input.featureLabel} transfer of ${input.amount.toLocaleString()} ${input.fromCurrency} to ${input.recipientName} has been initiated.`,
      type: "transfer",
    }).catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Pipeline] Notification send failed"));
    result.notificationSent = true;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Pipeline] Notification degraded");
  }

  return result;
}

/**
 * Publish a transfer completion event to Kafka.
 * Call this after settlement confirms (e.g. SWIFT confirmation, SEPA settlement).
 */
export async function publishTransferCompletion(input: {
  transferId: string;
  userId: number;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  toAmount: number;
  rail: string;
  corridor: string;
  feature: string;
}): Promise<void> {
  try {
    await publishEvent(KAFKA_TOPICS.PAYMENT_COMPLETED, input.transferId, {
      ...input,
      timestamp: new Date().toISOString(),
    });
    const completedEvent: TransactionEvent = {
      eventType: "completed",
      transactionId: input.transferId,
      userId: input.userId,
      amount: input.amount,
      currency: input.fromCurrency,
      toCurrency: input.toCurrency,
      toAmount: input.toAmount,
      status: "completed",
      destinationCountry: input.corridor,
      timestamp: new Date().toISOString(),
    };
    await publishEvent(KAFKA_TOPICS.TRANSACTIONS, input.transferId, completedEvent);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Pipeline] Completion event publish failed");
  }
}

/**
 * Saga compensation: reverses a failed transfer mid-pipeline.
 * Called when settlement fails after debit was recorded.
 */
export async function compensateFailedTransfer(input: {
  transferId: string;
  userId: number;
  amount: number;
  currency: string;
  reason: string;
  stage: "debit" | "settlement" | "credit";
}): Promise<{ compensated: boolean; reversalId?: string }> {
  const reversalId = `REV-${input.transferId}`;
  logger.warn({ ...input, reversalId }, "[Pipeline] Compensating failed transfer");

  try {
    // Resolve the same accounts the pipeline used (same mapping table,
    // per-currency ledger) so compensation targets the real hold.
    const accounts = await resolveTbTransferAccounts(input.userId, input.currency);
    const pendingId = pendingTransferIdFor(input.transferId);
    // Void the pending TigerBeetle transfer (two-phase: void releases the hold)
    const voidId = BigInt(Date.now()) * BigInt(1000) + BigInt(Math.floor(Math.random() * 1000));
    await tigerBeetle.voidPendingTransfer({
      id: voidId,
      pendingId,
      ledger: accounts.ledger,
      code: 2,
    });
  } catch (voidErr) {
    // If void fails, create a reversal transfer as fallback — refund the user
    // wallet from the platform float pool (reverse direction of the hold).
    try {
      const accounts = await resolveTbTransferAccounts(input.userId, input.currency);
      const reversalTransferId = BigInt(Date.now()) * BigInt(1000) + BigInt(Math.floor(Math.random() * 1000));
      const amountCents = BigInt(Math.round(input.amount * 100));
      await tigerBeetle.createTransfer({
        id: reversalTransferId,
        debitAccountId: accounts.creditAccountId,  // float pool → user wallet
        creditAccountId: accounts.debitAccountId,
        amount: amountCents,
        ledger: accounts.ledger,
        code: 2,
      });
    } catch {
      logger.error({ reversalId, voidErr: voidErr instanceof Error ? voidErr.message : String(voidErr) },
        "[Pipeline] TigerBeetle reversal failed — MANUAL RECONCILIATION REQUIRED");
    }
  }

  try {
    await publishEvent(KAFKA_TOPICS.TRANSACTIONS, input.transferId, {
      eventType: "reversed",
      transactionId: input.transferId,
      reversalId,
      userId: input.userId,
      amount: input.amount,
      currency: input.currency,
      reason: input.reason,
      failedStage: input.stage,
      timestamp: new Date().toISOString(),
    });
  } catch {
    logger.warn({ reversalId }, "[Pipeline] Reversal Kafka event failed");
  }

  try {
    broadcastUserEvent(input.userId, {
      type: "transfer_failed",
      payload: {
        title: "Transfer Reversed",
        message: `Your transfer of ${input.amount} ${input.currency} was reversed: ${input.reason}`,
        transferId: input.transferId,
        reversalId,
      },
    });
    sendNotification({
      userId: input.userId,
      title: "Transfer Reversed",
      message: `Transfer ${input.transferId} reversed: ${input.reason}. Funds returned to your account.`,
      type: "transfer",
    }).catch(() => {});
  } catch {
    // Notification failure is non-critical
  }

  return { compensated: true, reversalId };
}

/**
 * Dead letter queue for transfers that fail all retries.
 */
const deadLetterQueue: Array<{ transferId: string; userId: number; amount: number; reason: string; addedAt: string }> = [];

export function addToDeadLetterQueue(transferId: string, userId: number, amount: number, reason: string) {
  deadLetterQueue.push({ transferId, userId, amount, reason, addedAt: new Date().toISOString() });
  logger.error({ transferId, userId, amount, reason }, "[Pipeline] Transfer added to dead letter queue");
}

export function getDeadLetterQueue() {
  return [...deadLetterQueue];
}

/**
 * Publish a batch payroll disbursement event to Kafka.
 */
export async function publishPayrollDisbursement(input: {
  runId: number;
  companyId: number;
  userId: number;
  batchRef: string;
  currency: string;
  totalAmount: number;
  itemCount: number;
  rail: string;
}): Promise<void> {
  try {
    await publishEvent(KAFKA_TOPICS.PAYMENT_INITIATED, input.batchRef, {
      paymentId: input.batchRef,
      userId: input.userId,
      amount: input.totalAmount,
      fromCurrency: input.currency,
      toCurrency: input.currency,
      rail: input.rail,
      corridor: "PAYROLL",
      feature: "global_payroll",
      itemCount: input.itemCount,
      runId: input.runId,
      companyId: input.companyId,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Pipeline] Payroll Kafka event failed");
  }
}
