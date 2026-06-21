/**
 * temporalClient.ts — Temporal Connection Manager
 *
 * Provides a singleton Temporal client for starting and querying workflows.
 * In production, connects to the configured Temporal server.
 * In development without Temporal, provides a local saga fallback.
 *
 * Environment Variables:
 *   TEMPORAL_HOST_PORT     — Temporal gRPC endpoint (default: localhost:7233)
 *   TEMPORAL_NAMESPACE     — Temporal namespace (default: "remitflow")
 *   TEMPORAL_TASK_QUEUE    — Task queue name (default: "fund-flow-tasks")
 *   TEMPORAL_TLS_CERT      — Path to TLS client cert (optional, for Temporal Cloud)
 *   TEMPORAL_TLS_KEY       — Path to TLS client key (optional, for Temporal Cloud)
 *   FUND_FLOW_TEMPORAL_STRICT — "true" to reject multi-step fund ops if Temporal unavailable
 */

import { logger } from "../_core/logger.js";

const TEMPORAL_HOST = process.env.TEMPORAL_HOST_PORT ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "remitflow";
const TEMPORAL_TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "fund-flow-tasks";

interface TemporalWorkflowHandle {
  workflowId: string;
  result(): Promise<unknown>;
  query(queryType: string): Promise<unknown>;
  signal(signalName: string, ...args: unknown[]): Promise<void>;
  cancel(): Promise<void>;
  terminate(reason?: string): Promise<void>;
}

interface TemporalClientLike {
  start(workflowFn: string, options: {
    taskQueue: string;
    workflowId: string;
    args: unknown[];
  }): Promise<TemporalWorkflowHandle>;
  getHandle(workflowId: string): TemporalWorkflowHandle;
}

let temporalClient: TemporalClientLike | null = null;
let connectionFailed = false;
let lastConnectionError: string | null = null;

export interface TemporalHealthStatus {
  connected: boolean;
  host: string;
  namespace: string;
  taskQueue: string;
  lastError: string | null;
}

/**
 * Whether Temporal is required for multi-step fund operations.
 */
export function isTemporalStrictMode(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  return process.env.FUND_FLOW_TEMPORAL_STRICT === "true";
}

/**
 * Get or create the Temporal client connection.
 */
export async function getTemporalClient(): Promise<TemporalClientLike> {
  if (temporalClient) return temporalClient;

  try {
    const { Client, Connection } = await import("@temporalio/client");

    // TLS for Temporal Cloud
    const tlsCert = process.env.TEMPORAL_TLS_CERT;
    const tlsKey = process.env.TEMPORAL_TLS_KEY;
    let tls: { clientCertPair: { crt: Buffer; key: Buffer } } | undefined;
    if (tlsCert && tlsKey) {
      const fs = await import("fs");
      tls = {
        clientCertPair: {
          crt: fs.readFileSync(tlsCert),
          key: fs.readFileSync(tlsKey),
        },
      };
    }

    const connectOptions: { address: string; tls?: unknown } = { address: TEMPORAL_HOST };
    if (tls) connectOptions.tls = tls;
    const connection = await Connection.connect(connectOptions as Parameters<typeof Connection.connect>[0]);
    const client = new Client({
      connection,
      namespace: TEMPORAL_NAMESPACE,
    });

    temporalClient = {
      async start(workflowFn: string, options: { taskQueue: string; workflowId: string; args: unknown[] }) {
        const handle = await client.workflow.start(workflowFn, {
          taskQueue: options.taskQueue,
          workflowId: options.workflowId,
          args: options.args,
        });
        return {
          workflowId: options.workflowId,
          result: () => handle.result(),
          query: (qt: string) => handle.query(qt),
          signal: (sn: string, ...args: unknown[]) => handle.signal(sn, ...args),
          cancel: () => handle.cancel(),
          terminate: (reason?: string) => handle.terminate(reason),
        };
      },
      getHandle(workflowId: string) {
        const handle = client.workflow.getHandle(workflowId);
        return {
          workflowId,
          result: () => handle.result(),
          query: (qt: string) => handle.query(qt),
          signal: (sn: string, ...args: unknown[]) => handle.signal(sn, ...args),
          cancel: () => handle.cancel(),
          terminate: (reason?: string) => handle.terminate(reason),
        };
      },
    };

    connectionFailed = false;
    lastConnectionError = null;
    logger.info({ host: TEMPORAL_HOST, namespace: TEMPORAL_NAMESPACE }, "[Temporal] Connected successfully");
    return temporalClient;
  } catch (err) {
    connectionFailed = true;
    lastConnectionError = err instanceof Error ? err.message : String(err);
    logger.error({ err: lastConnectionError, host: TEMPORAL_HOST }, "[Temporal] Connection failed");
    throw err;
  }
}

/**
 * Start a fund flow workflow via Temporal.
 * In strict mode, failure to connect to Temporal blocks multi-step operations.
 */
export async function startFundFlowWorkflow(
  workflowName: string,
  workflowId: string,
  input: Record<string, unknown>,
): Promise<{ workflowId: string; handle?: TemporalWorkflowHandle }> {
  try {
    const client = await getTemporalClient();
    const handle = await client.start(workflowName, {
      taskQueue: TEMPORAL_TASK_QUEUE,
      workflowId,
      args: [input],
    });
    logger.info({ workflowName, workflowId }, "[Temporal] Workflow started");
    return { workflowId, handle };
  } catch (err) {
    if (isTemporalStrictMode()) {
      logger.error({ err, workflowName, workflowId }, "[Temporal] Cannot start workflow in strict mode — blocking operation");
      throw new Error(`[FUND_FLOW_BLOCKED] Temporal unavailable — cannot orchestrate ${workflowName}. Multi-step fund operations require Temporal for saga compensation guarantees.`);
    }
    logger.warn({ err, workflowName, workflowId }, "[Temporal] Workflow start failed — using local saga fallback");
    return { workflowId };
  }
}

/**
 * Query a running workflow's status.
 */
export async function queryWorkflowStatus(workflowId: string): Promise<unknown> {
  try {
    const client = await getTemporalClient();
    const handle = client.getHandle(workflowId);
    return await handle.query("getStatus");
  } catch (err) {
    logger.warn({ err, workflowId }, "[Temporal] Could not query workflow status");
    return null;
  }
}

/**
 * Cancel a running workflow.
 */
export async function cancelWorkflow(workflowId: string): Promise<boolean> {
  try {
    const client = await getTemporalClient();
    const handle = client.getHandle(workflowId);
    await handle.cancel();
    return true;
  } catch (err) {
    logger.warn({ err, workflowId }, "[Temporal] Could not cancel workflow");
    return false;
  }
}

/**
 * Get Temporal health status.
 */
export function getTemporalHealth(): TemporalHealthStatus {
  return {
    connected: temporalClient !== null && !connectionFailed,
    host: TEMPORAL_HOST,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: TEMPORAL_TASK_QUEUE,
    lastError: lastConnectionError,
  };
}
