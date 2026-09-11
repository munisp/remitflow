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
// W11-C2: hand-rolled OTel activity interceptors (worker/client side only —
// NEVER import into workflow sandbox files). One span per activity execution,
// traceparent extracted from activity headers, tenant.id when forwarded.
import { makeTemporalOtelActivityInterceptors } from "./interceptors";
// W10: additional task queues (SPEC-wave10)
import {
  AP_APPROVAL_TASK_QUEUE,
  apApprovalActivities,
} from "./apApprovalWorkflow";
import {
  arAgingTaskQueue,
  runArAgingSweepActivity,
} from "./arAgingWorkflow";

// V2-R2: modules dynamically import()ed inside the W10 activity/schedule
// bodies (enumerated from server/temporal/apApprovalWorkflow.ts and
// server/temporal/arAgingWorkflow.ts). webpack would otherwise try to pull
// them into the workflow isolate bundle; ignoreModules stubs them in the
// BUNDLE ONLY — activities still run in the normal worker process, unaffected.
const AP_WORKFLOW_IGNORE_MODULES = [
  "../db.js",
  "../../drizzle/schema.js",
  "drizzle-orm",
  "../middleware/kafka.js",
  "../_core/logger.js",
  "../services/approvalEngine.js",
  "./temporalClient.js",
];
const AR_WORKFLOW_IGNORE_MODULES = [
  "../db.js",
  "drizzle-orm",
  "../../drizzle/schema.js",
  "../middleware/kafka.js",
  "../_core/logger.js",
  "@temporalio/client",
];

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

    // W11-C2: per-activity OTel spans + traceparent extraction from headers
    interceptors: { activity: [makeTemporalOtelActivityInterceptors()] },
  });

  // ── W10 workers: ap-approvals + ar-aging (SPEC-wave10) ────────────────────
  // Each queue gets its own Worker with its own workflow bundle. The W10
  // workflow files are sandbox-disciplined: top-level imports are limited to
  // @temporalio/workflow (+ the repo logger); every side-effecting dependency
  // is dynamically imported inside the activity bodies.
  const apWorker = await Worker.create({
    connection,
    namespace: NAMESPACE,
    taskQueue: AP_APPROVAL_TASK_QUEUE,
    workflowsPath: new URL("./apApprovalWorkflow.js", import.meta.url).pathname,
    bundlerOptions: { ignoreModules: AP_WORKFLOW_IGNORE_MODULES },
    activities: apApprovalActivities,
    maxConcurrentActivityTaskExecutions: 10,
    maxConcurrentWorkflowTaskExecutions: 5,
    maxCachedWorkflows: 100,
    shutdownGraceTime: "30 seconds",
    interceptors: { activity: [makeTemporalOtelActivityInterceptors()] },
  });

  const arWorker = await Worker.create({
    connection,
    namespace: NAMESPACE,
    taskQueue: arAgingTaskQueue(),
    workflowsPath: new URL("./arAgingWorkflow.js", import.meta.url).pathname,
    bundlerOptions: { ignoreModules: AR_WORKFLOW_IGNORE_MODULES },
    activities: { runArAgingSweepActivity },
    maxConcurrentActivityTaskExecutions: 5,
    maxConcurrentWorkflowTaskExecutions: 2,
    maxCachedWorkflows: 50,
    shutdownGraceTime: "30 seconds",
    interceptors: { activity: [makeTemporalOtelActivityInterceptors()] },
  });

  logger.info(`[Temporal Worker] Worker started on task queue: ${TASK_QUEUE}`);
  logger.info("[Temporal Worker] Registered workflows: TransferWorkflow, KYCVerificationWorkflow, RecurringPaymentWorkflow");
  logger.info(`[Temporal Worker] Registered activities: ${Object.keys(activities).join(", ")}`);
  logger.info(`[Temporal Worker] W10 workers started on queues: ${AP_APPROVAL_TASK_QUEUE} (apApprovalExpiryWorkflow), ${arAgingTaskQueue()} (arAgingWorkflow)`);
  workerReady = true; // Signal health endpoint that worker is ready

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info("[Temporal Worker] Shutting down gracefully...");
    workerReady = false;
    await Promise.all([worker.shutdown(), apWorker.shutdown(), arWorker.shutdown()]);
    await connection.close();
    healthServer.close();
    logger.info("[Temporal Worker] Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await Promise.all([worker.run(), apWorker.run(), arWorker.run()]);
}

run().catch(err => {
  logger.error({ err: err }, '[Temporal Worker] Fatal error:');
  process.exit(1);
});
