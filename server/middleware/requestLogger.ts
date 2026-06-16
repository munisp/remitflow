/**
 * Request/Response Logger Middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * Structured logging for all HTTP requests with:
 * - Method, path, status code, response time
 * - Correlation ID for distributed tracing
 * - PII masking for sensitive fields
 * - Excludes health check endpoints from verbose logging
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../_core/logger";

const HEALTH_PATHS = new Set(["/health", "/healthz", "/ready", "/readiness", "/live", "/liveness"]);
const PII_FIELDS = new Set(["password", "secret", "token", "authorization", "cookie", "credit_card", "ssn", "bvn", "nin"]);

function maskPII(obj: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (PII_FIELDS.has(key.toLowerCase())) {
      masked[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      masked[key] = maskPII(value as Record<string, unknown>);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

export function requestLoggerMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip health checks
    if (HEALTH_PATHS.has(req.path)) {
      return next();
    }

    const startTime = process.hrtime.bigint();

    // Log request
    const requestLog: Record<string, unknown> = {
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      query: Object.keys(req.query).length > 0 ? maskPII(req.query as Record<string, unknown>) : undefined,
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    };

    // Log response on finish
    res.on("finish", () => {
      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000; // ms

      const responseLog = {
        ...requestLog,
        statusCode: res.statusCode,
        durationMs: Math.round(duration * 100) / 100,
        contentLength: res.getHeader("content-length"),
      };

      if (res.statusCode >= 500) {
        logger.error(responseLog, "Request failed");
      } else if (res.statusCode >= 400) {
        logger.warn(responseLog, "Client error");
      } else if (duration > 5000) {
        logger.warn(responseLog, "Slow request");
      } else {
        logger.info(responseLog, "Request completed");
      }
    });

    next();
  };
}
