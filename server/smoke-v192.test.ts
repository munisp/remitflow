/**
 * smoke-v192.test.ts
 *
 * Smoke tests for v192:
 * 1. BDC Bulk Disburse — bulkDisburseLiquidityRequests procedure
 * 2. Rate Alert Email Delivery — checkRateAlerts sends email to BDC compliance officers
 * 3. BDCPartnerPortal.tsx — Disburse All Approved button
 * 4. PAPSS cron — endpoint + post-deploy activation note
 * 5. Schema correctness — bdcPartners.contactEmail field
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const CBN_ROUTER = path.join(ROOT, "server/routers/cbnCompliance.ts");
const BDC_PORTAL = path.join(ROOT, "client/src/pages/BDCPartnerPortal.tsx");
const EMAIL_SERVICE = path.join(ROOT, "server/email.service.ts");
const SCHEMA = path.join(ROOT, "drizzle/schema.ts");
const INDEX_TS = path.join(ROOT, "server/_core/index.ts");

// ─── 1. BDC Bulk Disburse — Backend ──────────────────────────────────────────
describe("BDC Bulk Disburse — bulkDisburseLiquidityRequests procedure", () => {
  it("bulkDisburseLiquidityRequests procedure is defined", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    expect(content).toContain("bulkDisburseLiquidityRequests:");
  });

  it("bulkDisburseLiquidityRequests fetches all approved requests", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("bulkDisburseLiquidityRequests:"));
    expect(block.slice(0, 2000)).toContain("approved");
    expect(block.slice(0, 2000)).toContain("approvedRequests");
  });

  it("bulkDisburseLiquidityRequests generates a batch reference with BATCH-ADB prefix", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("bulkDisburseLiquidityRequests:"));
    expect(block.slice(0, 2000)).toContain("BATCH-ADB-");
    expect(block.slice(0, 2000)).toContain("batchRef");
  });

  it("bulkDisburseLiquidityRequests uses crypto.randomBytes for batch reference entropy", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("bulkDisburseLiquidityRequests:"));
    expect(block.slice(0, 2000)).toContain("crypto.randomBytes");
  });

  it("bulkDisburseLiquidityRequests updates each request to disbursed status with ADB ref", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("bulkDisburseLiquidityRequests:"));
    expect(block.slice(0, 2500)).toContain("disbursed");
    expect(block.slice(0, 2500)).toContain("adbTransferReference");
    expect(block.slice(0, 2500)).toContain("processedAt");
  });

  it("bulkDisburseLiquidityRequests returns disbursed count, totalUsd, batchRef, and references", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("bulkDisburseLiquidityRequests:"));
    expect(block.slice(0, 3000)).toContain("disbursed");
    expect(block.slice(0, 3000)).toContain("totalUsd");
    expect(block.slice(0, 3000)).toContain("batchRef");
    expect(block.slice(0, 3000)).toContain("references");
  });

  it("bulkDisburseLiquidityRequests returns early when no approved requests exist", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("bulkDisburseLiquidityRequests:"));
    expect(block.slice(0, 2000)).toContain("disbursed: 0");
  });

  it("bulkDisburseLiquidityRequests publishes a Kafka event", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("bulkDisburseLiquidityRequests:"));
    expect(block.slice(0, 3000)).toContain("publishKafkaEvent");
    expect(block.slice(0, 3000)).toContain("bdc-liquidity-bulk-disbursed");
  });

  it("bulkDisburseLiquidityRequests creates an audit log entry", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("bulkDisburseLiquidityRequests:"));
    expect(block.slice(0, 3000)).toContain("createAuditLog");
    expect(block.slice(0, 3000)).toContain("bdc_liquidity_bulk_disburse");
  });

  it("bulkDisburseLiquidityRequests sends notifyOwner with batch summary", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("bulkDisburseLiquidityRequests:"));
    expect(block.slice(0, 3500)).toContain("notifyOwner");
    expect(block.slice(0, 3500)).toContain("BDC Bulk Disburse Complete");
  });

  it("bulkDisburseLiquidityRequests is protected and admin-only", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("bulkDisburseLiquidityRequests:"));
    expect(block.slice(0, 500)).toContain("protectedProcedure");
    expect(block.slice(0, 2000)).toContain("adminOnly");
  });
});

// ─── 2. Rate Alert Email Delivery ─────────────────────────────────────────────
describe("Rate Alert Email Delivery — checkRateAlerts sends email to BDC compliance officers", () => {
  it("cbnCompliance router imports sendEmail from email.service", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    expect(content).toContain("import { sendEmail } from \"../email.service\"");
  });

  it("checkRateAlerts calls sendEmail when an alert is breached", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 5000)).toContain("sendEmail");
  });

  it("checkRateAlerts queries bdcPartners for contactEmail", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 5000)).toContain("contactEmail");
    expect(block.slice(0, 5000)).toContain("bdcPartners");
  });

  it("checkRateAlerts email subject contains pair and direction", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 5000)).toContain("RemitFlow CBN Alert");
    expect(block.slice(0, 5000)).toContain("subject:");
  });

  it("checkRateAlerts email includes live rate and threshold in HTML body", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 6000)).toContain("Live Rate");
    expect(block.slice(0, 6000)).toContain("Threshold");
  });

  it("checkRateAlerts email delivery is wrapped in try/catch to prevent failures from blocking", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 6000)).toContain("try {");
    expect(block.slice(0, 6000)).toContain("} catch (emailErr)");
  });

  it("checkRateAlerts skips partners without contactEmail", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("checkRateAlerts:"));
    expect(block.slice(0, 6000)).toContain("if (!partner.contactEmail) continue");
  });

  it("email.service.ts has sendEmail function that uses Resend API", () => {
    const content = fs.readFileSync(EMAIL_SERVICE, "utf8");
    expect(content).toContain("sendEmail");
    expect(content).toContain("Resend");
  });

  it("bdcPartners table has contactEmail column in schema", () => {
    const content = fs.readFileSync(SCHEMA, "utf8");
    const block = content.slice(content.indexOf("bdcPartners = pgTable"));
    expect(block.slice(0, 600)).toContain("contactEmail");
    expect(block.slice(0, 600)).toContain("contact_email");
  });
});

// ─── 3. BDCPartnerPortal.tsx — Disburse All Approved button ──────────────────
describe("BDCPartnerPortal.tsx — Disburse All Approved bulk action", () => {
  it("BDCPartnerPortal calls bulkDisburseLiquidityRequests tRPC mutation", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("bulkDisburseLiquidityRequests");
  });

  it("BDCPartnerPortal has liquidityApprovedCount derived from liquidityHistory", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("liquidityApprovedCount");
    expect(content).toContain("liquidityHistory.filter");
  });

  it("BDCPartnerPortal Disburse All Approved button is conditionally shown when approvedCount > 0", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("liquidityApprovedCount > 0");
  });

  it("BDCPartnerPortal Disburse All Approved button shows count in label", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("Disburse All Approved");
    expect(content).toContain("liquidityApprovedCount");
  });

  it("BDCPartnerPortal Disburse All Approved button shows loading state", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("Disbursing...");
    expect(content).toContain("bulkDisburse.isPending");
  });

  it("BDCPartnerPortal bulk disburse onSuccess toast shows batchRef", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("Bulk Disburse Complete");
    expect(content).toContain("batchRef");
  });

  it("BDCPartnerPortal bulk disburse refreshes history on success", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    const block = content.slice(content.indexOf("bulkDisburseLiquidityRequests"));
    expect(block.slice(0, 500)).toContain("refetchHistory");
  });
});

// ─── 4. PAPSS Cron — post-deploy activation ───────────────────────────────────
describe("PAPSS Daily Settlement Cron — endpoint readiness", () => {
  it("PAPSS settlement endpoint exists in server core", () => {
    const content = fs.readFileSync(INDEX_TS, "utf8");
    expect(content).toContain("papss-settlement");
  });

  it("PAPSS endpoint accepts x-scheduled-task header", () => {
    const content = fs.readFileSync(INDEX_TS, "utf8");
    expect(content).toContain("x-scheduled-task");
  });

  it("PAPSS endpoint uses idempotency key to prevent duplicate runs", () => {
    const content = fs.readFileSync(INDEX_TS, "utf8");
    expect(content).toContain("idempotency");
  });

  it("CHANGE_MANIFEST.md documents PAPSS cron post-deploy activation", () => {
    const manifest = path.join(ROOT, "CHANGE_MANIFEST.md");
    const content = fs.readFileSync(manifest, "utf8");
    expect(content).toContain("PAPSS");
    expect(content).toContain("02:00");
  });
});

// ─── 5. Schema correctness ────────────────────────────────────────────────────
describe("Schema — bdcPartners contactEmail field", () => {
  it("bdcPartners table has contactEmail varchar column", () => {
    const content = fs.readFileSync(SCHEMA, "utf8");
    const block = content.slice(content.indexOf("bdcPartners = pgTable"));
    expect(block.slice(0, 600)).toContain("contactEmail");
    expect(block.slice(0, 600)).toContain("varchar");
  });

  it("bdcPartners table has contactPhone varchar column", () => {
    const content = fs.readFileSync(SCHEMA, "utf8");
    const block = content.slice(content.indexOf("bdcPartners = pgTable"));
    expect(block.slice(0, 600)).toContain("contactPhone");
  });

  it("bdcLiquidityRequests table has status field with default pending", () => {
    const content = fs.readFileSync(SCHEMA, "utf8");
    const block = content.slice(content.indexOf("bdcLiquidityRequests = pgTable"));
    expect(block.slice(0, 600)).toContain("status");
    expect(block.slice(0, 600)).toContain("pending");
  });
});
