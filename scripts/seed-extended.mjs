/**
 * RemitFlow Extended Seed Script v107
 * Seeds all remaining critical business tables not covered by seed-all.mjs
 * Run after seed-all.mjs: node scripts/seed-extended.mjs
 */
import pg from "pg";
const { Client } = pg;

const POSTGRES_URL =
  process.env.LOCAL_DATABASE_URL ||
  process.env.POSTGRES_URL ||
  "postgresql://remitflow:remitflow123@localhost:5432/remitflow";
const client = new Client({ connectionString: POSTGRES_URL });
await client.connect();

async function q(sql, params = []) {
  try {
    return await client.query(sql, params);
  } catch (err) {
    if (err.code === "23505" || err.code === "23503") return; // duplicate / fk skip
    console.warn("⚠️  SQL warning:", err.message.slice(0, 120));
  }
}

console.log("🌱 RemitFlow Extended Seed v107\n");

// ─── GET EXISTING USER IDs ────────────────────────────────────────────────────
const usersResult = await q(`SELECT id, email FROM users ORDER BY id LIMIT 10`);
const users = usersResult.rows;
if (users.length === 0) {
  console.error("❌ No users found. Run seed-all.mjs first.");
  await client.end();
  process.exit(1);
}
const userId1 = users[0].id;
const userId2 = users[1]?.id || userId1;
const userId3 = users[2]?.id || userId1;
console.log(`   Using ${users.length} users for seed data`);

// ─── GET EXISTING TRANSACTION IDs ─────────────────────────────────────────────
const txResult = await q(`SELECT id, reference FROM transactions ORDER BY id LIMIT 10`);
const txs = txResult.rows;
const txId1 = txs[0]?.id || null;
const txRef1 = txs[0]?.reference || "TXN-DEMO-001";

// ─── AUDIT LOGS ───────────────────────────────────────────────────────────────
console.log("📋 Seeding audit logs...");
const auditEvents = [
  [userId1, "USER_LOGIN", "auth", "User logged in successfully", "192.168.1.100", "Mozilla/5.0 Chrome/120"],
  [userId1, "TRANSFER_INITIATED", "transaction", "Transfer of ₦50,000 to John Doe initiated", "192.168.1.100", "Mozilla/5.0 Chrome/120"],
  [userId1, "KYC_SUBMITTED", "kyc", "KYC documents submitted for review", "192.168.1.101", "Mozilla/5.0 Safari/17"],
  [userId2, "USER_LOGIN", "auth", "User logged in successfully", "10.0.0.5", "Mozilla/5.0 Firefox/121"],
  [userId2, "PROFILE_UPDATED", "profile", "User updated phone number", "10.0.0.5", "Mozilla/5.0 Firefox/121"],
  [userId1, "PASSWORD_CHANGED", "security", "User changed password", "192.168.1.100", "Mozilla/5.0 Chrome/120"],
  [userId3, "TRANSFER_COMPLETED", "transaction", "Transfer completed successfully", "172.16.0.1", "RemitFlow-Mobile/2.0"],
  [userId1, "API_KEY_CREATED", "api", "New API key created for sandbox", "192.168.1.100", "Mozilla/5.0 Chrome/120"],
  [userId2, "DISPUTE_OPENED", "dispute", "Dispute opened for transaction TXN-DEMO-001", "10.0.0.5", "Mozilla/5.0 Firefox/121"],
  [userId1, "2FA_ENABLED", "security", "Two-factor authentication enabled via TOTP", "192.168.1.100", "Mozilla/5.0 Chrome/120"],
];
for (const [uid, action, category, description, ip, ua] of auditEvents) {
  await q(
    `INSERT INTO audit_logs ("userId", action, category, description, "ipAddress", "userAgent", "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,NOW() - (random()*interval '30 days'))
     ON CONFLICT DO NOTHING`,
    [uid, action, category, description, ip, ua]
  );
}
console.log(`   ✓ ${auditEvents.length} audit log entries seeded`);

// ─── COMPLIANCE ALERTS ────────────────────────────────────────────────────────
console.log("🚨 Seeding compliance alerts...");
const complianceAlerts = [
  [userId1, "AML_THRESHOLD", "high", "Transaction exceeds AML reporting threshold of ₦5,000,000", "open", null],
  [userId2, "SANCTIONS_MATCH", "critical", "Potential sanctions list match detected - manual review required", "under_review", userId1],
  [userId3, "VELOCITY_BREACH", "medium", "User exceeded daily transfer velocity limit", "resolved", userId1],
  [userId1, "PEP_MATCH", "high", "Politically Exposed Person indicator detected", "open", null],
  [userId2, "UNUSUAL_PATTERN", "medium", "Unusual transaction pattern: 15 transfers in 2 hours", "resolved", userId1],
];
for (const [uid, alertType, severity, description, status, assignedTo] of complianceAlerts) {
  await q(
    `INSERT INTO compliance_alerts ("userId", "alertType", severity, description, status, "assignedTo", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,NOW() - (random()*interval '14 days'),NOW())
     ON CONFLICT DO NOTHING`,
    [uid, alertType, severity, description, status, assignedTo]
  );
}
console.log(`   ✓ ${complianceAlerts.length} compliance alerts seeded`);

// ─── KYC DOCUMENTS ────────────────────────────────────────────────────────────
console.log("🪪 Seeding KYC documents...");
const kycDocs = [
  [userId1, "national_id", "approved", "https://storage.remitflow.com/kyc/demo-id-front.jpg", "NGA-NIN-12345678901"],
  [userId1, "proof_of_address", "approved", "https://storage.remitflow.com/kyc/demo-poa.pdf", null],
  [userId1, "selfie", "approved", "https://storage.remitflow.com/kyc/demo-selfie.jpg", null],
  [userId2, "passport", "pending", "https://storage.remitflow.com/kyc/demo-passport.jpg", "A12345678"],
  [userId2, "proof_of_address", "pending", "https://storage.remitflow.com/kyc/demo-poa2.pdf", null],
  [userId3, "drivers_license", "rejected", "https://storage.remitflow.com/kyc/demo-dl.jpg", "DL-987654321"],
  [userId3, "national_id", "pending", "https://storage.remitflow.com/kyc/demo-id2.jpg", "NGA-NIN-98765432101"],
];
for (const [uid, docType, status, fileUrl, docNumber] of kycDocs) {
  await q(
    `INSERT INTO kyc_documents ("userId", "documentType", status, "fileUrl", "documentNumber", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,NOW() - (random()*interval '60 days'),NOW())
     ON CONFLICT DO NOTHING`,
    [uid, docType, status, fileUrl, docNumber]
  );
}
console.log(`   ✓ ${kycDocs.length} KYC documents seeded`);

// ─── FRAUD ALERTS ─────────────────────────────────────────────────────────────
console.log("🔍 Seeding fraud alerts...");
const fraudAlerts = [
  [userId1, "DEVICE_FINGERPRINT_MISMATCH", "medium", "Login from unrecognized device", "open", 0.72],
  [userId2, "VELOCITY_ANOMALY", "high", "10 transactions in 30 minutes exceeds normal pattern", "investigating", 0.89],
  [userId3, "GEO_ANOMALY", "low", "Login from new country: United Kingdom", "resolved", 0.45],
  [userId1, "AMOUNT_ANOMALY", "medium", "Transaction amount 5x above user average", "resolved", 0.68],
];
for (const [uid, alertType, severity, description, status, riskScore] of fraudAlerts) {
  await q(
    `INSERT INTO fraud_alerts ("userId", "alertType", severity, description, status, "riskScore", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,NOW() - (random()*interval '7 days'),NOW())
     ON CONFLICT DO NOTHING`,
    [uid, alertType, severity, description, status, riskScore]
  );
}
console.log(`   ✓ ${fraudAlerts.length} fraud alerts seeded`);

// ─── SAVINGS GOALS ────────────────────────────────────────────────────────────
console.log("💰 Seeding savings goals...");
const savingsGoals = [
  [userId1, "Holiday Fund", "Saving for Christmas holiday in Dubai", 500000, 125000, "2025-12-25", "active"],
  [userId1, "Emergency Fund", "6 months emergency fund", 1800000, 900000, "2025-06-30", "active"],
  [userId2, "New Car", "Toyota Camry 2025", 8000000, 2400000, "2026-03-01", "active"],
  [userId2, "School Fees", "University tuition for 2025/2026", 3500000, 3500000, "2025-09-01", "completed"],
  [userId3, "Business Capital", "Capital for food business startup", 2000000, 450000, "2025-12-31", "active"],
];
for (const [uid, name, description, targetAmount, currentAmount, targetDate, status] of savingsGoals) {
  await q(
    `INSERT INTO savings_goals ("userId", name, description, "targetAmount", "currentAmount", "targetDate", status, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW() - (random()*interval '90 days'),NOW())
     ON CONFLICT DO NOTHING`,
    [uid, name, description, targetAmount, currentAmount, targetDate, status]
  );
}
console.log(`   ✓ ${savingsGoals.length} savings goals seeded`);

// ─── EXCHANGE RATE ALERTS ─────────────────────────────────────────────────────
console.log("📈 Seeding exchange rate alerts...");
const rateAlerts = [
  [userId1, "USD", "NGN", 1600, "above", "active", "email"],
  [userId1, "GBP", "NGN", 2100, "above", "active", "push"],
  [userId2, "USD", "NGN", 1500, "below", "active", "email"],
  [userId2, "EUR", "NGN", 1700, "above", "triggered", "sms"],
  [userId3, "USD", "KES", 130, "below", "active", "email"],
];
for (const [uid, fromCurrency, toCurrency, targetRate, condition, status, notifyVia] of rateAlerts) {
  await q(
    `INSERT INTO exchange_rate_alerts ("userId", "fromCurrency", "toCurrency", "targetRate", condition, status, "notifyVia", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW() - (random()*interval '30 days'),NOW())
     ON CONFLICT DO NOTHING`,
    [uid, fromCurrency, toCurrency, targetRate, condition, status, notifyVia]
  );
}
console.log(`   ✓ ${rateAlerts.length} exchange rate alerts seeded`);

// ─── SCHEDULED TRANSFERS ──────────────────────────────────────────────────────
console.log("🔄 Seeding scheduled transfers...");
const scheduledTransfers = [
  [userId1, "Monthly rent to Lagos", 150000, "NGN", "NGN", "monthly", "2025-05-01", "active"],
  [userId1, "Weekly family support", 25000, "NGN", "NGN", "weekly", "2025-04-28", "active"],
  [userId2, "Quarterly school fees", 875000, "NGN", "NGN", "quarterly", "2025-07-01", "active"],
  [userId3, "Monthly savings", 50000, "NGN", "NGN", "monthly", "2025-05-01", "paused"],
];
for (const [uid, description, amount, fromCurrency, toCurrency, frequency, nextRunDate, status] of scheduledTransfers) {
  await q(
    `INSERT INTO scheduled_transfers ("userId", description, amount, "fromCurrency", "toCurrency", frequency, "nextRunDate", status, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW() - (random()*interval '60 days'),NOW())
     ON CONFLICT DO NOTHING`,
    [uid, description, amount, fromCurrency, toCurrency, frequency, nextRunDate, status]
  );
}
console.log(`   ✓ ${scheduledTransfers.length} scheduled transfers seeded`);

// ─── API KEYS ─────────────────────────────────────────────────────────────────
console.log("🔑 Seeding API keys...");
const apiKeys = [
  [userId1, "Production API Key", "rf_live_demo_key_abc123def456", "live", "active", '["transfers:read","transfers:write","rates:read"]'],
  [userId1, "Sandbox Test Key", "rf_test_demo_key_xyz789uvw012", "sandbox", "active", '["*"]'],
  [userId2, "Partner Integration Key", "rf_live_partner_key_mno345pqr678", "live", "active", '["rates:read","transfers:read"]'],
];
for (const [uid, name, keyHash, environment, status, permissions] of apiKeys) {
  await q(
    `INSERT INTO api_keys ("userId", name, "keyHash", environment, status, permissions, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW() - (random()*interval '90 days'),NOW())
     ON CONFLICT DO NOTHING`,
    [uid, name, keyHash, environment, status, permissions]
  );
}
console.log(`   ✓ ${apiKeys.length} API keys seeded`);

// ─── SUPPORT TICKETS ──────────────────────────────────────────────────────────
console.log("🎫 Seeding support tickets...");
const tickets = [
  [userId1, "Transaction not received", "I sent ₦50,000 to my beneficiary 2 hours ago but they haven't received it yet. Reference: TXN-DEMO-001", "open", "high", "transfers"],
  [userId2, "KYC document rejected", "My national ID was rejected but it's valid. Please review again.", "in_progress", "medium", "kyc"],
  [userId3, "Unable to add bank account", "Getting error when trying to add my GTBank account", "resolved", "low", "payment_methods"],
  [userId1, "Rate alert not working", "I set a rate alert for USD/NGN at 1600 but didn't receive notification", "open", "medium", "alerts"],
  [userId2, "Dispute status update", "My dispute from last week hasn't been updated. Case #DISP-001", "in_progress", "high", "disputes"],
];
for (const [uid, subject, description, status, priority, category] of tickets) {
  await q(
    `INSERT INTO support_tickets ("userId", subject, description, status, priority, category, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,NOW() - (random()*interval '14 days'),NOW())
     ON CONFLICT DO NOTHING`,
    [uid, subject, description, status, priority, category]
  );
}
console.log(`   ✓ ${tickets.length} support tickets seeded`);

// ─── SECURITY EVENTS ──────────────────────────────────────────────────────────
console.log("🛡️ Seeding security events...");
const securityEvents = [
  [userId1, "LOGIN_SUCCESS", "192.168.1.100", "Chrome 120 / macOS", "low"],
  [userId1, "LOGIN_FAILED", "185.220.101.5", "Unknown", "high"],
  [userId2, "PASSWORD_RESET", "10.0.0.5", "Firefox 121 / Windows", "medium"],
  [userId1, "2FA_ENABLED", "192.168.1.100", "Chrome 120 / macOS", "low"],
  [userId3, "SUSPICIOUS_LOGIN", "45.33.32.156", "Unknown / Linux", "critical"],
  [userId2, "SESSION_EXPIRED", "10.0.0.5", "Firefox 121 / Windows", "low"],
];
for (const [uid, eventType, ipAddress, userAgent, severity] of securityEvents) {
  await q(
    `INSERT INTO security_events ("userId", "eventType", "ipAddress", "userAgent", severity, "createdAt")
     VALUES ($1,$2,$3,$4,$5,NOW() - (random()*interval '30 days'))
     ON CONFLICT DO NOTHING`,
    [uid, eventType, ipAddress, userAgent, severity]
  );
}
console.log(`   ✓ ${securityEvents.length} security events seeded`);

// ─── NOTIFICATION PREFERENCES ─────────────────────────────────────────────────
console.log("🔔 Seeding notification preferences...");
for (const user of users.slice(0, 5)) {
  await q(
    `INSERT INTO notification_preferences ("userId", "emailEnabled", "pushEnabled", "smsEnabled", "transferAlerts", "rateAlerts", "securityAlerts", "marketingEmails", "weeklyDigest", "createdAt", "updatedAt")
     VALUES ($1, true, true, false, true, true, true, false, true, NOW(), NOW())
     ON CONFLICT ("userId") DO NOTHING`,
    [user.id]
  );
}
console.log(`   ✓ Notification preferences seeded for ${Math.min(users.length, 5)} users`);

// ─── SYSTEM CONFIG ────────────────────────────────────────────────────────────
console.log("⚙️ Seeding system config...");
const systemConfigs = [
  ["maintenance_mode", "false", "boolean", "Whether the platform is in maintenance mode"],
  ["max_daily_transfer_usd", "10000", "number", "Maximum daily transfer limit in USD equivalent"],
  ["fx_spread_percentage", "1.5", "number", "FX spread percentage charged on all conversions"],
  ["kyc_auto_approve_enabled", "false", "boolean", "Whether KYC documents are auto-approved"],
  ["aml_threshold_ngn", "5000000", "number", "AML reporting threshold in NGN"],
  ["support_email", "support@remitflow.com", "string", "Support email address"],
  ["platform_version", "5.0.0", "string", "Current platform version"],
  ["feature_flags_enabled", "true", "boolean", "Whether feature flags system is active"],
  ["multi_tenant_enabled", "true", "boolean", "Whether multi-tenancy is active"],
  ["white_label_enabled", "true", "boolean", "Whether white-labeling is active"],
];
for (const [key, value, valueType, description] of systemConfigs) {
  await q(
    `INSERT INTO system_config (key, value, "valueType", description, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,NOW(),NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`,
    [key, value, valueType, description]
  );
}
console.log(`   ✓ ${systemConfigs.length} system config entries seeded`);

// ─── PROMO CODES ──────────────────────────────────────────────────────────────
console.log("🎁 Seeding promo codes...");
const promoCodes = [
  ["WELCOME25", "percentage", 25, 1, 500, "2025-12-31", "active", "Welcome discount for new users"],
  ["FIRSTSEND", "fixed", 500, 1, 1000, "2025-06-30", "active", "₦500 off first transfer"],
  ["REFER50", "percentage", 50, 1, 200, "2025-12-31", "active", "Referral bonus - 50% off"],
  ["TESTMODE99", "percentage", 99, 1, 10, "2026-12-31", "active", "99% off for Stripe live mode testing"],
  ["SUMMER2025", "percentage", 20, 3, 300, "2025-08-31", "active", "Summer promotion"],
];
for (const [code, discountType, discountValue, minTransfers, maxRedemptions, expiresAt, status, description] of promoCodes) {
  await q(
    `INSERT INTO promo_codes (code, "discountType", "discountValue", "minTransfers", "maxRedemptions", "expiresAt", status, description, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
     ON CONFLICT (code) DO NOTHING`,
    [code, discountType, discountValue, minTransfers, maxRedemptions, expiresAt, status, description]
  );
}
console.log(`   ✓ ${promoCodes.length} promo codes seeded`);

// ─── VIRTUAL ACCOUNTS ─────────────────────────────────────────────────────────
console.log("🏦 Seeding virtual accounts...");
const virtualAccounts = [
  [userId1, "0123456789", "GTBank", "RemitFlow/Demo User 1", "NGN", "active"],
  [userId2, "9876543210", "Access Bank", "RemitFlow/Demo User 2", "NGN", "active"],
  [userId3, "5555444433", "Zenith Bank", "RemitFlow/Demo User 3", "NGN", "active"],
];
for (const [uid, accountNumber, bankName, accountName, currency, status] of virtualAccounts) {
  await q(
    `INSERT INTO virtual_accounts ("userId", "accountNumber", "bankName", "accountName", currency, status, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
     ON CONFLICT DO NOTHING`,
    [uid, accountNumber, bankName, accountName, currency, status]
  );
}
console.log(`   ✓ ${virtualAccounts.length} virtual accounts seeded`);

// ─── FX RATE CACHE ────────────────────────────────────────────────────────────
console.log("💱 Seeding FX rate cache...");
const fxRates = [
  ["USD", "NGN", 1580.50, 1582.00, 1579.00, 0.95],
  ["GBP", "NGN", 2020.75, 2023.00, 2018.50, -0.32],
  ["EUR", "NGN", 1720.30, 1722.50, 1718.00, 0.18],
  ["USD", "KES", 129.45, 129.80, 129.10, -0.12],
  ["USD", "GHS", 15.20, 15.35, 15.05, 0.66],
  ["USD", "ZAR", 18.65, 18.80, 18.50, -0.27],
  ["GBP", "USD", 1.2680, 1.2695, 1.2665, 0.08],
  ["EUR", "USD", 1.0850, 1.0865, 1.0835, -0.14],
];
for (const [fromCurrency, toCurrency, rate, bid, ask, change24h] of fxRates) {
  await q(
    `INSERT INTO fx_rate_cache ("fromCurrency", "toCurrency", rate, bid, ask, "change24h", "lastUpdated", "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
     ON CONFLICT ("fromCurrency", "toCurrency") DO UPDATE SET rate = EXCLUDED.rate, "lastUpdated" = NOW()`,
    [fromCurrency, toCurrency, rate, bid, ask, change24h]
  );
}
console.log(`   ✓ ${fxRates.length} FX rate cache entries seeded`);

// ─── COMPLIANCE REPORTS ───────────────────────────────────────────────────────
console.log("📊 Seeding compliance reports...");
const complianceReports = [
  ["CTR_MONTHLY", "2025-03-01", "2025-03-31", "submitted", "Monthly Currency Transaction Report - March 2025", 12, 45000000],
  ["STR_QUARTERLY", "2025-01-01", "2025-03-31", "submitted", "Suspicious Transaction Report - Q1 2025", 3, 8500000],
  ["AML_ANNUAL", "2024-01-01", "2024-12-31", "submitted", "Annual AML Compliance Report 2024", 156, 890000000],
  ["CTR_MONTHLY", "2025-04-01", "2025-04-30", "draft", "Monthly Currency Transaction Report - April 2025", 8, 32000000],
];
for (const [reportType, periodStart, periodEnd, status, description, transactionCount, totalAmount] of complianceReports) {
  await q(
    `INSERT INTO compliance_reports ("reportType", "periodStart", "periodEnd", status, description, "transactionCount", "totalAmount", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
     ON CONFLICT DO NOTHING`,
    [reportType, periodStart, periodEnd, status, description, transactionCount, totalAmount]
  );
}
console.log(`   ✓ ${complianceReports.length} compliance reports seeded`);

// ─── REFERRAL BONUSES ─────────────────────────────────────────────────────────
console.log("🎯 Seeding referral bonuses...");
const referralBonuses = [
  [userId1, userId2, 2500, "NGN", "paid", "Referral bonus for inviting Demo User 2"],
  [userId1, userId3, 2500, "NGN", "paid", "Referral bonus for inviting Demo User 3"],
  [userId2, userId1, 2500, "NGN", "pending", "Referral bonus pending first transfer"],
];
for (const [referrerId, referredId, amount, currency, status, description] of referralBonuses) {
  await q(
    `INSERT INTO referral_bonuses ("referrerId", "referredId", amount, currency, status, description, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,NOW() - (random()*interval '30 days'),NOW())
     ON CONFLICT DO NOTHING`,
    [referrerId, referredId, amount, currency, status, description]
  );
}
console.log(`   ✓ ${referralBonuses.length} referral bonuses seeded`);

// ─── RECURRING PAYMENTS ───────────────────────────────────────────────────────
console.log("🔁 Seeding recurring payments...");
const recurringPayments = [
  [userId1, "Netflix Subscription", 4500, "NGN", "monthly", "2025-05-01", "active"],
  [userId1, "DSTV Premium", 24500, "NGN", "monthly", "2025-05-15", "active"],
  [userId2, "Electricity Bill", 15000, "NGN", "monthly", "2025-05-01", "active"],
  [userId2, "Internet (Spectranet)", 18000, "NGN", "monthly", "2025-05-10", "paused"],
];
for (const [uid, description, amount, currency, frequency, nextPaymentDate, status] of recurringPayments) {
  await q(
    `INSERT INTO recurring_payments ("userId", description, amount, currency, frequency, "nextPaymentDate", status, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW() - (random()*interval '90 days'),NOW())
     ON CONFLICT DO NOTHING`,
    [uid, description, amount, currency, frequency, nextPaymentDate, status]
  );
}
console.log(`   ✓ ${recurringPayments.length} recurring payments seeded`);

// ─── RATE LOCKS ───────────────────────────────────────────────────────────────
console.log("🔒 Seeding rate locks...");
const rateLocks = [
  [userId1, "USD", "NGN", 1580.50, 50000, "NGN", "2025-04-25 18:00:00", "active"],
  [userId2, "GBP", "NGN", 2020.75, 100000, "NGN", "2025-04-24 12:00:00", "expired"],
];
for (const [uid, fromCurrency, toCurrency, lockedRate, amount, currency, expiresAt, status] of rateLocks) {
  await q(
    `INSERT INTO rate_locks ("userId", "fromCurrency", "toCurrency", "lockedRate", amount, currency, "expiresAt", status, "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW() - interval '1 hour')
     ON CONFLICT DO NOTHING`,
    [uid, fromCurrency, toCurrency, lockedRate, amount, currency, expiresAt, status]
  );
}
console.log(`   ✓ ${rateLocks.length} rate locks seeded`);

// ─── FINAL SUMMARY ────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════");
await client.query("ANALYZE");
const finalCounts = await client.query(`
  SELECT relname as tbl, n_live_tup as rows
  FROM pg_stat_user_tables
  WHERE n_live_tup > 0
  ORDER BY n_live_tup DESC
  LIMIT 30
`);
console.log("  Top 30 tables with data:");
for (const row of finalCounts.rows) {
  console.log(`    ${row.tbl.padEnd(35)} ${row.rows} rows`);
}
console.log("══════════════════════════════════════════════════════");
console.log("✅ Extended seed complete!\n");
await client.end();
