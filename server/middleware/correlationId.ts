/**
 * Correlation ID Middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * Assigns a unique correlation ID to every request for distributed tracing.
 * - Reads from incoming `x-request-id` or `x-correlation-id` header
 * - Falls back to generating a new UUID v4
 * - Attaches to response headers for client-side correlation
 * - Available via `req.correlationId` in all downstream handlers
 */

import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

export function correlationIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const id =
      (req.headers["x-request-id"] as string) ||
      (req.headers["x-correlation-id"] as string) ||
      randomUUID();

    req.correlationId = id;
    res.setHeader("x-request-id", id);
    res.setHeader("x-correlation-id", id);

    next();
  };
}
