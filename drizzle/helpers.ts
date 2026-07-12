/**
 * RemitFlow — Drizzle ORM Query Helpers
 * ──────────────────────────────────────
 * Type-safe, reusable query builders for common patterns across all 271+ tables.
 *
 * Features:
 *   - Paginated queries with cursor-based pagination
 *   - Soft-delete support
 *   - Optimistic locking via version columns
 *   - Bulk upsert helpers
 *   - Audit trail auto-injection
 *   - JSON aggregation helpers
 *   - Full-text search helpers
 */
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";

// ─── Pagination ───────────────────────────────────────────────────────────────
export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total?: number;
  page: number;
  limit: number;
  hasMore: boolean;
  nextCursor?: number;
}

export function buildPaginationOffset(params: PaginationParams): { offset: number; limit: number } {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  return { offset: (page - 1) * limit, limit };
}

export function buildCursorCondition<T extends PgTable>(
  table: T,
  idColumn: PgColumn,
  cursor?: number
) {
  return cursor ? gt(idColumn, cursor) : undefined;
}

// ─── Soft Delete ──────────────────────────────────────────────────────────────
export function notDeleted<T extends PgTable>(table: T, deletedAtColumn: PgColumn) {
  return isNull(deletedAtColumn);
}

// ─── Optimistic Locking ───────────────────────────────────────────────────────
export function withVersion<T extends Record<string, unknown>>(data: T, expectedVersion: number): T & { version: number } {
  return { ...data, version: expectedVersion + 1 };
}

// ─── Date Range ───────────────────────────────────────────────────────────────
export function dateRange(column: PgColumn, from?: Date, to?: Date) {
  const conditions = [];
  if (from) conditions.push(gte(column, from));
  if (to) conditions.push(lte(column, to));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

// ─── Full-Text Search ─────────────────────────────────────────────────────────
export function ilikSearch(column: PgColumn, query: string) {
  return ilike(column, `%${query.trim()}%`);
}

// ─── Bulk Upsert Helper ───────────────────────────────────────────────────────
export function buildOnConflictSet<T extends Record<string, unknown>>(
  data: T,
  excludeKeys: string[] = ["id", "createdAt"]
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([k]) => !excludeKeys.includes(k))
      .map(([k, v]) => [k, sql.raw(`EXCLUDED."${k}"`)])
  );
}

// ─── Status Filters ───────────────────────────────────────────────────────────
export function activeOnly(statusColumn: PgColumn) {
  return eq(statusColumn, "active");
}

export function pendingOnly(statusColumn: PgColumn) {
  return eq(statusColumn, "pending");
}

// ─── JSON Aggregation ─────────────────────────────────────────────────────────
export function jsonAgg(column: PgColumn) {
  return sql<unknown[]>`json_agg(${column})`;
}

export function jsonbBuildObject(fields: Record<string, PgColumn>) {
  const args = Object.entries(fields)
    .flatMap(([k, v]) => [sql.raw(`'${k}'`), v])
    .join(", ");
  return sql`jsonb_build_object(${sql.raw(args)})`;
}

// ─── Audit Trail Injection ────────────────────────────────────────────────────
export interface AuditContext {
  userId: number;
  ipAddress?: string;
  userAgent?: string;
}

export function withAuditContext<T extends Record<string, unknown>>(
  data: T,
  ctx: AuditContext
): T & { updatedBy: number } {
  return { ...data, updatedBy: ctx.userId };
}

// ─── Common Ordering ─────────────────────────────────────────────────────────
export function newestFirst(createdAtColumn: PgColumn) {
  return desc(createdAtColumn);
}

export function oldestFirst(createdAtColumn: PgColumn) {
  return asc(createdAtColumn);
}

// ─── Batch Operations ─────────────────────────────────────────────────────────
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ─── Type-Safe Column Selector ────────────────────────────────────────────────
export type SelectColumns<T extends PgTable> = {
  [K in keyof T["_"]["columns"]]?: boolean;
};

// ─── Integration-Aware Query Helpers ─────────────────────────────────────────
/**
 * Builds a query condition that checks if a TigerBeetle account is provisioned.
 */
export function hasTigerBeetleAccount(tbAccountColumn: PgColumn) {
  return sql`${tbAccountColumn} IS NOT NULL AND ${tbAccountColumn} > 0`;
}

/**
 * Builds a query condition for Temporal workflow status.
 */
export function temporalWorkflowRunning(temporalIdColumn: PgColumn) {
  return sql`${temporalIdColumn} IS NOT NULL AND ${temporalIdColumn} NOT LIKE 'fallback-%' AND ${temporalIdColumn} NOT LIKE 'error-%'`;
}

/**
 * Builds a query condition for Keycloak-linked users.
 */
export function keycloakLinked(keycloakRoleColumn: PgColumn) {
  return sql`${keycloakRoleColumn} IS NOT NULL`;
}

// ─── Transaction Helpers ──────────────────────────────────────────────────────
/**
 * Wraps a Drizzle transaction with retry logic for serialization failures.
 */
export async function withRetryTransaction<T>(
  db: { transaction: (fn: (tx: unknown) => Promise<T>) => Promise<T> },
  fn: (tx: unknown) => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await db.transaction(fn);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Retry on serialization failure (PostgreSQL error code 40001)
      if (msg.includes("40001") || msg.includes("serialization")) {
        await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
