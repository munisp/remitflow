import { createHash, randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { requireDb } from "../db";
import { sdk } from "../_core/sdk";
import { resolveTenantContext } from "../tenantMiddleware";
import { logger } from "../_core/logger";

interface IdempotencyRow {
  id: number;
  key: string;
  tenant_id: number;
  user_id: number;
  operation: string;
  request_hash: string;
  state: "processing" | "completed" | "failed";
  lock_token: string | null;
  lock_expires_at: Date | null;
  response_status: number | null;
  response_body: string | null;
  expires_at: Date;
}

type Reservation =
  | { kind: "execute"; rowId: number; lockToken: string; tenantId: number; userId: number }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "in_progress" };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveIntegerEnv(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export function hashIdempotencyRequest(req: Request): string {
  const payload = {
    method: req.method.toUpperCase(),
    path: req.originalUrl.split("?")[0],
    body: req.body ?? null,
  };
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

async function inTenantTransaction<T>(tenantId: number, userId: number, operation: (db: any) => Promise<T>): Promise<T> {
  const db = await requireDb();
  return db.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${String(tenantId)}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${String(userId)}, true)`);
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'false', true)`);
    return operation(tx);
  });
}

function parseReplay(body: string | null): unknown {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Idempotency replay payload is corrupted");
  }
}

async function reserve(params: {
  key: string;
  requestHash: string;
  operation: string;
  tenantId: number;
  userId: number;
}): Promise<Reservation> {
  const ttlHours = positiveIntegerEnv("IDEMPOTENCY_TTL_HOURS");
  const lockSeconds = positiveIntegerEnv("IDEMPOTENCY_LOCK_SECONDS");
  const lockToken = randomUUID();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  return inTenantTransaction(params.tenantId, params.userId, async (db) => {
    const inserted = await db.execute(sql`
      INSERT INTO idempotency_keys (
        key, tenant_id, user_id, operation, request_hash, state, lock_token,
        lock_expires_at, expires_at, created_at, updated_at
      ) VALUES (
        ${params.key}, ${params.tenantId}, ${params.userId}, ${params.operation}, ${params.requestHash},
        'processing', ${lockToken}::uuid,
        NOW() + make_interval(secs => ${lockSeconds}::int), ${expiresAt}, NOW(), NOW()
      )
      ON CONFLICT (tenant_id, user_id, operation, key) WHERE tenant_id IS NOT NULL AND user_id IS NOT NULL
      DO NOTHING
      RETURNING id
    `) as Array<{ id: number }>;
    if (inserted[0]) {
      return { kind: "execute", rowId: inserted[0].id, lockToken, tenantId: params.tenantId, userId: params.userId };
    }

    const [existing] = await db.execute(sql`
      SELECT * FROM idempotency_keys
      WHERE tenant_id = ${params.tenantId}
        AND user_id = ${params.userId}
        AND operation = ${params.operation}
        AND key = ${params.key}
        AND expires_at > NOW()
      FOR UPDATE
    `) as IdempotencyRow[];
    if (!existing) {
      throw new Error("Idempotency reservation disappeared before lookup");
    }
    if (existing.request_hash !== params.requestHash) {
      throw new IdempotencyConflictError("Idempotency key was reused with a different request payload");
    }
    if (existing.state === "completed") {
      return { kind: "replay", status: existing.response_status ?? 200, body: parseReplay(existing.response_body) };
    }
    if (existing.lock_expires_at && existing.lock_expires_at > new Date()) {
      return { kind: "in_progress" };
    }

    const renewed = await db.execute(sql`
      UPDATE idempotency_keys
      SET state = 'processing', lock_token = ${lockToken}::uuid,
          lock_expires_at = NOW() + make_interval(secs => ${lockSeconds}::int),
          updated_at = NOW()
      WHERE id = ${existing.id}
        AND (lock_expires_at IS NULL OR lock_expires_at <= NOW())
      RETURNING id
    `) as Array<{ id: number }>;
    if (!renewed[0]) return { kind: "in_progress" };
    return { kind: "execute", rowId: existing.id, lockToken, tenantId: params.tenantId, userId: params.userId };
  });
}

async function complete(reservation: Extract<Reservation, { kind: "execute" }>, status: number, body: unknown): Promise<void> {
  const responseBody = JSON.stringify(body);
  await inTenantTransaction(reservation.tenantId, reservation.userId, async (db) => {
    const rows = await db.execute(sql`
      UPDATE idempotency_keys
      SET state = 'completed', response_status = ${status}, response_body = ${responseBody},
          lock_token = NULL, lock_expires_at = NULL, updated_at = NOW()
      WHERE id = ${reservation.rowId} AND lock_token = ${reservation.lockToken}::uuid
      RETURNING id
    `) as Array<{ id: number }>;
    if (!rows[0]) throw new Error("Idempotency lock was lost before response persistence");
  });
}

async function fail(reservation: Extract<Reservation, { kind: "execute" }>, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 2048) : "Response terminated before idempotency completion";
  await inTenantTransaction(reservation.tenantId, reservation.userId, async (db) => {
    await db.execute(sql`
      UPDATE idempotency_keys
      SET state = 'failed', response_status = 503,
          response_body = ${JSON.stringify({ error: "IDEMPOTENCY_PROCESSING_FAILED", message: "The request did not complete safely. Retry with the same idempotency key." })},
          lock_token = NULL, lock_expires_at = NULL, updated_at = NOW()
      WHERE id = ${reservation.rowId} AND lock_token = ${reservation.lockToken}::uuid
    `);
  });
  logger.error({ rowId: reservation.rowId, error: message }, "Durable idempotency reservation failed before response completion");
}

export class IdempotencyConflictError extends Error {}

/**
 * PostgreSQL-backed idempotency middleware for authenticated tRPC mutations.
 * It is intentionally independent of Redis; cache loss cannot duplicate a money movement.
 */
export async function durableIdempotencyMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method !== "POST") return next();
  const keyHeader = req.headers["idempotency-key"] ?? req.headers["x-idempotency-key"];
  const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
  if (!key) return next();
  if (!UUID_V4.test(key)) {
    res.status(400).json({ error: "Invalid Idempotency-Key format. A UUID v4 is required." });
    return;
  }

  try {
    const user = req.remitflowUser ?? await sdk.authenticateRequest(req);
    const tenant = await resolveTenantContext(user.id);
    if (!tenant.tenantId) {
      res.status(403).json({ error: "An active tenant is required for an idempotent financial mutation." });
      return;
    }
    const reservation = await reserve({
      key,
      requestHash: hashIdempotencyRequest(req),
      operation: req.path.slice(0, 100),
      tenantId: tenant.tenantId,
      userId: user.id,
    });
    if (reservation.kind === "replay") {
      res.setHeader("Idempotency-Key", key);
      res.setHeader("X-Idempotency-Replayed", "true");
      res.status(reservation.status).json(reservation.body);
      return;
    }
    if (reservation.kind === "in_progress") {
      res.setHeader("Retry-After", "2");
      res.status(409).json({ error: "IDEMPOTENCY_REQUEST_IN_PROGRESS", message: "A request with this idempotency key is still processing." });
      return;
    }

    const originalJson = res.json.bind(res);
    let completed = false;
    res.json = ((body: unknown) => {
      if (!completed) {
        completed = true;
        void complete(reservation, res.statusCode, body).catch((error) => {
          logger.error({ error, key, operation: req.path }, "Failed to persist idempotent response");
        });
      }
      res.setHeader("Idempotency-Key", key);
      return originalJson(body);
    }) as Response["json"];
    res.once("close", () => {
      if (!completed && !res.writableEnded) {
        void fail(reservation, new Error("Response connection closed before JSON completion"));
      }
    });
    next();
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      res.status(422).json({ error: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST", message: error.message });
      return;
    }
    logger.error({ error: error instanceof Error ? error.message : String(error), path: req.path }, "Durable idempotency middleware failed");
    res.status(503).json({ error: "IDEMPOTENCY_UNAVAILABLE", message: "The request was not processed because durable idempotency is unavailable." });
  }
}
