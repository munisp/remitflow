#!/usr/bin/env node
/**
 * seed-canonical.mjs — Canonical seed entry point for RemitFlow
 *
 * Runs the most comprehensive seed script (seed-v134.mjs) which covers:
 *   - Users, wallets, KYC records, beneficiaries
 *   - Transactions, FX rates, corridors
 *   - Feature flags, tenant configs, agent data
 *   - Disputes, PAPSS settlements, CBDC records
 *   - Investments, price history, bulk payments
 *   - Support tickets, consent records, audit logs
 *
 * Usage:
 *   node scripts/seed-canonical.mjs [--env production|staging|development]
 *
 * The seed scripts are idempotent — re-running will not create duplicates
 * for records that use ON CONFLICT DO NOTHING or upsert patterns.
 */

import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const env = process.argv.find(a => a.startsWith("--env="))?.split("=")[1] ?? "development";
console.log(`[seed-canonical] Environment: ${env}`);
console.log(`[seed-canonical] Running comprehensive seed...`);

const seedScript = path.join(root, "scripts", "seed-v134.mjs");

try {
  execSync(`node ${seedScript}`, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: env },
  });
  console.log(`[seed-canonical] ✓ Seed complete`);
} catch (err) {
  console.error(`[seed-canonical] ✗ Seed failed:`, err.message);
  process.exit(1);
}
