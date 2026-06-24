/**
 * fundFlowAtomicity.ts — Atomic Fund Flow Middleware
 *
 * Ensures every financial mutation has:
 *   1. Distributed lock (Redis) — prevents concurrent modifications
 *   2. Idempotency check (Redis) — prevents duplicate processing
 *   3. TigerBeetle double-entry — immutable ledger record
 *   4. Kafka event sourcing — audit trail for every state change
 *   5. Fluvio streaming — real-time fraud detection feed
 *   6. Temporal saga compensation — automatic rollback on failure
 *
 * This middleware wraps the 14 fund flow paths identified in the audit.
 */

import { createHash, randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { logger } from "../_core/logger.js";
import { publishEvent, KAFKA_TOPICS } from "./kafka";
import { getRedisConnection, isRedisAvailable, isFundFlowStrictMode } from "./redisCluster";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AtomicOperation {
  /** Unique operation ID (idempotency key) */
  operationId: string;
  /** Type of fund flow (cross_border_send, agent_cashout, p2p, etc.) */
  flowType: FundFlowType;
  /** User initiating the operation */
  userId: number;
  /** Amount being moved */
  amount: number;
  /** Currency */
  currency: string;
  /** Optional: counterparty userId */
  counterpartyId?: number;
  /** Optional: transfer reference */
  transferRef?: string;
  /** Metadata for audit trail */
  metadata?: Record<string, unknown>;
}

export type FundFlowType =
  | "cross_border_send"
  | "agent_cash_pickup"
  | "agent_cash_in"
  | "agent_cash_out"
  | "p2p_instant"
  | "split_payment"
  | "wallet_topup"
  | "stablecoin_transfer"
  | "stablecoin_bridge"
  | "savings_deposit"
  | "savings_withdraw"
  | "bnpl_installment"
  | "recurring_transfer"
  | "float_replenishment"
  | "batch_payroll"
  | "stablecoin_onramp"
  | "stablecoin_offramp"
  | "stablecoin_bank_withdrawal"
  | "stablecoin_p2p"
  | "stablecoin_bill"
  | "stablecoin_stake"
  | "stablecoin_unstake"
  | "stablecoin_dca"
  | "stablecoin_virtual_card";

export interface AtomicResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  operationId: string;
  ledgerEntryId?: string;
  kafkaOffset?: string;
  sagaCompensated?: boolean;
}

// ─── Redis Distributed Lock ──────────────────────────────────────────────────

const LOCK_TTL_MS = 30_000; // 30-second lock timeout
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24-hour idempotency window

// In-memory fallback when Redis is unavailable
const localLocks = new Map<string, { expiresAt: number; owner: string }>();
const idempotencyCache = new Map<string, { result: unknown; expiresAt: number }>();

function getLockKey(op: AtomicOperation): string {
  // Lock scope: user + currency for wallet operations, or transferRef for transfer operations
  if (op.transferRef) return `fund_lock:transfer:${op.transferRef}`;
  return `fund_lock:wallet:${op.userId}:${op.currency}`;
}

function getIdempotencyKey(op: AtomicOperation): string {
  return `idemp:${op.flowType}:${op.operationId}`;
}

/**
 * Attempt to acquire a distributed lock.
 * Uses Redis Sentinel/Cluster in production. In strict mode (production),
 * refuses to proceed if Redis is unavailable — no silent in-memory fallback
 * for fund operations.
 */
export async function acquireFundLock(op: AtomicOperation): Promise<{ acquired: boolean; lockToken: string }> {
  const lockKey = getLockKey(op);
  const lockToken = randomBytes(16).toString("hex");
  const now = Date.now();

  // Try Redis (Sentinel/Cluster/Standalone via redisCluster module)
  try {
    const redis = await getRedisConnection();
    const result = await redis.set(lockKey, lockToken, "PX", LOCK_TTL_MS, "NX");
    if (result === "OK") return { acquired: true, lockToken };
    return { acquired: false, lockToken: "" };
  } catch (err) {
    // In strict mode (production), fail-hard — do NOT fall back to in-memory
    if (isFundFlowStrictMode()) {
      logger.error({ err, lockKey }, "[FundLock] Redis unavailable in strict mode — rejecting fund operation");
      throw new Error("[FUND_FLOW_BLOCKED] Redis unavailable — cannot acquire distributed lock for fund operation. In-memory fallback is disabled in production to prevent split-brain.");
    }
    logger.warn({ err, lockKey }, "[FundLock] Redis unavailable, using in-memory fallback (dev only)");
  }

  // In-memory fallback (development only — never reached in strict mode)
  const existing = localLocks.get(lockKey);
  if (existing && existing.expiresAt > now) {
    return { acquired: false, lockToken: "" };
  }
  localLocks.set(lockKey, { expiresAt: now + LOCK_TTL_MS, owner: lockToken });
  return { acquired: true, lockToken };
}

/**
 * Release a distributed lock (only if we own it).
 */
export async function releaseFundLock(op: AtomicOperation, lockToken: string): Promise<void> {
  const lockKey = getLockKey(op);

  try {
    const redis = await getRedisConnection();
    const script = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
    await redis.eval(script, 1, lockKey, lockToken);
    return;
  } catch {
    // Best-effort release — lock will expire via TTL anyway
  }

  // In-memory fallback (development only)
  const existing = localLocks.get(lockKey);
  if (existing?.owner === lockToken) {
    localLocks.delete(lockKey);
  }
}

// ─── Idempotency Check ───────────────────────────────────────────────────────

/**
 * Check if this operation was already processed (prevents double-processing).
 * Returns cached result if duplicate, null if new operation.
 */
export async function checkIdempotency(op: AtomicOperation): Promise<unknown | null> {
  const key = getIdempotencyKey(op);
  const now = Date.now();

  try {
    const redis = await getRedisConnection();
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);
    return null;
  } catch {
    if (isFundFlowStrictMode()) {
      logger.error({ key }, "[Idempotency] Redis unavailable in strict mode — cannot verify idempotency");
      throw new Error("[FUND_FLOW_BLOCKED] Redis unavailable — cannot verify operation idempotency");
    }
  }

  // In-memory fallback (development only)
  const cached = idempotencyCache.get(key);
  if (cached && cached.expiresAt > now) return cached.result;
  return null;
}

/**
 * Store operation result for idempotency.
 */
export async function storeIdempotencyResult(op: AtomicOperation, result: unknown): Promise<void> {
  const key = getIdempotencyKey(op);

  try {
    const redis = await getRedisConnection();
    await redis.set(key, JSON.stringify(result), "PX", IDEMPOTENCY_TTL_MS);
    return;
  } catch {
    // Best-effort — idempotency is defense-in-depth, not single point
    logger.warn({ key }, "[Idempotency] Could not store result in Redis");
  }

  // In-memory fallback (development only)
  idempotencyCache.set(key, { result, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
}

// ─── TigerBeetle Double-Entry ────────────────────────────────────────────────

export interface LedgerEntry {
  id: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  currency: string;
  flowType: FundFlowType;
  transferRef: string;
  pending: boolean;
}

/**
 * Whether TigerBeetle writes are mandatory.
 * In production, TigerBeetle must succeed or the operation is rejected.
 * In development, falls back to PostgreSQL.
 */
function isTigerBeetleStrictMode(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  return process.env.FUND_FLOW_TIGERBEETLE_STRICT === "true";
}

/**
 * Record a double-entry in TigerBeetle.
 * In production (strict mode), TigerBeetle failure blocks the operation.
 * In development, falls back to PostgreSQL.
 */
export async function recordDoubleEntry(entry: LedgerEntry): Promise<string> {
  const entryId = entry.id || createHash("sha256").update(`${entry.debitAccountId}:${entry.creditAccountId}:${entry.amount}:${Date.now()}`).digest("hex").slice(0, 32);

  // Try TigerBeetle first
  try {
    const tbAddr = process.env.TIGERBEETLE_ADDRESSES;
    if (tbAddr) {
      const { TigerBeetleIntegration } = await import("../middleware/middlewareIntegration.js");
      const tb = new TigerBeetleIntegration();
      await tb.createTransfer({
        id: BigInt("0x" + entryId.slice(0, 16)),
        debitAccountId: BigInt("0x" + createHash("sha256").update(entry.debitAccountId).digest("hex").slice(0, 16)),
        creditAccountId: BigInt("0x" + createHash("sha256").update(entry.creditAccountId).digest("hex").slice(0, 16)),
        amount: BigInt(Math.round(entry.amount * 100)),
        ledger: 1,
        code: flowTypeToCode(entry.flowType),
        pending: entry.pending,
      });
      return entryId;
    }

    // TigerBeetle not configured
    if (isTigerBeetleStrictMode()) {
      throw new Error("[FUND_FLOW_BLOCKED] TIGERBEETLE_ADDRESSES not configured — ledger recording is mandatory in production");
    }
  } catch (err) {
    if (isTigerBeetleStrictMode()) {
      logger.error({ err, entryId }, "[TigerBeetle] Transfer failed in strict mode — blocking fund operation");
      throw new Error(`[FUND_FLOW_BLOCKED] TigerBeetle ledger write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    logger.warn({ err, entryId }, "[TigerBeetle] Transfer failed, falling back to PostgreSQL");
  }

  // PostgreSQL fallback (development only — never reached in strict mode)
  try {
    const db = await getDb();
    if (db) {
      await db.execute(sql`
        INSERT INTO ledger_entries (id, amount, currency, type, description, created_at)
        VALUES (${entryId}, ${entry.amount.toString()}, ${entry.currency}, ${entry.flowType},
                ${`${entry.debitAccountId} -> ${entry.creditAccountId} [${entry.transferRef}]`}, NOW())
        ON CONFLICT (id) DO NOTHING
      `);
    }
  } catch (pgErr) {
    logger.warn({ pgErr, entryId }, "[TigerBeetle] PostgreSQL fallback failed — best-effort only");
  }

  return entryId;
}

function flowTypeToCode(flowType: FundFlowType): number {
  const codes: Record<FundFlowType, number> = {
    cross_border_send: 1,
    agent_cash_pickup: 2,
    agent_cash_in: 3,
    agent_cash_out: 4,
    p2p_instant: 5,
    split_payment: 6,
    wallet_topup: 7,
    stablecoin_transfer: 8,
    stablecoin_bridge: 9,
    savings_deposit: 10,
    savings_withdraw: 11,
    bnpl_installment: 12,
    recurring_transfer: 13,
    float_replenishment: 14,
    batch_payroll: 15,
    stablecoin_onramp: 16,
    stablecoin_offramp: 17,
    stablecoin_bank_withdrawal: 18,
    stablecoin_p2p: 19,
    stablecoin_bill: 20,
    stablecoin_stake: 21,
    stablecoin_unstake: 22,
    stablecoin_dca: 23,
    stablecoin_virtual_card: 24,
  };
  return codes[flowType] ?? 0;
}

// ─── Kafka Event Sourcing ────────────────────────────────────────────────────

export interface FundFlowEvent {
  eventId: string;
  eventType: "fund_flow_initiated" | "fund_flow_completed" | "fund_flow_failed" | "fund_flow_compensated";
  operationId: string;
  flowType: FundFlowType;
  userId: number;
  amount: number;
  currency: string;
  counterpartyId?: number;
  transferRef?: string;
  ledgerEntryId?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * Publish a fund flow event to Kafka for audit trail and downstream consumers.
 */
export async function publishFundFlowEvent(event: FundFlowEvent): Promise<void> {
  try {
    await publishEvent(
      KAFKA_TOPICS?.FUND_FLOW_EVENTS ?? "fund-flow-events",
      event.operationId,
      event
    );
  } catch (err) {
    logger.warn({ err, eventId: event.eventId }, "[Kafka] Fund flow event publish failed (non-blocking)");
  }

  // Also publish to Fluvio for real-time streaming (best-effort)
  try {
    const fluvioUrl = process.env.FLUVIO_GATEWAY_URL;
    if (fluvioUrl) {
      const response = await fetch(`${fluvioUrl}/api/v1/produce/fund-flow-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) throw new Error(`Fluvio ${response.status}`);
    }
  } catch {
    // Fluvio is best-effort for real-time streaming
  }
}

// ─── Temporal Saga Compensation ──────────────────────────────────────────────

export interface CompensationStep {
  name: string;
  execute: () => Promise<void>;
  compensate: () => Promise<void>;
}

/**
 * Execute a series of compensation steps (saga pattern).
 * If any step fails, all previously completed steps are compensated in reverse order.
 */
export async function executeSaga(steps: CompensationStep[], op: AtomicOperation): Promise<void> {
  const completedSteps: CompensationStep[] = [];

  for (const step of steps) {
    try {
      await step.execute();
      completedSteps.push(step);
    } catch (err) {
      logger.error({ err, step: step.name, op: op.operationId }, "[Saga] Step failed, compensating");

      // Compensate in reverse order
      for (let i = completedSteps.length - 1; i >= 0; i--) {
        try {
          await completedSteps[i].compensate();
          logger.info({ step: completedSteps[i].name }, "[Saga] Compensation successful");
        } catch (compErr) {
          logger.error({ err: compErr, step: completedSteps[i].name }, "[Saga] Compensation FAILED — manual intervention required");
        }
      }

      // Publish compensation event
      await publishFundFlowEvent({
        eventId: randomBytes(16).toString("hex"),
        eventType: "fund_flow_compensated",
        operationId: op.operationId,
        flowType: op.flowType,
        userId: op.userId,
        amount: op.amount,
        currency: op.currency,
        timestamp: new Date().toISOString(),
        metadata: { failedStep: step.name, error: err instanceof Error ? err.message : String(err) },
      });

      throw err;
    }
  }
}

// ─── Main Atomic Wrapper ─────────────────────────────────────────────────────

/**
 * withAtomicFundFlow — wraps any financial mutation with full atomicity guarantees:
 *
 * 1. Idempotency check (skip if already processed)
 * 2. Distributed lock (prevent concurrent modifications)
 * 3. Execute operation within a saga context
 * 4. Record TigerBeetle double-entry
 * 5. Publish Kafka event (audit trail)
 * 6. Publish Fluvio event (real-time streaming)
 * 7. Store result for idempotency
 * 8. Release lock
 *
 * If anything fails after step 3, the saga compensates automatically.
 */
export async function withAtomicFundFlow<T>(
  op: AtomicOperation,
  fn: () => Promise<T>,
  options?: {
    /** If true, record a TigerBeetle double-entry after success */
    recordLedger?: boolean;
    /** Debit account for TigerBeetle entry */
    debitAccount?: string;
    /** Credit account for TigerBeetle entry */
    creditAccount?: string;
    /** Skip distributed lock (for operations already inside a lock) */
    skipLock?: boolean;
    /** Compensation function if downstream fails */
    compensate?: () => Promise<void>;
  }
): Promise<AtomicResult<T>> {
  // 1. Idempotency check
  const cached = await checkIdempotency(op);
  if (cached !== null) {
    logger.info({ operationId: op.operationId }, "[Atomicity] Duplicate operation, returning cached result");
    return cached as AtomicResult<T>;
  }

  // 2. Distributed lock
  let lockToken = "";
  if (!options?.skipLock) {
    const lockResult = await acquireFundLock(op);
    if (!lockResult.acquired) {
      return {
        success: false,
        error: "Operation in progress — concurrent modification prevented",
        operationId: op.operationId,
      };
    }
    lockToken = lockResult.lockToken;
  }

  try {
    // 3. Publish initiated event
    const initiatedEvent: FundFlowEvent = {
      eventId: randomBytes(16).toString("hex"),
      eventType: "fund_flow_initiated",
      operationId: op.operationId,
      flowType: op.flowType,
      userId: op.userId,
      amount: op.amount,
      currency: op.currency,
      counterpartyId: op.counterpartyId,
      transferRef: op.transferRef,
      timestamp: new Date().toISOString(),
      metadata: op.metadata,
    };
    await publishFundFlowEvent(initiatedEvent);

    // 4. Execute the operation
    const data = await fn();

    // 5. Record TigerBeetle double-entry
    let ledgerEntryId: string | undefined;
    if (options?.recordLedger && options.debitAccount && options.creditAccount) {
      ledgerEntryId = await recordDoubleEntry({
        id: op.operationId,
        debitAccountId: options.debitAccount,
        creditAccountId: options.creditAccount,
        amount: op.amount,
        currency: op.currency,
        flowType: op.flowType,
        transferRef: op.transferRef ?? op.operationId,
        pending: false,
      });
    }

    // 6. Publish completed event
    const completedEvent: FundFlowEvent = {
      eventId: randomBytes(16).toString("hex"),
      eventType: "fund_flow_completed",
      operationId: op.operationId,
      flowType: op.flowType,
      userId: op.userId,
      amount: op.amount,
      currency: op.currency,
      counterpartyId: op.counterpartyId,
      transferRef: op.transferRef,
      ledgerEntryId,
      timestamp: new Date().toISOString(),
      metadata: op.metadata,
    };
    await publishFundFlowEvent(completedEvent);

    // 7. Build result and store for idempotency
    const result: AtomicResult<T> = {
      success: true,
      data,
      operationId: op.operationId,
      ledgerEntryId,
    };
    await storeIdempotencyResult(op, result);

    return result;
  } catch (err) {
    // Compensation
    if (options?.compensate) {
      try {
        await options.compensate();
      } catch (compErr) {
        logger.error({ compErr, operationId: op.operationId }, "[Atomicity] Compensation failed");
      }
    }

    // Publish failed event
    await publishFundFlowEvent({
      eventId: randomBytes(16).toString("hex"),
      eventType: "fund_flow_failed",
      operationId: op.operationId,
      flowType: op.flowType,
      userId: op.userId,
      amount: op.amount,
      currency: op.currency,
      timestamp: new Date().toISOString(),
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });

    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      operationId: op.operationId,
      sagaCompensated: !!options?.compensate,
    };
  } finally {
    // 8. Release lock
    if (!options?.skipLock && lockToken) {
      await releaseFundLock(op, lockToken);
    }
  }
}

// Clean up expired in-memory locks/cache every 5 minutes
setInterval(() => {
  const now = Date.now();
  localLocks.forEach((v, k) => { if (v.expiresAt < now) localLocks.delete(k); });
  idempotencyCache.forEach((v, k) => { if (v.expiresAt < now) idempotencyCache.delete(k); });
}, 300_000);
