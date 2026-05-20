/**
 * RemitFlow v14 — PostgreSQL Seed Script
 *
 * Seeds all 30+ tables with realistic multi-user data across 8 users in 6 countries.
 * Idempotent: safe to run multiple times (uses ON CONFLICT DO NOTHING / DO UPDATE).
 *
 * Usage:
 *   POSTGRES_URL=postgresql://user:pass@localhost:5432/remitflow node scripts/seed.pg.mjs
 *
 * Requires: npm install pg (or use the pg package already in devDependencies)
 */

import pg from "pg";
const { Client } = pg;

const POSTGRES_URL = process.env.POSTGRES_URL;
if (!POSTGRES_URL) {
  console.error("❌ POSTGRES_URL not set. Example: postgresql://remitflow:secret@localhost:5432/remitflow");
  process.exit(1);
}

const client = new Client({ connectionString: POSTGRES_URL, ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : false });
await client.connect();
console.log("✅ Connected to PostgreSQL");

async function exec(sql, params = []) {
  try {
    await client.query(sql, params);
  } catch (err) {
    if (err.code === "23505") return; // unique_violation — already exists, skip
    console.warn(`⚠️  Query warning: ${err.message}\n   SQL: ${sql.slice(0, 120)}`);
  }
}

// ─── 1. Users ─────────────────────────────────────────────────────────────────
console.log("🌱 Seeding users...");
const users = [
  ["seed_user_001", "amara.okafor@example.com",    "Amara Okafor",    "+234-801-234-5678", "user",  "tier2", "NGN", "14 Adeola Odeku St, Lagos"],
  ["seed_user_002", "kwame.mensah@example.com",     "Kwame Mensah",    "+233-244-567-890",  "user",  "tier1", "GHS", "45 Ring Road, Accra"],
  ["seed_user_003", "fatima.al-rashid@example.com", "Fatima Al-Rashid","+971-50-123-4567",  "user",  "tier3", "AED", "Sheikh Zayed Rd, Dubai"],
  ["seed_user_004", "james.odhiambo@example.com",   "James Odhiambo",  "+254-722-345-678",  "user",  "tier2", "KES", "Westlands, Nairobi"],
  ["seed_user_005", "sofia.martinez@example.com",   "Sofia Martinez",  "+44-7700-900-123",  "user",  "tier2", "GBP", "12 Canary Wharf, London"],
  ["seed_user_006", "chen.wei@example.com",         "Chen Wei",        "+86-138-0013-8000", "user",  "tier1", "CNY", "Pudong New Area, Shanghai"],
  ["seed_user_007", "admin@remitflow.io",           "RemitFlow Admin", "+1-415-555-0100",   "admin", "tier3", "USD", "101 Market St, San Francisco"],
  ["seed_user_008", "agent.kemi@example.com",       "Kemi Adeyemi",    "+234-803-456-7890", "user",  "tier2", "NGN", "Ikeja, Lagos"],
];
for (const [openId, email, name, phone, role, kycTier, defaultCurrency, address] of users) {
  await exec(
    `INSERT INTO users (open_id, email, name, phone, role, kyc_tier, default_currency, address, referral_code, two_factor_enabled, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,NOW(),NOW())
     ON CONFLICT (open_id) DO UPDATE SET email=EXCLUDED.email, name=EXCLUDED.name, updated_at=NOW()`,
    [openId, email, name, phone, role, kycTier, defaultCurrency, address, `RF${Math.random().toString(36).slice(2,8).toUpperCase()}`]
  );
}

// Get user IDs
const { rows: userRows } = await client.query(`SELECT id, open_id FROM users WHERE open_id LIKE 'seed_user_%' ORDER BY id`);
const uid = {};
for (const r of userRows) uid[r.open_id] = r.id;
console.log(`   ✓ ${userRows.length} users seeded`);

// ─── 2. Wallets ───────────────────────────────────────────────────────────────
console.log("🌱 Seeding wallets...");
const walletData = [
  [uid["seed_user_001"], "NGN", "4250000.00", true],
  [uid["seed_user_001"], "USD", "2750.00",    false],
  [uid["seed_user_001"], "GBP", "1200.00",    false],
  [uid["seed_user_002"], "GHS", "18500.00",   true],
  [uid["seed_user_002"], "USD", "850.00",     false],
  [uid["seed_user_003"], "AED", "55000.00",   true],
  [uid["seed_user_003"], "USD", "15000.00",   false],
  [uid["seed_user_004"], "KES", "320000.00",  true],
  [uid["seed_user_004"], "USD", "2400.00",    false],
  [uid["seed_user_005"], "GBP", "8500.00",    true],
  [uid["seed_user_005"], "EUR", "3200.00",    false],
  [uid["seed_user_006"], "CNY", "45000.00",   true],
  [uid["seed_user_007"], "USD", "100000.00",  true],
  [uid["seed_user_007"], "NGN", "15000000.00",false],
  [uid["seed_user_008"], "NGN", "750000.00",  true],
];
for (const [userId, currency, balance, isDefault] of walletData) {
  if (!userId) continue;
  await exec(
    `INSERT INTO wallets (user_id, currency, balance, locked_balance, is_default, status, created_at, updated_at)
     VALUES ($1,$2,$3,'0.00',$4,'active',NOW(),NOW())
     ON CONFLICT DO NOTHING`,
    [userId, currency, balance, isDefault]
  );
}
console.log(`   ✓ ${walletData.length} wallets seeded`);

// ─── 3. Transactions ──────────────────────────────────────────────────────────
console.log("🌱 Seeding transactions...");
const txns = [
  [uid["seed_user_001"],"send","completed","NGN","150000.00","GBP","78.45","750.00","1915.42","RF-TXN-001","School fees payment","Tunde Okafor","GB29NWBK60161331926819","Barclays Bank","GB","bank_transfer"],
  [uid["seed_user_001"],"receive","completed","USD","500.00","NGN","769230.00","0.00","1538.46","RF-TXN-002","Freelance payment","Amara Okafor","0123456789","First Bank","NG","bank_transfer"],
  [uid["seed_user_001"],"exchange","completed","USD","1000.00","NGN","1538460.00","15.38","1538.46","RF-TXN-003","Currency exchange",null,null,null,null,"fx_exchange"],
  [uid["seed_user_002"],"send","completed","GHS","2500.00","USD","215.52","12.50","11.60","RF-TXN-004","Family support","Abena Mensah","US64SVBKUS6S3300958879","Chase Bank","US","bank_transfer"],
  [uid["seed_user_003"],"send","completed","AED","5000.00","PKR","381250.00","50.00","76.25","RF-TXN-005","Business payment","Muhammad Ali","PK36SCBL0000001123456702","HBL Bank","PK","bank_transfer"],
  [uid["seed_user_004"],"send","completed","KES","25000.00","UGX","700000.00","250.00","28.00","RF-TXN-006","M-Pesa transfer","Grace Nakato","+256-701-234-567","MTN Mobile Money","UG","mobile_money"],
  [uid["seed_user_005"],"send","completed","GBP","350.00","NGN","680750.00","3.50","1945.00","RF-TXN-007","Rent contribution","Chidi Okonkwo","0987654321","GTBank","NG","bank_transfer"],
  [uid["seed_user_001"],"topup","completed","NGN","500000.00","NGN","500000.00","0.00","1.00","RF-TXN-008","Wallet top-up",null,null,null,null,"bank_transfer"],
  [uid["seed_user_001"],"airtime","completed","NGN","2000.00","NGN","2000.00","0.00","1.00","RF-TXN-009","MTN airtime",null,"+234-801-234-5678",null,null,"airtime"],
  [uid["seed_user_001"],"bill","completed","NGN","15000.00","NGN","15000.00","150.00","1.00","RF-TXN-010","EKEDC electricity","EKEDC","4520001234",null,null,"bill_payment"],
  [uid["seed_user_007"],"send","completed","USD","10000.00","NGN","15384600.00","100.00","1538.46","RF-TXN-011","Admin test transfer","Test Recipient","0000000001","Test Bank","NG","bank_transfer"],
  [uid["seed_user_001"],"send","pending","NGN","75000.00","KES","2625.00","375.00","0.035","RF-TXN-012","Pending transfer","James Kamau","1234567890","Equity Bank","KE","bank_transfer"],
];
for (const [userId, type, status, fromCurrency, fromAmount, toCurrency, toAmount, fee, fxRate, reference, description, recipientName, recipientAccount, recipientBank, recipientCountry, channel] of txns) {
  if (!userId) continue;
  await exec(
    `INSERT INTO transactions (user_id, type, status, from_currency, from_amount, to_currency, to_amount, fee, fx_rate, reference, description, recipient_name, recipient_account, recipient_bank, recipient_country, channel, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())
     ON CONFLICT DO NOTHING`,
    [userId, type, status, fromCurrency, fromAmount, toCurrency, toAmount, fee, fxRate, reference, description, recipientName, recipientAccount, recipientBank, recipientCountry, channel]
  );
}
console.log(`   ✓ ${txns.length} transactions seeded`);

// ─── 4. Beneficiaries ─────────────────────────────────────────────────────────
console.log("🌱 Seeding beneficiaries...");
const beneficiaries = [
  [uid["seed_user_001"],"Tunde Okafor","GB29NWBK60161331926819","Barclays Bank","BARCGB22","GBP","GB","+44-7700-900-456","tunde@example.com",true],
  [uid["seed_user_001"],"Chidi Okonkwo","0987654321","GTBank","058","NGN","NG","+234-802-345-6789","chidi@example.com",true],
  [uid["seed_user_001"],"Abena Mensah","US64SVBKUS6S3300958879","Chase Bank","CHASUS33","USD","US","+1-212-555-0101","abena@example.com",false],
  [uid["seed_user_001"],"James Kamau","1234567890","Equity Bank","EQB","KES","KE","+254-722-111-222","james.k@example.com",false],
  [uid["seed_user_002"],"Kofi Asante","GH-ACC-001234","GCB Bank","GCB","GHS","GH","+233-244-111-222","kofi@example.com",true],
  [uid["seed_user_003"],"Ahmad Hassan","PK36SCBL0000001123456702","HBL Bank","HABBPKKA","PKR","PK","+92-300-123-4567","ahmad@example.com",true],
  [uid["seed_user_004"],"Grace Nakato","+256-701-234-567","MTN Mobile Money","MTN","UGX","UG","+256-701-234-567","grace@example.com",true],
  [uid["seed_user_005"],"Emma Thompson","GB82WEST12345698765432","HSBC","MIDLGB22","GBP","GB","+44-7700-900-789","emma@example.com",false],
];
for (const [userId, name, accountNumber, bankName, bankCode, currency, country, phone, email, isFavorite] of beneficiaries) {
  if (!userId) continue;
  await exec(
    `INSERT INTO beneficiaries (user_id, name, account_number, bank_name, bank_code, currency, country, phone, email, is_favorite, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) ON CONFLICT DO NOTHING`,
    [userId, name, accountNumber, bankName, bankCode, currency, country, phone, email, isFavorite]
  );
}
console.log(`   ✓ ${beneficiaries.length} beneficiaries seeded`);

// ─── 5. Cards ─────────────────────────────────────────────────────────────────
console.log("🌱 Seeding cards...");
const cards = [
  [uid["seed_user_001"],"virtual","visa","4532","12","2027","active","USD","5000.00","Amara Okafor"],
  [uid["seed_user_001"],"physical","mastercard","8821","06","2026","active","NGN","500000.00","Amara Okafor"],
  [uid["seed_user_002"],"virtual","visa","3341","09","2026","active","USD","2000.00","Kwame Mensah"],
  [uid["seed_user_003"],"physical","visa","7729","03","2028","active","AED","20000.00","Fatima Al-Rashid"],
  [uid["seed_user_005"],"virtual","mastercard","5512","11","2027","active","GBP","3000.00","Sofia Martinez"],
  [uid["seed_user_007"],"virtual","visa","0001","01","2030","active","USD","100000.00","RemitFlow Admin"],
];
for (const [userId, type, brand, last4, expiryMonth, expiryYear, status, currency, spendLimit, cardholderName] of cards) {
  if (!userId) continue;
  await exec(
    `INSERT INTO cards (user_id, type, brand, last4, expiry_month, expiry_year, status, currency, spend_limit, cardholder_name, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, type, brand, last4, expiryMonth, expiryYear, status, currency, spendLimit, cardholderName]
  );
}
console.log(`   ✓ ${cards.length} cards seeded`);

// ─── 6. Savings Goals ─────────────────────────────────────────────────────────
console.log("🌱 Seeding savings goals...");
const savingsGoals = [
  [uid["seed_user_001"],"Emergency Fund","🛡️","1000000.00","350000.00","NGN","2025-12-31",true,"50000.00","active"],
  [uid["seed_user_001"],"New MacBook","💻","750000.00","200000.00","NGN","2025-06-30",false,"0.00","active"],
  [uid["seed_user_002"],"University Fees","🎓","25000.00","8500.00","GHS","2025-09-01",true,"1000.00","active"],
  [uid["seed_user_003"],"Dubai Property","🏠","500000.00","125000.00","AED","2027-01-01",true,"10000.00","active"],
  [uid["seed_user_004"],"Family Holiday","✈️","150000.00","45000.00","KES","2025-08-01",false,"0.00","active"],
  [uid["seed_user_005"],"Home Deposit","🏡","50000.00","12500.00","GBP","2026-06-01",true,"1000.00","active"],
];
for (const [userId, name, emoji, targetAmount, currentAmount, currency, targetDate, autoSave, autoSaveAmount, status] of savingsGoals) {
  if (!userId) continue;
  await exec(
    `INSERT INTO savings_goals (user_id, name, emoji, target_amount, current_amount, currency, target_date, auto_save, auto_save_amount, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, name, emoji, targetAmount, currentAmount, currency, targetDate, autoSave, autoSaveAmount, status]
  );
}
console.log(`   ✓ ${savingsGoals.length} savings goals seeded`);

// ─── 7. FX Alerts ─────────────────────────────────────────────────────────────
console.log("🌱 Seeding FX alerts...");
const fxAlerts = [
  [uid["seed_user_001"],"USD","NGN","1600.00","above",true,false],
  [uid["seed_user_001"],"GBP","NGN","2000.00","above",true,false],
  [uid["seed_user_002"],"USD","GHS","12.50","below",true,false],
  [uid["seed_user_003"],"USD","AED","3.60","below",true,false],
  [uid["seed_user_004"],"USD","KES","125.00","below",true,false],
  [uid["seed_user_005"],"EUR","GBP","0.85","above",true,false],
];
for (const [userId, fromCurrency, toCurrency, targetRate, direction, isActive, triggered] of fxAlerts) {
  if (!userId) continue;
  await exec(
    `INSERT INTO fx_alerts (user_id, from_currency, to_currency, target_rate, direction, is_active, triggered, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT DO NOTHING`,
    [userId, fromCurrency, toCurrency, targetRate, direction, isActive, triggered]
  );
}
console.log(`   ✓ ${fxAlerts.length} FX alerts seeded`);

// ─── 8. KYC Documents ─────────────────────────────────────────────────────────
console.log("🌱 Seeding KYC documents...");
const kycDocs = [
  [uid["seed_user_001"],"passport","approved","https://cdn.example.com/kyc/passport_001.jpg","kyc/passport_001.jpg"],
  [uid["seed_user_001"],"selfie","approved","https://cdn.example.com/kyc/selfie_001.jpg","kyc/selfie_001.jpg"],
  [uid["seed_user_002"],"national_id","under_review","https://cdn.example.com/kyc/nid_002.jpg","kyc/nid_002.jpg"],
  [uid["seed_user_003"],"passport","approved","https://cdn.example.com/kyc/passport_003.jpg","kyc/passport_003.jpg"],
  [uid["seed_user_004"],"national_id","approved","https://cdn.example.com/kyc/nid_004.jpg","kyc/nid_004.jpg"],
  [uid["seed_user_005"],"drivers_license","approved","https://cdn.example.com/kyc/dl_005.jpg","kyc/dl_005.jpg"],
];
for (const [userId, docType, status, fileUrl, fileKey] of kycDocs) {
  if (!userId) continue;
  await exec(
    `INSERT INTO kyc_documents (user_id, doc_type, status, file_url, file_key, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, docType, status, fileUrl, fileKey]
  );
}
console.log(`   ✓ ${kycDocs.length} KYC documents seeded`);

// ─── 9. Notifications ─────────────────────────────────────────────────────────
console.log("🌱 Seeding notifications...");
const notifications = [
  [uid["seed_user_001"],"Transfer Successful","Your transfer of ₦150,000 to Tunde Okafor was successful.","transaction",true],
  [uid["seed_user_001"],"KYC Approved","Your identity verification (Tier 2) has been approved!","kyc",true],
  [uid["seed_user_001"],"FX Rate Alert","USD/NGN has reached your target rate of ₦1,600.","fx_alert",false],
  [uid["seed_user_001"],"Security Alert","New login detected from Lagos, Nigeria.","security",false],
  [uid["seed_user_002"],"Transfer Received","You received $500 from Amara Okafor.","transaction",false],
  [uid["seed_user_003"],"Rate Lock Expiring","Your USD/AED rate lock expires in 2 hours.","system",false],
  [uid["seed_user_007"],"New Fraud Alert","High-risk transaction flagged for review.","security",false],
];
for (const [userId, title, message, type, isRead] of notifications) {
  if (!userId) continue;
  await exec(
    `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
     VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT DO NOTHING`,
    [userId, title, message, type, isRead]
  );
}
console.log(`   ✓ ${notifications.length} notifications seeded`);

// ─── 10. Virtual Accounts ─────────────────────────────────────────────────────
console.log("🌱 Seeding virtual accounts...");
const virtualAccounts = [
  [uid["seed_user_001"],"NGN","Providus Bank","8012345678","Amara Okafor",null,"000000",null,null],
  [uid["seed_user_001"],"USD","Silvergate Bank","US64SVBKUS6S3300958879","Amara Okafor","026013576",null,null,"SVBKUS6S"],
  [uid["seed_user_001"],"GBP","Barclays Bank","GB29NWBK60161331926819","Amara Okafor",null,"20-00-00",null,"BARCGB22"],
  [uid["seed_user_003"],"AED","Emirates NBD","AE070331234567890123456","Fatima Al-Rashid",null,null,"AE070331234567890123456","EBILAEAD"],
  [uid["seed_user_005"],"GBP","Monzo Bank","GB90MONZ04000402100001","Sofia Martinez",null,"04-00-04",null,"MONZGB2L"],
];
for (const [userId, currency, bank, accountNumber, accountName, routingNumber, sortCode, iban, swiftCode] of virtualAccounts) {
  if (!userId) continue;
  await exec(
    `INSERT INTO virtual_accounts (user_id, currency, bank, account_number, account_name, routing_number, sort_code, iban, swift_code, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',NOW()) ON CONFLICT DO NOTHING`,
    [userId, currency, bank, accountNumber, accountName, routingNumber, sortCode, iban, swiftCode]
  );
}
console.log(`   ✓ ${virtualAccounts.length} virtual accounts seeded`);

// ─── 11. Recurring Payments ───────────────────────────────────────────────────
console.log("🌱 Seeding recurring payments...");
const recurringPayments = [
  [uid["seed_user_001"],"Mum's Monthly Allowance","Mrs. Grace Okafor","0123456789","First Bank","50000.00","NGN","monthly","active"],
  [uid["seed_user_001"],"Netflix Subscription","Netflix","4111111111111111","Stripe","4500.00","NGN","monthly","active"],
  [uid["seed_user_005"],"Gym Membership","PureGym","GB29NWBK60161331926819","Barclays","45.00","GBP","monthly","active"],
];
for (const [userId, name, recipientName, recipientAccount, recipientBank, amount, currency, frequency, status] of recurringPayments) {
  if (!userId) continue;
  await exec(
    `INSERT INTO recurring_payments (user_id, name, recipient_name, recipient_account, recipient_bank, amount, currency, frequency, next_run_at, status, failure_count, execution_count, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW() + INTERVAL '30 days',$9,0,3,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, name, recipientName, recipientAccount, recipientBank, amount, currency, frequency, status]
  );
}
console.log(`   ✓ ${recurringPayments.length} recurring payments seeded`);

// ─── 12. Support Tickets ──────────────────────────────────────────────────────
console.log("🌱 Seeding support tickets...");
const supportTickets = [
  [uid["seed_user_001"],"Transfer delayed — reference RF-TXN-012","My transfer to James Kamau (RF-TXN-012) has been pending for 48 hours. Please investigate.","open","high","transfers"],
  [uid["seed_user_002"],"Unable to complete KYC upload","I keep getting an error when trying to upload my national ID. The file is under 5MB.","in_progress","medium","kyc"],
  [uid["seed_user_003"],"Rate lock expired before I could use it","I locked a rate at 3.67 AED/USD but it expired before my transfer went through.","resolved","low","fx"],
];
for (const [userId, subject, message, status, priority, category] of supportTickets) {
  if (!userId) continue;
  await exec(
    `INSERT INTO support_tickets (user_id, subject, message, status, priority, category, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, subject, message, status, priority, category]
  );
}
console.log(`   ✓ ${supportTickets.length} support tickets seeded`);

// ─── 13. Rate Locks ───────────────────────────────────────────────────────────
console.log("🌱 Seeding rate locks...");
await exec(
  `INSERT INTO rate_locks (user_id, from_currency, to_currency, locked_rate, amount, expires_at, status, created_at)
   VALUES ($1,'USD','NGN','1542.50','5000.00',NOW() + INTERVAL '2 hours','active',NOW()) ON CONFLICT DO NOTHING`,
  [uid["seed_user_001"]]
);
await exec(
  `INSERT INTO rate_locks (user_id, from_currency, to_currency, locked_rate, amount, expires_at, status, created_at)
   VALUES ($1,'GBP','NGN','1948.75','2000.00',NOW() - INTERVAL '1 hour','expired',NOW() - INTERVAL '3 hours') ON CONFLICT DO NOTHING`,
  [uid["seed_user_001"]]
);
console.log("   ✓ 2 rate locks seeded");

// ─── 14. Direct Debit Mandates ────────────────────────────────────────────────
console.log("🌱 Seeding direct debit mandates...");
await exec(
  `INSERT INTO direct_debit_mandates (user_id, creditor, creditor_account, amount, currency, frequency, status, next_debit_date, mandate_ref, created_at)
   VALUES ($1,'DSTV Nigeria','DSTV-NG-001','8500.00','NGN','monthly','active',NOW() + INTERVAL '15 days','DDM-001-2025',NOW()) ON CONFLICT DO NOTHING`,
  [uid["seed_user_001"]]
);
await exec(
  `INSERT INTO direct_debit_mandates (user_id, creditor, creditor_account, amount, currency, frequency, status, next_debit_date, mandate_ref, created_at)
   VALUES ($1,'Spotify UK','SPOT-UK-001','9.99','GBP','monthly','active',NOW() + INTERVAL '7 days','DDM-002-2025',NOW()) ON CONFLICT DO NOTHING`,
  [uid["seed_user_005"]]
);
console.log("   ✓ 2 direct debit mandates seeded");

// ─── 15. BNPL Plans ───────────────────────────────────────────────────────────
console.log("🌱 Seeding BNPL plans...");
await exec(
  `INSERT INTO bnpl_plans (user_id, merchant, description, total_amount, paid_amount, currency, installments, installment_amount, interest_rate, status, next_due_date, created_at, updated_at)
   VALUES ($1,'Jumia Nigeria','Samsung Galaxy S24 Ultra','750000.00','187500.00','NGN',4,'187500.00','2.50','active',NOW() + INTERVAL '30 days',NOW(),NOW()) ON CONFLICT DO NOTHING`,
  [uid["seed_user_001"]]
);
await exec(
  `INSERT INTO bnpl_plans (user_id, merchant, description, total_amount, paid_amount, currency, installments, installment_amount, interest_rate, status, next_due_date, created_at, updated_at)
   VALUES ($1,'Konga','MacBook Air M3','1200000.00','600000.00','NGN',4,'300000.00','2.50','active',NOW() + INTERVAL '15 days',NOW(),NOW()) ON CONFLICT DO NOTHING`,
  [uid["seed_user_001"]]
);
console.log("   ✓ 2 BNPL plans seeded");

// ─── 16. CBDC Wallets ─────────────────────────────────────────────────────────
console.log("🌱 Seeding CBDC wallets...");
const cbdcWallets = [
  [uid["seed_user_001"],"eNGN","50000.00","0x1a2b3c4d5e6f7890abcdef1234567890","Central Bank of Nigeria","retail"],
  [uid["seed_user_002"],"eGHS","2500.00","0x2b3c4d5e6f7890abcdef12345678901a","Bank of Ghana","retail"],
  [uid["seed_user_003"],"dAED","15000.00","0x3c4d5e6f7890abcdef12345678901a2b","UAE Central Bank","retail"],
  [uid["seed_user_004"],"eCBK","80000.00","0x4d5e6f7890abcdef12345678901a2b3c","Central Bank of Kenya","retail"],
];
for (const [userId, currency, balance, walletAddress, issuer, walletType] of cbdcWallets) {
  if (!userId) continue;
  await exec(
    `INSERT INTO cbdc_wallets (user_id, currency, balance, wallet_address, issuer, wallet_type, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'active',NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, currency, balance, walletAddress, issuer, walletType]
  );
}
console.log(`   ✓ ${cbdcWallets.length} CBDC wallets seeded`);

// ─── 17. Stablecoin Wallets ───────────────────────────────────────────────────
console.log("🌱 Seeding stablecoin wallets...");
const stablecoinWallets = [
  [uid["seed_user_001"],"USDT","2500.00000000","0xAbCdEf1234567890AbCdEf1234567890AbCdEf12","Ethereum","ERC-20"],
  [uid["seed_user_001"],"USDC","1000.00000000","0xBcDeF01234567890BcDeF01234567890BcDeF012","Ethereum","ERC-20"],
  [uid["seed_user_001"],"cUSD","500.00000000","0xCdEf012345678901CdEf012345678901CdEf0123","Celo","Celo"],
  [uid["seed_user_003"],"USDT","10000.00000000","0xDeFg123456789012DeFg123456789012DeFg1234","Tron","TRC-20"],
  [uid["seed_user_005"],"USDC","3500.00000000","0xEfGh234567890123EfGh234567890123EfGh2345","Ethereum","ERC-20"],
];
for (const [userId, symbol, balance, walletAddress, network, protocol] of stablecoinWallets) {
  if (!userId) continue;
  await exec(
    `INSERT INTO stablecoin_wallets (user_id, symbol, balance, wallet_address, network, protocol, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'active',NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [userId, symbol, balance, walletAddress, network, protocol]
  );
}
console.log(`   ✓ ${stablecoinWallets.length} stablecoin wallets seeded`);

// ─── 18. Mojaloop Transfers ───────────────────────────────────────────────────
console.log("🌱 Seeding Mojaloop transfers...");
await exec(
  `INSERT INTO mojaloop_transfers (user_id, transfer_id, quote_id, payer_fsp, payee_fsp, payer_identifier, payee_identifier, amount, currency, status, created_at)
   VALUES ($1,'TRF-MJL-001','QTE-MJL-001','remitflow','accessbank','msisdn/+2348012345678','msisdn/+2348098765432','50000.00','NGN','COMMITTED',NOW()) ON CONFLICT DO NOTHING`,
  [uid["seed_user_001"]]
);
console.log("   ✓ 1 Mojaloop transfer seeded");

// ─── 19. POS Terminals ────────────────────────────────────────────────────────
console.log("🌱 Seeding POS terminals...");
await exec(
  `INSERT INTO pos_terminals (user_id, terminal_id, merchant_name, merchant_category, location, status, serial_number, model, last_seen, daily_limit, total_transactions, total_volume, created_at, updated_at)
   VALUES ($1,'TRM-001-LGS','Amara Fashion Store','retail','14 Adeola Odeku St, Lagos','active','SN-TRM-001-2024','Ingenico iCT220',NOW(),'500000.00',247,'12350000.00',NOW(),NOW()) ON CONFLICT DO NOTHING`,
  [uid["seed_user_001"]]
);
await exec(
  `INSERT INTO pos_terminals (user_id, terminal_id, merchant_name, merchant_category, location, status, serial_number, model, last_seen, daily_limit, total_transactions, total_volume, created_at, updated_at)
   VALUES ($1,'TRM-002-IKJ','Kemi Supermart','grocery','Ikeja, Lagos','active','SN-TRM-002-2024','Verifone VX520',NOW(),'1000000.00',512,'28750000.00',NOW(),NOW()) ON CONFLICT DO NOTHING`,
  [uid["seed_user_008"]]
);
console.log("   ✓ 2 POS terminals seeded");

// ─── 20. Agent Accounts ───────────────────────────────────────────────────────
console.log("🌱 Seeding agent accounts...");
await exec(
  `INSERT INTO agent_accounts (user_id, agent_code, business_name, location, phone, status, tier, commission_rate, daily_limit, total_transactions, total_volume, rating, created_at, updated_at)
   VALUES ($1,'AGT-001-LGS','Kemi Express Money','Ikeja, Lagos','+234-803-456-7890','active','silver','1.75','2000000.00',1247,'62350000.00','4.85',NOW(),NOW()) ON CONFLICT DO NOTHING`,
  [uid["seed_user_008"]]
);
console.log("   ✓ 1 agent account seeded");

// ─── 21. Audit Logs ───────────────────────────────────────────────────────────
console.log("🌱 Seeding audit logs...");
const auditLogs = [
  [uid["seed_user_001"],"user.login","User logged in via Manus OAuth","102.89.23.45","Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)","info"],
  [uid["seed_user_001"],"transfer.send","Sent ₦150,000 to Tunde Okafor (RF-TXN-001)","102.89.23.45","Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)","info"],
  [uid["seed_user_001"],"kyc.upload","Uploaded passport document for KYC Tier 2","102.89.23.45","Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)","info"],
  [uid["seed_user_001"],"security.2fa_enabled","Two-factor authentication enabled","102.89.23.45","Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)","info"],
  [uid["seed_user_007"],"admin.fraud_review","Reviewed and blocked fraud alert #001","198.51.100.1","Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)","warning"],
];
for (const [userId, action, description, ipAddress, userAgent, severity] of auditLogs) {
  if (!userId) continue;
  await exec(
    `INSERT INTO audit_logs (user_id, action, description, ip_address, user_agent, severity, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT DO NOTHING`,
    [userId, action, description, ipAddress, userAgent, severity]
  );
}
console.log(`   ✓ ${auditLogs.length} audit logs seeded`);

// ─── 22. Fraud Alerts ─────────────────────────────────────────────────────────
console.log("🌱 Seeding fraud alerts...");
await exec(
  `INSERT INTO fraud_alerts (user_id, risk_level, flags, status, risk_score, reviewer_notes, created_at)
   VALUES ($1,'high','["velocity_exceeded","unusual_country","large_amount"]','pending',87,null,NOW()) ON CONFLICT DO NOTHING`,
  [uid["seed_user_001"]]
);
await exec(
  `INSERT INTO fraud_alerts (user_id, risk_level, flags, status, risk_score, reviewer_notes, created_at)
   VALUES ($1,'medium','["new_device","off_hours"]','reviewed',45,'Verified with customer via phone',NOW()) ON CONFLICT DO NOTHING`,
  [uid["seed_user_002"]]
);
console.log("   ✓ 2 fraud alerts seeded");

// ─── 23. FX Rate Cache ────────────────────────────────────────────────────────
console.log("🌱 Seeding FX rate cache...");
const rates = {
  USD:1, NGN:1538.46, GBP:0.7925, EUR:0.9215, KES:130.5, GHS:12.4,
  ZAR:18.7, TZS:2580, UGX:3750, RWF:1285, XOF:605, XAF:605,
  EGP:30.9, MAD:10.1, ETB:56.8, SAR:3.75, AED:3.67, CNY:7.24,
  INR:83.1, JPY:149.5, CAD:1.36, AUD:1.53, CHF:0.895, BRL:4.97,
  MXN:17.2, SGD:1.34, HKD:7.82, SEK:10.4, NOK:10.6, DKK:6.88,
  PLN:3.97, CZK:22.8, HUF:356, RON:4.58, TRY:30.5, PKR:279,
};
await exec(
  `INSERT INTO fx_rate_cache (base_currency, rates, fetched_at) VALUES ('USD',$1,NOW())
   ON CONFLICT DO NOTHING`,
  [JSON.stringify(rates)]
);
console.log("   ✓ FX rate cache seeded");

// ─── 24. Consent Records ─────────────────────────────────────────────────────
console.log("🌱 Seeding consent records...");
const consentTypes = ["marketing_emails","analytics","third_party_sharing","push_notifications","sms_alerts"];
for (const consentType of consentTypes) {
  await exec(
    `INSERT INTO consent_records (user_id, consent_type, granted, version, ip_address, granted_at, created_at)
     VALUES ($1,$2,true,'1.0','102.89.23.45',NOW(),NOW()) ON CONFLICT DO NOTHING`,
    [uid["seed_user_001"], consentType]
  );
}
console.log(`   ✓ ${consentTypes.length} consent records seeded`);

// ─── 25. KYB Records ─────────────────────────────────────────────────────────
console.log("🌱 Seeding KYB records...");
await exec(
  `INSERT INTO kyb_records (user_id, business_name, registration_number, tax_id, incorporation_date, country, industry, website, annual_revenue, employee_count, ubo_name, ubo_ownership, status, risk_rating, created_at, updated_at)
   VALUES ($1,'Amara Fashion Ltd','RC-1234567','TIN-9876543','2019-03-15','NG','retail','https://amarafashion.ng','25000000.00',12,'Amara Okafor','100.00','approved','low',NOW(),NOW()) ON CONFLICT DO NOTHING`,
  [uid["seed_user_001"]]
);
console.log("   ✓ 1 KYB record seeded");

// ─── 26. Outbox Events ────────────────────────────────────────────────────────
console.log("🌱 Seeding outbox events...");
await exec(
  `INSERT INTO outbox_events (aggregate_id, aggregate_type, event_type, payload, status, retry_count, max_retries, created_at)
   VALUES ('RF-TXN-001','transaction','transfer.completed','{"transactionId":"RF-TXN-001","userId":1,"amount":"150000","currency":"NGN"}','published',0,3,NOW()) ON CONFLICT DO NOTHING`
);
await exec(
  `INSERT INTO outbox_events (aggregate_id, aggregate_type, event_type, payload, status, retry_count, max_retries, created_at)
   VALUES ('RF-TXN-012','transaction','transfer.pending','{"transactionId":"RF-TXN-012","userId":1,"amount":"75000","currency":"NGN"}','pending',0,3,NOW()) ON CONFLICT DO NOTHING`
);
console.log("   ✓ 2 outbox events seeded");

// ─── 27. Batch Payments ───────────────────────────────────────────────────────
console.log("🌱 Seeding batch payments...");
const batchPayload = JSON.stringify([
  { name: "Chidi Okonkwo", account: "0987654321", bank: "GTBank", amount: "25000", currency: "NGN", status: "completed" },
  { name: "Tunde Okafor",  account: "1234567890", bank: "First Bank", amount: "30000", currency: "NGN", status: "completed" },
  { name: "Ngozi Eze",     account: "0111222333", bank: "Zenith Bank", amount: "20000", currency: "NGN", status: "failed" },
]);
await exec(
  `INSERT INTO batch_payments (user_id, name, total_amount, currency, total_recipients, success_count, failed_count, status, payments, created_at, updated_at)
   VALUES ($1,'December Staff Bonuses','75000.00','NGN',3,2,1,'partial',$2,NOW(),NOW()) ON CONFLICT DO NOTHING`,
  [uid["seed_user_001"], batchPayload]
);
console.log("   ✓ 1 batch payment seeded");

// ─── 28. Referrals ────────────────────────────────────────────────────────────
console.log("🌱 Seeding referrals...");
if (uid["seed_user_001"] && uid["seed_user_002"]) {
  await exec(
    `INSERT INTO referrals (referrer_id, referred_id, status, reward_amount, reward_currency, created_at)
     VALUES ($1,$2,'rewarded','500.00','NGN',NOW()) ON CONFLICT DO NOTHING`,
    [uid["seed_user_001"], uid["seed_user_002"]]
  );
}
if (uid["seed_user_001"] && uid["seed_user_008"]) {
  await exec(
    `INSERT INTO referrals (referrer_id, referred_id, status, reward_amount, reward_currency, created_at)
     VALUES ($1,$2,'completed','500.00','NGN',NOW()) ON CONFLICT DO NOTHING`,
    [uid["seed_user_001"], uid["seed_user_008"]]
  );
}
console.log("   ✓ 2 referrals seeded");

// ─── 29. Disputes ─────────────────────────────────────────────────────────────
console.log("🌱 Seeding disputes...");
await exec(
  `INSERT INTO disputes (user_id, type, description, status, created_at, updated_at)
   VALUES ($1,'not_received','I sent ₦150,000 to Tunde Okafor 3 days ago but he has not received it. Reference: RF-TXN-001','under_review',NOW(),NOW()) ON CONFLICT DO NOTHING`,
  [uid["seed_user_001"]]
);
console.log("   ✓ 1 dispute seeded");

// ─── 30. Payment Metrics ──────────────────────────────────────────────────────
console.log("🌱 Seeding payment metrics...");
const metrics = [
  [uid["seed_user_001"],"NGN-GBP",45,2,2340,"6750000.00","2025-01"],
  [uid["seed_user_001"],"NGN-USD",120,5,1890,"18450000.00","2025-01"],
  [uid["seed_user_002"],"GHS-USD",28,1,2100,"70000.00","2025-01"],
];
for (const [userId, corridor, successCount, failureCount, avgProcessingMs, totalVolume, period] of metrics) {
  if (!userId) continue;
  await exec(
    `INSERT INTO payment_metrics (user_id, corridor, success_count, failure_count, avg_processing_ms, total_volume, period, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT DO NOTHING`,
    [userId, corridor, successCount, failureCount, avgProcessingMs, totalVolume, period]
  );
}
console.log(`   ✓ ${metrics.length} payment metrics seeded`);

// ─── Done ─────────────────────────────────────────────────────────────────────
await client.end();
console.log("\n✅ PostgreSQL seed complete! All 30 tables seeded with realistic data.");
console.log("   Users: 8 | Wallets: 15 | Transactions: 12 | Beneficiaries: 8");
console.log("   Cards: 6 | Savings: 6 | FX Alerts: 6 | KYC Docs: 6");
console.log("   Notifications: 7 | Virtual Accounts: 5 | Recurring: 3");
console.log("   Support Tickets: 3 | Rate Locks: 2 | BNPL: 2 | CBDC: 4");
console.log("   Stablecoins: 5 | Mojaloop: 1 | POS: 2 | Agents: 1");
console.log("   Audit Logs: 5 | Fraud Alerts: 2 | Batch: 1 | Referrals: 2");
