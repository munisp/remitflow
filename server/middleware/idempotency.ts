/**
 * Idempotency Middleware — Lesson 2 from 1B Payments/Day research
 *
 * Prevents duplicate transfers when clients retry on network errors.
 * The benchmark shows that without idempotency, retries at scale cause
 * double-spends that are expensive to detect and reverse.
 *
 * Algorithm:
 * 1. Client sends Idempotency-Key header (UUID v4)
 * 2. On first request: store key + response in idempotency_keys table
 * 3. On retry: return cached response without re-executing the transfer
 * 4. Keys expire after 24 hours (configurable via IDEMPOTENCY_TTL_HOURS)
 *
 * Reference: https://backend.how/posts/1b-payments-per-day/
 */

import { Request, Response, NextFunction } from "express";
import { getDb } from "../db";
import { idempotencyKeys } from "../../drizzle/schema";
import { eq, and, gt } from "drizzle-orm";
import { logger } from '../_core/logger';

const TTL_HOURS = parseInt(process.env.IDEMPOTENCY_TTL_HOURS ?? "24", 10);

/**
 * Express middleware that enforces idempotency for POST /api/trpc/transfers.*
 * and other mutating endpoints.
 *
 * Usage: app.use("/api/trpc/transfers", idempotencyMiddleware);
 */
export async function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Only apply to POST requests (mutations)
  if (req.method !== "POST") {
    next();
    return;
  }

  const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
  if (!idempotencyKey) {
    next();
    return;
  }

  // Validate key format (UUID v4)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(idempotencyKey)) {
    res.status(400).json({
      error: "Invalid Idempotency-Key format. Must be a UUID v4.",
    });
    return;
  }

  const userId = (req as any).user?.id;
  const operation = req.path;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_HOURS * 60 * 60 * 1000);

  try {
    const db = await getDb();

    // Check for existing key
    const existing = await db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.key, idempotencyKey),
          gt(idempotencyKeys.expiresAt, now)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const cached = existing[0];
      logger.info(
        { idempotencyKey, userId, operation, cachedStatus: cached.responseStatus },
        "Idempotency cache hit — returning cached response"
      );

      // Return the cached response
      res.status(cached.responseStatus ?? 200);
      res.setHeader("Idempotency-Key", idempotencyKey);
      res.setHeader("X-Idempotency-Replayed", "true");
      res.json(JSON.parse(cached.responseBody ?? "{}"));
      return;
    }

    // Register the key before processing (optimistic lock)
    await db.insert(idempotencyKeys).values({
      key: idempotencyKey,
      userId: userId ?? null,
      operation,
      responseStatus: null,
      responseBody: null,
      expiresAt,
    });

    // Intercept the response to cache it
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      // Store the response asynchronously (fire-and-forget)
      db.update(idempotencyKeys)
        .set({
          responseStatus: res.statusCode,
          responseBody: JSON.stringify(body),
        })
        .where(eq(idempotencyKeys.key, idempotencyKey))
        .catch((err: Error) => {
          logger.error({ error: err.message, idempotencyKey }, "Failed to cache idempotency response");
        });

      res.setHeader("Idempotency-Key", idempotencyKey);
      return originalJson(body);
    };

    next();
  } catch (err) {
    // If the key already exists (race condition on concurrent retries), return 409
    if ((err as any)?.code === "23505") {
      res.status(409).json({
        error: "Concurrent request with same Idempotency-Key detected. Please wait and retry.",
      });
      return;
    }

    logger.error(
      { error: err instanceof Error ? err.message : String(err), idempotencyKey },
      "Idempotency middleware error"
    );
    next(err);
  }
}
