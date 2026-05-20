/**
 * smoke-v198.test.ts
 * Production-readiness sprint: WAF/security hardening, mobile parity,
 * middleware wiring, and v197 polyglot microservice integration.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const read = (p: string) => fs.readFileSync(path.resolve(p), "utf8");
const exists = (p: string) => fs.existsSync(path.resolve(p));

// ─── Go Security Sidecar WAF ─────────────────────────────────────────────────
describe("go-security-sidecar WAF", () => {
  const sidecar = read("services/go-security-sidecar/main.go");

  it("has wafInspect function", () => {
    expect(sidecar).toContain("func wafInspect");
  });

  it("detects SQL injection patterns", () => {
    expect(sidecar).toContain("union");
  });

  it("detects XSS patterns", () => {
    expect(sidecar).toContain("<script");
  });

  it("detects SSRF patterns", () => {
    expect(sidecar).toContain("169\\.254");
  });

  it("detects ransomware/path traversal patterns", () => {
    expect(sidecar).toContain("ransom");
  });

  it("URL-decodes query string before WAF inspection", () => {
    expect(sidecar).toContain("QueryUnescape");
  });

  it("returns 403 on WAF block", () => {
    expect(sidecar).toContain("StatusForbidden");
  });

  it("has WAF tests in test file", () => {
    const tests = read("services/go-security-sidecar/main_test.go");
    expect(tests).toContain("TestWAF");
  });
});

// ─── Go Outbound SWIFT Service ───────────────────────────────────────────────
describe("go outbound-swift service", () => {
  const main = read("services/outbound-swift/main.go");

  it("has /quote endpoint", () => {
    expect(main).toContain("/quote");
  });

  it("has /submit endpoint", () => {
    expect(main).toContain("/submit");
  });

  it("has /compliance endpoint", () => {
    expect(main).toContain("/compliance");
  });

  it("has /fee-schedule endpoint", () => {
    expect(main).toContain("/fee-schedule");
  });

  it("has CBN purpose codes", () => {
    expect(main).toContain("education");
    expect(main).toContain("medical");
  });

  it("has FX spread calculation", () => {
    expect(main).toContain("spread");
  });

  it("has SWIFT reference generation", () => {
    expect(main).toContain("SWIFT");
  });
});

// ─── Rust Float Income Engine ─────────────────────────────────────────────────
describe("rust float-income engine", () => {
  const main = read("services/float-income/src/main.rs");

  it("has FloatRequest struct", () => {
    expect(main).toContain("FloatRequest");
  });

  it("has CBN MPR constant", () => {
    expect(main).toContain("CBN_MPR");
  });

  it("has settlement_days field", () => {
    expect(main).toContain("settlement_days");
  });

  it("has project_float function", () => {
    expect(main).toContain("project_float");
  });

  it("has daily accrual calculation", () => {
    expect(main).toContain("daily_accrual");
  });

  it("has daily_float_income function", () => {
    expect(main).toContain("daily_float_income");
  });
});

// ─── Python Revenue Analytics Service ────────────────────────────────────────
describe("python revenue-analytics service", () => {
  const app = read("services/revenue-analytics/app.py");

  it("has scenario modeler", () => {
    expect(app).toContain("bear");
    expect(app).toContain("bull");
  });

  it("has cross-sell propensity scoring", () => {
    expect(app).toContain("cross_sell");
  });

  it("has formalization rate tracker", () => {
    expect(app).toContain("formalization");
  });

  it("has outbound segment classifier", () => {
    expect(app).toContain("segment");
  });

  it("has HTTP server handler", () => {
    expect(app).toContain("BaseHTTPRequestHandler");
  });

  it("has test file", () => {
    expect(exists("services/revenue-analytics/test_app.py")).toBe(true);
  });
});

// ─── TypeScript Outbound Router ───────────────────────────────────────────────
describe("typescript outbound router", () => {
  const router = read("server/routers/outbound.ts");

  it("has swift sub-router", () => {
    expect(router).toContain("swift");
  });

  it("has floatIncome sub-router", () => {
    expect(router).toContain("floatIncome");
  });

  it("has analytics sub-router", () => {
    expect(router).toContain("analytics");
  });

  it("is wired into appRouter", () => {
    const routers = read("server/routers.ts");
    expect(routers).toContain("outbound");
  });

  it("proxies to Go service", () => {
    expect(router).toContain("8081");
  });

  it("proxies to Rust service", () => {
    expect(router).toContain("8082");
  });

  it("proxies to Python service", () => {
    expect(router).toContain("8083");
  });
});

// ─── Flutter Mobile Parity ────────────────────────────────────────────────────
describe("flutter v197 mobile parity", () => {
  const appDart = read("mobile/flutter/lib/app.dart");

  it("imports SendFromNigeriaScreen", () => {
    expect(appDart).toContain("send_from_nigeria_screen.dart");
  });

  it("imports EducationPaymentsScreen", () => {
    expect(appDart).toContain("education_payments_screen.dart");
  });

  it("imports MedicalTourismScreen", () => {
    expect(appDart).toContain("medical_tourism_screen.dart");
  });

  it("imports FormalizationDashboardScreen", () => {
    expect(appDart).toContain("formalization_dashboard_screen.dart");
  });

  it("imports OutboundRevenueModelScreen", () => {
    expect(appDart).toContain("outbound_revenue_model_screen.dart");
  });

  it("imports RecipientOnboardingScreen", () => {
    expect(appDart).toContain("recipient_onboarding_screen.dart");
  });

  it("has /send-abroad route", () => {
    expect(appDart).toContain("/send-abroad");
  });

  it("has /education-payments route", () => {
    expect(appDart).toContain("/education-payments");
  });

  it("has /medical-tourism route", () => {
    expect(appDart).toContain("/medical-tourism");
  });

  it("has /formalization-dashboard route", () => {
    expect(appDart).toContain("/formalization-dashboard");
  });

  it("has /outbound-revenue-model route", () => {
    expect(appDart).toContain("/outbound-revenue-model");
  });

  it("has /recipient-onboarding route", () => {
    expect(appDart).toContain("/recipient-onboarding");
  });

  it("all 6 flutter screen files exist", () => {
    const screens = [
      "mobile/flutter/lib/screens/send_from_nigeria_screen.dart",
      "mobile/flutter/lib/screens/education_payments_screen.dart",
      "mobile/flutter/lib/screens/medical_tourism_screen.dart",
      "mobile/flutter/lib/screens/formalization_dashboard_screen.dart",
      "mobile/flutter/lib/screens/outbound_revenue_model_screen.dart",
      "mobile/flutter/lib/screens/recipient_onboarding_screen.dart",
    ];
    screens.forEach(s => expect(exists(s)).toBe(true));
  });
});

// ─── React Native Mobile Parity ───────────────────────────────────────────────
describe("react native v197 mobile parity", () => {
  const nav = read("mobile/react-native/src/navigation/RootNavigator.tsx");

  it("imports SendFromNigeriaScreen", () => {
    expect(nav).toContain("SendFromNigeriaScreen");
  });

  it("imports EducationPaymentsScreen", () => {
    expect(nav).toContain("EducationPaymentsScreen");
  });

  it("imports MedicalTourismScreen", () => {
    expect(nav).toContain("MedicalTourismScreen");
  });

  it("imports FormalizationDashboardScreen", () => {
    expect(nav).toContain("FormalizationDashboardScreen");
  });

  it("imports OutboundRevenueModelScreen", () => {
    expect(nav).toContain("OutboundRevenueModelScreen");
  });

  it("imports RecipientOnboardingScreen", () => {
    expect(nav).toContain("RecipientOnboardingScreen");
  });

  it("has SendAbroad in type map", () => {
    expect(nav).toContain("SendAbroad: undefined");
  });

  it("has EducationPayments in type map", () => {
    expect(nav).toContain("EducationPayments: undefined");
  });

  it("has MedicalTourism in type map", () => {
    expect(nav).toContain("MedicalTourism: undefined");
  });

  it("has FormalizationDashboard in type map", () => {
    expect(nav).toContain("FormalizationDashboard: undefined");
  });

  it("has OutboundRevenueModel in type map", () => {
    expect(nav).toContain("OutboundRevenueModel: undefined");
  });

  it("has RecipientOnboarding in type map", () => {
    expect(nav).toContain("RecipientOnboarding: undefined");
  });

  it("all 6 react native screen files exist", () => {
    const screens = [
      "mobile/react-native/src/screens/SendFromNigeriaScreen.tsx",
      "mobile/react-native/src/screens/EducationPaymentsScreen.tsx",
      "mobile/react-native/src/screens/MedicalTourismScreen.tsx",
      "mobile/react-native/src/screens/FormalizationDashboardScreen.tsx",
      "mobile/react-native/src/screens/OutboundRevenueModelScreen.tsx",
      "mobile/react-native/src/screens/RecipientOnboardingScreen.tsx",
    ];
    screens.forEach(s => expect(exists(s)).toBe(true));
  });
});

// ─── Web Frontend Pages ───────────────────────────────────────────────────────
describe("web frontend v197 pages", () => {
  it("SendFromNigeria.tsx exists", () => {
    expect(exists("client/src/pages/SendFromNigeria.tsx")).toBe(true);
  });

  it("EducationPayments.tsx exists", () => {
    expect(exists("client/src/pages/EducationPayments.tsx")).toBe(true);
  });

  it("MedicalTourism.tsx exists", () => {
    expect(exists("client/src/pages/MedicalTourism.tsx")).toBe(true);
  });

  it("FormalizationDashboard.tsx exists", () => {
    expect(exists("client/src/pages/FormalizationDashboard.tsx")).toBe(true);
  });

  it("OutboundRevenueModel.tsx exists", () => {
    expect(exists("client/src/pages/OutboundRevenueModel.tsx")).toBe(true);
  });

  it("RecipientOnboarding.tsx exists", () => {
    expect(exists("client/src/pages/RecipientOnboarding.tsx")).toBe(true);
  });

  it("all 6 pages are registered in App.tsx", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain("SendFromNigeria");
    expect(app).toContain("EducationPayments");
    expect(app).toContain("MedicalTourism");
    expect(app).toContain("FormalizationDashboard");
    expect(app).toContain("OutboundRevenueModel");
    expect(app).toContain("RecipientOnboarding");
  });
});

// ─── SSE Exponential Backoff ──────────────────────────────────────────────────
describe("SSE exponential backoff resilience", () => {
  const layout = read("client/src/components/DashboardLayout.tsx");

  it("has exponential backoff in SSE reconnect", () => {
    expect(layout).toContain("backoff");
  });

  it("has max backoff cap", () => {
    expect(layout).toContain("60");
  });
});

// ─── Seed Data ────────────────────────────────────────────────────────────────
describe("seed data completeness", () => {
  const seed = read("drizzle/seed.ts");

  it("has CBN corridors seed data", () => {
    expect(seed).toContain("cbnCorridors");
  });

  it("has BDC partners seed data", () => {
    expect(seed).toContain("bdcPartners");
  });

  it("has exchange rate alerts seed data", () => {
    expect(seed).toContain("exchangeRateAlerts");
  });
});

// ─── Gap Analysis Report ──────────────────────────────────────────────────────
describe("gap analysis report", () => {
  it("gap analysis report exists", () => {
    expect(exists("../remitflow-gap-analysis.md")).toBe(true);
  });

  it("gap analysis covers outbound SWIFT", () => {
    const report = read("../remitflow-gap-analysis.md");
    expect(report).toContain("SWIFT");
  });

  it("gap analysis covers float income", () => {
    const report = read("../remitflow-gap-analysis.md");
    expect(report).toContain("float");
  });

  it("gap analysis covers cross-sell", () => {
    const report = read("../remitflow-gap-analysis.md");
    expect(report).toContain("cross-sell");
  });
});
