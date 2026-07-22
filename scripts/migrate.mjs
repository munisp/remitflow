import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to apply database migrations");
}

const migrationsDirectory = path.resolve(process.cwd(), "drizzle");
const migrationName = /^(\d{4}_[a-z0-9_]+\.sql)$/i;
const client = new Client({ connectionString: databaseUrl });

async function main() {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isFile() && migrationName.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));

  if (migrations.length === 0) {
    throw new Error("No numbered migrations found in drizzle/");
  }

  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS platform_schema_migrations (
        id text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const fileName of migrations) {
      const sql = await readFile(path.join(migrationsDirectory, fileName), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const { rows } = await client.query(
        "SELECT checksum FROM platform_schema_migrations WHERE id = $1",
        [fileName],
      );
      if (rows.length > 0) {
        if (rows[0].checksum !== checksum) {
          throw new Error(`Migration checksum changed after application: ${fileName}`);
        }
        console.log(`skip ${fileName}`);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO platform_schema_migrations (id, checksum) VALUES ($1, $2)",
          [fileName, checksum],
        );
        await client.query("COMMIT");
        console.log(`applied ${fileName}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration failed (${fileName}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
