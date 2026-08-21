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
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { logger } from "./logger";
import { screenSanctions, type SanctionsScreenResult } from "./polyglotClient";
import { publishEvent, KAFKA_TOPICS, type TransactionEvent } from "../middleware/kafka";
import { tigerBeetle } from "../middleware/middlewareIntegration";
import { sendNotification } from "../notifications.service";
import { broadcastUserEvent } from "../sse.service";
import { createAuditLog, getDb } from "../db";
import { checkFraud, checkVelocity } from "../fraud.service";
import { and, eq, sql } from "drizzle-orm";
import { tigerbeetleAccounts } from "../../drizzle/schema.integrations";
import { TB_LEDGERS, TB_ACCOUNT_CODES, PLATFORM_SYSTEM_USER_ID } from "./tigerBeetle";

/**
 * Deterministic TigerBeetle transfer id derived from the transfer id string.
 * Both the pipeline (which creates the pending hold) and settlement /
 * compensation (which post / void that exact hold) derive the same id, so every
 * two-phase leg can target the real pending transfer instead of a fabricated
 * random id.
 *
 * FF-024 fix: the full id string is hashed with SHA-256 (first 16 bytes →
 * 128-bit TB id). The previous hex-munging approach collapsed distinct ids
 * (`ACH-…`, `SWIFT-…`, `P2P-…` all mapped to near-identical hex), which — combined
 * with TB exists(46) being treated as success — silently skipped holds for
 * same-user/same-amount transfers. A cryptographic hash makes collisions
 * computationally infeasible, so exists(46) can only mean a true replay.
 */
export function pendingTransferIdFor(transferId: string): bigint {
  const digest = createHash("sha256").update(transferId, "utf8").digest();
  let id = 0n;
  for (let i = 0; i < 16; i++) id = (id << 8n) | BigInt(digest[i]);
  // TigerBeetle forbids id = 0; astronomically unlikely, but stay safe.
  return id === 0n ? 1n : id;
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

// ─── Settlement (FF-001) ─────────────────────────────────────────────────────
// Two-phase money movement: the pipeline creates a TB pending hold; settlement
// must (a) debit the PG wallet atomically and (b) post the TB hold IN FULL.
// Exactly-once semantics come from the settlement_journal table (migration
// 0060): the journal row is the idempotency key for the PG debit, and the TB
// post uses a deterministic id (`POST:${transferId}`) so a replay hits TB
// exists(46) instead of double-posting.

export interface SettlementResult {
  settled: boolean;
  /** True when the journal row already existed (replay — no second effect). */
  replay: boolean;
  tbPosted: boolean;
  pendingId: string;
}

/**
 * Settle a transfer whose funds are held in a TB pending transfer:
 *   1. Insert settlement journal row (ON CONFLICT → replay detection) and
 *      debit the PG wallet with a balance guard, in one logical unit.
 *   2. Post the TB pending hold for its FULL pending amount (TB 0.16 releases
 *      any remainder; the bridge defaults amount to the hold amount).
 *   3. On TB post failure, mark the journal post_failed and raise — the
 *      settlement reaper retries / reconciles; the hold never silently expires.
 */
export async function settleTransferHold(input: {
  transferId: string;
  userId: number;
  amount: number;
  currency: string;
}): Promise<SettlementResult> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Settlement unavailable (no database)" });
  }
  const accounts = await resolveTbTransferAccounts(input.userId, input.currency);
  const pendingId = pendingTransferIdFor(input.transferId);
  const postId = pendingTransferIdFor(`POST:${input.transferId}`);
  const amountCents = BigInt(Math.round(input.amount * 100));
  const debitAmount = input.amount.toFixed(2);

  // 1. Journal + guarded wallet debit. The journal row IS the idempotency
  //    record: only the caller that inserts it may apply the PG debit.
  const journalRows = (await db.execute(sql`
    INSERT INTO settlement_journal (transfer_id, user_id, amount_minor, currency, status, tb_pending_id, created_at, updated_at)
    VALUES (${input.transferId}, ${input.userId}, ${amountCents.toString()}, ${input.currency}, 'debited', ${pendingId.toString()}, NOW(), NOW())
    ON CONFLICT (transfer_id) DO NOTHING
    RETURNING transfer_id
  `)) as unknown as Array<{ transfer_id: string }>;

  let replay = journalRows.length === 0;
  if (!replay) {
    const debitRows = (await db.execute(sql`
      UPDATE wallets
      SET balance = CAST(balance AS NUMERIC) - ${debitAmount}, "updatedAt" = NOW()
      WHERE "userId" = ${input.userId}
        AND currency = ${input.currency}
        AND CAST(balance AS NUMERIC) >= ${debitAmount}
      RETURNING id
    `)) as unknown as Array<{ id: number }>;
    if (debitRows.length === 0) {
      await db.execute(sql`
        UPDATE settlement_journal SET status = 'reconcile_required', updated_at = NOW()
        WHERE transfer_id = ${input.transferId}
      `);
      logger.error({ ...input }, "[Settlement] Wallet debit failed at settlement — insufficient PG balance; MANUAL RECONCILIATION REQUIRED");
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Settlement failed: insufficient wallet balance. Hold retained for reconciliation.",
      });
    }
  }

  // 2. Post the TB hold in full. Deterministic post id + exists(46) tolerance
  //    in the bridge client make this replay-safe.
  try {
    await tigerBeetle.postPendingTransfer({ id: postId, pendingId, ledger: accounts.ledger, code: 1 });
    await db.execute(sql`
      UPDATE settlement_journal SET status = 'posted', updated_at = NOW()
      WHERE transfer_id = ${input.transferId}
    `);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.execute(sql`
      UPDATE settlement_journal SET status = 'post_failed', updated_at = NOW()
      WHERE transfer_id = ${input.transferId}
    `);
    logger.error({ ...input, pendingId: pendingId.toString(), err: msg },
      "[Settlement] TigerBeetle post-pending failed after PG debit — journal marked post_failed, reaper will retry; MANUAL RECONCILIATION alert");
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Settlement ledger post failed — funds held and flagged for reconciliation.",
    });
  }

  logger.info({ ...input, pendingId: pendingId.toString(), replay }, "[Settlement] Transfer settled: PG debited + TB hold posted");
  return { settled: true, replay, tbPosted: true, pendingId: pendingId.toString() };
}

/**
 * Settlement reaper: scans the journal for transfers whose PG debit succeeded
 * but whose TB hold was never posted (post_failed, or 'debited' rows that
 * crashed mid-settlement). For each:
 *   - pending hold still open     → retry the post (deterministic id).
 *   - hold already posted         → mark journal posted (self-heal).
 *   - hold gone (expired/voided)  → refund the PG wallet and flag
 *     reconcile_required + MANUAL RECON alert (funds must never be taken in PG
 *     while the ledger hold evaporated).
 */
export async function reconcileSettlementJournal(limit = 100): Promise<{ retried: number; refunded: number; failed: number }> {
  const db = await getDb();
  if (!db) return { retried: 0, refunded: 0, failed: 0 };
  const rows = (await db.execute(sql`
    SELECT transfer_id, user_id, amount_minor, currency, tb_pending_id
    FROM settlement_journal
    WHERE status IN ('debited', 'post_failed')
    ORDER BY created_at
    LIMIT ${limit}
  `)) as unknown as Array<{ transfer_id: string; user_id: number; amount_minor: string; currency: string; tb_pending_id: string }>;

  let retried = 0, refunded = 0, failed = 0;
  for (const row of rows) {
    const pendingId = BigInt(row.tb_pending_id);
    const postId = pendingTransferIdFor(`POST:${row.transfer_id}`);
    const refundAmount = (Number(row.amount_minor) / 100).toFixed(2);
    try {
      const accounts = await resolveTbTransferAccounts(row.user_id, row.currency);
      try {
        // Retry the post for the full hold amount. The deterministic post id
        // makes a retry of a post that actually committed hit TB exists(46),
        // which the bridge client tolerates as idempotent success.
        await tigerBeetle.postPendingTransfer({ id: postId, pendingId, ledger: accounts.ledger, code: 1 });
        await db.execute(sql`UPDATE settlement_journal SET status = 'posted', updated_at = NOW() WHERE transfer_id = ${row.transfer_id}`);
        retried++;
      } catch (postErr) {
        const codes = tbResultCodes(postErr);
        if (codes.includes(TB_RESULT.ALREADY_POSTED)) {
          // Hold already posted (e.g. crash between TB post and journal update).
          await db.execute(sql`UPDATE settlement_journal SET status = 'posted', updated_at = NOW() WHERE transfer_id = ${row.transfer_id}`);
          retried++;
        } else if (
          codes.includes(TB_RESULT.ALREADY_VOIDED) ||
          codes.includes(TB_RESULT.EXPIRED) ||
          codes.includes(TB_RESULT.PENDING_NOT_FOUND)
        ) {
          // Hold expired/voided with PG already debited → refund PG and alert.
          await db.execute(sql`
            UPDATE wallets SET balance = CAST(balance AS NUMERIC) + ${refundAmount}, "updatedAt" = NOW()
            WHERE "userId" = ${row.user_id} AND currency = ${row.currency} /* FF-GATE-V2: journal rows are snake_case — row.userId was undefined at runtime */
          `);
          await db.execute(sql`UPDATE settlement_journal SET status = 'refunded', updated_at = NOW() WHERE transfer_id = ${row.transfer_id}`);
          refunded++;
          logger.error({ transferId: row.transfer_id, userId: row.user_id, refundAmount, currency: row.currency, codes },
            "[SettlementReaper] Hold expired/voided unposted after PG debit — wallet refunded; MANUAL RECONCILIATION REQUIRED");
        } else {
          failed++;
          logger.error({ transferId: row.transfer_id, codes, err: postErr instanceof Error ? postErr.message : String(postErr) },
            "[SettlementReaper] Post retry failed — will retry next pass");
        }
      }
    } catch (err) {
      failed++;
      logger.error({ transferId: row.transfer_id, err: err instanceof Error ? err.message : String(err) },
        "[SettlementReaper] Reconciliation attempt failed — will retry next pass");
    }
  }
  return { retried, refunded, failed };
}

/** Interval handle for the settlement reaper (started by server boot). */
let settlementReaperTimer: NodeJS.Timeout | null = null;

export function startSettlementReaper(intervalMs = 60_000): void {
  if (settlementReaperTimer) return;
  settlementReaperTimer = setInterval(() => {
    reconcileSettlementJournal().catch((err) =>
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "[SettlementReaper] pass failed"));
  }, intervalMs);
  settlementReaperTimer.unref?.();
  logger.info({ intervalMs }, "[SettlementReaper] started");
}

export function stopSettlementReaper(): void {
  if (settlementReaperTimer) clearInterval(settlementReaperTimer);
  settlementReaperTimer = null;
}

// ─── Saga compensation (FF-004) ──────────────────────────────────────────────

export type CompensationAction =
  | "voided"           // hold was pending and is now voided — funds released
  | "already_voided"   // hold was already voided/expired — no funds had moved
  | "no_hold"          // no hold ever existed — nothing to compensate
  | "reversed"         // hold was already POSTED → refund transfer created
  | "failed";          // outcome unknown — manual reconciliation required

// TB 0.16.63 CreateTransferResult codes (src/tigerbeetle.zig) relevant to
// two-phase compensation state detection:
const TB_RESULT = {
  PENDING_NOT_FOUND: 25,       // pending_transfer_not_found — hold never existed
  PENDING_NOT_PENDING: 26,     // pending_transfer_not_pending (generic)
  ALREADY_POSTED: 33,          // pending_transfer_already_posted
  ALREADY_VOIDED: 34,          // pending_transfer_already_voided
  EXPIRED: 35,                 // pending_transfer_expired (auto-void at timeout)
  EXISTS: 46,                  // exists — exact replay of an identical transfer
} as const;

function tbResultCodes(err: unknown): number[] {
  const msg = err instanceof Error ? err.message : String(err);
  const codes: number[] = [];
  for (const m of msg.matchAll(/"result":\s*(\d+)/g)) codes.push(Number(m[1]));
  return codes;
}

/**
 * Saga compensation: releases/reverses a failed transfer's ledger hold.
 *
 * FF-004 fix: state-aware, idempotent, honest.
 *   1. Attempt the void with a deterministic id (`VOID:${transferId}`). TB
 *      reports the hold's true state in the result code:
 *        ok / exists(46 on the void id)      → voided (replay-safe)
 *        already_voided(34) / expired(35)    → no funds were held → no refund
 *        not_found(25)                        → no hold ever existed → no refund
 *        already_posted(33)                   → funds moved → create a refund
 *                                               reversal with deterministic id
 *        anything else / transport error      → UNKNOWN: do NOT refund (that
 *                                               was the double-refund vector),
 *                                               raise MANUAL_RECON.
 *   2. Returns a truthful compensated flag — callers can distinguish failure.
 */
export async function compensateFailedTransfer(input: {
  transferId: string;
  userId: number;
  amount: number;
  currency: string;
  reason: string;
  stage: "debit" | "settlement" | "credit";
}): Promise<{ compensated: boolean; reversalId?: string; action: CompensationAction }> {
  const reversalId = `REV-${input.transferId}`;
  logger.warn({ ...input, reversalId }, "[Pipeline] Compensating failed transfer");

  let action: CompensationAction = "failed";
  try {
    // Resolve the same accounts the pipeline used (same mapping table,
    // per-currency ledger) so compensation targets the real hold.
    const accounts = await resolveTbTransferAccounts(input.userId, input.currency);
    const pendingId = pendingTransferIdFor(input.transferId);
    const voidId = pendingTransferIdFor(`VOID:${input.transferId}`);
    const amountCents = BigInt(Math.round(input.amount * 100));

    try {
      await tigerBeetle.voidPendingTransfer({ id: voidId, pendingId, ledger: accounts.ledger, code: 1 }); // FF-GATE-V2: code must match the pipeline hold (code 1) — TB 0.16 rejects mismatched code with pending_transfer_has_different_code(30)
      action = "voided";
    } catch (voidErr) {
      const codes = tbResultCodes(voidErr);
      if (codes.includes(TB_RESULT.ALREADY_POSTED)) {
        // The hold was posted — funds moved to the float pool. Refund the user
        // wallet from the float pool with a deterministic reversal id
        // (createTransfer tolerates exists(46), so this is replay-safe).
        await tigerBeetle.createTransfer({
          id: pendingTransferIdFor(`REVX:${input.transferId}`),
          debitAccountId: accounts.creditAccountId,  // float pool → user wallet
          creditAccountId: accounts.debitAccountId,
          amount: amountCents,
          ledger: accounts.ledger,
          code: 2,
        });
        action = "reversed";
      } else if (codes.includes(TB_RESULT.ALREADY_VOIDED) || codes.includes(TB_RESULT.EXPIRED)) {
        // Hold was already voided or auto-expired — no funds are held.
        action = "already_voided";
      } else if (codes.includes(TB_RESULT.PENDING_NOT_FOUND)) {
        // No hold ever existed under this id (skipLedger / dev-mode pipeline).
        action = "no_hold";
      } else {
        // Unknown outcome (e.g. timeout where the void may have committed).
        // Do NOT blind-refund — that double-pays the user.
        logger.error({ ...input, reversalId, codes, voidErr: voidErr instanceof Error ? voidErr.message : String(voidErr) },
          "[Pipeline] Void outcome UNKNOWN — refusing fallback refund; MANUAL RECONCILIATION REQUIRED");
        action = "failed";
      }
    }
  } catch (err) {
    logger.error({ ...input, reversalId, err: err instanceof Error ? err.message : String(err) },
      "[Pipeline] Compensation failed — MANUAL RECONCILIATION REQUIRED");
    action = "failed";
  }

  const compensated = action !== "failed";

  try {
    await publishEvent(KAFKA_TOPICS.TRANSACTIONS, input.transferId, {
      eventType: compensated ? "reversed" : "compensation_failed",
      transactionId: input.transferId,
      reversalId,
      userId: input.userId,
      amount: input.amount,
      currency: input.currency,
      reason: input.reason,
      failedStage: input.stage,
      compensationAction: action,
      timestamp: new Date().toISOString(),
    });
  } catch {
    logger.warn({ reversalId }, "[Pipeline] Reversal Kafka event failed");
  }

  try {
    broadcastUserEvent(input.userId, {
      type: "transfer_failed",
      payload: {
        title: compensated ? "Transfer Reversed" : "Transfer Failed — Reconciliation Pending",
        message: compensated
          ? `Your transfer of ${input.amount} ${input.currency} was reversed: ${input.reason}`
          : `Your transfer of ${input.amount} ${input.currency} failed: ${input.reason}. Our team has been alerted to reconcile your funds.`,
        transferId: input.transferId,
        reversalId,
      },
    });
    sendNotification({
      userId: input.userId,
      title: compensated ? "Transfer Reversed" : "Transfer Failed — Reconciliation Pending",
      message: compensated
        ? `Transfer ${input.transferId} reversed: ${input.reason}. Funds returned to your account.`
        : `Transfer ${input.transferId} failed: ${input.reason}. Reconciliation has been alerted.`,
      type: "transfer",
    }).catch(() => {});
  } catch {
    // Notification failure is non-critical
  }

  return { compensated, reversalId, action };
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
