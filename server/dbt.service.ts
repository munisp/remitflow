/**
 * dbt.service.ts
 * dbt (data build tool) integration for RemitFlow
 *
 * Value to the platform:
 * - Transforms raw Bronze lakehouse data into curated Silver/Gold analytics tables
 * - Provides tested, version-controlled SQL transformations for all business metrics
 * - Powers the AI/ML feature store with clean, deduplicated feature tables
 * - Enables compliance reporting with audit-ready data lineage
 * - Generates daily/weekly/monthly aggregates for dashboards without manual SQL
 *
 * Default URL: http://localhost:8580 (dbt Cloud API or dbt Core HTTP adapter)
 * Default project: remitflow-dbt (in /home/ubuntu/remitflow/dbt/)
 */

import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import path from "path";

const execAsync = promisify(exec);

const DBT_PROJECT_DIR = process.env.DBT_PROJECT_DIR ?? path.join(process.cwd(), "dbt");
const DBT_CLOUD_URL = process.env.DBT_CLOUD_URL ?? "http://localhost:8580";
const DBT_CLOUD_TOKEN = process.env.DBT_CLOUD_TOKEN ?? "";
const DBT_CLOUD_ACCOUNT_ID = process.env.DBT_CLOUD_ACCOUNT_ID ?? "1";
const DBT_CLOUD_JOB_ID = process.env.DBT_CLOUD_JOB_ID ?? "1";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface DbtModel {
  name: string;
  description: string;
  layer: "staging" | "intermediate" | "marts";
  tags: string[];
  dependsOn: string[];
  rowCount?: number;
  lastRunAt?: Date;
  status: "success" | "error" | "skipped" | "pending";
}

export interface DbtRunResult {
  success: boolean;
  runId: string;
  modelsRun: number;
  modelsSucceeded: number;
  modelsFailed: number;
  durationMs: number;
  errors: string[];
  available: boolean;
}

export interface DbtTestResult {
  success: boolean;
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  failures: Array<{ model: string; test: string; message: string }>;
  available: boolean;
}

export interface DbtStatus {
  available: boolean;
  projectExists: boolean;
  version?: string;
  models: DbtModel[];
  lastRunAt?: Date;
  lastRunStatus?: "success" | "error";
  error?: string;
}

// ─── Predefined RemitFlow dbt Models ─────────────────────────────────────────
export const REMITFLOW_DBT_MODELS: DbtModel[] = [
  // Staging layer — 1:1 with source tables, light cleaning
  { name: "stg_transactions", description: "Cleaned transaction events from Bronze", layer: "staging", tags: ["finance", "core"], dependsOn: ["raw_transactions"], status: "pending" },
  { name: "stg_users", description: "Cleaned user profiles from Bronze", layer: "staging", tags: ["users"], dependsOn: ["raw_users"], status: "pending" },
  { name: "stg_beneficiaries", description: "Cleaned beneficiary records", layer: "staging", tags: ["finance"], dependsOn: ["raw_beneficiaries"], status: "pending" },
  { name: "stg_fx_rates", description: "Cleaned FX rate snapshots", layer: "staging", tags: ["fx"], dependsOn: ["raw_fx_rates"], status: "pending" },
  { name: "stg_kyc_documents", description: "Cleaned KYC document records", layer: "staging", tags: ["compliance", "kyc"], dependsOn: ["raw_kyc_documents"], status: "pending" },
  { name: "stg_fraud_alerts", description: "Cleaned fraud alert events", layer: "staging", tags: ["fraud", "compliance"], dependsOn: ["raw_fraud_alerts"], status: "pending" },
  { name: "stg_compliance_cases", description: "Cleaned compliance case records", layer: "staging", tags: ["compliance"], dependsOn: ["raw_compliance_cases"], status: "pending" },
  { name: "stg_partner_payouts", description: "Cleaned partner payout records", layer: "staging", tags: ["partners"], dependsOn: ["raw_partner_payouts"], status: "pending" },

  // Intermediate layer — business logic joins
  { name: "int_transaction_enriched", description: "Transactions enriched with user, beneficiary, FX rate", layer: "intermediate", tags: ["finance", "core"], dependsOn: ["stg_transactions", "stg_users", "stg_beneficiaries", "stg_fx_rates"], status: "pending" },
  { name: "int_user_risk_profile", description: "User risk scores from transaction history + KYC status", layer: "intermediate", tags: ["risk", "compliance"], dependsOn: ["stg_users", "stg_transactions", "stg_kyc_documents", "stg_fraud_alerts"], status: "pending" },
  { name: "int_corridor_metrics", description: "Per-corridor volume, fees, success rates", layer: "intermediate", tags: ["analytics", "corridors"], dependsOn: ["int_transaction_enriched"], status: "pending" },
  { name: "int_partner_performance", description: "Partner success rates, latency, fee margins", layer: "intermediate", tags: ["partners"], dependsOn: ["stg_partner_payouts", "int_transaction_enriched"], status: "pending" },
  { name: "int_compliance_signals", description: "Aggregated compliance signals per user", layer: "intermediate", tags: ["compliance"], dependsOn: ["stg_compliance_cases", "stg_fraud_alerts", "int_user_risk_profile"], status: "pending" },

  // Marts layer — business-facing analytics tables
  { name: "mart_daily_volume", description: "Daily transaction volume by corridor and currency", layer: "marts", tags: ["analytics", "finance"], dependsOn: ["int_transaction_enriched"], status: "pending" },
  { name: "mart_user_lifetime_value", description: "User LTV, churn risk, engagement score", layer: "marts", tags: ["analytics", "users"], dependsOn: ["int_transaction_enriched", "int_user_risk_profile"], status: "pending" },
  { name: "mart_fraud_dashboard", description: "Fraud detection metrics for the AI/ML dashboard", layer: "marts", tags: ["fraud", "ml"], dependsOn: ["int_compliance_signals", "stg_fraud_alerts"], status: "pending" },
  { name: "mart_compliance_report", description: "Regulatory compliance report data (AML, KYC, FATF)", layer: "marts", tags: ["compliance", "regulatory"], dependsOn: ["int_compliance_signals", "stg_kyc_documents"], status: "pending" },
  { name: "mart_corridor_health", description: "Corridor health scores for smart routing", layer: "marts", tags: ["routing", "analytics"], dependsOn: ["int_corridor_metrics", "int_partner_performance"], status: "pending" },
  { name: "mart_ml_features", description: "Feature store for ML models (fraud, routing, LTV)", layer: "marts", tags: ["ml", "ai"], dependsOn: ["int_transaction_enriched", "int_user_risk_profile", "int_corridor_metrics"], status: "pending" },
  { name: "mart_treasury_positions", description: "Treasury position summaries by currency", layer: "marts", tags: ["treasury", "finance"], dependsOn: ["int_transaction_enriched", "stg_transactions"], status: "pending" },
];

// ─── dbt Service Class ────────────────────────────────────────────────────────
export class DbtService {
  async isAvailable(): Promise<boolean> {
    if (DBT_CLOUD_TOKEN) {
      try {
        const { default: axios } = await import("axios");
        const res = await axios.get(`${DBT_CLOUD_URL}/api/v2/accounts/${DBT_CLOUD_ACCOUNT_ID}/`, {
          headers: { Authorization: `Token ${DBT_CLOUD_TOKEN}` },
          timeout: 3000,
        });
        return res.status === 200;
      } catch {
        return false;
      }
    }
    // Check for dbt CLI
    try {
      await execAsync("dbt --version", { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<DbtStatus> {
    const available = await this.isAvailable();
    const projectExists = existsSync(path.join(DBT_PROJECT_DIR, "dbt_project.yml"));

    if (!available) {
      return {
        available: false,
        projectExists,
        models: REMITFLOW_DBT_MODELS,
        error: "dbt not available — install dbt-core or configure DBT_CLOUD_TOKEN",
      };
    }

    try {
      const { stdout } = await execAsync("dbt --version 2>&1", { cwd: DBT_PROJECT_DIR, timeout: 5000 });
      const versionMatch = stdout.match(/dbt-core\s+([\d.]+)/);
      return {
        available: true,
        projectExists,
        version: versionMatch?.[1] ?? "unknown",
        models: REMITFLOW_DBT_MODELS,
      };
    } catch {
      return { available: false, projectExists, models: REMITFLOW_DBT_MODELS };
    }
  }

  async runModels(select?: string): Promise<DbtRunResult> {
    const available = await this.isAvailable();
    const startMs = Date.now();

    if (!available) {
      return {
        success: false,
        runId: `unavailable-${Date.now()}`,
        modelsRun: 0,
        modelsSucceeded: 0,
        modelsFailed: 0,
        durationMs: 0,
        errors: ["dbt service is unavailable. Configure DBT_CLOUD_TOKEN or install dbt-core CLI."],
        available: false,
      };
    }

    try {
      const selectFlag = select ? `--select ${select}` : "";
      const { stdout, stderr } = await execAsync(`dbt run ${selectFlag} --profiles-dir . 2>&1`, {
        cwd: DBT_PROJECT_DIR,
        timeout: 300000, // 5 min
      });

      const succeededMatch = stdout.match(/(\d+) of \d+ OK/g);
      const failedMatch = stdout.match(/(\d+) of \d+ ERROR/g);
      const modelsSucceeded = succeededMatch?.length ?? 0;
      const modelsFailed = failedMatch?.length ?? 0;

      return {
        success: modelsFailed === 0,
        runId: `local-run-${Date.now()}`,
        modelsRun: modelsSucceeded + modelsFailed,
        modelsSucceeded,
        modelsFailed,
        durationMs: Date.now() - startMs,
        errors: stderr ? [stderr] : [],
        available: true,
      };
    } catch (err: any) {
      return {
        success: false,
        runId: `failed-run-${Date.now()}`,
        modelsRun: 0,
        modelsSucceeded: 0,
        modelsFailed: REMITFLOW_DBT_MODELS.length,
        durationMs: Date.now() - startMs,
        errors: [err.message ?? "Unknown error"],
        available: true,
      };
    }
  }

  async runTests(select?: string): Promise<DbtTestResult> {
    const available = await this.isAvailable();

    if (!available) {
      return {
        success: false,
        testsRun: 0,
        testsPassed: 0,
        testsFailed: 0,
        failures: [],
        available: false,
      };
    }

    try {
      const selectFlag = select ? `--select ${select}` : "";
      const { stdout } = await execAsync(`dbt test ${selectFlag} --profiles-dir . 2>&1`, {
        cwd: DBT_PROJECT_DIR,
        timeout: 120000,
      });

      const passedMatch = stdout.match(/(\d+) passed/);
      const failedMatch = stdout.match(/(\d+) failed/);
      const testsPassed = parseInt(passedMatch?.[1] ?? "0");
      const testsFailed = parseInt(failedMatch?.[1] ?? "0");

      return {
        success: testsFailed === 0,
        testsRun: testsPassed + testsFailed,
        testsPassed,
        testsFailed,
        failures: [],
        available: true,
      };
    } catch (err: any) {
      return { success: false, testsRun: 0, testsPassed: 0, testsFailed: 1, failures: [{ model: "unknown", test: "unknown", message: err.message }], available: true };
    }
  }

  async generateDocs(): Promise<{ success: boolean; message: string; available: boolean }> {
    const available = await this.isAvailable();
    if (!available) return { success: false, message: "dbt service unavailable. Configure DBT_CLOUD_TOKEN or install dbt-core CLI.", available: false };

    try {
      await execAsync("dbt docs generate --profiles-dir . 2>&1", { cwd: DBT_PROJECT_DIR, timeout: 60000 });
      return { success: true, message: "Docs generated at /dbt/target/index.html", available: true };
    } catch (err: any) {
      return { success: false, message: err.message, available: true };
    }
  }

  getModelList(): DbtModel[] {
    return REMITFLOW_DBT_MODELS;
  }
}

export const dbtService = new DbtService();
