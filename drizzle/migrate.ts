/**
 * RemitFlow — Database Migration Runner
 *
 * Applies pending migrations in order. Tracks applied migrations in a
 * `_migrations` table. Supports up/down/status commands.
 *
 * Usage:
 *   npx tsx drizzle/migrate.ts up          — Apply all pending migrations
 *   npx tsx drizzle/migrate.ts down        — Rollback last migration
 *   npx tsx drizzle/migrate.ts status      — Show migration status
 *   npx tsx drizzle/migrate.ts generate    — Generate new migration from schema diff
 *
 * Environment:
 *   DATABASE_URL — PostgreSQL connection string
 */

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { Pool } from "pg";

const MIGRATIONS_DIR = join(import.meta.dirname ?? __dirname, "migrations");
const MIGRATIONS_TABLE = "_migrations";

interface Migration {
  id: string;
  name: string;
  appliedAt: Date | null;
  filepath: string;
}

async function getPool(): Promise<Pool> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  return new Pool({ connectionString: url, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined });
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum VARCHAR(64) NOT NULL
    )
  `);
}

async function getAppliedMigrations(pool: Pool): Promise<Set<string>> {
  const result = await pool.query(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY id`
  );
  return new Set(result.rows.map((r: { name: string }) => r.name));
}

async function getPendingMigrations(pool: Pool): Promise<Migration[]> {
  const applied = await getAppliedMigrations(pool);
  const files = await readdir(MIGRATIONS_DIR).catch(() => []);

  const migrations: Migration[] = [];
  for (const file of files.sort()) {
    if (!file.endsWith(".sql")) continue;
    const name = file.replace(".sql", "");
    if (!applied.has(name)) {
      migrations.push({
        id: name.split("_")[0],
        name,
        appliedAt: null,
        filepath: join(MIGRATIONS_DIR, file),
      });
    }
  }
  return migrations;
}

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function migrateUp(pool: Pool): Promise<void> {
  await ensureMigrationsTable(pool);
  const pending = await getPendingMigrations(pool);

  if (pending.length === 0) {
    console.log("No pending migrations.");
    return;
  }

  console.log(`Applying ${pending.length} migration(s)...`);

  for (const migration of pending) {
    const sql = await readFile(migration.filepath, "utf-8");
    const checksum = await hashContent(sql);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (name, checksum) VALUES ($1, $2)`,
        [migration.name, checksum]
      );
      await client.query("COMMIT");
      console.log(`  ✓ ${migration.name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`  ✗ ${migration.name}: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  console.log("All migrations applied.");
}

async function migrateDown(pool: Pool): Promise<void> {
  await ensureMigrationsTable(pool);
  const result = await pool.query(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY id DESC LIMIT 1`
  );

  if (result.rows.length === 0) {
    console.log("No migrations to rollback.");
    return;
  }

  const lastMigration = result.rows[0].name;
  const downFile = join(MIGRATIONS_DIR, `${lastMigration}.down.sql`);

  try {
    const sql = await readFile(downFile, "utf-8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `DELETE FROM ${MIGRATIONS_TABLE} WHERE name = $1`,
        [lastMigration]
      );
      await client.query("COMMIT");
      console.log(`  ↩ Rolled back: ${lastMigration}`);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`  ✗ Rollback failed: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  } catch {
    console.error(`No rollback file found: ${downFile}`);
    console.error("Manual rollback required.");
    process.exit(1);
  }
}

async function migrateStatus(pool: Pool): Promise<void> {
  await ensureMigrationsTable(pool);
  const applied = await getAppliedMigrations(pool);
  const files = await readdir(MIGRATIONS_DIR).catch(() => []);

  console.log("Migration Status:");
  console.log("─".repeat(60));

  for (const file of files.sort()) {
    if (!file.endsWith(".sql") || file.includes(".down.")) continue;
    const name = file.replace(".sql", "");
    const status = applied.has(name) ? "✓ applied" : "○ pending";
    console.log(`  ${status}  ${name}`);
  }

  const pending = files.filter(
    (f) => f.endsWith(".sql") && !f.includes(".down.") && !applied.has(f.replace(".sql", ""))
  );
  console.log("─".repeat(60));
  console.log(`Total: ${files.filter((f) => f.endsWith(".sql") && !f.includes(".down.")).length} | Applied: ${applied.size} | Pending: ${pending.length}`);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

async function main() {
  const command = process.argv[2] || "status";

  if (command === "generate") {
    console.log("Use: npx drizzle-kit generate:pg --config=drizzle.config.ts");
    console.log("Then move generated SQL to drizzle/migrations/");
    return;
  }

  if (!["up", "down", "status"].includes(command)) {
    console.error(`Unknown command: ${command}`);
    console.error("Usage: npx tsx drizzle/migrate.ts [up|down|status|generate]");
    process.exit(1);
  }

  const pool = await getPool();

  try {
    switch (command) {
      case "up":
        await migrateUp(pool);
        break;
      case "down":
        await migrateDown(pool);
        break;
      case "status":
        await migrateStatus(pool);
        break;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
