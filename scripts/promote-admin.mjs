/**
 * Promote demo/test users to admin role
 * Usage: node scripts/promote-admin.mjs
 */
import postgres from 'postgres';
import * as dotenv from "dotenv";
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

// Parse postgres://user:pass@host:port/db
const sql = postgres(process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL, { max: 5, idle_timeout: 30 });
// postgres-js helper: simulate mysql2 execute(sql, params)
async function exec(q, params = []) {
  const parts = q.split('?');
  const strings = Object.assign(parts, { raw: parts });
  return sql(strings, ...params);
}

const conn = { sql };

const ADMIN_EMAILS = [
  "demo@remitflow.app",
  "amara.okafor@remitflow.test",
  "admin@remitflow.app",
];
const ADMIN_OPEN_IDS = [
  "dev-user-001",
];

let promoted = 0;
for (const email of ADMIN_EMAILS) {
  const [result] = await exec(
    "UPDATE users SET role = 'admin' WHERE email = ?",
    [email]
  );
  if (result.affectedRows > 0) {
    console.log(`✓ Promoted ${email} to admin`);
    promoted++;
  }
}
for (const openId of ADMIN_OPEN_IDS) {
  const [result] = await exec(
    "UPDATE users SET role = 'admin' WHERE openId = ?",
    [openId]
  );
  if (result.affectedRows > 0) {
    console.log(`✓ Promoted openId=${openId} to admin`);
    promoted++;
  }
}

if (promoted === 0) {
  console.log("No users found to promote. Run seed-all.mjs first.");
} else {
  console.log(`\n✅ ${promoted} user(s) promoted to admin`);
}

await sql.end();
