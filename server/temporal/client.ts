/**
 * RemitFlow Temporal Client v9 — Production-Hardened
 *
 * Provides a typed Temporal client for tRPC procedures to start workflows.
 * FAIL-CLOSED in production: throws when Temporal unavailable for money-critical workflows.
 * Graceful degradation only in development/test.
 */

import { Connection, Client, type WorkflowHandle } from "@temporalio/client";
import type { TransferWorkflowInput, KYCWorkflowInput, RecurringPaymentWorkflowInput } from "./workflows";
import { logger } from '../_core/logger';
import { TRPCError } from "@trpc/server";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "remitflow-main";
const NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "default";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

let _client: Client | null = null;
let _connectionFailed = false;
let _lastRetryAt = 0;
const RETRY_INTERVAL_MS = 30_000; // retry connection every 30s

async function getTemporalClient(): Promise<Client | null> {
  if (_client) return _client;

  // Allow periodic retry instead of permanent failure
  if (_connectionFailed && Date.now() - _lastRetryAt < RETRY_INTERVAL_MS) {
    return null;
  }

  try {
    _lastRetryAt = Date.now();
    const connection = await Connection.connect({
      address: TEMPORAL_ADDRESS,
    });
    _client = new Client({ connection, namespace: NAMESPACE });
    _connectionFailed = false;
    logger.info("[Temporal Client] Connected to Temporal server");
    return _client;
  } catch (err) {
    _connectionFailed = true;
    logger.warn("[Temporal Client] Temporal server unavailable:", (err as Error).message);
    return null;
  }
}

function ensureTemporalOrThrow(client: Client | null, workflowType: string): asserts client is Client {
  if (!client) {
    if (IS_PRODUCTION) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: `[Temporal] FAIL-CLOSED: Cannot start ${workflowType} — Temporal server unavailable in production`,
      });
    }
  }
}

// ============================================================================
// Start TransferWorkflow
// ============================================================================

export async function startTransferWorkflow(
  input: TransferWorkflowInput
): Promise<{ workflowId: string; runId?: string; fallback: boolean }> {
  const client = await getTemporalClient();

  // FAIL-CLOSED in production: transfers MUST go through Temporal saga
  ensureTemporalOrThrow(client, "TransferWorkflow");

  if (!client) {
    // Dev-only fallback
    logger.warn("[Temporal] DEV-ONLY fallback: executing transfer without Temporal orchestration");
    return { workflowId: `fallback-${input.idempotencyKey}`, fallback: true };
  }

  try {
    const handle = await client.workflow.start("TransferWorkflow", {
      taskQueue: TASK_QUEUE,
      workflowId: `transfer-${input.idempotencyKey}`,
      args: [input],
      searchAttributes: {
        CustomStringField: [`user:${input.userId}`],
      },
    });

    return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId, fallback: false };
  } catch (err) {
    if (IS_PRODUCTION) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `[Temporal] FAIL-CLOSED: TransferWorkflow start failed — ${(err as Error).message}`,
      });
    }
    logger.error("[Temporal] Failed to start TransferWorkflow:", (err as Error).message);
    return { workflowId: `error-${input.idempotencyKey}`, fallback: true };
  }
}

// ============================================================================
// Start KYCVerificationWorkflow
// ============================================================================

export async function startKYCWorkflow(
  input: KYCWorkflowInput
): Promise<{ workflowId: string; fallback: boolean }> {
  const client = await getTemporalClient();

  // FAIL-CLOSED in production: KYC verification MUST be orchestrated
  ensureTemporalOrThrow(client, "KYCVerificationWorkflow");

  if (!client) {
    return { workflowId: `fallback-kyc-${input.userId}-${Date.now()}`, fallback: true };
  }

  try {
    const handle = await client.workflow.start("KYCVerificationWorkflow", {
      taskQueue: TASK_QUEUE,
      workflowId: `kyc-${input.userId}-${input.kycDocId}`,
      args: [input],
    });

    return { workflowId: handle.workflowId, fallback: false };
  } catch (err) {
    if (IS_PRODUCTION) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `[Temporal] FAIL-CLOSED: KYCVerificationWorkflow failed — ${(err as Error).message}`,
      });
    }
    logger.error("[Temporal] Failed to start KYCVerificationWorkflow:", (err as Error).message);
    return { workflowId: `error-kyc-${input.userId}`, fallback: true };
  }
}

// ============================================================================
// Start RecurringPaymentWorkflow
// ============================================================================

export async function startRecurringPaymentWorkflow(
  input: RecurringPaymentWorkflowInput
): Promise<{ workflowId: string; fallback: boolean }> {
  const client = await getTemporalClient();

  // FAIL-CLOSED in production: recurring payments MUST be saga-orchestrated
  ensureTemporalOrThrow(client, "RecurringPaymentWorkflow");

  if (!client) {
    return { workflowId: `fallback-rec-${input.scheduleId}`, fallback: true };
  }

  try {
    const handle = await client.workflow.start("RecurringPaymentWorkflow", {
      taskQueue: TASK_QUEUE,
      workflowId: `recurring-${input.scheduleId}`,
      args: [input],
    });

    return { workflowId: handle.workflowId, fallback: false };
  } catch (err) {
    if (IS_PRODUCTION) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `[Temporal] FAIL-CLOSED: RecurringPaymentWorkflow failed — ${(err as Error).message}`,
      });
    }
    logger.error("[Temporal] Failed to start RecurringPaymentWorkflow:", (err as Error).message);
    return { workflowId: `error-rec-${input.scheduleId}`, fallback: true };
  }
}

// ============================================================================
// Get workflow status
// ============================================================================

export async function getWorkflowStatus(
  workflowId: string
): Promise<{ status: string; result?: unknown; error?: string } | null> {
  const client = await getTemporalClient();
  if (!client) return null;

  try {
    const handle: WorkflowHandle = client.workflow.getHandle(workflowId);
    const description = await handle.describe();
    return {
      status: description.status.name,
    };
  } catch (err) {
    return { status: "UNKNOWN", error: (err as Error).message };
  }
}

// ============================================================================
// Signal a workflow
// ============================================================================

export async function signalWorkflow(
  workflowId: string,
  signalName: string,
  args: unknown[]
): Promise<boolean> {
  const client = await getTemporalClient();
  if (!client) return false;

  try {
    const handle: WorkflowHandle = client.workflow.getHandle(workflowId);
    await handle.signal(signalName, ...args);
    return true;
  } catch (err) {
    logger.error("[Temporal] Signal failed:", (err as Error).message);
    return false;
  }
}
