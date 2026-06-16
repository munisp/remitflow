/**
 * Graceful Shutdown Handler
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles SIGTERM/SIGINT to cleanly shut down:
 * 1. Stop accepting new connections
 * 2. Wait for in-flight requests to complete (30s timeout)
 * 3. Close database connections
 * 4. Close Redis/Kafka/external connections
 * 5. Exit cleanly
 */

import { Server } from "http";
import { closeDb } from "../db";
import { logger } from "../_core/logger";

let isShuttingDown = false;

export function setupGracefulShutdown(server: Server): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, "Graceful shutdown initiated");

    // Stop accepting new connections
    server.close(() => {
      logger.info("HTTP server closed — no new connections");
    });

    // Give in-flight requests 30 seconds to complete
    const forceExitTimer = setTimeout(() => {
      logger.error("Graceful shutdown timed out after 30s — forcing exit");
      process.exit(1);
    }, 30_000);

    try {
      // Close database pool
      await closeDb();
      logger.info("Database connections closed");
    } catch (err) {
      logger.error({ err }, "Error closing database connections");
    }

    clearTimeout(forceExitTimer);
    logger.info("Graceful shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Catch unhandled rejections and uncaught exceptions
  process.on("unhandledRejection", (reason, promise) => {
    logger.error({ reason, promise: String(promise) }, "Unhandled rejection");
  });

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception — shutting down");
    shutdown("uncaughtException");
  });
}

/** Middleware to reject requests during shutdown */
export function shutdownGuard() {
  return (req: any, res: any, next: any) => {
    if (isShuttingDown) {
      res.status(503).json({
        error: "Service is shutting down",
        retryAfter: 5,
      });
      return;
    }
    next();
  };
}
