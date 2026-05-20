/**
 * RemitFlow v73 Seed Script
 * Seeds new production tables:
 *   - system_config
 *   - compliance_watchlist
 *   - partner_payouts
 *   - webhook_endpoints
 *   - api_keys
 *   - fx_rate_history
 *   - payment_gateway_logs
 *
 * Run: DATABASE_URL=$LOCAL_DATABASE_URL node scripts/seed-v73.mjs
 */
import pg from "pg";
import { randomBytes, createHash } from "crypto";

const DB_URL = process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();
console.log("✓ Connected to database");

function randomRef(prefix = "PAY") {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}
function daysAgo(n) { return new Date(Date.now() - n * 86400000); }
function randomBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ─── Get user/admin ids ────────────────────────────────────────────────────
const { rows: adminRows } = await client.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
const adminId = adminRows[0]?.id ?? 1;
const { rows: userRows } = await client.query(`SELECT id FROM users LIMIT 5`);
const userIds = userRows.map(r => r.id);
const userId1 = userIds[0] ?? 1;
const userId2 = userIds[1] ?? 1;

// ─── Get tenant ids ────────────────────────────────────────────────────────
const { rows: tenantRows } = await client.query(`SELECT id, name FROM tenants LIMIT 5`);
const tenantIds = tenantRows.map(r => r.id);
const tenantId1 = tenantIds[0] ?? null;
const tenantId2 = tenantIds[1] ?? null;

// ─── System Config ─────────────────────────────────────────────────────────
console.log("\n⚙️  Seeding system_config...");
const systemConfigs = [
  { key: "maintenance_mode",      value: "false",                    description: "Toggle maintenance mode",                   isSecret: false },
  { key: "max_transfer_usd",      value: "50000",                    description: "Maximum single transfer amount in USD",      isSecret: false },
  { key: "min_transfer_usd",      value: "0.50",                     description: "Minimum single transfer amount in USD",      isSecret: false },
  { key: "default_fee_percent",   value: "1.5",                      description: "Default transfer fee percentage",            isSecret: false },
  { key: "kyc_review_sla_hours",  value: "24",                       description: "KYC review SLA in hours",                   isSecret: false },
  { key: "aml_ctr_threshold_usd", value: "10000",                    description: "CTR reporting threshold in USD",             isSecret: true  },
  { key: "fraud_score_threshold", value: "0.75",                     description: "Fraud score threshold for auto-block",       isSecret: true  },
  { key: "referral_bonus_ngn",    value: "500",                      description: "Referral bonus amount in NGN",               isSecret: false },
  { key: "support_email",         value: "support@remitflow.com",    description: "Support email address",                     isSecret: false },
  { key: "compliance_email",      value: "compliance@remitflow.com", description: "Compliance team email",                     isSecret: true  },
  { key: "bnpl_max_credit_usd",   value: "5000",                     description: "Maximum BNPL credit limit in USD",           isSecret: true  },
  { key: "savings_default_apy",   value: "4.5",                      description: "Default savings APY percentage",             isSecret: false },
  { key: "cbdc_enabled",          value: "false",                    description: "Enable CBDC module",                        isSecret: false },
  { key: "mojaloop_enabled",      value: "true",                     description: "Enable Mojaloop integration",               isSecret: false },
  { key: "partner_revenue_share", value: "0.30",                     description: "Default partner revenue share (30%)",        isSecret: true  },
];

for (const cfg of systemConfigs) {
  await client.query(`
    INSERT INTO system_config (key, value, description, is_secret, updated_by, "updatedAt")
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, "updatedAt" = NOW()
  `, [cfg.key, cfg.value, cfg.description, cfg.isSecret, adminId]);
}
console.log(`  ✓ Seeded ${systemConfigs.length} system config entries`);

// ─── Compliance Watchlist ──────────────────────────────────────────────────
// compliance_watchlist: id, user_id, name, date_of_birth, nationality, id_number,
//   status (watchlist_status), risk_score, matched_lists (json), notes, reviewed_by, reviewed_at
console.log("\n🚨 Seeding compliance_watchlist...");
const watchlistEntries = [
  { name: "John Doe Test",         nationality: "US", status: "flagged",  riskScore: 85, matchedLists: ["OFAC_SDN"],       notes: "Test OFAC SDN match" },
  { name: "Acme Shell Corp",       nationality: "KY", status: "blocked",  riskScore: 100, matchedLists: ["UN_SANCTIONS"],  notes: "UN Security Council sanctions" },
  { name: "Jane Smith Demo",       nationality: "NG", status: "flagged",  riskScore: 65, matchedLists: ["INTERNAL"],       notes: "Unusual transaction pattern" },
  { name: "Global Trade Ltd",      nationality: "SY", status: "blocked",  riskScore: 95, matchedLists: ["EU_SANCTIONS"],   notes: "EU sanctions list" },
  { name: "Demo PEP Individual",   nationality: "RU", status: "flagged",  riskScore: 70, matchedLists: ["PEP_LIST"],       notes: "Politically Exposed Person" },
  { name: "Clean User Example",    nationality: "GB", status: "clear",    riskScore: 5,  matchedLists: [],                 notes: "Routine check — clear" },
];

for (const entry of watchlistEntries) {
  const { rows: existing } = await client.query(`SELECT id FROM compliance_watchlist WHERE name = $1 LIMIT 1`, [entry.name]);
  if (existing.length === 0) {
    await client.query(`
      INSERT INTO compliance_watchlist (name, nationality, status, risk_score, matched_lists, notes, "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    `, [entry.name, entry.nationality, entry.status, entry.riskScore, JSON.stringify(entry.matchedLists), entry.notes]);
  }
}
console.log(`  ✓ Seeded ${watchlistEntries.length} watchlist entries`);

// ─── Partner Payouts ───────────────────────────────────────────────────────
if (tenantId1) {
  console.log("\n💰 Seeding partner_payouts...");
  const payouts = [
    { tenantId: tenantId1,           amount: "1250.00", currency: "USD", method: "bank_transfer", status: "completed",  periodStart: daysAgo(60), periodEnd: daysAgo(31), feeRevenue: "4166.67", revenueShare: "0.30", reference: randomRef("PAY"), notes: null },
    { tenantId: tenantId1,           amount: "980.50",  currency: "USD", method: "bank_transfer", status: "completed",  periodStart: daysAgo(30), periodEnd: daysAgo(1),  feeRevenue: "3268.33", revenueShare: "0.30", reference: randomRef("PAY"), notes: null },
    { tenantId: tenantId2 ?? tenantId1, amount: "2100.00", currency: "USD", method: "paypal",     status: "pending",   periodStart: daysAgo(30), periodEnd: new Date(),   feeRevenue: "7000.00", revenueShare: "0.30", reference: randomRef("PAY"), notes: null },
    { tenantId: tenantId1,           amount: "450.75",  currency: "GBP", method: "bank_transfer", status: "processing", periodStart: daysAgo(14), periodEnd: new Date(),   feeRevenue: "1502.50", revenueShare: "0.30", reference: randomRef("PAY"), notes: null },
    { tenantId: tenantId2 ?? tenantId1, amount: "3500.00", currency: "USD", method: "bank_transfer", status: "failed", periodStart: daysAgo(45), periodEnd: daysAgo(16), feeRevenue: "11666.67", revenueShare: "0.30", reference: randomRef("PAY"), notes: "Bank transfer failed — invalid account details" },
  ];

  for (const p of payouts) {
    const { rows: existing } = await client.query(`SELECT id FROM partner_payouts WHERE reference = $1`, [p.reference]);
    if (existing.length === 0) {
      await client.query(`
        INSERT INTO partner_payouts (tenant_id, amount, currency, method, status, period_start, period_end, fee_revenue, revenue_share, reference, processed_by, notes, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      `, [p.tenantId, p.amount, p.currency, p.method, p.status, p.periodStart, p.periodEnd, p.feeRevenue, p.revenueShare, p.reference, adminId, p.notes]);
    }
  }
  console.log(`  ✓ Seeded ${payouts.length} partner payouts`);
} else {
  console.log("  ⚠ No tenants found — skipping partner payouts");
}

// ─── Webhook Endpoints ─────────────────────────────────────────────────────
console.log("\n🔗 Seeding webhook_endpoints...");
const webhookEndpoints = [
  { userId: userId1, url: "https://webhook.site/demo-remitflow-1", events: ["transfer.completed", "transfer.failed", "kyc.approved"], description: "Demo webhook for transfer events",        isActive: true  },
  { userId: userId1, url: "https://webhook.site/demo-remitflow-2", events: ["wallet.funded", "fraud.alert"],                          description: "Demo webhook for wallet/fraud events",    isActive: true  },
  { userId: userId2, url: "https://webhook.site/demo-remitflow-3", events: ["kyc.submitted", "kyc.rejected", "kyc.approved"],         description: "KYC event notifications",                 isActive: false },
];

for (const wh of webhookEndpoints) {
  const secret = `whsec_${randomBytes(28).toString("hex")}`.substring(0, 64);
  const { rows: existing } = await client.query(`SELECT id FROM webhook_endpoints WHERE url = $1 AND user_id = $2`, [wh.url, wh.userId]);
  if (existing.length === 0) {
    await client.query(`
      INSERT INTO webhook_endpoints (user_id, url, secret, events, description, is_active, "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    `, [wh.userId, wh.url, secret, JSON.stringify(wh.events), wh.description, wh.isActive]);
  }
}
console.log(`  ✓ Seeded ${webhookEndpoints.length} webhook endpoints`);

// ─── API Keys ──────────────────────────────────────────────────────────────
console.log("\n🔑 Seeding api_keys...");
const apiKeyEntries = [
  { userId: userId1, name: "Production Integration",       scopes: ["read", "write", "transfer"], status: "active"  },
  { userId: userId1, name: "Reporting Dashboard",          scopes: ["read"],                       status: "active"  },
  { userId: userId2, name: "Mobile App Backend",           scopes: ["read", "write"],              status: "active"  },
  { userId: userId1, name: "Legacy Integration (Revoked)", scopes: ["read", "write"],              status: "revoked" },
];

for (const ak of apiKeyEntries) {
  const rawKey = `rfk_${randomBytes(32).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.substring(0, 12);
  const { rows: existing } = await client.query(`SELECT id FROM api_keys WHERE name = $1 AND user_id = $2`, [ak.name, ak.userId]);
  if (existing.length === 0) {
    await client.query(`
      INSERT INTO api_keys (user_id, name, key_hash, key_prefix, scopes, status, "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    `, [ak.userId, ak.name, keyHash, keyPrefix, JSON.stringify(ak.scopes), ak.status]);
  }
}
console.log(`  ✓ Seeded ${apiKeyEntries.length} API keys`);

// ─── FX Rate History ───────────────────────────────────────────────────────
console.log("\n📈 Seeding fx_rate_history...");
const baseCurrencies = ["USD", "GBP", "EUR"];
const quoteCurrencies = ["NGN", "KES", "GHS", "ZAR", "UGX"];
const baseRates = {
  "USD-NGN": 1580, "USD-KES": 130,  "USD-GHS": 14.5, "USD-ZAR": 18.5, "USD-UGX": 3750,
  "GBP-NGN": 2000, "GBP-KES": 165,  "GBP-GHS": 18.5, "GBP-ZAR": 23.5, "GBP-UGX": 4750,
  "EUR-NGN": 1720, "EUR-KES": 142,  "EUR-GHS": 15.8, "EUR-ZAR": 20.1, "EUR-UGX": 4100,
};
let fxCount = 0;
for (const base of baseCurrencies) {
  for (const quote of quoteCurrencies) {
    const pairKey = `${base}-${quote}`;
    const baseRate = baseRates[pairKey] ?? 100;
    // Seed 30 days of daily rates
    for (let d = 30; d >= 0; d--) {
      const date = daysAgo(d);
      const fluctuation = 1 + (Math.random() - 0.5) * 0.02; // ±1% daily
      const rate = (baseRate * fluctuation).toFixed(6);
      const { rows: existing } = await client.query(
        `SELECT id FROM fx_rate_history WHERE from_currency = $1 AND to_currency = $2 AND DATE(recorded_at) = DATE($3) LIMIT 1`,
        [base, quote, date]
      );
      if (existing.length === 0) {
        await client.query(`
          INSERT INTO fx_rate_history (from_currency, to_currency, rate, source, recorded_at)
          VALUES ($1, $2, $3, 'seed', $4)
        `, [base, quote, rate, date]);
        fxCount++;
      }
    }
  }
}
console.log(`  ✓ Seeded ${fxCount} FX rate history entries`);

// ─── Payment Gateway Logs ──────────────────────────────────────────────────
// payment_gateway_logs: id, user_id, gateway (enum), gateway_tx_id, amount, currency,
//   status (gateway_tx_status), direction, metadata, error_message, ip_address, user_agent
console.log("\n📋 Seeding payment_gateway_logs...");
const gateways = ["stripe", "paypal", "flutterwave", "mpesa"];
// gateway_tx_status enum values — check what's in the DB
const { rows: statusEnumRows } = await client.query(`
  SELECT e.enumlabel FROM pg_enum e
  JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname = 'gateway_tx_status'
  ORDER BY e.enumsortorder
`);
const gwStatuses = statusEnumRows.map(r => r.enumlabel);
console.log(`  Gateway statuses available: ${gwStatuses.join(", ")}`);

let logCount = 0;
for (let i = 0; i < 25; i++) {
  const gateway = gateways[randomBetween(0, gateways.length - 1)];
  const status = gwStatuses[randomBetween(0, gwStatuses.length - 1)];
  const amount = (randomBetween(10, 5000) + Math.random()).toFixed(2);
  const currency = ["USD", "GBP", "EUR", "NGN", "KES"][randomBetween(0, 4)];
  const userId = userIds[randomBetween(0, userIds.length - 1)];
  const gwTxId = `${gateway.toUpperCase()}-${randomRef("TXN")}`;
  await client.query(`
    INSERT INTO payment_gateway_logs (user_id, gateway, gateway_tx_id, amount, currency, status, direction, metadata, "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, $6, 'credit', $7, $8, $8)
  `, [
    userId,
    gateway,
    gwTxId,
    amount,
    currency,
    status,
    JSON.stringify({ amount, currency, gateway, ref: gwTxId }),
    daysAgo(randomBetween(0, 30)),
  ]);
  logCount++;
}
console.log(`  ✓ Seeded ${logCount} payment gateway log entries`);

// ─── Done ──────────────────────────────────────────────────────────────────
await client.end();
console.log("\n✅ v73 seed complete!");
console.log("   Tables seeded: system_config, compliance_watchlist, partner_payouts, webhook_endpoints, api_keys, fx_rate_history, payment_gateway_logs");
