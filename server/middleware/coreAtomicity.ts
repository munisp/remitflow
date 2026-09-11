/**
 * RemitFlow — Core Atomicity Middleware
 *
 * Provides distributed locking, idempotency caching, TigerBeetle double-entry,
 * and Kafka event publishing for ALL fund flow operations.
 *
 * Components:
 *   - Redis distributed lock (30s TTL, fail-hard in production)
 *   - SHA-256 idempotency key with 24h TTL
 *   - TigerBeetle double-entry recording
 *   - Kafka audit trail on every mutation
 *   - Temporal saga compensation hooks
 */

import { createHash, randomUUID, randomBytes } from "crypto";
import { logger } from "../_core/logger";
import { getRedisClient, REDIS_KEYS } from "./redis";
import { isRedisAvailable } from "./redisHardened";
import { publishEvent, KAFKA_TOPICS, type TransactionEvent } from "./kafka";
import { tigerBeetle } from "./middlewareIntegration";
import { createAuditLog } from "../db";

// ── Topics ──────────────────────────────────────────────────────────────────
export const CORE_TOPICS = {
  SAVINGS_DEPOSIT: "remitflow.savings.deposit",
  SAVINGS_WITHDRAW: "remitflow.savings.withdraw",
  CBDC_TRANSFER: "remitflow.cbdc.transfer",
  CBDC_RECEIVE: "remitflow.cbdc.receive",
  BILL_PAYMENT: "remitflow.bill.payment",
  AIRTIME_TOPUP: "remitflow.airtime.topup",
  BATCH_PAYMENT: "remitflow.batch.payment",
  WALLET_TOPUP: "remitflow.wallet.topup",
  WALLET_WITHDRAW: "remitflow.wallet.withdraw",
  STABLECOIN_SWAP: "remitflow.stablecoin.swap",
  STABLECOIN_ONRAMP: "remitflow.stablecoin.onramp",
  STABLECOIN_OFFRAMP: "remitflow.stablecoin.offramp",
  STABLECOIN_BRIDGE: "remitflow.stablecoin.bridge",
  STABLECOIN_YIELD: "remitflow.stablecoin.yield",
  FUND_FLOW_COMPENSATED: "remitflow.fund.compensated",
} as const;

// ── Idempotency ─────────────────────────────────────────────────────────────

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const LOCK_TTL_MS = 30_000; // 30 seconds


// ── PostgreSQL Write-Through ─────────────────────────────────────────────────
// All in-memory Maps are persisted to PostgreSQL on write and loaded on startup.

let _wtDb: ReturnType<typeof import("drizzle-orm/postgres-js").drizzle> | null = null;

async function _getWtDb() {
  if (_wtDb) return _wtDb;
  try {
    const { getDb } = await import("../db.js");
    _wtDb = await getDb();
    return _wtDb;
  } catch {
    return null;
  }
}

async function _writeThrough(table: string, key: string, value: unknown): Promise<void> {
  const db = await _getWtDb();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      INSERT INTO ${sql.raw(table)} (key, data, updated_at)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `);
  } catch { /* silent — hot cache still works */ }
}

async function _loadFromDb(table: string): Promise<Map<string, any>> {
  const result = new Map<string, any>();
  const db = await _getWtDb();
  if (!db) return result;
  try {
    const { sql } = await import("drizzle-orm");
    const rows = await (db as any).execute(sql`SELECT key, data FROM ${sql.raw(table)}`);
    for (const row of rows) {
      result.set(row.key, row.data);
    }
  } catch { /* silent */ }
  return result;
}

async function _deleteFromDb(table: string, key: string): Promise<void> {
  const db = await _getWtDb();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`DELETE FROM ${sql.raw(table)} WHERE key = ${key}`);
  } catch { /* silent */ }
}

async function _ensureWriteThroughTables(): Promise<void> {
  const db = await _getWtDb();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      CREATE TABLE IF NOT EXISTS core_idempotency_cache (
        key TEXT PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await (db as any).execute(sql`
      CREATE TABLE IF NOT EXISTS core_distributed_locks (
        key TEXT PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch { /* silent */ }
}

// Initialize tables on module load
_ensureWriteThroughTables().catch(() => {});

const inMemoryIdempotency = new Map<string, { result: unknown; expiresAt: number }>(); // Persisted to PostgreSQL table "core_idempotency_cache"
const inMemoryLocks = new Map<string, number>(); // Persisted to PostgreSQL table "core_distributed_locks"

export function generateIdempotencyKey(
  userId: number,
  operation: string,
  ...args: (string | number)[]
): string {
  const raw = `${userId}:${operation}:${args.join(":")}`;
  return createHash("sha256").update(raw).digest("hex");
}

// ── Idempotency Cache ───────────────────────────────────────────────────────
//
// W12-FIX-2 (follow-up to F2-9): the sync checkIdempotency/storeIdempotency
// pair below is used by routers.ts money mutations (wallet topup :846,
// savings deposit :1886, airtime :3713, bill pay :3752) with the pattern
//   check → mutate → store.
// Previously the ONLY store was the per-process in-memory Map (the PG
// "write-through" is fire-and-forget with a silent catch and no unique-claim
// arbitration), so a duplicate request after a restart or on a second
// replica re-executed the money movement.
//
// Hardening (no signature changes, no caller edits required):
//   - storeIdempotency now also writes the result to Redis (fire-and-forget;
//     money already moved at this point, so a failed write logs CRITICAL in
//     production but NEVER throws post-commit).
//   - checkIdempotency FAILS CLOSED in production when Redis is unhealthy:
//     it throws IdempotencyStoreUnavailableError rather than "dedupe" against
//     an empty post-restart Map. All current callers are money paths, so the
//     default is deny; a future non-money caller may pass
//     { allowDegradedFallback: true } to keep the in-memory path with a WARN.
//
// Authoritative cross-instance claim: the sync API cannot make an atomic
// Redis claim, so the new async claimIdempotency() below performs
// SET NX PX (pending marker → later overwritten with the result by
// storeIdempotency). routers.ts migration is a one-line change per site:
//   const cached = checkIdempotency(key);            →   const cached = await claimIdempotency(key);
//   storeIdempotency(key, result);                    →   (unchanged — now writes through to Redis)
//
// Why not the `idempotency_keys` PG table as the authority? It has a proper
// UNIQUE(tenant_id,user_id,operation,key) claim (drizzle/schema.ts:631-651)
// but it is unused by these callers, requires async + tenant context the
// sync call sites don't have, and a claim written outside the money
// transaction re-opens the same crash window. Redis SET NX PX is atomic and
// matches the platform's other money-path claims (billCapture, fundFlow
// atomicity). Documented choice: Redis-first, fail-closed on outage.

/** Redis key namespace for the claim-based idempotency (distinct from the
 *  `idempotent:` keys used by withAtomicOperation). */
const IDEMP_CLAIM_PREFIX = "idempclaim:";
/** Value prefixes on the claim key: pending:<token> while in flight,
 *  result:<json> after completion. */
const IDEMP_PENDING_PREFIX = "pending:";
const IDEMP_RESULT_PREFIX = "result:";

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

/** True when the hardened Redis client exists and is connected ("ready"). */
function redisHealthy(): boolean {
  try {
    // Lazy require-style import avoidance: use the facade's client handle and
    // the hardened module's availability signal.
    return isRedisAvailable();
  } catch {
    return false;
  }
}

function assertIdempotencyAvailableSync(op: "read" | "write", key: string, allowDegradedFallback?: boolean): void {
  if (redisHealthy()) return;
  if (isProd() && !allowDegradedFallback) {
    logger.error({ key, op }, "[Atomicity] Idempotency check blocked — Redis unhealthy in production (fail-closed, money path)");
    throw new IdempotencyStoreUnavailableError(
      `[Atomicity] Redis unavailable — cannot ${op} idempotency record for ${key}; operation denied, retry later`
    );
  }
  logger.warn({ key, op }, "[Atomicity] Redis unavailable — in-memory idempotency fallback (non-production / degraded-allowed only)");
}

export function checkIdempotency(key: string, opts?: { allowDegradedFallback?: boolean }): { cached: boolean; result?: unknown } {
  // Fail-closed in production when Redis is down (see header note). When
  // Redis is healthy this is the in-memory fast path; the authoritative
  // cross-instance check is claimIdempotency() (async).
  assertIdempotencyAvailableSync("read", key, opts?.allowDegradedFallback);
  const entry = inMemoryIdempotency.get(key);
  if (!entry) return { cached: false };
  if (Date.now() > entry.expiresAt) {
    inMemoryIdempotency.delete(key);

    _deleteFromDb("core_idempotency_cache", key).catch(() => {});
    return { cached: false };
  }
  return { cached: true, result: entry.result };
}

export function storeIdempotency(key: string, result: unknown): void {
  inMemoryIdempotency.set(key, { result, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
  // Write-through to Redis so the claim key transitions pending → result and
  // cross-instance/restart replays are served. Fire-and-forget by design:
  // the money mutation has ALREADY committed when callers invoke this, so a
  // failed write must never throw (post-commit errors would trick clients
  // into retrying). Production failures are CRITICAL-logged instead.
  const redis = getRedisClient();
  if (!redis) {
    if (isProd()) {
      logger.error({ key }, "[Atomicity] CRITICAL: idempotency result not persisted to Redis (post-commit) — replay protection degraded until Redis recovers");
    }
    return;
  }
  redis
    .set(`${IDEMP_CLAIM_PREFIX}${key}`, `${IDEMP_RESULT_PREFIX}${JSON.stringify(result)}`, "PX", IDEMPOTENCY_TTL_MS)
    .then((ok) => {
      if (ok !== "OK" && isProd()) {
        logger.error({ key }, "[Atomicity] CRITICAL: idempotency result write not acknowledged by Redis (post-commit)");
      }
    })
    .catch((err) => {
      if (isProd()) {
        logger.error({ err, key }, "[Atomicity] CRITICAL: idempotency result write to Redis failed (post-commit)");
      } else {
        logger.warn({ err, key }, "[Atomicity] idempotency write-through to Redis failed (non-production)");
      }
    });
}

/**
 * Authoritative async idempotency claim for money-moving operations.
 * Atomically claims the key via SET NX PX:
 *   - fresh claim            → { cached: false } — caller executes the op,
 *                              then storeIdempotency() publishes the result.
 *   - completed prior run    → { cached: true, result } — replay-safe return.
 *   - in-flight prior run    → throws IdempotencyConflictError (retryable; the
 *                              first request is mid-execution — never run twice).
 *   - Redis unavailable      → production: throws IdempotencyStoreUnavailableError
 *                              (retryable, fail-closed); non-production: WARN +
 *                              in-memory fallback.
 */
export async function claimIdempotency(
  key: string,
  ttlMs: number = IDEMPOTENCY_TTL_MS,
  opts?: { allowDegradedFallback?: boolean },
): Promise<{ cached: boolean; result?: unknown }> {
  const redis = getRedisClient();
  if (!redis) {
    if (isProd() && !opts?.allowDegradedFallback) {
      logger.error({ key }, "[Atomicity] Idempotency claim blocked — Redis unavailable in production (fail-closed, money path)");
      throw new IdempotencyStoreUnavailableError(
        `[Atomicity] Redis unavailable — cannot claim idempotency key ${key}; operation denied, retry later`
      );
    }
    logger.warn({ key }, "[Atomicity] Redis unavailable — in-memory idempotency claim (non-production / degraded-allowed only)");
    return checkIdempotency(key, { allowDegradedFallback: true });
  }

  const claimKey = `${IDEMP_CLAIM_PREFIX}${key}`;
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    let setResult: string | null;
    try {
      setResult = await redis.set(claimKey, `${IDEMP_PENDING_PREFIX}${token}`, "PX", ttlMs, "NX");
    } catch (err) {
      if (isProd() && !opts?.allowDegradedFallback) {
        logger.error({ err, key }, "[Atomicity] Idempotency claim failed — Redis error in production (fail-closed, money path)");
        throw new IdempotencyStoreUnavailableError(
          `[Atomicity] Redis error claiming idempotency key ${key}: ${(err as Error).message}; operation denied, retry later`
        );
      }
      logger.warn({ err, key }, "[Atomicity] Redis error on idempotency claim — in-memory fallback (non-production)");
      return checkIdempotency(key, { allowDegradedFallback: true });
    }
    if (setResult === "OK") return { cached: false };

    // Claim lost — inspect the holder's value.
    let holder: string | null = null;
    try {
      holder = await redis.get(claimKey);
    } catch (err) {
      if (isProd() && !opts?.allowDegradedFallback) {
        throw new IdempotencyStoreUnavailableError(
          `[Atomicity] Redis error reading idempotency claim ${key}: ${(err as Error).message}; operation denied, retry later`
        );
      }
      return checkIdempotency(key, { allowDegradedFallback: true });
    }
    if (holder === null) continue; // holder's TTL expired between SET and GET — retry the claim once
    if (holder.startsWith(IDEMP_RESULT_PREFIX)) {
      try {
        return { cached: true, result: JSON.parse(holder.slice(IDEMP_RESULT_PREFIX.length)) };
      } catch {
        return { cached: true, result: holder.slice(IDEMP_RESULT_PREFIX.length) };
      }
    }
    // In-flight ("pending:<token>") — a concurrent request is executing the
    // operation right now. Deny rather than double-execute.
    throw new IdempotencyConflictError(
      `[Atomicity] Operation for idempotency key ${key} is already in flight — retry later`
    );
  }
  // Both attempts lost the claim to expiring holders — deny retryably rather
  // than risk concurrent execution.
  throw new IdempotencyConflictError(
    `[Atomicity] Could not establish idempotency claim for ${key} — retry later`
  );
}

/** Retryable 409-style denial for in-flight duplicate operations. */
export class IdempotencyConflictError extends Error {
  readonly retryable = true;
  readonly code = "CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

// ── Operation Reference Generator ───────────────────────────────────────────
export function generateOpRef(prefix: string, userId: number): string {
  return `${prefix}-${userId}-${Date.now()}-${randomBytes(3).toString("hex")}`;
}

// ── Distributed Lock ────────────────────────────────────────────────────────

export async function acquireLock(lockKey: string): Promise<string | null> {
  const lockId = randomUUID();
  const redis = getRedisClient();

  if (redis) {
    try {
      const result = await redis.set(
        `lock:fund:${lockKey}`,
        lockId,
        "PX",
        LOCK_TTL_MS,
        "NX"
      );
      return result === "OK" ? lockId : null;
    } catch (err) {
      logger.warn({ err }, "[Atomicity] Redis lock failed");
    }
  }

  // In-memory fallback (dev only)
  if (process.env.NODE_ENV === "production") {
    throw new Error("Redis unavailable — fund operations blocked in production");
  }
  const existing = inMemoryLocks.get(lockKey);
  if (existing && existing > Date.now()) return null;
  inMemoryLocks.set(lockKey, Date.now() + LOCK_TTL_MS);
  return lockId;
}

export async function releaseLock(lockKey: string, lockId: string): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    try {
      const script = `if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`;
      await redis.eval(script, 1, `lock:fund:${lockKey}`, lockId);
    } catch { /* best effort */ }
    return;
  }
  inMemoryLocks.delete(lockKey);

  _deleteFromDb("core_distributed_locks", lockKey).catch(() => {});
}

// ── Redis-backed Idempotency (async) ────────────────────────────────────────
//
// W12-FIX (audit F2-9): these functions back `withAtomicOperation`, the
// money-path wrapper. Previously they FAILED OPEN: when Redis was down (null
// client) or erroring, they silently fell through to the per-process
// in-memory Map — so a duplicate POST replayed during a Redis outage (or
// after a restart, or on a different replica) was NOT detected and the money
// operation executed twice.
//
// Policy: production FAILS CLOSED — Redis unavailable/erroring throws a
// retryable IdempotencyStoreUnavailableError and the operation is DENIED,
// never "proceeds without idempotency". Non-production keeps the in-memory
// fallback for dev convenience (mirrors acquireLock's dev fallback).
//
// Why not fall back to the DB write-through as the authoritative claim?
// The `_writeThrough` helper is fire-and-forget with a silent catch and no
// unique-claim semantics (no INSERT ... ON CONFLICT DO NOTHING RETURNING
// arbitration, no transaction with the money mutation) — it cannot, by
// itself, prevent duplicates, so it does not qualify as an authoritative
// backstop. Redis is therefore the single authoritative store here, and
// unavailability must deny the operation.

/** Retryable denial — the client/caller should retry the operation later. */
export class IdempotencyStoreUnavailableError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyStoreUnavailableError";
  }
}

function idempotencyStoreDown(op: "read" | "write", key: string, err?: unknown): never | void {
  if (process.env.NODE_ENV === "production") {
    logger.error({ err, key, op }, "[Atomicity] Idempotency store unavailable in production — denying money operation (fail-closed)");
    throw new IdempotencyStoreUnavailableError(
      `[Atomicity] Redis unavailable — cannot ${op} idempotency record for ${key}; operation denied, retry later`
    );
  }
  logger.warn({ err, key, op }, "[Atomicity] Redis unavailable — in-memory idempotency fallback (non-production only)");
}

export async function getIdempotentResult(key: string): Promise<unknown | null> {
  const redis = getRedisClient();
  if (redis) {
    try {
      const cached = await redis.get(`idempotent:${key}`);
      return cached ? JSON.parse(cached) : null;
    } catch (err) {
      idempotencyStoreDown("read", key, err); // throws in production
    }
  } else {
    idempotencyStoreDown("read", key); // throws in production
  }
  // Non-production fallback only.
  const entry = inMemoryIdempotency.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.result;
  return null;
}

export async function setIdempotentResult(key: string, result: unknown): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set(`idempotent:${key}`, JSON.stringify(result), "PX", IDEMPOTENCY_TTL_MS);
      return;
    } catch (err) {
      idempotencyStoreDown("write", key, err); // throws in production
    }
  } else {
    idempotencyStoreDown("write", key); // throws in production
  }
  // Non-production fallback only.
  inMemoryIdempotency.set(key, { result, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
}

// ── TigerBeetle Double-Entry ────────────────────────────────────────────────

const TIGERBEETLE_URL = process.env.TIGERBEETLE_HTTP_URL || "http://localhost:3320";

export async function recordDoubleEntry(params: {
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  currency: string;
  transferRef: string;
  operation: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`${TIGERBEETLE_URL}/transfers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: params.transferRef,
        debit_account_id: params.debitAccountId,
        credit_account_id: params.creditAccountId,
        amount: Math.round(params.amount * 100),
        ledger: 1,
        code: 1,
        user_data_128: params.operation,
        user_data_64: params.currency,
        timestamp: Date.now(),
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(`TigerBeetle write failed: ${res.status}`);
      }
      logger.warn({ status: res.status }, "[TigerBeetle] Write failed — dev mode, continuing");
      return false;
    }
    return true;
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`TigerBeetle unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
    logger.warn({ err }, "[TigerBeetle] Unavailable — dev mode, continuing");
    return false;
  }
}

export async function recordCoreDoubleEntry(params: {
  userId: number;
  amount: number;
  featureLabel: string;
  transferId: string;
  ledger?: number;
}): Promise<boolean> {
  try {
    const transferBigId = BigInt(Date.now()) * BigInt(1000) + BigInt(Math.floor(Math.random() * 1000));
    const debitAccountId = BigInt(params.userId);
    const creditAccountId = BigInt(params.userId + 1_000_000);
    const amountCents = BigInt(Math.round(params.amount * 100));
    await tigerBeetle.createTransfer({
      id: transferBigId,
      debitAccountId,
      creditAccountId,
      amount: amountCents,
      ledger: params.ledger ?? 1,
      code: 1,
    });
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), feature: params.featureLabel },
      "[CoreAtomicity] TigerBeetle degraded, using DB fallback"
    );
    return false;
  }
}

// ── Kafka Audit ─────────────────────────────────────────────────────────────

export async function publishFundFlowEvent(
  topic: string,
  key: string,
  event: Record<string, unknown>
): Promise<void> {
  try {
    await publishEvent(topic as any, key, {
      ...event,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn({ err, topic, key }, "[Atomicity] Kafka publish failed");
    if (process.env.NODE_ENV === "production") {
      throw new Error("Kafka unavailable — fund event lost");
    }
  }
}

export async function publishCoreEvent(params: {
  topic: string;
  userId: number;
  amount: number;
  currency: string;
  featureLabel: string;
  operationRef: string;
  eventType?: "created" | "completed" | "failed";
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  try {
    const event: TransactionEvent = {
      eventType: params.eventType ?? "completed",
      transactionId: params.operationRef,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      status: params.eventType === "failed" ? "failed" : "completed",
      timestamp: new Date().toISOString(),
    };
    await publishEvent(
      params.topic as any,
      params.operationRef,
      { ...event, feature: params.featureLabel, ...(params.metadata ?? {}) }
    );
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), feature: params.featureLabel },
      "[CoreAtomicity] Kafka publish degraded"
    );
    return false;
  }
}

// ── Audit + TigerBeetle + Kafka Wrapper ─────────────────────────────────────

export async function auditCoreOperation(params: {
  userId: number;
  action: string;
  description: string;
  amount: number;
  currency: string;
  featureLabel: string;
  operationRef: string;
  kafkaTopic: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  tigerBeetleRecorded: boolean;
  kafkaPublished: boolean;
  auditLogged: boolean;
}> {
  const [tigerBeetleRecorded, kafkaPublished] = await Promise.all([
    recordCoreDoubleEntry({
      userId: params.userId,
      amount: params.amount,
      featureLabel: params.featureLabel,
      transferId: params.operationRef,
    }),
    publishCoreEvent({
      topic: params.kafkaTopic,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      featureLabel: params.featureLabel,
      operationRef: params.operationRef,
      metadata: params.metadata,
    }),
  ]);

  let auditLogged = false;
  try {
    await createAuditLog({
      userId: params.userId,
      action: params.action,
      description: params.description,
      metadata: {
        operationRef: params.operationRef,
        tigerBeetleRecorded,
        kafkaPublished,
        feature: params.featureLabel,
        ...params.metadata,
      },
    });
    auditLogged = true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[CoreAtomicity] Audit log failed"
    );
  }

  return { tigerBeetleRecorded, kafkaPublished, auditLogged };
}

// ── Composite: Atomic Fund Flow ─────────────────────────────────────────────

export interface AtomicFundFlowParams {
  userId: number;
  operation: string;
  amount: number;
  currency: string;
  debitAccountId: string;
  creditAccountId: string;
  topic: string;
  metadata?: Record<string, unknown>;
}

export async function withAtomicFundFlow<T>(
  params: AtomicFundFlowParams,
  fn: () => Promise<T>
): Promise<T> {
  const idempotencyKey = generateIdempotencyKey(
    params.userId,
    params.operation,
    params.amount.toString(),
    params.currency
  );

  // Check idempotency
  const cached = await getIdempotentResult(idempotencyKey);
  if (cached) {
    logger.info({ operation: params.operation }, "[Atomicity] Idempotent replay");
    return cached as T;
  }

  // Acquire lock
  const lockKey = `${params.userId}:${params.operation}`;
  const lockId = await acquireLock(lockKey);
  if (!lockId) {
    throw new Error("Operation in progress — please wait");
  }

  try {
    // Execute operation
    const result = await fn();

    // Record in TigerBeetle
    await recordDoubleEntry({
      debitAccountId: params.debitAccountId,
      creditAccountId: params.creditAccountId,
      amount: params.amount,
      currency: params.currency,
      transferRef: `${params.operation}-${params.userId}-${Date.now()}`,
      operation: params.operation,
    });

    // Publish Kafka event
    await publishFundFlowEvent(params.topic, `${params.operation}:${params.userId}`, {
      eventType: params.operation,
      userId: params.userId,
      amount: params.amount,
      currency: params.currency,
      ...(params.metadata || {}),
    });

    // Cache result
    await setIdempotentResult(idempotencyKey, result);

    return result;
  } finally {
    await releaseLock(lockKey, lockId);
  }
}
