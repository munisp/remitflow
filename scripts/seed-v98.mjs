#!/usr/bin/env node
/**
 * RemitFlow v98 Seed Script
 * Seeds: kafka_consumer_metrics, export_history, ip_login_history,
 *        cbdc_mint_burn_log, community_activity_feed, ctr_auto_flags,
 *        gdpr_requests, stripe_webhook_retry_log, mojaloop_fsps
 */
import "dotenv/config";
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

async function seed() {
  console.log("🌱 Seeding v98 tables...");

  // 1. Mojaloop FSPs
  await query(`
    INSERT INTO mojaloop_fsps (name, fsp_id, country, currency, endpoint, is_active, created_at)
    VALUES
      ('First Bank Nigeria', 'fbn-ng', 'NG', 'NGN', 'https://fbn.mojaloop.io/fspiop', true, NOW()),
      ('Zenith Bank', 'zenith-ng', 'NG', 'NGN', 'https://zenith.mojaloop.io/fspiop', true, NOW()),
      ('Equity Bank Kenya', 'equity-ke', 'KE', 'KES', 'https://equity.mojaloop.io/fspiop', true, NOW()),
      ('M-Pesa Kenya', 'mpesa-ke', 'KE', 'KES', 'https://mpesa.mojaloop.io/fspiop', true, NOW()),
      ('Standard Bank SA', 'stdbank-za', 'ZA', 'ZAR', 'https://stdbank.mojaloop.io/fspiop', true, NOW()),
      ('MTN Mobile Money', 'mtn-gh', 'GH', 'GHS', 'https://mtn.mojaloop.io/fspiop', true, NOW()),
      ('Airtel Money', 'airtel-tz', 'TZ', 'TZS', 'https://airtel.mojaloop.io/fspiop', true, NOW()),
      ('Wave Senegal', 'wave-sn', 'SN', 'XOF', 'https://wave.mojaloop.io/fspiop', true, NOW())
    ON CONFLICT DO NOTHING
  `);
  console.log("  ✓ Mojaloop FSPs seeded (8 FSPs)");

  // 2. CTR Auto-Flags (sample compliance flags)
  await query(`
    INSERT INTO ctr_auto_flags (user_id, transaction_id, amount, currency, flag_reason, status, created_at)
    SELECT
      u.id,
      t.id,
      t."fromAmount"::numeric,
      t."fromCurrency",
      'Amount exceeds $10,000 CTR threshold',
      'pending_review',
      NOW() - (random() * interval '30 days')
    FROM transactions t
    JOIN users u ON u.id = t."userId"
    WHERE t."fromAmount"::numeric >= 10000
      AND t.status = 'completed'
    LIMIT 10
    ON CONFLICT DO NOTHING
  `);
  console.log("  ✓ CTR auto-flags seeded");

  // 3. Community Activity Feed
  await query(`
    INSERT INTO community_activity_feed (user_id, actor_name, activity_type, title, description, is_public, created_at)
    SELECT
      u.id,
      COALESCE(u.name, 'Anonymous User'),
      CASE (random() * 4)::int
        WHEN 0 THEN 'transfer_sent'
        WHEN 1 THEN 'kyc_verified'
        WHEN 2 THEN 'referral'
        WHEN 3 THEN 'milestone'
        ELSE 'badge_earned'
      END,
      CASE (random() * 4)::int
        WHEN 0 THEN 'Sent money to family'
        WHEN 1 THEN 'KYC verification completed'
        WHEN 2 THEN 'Referred a friend'
        WHEN 3 THEN 'First transfer milestone'
        ELSE 'Earned Power Sender badge'
      END,
      'Activity recorded on RemitFlow',
      true,
      NOW() - (random() * interval '60 days')
    FROM users u
    LIMIT 20
    ON CONFLICT DO NOTHING
  `);
  console.log("  ✓ Community activity feed seeded (20 activities)");

  // 4. CBDC Mint/Burn Log
  await query(`
    INSERT INTO cbdc_mint_burn_log (user_id, operation, currency, amount, balance_before, balance_after, reason, status, created_at)
    SELECT
      u.id,
      CASE (random() * 1)::int WHEN 0 THEN 'mint' ELSE 'burn' END,
      CASE (random() * 3)::int
        WHEN 0 THEN 'eNGN'
        WHEN 1 THEN 'eKES'
        WHEN 2 THEN 'eZAR'
        ELSE 'eGHS'
      END,
      (random() * 1000000 + 10000)::numeric(18,2),
      (random() * 5000000)::numeric(18,2),
      (random() * 5000000 + 10000)::numeric(18,2),
      'Central bank monetary policy operation',
      'completed',
      NOW() - (random() * interval '90 days')
    FROM users u
    WHERE u.role = 'admin'
    LIMIT 5
    ON CONFLICT DO NOTHING
  `);
  console.log("  ✓ CBDC mint/burn log seeded");

  // 5. IP Login History
  await query(`
    INSERT INTO ip_login_history (user_id, ip_address, country, city, device_fingerprint, is_suspicious, login_at)
    SELECT
      u.id,
      ('192.168.' || (random() * 255)::int || '.' || (random() * 255)::int),
      CASE (random() * 4)::int
        WHEN 0 THEN 'United States'
        WHEN 1 THEN 'Nigeria'
        WHEN 2 THEN 'United Kingdom'
        WHEN 3 THEN 'Kenya'
        ELSE 'South Africa'
      END,
      CASE (random() * 4)::int
        WHEN 0 THEN 'New York'
        WHEN 1 THEN 'Lagos'
        WHEN 2 THEN 'London'
        WHEN 3 THEN 'Nairobi'
        ELSE 'Cape Town'
      END,
      md5(random()::text),
      (random() < 0.05),
      NOW() - (random() * interval '30 days')
    FROM users u
    CROSS JOIN generate_series(1, 3)
    LIMIT 50
    ON CONFLICT DO NOTHING
  `);
  console.log("  ✓ IP login history seeded (50 records)");

  // 6. Export History
  await query(`
    INSERT INTO export_history (user_id, export_type, format, status, record_count, file_url, created_at, completed_at)
    SELECT
      u.id,
      CASE (random() * 2)::int WHEN 0 THEN 'transactions' WHEN 1 THEN 'wallet_statement' ELSE 'compliance_report' END,
      CASE (random() * 2)::int WHEN 0 THEN 'csv' WHEN 1 THEN 'pdf' ELSE 'xlsx' END,
      'completed',
      (random() * 500 + 10)::int,
      'https://storage.remitflow.io/exports/sample-export.csv',
      NOW() - (random() * interval '30 days'),
      NOW() - (random() * interval '29 days')
    FROM users u
    LIMIT 15
    ON CONFLICT DO NOTHING
  `);
  console.log("  ✓ Export history seeded (15 records)");

  // 7. GDPR Requests
  await query(`
    INSERT INTO gdpr_requests (user_id, request_type, status, reason, created_at)
    SELECT
      u.id,
      CASE (random() * 2)::int WHEN 0 THEN 'portability' WHEN 1 THEN 'restriction' ELSE 'erasure' END,
      CASE (random() * 2)::int WHEN 0 THEN 'pending' WHEN 1 THEN 'completed' ELSE 'processing' END,
      'User requested data rights exercise',
      NOW() - (random() * interval '60 days')
    FROM users u
    LIMIT 5
    ON CONFLICT DO NOTHING
  `);
  console.log("  ✓ GDPR requests seeded (5 records)");

  // 8. Stripe Webhook Retry Log
  await query(`
    INSERT INTO stripe_webhook_retry_log (stripe_event_id, event_type, payload, attempt_count, last_attempt_at, status, created_at)
    VALUES
      ('evt_test_001', 'payment_intent.succeeded', '{"id":"pi_test_001"}', 1, NOW() - interval '2 hours', 'resolved', NOW() - interval '2 hours'),
      ('evt_test_002', 'customer.subscription.created', '{"id":"sub_test_001"}', 2, NOW() - interval '1 hour', 'pending', NOW() - interval '3 hours'),
      ('evt_test_003', 'invoice.payment_failed', '{"id":"in_test_001"}', 3, NOW() - interval '30 minutes', 'failed', NOW() - interval '4 hours'),
      ('evt_test_004', 'checkout.session.completed', '{"id":"cs_test_001"}', 1, NOW() - interval '5 hours', 'resolved', NOW() - interval '5 hours'),
      ('evt_test_005', 'payment_intent.payment_failed', '{"id":"pi_test_002"}', 5, NOW() - interval '10 minutes', 'abandoned', NOW() - interval '6 hours')
    ON CONFLICT DO NOTHING
  `);
  console.log("  ✓ Stripe webhook retry log seeded (5 records)");

  console.log("\n✅ v98 seed complete!");
  await pool.end();
}

seed().catch(err => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
