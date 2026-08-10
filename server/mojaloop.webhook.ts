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
import { mojaloopTransfers, transactions } from "../drizzle/schema.js";
import { eq, sql } from "drizzle-orm";
import { logger } from './_core/logger';
import { advanceTransferState } from "./transfer-state-machine.js";
import { verifyFSPIOPSignature, isFSPIOPVerificationConfigured } from "./mojaloop.service.js";

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
// Only serializable state (expiry) is persisted to PostgreSQL — never resolve/
// reject functions or timer handles. Rows let callbacks arriving after a
// process restart be matched and cleared instead of reported as "unknown".

// ── PostgreSQL persistence ───────────────────────────────────────────────────

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

async function _persistPendingCallback(correlationId: string, expiresAt: Date): Promise<void> {
  const db = await _getWtDb();
  if (!db) return;
  try {
    await db.execute(sql`
      INSERT INTO mojaloop_pending_callbacks (correlation_id, expires_at, updated_at)
      VALUES (${correlationId}, ${expiresAt.toISOString()}, NOW())
      ON CONFLICT (correlation_id) DO UPDATE
        SET expires_at = EXCLUDED.expires_at, updated_at = NOW()
    `);
  } catch (err: any) {
    logger.warn({ data: (err as Error).message }, "[Mojaloop] Failed to persist pending callback (continuing in-memory)");
  }
}

async function _deletePendingCallback(correlationId: string): Promise<void> {
  const db = await _getWtDb();
  if (!db) return;
  try {
    await db.execute(sql`DELETE FROM mojaloop_pending_callbacks WHERE correlation_id = ${correlationId}`);
  } catch { /* silent */ }
}

async function _hasPendingCallback(correlationId: string): Promise<boolean> {
  const db = await _getWtDb();
  if (!db) return false;
  try {
    const rows = await db.execute(
      sql`SELECT correlation_id FROM mojaloop_pending_callbacks WHERE correlation_id = ${correlationId} AND expires_at > NOW()`
    );
    return (rows as any[]).length > 0;
  } catch {
    return false;
  }
}

async function _ensurePendingCallbacksTable(): Promise<void> {
  const db = await _getWtDb();
  if (!db) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mojaloop_pending_callbacks (
        correlation_id TEXT PRIMARY KEY,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Expire stale rows left by previous processes
    await db.execute(sql`DELETE FROM mojaloop_pending_callbacks WHERE expires_at <= NOW()`);
  } catch { /* silent */ }
}

// Initialize table on module load
_ensurePendingCallbacksTable().catch(() => {});

const pendingCallbacks = new Map<string, {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

export function waitForCallback<T>(correlationId: string, timeoutMs = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCallbacks.delete(correlationId);

      _deletePendingCallback(correlationId).catch(() => {});
      reject(new Error(`Mojaloop callback timeout after ${timeoutMs}ms for ${correlationId}`));
    }, timeoutMs);

    pendingCallbacks.set(correlationId, { resolve, reject, timeout });

    _persistPendingCallback(correlationId, new Date(Date.now() + timeoutMs)).catch(() => {});
  });
}

async function resolveCallback(correlationId: string, value: any) {
  const pending = pendingCallbacks.get(correlationId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingCallbacks.delete(correlationId);

    _deletePendingCallback(correlationId).catch(() => {});
    pending.resolve(value);
    return;
  }
  // Not in memory — maybe registered by a previous process. Clear the row so
  // the callback is acknowledged as matched rather than "unknown".
  if (await _hasPendingCallback(correlationId)) {
    await _deletePendingCallback(correlationId);
    logger.info(`[Mojaloop] Callback matched persisted correlation: ${correlationId}`);
  }
}

// ─── FSPIOP inbound signature verification ────────────────────────────────────

/**
 * Verify the FSPIOP-Signature header on an inbound switch callback.
 * Fails closed: returns false (caller must reject) when verification is
 * required but fails. In non-production without a configured switch public
 * key, logs a warning and allows (Mojaloop simulator does not sign).
 */
export function verifyInboundFSPIOP(req: Request): { ok: boolean; reason?: string } {
  if (!isFSPIOPVerificationConfigured()) {
    if (process.env.NODE_ENV === "production") {
      logger.error("[Mojaloop] CRITICAL: MOJALOOP_JWS_PUBLIC_KEY not set — rejecting unverifiable callback in production");
      return { ok: false, reason: "Callback signature verification not configured" };
    }
    return { ok: true }; // dev/simulator: unsigned callbacks allowed
  }

  const payload = typeof (req as any).rawBody === "string"
    ? (req as any).rawBody
    : req.body ? JSON.stringify(req.body) : "";

  const result = verifyFSPIOPSignature({
    signatureHeader: req.header("FSPIOP-Signature"),
    method: req.method,
    uri: req.originalUrl,
    payload,
    date: req.header("Date"),
  });
  if (!result.valid) {
    logger.warn({ data: result.reason }, "[Mojaloop] Rejected callback with invalid FSPIOP signature");
    return { ok: false, reason: result.reason };
  }
  return { ok: true };
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerMojaloopWebhooks(app: Express) {
  // Party lookup callback — PUT /api/mojaloop/callback/party/:type/:id
  app.put("/api/mojaloop/callback/party/:type/:id", async (req: Request, res: Response) => {
    const sig = verifyInboundFSPIOP(req);
    if (!sig.ok) {
      res.status(401).json({ error: sig.reason ?? "Invalid FSPIOP signature" });
      return;
    }
    const { type, id } = req.params;
    const payload = req.body as MojaloopPartyCallback;
    const correlationId = `party:${type}:${id}`;

    logger.info(`[Mojaloop] Party callback received: ${correlationId}`);

    if (payload.errorInformation) {
      await resolveCallback(correlationId, { error: payload.errorInformation });
    } else {
      await resolveCallback(correlationId, { party: payload.party });
    }

    res.status(200).json({ received: true });
  });

  // Quote callback — PUT /api/mojaloop/callback/quotes/:quoteId
  app.put("/api/mojaloop/callback/quotes/:quoteId", async (req: Request, res: Response) => {
    const sig = verifyInboundFSPIOP(req);
    if (!sig.ok) {
      res.status(401).json({ error: sig.reason ?? "Invalid FSPIOP signature" });
      return;
    }
    const { quoteId } = req.params;
    const payload = req.body as MojaloopQuoteCallback;
    const correlationId = `quote:${quoteId}`;

    logger.info(`[Mojaloop] Quote callback received: ${correlationId}`);

    if (payload.errorInformation) {
      await resolveCallback(correlationId, { error: payload.errorInformation });
    } else {
      await resolveCallback(correlationId, payload);
    }

    res.status(200).json({ received: true });
  });

  // Transfer committed callback — PUT /api/mojaloop/callback/transfers/:transferId
  app.put("/api/mojaloop/callback/transfers/:transferId", async (req: Request, res: Response) => {
    const sig = verifyInboundFSPIOP(req);
    if (!sig.ok) {
      res.status(401).json({ error: sig.reason ?? "Invalid FSPIOP signature" });
      return;
    }
    const { transferId } = req.params;
    if (!transferId) {
      res.status(400).json({ error: "Missing transferId" });
      return;
    }
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
          .where(sql`${mojaloopTransfers.transferId} = ${transferId}`);
      }
    } catch (err) {
      logger.warn({ data: err }, '[Mojaloop] DB update failed for transfer ${transferId}:');
    }

    resolveCallback(correlationId, {
      transferId,
      transferState: payload.transferState ?? "COMMITTED",
      completedTimestamp: payload.completedTimestamp,
      fulfilment: payload.fulfilment,
    }).catch(() => {});

    // Advance main transfer state when settlement is confirmed
    if ((payload.transferState ?? "COMMITTED") === "COMMITTED") {
      try {
        const db2 = await getDb();
        if (db2) {
          const rows = await db2.execute(
            sql`SELECT reference, "userId" FROM transactions
                WHERE metadata->>'partnerReference' = ${transferId} LIMIT 1`
          );
          const txn = (rows as any[])[0];
          if (txn) {
            await advanceTransferState(txn.reference, txn.userId, "completed");
            logger.info(`[Mojaloop] Transfer ${txn.reference} completed via Mojaloop settlement`);
          }
        }
      } catch (advErr) {
        logger.warn({ err: advErr, transferId }, "[Mojaloop] Failed to advance transfer state");
      }
    }

    res.status(200).json({ received: true });
  });

  // Transfer error callback — PUT /api/mojaloop/callback/transfers/:transferId/error
  app.put("/api/mojaloop/callback/transfers/:transferId/error", async (req: Request, res: Response) => {
    const sig = verifyInboundFSPIOP(req);
    if (!sig.ok) {
      res.status(401).json({ error: sig.reason ?? "Invalid FSPIOP signature" });
      return;
    }
    const { transferId } = req.params;
    if (!transferId) {
      res.status(400).json({ error: "Missing transferId" });
      return;
    }
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
          .where(sql`${mojaloopTransfers.transferId} = ${transferId}`);
      }
    } catch (err) {
      logger.warn({ data: err }, '[Mojaloop] DB update failed for aborted transfer ${transferId}:');
    }

    await resolveCallback(correlationId, {
      transferId,
      transferState: "ABORTED",
      errorInformation: payload.errorInformation,
    });

    res.status(200).json({ received: true });
  });

  // Generic callback from Go FSP service — POST /api/mojaloop/callback
  app.post("/api/mojaloop/callback", async (req: Request, res: Response) => {
    const payload = req.body as any;
    const { transferId, quoteId, type } = payload;

    if (transferId) {
      const correlationId = `transfer:${transferId}`;
      await resolveCallback(correlationId, payload);
    } else if (quoteId) {
      const correlationId = `quote:${quoteId}`;
      await resolveCallback(correlationId, payload);
    }

    logger.info(`[Mojaloop] Generic callback received: type=${type ?? "unknown"}`);
    res.status(200).json({ received: true });
  });

  // Sub-path callbacks from Go FSP service
  app.post("/api/mojaloop/callback/party", async (req: Request, res: Response) => {
    const payload = req.body as any;
    const correlationId = `party:${payload.partyIdType ?? "MSISDN"}:${payload.partyIdentifier ?? payload.partyId}`;
    await resolveCallback(correlationId, payload);
    res.status(200).json({ received: true });
  });

  app.post("/api/mojaloop/callback/quote", async (req: Request, res: Response) => {
    const payload = req.body as any;
    const correlationId = `quote:${payload.quoteId}`;
    await resolveCallback(correlationId, payload);
    res.status(200).json({ received: true });
  });

  app.post("/api/mojaloop/callback/transfer", async (req: Request, res: Response) => {
    const payload = req.body as any;
    const { transferId, transferState } = payload;
    if (transferId) {
      const correlationId = `transfer:${transferId}`;
      await resolveCallback(correlationId, payload);

      // Update DB
      try {
        const db = await getDb();
        if (db) {
          await db.update(mojaloopTransfers)
            .set({
              status: transferState ?? "COMMITTED",
              completedAt: new Date(),
            })
            .where(sql`${mojaloopTransfers.transferId} = ${transferId}`);
        }
      } catch { /* ignore */ }
    }
    res.status(200).json({ received: true });
  });

  logger.info("[Mojaloop] Webhook handlers registered at /api/mojaloop/callback/*");
}
