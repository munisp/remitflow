/**
 * smoke-v176.test.ts — v176 production-readiness sprint
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");
const readFile = (rel: string) => fs.readFileSync(path.join(root, rel), "utf-8");
const fileExists = (rel: string) => fs.existsSync(path.join(root, rel));

describe("AgentKYBAdmin page", () => {
  it("exists", () => expect(fileExists("client/src/pages/AgentKYBAdmin.tsx")).toBe(true));
  it("calls agentOnboarding", () => expect(readFile("client/src/pages/AgentKYBAdmin.tsx")).toContain("agentOnboarding"));
  it("has approve and reject", () => { const c = readFile("client/src/pages/AgentKYBAdmin.tsx"); expect(c).toContain("approve"); expect(c).toContain("reject"); });
});

describe("SupportTickets page", () => {
  it("exists", () => expect(fileExists("client/src/pages/SupportTickets.tsx")).toBe(true));
  it("calls support", () => expect(readFile("client/src/pages/SupportTickets.tsx")).toContain("support"));
  it("has create and close", () => { const c = readFile("client/src/pages/SupportTickets.tsx"); expect(c).toContain("create"); expect(c).toContain("close"); });
});

describe("DashboardLayout sidebar nav", () => {
  it("has /agent/pos", () => expect(readFile("client/src/components/DashboardLayout.tsx")).toContain("/agent/pos"));
  it("has /transfers", () => expect(readFile("client/src/components/DashboardLayout.tsx")).toContain("/transfers"));
  it("has /support/tickets", () => expect(readFile("client/src/components/DashboardLayout.tsx")).toContain("/support/tickets"));
  it("has /admin/agent-kyb", () => expect(readFile("client/src/components/DashboardLayout.tsx")).toContain("/admin/agent-kyb"));
  it("has /admin/rails-health", () => expect(readFile("client/src/components/DashboardLayout.tsx")).toContain("/admin/rails-health"));
  it("has /send-crypto", () => expect(readFile("client/src/components/DashboardLayout.tsx")).toContain("/send-crypto"));
});

describe("posAgentCashFlow router", () => {
  it("exists", () => expect(fileExists("server/routers/posAgentCashFlow.ts")).toBe(true));
  it("has cashIn", () => expect(readFile("server/routers/posAgentCashFlow.ts")).toContain("cashIn"));
  it("has cashOut", () => expect(readFile("server/routers/posAgentCashFlow.ts")).toContain("cashOut"));
  it("has agentStats", () => expect(readFile("server/routers/posAgentCashFlow.ts")).toContain("agentStats"));
  it("has todayTransactions", () => expect(readFile("server/routers/posAgentCashFlow.ts")).toContain("todayTransactions"));
  it("uses createAuditLog", () => expect(readFile("server/routers/posAgentCashFlow.ts")).toContain("createAuditLog"));
  it("is registered in appRouter", () => expect(readFile("server/routers.ts")).toContain("posAgentCashFlow"));
});

describe("posReceipt router", () => {
  it("exists", () => expect(fileExists("server/routers/posReceipt.ts")).toBe(true));
  it("has generate", () => expect(readFile("server/routers/posReceipt.ts")).toContain("generate"));
  it("is registered in appRouter", () => expect(readFile("server/routers.ts")).toContain("posReceipt"));
});

describe("agentOnboarding router", () => {
  it("exists", () => expect(fileExists("server/routers/agentOnboarding.ts")).toBe(true));
  it("has register procedure", () => expect(readFile("server/routers/agentOnboarding.ts")).toContain("register"));
  it("has listPending", () => expect(readFile("server/routers/agentOnboarding.ts")).toContain("listPending"));
  it("no Math.random", () => expect(readFile("server/routers/agentOnboarding.ts")).not.toContain("Math.random"));
  it("is registered in appRouter", () => expect(readFile("server/routers.ts")).toContain("agentOnboarding"));
});

describe("cryptoCustody dual-approval gate", () => {
  it("no TODO remaining", () => expect(readFile("server/routers/cryptoCustody.ts")).not.toContain("TODO"));
  it("has ASSET_USD_RATES", () => expect(readFile("server/routers/cryptoCustody.ts")).toContain("ASSET_USD_RATES"));
  it("throws FORBIDDEN for high-value", () => { const c = readFile("server/routers/cryptoCustody.ts"); expect(c).toContain("FORBIDDEN"); expect(c).toContain("dual-approval threshold"); });
});

describe("Service Worker v23", () => {
  it("is version v23", () => expect(readFile("client/public/sw.js")).toContain("v23"));
  it("has V176_API_PATTERNS", () => expect(readFile("client/public/sw.js")).toContain("V176_API_PATTERNS"));
  it("caches posAgentCashFlow.agentStats", () => expect(readFile("client/public/sw.js")).toContain("posAgentCashFlow.agentStats"));
  it("caches transfers.list", () => expect(readFile("client/public/sw.js")).toContain("transfers.list"));
  it("caches newRails.railHealth", () => expect(readFile("client/public/sw.js")).toContain("newRails.railHealth"));
});

describe("PWA manifest", () => {
  it("has 9+ shortcuts", () => { const m = JSON.parse(readFile("client/public/manifest.json")); expect(m.shortcuts.length).toBeGreaterThanOrEqual(9); });
  it("has /agent/pos shortcut", () => { const m = JSON.parse(readFile("client/public/manifest.json")); expect(m.shortcuts.map((s: any) => s.url)).toContain("/agent/pos"); });
  it("has /transfers shortcut", () => { const m = JSON.parse(readFile("client/public/manifest.json")); expect(m.shortcuts.map((s: any) => s.url)).toContain("/transfers"); });
  it("has protocol_handlers", () => { const m = JSON.parse(readFile("client/public/manifest.json")); expect(m.protocol_handlers?.length).toBeGreaterThan(0); });
});

describe("New microservice scaffolding", () => {
  it("go-bricspay-adapter has go.mod", () => expect(fileExists("services/go-bricspay-adapter/go.mod")).toBe(true));
  it("go-ghipss-adapter has go.mod", () => expect(fileExists("services/go-ghipss-adapter/go.mod")).toBe(true));
  it("go-papss-service has go.mod", () => expect(fileExists("services/go-papss-service/go.mod")).toBe(true));
  it("rust-mbridge-adapter has Cargo.toml", () => expect(fileExists("services/rust-mbridge-adapter/Cargo.toml")).toBe(true));
  it("go-bricspay-adapter has Dockerfile", () => expect(fileExists("services/go-bricspay-adapter/Dockerfile")).toBe(true));
  it("go-ghipss-adapter has Dockerfile", () => expect(fileExists("services/go-ghipss-adapter/Dockerfile")).toBe(true));
  it("go-papss-service has Dockerfile", () => expect(fileExists("services/go-papss-service/Dockerfile")).toBe(true));
  it("rust-mbridge-adapter has Dockerfile", () => expect(fileExists("services/rust-mbridge-adapter/Dockerfile")).toBe(true));
  it("python-africbdc-adapter has Dockerfile", () => expect(fileExists("services/python-africbdc-adapter/Dockerfile")).toBe(true));
  it("universal-fx has Dockerfile", () => expect(fileExists("services/universal-fx/Dockerfile")).toBe(true));
});

describe("App.tsx routes", () => {
  it("has /agent/pos", () => expect(readFile("client/src/App.tsx")).toContain("/agent/pos"));
  it("has /agent/register", () => expect(readFile("client/src/App.tsx")).toContain("/agent/register"));
  it("has /transfers", () => expect(readFile("client/src/App.tsx")).toContain("/transfers"));
  it("has /support/tickets", () => expect(readFile("client/src/App.tsx")).toContain("/support/tickets"));
  it("has /admin/agent-kyb", () => expect(readFile("client/src/App.tsx")).toContain("/admin/agent-kyb"));
  it("has /send-crypto", () => expect(readFile("client/src/App.tsx")).toContain("/send-crypto"));
  it("has /admin/rails-health", () => expect(readFile("client/src/App.tsx")).toContain("/admin/rails-health"));
});
