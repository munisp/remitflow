/**
 * Graceful Shutdown — Lesson 14 from 1B Payments/Day research
 *
 * The benchmark's Go implementation uses sync.WaitGroup to wait for all
 * in-flight goroutines before exiting. This module provides the equivalent
 * for Node.js: drain the transfer batch queue, flush Kafka producer,
 * close DB connections, and stop accepting new requests — all within a
 * configurable timeout before force-killing.
 *
 * Reference: https://github.com/pratikgajjar/1b-payments/blob/main/cmd/tb/transfers/main.go
 */

import { Server } from "http";
import { logger } from '../_core/logger';

type ShutdownTask = {
  name: string;
  fn: () => Promise<void>;
  timeoutMs?: number;
};

const tasks: ShutdownTask[] = [];
let isShuttingDown = false;

/**
 * Register a shutdown task.
 * Tasks are executed in registration order.
 */
export function registerShutdownTask(task: ShutdownTask): void {
  tasks.push(task);
}

/**
 * Wire graceful shutdown to SIGTERM and SIGINT signals.
 * Call this once at server startup.
 */
export function wireGracefulShutdown(server: Server, totalTimeoutMs = 30_000): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal, tasks: tasks.map((t) => t.name) }, "Graceful shutdown initiated");

    // Stop accepting new HTTP connections
    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) {
          logger.error({ error: err.message }, "Error closing HTTP server");
        } else {
          logger.info("HTTP server closed — no new connections accepted");
        }
        resolve();
      });
    });

    const overallDeadline = Date.now() + totalTimeoutMs;

    // Execute each registered shutdown task
    for (const task of tasks) {
      const remaining = overallDeadline - Date.now();
      if (remaining <= 0) {
        logger.warn({ task: task.name }, "Shutdown timeout exceeded — skipping remaining tasks");
        break;
      }

      const taskTimeout = Math.min(task.timeoutMs ?? 10_000, remaining);
      logger.info({ task: task.name, timeoutMs: taskTimeout }, "Running shutdown task");

      try {
        await Promise.race([
          task.fn(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${taskTimeout}ms`)), taskTimeout)
          ),
        ]);
        logger.info({ task: task.name }, "Shutdown task completed");
      } catch (err) {
        logger.error(
          { task: task.name, error: err instanceof Error ? err.message : String(err) },
          "Shutdown task failed or timed out"
        );
      }
    }

    logger.info("Graceful shutdown complete");
    process.exit(0);
  };

  // Handle SIGTERM (Docker stop, Kubernetes pod termination)
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Handle SIGINT (Ctrl+C in development)
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Handle uncaught exceptions — log and attempt graceful shutdown
  process.on("uncaughtException", (err) => {
    logger.error({ error: err.message, stack: err.stack }, "Uncaught exception");
    shutdown("uncaughtException").catch(() => process.exit(1));
  });

  process.on("unhandledRejection", (reason) => {
    logger.error(
      { reason: reason instanceof Error ? reason.message : String(reason) },
      "Unhandled promise rejection"
    );
    // Don't exit on unhandled rejection — log and continue
  });

  logger.info({ totalTimeoutMs }, "Graceful shutdown handler registered");
}

export function isShutdownInProgress(): boolean {
  return isShuttingDown;
}
