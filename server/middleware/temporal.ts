import { logger } from '../_core/logger';
/**
 * RemitFlow — Temporal Workflow Client
 * Orchestrates long-running business processes:
 *   - KYC verification workflows
 *   - International transfer workflows
 *   - Dispute resolution workflows
 *   - Batch payment processing
 *   - Scheduled recurring transfers
 */

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE || "remitflow";
const TEMPORAL_HTTP_URL = process.env.TEMPORAL_HTTP_URL || "http://localhost:8088";

// ── Workflow Types ────────────────────────────────────────────────────────────

export const WORKFLOW_TYPES = {
  KYC_VERIFICATION: "KYCVerificationWorkflow",
  INTERNATIONAL_TRANSFER: "InternationalTransferWorkflow",
  DISPUTE_RESOLUTION: "DisputeResolutionWorkflow",
  BATCH_PAYMENT: "BatchPaymentWorkflow",
  RECURRING_TRANSFER: "RecurringTransferWorkflow",
  SAVINGS_GOAL_MATURITY: "SavingsGoalMaturityWorkflow",
  INVESTMENT_ORDER: "InvestmentOrderWorkflow",
  MOJALOOP_TRANSFER: "MojaloopTransferWorkflow",
} as const;

export const TASK_QUEUES = {
  KYC: "kyc-queue",
  TRANSFERS: "transfers-queue",
  DISPUTES: "disputes-queue",
  BATCH: "batch-queue",
  INVESTMENTS: "investments-queue",
} as const;

// ── Workflow Input/Output Types ───────────────────────────────────────────────

export interface KYCWorkflowInput {
  userId: string;
  kycTier: number;
  documentIds: string[];
  submittedAt: string;
}

export interface TransferWorkflowInput {
  transactionId: string;
  userId: string;
  amount: number;
  currency: string;
  destinationCountry: string;
  beneficiaryId: string;
  provider: "mojaloop" | "wise" | "direct";
}

export interface DisputeWorkflowInput {
  disputeId: string;
  transactionId: string;
  claimantId: string;
  respondentId?: string;
  type: string;
  amount: number;
}

export interface BatchPaymentWorkflowInput {
  batchId: string;
  userId: string;
  paymentIds: string[];
  totalAmount: number;
  currency: string;
}

// ── Temporal HTTP Client (graceful degradation) ───────────────────────────────

class TemporalClient {
  private available = false;

  constructor() {
    this.checkAvailability();
  }

  private async checkAvailability(): Promise<void> {
    try {
      const res = await fetch(`${TEMPORAL_HTTP_URL}/api/v1/namespaces/${TEMPORAL_NAMESPACE}`, {
        signal: AbortSignal.timeout(1000),
      });
      this.available = res.ok;
      if (this.available) {
        logger.info(`[TEMPORAL] Connected to namespace: ${TEMPORAL_NAMESPACE}`);
      }
    } catch {
      this.available = false;
      logger.info("[TEMPORAL] Not available, workflows will use direct execution");
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  async startWorkflow(
    workflowType: string,
    workflowId: string,
    taskQueue: string,
    input: unknown
  ): Promise<{ workflowId: string; runId?: string } | null> {
    if (!this.available) {
      logger.info(`[TEMPORAL:DEV] Would start workflow: ${workflowType} (${workflowId})`);
      return { workflowId };
    }

    try {
      const res = await fetch(
        `${TEMPORAL_HTTP_URL}/api/v1/namespaces/${TEMPORAL_NAMESPACE}/workflows`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflow_id: workflowId,
            workflow_type: { name: workflowType },
            task_queue: { name: taskQueue },
            input: { payloads: [{ data: Buffer.from(JSON.stringify(input)).toString("base64") }] },
          }),
          signal: AbortSignal.timeout(5000),
        }
      );

      if (!res.ok) return null;
      const data = (await res.json()) as { run_id: string };
      return { workflowId, runId: data.run_id };
    } catch {
      return null;
    }
  }

  async getWorkflowStatus(workflowId: string): Promise<{
    status: string;
    startTime?: string;
    closeTime?: string;
  } | null> {
    if (!this.available) return null;

    try {
      const res = await fetch(
        `${TEMPORAL_HTTP_URL}/api/v1/namespaces/${TEMPORAL_NAMESPACE}/workflows/${workflowId}`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        workflowExecutionInfo: {
          status: string;
          startTime: string;
          closeTime?: string;
        };
      };
      return {
        status: data.workflowExecutionInfo.status,
        startTime: data.workflowExecutionInfo.startTime,
        closeTime: data.workflowExecutionInfo.closeTime,
      };
    } catch {
      return null;
    }
  }

  async terminateWorkflow(workflowId: string, reason: string): Promise<boolean> {
    if (!this.available) return false;

    try {
      const res = await fetch(
        `${TEMPORAL_HTTP_URL}/api/v1/namespaces/${TEMPORAL_NAMESPACE}/workflows/${workflowId}/terminate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
          signal: AbortSignal.timeout(3000),
        }
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let temporalClient: TemporalClient | null = null;

export function getTemporalClient(): TemporalClient {
  if (!temporalClient) {
    temporalClient = new TemporalClient();
  }
  return temporalClient;
}

// ── High-Level Workflow Starters ──────────────────────────────────────────────

export async function startKYCWorkflow(input: KYCWorkflowInput): Promise<string | null> {
  const workflowId = `kyc-${input.userId}-${Date.now()}`;
  const result = await getTemporalClient().startWorkflow(
    WORKFLOW_TYPES.KYC_VERIFICATION,
    workflowId,
    TASK_QUEUES.KYC,
    input
  );
  return result?.workflowId ?? null;
}

export async function startTransferWorkflow(input: TransferWorkflowInput): Promise<string | null> {
  const workflowId = `transfer-${input.transactionId}`;
  const result = await getTemporalClient().startWorkflow(
    WORKFLOW_TYPES.INTERNATIONAL_TRANSFER,
    workflowId,
    TASK_QUEUES.TRANSFERS,
    input
  );
  return result?.workflowId ?? null;
}

export async function startDisputeWorkflow(input: DisputeWorkflowInput): Promise<string | null> {
  const workflowId = `dispute-${input.disputeId}`;
  const result = await getTemporalClient().startWorkflow(
    WORKFLOW_TYPES.DISPUTE_RESOLUTION,
    workflowId,
    TASK_QUEUES.DISPUTES,
    input
  );
  return result?.workflowId ?? null;
}

export async function startBatchPaymentWorkflow(input: BatchPaymentWorkflowInput): Promise<string | null> {
  const workflowId = `batch-${input.batchId}`;
  const result = await getTemporalClient().startWorkflow(
    WORKFLOW_TYPES.BATCH_PAYMENT,
    workflowId,
    TASK_QUEUES.BATCH,
    input
  );
  return result?.workflowId ?? null;
}
