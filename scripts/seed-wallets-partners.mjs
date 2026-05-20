/**
 * Seed wallets and partner applications with correct enum values
 */
import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.LOCAL_DATABASE_URL, ssl: false });
const client = await pool.connect();

const CURRENCIES = ["NGN","GHS","KES","XOF","ZAR","GBP","USD","EUR","CAD","AED"];
const APP_TYPES = ["fintech_startup","bank","mfi","ngo","telecom","aggregator","enterprise","other"];
const APP_STATUSES = ["submitted","under_review","approved","approved","rejected"];
const COUNTRIES = ["NG","GH","KE","SN","CM","ZA","UG","TZ","GB","US"];

function rnd(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function pick(arr) { return arr[rnd(0, arr.length - 1)]; }
function randDate(days) { return new Date(Date.now() - rnd(0, days * 86400000)); }

const userRows = await client.query("SELECT id FROM users ORDER BY id LIMIT 100");
const userIds = userRows.rows.map(r => r.id);
console.log("Users:", userIds.length);

// Wallets
let wc = 0;
for (const uid of userIds.slice(0, 60)) {
  try {
    await client.query(
      `INSERT INTO wallets ("userId", currency, balance, status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'active', NOW(), NOW())`,
      [uid, pick(CURRENCIES), rnd(100, 500000)]
    );
    wc++;
  } catch (e) {
    // ignore duplicate key errors
  }
}
console.log("Wallets seeded:", wc);

// Partner Applications
const PNAMES = [
  "AfriPay Plus","NairaXpress","GhanaLink Pro","KenyaRemit Plus","SenegalPay",
  "CameroonCash Pro","ZARemit Plus","UgandaPay Pro","TanzaniaTransfer Pro","DiasporaFirst Pro",
  "GlobalSend Pro","FastRemit Plus","QuickTransfer Pro","EasyMoney Pro","SwiftPay Plus",
  "AfricaConnect Pro","HomeRemit Plus","FamilyFirst Pro","TrustTransfer Plus","SecureSend Pro",
  "MobileRemit Plus","DigitalCash Pro","SmartPay Plus","PayAfrica Pro","RemitPlus Pro",
  "CrossBorderPay Pro","InstantRemit Plus","PrimePay Pro","EliteSend Plus","ProTransfer Pro",
];
let pc = 0;
for (let i = 0; i < 30; i++) {
  const name = PNAMES[i];
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-v94e-" + i;
  try {
    await client.query(
      `INSERT INTO partner_applications
       (company_name, brand_name, slug, application_type, contact_name, contact_email, country, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       ON CONFLICT (slug) DO NOTHING`,
      [name, name, slug, pick(APP_TYPES), "CEO " + name, "ceo@" + slug + ".com",
       pick(COUNTRIES), pick(APP_STATUSES), randDate(180)]
    );
    pc++;
  } catch (e) {
    console.log("partner err:", e.message.slice(0, 80));
  }
}
console.log("Partners seeded:", pc);

client.release();
await pool.end();
console.log("Done");
