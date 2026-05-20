/**
 * RemitFlow Production Seed Script v5
 * Populates the database with comprehensive, realistic demo data
 * Run: node scripts/seed-production.mjs
 */

import postgres from 'postgres';
import * as dotenv from "dotenv";
dotenv.config();

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const sql = postgres(DB_URL, { max: 5, idle_timeout: 30 });
// postgres-js helper: simulates postgres2 execute(sql, params) using postgres driver
async function exec(query, params = []) {
  const parts = query.split('?');
  const strings = Object.assign(parts, { raw: parts });
  return sql(strings, ...params);
}
async function query(q, params = []) {
  const parts = q.split('?');
  const strings = Object.assign(parts, { raw: parts });
  return sql(strings, ...params);
}

const conn = { sql };
console.log("✓ Connected to database");

// ─── Helper Functions ─────────────────────────────────────────────────────────

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(daysAgo, daysAgoEnd = 0) {
  const now = Date.now();
  const start = now - daysAgo * 86400000;
  const end = now - daysAgoEnd * 86400000;
  return new Date(start + Math.random() * (end - start));
}

function randomRef() {
  return "RF" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

// ─── Demo Users ───────────────────────────────────────────────────────────────

const DEMO_USERS = [
  { openId: "demo-user-001", name: "Adaeze Okonkwo", email: "adaeze@remitflow.demo", role: "user", kycTier: "tier2", phone: "+2348012345678" },
  { openId: "demo-user-002", name: "Kwame Asante", email: "kwame@remitflow.demo", role: "user", kycTier: "tier1", phone: "+233244567890" },
  { openId: "demo-user-003", name: "Fatima Al-Hassan", email: "fatima@remitflow.demo", role: "user", kycTier: "tier2", phone: "+971501234567" },
  { openId: "demo-admin-001", name: "RemitFlow Admin", email: "admin@remitflow.demo", role: "admin", kycTier: "tier3", phone: "+447700900000" },
];

// ─── Seed Users ───────────────────────────────────────────────────────────────

console.log("\n📦 Seeding users...");
const userIds = [];
for (const u of DEMO_USERS) {
  const [existing] = await exec("SELECT id FROM users WHERE openId = ?", [u.openId]);
  if (existing.length > 0) {
    userIds.push(existing[0].id);
    console.log(`  ↳ User ${u.name} already exists (id=${existing[0].id})`);
    continue;
  }
  const [result] = await exec(
    "INSERT INTO users (openId, name, email, role, kycTier, phone, createdAt) VALUES (?, ?, ?, ?, ?, ?, NOW())",
    [u.openId, u.name, u.email, u.role, u.kycTier, u.phone]
  );
  userIds.push(result.insertId);
  console.log(`  ✓ Created user ${u.name} (id=${result.insertId})`);
}

// Use first user as primary demo user
const primaryUserId = userIds[0];

// ─── Seed Wallets ─────────────────────────────────────────────────────────────

console.log("\n💰 Seeding wallets...");
const WALLETS = [
  { currency: "NGN", balance: "2847650.00", isDefault: true },
  { currency: "USD", balance: "1842.50", isDefault: false },
  { currency: "GBP", balance: "624.30", isDefault: false },
  { currency: "EUR", balance: "890.75", isDefault: false },
  { currency: "KES", balance: "45200.00", isDefault: false },
  { currency: "GHS", balance: "8750.00", isDefault: false },
];

for (const w of WALLETS) {
  const [existing] = await exec(
    "SELECT id FROM wallets WHERE userId = ? AND currency = ?",
    [primaryUserId, w.currency]
  );
  if (existing.length > 0) {
    await exec("UPDATE wallets SET balance = ? WHERE id = ?", [w.balance, existing[0].id]);
    console.log(`  ↳ Updated ${w.currency} wallet to ${w.balance}`);
  } else {
    await exec(
      "INSERT INTO wallets (userId, currency, balance, isDefault, status, createdAt) VALUES (?, ?, ?, ?, 'active', NOW())",
      [primaryUserId, w.currency, w.balance, w.isDefault ? 1 : 0]
    );
    console.log(`  ✓ Created ${w.currency} wallet (${w.balance})`);
  }
}

// ─── Seed Transactions ────────────────────────────────────────────────────────

console.log("\n💸 Seeding transactions...");
const TRANSACTIONS = [
  // Outbound transfers
  { type: "send", status: "completed", fromCurrency: "NGN", fromAmount: "250000.00", toCurrency: "GBP", toAmount: "124.50", fee: "1250.00", fxRate: "0.000498", recipientName: "James Okonkwo", recipientAccount: "12345678", recipientBank: "Barclays UK", recipientCountry: "GB", description: "Monthly family support", daysAgo: 2 },
  { type: "send", status: "completed", fromCurrency: "NGN", fromAmount: "500000.00", toCurrency: "USD", toAmount: "325.50", fee: "2500.00", fxRate: "0.000651", recipientName: "Sarah Chen", recipientAccount: "9876543210", recipientBank: "Chase Bank", recipientCountry: "US", description: "Business payment", daysAgo: 5 },
  { type: "send", status: "completed", fromCurrency: "USD", fromAmount: "200.00", toCurrency: "KES", toAmount: "26100.00", fee: "1.00", fxRate: "130.5", recipientName: "Peter Kamau", recipientAccount: "254712345678", recipientBank: "Equity Bank", recipientCountry: "KE", description: "School fees", daysAgo: 8 },
  { type: "send", status: "pending", fromCurrency: "NGN", fromAmount: "150000.00", toCurrency: "EUR", toAmount: "88.20", fee: "750.00", fxRate: "0.000588", recipientName: "Marie Dupont", recipientAccount: "FR7612345678901234567890189", recipientBank: "BNP Paribas", recipientCountry: "FR", description: "Invoice payment", daysAgo: 0 },
  { type: "send", status: "failed", fromCurrency: "NGN", fromAmount: "75000.00", toCurrency: "GHS", toAmount: "621.00", fee: "375.00", fxRate: "0.00828", recipientName: "Kofi Mensah", recipientAccount: "0241234567", recipientBank: "GCB Bank", recipientCountry: "GH", description: "Transfer failed - insufficient funds", daysAgo: 12 },
  // Inbound
  { type: "receive", status: "completed", fromCurrency: "USD", fromAmount: "500.00", fee: "0", description: "Payment from client", daysAgo: 3 },
  { type: "receive", status: "completed", fromCurrency: "GBP", fromAmount: "200.00", fee: "0", description: "Refund received", daysAgo: 7 },
  // Top-ups
  { type: "topup", status: "completed", fromCurrency: "NGN", fromAmount: "1000000.00", fee: "0", description: "Bank transfer top-up", daysAgo: 10 },
  { type: "topup", status: "completed", fromCurrency: "USD", fromAmount: "1000.00", fee: "0", description: "Stripe card top-up", daysAgo: 15 },
  // Withdrawals
  { type: "withdrawal", status: "completed", fromCurrency: "NGN", fromAmount: "200000.00", fee: "0", description: "Withdrawal to GTBank", daysAgo: 6 },
  // More historical
  { type: "send", status: "completed", fromCurrency: "NGN", fromAmount: "320000.00", toCurrency: "USD", toAmount: "208.00", fee: "1600.00", fxRate: "0.00065", recipientName: "David Williams", recipientAccount: "1234567890", recipientBank: "Wells Fargo", recipientCountry: "US", description: "Rent payment", daysAgo: 20 },
  { type: "send", status: "completed", fromCurrency: "NGN", fromAmount: "180000.00", toCurrency: "GBP", toAmount: "89.64", fee: "900.00", fxRate: "0.000498", recipientName: "Emma Thompson", recipientAccount: "87654321", recipientBank: "HSBC UK", recipientCountry: "GB", description: "Medical expenses", daysAgo: 25 },
  { type: "send", status: "completed", fromCurrency: "NGN", fromAmount: "95000.00", toCurrency: "KES", toAmount: "8132.50", fee: "475.00", fxRate: "0.0856", recipientName: "Grace Wanjiku", recipientAccount: "254798765432", recipientBank: "KCB Bank", recipientCountry: "KE", description: "Business supplies", daysAgo: 30 },
];

for (const tx of TRANSACTIONS) {
  const createdAt = randomDate(tx.daysAgo + 1, tx.daysAgo);
  await exec(
    `INSERT INTO transactions (userId, type, status, fromCurrency, fromAmount, toCurrency, toAmount, fee, fxRate, description, recipientName, recipientAccount, recipientBank, recipientCountry, reference, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      primaryUserId, tx.type, tx.status, tx.fromCurrency, tx.fromAmount,
      tx.toCurrency ?? null, tx.toAmount ?? null, tx.fee, tx.fxRate ?? null,
      tx.description, tx.recipientName ?? null, tx.recipientAccount ?? null,
      tx.recipientBank ?? null, tx.recipientCountry ?? null,
      randomRef(), createdAt
    ]
  );
}
console.log(`  ✓ Created ${TRANSACTIONS.length} transactions`);

// ─── Seed Beneficiaries ───────────────────────────────────────────────────────

console.log("\n👥 Seeding beneficiaries...");
const BENEFICIARIES = [
  { name: "James Okonkwo", country: "GB", currency: "GBP", bankName: "Barclays UK", accountNumber: "12345678", sortCode: "20-00-00", isFavorite: true, transferCount: 8, lastTransferAmount: "250000.00" },
  { name: "Sarah Chen", country: "US", currency: "USD", bankName: "Chase Bank", accountNumber: "9876543210", routingNumber: "021000021", isFavorite: true, transferCount: 5, lastTransferAmount: "500000.00" },
  { name: "Peter Kamau", country: "KE", currency: "KES", bankName: "Equity Bank", accountNumber: "254712345678", isFavorite: false, transferCount: 3, lastTransferAmount: "200.00" },
  { name: "Marie Dupont", country: "FR", currency: "EUR", bankName: "BNP Paribas", accountNumber: "FR7612345678901234567890189", isFavorite: false, transferCount: 2, lastTransferAmount: "150000.00" },
  { name: "Kofi Mensah", country: "GH", currency: "GHS", bankName: "GCB Bank", accountNumber: "0241234567", isFavorite: false, transferCount: 1, lastTransferAmount: "75000.00" },
  { name: "David Williams", country: "US", currency: "USD", bankName: "Wells Fargo", accountNumber: "1234567890", routingNumber: "121000248", isFavorite: true, transferCount: 4, lastTransferAmount: "320000.00" },
  { name: "Emma Thompson", country: "GB", currency: "GBP", bankName: "HSBC UK", accountNumber: "87654321", sortCode: "40-02-50", isFavorite: false, transferCount: 2, lastTransferAmount: "180000.00" },
  { name: "Grace Wanjiku", country: "KE", currency: "KES", bankName: "KCB Bank", accountNumber: "254798765432", isFavorite: false, transferCount: 1, lastTransferAmount: "95000.00" },
];

for (const b of BENEFICIARIES) {
  const [existing] = await exec(
    "SELECT id FROM beneficiaries WHERE userId = ? AND accountNumber = ?",
    [primaryUserId, b.accountNumber]
  );
  if (existing.length > 0) continue;
  await exec(
    `INSERT INTO beneficiaries (userId, name, country, currency, bankName, accountNumber, isFavorite, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [primaryUserId, b.name, b.country, b.currency, b.bankName, b.bankName, b.accountNumber, b.isFavorite ? 1 : 0]
  );
}
console.log(`  ✓ Created ${BENEFICIARIES.length} beneficiaries`);

// ─── Seed Savings Goals ───────────────────────────────────────────────────────

console.log("\n🎯 Seeding savings goals...");
const SAVINGS_GOALS = [
  { name: "Emergency Fund", targetAmount: "500000.00", currentAmount: "325000.00", currency: "NGN", targetDate: new Date(Date.now() + 90 * 86400000), status: "active", autoSave: true, autoSaveAmount: "25000.00", autoSaveFrequency: "monthly" },
  { name: "UK Study Abroad", targetAmount: "5000.00", currentAmount: "1842.50", currency: "GBP", targetDate: new Date(Date.now() + 180 * 86400000), status: "active", autoSave: false, autoSaveAmount: "0", autoSaveFrequency: "monthly" },
  { name: "House Deposit", targetAmount: "10000000.00", currentAmount: "2847650.00", currency: "NGN", targetDate: new Date(Date.now() + 365 * 86400000), status: "active", autoSave: true, autoSaveAmount: "100000.00", autoSaveFrequency: "monthly" },
  { name: "Car Purchase", targetAmount: "3000000.00", currentAmount: "3000000.00", currency: "NGN", targetDate: new Date(Date.now() - 30 * 86400000), status: "completed", autoSave: false, autoSaveAmount: "0", autoSaveFrequency: "monthly" },
];

for (const g of SAVINGS_GOALS) {
  const [existing] = await exec("SELECT id FROM savings_goals WHERE userId = ? AND name = ?", [primaryUserId, g.name]);
  if (existing.length > 0) continue;
  await exec(
    `INSERT INTO savings_goals (userId, name, targetAmount, currentAmount, currency, targetDate, status, autoSave, autoSaveAmount, autoSaveFrequency, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [primaryUserId, g.name, g.targetAmount, g.currentAmount, g.currency, g.targetDate, g.status, g.autoSave ? 1 : 0, g.autoSaveAmount, g.autoSaveFrequency]
  );
}
console.log(`  ✓ Created ${SAVINGS_GOALS.length} savings goals`);

// ─── Seed Notifications ───────────────────────────────────────────────────────

console.log("\n🔔 Seeding notifications...");
const NOTIFICATIONS = [
  { title: "Transfer Completed", message: "Your transfer of ₦250,000 to James Okonkwo (UK) has been completed successfully.", type: "transfer", isRead: false, createdAt: randomDate(2) },
  { title: "FX Rate Alert", message: "GBP/NGN rate has crossed your target of 1,900. Current rate: 1,925.", type: "fx_alert", isRead: false, createdAt: randomDate(1) },
  { title: "KYC Approved", message: "Your Tier 2 KYC verification has been approved. Your daily limit is now ₦5,000,000.", type: "kyc", isRead: true, createdAt: randomDate(5) },
  { title: "Security Alert", message: "New login detected from Lagos, Nigeria. If this was you, no action needed.", type: "security", isRead: true, createdAt: randomDate(3) },
  { title: "Savings Goal Milestone", message: "You've reached 50% of your Emergency Fund goal! Keep it up.", type: "system", isRead: false, createdAt: randomDate(4) },
  { title: "Transfer Failed", message: "Your transfer of ₦75,000 to Kofi Mensah (Ghana) failed. Reason: Bank declined. Please retry.", type: "transfer", isRead: true, createdAt: randomDate(12) },
  { title: "New Feature: Batch Payments", message: "You can now send money to multiple recipients at once with our new Batch Payments feature.", type: "system", isRead: true, createdAt: randomDate(20) },
  { title: "Referral Bonus", message: "Your friend Kwame Asante joined RemitFlow using your referral code. You've earned ₦2,500!", type: "referral", isRead: false, createdAt: randomDate(7) },
];

for (const n of NOTIFICATIONS) {
  await exec(
    "INSERT INTO notifications (userId, title, message, type, isRead, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
    [primaryUserId, n.title, n.message, n.type, n.isRead ? 1 : 0, n.createdAt]
  );
}
console.log(`  ✓ Created ${NOTIFICATIONS.length} notifications`);

// ─── Seed Referrals ───────────────────────────────────────────────────────────

console.log("\n🎁 Seeding referrals...");
const referralCode = "ADAEZE2024";
const [existingRef] = await exec("SELECT id FROM referrals WHERE userId = ? AND code = ?", [primaryUserId, referralCode]);
if (!existingRef.length) {
  await exec(
    "INSERT INTO referrals (userId, code, referred_userId, status, reward_amount, createdAt) VALUES (?, ?, ?, 'paid', 2500.00, ?)",
    [primaryUserId, userIds[1] ?? primaryUserId, randomDate(7)]
  );
  await exec(
    "INSERT INTO referrals (userId, code, referred_userId, status, reward_amount, createdAt) VALUES (?, ?, ?, 'pending', 2500.00, ?)",
    [primaryUserId, userIds[2] ?? primaryUserId, randomDate(2)]
  );
  console.log("  ✓ Created 2 referrals");
}

// ─── Seed FX Alerts ───────────────────────────────────────────────────────────

console.log("\n📈 Seeding FX alerts...");
const FX_ALERTS = [
  { fromCurrency: "NGN", toCurrency: "GBP", targetRate: 0.000520, direction: "above", status: "active" },
  { fromCurrency: "NGN", toCurrency: "USD", targetRate: 0.000680, direction: "above", status: "active" },
  { fromCurrency: "USD", toCurrency: "NGN", targetRate: 1600, direction: "above", status: "triggered" },
];

for (const a of FX_ALERTS) {
  const [existing] = await exec(
    "SELECT id FROM fx_alerts WHERE userId = ? AND fromCurrency = ? AND toCurrency = ?",
    [primaryUserId, a.fromCurrency, a.toCurrency]
  );
  if (existing.length > 0) continue;
  await exec(
    "INSERT INTO fx_alerts (userId, fromCurrency, toCurrency, target_rate, direction, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, NOW())",
    [primaryUserId, a.fromCurrency, a.toCurrency, a.targetRate, a.direction, a.status]
  );
}
console.log(`  ✓ Created ${FX_ALERTS.length} FX alerts`);

// ─── Seed Recurring Payments ──────────────────────────────────────────────────

console.log("\n🔄 Seeding recurring payments...");
const RECURRING = [
  { name: "Monthly Family Support", amount: "250000.00", currency: "NGN", recipientName: "James Okonkwo", recipientAccount: "12345678", recipientBank: "Barclays UK", recipientCountry: "GB", frequency: "monthly", nextRunDate: new Date(Date.now() + 28 * 86400000), status: "active" },
  { name: "Quarterly Business Payment", amount: "500000.00", currency: "NGN", recipientName: "Sarah Chen", recipientAccount: "9876543210", recipientBank: "Chase Bank", recipientCountry: "US", frequency: "quarterly", nextRunDate: new Date(Date.now() + 60 * 86400000), status: "active" },
];

for (const r of RECURRING) {
  const [existing] = await exec("SELECT id FROM recurring_payments WHERE userId = ? AND name = ?", [primaryUserId, r.name]);
  if (existing.length > 0) continue;
  await exec(
    `INSERT INTO recurring_payments (userId, name, amount, currency, recipientName, recipientAccount, recipientBank, recipientCountry, frequency, nextRunDate, status, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [primaryUserId, r.name, r.amount, r.currency, r.recipientName, r.recipientAccount, r.recipientBank, r.recipientCountry, r.frequency, r.nextRunDate, r.status]
  );
}
console.log(`  ✓ Created ${RECURRING.length} recurring payments`);

// ─── Seed Audit Logs ──────────────────────────────────────────────────────────

console.log("\n📋 Seeding audit logs...");
const AUDIT_LOGS = [
  { action: "LOGIN", description: "User logged in from Lagos, Nigeria (IP: 197.210.x.x)", createdAt: randomDate(1) },
  { action: "TRANSFER_SENT", description: "Sent ₦250,000 NGN to James Okonkwo (GB)", createdAt: randomDate(2) },
  { action: "KYC_SUBMITTED", description: "Tier 2 KYC documents submitted for review", createdAt: randomDate(6) },
  { action: "KYC_APPROVED", description: "Tier 2 KYC verification approved by compliance team", createdAt: randomDate(5) },
  { action: "WALLET_TOPUP", description: "NGN wallet topped up by ₦1,000,000 via bank transfer", createdAt: randomDate(10) },
  { action: "PASSWORD_CHANGED", description: "Account password changed", createdAt: randomDate(15) },
  { action: "2FA_ENABLED", description: "Two-factor authentication enabled", createdAt: randomDate(20) },
  { action: "BENEFICIARY_ADDED", description: "New beneficiary added: David Williams (US)", createdAt: randomDate(25) },
  { action: "SAVINGS_GOAL_CREATED", description: "New savings goal created: UK Study Abroad", createdAt: randomDate(30) },
  { action: "TRANSFER_SENT", description: "Sent $200 USD to Peter Kamau (KE)", createdAt: randomDate(8) },
];

for (const log of AUDIT_LOGS) {
  await exec(
    "INSERT INTO audit_logs (userId, action, description, createdAt) VALUES (?, ?, ?, ?)",
    [primaryUserId, log.action, log.description, log.createdAt]
  );
}
console.log(`  ✓ Created ${AUDIT_LOGS.length} audit log entries`);

// ─── Seed Virtual Accounts ────────────────────────────────────────────────────

console.log("\n🏦 Seeding virtual accounts...");
const VIRTUAL_ACCOUNTS = [
  { currency: "NGN", accountNumber: "0123456789", bank: "GTBank", bankCode: "058", accountName: "ADAEZE OKONKWO - REMITFLOW", status: "active" },
  { currency: "GBP", accountNumber: "12345678", bank: "Barclays", bankCode: "20-00-00", accountName: "ADAEZE OKONKWO - REMITFLOW", status: "active" },
  { currency: "USD", accountNumber: "9876543210", bank: "JP Morgan Chase", bankCode: "021000021", accountName: "ADAEZE OKONKWO - REMITFLOW", status: "active" },
];

for (const va of VIRTUAL_ACCOUNTS) {
  const [existing] = await exec(
    "SELECT id FROM virtual_accounts WHERE userId = ? AND currency = ?",
    [primaryUserId, va.currency]
  );
  if (existing.length > 0) continue;
  await exec(
    "INSERT INTO virtual_accounts (userId, currency, accountNumber, bank, bankCode, accountName, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())",
    [primaryUserId, va.currency, va.accountNumber, va.bank, va.bankCode, va.accountName, va.status]
  );
}
console.log(`  ✓ Created ${VIRTUAL_ACCOUNTS.length} virtual accounts`);

// ─── Seed KYC Documents ───────────────────────────────────────────────────────

console.log("\n🪪 Seeding KYC documents...");
const KYC_DOCS = [
  { docType: "national_id", status: "approved", fileUrl: "https://cdn.remitflow.demo/kyc/national_id_001.jpg", tier: 1 },
  { docType: "proof_of_address", status: "approved", fileUrl: "https://cdn.remitflow.demo/kyc/address_001.pdf", tier: 2 },
  { docType: "selfie", status: "approved", fileUrl: "https://cdn.remitflow.demo/kyc/selfie_001.jpg", tier: 2 },
];

for (const doc of KYC_DOCS) {
  const [existing] = await exec(
    "SELECT id FROM kyc_documents WHERE userId = ? AND docType = ?",
    [primaryUserId, doc.docType]
  );
  if (existing.length > 0) continue;
  await exec(
    "INSERT INTO kyc_documents (userId, docType, status, fileUrl, tier, createdAt) VALUES (?, ?, ?, ?, ?, NOW())",
    [primaryUserId, doc.docType, doc.status, doc.fileUrl, doc.tier]
  );
}
console.log(`  ✓ Created ${KYC_DOCS.length} KYC documents`);

// ─── Seed Disputes ────────────────────────────────────────────────────────────

console.log("\n⚖️ Seeding disputes...");
const [txRows] = await exec("SELECT id FROM transactions WHERE userId = ? LIMIT 2", [primaryUserId]);
if (txRows.length > 0) {
  const [existingDispute] = await exec("SELECT id FROM disputes WHERE userId = ? LIMIT 1", [primaryUserId]);
  if (!existingDispute.length) {
    await exec(
      "INSERT INTO disputes (userId, transactionId, reason, description, status, createdAt) VALUES (?, ?, 'wrong_amount', 'Transfer amount was deducted but recipient did not receive funds', 'resolved', ?)",
      [primaryUserId, txRows[0].id, randomDate(15)]
    );
    console.log("  ✓ Created 1 dispute");
  }
}

// ─── Seed Batch Payments ──────────────────────────────────────────────────────

console.log("\n📦 Seeding batch payments...");
const [existingBatch] = await exec("SELECT id FROM batch_payments WHERE userId = ? LIMIT 1", [primaryUserId]);
if (!existingBatch.length) {
  const batchData = JSON.stringify([
    { name: "James Okonkwo", account: "12345678", bank: "Barclays UK", amount: 250000, currency: "NGN" },
    { name: "Sarah Chen", account: "9876543210", bank: "Chase Bank", amount: 500000, currency: "NGN" },
    { name: "Peter Kamau", account: "254712345678", bank: "Equity Bank", amount: 200, currency: "USD" },
  ]);
  await exec(
    "INSERT INTO batch_payments (userId, name, totalAmount, currency, recipients, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [primaryUserId, "Q1 2024 Payments", "950200.00", "NGN", batchData, "completed", randomDate(20)]
  );
  console.log("  ✓ Created 1 batch payment");
}

// ─── Seed Cards ───────────────────────────────────────────────────────────────

console.log("\n💳 Seeding cards...");
const CARDS = [
  { cardType: "virtual", cardNumber: "**** **** **** 4242", expiryMonth: 12, expiryYear: 2027, currency: "USD", status: "active", cardholderName: "ADAEZE OKONKWO", spendLimit: "500.00", currentSpend: "127.50" },
  { cardType: "physical", cardNumber: "**** **** **** 8765", expiryMonth: 6, expiryYear: 2026, currency: "NGN", status: "active", cardholderName: "ADAEZE OKONKWO", spendLimit: "500000.00", currentSpend: "85000.00" },
];

for (const c of CARDS) {
  const [existing] = await exec(
    "SELECT id FROM cards WHERE userId = ? AND cardNumber = ?",
    [primaryUserId, c.cardNumber]
  );
  if (existing.length > 0) continue;
  await exec(
    `INSERT INTO cards (userId, type, last4, expiryMonth, expiryYear, currency, status, cardholderName, spendLimit, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [primaryUserId, c.cardType, c.cardNumber.replace(/\* /g,'').slice(-4), c.expiryMonth, c.expiryYear, c.currency, c.status, c.cardholderName, c.spendLimit]
  );
}
console.log(`  ✓ Created ${CARDS.length} cards`);

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log("\n✅ Production seed complete!");
console.log("   Primary demo user ID:", primaryUserId);
console.log("   Login with: adaeze@remitflow.demo");
console.log("   Wallets: NGN, USD, GBP, EUR, KES, GHS");
console.log("   Transactions: 13 | Beneficiaries: 8 | Notifications: 8");
console.log("   Savings Goals: 4 | Recurring: 2 | Cards: 2");

await sql.end();
