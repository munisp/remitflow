import { NextFunction, Request, Response } from "express";
import { createHash, timingSafeEqual } from "crypto";
import httpStatus from "http-status";

/**
 * SEC-31: service-to-service authentication for tenant lifecycle and billing
 * endpoints. Callers must present `Authorization: Bearer <token>` matching the
 * env-configured TENANT_MANAGEMENT_API_TOKEN (constant-time comparison; both
 * sides hashed so token length is never leaked).
 *
 * Fail-closed: when the token is unset the middleware rejects every request
 * (503). app.ts additionally refuses to boot in production without it.
 */
export function requireServiceAuth() {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = process.env.TENANT_MANAGEMENT_API_TOKEN;
    if (!token || token.length === 0) {
      return res.status(httpStatus.SERVICE_UNAVAILABLE).json({
        error: "Service authentication is not configured",
      });
    }

    const header = req.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!bearer) {
      return res.status(httpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const expected = createHash("sha256").update(token).digest();
    const actual = createHash("sha256").update(bearer).digest();
    if (!timingSafeEqual(expected, actual)) {
      return res.status(httpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    next();
  };
}
