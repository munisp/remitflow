/**
 * RemitFlow — Graceful Shutdown Handler (TypeScript)
 * ════════════════════════════════════════════════════
 * Handles SIGTERM/SIGINT signals gracefully by:
 *   1. Stopping the HTTP server from accepting new connections
 *   2. Waiting for in-flight requests to complete (drain timeout)
 *   3. Stopping the outbox worker
 *   4. Closing the database connection pool
 *   5. Closing the Redis connection
 *   6. Flushing OpenTelemetry spans
 *   7. Exiting with code 0
 *
 * Kubernetes sends SIGTERM before killing the pod. The default
 * terminationGracePeriodSeconds is 30s — we use 25s to be safe.
 */

import { logger } from "../_core/logger";

type ShutdownHook = {
  name: string;
  fn: () => Promise<void>;
  timeoutMs?: number;
};

class GracefulShutdown {
  private hooks: ShutdownHook[] = [];
  private isShuttingDown = false;
  private readonly drainTimeoutMs: number;

  constructor(drainTimeoutMs = 25000) {
    this.drainTimeoutMs = drainTimeoutMs;
  }

  register(name: string, fn: () => Promise<void>, timeoutMs = 5000): void {
    this.hooks.push({ name, fn, timeoutMs });
  }

  async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn("[Shutdown] Already shutting down — ignoring duplicate signal");
      return;
    }

    this.isShuttingDown = true;
    logger.info({ signal }, "[Shutdown] Graceful shutdown initiated");

    const overallTimeout = setTimeout(() => {
      logger.error("[Shutdown] Drain timeout exceeded — forcing exit");
      process.exit(1);
    }, this.drainTimeoutMs);

    for (const hook of this.hooks) {
      const hookTimeout = setTimeout(() => {
        logger.warn({ hook: hook.name }, "[Shutdown] Hook timed out — continuing");
      }, hook.timeoutMs ?? 5000);

      try {
        await hook.fn();
        logger.info({ hook: hook.name }, "[Shutdown] Hook completed");
      } catch (err) {
        logger.error({ hook: hook.name, err }, "[Shutdown] Hook failed");
      } finally {
        clearTimeout(hookTimeout);
      }
    }

    clearTimeout(overallTimeout);
    logger.info("[Shutdown] All hooks completed — exiting cleanly");
    process.exit(0);
  }

  install(): void {
    process.on("SIGTERM", () => this.shutdown("SIGTERM"));
    process.on("SIGINT", () => this.shutdown("SIGINT"));
    process.on("SIGUSR2", () => this.shutdown("SIGUSR2")); // nodemon restart

    process.on("uncaughtException", (err) => {
      logger.fatal({ err }, "[Shutdown] Uncaught exception — shutting down");
      this.shutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason) => {
      logger.fatal({ reason }, "[Shutdown] Unhandled promise rejection — shutting down");
      this.shutdown("unhandledRejection");
    });
  }
}

export const gracefulShutdown = new GracefulShutdown(
  parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? "25000", 10)
);
