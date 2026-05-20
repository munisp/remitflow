import postgres from "postgres";
const sql = postgres(process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL);

async function seed() {
  console.log("Seeding v86 tables...");

  // promo_codes
  await sql`INSERT INTO promo_codes (code, description, discount_type, discount_value, usage_limit, per_user_limit, is_active, valid_from, valid_until, created_by) VALUES
    ('WELCOME20', 'Welcome bonus - 20% off fees', 'percentage', 20, 1000, 1, true, NOW(), NOW() + INTERVAL '1 year', 1),
    ('SAVE10', 'Save $10 on your next transfer', 'fixed', 10, 500, 2, true, NOW(), NOW() + INTERVAL '6 months', 1),
    ('AFRICA15', 'Africa corridor discount 15%', 'percentage', 15, 200, 3, true, NOW(), NOW() + INTERVAL '3 months', 1),
    ('NEWUSER', 'New user first transfer free fee', 'percentage', 100, 100, 1, true, NOW(), NOW() + INTERVAL '1 year', 1),
    ('SUMMER25', 'Summer promotion 25% off', 'percentage', 25, 300, 1, true, NOW(), NOW() + INTERVAL '2 months', 1),
    ('EXPIRED10', 'Expired test code', 'percentage', 10, 100, 1, false, NOW() - INTERVAL '1 year', NOW() - INTERVAL '1 day', 1)
  ON CONFLICT (code) DO NOTHING`;
  console.log("✓ promo_codes seeded");

  // promo_redemptions
  const codes = await sql`SELECT id, code FROM promo_codes WHERE code IN ('WELCOME20', 'SAVE10') LIMIT 2`;
  for (const c of codes) {
    await sql`INSERT INTO promo_redemptions (promo_code_id, user_id, discount_applied, currency) VALUES
      (${c.id}, 1, 5.00, 'USD')
    ON CONFLICT DO NOTHING`;
  }
  console.log("✓ promo_redemptions seeded");

  // scheduled_transfers
  await sql`INSERT INTO scheduled_transfers (user_id, from_currency, to_currency, amount, frequency, status, next_run_at, description) VALUES
    (1, 'USD', 'NGN', 200.00, 'monthly', 'active', NOW() + INTERVAL '30 days', 'Monthly family support'),
    (1, 'GBP', 'KES', 150.00, 'weekly', 'active', NOW() + INTERVAL '7 days', 'Weekly business payment'),
    (1, 'USD', 'GHS', 100.00, 'monthly', 'paused', NOW() + INTERVAL '30 days', 'Paused savings transfer'),
    (1, 'EUR', 'ZAR', 300.00, 'quarterly', 'active', NOW() + INTERVAL '90 days', 'Quarterly investment')
  ON CONFLICT DO NOTHING`;
  console.log("✓ scheduled_transfers seeded");

  // user_notif_prefs
  await sql`INSERT INTO user_notif_prefs (user_id, email_transactions, email_marketing, email_security, push_transactions, push_marketing, sms_transactions, fx_alert_enabled, fx_alert_threshold, fx_alert_currency) VALUES
    (1, true, false, true, true, false, false, true, 5.0, 'USD')
  ON CONFLICT (user_id) DO UPDATE SET email_transactions = EXCLUDED.email_transactions`;
  console.log("✓ user_notif_prefs seeded");

  // daily_volume_snapshots (30 days)
  for (let i = 0; i < 30; i++) {
    const date = new Date(Date.now() - i * 86400000).toISOString().split("T")[0];
    const txCount = Math.floor(Math.random() * 50) + 10;
    const totalUsd = (Math.random() * 50000 + 5000).toFixed(2);
    const feesUsd = (Number(totalUsd) * 0.015).toFixed(2);
    await sql`INSERT INTO daily_volume_snapshots (snapshot_date, total_transactions, total_volume_usd, total_fees_usd, unique_senders, top_corridor) VALUES
      (${date}, ${txCount}, ${totalUsd}, ${feesUsd}, ${Math.floor(txCount * 0.8)}, 'USD→NGN')
    ON CONFLICT DO NOTHING`;
  }
  console.log("✓ daily_volume_snapshots seeded (30 days)");

  await sql.end();
  console.log("✅ v86 seed complete");
}

seed().catch(e => { console.error(e); process.exit(1); });
