/**
 * RemitFlow — Request ID Middleware
 * Adds X-Request-ID header to all requests for distributed tracing.
 */
import { Request, Response, NextFunction } from "express";
import { randomBytes, randomUUID } from "crypto";
import { logger } from '../_core/logger';
import { incHttpRequest } from "../metrics";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      traceparent: string;
      traceId: string;
    }
  }
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-(0[01])$/i;
const REQUEST_ID = /^[a-zA-Z0-9._:-]{8,128}$/;

function createTraceparent(): string {
  return `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const candidateRequestId = req.headers["x-request-id"] ?? req.headers["x-correlation-id"];
  const rawRequestId = Array.isArray(candidateRequestId) ? candidateRequestId[0] : candidateRequestId;
  const requestId = rawRequestId && REQUEST_ID.test(rawRequestId) ? rawRequestId : randomUUID();
  const candidateTraceparent = req.headers.traceparent;
  const rawTraceparent = Array.isArray(candidateTraceparent) ? candidateTraceparent[0] : candidateTraceparent;
  const traceparent = rawTraceparent && TRACEPARENT.test(rawTraceparent) ? rawTraceparent.toLowerCase() : createTraceparent();

  req.requestId = requestId;
  req.traceparent = traceparent;
  req.traceId = traceparent.split("-")[1];
  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Correlation-ID", requestId);
  res.setHeader("traceparent", traceparent);
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
      traceId: req.traceId,
      traceparent: req.traceparent,
      method,
      url,
      statusCode,
      duration,
      userAgent: req.headers["user-agent"],
      ip: req.ip || req.socket?.remoteAddress,
    };
    incHttpRequest(method, req.path, statusCode);
    if (level === "error") logger.error("[HTTP]", JSON.stringify(log));
    else if (level === "warn") logger.warn("[HTTP]", JSON.stringify(log));
    else if (duration > 500) logger.info("[HTTP]", JSON.stringify(log));
  });

  next();
}
