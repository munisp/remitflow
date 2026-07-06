import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./server/db.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
