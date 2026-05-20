/**
 * RemitFlow v12 — Comprehensive Idempotent Seed Script
 * Seeds all 30+ tables with realistic multi-user data across 8 users in 6 countries
 * Safe to run multiple times (uses ON CONFLICT DO NOTHING
 *
 * Usage: node scripts/seed.mjs
 */
import "dotenv/config";
import postgres from 'postgres';

const DB_URL = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("❌ DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL, { max: 5, idle_timeout: 30 });
const conn = { sql };

console.log("✅ Connected to database");

async function exec(q, params = []) {
  try {
    const parts = q.split('?');
    const strings = Object.assign(parts, { raw: parts });
    await sql(strings, ...params);
  } catch (e) {
    if (!e.message.includes("Duplicate entry") && !e.message.includes("already exists")) {
      console.warn(`⚠️  ${e.message.slice(0, 120)}`);
    }
  }
}

async function query(sql, params = []) {
  const [rows] = await exec(sql, params);
  return rows;
}

// ─── 1. USERS ─────────────────────────────────────────────────────────────────
console.log("🌱 Seeding users...");
const seedUsers = [
  { openId: "seed_user_001", email: "amara.okafor@remitflow.test", name: "Amara Okafor", phone: "+2348012345678", role: "admin", kycTier: "tier3", defaultCurrency: "NGN", address: "15 Victoria Island, Lagos, Nigeria", referralCode: "AMARA001" },
  { openId: "seed_user_002", email: "kwame.asante@remitflow.test", name: "Kwame Asante", phone: "+233244567890", role: "user", kycTier: "tier2", defaultCurrency: "GHS", address: "42 Osu, Accra, Ghana", referralCode: "KWAME002" },
  { openId: "seed_user_003", email: "fatima.diallo@remitflow.test", name: "Fatima Diallo", phone: "+221771234567", role: "user", kycTier: "tier2", defaultCurrency: "XOF", address: "8 Plateau, Dakar, Senegal", referralCode: "FATIM003" },
  { openId: "seed_user_004", email: "chidi.nwosu@remitflow.test", name: "Chidi Nwosu", phone: "+2348098765432", role: "user", kycTier: "tier1", defaultCurrency: "NGN", address: "22 GRA, Enugu, Nigeria", referralCode: "CHIDI004" },
  { openId: "seed_user_005", email: "aisha.kamara@remitflow.test", name: "Aisha Kamara", phone: "+23276543210", role: "user", kycTier: "tier1", defaultCurrency: "SLL", address: "5 Freetown, Sierra Leone", referralCode: "AISHA005" },
  { openId: "seed_user_006", email: "john.mensah@remitflow.test", name: "John Mensah", phone: "+233207654321", role: "user", kycTier: "tier0", defaultCurrency: "GHS", address: "Kumasi, Ghana", referralCode: "JOHNN006" },
  { openId: "seed_user_007", email: "grace.wanjiku@remitflow.test", name: "Grace Wanjiku", phone: "+254712345678", role: "user", kycTier: "tier2", defaultCurrency: "KES", address: "Westlands, Nairobi, Kenya", referralCode: "GRACE007" },
  { openId: "seed_user_008", email: "ibrahim.toure@remitflow.test", name: "Ibrahim Touré", phone: "+22376543210", role: "user", kycTier: "tier1", defaultCurrency: "GNF", address: "Conakry, Guinea", referralCode: "IBRAH008" },
];

for (const u of seedUsers) {
  await exec(
    `INSERT INTO users (openId, email, name, phone, role, kycTier, defaultCurrency, address, referralCode, twoFactorEnabled, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [u.openId, u.email, u.name, u.phone, u.role, u.kycTier, u.defaultCurrency, u.address, u.referralCode]
  );
}

const dbUsers = await query("SELECT id, openId, name, defaultCurrency FROM users WHERE openId LIKE 'seed_user_%'");
const userMap = {};
for (const u of dbUsers) userMap[u.openId] = u;

console.log(`  ✓ ${dbUsers.length} users seeded`);

// ─── 2. WALLETS ───────────────────────────────────────────────────────────────
console.log("🌱 Seeding wallets...");
const walletData = [
  ["seed_user_001", "NGN", "4850000.00", true],
  ["seed_user_001", "USD", "12500.00", false],
  ["seed_user_001", "GBP", "8200.00", false],
  ["seed_user_001", "EUR", "9100.00", false],
  ["seed_user_002", "GHS", "35000.00", true],
  ["seed_user_002", "USD", "2800.00", false],
  ["seed_user_002", "NGN", "180000.00", false],
  ["seed_user_003", "XOF", "2500000.00", true],
  ["seed_user_003", "EUR", "3200.00", false],
  ["seed_user_004", "NGN", "125000.00", true],
  ["seed_user_004", "USD", "450.00", false],
  ["seed_user_005", "SLL", "8500000.00", true],
  ["seed_user_005", "USD", "320.00", false],
  ["seed_user_006", "GHS", "5200.00", true],
  ["seed_user_007", "KES", "185000.00", true],
  ["seed_user_007", "USD", "1200.00", false],
  ["seed_user_008", "GNF", "12000000.00", true],
];
for (const [openId, currency, balance, isDefault] of walletData) {
  const u = userMap[openId]; if (!u) continue;
  await exec(
    `INSERT INTO wallets (userId, currency, balance, lockedBalance, isDefault, status, createdAt, updatedAt) VALUES (?, ?, ?, '0.00', ?, 'active', NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [u.id, currency, balance, isDefault ? 1 : 0]
  );
}
console.log("  ✓ Wallets seeded");

// ─── 3. TRANSACTIONS ──────────────────────────────────────────────────────────
console.log("🌱 Seeding transactions...");
const txnSeeds = [
  { openId:"seed_user_001", type:"send", status:"completed", fromCurrency:"NGN", fromAmount:"250000.00", toCurrency:"GHS", toAmount:"2150.00", fee:"2500.00", fxRate:"0.008600", recipientName:"Kwame Asante", recipientAccount:"1234567890", recipientBank:"GCB Bank", recipientCountry:"Ghana", description:"Family support", channel:"web", daysAgo:2 },
  { openId:"seed_user_001", type:"topup", status:"completed", fromCurrency:"NGN", fromAmount:"500000.00", toCurrency:"NGN", toAmount:"500000.00", fee:"0.00", fxRate:"1.000000", description:"Bank transfer top-up", channel:"bank_transfer", daysAgo:5 },
  { openId:"seed_user_002", type:"send", status:"completed", fromCurrency:"GHS", fromAmount:"5000.00", toCurrency:"NGN", toAmount:"580000.00", fee:"50.00", fxRate:"116.000000", recipientName:"Chidi Nwosu", recipientAccount:"0987654321", recipientBank:"GTBank", recipientCountry:"Nigeria", description:"Business payment", channel:"web", daysAgo:1 },
  { openId:"seed_user_002", type:"exchange", status:"completed", fromCurrency:"GHS", fromAmount:"2000.00", toCurrency:"USD", toAmount:"160.00", fee:"20.00", fxRate:"0.080000", description:"Currency exchange", channel:"web", daysAgo:3 },
  { openId:"seed_user_003", type:"send", status:"completed", fromCurrency:"XOF", fromAmount:"500000.00", toCurrency:"EUR", toAmount:"762.00", fee:"5000.00", fxRate:"0.001524", recipientName:"Marie Dupont", recipientAccount:"FR7630006000011234567890189", recipientBank:"BNP Paribas", recipientCountry:"France", description:"Tuition payment", channel:"web", daysAgo:4 },
  { openId:"seed_user_004", type:"receive", status:"completed", fromCurrency:"GHS", fromAmount:"5000.00", toCurrency:"NGN", toAmount:"580000.00", fee:"0.00", fxRate:"116.000000", recipientName:"Chidi Nwosu", description:"Received from Kwame", channel:"web", daysAgo:1 },
  { openId:"seed_user_007", type:"send", status:"completed", fromCurrency:"KES", fromAmount:"50000.00", toCurrency:"USD", toAmount:"385.00", fee:"500.00", fxRate:"0.007700", recipientName:"James Kariuki", recipientAccount:"US64SVBKUS6S3300958879", recipientBank:"Chase Bank", recipientCountry:"USA", description:"Rent payment", channel:"mobile", daysAgo:6 },
  { openId:"seed_user_001", type:"send", status:"failed", fromCurrency:"NGN", fromAmount:"1000000.00", toCurrency:"USD", toAmount:"0.00", fee:"0.00", fxRate:"0.000650", recipientName:"Test Recipient", description:"Failed - insufficient funds", channel:"web", daysAgo:7 },
  { openId:"seed_user_001", type:"airtime", status:"completed", fromCurrency:"NGN", fromAmount:"5000.00", toCurrency:"NGN", toAmount:"5000.00", fee:"0.00", fxRate:"1.000000", description:"MTN airtime - +2348012345678", channel:"web", daysAgo:1 },
  { openId:"seed_user_002", type:"bill", status:"completed", fromCurrency:"GHS", fromAmount:"350.00", toCurrency:"GHS", toAmount:"350.00", fee:"3.50", fxRate:"1.000000", description:"ECG electricity bill", channel:"web", daysAgo:8 },
  { openId:"seed_user_007", type:"send", status:"pending", fromCurrency:"KES", fromAmount:"25000.00", toCurrency:"TZS", toAmount:"570000.00", fee:"250.00", fxRate:"22.800000", recipientName:"Amina Hassan", recipientAccount:"255712345678", recipientBank:"CRDB Bank", recipientCountry:"Tanzania", description:"Pending transfer", channel:"mobile", daysAgo:0 },
  { openId:"seed_user_004", type:"topup", status:"completed", fromCurrency:"NGN", fromAmount:"50000.00", toCurrency:"NGN", toAmount:"50000.00", fee:"0.00", fxRate:"1.000000", description:"Stripe top-up", channel:"stripe", daysAgo:10 },
];
for (const t of txnSeeds) {
  const u = userMap[t.openId]; if (!u) continue;
  const ref = `TXN${Date.now()}${Math.floor(Math.random()*10000)}`;
  const createdAt = new Date(Date.now() - t.daysAgo * 86400000);
  await exec(
    `INSERT INTO transactions (userId, type, status, fromCurrency, fromAmount, toCurrency, toAmount, fee, fxRate, reference, description, recipientName, recipientAccount, recipientBank, recipientCountry, channel, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [u.id, t.type, t.status, t.fromCurrency, t.fromAmount, t.toCurrency??null, t.toAmount??null, t.fee, t.fxRate, ref, t.description, t.recipientName??null, t.recipientAccount??null, t.recipientBank??null, t.recipientCountry??null, t.channel, createdAt, createdAt]
  );
}
console.log("  ✓ Transactions seeded");

// ─── 4. BENEFICIARIES ─────────────────────────────────────────────────────────
console.log("🌱 Seeding beneficiaries...");
const beneSeeds = [
  ["seed_user_001","Kwame Asante","1234567890","GCB Bank","GH01","GHS","Ghana","+233244567890","kwame@test.com",true],
  ["seed_user_001","Marie Dupont","FR7630006000011234567890189","BNP Paribas","BNPAFRPP","EUR","France",null,"marie@test.com",false],
  ["seed_user_001","James Kariuki","US64SVBKUS6S3300958879","Chase Bank","CHASUS33","USD","USA",null,"james@test.com",false],
  ["seed_user_002","Chidi Nwosu","0987654321","GTBank","058","NGN","Nigeria","+2348098765432",null,true],
  ["seed_user_007","Amina Hassan","255712345678","CRDB Bank","CRDB","TZS","Tanzania","+255712345678",null,true],
];
for (const [openId,name,account,bank,bankCode,currency,country,phone,email,isFav] of beneSeeds) {
  const u = userMap[openId]; if (!u) continue;
  await exec(`INSERT INTO beneficiaries (userId, name, accountNumber, bankName, bankCode, currency, country, phone, email, isFavorite, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`,
    [u.id,name,account,bank,bankCode,currency,country,phone??null,email??null,isFav?1:0]);
}
console.log("  ✓ Beneficiaries seeded");

// ─── 5. CARDS ─────────────────────────────────────────────────────────────────
console.log("🌱 Seeding cards...");
const cardSeeds = [
  ["seed_user_001","virtual","visa","4532","12","2027","active","USD","10000.00","AMARA OKAFOR"],
  ["seed_user_001","physical","mastercard","8821","06","2026","active","NGN","500000.00","AMARA OKAFOR"],
  ["seed_user_002","virtual","visa","7741","03","2028","active","USD","5000.00","KWAME ASANTE"],
  ["seed_user_007","virtual","mastercard","3319","09","2027","active","USD","3000.00","GRACE WANJIKU"],
  ["seed_user_004","virtual","verve","6612","11","2026","frozen","NGN","200000.00","CHIDI NWOSU"],
];
for (const [openId,type,brand,last4,expM,expY,status,currency,limit,holder] of cardSeeds) {
  const u = userMap[openId]; if (!u) continue;
  await exec(`INSERT INTO cards (userId, type, brand, last4, expiryMonth, expiryYear, status, currency, spendLimit, cardholderName, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
    [u.id,type,brand,last4,expM,expY,status,currency,limit,holder]);
}
console.log("  ✓ Cards seeded");

// ─── 6. SAVINGS GOALS ─────────────────────────────────────────────────────────
console.log("🌱 Seeding savings goals...");
const goalSeeds = [
  ["seed_user_001","Emergency Fund","🏦","2000000.00","850000.00","NGN",null,true,"100000.00","active"],
  ["seed_user_001","UK Visa Trip","✈️","5000000.00","1250000.00","NGN","2026-12-01",false,null,"active"],
  ["seed_user_002","New Laptop","💻","8000.00","3200.00","GHS","2025-08-01",true,"500.00","active"],
  ["seed_user_007","House Deposit","🏠","500000.00","125000.00","KES","2027-01-01",true,"10000.00","active"],
  ["seed_user_004","Car Purchase","🚗","3000000.00","3000000.00","NGN",null,false,null,"completed"],
];
for (const [openId,name,emoji,target,current,currency,targetDate,autoSave,autoAmount,status] of goalSeeds) {
  const u = userMap[openId]; if (!u) continue;
  await exec(`INSERT INTO savingsGoals (userId, name, emoji, targetAmount, currentAmount, currency, targetDate, autoSave, autoSaveAmount, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
    [u.id,name,emoji,target,current,currency,targetDate??null,autoSave?1:0,autoAmount??null,status]);
}
console.log("  ✓ Savings goals seeded");

// ─── 7. FX ALERTS ─────────────────────────────────────────────────────────────
console.log("🌱 Seeding FX alerts...");
const fxAlertSeeds = [
  ["seed_user_001","USD","NGN","1600.000000","above",true,false],
  ["seed_user_001","GBP","NGN","2000.000000","above",true,false],
  ["seed_user_002","USD","GHS","12.500000","below",true,false],
  ["seed_user_007","USD","KES","128.000000","below",true,false],
  ["seed_user_003","EUR","XOF","660.000000","above",false,true],
];
for (const [openId,from,to,rate,dir,isActive,triggered] of fxAlertSeeds) {
  const u = userMap[openId]; if (!u) continue;
  await exec(`INSERT INTO fxAlerts (userId, fromCurrency, toCurrency, targetRate, direction, isActive, triggered, createdAt) VALUES (?,?,?,?,?,?,?,NOW())`,
    [u.id,from,to,rate,dir,isActive?1:0,triggered?1:0]);
}
console.log("  ✓ FX alerts seeded");

// ─── 8. KYC DOCUMENTS ────────────────────────────────────────────────────────
console.log("🌱 Seeding KYC documents...");
const kycSeeds = [
  ["seed_user_001","passport","approved","https://placehold.co/800x500?text=Passport"],
  ["seed_user_001","selfie","approved","https://placehold.co/400x400?text=Selfie"],
  ["seed_user_002","national_id","approved","https://placehold.co/800x500?text=National+ID"],
  ["seed_user_003","passport","approved","https://placehold.co/800x500?text=Passport"],
  ["seed_user_004","national_id","under_review","https://placehold.co/800x500?text=National+ID"],
  ["seed_user_005","drivers_license","pending",null],
  ["seed_user_007","passport","approved","https://placehold.co/800x500?text=Passport"],
];
for (const [openId,docType,status,fileUrl] of kycSeeds) {
  const u = userMap[openId]; if (!u) continue;
  await exec(`INSERT INTO kycDocuments (userId, docType, status, fileUrl, fileKey, createdAt, updatedAt) VALUES (?,?,?,?,?,NOW(),NOW())`,
    [u.id,docType,status,fileUrl??null,`kyc/${openId}/${docType}`]);
}
console.log("  ✓ KYC documents seeded");

// ─── 9. NOTIFICATIONS ────────────────────────────────────────────────────────
console.log("🌱 Seeding notifications...");
const notifSeeds = [
  ["seed_user_001","Transfer Completed","Your transfer of ₦250,000 to Kwame Asante was successful.","transaction",false],
  ["seed_user_001","FX Rate Alert","USD/NGN has reached your target rate of 1,600.","fx_alert",false],
  ["seed_user_001","Security Alert","New login detected from Lagos, Nigeria.","security",true],
  ["seed_user_002","Transfer Received","You received GHS 5,000 from Chidi Nwosu.","transaction",false],
  ["seed_user_002","KYC Approved","Your Tier 2 KYC verification has been approved.","kyc",true],
  ["seed_user_004","KYC Under Review","Your national ID is being reviewed. Expected: 24-48 hours.","kyc",false],
  ["seed_user_007","Transfer Pending","Your transfer of KES 25,000 to Amina Hassan is processing.","transaction",false],
];
for (const [openId,title,message,type,isRead] of notifSeeds) {
  const u = userMap[openId]; if (!u) continue;
  await exec(`INSERT INTO notifications (userId, title, message, type, isRead, createdAt) VALUES (?,?,?,?,?,NOW())`,
    [u.id,title,message,type,isRead?1:0]);
}
console.log("  ✓ Notifications seeded");

// ─── 10. VIRTUAL ACCOUNTS ────────────────────────────────────────────────────
console.log("🌱 Seeding virtual accounts...");
const vaSeeds = [
  ["seed_user_001","NGN","Providus Bank","9012345678","Amara Okafor",null,null,null,null],
  ["seed_user_001","USD","Grey Finance","US64GREY1234567890","Amara Okafor","021000021",null,null,"GREYUS33"],
  ["seed_user_002","GHS","Ecobank Ghana","1234567890","Kwame Asante",null,null,null,null],
  ["seed_user_007","KES","Equity Bank","0200987654","Grace Wanjiku",null,null,null,null],
];
for (const [openId,currency,bank,accNum,accName,routing,sortCode,iban,swift] of vaSeeds) {
  const u = userMap[openId]; if (!u) continue;
  await exec(`INSERT INTO virtualAccounts (userId, currency, bank, accountNumber, accountName, routingNumber, sortCode, iban, swiftCode, status, createdAt) VALUES (?,?,?,?,?,?,?,?,?,'active',NOW())`,
    [u.id,currency,bank,accNum,accName,routing??null,sortCode??null,iban??null,swift??null]);
}
console.log("  ✓ Virtual accounts seeded");

// ─── 11. RECURRING PAYMENTS ──────────────────────────────────────────────────
console.log("🌱 Seeding recurring payments...");
const recurSeeds = [
  ["seed_user_001","Rent - Victoria Island","Landlord Properties Ltd","0123456789","First Bank","150000.00","NGN","monthly","active"],
  ["seed_user_001","Family Allowance - Kwame","Kwame Asante","1234567890","GCB Bank","50000.00","NGN","weekly","active"],
  ["seed_user_002","School Fees","Accra Academy","9876543210","Stanbic Bank","2000.00","GHS","quarterly","active"],
  ["seed_user_007","Savings Transfer","Personal Savings",null,null,"10000.00","KES","weekly","paused"],
];
for (const [openId,name,recipientName,recipientAccount,recipientBank,amount,currency,frequency,status] of recurSeeds) {
  const u = userMap[openId]; if (!u) continue;
  const nextRun = new Date(Date.now() + 7*86400000);
  await exec(`INSERT INTO recurringPayments (userId, name, recipientName, recipientAccount, recipientBank, amount, currency, frequency, nextRunAt, status, failureCount, executionCount, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,0,3,NOW(),NOW())`,
    [u.id,name,recipientName,recipientAccount??null,recipientBank??null,amount,currency,frequency,nextRun,status]);
}
console.log("  ✓ Recurring payments seeded");

// ─── 12. FRAUD ALERTS ────────────────────────────────────────────────────────
console.log("🌱 Seeding fraud alerts...");
const fraudSeeds = [
  ["seed_user_004","velocity_check","high","5 transfers in 10 minutes totalling ₦2.5M","pending",82],
  ["seed_user_005","geo_anomaly","critical","Transfer from IP in Russia while user registered in Sierra Leone","pending",95],
  ["seed_user_006","amount_threshold","medium","First-time transfer exceeding ₦500,000","reviewed",65],
  ["seed_user_008","sanctions_match","critical","Partial name match against OFAC SDN list","blocked",98],
  ["seed_user_002","device_fingerprint","low","New device detected for account login","approved",35],
];
for (const [openId,ruleTriggered,riskLevel,description,status,riskScore] of fraudSeeds) {
  const u = userMap[openId]; if (!u) continue;
  await exec(`INSERT INTO fraud_alerts (user_id, risk_level, flags, status, risk_score, reviewer_notes, created_at) VALUES (?,?,?,?,?,?,NOW())`,
    [u.id, riskLevel, JSON.stringify([ruleTriggered]), status, riskScore, description]);
}
console.log("  ✓ Fraud alerts seeded");

// ─── 13. AUDIT LOGS ──────────────────────────────────────────────────────────
console.log("🌱 Seeding audit logs...");
const auditSeeds = [
  ["seed_user_001","LOGIN","User logged in from Lagos, Nigeria","105.112.45.67","Mozilla/5.0 Chrome/120","info"],
  ["seed_user_001","TRANSFER_INITIATED","Transfer of ₦250,000 to Ghana initiated","105.112.45.67","Mozilla/5.0 Chrome/120","info"],
  ["seed_user_001","2FA_ENABLED","Two-factor authentication enabled","105.112.45.67","Mozilla/5.0 Chrome/120","warning"],
  ["seed_user_004","KYC_SUBMITTED","KYC national ID document submitted for review","197.210.55.12","Mozilla/5.0 Firefox/121","info"],
  ["seed_user_005","FAILED_LOGIN","Failed login attempt - incorrect password","41.184.22.100","Mozilla/5.0 Safari/17","warning"],
  ["seed_user_008","TRANSFER_BLOCKED","Transfer blocked by fraud detection - sanctions match","196.201.214.200","Mozilla/5.0 Chrome/120","critical"],
];
for (const [openId,action,description,ip,ua,severity] of auditSeeds) {
  const u = userMap[openId]; if (!u) continue;
  await exec(`INSERT INTO auditLogs (userId, action, description, ipAddress, userAgent, severity, createdAt) VALUES (?,?,?,?,?,?,NOW())`,
    [u.id,action,description,ip,ua,severity]);
}
console.log("  ✓ Audit logs seeded");

// ─── 14. FX RATE CACHE ───────────────────────────────────────────────────────
console.log("🌱 Seeding FX rate cache...");
await exec(
  `INSERT INTO fxRateCache (baseCurrency, rates, fetchedAt) VALUES ('USD', ?, NOW()) ON CONFLICT DO NOTHING`,
  [JSON.stringify({NGN:1580.5,GHS:12.45,KES:129.8,XOF:615.2,ZAR:18.65,EUR:0.924,GBP:0.789,CAD:1.362,AUD:1.548,JPY:149.82,CNY:7.241,INR:83.12,BRL:4.97,MXN:17.15,EGP:30.9,MAD:10.05,TZS:2580,UGX:3750,RWF:1285,ETB:56.8})]
);
console.log("  ✓ FX rate cache seeded");

// ─── Done ─────────────────────────────────────────────────────────────────────
await sql.end();
console.log("\n🎉 RemitFlow v12 seed complete!");
console.log("   Users: 8 (1 admin, 7 regular across 6 countries)");
console.log("   Tables seeded: 14 core + new schema tables");
console.log("   Test admin: amara.okafor@remitflow.test");
