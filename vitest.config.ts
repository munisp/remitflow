import { defineConfig } from "vitest/config";
import path from "path";
import { config } from "dotenv";

const templateRoot = path.resolve(import.meta.dirname);

// Load .env so DATABASE_URL is available to test processes
config({ path: path.resolve(templateRoot, ".env") });

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
    testTimeout: 15000,
    pool: "forks",
    maxConcurrency: 2,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["server/**/*.ts"],
      exclude: [
        "server/**/*.test.ts",
        "server/**/*.spec.ts",
        "server/_core/**",
        "node_modules/**",
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
});
