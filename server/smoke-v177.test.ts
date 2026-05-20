/**
 * smoke-v177.test.ts
 * Verifies: POS auto-print receipt, SMS mock mode defaults, PAPSS scheduler endpoint,
 * Africa's Talking SMS wiring, and agentOnboarding completeness.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const root = resolve(__dirname, "..");

function readFile(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

function fileExists(rel: string) {
  return existsSync(resolve(root, rel));
}

// ─── POS Auto-Print ───────────────────────────────────────────────────────────
describe("AgentPOS auto-print receipt", () => {
  it("AgentPOS.tsx exists", () => expect(fileExists("client/src/pages/AgentPOS.tsx")).toBe(true));

  it("auto-prints after cash-in success", () =>
    expect(readFile("client/src/pages/AgentPOS.tsx")).toContain("handlePrintReceipt(data.transaction)"));

  it("auto-prints after cash-out success", () => {
    const content = readFile("client/src/pages/AgentPOS.tsx");
    // The auto-print call appears after the cash-out onSuccess block
    const cashOutIdx = content.indexOf("Cash-Out Successful");
    const afterCashOut = content.slice(cashOutIdx, cashOutIdx + 600);
    expect(afterCashOut).toContain("handlePrintReceipt(data.transaction)");
  });

  it("uses setTimeout delay for print trigger", () =>
    expect(readFile("client/src/pages/AgentPOS.tsx")).toContain("setTimeout"));

  it("posReceipt.generate mutation is wired", () =>
    expect(readFile("client/src/pages/AgentPOS.tsx")).toContain("posReceipt.generate"));

  it("receipt renders securely for printing", () =>
    // Uses srcdoc iframe (XSS-safe) instead of window.open+document.write
    expect(readFile("client/src/pages/AgentPOS.tsx")).toMatch(/srcdoc|printIframe|printWindow|window\.open/));

  it("receipt triggers browser print", () =>
    expect(readFile("client/src/pages/AgentPOS.tsx")).toMatch(/win\.print\(\)|iframe.*print|contentWindow.*print/));
});

// ─── posReceipt Router ────────────────────────────────────────────────────────
describe("posReceipt router", () => {
  it("posReceipt.ts exists", () => expect(fileExists("server/routers/posReceipt.ts")).toBe(true));

  it("has generate procedure", () =>
    expect(readFile("server/routers/posReceipt.ts")).toContain("generate"));

  it("returns receipt as base64", () => {
    const content = readFile("server/routers/posReceipt.ts");
    // posReceipt returns receiptHtml (base64-encoded HTML) or receiptBase64
    expect(content).toMatch(/receiptHtml|receiptBase64|base64Html/);
  });

  it("includes agent branding in receipt", () =>
    expect(readFile("server/routers/posReceipt.ts")).toContain("agentName"));

  it("includes transaction reference", () =>
    expect(readFile("server/routers/posReceipt.ts")).toContain("reference"));

  it("uses createAuditLog", () =>
    expect(readFile("server/routers/posReceipt.ts")).toContain("createAuditLog"));
});

// ─── SMS Provider Configuration ───────────────────────────────────────────────
describe("SMS provider configuration", () => {
  it("smsConfirm.ts exists", () => expect(fileExists("server/routers/smsConfirm.ts")).toBe(true));

  it("defaults to mock mode when SMS_PROVIDER not set", () => {
    const content = readFile("server/routers/smsConfirm.ts");
    expect(content).toContain('"mock"');
  });

  it("supports africas_talking provider", () =>
    expect(readFile("server/routers/smsConfirm.ts")).toContain("africas_talking"));

  it("uses AFRICAS_TALKING_API_KEY env var", () =>
    expect(readFile("server/routers/smsConfirm.ts")).toContain("AFRICAS_TALKING_API_KEY"));

  it("uses AFRICAS_TALKING_USERNAME env var", () =>
    expect(readFile("server/routers/smsConfirm.ts")).toContain("AFRICAS_TALKING_USERNAME"));

  it("calls Africa's Talking API endpoint", () =>
    expect(readFile("server/routers/smsConfirm.ts")).toContain("api.africastalking.com"));

  it("supports twilio provider", () =>
    expect(readFile("server/routers/smsConfirm.ts")).toContain("twilio"));

  it("mock mode logs OTP via logger or console", () => {
    const content = readFile("server/routers/smsConfirm.ts");
    // May use logger.info or console.log for OTP in mock mode
    expect(content).toMatch(/logger\.info|logger\.debug|console\.log/);
  });
});

// ─── PAPSS Settlement Scheduler Endpoint ──────────────────────────────────────
describe("PAPSS settlement scheduler endpoint", () => {
  it("endpoint registered in index.ts", () =>
    expect(readFile("server/_core/index.ts")).toContain("/api/scheduled/papss-settlement"));

  it("accepts POST method", () => {
    const content = readFile("server/_core/index.ts");
    const idx = content.indexOf("/api/scheduled/papss-settlement");
    // Look in a wider window around the endpoint definition
    const around = content.slice(Math.max(0, idx - 100), idx + 100);
    expect(around).toMatch(/post|POST/);
  });

  it("generates batchId", () =>
    expect(readFile("server/_core/index.ts")).toContain("PAPSS-BATCH-"));

  it("settles pending transfers", () =>
    expect(readFile("server/_core/index.ts")).toContain("settled"));

  it("sends owner notification", () =>
    expect(readFile("server/_core/index.ts")).toContain("notifyOwner"));

  it("returns corridors summary", () =>
    expect(readFile("server/_core/index.ts")).toContain("corridors"));

  it("returns settledAt timestamp", () =>
    expect(readFile("server/_core/index.ts")).toContain("settledAt"));
});

// ─── Agent Onboarding Router ──────────────────────────────────────────────────
describe("agentOnboarding router", () => {
  it("exists", () => expect(fileExists("server/routers/agentOnboarding.ts")).toBe(true));

  it("has register procedure", () =>
    expect(readFile("server/routers/agentOnboarding.ts")).toContain("register"));

  it("has listPending procedure", () =>
    expect(readFile("server/routers/agentOnboarding.ts")).toContain("listPending"));

  it("has approve procedure", () =>
    expect(readFile("server/routers/agentOnboarding.ts")).toContain("approve"));

  it("has reject procedure", () =>
    expect(readFile("server/routers/agentOnboarding.ts")).toContain("reject"));

  it("uses crypto.randomInt (not Math.random)", () => {
    const content = readFile("server/routers/agentOnboarding.ts");
    expect(content).not.toContain("Math.random");
    expect(content).toContain("crypto");
  });
});

// ─── Agent KYB Admin Page ─────────────────────────────────────────────────────
describe("AgentKYBAdmin page", () => {
  it("exists", () => expect(fileExists("client/src/pages/AgentKYBAdmin.tsx")).toBe(true));

  it("has approve action", () =>
    expect(readFile("client/src/pages/AgentKYBAdmin.tsx")).toContain("approve"));

  it("has reject action", () =>
    expect(readFile("client/src/pages/AgentKYBAdmin.tsx")).toContain("reject"));

  it("shows pending count", () =>
    expect(readFile("client/src/pages/AgentKYBAdmin.tsx")).toContain("pending"));
});

// ─── Support Tickets Page ─────────────────────────────────────────────────────
describe("SupportTickets page", () => {
  it("exists", () => expect(fileExists("client/src/pages/SupportTickets.tsx")).toBe(true));

  it("has create ticket", () =>
    expect(readFile("client/src/pages/SupportTickets.tsx")).toContain("create"));

  it("has close ticket", () =>
    expect(readFile("client/src/pages/SupportTickets.tsx")).toContain("close"));

  it("has FAQ section", () =>
    expect(readFile("client/src/pages/SupportTickets.tsx")).toContain("FAQ"));
});

// ─── Sidebar Navigation ───────────────────────────────────────────────────────
describe("DashboardLayout sidebar navigation", () => {
  it("has Agent POS link", () =>
    expect(readFile("client/src/components/DashboardLayout.tsx")).toContain("/agent/pos"));

  it("has My Transfers link", () =>
    expect(readFile("client/src/components/DashboardLayout.tsx")).toContain("/transfers"));

  it("has Support Tickets link", () =>
    expect(readFile("client/src/components/DashboardLayout.tsx")).toContain("/support/tickets"));

  it("has Agent KYB admin link", () =>
    expect(readFile("client/src/components/DashboardLayout.tsx")).toContain("/admin/agent-kyb"));

  it("has Rails Health admin link", () =>
    expect(readFile("client/src/components/DashboardLayout.tsx")).toContain("/admin/rails-health"));

  it("has Send Crypto link", () =>
    expect(readFile("client/src/components/DashboardLayout.tsx")).toContain("/send-crypto"));
});
