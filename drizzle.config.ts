import type { Config } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Drizzle operations");
}

export default {
  schema: "./drizzle/schema.ts",
  // Canonical migration track is the repo-root drizzle/ directory — the same
  // path scripts/migrate.mjs applies at deploy time. The former
  // ./drizzle/migrations subdirectory was a divergent second track and has
  // been removed (see drizzle/MIGRATIONS.md).
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
} satisfies Config;
