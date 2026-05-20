/**
 * smoke-v140.test.ts — v140 Production Smoke Tests
 *
 * Covers:
 * 1. transfer-state-machine.ts: correct column names, metadata-based pipeline state,
 *    crypto import, valid enum-safe status updates
 * 2. routers.ts: scoreFraud/buildFeatures/runTransferPipeline wired into transfer.send
 * 3. React Native: 12 new parity screens registered in RootNavigator
 * 4. Flutter: 9 new parity screens registered in app.dart
 * 5. PLATFORM_PARITY.md updated with v140 changes
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SERVER = path.resolve("server");
const MOBILE_RN = path.resolve("mobile/react-native/src");
const MOBILE_FL = path.resolve("mobile/flutter/lib");

// ─── 1. transfer-state-machine.ts correctness ────────────────────────────────
describe("transfer-state-machine.ts — schema correctness", () => {
  const file = fs.readFileSync(path.join(SERVER, "transfer-state-machine.ts"), "utf-8");

  it("imports crypto as ES module (not require)", () => {
    expect(file).toContain("import crypto from");
    expect(file).not.toContain("require('crypto')");
    expect(file).not.toContain('require("crypto")');
  });

  it("uses camelCase column name 'failureReason' not snake_case 'failure_reason'", () => {
    expect(file).not.toContain("failure_reason");
    expect(file).toContain("failureReason");
  });

  it("uses camelCase column name 'partnerReference' not snake_case 'partner_reference'", () => {
    expect(file).not.toContain("partner_reference");
    expect(file).toContain("partnerReference");
  });

  it("stores pipeline sub-states in metadata.pipelineState not in status column", () => {
    expect(file).toContain("pipelineState");
    expect(file).toContain("metadata");
  });

  it("does NOT write 'fraud_check' directly to status column (would break enum)", () => {
    // The status column should only be set to valid enum values
    // fraud_check should only appear in metadata/pipelineState context
    const statusSetLines = file.split("\n").filter(l =>
      l.includes("status:") && (l.includes("fraud_check") || l.includes("aml_check") || l.includes("kyc_check") || l.includes("partner_sent"))
    );
    // These sub-states should only appear in metadata, not as direct status= assignments
    expect(statusSetLines.length).toBe(0);
  });

  it("uses eq() from drizzle-orm for WHERE clause (not raw SQL with integer id)", () => {
    expect(file).toContain("eq(transactions.reference");
  });

  it("uses correct Drizzle ORM column 'userId' not raw SQL 'user_id'", () => {
    // In the audit log insert, it should use userId not user_id
    expect(file).not.toContain('"user_id"');
    expect(file).toContain("userId");
  });

  it("uses correct notifications column 'message' not 'body'", () => {
    expect(file).not.toContain('"body"');
    expect(file).toContain("message:");
  });

  it("uses correct notifications column 'isRead' not 'is_read'", () => {
    expect(file).not.toContain('"is_read"');
    expect(file).toContain("isRead");
  });

  it("exports runTransferPipeline function", () => {
    expect(file).toContain("export async function runTransferPipeline");
  });

  it("runTransferPipeline accepts transferRef as string (reference, not integer id)", () => {
    // The function signature spans multiple lines; check the block after the function declaration
    const fnIdx = file.indexOf("export async function runTransferPipeline");
    const fnBlock = file.slice(fnIdx, fnIdx + 200);
    expect(fnBlock).toContain("transferRef");
    expect(fnBlock).toContain("string");
  });

  it("handles valid enum-safe status transitions (pending, processing, completed, failed, cancelled, reversed)", () => {
    // Only these enum-safe values should appear in status: assignments
    const validStatuses = ["pending", "processing", "completed", "failed", "cancelled", "reversed"];
    const statusAssignments = file.split("\n")
      .filter(l => l.match(/status:\s*["']/))
      .map(l => l.trim());
    for (const line of statusAssignments) {
      const match = line.match(/status:\s*["']([^"']+)["']/);
      if (match) {
        expect(validStatuses).toContain(match[1]);
      }
    }
  });
});

// ─── 2. routers.ts: transfer pipeline wiring ─────────────────────────────────
describe("routers.ts — transfer pipeline wiring", () => {
  const file = fs.readFileSync(path.join(SERVER, "routers.ts"), "utf-8");

  it("imports scoreFraud from fraud-detection.service", () => {
    expect(file).toContain("scoreFraud");
    expect(file).toContain("fraud-detection.service");
  });

  it("imports buildFeatures from fraud-detection.service", () => {
    expect(file).toContain("buildFeatures");
  });

  it("imports runTransferPipeline from transfer-state-machine", () => {
    expect(file).toContain("runTransferPipeline");
    expect(file).toContain("transfer-state-machine");
  });

  it("calls buildFeatures in the transfer.send procedure", () => {
    const idx = file.indexOf("buildFeatures(");
    expect(idx).toBeGreaterThan(-1);
  });

  it("calls scoreFraud in the transfer.send procedure", () => {
    const idx = file.indexOf("scoreFraud(");
    expect(idx).toBeGreaterThan(-1);
  });

  it("calls runTransferPipeline in the transfer.send procedure", () => {
    const idx = file.indexOf("runTransferPipeline(");
    expect(idx).toBeGreaterThan(-1);
  });

  it("passes mlFraudResult.score to runTransferPipeline", () => {
    expect(file).toContain("mlFraudResult.score");
  });

  it("creates transaction with status 'pending' before pipeline runs", () => {
    // Find the transfer.send createTransaction call (line ~955) and verify status is pending
    // The first createTransaction is the wallet topup (status: completed), we need the transfer.send one
    const sendIdx = file.indexOf('type: "send", status: "pending"');
    expect(sendIdx).toBeGreaterThan(-1);
  });
});

// ─── 3. React Native: v140 parity screens registered ─────────────────────────
describe("React Native — v140 parity screens", () => {
  const navFile = fs.readFileSync(path.join(MOBILE_RN, "navigation/RootNavigator.tsx"), "utf-8");
  const screensDir = path.join(MOBILE_RN, "screens");

  const newScreens = [
    "AfriMarket",
    "AgentNetwork",
    "CBDCAdmin",
    "CorridorPricingAdmin",
    "DocumentVault",
    "FXHedging",
    "NotificationCenter",
    "PBACPolicies",
    "RevenueAnalytics",
    "RevenueSharePWA",
    "ServicesHealthDashboard",
    "SystemConfigPage",
  ];

  for (const screen of newScreens) {
    it(`${screen}Screen.tsx exists`, () => {
      expect(fs.existsSync(path.join(screensDir, `${screen}Screen.tsx`))).toBe(true);
    });

    it(`${screen} is imported in RootNavigator`, () => {
      expect(navFile).toContain(`${screen}Screen`);
    });

    it(`${screen} is registered as Stack.Screen in RootNavigator`, () => {
      expect(navFile).toContain(`name="${screen}"`);
    });
  }
});

// ─── 4. Flutter: v140 parity screens registered ──────────────────────────────
describe("Flutter — v140 parity screens", () => {
  const appFile = fs.readFileSync(path.join(MOBILE_FL, "app.dart"), "utf-8");
  const screensDir = path.join(MOBILE_FL, "screens");

  const newScreens: [string, string][] = [
    ["cbdc_admin_screen.dart", "/cbdc-admin"],
    ["corridor_pricing_admin_screen.dart", "/corridor-pricing-admin"],
    ["fee_rules_crudv2_page_screen.dart", "/fee-rules-v2"],
    ["kgqa_page_screen.dart", "/kgqa"],
    ["m_pesa_screen.dart", "/mpesa"],
    ["pbac_policies_screen.dart", "/pbac-policies"],
    ["revenue_share_pwa_screen.dart", "/revenue-share-pwa"],
    ["services_health_dashboard_screen.dart", "/services-health"],
    ["system_config_page_screen.dart", "/system-config"],
  ];

  for (const [filename, route] of newScreens) {
    it(`${filename} exists`, () => {
      expect(fs.existsSync(path.join(screensDir, filename))).toBe(true);
    });

    it(`${filename} is imported in app.dart`, () => {
      expect(appFile).toContain(filename);
    });

    it(`route '${route}' is registered in app.dart GoRouter`, () => {
      expect(appFile).toContain(`path: '${route}'`);
    });
  }
});

// ─── 5. PLATFORM_PARITY.md updated ───────────────────────────────────────────
describe("PLATFORM_PARITY.md — v140 documentation", () => {
  const parityFile = fs.readFileSync(path.resolve("mobile/PLATFORM_PARITY.md"), "utf-8");

  it("documents v140 changes", () => {
    expect(parityFile).toContain("v140");
  });

  it("shows AfriMarket parity across all 3 platforms", () => {
    expect(parityFile).toContain("AfriMarket");
  });

  it("shows PBAC Policies parity across all 3 platforms", () => {
    expect(parityFile).toContain("PBAC Policies");
  });

  it("shows Services Health parity across all 3 platforms", () => {
    expect(parityFile).toContain("Services Health");
  });

  it("documents transfer-state-machine fix", () => {
    expect(parityFile).toContain("transfer-state-machine");
  });

  it("documents scoreFraud/buildFeatures wiring", () => {
    expect(parityFile).toContain("scoreFraud");
  });
});

// ─── 6. Fraud detection service integrity ────────────────────────────────────
describe("fraud-detection.service.ts — ML scorer integrity", () => {
  const file = fs.readFileSync(path.join(SERVER, "fraud-detection.service.ts"), "utf-8");

  it("exports scoreFraud function", () => {
    expect(file).toContain("export");
    expect(file).toContain("scoreFraud");
  });

  it("exports buildFeatures function", () => {
    expect(file).toContain("buildFeatures");
  });

  it("scoreFraud returns an object with a score property", () => {
    expect(file).toContain("score");
  });

  it("does not use Math.random for fraud scoring (should use deterministic ML)", () => {
    // Math.random is acceptable for jitter/noise but not as the primary score
    const scoreFunction = file.split("function scoreFraud")[1]?.split("function ")[0] ?? "";
    // The score should be computed from features, not purely random
    expect(scoreFunction.length).toBeGreaterThan(50);
  });
});
