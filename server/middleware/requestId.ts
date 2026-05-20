/**
 * RemitFlow — Request ID Middleware
 * Adds X-Request-ID header to all requests for distributed tracing.
 */
import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { logger } from '../_core/logger';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId =
    (req.headers["x-request-id"] as string) ||
    (req.headers["x-correlation-id"] as string) ||
    randomUUID();

  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Correlation-ID", requestId);
  next();
}

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const { method, url, requestId } = req;

  res.on("finish", () => {
    const duration = Date.now() - start;
    const { statusCode } = res;
    const level = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
    // Use console with structured format for compatibility
    const log = {
      requestId,
      method,
      url,
      statusCode,
      duration,
      userAgent: req.headers["user-agent"],
      ip: req.ip || req.socket?.remoteAddress,
    };
    if (level === "error") logger.error("[HTTP]", JSON.stringify(log));
    else if (level === "warn") logger.warn("[HTTP]", JSON.stringify(log));
    else if (duration > 500) console.info("[HTTP]", JSON.stringify(log));
  });

  next();
}
