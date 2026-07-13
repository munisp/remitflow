/**
 * RemitFlow Temporal Worker v8
 *
 * Standalone worker process that:
 *   1. Connects to Temporal server (default: localhost:7233)
 *   2. Registers all workflow and activity implementations
 *   3. Polls the task queue for work
 *
 * Run as a separate process:
 *   node --loader ts-node/esm server/temporal/worker.ts
 *
 * Or in production via Kubernetes Deployment:
 *   image: remitflow/temporal-worker:v8
 *   env: TEMPORAL_ADDRESS=temporal-frontend:7233
 */

import { Worker, NativeConnection } from "@temporalio/worker";
import * as activities from "./activities";
import http from "http";
import { logger } from '../_core/logger';

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "remitflow-main";
const NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "default";

// ── Health HTTP server ───────────────────────────────────────────────────────
let workerReady = false;
const HEALTH_PORT = parseInt(process.env.WORKER_HEALTH_PORT ?? "8080", 10);
const healthServer = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    const status = workerReady ? 200 : 503;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: workerReady ? "healthy" : "starting",
      taskQueue: TASK_QUEUE,
      namespace: NAMESPACE,
      temporal: TEMPORAL_ADDRESS,
      uptime: Math.round(process.uptime()),
    }));
  } else {
    res.writeHead(404); res.end();
  }
});
healthServer.listen(HEALTH_PORT, () => {
  logger.info(`[Temporal Worker] Health endpoint: http://localhost:${HEALTH_PORT}/health`);
});

async function run(): Promise<void> {
  logger.info(`[Temporal Worker] Connecting to ${TEMPORAL_ADDRESS} (namespace: ${NAMESPACE})`);

  let connection: NativeConnection;
  try {
    connection = await NativeConnection.connect({
      address: TEMPORAL_ADDRESS,
    });
    logger.info("[Temporal Worker] Connected to Temporal server");
  } catch (err) {
    logger.error("[Temporal Worker] Failed to connect to Temporal server:", (err as Error).message);
    logger.warn("[Temporal Worker] Temporal server not available — worker will not start.");
    logger.warn("[Temporal Worker] Start Temporal with: docker run -p 7233:7233 temporalio/auto-setup");
    process.exit(0); // Exit gracefully — don't crash the main app
  }

  const worker = await Worker.create({
    connection,
    namespace: NAMESPACE,
    taskQueue: TASK_QUEUE,

    // Workflow bundle — Temporal sandboxes workflows in a separate V8 context
    workflowsPath: new URL("./workflows.js", import.meta.url).pathname,

    // Activities — run directly in the worker process
    activities,

    // Worker options
    maxConcurrentActivityTaskExecutions: 10,
    maxConcurrentWorkflowTaskExecutions: 5,
    maxCachedWorkflows: 100,

    // Graceful shutdown
    shutdownGraceTime: "30 seconds",
  });

  logger.info(`[Temporal Worker] Worker started on task queue: ${TASK_QUEUE}`);
  logger.info("[Temporal Worker] Registered workflows: TransferWorkflow, KYCVerificationWorkflow, RecurringPaymentWorkflow");
  logger.info(`[Temporal Worker] Registered activities: ${Object.keys(activities).join(", ")}`);
  workerReady = true; // Signal health endpoint that worker is ready

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info("[Temporal Worker] Shutting down gracefully...");
    workerReady = false;
    await worker.shutdown();
    await connection.close();
    healthServer.close();
    logger.info("[Temporal Worker] Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await worker.run();
}

run().catch(err => {
  logger.error({ err: err }, '[Temporal Worker] Fatal error:');
  process.exit(1);
});
