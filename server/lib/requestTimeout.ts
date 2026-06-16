/**
 * Request timeout middleware.
 * P1 Backend 1.9 — configurable per-route timeouts.
 */
import type { Request, Response, NextFunction } from "express";

const TIMEOUT_DEFAULTS: Record<string, number> = {
  health: 5_000,
  upload: 120_000,
  export: 60_000,
  default: 30_000,
};

export function requestTimeout(timeoutMs?: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ms = timeoutMs ?? inferTimeout(req.path);

    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          code: "REQUEST_TIMEOUT",
          message: `Request timed out after ${ms}ms`,
          path: req.path,
        });
      }
    }, ms);

    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));

    next();
  };
}

function inferTimeout(path: string): number {
  if (path.includes("/health") || path.includes("/ready") || path.includes("/live")) {
    return TIMEOUT_DEFAULTS.health;
  }
  if (path.includes("/upload") || path.includes("/import")) {
    return TIMEOUT_DEFAULTS.upload;
  }
  if (path.includes("/export") || path.includes("/report") || path.includes("/download")) {
    return TIMEOUT_DEFAULTS.export;
  }
  return TIMEOUT_DEFAULTS.default;
}
