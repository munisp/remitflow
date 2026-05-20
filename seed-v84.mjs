#!/usr/bin/env node
/**
 * seed-v84.mjs — Seed v84 production tables (PostgreSQL):
 *   - smart_routing_decisions
 *   - compliance_reports
 *   - developer_sandbox_sessions
 *   - api_key_usage_logs
 *   - push_subscriptions
 *   - stripe_receipts
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const dotenv = require("dotenv");
dotenv.config();

const DB_URL = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;
if (!DB_URL) { console.error("No LOCAL_DATABASE_URL"); process.exit(1); }

const pool = new Pool({ connectionString: DB_URL });

async function run(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function main() {
  console.log("🌱 Seeding v84 tables...");

  // Get valid user ids
  const users = await run("SELECT id FROM users LIMIT 3");
  if (!users.length) { console.log("No users found — run seed.mjs first"); process.exit(0); }
  const uid = users[0].id;
  const uid2 = users[1]?.id ?? uid;

  // ─── smart_routing_decisions ─────────────────────────────────────────────
  const routingRows = [
    [uid, null, "USD", "NGN", "500.00", "Flutterwave", "3.50", 120, "98.5", JSON.stringify({ latency: 120, fee: 3.50, reliability: 0.99 })],
    [uid, null, "GBP", "KES", "200.00", "Wise", "2.10", 90, "97.2", JSON.stringify({ latency: 90, fee: 2.10, reliability: 0.98 })],
    [uid2, null, "EUR", "GHS", "350.00", "Remitly", "4.00", 180, "95.1", JSON.stringify({ latency: 180, fee: 4.00, reliability: 0.96 })],
    [uid, null, "USD", "ZAR", "1000.00", "OFX", "5.50", 60, "99.1", JSON.stringify({ latency: 60, fee: 5.50, reliability: 0.997 })],
    [uid2, null, "CAD", "NGN", "750.00", "WorldRemit", "6.00", 150, "93.8", JSON.stringify({ latency: 150, fee: 6.00, reliability: 0.94 })],
  ];
  for (const r of routingRows) {
    await run(
      `INSERT INTO smart_routing_decisions (user_id, transfer_id, from_currency, to_currency, amount, selected_provider, estimated_fee, estimated_time_seconds, score, decision_factors) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      r
    );
  }
  console.log(`  ✓ smart_routing_decisions: ${routingRows.length} rows`);

  // ─── compliance_reports ──────────────────────────────────────────────────
  const complianceRows = [
    [uid, "AML", "2025-Q1", "submitted", 12450, "2847500.00", 3, new Date("2025-01-31")],
    [uid, "SAR", "2025-Q2", "submitted", 8920, "1950000.00", 1, new Date("2025-04-30")],
    [uid, "CTR", "2025-Q3", "draft", 15600, "3200000.00", 7, null],
    [uid, "KYC_AUDIT", "2025-Q4", "draft", 2340, "450000.00", 0, null],
    [uid, "OFAC_SCREENING", "2025-Q1", "submitted", 18900, "4100000.00", 2, new Date("2025-02-15")],
  ];
  for (const r of complianceRows) {
    await run(
      `INSERT INTO compliance_reports (generated_by, report_type, report_period, status, total_transactions, total_volume, flagged_transactions, submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      r
    );
  }
  console.log(`  ✓ compliance_reports: ${complianceRows.length} rows`);

  // ─── developer_sandbox_sessions ──────────────────────────────────────────
  const sandboxRows = [
    [uid, `sess_${Date.now()}_1`, "sandbox", "sk_test_remitflow_sandbox_001", 142, new Date("2026-12-31")],
    [uid2, `sess_${Date.now()}_2`, "sandbox", "sk_test_remitflow_sandbox_002", 87, new Date("2026-12-31")],
  ];
  for (const r of sandboxRows) {
    await run(
      `INSERT INTO developer_sandbox_sessions (user_id, session_key, environment, test_api_key, request_count, expires_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      r
    );
  }
  console.log(`  ✓ developer_sandbox_sessions: ${sandboxRows.length} rows`);

  // ─── api_key_usage_logs ──────────────────────────────────────────────────
  const apiKeys = await run("SELECT id FROM api_keys WHERE user_id = $1 LIMIT 1", [uid]);
  const keyId = apiKeys[0]?.id ?? 1;
  const endpoints = ["/api/trpc/transfers.create", "/api/trpc/fx.rates", "/api/trpc/wallets.list", "/api/trpc/kyc.status", "/api/trpc/transfers.list"];
  const statusCodes = [200, 200, 200, 200, 422, 429];
  for (let i = 0; i < 20; i++) {
    await run(
      `INSERT INTO api_key_usage_logs (api_key_id, user_id, endpoint, method, status_code, latency_ms, ip_address, environment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [keyId, uid, endpoints[i % endpoints.length], "POST", statusCodes[i % statusCodes.length], Math.floor(Math.random() * 300) + 50, "127.0.0.1", "live"]
    );
  }
  console.log(`  ✓ api_key_usage_logs: 20 rows`);

  // ─── push_subscriptions ──────────────────────────────────────────────────
  const pushRows = [
    [uid, `https://fcm.googleapis.com/fcm/send/sandbox-${Date.now()}_1`, "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlTiESgX9QualityKey", "tBHItJI5svbpez7KI4CCXg", "Desktop Browser", true],
    [uid, `https://fcm.googleapis.com/fcm/send/sandbox-${Date.now()}_2`, "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlTiESgX9QualityKey2", "tBHItJI5svbpez7KI4CCXg2", "Mobile Browser", true],
    [uid2, `https://fcm.googleapis.com/fcm/send/sandbox-${Date.now()}_3`, "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlTiESgX9QualityKey3", "tBHItJI5svbpez7KI4CCXg3", "Desktop Browser", true],
  ];
  for (const r of pushRows) {
    await run(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device_name, is_active) VALUES ($1,$2,$3,$4,$5,$6)`,
      r
    );
  }
  console.log(`  ✓ push_subscriptions: ${pushRows.length} rows`);

  // ─── stripe_receipts ─────────────────────────────────────────────────────
  // Schema: user_id, stripe_session_id, stripe_payment_intent_id, amount_total, currency, status, product_name, receipt_url, metadata, paid_at
  const receiptRows = [
    [uid, `cs_test_${Date.now()}_1`, `pi_test_${Date.now()}_1`, 4999, "usd", "paid", "Premium Plan", null, null, new Date("2025-01-15")],
    [uid, `cs_test_${Date.now()}_2`, `pi_test_${Date.now()}_2`, 9999, "usd", "paid", "Business Plan", null, null, new Date("2025-02-15")],
    [uid2, `cs_test_${Date.now()}_3`, `pi_test_${Date.now()}_3`, 2999, "usd", "paid", "Starter Plan", null, null, new Date("2025-03-15")],
    [uid, `cs_test_${Date.now()}_4`, `pi_test_${Date.now()}_4`, 4999, "usd", "refunded", "Premium Plan", null, null, new Date("2025-04-01")],
  ];
  for (const r of receiptRows) {
    await run(
      `INSERT INTO stripe_receipts (user_id, stripe_session_id, stripe_payment_intent_id, amount_total, currency, status, product_name, receipt_url, metadata, paid_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      r
    );
  }
  console.log(`  ✓ stripe_receipts: ${receiptRows.length} rows`);

  console.log("\n✅ v84 seed complete!");
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
