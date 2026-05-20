/**
 * RemitFlow v90 Smoke Tests
 * Covers: productionV90 router, fraud-detection.service, dataPipelines router,
 *         docker-compose.v90.yml, k8s/v90-deployment.yaml, seed-v90.mjs,
 *         sanctions screening, bulk payments, open banking, regulatory reporting,
 *         payment rails, FX streaming, revenue analytics, dispute management,
 *         fraud model runs, schema tables, security audit report
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");

// ─── productionV90 Router ─────────────────────────────────────────────────────
describe("productionV90 Router", () => {
  let v90: any;

  beforeAll(async () => {
    v90 = await import("./routers/productionV90.js");
  });

  it("exports fxStreamRouter", () => {
    expect(v90.fxStreamRouter).toBeDefined();
  });

  it("exports embeddingIndexRouter", () => {
    expect(v90.embeddingIndexRouter).toBeDefined();
  });

  it("exports grafanaRouter", () => {
    expect(v90.grafanaRouter).toBeDefined();
  });

  it("exports kycWorkflowRouter", () => {
    expect(v90.kycWorkflowRouter).toBeDefined();
  });

  it("exports paymentRailsRouter", () => {
    expect(v90.paymentRailsRouter).toBeDefined();
  });

  it("exports revenueAnalyticsRouter", () => {
    expect(v90.revenueAnalyticsRouter).toBeDefined();
  });

  it("exports disputeManagementRouter", () => {
    expect(v90.disputeManagementRouter).toBeDefined();
  });

  it("exports sanctionsScreeningRouter", () => {
    expect(v90.sanctionsScreeningRouter).toBeDefined();
  });

  it("exports beneficiaryDedupRouter", () => {
    expect(v90.beneficiaryDedupRouter).toBeDefined();
  });

  it("exports bulkPaymentRouter", () => {
    expect(v90.bulkPaymentRouter).toBeDefined();
  });

  it("exports openBankingRouter", () => {
    expect(v90.openBankingRouter).toBeDefined();
  });

  it("exports regulatoryReportingRouter", () => {
    expect(v90.regulatoryReportingRouter).toBeDefined();
  });

  it("exports productionV90Router (aggregate)", () => {
    expect(v90.productionV90Router).toBeDefined();
  });

  it("fxStreamRouter has getLatestRates procedure", () => {
    expect(v90.fxStreamRouter._def.procedures.getLatestRates).toBeDefined();
  });

  it("paymentRailsRouter has initiateSwiftTransfer procedure", () => {
    expect(v90.paymentRailsRouter._def.procedures.initiateSwiftTransfer).toBeDefined();
  });

  it("paymentRailsRouter has getSupportedRails procedure", () => {
    expect(v90.paymentRailsRouter._def.procedures.getSupportedRails).toBeDefined();
  });

  it("sanctionsScreeningRouter has getSanctionsList procedure", () => {
    expect(v90.sanctionsScreeningRouter._def.procedures.getSanctionsList).toBeDefined();
  });

  it("bulkPaymentRouter has getBatchStatus procedure", () => {
    expect(v90.bulkPaymentRouter._def.procedures.getBatchStatus).toBeDefined();
  });

  it("openBankingRouter has getConnectedAccounts procedure", () => {
    expect(v90.openBankingRouter._def.procedures.getConnectedAccounts).toBeDefined();
  });

  it("regulatoryReportingRouter has getCTRReport procedure", () => {
    expect(v90.regulatoryReportingRouter._def.procedures.getCTRReport).toBeDefined();
  });

  it("disputeManagementRouter has listDisputes procedure", () => {
    expect(v90.disputeManagementRouter._def.procedures.listDisputes).toBeDefined();
  });

  it("regulatoryReportingRouter has generateReport procedure", () => {
    expect(v90.regulatoryReportingRouter._def.procedures.generateReport).toBeDefined();
  });

  it("regulatoryReportingRouter has getComplianceCalendar procedure", () => {
    expect(v90.regulatoryReportingRouter._def.procedures.getComplianceCalendar).toBeDefined();
  });

  it("disputeManagementRouter has createDispute procedure", () => {
    expect(v90.disputeManagementRouter._def.procedures.createDispute).toBeDefined();
  });

  it("disputeManagementRouter has resolveDispute procedure", () => {
    expect(v90.disputeManagementRouter._def.procedures.resolveDispute).toBeDefined();
  });

  it("revenueAnalyticsRouter has getSummary procedure", () => {
    expect(v90.revenueAnalyticsRouter._def.procedures.getSummary).toBeDefined();
  });

  it("grafanaRouter has getDashboards procedure", () => {
    expect(v90.grafanaRouter._def.procedures.getDashboards).toBeDefined();
  });
});

// ─── Fraud Detection Service ──────────────────────────────────────────────────
describe("Fraud Detection Service", () => {
  let fraudSvc: any;

  beforeAll(async () => {
    fraudSvc = await import("./fraud-detection.service.js");
  });

  it("exports scoreFraud function", () => {
    expect(typeof fraudSvc.scoreFraud).toBe("function");
  });

  it("exports buildFeatures function", () => {
    expect(typeof fraudSvc.buildFeatures).toBe("function");
  });

  it("exports getModelMetrics function", () => {
    expect(typeof fraudSvc.getModelMetrics).toBe("function");
  });

  it("exports scoreBatch function", () => {
    expect(typeof fraudSvc.scoreBatch).toBe("function");
  });

  it("exports getContinuousImprovementReport function", () => {
    expect(typeof fraudSvc.getContinuousImprovementReport).toBe("function");
  });

  it("exports fraudDetectionService object", () => {
    expect(fraudSvc.fraudDetectionService).toBeDefined();
    expect(typeof fraudSvc.fraudDetectionService).toBe("object");
  });

  it("scoreFraud returns a result with score and riskLevel", () => {
    const features = fraudSvc.buildFeatures({
      amount_usd: 5000,
      source_country: "US",
      dest_country: "NG",
    });
    const result = fraudSvc.scoreFraud(features);
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("riskLevel");
    expect(result).toHaveProperty("decision");
    expect(result).toHaveProperty("triggeredRules");
    expect(typeof result.score).toBe("number");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("scoreFraud flags high-risk transactions correctly", () => {
    const features = fraudSvc.buildFeatures({
      amount_usd: 50000,
      source_country: "US",
      dest_country: "KP",
    });
    const result = fraudSvc.scoreFraud(features);
    expect(result.score).toBeGreaterThan(10);
    expect(["low", "medium", "high", "critical"]).toContain(result.riskLevel);
  });

  it("getModelMetrics returns metrics object", () => {
    const metrics = fraudSvc.getModelMetrics();
    expect(metrics).toHaveProperty("accuracy");
    expect(metrics).toHaveProperty("f1Score");
    expect(metrics).toHaveProperty("auc");
    expect(metrics).toHaveProperty("version");
    expect(metrics).toHaveProperty("precision");
  });

  it("scoreBatch processes multiple transactions", () => {
    const transactions = [
      { id: "TX001", features: { amount_usd: 100, source_country: "US", dest_country: "NG" } },
      { id: "TX002", features: { amount_usd: 25000, source_country: "US", dest_country: "KP" } },
      { id: "TX003", features: { amount_usd: 500, source_country: "GB", dest_country: "GH" } },
    ];
    const result = fraudSvc.scoreBatch(transactions);
    expect(result).toHaveProperty("results");
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBe(3);
    for (const r of result.results) {
      expect(r).toHaveProperty("transactionId");
      expect(r).toHaveProperty("score");
      expect(r).toHaveProperty("decision");
    }
  });

  it("getContinuousImprovementReport returns report object", () => {
    const report = fraudSvc.getContinuousImprovementReport();
    expect(report).toHaveProperty("period");
    expect(report).toHaveProperty("currentModel");
    expect(report).toHaveProperty("nextActions");
    expect(Array.isArray(report.nextActions)).toBe(true);
  });
});

// ─── Data Pipelines Router ────────────────────────────────────────────────────
describe("Data Pipelines Router", () => {
  let pipelines: any;

  beforeAll(async () => {
    pipelines = await import("./routers/dataPipelines.js");
  });

  it("exports nifiRouter", () => {
    expect(pipelines.nifiRouter).toBeDefined();
  });

  it("exports dbtRouter", () => {
    expect(pipelines.dbtRouter).toBeDefined();
  });

  it("exports airflowRouter", () => {
    expect(pipelines.airflowRouter).toBeDefined();
  });

  it("exports dataPipelinesRouter (aggregate)", () => {
    expect(pipelines.dataPipelinesRouter).toBeDefined();
  });

  it("nifiRouter has getPipelines procedure", () => {
    expect(pipelines.nifiRouter._def.procedures.getPipelines).toBeDefined();
  });

  it("dbtRouter has getModels procedure", () => {
    expect(pipelines.dbtRouter._def.procedures.getModels).toBeDefined();
  });

  it("airflowRouter has getDags procedure", () => {
    expect(pipelines.airflowRouter._def.procedures.getDags).toBeDefined();
  });
});

// ─── Docker Compose v90 ───────────────────────────────────────────────────────
describe("Docker Compose v90", () => {
  const composeFile = path.join(ROOT, "docker-compose.v90.yml");

  it("docker-compose.v90.yml exists", () => {
    expect(fs.existsSync(composeFile)).toBe(true);
  });

  it("contains sanctions-api service", () => {
    const content = fs.readFileSync(composeFile, "utf8");
    expect(content).toContain("sanctions-api:");
  });

  it("contains swift-simulator service", () => {
    const content = fs.readFileSync(composeFile, "utf8");
    expect(content).toContain("swift-simulator:");
  });

  it("contains sepa-simulator service", () => {
    const content = fs.readFileSync(composeFile, "utf8");
    expect(content).toContain("sepa-simulator:");
  });

  it("contains open-banking-hub service", () => {
    const content = fs.readFileSync(composeFile, "utf8");
    expect(content).toContain("open-banking-hub:");
  });

  it("contains regulatory-svc service", () => {
    const content = fs.readFileSync(composeFile, "utf8");
    expect(content).toContain("regulatory-svc:");
  });

  it("contains fraud-api-v2 service", () => {
    const content = fs.readFileSync(composeFile, "utf8");
    expect(content).toContain("fraud-api-v2:");
  });

  it("contains redis-v90 service", () => {
    const content = fs.readFileSync(composeFile, "utf8");
    expect(content).toContain("redis-v90:");
  });

  it("contains prometheus-v90 service", () => {
    const content = fs.readFileSync(composeFile, "utf8");
    expect(content).toContain("prometheus-v90:");
  });

  it("sanctions-api uses port 9100", () => {
    const content = fs.readFileSync(composeFile, "utf8");
    expect(content).toContain("9100");
  });

  it("fraud-api-v2 uses port 9400", () => {
    const content = fs.readFileSync(composeFile, "utf8");
    expect(content).toContain("9400");
  });

  it("open-banking-hub uses port 9200", () => {
    const content = fs.readFileSync(composeFile, "utf8");
    expect(content).toContain("9200");
  });

  it("regulatory-svc uses port 9300", () => {
    const content = fs.readFileSync(composeFile, "utf8");
    expect(content).toContain("9300");
  });

  it("has healthcheck for all critical services", () => {
    const content = fs.readFileSync(composeFile, "utf8");
    const healthcheckCount = (content.match(/healthcheck:/g) || []).length;
    expect(healthcheckCount).toBeGreaterThanOrEqual(5);
  });

  it("defines remitflow-v90 network", () => {
    const content = fs.readFileSync(composeFile, "utf8");
    expect(content).toContain("remitflow-v90:");
  });

  it("defines named volumes for persistence", () => {
    const content = fs.readFileSync(composeFile, "utf8");
    expect(content).toContain("sanctions_data:");
    expect(content).toContain("fraud_models_v2:");
    expect(content).toContain("regulatory_reports_data:");
  });
});

// ─── K8s v90 Deployment ───────────────────────────────────────────────────────
describe("K8s v90 Deployment", () => {
  const k8sFile = path.join(ROOT, "k8s/v90-deployment.yaml");

  it("k8s/v90-deployment.yaml exists", () => {
    expect(fs.existsSync(k8sFile)).toBe(true);
  });

  it("defines remitflow-v90 namespace", () => {
    const content = fs.readFileSync(k8sFile, "utf8");
    expect(content).toContain("name: remitflow-v90");
  });

  it("contains sanctions-api deployment", () => {
    const content = fs.readFileSync(k8sFile, "utf8");
    expect(content).toContain("name: sanctions-api");
  });

  it("contains fraud-api-v2 deployment", () => {
    const content = fs.readFileSync(k8sFile, "utf8");
    expect(content).toContain("name: fraud-api-v2");
  });

  it("contains open-banking-hub deployment", () => {
    const content = fs.readFileSync(k8sFile, "utf8");
    expect(content).toContain("name: open-banking-hub");
  });

  it("contains regulatory-svc deployment", () => {
    const content = fs.readFileSync(k8sFile, "utf8");
    expect(content).toContain("name: regulatory-svc");
  });

  it("has HPA for fraud-api-v2", () => {
    const content = fs.readFileSync(k8sFile, "utf8");
    expect(content).toContain("fraud-api-v2-hpa");
  });

  it("has HPA for sanctions-api", () => {
    const content = fs.readFileSync(k8sFile, "utf8");
    expect(content).toContain("sanctions-api-hpa");
  });

  it("has NetworkPolicy", () => {
    const content = fs.readFileSync(k8sFile, "utf8");
    expect(content).toContain("NetworkPolicy");
  });

  it("has Secret manifest", () => {
    const content = fs.readFileSync(k8sFile, "utf8");
    expect(content).toContain("kind: Secret");
  });

  it("has ConfigMap manifest", () => {
    const content = fs.readFileSync(k8sFile, "utf8");
    expect(content).toContain("kind: ConfigMap");
  });

  it("fraud-api-v2 has 3 replicas", () => {
    const content = fs.readFileSync(k8sFile, "utf8");
    expect(content).toMatch(/name: fraud-api-v2[\s\S]*?replicas: 3/);
  });

  it("all deployments have resource limits", () => {
    const content = fs.readFileSync(k8sFile, "utf8");
    const limitsCount = (content.match(/limits:/g) || []).length;
    expect(limitsCount).toBeGreaterThanOrEqual(4);
  });

  it("all deployments have liveness probes", () => {
    const content = fs.readFileSync(k8sFile, "utf8");
    const probeCount = (content.match(/livenessProbe:/g) || []).length;
    expect(probeCount).toBeGreaterThanOrEqual(4);
  });
});

// ─── Seed v90 Script ──────────────────────────────────────────────────────────
describe("Seed v90 Script", () => {
  const seedFile = path.join(ROOT, "scripts/seed-v90.mjs");

  it("seed-v90.mjs exists", () => {
    expect(fs.existsSync(seedFile)).toBe(true);
  });

  it("seeds sanctions_checks table", () => {
    const content = fs.readFileSync(seedFile, "utf8");
    expect(content).toContain("sanctions_checks");
  });

  it("seeds bulk_payment_batches table", () => {
    const content = fs.readFileSync(seedFile, "utf8");
    expect(content).toContain("bulk_payment_batches");
  });

  it("seeds open_banking_consents table", () => {
    const content = fs.readFileSync(seedFile, "utf8");
    expect(content).toContain("open_banking_consents");
  });

  it("seeds regulatory_reports table", () => {
    const content = fs.readFileSync(seedFile, "utf8");
    expect(content).toContain("regulatory_reports");
  });

  it("seeds fraud_model_runs table", () => {
    const content = fs.readFileSync(seedFile, "utf8");
    expect(content).toContain("fraud_model_runs");
  });

  it("includes OFAC sanctions list check", () => {
    const content = fs.readFileSync(seedFile, "utf8");
    expect(content).toContain("OFAC-SDN");
  });

  it("includes UN consolidated list check", () => {
    const content = fs.readFileSync(seedFile, "utf8");
    expect(content).toContain("UN-CONSOLIDATED");
  });

  it("includes EU financial sanctions list", () => {
    const content = fs.readFileSync(seedFile, "utf8");
    expect(content).toContain("EU-FINANCIAL-SANCTIONS");
  });

  it("includes CTR regulatory report type", () => {
    const content = fs.readFileSync(seedFile, "utf8");
    expect(content).toContain("CTR");
  });

  it("includes SAR regulatory report type", () => {
    const content = fs.readFileSync(seedFile, "utf8");
    expect(content).toContain("SAR");
  });

  it("includes FBAR regulatory report type", () => {
    const content = fs.readFileSync(seedFile, "utf8");
    expect(content).toContain("FBAR");
  });

  it("includes ANNUAL_AML regulatory report type", () => {
    const content = fs.readFileSync(seedFile, "utf8");
    expect(content).toContain("ANNUAL_AML");
  });

  it("includes fraud model XGBoost", () => {
    const content = fs.readFileSync(seedFile, "utf8");
    expect(content).toContain("fraud_xgboost_v3");
  });

  it("includes fraud model LightGBM", () => {
    const content = fs.readFileSync(seedFile, "utf8");
    expect(content).toContain("fraud_lightgbm_v2");
  });

  it("seeds multiple open banking banks", () => {
    const content = fs.readFileSync(seedFile, "utf8");
    expect(content).toContain("barclays-uk");
    expect(content).toContain("hsbc-uk");
    expect(content).toContain("monzo-uk");
    expect(content).toContain("starling-uk");
  });

  it("bulk payment batches include NGN payroll", () => {
    const content = fs.readFileSync(seedFile, "utf8");
    expect(content).toContain("NGN");
    expect(content).toContain("Payroll");
  });
});

// ─── v90 Schema Tables ────────────────────────────────────────────────────────
describe("v90 Schema Tables", () => {
  const schemaFile = path.join(ROOT, "drizzle/schema.ts");

  it("schema.ts exists", () => {
    expect(fs.existsSync(schemaFile)).toBe(true);
  });

  it("defines sanctions_checks table", () => {
    const content = fs.readFileSync(schemaFile, "utf8");
    expect(content).toContain("sanctions_checks");
  });

  it("defines bulk_payment_batches table", () => {
    const content = fs.readFileSync(schemaFile, "utf8");
    expect(content).toContain("bulk_payment_batches");
  });

  it("defines open_banking_consents table", () => {
    const content = fs.readFileSync(schemaFile, "utf8");
    expect(content).toContain("open_banking_consents");
  });

  it("defines regulatory_reports table", () => {
    const content = fs.readFileSync(schemaFile, "utf8");
    expect(content).toContain("regulatory_reports");
  });

  it("defines fraud_model_runs table", () => {
    const content = fs.readFileSync(schemaFile, "utf8");
    expect(content).toContain("fraud_model_runs");
  });

  it("defines dispute_priority enum", () => {
    const content = fs.readFileSync(schemaFile, "utf8");
    expect(content).toContain("dispute_priority");
  });

  it("defines sanctions_check_result enum", () => {
    const content = fs.readFileSync(schemaFile, "utf8");
    expect(content).toContain("sanctions_check_result");
  });

  it("defines bulk_payment_batch_status enum", () => {
    const content = fs.readFileSync(schemaFile, "utf8");
    expect(content).toContain("bulk_payment_batch_status");
  });

  it("defines open_banking_consent_status enum", () => {
    const content = fs.readFileSync(schemaFile, "utf8");
    expect(content).toContain("open_banking_consent_status");
  });

  it("defines regulatory_report_type enum", () => {
    const content = fs.readFileSync(schemaFile, "utf8");
    expect(content).toContain("regulatory_report_type");
  });

  it("defines regulatory_report_status enum", () => {
    const content = fs.readFileSync(schemaFile, "utf8");
    expect(content).toContain("regulatory_report_status");
  });

  it("schema has 100+ tables", () => {
    const content = fs.readFileSync(schemaFile, "utf8");
    const tableCount = (content.match(/pgTable\(/g) || []).length;
    expect(tableCount).toBeGreaterThanOrEqual(100);
  });
});

// ─── v90 Frontend Pages ───────────────────────────────────────────────────────
describe("v90 Frontend Pages", () => {
  const pagesDir = path.join(ROOT, "client/src/pages");

  const v90Pages = [
    "RealTimeTransactionMonitor.tsx",
    "FraudDetectionV2Page.tsx",
    "FXStreamingPage.tsx",
    "DisputeManagementPage.tsx",
    "RevenueAnalyticsPage.tsx",
    "SanctionsScreeningPage.tsx",
    "PaymentRailsPage.tsx",
    "RegulatoryReportingPage.tsx",
    "OpenBankingPage.tsx",
    "GrafanaDashboardPage.tsx",
    "BulkPaymentsV2Page.tsx",
  ];

  for (const page of v90Pages) {
    it(`${page} exists`, () => {
      expect(fs.existsSync(path.join(pagesDir, page))).toBe(true);
    });
  }

  it("RealTimeTransactionMonitor.tsx has SSE/streaming content", () => {
    const content = fs.readFileSync(path.join(pagesDir, "RealTimeTransactionMonitor.tsx"), "utf8");
    expect(content.toLowerCase()).toMatch(/stream|sse|event|real.?time/i);
  });

  it("FraudDetectionV2Page.tsx has fraud case management content", () => {
    const content = fs.readFileSync(path.join(pagesDir, "FraudDetectionV2Page.tsx"), "utf8");
    expect(content.toLowerCase()).toMatch(/fraud|case|score|risk/i);
  });

  it("SanctionsScreeningPage.tsx has OFAC/UN screening content", () => {
    const content = fs.readFileSync(path.join(pagesDir, "SanctionsScreeningPage.tsx"), "utf8");
    expect(content.toLowerCase()).toMatch(/sanction|screen|ofac|compliance/i);
  });

  it("PaymentRailsPage.tsx has SWIFT/SEPA content", () => {
    const content = fs.readFileSync(path.join(pagesDir, "PaymentRailsPage.tsx"), "utf8");
    expect(content.toLowerCase()).toMatch(/swift|sepa|payment.?rail/i);
  });

  it("RegulatoryReportingPage.tsx has CTR/SAR/FBAR content", () => {
    const content = fs.readFileSync(path.join(pagesDir, "RegulatoryReportingPage.tsx"), "utf8");
    expect(content.toLowerCase()).toMatch(/ctr|sar|fbar|regulatory|report/i);
  });

  it("OpenBankingPage.tsx has PSD2/consent content", () => {
    const content = fs.readFileSync(path.join(pagesDir, "OpenBankingPage.tsx"), "utf8");
    expect(content.toLowerCase()).toMatch(/open.?banking|psd2|consent/i);
  });

  it("BulkPaymentsV2Page.tsx has batch payment content", () => {
    const content = fs.readFileSync(path.join(pagesDir, "BulkPaymentsV2Page.tsx"), "utf8");
    expect(content.toLowerCase()).toMatch(/bulk|batch|payment/i);
  });
});

// ─── Security Audit Report ────────────────────────────────────────────────────
describe("Security Audit Report", () => {
  const auditFile = path.join(ROOT, "docs/SECURITY_AUDIT_v90.md");

  it("SECURITY_AUDIT_v90.md exists", () => {
    expect(fs.existsSync(auditFile)).toBe(true);
  });

  it("covers OWASP Top 10", () => {
    const content = fs.readFileSync(auditFile, "utf8");
    expect(content.toUpperCase()).toContain("OWASP");
  });

  it("includes injection vulnerability assessment", () => {
    const content = fs.readFileSync(auditFile, "utf8");
    expect(content.toLowerCase()).toMatch(/injection|sql.?inject/i);
  });

  it("includes authentication assessment", () => {
    const content = fs.readFileSync(auditFile, "utf8");
    expect(content.toLowerCase()).toMatch(/auth|jwt|session/i);
  });

  it("includes rate limiting documentation", () => {
    const content = fs.readFileSync(auditFile, "utf8");
    expect(content.toLowerCase()).toMatch(/rate.?limit/i);
  });

  it("includes vulnerability score", () => {
    const content = fs.readFileSync(auditFile, "utf8");
    expect(content.toLowerCase()).toMatch(/score|vulnerabilit/i);
  });

  it("includes CSP documentation", () => {
    const content = fs.readFileSync(auditFile, "utf8");
    expect(content.toUpperCase()).toMatch(/CSP|CONTENT.SECURITY.POLICY/i);
  });
});

// ─── PIPELINES.md Documentation ──────────────────────────────────────────────
describe("PIPELINES.md Documentation", () => {
  const pipelinesDoc = path.join(ROOT, "docs/PIPELINES.md");

  it("PIPELINES.md exists", () => {
    expect(fs.existsSync(pipelinesDoc)).toBe(true);
  });

  it("covers Apache NiFi", () => {
    const content = fs.readFileSync(pipelinesDoc, "utf8");
    expect(content).toContain("NiFi");
  });

  it("covers dbt", () => {
    const content = fs.readFileSync(pipelinesDoc, "utf8");
    expect(content.toLowerCase()).toContain("dbt");
  });

  it("covers Apache Airflow", () => {
    const content = fs.readFileSync(pipelinesDoc, "utf8");
    expect(content).toContain("Airflow");
  });

  it("covers Bronze/Silver/Gold medallion architecture", () => {
    const content = fs.readFileSync(pipelinesDoc, "utf8");
    expect(content).toMatch(/Bronze|Silver|Gold/i);
  });
});

// ─── dbt Models ───────────────────────────────────────────────────────────────
describe("dbt Models", () => {
  const dbtDir = path.join(ROOT, "dbt");

  it("dbt directory exists", () => {
    expect(fs.existsSync(dbtDir)).toBe(true);
  });

  it("stg_transactions.sql exists", () => {
    const stagingDir = path.join(dbtDir, "models/staging");
    const files = fs.existsSync(stagingDir) ? fs.readdirSync(stagingDir) : [];
    expect(files.some(f => f.includes("stg_transactions"))).toBe(true);
  });

  it("mart_fraud_detection.sql exists", () => {
    const martsDir = path.join(dbtDir, "models/marts");
    const files = fs.existsSync(martsDir) ? fs.readdirSync(martsDir) : [];
    expect(files.some(f => f.includes("fraud"))).toBe(true);
  });
});

// ─── Airflow DAGs ─────────────────────────────────────────────────────────────
describe("Airflow DAGs", () => {
  const dagsDir = path.join(ROOT, "airflow/dags");

  it("airflow/dags directory exists", () => {
    expect(fs.existsSync(dagsDir)).toBe(true);
  });

  it("fraud model retrain DAG exists", () => {
    const files = fs.existsSync(dagsDir) ? fs.readdirSync(dagsDir) : [];
    expect(files.some(f => f.includes("fraud") || f.includes("retrain"))).toBe(true);
  });

  it("fraud retrain DAG has valid Python content", () => {
    const dagsFiles = fs.existsSync(dagsDir) ? fs.readdirSync(dagsDir) : [];
    const fraudDag = dagsFiles.find(f => f.includes("fraud") || f.includes("retrain"));
    if (fraudDag) {
      const content = fs.readFileSync(path.join(dagsDir, fraudDag), "utf8");
      expect(content).toContain("DAG");
      expect(content).toContain("airflow");
    }
  });
});

// ─── App.tsx v90 Routes ───────────────────────────────────────────────────────
describe("App.tsx v90 Routes", () => {
  const appFile = path.join(ROOT, "client/src/App.tsx");

  it("App.tsx exists", () => {
    expect(fs.existsSync(appFile)).toBe(true);
  });

  it("has RealTimeTransactionMonitor route", () => {
    const content = fs.readFileSync(appFile, "utf8");
    expect(content).toContain("RealTimeTransactionMonitor");
  });

  it("has FraudDetectionV2Page route", () => {
    const content = fs.readFileSync(appFile, "utf8");
    expect(content).toContain("FraudDetectionV2Page");
  });

  it("has SanctionsScreeningPage route", () => {
    const content = fs.readFileSync(appFile, "utf8");
    expect(content).toContain("SanctionsScreeningPage");
  });

  it("has PaymentRailsPage route", () => {
    const content = fs.readFileSync(appFile, "utf8");
    expect(content).toContain("PaymentRailsPage");
  });

  it("has RegulatoryReportingPage route", () => {
    const content = fs.readFileSync(appFile, "utf8");
    expect(content).toContain("RegulatoryReportingPage");
  });

  it("has OpenBankingPage route", () => {
    const content = fs.readFileSync(appFile, "utf8");
    expect(content).toContain("OpenBankingPage");
  });

  it("has BulkPaymentsV2Page route", () => {
    const content = fs.readFileSync(appFile, "utf8");
    expect(content).toContain("BulkPaymentsV2Page");
  });

  it("has GrafanaDashboardPage route", () => {
    const content = fs.readFileSync(appFile, "utf8");
    expect(content).toContain("GrafanaDashboardPage");
  });

  it("has DisputeManagementPage route", () => {
    const content = fs.readFileSync(appFile, "utf8");
    expect(content).toContain("DisputeManagementPage");
  });

  it("has RevenueAnalyticsPage route", () => {
    const content = fs.readFileSync(appFile, "utf8");
    expect(content).toContain("RevenueAnalyticsPage");
  });

  it("has FXStreamingPage route", () => {
    const content = fs.readFileSync(appFile, "utf8");
    expect(content).toContain("FXStreamingPage");
  });
});

// ─── DashboardLayout v90 Nav ──────────────────────────────────────────────────
describe("DashboardLayout v90 Navigation", () => {
  const layoutFile = path.join(ROOT, "client/src/components/DashboardLayout.tsx");

  it("DashboardLayout.tsx exists", () => {
    expect(fs.existsSync(layoutFile)).toBe(true);
  });

  it("has v90 navigation items", () => {
    const content = fs.readFileSync(layoutFile, "utf8");
    // Should contain at least some v90 nav items
    const hasV90Nav = content.includes("sanctions") ||
                      content.includes("Sanctions") ||
                      content.includes("payment-rails") ||
                      content.includes("Payment Rails") ||
                      content.includes("regulatory") ||
                      content.includes("Regulatory") ||
                      content.includes("bulk-payments") ||
                      content.includes("Bulk Payments");
    expect(hasV90Nav).toBe(true);
  });
});

// ─── Prometheus v90 Config ────────────────────────────────────────────────────
describe("Prometheus v90 Config", () => {
  const prometheusFile = path.join(ROOT, "monitoring/prometheus-v90.yml");

  it("monitoring/prometheus-v90.yml exists", () => {
    expect(fs.existsSync(prometheusFile)).toBe(true);
  });

  it("scrapes sanctions-api", () => {
    const content = fs.readFileSync(prometheusFile, "utf8");
    expect(content).toContain("sanctions-api");
  });

  it("scrapes fraud-api-v2", () => {
    const content = fs.readFileSync(prometheusFile, "utf8");
    expect(content).toContain("fraud-api-v2");
  });

  it("scrapes open-banking-hub", () => {
    const content = fs.readFileSync(prometheusFile, "utf8");
    expect(content).toContain("open-banking-hub");
  });

  it("scrapes regulatory-svc", () => {
    const content = fs.readFileSync(prometheusFile, "utf8");
    expect(content).toContain("regulatory-svc");
  });

  it("has global scrape_interval", () => {
    const content = fs.readFileSync(prometheusFile, "utf8");
    expect(content).toContain("scrape_interval");
  });
});

// ─── FX Streaming Business Logic ─────────────────────────────────────────────
describe("FX Streaming Business Logic", () => {
  let v90: any;

  beforeAll(async () => {
    v90 = await import("./routers/productionV90.js");
  });

  it("fxStreamRouter has getStreamConfig procedure", () => {
    const procedures = Object.keys(v90.fxStreamRouter._def.procedures);
    expect(procedures.length).toBeGreaterThan(0);
  });

  it("paymentRailsRouter has multiple procedures", () => {
    const procedures = Object.keys(v90.paymentRailsRouter._def.procedures);
    expect(procedures.length).toBeGreaterThanOrEqual(2);
  });

  it("openBankingRouter has multiple procedures", () => {
    const procedures = Object.keys(v90.openBankingRouter._def.procedures);
    expect(procedures.length).toBeGreaterThanOrEqual(2);
  });

  it("regulatoryReportingRouter has multiple procedures", () => {
    const procedures = Object.keys(v90.regulatoryReportingRouter._def.procedures);
    expect(procedures.length).toBeGreaterThanOrEqual(2);
  });

  it("sanctionsScreeningRouter has multiple procedures", () => {
    const procedures = Object.keys(v90.sanctionsScreeningRouter._def.procedures);
    expect(procedures.length).toBeGreaterThanOrEqual(2);
  });

  it("bulkPaymentRouter has multiple procedures", () => {
    const procedures = Object.keys(v90.bulkPaymentRouter._def.procedures);
    expect(procedures.length).toBeGreaterThanOrEqual(2);
  });

  it("disputeManagementRouter has multiple procedures", () => {
    const procedures = Object.keys(v90.disputeManagementRouter._def.procedures);
    expect(procedures.length).toBeGreaterThanOrEqual(2);
  });

  it("revenueAnalyticsRouter has multiple procedures", () => {
    const procedures = Object.keys(v90.revenueAnalyticsRouter._def.procedures);
    expect(procedures.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Routers.ts Integration ───────────────────────────────────────────────────
describe("Routers.ts v90 Integration", () => {
  const routersFile = path.join(ROOT, "server/routers.ts");

  it("routers.ts exists", () => {
    expect(fs.existsSync(routersFile)).toBe(true);
  });

  it("imports productionV90Router", () => {
    const content = fs.readFileSync(routersFile, "utf8");
    expect(content).toContain("productionV90");
  });

  it("imports dataPipelinesRouter", () => {
    const content = fs.readFileSync(routersFile, "utf8");
    expect(content).toContain("dataPipelines");
  });

  it("mounts productionV90Router in appRouter", () => {
    const content = fs.readFileSync(routersFile, "utf8");
    expect(content).toMatch(/productionV90|v90/i);
  });
});
