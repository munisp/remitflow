/**
 * seed-v90.mjs — RemitFlow v90 Seed Data
 * Seeds: sanctions_checks, bulk_payment_batches, open_banking_consents,
 *        regulatory_reports, fraud_model_runs
 *
 * Usage: DATABASE_URL=$LOCAL_DATABASE_URL node scripts/seed-v90.mjs
 */

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function getFirstUserId() {
  const res = await pool.query("SELECT id FROM users ORDER BY id LIMIT 1");
  if (res.rows.length === 0) throw new Error("No users found — run seed-v89 first");
  return res.rows[0].id;
}

async function seedSanctionsChecks(userId) {
  console.log("Seeding sanctions_checks...");
  const checks = [
    {
      screening_id: "SCR-OFAC-001",
      user_id: userId,
      entity_name: "John Smith",
      entity_type: "individual",
      result: "clear",
      risk_level: "low",
      lists_checked: ["OFAC-SDN", "UN-CONSOLIDATED", "EU-FINANCIAL-SANCTIONS"],
      match_details: null,
    },
    {
      screening_id: "SCR-OFAC-002",
      user_id: userId,
      entity_name: "Acme Trading LLC",
      entity_type: "organization",
      result: "hit",
      risk_level: "critical",
      lists_checked: ["OFAC-SDN", "UN-CONSOLIDATED"],
      match_details: JSON.stringify({ matchScore: 0.97, matchedList: "OFAC-SDN", matchedEntry: "ACME TRADING CO", reason: "Name similarity > 95%" }),
    },
    {
      screening_id: "SCR-EU-003",
      user_id: userId,
      entity_name: "Maria Gonzalez",
      entity_type: "individual",
      result: "clear",
      risk_level: "low",
      lists_checked: ["EU-FINANCIAL-SANCTIONS", "UK-HMT"],
      match_details: null,
    },
    {
      screening_id: "SCR-UN-004",
      user_id: null,
      entity_name: "Global Finance Corp",
      entity_type: "organization",
      result: "pending_review",
      risk_level: "high",
      lists_checked: ["OFAC-SDN", "UN-CONSOLIDATED", "EU-FINANCIAL-SANCTIONS", "UK-HMT", "INTERPOL"],
      match_details: JSON.stringify({ matchScore: 0.72, matchedList: "UN-CONSOLIDATED", reason: "Partial name match — requires manual review" }),
    },
    {
      screening_id: "SCR-OFAC-005",
      user_id: userId,
      entity_name: "Ahmed Al-Rashid",
      entity_type: "individual",
      result: "clear",
      risk_level: "medium",
      lists_checked: ["OFAC-SDN", "UN-CONSOLIDATED", "EU-FINANCIAL-SANCTIONS"],
      match_details: null,
    },
    {
      screening_id: "SCR-INTERPOL-006",
      user_id: userId,
      entity_name: "Sunrise Capital Ltd",
      entity_type: "organization",
      result: "clear",
      risk_level: "low",
      lists_checked: ["OFAC-SDN", "INTERPOL", "FATF-HIGH-RISK"],
      match_details: null,
    },
    {
      screening_id: "SCR-FATF-007",
      user_id: null,
      entity_name: "Vladislav Petrov",
      entity_type: "individual",
      result: "hit",
      risk_level: "critical",
      lists_checked: ["OFAC-SDN", "EU-FINANCIAL-SANCTIONS", "UK-HMT", "UN-CONSOLIDATED"],
      match_details: JSON.stringify({ matchScore: 0.99, matchedList: "EU-FINANCIAL-SANCTIONS", matchedEntry: "VLADISLAV PETROV", reason: "Exact name match with DOB confirmation" }),
    },
    {
      screening_id: "SCR-HMT-008",
      user_id: userId,
      entity_name: "Pacific Rim Exports",
      entity_type: "organization",
      result: "clear",
      risk_level: "low",
      lists_checked: ["OFAC-SDN", "UK-HMT", "EU-FINANCIAL-SANCTIONS"],
      match_details: null,
    },
    {
      screening_id: "SCR-OFAC-009",
      user_id: userId,
      entity_name: "Chen Wei",
      entity_type: "individual",
      result: "pending_review",
      risk_level: "medium",
      lists_checked: ["OFAC-SDN", "UN-CONSOLIDATED"],
      match_details: JSON.stringify({ matchScore: 0.65, matchedList: "OFAC-SDN", reason: "Common name — additional verification required" }),
    },
    {
      screening_id: "SCR-UN-010",
      user_id: userId,
      entity_name: "Nile Valley Trading",
      entity_type: "organization",
      result: "clear",
      risk_level: "low",
      lists_checked: ["OFAC-SDN", "UN-CONSOLIDATED", "EU-FINANCIAL-SANCTIONS", "UK-HMT"],
      match_details: null,
    },
    {
      screening_id: "SCR-OFAC-011",
      user_id: userId,
      entity_name: "Ibrahim Hassan",
      entity_type: "individual",
      result: "clear",
      risk_level: "low",
      lists_checked: ["OFAC-SDN", "UN-CONSOLIDATED"],
      match_details: null,
    },
    {
      screening_id: "SCR-EU-012",
      user_id: null,
      entity_name: "Eastern Horizons BV",
      entity_type: "organization",
      result: "hit",
      risk_level: "high",
      lists_checked: ["EU-FINANCIAL-SANCTIONS", "UN-CONSOLIDATED"],
      match_details: JSON.stringify({ matchScore: 0.88, matchedList: "EU-FINANCIAL-SANCTIONS", reason: "Entity name match with known sanctioned entity" }),
    },
  ];

  for (const c of checks) {
    await pool.query(
      `INSERT INTO sanctions_checks
        (screening_id, user_id, entity_name, entity_type, result, risk_level, lists_checked, match_details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (screening_id) DO NOTHING`,
      [c.screening_id, c.user_id, c.entity_name, c.entity_type, c.result, c.risk_level, c.lists_checked, c.match_details]
    );
  }
  console.log(`  ✓ Inserted ${checks.length} sanctions_checks`);
}

async function seedBulkPaymentBatches(userId) {
  console.log("Seeding bulk_payment_batches...");
  const batches = [
    {
      batch_id: "BATCH-2026-001",
      user_id: userId,
      name: "March Payroll — Nigeria",
      description: "Monthly payroll disbursement for 250 employees in Lagos and Abuja",
      total_payments: 250,
      completed: 248,
      failed: 2,
      pending: 0,
      status: "completed",
      currency: "NGN",
      total_amount: 125000000,
      success_rate: 99,
    },
    {
      batch_id: "BATCH-2026-002",
      user_id: userId,
      name: "Supplier Payments — Q1 2026",
      description: "Quarterly supplier invoice settlements across 12 countries",
      total_payments: 87,
      completed: 85,
      failed: 1,
      pending: 1,
      status: "processing",
      currency: "USD",
      total_amount: 4250000,
      success_rate: 98,
    },
    {
      batch_id: "BATCH-2026-003",
      user_id: userId,
      name: "Diaspora Remittances — April",
      description: "Bulk remittance processing for diaspora community transfers",
      total_payments: 1200,
      completed: 0,
      failed: 0,
      pending: 1200,
      status: "pending",
      currency: "USD",
      total_amount: 600000,
      success_rate: 0,
    },
    {
      batch_id: "BATCH-2026-004",
      user_id: userId,
      name: "NGO Aid Distribution — Kenya",
      description: "Emergency aid disbursement to 500 beneficiaries in Nairobi",
      total_payments: 500,
      completed: 500,
      failed: 0,
      pending: 0,
      status: "completed",
      currency: "KES",
      total_amount: 25000000,
      success_rate: 100,
    },
    {
      batch_id: "BATCH-2026-005",
      user_id: userId,
      name: "Contractor Payments — EU",
      description: "SEPA batch payments to European contractors",
      total_payments: 45,
      completed: 0,
      failed: 45,
      pending: 0,
      status: "failed",
      currency: "EUR",
      total_amount: 225000,
      success_rate: 0,
    },
    {
      batch_id: "BATCH-2026-006",
      user_id: userId,
      name: "Scholarship Disbursements — Ghana",
      description: "University scholarship payments to 300 students",
      total_payments: 300,
      completed: 150,
      failed: 0,
      pending: 150,
      status: "processing",
      currency: "GHS",
      total_amount: 3000000,
      success_rate: 50,
    },
    {
      batch_id: "BATCH-2026-007",
      user_id: userId,
      name: "Insurance Claims — South Africa",
      description: "Batch insurance claim payouts",
      total_payments: 75,
      completed: 75,
      failed: 0,
      pending: 0,
      status: "completed",
      currency: "ZAR",
      total_amount: 3750000,
      success_rate: 100,
    },
  ];

  for (const b of batches) {
    await pool.query(
      `INSERT INTO bulk_payment_batches
        (batch_id, user_id, name, description, total_payments, completed, failed, pending, status, currency, total_amount, success_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (batch_id) DO NOTHING`,
      [b.batch_id, b.user_id, b.name, b.description, b.total_payments, b.completed, b.failed, b.pending, b.status, b.currency, b.total_amount, b.success_rate]
    );
  }
  console.log(`  ✓ Inserted ${batches.length} bulk_payment_batches`);
}

async function seedOpenBankingConsents(userId) {
  console.log("Seeding open_banking_consents...");
  const consents = [
    {
      consent_id: "OBC-BARCLAYS-001",
      user_id: userId,
      bank_id: "barclays-uk",
      bank_name: "Barclays UK",
      status: "authorised",
      permissions: ["ReadAccountsBasic", "ReadAccountsDetail", "ReadBalances", "ReadTransactions"],
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      authorised_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    },
    {
      consent_id: "OBC-HSBC-002",
      user_id: userId,
      bank_id: "hsbc-uk",
      bank_name: "HSBC UK",
      status: "authorised",
      permissions: ["ReadAccountsBasic", "ReadBalances", "ReadTransactions", "ReadDirectDebits"],
      expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      authorised_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    },
    {
      consent_id: "OBC-LLOYDS-003",
      user_id: userId,
      bank_id: "lloyds-uk",
      bank_name: "Lloyds Bank",
      status: "awaiting_authorisation",
      permissions: ["ReadAccountsBasic", "ReadBalances"],
      expires_at: null,
      authorised_at: null,
    },
    {
      consent_id: "OBC-NATWEST-004",
      user_id: userId,
      bank_id: "natwest-uk",
      bank_name: "NatWest",
      status: "revoked",
      permissions: ["ReadAccountsBasic", "ReadBalances", "ReadTransactions"],
      expires_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      authorised_at: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
    },
    {
      consent_id: "OBC-MONZO-005",
      user_id: userId,
      bank_id: "monzo-uk",
      bank_name: "Monzo",
      status: "authorised",
      permissions: ["ReadAccountsBasic", "ReadAccountsDetail", "ReadBalances", "ReadTransactions", "ReadStandingOrders"],
      expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
      authorised_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
    {
      consent_id: "OBC-REVOLUT-006",
      user_id: userId,
      bank_id: "revolut-uk",
      bank_name: "Revolut",
      status: "expired",
      permissions: ["ReadAccountsBasic", "ReadBalances"],
      expires_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      authorised_at: new Date(Date.now() - 95 * 24 * 60 * 60 * 1000),
    },
    {
      consent_id: "OBC-STARLING-007",
      user_id: userId,
      bank_id: "starling-uk",
      bank_name: "Starling Bank",
      status: "authorised",
      permissions: ["ReadAccountsBasic", "ReadAccountsDetail", "ReadBalances", "ReadTransactions", "ReadBeneficiaries"],
      expires_at: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000),
      authorised_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    },
    {
      consent_id: "OBC-SANTANDER-008",
      user_id: userId,
      bank_id: "santander-uk",
      bank_name: "Santander UK",
      status: "rejected",
      permissions: ["ReadAccountsBasic"],
      expires_at: null,
      authorised_at: null,
    },
  ];

  for (const c of consents) {
    await pool.query(
      `INSERT INTO open_banking_consents
        (consent_id, user_id, bank_id, bank_name, status, permissions, expires_at, authorised_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (consent_id) DO NOTHING`,
      [c.consent_id, c.user_id, c.bank_id, c.bank_name, c.status, c.permissions, c.expires_at, c.authorised_at]
    );
  }
  console.log(`  ✓ Inserted ${consents.length} open_banking_consents`);
}

async function seedRegulatoryReports(userId) {
  console.log("Seeding regulatory_reports...");
  const reports = [
    {
      report_id: "RPT-CTR-2026-001",
      report_type: "CTR",
      status: "filed",
      format: "pdf",
      period_start: "2026-01-01",
      period_end: "2026-01-31",
      generated_by: userId,
      download_url: "https://storage.remitflow.io/reports/CTR-2026-001.pdf",
      filed_at: new Date("2026-02-15"),
    },
    {
      report_id: "RPT-SAR-2026-001",
      report_type: "SAR",
      status: "filed",
      format: "pdf",
      period_start: "2026-01-15",
      period_end: "2026-01-15",
      generated_by: userId,
      download_url: "https://storage.remitflow.io/reports/SAR-2026-001.pdf",
      filed_at: new Date("2026-01-22"),
    },
    {
      report_id: "RPT-CTR-2026-002",
      report_type: "CTR",
      status: "ready",
      format: "pdf",
      period_start: "2026-02-01",
      period_end: "2026-02-28",
      generated_by: userId,
      download_url: "https://storage.remitflow.io/reports/CTR-2026-002.pdf",
      filed_at: null,
    },
    {
      report_id: "RPT-FBAR-2025-001",
      report_type: "FBAR",
      status: "filed",
      format: "xml",
      period_start: "2025-01-01",
      period_end: "2025-12-31",
      generated_by: userId,
      download_url: "https://storage.remitflow.io/reports/FBAR-2025-001.xml",
      filed_at: new Date("2026-04-15"),
    },
    {
      report_id: "RPT-AML-2025-001",
      report_type: "ANNUAL_AML",
      status: "filed",
      format: "pdf",
      period_start: "2025-01-01",
      period_end: "2025-12-31",
      generated_by: userId,
      download_url: "https://storage.remitflow.io/reports/AML-2025-001.pdf",
      filed_at: new Date("2026-03-31"),
    },
    {
      report_id: "RPT-CTR-2026-003",
      report_type: "CTR",
      status: "generating",
      format: "pdf",
      period_start: "2026-03-01",
      period_end: "2026-03-31",
      generated_by: userId,
      download_url: null,
      filed_at: null,
    },
    {
      report_id: "RPT-SAR-2026-002",
      report_type: "SAR",
      status: "pending",
      format: "pdf",
      period_start: "2026-04-01",
      period_end: "2026-04-21",
      generated_by: userId,
      download_url: null,
      filed_at: null,
    },
    {
      report_id: "RPT-CTR-2026-004",
      report_type: "CTR",
      status: "failed",
      format: "pdf",
      period_start: "2026-04-01",
      period_end: "2026-04-15",
      generated_by: userId,
      download_url: null,
      filed_at: null,
    },
  ];

  for (const r of reports) {
    await pool.query(
      `INSERT INTO regulatory_reports
        (report_id, report_type, status, format, period_start, period_end, generated_by, download_url, filed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (report_id) DO NOTHING`,
      [r.report_id, r.report_type, r.status, r.format, r.period_start, r.period_end, r.generated_by, r.download_url, r.filed_at]
    );
  }
  console.log(`  ✓ Inserted ${reports.length} regulatory_reports`);
}

async function seedFraudModelRuns() {
  console.log("Seeding fraud_model_runs...");
  const runs = [
    {
      run_id: "FMR-20260101-001",
      model_name: "fraud_xgboost_v3",
      model_version: "3.0.0",
      triggered_by: "airflow",
      status: "completed",
      accuracy: 9847,
      f1_score: 9721,
      auc_roc: 9934,
      training_records: 450000,
      validation_records: 50000,
      duration_seconds: 1847,
      completed_at: new Date("2026-01-01T06:30:47Z"),
    },
    {
      run_id: "FMR-20260115-001",
      model_name: "fraud_xgboost_v3",
      model_version: "3.1.0",
      triggered_by: "airflow",
      status: "completed",
      accuracy: 9863,
      f1_score: 9745,
      auc_roc: 9951,
      training_records: 475000,
      validation_records: 52000,
      duration_seconds: 1923,
      completed_at: new Date("2026-01-15T06:28:12Z"),
    },
    {
      run_id: "FMR-20260201-001",
      model_name: "fraud_lightgbm_v2",
      model_version: "2.4.0",
      triggered_by: "manual",
      status: "completed",
      accuracy: 9812,
      f1_score: 9698,
      auc_roc: 9908,
      training_records: 480000,
      validation_records: 53000,
      duration_seconds: 1234,
      completed_at: new Date("2026-02-01T14:15:33Z"),
    },
    {
      run_id: "FMR-20260301-001",
      model_name: "fraud_xgboost_v3",
      model_version: "3.2.0",
      triggered_by: "airflow",
      status: "completed",
      accuracy: 9878,
      f1_score: 9762,
      auc_roc: 9967,
      training_records: 510000,
      validation_records: 55000,
      duration_seconds: 2105,
      completed_at: new Date("2026-03-01T06:35:05Z"),
    },
    {
      run_id: "FMR-20260401-001",
      model_name: "fraud_neural_net_v1",
      model_version: "1.0.0",
      triggered_by: "airflow",
      status: "failed",
      accuracy: null,
      f1_score: null,
      auc_roc: null,
      training_records: 520000,
      validation_records: 57000,
      duration_seconds: 450,
      completed_at: new Date("2026-04-01T06:07:30Z"),
    },
    {
      run_id: "FMR-20260415-001",
      model_name: "fraud_xgboost_v3",
      model_version: "3.3.0",
      triggered_by: "airflow",
      status: "completed",
      accuracy: 9891,
      f1_score: 9778,
      auc_roc: 9972,
      training_records: 535000,
      validation_records: 58000,
      duration_seconds: 2234,
      completed_at: new Date("2026-04-15T06:37:14Z"),
    },
    {
      run_id: "FMR-20260421-001",
      model_name: "fraud_xgboost_v3",
      model_version: "3.4.0",
      triggered_by: "airflow",
      status: "running",
      accuracy: null,
      f1_score: null,
      auc_roc: null,
      training_records: 540000,
      validation_records: 59000,
      duration_seconds: null,
      completed_at: null,
    },
  ];

  for (const r of runs) {
    await pool.query(
      `INSERT INTO fraud_model_runs
        (run_id, model_name, model_version, triggered_by, status, accuracy, f1_score, auc_roc,
         training_records, validation_records, duration_seconds, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (run_id) DO NOTHING`,
      [r.run_id, r.model_name, r.model_version, r.triggered_by, r.status, r.accuracy, r.f1_score, r.auc_roc,
       r.training_records, r.validation_records, r.duration_seconds, r.completed_at]
    );
  }
  console.log(`  ✓ Inserted ${runs.length} fraud_model_runs`);
}

async function main() {
  console.log("=== RemitFlow v90 Seed Data ===\n");
  try {
    const userId = await getFirstUserId();
    console.log(`Using userId: ${userId}\n`);

    await seedSanctionsChecks(userId);
    await seedBulkPaymentBatches(userId);
    await seedOpenBankingConsents(userId);
    await seedRegulatoryReports(userId);
    await seedFraudModelRuns();

    // Summary
    const tables = ["sanctions_checks", "bulk_payment_batches", "open_banking_consents", "regulatory_reports", "fraud_model_runs"];
    console.log("\n=== Seed Summary ===");
    for (const t of tables) {
      const res = await pool.query(`SELECT COUNT(*) FROM ${t}`);
      console.log(`  ${t}: ${res.rows[0].count} rows`);
    }
    console.log("\n✅ v90 seed complete!");
  } catch (err) {
    console.error("Seed failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
