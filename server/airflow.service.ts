/**
 * airflow.service.ts
 * Apache Airflow integration for RemitFlow
 *
 * Value to the platform:
 * - Orchestrates complex multi-step workflows: KYC → Compliance → Approval → Settlement
 * - Schedules and monitors dbt model runs on a cron basis
 * - Manages partner reconciliation workflows with retry logic and alerting
 * - Orchestrates the full lakehouse ETL pipeline (NiFi ingest → dbt transform → Qdrant index)
 * - Provides dependency-aware scheduling for regulatory reporting deadlines
 * - Handles failure recovery, SLA monitoring, and escalation for critical financial workflows
 *
 * Default URL: http://localhost:8081/api/v1 (override with AIRFLOW_URL env var)
 */

import axios from "axios";

const AIRFLOW_BASE_URL = process.env.AIRFLOW_URL ?? "http://localhost:8081/api/v1";
const AIRFLOW_USERNAME = process.env.AIRFLOW_USERNAME ?? "admin";
const AIRFLOW_PASSWORD = process.env.AIRFLOW_PASSWORD ?? "admin";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface AirflowDag {
  dagId: string;
  description: string;
  isPaused: boolean;
  isActive: boolean;
  schedule: string;
  lastRunAt?: Date;
  lastRunState?: "success" | "failed" | "running" | "queued";
  nextRunAt?: Date;
  tags: string[];
}

export interface AirflowDagRun {
  dagRunId: string;
  dagId: string;
  state: "success" | "failed" | "running" | "queued";
  startDate?: Date;
  endDate?: Date;
  executionDate: Date;
  note?: string;
}

export interface AirflowTaskInstance {
  taskId: string;
  dagId: string;
  dagRunId: string;
  state: "success" | "failed" | "running" | "queued" | "skipped" | "upstream_failed";
  startDate?: Date;
  endDate?: Date;
  durationSeconds?: number;
  tryNumber: number;
}

export interface AirflowStatus {
  available: boolean;
  version?: string;
  dags: AirflowDag[];
  runningDagRuns: number;
  failedDagRuns24h: number;
  error?: string;
}

export interface AirflowTriggerResult {
  success: boolean;
  dagId: string;
  dagRunId: string;
  message: string;
  available: boolean;
}

// ─── Predefined RemitFlow Airflow DAGs ───────────────────────────────────────
export const REMITFLOW_DAGS: AirflowDag[] = [
  {
    dagId: "remitflow_daily_etl",
    description: "Daily ETL: NiFi ingest → dbt transform → Qdrant index → ML feature refresh",
    isPaused: false,
    isActive: true,
    schedule: "0 1 * * *",
    tags: ["etl", "lakehouse", "daily"],
  },
  {
    dagId: "remitflow_kyc_workflow",
    description: "KYC lifecycle: document upload → OCR → AML screening → approval/rejection",
    isPaused: false,
    isActive: true,
    schedule: "*/10 * * * *",
    tags: ["kyc", "compliance", "realtime"],
  },
  {
    dagId: "remitflow_compliance_report",
    description: "Weekly compliance report: AML/KYC/FATF data aggregation → PDF generation → regulator submission",
    isPaused: false,
    isActive: true,
    schedule: "0 6 * * 1",
    tags: ["compliance", "regulatory", "weekly"],
  },
  {
    dagId: "remitflow_partner_reconciliation",
    description: "Daily partner reconciliation: SFTP pickup → parse → match → exception handling",
    isPaused: false,
    isActive: true,
    schedule: "0 3 * * *",
    tags: ["partners", "reconciliation", "daily"],
  },
  {
    dagId: "remitflow_fraud_model_retrain",
    description: "Weekly fraud model retraining: feature extraction → model training → evaluation → deployment",
    isPaused: false,
    isActive: true,
    schedule: "0 2 * * 0",
    tags: ["ml", "fraud", "weekly"],
  },
  {
    dagId: "remitflow_treasury_rebalance",
    description: "Daily treasury rebalancing: position calculation → threshold check → rebalance orders",
    isPaused: false,
    isActive: true,
    schedule: "0 4 * * *",
    tags: ["treasury", "finance", "daily"],
  },
  {
    dagId: "remitflow_sla_monitor",
    description: "Hourly SLA monitoring: check pending transactions → escalate breaches → notify ops",
    isPaused: false,
    isActive: true,
    schedule: "0 * * * *",
    tags: ["sla", "ops", "hourly"],
  },
  {
    dagId: "remitflow_fx_rate_sync",
    description: "FX rate synchronisation every 5 minutes from ECB, OpenExchangeRates, Wise",
    isPaused: false,
    isActive: true,
    schedule: "*/5 * * * *",
    tags: ["fx", "rates", "frequent"],
  },
  {
    dagId: "remitflow_dbt_run",
    description: "Hourly dbt model run: staging → intermediate → marts",
    isPaused: false,
    isActive: true,
    schedule: "0 * * * *",
    tags: ["dbt", "lakehouse", "hourly"],
  },
  {
    dagId: "remitflow_notification_dispatch",
    description: "Notification dispatch: queue → batch → send (email/SMS/push) → delivery tracking",
    isPaused: false,
    isActive: true,
    schedule: "*/2 * * * *",
    tags: ["notifications", "comms", "frequent"],
  },
  {
    dagId: "remitflow_data_retention",
    description: "Monthly data retention: archive old records → purge erasure requests → GDPR compliance",
    isPaused: false,
    isActive: true,
    schedule: "0 0 1 * *",
    tags: ["gdpr", "retention", "monthly"],
  },
  {
    dagId: "remitflow_corridor_health_check",
    description: "Hourly corridor health check: test transactions → latency measurement → routing table update",
    isPaused: false,
    isActive: true,
    schedule: "30 * * * *",
    tags: ["routing", "corridors", "hourly"],
  },
];

// ─── Airflow Service Class ────────────────────────────────────────────────────
export class AirflowService {
  private get authHeaders() {
    const token = Buffer.from(`${AIRFLOW_USERNAME}:${AIRFLOW_PASSWORD}`).toString("base64");
    return { Authorization: `Basic ${token}`, "Content-Type": "application/json" };
  }

  private async request<T>(method: "get" | "post" | "patch" | "delete", path: string, data?: unknown): Promise<T | null> {
    try {
      const res = await axios({
        method,
        url: `${AIRFLOW_BASE_URL}${path}`,
        data,
        headers: this.authHeaders,
        timeout: 10000,
      });
      return res.data as T;
    } catch {
      return null;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await axios.get(`${AIRFLOW_BASE_URL}/health`, {
        headers: this.authHeaders,
        timeout: 3000,
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<AirflowStatus> {
    const available = await this.isAvailable();

    if (!available) {
      return {
        available: false,
        dags: REMITFLOW_DAGS,
        runningDagRuns: 0,
        failedDagRuns24h: 0,
        error: "Airflow not reachable — start with docker compose -f docker-compose.ai.yml up airflow",
      };
    }

    const [health, dagsRes] = await Promise.all([
      this.request<any>("get", "/health"),
      this.request<any>("get", "/dags?limit=100"),
    ]);

    const remoteDags: AirflowDag[] = (dagsRes?.dags ?? []).map((d: any) => ({
      dagId: d.dag_id,
      description: d.description ?? "",
      isPaused: d.is_paused,
      isActive: d.is_active,
      schedule: d.schedule_interval?.value ?? d.timetable_description ?? "",
      tags: (d.tags ?? []).map((t: any) => t.name),
    }));

    return {
      available: true,
      version: health?.version ?? "unknown",
      dags: remoteDags.length > 0 ? remoteDags : REMITFLOW_DAGS,
      runningDagRuns: 0,
      failedDagRuns24h: 0,
    };
  }

  async triggerDag(dagId: string, conf?: Record<string, unknown>): Promise<AirflowTriggerResult> {
    const available = await this.isAvailable();

    if (!available) {
      return {
        success: false,
        dagId,
        dagRunId: "",
        message: `Airflow service unavailable. Configure AIRFLOW_BASE_URL to connect to a running Airflow instance.`,
        available: false,
      };
    }

    const result = await this.request<any>("post", `/dags/${dagId}/dagRuns`, {
      conf: conf ?? {},
      note: `Triggered by RemitFlow API at ${new Date().toISOString()}`,
    });

    if (!result) {
      return { success: false, dagId, dagRunId: "", message: `Failed to trigger DAG '${dagId}'`, available: true };
    }

    return {
      success: true,
      dagId,
      dagRunId: result.dag_run_id,
      message: `DAG '${dagId}' triggered — run ID: ${result.dag_run_id}`,
      available: true,
    };
  }

  async getDagRuns(dagId: string, limit = 10): Promise<AirflowDagRun[]> {
    const available = await this.isAvailable();
    if (!available) return [];

    const result = await this.request<any>("get", `/dags/${dagId}/dagRuns?limit=${limit}&order_by=-execution_date`);
    return (result?.dag_runs ?? []).map((r: any) => ({
      dagRunId: r.dag_run_id,
      dagId: r.dag_id,
      state: r.state,
      startDate: r.start_date ? new Date(r.start_date) : undefined,
      endDate: r.end_date ? new Date(r.end_date) : undefined,
      executionDate: new Date(r.execution_date),
      note: r.note,
    }));
  }

  async pauseDag(dagId: string): Promise<{ success: boolean; message: string }> {
    const available = await this.isAvailable();
    if (!available) return { success: false, message: `Airflow service unavailable. Configure AIRFLOW_BASE_URL.` };

    const result = await this.request<any>("patch", `/dags/${dagId}`, { is_paused: true });
    return { success: !!result, message: result ? `DAG '${dagId}' paused` : `Failed to pause DAG '${dagId}'` };
  }

  async unpauseDag(dagId: string): Promise<{ success: boolean; message: string }> {
    const available = await this.isAvailable();
    if (!available) return { success: false, message: `Airflow service unavailable. Configure AIRFLOW_BASE_URL.` };

    const result = await this.request<any>("patch", `/dags/${dagId}`, { is_paused: false });
    return { success: !!result, message: result ? `DAG '${dagId}' unpaused` : `Failed to unpause DAG '${dagId}'` };
  }

  getDagList(): AirflowDag[] {
    return REMITFLOW_DAGS;
  }
}

export const airflowService = new AirflowService();
