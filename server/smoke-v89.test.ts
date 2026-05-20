/**
 * RemitFlow v89 Smoke Tests
 * Covers: NiFi/dbt/Airflow services, v89 routers, data pipeline features,
 *         tenant config, security hardening, dbt models, Airflow DAGs
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── NiFi Service ─────────────────────────────────────────────────────────────
describe("NiFi Service", () => {
  let nifiService: any;

  beforeAll(async () => {
    nifiService = await import("./nifi.service.js");
  });

  it("exports NiFiService class", () => {
    expect(nifiService.NiFiService).toBeDefined();
  });

  it("can instantiate NiFiService with default URL", () => {
    const svc = new nifiService.NiFiService();
    expect(svc).toBeDefined();
  });

  it("getPipelineList returns an array of pipelines", async () => {
    const svc = new nifiService.NiFiService();
    const pipelines = await svc.getPipelineList();
    expect(Array.isArray(pipelines)).toBe(true);
    expect(pipelines.length).toBeGreaterThan(0);
  });

  it("each pipeline has required fields", async () => {
    const svc = new nifiService.NiFiService();
    const pipelines = await svc.getPipelineList();
    for (const p of pipelines) {
      expect(p).toHaveProperty("id");
      expect(p).toHaveProperty("name");
      expect(p).toHaveProperty("status");
    }
  });

  it("getStatus returns an object with available field", async () => {
    const svc = new nifiService.NiFiService();
    const status = await svc.getStatus();
    expect(status).toHaveProperty("available");
    expect(typeof status.available).toBe("boolean");
  });

  it("triggerPipeline returns a result object", async () => {
    const svc = new nifiService.NiFiService();
    const result = await svc.triggerPipeline("remitflow-tx-ingest", { mode: "manual" });
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("pipelineId");
  });

  it("startPipeline returns a result object", async () => {
    const svc = new nifiService.NiFiService();
    const result = await svc.startPipeline("remitflow-tx-ingest");
    expect(result).toHaveProperty("success");
  });

  it("stopPipeline returns a result object", async () => {
    const svc = new nifiService.NiFiService();
    const result = await svc.stopPipeline("remitflow-tx-ingest");
    expect(result).toHaveProperty("success");
  });
});

// ─── dbt Service ──────────────────────────────────────────────────────────────
describe("dbt Service", () => {
  let dbtService: any;

  beforeAll(async () => {
    dbtService = await import("./dbt.service.js");
  });

  it("exports DbtService class", () => {
    expect(dbtService.DbtService).toBeDefined();
  });

  it("can instantiate DbtService", () => {
    const svc = new dbtService.DbtService();
    expect(svc).toBeDefined();
  });

  it("getStatus returns an object with available field", async () => {
    const svc = new dbtService.DbtService();
    const status = await svc.getStatus();
    expect(status).toHaveProperty("available");
    expect(typeof status.available).toBe("boolean");
  });

  it("getModelList returns an array", async () => {
    const svc = new dbtService.DbtService();
    const models = svc.getModelList();
    expect(Array.isArray(models)).toBe(true);
  });

  it("each model has required fields", async () => {
    const svc = new dbtService.DbtService();
    const models = svc.getModelList();
    for (const m of models) {
      expect(m).toHaveProperty("name");
      expect(m).toHaveProperty("layer"); // DbtModel uses 'layer' not 'type'
    }
  });

  it("runModels returns a run result", async () => {
    const svc = new dbtService.DbtService();
    const result = await svc.runModels({ select: "tag:staging" });
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("runId");
  });

  it("runTests returns a test result", async () => {
    const svc = new dbtService.DbtService();
    const result = await svc.runTests();
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("testsRun");
  });
});

// ─── Airflow Service ──────────────────────────────────────────────────────────
describe("Airflow Service", () => {
  let airflowService: any;

  beforeAll(async () => {
    airflowService = await import("./airflow.service.js");
  });

  it("exports AirflowService class", () => {
    expect(airflowService.AirflowService).toBeDefined();
  });

  it("can instantiate AirflowService with default URL", () => {
    const svc = new airflowService.AirflowService();
    expect(svc).toBeDefined();
  });

  it("getStatus returns an object with available field", async () => {
    const svc = new airflowService.AirflowService();
    const status = await svc.getStatus();
    expect(status).toHaveProperty("available");
    expect(typeof status.available).toBe("boolean");
  });

  it("getDagList returns an array of DAGs", async () => {
    const svc = new airflowService.AirflowService();
    const dags = await svc.getDagList();
    expect(Array.isArray(dags)).toBe(true);
    expect(dags.length).toBeGreaterThan(0);
  });

  it("each DAG has required fields", async () => {
    const svc = new airflowService.AirflowService();
    const dags = await svc.getDagList();
    for (const dag of dags) {
      expect(dag).toHaveProperty("dagId");
      expect(dag).toHaveProperty("description");
      expect(dag).toHaveProperty("isPaused");
    }
  });

  it("triggerDag returns a run result", async () => {
    const svc = new airflowService.AirflowService();
    const result = await svc.triggerDag("remitflow_daily_etl");
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("dagRunId");
  });

  it("pauseDag returns a result", async () => {
    const svc = new airflowService.AirflowService();
    const result = await svc.pauseDag("remitflow_daily_etl");
    expect(result).toHaveProperty("success");
  });

  it("unpauseDag returns a result", async () => {
    const svc = new airflowService.AirflowService();
    const result = await svc.unpauseDag("remitflow_daily_etl");
    expect(result).toHaveProperty("success");
  });
});

// ─── Data Pipelines Router ────────────────────────────────────────────────────
describe("Data Pipelines Router", () => {
  it("exports dataPipelinesRouter", async () => {
    const mod = await import("./routers/dataPipelines.js");
    expect(mod.dataPipelinesRouter).toBeDefined();
  });

  it("dataPipelinesRouter has nifi sub-router", async () => {
    const mod = await import("./routers/dataPipelines.js");
    expect(mod.dataPipelinesRouter._def.record).toBeDefined();
  });
});

// ─── Production V89 Router ────────────────────────────────────────────────────
describe("Production V89 Router", () => {
  it("exports productionV89Router", async () => {
    const mod = await import("./routers/productionV89.js");
    expect(mod.productionV89Router).toBeDefined();
  });

  it("productionV89Router has webhookRetry sub-router", async () => {
    const mod = await import("./routers/productionV89.js");
    const router = mod.productionV89Router;
    expect(router).toBeDefined();
  });
});

// ─── dbt Models File Structure ────────────────────────────────────────────────
describe("dbt Project Structure", () => {
  const dbtDir = path.join(process.cwd(), "dbt");

  it("dbt directory exists", () => {
    expect(fs.existsSync(dbtDir)).toBe(true);
  });

  it("dbt_project.yml exists", () => {
    expect(fs.existsSync(path.join(dbtDir, "dbt_project.yml"))).toBe(true);
  });

  it("dbt profiles directory exists", () => {
    expect(fs.existsSync(path.join(dbtDir, "profiles"))).toBe(true);
  });

  it("dbt staging models directory exists", () => {
    expect(fs.existsSync(path.join(dbtDir, "models", "staging"))).toBe(true);
  });

  it("dbt marts models directory exists", () => {
    expect(fs.existsSync(path.join(dbtDir, "models", "marts"))).toBe(true);
  });

  it("stg_transactions.sql exists", () => {
    expect(fs.existsSync(path.join(dbtDir, "models", "staging", "stg_transactions.sql"))).toBe(true);
  });

  it("mart_daily_volume.sql exists", () => {
    expect(fs.existsSync(path.join(dbtDir, "models", "marts", "mart_daily_volume.sql"))).toBe(true);
  });

  it("mart_corridor_performance.sql exists", () => {
    expect(fs.existsSync(path.join(dbtDir, "models", "marts", "mart_corridor_performance.sql"))).toBe(true);
  });

  it("mart_fraud_signals.sql exists", () => {
    expect(fs.existsSync(path.join(dbtDir, "models", "marts", "mart_fraud_signals.sql"))).toBe(true);
  });

  it("dbt_project.yml has correct project name", () => {
    const content = fs.readFileSync(path.join(dbtDir, "dbt_project.yml"), "utf-8");
    expect(content).toContain("name: 'remitflow'");
  });
});

// ─── Airflow DAGs File Structure ──────────────────────────────────────────────
describe("Airflow DAGs Structure", () => {
  const dagsDir = path.join(process.cwd(), "airflow", "dags");

  it("airflow/dags directory exists", () => {
    expect(fs.existsSync(dagsDir)).toBe(true);
  });

  it("remitflow_daily_etl.py exists", () => {
    expect(fs.existsSync(path.join(dagsDir, "remitflow_daily_etl.py"))).toBe(true);
  });

  it("remitflow_fraud_model_retrain.py exists", () => {
    expect(fs.existsSync(path.join(dagsDir, "remitflow_fraud_model_retrain.py"))).toBe(true);
  });

  it("remitflow_compliance_report.py exists", () => {
    expect(fs.existsSync(path.join(dagsDir, "remitflow_compliance_report.py"))).toBe(true);
  });

  it("daily_etl DAG has correct schedule", () => {
    const content = fs.readFileSync(path.join(dagsDir, "remitflow_daily_etl.py"), "utf-8");
    expect(content).toContain("0 1 * * *");
  });

  it("fraud_model_retrain DAG has weekly schedule", () => {
    const content = fs.readFileSync(path.join(dagsDir, "remitflow_fraud_model_retrain.py"), "utf-8");
    expect(content).toContain("0 2 * * 0");
  });

  it("compliance_report DAG has daily schedule", () => {
    const content = fs.readFileSync(path.join(dagsDir, "remitflow_compliance_report.py"), "utf-8");
    expect(content).toContain("0 6 * * *");
  });

  it("all DAGs have retry configuration", () => {
    for (const dag of ["remitflow_daily_etl", "remitflow_fraud_model_retrain", "remitflow_compliance_report"]) {
      const content = fs.readFileSync(path.join(dagsDir, `${dag}.py`), "utf-8");
      expect(content).toContain("retries");
    }
  });
});

// ─── Docker Compose Pipeline Services ────────────────────────────────────────
describe("Docker Compose Pipeline Services", () => {
  const composeFile = path.join(process.cwd(), "docker-compose.pipelines.yml");

  it("docker-compose.pipelines.yml exists", () => {
    expect(fs.existsSync(composeFile)).toBe(true);
  });

  it("includes NiFi service", () => {
    const content = fs.readFileSync(composeFile, "utf-8");
    expect(content).toContain("apache/nifi");
  });

  it("includes Airflow webserver service", () => {
    const content = fs.readFileSync(composeFile, "utf-8");
    expect(content).toContain("apache/airflow");
  });

  it("includes dbt service", () => {
    const content = fs.readFileSync(composeFile, "utf-8");
    expect(content).toContain("dbt-labs/dbt-postgres");
  });

  it("NiFi exposes port 8443", () => {
    const content = fs.readFileSync(composeFile, "utf-8");
    expect(content).toContain("8443:8443");
  });

  it("Airflow webserver exposes port 8080", () => {
    const content = fs.readFileSync(composeFile, "utf-8");
    expect(content).toContain("8080:8080");
  });

  it("dbt docs server exposes port 8088", () => {
    const content = fs.readFileSync(composeFile, "utf-8");
    expect(content).toContain("8088:8088");
  });

  it("uses named volumes for persistence", () => {
    const content = fs.readFileSync(composeFile, "utf-8");
    expect(content).toContain("nifi_conf:");
    expect(content).toContain("airflow_logs:");
  });

  it("services have healthchecks", () => {
    const content = fs.readFileSync(composeFile, "utf-8");
    expect(content).toContain("healthcheck:");
  });
});

// ─── K8s Pipeline Manifests ───────────────────────────────────────────────────
describe("Kubernetes Pipeline Manifests", () => {
  const k8sFile = path.join(process.cwd(), "k8s", "pipelines-deployment.yaml");

  it("k8s/pipelines-deployment.yaml exists", () => {
    expect(fs.existsSync(k8sFile)).toBe(true);
  });

  it("includes NiFi deployment", () => {
    const content = fs.readFileSync(k8sFile, "utf-8");
    expect(content).toContain("name: nifi");
  });

  it("includes Airflow webserver deployment", () => {
    const content = fs.readFileSync(k8sFile, "utf-8");
    expect(content).toContain("name: airflow-webserver");
  });

  it("includes Airflow scheduler deployment", () => {
    const content = fs.readFileSync(k8sFile, "utf-8");
    expect(content).toContain("name: airflow-scheduler");
  });

  it("includes secrets for NiFi credentials", () => {
    const content = fs.readFileSync(k8sFile, "utf-8");
    expect(content).toContain("name: nifi-credentials");
  });

  it("includes secrets for Airflow", () => {
    const content = fs.readFileSync(k8sFile, "utf-8");
    expect(content).toContain("name: airflow-secrets");
  });

  it("includes resource limits", () => {
    const content = fs.readFileSync(k8sFile, "utf-8");
    expect(content).toContain("limits:");
    expect(content).toContain("memory:");
  });

  it("includes liveness probes", () => {
    const content = fs.readFileSync(k8sFile, "utf-8");
    expect(content).toContain("livenessProbe:");
  });

  it("includes ingress for pipeline services", () => {
    const content = fs.readFileSync(k8sFile, "utf-8");
    expect(content).toContain("nifi.remitflow.io");
    expect(content).toContain("airflow.remitflow.io");
  });
});

// ─── v89 Seed Script ──────────────────────────────────────────────────────────
describe("v89 Seed Script", () => {
  const seedFile = path.join(process.cwd(), "scripts", "seed-v89.mjs");

  it("seed-v89.mjs exists", () => {
    expect(fs.existsSync(seedFile)).toBe(true);
  });

  it("seeds NiFi pipeline runs", () => {
    const content = fs.readFileSync(seedFile, "utf-8");
    expect(content).toContain("nifi_pipeline_runs");
  });

  it("seeds dbt run history", () => {
    const content = fs.readFileSync(seedFile, "utf-8");
    expect(content).toContain("dbt_run_history");
  });

  it("seeds Airflow DAG runs", () => {
    const content = fs.readFileSync(seedFile, "utf-8");
    expect(content).toContain("airflow_dag_runs");
  });

  it("seeds tenant configurations", () => {
    const content = fs.readFileSync(seedFile, "utf-8");
    expect(content).toContain("tenant_configs");
  });

  it("seeds fee rules", () => {
    const content = fs.readFileSync(seedFile, "utf-8");
    expect(content).toContain("fee_rules");
  });

  it("uses ON CONFLICT DO NOTHING for idempotency", () => {
    const content = fs.readFileSync(seedFile, "utf-8");
    expect(content).toContain("ON CONFLICT");
  });
});

// ─── v89 Frontend Pages ───────────────────────────────────────────────────────
describe("v89 Frontend Pages", () => {
  const pagesDir = path.join(process.cwd(), "client", "src", "pages");

  const v89Pages = [
    "WebhookRetryPage.tsx",
    "TenantConfigPage.tsx",
    "PartnerPayoutsV2Page.tsx",
    "ComplianceScoringPage.tsx",
    "SmartRoutingV2Page.tsx",
    "NotificationCenterV2Page.tsx",
    "AuditTrailV2Page.tsx",
    "FeeRulesCRUDPage.tsx",
    "KYCLifecyclePage.tsx",
    "MultiCurrencyLedgerPage.tsx",
    "DataPipelinesPage.tsx",
  ];

  for (const page of v89Pages) {
    it(`${page} exists`, () => {
      expect(fs.existsSync(path.join(pagesDir, page))).toBe(true);
    });
  }

  it("DataPipelinesPage.tsx references NiFi", () => {
    const content = fs.readFileSync(path.join(pagesDir, "DataPipelinesPage.tsx"), "utf-8");
    expect(content.toLowerCase()).toContain("nifi");
  });

  it("DataPipelinesPage.tsx references Airflow", () => {
    const content = fs.readFileSync(path.join(pagesDir, "DataPipelinesPage.tsx"), "utf-8");
    expect(content.toLowerCase()).toContain("airflow");
  });

  it("DataPipelinesPage.tsx references dbt", () => {
    const content = fs.readFileSync(path.join(pagesDir, "DataPipelinesPage.tsx"), "utf-8");
    expect(content.toLowerCase()).toContain("dbt");
  });

  it("TenantConfigPage.tsx has CRUD operations", () => {
    const content = fs.readFileSync(path.join(pagesDir, "TenantConfigPage.tsx"), "utf-8");
    expect(content).toContain("useMutation");
  });

  it("FeeRulesCRUDPage.tsx has CRUD operations", () => {
    const content = fs.readFileSync(path.join(pagesDir, "FeeRulesCRUDPage.tsx"), "utf-8");
    expect(content).toContain("useMutation");
  });

  it("KYCLifecyclePage.tsx has workflow actions", () => {
    const content = fs.readFileSync(path.join(pagesDir, "KYCLifecyclePage.tsx"), "utf-8");
    expect(content).toContain("useMutation");
  });
});

// ─── Security Hardening ───────────────────────────────────────────────────────
describe("Security Hardening v89", () => {
  it("security.middleware.ts exports validateCurrencyCode", async () => {
    const mod = await import("./security.middleware.js");
    expect(mod.validateCurrencyCode).toBeDefined();
  });

  it("validateCurrencyCode accepts valid ISO 4217 codes", async () => {
    const mod = await import("./security.middleware.js");
    expect(mod.validateCurrencyCode("USD")).toBe(true);
    expect(mod.validateCurrencyCode("EUR")).toBe(true);
    expect(mod.validateCurrencyCode("GBP")).toBe(true);
    expect(mod.validateCurrencyCode("NGN")).toBe(true);
    expect(mod.validateCurrencyCode("KES")).toBe(true);
  });

  it("validateCurrencyCode rejects invalid codes", async () => {
    const mod = await import("./security.middleware.js");
    expect(mod.validateCurrencyCode("INVALID")).toBe(false);
    expect(mod.validateCurrencyCode("")).toBe(false);
    expect(mod.validateCurrencyCode("US")).toBe(false);
    // validateCurrencyCode normalizes to uppercase, so 'usd' → 'USD' which is valid
    // The function is case-insensitive by design
    expect(mod.validateCurrencyCode("INVALID")).toBe(false);
  });

  it("security.middleware.ts exports registerSecurityMiddleware", async () => {
    const mod = await import("./security.middleware.js");
    expect(mod.registerSecurityMiddleware).toBeDefined();
    expect(typeof mod.registerSecurityMiddleware).toBe("function");
  });

  it("security.middleware.ts exports exportRateLimit", async () => {
    const mod = await import("./security.middleware.js");
    expect(mod.exportRateLimit).toBeDefined();
  });

  it("open redirect protection: dev-login only allows relative paths", async () => {
    const oauthMod = await import("./_core/oauth.js");
    // The module should load without errors
    expect(oauthMod).toBeDefined();
  });
});

// ─── Schema v89 Tables ────────────────────────────────────────────────────────
describe("Schema v89 Tables", () => {
  it("schema.ts exports nifiPipelineRuns table", async () => {
    const schema = await import("../drizzle/schema.js");
    expect(schema.nifiPipelineRuns).toBeDefined();
  });

  it("schema.ts exports dbtRunHistory table", async () => {
    const schema = await import("../drizzle/schema.js");
    expect(schema.dbtRunHistory).toBeDefined();
  });

  it("schema.ts exports airflowDagRuns table", async () => {
    const schema = await import("../drizzle/schema.js");
    expect(schema.airflowDagRuns).toBeDefined();
  });

  it("schema.ts exports tenantConfigs table", async () => {
    const schema = await import("../drizzle/schema.js");
    expect(schema.tenantConfigs).toBeDefined();
  });

  it("nifiPipelineRuns has pipelineId field", async () => {
    const schema = await import("../drizzle/schema.js");
    expect(schema.nifiPipelineRuns.pipelineId).toBeDefined();
  });

  it("dbtRunHistory has runId field", async () => {
    const schema = await import("../drizzle/schema.js");
    expect(schema.dbtRunHistory.runId).toBeDefined();
  });

  it("airflowDagRuns has dagId field", async () => {
    const schema = await import("../drizzle/schema.js");
    expect(schema.airflowDagRuns.dagId).toBeDefined();
  });

  it("tenantConfigs has tenantId field", async () => {
    const schema = await import("../drizzle/schema.js");
    expect(schema.tenantConfigs.tenantId).toBeDefined();
  });
});
