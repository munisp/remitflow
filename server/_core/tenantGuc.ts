/**
 * Request-scoped tenant context for Row-Level Security (audit PG4).
 * ─────────────────────────────────────────────────────────────────
 * The tRPC tenant middleware (server/_core/trpc.ts) resolves the caller's
 * tenant ONCE per request and stores it here via AsyncLocalStorage. Every
 * database transaction opened for the request must call applyTenantGuc()
 * first so PostgreSQL RLS policies see app.current_tenant_id /
 * app.current_user_id. Lives in its own module (not trpc.ts/db.ts) so both
 * sides can import it without an import cycle.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";

export interface RequestTenantContext {
  /** Tenant id as string for set_config, or null when the user has no tenant. */
  tenantId: string | null;
  userId: string;
}

const storage = new AsyncLocalStorage<RequestTenantContext>();

/** Run `fn` with the given tenant context bound to this async execution. */
export function runWithTenantContext<T>(ctx: RequestTenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Current request's tenant context, or undefined outside a tRPC request. */
export function getRequestTenantContext(): RequestTenantContext | undefined {
  return storage.getStore();
}

/**
 * Set the RLS GUCs on an open transaction from the current request context.
 * FAILS CLOSED: when a tenant context is required (default) but absent, this
 * throws rather than running the transaction with no tenant isolation.
 * Callers in non-request contexts (workers, cron) must pass
 * { required: false } explicitly — that is a deliberate, visible choice.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function applyTenantGuc(tx: any, opts?: { required?: boolean }): Promise<void> {
  const required = opts?.required ?? true;
  const ctx = storage.getStore();
  if (!ctx) {
    if (required) {
      throw new Error("[RLS] No tenant context bound to this request — refusing to open transaction (fail-closed)");
    }
    return;
  }
  await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.userId}, true)`);
  await tx.execute(
    ctx.tenantId !== null
      ? sql`SELECT set_config('app.current_tenant_id', ${ctx.tenantId}, true)`
      : sql`SELECT set_config('app.current_tenant_id', '', true)`,
  );
  // RLS must never be bypassed on a request-scoped transaction.
  await tx.execute(sql`SELECT set_config('app.bypass_rls', 'false', true)`);
}
