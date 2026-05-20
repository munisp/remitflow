import { defineConfig } from "drizzle-kit";

// Prefer LOCAL_DATABASE_URL (PostgreSQL). DATABASE_URL may point to a MySQL/TiDB remote.
const connectionString = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("LOCAL_DATABASE_URL or DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
