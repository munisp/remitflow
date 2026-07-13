/**
 * nifi.service.ts
 * Apache NiFi integration for RemitFlow
 *
 * Value to the platform:
 * - Real-time data ingestion from payment rails (SWIFT, SEPA, ACH, Mojaloop)
 * - Automated ETL pipelines: raw transaction events → Bronze → Silver → Gold lakehouse
 * - Compliance data routing: flag suspicious flows → compliance queue
 * - Partner data exchange: automated file-based partner reconciliation
 * - Event-driven FX rate ingestion from multiple providers
 *
 * Default URL: http://localhost:8080/nifi-api (override with NIFI_URL env var)
 */

import axios from "axios";

const NIFI_BASE_URL = process.env.NIFI_URL ?? "http://localhost:8080/nifi-api";
const NIFI_USERNAME = process.env.NIFI_USERNAME ?? "admin";
const NIFI_PASSWORD = process.env.NIFI_PASSWORD ?? "adminadminadmin";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface NiFiProcessGroup {
  id: string;
  name: string;
  status: "RUNNING" | "STOPPED" | "DISABLED";
  flowFilesQueued: number;
  bytesQueued: number;
  activeThreadCount: number;
}

export interface NiFiProcessor {
  id: string;
  name: string;
  type: string;
  state: "RUNNING" | "STOPPED" | "DISABLED";
  validationErrors: string[];
}

export interface NiFiConnection {
  id: string;
  name: string;
  sourceId: string;
  destinationId: string;
  queuedCount: number;
  queuedSize: string;
  backPressureObjectThreshold: number;
}

export interface NiFiFlowStatus {
  available: boolean;
  version?: string;
  processGroups: NiFiProcessGroup[];
  totalFlowFilesQueued: number;
  totalBytesQueued: number;
  activeThreadCount: number;
  error?: string;
}

export interface NiFiPipelineResult {
  success: boolean;
  pipelineId: string;
  pipelineName: string;
  action: "start" | "stop" | "trigger";
  message: string;
  available: boolean;
}

// ─── Predefined RemitFlow NiFi Pipelines ─────────────────────────────────────
export const REMITFLOW_PIPELINES = {
  TRANSACTION_INGEST: {
    id: "remitflow-tx-ingest",
    name: "Transaction Ingestion Pipeline",
    description: "Ingests raw transaction events from Kafka → Bronze lakehouse",
    schedule: "* * * * * ?",
  },
  FX_RATE_SYNC: {
    id: "remitflow-fx-sync",
    name: "FX Rate Synchronisation",
    description: "Pulls live FX rates from ECB, OpenExchangeRates, CurrencyLayer every 60s",
    schedule: "0 * * * * ?",
  },
  COMPLIANCE_ROUTING: {
    id: "remitflow-compliance",
    name: "Compliance Data Router",
    description: "Routes flagged transactions to compliance queue and OFAC screening",
    schedule: "0/30 * * * * ?",
  },
  PARTNER_RECONCILIATION: {
    id: "remitflow-partner-recon",
    name: "Partner Reconciliation Pipeline",
    description: "Automated SFTP pickup of partner settlement files → reconciliation DB",
    schedule: "0 0 2 * * ?",
  },
  LAKEHOUSE_ETL: {
    id: "remitflow-lakehouse-etl",
    name: "Lakehouse ETL Pipeline",
    description: "Bronze → Silver → Gold transformation with dbt models",
    schedule: "0 0 1 * * ?",
  },
  KYC_DOCUMENT_INGEST: {
    id: "remitflow-kyc-ingest",
    name: "KYC Document Ingestion",
    description: "Ingests KYC documents from S3 → OCR → structured data",
    schedule: "0/10 * * * * ?",
  },
  FRAUD_SIGNAL_AGGREGATOR: {
    id: "remitflow-fraud-signals",
    name: "Fraud Signal Aggregator",
    description: "Aggregates fraud signals from Qdrant, FalkorDB, and rule engine",
    schedule: "0/5 * * * * ?",
  },
  MOJALOOP_EVENT_PROCESSOR: {
    id: "remitflow-mojaloop-events",
    name: "Mojaloop Event Processor",
    description: "Processes Mojaloop transfer callbacks and settlement notifications",
    schedule: "* * * * * ?",
  },
} as const;

// ─── NiFi Service Class ───────────────────────────────────────────────────────
export class NiFiService {
  private token: string | null = null;
  private tokenExpiry: number = 0;

  private async getToken(): Promise<string | null> {
    if (this.token && Date.now() < this.tokenExpiry) return this.token;
    try {
      const res = await axios.post(
        `${NIFI_BASE_URL}/access/token`,
        new URLSearchParams({ username: NIFI_USERNAME, password: NIFI_PASSWORD }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 5000 }
      );
      this.token = res.data as string;
      this.tokenExpiry = Date.now() + 10 * 60 * 1000; // 10 min
      return this.token;
    } catch {
      return null;
    }
  }

  private async request<T>(method: "get" | "post" | "put" | "delete", path: string, data?: unknown): Promise<T | null> {
    try {
      const token = await this.getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await axios({ method, url: `${NIFI_BASE_URL}${path}`, data, headers, timeout: 10000 });
      return res.data as T;
    } catch {
      return null;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await axios.get(`${NIFI_BASE_URL}/system-diagnostics`, { timeout: 3000 });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<NiFiFlowStatus> {
    const available = await this.isAvailable();
    if (!available) {
      return {
        available: false,
        processGroups: Object.values(REMITFLOW_PIPELINES).map((p) => ({
          id: p.id,
          name: p.name,
          status: "STOPPED" as const,
          flowFilesQueued: 0,
          bytesQueued: 0,
          activeThreadCount: 0,
        })),
        totalFlowFilesQueued: 0,
        totalBytesQueued: 0,
        activeThreadCount: 0,
        error: "NiFi not reachable — start with docker compose -f docker-compose.ai.yml up nifi",
      };
    }

    const flow = await this.request<any>("get", "/flow/process-groups/root");
    const diagnostics = await this.request<any>("get", "/system-diagnostics");

    const processGroups: NiFiProcessGroup[] = (flow?.processGroupFlow?.flow?.processGroups ?? []).map((pg: any) => ({
      id: pg.id,
      name: pg.component?.name ?? "Unknown",
      status: pg.component?.state ?? "STOPPED",
      flowFilesQueued: pg.status?.aggregateSnapshot?.flowFilesQueued ?? 0,
      bytesQueued: pg.status?.aggregateSnapshot?.bytesQueued ?? 0,
      activeThreadCount: pg.status?.aggregateSnapshot?.activeThreadCount ?? 0,
    }));

    return {
      available: true,
      version: diagnostics?.systemDiagnostics?.aggregateSnapshot?.versionInfo?.niFiVersion ?? "unknown",
      processGroups,
      totalFlowFilesQueued: processGroups.reduce((s, pg) => s + pg.flowFilesQueued, 0),
      totalBytesQueued: processGroups.reduce((s, pg) => s + pg.bytesQueued, 0),
      activeThreadCount: processGroups.reduce((s, pg) => s + pg.activeThreadCount, 0),
    };
  }

  async startPipeline(pipelineId: string): Promise<NiFiPipelineResult> {
    const pipeline = Object.values(REMITFLOW_PIPELINES).find((p) => p.id === pipelineId);
    if (!pipeline) {
      return { success: false, pipelineId, pipelineName: "Unknown", action: "start", message: "Pipeline not found", available: false };
    }

    const available = await this.isAvailable();
    if (!available) {
      return {
        success: false,
        pipelineId,
        pipelineName: pipeline.name,
        action: "start",
        message: "NiFi service unavailable. Configure NIFI_URL to connect to a running NiFi instance.",
        available: false,
      };
    }

    const result = await this.request<any>("put", `/flow/process-groups/${pipelineId}`, {
      id: pipelineId,
      state: "RUNNING",
    });

    return {
      success: !!result,
      pipelineId,
      pipelineName: pipeline.name,
      action: "start",
      message: result ? `Pipeline '${pipeline.name}' started` : "Failed to start pipeline",
      available: true,
    };
  }

  async stopPipeline(pipelineId: string): Promise<NiFiPipelineResult> {
    const pipeline = Object.values(REMITFLOW_PIPELINES).find((p) => p.id === pipelineId);
    if (!pipeline) {
      return { success: false, pipelineId, pipelineName: "Unknown", action: "stop", message: "Pipeline not found", available: false };
    }

    const available = await this.isAvailable();
    if (!available) {
      return { success: false, pipelineId, pipelineName: pipeline.name, action: "stop", message: "NiFi not available", available: false };
    }

    const result = await this.request<any>("put", `/flow/process-groups/${pipelineId}`, {
      id: pipelineId,
      state: "STOPPED",
    });

    return {
      success: !!result,
      pipelineId,
      pipelineName: pipeline.name,
      action: "stop",
      message: result ? `Pipeline '${pipeline.name}' stopped` : "Failed to stop pipeline",
      available: true,
    };
  }

  async triggerPipeline(pipelineId: string, payload?: Record<string, unknown>): Promise<NiFiPipelineResult> {
    const pipeline = Object.values(REMITFLOW_PIPELINES).find((p) => p.id === pipelineId);
    if (!pipeline) {
      return { success: false, pipelineId, pipelineName: "Unknown", action: "trigger", message: "Pipeline not found", available: false };
    }

    const available = await this.isAvailable();
    if (!available) {
      return {
        success: false,
        pipelineId,
        pipelineName: pipeline.name,
        action: "trigger",
        message: `NiFi service unavailable. Configure NIFI_URL to connect to a running NiFi instance.`,
        available: false,
      };
    }

    // In real NiFi, triggering is done by posting a FlowFile to an HTTP Listen processor
    const result = await this.request<any>("post", `/data-transfer/input-ports/${pipelineId}/transactions`, payload ?? {});
    return {
      success: !!result,
      pipelineId,
      pipelineName: pipeline.name,
      action: "trigger",
      message: result ? `Pipeline '${pipeline.name}' triggered` : "Failed to trigger pipeline",
      available: true,
    };
  }

  async getPipelineList(): Promise<Array<typeof REMITFLOW_PIPELINES[keyof typeof REMITFLOW_PIPELINES] & { status: string; available: boolean }>> {
    const available = await this.isAvailable();
    return Object.values(REMITFLOW_PIPELINES).map((p) => ({
      ...p,
      status: available ? "RUNNING" : "STOPPED",
      available,
    }));
  }
}

export const nifiService = new NiFiService();
