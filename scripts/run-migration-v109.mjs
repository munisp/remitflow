import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbUrl = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: dbUrl?.includes("localhost") ? false : { rejectUnauthorized: false },
});

const sql = readFileSync(join(__dirname, "../drizzle/0020_rich_millenium_guard.sql"), "utf8");

// Split on --> statement-breakpoint
const statements = sql
  .split("--> statement-breakpoint")
  .map(s => s.trim())
  .filter(Boolean);

let passed = 0, skipped = 0, failed = 0;

for (const stmt of statements) {
  if (!stmt) continue;
  try {
    await pool.query(stmt);
    passed++;
  } catch (e) {
    if (e.message?.includes("already exists") || e.message?.includes("duplicate")) {
      skipped++;
    } else {
      console.error("FAILED:", e.message, "\nSQL:", stmt.slice(0, 100));
      failed++;
    }
  }
}

console.log(`Migration complete: ${passed} passed, ${skipped} skipped (already exist), ${failed} failed`);
await pool.end();
