/**
 * CSRF Protection Middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * Double-submit cookie pattern:
 * 1. Sets a random CSRF token in a cookie (csrf-token)
 * 2. Client sends the token back in x-csrf-token header
 * 3. Server validates they match
 *
 * Exempt: GET, HEAD, OPTIONS (safe methods)
 * Exempt: /api/webhooks/* (external webhook callbacks)
 * Exempt: /api/health (health checks)
 */

import { randomBytes } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../_core/logger";

const CSRF_COOKIE = "csrf-token";
const CSRF_HEADER = "x-csrf-token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const EXEMPT_PATHS = ["/api/webhooks/", "/api/health", "/healthz", "/ready"];

export function csrfProtection() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Generate token if not present
    if (!req.cookies?.[CSRF_COOKIE]) {
      const token = randomBytes(32).toString("hex");
      res.cookie(CSRF_COOKIE, token, {
        httpOnly: false, // Client JS needs to read this
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 86400000, // 24h
      });
    }

    // Skip for safe methods
    if (SAFE_METHODS.has(req.method)) {
      return next();
    }

    // Skip for exempt paths
    if (EXEMPT_PATHS.some((p) => req.path.startsWith(p))) {
      return next();
    }

    // Validate CSRF token
    const cookieToken = req.cookies?.[CSRF_COOKIE];
    const headerToken = req.headers[CSRF_HEADER] as string;

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      logger.warn(
        { path: req.path, method: req.method, ip: req.ip },
        "CSRF validation failed"
      );
      res.status(403).json({ error: "CSRF token mismatch" });
      return;
    }

    next();
  };
}
