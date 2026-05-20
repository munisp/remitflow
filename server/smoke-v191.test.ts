/**
 * smoke-v191.test.ts
 *
 * Smoke tests for v191:
 * 1. BDC Transfer History — listBdcLiquidityRequests + approveLiquidityRequest procedures
 * 2. CBN Corridor Rate Alerts — createRateAlert, listRateAlerts, deleteRateAlert, checkRateAlerts
 * 3. BDCPartnerPortal.tsx — Transfer History tab UI
 * 4. CbnComplianceDashboard.tsx — Rate Alerts tab UI
 * 5. Schema — exchangeRateAlerts table reused for CBN rate alerts
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const CBN_ROUTER = path.join(ROOT, "server/routers/cbnCompliance.ts");
const BDC_PORTAL = path.join(ROOT, "client/src/pages/BDCPartnerPortal.tsx");
const CBN_DASHBOARD = path.join(ROOT, "client/src/pages/CbnComplianceDashboard.tsx");
const SCHEMA = path.join(ROOT, "drizzle/schema.ts");

// ─── 1. BDC Transfer History — Backend ───────────────────────────────────────
describe("BDC Transfer History — listBdcLiquidityRequests procedure", () => {
  it("listBdcLiquidityRequests procedure is defined in cbnCompliance router", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    expect(content).toContain("listBdcLiquidityRequests:");
  });

  it("listBdcLiquidityRequests accepts bdcPartnerId filter", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("listBdcLiquidityRequests:"));
    expect(block.slice(0, 2000)).toContain("bdcPartnerId");
  });

  it("listBdcLiquidityRequests accepts status filter", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("listBdcLiquidityRequests:"));
    expect(block.slice(0, 2000)).toContain("status");
    expect(block.slice(0, 2000)).toContain("pending");
    expect(block.slice(0, 2000)).toContain("approved");
    expect(block.slice(0, 2000)).toContain("rejected");
    expect(block.slice(0, 2000)).toContain("disbursed");
  });

  it("listBdcLiquidityRequests accepts date range filters", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("listBdcLiquidityRequests:"));
    expect(block.slice(0, 2000)).toContain("fromDate");
    expect(block.slice(0, 2000)).toContain("toDate");
  });

  it("listBdcLiquidityRequests joins bdcPartners for partnerName and corridorCode", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("listBdcLiquidityRequests:"));
    expect(block.slice(0, 2500)).toContain("partnerName");
    expect(block.slice(0, 2500)).toContain("corridorCode");
    expect(block.slice(0, 2500)).toContain("leftJoin");
  });

  it("listBdcLiquidityRequests returns rows and total count", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("listBdcLiquidityRequests:"));
    expect(block.slice(0, 2500)).toContain("rows");
    expect(block.slice(0, 2500)).toContain("total");
  });

  it("listBdcLiquidityRequests is protected and admin-only", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("listBdcLiquidityRequests:"));
    expect(block.slice(0, 500)).toContain("protectedProcedure");
    expect(block.slice(0, 2000)).toContain("adminOnly");
  });

  it("listBdcLiquidityRequests supports pagination via limit and offset", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("listBdcLiquidityRequests:"));
    expect(block.slice(0, 2000)).toContain("limit");
    expect(block.slice(0, 2000)).toContain("offset");
  });
});

describe("BDC Transfer History — approveLiquidityRequest procedure", () => {
  it("approveLiquidityRequest procedure is defined", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    expect(content).toContain("approveLiquidityRequest:");
  });

  it("approveLiquidityRequest accepts approve, reject, and disburse actions", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveLiquidityRequest:"));
    expect(block.slice(0, 2000)).toContain("approve");
    expect(block.slice(0, 2000)).toContain("reject");
    expect(block.slice(0, 2000)).toContain("disburse");
  });

  it("approveLiquidityRequest updates status and processedAt", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveLiquidityRequest:"));
    expect(block.slice(0, 2000)).toContain("processedAt");
    expect(block.slice(0, 2000)).toContain("status");
  });

  it("approveLiquidityRequest accepts adbTransferReference", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveLiquidityRequest:"));
    expect(block.slice(0, 2000)).toContain("adbTransferReference");
  });

  it("approveLiquidityRequest publishes a Kafka event", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveLiquidityRequest:"));
    expect(block.slice(0, 3000)).toContain("publishKafkaEvent");
    expect(block.slice(0, 3000)).toContain("bdc-liquidity-");
  });

  it("approveLiquidityRequest creates an audit log entry", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveLiquidityRequest:"));
    expect(block.slice(0, 3000)).toContain("createAuditLog");
  });
});

// ─── 2. CBN Rate Alerts — Backend ─────────────────────────────────────────────
describe("CBN Rate Alerts — createRateAlert procedure", () => {
  it("createRateAlert procedure is defined", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    expect(content).toContain("createRateAlert:");
  });

  it("createRateAlert accepts fromCurrency, toCurrency, targetRate, direction", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("createRateAlert:"));
    expect(block.slice(0, 2000)).toContain("fromCurrency");
    expect(block.slice(0, 2000)).toContain("toCurrency");
    expect(block.slice(0, 2000)).toContain("targetRate");
    expect(block.slice(0, 2000)).toContain("direction");
  });

  it("createRateAlert direction enum includes above and below", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("createRateAlert:"));
    expect(block.slice(0, 2000)).toContain("above");
    expect(block.slice(0, 2000)).toContain("below");
  });

  it("createRateAlert inserts into exchangeRateAlerts table", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("createRateAlert:"));
    expect(block.slice(0, 2000)).toContain("exchangeRateAlerts");
    expect(block.slice(0, 2000)).toContain("insert");
  });

  it("createRateAlert publishes a Kafka event", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("createRateAlert:"));
    expect(block.slice(0, 2500)).toContain("publishKafkaEvent");
    expect(block.slice(0, 2500)).toContain("cbn-rate-alert-created");
  });
});

describe("CBN Rate Alerts — listRateAlerts procedure", () => {
  it("listRateAlerts procedure is defined", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    expect(content).toContain("listRateAlerts:");
  });

  it("listRateAlerts queries exchangeRateAlerts table", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("listRateAlerts:"));
    expect(block.slice(0, 1500)).toContain("exchangeRateAlerts");
  });

  it("listRateAlerts supports activeOnly filter", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("listRateAlerts:"));
    expect(block.slice(0, 1500)).toContain("activeOnly");
  });
});

describe("CBN Rate Alerts — deleteRateAlert procedure", () => {
  it("deleteRateAlert procedure is defined", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    expect(content).toContain("deleteRateAlert:");
  });

  it("deleteRateAlert soft-deletes by setting isActive to false", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("deleteRateAlert:"));
    expect(block.slice(0, 1500)).toContain("isActive");
    expect(block.slice(0, 1500)).toContain("false");
    expect(block.slice(0, 1500)).toContain("update");
  });

  it("deleteRateAlert publishes a Kafka event", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("deleteRateAlert:"));
    expect(block.slice(0, 2000)).toContain("publishKafkaEvent");
    expect(block.slice(0, 2000)).toContain("cbn-rate-alert-deleted");
  });
});

describe("CBN Rate Alerts — checkRateAlerts procedure", () => {
  it("checkRateAlerts procedure is defined", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    expect(content).toContain("checkRateAlerts:");
  });

  it("checkRateAlerts fetches live BMATCH rate (multi-corridor via cbnCorridors)", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 3000)).toContain("fetchBmatchRate");
    // v193: multi-corridor — fetches all active corridors, not just USD/NGN
    expect(block.slice(0, 3000)).toContain("activeCbnCorridors");
  });

  it("checkRateAlerts compares live rate against threshold in both directions", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 3000)).toContain("above");
    expect(block.slice(0, 3000)).toContain("below");
    expect(block.slice(0, 3000)).toContain("threshold");
  });

  it("checkRateAlerts calls notifyOwner when an alert is breached", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 4000)).toContain("notifyOwner");
    expect(block.slice(0, 4000)).toContain("CBN Rate Alert Triggered");
  });

  it("checkRateAlerts marks notificationSent and triggeredAt on breach", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 3000)).toContain("notificationSent");
    expect(block.slice(0, 3000)).toContain("triggeredAt");
  });

  it("checkRateAlerts publishes a Kafka event when triggered", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 6000)).toContain("publishKafkaEvent");
    expect(block.slice(0, 6000)).toContain("cbn-rate-alert-triggered");
  });

  it("checkRateAlerts returns checked, triggered, liveRate, and alerts", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 3000)).toContain("checked");
    expect(block.slice(0, 3000)).toContain("triggered");
    expect(block.slice(0, 3000)).toContain("liveRate");
    expect(block.slice(0, 3000)).toContain("alerts");
  });
});

// ─── 3. Schema — exchangeRateAlerts table ─────────────────────────────────────
describe("Schema — exchangeRateAlerts table reused for CBN rate alerts", () => {
  it("exchangeRateAlerts table exists in schema", () => {
    const content = fs.readFileSync(SCHEMA, "utf8");
    expect(content).toContain("exchangeRateAlerts");
    expect(content).toContain("exchange_rate_alerts");
  });

  it("exchangeRateAlerts has fromCurrency and toCurrency columns", () => {
    const content = fs.readFileSync(SCHEMA, "utf8");
    const block = content.slice(content.indexOf("exchangeRateAlerts = pgTable"));
    expect(block.slice(0, 800)).toContain("fromCurrency");
    expect(block.slice(0, 800)).toContain("toCurrency");
  });

  it("exchangeRateAlerts has direction column with above/below enum", () => {
    const content = fs.readFileSync(SCHEMA, "utf8");
    const block = content.slice(content.indexOf("exchangeRateAlerts = pgTable"));
    expect(block.slice(0, 800)).toContain("direction");
    expect(block.slice(0, 800)).toContain("above");
  });

  it("exchangeRateAlerts has isActive and notificationSent boolean columns", () => {
    const content = fs.readFileSync(SCHEMA, "utf8");
    const block = content.slice(content.indexOf("exchangeRateAlerts = pgTable"));
    expect(block.slice(0, 800)).toContain("isActive");
    expect(block.slice(0, 800)).toContain("notificationSent");
  });

  it("exchangeRateAlerts has triggeredAt timestamp column", () => {
    const content = fs.readFileSync(SCHEMA, "utf8");
    const block = content.slice(content.indexOf("exchangeRateAlerts = pgTable"));
    expect(block.slice(0, 800)).toContain("triggeredAt");
  });

  it("cbnCompliance router imports exchangeRateAlerts from schema", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    expect(content).toContain("exchangeRateAlerts");
  });
});

// ─── 4. BDCPartnerPortal.tsx — Transfer History Tab ───────────────────────────
describe("BDCPartnerPortal.tsx — Transfer History tab", () => {
  it("BDCPartnerPortal imports History icon from lucide-react", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("History");
  });

  it("BDCPartnerPortal has Transfer History TabsTrigger", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("Transfer History");
    expect(content).toContain('value="history"');
  });

  it("BDCPartnerPortal calls listBdcLiquidityRequests tRPC query", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("listBdcLiquidityRequests");
  });

  it("BDCPartnerPortal calls approveLiquidityRequest tRPC mutation", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("approveLiquidityRequest");
  });

  it("BDCPartnerPortal Transfer History table has Date column", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("Date");
    expect(content).toContain("createdAt");
  });

  it("BDCPartnerPortal Transfer History table has BMATCH Rate column", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("BMATCH Rate");
    expect(content).toContain("bmatchRateAtRequest");
  });

  it("BDCPartnerPortal Transfer History table has Settlement Ref column", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("Settlement Ref");
    expect(content).toContain("adbTransferReference");
  });

  it("BDCPartnerPortal Transfer History has status filter Select", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("historyStatus");
    expect(content).toContain("All Statuses");
  });

  it("BDCPartnerPortal Transfer History has Approve/Reject/Disburse action buttons", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("Approve");
    expect(content).toContain("Reject");
    expect(content).toContain("Mark Disbursed");
  });

  it("BDCPartnerPortal Transfer History shows total count badge", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("liquidityTotal");
  });
});

// ─── 5. CbnComplianceDashboard.tsx — Rate Alerts Tab ─────────────────────────
describe("CbnComplianceDashboard.tsx — Rate Alerts tab", () => {
  it("CbnComplianceDashboard imports Bell, BellOff, Trash2 icons", () => {
    const content = fs.readFileSync(CBN_DASHBOARD, "utf8");
    expect(content).toContain("Bell");
    expect(content).toContain("BellOff");
    expect(content).toContain("Trash2");
  });

  it("CbnComplianceDashboard has Rate Alerts TabsTrigger", () => {
    const content = fs.readFileSync(CBN_DASHBOARD, "utf8");
    expect(content).toContain("Rate Alerts");
    expect(content).toContain('value="alerts"');
  });

  it("CbnComplianceDashboard calls listRateAlerts tRPC query", () => {
    const content = fs.readFileSync(CBN_DASHBOARD, "utf8");
    expect(content).toContain("listRateAlerts");
  });

  it("CbnComplianceDashboard calls createRateAlert tRPC mutation", () => {
    const content = fs.readFileSync(CBN_DASHBOARD, "utf8");
    expect(content).toContain("createRateAlert");
  });

  it("CbnComplianceDashboard calls deleteRateAlert tRPC mutation", () => {
    const content = fs.readFileSync(CBN_DASHBOARD, "utf8");
    expect(content).toContain("deleteRateAlert");
  });

  it("CbnComplianceDashboard calls checkRateAlerts tRPC mutation", () => {
    const content = fs.readFileSync(CBN_DASHBOARD, "utf8");
    expect(content).toContain("checkRateAlerts");
  });

  it("CbnComplianceDashboard Rate Alerts form has fromCurrency and toCurrency selects", () => {
    const content = fs.readFileSync(CBN_DASHBOARD, "utf8");
    expect(content).toContain("alertFromCurrency");
    expect(content).toContain("alertToCurrency");
  });

  it("CbnComplianceDashboard Rate Alerts form has direction select with above/below", () => {
    const content = fs.readFileSync(CBN_DASHBOARD, "utf8");
    expect(content).toContain("alertDirection");
    expect(content).toContain("Rate goes above");
    expect(content).toContain("Rate goes below");
  });

  it("CbnComplianceDashboard Rate Alerts form has target rate input", () => {
    const content = fs.readFileSync(CBN_DASHBOARD, "utf8");
    expect(content).toContain("alertTargetRate");
    expect(content).toContain("Target Rate");
  });

  it("CbnComplianceDashboard Rate Alerts has Check Now button", () => {
    const content = fs.readFileSync(CBN_DASHBOARD, "utf8");
    expect(content).toContain("Check Now");
    expect(content).toContain("checkAlerts.mutate");
  });

  it("CbnComplianceDashboard Rate Alerts table shows pair, direction, target rate, status columns", () => {
    const content = fs.readFileSync(CBN_DASHBOARD, "utf8");
    expect(content).toContain("Target Rate");
    expect(content).toContain("Direction");
    expect(content).toContain("Triggered At");
  });

  it("CbnComplianceDashboard Rate Alerts has Deactivate button for active alerts", () => {
    const content = fs.readFileSync(CBN_DASHBOARD, "utf8");
    expect(content).toContain("Deactivate");
    expect(content).toContain("deleteAlert.mutate");
  });

  it("CbnComplianceDashboard shows active alerts count badge", () => {
    const content = fs.readFileSync(CBN_DASHBOARD, "utf8");
    expect(content).toContain("active");
    expect(content).toContain("isActive");
  });
});

// ─── 6. PAPSS Cron — deployment prerequisite ──────────────────────────────────
describe("PAPSS Daily Settlement Cron — deployment prerequisite", () => {
  it("PAPSS settlement endpoint exists in server core", () => {
    const indexTs = path.join(ROOT, "server/_core/index.ts");
    const content = fs.readFileSync(indexTs, "utf8");
    expect(content).toContain("papss-settlement");
  });

  it("PAPSS settlement endpoint accepts x-scheduled-task header", () => {
    const indexTs = path.join(ROOT, "server/_core/index.ts");
    const content = fs.readFileSync(indexTs, "utf8");
    expect(content).toContain("x-scheduled-task");
  });

  it("PAPSS settlement endpoint uses idempotency key", () => {
    const indexTs = path.join(ROOT, "server/_core/index.ts");
    const content = fs.readFileSync(indexTs, "utf8");
    expect(content).toContain("idempotency");
  });
});
