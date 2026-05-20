/**
 * Seed initial partner invite codes for RemitFlow v68
 * Usage: node scripts/seed-invite-codes.mjs
 */
import postgres from 'postgres';

const dbUrl = process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL;
const sql = postgres(process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL, { max: 5, idle_timeout: 30 });
// postgres-js helper: simulate mysql2 execute(sql, params)
async function exec(q, params = []) {
  const parts = q.split('?');
  const strings = Object.assign(parts, { raw: parts });
  return sql(strings, ...params);
}

const connection = { sql };

console.log("Connected to database");

// Get admin user ID
const [adminRows] = await exec(`SELECT id FROM user WHERE role = 'admin' LIMIT 1`);
const adminId = adminRows[0]?.id ?? 1;

const codes = [
  {
    code: "REMIT-STARTER-2026",
    plan: "starter",
    description: "Default starter code for new partners — up to 100 users, $50K/mo volume",
    max_uses: 10,
    expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    is_active: 1,
    created_by: adminId,
  },
  {
    code: "REMIT-GROWTH-2026",
    plan: "growth",
    description: "Growth tier code — up to 1,000 users, $500K/mo volume",
    max_uses: 5,
    expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
    is_active: 1,
    created_by: adminId,
  },
  {
    code: "REMIT-ENTERPRISE-VIP",
    plan: "enterprise",
    description: "Enterprise VIP code — unlimited users and volume",
    max_uses: 3,
    expires_at: null,
    is_active: 1,
    created_by: adminId,
  },
  {
    code: "AFRICA-FINTECH-2026",
    plan: "growth",
    description: "Africa Fintech Summit 2026 partner code",
    max_uses: 20,
    expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    is_active: 1,
    created_by: adminId,
  },
  {
    code: "DIASPORA-PARTNER-UK",
    plan: "starter",
    description: "UK Diaspora community partner code",
    max_uses: 15,
    expires_at: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000),
    is_active: 1,
    created_by: adminId,
  },
];

let inserted = 0;
let skipped = 0;

for (const code of codes) {
  const [existing] = await exec(
    `SELECT id FROM partner_invite_codes WHERE code = ?`,
    [code.code]
  );
  if (existing.length > 0) {
    console.log(`  SKIP: ${code.code} (already exists)`);
    skipped++;
    continue;
  }

  await exec(
    `INSERT INTO partner_invite_codes (code, plan, description, max_uses, expires_at, is_active, created_by, used_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
    [code.code, code.plan, code.description, code.max_uses, code.expires_at, code.is_active, code.created_by]
  );
  console.log(`  OK: ${code.code} (${code.plan})`);
  inserted++;
}

console.log(`\nDone: ${inserted} inserted, ${skipped} skipped`);
await sql.end();
