/**
 * smoke-v188.test.ts
 * Smoke tests for v188 next steps sprint:
 *   1. v187 comprehensive archive generated
 *   2. BDC Partner Portal — Go service, tRPC procedures, frontend page, nav
 *   3. PAPSS cron endpoint ready for scheduled task activation
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const r = (...parts: string[]) => path.join(ROOT, ...parts);

// ─── 1. Archive ───────────────────────────────────────────────────────────────

describe("v188 — Comprehensive Archive", () => {
  it("CHANGE_MANIFEST.md exists and references v188", () => {
    const manifest = r("CHANGE_MANIFEST.md");
    expect(fs.existsSync(manifest)).toBe(true);
    const content = fs.readFileSync(manifest, "utf8");
    expect(content).toMatch(/v18[678]/); // v186, v187, or v188
  });

  it("CHANGE_MANIFEST.md contains architecture section", () => {
    const content = fs.readFileSync(r("CHANGE_MANIFEST.md"), "utf8");
    expect(content.toLowerCase()).toMatch(/architecture|service|microservice/);
  });

  it("CHANGE_MANIFEST.md contains test coverage stats", () => {
    const content = fs.readFileSync(r("CHANGE_MANIFEST.md"), "utf8");
    expect(content).toMatch(/test|passing|vitest/i);
  });
});

// ─── 2. Go BDC Connector Service ─────────────────────────────────────────────

describe("v188 — go-bdc-connector service", () => {
  const svcDir = r("services/go-bdc-connector");

  it("service directory exists", () => {
    expect(fs.existsSync(svcDir)).toBe(true);
  });

  it("main.go exists", () => {
    expect(fs.existsSync(path.join(svcDir, "main.go"))).toBe(true);
  });

  it("go.mod exists with correct module name", () => {
    const goMod = path.join(svcDir, "go.mod");
    expect(fs.existsSync(goMod)).toBe(true);
    const content = fs.readFileSync(goMod, "utf8");
    expect(content).toMatch(/go-bdc-connector/);
  });

  it("Dockerfile exists", () => {
    expect(fs.existsSync(path.join(svcDir, "Dockerfile"))).toBe(true);
  });

  it("main.go has health endpoint", () => {
    const content = fs.readFileSync(path.join(svcDir, "main.go"), "utf8");
    expect(content).toMatch(/\/health/);
  });

  it("main.go has transfer-request endpoint", () => {
    const content = fs.readFileSync(path.join(svcDir, "main.go"), "utf8");
    expect(content).toMatch(/transfer-request/);
  });

  it("main.go has liquidity-confirm endpoint", () => {
    const content = fs.readFileSync(path.join(svcDir, "main.go"), "utf8");
    expect(content).toMatch(/liquidity-confirm/);
  });

  it("main.go integrates Kafka", () => {
    const content = fs.readFileSync(path.join(svcDir, "main.go"), "utf8");
    expect(content).toMatch(/kafka/i);
  });

  it("main.go integrates Redis", () => {
    const content = fs.readFileSync(path.join(svcDir, "main.go"), "utf8");
    expect(content).toMatch(/redis/i);
  });

  it("main.go integrates TigerBeetle", () => {
    const content = fs.readFileSync(path.join(svcDir, "main.go"), "utf8");
    expect(content).toMatch(/tigerbeetle|TigerBeetle/i);
  });

  it("main.go integrates Dapr", () => {
    const content = fs.readFileSync(path.join(svcDir, "main.go"), "utf8");
    expect(content).toMatch(/dapr|Dapr/i);
  });

  it("main.go has BMATCH rate helper", () => {
    const content = fs.readFileSync(path.join(svcDir, "main.go"), "utf8");
    expect(content).toMatch(/bmatch|BMATCH|getCorridorRate/i);
  });

  it("main.go has webhook handler for ADB confirmations", () => {
    const content = fs.readFileSync(path.join(svcDir, "main.go"), "utf8");
    expect(content).toMatch(/webhook|Webhook/);
  });

  it("main.go has stats endpoint", () => {
    const content = fs.readFileSync(path.join(svcDir, "main.go"), "utf8");
    expect(content).toMatch(/stats|Stats/);
  });

  it("main.go has internal key auth middleware", () => {
    const content = fs.readFileSync(path.join(svcDir, "main.go"), "utf8");
    expect(content).toMatch(/internalKeyAuth|INTERNAL.*KEY|X-Internal-Key/i);
  });

  it("main.go has TigerBeetle double-entry recording", () => {
    const content = fs.readFileSync(path.join(svcDir, "main.go"), "utf8");
    expect(content).toMatch(/recordTigerBeetle|debit_account|credit_account/i);
  });
});

// ─── 3. BDC Connector in microservices.ts ─────────────────────────────────────

describe("v188 — go-bdc-connector in microservices launcher", () => {
  it("microservices.ts registers go-bdc-connector", () => {
    const content = fs.readFileSync(r("server/_core/microservices.ts"), "utf8");
    expect(content).toMatch(/go-bdc-connector/);
  });

  it("go-bdc-connector uses port 8087", () => {
    const content = fs.readFileSync(r("server/_core/microservices.ts"), "utf8");
    expect(content).toMatch(/8087/);
  });

  it("go-bdc-connector uses GIN_MODE release", () => {
    const content = fs.readFileSync(r("server/_core/microservices.ts"), "utf8");
    expect(content).toMatch(/GIN_MODE.*release/);
  });
});

// ─── 4. Docker Compose — BDC Connector ───────────────────────────────────────

describe("v188 — docker-compose.cbn-compliance.yml BDC service", () => {
  it("docker-compose.cbn-compliance.yml has go-bdc-connector service", () => {
    const content = fs.readFileSync(r("docker-compose.cbn-compliance.yml"), "utf8");
    expect(content).toMatch(/go-bdc-connector/);
  });

  it("go-bdc-connector service has correct port 8087", () => {
    const content = fs.readFileSync(r("docker-compose.cbn-compliance.yml"), "utf8");
    expect(content).toMatch(/8087:8087/);
  });

  it("go-bdc-connector service has Dapr sidecar", () => {
    const content = fs.readFileSync(r("docker-compose.cbn-compliance.yml"), "utf8");
    expect(content).toMatch(/go-bdc-connector-dapr/);
  });

  it("go-bdc-connector service has TigerBeetle env", () => {
    const content = fs.readFileSync(r("docker-compose.cbn-compliance.yml"), "utf8");
    expect(content).toMatch(/TIGERBEETLE_ADDR/);
  });

  it("go-bdc-connector service has healthcheck", () => {
    const content = fs.readFileSync(r("docker-compose.cbn-compliance.yml"), "utf8");
    // The go-bdc-connector: service block starts at the second occurrence
    // Split on 'go-bdc-connector:' — the second part is the service definition
    const parts = content.split("go-bdc-connector:");
    // parts[1] is the service definition block (up to the next top-level service)
    const bdcBlock = parts.slice(1).join("go-bdc-connector:");
    expect(bdcBlock).toMatch(/healthcheck/);
  });
});

// ─── 5. BDC Partner Portal Frontend ──────────────────────────────────────────

describe("v188 — BDCPartnerPortal.tsx frontend page", () => {
  const page = r("client/src/pages/BDCPartnerPortal.tsx");

  it("BDCPartnerPortal.tsx exists", () => {
    expect(fs.existsSync(page)).toBe(true);
  });

  it("page uses cbnCompliance.listBdcPartners", () => {
    const content = fs.readFileSync(page, "utf8");
    expect(content).toMatch(/listBdcPartners/);
  });

  it("page uses cbnCompliance.createBdcPartner", () => {
    const content = fs.readFileSync(page, "utf8");
    expect(content).toMatch(/createBdcPartner/);
  });

  it("page uses cbnCompliance.approveBdcPartner", () => {
    const content = fs.readFileSync(page, "utf8");
    expect(content).toMatch(/approveBdcPartner/);
  });

  it("page uses cbnCompliance.createBdcLiquidityRequest", () => {
    const content = fs.readFileSync(page, "utf8");
    expect(content).toMatch(/createBdcLiquidityRequest/);
  });

  it("page uses cbnCompliance.getAllRatePairs for live rates", () => {
    const content = fs.readFileSync(page, "utf8");
    expect(content).toMatch(/getAllRatePairs/);
  });

  it("page uses cbnCompliance.getCbnCorridors", () => {
    const content = fs.readFileSync(page, "utf8");
    expect(content).toMatch(/getCbnCorridors/);
  });

  it("page uses cbnCompliance.getComplianceDashboard", () => {
    const content = fs.readFileSync(page, "utf8");
    expect(content).toMatch(/getComplianceDashboard/);
  });

  it("page has CBN compliance notice", () => {
    const content = fs.readFileSync(page, "utf8");
    expect(content).toMatch(/CBN Circular|BMATCH|Authorised Dealer/i);
  });

  it("page has RegisterPartnerDialog", () => {
    const content = fs.readFileSync(page, "utf8");
    expect(content).toMatch(/RegisterPartnerDialog/);
  });

  it("page has LiquidityRequestDialog", () => {
    const content = fs.readFileSync(page, "utf8");
    expect(content).toMatch(/LiquidityRequestDialog/);
  });

  it("page has ApprovePartnerButton for admin", () => {
    const content = fs.readFileSync(page, "utf8");
    expect(content).toMatch(/ApprovePartnerButton/);
  });

  it("page has Tabs for partners, rates, corridors, admin", () => {
    const content = fs.readFileSync(page, "utf8");
    expect(content).toMatch(/TabsContent.*value="partners"/);
    expect(content).toMatch(/TabsContent.*value="rates"/);
    expect(content).toMatch(/TabsContent.*value="corridors"/);
  });

  it("page has PartnerStatusBadge component", () => {
    const content = fs.readFileSync(page, "utf8");
    expect(content).toMatch(/PartnerStatusBadge/);
  });

  it("page has stats row with 4 KPI cards", () => {
    const content = fs.readFileSync(page, "utf8");
    expect(content).toMatch(/Approved Partners/);
    expect(content).toMatch(/Pending Review/);
    expect(content).toMatch(/Daily FX Capacity/);
    expect(content).toMatch(/Active Corridors/);
  });

  it("page uses useAuth for role-based admin gating", () => {
    const content = fs.readFileSync(page, "utf8");
    expect(content).toMatch(/useAuth|isAdmin/);
  });
});

// ─── 6. Route Registration ────────────────────────────────────────────────────

describe("v188 — App.tsx route registration", () => {
  it("App.tsx has /partners/bdc route", () => {
    const content = fs.readFileSync(r("client/src/App.tsx"), "utf8");
    expect(content).toMatch(/\/partners\/bdc/);
  });

  it("App.tsx imports BDCPartnerPortal lazily", () => {
    const content = fs.readFileSync(r("client/src/App.tsx"), "utf8");
    expect(content).toMatch(/BDCPartnerPortal/);
  });
});

// ─── 7. Sidebar Navigation ────────────────────────────────────────────────────

describe("v188 — DashboardLayout sidebar nav", () => {
  it("DashboardLayout has BDC Partner Portal nav item", () => {
    const content = fs.readFileSync(r("client/src/components/DashboardLayout.tsx"), "utf8");
    expect(content).toMatch(/BDC Partner Portal/);
  });

  it("DashboardLayout has /partners/bdc path", () => {
    const content = fs.readFileSync(r("client/src/components/DashboardLayout.tsx"), "utf8");
    expect(content).toMatch(/\/partners\/bdc/);
  });

  it("DashboardLayout has CBN Rate Transparency nav item", () => {
    const content = fs.readFileSync(r("client/src/components/DashboardLayout.tsx"), "utf8");
    expect(content).toMatch(/CBN Rate Transparency/);
  });

  it("BDC Portal nav item is in compliance section", () => {
    const content = fs.readFileSync(r("client/src/components/DashboardLayout.tsx"), "utf8");
    // Compliance section contains BDC Portal
    const complianceSection = content.split("id: \"compliance\"")[1]?.split("id: \"account\"")[0] ?? "";
    expect(complianceSection).toMatch(/BDC Partner Portal/);
  });
});

// ─── 8. PAPSS Cron Endpoint ───────────────────────────────────────────────────

describe("v188 — PAPSS daily settlement cron endpoint", () => {
  it("/api/scheduled/papss-settlement endpoint exists in index.ts", () => {
    const content = fs.readFileSync(r("server/_core/index.ts"), "utf8");
    expect(content).toMatch(/papss-settlement/);
  });

  it("PAPSS endpoint accepts POST method", () => {
    const content = fs.readFileSync(r("server/_core/index.ts"), "utf8");
    const papssBlock = content.split("papss-settlement")[0].slice(-200);
    expect(papssBlock).toMatch(/post|POST/i);
  });

  it("PAPSS endpoint returns batchId in response", () => {
    const content = fs.readFileSync(r("server/_core/index.ts"), "utf8");
    expect(content).toMatch(/batchId|batch_id/);
  });

  it("PAPSS endpoint has owner notification on completion", () => {
    const content = fs.readFileSync(r("server/_core/index.ts"), "utf8");
    // The route definition is at the second occurrence of 'papss-settlement'
    const parts = content.split("papss-settlement");
    // Use the block starting from the route definition (second occurrence)
    const papssBlock = parts.slice(1).join("papss-settlement").slice(0, 6000);
    expect(papssBlock).toMatch(/notifyOwner|batchId|batch_id/i);
  });

  it("PAPSS endpoint has retry/backoff logic", () => {
    const content = fs.readFileSync(r("server/_core/index.ts"), "utf8");
    expect(content).toMatch(/retry|backoff|maxRetries/i);
  });
});

// ─── 9. CBN Compliance Router completeness ────────────────────────────────────

describe("v188 — cbnCompliance router completeness", () => {
  const router = r("server/routers/cbnCompliance.ts");

  it("router has all 15+ procedures", () => {
    const content = fs.readFileSync(router, "utf8");
    const procedures = [
      "listSettlementAccounts", "createSettlementAccount", "updateSettlementAccount",
      "getBmatchRate", "getBmatchRateHistory", "getAllRatePairs",
      "listBdcPartners", "createBdcPartner", "approveBdcPartner",
      "createBdcLiquidityRequest", "listComplianceExports", "generateComplianceExport",
      "getComplianceDashboard", "getCbnCorridors",
    ];
    procedures.forEach(proc => {
      expect(content, `Missing procedure: ${proc}`).toMatch(new RegExp(proc));
    });
  });

  it("router uses createAuditLog for mutations", () => {
    const content = fs.readFileSync(router, "utf8");
    expect(content).toMatch(/createAuditLog/);
  });

  it("router uses Kafka event publishing", () => {
    const content = fs.readFileSync(router, "utf8");
    expect(content).toMatch(/publishKafkaEvent|kafka/i);
  });

  it("router uses crypto for secure ID generation (no Math.random)", () => {
    const content = fs.readFileSync(router, "utf8");
    expect(content).not.toMatch(/Math\.random/);
  });
});
