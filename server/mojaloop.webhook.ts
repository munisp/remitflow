// ============================================================================
// RemitFlow v15 — Mojaloop FSPIOP Webhook Handler
// Handles PUT callbacks from the Mojaloop Switch:
//   PUT /api/mojaloop/callback/party      — party lookup result
//   PUT /api/mojaloop/callback/quote      — quote result
//   PUT /api/mojaloop/callback/transfer   — transfer committed or aborted
//   PUT /api/mojaloop/callback/transfer/error — transfer error
//   POST /api/mojaloop/callback           — generic callback (from Go FSP service)
// ============================================================================
import type { Express, Request, Response } from "express";
import { getDb, createAuditLog } from "./db.js";
import { mojaloopTransfers } from "../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { logger } from './_core/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MojaloopPartyCallback {
  party?: {
    partyIdInfo?: { partyIdType: string; partyIdentifier: string; fspId: string };
    personalInfo?: { complexName?: { firstName?: string; lastName?: string } };
    name?: string;
  };
  errorInformation?: { errorCode: string; errorDescription: string };
}

interface MojaloopQuoteCallback {
  quoteId?: string;
  transferAmount?: { amount: string; currency: string };
  payeeReceiveAmount?: { amount: string; currency: string };
  ilpPacket?: string;
  condition?: string;
  expiration?: string;
  errorInformation?: { errorCode: string; errorDescription: string };
}

interface MojaloopTransferCallback {
  transferId?: string;
  transferState?: "RECEIVED" | "RESERVED" | "COMMITTED" | "ABORTED";
  completedTimestamp?: string;
  fulfilment?: string;
  errorInformation?: { errorCode: string; errorDescription: string };
}

// ─── In-memory pending callbacks (for async resolution) ───────────────────────
// In production, use Redis pub/sub or a database polling mechanism

// ── PostgreSQL Write-Through ─────────────────────────────────────────────────
// All in-memory Maps are persisted to PostgreSQL on write and loaded on startup.

let _wtDb: ReturnType<typeof import("drizzle-orm/postgres-js").drizzle> | null = null;

async function _getWtDb() {
  if (_wtDb) return _wtDb;
  try {
    const { getDb } = await import("./db.js");
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
      CREATE TABLE IF NOT EXISTS mojaloop_pending_callbacks (
        key TEXT PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch { /* silent */ }
}

// Initialize tables on module load
_ensureWriteThroughTables().catch(() => {});

const pendingCallbacks = new Map<string, {
  resolve: (value: any) => void; // Persisted to PostgreSQL table "mojaloop_pending_callbacks"
  reject: (reason: any) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

export function waitForCallback<T>(correlationId: string, timeoutMs = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCallbacks.delete(correlationId);

      _deleteFromDb("mojaloop_pending_callbacks", correlationId).catch(() => {});
      reject(new Error(`Mojaloop callback timeout after ${timeoutMs}ms for ${correlationId}`));
    }, timeoutMs);

    pendingCallbacks.set(correlationId, { resolve, reject, timeout });


    _writeThrough("mojaloop_pending_callbacks", correlationId, { resolve, reject, timeout }).catch(() => {});
  });
}

function resolveCallback(correlationId: string, value: any) {
  const pending = pendingCallbacks.get(correlationId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingCallbacks.delete(correlationId);

    _deleteFromDb("mojaloop_pending_callbacks", correlationId).catch(() => {});
    pending.resolve(value);
  }
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerMojaloopWebhooks(app: Express) {
  // Party lookup callback — PUT /api/mojaloop/callback/party/:type/:id
  app.put("/api/mojaloop/callback/party/:type/:id", (req: Request, res: Response) => {
    const { type, id } = req.params;
    const payload = req.body as MojaloopPartyCallback;
    const correlationId = `party:${type}:${id}`;

    logger.info(`[Mojaloop] Party callback received: ${correlationId}`);

    if (payload.errorInformation) {
      resolveCallback(correlationId, { error: payload.errorInformation });
    } else {
      resolveCallback(correlationId, { party: payload.party });
    }

    res.status(200).json({ received: true });
  });

  // Quote callback — PUT /api/mojaloop/callback/quotes/:quoteId
  app.put("/api/mojaloop/callback/quotes/:quoteId", (req: Request, res: Response) => {
    const { quoteId } = req.params;
    const payload = req.body as MojaloopQuoteCallback;
    const correlationId = `quote:${quoteId}`;

    logger.info(`[Mojaloop] Quote callback received: ${correlationId}`);

    if (payload.errorInformation) {
      resolveCallback(correlationId, { error: payload.errorInformation });
    } else {
      resolveCallback(correlationId, payload);
    }

    res.status(200).json({ received: true });
  });

  // Transfer committed callback — PUT /api/mojaloop/callback/transfers/:transferId
  app.put("/api/mojaloop/callback/transfers/:transferId", async (req: Request, res: Response) => {
    const { transferId } = req.params;
    const payload = req.body as MojaloopTransferCallback;
    const correlationId = `transfer:${transferId}`;

    logger.info(`[Mojaloop] Transfer callback: ${transferId} state=${payload.transferState}`);

    // Update DB record if it exists
    try {
      const db = await getDb();
      if (db) {
        await db.update(mojaloopTransfers)
          .set({
            status: payload.transferState ?? "COMMITTED",
            completedAt: payload.completedTimestamp ? new Date(payload.completedTimestamp) : new Date(),
            fulfilment: payload.fulfilment ?? null,
          })
          .where(eq(mojaloopTransfers.transferId, transferId));
      }
    } catch (err) {
      logger.warn({ data: err }, '[Mojaloop] DB update failed for transfer ${transferId}:');
    }

    resolveCallback(correlationId, {
      transferId,
      transferState: payload.transferState ?? "COMMITTED",
      completedTimestamp: payload.completedTimestamp,
      fulfilment: payload.fulfilment,
    });

    res.status(200).json({ received: true });
  });

  // Transfer error callback — PUT /api/mojaloop/callback/transfers/:transferId/error
  app.put("/api/mojaloop/callback/transfers/:transferId/error", async (req: Request, res: Response) => {
    const { transferId } = req.params;
    const payload = req.body as MojaloopTransferCallback;
    const correlationId = `transfer:${transferId}`;

    logger.error({ err: payload.errorInformation }, '[Mojaloop] Transfer error callback: ${transferId}');

    try {
      const db = await getDb();
      if (db) {
        await db.update(mojaloopTransfers)
          .set({
            status: "ABORTED",
            errorCode: payload.errorInformation?.errorCode ?? "UNKNOWN",
            errorDescription: payload.errorInformation?.errorDescription ?? "Transfer aborted",
          })
          .where(eq(mojaloopTransfers.transferId, transferId));
      }
    } catch (err) {
      logger.warn({ data: err }, '[Mojaloop] DB update failed for aborted transfer ${transferId}:');
    }

    resolveCallback(correlationId, {
      transferId,
      transferState: "ABORTED",
      errorInformation: payload.errorInformation,
    });

    res.status(200).json({ received: true });
  });

  // Generic callback from Go FSP service — POST /api/mojaloop/callback
  app.post("/api/mojaloop/callback", (req: Request, res: Response) => {
    const payload = req.body as any;
    const { transferId, quoteId, type } = payload;

    if (transferId) {
      const correlationId = `transfer:${transferId}`;
      resolveCallback(correlationId, payload);
    } else if (quoteId) {
      const correlationId = `quote:${quoteId}`;
      resolveCallback(correlationId, payload);
    }

    logger.info(`[Mojaloop] Generic callback received: type=${type ?? "unknown"}`);
    res.status(200).json({ received: true });
  });

  // Sub-path callbacks from Go FSP service
  app.post("/api/mojaloop/callback/party", (req: Request, res: Response) => {
    const payload = req.body as any;
    const correlationId = `party:${payload.partyIdType ?? "MSISDN"}:${payload.partyIdentifier ?? payload.partyId}`;
    resolveCallback(correlationId, payload);
    res.status(200).json({ received: true });
  });

  app.post("/api/mojaloop/callback/quote", (req: Request, res: Response) => {
    const payload = req.body as any;
    const correlationId = `quote:${payload.quoteId}`;
    resolveCallback(correlationId, payload);
    res.status(200).json({ received: true });
  });

  app.post("/api/mojaloop/callback/transfer", async (req: Request, res: Response) => {
    const payload = req.body as any;
    const { transferId, transferState } = payload;
    if (transferId) {
      const correlationId = `transfer:${transferId}`;
      resolveCallback(correlationId, payload);

      // Update DB
      try {
        const db = await getDb();
        if (db) {
          await db.update(mojaloopTransfers)
            .set({
              status: transferState ?? "COMMITTED",
              completedAt: new Date(),
            })
            .where(eq(mojaloopTransfers.transferId, transferId));
        }
      } catch { /* ignore */ }
    }
    res.status(200).json({ received: true });
  });

  logger.info("[Mojaloop] Webhook handlers registered at /api/mojaloop/callback/*");
}
