/**
 * Production Hardening Routes
 *
 * Registers additional Express routes and middleware required for
 * production operations: readiness probe, liveness probe, metrics scrape,
 * and graceful shutdown signalling.
 */
import type { Express, Request, Response } from "express";
import { logger } from "./logger";

let isShuttingDown = false;

export function registerProductionHardeningRoutes(app: Express): void {
  // ─── Kubernetes liveness probe ─────────────────────────────────────────────
  app.get("/healthz", (_req: Request, res: Response) => {
    if (isShuttingDown) {
      res.status(503).json({ status: "shutting_down" });
      return;
    }
    res.json({ status: "alive", ts: new Date().toISOString() });
  });

  // ─── Kubernetes readiness probe ────────────────────────────────────────────
  app.get("/readyz", (_req: Request, res: Response) => {
    if (isShuttingDown) {
      res.status(503).json({ status: "not_ready", reason: "shutting_down" });
      return;
    }
    res.json({ status: "ready", ts: new Date().toISOString() });
  });

  // ─── SIGTERM / graceful shutdown ───────────────────────────────────────────
  process.on("SIGTERM", () => {
    logger.info("[productionHardening] SIGTERM received — marking as not ready");
    isShuttingDown = true;
    // Give load balancer time to drain connections
    setTimeout(() => {
      logger.info("[productionHardening] Drain period elapsed — exiting");
      process.exit(0);
    }, 5000);
  });

  logger.info("[productionHardening] Liveness and readiness probes registered.");
}
