/**
 * smoke-v194.test.ts
 *
 * Smoke tests for v194:
 * 1. resetRateAlert — re-arms a triggered alert (notificationSent=false, isActive=true)
 * 2. listRateAlertHistory — returns alerts where notificationSent=true
 * 3. getBdcOnboardingEmailPreview — returns HTML + subject + previewData
 * 4. BdcOnboardingEmailPreview.tsx — admin-only page with iframe and controls
 * 5. App.tsx — route /admin/email-preview/bdc-onboarding registered
 * 6. CbnComplianceDashboard.tsx — Rate Alert History table and Re-arm button
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const CBN_ROUTER = path.join(ROOT, "server/routers/cbnCompliance.ts");
const DASHBOARD = path.join(ROOT, "client/src/pages/CbnComplianceDashboard.tsx");
const PREVIEW_PAGE = path.join(ROOT, "client/src/pages/BdcOnboardingEmailPreview.tsx");
const APP_TSX = path.join(ROOT, "client/src/App.tsx");

// ─── 1. resetRateAlert ────────────────────────────────────────────────────────
describe("resetRateAlert — re-arms a triggered alert", () => {
  it("resetRateAlert procedure exists in cbnCompliance.ts", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    expect(content).toContain("resetRateAlert:");
  });

  it("resetRateAlert sets notificationSent to false", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("resetRateAlert:"));
    const resetBlock = block.slice(0, 1500);
    expect(resetBlock).toContain("notificationSent: false");
  });

  it("resetRateAlert sets isActive to true", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("resetRateAlert:"));
    const resetBlock = block.slice(0, 1500);
    expect(resetBlock).toContain("isActive: true");
  });

  it("resetRateAlert sets triggeredAt to null", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("resetRateAlert:"));
    const resetBlock = block.slice(0, 1500);
    expect(resetBlock).toContain("triggeredAt: null");
  });

  it("resetRateAlert throws NOT_FOUND when alert does not exist", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("resetRateAlert:"));
    const resetBlock = block.slice(0, 1500);
    expect(resetBlock).toContain("NOT_FOUND");
  });

  it("resetRateAlert writes an audit log entry", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("resetRateAlert:"));
    const resetBlock = block.slice(0, 1500);
    expect(resetBlock).toContain("createAuditLog");
    expect(resetBlock).toContain("rate_alert_rearmed");
  });

  it("resetRateAlert returns success:true and the alert id", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("resetRateAlert:"));
    const resetBlock = block.slice(0, 1500);
    expect(resetBlock).toContain("success: true");
    expect(resetBlock).toContain("id: input.id");
  });

  it("resetRateAlert is a protectedProcedure with adminOnly guard", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("resetRateAlert:"));
    const resetBlock = block.slice(0, 1500);
    expect(resetBlock).toContain("protectedProcedure");
    expect(resetBlock).toContain("adminOnly(ctx)");
  });
});

// ─── 2. listRateAlertHistory ──────────────────────────────────────────────────
describe("listRateAlertHistory — returns triggered alerts", () => {
  it("listRateAlertHistory procedure exists in cbnCompliance.ts", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    expect(content).toContain("listRateAlertHistory:");
  });

  it("listRateAlertHistory filters by notificationSent=true", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("listRateAlertHistory:"));
    const histBlock = block.slice(0, 2000);
    expect(histBlock).toContain("notificationSent");
    expect(histBlock).toContain("true");
  });

  it("listRateAlertHistory orders by triggeredAt desc", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("listRateAlertHistory:"));
    const histBlock = block.slice(0, 2000);
    expect(histBlock).toContain("triggeredAt");
    expect(histBlock).toContain("desc");
  });

  it("listRateAlertHistory supports optional pair filter", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("listRateAlertHistory:"));
    const histBlock = block.slice(0, 2000);
    expect(histBlock).toContain("pair: z.string().optional()");
  });

  it("listRateAlertHistory returns items array and total count", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("listRateAlertHistory:"));
    const histBlock = block.slice(0, 2500);
    expect(histBlock).toContain("items:");
    expect(histBlock).toContain("total:");
  });

  it("listRateAlertHistory supports pagination with limit and offset", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("listRateAlertHistory:"));
    const histBlock = block.slice(0, 2000);
    expect(histBlock).toContain("limit");
    expect(histBlock).toContain("offset");
  });

  it("listRateAlertHistory is a protectedProcedure with adminOnly guard", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("listRateAlertHistory:"));
    const histBlock = block.slice(0, 2000);
    expect(histBlock).toContain("protectedProcedure");
    expect(histBlock).toContain("adminOnly(ctx)");
  });
});

// ─── 3. getBdcOnboardingEmailPreview ─────────────────────────────────────────
describe("getBdcOnboardingEmailPreview — returns HTML email preview", () => {
  it("getBdcOnboardingEmailPreview procedure exists in cbnCompliance.ts", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    expect(content).toContain("getBdcOnboardingEmailPreview:");
  });

  it("getBdcOnboardingEmailPreview returns html field", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("getBdcOnboardingEmailPreview:"));
    const previewBlock = block.slice(0, 5500);
    expect(previewBlock).toContain("html,");
  });

  it("getBdcOnboardingEmailPreview returns subject field", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("getBdcOnboardingEmailPreview:"));
    const previewBlock = block.slice(0, 5500);
    expect(previewBlock).toContain("subject:");
    expect(previewBlock).toContain("Welcome to RemitFlow CBN BDC Network");
  });

  it("getBdcOnboardingEmailPreview returns previewData with keycloakClientId", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("getBdcOnboardingEmailPreview:"));
    const previewBlock = block.slice(0, 5500);
    expect(previewBlock).toContain("previewData:");
    expect(previewBlock).toContain("keycloakClientId");
  });

  it("getBdcOnboardingEmailPreview HTML includes gradient header", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("getBdcOnboardingEmailPreview:"));
    const previewBlock = block.slice(0, 5500);
    expect(previewBlock).toContain("linear-gradient");
    expect(previewBlock).toContain("#4f46e5");
  });

  it("getBdcOnboardingEmailPreview HTML includes PREVIEW-ONLY marker", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("getBdcOnboardingEmailPreview:"));
    const previewBlock = block.slice(0, 4000);
    expect(previewBlock).toContain("PREVIEW");
  });

  it("getBdcOnboardingEmailPreview accepts optional input with defaults", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("getBdcOnboardingEmailPreview:"));
    const previewBlock = block.slice(0, 2000);
    expect(previewBlock).toContain("Acme BDC Limited");
    expect(previewBlock).toContain("BDC/2024/DEMO-001");
  });

  it("getBdcOnboardingEmailPreview is a protectedProcedure with adminOnly guard", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("getBdcOnboardingEmailPreview:"));
    const previewBlock = block.slice(0, 2000);
    expect(previewBlock).toContain("protectedProcedure");
    expect(previewBlock).toContain("adminOnly(ctx)");
  });
});

// ─── 4. BdcOnboardingEmailPreview.tsx ────────────────────────────────────────
describe("BdcOnboardingEmailPreview.tsx — admin-only preview page", () => {
  it("BdcOnboardingEmailPreview.tsx file exists", () => {
    expect(fs.existsSync(PREVIEW_PAGE)).toBe(true);
  });

  it("renders an iframe with srcDoc for email preview", () => {
    const content = fs.readFileSync(PREVIEW_PAGE, "utf8");
    expect(content).toContain("<iframe");
    expect(content).toContain("srcDoc");
  });

  it("uses getBdcOnboardingEmailPreview tRPC query", () => {
    const content = fs.readFileSync(PREVIEW_PAGE, "utf8");
    expect(content).toContain("getBdcOnboardingEmailPreview");
    expect(content).toContain("trpc.cbnCompliance");
  });

  it("has admin-only guard that redirects non-admins", () => {
    const content = fs.readFileSync(PREVIEW_PAGE, "utf8");
    expect(content).toContain("user.role !== \"admin\"");
    expect(content).toContain("Admin Access Required");
  });

  it("has Copy HTML button", () => {
    const content = fs.readFileSync(PREVIEW_PAGE, "utf8");
    expect(content).toContain("Copy");
    expect(content).toContain("navigator.clipboard");
  });

  it("has Refresh Preview button", () => {
    const content = fs.readFileSync(PREVIEW_PAGE, "utf8");
    expect(content).toContain("Refresh Preview");
    expect(content).toContain("refetch");
  });

  it("shows partner name, CBN licence, ADB name, daily FX limit inputs", () => {
    const content = fs.readFileSync(PREVIEW_PAGE, "utf8");
    expect(content).toContain("partnerName");
    expect(content).toContain("cbnLicenceNumber");
    expect(content).toContain("adbName");
    expect(content).toContain("maxDailyFxUsd");
  });

  it("shows a PREVIEW badge", () => {
    const content = fs.readFileSync(PREVIEW_PAGE, "utf8");
    expect(content).toContain("Preview Only");
  });

  it("shows back navigation to /admin", () => {
    const content = fs.readFileSync(PREVIEW_PAGE, "utf8");
    expect(content).toContain("/admin");
    expect(content).toContain("navigate");
  });
});

// ─── 5. App.tsx route registration ───────────────────────────────────────────
describe("App.tsx — /admin/email-preview/bdc-onboarding route", () => {
  it("BdcOnboardingEmailPreview is lazily imported in App.tsx", () => {
    const content = fs.readFileSync(APP_TSX, "utf8");
    expect(content).toContain("BdcOnboardingEmailPreview");
    expect(content).toContain("import(\"./pages/BdcOnboardingEmailPreview\")");
  });

  it("route /admin/email-preview/bdc-onboarding is registered", () => {
    const content = fs.readFileSync(APP_TSX, "utf8");
    expect(content).toContain("/admin/email-preview/bdc-onboarding");
    expect(content).toContain("component={BdcOnboardingEmailPreview}");
  });
});

// ─── 6. CbnComplianceDashboard.tsx — Rate Alert History UI ───────────────────
describe("CbnComplianceDashboard.tsx — Rate Alert History and Re-arm", () => {
  it("listRateAlertHistory query is wired in CbnComplianceDashboard", () => {
    const content = fs.readFileSync(DASHBOARD, "utf8");
    expect(content).toContain("listRateAlertHistory");
    expect(content).toContain("trpc.cbnCompliance.listRateAlertHistory");
  });

  it("resetRateAlert mutation is wired in CbnComplianceDashboard", () => {
    const content = fs.readFileSync(DASHBOARD, "utf8");
    expect(content).toContain("resetRateAlert");
    expect(content).toContain("trpc.cbnCompliance.resetRateAlert");
  });

  it("Re-arm button appears in the history table", () => {
    const content = fs.readFileSync(DASHBOARD, "utf8");
    expect(content).toContain("Re-arm");
    expect(content).toContain("RotateCcw");
  });

  it("Triggered Alert History card is rendered", () => {
    const content = fs.readFileSync(DASHBOARD, "utf8");
    expect(content).toContain("Triggered Alert History");
    expect(content).toContain("alertHistoryTotal");
  });

  it("History icon is imported from lucide-react", () => {
    const content = fs.readFileSync(DASHBOARD, "utf8");
    expect(content).toContain("History");
    expect(content).toContain("RotateCcw");
  });

  it("alertHistory maps over items with triggeredAt display", () => {
    const content = fs.readFileSync(DASHBOARD, "utf8");
    expect(content).toContain("alertHistory.map");
    expect(content).toContain("triggeredAt");
  });

  it("refetchAlertHistory is called on successful re-arm", () => {
    const content = fs.readFileSync(DASHBOARD, "utf8");
    expect(content).toContain("refetchAlertHistory");
  });

  it("empty state shown when no alerts have triggered", () => {
    const content = fs.readFileSync(DASHBOARD, "utf8");
    expect(content).toContain("No alerts have triggered yet");
  });
});
