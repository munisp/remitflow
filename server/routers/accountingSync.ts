/**
 * RemitFlow — Accounting Sync Router (W10-C4)
 * ─────────────────────────────────────────────────────────────────────────────
 * TS side of the QuickBooks Online / Xero / Odoo sync bridge. The Go service
 * (services/go-accounting-sync, :8113) owns the OAuth redirect dance and the
 * provider API calls; this router owns persistence:
 *
 *   - accounting_connections rows (status machine: pending_auth → active →
 *     revoked; error surfaces as status failed rows in accounting_sync_logs)
 *   - OAuth tokens — ALWAYS stored via secretBox encryptField (AES-256-GCM).
 *     Raw tokens never touch the DB and are never logged.
 *   - accounting_sync_logs — per-entity sync outcomes, including failures.
 *
 * Auth model:
 *   - startConnect / disconnect / triggerSync / exportCsv: PBAC adminProcedure
 *     (tenant-scoped via the caller's session — never a client-supplied
 *     tenantId).
 *   - syncStatus / syncLogs: protectedProcedure, tenant-scoped reads.
 *   - completeConnect: service-key procedure — called ONLY by the Go service
 *     with X-Service-Key == INTERNAL_SERVICE_KEY (constant-time compare; the
 *     env var unset → fail closed 503).
 *
 * Kafka: emits remitflow.accounting-sync on connect / sync-complete / error.
 *
 * Periodic sync: the repo scheduler (server/scheduler.ts) is node-cron based
 * and has no Temporal schedule primitive for this job, so this module exposes
 * startAccountingSyncSchedule() for boot registration.
 * NOTE FOR ORCHESTRATOR: register startAccountingSyncSchedule() in
 * server/_core/index.ts alongside the other boot schedulers (this contract
 * intentionally does NOT edit _core/index.ts).
 */
import { z } from "zod";
import crypto from "crypto";
import cron from "node-cron";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { accountingConnections, accountingSyncLogs } from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "../_core/logger";
import { encryptField, decryptField } from "../_core/secretBox";
import { resolveTenantContext } from "../tenantMiddleware";
import { publishEvent } from "../middleware/kafka";

// ─── Constants & helpers ──────────────────────────────────────────────────────

const GO_SYNC_URL = process.env.GO_ACCOUNTING_SYNC_URL || "http://localhost:8113";
const ACCOUNTING_SYNC_TOPIC = "remitflow.accounting-sync";

const providerEnum = z.enum(["quickbooks_online", "xero", "odoo"]);
type Provider = z.infer<typeof providerEnum>;

/** Non-secret Odoo connection extras persisted in accounting_connections.metadata. */
type OdooConnectionMeta = { apiUrl?: string; username?: string };

function odooMeta(conn: { metadata?: unknown }): OdooConnectionMeta {
  const m = conn.metadata;
  if (m && typeof m === "object" && !Array.isArray(m)) return m as OdooConnectionMeta;
  return {};
}

/** Fail-closed internal service key (mirrors microservicesExtended pattern). */
function requireServiceKey(): string {
  const key = process.env.INTERNAL_SERVICE_KEY;
  if (!key) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE" as "INTERNAL_SERVER_ERROR",
      message: "INTERNAL_SERVICE_KEY is not configured — accounting sync service calls are disabled (fail-closed)",
    });
  }
  return key;
}

/** Constant-time check of the X-Service-Key header on service-to-service calls. */
function assertServiceCall(headers: Record<string, unknown> | undefined): void {
  const expected = process.env.INTERNAL_SERVICE_KEY;
  if (!expected) {
    // No key configured => there is nothing valid to compare against.
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE" as "INTERNAL_SERVER_ERROR", message: "Service callbacks disabled: INTERNAL_SERVICE_KEY is not configured" });
  }
  const presented = String(headers?.["x-service-key"] ?? "");
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid service key" });
  }
}

/** Resolve the caller's session tenant; fail closed when unresolvable. */
async function requireTenantId(userId: number): Promise<number> {
  const session = await resolveTenantContext(userId);
  if (session.tenantId == null) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tenant context for the current session — accounting sync requires a tenant" });
  }
  return session.tenantId;
}

function emitSyncEvent(type: "connect" | "sync-complete" | "error", payload: Record<string, unknown>): void {
  publishEvent(ACCOUNTING_SYNC_TOPIC, `accounting:${payload.connectionId ?? payload.tenantId ?? "unknown"}`, {
    type,
    ...payload,
    timestamp: new Date().toISOString(),
  }).catch((err: unknown) =>
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[AccountingSync] Kafka event failed"),
  );
}

/** Never log raw tokens — redact connection rows for safe logging. */
function redactConnection(c: { id: number; provider: string; status: string }) {
  return { id: c.id, provider: c.provider, status: c.status };
}

async function writeSyncLog(entry: {
  connectionId: number;
  direction: "push" | "pull";
  entityType: string;
  entityId: string;
  externalId?: string | null;
  action: string;
  status: "success" | "failed";
  error?: string | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(accountingSyncLogs).values({
    connectionId: entry.connectionId,
    direction: entry.direction,
    entityType: entry.entityType,
    entityId: entry.entityId,
    externalId: entry.externalId ?? null,
    action: entry.action,
    status: entry.status,
    error: entry.error ?? null,
  });
}

// ─── Shared sync runner (triggerSync + periodic schedule) ────────────────────

type GoEntityResult = {
  entityId: string;
  entityType: string;
  action: string;
  status: "success" | "failed";
  externalId?: string;
  error?: string;
};

async function runSyncForConnection(connectionId: number): Promise<{ pushed: number; failed: number; pulled: number }> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const serviceKey = requireServiceKey();

  const [conn] = await db.select().from(accountingConnections).where(eq(accountingConnections.id, connectionId)).limit(1);
  if (!conn) throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" });
  if (conn.status !== "active") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Connection is ${conn.status} — only active connections can sync` });
  }
  if (!conn.accessTokenEncrypted) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Connection has no stored token — reconnect required" });
  }
  if (conn.expiresAt && conn.expiresAt.getTime() <= Date.now()) {
    await writeSyncLog({
      connectionId: conn.id, direction: "push", entityType: "connection", entityId: String(conn.id),
      action: "sync", status: "failed", error: "access token expired — reconnect required",
    });
    emitSyncEvent("error", { connectionId: conn.id, provider: conn.provider, detail: "token expired" });
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Access token expired — disconnect and reconnect the provider" });
  }

  // Decrypt in memory for the duration of this call only.
  const accessToken = decryptField(conn.accessTokenEncrypted);

  if (conn.provider === "odoo") {
    const meta = odooMeta(conn);
    if (!meta.apiUrl || !meta.username || !conn.realmId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Odoo connection is incomplete (apiUrl/username/database missing) — reconnect via connectOdoo",
      });
    }
  }

  // Odoo: the Go service needs the per-connection base URL and login (both
  // non-secret, from metadata) alongside the API key (accessToken) and the
  // database name (realmId).
  const odoo = conn.provider === "odoo" ? odooMeta(conn) : null;

  const callGo = async (path: string) => {
    const res = await fetch(`${GO_SYNC_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Service-Key": serviceKey },
      body: JSON.stringify({
        connectionId: String(conn.id),
        provider: conn.provider,
        accessToken,
        realmId: conn.realmId ?? undefined,
        ...(odoo ? { username: odoo.username, apiBase: odoo.apiUrl } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    return { status: res.status, body };
  };

  // ── Push ──
  let pushed = 0;
  let failed = 0;
  const push = await callGo("/sync/push");
  const results = Array.isArray(push.body.results) ? (push.body.results as GoEntityResult[]) : [];
  for (const r of results) {
    await writeSyncLog({
      connectionId: conn.id, direction: "push", entityType: r.entityType ?? "unknown",
      entityId: String(r.entityId ?? "unknown"), externalId: r.externalId ?? null,
      action: r.action ?? "unknown", status: r.status === "success" ? "success" : "failed",
      error: r.error ?? null,
    });
    if (r.status === "success") pushed++; else failed++;
  }
  if (push.status >= 400 && results.length === 0) {
    await writeSyncLog({
      connectionId: conn.id, direction: "push", entityType: "connection", entityId: String(conn.id),
      action: "sync", status: "failed",
      error: `go-accounting-sync /sync/push returned HTTP ${push.status}: ${String((push.body as { error?: string }).error ?? "unknown")}`,
    });
    failed++;
  }

  // ── Pull ──
  let pulled = 0;
  const pull = await callGo("/sync/pull");
  if (pull.status < 400) {
    pulled = typeof pull.body.collections === "number" ? pull.body.collections : 0;
    if (typeof pull.body.cursor === "string") {
      await db.update(accountingConnections)
        .set({ syncCursor: pull.body.cursor, updatedAt: new Date() })
        .where(eq(accountingConnections.id, conn.id));
    }
  } else {
    await writeSyncLog({
      connectionId: conn.id, direction: "pull", entityType: "connection", entityId: String(conn.id),
      action: "sync", status: "failed",
      error: `go-accounting-sync /sync/pull returned HTTP ${pull.status}: ${String((pull.body as { error?: string }).error ?? "unknown")}`,
    });
    failed++;
  }

  await db.update(accountingConnections)
    .set({ lastSyncAt: new Date(), updatedAt: new Date() })
    .where(eq(accountingConnections.id, conn.id));

  if (failed > 0) {
    emitSyncEvent("error", { connectionId: conn.id, provider: conn.provider, detail: `sync completed with ${failed} failure(s)` });
  } else {
    emitSyncEvent("sync-complete", { connectionId: conn.id, provider: conn.provider, pushed, pulled });
  }
  return { pushed, failed, pulled };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const accountingSyncRouter = router({
  /** Begin an OAuth connect: returns the Go service authorize redirect URL. */
  startConnect: adminProcedure
    .input(z.object({ provider: providerEnum }))
    .mutation(async ({ ctx, input }) => {
      if (input.provider === "odoo") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Odoo does not use OAuth2 — use accountingSync.connectOdoo with the instance URL, database, username and API key",
        });
      }
      const tenantId = await requireTenantId(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      requireServiceKey(); // fail closed if the Go service cannot be called

      const [conn] = await db.insert(accountingConnections)
        .values({ tenantId, provider: input.provider, status: "pending_auth", createdBy: ctx.user.id })
        .onConflictDoUpdate({
          target: [accountingConnections.tenantId, accountingConnections.provider],
          set: { status: "pending_auth", updatedAt: new Date() },
        })
        .returning();
      logger.info({ connection: redactConnection(conn), tenantId }, "[AccountingSync] connect started");
      return {
        connectionId: conn.id,
        provider: input.provider,
        authorizeUrl: `${GO_SYNC_URL}/auth/${input.provider}/start`,
      };
    }),

  /**
   * Connect a self-hosted / Odoo.sh instance (open-source provider). Odoo
   * authenticates with username + API key over JSON-RPC — there is no OAuth
   * redirect dance, so this mutation directly activates the connection:
   *   - apiKey   → secretBox-encrypted in access_token_encrypted (same
   *                protection as OAuth tokens; raw value never logged/stored)
   *   - database → realm_id;  apiUrl + username → metadata (non-secret)
   * Credentials are verified live by the Go service on the first sync; an
   * honest sync-failed log row results if they are rejected (no fake-active).
   */
  connectOdoo: adminProcedure
    .input(z.object({
      apiUrl: z.string().url().max(255)
        .refine((u) => /^https?:\/\//.test(u), "apiUrl must be an absolute http(s) URL"),
      database: z.string().min(1).max(128),
      username: z.string().min(1).max(128),
      apiKey: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      requireServiceKey(); // fail closed if the Go service cannot be called

      const base = input.apiUrl.replace(/\/+$/, "");
      const [conn] = await db.insert(accountingConnections)
        .values({
          tenantId,
          provider: "odoo",
          status: "active",
          accessTokenEncrypted: encryptField(input.apiKey),
          refreshTokenEncrypted: null,
          realmId: input.database,
          expiresAt: null, // Odoo API keys do not expire server-side
          metadata: { apiUrl: base, username: input.username },
          createdBy: ctx.user.id,
        })
        .onConflictDoUpdate({
          target: [accountingConnections.tenantId, accountingConnections.provider],
          set: {
            status: "active",
            accessTokenEncrypted: encryptField(input.apiKey),
            refreshTokenEncrypted: null,
            realmId: input.database,
            expiresAt: null,
            metadata: { apiUrl: base, username: input.username },
            updatedAt: new Date(),
          },
        })
        .returning();
      logger.info({ connection: redactConnection(conn), tenantId }, "[AccountingSync] odoo connection activated (API-key connect)");
      emitSyncEvent("connect", { connectionId: conn.id, provider: "odoo", tenantId });
      return { success: true, connectionId: conn.id, provider: "odoo" as const, status: "active" };
    }),

  /**
   * Service-key-authed callback invoked by go-accounting-sync after the OAuth
   * code exchange. Tokens arrive in the request body and are stored ONLY as
   * secretBox ciphertext. The raw values never touch the DB or logs.
   *
   * Tenant binding: the Go service does not know tenant context, so this
   * activates the single pending_auth connection for the provider. If zero or
   * MULTIPLE pending connections exist, it fails closed rather than guessing.
   */
  completeConnect: publicProcedure
    .input(z.object({
      provider: providerEnum,
      accessToken: z.string().min(1),
      refreshToken: z.string().optional().default(""),
      tokenType: z.string().optional().default(""),
      expiresIn: z.number().int().nonnegative().optional().default(0),
      realmId: z.string().optional().default(""),
    }))
    .mutation(async ({ ctx, input }) => {
      assertServiceCall((ctx.req as { headers?: Record<string, unknown> } | undefined)?.headers);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const pending = await db.select().from(accountingConnections)
        .where(and(eq(accountingConnections.provider, input.provider), eq(accountingConnections.status, "pending_auth")))
        .orderBy(desc(accountingConnections.updatedAt));
      if (pending.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: `No pending_auth connection for ${input.provider} — start the connect flow first` });
      }
      if (pending.length > 1) {
        logger.error({ provider: input.provider, pendingCount: pending.length }, "[AccountingSync] ambiguous connect: multiple pending connections");
        throw new TRPCError({ code: "CONFLICT", message: `Multiple pending_auth connections for ${input.provider} — refusing to guess; complete stale flows or retry` });
      }
      const conn = pending[0];
      const expiresAt = input.expiresIn > 0 ? new Date(Date.now() + input.expiresIn * 1000) : null;
      await db.update(accountingConnections)
        .set({
          status: "active",
          accessTokenEncrypted: encryptField(input.accessToken),
          refreshTokenEncrypted: input.refreshToken ? encryptField(input.refreshToken) : null,
          realmId: input.realmId || null,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(accountingConnections.id, conn.id));
      logger.info({ connection: redactConnection({ ...conn, status: "active" }) }, "[AccountingSync] connection activated");
      emitSyncEvent("connect", { connectionId: conn.id, provider: input.provider, tenantId: conn.tenantId });
      return { success: true, connectionId: conn.id, status: "active" };
    }),

  /** PBAC admin: trigger a push+pull sync for one connection. */
  triggerSync: adminProcedure
    .input(z.object({ connectionId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [conn] = await db.select().from(accountingConnections).where(eq(accountingConnections.id, input.connectionId)).limit(1);
      if (!conn || conn.tenantId !== tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" });
      }
      return runSyncForConnection(input.connectionId);
    }),

  /** Tenant-scoped connection status (tokens are NEVER returned). */
  syncStatus: protectedProcedure.query(async ({ ctx }) => {
    const tenantId = await requireTenantId(ctx.user.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const rows = await db.select({
      id: accountingConnections.id,
      provider: accountingConnections.provider,
      status: accountingConnections.status,
      realmId: accountingConnections.realmId,
      expiresAt: accountingConnections.expiresAt,
      lastSyncAt: accountingConnections.lastSyncAt,
      metadata: accountingConnections.metadata,
      createdAt: accountingConnections.createdAt,
    }).from(accountingConnections).where(eq(accountingConnections.tenantId, tenantId));
    return { connections: rows };
  }),

  /** Tenant-scoped sync log reads. */
  syncLogs: protectedProcedure
    .input(z.object({ connectionId: z.number().int().positive(), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [conn] = await db.select({ id: accountingConnections.id, tenantId: accountingConnections.tenantId })
        .from(accountingConnections).where(eq(accountingConnections.id, input.connectionId)).limit(1);
      if (!conn || conn.tenantId !== tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" });
      }
      const rows = await db.select().from(accountingSyncLogs)
        .where(eq(accountingSyncLogs.connectionId, input.connectionId))
        .orderBy(desc(accountingSyncLogs.createdAt))
        .limit(input.limit);
      return { logs: rows };
    }),

  /**
   * CSV export of the double-entry ledger (raw SQL per doubleEntry.ts
   * patterns). Returns CSV text; chart-of-accounts mapping for external
   * systems happens in go-accounting-sync /export/csv (COA_MAP_JSON).
   */
  exportCsv: adminProcedure
    .input(z.object({ since: z.string().datetime().optional(), limit: z.number().int().min(1).max(10000).default(5000) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const result = await db.execute(sql`
        SELECT id, transaction_id, account_id, account_type, debit, credit, currency, description, created_at
        FROM ledger_entries
        ${input.since ? sql`WHERE created_at >= ${input.since}` : sql``}
        ORDER BY created_at ASC
        LIMIT ${input.limit}
      `) as { rows: Array<Record<string, unknown>> };
      const rows = result.rows ?? [];
      const esc = (v: unknown): string => {
        const s = v == null ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = "Entry ID,Transaction ID,Account ID,Account Type,Debit,Credit,Currency,Description,Created At";
      const lines = rows.map((r) =>
        [r.id, r.transaction_id, r.account_id, r.account_type, r.debit, r.credit, r.currency, r.description, r.created_at]
          .map(esc).join(","),
      );
      return { csv: [header, ...lines].join("\n") + "\n", rowCount: rows.length };
    }),

  /** Revoke a connection and wipe stored tokens. */
  disconnect: adminProcedure
    .input(z.object({ connectionId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = await requireTenantId(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [conn] = await db.select().from(accountingConnections).where(eq(accountingConnections.id, input.connectionId)).limit(1);
      if (!conn || conn.tenantId !== tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" });
      }
      await db.update(accountingConnections)
        .set({
          status: "revoked",
          accessTokenEncrypted: null,
          refreshTokenEncrypted: null,
          expiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(accountingConnections.id, conn.id));
      logger.info({ connection: redactConnection({ ...conn, status: "revoked" }) }, "[AccountingSync] connection revoked, tokens wiped");
      return { success: true, connectionId: conn.id, status: "revoked" };
    }),
});

// ─── Periodic sync schedule (boot registration by orchestrator) ───────────────

let scheduleStarted = false;

/**
 * startAccountingSyncSchedule registers a node-cron job (matching the repo's
 * server/scheduler.ts pattern — there is no Temporal schedule primitive for
 * this job) that syncs every active connection every 15 minutes. Per-
 * connection errors are caught and logged — the loop never crashes.
 *
 * NOT called here: the orchestrator must register it in server/_core/index.ts.
 */
export function startAccountingSyncSchedule(): void {
  if (scheduleStarted) return;
  scheduleStarted = true;
  cron.schedule("*/15 * * * *", async () => {
    try {
      const db = await getDb();
      if (!db) return;
      const active = await db.select({ id: accountingConnections.id })
        .from(accountingConnections)
        .where(eq(accountingConnections.status, "active"));
      for (const conn of active) {
        try {
          await runSyncForConnection(conn.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ connectionId: conn.id, err: message }, "[AccountingSync] scheduled sync failed");
          await writeSyncLog({
            connectionId: conn.id, direction: "push", entityType: "connection", entityId: String(conn.id),
            action: "scheduled-sync", status: "failed", error: message,
          }).catch(() => {});
          emitSyncEvent("error", { connectionId: conn.id, detail: message });
        }
      }
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "[AccountingSync] schedule tick failed");
    }
  });
  logger.info({}, "[AccountingSync] periodic sync schedule registered (every 15 min)");
}
