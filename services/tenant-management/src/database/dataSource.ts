import path from "path";
import { DataSource } from "typeorm";
import { devEnvironment, prodEnvironment, readEnv } from "../config/readEnv.config";

// TLS is verified by default. Skipping certificate verification is a
// development-only escape hatch (DATABASE_SSL_INSECURE=true) for local
// databases without proper certificates; it is rejected in production.
function resolveSsl(): boolean | { rejectUnauthorized: boolean } | undefined {
  const insecureRequested =
    (process.env.DATABASE_SSL_INSECURE || "").toLowerCase() === "true";
  if (insecureRequested) {
    if (prodEnvironment()) {
      throw new Error(
        "[tenant-management] DATABASE_SSL_INSECURE=true is forbidden in production: " +
          "database TLS certificate verification cannot be disabled.",
      );
    }
    // eslint-disable-next-line no-console
    console.warn(
      "[tenant-management] DATABASE_SSL_INSECURE=true: database TLS certificate " +
        "verification is DISABLED. Never use this outside local development.",
    );
    return { rejectUnauthorized: false };
  }
  // Verify certificates whenever TLS is used; in dev against a local
  // database without TLS configured, leave ssl unset.
  return devEnvironment() ? undefined : { rejectUnauthorized: true };
}

export const AppDataSource = new DataSource({
  type: "postgres",
  url: readEnv("DATABASE_URI"),
  // Schema changes go through migrations only — auto-sync against a shared
  // production database is not safe (see migrationsRun below).
  synchronize: false,
  migrationsRun: true,
  logging: false,
  entities: [path.join(__dirname, "../entity/*.{js,ts}")],
  migrations: [path.join(__dirname, "../migration/*.{js,ts}")],
  subscribers: [],
  ssl: resolveSsl(),
});
