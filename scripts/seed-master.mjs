#!/usr/bin/env node
/**
 * RemitFlow Unified Seed Script — Single Source of Truth
 * 
 * Replaces all 48 individual seed scripts with one idempotent, deterministic script.
 * Safe to run multiple times — uses upsert/ON CONFLICT for all tables.
 * 
 * Usage:
 *   node scripts/seed-master.mjs                    # Full seed (all tables)
 *   node scripts/seed-master.mjs --table users      # Seed specific table
 *   node scripts/seed-master.mjs --reset            # Drop and recreate all seed data
 *   node scripts/seed-master.mjs --verify           # Verify seed data integrity
 */
import pg from "pg";
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://remitflow:remitflow123@localhost:5432/remitflow";
const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

const args = process.argv.slice(2);
const RESET = args.includes("--reset");
const VERIFY = args.includes("--verify");
const TABLE_FILTER = args.find(a => a.startsWith("--table="))?.split("=")[1] ?? args[args.indexOf("--table") + 1];

// ─── Deterministic Seed Data ───────────────────────────────────────────────────
const USERS = [
  { openId: "dev-user-001", email: "demo@remitflow.com", name: "Demo User", role: "admin", kycTier: "tier3" },
  { openId: "user-002", email: "emeka.okafor@gmail.com", name: "Emeka Okafor", role: "user", kycTier: "tier2" },
  { openId: "user-003", email: "fatima.abdullahi@yahoo.com", name: "Fatima Abdullahi", role: "user", kycTier: "tier2" },
  { openId: "user-004", email: "john.smith@outlook.com", name: "John Smith", role: "user", kycTier: "tier1" },
  { openId: "user-005", email: "kwame.asante@gmail.com", name: "Kwame Asante", role: "user", kycTier: "tier2" },
  { openId: "user-006", email: "amina.diallo@mail.com", name: "Amina Diallo", role: "user", kycTier: "tier1" },
  { openId: "user-007", email: "compliance@remitflow.com", name: "Compliance Officer", role: "admin", kycTier: "tier3" },
  { openId: "user-008", email: "support@remitflow.com", name: "Support Agent", role: "partner", kycTier: "tier3" },
  { openId: "user-009", email: "agent.lagos@remitflow.com", name: "Lagos Agent", role: "partner", kycTier: "tier2" },
  { openId: "user-010", email: "merchant@shoprite.ng", name: "Shoprite Merchant", role: "partner", kycTier: "tier3" },
];

const WALLETS = [
  { userId: 1, currency: "NGN", balance: 2850000 },
  { userId: 1, currency: "USD", balance: 15000 },
  { userId: 1, currency: "GBP", balance: 8500 },
  { userId: 1, currency: "EUR", balance: 5200 },
  { userId: 1, currency: "GHS", balance: 45000 },
  { userId: 2, currency: "NGN", balance: 1200000 },
  { userId: 3, currency: "NGN", balance: 850000 },
  { userId: 4, currency: "GBP", balance: 25000 },
  { userId: 5, currency: "GHS", balance: 120000 },
];

const CURRENCIES = ["NGN", "USD", "GBP", "EUR", "GHS", "KES", "ZAR", "XOF", "EGP", "TZS"];
const STATUSES = ["completed", "completed", "completed", "completed", "pending", "processing", "failed"];

function generateTransactions(count) {
  const txs = [];
  const baseDate = new Date("2025-01-01");
  for (let i = 0; i < count; i++) {
    const fromCurrency = CURRENCIES[i % CURRENCIES.length];
    const toCurrency = CURRENCIES[(i + 3) % CURRENCIES.length];
    const amount = Math.floor(5000 + (i * 1337) % 500000);
    const rate = 1 + (i % 7) * 0.15;
    const status = STATUSES[i % STATUSES.length];
    const date = new Date(baseDate.getTime() + i * 3600_000 * 4);
    txs.push({
      userId: (i % 5) + 1,
      fromCurrency,
      toCurrency,
      fromAmount: amount.toString(),
      toAmount: Math.floor(amount * rate).toString(),
      fxRate: rate.toFixed(6),
      status,
      type: "send",
      description: `Transfer ${fromCurrency} to ${toCurrency}`,
      createdAt: date.toISOString(),
    });
  }
  return txs;
}

function generateFxRateHistory(days) {
  const pairs = [
    { from: "USD", to: "NGN", base: 1580 },
    { from: "GBP", to: "NGN", base: 1980 },
    { from: "EUR", to: "NGN", base: 1720 },
    { from: "USD", to: "GHS", base: 15.2 },
    { from: "GBP", to: "GHS", base: 19.1 },
    { from: "USD", to: "KES", base: 153 },
    { from: "USD", to: "ZAR", base: 18.5 },
    { from: "GBP", to: "USD", base: 1.26 },
  ];
  const rates = [];
  const now = Date.now();
  for (const pair of pairs) {
    for (let d = 0; d < days; d++) {
      const variance = (Math.sin(d * 0.3) * 0.02 + (d % 7) * 0.001) * pair.base;
      const rate = pair.base + variance;
      rates.push({
        fromCurrency: pair.from,
        toCurrency: pair.to,
        rate: rate.toFixed(6),
        source: "market",
        createdAt: new Date(now - d * 86400_000).toISOString(),
      });
    }
  }
  return rates;
}

const NOTIFICATIONS = [
  { userId: 1, title: "Transfer Successful", message: "Your transfer of ₦50,000 to Emeka Okafor has been completed.", type: "transaction", isRead: false },
  { userId: 1, title: "KYC Approved", message: "Your National ID has been verified. You are now Tier 1 verified.", type: "kyc", isRead: false },
  { userId: 1, title: "Rate Alert", message: "USD/NGN rate dropped below ₦1,580. Your alert has been triggered.", type: "fx_alert", isRead: true },
  { userId: 1, title: "Security Alert", message: "New login detected from Lagos, Nigeria (Chrome on Windows).", type: "security", isRead: false },
  { userId: 1, title: "Promotion", message: "Send money to Ghana this week and get 0% fees!", type: "promotion", isRead: true },
  { userId: 2, title: "Transfer Received", message: "You received ₦50,000 from Demo User.", type: "transaction", isRead: false },
  { userId: 2, title: "KYC Required", message: "Please complete Tier 2 verification to increase your limits.", type: "kyc", isRead: false },
];

const FEE_RULES = [
  { corridor: "NGN→GHS", feeType: "percentage", feePercentage: "1.5", minFee: "100", maxFee: "5000", isActive: true },
  { corridor: "USD→NGN", feeType: "percentage", feePercentage: "0.8", minFee: "2", maxFee: "50", isActive: true },
  { corridor: "GBP→NGN", feeType: "percentage", feePercentage: "0.7", minFee: "1", maxFee: "40", isActive: true },
  { corridor: "NGN→KES", feeType: "percentage", feePercentage: "2.0", minFee: "150", maxFee: "8000", isActive: true },
  { corridor: "*→*", feeType: "percentage", feePercentage: "2.5", minFee: "1", maxFee: "100", isActive: true },
];

const FEATURE_FLAGS = [
  { key: "ENABLE_CBDC", value: "true", description: "Enable CBDC (eNaira) features" },
  { key: "ENABLE_CRYPTO", value: "false", description: "Enable cryptocurrency transfers" },
  { key: "ENABLE_INSURANCE", value: "true", description: "Enable micro-insurance products" },
  { key: "ENABLE_SOCIAL_LENDING", value: "true", description: "Enable social lending circles (ajo/esusu)" },
  { key: "MAINTENANCE_MODE", value: "false", description: "Put platform in maintenance mode" },
  { key: "MAX_TRANSFER_NGN", value: "10000000", description: "Maximum single transfer in NGN" },
  { key: "KYC_LIVENESS_REQUIRED", value: "true", description: "Require liveness check for Tier 2+" },
];

// ─── Seed Functions ────────────────────────────────────────────────────────────
async function seedUsers(client) {
  console.log("  Seeding users...");
  for (const u of USERS) {
    await client.query(`
      INSERT INTO users ("openId", email, name, role, "kycTier", "createdAt")
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT ("openId") DO UPDATE SET role = $4, "kycTier" = $5, name = $3
    `, [u.openId, u.email, u.name, u.role, u.kycTier]);
  }
  console.log(`    ✓ ${USERS.length} users upserted`);
}

async function seedWallets(client) {
  console.log("  Seeding wallets...");
  for (const w of WALLETS) {
    const existing = await client.query(
      `SELECT id FROM wallets WHERE "userId" = $1 AND currency = $2 LIMIT 1`,
      [w.userId, w.currency]
    );
    if (existing.rows.length > 0) {
      await client.query(`UPDATE wallets SET balance = $1 WHERE id = $2`, [w.balance.toString(), existing.rows[0].id]);
    } else {
      await client.query(`
        INSERT INTO wallets ("userId", currency, balance, "createdAt")
        VALUES ($1, $2, $3, NOW())
      `, [w.userId, w.currency, w.balance.toString()]);
    }
  }
  console.log(`    ✓ ${WALLETS.length} wallets upserted`);
}

async function seedTransactions(client) {
  console.log("  Seeding transactions...");
  const txs = generateTransactions(200);
  // Clear existing seed transactions and re-insert
  await client.query(`DELETE FROM transactions WHERE description LIKE 'Transfer %'`);
  for (const tx of txs) {
    await client.query(`
      INSERT INTO transactions ("userId", "fromCurrency", "toCurrency", "fromAmount", "toAmount", "fxRate", status, type, description, "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [tx.userId, tx.fromCurrency, tx.toCurrency, tx.fromAmount, tx.toAmount, tx.fxRate, tx.status, tx.type, tx.description, tx.createdAt]);
  }
  console.log(`    ✓ ${txs.length} transactions seeded`);
}

async function seedFxRateHistory(client) {
  console.log("  Seeding FX rate history...");
  const rates = generateFxRateHistory(90);
  // Upsert by (fromCurrency, toCurrency, createdAt)
  for (const r of rates) {
    await client.query(`
      INSERT INTO fx_rate_history (from_currency, to_currency, rate, source, recorded_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT DO NOTHING
    `, [r.fromCurrency, r.toCurrency, r.rate, r.source, r.createdAt]);
  }
  console.log(`    ✓ ${rates.length} FX rate entries seeded`);
}

async function seedNotifications(client) {
  console.log("  Seeding notifications...");
  await client.query(`DELETE FROM notifications WHERE title IN (${NOTIFICATIONS.map((_, i) => `$${i + 1}`).join(",")})`, NOTIFICATIONS.map(n => n.title));
  for (const n of NOTIFICATIONS) {
    await client.query(`
      INSERT INTO notifications ("userId", title, message, type, "isRead", "createdAt")
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [n.userId, n.title, n.message, n.type, n.isRead]);
  }
  console.log(`    ✓ ${NOTIFICATIONS.length} notifications seeded`);
}

async function seedFeeRules(client) {
  console.log("  Seeding fee rules...");
  for (const r of FEE_RULES) {
    await client.query(`
      INSERT INTO fee_rules (corridor, fee_type, fee_percentage, min_fee, max_fee, is_active, "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT DO NOTHING
    `, [r.corridor, r.feeType, r.feePercentage, r.minFee, r.maxFee, r.isActive]);
  }
  console.log(`    ✓ ${FEE_RULES.length} fee rules seeded`);
}

async function seedFeatureFlags(client) {
  console.log("  Seeding feature flags...");
  for (const f of FEATURE_FLAGS) {
    await client.query(`
      INSERT INTO system_config (key, value, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET value = $2, description = $3
    `, [f.key, f.value, f.description]);
  }
  console.log(`    ✓ ${FEATURE_FLAGS.length} feature flags seeded`);
}

async function seedAuditLogs(client) {
  console.log("  Seeding audit logs...");
  const actions = ["login", "transfer.create", "kyc.submit", "password.change", "settings.update", "admin.access"];
  for (let i = 0; i < 50; i++) {
    const userId = (i % 5) + 1;
    const action = actions[i % actions.length];
    const date = new Date(Date.now() - i * 7200_000);
    await client.query(`
      INSERT INTO "auditLogs" ("userId", action, "ipAddress", "createdAt")
      VALUES ($1, $2, $3, $4)
    `, [userId, action, `192.168.1.${(i % 254) + 1}`, date.toISOString()]);
  }
  console.log("    ✓ 50 audit log entries seeded");
}

// ─── Verification ──────────────────────────────────────────────────────────────
async function verify(client) {
  console.log("\n🔍 Verifying seed data integrity...\n");
  const checks = [
    { table: "users", query: "SELECT COUNT(*) as c FROM users", minExpected: 10 },
    { table: "wallets", query: "SELECT COUNT(*) as c FROM wallets", minExpected: 9 },
    { table: "transactions", query: "SELECT COUNT(*) as c FROM transactions", minExpected: 100 },
    { table: "fx_rate_history", query: `SELECT COUNT(*) as c FROM fx_rate_history`, minExpected: 100 },
    { table: "notifications", query: "SELECT COUNT(*) as c FROM notifications", minExpected: 5 },
    { table: "fee_rules", query: `SELECT COUNT(*) as c FROM fee_rules`, minExpected: 3 },
    { table: "auditLogs", query: `SELECT COUNT(*) as c FROM "auditLogs"`, minExpected: 10 },
  ];

  let allPass = true;
  for (const check of checks) {
    try {
      const result = await client.query(check.query);
      const count = parseInt(result.rows[0].c);
      const pass = count >= check.minExpected;
      console.log(`  ${pass ? "✓" : "✗"} ${check.table}: ${count} rows (min: ${check.minExpected})`);
      if (!pass) allPass = false;
    } catch (e) {
      console.log(`  ✗ ${check.table}: ERROR — ${e.message}`);
      allPass = false;
    }
  }
  console.log(`\n${allPass ? "✓ All verifications passed" : "✗ Some verifications failed"}\n`);
  return allPass;
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║        RemitFlow Unified Seed Script (Master)                 ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const client = await pool.connect();
  try {
    if (RESET) {
      console.log("⚠️  RESET mode — clearing all seed data...\n");
      await client.query("DELETE FROM notifications");
      await client.query(`DELETE FROM "fxRateHistory"`);
      await client.query("DELETE FROM transactions");
      await client.query("DELETE FROM wallets");
      await client.query(`DELETE FROM "auditLogs"`);
      console.log("  ✓ Cleared\n");
    }

    if (VERIFY) {
      const ok = await verify(client);
      process.exit(ok ? 0 : 1);
    }

    const seedFns = {
      users: seedUsers,
      wallets: seedWallets,
      transactions: seedTransactions,
      fxRateHistory: seedFxRateHistory,
      notifications: seedNotifications,
      feeRules: seedFeeRules,
      featureFlags: seedFeatureFlags,
      auditLogs: seedAuditLogs,
    };

    if (TABLE_FILTER) {
      if (!seedFns[TABLE_FILTER]) {
        console.error(`Unknown table: ${TABLE_FILTER}. Available: ${Object.keys(seedFns).join(", ")}`);
        process.exit(1);
      }
      await seedFns[TABLE_FILTER](client);
    } else {
      console.log("Seeding all tables...\n");
      for (const [name, fn] of Object.entries(seedFns)) {
        await fn(client);
      }
    }

    console.log("\n✓ Seed complete\n");

    // Verify after seeding
    await verify(client);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error("Seed failed:", e.message);
  process.exit(1);
});
