/**
 * RemitFlow v89 Comprehensive Seed Script
 * Seeds: NiFi pipeline runs, dbt run history, Airflow DAG runs,
 *        Tenant configs, Fee rules
 * 
 * Usage: node scripts/seed-v89.mjs
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const DB_URL = process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL;
if (!DB_URL) {
  console.error("❌ DATABASE_URL not set");
  process.exit(1);
}

const { Pool } = require("pg");
const pool = new Pool({
  connectionString: DB_URL,
  ssl: DB_URL.includes("localhost") || DB_URL.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
});

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];
const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString();

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function seedNifiPipelineRuns() {
  console.log("🔧 Seeding NiFi pipeline runs...");
  const pipelines = [
    ["remitflow-tx-ingest", "Transaction Ingestion Pipeline"],
    ["remitflow-fx-sync", "FX Rate Synchronisation"],
    ["remitflow-compliance", "Compliance Data Router"],
    ["remitflow-partner-recon", "Partner Reconciliation Pipeline"],
    ["remitflow-lakehouse-etl", "Lakehouse ETL Pipeline"],
    ["remitflow-kyc-ingest", "KYC Document Ingestion"],
    ["remitflow-fraud-feed", "Fraud Signal Feed"],
  ];
  const statuses = ["success", "success", "success", "failed", "running"];
  const errors = [
    "Connection timeout to upstream source",
    "Schema validation error: missing required field 'amount'",
    "Downstream sink unavailable — retry scheduled",
    "Rate limit exceeded on FX provider API",
  ];

  let count = 0;
  for (let i = 0; i < 50; i++) {
    const [pid, pname] = pick(pipelines);
    const status = pick(statuses);
    const startedAt = hoursAgo(rand(1, 168));
    const durationMs = rand(500, 45000);
    const completedAt = status !== "running" ? new Date(new Date(startedAt).getTime() + durationMs).toISOString() : null;
    await query(
      `INSERT INTO nifi_pipeline_runs (pipeline_id, pipeline_name, status, started_at, completed_at, duration_ms, records_processed, error_message, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [pid, pname, status, startedAt, completedAt, status !== "running" ? durationMs : null,
       status === "success" ? rand(100, 50000) : 0,
       status === "failed" ? pick(errors) : null,
       JSON.stringify({ triggeredBy: "scheduler", environment: "production" })]
    );
    count++;
  }
  console.log(`  ✓ Inserted ${count} NiFi pipeline runs`);
}

async function seedDbtRunHistory() {
  console.log("🔧 Seeding dbt run history...");
  const statuses = ["success", "success", "success", "failed"];
  let count = 0;
  for (let i = 0; i < 30; i++) {
    const status = pick(statuses);
    const startedAt = hoursAgo(rand(1, 240));
    const durationMs = rand(15000, 180000);
    const modelsRun = rand(3, 10);
    await query(
      `INSERT INTO dbt_run_history (run_id, model_select, status, started_at, completed_at, duration_ms, models_run, models_error, error_message, results)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [`dbt-run-${Date.now()}-${i}`,
       i % 5 === 0 ? "tag:marts" : i % 3 === 0 ? "tag:staging" : null,
       status, startedAt,
       status !== "running" ? new Date(new Date(startedAt).getTime() + durationMs).toISOString() : null,
       status !== "running" ? durationMs : null,
       modelsRun, status === "failed" ? rand(1, 2) : 0,
       status === "failed" ? "Compilation error in mart_fraud_signals: undefined ref 'stg_fraud_events'" : null,
       JSON.stringify({ modelsRun })]
    );
    count++;
  }
  console.log(`  ✓ Inserted ${count} dbt run history records`);
}

async function seedAirflowDagRuns() {
  console.log("🔧 Seeding Airflow DAG runs...");
  const dags = [
    "remitflow_daily_etl", "remitflow_kyc_workflow", "remitflow_compliance_report",
    "remitflow_fraud_model_retrain", "remitflow_partner_settlement",
    "remitflow_treasury_rebalance", "remitflow_fx_rate_update",
  ];
  const statuses = ["success", "success", "success", "failed", "running"];
  const errors = [
    "Task 'extract_transactions' failed: DB connection pool exhausted",
    "Task 'load_to_warehouse' failed: S3 write timeout",
    "Task 'send_compliance_report' failed: SMTP authentication error",
  ];
  let count = 0;
  for (let i = 0; i < 40; i++) {
    const dagId = pick(dags);
    const status = pick(statuses);
    const startedAt = hoursAgo(rand(1, 336));
    const durationMs = rand(30000, 600000);
    await query(
      `INSERT INTO airflow_dag_runs (dag_id, run_id, status, conf, started_at, completed_at, duration_ms, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [dagId, `manual__${startedAt}`, status,
       dagId === "remitflow_daily_etl" ? JSON.stringify({ date: startedAt.split("T")[0] }) : null,
       startedAt,
       status !== "running" ? new Date(new Date(startedAt).getTime() + durationMs).toISOString() : null,
       status !== "running" ? durationMs : null,
       status === "failed" ? pick(errors) : null]
    );
    count++;
  }
  console.log(`  ✓ Inserted ${count} Airflow DAG runs`);
}

async function seedTenantConfigs() {
  console.log("🔧 Seeding tenant configurations...");
  const tenants = [
    ["remitflow-default", "RemitFlow Default", "#6366f1", "#8b5cf6", "support@remitflow.io", "+1-800-REMIT-01", "USD", '["USD","EUR","GBP","NGN","KES","GHS","ZAR","XOF"]', "50000", true, false, "https://api.remitflow.io/webhooks/default", "whsec_remitflow_default_2024_prod"],
    ["afriremit-ng", "AfriRemit Nigeria", "#008751", "#009A44", "support@afriremit.ng", "+234-800-AFRI-01", "NGN", '["NGN","USD","GBP","EUR"]', "25000000", true, true, "https://api.afriremit.ng/webhooks", "whsec_afriremit_ng_2024_prod"],
    ["diaspora-pay-ke", "DiasporaPay Kenya", "#006600", "#BB0000", "support@diasporapay.ke", "+254-800-DIASP-01", "KES", '["KES","USD","GBP","EUR","TZS","UGX"]', "5000000", true, false, "https://api.diasporapay.ke/webhooks", "whsec_diasporapay_ke_2024_prod"],
    ["sendwave-gh", "SendWave Ghana", "#FCD116", "#006B3F", "support@sendwave.gh", "+233-800-SEND-01", "GHS", '["GHS","USD","EUR","GBP"]', "100000", true, false, "https://api.sendwave.gh/webhooks", "whsec_sendwave_gh_2024_prod"],
    ["euroremit-eu", "EuroRemit EU", "#003399", "#FFCC00", "support@euroremit.eu", "+44-800-EURO-01", "EUR", '["EUR","GBP","USD","NGN","KES","GHS","XOF","MAD"]', "100000", true, true, "https://api.euroremit.eu/webhooks", "whsec_euroremit_eu_2024_prod"],
  ];
  let count = 0;
  for (const t of tenants) {
    await query(
      `INSERT INTO tenant_configs (tenant_id, tenant_name, primary_color, secondary_color, support_email, support_phone, default_currency, allowed_currencies, max_transfer_limit, kyc_required, mfa_required, webhook_url, webhook_secret, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
       ON CONFLICT (tenant_id) DO NOTHING`,
      t
    );
    count++;
  }
  console.log(`  ✓ Upserted ${count} tenant configurations`);
}

async function seedFeeRules() {
  console.log("🔧 Seeding fee rules...");
  const existing = await query("SELECT COUNT(*) FROM fee_rules");
  if (parseInt(existing.rows[0].count) > 0) {
    console.log("  ⏭ Fee rules already seeded, skipping");
    return;
  }
  const corridors = [
    ["GBP", "NGN", 1.5], ["USD", "NGN", 1.8], ["EUR", "NGN", 1.6],
    ["GBP", "KES", 1.7], ["USD", "KES", 2.0], ["GBP", "GHS", 1.9],
    ["USD", "GHS", 2.1], ["EUR", "XOF", 1.4], ["USD", "ZAR", 2.2], ["GBP", "ZAR", 1.8],
  ];
  let count = 0;
  for (const [from, to, fee] of corridors) {
    await query(
      `INSERT INTO fee_rules (name, from_currency, to_currency, fee_type, fee_value, min_fee, max_fee, min_amount, max_amount, is_active, priority, description)
       VALUES ($1,$2,$3,'percentage',$4,$5,$6,'1.00','50000.00',true,1,$7)`,
      [`Standard ${from}→${to} Fee`, from, to, fee.toFixed(2), (0.5 + Math.random()).toFixed(2), (25 + Math.random() * 25).toFixed(2), `Standard fee rule for ${from} to ${to} corridor`]
    );
    count++;
  }
  console.log(`  ✓ Inserted ${count} fee rules`);
}

async function main() {
  console.log("\n🚀 RemitFlow v89 Seed Script Starting...\n");
  try {
    await seedNifiPipelineRuns();
    await seedDbtRunHistory();
    await seedAirflowDagRuns();
    await seedTenantConfigs();
    await seedFeeRules();
    console.log("\n✅ v89 seed complete!");
    console.log("  • NiFi pipeline runs: 50 records");
    console.log("  • dbt run history: 30 records");
    console.log("  • Airflow DAG runs: 40 records");
    console.log("  • Tenant configurations: 5 records");
    console.log("  • Fee rules: 10 corridor rules\n");
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}
main();
