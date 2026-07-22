import crypto from "crypto";
import { sql } from "drizzle-orm";
import { requireDb } from "../db";

/**
 * Hash a transfer reference to a PostgreSQL advisory-lock identifier.
 * The lock remains transaction-session scoped and is released in `finally`.
 */
function getLockId(transferRef: string): number {
  const hash = crypto.createHash("sha256").update(transferRef).digest();
  return hash.readInt32BE(0);
}

function rowsFrom(result: unknown): Array<{ acquired?: boolean }> {
  if (Array.isArray(result)) return result as Array<{ acquired?: boolean }>;
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? rows as Array<{ acquired?: boolean }> : [];
  }
  return [];
}

async function releaseTransferLock(lockId: number): Promise<void> {
  const db = await requireDb();
  await db.execute(sql`SELECT pg_advisory_unlock(${lockId})`);
}

/**
 * Acquire a non-blocking PostgreSQL advisory lock around a critical transfer
 * operation. The function fails closed whenever PostgreSQL is unavailable or
 * another invocation already holds the same transfer lock.
 */
export async function withTransferLock<T>(
  transferRef: string,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockId = getLockId(transferRef);
  const db = await requireDb();
  const result = await db.execute(sql`SELECT pg_try_advisory_lock(${lockId}) AS acquired`);
  const acquired = rowsFrom(result)[0]?.acquired === true;

  if (!acquired) {
    throw new Error(`Cannot ${label}: another operation is in progress for transfer ${transferRef}`);
  }

  try {
    return await fn();
  } finally {
    await releaseTransferLock(lockId);
  }
}
