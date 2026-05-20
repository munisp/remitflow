import pg from "pg";
import { readFileSync } from "fs";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const migrationSql = readFileSync("drizzle/0013_pale_carlie_cooper.sql", "utf8");

try {
  await pool.query(migrationSql);
  console.log("✅ v91 migration applied successfully");
} catch (e) {
  if (e.message.includes("already exists")) {
    console.log("ℹ️  Tables already exist, skipping:", e.message.split("\n")[0]);
  } else {
    console.error("❌ Migration error:", e.message);
    process.exit(1);
  }
} finally {
  await pool.end();
}
