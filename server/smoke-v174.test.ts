/**
 * smoke-v174.test.ts
 * Smoke tests for v174:
 *   - Agent Onboarding router (register, myStatus, listPending, approve, reject)
 *   - POS Receipt router (generate)
 *   - useResilientSSE hook (file existence + key exports)
 *   - ConnectionQualityIndicator component (file existence)
 *   - ServicesHealthDashboard WebSocket → SSE migration
 *   - ComplianceAlerts SSE resilience (exponential backoff + polling fallback)
 *   - posAgentCashFlow router (agentStats, cashIn, cashOut)
 *   - transfersList router (list, cancel)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function readFile(rel: string) {
  return readFileSync(join(ROOT, rel), "utf-8");
}

function fileExists(rel: string) {
  return existsSync(join(ROOT, rel));
}

// ── Agent Onboarding ─────────────────────────────────────────────────────────
describe("v174 — Agent Onboarding Router", () => {
  it("agentOnboarding.ts exists", () => {
    expect(fileExists("server/routers/agentOnboarding.ts")).toBe(true);
  });

  it("exports agentOnboardingRouter", () => {
    const content = readFile("server/routers/agentOnboarding.ts");
    expect(content).toContain("agentOnboardingRouter");
  });

  it("has register procedure", () => {
    const content = readFile("server/routers/agentOnboarding.ts");
    expect(content).toContain("register:");
  });

  it("has myStatus procedure", () => {
    const content = readFile("server/routers/agentOnboarding.ts");
    expect(content).toContain("myStatus:");
  });

  it("has listPending procedure", () => {
    const content = readFile("server/routers/agentOnboarding.ts");
    expect(content).toContain("listPending:");
  });

  it("has approve and reject procedures", () => {
    const content = readFile("server/routers/agentOnboarding.ts");
    expect(content).toContain("approve:");
    expect(content).toContain("reject:");
  });

  it("generates agent code with country prefix", () => {
    const content = readFile("server/routers/agentOnboarding.ts");
    expect(content).toContain("AGT-");
    expect(content).toContain("agentCode");
  });

  it("sends owner notification on registration", () => {
    const content = readFile("server/routers/agentOnboarding.ts");
    expect(content).toContain("notifyOwner");
  });

  it("has createAuditLog marker for middleware coverage", () => {
    const content = readFile("server/routers/agentOnboarding.ts");
    expect(content).toContain("createAuditLog");
  });

  it("is wired into appRouter", () => {
    const content = readFile("server/routers.ts");
    expect(content).toContain("agentOnboardingRouter");
    expect(content).toContain("agentOnboarding:");
  });

  it("AgentRegister page exists", () => {
    expect(fileExists("client/src/pages/AgentRegister.tsx")).toBe(true);
  });

  it("AgentRegister page has tRPC call", () => {
    const content = readFile("client/src/pages/AgentRegister.tsx");
    expect(content).toContain("trpc.");
  });

  it("AgentRegister route registered in App.tsx", () => {
    const content = readFile("client/src/App.tsx");
    expect(content).toContain("AgentRegister");
    expect(content).toContain("/agent/register");
  });
});

// ── POS Receipt ──────────────────────────────────────────────────────────────
describe("v174 — POS Receipt Router", () => {
  it("posReceipt.ts exists", () => {
    expect(fileExists("server/routers/posReceipt.ts")).toBe(true);
  });

  it("exports posReceiptRouter", () => {
    const content = readFile("server/routers/posReceipt.ts");
    expect(content).toContain("posReceiptRouter");
  });

  it("has generate procedure", () => {
    const content = readFile("server/routers/posReceipt.ts");
    expect(content).toContain("generate:");
  });

  it("returns base64-encoded HTML receipt", () => {
    const content = readFile("server/routers/posReceipt.ts");
    expect(content).toContain("base64");
    expect(content).toContain("receiptHtml");
  });

  it("includes REMITFLOW branding in receipt template", () => {
    const content = readFile("server/routers/posReceipt.ts");
    expect(content).toContain("REMITFLOW");
  });

  it("supports cash_in and cash_out types", () => {
    const content = readFile("server/routers/posReceipt.ts");
    expect(content).toContain("cash_in");
    expect(content).toContain("cash_out");
  });

  it("has createAuditLog marker for middleware coverage", () => {
    const content = readFile("server/routers/posReceipt.ts");
    expect(content).toContain("createAuditLog");
  });

  it("is wired into appRouter", () => {
    const content = readFile("server/routers.ts");
    expect(content).toContain("posReceiptRouter");
    expect(content).toContain("posReceipt:");
  });
});

// ── Offline/Low-Bandwidth Resilience ─────────────────────────────────────────
describe("v174 — useResilientSSE Hook", () => {
  it("useResilientSSE.ts exists", () => {
    expect(fileExists("client/src/hooks/useResilientSSE.ts")).toBe(true);
  });

  it("exports useResilientSSE function", () => {
    const content = readFile("client/src/hooks/useResilientSSE.ts");
    expect(content).toContain("export function useResilientSSE");
  });

  it("implements exponential backoff", () => {
    const content = readFile("client/src/hooks/useResilientSSE.ts");
    expect(content).toContain("Math.pow");
    expect(content).toContain("backoff");
  });

  it("has polling fallback mode", () => {
    const content = readFile("client/src/hooks/useResilientSSE.ts");
    expect(content).toContain("polling");
    expect(content).toContain("startPolling");
  });

  it("has heartbeat timeout detection", () => {
    const content = readFile("client/src/hooks/useResilientSSE.ts");
    expect(content).toContain("heartbeat");
    expect(content).toContain("45_000");
  });

  it("upgrades back to SSE on navigator.online", () => {
    const content = readFile("client/src/hooks/useResilientSSE.ts");
    expect(content).toContain("handleOnline");
    expect(content).toContain("online");
  });

  it("exports SSEStatus type", () => {
    const content = readFile("client/src/hooks/useResilientSSE.ts");
    expect(content).toContain("SSEStatus");
  });
});

describe("v174 — ConnectionQualityIndicator Component", () => {
  it("ConnectionQualityIndicator.tsx exists", () => {
    expect(fileExists("client/src/components/ConnectionQualityIndicator.tsx")).toBe(true);
  });

  it("exports ConnectionQualityIndicator", () => {
    const content = readFile("client/src/components/ConnectionQualityIndicator.tsx");
    expect(content).toContain("ConnectionQualityIndicator");
  });

  it("supports good/fair/poor/offline quality states", () => {
    const content = readFile("client/src/components/ConnectionQualityIndicator.tsx");
    expect(content).toContain("good");
    expect(content).toContain("fair");
    expect(content).toContain("poor");
    expect(content).toContain("offline");
  });

  it("measures RTT via fetch ping", () => {
    const content = readFile("client/src/components/ConnectionQualityIndicator.tsx");
    expect(content).toContain("measureRtt");
    expect(content).toContain("/api/health");
  });

  it("uses Network Information API", () => {
    const content = readFile("client/src/components/ConnectionQualityIndicator.tsx");
    expect(content).toContain("effectiveType");
  });
});

describe("v174 — ServicesHealthDashboard WebSocket → SSE Migration", () => {
  it("ServicesHealthDashboard no longer uses WebSocket", () => {
    const content = readFile("client/src/pages/ServicesHealthDashboard.tsx");
    expect(content).not.toContain("new WebSocket(");
  });

  it("uses EventSource (SSE) instead", () => {
    const content = readFile("client/src/pages/ServicesHealthDashboard.tsx");
    expect(content).toContain("new EventSource(");
  });

  it("has exponential backoff on SSE error", () => {
    const content = readFile("client/src/pages/ServicesHealthDashboard.tsx");
    expect(content).toContain("Math.pow");
  });

  it("has polling fallback", () => {
    const content = readFile("client/src/pages/ServicesHealthDashboard.tsx");
    expect(content).toContain("startPolling");
    expect(content).toContain("polling");
  });

  it("has heartbeat timeout", () => {
    const content = readFile("client/src/pages/ServicesHealthDashboard.tsx");
    expect(content).toContain("45_000");
  });

  it("shows SSE transport label in UI", () => {
    const content = readFile("client/src/pages/ServicesHealthDashboard.tsx");
    expect(content).toContain("SSE");
  });
});

describe("v174 — ComplianceAlerts SSE Resilience", () => {
  it("ComplianceAlerts has exponential backoff", () => {
    const content = readFile("client/src/pages/ComplianceAlerts.tsx");
    expect(content).toContain("Math.pow");
  });

  it("ComplianceAlerts has polling fallback", () => {
    const content = readFile("client/src/pages/ComplianceAlerts.tsx");
    expect(content).toContain("startPolling");
  });

  it("ComplianceAlerts has heartbeat timeout", () => {
    const content = readFile("client/src/pages/ComplianceAlerts.tsx");
    expect(content).toContain("45_000");
  });

  it("ComplianceAlerts upgrades back to SSE on online event", () => {
    const content = readFile("client/src/pages/ComplianceAlerts.tsx");
    expect(content).toContain("handleOnline");
  });
});

// ── POS Agent Cash Flow ───────────────────────────────────────────────────────
describe("v174 — posAgentCashFlow Router", () => {
  it("posAgentCashFlow.ts exists", () => {
    expect(fileExists("server/routers/posAgentCashFlow.ts")).toBe(true);
  });

  it("has agentStats procedure", () => {
    const content = readFile("server/routers/posAgentCashFlow.ts");
    expect(content).toContain("agentStats");
  });

  it("has cashIn procedure", () => {
    const content = readFile("server/routers/posAgentCashFlow.ts");
    expect(content).toContain("cashIn");
  });

  it("has cashOut procedure", () => {
    const content = readFile("server/routers/posAgentCashFlow.ts");
    expect(content).toContain("cashOut");
  });

  it("is wired into appRouter", () => {
    const content = readFile("server/routers.ts");
    expect(content).toContain("posAgentCashFlow");
  });
});

// ── Transfers List ────────────────────────────────────────────────────────────
describe("v174 — Transfers List Router", () => {
  it("transfersList router is wired", () => {
    const content = readFile("server/routers.ts");
    expect(content).toContain("transfersList");
  });
});
