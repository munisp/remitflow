/**
 * RemitFlow v94 Expanded Seed Script
 * 100 users, 500 transfers, 30 partner applications, 20 tenants, A/B experiments, referral bonuses
 * Run: node scripts/seed-v94.mjs
 */
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.LOCAL_DATABASE_URL,
  ssl: false,
});

const client = await pool.connect();
console.log("✓ Connected to database");

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[rnd(0, arr.length - 1)]; }
function randDate(daysAgo, daysAgoEnd = 0) {
  const now = Date.now();
  return new Date(now - rnd(daysAgoEnd * 86400000, daysAgo * 86400000));
}
function ref() { return "RF" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase(); }

// ─── Data Arrays ──────────────────────────────────────────────────────────────
const FIRST_NAMES = [
  "Adaeze","Kwame","Fatima","Chidi","Amara","Kofi","Zainab","Emeka","Ama","Tunde",
  "Ngozi","Yaw","Halima","Obinna","Akosua","Segun","Mariam","Femi","Abena","Kola",
  "Ifeoma","Kwabena","Aisha","Uche","Efua","Babatunde","Nkechi","Kweku","Hauwa","Dele",
  "Chisom","Fiifi","Ramatu","Ikenna","Adjoa","Rotimi","Fatou","Chukwuemeka","Esi","Wale",
  "Oluwaseun","Nana","Maryam","Ifeanyi","Abiba","Olumide","Adwoa","Biodun","Salamatu","Tobi",
  "James","Sarah","Michael","Emma","David","Olivia","Daniel","Sophia","Matthew","Isabella",
  "Chiamaka","Kwasi","Bilkisu","Nnamdi","Aba","Lanre","Fanta","Chukwuma","Ekua","Sola",
  "Oluwafunmilayo","Yoofi","Aissatou","Ikechukwu","Adjoa","Rotimi","Fatou","Emeka","Esi","Wale",
  "Ahmed","Fatou","Ibrahim","Amina","Moussa","Kadiatou","Mamadou","Mariama","Oumar","Fatoumata",
  "Cheikh","Rokhaya","Modou","Ndèye","Pape","Astou","Babacar","Coumba","Ibrahima","Khady",
];
const LAST_NAMES = [
  "Okonkwo","Asante","Al-Hassan","Adeyemi","Mensah","Abiodun","Diallo","Okafor","Acheampong","Bello",
  "Eze","Owusu","Sow","Nwosu","Boateng","Adegoke","Traore","Chukwu","Amponsah","Adesanya",
  "Nwachukwu","Antwi","Camara","Obi","Asare","Afolabi","Coulibaly","Nwankwo","Adjei","Fashola",
  "Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Wilson","Taylor",
  "Diallo","Kouyate","Balde","Barry","Toure","Sylla","Bah","Conde","Camara","Keita",
  "Ndoye","Diop","Fall","Ndiaye","Mbaye","Seck","Gueye","Faye","Sarr","Diouf",
];
const COUNTRIES = ["NG","GH","KE","SN","CM","ZA","UG","TZ","GB","US","CA","DE","FR","AE","SA"];
const CURRENCIES = ["NGN","GHS","KES","XOF","XAF","ZAR","UGX","TZS","GBP","USD","CAD","EUR","AED","SAR"];
const KYC_TIERS = ["tier0","tier1","tier1","tier2","tier2","tier3"];
const TX_STATUSES = ["completed","completed","completed","completed","pending","processing","failed"];
const TX_TYPES = ["send","receive","exchange","topup","withdrawal"];

// ─── Seed 100 Users ───────────────────────────────────────────────────────────
console.log("\n👥 Seeding 100 users...");
const userIds = [];
for (let i = 1; i <= 100; i++) {
  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  const name = `${firstName} ${lastName}`;
  const openId = `seed-user-v94-${i.toString().padStart(3, "0")}`;
  const emailAddr = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@remitflow.demo`;
  const kycTier = pick(KYC_TIERS);
  const role = i === 1 ? "admin" : "user";
  const createdAt = randDate(365, 30);
  const referralCode = `RF${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  
  try {
    const result = await client.query(
      `INSERT INTO users ("openId", name, email, role, "kycTier", phone, "defaultCurrency", "referralCode", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       ON CONFLICT ("openId") DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [openId, name, emailAddr, role, kycTier, `+234${rnd(7000000000, 9999999999)}`, pick(CURRENCIES), referralCode, createdAt]
    );
    userIds.push(result.rows[0].id);
  } catch (e) {
    try {
      const existing = await client.query(`SELECT id FROM users WHERE "openId" = $1`, [openId]);
      if (existing.rows.length > 0) userIds.push(existing.rows[0].id);
    } catch {}
  }
}
console.log(`✓ ${userIds.length} users seeded`);

// ─── Seed Wallets ─────────────────────────────────────────────────────────────
console.log("\n💰 Seeding wallets...");
let walletCount = 0;
for (const userId of userIds.slice(0, 60)) {
  const currency = pick(CURRENCIES);
  const balance = rnd(100, 500000);
  try {
    await client.query(
      `INSERT INTO wallets ("userId", currency, balance, status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'active', NOW(), NOW())
       ON CONFLICT ("userId", currency) DO NOTHING`,
      [userId, currency, balance]
    );
    walletCount++;
  } catch {}
}
console.log(`✓ ${walletCount} wallets seeded`);

// ─── Seed 500 Transactions ────────────────────────────────────────────────────
console.log("\n💸 Seeding 500 transactions...");
let txCount = 0;
for (let i = 0; i < 500; i++) {
  const userId = pick(userIds);
  const txType = pick(TX_TYPES);
  const status = pick(TX_STATUSES);
  const fromAmount = rnd(1000, 5000000);
  const fromCurrency = pick(CURRENCIES);
  const toCurrency = pick(CURRENCIES);
  const fxRate = (0.0001 + Math.random() * 2).toFixed(6);
  const fee = Math.floor(fromAmount * 0.005);
  const toAmount = Math.floor(fromAmount * parseFloat(fxRate));
  const createdAt = randDate(365, 0);
  const recipientNames = ["John Doe","Jane Smith","Kwame Mensah","Fatima Diallo","Chidi Okonkwo","Ama Asante"];
  
  try {
    await client.query(
      `INSERT INTO transactions ("userId", type, status, "fromCurrency", "fromAmount", "toCurrency", "toAmount", "fxRate", fee, reference, description, "recipientName", "recipientCountry", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`,
      [userId, txType, status, fromCurrency, fromAmount, toCurrency, toAmount, fxRate, fee, ref(), `${txType} transaction`, pick(recipientNames), pick(COUNTRIES), createdAt]
    );
    txCount++;
  } catch {}
}
console.log(`✓ ${txCount} transactions seeded`);

// ─── Seed 30 Partner Applications ────────────────────────────────────────────
console.log("\n🤝 Seeding 30 partner applications...");
const PARTNER_NAMES = [
  "AfriPay Solutions","NairaExpress","GhanaLink","KenyaRemit","SenegalMoney",
  "CameroonCash","ZARemit","UgandaPay","TanzaniaTransfer","DiasporaFirst",
  "GlobalSend","FastRemit","QuickTransfer","EasyMoney","SwiftPay",
  "AfricaConnect","HomeRemit","FamilyFirst","TrustTransfer","SecureSend",
  "MobileRemit","DigitalCash","SmartPay","PayAfrica","RemitPlus",
  "CrossBorderPay","InstantRemit","PrimePay","EliteSend","ProTransfer",
];
let partnerCount = 0;
for (let i = 0; i < 30; i++) {
  const name = PARTNER_NAMES[i];
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + `-${i}`;
  const country = pick(COUNTRIES);
  const status = pick(["pending","approved","approved","approved","rejected"]);
  
  try {
    await client.query(
      `INSERT INTO partner_applications (company_name, brand_name, slug, application_type, contact_name, contact_email, contact_phone, website, country, registration_number, business_description, expected_monthly_volume, expected_user_count, requested_plan, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
       ON CONFLICT (slug) DO NOTHING`,
      [name, name, slug, "white_label", `CEO of ${name}`, `ceo@${slug}.com`, `+1${rnd(2000000000, 9999999999)}`, `https://${slug}.com`, country, `REG${rnd(100000, 999999)}`, `${name} provides cross-border payment services`, rnd(100000, 5000000), rnd(100, 10000), pick(["starter","growth","enterprise"]), status, randDate(180, 0)]
    );
    partnerCount++;
  } catch {}
}
console.log(`✓ ${partnerCount} partner applications seeded`);

// ─── Seed 20 Tenants ──────────────────────────────────────────────────────────
console.log("\n🏢 Seeding 20 tenants...");
const TENANT_NAMES = [
  "AfriBank White Label","DigiPay Platform","MobileFirst Remit","QuickSend Pro",
  "TrustPay Enterprise","GlobalRemit Hub","AfricaFirst Pay","SmartTransfer Corp",
  "PayLink Solutions","RemitCore Platform","SwiftBridge Finance","DiasporaHub",
  "CrossPay Network","InstantBridge","PrimeSend Platform","EliteRemit Corp",
  "ProPay Solutions","NexusPay Africa","ApexTransfer","ZenithRemit",
];
let tenantCount = 0;
for (let i = 0; i < 20; i++) {
  const name = TENANT_NAMES[i];
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + `-${i}`;
  const ownerId = userIds.length > 0 ? pick(userIds) : null;
  
  try {
    await client.query(
      `INSERT INTO tenants (slug, name, plan, status, owner_id, primary_color, secondary_color, support_email, default_currency, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $9)
       ON CONFLICT (slug) DO NOTHING`,
      [slug, name, pick(["starter","growth","enterprise"]), ownerId, `#${Math.floor(Math.random()*16777215).toString(16).padStart(6,'0')}`, `#${Math.floor(Math.random()*16777215).toString(16).padStart(6,'0')}`, `support@${slug}.com`, pick(CURRENCIES), randDate(365, 0)]
    );
    tenantCount++;
  } catch {}
}
console.log(`✓ ${tenantCount} tenants seeded`);

// ─── Seed A/B Experiments ─────────────────────────────────────────────────────
console.log("\n🧪 Seeding A/B experiments...");
const experiments = [
  {
    name: "Landing Page Hero CTA",
    description: "Test 'Send Money Now' vs 'Get Started Free' CTA button",
    status: "running",
    variants: JSON.stringify([
      { id: "control", name: "Send Money Now", weight: 50, description: "Original CTA" },
      { id: "variant_a", name: "Get Started Free", weight: 50, description: "New CTA" },
    ]),
    startDate: randDate(30, 0),
    endDate: null,
  },
  {
    name: "Onboarding Flow Length",
    description: "3-step vs 5-step onboarding comparison",
    status: "running",
    variants: JSON.stringify([
      { id: "control", name: "5-Step Onboarding", weight: 50, description: "Full onboarding" },
      { id: "variant_a", name: "3-Step Onboarding", weight: 50, description: "Streamlined" },
    ]),
    startDate: randDate(14, 0),
    endDate: null,
  },
  {
    name: "Fee Display Format",
    description: "Show fee as percentage vs fixed amount",
    status: "completed",
    variants: JSON.stringify([
      { id: "control", name: "Percentage Fee", weight: 50, description: "Show as 0.5%" },
      { id: "variant_a", name: "Fixed Fee", weight: 50, description: "Show as $2.50" },
    ]),
    startDate: randDate(90, 60),
    endDate: randDate(60, 30),
  },
  {
    name: "Referral Bonus Amount",
    description: "Test $5 vs $10 referral bonus impact on conversion",
    status: "draft",
    variants: JSON.stringify([
      { id: "control", name: "$5 Bonus", weight: 50, description: "Standard bonus" },
      { id: "variant_a", name: "$10 Bonus", weight: 50, description: "Double bonus" },
    ]),
    startDate: null,
    endDate: null,
  },
  {
    name: "Exchange Rate Display",
    description: "Show live rate vs locked rate in calculator",
    status: "running",
    variants: JSON.stringify([
      { id: "control", name: "Live Rate", weight: 33, description: "Real-time rate" },
      { id: "variant_a", name: "Locked Rate", weight: 33, description: "Rate locked for 15min" },
      { id: "variant_b", name: "Best Rate Guarantee", weight: 34, description: "Best rate badge" },
    ]),
    startDate: randDate(7, 0),
    endDate: null,
  },
];

let expCount = 0;
for (const exp of experiments) {
  try {
    await client.query(
      `INSERT INTO ab_experiments (name, description, status, variants, start_date, end_date, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (name) DO UPDATE SET status = EXCLUDED.status`,
      [exp.name, exp.description, exp.status, exp.variants, exp.startDate, exp.endDate]
    );
    expCount++;
  } catch (e) {
    // Try without ON CONFLICT if constraint doesn't exist
    try {
      await client.query(
        `INSERT INTO ab_experiments (name, description, status, variants, start_date, end_date, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [exp.name, exp.description, exp.status, exp.variants, exp.startDate, exp.endDate]
      );
      expCount++;
    } catch {}
  }
}
console.log(`✓ ${expCount} A/B experiments seeded`);

// ─── Seed Referral Bonuses ────────────────────────────────────────────────────
console.log("\n🎁 Seeding referral bonuses...");
let refCount = 0;
if (userIds.length >= 2) {
  for (let i = 0; i < 60; i++) {
    const referrerId = pick(userIds);
    const otherUsers = userIds.filter(id => id !== referrerId);
    if (otherUsers.length === 0) continue;
    const referredId = pick(otherUsers);
    const status = pick(["pending","approved","paid","paid","paid","rejected"]);
    
    try {
      await client.query(
        `INSERT INTO referral_bonuses (referrer_id, referred_id, referrer_bonus, referred_bonus, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [referrerId, referredId, "5.00", "2.00", status, randDate(180, 0)]
      );
      refCount++;
    } catch {}
  }
}
console.log(`✓ ${refCount} referral bonuses seeded`);

// ─── Seed Rate Alert History ──────────────────────────────────────────────────
console.log("\n📊 Seeding rate alert history...");
let alertCount = 0;
for (let i = 0; i < 120; i++) {
  const userId = pick(userIds);
  const fromCurrency = pick(["USD","GBP","EUR","CAD"]);
  const toCurrency = pick(["NGN","GHS","KES","XOF"]);
  const targetRate = (rnd(100, 2000) + Math.random()).toFixed(6);
  const actualRate = (parseFloat(targetRate) * (0.98 + Math.random() * 0.04)).toFixed(6);
  const direction = pick(["above","below"]);
  const status = pick(["triggered","triggered","snoozed","dismissed"]);
  const triggeredAt = randDate(90, 0);
  
  try {
    await client.query(
      `INSERT INTO rate_alert_history (user_id, from_currency, to_currency, target_rate, actual_rate, direction, status, triggered_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8)`,
      [userId, fromCurrency, toCurrency, targetRate, actualRate, direction, status, triggeredAt]
    );
    alertCount++;
  } catch {}
}
console.log(`✓ ${alertCount} rate alert history records seeded`);

// ─── Seed Document Vault ──────────────────────────────────────────────────────
console.log("\n📁 Seeding document vault...");
const DOC_CATEGORIES = ["identity","address","financial","compliance","contract","other"];
const DOC_STATUSES = ["active","active","active","expired","archived"];
let docCount = 0;
const vaultUsers = userIds.slice(0, Math.min(40, userIds.length));
for (let i = 0; i < 100; i++) {
  if (vaultUsers.length === 0) break;
  const userId = pick(vaultUsers);
  const category = pick(DOC_CATEGORIES);
  const status = pick(DOC_STATUSES);
  const now = new Date();
  const expiresAt = status === "expired"
    ? new Date(now.getTime() - rnd(30, 365) * 86400000)
    : (Math.random() > 0.5 ? new Date(now.getTime() + rnd(30, 730) * 86400000) : null);
  
  try {
    await client.query(
      `INSERT INTO document_vault (user_id, name, category, status, file_url, file_key, file_size, mime_type, tags, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [
        userId,
        `${category.charAt(0).toUpperCase() + category.slice(1)} Document ${i + 1}`,
        category,
        status,
        `https://placehold.co/400x300?text=${encodeURIComponent(category)}`,
        `vault/${userId}/${category}-${i}-${Date.now()}.pdf`,
        rnd(50000, 5000000),
        "application/pdf",
        JSON.stringify([category, "2024", "verified"]),
        expiresAt,
        randDate(180, 0),
      ]
    );
    docCount++;
  } catch {}
}
console.log(`✓ ${docCount} document vault records seeded`);

// ─── Seed Audit Logs ──────────────────────────────────────────────────────────
console.log("\n📋 Seeding audit logs...");
const AUDIT_ACTIONS = [
  "USER_LOGIN","USER_LOGOUT","TRANSFER_INITIATED","TRANSFER_COMPLETED","KYC_SUBMITTED",
  "KYC_APPROVED","PROFILE_UPDATED","PASSWORD_CHANGED","2FA_ENABLED","WALLET_CREATED",
  "BENEFICIARY_ADDED","RATE_ALERT_SET","DOCUMENT_UPLOADED","REFERRAL_CODE_USED",
];
let auditCount = 0;
for (let i = 0; i < 200; i++) {
  const userId = pick(userIds);
  const action = pick(AUDIT_ACTIONS);
  const severity = pick(["info","info","info","warning","critical"]);
  
  try {
    await client.query(
      `INSERT INTO "auditLogs" ("userId", action, description, severity, "createdAt")
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, action, `User performed ${action.toLowerCase().replace(/_/g, " ")}`, severity, randDate(90, 0)]
    );
    auditCount++;
  } catch {}
}
console.log(`✓ ${auditCount} audit logs seeded`);

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log("\n✅ v94 Seed complete!");
console.log(`   Users: ${userIds.length}`);
console.log(`   Wallets: ${walletCount}`);
console.log(`   Transactions: ${txCount}`);
console.log(`   Partner Applications: ${partnerCount}`);
console.log(`   Tenants: ${tenantCount}`);
console.log(`   A/B Experiments: ${expCount}`);
console.log(`   Referral Bonuses: ${refCount}`);
console.log(`   Rate Alert History: ${alertCount}`);
console.log(`   Document Vault: ${docCount}`);
console.log(`   Audit Logs: ${auditCount}`);

client.release();
await pool.end();
