/**
 * RemitFlow — Comprehensive Production Seed Script v2
 * Seeds ALL tables with realistic multi-user data.
 * Idempotent: safe to re-run (uses ON CONFLICT DO NOTHING).
 *
 * Usage:
 *   node scripts/seed-all.mjs
 */
import pg from "pg";
const { Client } = pg;

const POSTGRES_URL =
  process.env.LOCAL_DATABASE_URL ||
  process.env.POSTGRES_URL ||
  "postgresql://remitflow:remitflow123@localhost:5432/remitflow";

const client = new Client({ connectionString: POSTGRES_URL });
await client.connect();
console.log("✅ Connected to PostgreSQL");

async function q(sql, params = []) {
  try {
    return await client.query(sql, params);
  } catch (err) {
    if (err.code === "23505" || err.code === "23503") return; // duplicate / fk skip
    console.warn("⚠️  SQL warning:", err.message.slice(0, 120));
  }
}

function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function rndDate(daysAgo, daysAgoEnd = 0) {
  const now = Date.now();
  return new Date(now - rnd(daysAgoEnd, daysAgo) * 86400000);
}
function ref() { return "RF" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase(); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ─── 1. USERS ─────────────────────────────────────────────────────────────────
console.log("\n→ Seeding users...");
const USERS = [
  { openId: "demo-user-001", name: "Adaeze Okonkwo",   email: "adaeze@remitflow.demo",  phone: "+2348012345678", role: "user",  kycTier: "tier2", defaultCurrency: "NGN" },
  { openId: "demo-user-002", name: "Kwame Asante",      email: "kwame@remitflow.demo",   phone: "+233244567890", role: "user",  kycTier: "tier1", defaultCurrency: "GHS" },
  { openId: "demo-user-003", name: "Fatima Al-Hassan",  email: "fatima@remitflow.demo",  phone: "+971501234567", role: "user",  kycTier: "tier2", defaultCurrency: "AED" },
  { openId: "demo-user-004", name: "Chidi Obi",         email: "chidi@remitflow.demo",   phone: "+447700900001", role: "user",  kycTier: "tier3", defaultCurrency: "GBP" },
  { openId: "demo-user-005", name: "Amara Diallo",      email: "amara@remitflow.demo",   phone: "+221771234567", role: "user",  kycTier: "tier1", defaultCurrency: "XOF" },
  { openId: "demo-user-006", name: "Emeka Nwosu",       email: "emeka@remitflow.demo",   phone: "+2348098765432", role: "user", kycTier: "tier2", defaultCurrency: "NGN" },
  { openId: "demo-user-007", name: "Zainab Musa",       email: "zainab@remitflow.demo",  phone: "+2349011223344", role: "user", kycTier: "tier1", defaultCurrency: "NGN" },
  { openId: "demo-admin-001", name: "RemitFlow Admin",  email: "admin@remitflow.demo",   phone: "+447700900000", role: "admin", kycTier: "tier3", defaultCurrency: "GBP" },
];

const userIds = {};
for (const u of USERS) {
  const rc = "RF" + Math.random().toString(36).slice(2, 8).toUpperCase();
  const res = await q(
    `INSERT INTO users ("openId", email, name, phone, role, "kycTier", "defaultCurrency", "referralCode", "twoFactorEnabled", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5::role,$6::"kycTier",$7,$8,false,NOW(),NOW())
     ON CONFLICT ("openId") DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, "kycTier"=EXCLUDED."kycTier"
     RETURNING id`,
    [u.openId, u.email, u.name, u.phone, u.role, u.kycTier, u.defaultCurrency, rc]
  );
  if (res?.rows?.[0]) userIds[u.openId] = res.rows[0].id;
}
for (const u of USERS) {
  if (!userIds[u.openId]) {
    const res = await client.query(`SELECT id FROM users WHERE "openId"=$1`, [u.openId]);
    if (res.rows[0]) userIds[u.openId] = res.rows[0].id;
  }
}
const uid1 = userIds["demo-user-001"];
const uid2 = userIds["demo-user-002"];
const uid3 = userIds["demo-user-003"];
const uid4 = userIds["demo-user-004"];
const uid5 = userIds["demo-user-005"];
const uid6 = userIds["demo-user-006"];
const uid7 = userIds["demo-user-007"];
const adminId = userIds["demo-admin-001"];
console.log("   ✓ Users:", Object.values(userIds).filter(Boolean).length);

// ─── 2. WALLETS ───────────────────────────────────────────────────────────────
console.log("→ Seeding wallets...");
// wallets: id, userId, currency, balance, lockedBalance, isDefault, status, createdAt, updatedAt
const WALLETS = [
  [uid1, "NGN", 2450000.00, true],  [uid1, "USD", 1250.50, false], [uid1, "GBP", 320.00, false],
  [uid2, "GHS", 15000.00, true],    [uid2, "USD", 800.00, false],
  [uid3, "AED", 5000.00, true],     [uid3, "USD", 2100.00, false],
  [uid4, "GBP", 4500.00, true],     [uid4, "EUR", 1200.00, false],
  [uid5, "XOF", 500000.00, true],   [uid5, "EUR", 350.00, false],
  [uid6, "NGN", 850000.00, true],   [uid6, "USD", 450.00, false],
  [uid7, "NGN", 125000.00, true],
  [adminId, "USD", 99999.00, true],
];
for (const [userId, currency, balance, isDefault] of WALLETS) {
  if (!userId) continue;
  await q(
    `INSERT INTO wallets ("userId", currency, balance, "lockedBalance", "isDefault", status, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,0,$4,'active',NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, currency, balance, isDefault]
  );
}
console.log("   ✓ Wallets seeded");

// ─── 3. TRANSACTIONS ──────────────────────────────────────────────────────────
console.log("→ Seeding transactions...");
// transactions: id, userId, type, status, fromCurrency, fromAmount, toCurrency, toAmount, fee, fxRate, reference, description, recipientName, recipientAccount, recipientBank, recipientCountry, channel, metadata, createdAt, updatedAt
const CORRIDORS = [
  { from: "NGN", to: "GBP", rate: 0.00051, country: "GB" },
  { from: "NGN", to: "USD", rate: 0.00065, country: "US" },
  { from: "GHS", to: "USD", rate: 0.082,   country: "US" },
  { from: "AED", to: "USD", rate: 0.272,   country: "US" },
  { from: "XOF", to: "EUR", rate: 0.0015,  country: "FR" },
  { from: "GBP", to: "NGN", rate: 1960,    country: "NG" },
];
const txUserIds = [uid1, uid2, uid3, uid4, uid5, uid6, uid7].filter(Boolean);
const BENE_NAMES = ["Ngozi Okonkwo", "David Smith", "Ama Asante", "Ahmed Hassan", "Blessing Obi", "Moussa Diallo", "Chioma Nwosu", "Emeka Eze"];
const DESCRIPTIONS = ["School fees", "Family support", "Business payment", "Rent", "Medical expenses", "Investment transfer", "Salary", "Emergency funds"];
const TX_TYPES = ["send", "receive", "topup", "exchange"];
const TX_STATUSES = ["completed", "completed", "completed", "pending", "failed"];
const CHANNELS = ["mobile", "web", "api", "agent"];
for (let i = 0; i < 100; i++) {
  const userId = pick(txUserIds);
  const corridor = pick(CORRIDORS);
  const fromAmount = rnd(5000, 500000);
  const toAmount = +(fromAmount * corridor.rate).toFixed(2);
  const fee = +(fromAmount * 0.005).toFixed(2);
  const createdAt = rndDate(180, 0);
  await q(
    `INSERT INTO transactions ("userId", type, status, "fromCurrency", "fromAmount", "toCurrency", "toAmount", fee, "fxRate", reference, description, "recipientName", "recipientAccount", "recipientBank", "recipientCountry", channel, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`,
    [userId, pick(TX_TYPES), pick(TX_STATUSES), corridor.from, fromAmount, corridor.to, toAmount,
     fee, corridor.rate, ref(), pick(DESCRIPTIONS), pick(BENE_NAMES),
     "0" + rnd(100000000, 999999999), pick(["First Bank", "GTBank", "Access Bank", "Barclays", "Chase"]),
     corridor.country, pick(CHANNELS), createdAt]
  );
}
console.log("   ✓ Transactions seeded");

// ─── 4. BENEFICIARIES ─────────────────────────────────────────────────────────
console.log("→ Seeding beneficiaries...");
// beneficiaries: id, userId, name, accountNumber, bankName, bankCode, currency, country, phone, email, isFavorite, createdAt
const BENES = [
  [uid1, "Ngozi Okonkwo", "0123456789", "First Bank",   "FBNGNGLA", "NGN", "NG", "+2348011111111", true],
  [uid1, "David Smith",   "12345678",   "Barclays",     "BARCGB22", "GBP", "GB", "+447700100001",  true],
  [uid1, "Emeka Eze",     "US12345678", "Chase",        "CHASUS33", "USD", "US", "+12125551234",   false],
  [uid2, "Ama Asante",    "0201234567", "GCB Bank",     "GHCBGHAC", "GHS", "GH", "+233201234567",  true],
  [uid3, "Ahmed Hassan",  "AE12345678", "Emirates NBD", "EBILAEAD", "AED", "AE", "+971501111111",  true],
  [uid4, "Blessing Obi",  "0987654321", "GTBank",       "GTBINGLA", "NGN", "NG", "+2348099999999", true],
  [uid5, "Moussa Diallo", "SN12345678", "Ecobank",      "ECOCSNDA", "XOF", "SN", "+221771111111",  true],
  [uid6, "Chioma Nwosu",  "0811223344", "Access Bank",  "ABNGNGLA", "NGN", "NG", "+2348011223344", true],
];
for (const [userId, name, accountNumber, bankName, bankCode, currency, country, phone, isFavorite] of BENES) {
  if (!userId) continue;
  await q(
    `INSERT INTO beneficiaries ("userId", name, "accountNumber", "bankName", "bankCode", currency, country, phone, "isFavorite", "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT DO NOTHING`,
    [userId, name, accountNumber, bankName, bankCode, currency, country, phone, isFavorite]
  );
}
console.log("   ✓ Beneficiaries seeded");

// ─── 5. KYC DOCUMENTS ────────────────────────────────────────────────────────
console.log("→ Seeding KYC documents...");
// kycDocuments: id, userId, docType, status, fileUrl, fileKey, rejectionReason, expiresAt, reviewedAt, createdAt, updatedAt, supersededAt, extractedData
const KYC_DOCS = [
  [uid1, "passport",       "approved", "https://storage.remitflow.demo/kyc/passport-001.jpg", "kyc/passport-001.jpg"],
  [uid1, "utility_bill",   "approved", "https://storage.remitflow.demo/kyc/utility-001.jpg",  "kyc/utility-001.jpg"],
  [uid2, "national_id",    "approved", "https://storage.remitflow.demo/kyc/nid-002.jpg",       "kyc/nid-002.jpg"],
  [uid3, "passport",       "approved", "https://storage.remitflow.demo/kyc/passport-003.jpg", "kyc/passport-003.jpg"],
  [uid3, "bank_statement", "pending",  "https://storage.remitflow.demo/kyc/bank-003.pdf",      "kyc/bank-003.pdf"],
  [uid4, "passport",       "approved", "https://storage.remitflow.demo/kyc/passport-004.jpg", "kyc/passport-004.jpg"],
  [uid4, "proof_of_address","approved","https://storage.remitflow.demo/kyc/poa-004.pdf",       "kyc/poa-004.pdf"],
  [uid4, "selfie",         "approved", "https://storage.remitflow.demo/kyc/selfie-004.jpg",   "kyc/selfie-004.jpg"],
  [uid5, "national_id",    "pending",  "https://storage.remitflow.demo/kyc/nid-005.jpg",       "kyc/nid-005.jpg"],
  [uid6, "passport",       "approved", "https://storage.remitflow.demo/kyc/passport-006.jpg", "kyc/passport-006.jpg"],
  [uid7, "national_id",    "rejected", "https://storage.remitflow.demo/kyc/nid-007.jpg",       "kyc/nid-007.jpg"],
];
for (const [userId, docType, status, fileUrl, fileKey] of KYC_DOCS) {
  if (!userId) continue;
  const expiresAt = new Date(Date.now() + 3 * 365 * 86400000);
  await q(
    `INSERT INTO "kycDocuments" ("userId", "docType", status, "fileUrl", "fileKey", "expiresAt", "reviewedAt", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $3 != 'pending' THEN NOW() ELSE NULL END,NOW(),NOW())
     ON CONFLICT DO NOTHING`,
    [userId, docType, status, fileUrl, fileKey, expiresAt]
  );
}
console.log("   ✓ KYC documents seeded");

// ─── 6. CARDS ─────────────────────────────────────────────────────────────────
console.log("→ Seeding cards...");
// cards: id, userId, type, brand, last4, expiryMonth, expiryYear, status, currency, spendLimit, cardholderName, createdAt, updatedAt
const CARDS = [
  [uid1, "virtual",  "visa",       "4532", "12", "2028", "active",  "USD", "5000.00", "ADAEZE OKONKWO"],
  [uid1, "physical", "mastercard", "5412", "08", "2027", "active",  "NGN", "200000.00","ADAEZE OKONKWO"],
  [uid2, "virtual",  "visa",       "4111", "03", "2029", "active",  "USD", "3000.00", "KWAME ASANTE"],
  [uid3, "virtual",  "mastercard", "5500", "11", "2027", "active",  "AED", "10000.00","FATIMA AL-HASSAN"],
  [uid4, "physical", "visa",       "4916", "06", "2028", "active",  "GBP", "8000.00", "CHIDI OBI"],
  [uid6, "virtual",  "verve",      "5061", "09", "2026", "active",  "NGN", "100000.00","EMEKA NWOSU"],
  [uid7, "virtual",  "visa",       "4024", "01", "2027", "frozen",  "NGN", "50000.00", "ZAINAB MUSA"],
];
for (const [userId, type, brand, last4, expiryMonth, expiryYear, status, currency, spendLimit, cardholderName] of CARDS) {
  if (!userId) continue;
  await q(
    `INSERT INTO cards ("userId", type, brand, last4, "expiryMonth", "expiryYear", status, currency, "spendLimit", "cardholderName", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, type, brand, last4, expiryMonth, expiryYear, status, currency, spendLimit, cardholderName]
  );
}
console.log("   ✓ Cards seeded");

// ─── 7. SAVINGS GOALS ────────────────────────────────────────────────────────
console.log("→ Seeding savings goals...");
// savingsGoals: id, userId, name, emoji, targetAmount, currentAmount, currency, targetDate, autoSave, autoSaveAmount, status, createdAt, updatedAt, purpose
const GOALS = [
  [uid1, "New Car",          "🚗", 500000, 125000, "NGN", "2026-12-31", true,  10000, "transport"],
  [uid1, "Emergency Fund",   "🛡️", 200000, 200000, "NGN", "2026-06-30", false, 0,     "emergency"],
  [uid2, "University Fees",  "🎓",  8000,   3200,  "USD", "2027-09-01", true,  200,   "education"],
  [uid3, "Home Deposit",     "🏠", 50000,  12500,  "AED", "2028-01-01", true,  1000,  "property"],
  [uid4, "Holiday Fund",     "✈️",  3000,   1800,  "GBP", "2026-08-01", true,  150,   "travel"],
  [uid6, "Business Capital", "💼", 300000,  75000, "NGN", "2027-03-01", true,  15000, "business"],
  [uid7, "Wedding Fund",     "💍", 150000,  30000, "NGN", "2027-06-01", true,  8000,  "lifestyle"],
];
for (const [userId, name, emoji, targetAmount, currentAmount, currency, targetDate, autoSave, autoSaveAmount, purpose] of GOALS) {
  if (!userId) continue;
  await q(
    `INSERT INTO "savingsGoals" ("userId", name, emoji, "targetAmount", "currentAmount", currency, "targetDate", "autoSave", "autoSaveAmount", status, purpose, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, name, emoji, targetAmount, currentAmount, currency, targetDate, autoSave, autoSaveAmount, purpose]
  );
}
console.log("   ✓ Savings goals seeded");

// ─── 8. RECURRING PAYMENTS ───────────────────────────────────────────────────
console.log("→ Seeding recurring payments...");
// recurringPayments: id, userId, name, recipientName, recipientAccount, recipientBank, amount, currency, targetCurrency, description, frequency, timezone, startDate, endDate, nextRunAt, lastRunAt, status, lastRunStatus, failureCount, executionCount, createdAt, updatedAt
const RECURRING = [
  [uid1, "Family Allowance",  "Ngozi Okonkwo", "0123456789", "First Bank",  50000, "NGN", "NGN", "monthly"],
  [uid1, "Netflix",           "Netflix NG",    "NG-NETFLIX", "Paystack",    4500,  "NGN", "NGN", "monthly"],
  [uid2, "Rent Payment",      "Landlord",      "0201234567", "GCB Bank",    1200,  "GHS", "GHS", "monthly"],
  [uid3, "School Fees",       "AUS School",    "AE12345678", "Emirates NBD",15000, "AED", "AED", "quarterly"],
  [uid4, "Mortgage",          "Nationwide",    "GB29NWBK",   "Nationwide",  1800,  "GBP", "GBP", "monthly"],
  [uid6, "Electricity Bill",  "EKEDC",         "NG-EKEDC",   "EKEDC",       8000,  "NGN", "NGN", "monthly"],
];
for (const [userId, name, recipientName, recipientAccount, recipientBank, amount, currency, targetCurrency, frequency] of RECURRING) {
  if (!userId) continue;
  const nextRunAt = new Date(Date.now() + 30 * 86400000);
  const startDate = rndDate(90, 60);
  await q(
    `INSERT INTO "recurringPayments" ("userId", name, "recipientName", "recipientAccount", "recipientBank", amount, currency, "targetCurrency", frequency, timezone, "startDate", "nextRunAt", status, "failureCount", "executionCount", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'UTC',$10,$11,'active',0,$12,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, name, recipientName, recipientAccount, recipientBank, amount, currency, targetCurrency, frequency, startDate, nextRunAt, rnd(1, 12)]
  );
}
console.log("   ✓ Recurring payments seeded");

// ─── 9. DISPUTES ─────────────────────────────────────────────────────────────
console.log("→ Seeding disputes...");
// disputes: id, userId, transactionId, type, description, status, resolution, fileUrl, fileKey, createdAt, updatedAt
const DISPUTE_TYPES = ["unauthorized", "not_received", "wrong_amount", "duplicate", "service_issue"];
const DISPUTES = [
  [uid1, "unauthorized", "Unauthorized transaction on my account — I did not authorize this transfer", "open"],
  [uid2, "not_received", "Transfer not received by beneficiary after 3 business days",                "resolved"],
  [uid3, "wrong_amount", "Wrong exchange rate applied — rate was 0.265 not 0.272 as agreed",          "open"],
  [uid4, "duplicate",    "Duplicate charge on card — charged twice for same transaction",              "resolved"],
  [uid6, "other",        "Transfer delayed beyond 24-hour SLA without notification",                  "under_review"],
];
for (const [userId, type, description, status] of DISPUTES) {
  if (!userId) continue;
  const resolution = status === "resolved" ? "Refund processed within 5 business days" : null;
  await q(
    `INSERT INTO disputes ("userId", type, description, status, resolution, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, type, description, status, resolution]
  );
}
console.log("   ✓ Disputes seeded");

// ─── 10. SUPPORT TICKETS ─────────────────────────────────────────────────────
console.log("→ Seeding support tickets...");
// support_tickets: id, user_id, subject, message, status, priority, category, agent_id, resolution, created_at, updated_at, resolved_at
const TICKETS = [
  [uid1, "Cannot complete KYC verification",       "I have uploaded my passport but it keeps failing verification.", "open",        "high",   "kyc"],
  [uid2, "How do I add a beneficiary?",            "I want to add my sister in Ghana as a beneficiary.",             "resolved",    "low",    "general"],
  [uid3, "Transfer stuck in pending for 2 days",   "Transfer reference RF123456 has been pending since Monday.",     "in_progress", "high",   "transfer"],
  [uid4, "2FA not working after phone change",     "I changed my phone number and now cannot receive OTP.",          "open",        "medium", "security"],
  [uid5, "Need to update my address",              "I have moved to a new address and need to update my profile.",   "resolved",    "low",    "account"],
  [uid6, "Card declined at POS terminal",          "My virtual card keeps getting declined at online merchants.",    "open",        "medium", "card"],
  [uid7, "Referral bonus not credited",            "I referred my friend 2 weeks ago but bonus not received.",       "in_progress", "low",    "referral"],
];
for (const [userId, subject, message, status, priority, category] of TICKETS) {
  if (!userId) continue;
  const resolution = status === "resolved" ? "Issue has been resolved. Please contact us if problem persists." : null;
  const resolvedAt = status === "resolved" ? new Date() : null;
  await q(
    `INSERT INTO support_tickets (user_id, subject, message, status, priority, category, resolution, created_at, updated_at, resolved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW(),$8) ON CONFLICT DO NOTHING`,
    [userId, subject, message, status, priority, category, resolution, resolvedAt]
  );
}
console.log("   ✓ Support tickets seeded");

// ─── 11. NOTIFICATIONS ───────────────────────────────────────────────────────
console.log("→ Seeding notifications...");
// notifications: id, userId, title, message, type, isRead, actionUrl, metadata, createdAt
const NOTIFS = [
  [uid1, "Transfer Completed",    "Your NGN 50,000 transfer to David Smith was successful.",   "transaction", true,  "/transfers"],
  [uid1, "KYC Approved",          "Your Tier 2 KYC verification has been approved.",           "kyc",         false, "/kyc"],
  [uid2, "Rate Alert Triggered",  "GHS/USD rate hit your target of 0.085.",                    "fx_alert",    false, "/fx-alerts"],
  [uid3, "Card Created",          "Your new virtual Mastercard ending in 5500 is ready.",      "system",      true,  "/cards"],
  [uid4, "Savings Goal Progress", "Congratulations! Your Holiday Fund goal is 60% complete.",  "promotion",   false, "/savings"],
  [uid6, "Dispute Update",        "Your dispute has been escalated to our compliance team.",   "security",    false, "/disputes"],
  [uid7, "KYC Approved",          "Your identity verification has been approved. Tier 2 unlocked.","kyc",      false, "/kyc"],
  [adminId, "New User Signup",    "7 new users registered in the last 24 hours.",              "system",      false, "/admin/users"],
  [uid1, "Referral Bonus",        "Your referral bonus of NGN 500 has been credited.",         "transaction", false, "/wallet"],
  [uid4, "Investment Return",     "Your BTC investment is up 12.5% this month.",               "promotion",   false, "/investments"],
];
for (const [userId, title, message, type, isRead, actionUrl] of NOTIFS) {
  if (!userId) continue;
  await q(
    `INSERT INTO notifications ("userId", title, message, type, "isRead", "actionUrl", "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT DO NOTHING`,
    [userId, title, message, type, isRead, actionUrl]
  );
}
console.log("   ✓ Notifications seeded");

// ─── 12. AUDIT LOGS ──────────────────────────────────────────────────────────
console.log("→ Seeding audit logs...");
// auditLogs: id, userId, targetId, targetType, action, description, ipAddress, userAgent, severity, metadata, createdAt
const AUDIT_ACTIONS = [
  [uid1, null, null, "LOGIN",            "User logged in via OAuth",                    "info"],
  [uid1, null, null, "TRANSFER_CREATED", "Transfer of NGN 50,000 to beneficiary",       "info"],
  [uid1, null, null, "KYC_SUBMITTED",    "KYC document passport submitted for review",  "info"],
  [uid2, null, null, "LOGIN",            "User logged in via OAuth",                    "info"],
  [uid2, null, null, "BENEFICIARY_ADDED","Beneficiary Ama Asante added",                "info"],
  [uid3, null, null, "CARD_CREATED",     "Virtual Mastercard ending 5500 created",      "info"],
  [uid4, null, null, "2FA_ENABLED",      "TOTP 2FA enabled by user",                    "warning"],
  [uid4, null, null, "LOGIN",            "User logged in via OAuth",                    "info"],
  [uid6, null, null, "LARGE_TRANSFER",   "Transfer of NGN 450,000 flagged for review",  "warning"],
  [uid7, null, null, "FAILED_LOGIN",     "Failed login attempt — invalid credentials",  "warning"],
  [adminId, null, null, "ADMIN_LOGIN",   "Admin logged in to dashboard",                "info"],
  [adminId, uid1, "user", "USER_VIEWED", "Admin viewed user profile demo-user-001",     "info"],
];
for (const [userId, targetId, targetType, action, description, severity] of AUDIT_ACTIONS) { if (!userId) continue;
  await q(
    `INSERT INTO "auditLogs" ("userId", "targetId", "targetType", action, description, "ipAddress", "userAgent", severity, "createdAt")
     VALUES ($1,$2,$3,$4,$5,'192.168.1.1','Mozilla/5.0 RemitFlow/1.0',$6,NOW()) ON CONFLICT DO NOTHING`,
    [userId, targetId, targetType, action, description, severity]
  );
}
console.log("   ✓ Audit logs seeded");

// ─── 13. VIRTUAL ACCOUNTS ────────────────────────────────────────────────────
console.log("→ Seeding virtual accounts...");
// virtualAccounts: id, userId, currency, bank, accountNumber, accountName, routingNumber, sortCode, iban, swiftCode, status, createdAt
const VAS = [
  [uid1, "NGN", "First Bank",  "0123456789", "ADAEZE OKONKWO",  null,     null,     null,               "FBNGNGLA", "active"],
  [uid2, "GHS", "GCB Bank",   "0201234567", "KWAME ASANTE",    null,     null,     null,               "GHCBGHAC", "active"],
  [uid4, "GBP", "NatWest",    "12345678",   "CHIDI OBI",       null,     "60-00-01","GB29NWBK60161331926819","NWBKGB2L","active"],
  [uid4, "EUR", "Revolut",    "DE89370400440532013000","CHIDI OBI",null, null,     "DE89370400440532013000","REVOGB21","active"],
];
for (const [userId, currency, bank, accountNumber, accountName, routingNumber, sortCode, iban, swiftCode, status] of VAS) {
  if (!userId) continue;
  await q(
    `INSERT INTO "virtualAccounts" ("userId", currency, bank, "accountNumber", "accountName", "routingNumber", "sortCode", iban, "swiftCode", status, "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) ON CONFLICT DO NOTHING`,
    [userId, currency, bank, accountNumber, accountName, routingNumber, sortCode, iban, swiftCode, status]
  );
}
console.log("   ✓ Virtual accounts seeded");

// ─── 14. BATCH PAYMENTS ──────────────────────────────────────────────────────
console.log("→ Seeding batch payments...");
// batchPayments: id, userId, name, totalAmount, currency, totalRecipients, successCount, failedCount, status, payments, createdAt, updatedAt
const BATCHES = [
  [uid1, "Staff Salaries April 2026",  2500000, "NGN", 25, 25, 0, "completed"],
  [uid4, "Supplier Payments Q1 2026",  45000,   "GBP", 12, 10, 2, "completed"],
  [uid6, "Agent Commissions March",    180000,  "NGN", 18, 18, 0, "completed"],
  [uid1, "Family Remittances April",   350000,  "NGN",  7,  0, 0, "draft"],
  [adminId, "Test Batch Payment",       5000,   "USD",  5,  3, 1, "processing"],
];
for (const [userId, name, totalAmount, currency, totalRecipients, successCount, failedCount, status] of BATCHES) {
  if (!userId) continue;
  const payments = JSON.stringify([{ name: "Recipient 1", amount: totalAmount / totalRecipients, status: "completed" }]);
  await q(
    `INSERT INTO "batchPayments" ("userId", name, "totalAmount", currency, "totalRecipients", "successCount", "failedCount", status, payments, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, name, totalAmount, currency, totalRecipients, successCount, failedCount, status, payments]
  );
}
console.log("   ✓ Batch payments seeded");

// ─── 15. RATE LOCKS ──────────────────────────────────────────────────────────
console.log("→ Seeding rate locks...");
// rate_locks: id, user_id, from_currency, to_currency, locked_rate, amount, expires_at, status, created_at
const RATE_LOCKS = [
  [uid1, "NGN", "GBP", 0.000512, 100000, new Date(Date.now() + 72 * 3600000), "active"],
  [uid2, "GHS", "USD", 0.0825,    5000,  new Date(Date.now() + 48 * 3600000), "active"],
  [uid3, "AED", "EUR", 0.2551,    10000, new Date(Date.now() - 24 * 3600000), "expired"],
  [uid4, "GBP", "NGN", 1962.5,    2000,  new Date(Date.now() + 96 * 3600000), "active"],
  [uid6, "NGN", "USD", 0.00068,   50000, new Date(Date.now() + 24 * 3600000), "active"],
];
for (const [userId, fromCurrency, toCurrency, lockedRate, amount, expiresAt, status] of RATE_LOCKS) {
  if (!userId) continue;
  await q(
    `INSERT INTO rate_locks (user_id, from_currency, to_currency, locked_rate, amount, expires_at, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT DO NOTHING`,
    [userId, fromCurrency, toCurrency, lockedRate, amount, expiresAt, status]
  );
}
console.log("   ✓ Rate locks seeded");

// ─── 16. FX ALERTS ───────────────────────────────────────────────────────────
console.log("→ Seeding FX alerts...");
// fxAlerts: id, userId, fromCurrency, toCurrency, targetRate, direction, isActive, triggered, triggeredAt, notifiedAt, lastCheckedRate, lastCheckedAt, createdAt
const FX_ALERTS = [
  [uid1, "NGN", "GBP", 0.00055, "above", true,  false],
  [uid1, "NGN", "USD", 0.00070, "above", true,  false],
  [uid2, "GHS", "USD", 0.090,   "above", false, true],
  [uid3, "AED", "EUR", 0.260,   "below", true,  false],
  [uid4, "GBP", "NGN", 2000,    "above", true,  false],
  [uid6, "NGN", "EUR", 0.00060, "above", true,  false],
];
for (const [userId, fromCurrency, toCurrency, targetRate, direction, isActive, triggered] of FX_ALERTS) {
  if (!userId) continue;
  await q(
    `INSERT INTO "fxAlerts" ("userId", "fromCurrency", "toCurrency", "targetRate", direction, "isActive", triggered, "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT DO NOTHING`,
    [userId, fromCurrency, toCurrency, targetRate, direction, isActive, triggered]
  );
}
console.log("   ✓ FX alerts seeded");

// ─── 17. DIRECT DEBIT MANDATES ───────────────────────────────────────────────
console.log("→ Seeding direct debit mandates...");
// direct_debit_mandates: id, user_id, creditor, creditor_account, amount, currency, frequency, status, next_debit_date, last_debit_date, mandate_ref, created_at
const MANDATES = [
  [uid1, "Netflix",        "NG-NETFLIX-001",  4500,  "NGN", "monthly",  "active"],
  [uid1, "Spotify",        "NG-SPOTIFY-001",  1500,  "NGN", "monthly",  "active"],
  [uid2, "Electricity",    "GH-ELEC-001",     200,   "GHS", "monthly",  "active"],
  [uid4, "Council Tax",    "GB-COUNCIL-001",  180,   "GBP", "monthly",  "active"],
  [uid4, "Gym Membership", "GB-GYM-001",      45,    "GBP", "monthly",  "paused"],
  [uid6, "Water Bill",     "NG-WATER-001",    3000,  "NGN", "quarterly","active"],
];
for (const [userId, creditor, creditorAccount, amount, currency, frequency, status] of MANDATES) {
  if (!userId) continue;
  const nextDebit = new Date(Date.now() + 30 * 86400000);
  const mandateRef = "DDM-" + Math.random().toString(36).slice(2, 10).toUpperCase();
  await q(
    `INSERT INTO direct_debit_mandates (user_id, creditor, creditor_account, amount, currency, frequency, status, next_debit_date, mandate_ref, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT DO NOTHING`,
    [userId, creditor, creditorAccount, amount, currency, frequency, status, nextDebit, mandateRef]
  );
}
console.log("   ✓ Direct debit mandates seeded");

// ─── 18. DIASPORA COLLECTIVES ────────────────────────────────────────────────
console.log("→ Seeding diaspora collectives...");
// diaspora_collectives: id, created_by_user_id, name, description, target_amount, total_contributed, currency, member_count, max_members, status, investment_focus, country, next_vote_date, createdAt, updatedAt
const COLLECTIVES = [
  [uid1, "Okonkwo Family Union",        "Family savings collective for Okonkwo family members in the UK and Nigeria", 500000, 125000, "NGN", 8,  20, "active", "real_estate", "NG"],
  [uid2, "Asante Ghana Diaspora Group", "Ghanaian diaspora collective for community development projects",             100000,  45000, "GHS", 12, 30, "active", "agriculture", "GH"],
  [uid4, "Lagos Professionals UK",      "Network of Nigerian professionals in the UK pooling resources",               20000,   8500, "GBP", 15, 25, "active", "tech_startup", "GB"],
  [uid6, "Nwosu Extended Family",       "Monthly contributions for family emergencies and celebrations",              300000,  90000, "NGN", 6,  15, "active", "education",   "NG"],
];
for (const [userId, name, description, targetAmount, totalContributed, currency, memberCount, maxMembers, status, investmentFocus, country] of COLLECTIVES) {
  if (!userId) continue;
  await q(
    `INSERT INTO diaspora_collectives (created_by_user_id, name, description, target_amount, total_contributed, currency, member_count, max_members, status, investment_focus, country, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, name, description, targetAmount, totalContributed, currency, memberCount, maxMembers, status, investmentFocus, country]
  );
}
// Add members
const collRes = await client.query(`SELECT id, created_by_user_id FROM diaspora_collectives LIMIT 10`);
for (const coll of collRes.rows) {
  const memberIds = [uid1, uid2, uid3, uid4, uid5, uid6].filter(id => id && id !== coll.created_by_user_id);
  for (const memberId of memberIds.slice(0, 3)) {
    await q(
      `INSERT INTO diaspora_collective_members (collective_id, user_id, role, joined_at)
       VALUES ($1,$2,'member',NOW()) ON CONFLICT DO NOTHING`,
      [coll.id, memberId]
    );
  }
}
console.log("   ✓ Diaspora collectives seeded");

// ─── 19. COMMUNITY FUNDS ─────────────────────────────────────────────────────
console.log("→ Seeding community funds...");
// community_funds: id, created_by_user_id, name, description, country, theme, total_raised, goal_amount, currency, contributor_count, beneficiary_count, sdg_goals, status, image_url, createdAt, updatedAt
const CFUNDS = [
  [uid1, "Flood Relief Nigeria 2026",    "Emergency fund for flood victims in Anambra State", "NG", "emergency",   450000, 1000000, "NGN", 45, 120, ["SDG1","SDG11"]],
  [uid2, "Ghana School Building",        "Building a new school in Kumasi district",           "GH", "education",   125000,  500000, "GHS", 28,  500, ["SDG4"]],
  [uid4, "Diaspora Healthcare Fund",     "Medical equipment for rural clinics in Nigeria",     "NG", "healthcare",   22000,   50000, "GBP", 18,  300, ["SDG3"]],
  [uid5, "Senegal Clean Water Project",  "Borehole drilling for 3 villages in Dakar region",  "SN", "infrastructure",800000,2000000,"XOF", 62, 1500, ["SDG6","SDG11"]],
];
for (const [userId, name, description, country, theme, totalRaised, goalAmount, currency, contributorCount, beneficiaryCount, sdgGoals] of CFUNDS) {
  if (!userId) continue;
  await q(
    `INSERT INTO community_funds (created_by_user_id, name, description, country, theme, total_raised, goal_amount, currency, contributor_count, beneficiary_count, sdg_goals, status, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, name, description, country, theme, totalRaised, goalAmount, currency, contributorCount, beneficiaryCount, JSON.stringify(sdgGoals)]
  );
}
console.log("   ✓ Community funds seeded");

// ─── 20. MARKET LISTINGS ─────────────────────────────────────────────────────
console.log("→ Seeding market listings...");
// market_listings: id, seller_id, title, description, category, price, currency, country, city, image_url, status, view_count, createdAt, updatedAt
const LISTINGS = [
  [uid1, "iPhone 14 Pro Max 256GB",          "electronics", 450000, "NGN", "NG", "Lagos",   "active",   "https://storage.remitflow.demo/market/iphone14.jpg",  245],
  [uid2, "Toyota Camry 2020 (used)",          "vehicles",    85000,  "GHS", "GH", "Accra",   "active",   "https://storage.remitflow.demo/market/camry.jpg",     189],
  [uid3, "2BR Apartment Dubai Marina",        "property",   120000, "AED", "AE", "Dubai",   "active",   "https://storage.remitflow.demo/market/apt-dubai.jpg",  312],
  [uid4, "MacBook Pro M3 14-inch",            "electronics",  1800,  "GBP", "GB", "London",  "active",   "https://storage.remitflow.demo/market/macbook.jpg",    98],
  [uid6, "Ankara Fabric Collection (10 yds)", "fashion",     15000,  "NGN", "NG", "Abuja",   "active",   "https://storage.remitflow.demo/market/ankara.jpg",     67],
  [uid1, "Handmade Leather Bag",              "fashion",     25000,  "NGN", "NG", "Lagos",   "sold",     "https://storage.remitflow.demo/market/bag.jpg",        134],
  [uid5, "Traditional Kora Instrument",       "other",      150000, "XOF", "SN", "Dakar",   "active",   "https://storage.remitflow.demo/market/kora.jpg",        45],
  [uid7, "Organic Shea Butter (5kg)",         "food",         8000,  "NGN", "NG", "Kano",    "active",   "https://storage.remitflow.demo/market/shea.jpg",        78],
];
for (const [userId, title, category, price, currency, country, city, status, imageUrl, viewCount] of LISTINGS) {
  if (!userId) continue;
  await q(
    `INSERT INTO market_listings (seller_id, title, description, category, price, currency, country, city, image_url, status, view_count, "createdAt", "updatedAt")
     VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, title, category, price, currency, country, city, imageUrl, status, viewCount]
  );
}
console.log("   ✓ Market listings seeded");

// ─── 21. TALENT PROFILES ─────────────────────────────────────────────────────
console.log("→ Seeding talent profiles...");
// talent_profiles: id, user_id, bio, expertise, countries, availability, hourly_rate, currency, linkedin_url, portfolio_url, verified, total_bookings, avg_rating, createdAt, updatedAt
const TALENTS = [
  [uid1, "Full-Stack Developer with 8 years experience in fintech and payments",   ["JavaScript","React","Node.js","PostgreSQL","AWS"],  ["NG","GB","US"], "full_time",  75,  "USD", "https://linkedin.com/in/adaeze", true,  24, 4.8],
  [uid2, "Digital Marketing Expert specializing in African diaspora markets",       ["SEO","Social Media","Content","Analytics","Meta"],  ["GH","NG","UK"], "advisory",   45,  "USD", "https://linkedin.com/in/kwame",  true,  18, 4.6],
  [uid3, "Senior Financial Analyst with CFA and 12 years in investment banking",   ["Excel","Bloomberg","Risk","Modelling","Python"],    ["AE","UK","US"], "advisory",   90,  "USD", "https://linkedin.com/in/fatima", true,  36, 4.9],
  [uid4, "UI/UX Designer focused on inclusive design for emerging markets",         ["Figma","Adobe XD","Prototyping","Research","CSS"],  ["GB","NG","GH"], "full_time",  65,  "GBP", "https://linkedin.com/in/chidi",  true,  20, 4.7],
  [uid6, "Supply Chain Manager with expertise in cross-border logistics",           ["Logistics","SAP","Procurement","Analytics","ERP"],  ["NG","GH","SN"], "advisory",   55,  "USD", "https://linkedin.com/in/emeka",  false, 15, 4.5],
];
for (const [userId, bio, expertise, countries, availability, hourlyRate, currency, linkedinUrl, verified, totalBookings, avgRating] of TALENTS) {
  if (!userId) continue;
  await q(
    `INSERT INTO talent_profiles (user_id, bio, expertise, countries, availability, hourly_rate, currency, linkedin_url, verified, total_bookings, avg_rating, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW()) ON CONFLICT (user_id) DO UPDATE SET bio=EXCLUDED.bio`,
    [userId, bio, JSON.stringify(expertise), JSON.stringify(countries), availability, hourlyRate, currency, linkedinUrl, verified, totalBookings, avgRating]
  );
}
console.log("   ✓ Talent profiles seeded");

// ─── 22. TALENT OPPORTUNITIES ────────────────────────────────────────────────
console.log("→ Seeding talent opportunities...");
// talent_opportunities: id, posted_by_user_id, institution_name, title, description, sector, country, engagement_type, compensation, currency, deadline, status, applicant_count, createdAt
const OPPS = [
  [uid1, "TechFinance Ltd",       "React Developer for Fintech App",     "Technology",  "NG", "contract",  80,  "USD"],
  [uid4, "Global Finance Corp",   "Financial Analyst — 3-month contract","Finance",     "GB", "contract",  90,  "GBP"],
  [uid3, "Dubai Ventures",        "Digital Marketing Manager",           "Marketing",   "AE", "full_time", 50,  "USD"],
  [adminId, "RemitFlow",          "Backend Node.js Engineer",            "Technology",  "NG", "contract",  75,  "USD"],
  [uid2, "Agri-Connect Ghana",    "Supply Chain Consultant",             "Agriculture", "GH", "advisory",  60,  "USD"],
];
for (const [userId, institutionName, title, sector, country, engagementType, compensation, currency] of OPPS) {
  if (!userId) continue;
  const deadline = new Date(Date.now() + rnd(14, 60) * 86400000);
  await q(
    `INSERT INTO talent_opportunities (posted_by_user_id, institution_name, title, description, sector, country, engagement_type, compensation, currency, deadline, status, applicant_count, "createdAt")
     VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,'open',$10,NOW()) ON CONFLICT DO NOTHING`,
    [userId, institutionName, title, sector, country, engagementType, compensation, currency, deadline, rnd(0, 12)]
  );
}
console.log("   ✓ Talent opportunities seeded");

// ─── 23. POS TERMINALS ───────────────────────────────────────────────────────
console.log("→ Seeding POS terminals...");
// pos_terminals: id, user_id, terminal_id, merchant_name, merchant_category, location, status, serial_number, model, last_seen, daily_limit, total_transactions, total_volume, created_at, updated_at
const TERMINALS = [
  [uid1, "TRM-001-NG", "Adaeze Okonkwo Ventures", "retail",      "Lagos Island, Lagos, Nigeria",  "active",  "SN-001-NG", "Ingenico iCT250", 500000, 142, 2850000],
  [uid6, "TRM-002-NG", "Emeka Nwosu Enterprises",  "retail",      "Ikeja, Lagos, Nigeria",         "active",  "SN-002-NG", "Verifone VX520",  500000,  97, 1950000],
  [uid7, "TRM-003-NG", "Zainab Mobile Money",       "mobile_money","Port Harcourt, Rivers, Nigeria","inactive","SN-003-NG", "Ingenico iCT250", 500000,   0,       0],
  [uid2, "TRM-001-GH", "Kwame Asante Agency",       "retail",      "Accra Central, Ghana",          "active",  "SN-001-GH", "Verifone VX520",  200000,  43,  850000],
];
for (const [userId, terminalId, merchantName, merchantCategory, location, status, serialNumber, model, dailyLimit, totalTransactions, totalVolume] of TERMINALS) {
  if (!userId) continue;
  await q(
    `INSERT INTO pos_terminals (user_id, terminal_id, merchant_name, merchant_category, location, status, serial_number, model, last_seen, daily_limit, total_transactions, total_volume, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10,$11,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, terminalId, merchantName, merchantCategory, location, status, serialNumber, model, dailyLimit, totalTransactions, totalVolume]
  );
}
console.log("   ✓ POS terminals seeded");

// ─── 24. AGENT ACCOUNTS ──────────────────────────────────────────────────────
console.log("→ Seeding agent accounts...");
// agent_accounts: id, user_id, agent_code, business_name, location, phone, status, tier, commission_rate, daily_limit, total_transactions, total_volume, rating, created_at, updated_at
const AGENTS = [
  [uid1, "AGT-001-NG", "Adaeze Okonkwo Ventures", "Lagos Island, Lagos",    "+2348012345678", "active",   "gold",   1.25, 2000000, 1842, 92100000, 4.8],
  [uid6, "AGT-002-NG", "Emeka Nwosu Enterprises",  "Ikeja, Lagos",           "+2348098765432", "active",   "silver", 1.50, 1000000,  956, 47800000, 4.6],
  [uid2, "AGT-001-GH", "Kwame Asante Agency",       "Accra Central, Ghana",  "+233244567890",  "active",   "gold",   1.25, 1500000,  743, 37150000, 4.9],
  [uid7, "AGT-003-NG", "Zainab Mobile Money",       "Port Harcourt, Rivers", "+2349011223344", "inactive", "basic",  1.75,  500000,    0,        0, 4.2],
];
for (const [userId, agentCode, businessName, location, phone, status, tier, commissionRate, dailyLimit, totalTransactions, totalVolume, rating] of AGENTS) {
  if (!userId) continue;
  await q(
    `INSERT INTO agent_accounts (user_id, agent_code, business_name, location, phone, status, tier, commission_rate, daily_limit, total_transactions, total_volume, rating, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, agentCode, businessName, location, phone, status, tier, commissionRate, dailyLimit, totalTransactions, totalVolume, rating]
  );
}
console.log("   ✓ Agent accounts seeded");

// ─── 25. STABLECOIN WALLETS ──────────────────────────────────────────────────
console.log("→ Seeding stablecoin wallets...");
// stablecoin_wallets: id, user_id, symbol, balance, wallet_address, network, protocol, status, created_at, updated_at
const STABLECOINS = [
  [uid1, "USDT", 1250.00, "0x742d35Cc6634C0532925a3b8D4C9C3aaa1", "Ethereum", "ERC-20"],
  [uid1, "USDC",  500.00, "0x742d35Cc6634C0532925a3b8D4C9C4bbb", "Ethereum", "ERC-20"],
  [uid3, "USDT", 3000.00, "TXYZabc123def456ghi789jkl012mno345", "Tron",     "TRC-20"],
  [uid4, "BUSD",  800.00, "0xBNB742d35Cc6634C0532925a3b8D4C9C5", "BNB Chain","BEP-20"],
  [uid6, "USDC",  200.00, "0x742d35Cc6634C0532925a3b8D4C9C6ccc", "Ethereum", "ERC-20"],
];
for (const [userId, symbol, balance, walletAddress, network, protocol] of STABLECOINS) {
  if (!userId) continue;
  await q(
    `INSERT INTO stablecoin_wallets (user_id, symbol, balance, wallet_address, network, protocol, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'active',NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, symbol, balance, walletAddress, network, protocol]
  );
}
console.log("   ✓ Stablecoin wallets seeded");

// ─── 26. CBDC WALLETS ────────────────────────────────────────────────────────
console.log("→ Seeding CBDC wallets...");
// cbdc_wallets: id, user_id, currency, balance, wallet_address, issuer, wallet_type, status, created_at, updated_at
const CBDC_WALLETS = [
  [uid1, "NGN", 50000.00, "eNGN1234567890ABCDEF", "Central Bank of Nigeria",   "retail"],
  [uid2, "GHS",  5000.00, "eGHS9876543210FEDCBA", "Bank of Ghana",             "retail"],
  [uid4, "GBP",   500.00, "eGBP5555444433332222", "Bank of England",           "retail"],
];
for (const [userId, currency, balance, walletAddress, issuer, walletType] of CBDC_WALLETS) {
  if (!userId) continue;
  await q(
    `INSERT INTO cbdc_wallets (user_id, currency, balance, wallet_address, issuer, wallet_type, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'active',NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, currency, balance, walletAddress, issuer, walletType]
  );
}
console.log("   ✓ CBDC wallets seeded");

// ─── 27. USER INVESTMENTS ────────────────────────────────────────────────────
console.log("→ Seeding user investments...");
// user_investments: id, user_id, asset_id, status, quantity, purchase_price, current_value, currency, purchased_at, sold_at, sold_price, notes, createdAt, updatedAt
const assetRes = await client.query(`SELECT id, symbol, current_price FROM investment_assets LIMIT 27`);
const assetMap = {};
for (const a of assetRes.rows) assetMap[a.symbol] = { id: a.id, price: parseFloat(a.current_price || 100) };

const HOLDINGS = [
  [uid1, "AAPL",  10, 175.50, "USD"],
  [uid1, "BTC",    0.5, 42000, "USD"],
  [uid3, "GOLD",   5,  1950.00, "USD"],
  [uid3, "AAPL",  20,  170.00, "USD"],
  [uid4, "BTC",    1.2, 38000, "USD"],
  [uid4, "ETH",    5,   2200,  "USD"],
  [uid4, "TSLA",  15,   220,   "USD"],
  [uid6, "GOLD",   2,  1980.00,"USD"],
];
for (const [userId, symbol, quantity, purchasePrice, currency] of HOLDINGS) {
  if (!userId || !assetMap[symbol]) continue;
  const assetId = assetMap[symbol].id;
  const currentValue = +(quantity * assetMap[symbol].price).toFixed(2);
  await q(
    `INSERT INTO user_investments (user_id, asset_id, status, quantity, purchase_price, current_value, currency, purchased_at, "createdAt", "updatedAt")
     VALUES ($1,$2,'active',$3,$4,$5,$6,NOW(),NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, assetId, quantity, purchasePrice, currentValue, currency]
  );
}
console.log("   ✓ User investments seeded");

// ─── 28. INVESTMENT ORDERS ───────────────────────────────────────────────────
console.log("→ Seeding investment orders...");
// investment_orders: id, user_id, asset_id, order_type, quantity, price_at_order, total_amount, currency, status, fee, createdAt
const ORDER_USERS = [uid1, uid3, uid4, uid6].filter(Boolean);
const ORDER_SYMBOLS = Object.keys(assetMap).slice(0, 10);
for (let i = 0; i < 20; i++) {
  const userId = pick(ORDER_USERS);
  const symbol = pick(ORDER_SYMBOLS);
  if (!assetMap[symbol]) continue;
  const orderType = pick(["buy", "sell"]);
  const quantity = +(Math.random() * 5 + 0.1).toFixed(4);
  const price = assetMap[symbol].price;
  const totalAmount = +(quantity * price).toFixed(2);
  const fee = +(totalAmount * 0.001).toFixed(2);
  const status = pick(["completed", "completed", "processing", "failed"]);
  await q(
    `INSERT INTO investment_orders (user_id, asset_id, order_type, quantity, price_at_order, total_amount, currency, status, fee, "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,'USD',$7,$8,NOW()) ON CONFLICT DO NOTHING`,
    [userId, assetMap[symbol].id, orderType, quantity, price, totalAmount, status, fee]
  );
}
console.log("   ✓ Investment orders seeded");

// ─── 29. FRAUD ALERTS ────────────────────────────────────────────────────────
console.log("→ Seeding fraud alerts...");
// fraud_alerts: id, user_id, transaction_id, risk_score, risk_level, status, flagged_reasons, transaction_amount, reviewer_id, reviewer_notes, reviewed_at, created_at, updated_at
const FRAUD = [
  [uid7, 95, "high",   ["velocity_check","geo_anomaly"],         45000, "pending",  null,     null],
  [uid1, 45, "medium", ["geo_anomaly"],                          12000, "cleared",  adminId,  "Confirmed legitimate — user was traveling"],
  [uid6, 30, "low",    ["large_transaction"],                   450000, "cleared",  adminId,  "User confirmed the transaction"],
  [uid3, 65, "high",   ["new_device","unusual_time"],            8500,  "reviewed", null,     null],
];
for (const [userId, riskScore, riskLevel, flaggedReasons, txAmount, status, reviewerId, reviewerNotes] of FRAUD) {
  if (!userId) continue;
  const reviewedAt = reviewerId ? new Date() : null;
  await q(
    `INSERT INTO fraud_alerts (user_id, risk_score, risk_level, status, flagged_reasons, transaction_amount, reviewer_id, reviewer_notes, reviewed_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, riskScore, riskLevel, status, JSON.stringify(flaggedReasons), txAmount, reviewerId, reviewerNotes, reviewedAt]
  );
}
console.log("   ✓ Fraud alerts seeded");

// ─── 30. COMPLIANCE CASES ────────────────────────────────────────────────────
console.log("→ Seeding compliance cases...");
// complianceCases: id, userId, transactionId, caseType, severity, status, title, description, riskScore, assignedTo, resolvedAt, escalatedAt, notes, createdAt, updatedAt, dueAt, priority
const COMP_CASES = [
  [uid7, "aml_flag",          "critical", "open",         "AML Review — Velocity Threshold Exceeded",  "Suspicious transaction pattern: 5 transactions in 10 minutes exceeds velocity threshold of 3/hour", 95, adminId, "high"],
  [uid1, "unusual_activity",  "medium",   "resolved",     "KYC Manual Review — Tier 2 Upgrade",        "Tier 2 KYC documents require manual review before upgrade approval",                                 45, adminId, "medium"],
  [uid6, "pep_match",         "high",     "under_review", "PEP Screening Match — Enhanced Due Diligence","Name match on PEP watchlist requires enhanced due diligence and source of funds verification",     75, adminId, "high"],
  [uid3, "high_risk_corridor","high",     "open",         "SAR Filing Required — Unusual Pattern",      "Multiple large cross-border transfers to high-risk jurisdictions requires SAR filing",              80, adminId, "high"],
];
for (const [userId, caseType, severity, status, title, description, riskScore, assignedTo, priority] of COMP_CASES) {
  if (!userId) continue;
  const dueAt = new Date(Date.now() + 7 * 86400000);
  const resolvedAt = status === "resolved" ? new Date() : null;
  await q(
    `INSERT INTO "complianceCases" ("userId", "caseType", severity, status, title, description, "riskScore", "assignedTo", "resolvedAt", "createdAt", "updatedAt", "dueAt", priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW(),$10,$11) ON CONFLICT DO NOTHING`,
    [userId, caseType, severity, status, title, description, riskScore, assignedTo, resolvedAt, dueAt, priority]
  );
}
console.log("   ✓ Compliance cases seeded");

// ─── 31. PAYMENT METRICS ─────────────────────────────────────────────────────
console.log("→ Seeding payment metrics...");
// payment_metrics: id, user_id, corridor, success_count, failure_count, avg_processing_ms, total_volume, period, created_at
const METRIC_CORRIDORS = ["NGN-GBP", "NGN-USD", "GHS-USD", "AED-USD", "XOF-EUR", "GBP-NGN"];
for (let i = 0; i < 60; i++) {
  const d = new Date(Date.now() - i * 86400000);
  const period = d.toISOString().slice(0, 10);
  const corridor = pick(METRIC_CORRIDORS);
  const successCount = rnd(20, 80);
  const failureCount = rnd(0, 5);
  const avgProcessingMs = rnd(800, 3500);
  const totalVolume = rnd(500000, 5000000);
  const metricUserId = pick(txUserIds);
  await q(
    `INSERT INTO payment_metrics (user_id, corridor, success_count, failure_count, avg_processing_ms, total_volume, period, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
    [metricUserId, corridor, successCount, failureCount, avgProcessingMs, totalVolume, period, d]
  );
}
console.log("   ✓ Payment metrics seeded");

// ─── 32. REFERRALS ───────────────────────────────────────────────────────────
console.log("→ Seeding referrals...");
// referrals: id, referrerId, referredId, status, rewardAmount, rewardCurrency, createdAt
const REFERRALS = [
  [uid1, uid6, "completed", 500, "NGN"],
  [uid1, uid7, "completed", 500, "NGN"],
  [uid4, uid3, "pending",   10,  "GBP"],
  [uid2, uid5, "completed", 20,  "GHS"],
];
for (const [referrerId, referredId, status, rewardAmount, rewardCurrency] of REFERRALS) {
  if (!referrerId || !referredId) continue;
  await q(
    `INSERT INTO referrals ("referrerId", "referredId", status, "rewardAmount", "rewardCurrency", "createdAt")
     VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT DO NOTHING`,
    [referrerId, referredId, status, rewardAmount, rewardCurrency]
  );
}
console.log("   ✓ Referrals seeded");

// ─── 33. FAMILY BUDGETS ──────────────────────────────────────────────────────
console.log("→ Seeding family budgets...");
// family_budgets: id, user_id, family_member_id, monthly_limit, currency, current_month_spent, alert_threshold, auto_renew, createdAt, updatedAt
const BUDGETS = [
  [uid1, uid6, 200000, "NGN", 85000,  80],
  [uid4, uid3,   5000, "GBP",  2100,  75],
  [uid6, uid7,  80000, "NGN", 45000,  80],
];
for (const [userId, familyMemberId, monthlyLimit, currency, currentMonthSpent, alertThreshold] of BUDGETS) {
  if (!userId || !familyMemberId) continue;
  await q(
    `INSERT INTO family_budgets (user_id, family_member_id, monthly_limit, currency, current_month_spent, alert_threshold, auto_renew, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,true,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, familyMemberId, monthlyLimit, currency, currentMonthSpent, alertThreshold]
  );
}
console.log("   ✓ Family budgets seeded");

// ─── 34. BNPL PLANS ──────────────────────────────────────────────────────────
console.log("→ Seeding BNPL plans...");
// bnpl_plans: id, user_id, merchant, description, total_amount, paid_amount, currency, installments, installment_amount, interest_rate, status, next_due_date, completed_at, created_at, updated_at
const BNPL = [
  [uid1, "Apple Store Nigeria", "iPhone 14 Pro Max 256GB",  450000, 112500, "NGN", 4, 112500, 0,   "active"],
  [uid2, "Jumia Ghana",         "Laptop Purchase",            3000,   1000, "GHS", 3,   1000, 2.5, "active"],
  [uid4, "Currys UK",           "Home Appliances Bundle",     1200,   1200, "GBP", 6,    200, 0,   "completed"],
  [uid6, "Slot Nigeria",        "Samsung Galaxy S24",         350000, 87500, "NGN", 4,  87500, 1.5, "active"],
];
for (const [userId, merchant, description, totalAmount, paidAmount, currency, installments, installmentAmount, interestRate, status] of BNPL) {
  if (!userId) continue;
  const nextDueDate = status === "completed" ? null : new Date(Date.now() + 30 * 86400000);
  const completedAt = status === "completed" ? new Date() : null;
  await q(
    `INSERT INTO bnpl_plans (user_id, merchant, description, total_amount, paid_amount, currency, installments, installment_amount, interest_rate, status, next_due_date, completed_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, merchant, description, totalAmount, paidAmount, currency, installments, installmentAmount, interestRate, status, nextDueDate, completedAt]
  );
}
console.log("   ✓ BNPL plans seeded");

// ─── 35. NOTIFICATION PREFERENCES ───────────────────────────────────────────
console.log("→ Seeding notification preferences...");
// notificationPreferences: id, userId, category, emailEnabled, inAppEnabled, pushEnabled, createdAt, updatedAt
const NOTIF_CATEGORIES = ["transaction", "security", "marketing", "kyc", "fx", "investment", "community"];
for (const userId of [uid1, uid2, uid3, uid4, uid6].filter(Boolean)) {
  for (const category of NOTIF_CATEGORIES) {
    await q(
      `INSERT INTO "notificationPreferences" ("userId", category, "emailEnabled", "inAppEnabled", "pushEnabled", "createdAt", "updatedAt")
       VALUES ($1,$2,true,true,true,NOW(),NOW()) ON CONFLICT DO NOTHING`,
      [userId, category]
    );
  }
}
console.log("   ✓ Notification preferences seeded");

// ─── 36. CONSENT RECORDS ─────────────────────────────────────────────────────
console.log("→ Seeding consent records...");
// consent_records: id, user_id, consent_type, granted, version, ip_address, granted_at, revoked_at, created_at
const CONSENTS = [
  [uid1, "marketing",    false, "1.0", "192.168.1.1"],
  [uid1, "analytics",    true,  "1.0", "192.168.1.1"],
  [uid1, "transactional",true,  "1.0", "192.168.1.1"],
  [uid2, "analytics",    true,  "1.0", "10.0.0.1"],
  [uid2, "transactional",true,  "1.0", "10.0.0.1"],
  [uid4, "marketing",    true,  "1.0", "172.16.0.1"],
  [uid4, "analytics",    true,  "1.0", "172.16.0.1"],
  [uid4, "third_party",  false, "1.0", "172.16.0.1"],
  [uid4, "transactional",true,  "1.0", "172.16.0.1"],
];
for (const [userId, consentType, granted, version, ipAddress] of CONSENTS) {
  if (!userId) continue;
  const grantedAt = granted ? new Date() : null;
  await q(
    `INSERT INTO consent_records (user_id, consent_type, granted, version, ip_address, granted_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT DO NOTHING`,
    [userId, consentType, granted, version, ipAddress, grantedAt]
  );
}
console.log("   ✓ Consent records seeded");

// ─── 37. MOJALOOP TRANSFERS ──────────────────────────────────────────────────
console.log("→ Seeding Mojaloop transfers...");
// mojaloop_transfers: id, user_id, transfer_id, quote_id, transaction_id, payer_fsp, payee_fsp, payer_identifier, payee_identifier, amount, currency, ilp_packet, condition, fulfilment, status, error_code, error_description, expiration_date, completed_at, created_at
const MOJALOOP_STATUSES = ["COMMITTED", "COMMITTED", "RESERVED", "ABORTED"];
for (let i = 0; i < 15; i++) {
  const userId = pick(txUserIds);
  const status = pick(MOJALOOP_STATUSES);
  const transferId = "TRF" + Date.now().toString(36).toUpperCase() + i;
  const expiresAt = new Date(Date.now() + 30000);
  const completedAt = status === "COMMITTED" ? new Date() : null;
  await q(
    `INSERT INTO mojaloop_transfers (user_id, transfer_id, payer_fsp, payee_fsp, payer_identifier, payee_identifier, amount, currency, status, expiration_date, completed_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()) ON CONFLICT DO NOTHING`,
    [userId, transferId, "remitflow-fsp", pick(["ecobank-ng","gtbank-ng","equity-ke","gcb-gh"]),
     "+234" + rnd(7000000000, 9099999999), "+254" + rnd(700000000, 799999999),
     rnd(1000, 50000), pick(["NGN","KES","GHS"]), status, expiresAt, completedAt]
  );
}
console.log("   ✓ Mojaloop transfers seeded");

// ─── 38. FUND PROPOSALS ──────────────────────────────────────────────────────
console.log("→ Seeding fund proposals...");
// fund_proposals: id, fund_id, submitted_by_user_id, title, description, requested_amount, currency, beneficiary_name, beneficiary_country, impact_description, status, votes_for, votes_against, voting_deadline, funded_at, createdAt, updatedAt
const cfRes = await client.query(`SELECT id, currency FROM community_funds LIMIT 4`);
const PROPOSAL_TITLES = ["Emergency Medical Aid", "School Supplies Distribution", "Infrastructure Repair", "Community Event Funding", "Scholarship Program"];
for (const cf of cfRes.rows) {
  const title = pick(PROPOSAL_TITLES);
  const votingDeadline = new Date(Date.now() + 14 * 86400000);
  const proposalStatus = pick(["voting", "approved", "rejected", "draft"]);
  await q(
    `INSERT INTO fund_proposals (fund_id, submitted_by_user_id, title, description, requested_amount, currency, beneficiary_name, beneficiary_country, impact_description, status, votes_for, votes_against, voting_deadline, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [cf.id, pick([uid1, uid2, uid4].filter(Boolean)), title,
     `Proposal to allocate ${cf.currency} funds for ${title.toLowerCase()} in the target community`,
     rnd(10000, 100000), cf.currency, "Community Beneficiaries", pick(["NG","GH","SN","KE"]),
     "This initiative will directly benefit 500+ community members through improved access to essential services",
     proposalStatus, rnd(3, 15), rnd(0, 5), votingDeadline]
  );
}
console.log("   ✓ Fund proposals seeded");

// ─── 39. ANALYTICS THRESHOLDS ────────────────────────────────────────────────
console.log("→ Seeding analytics thresholds...");
// analyticsThresholds: id, metric, label, threshold, operator, notifyOwner, createdAt, updatedAt
const THRESHOLDS = [
  ["daily_transfer_volume",   "Daily Transfer Volume Alert",       5000000, "above", true],
  ["velocity_transactions",   "Transaction Velocity Alert",        10,      "above", true],
  ["large_single_transfer",   "Large Single Transfer Flag",        100000,  "above", false],
  ["aml_reporting_threshold", "AML Reporting Threshold",           1000000, "above", true],
  ["failed_login_attempts",   "Failed Login Attempts Alert",       5,       "above", true],
  ["kyc_rejection_rate",      "KYC Rejection Rate Alert",          20,      "above", false],
];
for (const [metric, label, threshold, operator, notifyOwner] of THRESHOLDS) {
  await q(
    `INSERT INTO "analyticsThresholds" (metric, label, threshold, operator, "notifyOwner", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [metric, label, threshold, operator, notifyOwner]
  );
}
console.log("   ✓ Analytics thresholds seeded");

// ─── 40. TENANTS ─────────────────────────────────────────────────────────────
console.log("→ Seeding tenants...");
const TENANTS = [
  [1, "RemitFlow Core",  "remitflow",     "enterprise",  "active", "https://remitflow.manus.space",     "support@remitflow.com",     "FCA",  "GB", 10000,  100000000],
  [2, "AfriPay",         "afripay",       "growth",      "active", "https://afripay.example.com",       "support@afripay.com",       "CBN",  "NG", 1000,   10000000],
  [3, "KenyaRemit",      "kenyaremit",    "starter",     "active", "https://kenyaremit.example.com",    "support@kenyaremit.com",    "CBK",  "KE", 100,    1000000],
  [4, "DiasporaBank",    "diasporabank",  "white_label", "active", "https://diasporabank.example.com",  "support@diasporabank.com",  "FCA",  "GB", 50000,  500000000],
  [5, "GhanaTransfer",   "ghanatransfer", "growth",      "trial",  "https://ghanatransfer.example.com", "support@ghanatransfer.com", "BOG",  "GH", 1000,   10000000],
];
for (const [id, name, slug, plan, status, domain, email, regulator, country, maxUsers, monthlyLimit] of TENANTS) {
  await q(
    `INSERT INTO tenants (id, name, slug, plan, status, domain, "contactEmail", regulator, country, "maxUsers", "monthlyTransferLimit", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
    [id, name, slug, plan, status, domain, email, regulator, country, maxUsers, monthlyLimit]
  );
}
console.log("   ✓ Tenants seeded");

// ─── 41. FEATURE FLAGS ───────────────────────────────────────────────────────
console.log("→ Seeding feature flags...");
const FLAGS = [
  ["bnpl_enabled",           "BNPL Payments",          "Enable Buy Now Pay Later",                    true,  "payments",       100],
  ["cbdc_enabled",           "CBDC Wallet",            "Enable Central Bank Digital Currency wallet", false, "payments",       0],
  ["stablecoin_enabled",     "Stablecoin Wallet",      "Enable stablecoin (USDT/USDC) wallet",        true,  "payments",       100],
  ["mojaloop_enabled",       "Mojaloop Integration",   "Enable Mojaloop FSPIOP transfers",            false, "infrastructure", 0],
  ["open_banking_enabled",   "Open Banking",           "Enable PSD2/Open Banking API connections",    true,  "compliance",     100],
  ["kyc_auto_approve",       "KYC Auto-Approve",       "Auto-approve KYC for trusted sources",        false, "compliance",     0],
  ["fx_live_rates",          "Live FX Rates",          "Use live FX rates from external API",         true,  "fx",             100],
  ["fx_hedging",             "FX Hedging",             "Enable FX hedging for large transfers",       false, "fx",             0],
  ["referral_program",       "Referral Program",       "Enable user referral program",                true,  "growth",         100],
  ["diaspora_collective",    "Diaspora Collective",    "Enable diaspora collective investment",       true,  "social",         100],
  ["ai_fraud_detection",     "AI Fraud Detection",     "Enable ML-based fraud detection",             true,  "security",       100],
  ["push_notifications",     "Push Notifications",     "Enable web push notifications",               true,  "notifications",  100],
  ["sms_notifications",      "SMS Notifications",      "Enable SMS alerts via Twilio",                false, "notifications",  0],
  ["two_factor_required",    "2FA Required",           "Require 2FA for all users",                   false, "security",       0],
  ["high_value_2fa",         "High-Value 2FA",         "Require 2FA for transfers >$1000",            true,  "security",       100],
  ["rate_lock_enabled",      "Rate Lock",              "Enable FX rate locking for transfers",        true,  "fx",             100],
  ["batch_payments_enabled", "Batch Payments",         "Enable bulk/batch payment processing",        true,  "payments",       100],
  ["checkout_sdk_enabled",   "Checkout SDK",           "Enable merchant checkout SDK",                true,  "developer",      100],
  ["pos_enabled",            "POS Terminals",          "Enable POS terminal management",              true,  "operations",     100],
  ["agent_network_enabled",  "Agent Network",          "Enable agent network management",             true,  "operations",     100],
];
for (const [key, name, description, enabled, category, rolloutPercent] of FLAGS) {
  await q(
    `INSERT INTO feature_flags (key, name, description, enabled, category, "rolloutPercent", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) ON CONFLICT (key) DO NOTHING`,
    [key, name, description, enabled, category, rolloutPercent]
  );
}
console.log("   ✓ Feature flags seeded");

// ─── 42. WHITE-LABEL CONFIGS ─────────────────────────────────────────────────
console.log("→ Seeding white-label configs...");
const WL_CONFIGS = [
  [1, "RemitFlow",   "#7C3AED", "#10B981", "Inter",   "https://remitflow.manus.space",    "https://remitflow.manus.space/favicon.ico",   "dark",  "support@remitflow.com",   "© 2025 RemitFlow. All rights reserved."],
  [2, "AfriPay",    "#059669", "#F59E0B", "Poppins", "https://afripay.example.com",      "https://afripay.example.com/favicon.ico",     "light", "support@afripay.com",     "© 2025 AfriPay. All rights reserved."],
  [4, "DiasporaBank","#1D4ED8","#F97316", "Roboto",  "https://diasporabank.example.com", "https://diasporabank.example.com/favicon.ico","light", "support@diasporabank.com","© 2025 DiasporaBank. All rights reserved."],
];
for (const [tenantId, appName, primaryColor, accentColor, fontFamily, appUrl, logoUrl, theme, supportEmail, footerText] of WL_CONFIGS) {
  await q(
    `INSERT INTO white_label_configs ("tenantId", "appName", "primaryColor", "accentColor", "fontFamily", "appUrl", "logoUrl", theme, "supportEmail", "footerText", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) ON CONFLICT ("tenantId") DO NOTHING`,
    [tenantId, appName, primaryColor, accentColor, fontFamily, appUrl, logoUrl, theme, supportEmail, footerText]
  );
}
console.log("   ✓ White-label configs seeded");

// ─── 43. TENANT FEATURE FLAGS ────────────────────────────────────────────────
console.log("→ Seeding tenant feature flags...");
const flagRows = await client.query(`SELECT id, key FROM feature_flags LIMIT 50`);
const flagMap = Object.fromEntries(flagRows.rows.map(r => [r.key, r.id]));
// Tenant 1 (RemitFlow Core) — all flags enabled
for (const [key, , , enabled] of FLAGS) {
  if (flagMap[key]) {
    await q(
      `INSERT INTO tenant_feature_flags ("tenantId", "flagId", enabled, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,NOW(),NOW()) ON CONFLICT ("tenantId", "flagId") DO NOTHING`,
      [1, flagMap[key], enabled]
    );
  }
}
// Tenant 2 (AfriPay) — payments + growth flags only
const afriPayFlags = ["bnpl_enabled","stablecoin_enabled","referral_program","fx_live_rates","push_notifications","high_value_2fa","batch_payments_enabled","pos_enabled","agent_network_enabled"];
for (const key of afriPayFlags) {
  if (flagMap[key]) {
    await q(
      `INSERT INTO tenant_feature_flags ("tenantId", "flagId", enabled, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,NOW(),NOW()) ON CONFLICT ("tenantId", "flagId") DO NOTHING`,
      [2, flagMap[key], true]
    );
  }
}
console.log("   ✓ Tenant feature flags seeded");

// ─── FINAL SUMMARY ────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════");
const finalCounts = await client.query(`
  SELECT relname as tbl, n_live_tup as rows
  FROM pg_stat_user_tables
  WHERE n_live_tup > 0
  ORDER BY n_live_tup DESC
`);
console.log("  Tables with data (after ANALYZE):");
await client.query("ANALYZE");
const finalCounts2 = await client.query(`
  SELECT relname as tbl, n_live_tup as rows
  FROM pg_stat_user_tables
  WHERE n_live_tup > 0
  ORDER BY n_live_tup DESC
`);
for (const row of finalCounts2.rows) {
  console.log(`    ${row.tbl.padEnd(35)} ${row.rows} rows`);
}
console.log("══════════════════════════════════════════════════════");
console.log("✅ Seed complete!\n");

await client.end();
