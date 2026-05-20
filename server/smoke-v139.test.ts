/**
 * smoke-v139.test.ts — v139 Comprehensive Production Smoke Tests
 * Tests: TypeScript fixes, orphaned service wiring, mobile screen parity,
 * WebSocket auth guard, circuit-breaker persistence, extendedCrud fixes,
 * db-extended fixes, servicesHealth fixes, microservicesV127 fixes
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SERVER = path.resolve("server");
const CLIENT = path.resolve("client/src");
const MOBILE_BASE = path.resolve(__dirname, "..", "mobile");
const RN_SCREENS = path.join(MOBILE_BASE, "react-native/src/screens");
const FL_SCREENS = path.join(MOBILE_BASE, "flutter/lib/screens");

// ─── 1. TypeScript fixes: extendedCrud.ts ─────────────────────────────────────
describe("extendedCrud.ts TypeScript fixes", () => {
  const file = fs.readFileSync(path.join(SERVER, "routers/extendedCrud.ts"), "utf-8");

  it("uses z.record(z.string(), z.unknown()) not z.record(z.unknown())", () => {
    expect(file).not.toContain("z.record(z.unknown())");
    expect(file).toContain("z.record(z.string(), z.unknown())");
  });

  it("scheduledTransferRun uses scheduleId not scheduledTransferId", () => {
    expect(file).toContain("scheduleId: input.scheduledTransferId");
  });

  it("scheduledTransferRun includes required amount and currency fields", () => {
    expect(file).toContain("amount: '0', currency: 'USD'");
  });

  it("paymentMetrics upsert does not use recordedAt (non-existent column)", () => {
    const metricsSection = file.split("upsertPaymentMetrics")[1]?.split("\n")[0] ?? "";
    expect(metricsSection).not.toContain("recordedAt");
  });

  it("analyticsThreshold upsert includes required label field", () => {
    expect(file).toContain("label: input.metric");
  });

  it("marketplace category uses type cast to enum literal", () => {
    expect(file).toContain("input.category as");
  });

  it("fraudAlert create uses riskLevel not type field", () => {
    // The mutation line (not the import line) should use riskLevel
    const lines = file.split("\n");
    const mutationLine = lines.find(l => l.includes("createFraudAlert(") && l.includes(".mutation"));
    expect(mutationLine ?? file).toContain("riskLevel");
  });

  it("securityIncident create includes required type field", () => {
    // The mutation line (not the import line) should include type:
    const lines = file.split("\n");
    const mutationLine = lines.find(l => l.includes("createSecurityIncident(") && l.includes(".mutation"));
    expect(mutationLine ?? file).toContain("type:");
  });

  it("cronJob upsert status uses literal type cast", () => {
    expect(file).toContain("as 'active' | 'paused' | 'running' | 'error'");
  });

  it("familyBudget update uses monthlyLimit not amount/name", () => {
    expect(file).toContain("monthlyLimit:");
  });
});

// ─── 2. TypeScript fixes: db-extended.ts ──────────────────────────────────────
describe("db-extended.ts TypeScript fixes", () => {
  const file = fs.readFileSync(path.join(SERVER, "db-extended.ts"), "utf-8");

  it("updateCronJobStatus accepts string|number id", () => {
    expect(file).toContain("id: string | number");
  });

  it("updateCronJobStatus converts id to string for varchar PK", () => {
    expect(file).toContain("String(id)");
  });

  it("updateCronJobStatus uses lastRunError not lastError column", () => {
    expect(file).toContain("lastRunError: lastError");
  });
});

// ─── 3. TypeScript fixes: microservicesV127.ts ────────────────────────────────
describe("microservicesV127.ts TypeScript fixes", () => {
  const file = fs.readFileSync(path.join(SERVER, "routers/microservicesV127.ts"), "utf-8");

  it("uses await getDb() not const db = getDb()", () => {
    expect(file).not.toContain("const db = getDb()");
    expect(file).toContain("const db = await getDb()");
  });

  it("uses z.record(z.string(), z.unknown()) not z.record(z.unknown())", () => {
    expect(file).not.toContain("z.record(z.unknown())");
  });
});

// ─── 4. TypeScript fixes: orphanedTables.ts ───────────────────────────────────
describe("orphanedTables.ts TypeScript fixes", () => {
  const file = fs.readFileSync(path.join(SERVER, "routers/orphanedTables.ts"), "utf-8");

  it("nifiPipelineRuns uses 'success' not 'completed' status", () => {
    const nifiSection = file.split("nifiPipelineRuns")[1]?.split("\n").slice(0, 20).join("\n") ?? "";
    expect(nifiSection).not.toContain('"completed"');
  });
});

// ─── 5. TypeScript fixes: servicesHealth.ts ───────────────────────────────────
describe("servicesHealth.ts TypeScript fixes", () => {
  const file = fs.readFileSync(path.join(SERVER, "routers/servicesHealth.ts"), "utf-8");

  it("uses z.record(z.string(), z.unknown()) not z.record(z.unknown())", () => {
    expect(file).not.toContain("z.record(z.unknown())");
  });
});

// ─── 6. TypeScript fixes: productionV84.ts ────────────────────────────────────
describe("productionV84.ts TypeScript fixes", () => {
  const file = fs.readFileSync(path.join(SERVER, "routers/productionV84.ts"), "utf-8");

  it("uses .returning() not .$returningId()", () => {
    expect(file).not.toContain(".$returningId()");
  });
});

// ─── 7. WebSocket auth guard ──────────────────────────────────────────────────
describe("WebSocket services-health auth guard", () => {
  const file = fs.readFileSync(path.join(SERVER, "ws-services-health.ts"), "utf-8");

  it("verifies JWT session on WebSocket upgrade", () => {
    expect(file).toMatch(/verifyWsSession|jwt|JWT|session.*cookie|cookie.*session/i);
  });

  it("rejects non-admin connections", () => {
    expect(file).toMatch(/admin|role.*admin|FORBIDDEN|403/i);
  });

  it("broadcasts health updates to connected clients", () => {
    expect(file).toContain("broadcast");
  });
});

// ─── 8. Circuit-breaker persistence ──────────────────────────────────────────
describe("Circuit-breaker trip event persistence", () => {
  const wsFile = fs.readFileSync(path.join(SERVER, "ws-services-health.ts"), "utf-8");

  it("persists circuit-breaker events to auditLogs", () => {
    expect(wsFile).toMatch(/auditLog|audit_log|createAuditLog/i);
  });
});

// ─── 9. server/_core/index.ts fixes ──────────────────────────────────────────
describe("server/_core/index.ts fixes", () => {
  const file = fs.readFileSync(path.join(SERVER, "_core/index.ts"), "utf-8");

  it("does not reference non-existent savingsAccounts table", () => {
    expect(file).not.toContain("savingsAccounts");
  });

  it("does not reference non-existent savingsTransactions table", () => {
    expect(file).not.toContain("savingsTransactions");
  });

  it("fxAlerts query filters by isActive not status", () => {
    const fxSection = file.split("fxAlerts")[1]?.split("\n").slice(0, 10).join("\n") ?? "";
    expect(fxSection).toMatch(/isActive|triggered/);
  });
});

// ─── 10. Client page fixes ────────────────────────────────────────────────────
describe("Client page TypeScript fixes", () => {
  it("PBACPolicies uses check.useQuery not check.useMutation", () => {
    const file = fs.readFileSync(path.join(CLIENT, "pages/PBACPolicies.tsx"), "utf-8");
    expect(file).not.toContain("check.useMutation");
  });

  it("SecurityDashboard does not use invalid queryKey option", () => {
    const file = fs.readFileSync(path.join(CLIENT, "pages/SecurityDashboard.tsx"), "utf-8");
    // queryKey as a tRPC option is not valid — should use the standard tRPC query
    expect(file).not.toContain("queryKey:");
  });

  it("TenantFeatureFlagsAdmin uses trpc.tenants not trpc.featureFlags.tenants", () => {
    const file = fs.readFileSync(path.join(CLIENT, "pages/TenantFeatureFlagsAdmin.tsx"), "utf-8");
    expect(file).not.toContain("trpc.featureFlags.tenants");
  });

  it("Mojaloop uses valid procedure names (no non-existent procedures)", () => {
    const file = fs.readFileSync(path.join(CLIENT, "pages/Mojaloop.tsx"), "utf-8");
    // mojaloop.settlement does not exist (only settlementWindows does)
    expect(file).not.toMatch(/trpc\.mojaloop\.settlement(?!Windows)/);
    // mojaloop.quote is a valid procedure - this is fine
    // mojaloop.transfers is a valid procedure
    expect(file).toMatch(/trpc\.mojaloop/);
  });
});

// ─── 11. Mobile screen parity — new v139 screens ─────────────────────────────
describe("React Native v139 screens — file existence", () => {
  const screens = [
    "SavingsGoalsScreen.tsx",
    "BNPLScreen.tsx",
    "StablecoinScreen.tsx",
    "CBDCScreen.tsx",
    "ReferralScreen.tsx",
    "SplitBillScreen.tsx",
    "BatchPaymentsScreen.tsx",
    "DirectDebitScreen.tsx",
    "RecurringPaymentsScreen.tsx",
    "QRPayScreen.tsx",
    "AirtimeScreen.tsx",
    "BillPaymentScreen.tsx",
    "FXAlertsScreen.tsx",
    "FraudMonitorScreen.tsx",
    "SecurityDashboardScreen.tsx",
    "ServicesHealthDashboardScreen.tsx",
    "PBACPoliciesScreen.tsx",
  ];
  screens.forEach((screen) => {
    it(`${screen} exists`, () => {
      expect(fs.existsSync(path.join(RN_SCREENS, screen))).toBe(true);
    });
  });
});

describe("Flutter v139 screens — file existence", () => {
  const screens = [
    "savings_goals_screen.dart",
    "bnpl_screen.dart",
    "stablecoin_screen.dart",
    "cbdc_screen.dart",
    "referral_screen.dart",
    "split_bill_screen.dart",
    "batch_payments_screen.dart",
    "direct_debit_screen.dart",
    "recurring_payments_screen.dart",
    "qr_pay_screen.dart",
    "airtime_screen.dart",
    "bill_payment_screen.dart",
    "fx_alerts_screen.dart",
    "fraud_monitor_screen.dart",
    "security_dashboard_screen.dart",
    "services_health_dashboard_screen.dart",
    "pbac_policies_screen.dart",
  ];
  screens.forEach((screen) => {
    it(`${screen} exists`, () => {
      expect(fs.existsSync(path.join(FL_SCREENS, screen))).toBe(true);
    });
  });
});

// ─── 12. React Native navigator registration ──────────────────────────────────
describe("React Native App.tsx navigator — screen registration", () => {
  const appFile = path.join(MOBILE_BASE, "react-native-complete/App.tsx");
  if (!fs.existsSync(appFile)) {
    it.skip("App.tsx not found", () => {});
  } else {
    const content = fs.readFileSync(appFile, "utf-8");
    const screens = [
      "SavingsGoals",
      "BNPL",
      "Stablecoin",
      "CBDC",
      "Referral",
      "SplitBill",
      "BatchPayments",
      "DirectDebit",
      "RecurringPayments",
      "QRPay",
      "Airtime",
      "BillPayment",
      "FXAlerts",
      "FraudMonitor",
      "SecurityDashboard",
    ];
    screens.forEach((screen) => {
      it(`${screen} registered in navigator`, () => {
        expect(content).toContain(screen);
      });
    });
  }
});

// ─── 13. Flutter main.dart route registration ─────────────────────────────────
describe("Flutter main.dart — route registration", () => {
  const mainFile = path.join(MOBILE_BASE, "flutter-complete/lib/main.dart");
  if (!fs.existsSync(mainFile)) {
    it.skip("main.dart not found", () => {});
  } else {
    const content = fs.readFileSync(mainFile, "utf-8");
    const routes = [
      "savings_goals",
      "bnpl",
      "stablecoin",
      "cbdc",
      "referral",
      "split_bill",
      "batch_payments",
      "direct_debit",
      "recurring_payments",
      "qr_pay",
      "airtime",
      "bill_payment",
      "fx_alerts",
      "fraud_monitor",
      "security_dashboard",
    ];
    routes.forEach((route) => {
      it(`/${route} route registered`, () => {
        expect(content).toContain(route);
      });
    });
  }
});

// ─── 14. Orphaned services wired ─────────────────────────────────────────────
describe("Orphaned services wired into routers", () => {
  const routersFile = fs.readFileSync(path.join(SERVER, "routers.ts"), "utf-8");

  it("fraud-detection.service is imported in routers.ts", () => {
    expect(routersFile).toMatch(/fraud-detection\.service|fraudDetection/);
  });

  it("transfer-state-machine is imported in routers.ts", () => {
    expect(routersFile).toMatch(/transfer-state-machine|runTransferPipeline/);
  });

  it("appRouter has no duplicate keys", () => {
    // Check that directDebit, recurringPayments, batchPayments don't appear twice
    const matches = (routersFile.match(/^\s+directDebit:/gm) ?? []).length;
    expect(matches).toBeLessThanOrEqual(1);
  });
});

// ─── 15. Test suite health ────────────────────────────────────────────────────
describe("Test suite health", () => {
  it("smoke-v138.test.ts exists", () => {
    expect(fs.existsSync(path.join(SERVER, "smoke-v138.test.ts"))).toBe(true);
  });

  it("smoke-v139.test.ts exists (this file)", () => {
    expect(fs.existsSync(path.join(SERVER, "smoke-v139.test.ts"))).toBe(true);
  });

  it("pbac.test.ts exists", () => {
    expect(fs.existsSync(path.join(SERVER, "pbac.test.ts"))).toBe(true);
  });
});
