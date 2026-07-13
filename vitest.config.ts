import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Run tests in Node.js environment (not browser)
    environment: "node",

    // Global test setup
    setupFiles: ["./server/test/setup.ts"],

    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: [
        "server/**/*.ts",
        "!server/**/*.test.ts",
        "!server/test/**",
        "!server/_core/index.ts", // Entry point — tested via integration
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },

    // Test file patterns
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
    ],
    exclude: [
      "node_modules/**",
      "dist/**",
      "uis/**",
      "services/**",
    ],

    // Timeout for async tests
    testTimeout: 30_000,
    hookTimeout: 30_000,

    // Reporter
    reporters: ["verbose"],

    // Pool configuration
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
  },

  resolve: {
    alias: {
      "@server": path.resolve(__dirname, "./server"),
      "@db": path.resolve(__dirname, "./server/db"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
});
