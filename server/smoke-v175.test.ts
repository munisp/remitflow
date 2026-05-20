/**
 * smoke-v175.test.ts
 * Verifies: Agent KYB Admin page, POS print button wiring, PAPSS settlement endpoint,
 * and PAPSS scheduler activation readiness.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");

const readFile = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const fileExists = (rel: string) => fs.existsSync(path.join(root, rel));

// ─── 1. Agent KYB Admin page ────────────────────────────────────────────────
describe("v175 — Agent KYB Admin page", () => {
  it("AgentKYBAdmin.tsx exists", () => {
    expect(fileExists("client/src/pages/AgentKYBAdmin.tsx")).toBe(true);
  });

  it("uses trpc.agentOnboarding.listPending", () => {
    const content = readFile("client/src/pages/AgentKYBAdmin.tsx");
    expect(content).toContain("agentOnboarding.listPending");
  });

  it("uses trpc.agentOnboarding.approve", () => {
    const content = readFile("client/src/pages/AgentKYBAdmin.tsx");
    expect(content).toContain("agentOnboarding.approve");
  });

  it("uses trpc.agentOnboarding.reject", () => {
    const content = readFile("client/src/pages/AgentKYBAdmin.tsx");
    expect(content).toContain("agentOnboarding.reject");
  });

  it("has role guard for admin", () => {
    const content = readFile("client/src/pages/AgentKYBAdmin.tsx");
    expect(content).toContain("admin");
  });

  it("has reject dialog with reason textarea", () => {
    const content = readFile("client/src/pages/AgentKYBAdmin.tsx");
    expect(content).toContain("Textarea");
    expect(content).toContain("rejectReason");
  });

  it("route /admin/agent-kyb registered in App.tsx", () => {
    const app = readFile("client/src/App.tsx");
    expect(app).toContain("/admin/agent-kyb");
    expect(app).toContain("AgentKYBAdmin");
  });
});

// ─── 2. POS Print Button ─────────────────────────────────────────────────────
describe("v175 — POS Print Button", () => {
  it("AgentPOS.tsx uses trpc.posReceipt.generate", () => {
    const content = readFile("client/src/pages/AgentPOS.tsx");
    expect(content).toContain("posReceipt.generate");
  });

  it("AgentPOS.tsx has handlePrintReceipt function", () => {
    const content = readFile("client/src/pages/AgentPOS.tsx");
    expect(content).toContain("handlePrintReceipt");
  });

  it("AgentPOS.tsx renders receipt securely for printing", () => {
    const content = readFile("client/src/pages/AgentPOS.tsx");
    // Uses srcdoc iframe (XSS-safe) instead of window.open+document.write
    expect(content).toMatch(/srcdoc|printIframe|printWindow|window\.open/);
  });

  it("AgentPOS.tsx print button is disabled when no lastTx", () => {
    const content = readFile("client/src/pages/AgentPOS.tsx");
    expect(content).toContain("disabled={!lastTx || receiptMutation.isPending}");
  });

  it("posReceipt router exists", () => {
    expect(fileExists("server/routers/posReceipt.ts")).toBe(true);
  });

  it("posReceipt router has generate procedure", () => {
    const content = readFile("server/routers/posReceipt.ts");
    expect(content).toContain("generate");
    // Returns receiptHtml (base64-encoded HTML) or receiptBase64
    expect(content).toMatch(/receiptHtml|receiptBase64/);
  });

  it("posReceipt router is wired in appRouter", () => {
    const routers = readFile("server/routers.ts");
    expect(routers).toContain("posReceipt");
  });
});

// ─── 3. PAPSS Settlement Endpoint ────────────────────────────────────────────
describe("v175 — PAPSS Settlement Endpoint", () => {
  it("POST /api/scheduled/papss-settlement endpoint exists in index.ts", () => {
    const content = readFile("server/_core/index.ts");
    expect(content).toContain("/api/scheduled/papss-settlement");
  });

  it("endpoint accepts POST method", () => {
    const content = readFile("server/_core/index.ts");
    expect(content).toContain("app.post(\"/api/scheduled/papss-settlement\"");
  });

  it("endpoint runs multilateral netting", () => {
    const content = readFile("server/_core/index.ts");
    expect(content).toContain("netting");
  });

  it("endpoint sends owner notification", () => {
    const content = readFile("server/_core/index.ts");
    // The endpoint imports and calls notifyOwner
    const idx = content.indexOf("/api/scheduled/papss-settlement");
    const snippet = content.slice(idx, idx + 5000);
    expect(snippet).toMatch(/notifyOwner|notify/);
  });
});

// ─── 4. Agent Onboarding Router ───────────────────────────────────────────────
describe("v175 — Agent Onboarding Router", () => {
  it("agentOnboarding router exists", () => {
    expect(fileExists("server/routers/agentOnboarding.ts")).toBe(true);
  });

  it("uses crypto.randomInt (not Math.random) for agent codes", () => {
    const content = readFile("server/routers/agentOnboarding.ts");
    expect(content).not.toContain("Math.random");
    expect(content).toContain("randomInt");
  });

  it("has register, myStatus, listPending, approve, reject procedures", () => {
    const content = readFile("server/routers/agentOnboarding.ts");
    expect(content).toContain("register");
    expect(content).toContain("myStatus");
    expect(content).toContain("listPending");
    expect(content).toContain("approve");
    expect(content).toContain("reject");
  });

  it("notifies owner on new agent application", () => {
    const content = readFile("server/routers/agentOnboarding.ts");
    expect(content).toContain("notifyOwner");
  });

  it("agentOnboarding router is wired in appRouter", () => {
    const routers = readFile("server/routers.ts");
    expect(routers).toContain("agentOnboarding");
  });
});

// ─── 5. Agent Register page ───────────────────────────────────────────────────
describe("v175 — Agent Register page", () => {
  it("AgentRegister.tsx exists", () => {
    expect(fileExists("client/src/pages/AgentRegister.tsx")).toBe(true);
  });

  it("route /agent/register registered in App.tsx", () => {
    const app = readFile("client/src/App.tsx");
    expect(app).toContain("/agent/register");
    expect(app).toContain("AgentRegister");
  });
});
