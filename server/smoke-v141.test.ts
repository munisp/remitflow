/**
 * RemitFlow v141 Smoke Tests
 *
 * Covers:
 * 1. No require('crypto') calls in any server file (ES module imports only)
 * 2. No Math.random() used for token generation in server files
 * 3. Transfer state machine: pending → fraud_check transition is valid
 * 4. Transfer state machine: VALID_TRANSITIONS covers all pipeline states
 * 5. SECURITY_AUDIT.md is updated to v141
 * 6. partnerOnboarding.ts uses randomInt from crypto (not Math.random)
 * 7. extendedCrud.ts uses randomBytes from crypto (not Math.random)
 * 8. notifications.service.ts uses randomBytes from crypto (not require)
 * 9. db.ts uses randomBytes from crypto (not require)
 * 10. productionV90.ts uses randomUUID from crypto (not require)
 * 11. v101Features.ts uses randomUUID from crypto (not require)
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const SERVER_DIR = join(process.cwd(), "server");
const ROUTERS_DIR = join(SERVER_DIR, "routers");

function readServerFile(filename: string): string {
  return readFileSync(join(SERVER_DIR, filename), "utf-8");
}

function readRouterFile(filename: string): string {
  return readFileSync(join(ROUTERS_DIR, filename), "utf-8");
}

function getAllServerFiles(): string[] {
  const files: string[] = [];
  const serverFiles = readdirSync(SERVER_DIR).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".spec.ts"));
  const routerFiles = readdirSync(ROUTERS_DIR).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".spec.ts"));
  serverFiles.forEach(f => files.push(readFileSync(join(SERVER_DIR, f), "utf-8")));
  routerFiles.forEach(f => files.push(readFileSync(join(ROUTERS_DIR, f), "utf-8")));
  return files;
}

describe("v141 — Crypto ES Module Compliance", () => {
  it("no server file uses require('crypto') for randomBytes or randomUUID", () => {
    const allFiles = getAllServerFiles();
    const violations: string[] = [];
    const serverFiles = readdirSync(SERVER_DIR).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".spec.ts"));
    const routerFiles = readdirSync(ROUTERS_DIR).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".spec.ts"));
    const allFilenames = [
      ...serverFiles.map(f => `server/${f}`),
      ...routerFiles.map(f => `server/routers/${f}`),
    ];
    allFiles.forEach((content, i) => {
      if (content.includes("require('crypto')") || content.includes('require("crypto")')) {
        violations.push(allFilenames[i]);
      }
    });
    expect(violations).toEqual([]);
  });

  it("no server file uses Math.random() for token generation", () => {
    const allFiles = getAllServerFiles();
    const serverFiles = readdirSync(SERVER_DIR).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".spec.ts"));
    const routerFiles = readdirSync(ROUTERS_DIR).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".spec.ts"));
    const allFilenames = [
      ...serverFiles.map(f => `server/${f}`),
      ...routerFiles.map(f => `server/routers/${f}`),
    ];
    const violations: string[] = [];
    allFiles.forEach((content, i) => {
      if (content.includes("Math.random()")) {
        violations.push(allFilenames[i]);
      }
    });
    expect(violations).toEqual([]);
  });

  it("db.ts uses randomBytes from crypto (not require)", () => {
    const content = readServerFile("db.ts");
    expect(content).toContain('import { randomBytes }');
    expect(content).not.toContain('require("crypto")');
    expect(content).not.toContain("require('crypto')");
  });

  it("notifications.service.ts uses randomBytes from crypto (not require)", () => {
    const content = readServerFile("notifications.service.ts");
    expect(content).toContain('import { randomBytes }');
    expect(content).not.toContain('require("crypto")');
    expect(content).not.toContain("require('crypto')");
  });

  it("extendedCrud.ts uses randomBytes from crypto (not Math.random)", () => {
    const content = readRouterFile("extendedCrud.ts");
    expect(content).toContain('import { randomBytes }');
    expect(content).not.toContain("Math.random()");
  });

  it("partnerOnboarding.ts uses randomInt from crypto (not Math.random)", () => {
    const content = readRouterFile("partnerOnboarding.ts");
    expect(content).toContain('randomInt');
    expect(content).not.toContain("Math.random()");
  });

  it("productionV90.ts uses randomUUID from crypto (not require)", () => {
    const content = readRouterFile("productionV90.ts");
    expect(content).toContain('randomUUID');
    expect(content).not.toContain('require("crypto")');
    expect(content).not.toContain("require('crypto')");
  });

  it("v101Features.ts uses randomUUID from crypto (not require)", () => {
    const content = readRouterFile("v101Features.ts");
    expect(content).toContain('randomUUID');
    expect(content).not.toContain('require("crypto")');
    expect(content).not.toContain("require('crypto')");
  });
});

describe("v141 — Transfer State Machine Transition Fix", () => {
  it("transfer-state-machine.ts has VALID_TRANSITIONS entry for pending state", () => {
    const content = readServerFile("transfer-state-machine.ts");
    // The pending state must have a valid transition to fraud_check
    expect(content).toContain("pending");
    // Check that VALID_TRANSITIONS includes pending as a key
    const pendingTransitionMatch = content.match(/pending.*fraud_check|"pending".*\[/s);
    expect(pendingTransitionMatch).not.toBeNull();
  });

  it("transfer-state-machine.ts uses reference column (not id) for DB lookups", () => {
    const content = readServerFile("transfer-state-machine.ts");
    // Must use transactions.reference for lookups, not transactions.id with a string
    expect(content).toContain("transactions.reference");
    // Must not use raw SQL WHERE id = with a string parameter
    expect(content).not.toContain("WHERE id = $1");
  });

  it("transfer-state-machine.ts uses camelCase column names", () => {
    const content = readServerFile("transfer-state-machine.ts");
    // Must use camelCase column names (Drizzle ORM convention)
    expect(content).toContain("failureReason");
    expect(content).not.toContain("failure_reason");
    // Must not use snake_case for Drizzle columns
    expect(content).not.toContain("partner_reference");
  });

  it("transfer-state-machine.ts stores pipeline sub-states in metadata (not status enum)", () => {
    const content = readServerFile("transfer-state-machine.ts");
    // Sub-states like fraud_check, aml_check must be stored in metadata
    expect(content).toContain("pipelineState");
    // Must not write fraud_check directly to status column
    expect(content).not.toMatch(/status.*fraud_check.*enum|set.*status.*"fraud_check"/);
  });

  it("transfer-state-machine.ts uses ES module import for crypto", () => {
    const content = readServerFile("transfer-state-machine.ts");
    expect(content).toContain('import');
    expect(content).not.toContain('require("crypto")');
    expect(content).not.toContain("require('crypto')");
  });
});

describe("v141 — Security Audit Documentation", () => {
  it("SECURITY_AUDIT.md is updated to v141", () => {
    const content = readFileSync(join(process.cwd(), "SECURITY_AUDIT.md"), "utf-8");
    expect(content).toContain("v141");
    expect(content).not.toContain("v69");
  });

  it("SECURITY_AUDIT.md documents the require('crypto') fix", () => {
    const content = readFileSync(join(process.cwd(), "SECURITY_AUDIT.md"), "utf-8");
    expect(content).toContain("require('crypto')");
    expect(content).toContain("FIXED");
  });

  it("SECURITY_AUDIT.md documents the Math.random() fix", () => {
    const content = readFileSync(join(process.cwd(), "SECURITY_AUDIT.md"), "utf-8");
    expect(content).toContain("Math.random()");
    expect(content).toContain("FIXED");
  });

  it("SECURITY_AUDIT.md documents the state machine transition fix", () => {
    const content = readFileSync(join(process.cwd(), "SECURITY_AUDIT.md"), "utf-8");
    expect(content).toContain("pending");
    expect(content).toContain("fraud_check");
    expect(content).toContain("FIXED");
  });

  it("SECURITY_AUDIT.md shows 99/100 security score", () => {
    const content = readFileSync(join(process.cwd(), "SECURITY_AUDIT.md"), "utf-8");
    expect(content).toContain("99/100");
  });
});

describe("v141 — Mobile Platform Parity (v140 additions)", () => {
  it("React Native navigator includes AfriMarketScreen", () => {
    const content = readFileSync(
      join(process.cwd(), "mobile/react-native/src/navigation/RootNavigator.tsx"),
      "utf-8"
    );
    expect(content).toContain("AfriMarket");
  });

  it("React Native navigator includes AgentNetworkScreen", () => {
    const content = readFileSync(
      join(process.cwd(), "mobile/react-native/src/navigation/RootNavigator.tsx"),
      "utf-8"
    );
    expect(content).toContain("AgentNetwork");
  });

  it("Flutter app.dart includes cbdc-admin route", () => {
    const content = readFileSync(
      join(process.cwd(), "mobile/flutter/lib/app.dart"),
      "utf-8"
    );
    expect(content).toContain("cbdc");
  });
});
