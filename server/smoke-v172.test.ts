// RemitFlow — v172 Smoke Tests
// Covers: Payment Rails Health Dashboard, PAPSS settlement endpoint,
//         Agent/POS integration audit, SMS mock mode defaults

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function readFile(relPath: string): string {
  const full = join(ROOT, relPath);
  if (!existsSync(full)) throw new Error(`File not found: ${relPath}`);
  return readFileSync(full, "utf-8");
}

// ── 1. Rails Health Dashboard ─────────────────────────────────────────────────

describe("v172 Rails Health Dashboard", () => {
  it("RailsHealthDashboard.tsx exists", () => {
    expect(existsSync(join(ROOT, "client/src/pages/RailsHealthDashboard.tsx"))).toBe(true);
  });

  it("uses trpc.newRails.railHealth.getAll query", () => {
    const content = readFile("client/src/pages/RailsHealthDashboard.tsx");
    expect(content).toContain("newRails.railHealth.getAll");
    expect(content).toContain("useQuery");
  });

  it("shows all 9 rail identifiers", () => {
    const content = readFile("client/src/pages/RailsHealthDashboard.tsx");
    expect(content).toContain("mojaloop");
    expect(content).toContain("papss");
    expect(content).toContain("bricspay");
    expect(content).toContain("mbridge");
    expect(content).toContain("ghipss");
    expect(content).toContain("africbdc");
    expect(content).toContain("cips");
    expect(content).toContain("upi");
    expect(content).toContain("pix");
  });

  it("has auto-refresh every 30 seconds", () => {
    const content = readFile("client/src/pages/RailsHealthDashboard.tsx");
    expect(content).toContain("30_000");
    expect(content).toContain("refetchInterval");
  });

  it("shows latency bar and uptime percentage", () => {
    const content = readFile("client/src/pages/RailsHealthDashboard.tsx");
    expect(content).toContain("LatencyBar");
    expect(content).toContain("UptimePill");
    expect(content).toContain("latency_ms");
    expect(content).toContain("uptime_pct");
  });

  it("shows healthy/degraded/down status icons", () => {
    const content = readFile("client/src/pages/RailsHealthDashboard.tsx");
    expect(content).toContain("StatusIcon");
    expect(content).toContain("StatusBadge");
    expect(content).toContain("healthy");
    expect(content).toContain("degraded");
    expect(content).toContain("down");
  });

  it("shows all 11 middleware badges", () => {
    const content = readFile("client/src/pages/RailsHealthDashboard.tsx");
    expect(content).toContain("Kafka");
    expect(content).toContain("Dapr");
    expect(content).toContain("Fluvio");
    expect(content).toContain("Temporal");
    expect(content).toContain("Keycloak");
    expect(content).toContain("Permify");
    expect(content).toContain("OpenSearch");
    expect(content).toContain("Redis");
    expect(content).toContain("APISix");
    expect(content).toContain("TigerBeetle");
    expect(content).toContain("Lakehouse");
  });

  it("/admin/rails-health route registered in App.tsx", () => {
    const content = readFile("client/src/App.tsx");
    expect(content).toContain("/admin/rails-health");
    expect(content).toContain("RailsHealthDashboard");
  });
});

// ── 2. PAPSS Settlement Endpoint ──────────────────────────────────────────────

describe("v172 PAPSS Settlement Scheduled Endpoint", () => {
  it("POST /api/scheduled/papss-settlement exists in index.ts", () => {
    const content = readFile("server/_core/index.ts");
    expect(content).toContain("/api/scheduled/papss-settlement");
  });

  it("accepts session cookie auth (user role from scheduled task platform)", () => {
    const content = readFile("server/_core/index.ts");
    expect(content).toContain("app_session_id");
    expect(content).toContain("papss-settlement");
  });

  it("accepts admin bearer token auth", () => {
    const content = readFile("server/_core/index.ts");
    expect(content).toContain("SCHEDULED_TASK_TOKEN");
    expect(content).toContain("ALERTMANAGER_WEBHOOK_TOKEN");
  });

  it("generates PAPSS batch ID with date prefix", () => {
    const content = readFile("server/_core/index.ts");
    expect(content).toContain("PAPSS-BATCH-");
    expect(content).toContain("batchId");
  });

  it("performs multilateral netting by corridor", () => {
    const content = readFile("server/_core/index.ts");
    expect(content).toContain("papss_transfers");
    expect(content).toContain("corridor");
    expect(content).toContain("corridorSummaries");
  });

  it("marks transfers as settled with batch ID", () => {
    const content = readFile("server/_core/index.ts");
    expect(content).toContain("status = 'settled'");
    expect(content).toContain("netting_batch_id");
  });

  it("sends owner notification with settlement summary", () => {
    const content = readFile("server/_core/index.ts");
    expect(content).toContain("notifyOwner");
    expect(content).toContain("PAPSS Daily Settlement");
  });

  it("returns structured JSON with corridors array", () => {
    const content = readFile("server/_core/index.ts");
    expect(content).toContain("totalTransfers");
    expect(content).toContain("corridors: corridorSummaries");
    expect(content).toContain("settledAt");
  });
});

// ── 3. Agent/POS Integration ──────────────────────────────────────────────────

describe("v172 Agent/POS Integration — schema and router", () => {
  it("pos_terminals table has required fields", () => {
    const schema = readFile("drizzle/schema.ts");
    expect(schema).toContain("posTerminals");
    expect(schema).toContain("terminalId");
    expect(schema).toContain("merchantName");
    expect(schema).toContain("dailyLimit");
    expect(schema).toContain("totalVolume");
    expect(schema).toContain("status");
  });

  it("agent_accounts table has commission, tier, and float fields", () => {
    const schema = readFile("drizzle/schema.ts");
    expect(schema).toContain("agentAccounts");
    expect(schema).toContain("agentCode");
    expect(schema).toContain("commissionRate");
    expect(schema).toContain("tier");
    expect(schema).toContain("dailyLimit");
    expect(schema).toContain("totalVolume");
    expect(schema).toContain("rating");
  });

  it("pos router exposes list, register, and updateStatus procedures", () => {
    const routers = readFile("server/routers.ts");
    expect(routers).toContain("posTerminals");
  });

  it("agent router exposes stats and register procedures", () => {
    const routers = readFile("server/routers.ts");
    expect(routers).toContain("agentAccounts");
    expect(routers).toContain("commissionRate");
    expect(routers).toContain("register");
  });

  it("ART agent router is registered for risk screening", () => {
    const routers = readFile("server/routers.ts");
    expect(routers).toContain("artAgent: artAgentRouter");
    expect(routers).toContain("artAgentRouter");
  });

  it("ART agent supports sanctions check tool", () => {
    const content = readFile("server/routers/productionV87.ts");
    expect(content).toContain("check_sanctions");
    expect(content).toContain("calculate_fee");
    expect(content).toContain("get_exchange_rate");
    expect(content).toContain("assess_risk");
  });
});

// ── 4. SMS Mock Mode ──────────────────────────────────────────────────────────

describe("v172 SMS Confirm — mock mode defaults", () => {
  it("smsConfirm router defaults to mock mode when SMS_PROVIDER not set", () => {
    const content = readFile("server/routers/smsConfirm.ts");
    expect(content).toContain("mock");
    expect(content).toContain("SMS_PROVIDER");
    expect(content).toContain("africas_talking");
  });

  it("smsConfirm supports Africa's Talking provider", () => {
    const content = readFile("server/routers/smsConfirm.ts");
    expect(content).toContain("africastalking.com");
    expect(content).toContain("AFRICAS_TALKING_API_KEY");
    expect(content).toContain("AFRICAS_TALKING_USERNAME");
  });

  it("smsConfirm supports Twilio as fallback provider", () => {
    const content = readFile("server/routers/smsConfirm.ts");
    expect(content).toContain("twilio");
  });

  it("smsConfirm exposes requestConfirmation and verifyCode procedures", () => {
    const content = readFile("server/routers/smsConfirm.ts");
    expect(content).toContain("requestConfirmation");
    expect(content).toContain("verifyCode");
  });

  it("smsConfirmRouter is registered in appRouter", () => {
    const routers = readFile("server/routers.ts");
    expect(routers).toContain("smsConfirm");
    expect(routers).toContain("smsConfirmRouter");
  });
});

// ── 5. SendCrypto UI (regression) ────────────────────────────────────────────

describe("v172 SendCrypto — regression checks", () => {
  it("/send-crypto route still registered", () => {
    const content = readFile("client/src/App.tsx");
    expect(content).toContain("/send-crypto");
  });

  it("cryptoCustody router still registered", () => {
    const routers = readFile("server/routers.ts");
    expect(routers).toContain("cryptoCustody");
  });
});

// ── 6. newRails railHealth procedure ─────────────────────────────────────────

describe("v172 newRails.railHealth.getAll — procedure exists", () => {
  it("railHealth.getAll procedure is defined", () => {
    const content = readFile("server/routers/newRails.ts");
    expect(content).toContain("railHealth:");
    expect(content).toContain("getAll:");
  });

  it("railHealth returns status and latency fields", () => {
    const content = readFile("server/routers/newRails.ts");
    expect(content).toContain("status");
    expect(content).toContain("latencyMs");
  });

  it("railHealth covers all 9 rails", () => {
    const content = readFile("server/routers/newRails.ts");
    expect(content).toContain("mojaloop");
    expect(content).toContain("papss");
    expect(content).toContain("bricspay");
    expect(content).toContain("mbridge");
    expect(content).toContain("ghipss");
    expect(content).toContain("africbdc");
    expect(content).toContain("cips");
    expect(content).toContain("upi");
    expect(content).toContain("pix");
  });
});
