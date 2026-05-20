import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

const connStr = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL || '';
const pool = new Pool({ connectionString: connStr });

const sqlFile = path.join(__dirname, '../drizzle/0014_nifty_dakota_north.sql');
const sql = fs.readFileSync(sqlFile, 'utf8');
const statements = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(s => s.length > 0);

const client = await pool.connect();
try {
  for (const stmt of statements) {
    try {
      await client.query(stmt);
    } catch (e) {
      if (e.message.includes('already exists')) {
        console.log('Skip (already exists):', stmt.substring(0, 60));
      } else {
        throw e;
      }
    }
  }
  console.log('Migration v94 applied OK, statements:', statements.length);
} finally {
  client.release();
  await pool.end();
}
