/**
 * smoke-v193.test.ts
 *
 * Smoke tests for v193:
 * 1. BDC Partner Onboarding Email — sent on approveBdcPartner
 * 2. Multi-Corridor Rate Alerts — checkRateAlerts fetches all active cbnCorridors
 * 3. Bulk Disburse AlertDialog — confirmation dialog in BDCPartnerPortal.tsx
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const CBN_ROUTER = path.join(ROOT, "server/routers/cbnCompliance.ts");
const BDC_PORTAL = path.join(ROOT, "client/src/pages/BDCPartnerPortal.tsx");
const SCHEMA = path.join(ROOT, "drizzle/schema.ts");

// ─── 1. BDC Partner Onboarding Email ─────────────────────────────────────────
describe("BDC Partner Onboarding Email — sent on approveBdcPartner", () => {
  it("approveBdcPartner calls sendEmail when partner has contactEmail", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner:"));
    // The email block should appear before the Kafka event
    const emailIdx = block.indexOf("sendEmail(");
    const kafkaIdx = block.indexOf("publishKafkaEvent(\"bdc-partner-approved\"");
    expect(emailIdx).toBeGreaterThan(0);
    expect(emailIdx).toBeLessThan(kafkaIdx);
  });

  it("approveBdcPartner email subject includes partner name", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner:"));
    const emailBlock = block.slice(block.indexOf("sendEmail("), block.indexOf("sendEmail(") + 3000);
    expect(emailBlock).toContain("Welcome to RemitFlow CBN BDC Network");
    expect(emailBlock).toContain("partner.name");
  });

  it("approveBdcPartner email includes CBN licence number", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner:"));
    const emailBlock = block.slice(block.indexOf("sendEmail("), block.indexOf("sendEmail(") + 3000);
    expect(emailBlock).toContain("cbnLicenceNumber");
  });

  it("approveBdcPartner email includes Keycloak client ID and temp password", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner:"));
    const emailBlock = block.slice(block.indexOf("sendEmail("), block.indexOf("sendEmail(") + 3000);
    expect(emailBlock).toContain("keycloakClientId");
    expect(emailBlock).toContain("tempPassword");
  });

  it("approveBdcPartner email includes daily FX limit", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner:"));
    const emailBlock = block.slice(block.indexOf("sendEmail("), block.indexOf("sendEmail(") + 3000);
    expect(emailBlock).toContain("maxDailyFxUsd");
  });

  it("approveBdcPartner email delivery is wrapped in try/catch", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner:"));
    const emailBlock = block.slice(block.indexOf("if (partner.contactEmail)"), block.indexOf("if (partner.contactEmail)") + 5000);
    expect(emailBlock).toContain("try {");
    expect(emailBlock).toContain("} catch (emailErr)");
  });

  it("approveBdcPartner only sends email when contactEmail is set", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner:"));
    expect(block.slice(0, 5000)).toContain("if (partner.contactEmail)");
  });

  it("approveBdcPartner email includes onboarding next steps", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner:"));
    const emailBlock = block.slice(block.indexOf("sendEmail("), block.indexOf("sendEmail(") + 3000);
    expect(emailBlock).toContain("Next Steps");
    expect(emailBlock).toContain("keycloakRealmUrl");
    expect(emailBlock).toContain("apisixGatewayUrl");
  });

  it("approveBdcPartner email has both HTML and text fallback", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner:"));
    const emailBlock = block.slice(block.indexOf("sendEmail("), block.indexOf("sendEmail(") + 4000);
    expect(emailBlock).toContain("html:");
    expect(emailBlock).toContain("text:");
  });
});

// ─── 2. Multi-Corridor Rate Alerts ────────────────────────────────────────────
describe("Multi-Corridor Rate Alerts — checkRateAlerts fetches all active cbnCorridors", () => {
  it("checkRateAlerts queries cbnCorridors table for active corridors", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 3000)).toContain("activeCbnCorridors");
    expect(block.slice(0, 3000)).toContain("cbnCorridors");
    expect(block.slice(0, 3000)).toContain("isActive");
  });

  it("checkRateAlerts builds a liveRateMap using Promise.all for parallel fetching", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 3000)).toContain("liveRateMap");
    expect(block.slice(0, 3000)).toContain("Promise.all");
    expect(block.slice(0, 3000)).toContain("fetchBmatchRate(corridor)");
  });

  it("checkRateAlerts uses liveRateMap.get(pair) for each alert", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 4000)).toContain("liveRateMap.get(pair)");
  });

  it("checkRateAlerts skips alerts where live rate could not be fetched", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 4000)).toContain("if (liveRateNum === undefined) continue");
  });

  it("checkRateAlerts returns corridorsChecked count", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 6000)).toContain("corridorsChecked: liveRateMap.size");
  });

  it("checkRateAlerts returns liveRates map in response", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 6000)).toContain("liveRates: Object.fromEntries(liveRateMap)");
  });

  it("checkRateAlerts fetches approved BDC partners once (not per-alert)", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    // approvedBdcPartners should be defined before the for loop
    const approvedIdx = block.indexOf("approvedBdcPartners");
    const forLoopIdx = block.indexOf("for (const alert of activeAlerts)");
    expect(approvedIdx).toBeGreaterThan(0);
    expect(approvedIdx).toBeLessThan(forLoopIdx);
  });

  it("checkRateAlerts handles corridor rate fetch failure gracefully", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    // The Promise.all map should have a try/catch
    const promiseAllBlock = block.slice(block.indexOf("Promise.all("), block.indexOf("Promise.all(") + 500);
    expect(promiseAllBlock).toContain("try {");
    expect(promiseAllBlock).toContain("} catch {");
  });

  it("cbnCorridors table has isActive boolean column", () => {
    const content = fs.readFileSync(SCHEMA, "utf8");
    const block = content.slice(content.indexOf("cbnCorridors = pgTable"));
    expect(block.slice(0, 600)).toContain("isActive");
    expect(block.slice(0, 600)).toContain("is_active");
  });

  it("cbnCorridors table has corridor varchar column", () => {
    const content = fs.readFileSync(SCHEMA, "utf8");
    const block = content.slice(content.indexOf("cbnCorridors = pgTable"));
    expect(block.slice(0, 400)).toContain("corridor");
    expect(block.slice(0, 400)).toContain("varchar");
  });
});

// ─── 3. Bulk Disburse AlertDialog ─────────────────────────────────────────────
describe("Bulk Disburse AlertDialog — confirmation before mutation fires", () => {
  it("BDCPartnerPortal imports AlertDialog components", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("AlertDialog");
    expect(content).toContain("AlertDialogTrigger");
    expect(content).toContain("AlertDialogContent");
    expect(content).toContain("AlertDialogAction");
    expect(content).toContain("AlertDialogCancel");
  });

  it("BDCPartnerPortal has showDisburseDialog state", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("showDisburseDialog");
    expect(content).toContain("setShowDisburseDialog");
  });

  it("AlertDialog open state is controlled by showDisburseDialog", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("open={showDisburseDialog}");
    expect(content).toContain("onOpenChange={setShowDisburseDialog}");
  });

  it("AlertDialog title is Confirm Bulk Disburse", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("Confirm Bulk Disburse");
  });

  it("AlertDialog description mentions count and irreversibility", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("liquidityApprovedCount");
    expect(content).toContain("cannot be undone");
  });

  it("AlertDialog has Cancel and Confirm Disburse actions", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("AlertDialogCancel");
    expect(content).toContain("Confirm Disburse");
  });

  it("AlertDialogAction closes dialog before firing mutation", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    const block = content.slice(content.indexOf("Confirm Disburse") - 400, content.indexOf("Confirm Disburse") + 200);
    expect(block).toContain("setShowDisburseDialog(false)");
    expect(block).toContain("bulkDisburse.mutate({})");
  });

  it("AlertDialogTrigger wraps the Disburse All Approved button", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    // Find the JSX usage (not the import line)
    const triggerJsxIdx = content.indexOf("<AlertDialogTrigger");
    const block = content.slice(triggerJsxIdx);
    expect(block.slice(0, 300)).toContain("asChild");
    expect(block.slice(0, 300)).toContain("Button");
  });
});
