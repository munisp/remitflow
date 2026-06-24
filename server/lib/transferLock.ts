/**
 * transferLock.ts — Distributed locking for transfer operations
 *
 * Prevents race conditions when multiple operations target the same transfer
 * concurrently (e.g., reversal + agent disbursement, concurrent cash-outs).
 *
 * Uses PostgreSQL advisory locks as the primary mechanism (no Redis required).
 * Each transfer reference is hashed to a 64-bit lock ID.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db.js";
import { createHash } from "crypto";
import { logger } from "../_core/logger.js";

/**
 * Convert a transfer reference to a PostgreSQL advisory lock key.
 * Uses CRC32 of SHA-256 to get a stable 32-bit integer.
 */
function transferRefToLockId(transferRef: string): number {
  const hash = createHash("sha256").update(transferRef).digest();
  // Use first 4 bytes as a signed 32-bit integer for pg_advisory_lock
  return hash.readInt32BE(0);
}

/**
 * Acquire an advisory lock for a transfer reference.
 * Returns true if the lock was acquired, false if it's already held.
 * Uses pg_try_advisory_lock (non-blocking) to avoid deadlocks.
 */
export async function acquireTransferLock(transferRef: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const lockId = transferRefToLockId(transferRef);
  try {
    const result = await db.execute(
      sql`SELECT pg_try_advisory_lock(${lockId}) as acquired`
    );
    const acquired = (result.rows ?? result)?.[0] as any;
    if (acquired?.acquired) {
      logger.debug({ transferRef, lockId }, "[TransferLock] Acquired");
      return true;
    }
    logger.warn({ transferRef, lockId }, "[TransferLock] Already held by another operation");
    return false;
  } catch (err) {
    logger.error({ err, transferRef }, "[TransferLock] Failed to acquire");
    return false;
  }
}

/**
 * Release an advisory lock for a transfer reference.
 */
export async function releaseTransferLock(transferRef: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const lockId = transferRefToLockId(transferRef);
  try {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockId})`);
    logger.debug({ transferRef, lockId }, "[TransferLock] Released");
  } catch (err) {
    logger.error({ err, transferRef }, "[TransferLock] Failed to release");
  }
}

/**
 * Execute a function while holding a transfer lock.
 * Automatically acquires and releases the lock.
 * Throws if the lock cannot be acquired (another operation in progress).
 */
export async function withTransferLock<T>(
  transferRef: string,
  operationName: string,
  fn: () => Promise<T>
): Promise<T> {
  const acquired = await acquireTransferLock(transferRef);
  if (!acquired) {
    throw new Error(
      `Cannot ${operationName}: another operation is in progress for transfer ${transferRef}. Please try again.`
    );
  }

  try {
    return await fn();
  } finally {
    await releaseTransferLock(transferRef);
  }
}
