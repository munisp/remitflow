import crypto from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Hashes a transfer reference to a 32-bit lock ID using SHA-256.
 * PostgreSQL advisory locks use 32-bit integers.
 */
function getLockId(transferRef: string): number {
  const hash = crypto.createHash("sha256").update(transferRef).digest();
  return hash.readInt32BE(0);
}

/**
 * Releases a PostgreSQL advisory lock.
 */
async function releaseTransferLock(lockId: number): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_unlock(${lockId})`);
}

/**
 * Acquires a PostgreSQL advisory lock using pg_try_advisory_lock (non-blocking).
 * Wraps an operation in a distributed lock to prevent concurrent modifications
 * to the same transfer.
 *
 * Throws if the lock cannot be acquired (another operation is in progress).
 */
export async function withTransferLock<T>(
  transferRef: string,
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockId = getLockId(transferRef);

  const result = await db.execute(sql`SELECT pg_try_advisory_lock(${lockId}) AS acquired`);
  const acquired = (result.rows[0] as { acquired: boolean }).acquired;

  if (!acquired) {
    throw new Error(
      `Cannot ${label}: another operation is in progress for transfer ${transferRef}`
    );
  }

  try {
    return await fn();
  } finally {
    await releaseTransferLock(lockId);
  }
}
