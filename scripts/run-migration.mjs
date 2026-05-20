import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

const pool = new Pool({ 
  connectionString: process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL,
  ssl: process.env.LOCAL_DATABASE_URL ? undefined : { rejectUnauthorized: false }
});

const sqlFile = path.join(__dirname, '../drizzle/0019_many_yellowjacket.sql');
const sql = fs.readFileSync(sqlFile, 'utf8');
const stmts = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);

let passed = 0, skipped = 0, failed = 0;
for (const stmt of stmts) {
  try {
    await pool.query(stmt);
    passed++;
  } catch(e) {
    if (e.message.includes('already exists')) {
      skipped++;
    } else {
      console.error('FAILED:', stmt.slice(0, 120));
      console.error('ERROR:', e.message);
      failed++;
    }
  }
}
console.log(`Migration complete: ${passed} passed, ${skipped} skipped (already exist), ${failed} failed`);

// Mark migration as applied in drizzle journal
try {
  await pool.query(`
    INSERT INTO "__drizzle_migrations" (hash, created_at)
    VALUES ('0019_many_yellowjacket', extract(epoch from now()) * 1000)
    ON CONFLICT DO NOTHING
  `);
  console.log('Migration journal updated');
} catch(e) {
  console.log('Journal update skipped:', e.message.slice(0, 80));
}

await pool.end();
