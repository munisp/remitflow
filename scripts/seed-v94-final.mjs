/**
 * RemitFlow v94 Final Seed — wallets, partner_applications, tenants
 */
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.LOCAL_DATABASE_URL, ssl: false });
const client = await pool.connect();
console.log("Connected");

const CURRENCIES = ["NGN","GHS","KES","XOF","XAF","ZAR","UGX","TZS","GBP","USD","CAD","EUR","AED","SAR"];
const COUNTRIES = ["NG","GH","KE","SN","CM","ZA","UG","TZ","GB","US","CA","DE","FR","AE","SA"];
const APP_TYPES = ["fintech_startup","bank","mfi","ngo","telecom","aggregator","enterprise","other"];

function rnd(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function pick(arr) { return arr[rnd(0, arr.length - 1)]; }
function randDate(days) { return new Date(Date.now() - rnd(0, days * 86400000)); }

const userRows = await client.query("SELECT id FROM users ORDER BY id LIMIT 100");
const userIds = userRows.rows.map(r => r.id);
console.log("Users found:", userIds.length);

// Wallets
let wc = 0;
for (const uid of userIds.slice(0, 60)) {
  try {
    await client.query(
      `INSERT INTO wallets ("userId", currency, balance, status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'active', NOW(), NOW())
       ON CONFLICT ("userId", currency) DO NOTHING`,
      [uid, pick(CURRENCIES), rnd(100, 500000)]
    );
    wc++;
  } catch {}
}
console.log("Wallets:", wc);

// Partner Applications
const PARTNER_NAMES = [
  "AfriPay Solutions","NairaExpress","GhanaLink","KenyaRemit","SenegalMoney",
  "CameroonCash","ZARemit","UgandaPay","TanzaniaTransfer","DiasporaFirst",
  "GlobalSend","FastRemit","QuickTransfer","EasyMoney","SwiftPay",
  "AfricaConnect","HomeRemit","FamilyFirst","TrustTransfer","SecureSend",
  "MobileRemit","DigitalCash","SmartPay","PayAfrica","RemitPlus",
  "CrossBorderPay","InstantRemit","PrimePay","EliteSend","ProTransfer",
];
let pc = 0;
for (let i = 0; i < 30; i++) {
  const name = PARTNER_NAMES[i];
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-v94c-" + i;
  try {
    await client.query(
      `INSERT INTO partner_applications
       (company_name, brand_name, slug, application_type, contact_name, contact_email, country, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       ON CONFLICT (slug) DO NOTHING`,
      [name, name, slug, pick(APP_TYPES), "CEO of " + name, "ceo@" + slug + ".com",
       pick(COUNTRIES), pick(["pending","approved","approved","rejected"]), randDate(180)]
    );
    pc++;
  } catch (e) {
    console.log("partner err:", e.message.slice(0, 80));
  }
}
console.log("Partners:", pc);

// Tenants
const TENANT_NAMES = [
  "AfriBank WL","DigiPay Platform","MobileFirst Remit","QuickSend Pro",
  "TrustPay Enterprise","GlobalRemit Hub","AfricaFirst Pay","SmartTransfer Corp",
  "PayLink Solutions","RemitCore Platform","SwiftBridge Finance","DiasporaHub",
  "CrossPay Network","InstantBridge","PrimeSend Platform","EliteRemit Corp",
  "ProPay Solutions","NexusPay Africa","ApexTransfer","ZenithRemit",
];
let tc = 0;
for (let i = 0; i < 20; i++) {
  const name = TENANT_NAMES[i];
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-v94c-" + i;
  try {
    await client.query(
      `INSERT INTO tenants
       (slug, name, plan, status, owner_id, primary_color, secondary_color, support_email, default_currency, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, NOW(), NOW())
       ON CONFLICT (slug) DO NOTHING`,
      [slug, name, pick(["starter","growth","enterprise"]), pick(userIds),
       "#1a56db", "#7e3af2", "support@" + slug + ".com", pick(CURRENCIES)]
    );
    tc++;
  } catch (e) {
    console.log("tenant err:", e.message.slice(0, 80));
  }
}
console.log("Tenants:", tc);

client.release();
await pool.end();
console.log("Done");
