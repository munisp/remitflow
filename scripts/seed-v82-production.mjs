/**
 * RemitFlow — v82 Production Seed Script
 * Seeds the 6 new v82 feature tables with realistic data:
 *   - treasury_positions
 *   - sla_incidents
 *   - document_vault
 *   - chargebacks
 *   - notification_center_items
 *   - fx_forward_contracts
 *
 * Usage:
 *   node scripts/seed-v82-production.mjs
 *
 * Idempotent: uses ON CONFLICT DO NOTHING where possible.
 */
import pg from "pg";
const { Client } = pg;

const POSTGRES_URL =
  process.env.LOCAL_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://remitflow:remitflow123@localhost:5432/remitflow";

const client = new Client({ connectionString: POSTGRES_URL });
await client.connect();
console.log("✅ Connected to PostgreSQL");

async function q(sql, params = []) {
  try {
    return await client.query(sql, params);
  } catch (err) {
    if (err.code === "23505" || err.code === "23503") return; // duplicate / fk skip
    console.warn("⚠️  SQL warning:", err.message.slice(0, 160));
  }
}

function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); }
function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); }

// ── Get first user id for FK references ──────────────────────────────────────
const userRes = await q("SELECT id FROM users LIMIT 5");
const userIds = (userRes?.rows || []).map(r => r.id);
const userId = userIds[0] || 1;

console.log(`\n📦 Seeding v82 tables for ${userIds.length} users...\n`);

// ── 1. TREASURY POSITIONS ────────────────────────────────────────────────────
console.log("💰 Seeding treasury_positions...");
const currencies = ["USD", "GBP", "EUR", "NGN", "KES", "GHS", "ZAR", "INR", "PHP", "MXN"];
const counterparties = ["Barclays Bank", "Standard Chartered", "Citibank", "JP Morgan", "HSBC", "Deutsche Bank", "BNP Paribas", "UBS", "Goldman Sachs", "Morgan Stanley"];

// Create table if it doesn't exist (graceful)
await q(`
  CREATE TABLE IF NOT EXISTS treasury_positions (
    id SERIAL PRIMARY KEY,
    currency VARCHAR(10) NOT NULL,
    balance DECIMAL(20,4) NOT NULL DEFAULT 0,
    available DECIMAL(20,4) NOT NULL DEFAULT 0,
    reserved DECIMAL(20,4) NOT NULL DEFAULT 0,
    counterparty VARCHAR(200),
    account_number VARCHAR(100),
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);

for (const currency of currencies) {
  const balance = rnd(50000, 5000000) + rnd(0, 99) / 100;
  const reserved = rnd(1000, 50000);
  await q(
    `INSERT INTO treasury_positions (currency, balance, available, reserved, counterparty, account_number, last_updated)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT DO NOTHING`,
    [currency, balance, balance - reserved, reserved, pick(counterparties), `ACC-${rnd(10000000, 99999999)}`]
  );
}
console.log(`  ✓ Seeded ${currencies.length} treasury positions`);

// ── 2. SLA INCIDENTS ─────────────────────────────────────────────────────────
console.log("🚨 Seeding sla_incidents...");
await q(`
  CREATE TABLE IF NOT EXISTS sla_incidents (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'medium',
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    service VARCHAR(100),
    description TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    duration_minutes INTEGER,
    affected_users INTEGER DEFAULT 0,
    root_cause TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);

const incidents = [
  { title: "FX Rate Feed Delayed — EUR/USD 15min lag", severity: "high", service: "fx-rates", status: "resolved", daysAgoStart: 45, durationMin: 23, affected: 1240, rootCause: "Redis cache TTL misconfiguration caused stale rates to be served. Fixed by reducing TTL from 15min to 30s." },
  { title: "Transfer Processing Queue Backlog", severity: "critical", service: "transfer-engine", status: "resolved", daysAgoStart: 30, durationMin: 47, affected: 3820, rootCause: "Database connection pool exhaustion under peak load. Increased pool size from 20 to 100 connections." },
  { title: "KYC Document Upload Timeout", severity: "medium", service: "kyc", status: "resolved", daysAgoStart: 22, durationMin: 12, affected: 89, rootCause: "S3 presigned URL generation latency spike. Implemented retry logic with exponential backoff." },
  { title: "Push Notification Delivery Failure — iOS", severity: "medium", service: "notifications", status: "resolved", daysAgoStart: 18, durationMin: 35, affected: 4500, rootCause: "APNs certificate expired. Renewed and deployed new certificate." },
  { title: "API Gateway 502 Errors — /api/trpc/transfer.*", severity: "high", service: "api-gateway", status: "resolved", daysAgoStart: 12, durationMin: 8, affected: 620, rootCause: "Nginx upstream keepalive timeout mismatch. Aligned keepalive_timeout across all services." },
  { title: "Compliance Report Generation Timeout", severity: "low", service: "compliance", status: "resolved", daysAgoStart: 7, durationMin: 4, affected: 2, rootCause: "Large dataset query missing index on created_at. Added composite index." },
  { title: "Mobile App Login Loop — Android 14", severity: "medium", service: "auth", status: "resolved", daysAgoStart: 5, durationMin: 90, affected: 2100, rootCause: "JWT cookie SameSite=None rejected by Android WebView in strict mode. Implemented token-based fallback." },
  { title: "FX Forward Contract Settlement Delay", severity: "high", service: "fx-hedging", status: "investigating", daysAgoStart: 1, durationMin: null, affected: 34, rootCause: null },
  { title: "Elevated Error Rate — /api/trpc/savings.*", severity: "low", service: "savings", status: "monitoring", daysAgoStart: 0, durationMin: null, affected: 12, rootCause: null },
];

for (const inc of incidents) {
  const startedAt = daysAgo(inc.daysAgoStart);
  const resolvedAt = inc.status === "resolved" ? new Date(new Date(startedAt).getTime() + inc.durationMin * 60000).toISOString() : null;
  await q(
    `INSERT INTO sla_incidents (title, severity, status, service, started_at, resolved_at, duration_minutes, affected_users, root_cause)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [inc.title, inc.severity, inc.status, inc.service, startedAt, resolvedAt, inc.durationMin, inc.affected, inc.rootCause]
  );
}
console.log(`  ✓ Seeded ${incidents.length} SLA incidents`);

// ── 3. DOCUMENT VAULT ────────────────────────────────────────────────────────
console.log("📄 Seeding document_vault...");
await q(`
  CREATE TABLE IF NOT EXISTS document_vault (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(500) NOT NULL,
    type VARCHAR(100) NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'kyc',
    file_url TEXT,
    file_key TEXT,
    file_size INTEGER,
    mime_type VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    expires_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    verified_by VARCHAR(200),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`);

const docTypes = [
  { name: "Passport — John Adebayo", type: "passport", category: "kyc", expiryDays: 1200, status: "verified", verifiedBy: "Onfido AI" },
  { name: "Proof of Address — Utility Bill", type: "utility_bill", category: "kyc", expiryDays: 90, status: "verified", verifiedBy: "Manual Review" },
  { name: "Bank Statement — Barclays Q1 2026", type: "bank_statement", category: "financial", expiryDays: 180, status: "active", verifiedBy: null },
  { name: "Business Registration Certificate", type: "business_registration", category: "compliance", expiryDays: 730, status: "verified", verifiedBy: "Compliance Team" },
  { name: "AML Training Certificate", type: "training_certificate", category: "compliance", expiryDays: 365, status: "active", verifiedBy: null },
  { name: "National ID Card — Amara Osei", type: "national_id", category: "kyc", expiryDays: 1800, status: "verified", verifiedBy: "Jumio" },
  { name: "Source of Funds Declaration", type: "sof_declaration", category: "compliance", expiryDays: 365, status: "pending", verifiedBy: null },
  { name: "Director Identification — Maria Santos", type: "director_id", category: "kyc", expiryDays: 1500, status: "verified", verifiedBy: "Onfido AI" },
  { name: "FCA Authorisation Letter", type: "regulatory_approval", category: "regulatory", expiryDays: 365, status: "active", verifiedBy: null },
  { name: "PCI DSS Compliance Certificate 2025", type: "pci_certificate", category: "compliance", expiryDays: 120, status: "active", verifiedBy: null },
  { name: "ISO 27001 Certification", type: "iso_certificate", category: "compliance", expiryDays: 730, status: "active", verifiedBy: null },
  { name: "GDPR Data Processing Agreement", type: "dpa", category: "legal", expiryDays: 1095, status: "active", verifiedBy: null },
];

for (const doc of docTypes) {
  const uid = pick(userIds) || userId;
  await q(
    `INSERT INTO document_vault (user_id, name, type, category, file_url, file_size, mime_type, status, expires_at, verified_at, verified_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      uid, doc.name, doc.type, doc.category,
      `https://storage.remitflow.com/vault/${doc.type}-${rnd(1000,9999)}.pdf`,
      rnd(50000, 5000000), "application/pdf", doc.status,
      daysFromNow(doc.expiryDays),
      doc.status === "verified" ? daysAgo(rnd(1, 30)) : null,
      doc.verifiedBy
    ]
  );
}
console.log(`  ✓ Seeded ${docTypes.length} document vault entries`);

// ── 4. CHARGEBACKS ───────────────────────────────────────────────────────────
console.log("⚖️  Seeding chargebacks...");
await q(`
  CREATE TABLE IF NOT EXISTS chargebacks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    transaction_reference VARCHAR(200),
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    reason VARCHAR(500) NOT NULL,
    reason_code VARCHAR(50),
    status VARCHAR(50) NOT NULL DEFAULT 'open',
    card_network VARCHAR(50),
    merchant_name VARCHAR(200),
    dispute_deadline TIMESTAMPTZ,
    evidence_submitted_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolution VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`);

const chargebackData = [
  { ref: "TXN-2026-001234", amount: 450.00, currency: "USD", reason: "Unauthorized transaction — card not present", reasonCode: "4853", status: "won", network: "Visa", merchant: "Online Store XYZ", daysAgo_: 60, resolution: "won" },
  { ref: "TXN-2026-002891", amount: 1200.00, currency: "GBP", reason: "Service not received — transfer failed but charged", reasonCode: "4855", status: "lost", network: "Mastercard", merchant: "RemitFlow Transfer", daysAgo_: 45, resolution: "lost" },
  { ref: "TXN-2026-003445", amount: 89.99, currency: "EUR", reason: "Duplicate transaction", reasonCode: "4834", status: "won", network: "Visa", merchant: "Subscription Service", daysAgo_: 30, resolution: "won" },
  { ref: "TXN-2026-004112", amount: 2500.00, currency: "USD", reason: "Fraudulent transaction — identity theft", reasonCode: "10.4", status: "evidence_submitted", network: "Amex", merchant: "Wire Transfer", daysAgo_: 15, resolution: null },
  { ref: "TXN-2026-005678", amount: 350.00, currency: "NGN", reason: "Goods not as described", reasonCode: "4853", status: "open", network: "Verve", merchant: "Local Merchant", daysAgo_: 7, resolution: null },
  { ref: "TXN-2026-006234", amount: 175.50, currency: "GBP", reason: "Credit not processed", reasonCode: "4860", status: "open", network: "Mastercard", merchant: "Retail Store", daysAgo_: 3, resolution: null },
  { ref: "TXN-2026-007891", amount: 5000.00, currency: "USD", reason: "Unauthorized recurring charge", reasonCode: "4853", status: "investigating", network: "Visa", merchant: "SaaS Platform", daysAgo_: 1, resolution: null },
];

for (const cb of chargebackData) {
  const uid = pick(userIds) || userId;
  const createdAt = daysAgo(cb.daysAgo_);
  const deadline = new Date(new Date(createdAt).getTime() + 45 * 24 * 60 * 60 * 1000).toISOString();
  const resolvedAt = cb.resolution ? daysAgo(Math.max(0, cb.daysAgo_ - 20)) : null;
  await q(
    `INSERT INTO chargebacks (user_id, transaction_reference, amount, currency, reason, reason_code, status, card_network, merchant_name, dispute_deadline, resolved_at, resolution, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [uid, cb.ref, cb.amount, cb.currency, cb.reason, cb.reasonCode, cb.status, cb.network, cb.merchant, deadline, resolvedAt, cb.resolution, createdAt]
  );
}
console.log(`  ✓ Seeded ${chargebackData.length} chargeback disputes`);

// ── 5. NOTIFICATION CENTER ITEMS ─────────────────────────────────────────────
console.log("🔔 Seeding notification_center_items...");
await q(`
  CREATE TABLE IF NOT EXISTS notification_center_items (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    body TEXT NOT NULL,
    type VARCHAR(100) NOT NULL DEFAULT 'info',
    category VARCHAR(100) NOT NULL DEFAULT 'system',
    is_read BOOLEAN NOT NULL DEFAULT false,
    action_url TEXT,
    icon VARCHAR(100),
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);

const notifications = [
  { title: "Transfer Completed", body: "Your transfer of £500.00 to Amara Osei has been delivered successfully.", type: "success", category: "transfer", icon: "check-circle", priority: "high", daysAgo_: 0, read: false },
  { title: "FX Rate Alert — GBP/NGN", body: "GBP/NGN has reached your target rate of 2,050. Click to send money now.", type: "alert", category: "fx", icon: "trending-up", priority: "high", daysAgo_: 0, read: false },
  { title: "KYC Verification Approved", body: "Your identity verification has been approved. You now have full access to all features.", type: "success", category: "kyc", icon: "shield-check", priority: "high", daysAgo_: 1, read: true },
  { title: "New Login Detected", body: "A new login was detected from London, UK using Chrome on Windows. If this wasn't you, secure your account immediately.", type: "warning", category: "security", icon: "alert-triangle", priority: "urgent", daysAgo_: 2, read: true },
  { title: "Savings Goal Reached", body: "Congratulations! Your 'Family Support' savings goal of ₦500,000 has been reached.", type: "success", category: "savings", icon: "target", priority: "normal", daysAgo_: 3, read: true },
  { title: "Direct Debit Scheduled", body: "Your monthly direct debit of £200.00 to John Adebayo is scheduled for tomorrow.", type: "info", category: "payment", icon: "calendar", priority: "normal", daysAgo_: 4, read: true },
  { title: "Compliance Document Expiring", body: "Your Proof of Address document expires in 30 days. Please upload a new one.", type: "warning", category: "compliance", icon: "file-warning", priority: "high", daysAgo_: 5, read: false },
  { title: "Referral Bonus Earned", body: "You've earned £25 for referring Maria Santos. Bonus credited to your wallet.", type: "success", category: "rewards", icon: "gift", priority: "normal", daysAgo_: 7, read: true },
  { title: "API Key Created", body: "A new API key 'Production Key' was created. If you didn't do this, contact support.", type: "warning", category: "security", icon: "key", priority: "high", daysAgo_: 10, read: true },
  { title: "System Maintenance Scheduled", body: "Planned maintenance on April 25, 2026 from 02:00–04:00 UTC. Services may be briefly unavailable.", type: "info", category: "system", icon: "settings", priority: "normal", daysAgo_: 12, read: true },
  { title: "Investment Portfolio +8.4%", body: "Your investment portfolio has grown 8.4% this month. View your performance dashboard.", type: "success", category: "investment", icon: "bar-chart", priority: "normal", daysAgo_: 14, read: true },
  { title: "Chargeback Update", body: "Your dispute for TXN-2026-001234 has been resolved in your favour. £450.00 will be refunded.", type: "success", category: "payment", icon: "check-circle", priority: "high", daysAgo_: 15, read: true },
];

for (const notif of notifications) {
  const uid = pick(userIds) || userId;
  await q(
    `INSERT INTO notification_center_items (user_id, title, body, type, category, is_read, icon, priority, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [uid, notif.title, notif.body, notif.type, notif.category, notif.read, notif.icon, notif.priority, daysAgo(notif.daysAgo_)]
  );
}
console.log(`  ✓ Seeded ${notifications.length} notification center items`);

// ── 6. FX FORWARD CONTRACTS ──────────────────────────────────────────────────
console.log("📈 Seeding fx_forward_contracts...");
await q(`
  CREATE TABLE IF NOT EXISTS fx_forward_contracts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    reference VARCHAR(100) UNIQUE NOT NULL,
    base_currency VARCHAR(10) NOT NULL,
    quote_currency VARCHAR(10) NOT NULL,
    notional_amount DECIMAL(20,4) NOT NULL,
    locked_rate DECIMAL(20,8) NOT NULL,
    spot_rate_at_booking DECIMAL(20,8),
    settlement_date TIMESTAMPTZ NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    counterparty VARCHAR(200),
    purpose VARCHAR(200),
    margin_required DECIMAL(12,4),
    margin_posted DECIMAL(12,4),
    unrealized_pnl DECIMAL(12,4),
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);

const forwardContracts = [
  { base: "GBP", quote: "NGN", notional: 50000, lockedRate: 2045.50, spotAtBooking: 2038.20, settleDays: 30, status: "active", counterparty: "Barclays FX Desk", purpose: "Payroll hedging — Nigeria operations", margin: 2500 },
  { base: "USD", quote: "KES", notional: 100000, lockedRate: 129.45, spotAtBooking: 130.10, settleDays: 60, status: "active", counterparty: "Standard Chartered", purpose: "Import payment hedge", margin: 5000 },
  { base: "EUR", quote: "GHS", notional: 25000, lockedRate: 16.82, spotAtBooking: 16.75, settleDays: 90, status: "active", counterparty: "Citibank FX", purpose: "Supplier payment hedge", margin: 1250 },
  { base: "GBP", quote: "ZAR", notional: 75000, lockedRate: 23.15, spotAtBooking: 23.40, settleDays: -10, status: "settled", counterparty: "HSBC FX", purpose: "Investment repatriation", margin: 3750 },
  { base: "USD", quote: "PHP", notional: 200000, lockedRate: 56.20, spotAtBooking: 56.80, settleDays: -5, status: "settled", counterparty: "JP Morgan FX", purpose: "Remittance corridor hedge", margin: 10000 },
  { base: "GBP", quote: "INR", notional: 30000, lockedRate: 107.85, spotAtBooking: 107.20, settleDays: 45, status: "active", counterparty: "Deutsche Bank", purpose: "IT services payment hedge", margin: 1500 },
  { base: "EUR", quote: "NGN", notional: 40000, lockedRate: 2198.30, spotAtBooking: 2185.60, settleDays: -20, status: "expired", counterparty: "BNP Paribas", purpose: "Trade finance hedge", margin: 2000 },
];

for (const fc of forwardContracts) {
  const uid = pick(userIds) || userId;
  const ref = `FWD-${new Date().getFullYear()}-${rnd(10000, 99999)}`;
  const settleDate = fc.settleDays >= 0 ? daysFromNow(fc.settleDays) : daysAgo(Math.abs(fc.settleDays));
  const settledAt = fc.status === "settled" ? daysAgo(Math.abs(fc.settleDays) - 1) : null;
  const unrealizedPnl = fc.status === "active" ? (fc.lockedRate - fc.spotAtBooking) * fc.notional * 0.001 : 0;
  await q(
    `INSERT INTO fx_forward_contracts (user_id, reference, base_currency, quote_currency, notional_amount, locked_rate, spot_rate_at_booking, settlement_date, status, counterparty, purpose, margin_required, margin_posted, unrealized_pnl, settled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (reference) DO NOTHING`,
    [uid, ref, fc.base, fc.quote, fc.notional, fc.lockedRate, fc.spotAtBooking, settleDate, fc.status, fc.counterparty, fc.purpose, fc.margin, fc.margin, unrealizedPnl.toFixed(4), settledAt]
  );
}
console.log(`  ✓ Seeded ${forwardContracts.length} FX forward contracts`);

// ── SUMMARY ──────────────────────────────────────────────────────────────────
console.log(`
╔══════════════════════════════════════════════════════╗
║       RemitFlow v82 Seed Complete                    ║
╠══════════════════════════════════════════════════════╣
║  treasury_positions           ${currencies.length.toString().padStart(3)} records             ║
║  sla_incidents                ${incidents.length.toString().padStart(3)} records             ║
║  document_vault               ${docTypes.length.toString().padStart(3)} records             ║
║  chargebacks                  ${chargebackData.length.toString().padStart(3)} records             ║
║  notification_center_items    ${notifications.length.toString().padStart(3)} records             ║
║  fx_forward_contracts         ${forwardContracts.length.toString().padStart(3)} records             ║
╚══════════════════════════════════════════════════════╝
`);

await client.end();
