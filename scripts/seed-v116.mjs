/**
 * RemitFlow v116 — Incremental Seed Script (PostgreSQL)
 * Seeds new tables introduced in v115-v116:
 *   - payment_requests (Request Money flow)
 *   - fx_rate_history (7-day FX rate history)
 *
 * Safe to run multiple times (uses INSERT ... ON CONFLICT DO NOTHING)
 * Usage: node scripts/seed-v116.mjs
 */
import postgres from "postgres";
import crypto from "crypto";

const DB_URL = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("❌ LOCAL_DATABASE_URL or DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(DB_URL, { ssl: "require", max: 3 });
console.log("✅ Connected to PostgreSQL");

// ─── Get existing users ───────────────────────────────────────────────────────
const users = await sql`SELECT id, email FROM users ORDER BY id LIMIT 10`;
if (users.length === 0) {
  console.log("No users found — run seed.mjs first");
  await sql.end();
  process.exit(0);
}
console.log(`Found ${users.length} users`);

// ─── 1. Seed payment_requests ─────────────────────────────────────────────────
console.log("\n📋 Seeding payment_requests...");
const requestScenarios = [
  { amount: "250.00", currency: "USD", description: "Monthly rent contribution", status: "pending",   hoursOffset: 72 },
  { amount: "45.00",  currency: "GBP", description: "Dinner split",              status: "paid",      hoursOffset: 24 },
  { amount: "1200.00",currency: "NGN", description: "School fees",               status: "pending",   hoursOffset: 168 },
  { amount: null,     currency: "USD", description: "Any amount welcome",         status: "pending",   hoursOffset: 48 },
  { amount: "80.00",  currency: "EUR", description: "Concert tickets",            status: "expired",   hoursOffset: -1 },
  { amount: "500.00", currency: "KES", description: "Groceries",                  status: "cancelled", hoursOffset: 24 },
  { amount: "150.00", currency: "USD", description: "Medical consultation",       status: "pending",   hoursOffset: 48 },
  { amount: "30.00",  currency: "GBP", description: "Taxi fare",                  status: "paid",      hoursOffset: 12 },
];

let seeded = 0;
for (let i = 0; i < Math.min(users.length, requestScenarios.length); i++) {
  const user = users[i];
  const s = requestScenarios[i];
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + s.hoursOffset * 3600 * 1000);

  try {
    await sql`
      INSERT INTO payment_requests
        (requester_id, token, amount, currency, description, status, expires_at, created_at, updated_at)
      VALUES
        (${user.id}, ${token}, ${s.amount}, ${s.currency}, ${s.description}, ${s.status}, ${expiresAt}, NOW(), NOW())
      ON CONFLICT (token) DO NOTHING
    `;
    seeded++;
  } catch (err) {
    console.warn(`  ⚠️  Row ${i}: ${err.message.slice(0, 80)}`);
  }
}
console.log(`  ✅ Seeded ${seeded} payment_requests`);

// ─── 2. FX rate history ───────────────────────────────────────────────────────
console.log("\n💱 Seeding fx_rate_history...");
// Check if table exists
const fxTableCheck = await sql`
  SELECT tablename FROM pg_tables
  WHERE schemaname='public' AND tablename='fx_rate_history'
`;
if (fxTableCheck.length > 0) {
  const fxPairs = [
    { from: "USD", to: "NGN", rate: 1538.46 },
    { from: "USD", to: "KES", rate: 130.50 },
    { from: "USD", to: "GHS", rate: 12.40 },
    { from: "GBP", to: "NGN", rate: 1941.23 },
    { from: "EUR", to: "NGN", rate: 1669.12 },
    { from: "USD", to: "GBP", rate: 0.7925 },
    { from: "USD", to: "EUR", rate: 0.9215 },
    { from: "USD", to: "ZAR", rate: 18.42 },
    { from: "USD", to: "TZS", rate: 2580.00 },
    { from: "USD", to: "UGX", rate: 3720.00 },
  ];
  let fxSeeded = 0;
  for (const pair of fxPairs) {
    for (let day = 0; day < 7; day++) {
      const variation = 1 + (Math.random() - 0.5) * 0.02;
      const rate = (pair.rate * variation).toFixed(4);
      const ts = new Date(Date.now() - day * 24 * 3600 * 1000);
      try {
        await sql`
          INSERT INTO fx_rate_history (from_currency, to_currency, rate, source, recorded_at)
          VALUES (${pair.from}, ${pair.to}, ${rate}, 'open.er-api.com', ${ts})
          ON CONFLICT DO NOTHING
        `;
        fxSeeded++;
      } catch (_) {}
    }
  }
  console.log(`  ✅ FX rate history seeded (${fxSeeded} rows)`);
} else {
  console.log("  ⚠️  fx_rate_history table not found — skipping");
}

// ─── 3. Summary ──────────────────────────────────────────────────────────────
const [{ count: prCount }] = await sql`SELECT COUNT(*)::int as count FROM payment_requests`;
console.log(`\n📊 payment_requests total: ${prCount}`);

await sql.end();
console.log("✅ v116 seed complete");
