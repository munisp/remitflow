import path from "path";
import { DataSource } from "typeorm";
import { devEnvironment, readEnv } from "../config/readEnv.config";

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
  ssl: devEnvironment()
    ? undefined
    : {
        rejectUnauthorized: false,
      },
});
