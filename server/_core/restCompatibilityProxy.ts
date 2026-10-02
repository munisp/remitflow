import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { getDb } from "../db";

const FORWARDED_HEADERS = [
  "authorization",
  "content-type",
  "idempotency-key",
  "x-request-id",
  "x-tenant-id",
  "x-ledger-id",
] as const;

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function configuredUpstream(): URL | null {
  const raw = process.env.CORE_BANKING_UPSTREAM_URL?.trim();
  if (!raw) return null;
  let upstream: URL;
  try {
    upstream = new URL(raw);
  } catch {
    throw new Error("CORE_BANKING_UPSTREAM_URL must be an absolute HTTP(S) URL");
  }
  if (upstream.protocol !== "http:" && upstream.protocol !== "https:") {
    throw new Error("CORE_BANKING_UPSTREAM_URL must use HTTP or HTTPS");
  }
  if (["localhost", "127.0.0.1", "::1"].includes(upstream.hostname)) {
    throw new Error("CORE_BANKING_UPSTREAM_URL cannot target the API process itself");
  }
  return upstream;
}

function upstreamPath(req: Request): string {
  const original = req.originalUrl || req.url;
  const path = original.replace(/^\/api(?=\/|$)/, "");
  return path || "/";
}

function headersFor(req: Request): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = req.header(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("content-type") && BODY_METHODS.has(req.method)) {
    headers.set("content-type", "application/json");
  }
  return headers;
}

function responseHeaders(upstream: globalThis.Response, res: Response): void {
  for (const name of ["content-type", "cache-control", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
}

// ─── W20-E (DL-06): core-banking shadow persistence ──────────────────────────
// Proxied transactions/wallets/cards/disputes used to never land in our
// Postgres. Every successful upstream response is now shadow-upserted into the
// cb_shadow_* tables (drizzle/0103_core_banking_shadow.sql, raw SQL — schema.ts
// is owned by another lane). Shadow rows record REAL upstream responses only;
// no synthetic data is ever written.

type ShadowTable = "cb_shadow_accounts" | "cb_shadow_transactions" | "cb_shadow_cards" | "cb_shadow_disputes";

/** Fail-open telemetry counters — shadow persistence never blocks the proxy. */
export const shadowPersistenceMetrics = {
  upserts: 0,
  readShadowFailures: 0,
  writeShadowFailures: 0,
  orphansRecorded: 0,
};

const ACCOUNT_PATHS = /^\/(wallet|account|virtual-accounts|savings|stablecoin\/balances|profile\/linked-accounts)(\/|$)/;
const TRANSACTION_PATHS = /^\/(transactions|transfers|mpesa|wise|batch-payments|airtime|bills|receive|property-kyc\/transactions|stablecoin\/(buy|sell|send|convert|history))(\/|$)/;
const CARD_PATHS = /^\/cards(\/|$)/;
const DISPUTE_PATHS = /^\/disputes(\/|$)/;

function shadowTargetFor(path: string): { table: ShadowTable; kind: string } | null {
  const segments = path.split("/").filter(Boolean);
  const kind = segments[0] ?? "";
  if (DISPUTE_PATHS.test(path)) return { table: "cb_shadow_disputes", kind };
  // /cards/:id/transactions is a transaction read; everything else under
  // /cards is a card record.
  if (CARD_PATHS.test(path)) {
    if (segments[segments.length - 1] === "transactions") return { table: "cb_shadow_transactions", kind: "card_transaction" };
    return { table: "cb_shadow_cards", kind };
  }
  if (TRANSACTION_PATHS.test(path)) return { table: "cb_shadow_transactions", kind };
  if (ACCOUNT_PATHS.test(path)) return { table: "cb_shadow_accounts", kind };
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extract the upstream's own identifier from a response record. */
function extractUpstreamId(rec: Record<string, unknown>): string | null {
  for (const key of ["id", "transactionId", "transferId", "cardId", "disputeId", "paymentId", "accountId", "upstreamId"]) {
    const value = rec[key];
    if (typeof value === "string" && value) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** Flatten an upstream JSON payload into individual shadow-able records. */
function extractRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload)) {
    for (const key of ["data", "items", "results", "records", "transactions", "accounts", "wallets", "cards", "disputes"]) {
      const nested = payload[key];
      if (Array.isArray(nested)) return nested.filter(isRecord);
    }
    return [payload];
  }
  return [];
}

async function shadowUpsert(
  table: ShadowTable,
  tenantId: string,
  upstreamId: string,
  kind: string,
  payload: unknown,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable for core-banking shadow persistence");
  await db.execute(sql`
    INSERT INTO ${sql.raw(table)} (tenant_id, upstream_id, kind, payload, synced_at)
    VALUES (${tenantId}, ${upstreamId}, ${kind}, ${JSON.stringify(payload)}::jsonb, NOW())
    ON CONFLICT (tenant_id, upstream_id, kind)
    DO UPDATE SET payload = EXCLUDED.payload, synced_at = NOW()
  `);
}

async function recordSyncFailure(
  tenantId: string,
  target: { table: ShadowTable; kind: string },
  upstreamId: string,
  req: Request,
  errorMessage: string,
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    await db.execute(sql`
      INSERT INTO cb_shadow_sync_failures (tenant_id, shadow_table, upstream_id, kind, method, path, error)
      VALUES (${tenantId}, ${target.table}, ${upstreamId}, ${target.kind}, ${req.method}, ${upstreamPath(req)}, ${errorMessage})
    `);
    shadowPersistenceMetrics.orphansRecorded += 1;
  } catch (failureLogError) {
    // Telemetry fail-open but NEVER silent: if even the failure ledger cannot
    // be written, the structured error log above plus this line are the record.
    shadowPersistenceMetrics.writeShadowFailures += 1;
    logger.error(
      { tenantId, upstreamId, message: failureLogError instanceof Error ? failureLogError.message : String(failureLogError) },
      "[REST compatibility] CRITICAL: could not record core-banking shadow sync failure — manual reconciliation required",
    );
  }
}

/**
 * Persist shadow rows for a successful upstream response. For READS this is
 * fail-open (log + metric); for WRITES the caller awaits it and, on failure,
 * records an orphan row in cb_shadow_sync_failures for later reconciliation —
 * upstream semantics (status/body) are never altered.
 */
async function shadowPersist(
  req: Request,
  target: { table: ShadowTable; kind: string },
  payload: unknown,
  isWrite: boolean,
): Promise<void> {
  const tenantId = req.header("x-tenant-id")?.trim() || "default";
  const records = extractRecords(payload);
  const ids: { upstreamId: string; record: Record<string, unknown> }[] = [];
  for (const record of records) {
    const upstreamId = extractUpstreamId(record);
    if (upstreamId) ids.push({ upstreamId, record });
  }
  // DELETE/PUT responses often carry no body: fall back to the path's id segment.
  if (ids.length === 0 && isWrite) {
    const segments = upstreamPath(req).split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    const verbs = new Set(["cancel", "execute", "favorite", "messages", "contribute", "withdraw", "read", "dismiss", "verify", "claim"]);
    if (last && !verbs.has(last) && segments.length > 1) {
      ids.push({ upstreamId: decodeURIComponent(last), record: { id: decodeURIComponent(last), deleted: req.method === "DELETE" || undefined } });
    }
  }
  for (const { upstreamId, record } of ids) {
    try {
      await shadowUpsert(target.table, tenantId, upstreamId, target.kind, record);
      shadowPersistenceMetrics.upserts += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isWrite) {
        shadowPersistenceMetrics.writeShadowFailures += 1;
        logger.error(
          { tenantId, upstreamId, table: target.table, method: req.method, path: upstreamPath(req), message },
          "[REST compatibility] Core-banking WRITE succeeded upstream but shadow persistence FAILED — recording orphan for reconciliation",
        );
        await recordSyncFailure(tenantId, target, upstreamId, req, message);
      } else {
        shadowPersistenceMetrics.readShadowFailures += 1;
        logger.warn(
          { tenantId, upstreamId, table: target.table, method: req.method, path: upstreamPath(req), message },
          "[REST compatibility] Shadow persistence failed for upstream READ (fail-open)",
        );
      }
    }
  }
}

/**
 * Forwards legacy PWA REST calls to the real core-banking backend. The native
 * Express and tRPC routes are registered first; only otherwise-unhandled `/api`
 * requests reach this proxy. It deliberately returns a JSON 503 or 502 instead
 * of emitting a simulated business result.
 */
export function registerRestCompatibilityProxy(app: Express): void {
  app.all("/api/*", async (req, res) => {
    let upstream: URL | null;
    try {
      upstream = configuredUpstream();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid core-banking upstream configuration";
      logger.error({ message }, "[REST compatibility] Invalid upstream configuration");
      return res.status(503).json({ error: "core_banking_unavailable", message });
    }

    if (!upstream) {
      return res.status(503).json({
        error: "core_banking_unavailable",
        message: "CORE_BANKING_UPSTREAM_URL is required for legacy REST service requests",
      });
    }

    const target = new URL(upstreamPath(req), upstream);
    try {
      const init: RequestInit = {
        method: req.method,
        headers: headersFor(req),
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      };
      if (BODY_METHODS.has(req.method) && req.body !== undefined) {
        init.body = JSON.stringify(req.body);
      }

      const response = await fetch(target, init);
      responseHeaders(response, res);
      const payload = Buffer.from(await response.arrayBuffer());

      // W20-E (DL-06): shadow-persist successful upstream responses. Response
      // shape, status and upstream failure semantics are unchanged.
      if (response.status >= 200 && response.status < 300) {
        const shadowTarget = shadowTargetFor(upstreamPath(req));
        if (shadowTarget) {
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(payload.toString("utf8"));
          } catch {
            parsed = null; // non-JSON body (e.g. 204): path-id fallback may still apply for writes
          }
          const isWrite = req.method !== "GET" && req.method !== "HEAD";
          if (isWrite) {
            // Awaited: one upsert of latency on the write path is acceptable
            // and guarantees the orphan record is written before responding.
            await shadowPersist(req, shadowTarget, parsed, true);
          } else {
            // READ shadowing is fail-open and off the response path.
            void shadowPersist(req, shadowTarget, parsed, false);
          }
        }
      }

      return res.status(response.status).send(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Core-banking upstream request failed";
      logger.error({ method: req.method, path: upstreamPath(req), message }, "[REST compatibility] Upstream request failed");
      return res.status(502).json({ error: "core_banking_upstream_error", message: "The configured core-banking service did not respond" });
    }
  });
}
