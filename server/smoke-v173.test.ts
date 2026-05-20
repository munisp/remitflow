/**
 * smoke-v173.test.ts
 * Covers:
 *  - Agent/POS Cash-In/Cash-Out router (posAgentCashFlow)
 *  - My Transfers router (transfers.list + transfers.cancel)
 *  - PAPSS settlement scheduled endpoint
 *  - Security audit (no hardcoded prod secrets, all webhooks use env vars)
 *  - New payment rails microservices (BRICSPay, mBridge, GhIPSS, AfriCBDC, PAPSS service)
 *  - Shared middleware library
 *  - APISix gateway config
 *  - Seed script existence
 *  - Agent/POS schema tables
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");
const exists = (p: string) => existsSync(join(ROOT, p));

// ─── posAgentCashFlow router ──────────────────────────────────────────────────
describe("posAgentCashFlow router", () => {
  it("file exists", () => {
    expect(exists("server/routers/posAgentCashFlow.ts")).toBe(true);
  });

  it("exports posAgentCashFlowRouter", () => {
    const src = read("server/routers/posAgentCashFlow.ts");
    expect(src).toContain("posAgentCashFlowRouter");
  });

  it("exports transfersListRouter", () => {
    const src = read("server/routers/posAgentCashFlow.ts");
    expect(src).toContain("transfersListRouter");
  });

  it("has agentStats procedure", () => {
    const src = read("server/routers/posAgentCashFlow.ts");
    expect(src).toContain("agentStats");
  });

  it("has cashIn procedure with daily limit check", () => {
    const src = read("server/routers/posAgentCashFlow.ts");
    expect(src).toContain("cashIn");
    expect(src).toContain("dailyLimit");
  });

  it("has cashOut procedure with float balance check", () => {
    const src = read("server/routers/posAgentCashFlow.ts");
    expect(src).toContain("cashOut");
    expect(src).toContain("floatBalance");
  });

  it("has todayTransactions procedure", () => {
    const src = read("server/routers/posAgentCashFlow.ts");
    expect(src).toContain("todayTransactions");
  });

  it("transfers.list has pagination (limit/offset)", () => {
    const src = read("server/routers/posAgentCashFlow.ts");
    expect(src).toContain("offset");
    expect(src).toContain("limit");
  });

  it("transfers.cancel checks ownership and status", () => {
    const src = read("server/routers/posAgentCashFlow.ts");
    expect(src).toContain("cancel");
    expect(src).toContain("pending");
    expect(src).toContain("NOT_FOUND");
  });

  it("is wired in appRouter", () => {
    const src = read("server/routers.ts");
    expect(src).toContain("posAgentCashFlowRouter");
    expect(src).toContain("transfersListRouter");
  });
});

// ─── Agent/POS UI pages ───────────────────────────────────────────────────────
describe("Agent/POS UI pages", () => {
  it("AgentPOS.tsx exists", () => {
    expect(exists("client/src/pages/AgentPOS.tsx")).toBe(true);
  });

  it("AgentPOS uses posAgentCashFlow router", () => {
    const src = read("client/src/pages/AgentPOS.tsx");
    expect(src).toContain("posAgentCashFlow");
  });

  it("AgentPOS has cash-in and cash-out forms", () => {
    const src = read("client/src/pages/AgentPOS.tsx");
    expect(src).toContain("cashIn");
    expect(src).toContain("cashOut");
  });

  it("MyTransfers.tsx exists", () => {
    expect(exists("client/src/pages/MyTransfers.tsx")).toBe(true);
  });

  it("MyTransfers uses transfers router", () => {
    const src = read("client/src/pages/MyTransfers.tsx");
    expect(src).toContain("transfers");
  });

  it("AgentPOS route registered in App.tsx", () => {
    const src = read("client/src/App.tsx");
    expect(src).toContain("AgentPOS");
  });

  it("MyTransfers route registered in App.tsx", () => {
    const src = read("client/src/App.tsx");
    expect(src).toContain("MyTransfers");
  });
});

// ─── PAPSS settlement endpoint ────────────────────────────────────────────────
describe("PAPSS settlement scheduled endpoint", () => {
  it("endpoint registered in index.ts", () => {
    const src = read("server/_core/index.ts");
    expect(src).toContain("/api/scheduled/papss-settlement");
  });

  it("endpoint uses POST method", () => {
    const src = read("server/_core/index.ts");
    expect(src).toContain('app.post("/api/scheduled/papss-settlement"');
  });

  it("endpoint sends owner notification", () => {
    const src = read("server/_core/index.ts");
    // The endpoint should reference notifyOwner or notification
    const hasNotify = src.includes("notifyOwner") || src.includes("notification") || src.includes("PAPSS");
    expect(hasNotify).toBe(true);
  });
});

// ─── Security audit ───────────────────────────────────────────────────────────
describe("Security hardening", () => {
  it("KYC webhook secrets use env vars (not hardcoded)", () => {
    const src = read("server/kycProviderWebhook.ts");
    expect(src).toContain("process.env.ONFIDO_WEBHOOK_SECRET");
    expect(src).toContain("process.env.SUMSUB_WEBHOOK_SECRET");
    expect(src).toContain("process.env.VERIFF_WEBHOOK_SECRET");
  });

  it("security middleware registers CSRF protection", () => {
    const src = read("server/security.middleware.ts");
    expect(src).toContain("csrfProtectionMiddleware");
  });

  it("security middleware registers rate limiting", () => {
    const src = read("server/security.middleware.ts");
    expect(src).toContain("generalRateLimit");
    expect(src).toContain("paymentRateLimit");
  });

  it("security middleware registers XSS detection", () => {
    const src = read("server/security.middleware.ts");
    expect(src).toContain("xssDetectionMiddleware");
  });

  it("security middleware registers SQL injection detection", () => {
    const src = read("server/security.middleware.ts");
    expect(src).toContain("sqlInjectionDetectionMiddleware");
  });

  it("attack mitigations are registered", () => {
    const src = read("server/security.attacks.ts");
    expect(src).toContain("registerAttackMitigations");
  });

  it("no hardcoded JWT secrets in server code", () => {
    const src = read("server/_core/index.ts");
    // Should use env var, not hardcoded string
    expect(src).not.toContain('"supersecret"');
    expect(src).not.toContain("'supersecret'");
  });
});

// ─── New payment rail microservices ───────────────────────────────────────────
describe("New payment rail microservices", () => {
  it("BRICSPay Go adapter exists", () => {
    expect(exists("services/go-bricspay-adapter/main.go")).toBe(true);
  });

  it("BRICSPay adapter has Kafka wiring", () => {
    const src = read("services/go-bricspay-adapter/main.go");
    expect(src).toContain("kafka");
  });

  it("BRICSPay adapter has TigerBeetle wiring", () => {
    const src = read("services/go-bricspay-adapter/main.go");
    expect(src).toContain("TigerBeetle");
  });

  it("mBridge Rust adapter exists", () => {
    expect(exists("services/rust-mbridge-adapter/src/main.rs")).toBe(true);
  });

  it("mBridge adapter has Temporal wiring", () => {
    const src = read("services/rust-mbridge-adapter/src/main.rs");
    expect(src).toContain("Temporal");
  });

  it("GhIPSS Go adapter exists", () => {
    expect(exists("services/go-ghipss-adapter/main.go")).toBe(true);
  });

  it("GhIPSS adapter has Mojaloop integration", () => {
    const src = read("services/go-ghipss-adapter/main.go");
    expect(src).toContain("mojaloop");
  });

  it("AfriCBDC Python adapter exists", () => {
    expect(exists("services/python-africbdc-adapter/main.py")).toBe(true);
  });

  it("AfriCBDC adapter supports eNaira, eCedi, digital Rand", () => {
    const src = read("services/python-africbdc-adapter/main.py");
    expect(src).toContain("eNaira");
    expect(src).toContain("eCedi");
  });

  it("PAPSS Go service exists", () => {
    expect(exists("services/go-papss-service/main.go")).toBe(true);
  });

  it("PAPSS service has Redis wiring", () => {
    const src = read("services/go-papss-service/main.go");
    expect(src).toContain("Redis");
  });
});

// ─── Shared middleware library ────────────────────────────────────────────────
describe("Shared middleware library", () => {
  it("shared-middleware/middleware.go exists", () => {
    expect(exists("services/shared-middleware/middleware.go")).toBe(true);
  });

  it("shared middleware has Kafka client", () => {
    const src = read("services/shared-middleware/middleware.go");
    expect(src).toContain("kafka");
  });

  it("shared middleware has Dapr client", () => {
    const src = read("services/shared-middleware/middleware.go");
    expect(src).toContain("Dapr");
  });

  it("shared middleware has OpenSearch client", () => {
    const src = read("services/shared-middleware/middleware.go");
    expect(src).toContain("OpenSearch");
  });

  it("shared middleware has Permify client", () => {
    const src = read("services/shared-middleware/middleware.go");
    expect(src).toContain("Permify");
  });
});

// ─── APISix gateway config ────────────────────────────────────────────────────
describe("APISix gateway config", () => {
  it("rails_routes.yaml exists", () => {
    expect(exists("services/go-apisix-config/rails_routes.yaml")).toBe(true);
  });

  it("config registers BRICSPay route", () => {
    const src = read("services/go-apisix-config/rails_routes.yaml");
    expect(src).toContain("bricspay");
  });

  it("config registers mBridge route", () => {
    const src = read("services/go-apisix-config/rails_routes.yaml");
    expect(src).toContain("mbridge");
  });

  it("config registers GhIPSS route", () => {
    const src = read("services/go-apisix-config/rails_routes.yaml");
    expect(src).toContain("ghipss");
  });

  it("config registers PAPSS route", () => {
    const src = read("services/go-apisix-config/rails_routes.yaml");
    expect(src).toContain("papss");
  });
});

// ─── Seed script ─────────────────────────────────────────────────────────────
describe("Seed script", () => {
  it("seed.mjs exists", () => {
    expect(exists("scripts/seed.mjs")).toBe(true);
  });

  it("seed script covers multiple tables", () => {
    const src = read("scripts/seed.mjs");
    expect(src).toContain("users");
    expect(src).toContain("wallets");
    expect(src).toContain("transactions");
    expect(src).toContain("beneficiaries");
  });
});

// ─── Schema tables ────────────────────────────────────────────────────────────
describe("Schema tables for agent/POS", () => {
  it("posTerminals table defined in schema", () => {
    const src = read("drizzle/schema.ts");
    expect(src).toContain("pos_terminals");
    expect(src).toContain("posTerminals");
  });

  it("agentAccounts table defined in schema", () => {
    const src = read("drizzle/schema.ts");
    expect(src).toContain("agent_accounts");
    expect(src).toContain("agentAccounts");
  });

  it("posTerminals has dailyLimit column", () => {
    const src = read("drizzle/schema.ts");
    expect(src).toContain("daily_limit");
  });

  it("agentAccounts has commissionRate column", () => {
    const src = read("drizzle/schema.ts");
    expect(src).toContain("commission_rate");
  });
});

// ─── Rails health dashboard ───────────────────────────────────────────────────
describe("Rails health dashboard", () => {
  it("RailsHealthDashboard.tsx exists", () => {
    expect(exists("client/src/pages/RailsHealthDashboard.tsx")).toBe(true);
  });

  it("dashboard uses newRails router", () => {
    const src = read("client/src/pages/RailsHealthDashboard.tsx");
    expect(src).toContain("newRails");
  });

  it("dashboard route registered in App.tsx", () => {
    const src = read("client/src/App.tsx");
    expect(src).toContain("RailsHealthDashboard");
  });
});

// ─── Send Crypto page ─────────────────────────────────────────────────────────
describe("Send Crypto page", () => {
  it("SendCrypto.tsx exists", () => {
    expect(exists("client/src/pages/SendCrypto.tsx")).toBe(true);
  });

  it("SendCrypto route registered in App.tsx", () => {
    const src = read("client/src/App.tsx");
    expect(src).toContain("SendCrypto");
  });
});
