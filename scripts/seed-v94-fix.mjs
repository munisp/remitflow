/**
 * RemitFlow v94 Seed Fix — wallets, partner_applications, tenants, referral_bonuses, rate_alert_history
 */
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.LOCAL_DATABASE_URL, ssl: false });
const client = await pool.connect();
console.log("✓ Connected to database");

function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[rnd(0, arr.length - 1)]; }
function randDate(daysAgo, daysAgoEnd = 0) {
  const now = Date.now();
  return new Date(now - rnd(daysAgoEnd * 86400000, daysAgo * 86400000));
}
function ref() { return "RF" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase(); }

const CURRENCIES = ["NGN","GHS","KES","XOF","XAF","ZAR","UGX","TZS","GBP","USD","CAD","EUR","AED","SAR"];
const COUNTRIES = ["NG","GH","KE","SN","CM","ZA","UG","TZ","GB","US","CA","DE","FR","AE","SA"];

// Get existing user IDs
const userRows = await client.query("SELECT id FROM users ORDER BY id LIMIT 100");
const userIds = userRows.rows.map(r => r.id);
console.log(`Found ${userIds.length} users`);

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
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + `-v94-${i}`;
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
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + `-v94-${i}`;
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

// ─── Seed Referral Bonuses ────────────────────────────────────────────────────
console.log("\n🎁 Seeding referral bonuses...");
let refCount = 0;
for (let i = 0; i < 60; i++) {
  if (userIds.length < 2) break;
  const referrerId = pick(userIds);
  const otherUsers = userIds.filter(id => id !== referrerId);
  const referredId = pick(otherUsers);
  const status = pick(["pending","approved","paid","paid","paid","rejected"]);
  const referralCode = `REF${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  
  try {
    await client.query(
      `INSERT INTO referral_bonuses (referrer_id, referred_id, referral_code, referrer_bonus, referred_bonus, currency, status, trigger_event, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [referrerId, referredId, referralCode, "5.00", "2.00", "USD", status, "first_transfer", randDate(180, 0)]
    );
    refCount++;
  } catch {}
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
      `INSERT INTO rate_alert_history (user_id, from_currency, to_currency, target_rate, actual_rate, direction, status, notification_sent, triggered_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [userId, fromCurrency, toCurrency, targetRate, actualRate, direction, status, true, triggeredAt]
    );
    alertCount++;
  } catch {}
}
console.log(`✓ ${alertCount} rate alert history records seeded`);

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log("\n✅ v94 Fix Seed complete!");
console.log(`   Wallets: ${walletCount}`);
console.log(`   Partner Applications: ${partnerCount}`);
console.log(`   Tenants: ${tenantCount}`);
console.log(`   Referral Bonuses: ${refCount}`);
console.log(`   Rate Alert History: ${alertCount}`);

client.release();
await pool.end();
