/**
 * RemitFlow v97 Seed Data
 * Seeds: velocity rules, KYC lifecycle states, document renewals,
 *        webhook retry queue, API keys, batch payments, feature flag evaluations,
 *        system config hot-reload entries, admin compliance triggers
 */

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL,
  ssl: process.env.LOCAL_DATABASE_URL ? false : { rejectUnauthorized: false },
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function seedVelocityRules() {
  console.log("[v97] Seeding velocity rules...");
  const rules = [
    { name: "Daily Send Limit - Standard", maxAmount: 2000, windowHours: 24, maxTransactions: 5, action: "block", enabled: true, description: "Block transactions exceeding $2,000/day for standard KYC users" },
    { name: "Daily Send Limit - Enhanced", maxAmount: 10000, windowHours: 24, maxTransactions: 20, action: "block", enabled: true, description: "Block transactions exceeding $10,000/day for enhanced KYC users" },
    { name: "Hourly Velocity Flag", maxAmount: 500, windowHours: 1, maxTransactions: 3, action: "flag", enabled: true, description: "Flag rapid succession of transactions within 1 hour" },
    { name: "Weekly Cumulative Review", maxAmount: 15000, windowHours: 168, maxTransactions: 50, action: "review", enabled: true, description: "Trigger manual review for weekly cumulative > $15,000" },
    { name: "New Account Restriction", maxAmount: 500, windowHours: 24, maxTransactions: 2, action: "block", enabled: true, description: "Restrict new accounts (< 7 days) to $500/day" },
    { name: "High-Risk Corridor Limit", maxAmount: 1000, windowHours: 24, maxTransactions: 3, action: "flag", enabled: true, description: "Flag high-risk corridor transactions above $1,000" },
  ];

  for (const rule of rules) {
    await query(
      `INSERT INTO velocity_rules_v97 (name, max_amount, window_hours, max_transactions, action, enabled, description, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (name) DO UPDATE SET max_amount = EXCLUDED.max_amount, enabled = EXCLUDED.enabled`,
      [rule.name, rule.maxAmount, rule.windowHours, rule.maxTransactions, rule.action, rule.enabled, rule.description]
    );
  }
  console.log(`  ✓ ${rules.length} velocity rules seeded`);
}

async function seedKycLifecycleStates() {
  console.log("[v97] Seeding KYC lifecycle states...");
  // Get existing users
  const { rows: users } = await query("SELECT id FROM users LIMIT 20");
  if (!users.length) { console.log("  ⚠ No users found, skipping"); return; }

  const stages = ["identity_submitted", "identity_verified", "address_submitted", "address_verified", "enhanced_due_diligence", "approved", "rejected"];
  let count = 0;

  for (const user of users.slice(0, 10)) {
    const stage = stages[Math.floor(Math.random() * stages.length)];
    const riskScore = Math.floor(Math.random() * 100);
    await query(
      `INSERT INTO kyc_lifecycle_states_v97 (user_id, current_stage, risk_score, next_action, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET current_stage = EXCLUDED.current_stage, risk_score = EXCLUDED.risk_score`,
      [user.id, stage, riskScore, stage === "approved" ? null : "Submit required documents"]
    );
    count++;
  }
  console.log(`  ✓ ${count} KYC lifecycle states seeded`);
}

async function seedDocumentRenewals() {
  console.log("[v97] Seeding document renewals...");
  const { rows: users } = await query("SELECT id FROM users LIMIT 10");
  if (!users.length) { console.log("  ⚠ No users found, skipping"); return; }

  const docTypes = ["passport", "national_id", "drivers_license", "proof_of_address", "bank_statement"];
  let count = 0;

  for (const user of users) {
    for (const docType of docTypes.slice(0, 2)) {
      const daysUntilExpiry = Math.floor(Math.random() * 90) - 10; // -10 to 80 days
      const expiresAt = new Date(Date.now() + daysUntilExpiry * 86400000);
      const status = daysUntilExpiry < 0 ? "overdue" : daysUntilExpiry < 30 ? "pending" : "active";

      await query(
        `INSERT INTO document_renewals_v97 (user_id, document_type, expires_at, status, days_until_expiry, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id, document_type) DO UPDATE SET expires_at = EXCLUDED.expires_at, status = EXCLUDED.status`,
        [user.id, docType, expiresAt, status, daysUntilExpiry]
      );
      count++;
    }
  }
  console.log(`  ✓ ${count} document renewals seeded`);
}

async function seedWebhookRetryQueue() {
  console.log("[v97] Seeding webhook retry queue...");
  const endpoints = [
    { url: "https://partner1.example.com/webhooks/remitflow", events: ["transaction.completed", "kyc.approved"] },
    { url: "https://partner2.example.com/webhooks/payments", events: ["payment.failed", "refund.processed"] },
    { url: "https://compliance.example.com/webhooks/aml", events: ["aml.alert", "sanctions.match"] },
  ];

  const eventTypes = ["transaction.completed", "kyc.approved", "payment.failed", "aml.alert", "refund.processed"];
  let count = 0;

  for (const endpoint of endpoints) {
    for (let i = 0; i < 3; i++) {
      const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
      const attempts = Math.floor(Math.random() * 4) + 1;
      const nextRetry = new Date(Date.now() + Math.pow(2, attempts) * 60000); // Exponential backoff

      await query(
        `INSERT INTO webhook_retry_queue_v97 (endpoint_url, event_type, payload, status, attempts, next_retry_at, created_at)
         VALUES ($1, $2, $3, 'pending', $4, $5, NOW())`,
        [endpoint.url, eventType, JSON.stringify({ event: eventType, data: { id: Math.floor(Math.random() * 1000) }, timestamp: Date.now() }), attempts, nextRetry]
      );
      count++;
    }
  }
  console.log(`  ✓ ${count} webhook retry entries seeded`);
}

async function seedApiKeys() {
  console.log("[v97] Seeding API keys...");
  const { rows: users } = await query("SELECT id FROM users WHERE role = 'admin' LIMIT 3");
  if (!users.length) { console.log("  ⚠ No admin users found, skipping"); return; }

  const keyConfigs = [
    { name: "Production Integration Key", scopes: ["transactions:read", "transactions:write", "beneficiaries:read"] },
    { name: "Analytics Read-Only Key", scopes: ["transactions:read", "analytics:read"] },
    { name: "Compliance Monitoring Key", scopes: ["compliance:read", "kyc:read", "aml:read"] },
    { name: "Partner API Key", scopes: ["transactions:read", "fx:read", "corridors:read"] },
  ];

  let count = 0;
  for (const user of users) {
    for (const config of keyConfigs.slice(0, 2)) {
      const prefix = `rk_${Math.random().toString(36).substring(2, 8)}`;
      const keyHash = `hash_${Math.random().toString(36).substring(2, 42)}`;
      const expiresAt = new Date(Date.now() + 365 * 86400000);

      await query(
        `INSERT INTO api_keys_v97 (user_id, name, key_prefix, key_hash, scopes, is_active, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, true, $6, NOW())`,
        [user.id, config.name, prefix, keyHash, JSON.stringify(config.scopes), expiresAt]
      );
      count++;
    }
  }
  console.log(`  ✓ ${count} API keys seeded`);
}

async function seedBatchPayments() {
  console.log("[v97] Seeding batch payments...");
  const { rows: users } = await query("SELECT id FROM users WHERE role = 'admin' LIMIT 2");
  if (!users.length) { console.log("  ⚠ No admin users found, skipping"); return; }

  const batches = [
    { name: "Payroll - March 2026", totalItems: 150, successCount: 148, failedCount: 2, pendingCount: 0, status: "completed" },
    { name: "Supplier Payments Q1", totalItems: 45, successCount: 40, failedCount: 3, pendingCount: 2, status: "partial" },
    { name: "NGO Disbursement - April", totalItems: 200, successCount: 0, failedCount: 0, pendingCount: 200, status: "pending" },
    { name: "Scholarship Transfers", totalItems: 75, successCount: 70, failedCount: 5, pendingCount: 0, status: "completed" },
    { name: "Emergency Relief Fund", totalItems: 30, successCount: 25, failedCount: 2, pendingCount: 3, status: "partial" },
  ];

  let count = 0;
  for (const batch of batches) {
    await query(
      `INSERT INTO batch_payments_v97 (user_id, name, total_items, success_count, failed_count, pending_count, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [users[0].id, batch.name, batch.totalItems, batch.successCount, batch.failedCount, batch.pendingCount, batch.status]
    );
    count++;
  }
  console.log(`  ✓ ${count} batch payments seeded`);
}

async function seedSystemConfigEntries() {
  console.log("[v97] Seeding system config hot-reload entries...");
  const configs = [
    { key: "max_daily_transfer_limit", value: "50000", category: "limits", description: "Maximum daily transfer limit in USD", isHotReloadable: true },
    { key: "kyc_auto_approve_threshold", value: "25", category: "kyc", description: "Risk score threshold for auto-approval", isHotReloadable: true },
    { key: "fraud_score_block_threshold", value: "80", category: "fraud", description: "Fraud score above which transactions are blocked", isHotReloadable: true },
    { key: "velocity_check_enabled", value: "true", category: "compliance", description: "Enable/disable velocity checks", isHotReloadable: true },
    { key: "webhook_max_retries", value: "5", category: "webhooks", description: "Maximum webhook retry attempts", isHotReloadable: true },
    { key: "api_key_expiry_days", value: "365", category: "api", description: "Default API key expiry in days", isHotReloadable: false },
    { key: "batch_payment_chunk_size", value: "50", category: "batch", description: "Number of items to process per batch chunk", isHotReloadable: true },
    { key: "document_renewal_warning_days", value: "30", category: "documents", description: "Days before expiry to send renewal warning", isHotReloadable: true },
  ];

  for (const config of configs) {
    await query(
      `INSERT INTO system_config (key, value, description, is_secret, "updatedAt")
       VALUES ($1, $2, $3, false, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`,
      [config.key, config.value, `[${config.category}] ${config.description}`]
    );
  }
  console.log(`  ✓ ${configs.length} system config entries seeded`);
}

async function seedFeatureFlagEvaluations() {
  console.log("[v97] Seeding feature flag evaluations...");
  const flags = [
    { name: "velocity_check_v97", description: "Enable v97 velocity check engine", enabled: true, rolloutPct: 100, environment: "production" },
    { name: "kyc_lifecycle_v97", description: "Enable v97 KYC lifecycle state machine", enabled: true, rolloutPct: 100, environment: "production" },
    { name: "document_renewal_alerts", description: "Send document renewal alerts", enabled: true, rolloutPct: 80, environment: "production" },
    { name: "webhook_exponential_backoff", description: "Use exponential backoff for webhook retries", enabled: true, rolloutPct: 100, environment: "production" },
    { name: "api_key_rotation_v97", description: "Enable API key rotation feature", enabled: true, rolloutPct: 100, environment: "production" },
    { name: "batch_payment_partial_failure", description: "Enable partial failure handling for batch payments", enabled: true, rolloutPct: 100, environment: "production" },
    { name: "system_config_hot_reload", description: "Enable hot-reload for system config changes", enabled: true, rolloutPct: 100, environment: "production" },
    { name: "admin_compliance_trigger", description: "Enable manual compliance trigger from admin panel", enabled: true, rolloutPct: 100, environment: "production" },
    { name: "feature_flag_evaluation_engine", description: "Enable v97 feature flag evaluation engine", enabled: true, rolloutPct: 100, environment: "production" },
    { name: "tenant_isolation_v97", description: "Enable v97 tenant isolation middleware", enabled: false, rolloutPct: 0, environment: "staging" },
  ];

  for (const flag of flags) {
    await query(
      `INSERT INTO feature_flags (key, name, description, default_enabled, rollout_pct, scope, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'global', NOW(), NOW())
       ON CONFLICT (key) DO UPDATE SET default_enabled = EXCLUDED.default_enabled, rollout_pct = EXCLUDED.rollout_pct, "updatedAt" = NOW()`,
      [flag.name, flag.name, flag.description, flag.enabled, flag.rolloutPct]
    );
  }
  console.log(`  ✓ ${flags.length} feature flags seeded`);
}

async function main() {
  console.log("🌱 RemitFlow v97 Seed Data");
  console.log("=".repeat(50));

  try {
    await seedVelocityRules();
    await seedKycLifecycleStates();
    await seedDocumentRenewals();
    await seedWebhookRetryQueue();
    await seedApiKeys();
    await seedBatchPayments();
    await seedSystemConfigEntries();
    await seedFeatureFlagEvaluations();

    console.log("\n✅ v97 seed data complete!");
  } catch (err) {
    console.error("❌ Seed error:", err.message);
    // Non-fatal: tables may not exist yet if migration hasn't run
    console.log("  Run 'pnpm db:push' first, then re-run this seed script");
  } finally {
    await pool.end();
  }
}

main();
