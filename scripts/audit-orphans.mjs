#!/usr/bin/env node
/**
 * Orphan Feature Audit Script
 *
 * Detects:
 *   1. Screen/page files with no route (mobile + PWA)
 *   2. tRPC procedures defined but never called by the frontend
 *   3. DB tables defined in schema but never referenced in server code
 *   4. Feature flags defined but never checked
 *
 * Run: node scripts/audit-orphans.mjs
 */
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, basename } from "path";
import { execSync } from "child_process";

const ROOT = process.cwd();
let totalOrphans = 0;

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║           RemitFlow Orphan Feature Audit                    ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

// ─── 1. Mobile Screen Files vs Routes ─────────────────────────────────────────
function auditMobileScreens() {
  console.log("━━━ 1. Mobile Screen Files vs Routes ━━━");
  const screensDir = join(ROOT, "mobile/flutter/lib/screens");
  if (!existsSync(screensDir)) {
    console.log("  ⏭  mobile/flutter/lib/screens not found, skipping\n");
    return;
  }

  const screenFiles = readdirSync(screensDir).filter((f) => f.endsWith("_screen.dart"));
  const appDartPath = join(ROOT, "mobile/flutter/lib/app.dart");
  const appDart = existsSync(appDartPath) ? readFileSync(appDartPath, "utf8") : "";

  const orphans = screenFiles.filter((f) => !appDart.includes(`'screens/${f}'`));
  console.log(`  Total screen files: ${screenFiles.length}`);
  console.log(`  Routed screens: ${screenFiles.length - orphans.length}`);
  console.log(`  Orphaned screens: ${orphans.length}`);
  if (orphans.length > 0 && orphans.length <= 20) {
    orphans.forEach((f) => console.log(`    - ${f}`));
  }
  totalOrphans += orphans.length;
  console.log();
}

// ─── 2. PWA Page Files vs Router ──────────────────────────────────────────────
function auditPWAPages() {
  console.log("━━━ 2. PWA Page Files vs Router ━━━");
  const pagesDir = join(ROOT, "client/src/pages");
  if (!existsSync(pagesDir)) {
    console.log("  ⏭  client/src/pages not found, skipping\n");
    return;
  }

  let pageFiles = [];
  function walkDir(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walkDir(join(dir, entry.name));
      else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
        pageFiles.push(join(dir, entry.name).replace(ROOT + "/", ""));
      }
    }
  }
  walkDir(pagesDir);

  // Check if page is imported anywhere in App.tsx or router
  const appTsx = join(ROOT, "client/src/App.tsx");
  const routerContent = existsSync(appTsx) ? readFileSync(appTsx, "utf8") : "";
  // Also check all router-related files
  let allRouterContent = routerContent;
  try {
    const routerFiles = execSync(
      `grep -rl "Route\\|createBrowserRouter\\|lazy(" client/src/ --include="*.tsx" --include="*.ts" 2>/dev/null`,
      { encoding: "utf8", cwd: ROOT }
    ).trim().split("\n").filter(Boolean);
    for (const rf of routerFiles) {
      allRouterContent += readFileSync(join(ROOT, rf), "utf8");
    }
  } catch { /* no router files */ }

  const orphans = pageFiles.filter((f) => {
    const name = basename(f, ".tsx").replace("Page", "").replace("page", "");
    return !allRouterContent.includes(name) && !allRouterContent.includes(basename(f));
  });

  console.log(`  Total page files: ${pageFiles.length}`);
  console.log(`  Potentially orphaned: ${orphans.length}`);
  if (orphans.length > 0 && orphans.length <= 20) {
    orphans.forEach((f) => console.log(`    - ${f}`));
  }
  totalOrphans += orphans.length;
  console.log();
}

// ─── 3. tRPC Procedures: Defined vs Called ────────────────────────────────────
function auditTRPCProcedures() {
  console.log("━━━ 3. tRPC Procedures: Defined vs Called ━━━");
  try {
    // Find all procedure definitions (query, mutation, subscription)
    const definedRaw = execSync(
      `grep -roh "[a-zA-Z_][a-zA-Z0-9_]*:\\s*\\(protectedProcedure\\|publicProcedure\\|adminProcedure\\|auditedProcedure\\|rateLimitedProcedure\\)" server/routers/ --include="*.ts" 2>/dev/null | sed 's/:.*//' | sort -u`,
      { encoding: "utf8", cwd: ROOT }
    ).trim().split("\n").filter(Boolean);

    // Find all frontend tRPC calls
    const calledRaw = execSync(
      `grep -roh "trpc\\.[a-zA-Z_][a-zA-Z0-9_.]*" client/src/ --include="*.tsx" --include="*.ts" 2>/dev/null | sed 's/trpc\\.//' | sed 's/\\.use.*//' | sed 's/\\.query.*//' | sed 's/\\.mutate.*//' | sort -u`,
      { encoding: "utf8", cwd: ROOT }
    ).trim().split("\n").filter(Boolean);

    // Extract procedure names from called paths (e.g., "send.getQuote" → "getQuote")
    const calledProcedures = new Set(calledRaw.flatMap((c) => [c, c.split(".").pop()]));

    const orphans = definedRaw.filter((d) => !calledProcedures.has(d));
    console.log(`  Defined procedures: ${definedRaw.length}`);
    console.log(`  Frontend-called procedures: ${calledRaw.length}`);
    console.log(`  Potentially orphaned (server-only or unused): ${orphans.length}`);
    if (orphans.length > 0 && orphans.length <= 30) {
      orphans.slice(0, 30).forEach((f) => console.log(`    - ${f}`));
    }
    // Don't count these as true orphans — many are server-only/admin/webhook
    console.log(`  Note: Some may be called via server-to-server, webhooks, or CLI`);
  } catch (e) {
    console.log(`  ⚠️  Could not audit tRPC procedures: ${e.message}`);
  }
  console.log();
}

// ─── 4. DB Tables: Schema vs Code References ─────────────────────────────────
function auditDBTables() {
  console.log("━━━ 4. DB Tables: Schema vs Code References ━━━");
  try {
    // Find table names from Drizzle schema
    const schemaRaw = execSync(
      `grep -roh "pgTable(\"[^\"]*\"" drizzle/ --include="*.ts" 2>/dev/null | sed 's/pgTable("//; s/"//' | sort -u`,
      { encoding: "utf8", cwd: ROOT }
    ).trim().split("\n").filter(Boolean);

    if (schemaRaw.length === 0) {
      console.log("  ⏭  No Drizzle schema tables found, skipping\n");
      return;
    }

    // Check if table name appears in server code
    const serverCode = execSync(
      `cat server/**/*.ts 2>/dev/null || find server -name "*.ts" -exec cat {} \\;`,
      { encoding: "utf8", cwd: ROOT, maxBuffer: 50 * 1024 * 1024 }
    );

    const orphans = schemaRaw.filter((table) => {
      const camelCase = table.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      return !serverCode.includes(table) && !serverCode.includes(camelCase);
    });

    console.log(`  Total schema tables: ${schemaRaw.length}`);
    console.log(`  Referenced in server code: ${schemaRaw.length - orphans.length}`);
    console.log(`  Potentially orphaned tables: ${orphans.length}`);
    if (orphans.length > 0) {
      orphans.forEach((f) => console.log(`    - ${f}`));
    }
    totalOrphans += orphans.length;
  } catch (e) {
    console.log(`  ⚠️  Could not audit DB tables: ${e.message}`);
  }
  console.log();
}

// ─── 5. Feature Flags: Defined vs Checked ─────────────────────────────────────
function auditFeatureFlags() {
  console.log("━━━ 5. Feature Flags: Defined vs Checked ━━━");
  try {
    // Find flag definitions in featureFlagsClient
    const flagClientPath = join(ROOT, "server/lib/featureFlagsClient.ts");
    if (!existsSync(flagClientPath)) {
      console.log("  ⏭  featureFlagsClient.ts not found, skipping\n");
      return;
    }
    const flagContent = readFileSync(flagClientPath, "utf8");
    const flagMatches = flagContent.match(/"[a-z-]+"/g) || [];
    const definedFlags = [...new Set(flagMatches.map((f) => f.replace(/"/g, "")))];

    // Check if flags are referenced elsewhere
    const allServerCode = execSync(
      `grep -rh "${definedFlags.slice(0, 10).join("\\|")}" server/ client/src/ --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l`,
      { encoding: "utf8", cwd: ROOT }
    ).trim();

    console.log(`  Defined feature flags: ${definedFlags.length}`);
    console.log(`  Total references across codebase: ${allServerCode}`);
    console.log(`  Flags:`);
    definedFlags.forEach((f) => console.log(`    - ${f}`));
  } catch (e) {
    console.log(`  ⚠️  Could not audit feature flags: ${e.message}`);
  }
  console.log();
}

// ─── Run All Audits ───────────────────────────────────────────────────────────
auditMobileScreens();
auditPWAPages();
auditTRPCProcedures();
auditDBTables();
auditFeatureFlags();

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`Total potential orphans found: ${totalOrphans}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
process.exit(totalOrphans > 50 ? 1 : 0); // Fail if > 50 orphans
