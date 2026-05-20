/**
 * smoke-v190.test.ts
 *
 * Smoke tests for v190:
 * 1. BDC partner onboarding email (Keycloak credentials + APISIX gateway URL)
 * 2. CBN rate transparency page — 30s auto-refresh, manual refresh button
 * 3. PAPSS daily cron — endpoint idempotency + scheduled task prompt
 * 4. BDC partner portal UI — approval status + credential download
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const CBN_ROUTER = path.join(ROOT, "server/routers/cbnCompliance.ts");
const PAPSS_PAGE = path.join(ROOT, "client/src/pages/PapssCompliance.tsx");
const BDC_PORTAL = path.join(ROOT, "client/src/pages/BDCPartnerPortal.tsx");
const INDEX_TS = path.join(ROOT, "server/_core/index.ts");

// ─── 1. BDC Onboarding Email ─────────────────────────────────────────────────
describe("BDC Partner Onboarding Email", () => {
  it("approveBdcPartner generates a Keycloak client ID from CBN licence number", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner"));
    expect(block.slice(0, 3000)).toContain("keycloakClientId");
    expect(block.slice(0, 3000)).toContain("cbnLicenceNumber");
  });

  it("approveBdcPartner generates a cryptographically random temporary password", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner"));
    expect(block.slice(0, 3000)).toContain("crypto.randomBytes");
    expect(block.slice(0, 3000)).toContain("tempPassword");
  });

  it("approveBdcPartner sends notifyOwner with Keycloak credentials section", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner"));
    expect(block.slice(0, 3000)).toContain("ONBOARDING CREDENTIALS");
    expect(block.slice(0, 3000)).toContain("Keycloak Client ID");
    expect(block.slice(0, 3000)).toContain("Temporary Password");
  });

  it("approveBdcPartner includes APISIX gateway URL in the onboarding email", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner"));
    expect(block.slice(0, 3000)).toContain("APISIX Gateway URL");
    expect(block.slice(0, 3000)).toContain("apisixGatewayUrl");
  });

  it("approveBdcPartner includes NEXT STEPS section in the onboarding email", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner"));
    expect(block.slice(0, 3000)).toContain("NEXT STEPS");
    expect(block.slice(0, 3000)).toContain("OAuth2 token");
  });

  it("approveBdcPartner publishes a bdc-partner-approved Kafka event", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner"));
    expect(block.slice(0, 7000)).toContain("bdc-partner-approved");
    expect(block.slice(0, 7000)).toContain("publishKafkaEvent");
  });

  it("approveBdcPartner returns onboardingCredentials object with all required fields", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner"));
    expect(block.slice(0, 7000)).toContain("onboardingCredentials");
    expect(block.slice(0, 7000)).toContain("keycloakRealmUrl");
    expect(block.slice(0, 7000)).toContain("apiBasePath");
    expect(block.slice(0, 7000)).toContain("temporaryPassword");
  });

  it("approveBdcPartner uses KEYCLOAK_REALM_URL env with fallback", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner"));
    expect(block.slice(0, 3000)).toContain("KEYCLOAK_REALM_URL");
    expect(block.slice(0, 3000)).toContain("auth.remitflow.com");
  });

  it("approveBdcPartner uses APISIX_GATEWAY_URL env with fallback", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner"));
    expect(block.slice(0, 3000)).toContain("APISIX_GATEWAY_URL");
    expect(block.slice(0, 3000)).toContain("gateway.remitflow.com");
  });

  it("approveBdcPartner includes approval timestamp in the email", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("approveBdcPartner"));
    expect(block.slice(0, 3000)).toContain("Approval timestamp");
    expect(block.slice(0, 3000)).toContain("toISOString");
  });
});

// ─── 2. CBN Rate Transparency Page ───────────────────────────────────────────
describe("CBN Rate Transparency Page — Live BMATCH", () => {
  it("PapssCompliance.tsx uses trpc.cbnCompliance.getAllRatePairs.useQuery", () => {
    const content = fs.readFileSync(PAPSS_PAGE, "utf8");
    expect(content).toContain("cbnCompliance.getAllRatePairs.useQuery");
  });

  it("PapssCompliance.tsx auto-refreshes every 30 seconds", () => {
    const content = fs.readFileSync(PAPSS_PAGE, "utf8");
    expect(content).toContain("refetchInterval: 30000");
  });

  it("PapssCompliance.tsx has a manual refresh button with handleManualRefresh", () => {
    const content = fs.readFileSync(PAPSS_PAGE, "utf8");
    expect(content).toContain("handleManualRefresh");
    expect(content).toContain("onClick={handleManualRefresh}");
  });

  it("PapssCompliance.tsx shows a spinning RefreshCw icon while fetching", () => {
    const content = fs.readFileSync(PAPSS_PAGE, "utf8");
    expect(content).toContain("animate-spin");
    expect(content).toContain("isFetching");
  });

  it("PapssCompliance.tsx shows last-updated timestamp", () => {
    const content = fs.readFileSync(PAPSS_PAGE, "utf8");
    expect(content).toContain("lastRefreshed");
    expect(content).toContain("toLocaleTimeString");
  });

  it("PapssCompliance.tsx invalidates both rate pairs and corridors on manual refresh", () => {
    const content = fs.readFileSync(PAPSS_PAGE, "utf8");
    expect(content).toContain("getAllRatePairs.invalidate");
    expect(content).toContain("getCbnCorridors.invalidate");
  });

  it("PapssCompliance.tsx renders a rate table with BMATCH mid rate column", () => {
    const content = fs.readFileSync(PAPSS_PAGE, "utf8");
    expect(content).toContain("midRate");
    expect(content).toContain("platformRate");
    expect(content).toContain("spreadBps");
  });

  it("PapssCompliance.tsx shows CBN limit compliance badge per rate", () => {
    const content = fs.readFileSync(PAPSS_PAGE, "utf8");
    expect(content).toContain("withinCbnLimit");
  });

  it("PapssCompliance.tsx uses useCallback for handleManualRefresh (stable reference)", () => {
    const content = fs.readFileSync(PAPSS_PAGE, "utf8");
    expect(content).toContain("useCallback");
  });

  it("PapssCompliance.tsx shows 'auto-refresh every 30s' in the card description", () => {
    const content = fs.readFileSync(PAPSS_PAGE, "utf8");
    expect(content).toContain("auto-refresh every 30s");
  });
});

// ─── 3. PAPSS Daily Cron Endpoint ────────────────────────────────────────────
describe("PAPSS Daily Settlement Cron Endpoint", () => {
  it("index.ts has /api/scheduled/papss-settlement POST endpoint", () => {
    const content = fs.readFileSync(INDEX_TS, "utf8");
    expect(content).toContain("/api/scheduled/papss-settlement");
    expect(content).toContain("app.post");
  });

  it("PAPSS endpoint checks x-scheduled-task header for auth", () => {
    const content = fs.readFileSync(INDEX_TS, "utf8");
    const block = content.slice(content.indexOf("/api/scheduled/papss-settlement"));
    expect(block.slice(0, 4000)).toContain("x-scheduled-task");
  });

  it("PAPSS endpoint implements idempotency key to prevent duplicate batches", () => {
    const content = fs.readFileSync(INDEX_TS, "utf8");
    const block = content.slice(content.indexOf("/api/scheduled/papss-settlement"));
    expect(block.slice(0, 4000)).toContain("idempotency");
    expect(block.slice(0, 4000)).toContain("papss-settlement-");
  });

  it("PAPSS endpoint returns batchId in the response", () => {
    const content = fs.readFileSync(INDEX_TS, "utf8");
    const block = content.slice(content.indexOf("/api/scheduled/papss-settlement"));
    expect(block.slice(0, 6000)).toContain("batchId");
  });

  it("PAPSS endpoint returns totalTransfers in the response", () => {
    const content = fs.readFileSync(INDEX_TS, "utf8");
    const block = content.slice(content.indexOf("/api/scheduled/papss-settlement"));
    expect(block.slice(0, 6000)).toContain("totalTransfers");
  });

  it("PAPSS endpoint returns retryInfo for exponential backoff", () => {
    const content = fs.readFileSync(INDEX_TS, "utf8");
    const block = content.slice(content.indexOf("/api/scheduled/papss-settlement"));
    expect(block.slice(0, 6500)).toContain("retryInfo");
  });

  it("PAPSS endpoint notifies owner on settlement completion", () => {
    const content = fs.readFileSync(INDEX_TS, "utf8");
    const block = content.slice(content.indexOf("/api/scheduled/papss-settlement"));
    expect(block.slice(0, 6500)).toContain("notifyOwner");
  });
});

// ─── 4. BDC Partner Portal UI ────────────────────────────────────────────────
describe("BDC Partner Portal UI", () => {
  it("BDCPartnerPortal.tsx exists", () => {
    expect(fs.existsSync(BDC_PORTAL)).toBe(true);
  });

  it("BDCPartnerPortal.tsx uses listBdcPartners tRPC query", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("listBdcPartners");
  });

  it("BDCPartnerPortal.tsx uses createBdcPartner tRPC mutation", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("createBdcPartner");
  });

  it("BDCPartnerPortal.tsx uses approveBdcPartner tRPC mutation", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("approveBdcPartner");
  });

  it("BDCPartnerPortal.tsx shows partner status badges", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("status");
    expect(content).toContain("Badge");
  });

  it("BDCPartnerPortal.tsx shows CBN licence number field", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("cbnLicenceNumber");
  });

  it("BDCPartnerPortal.tsx shows liquidity request section", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("createBdcLiquidityRequest");
  });

  it("BDCPartnerPortal.tsx shows onboarding credentials after approval", () => {
    const content = fs.readFileSync(BDC_PORTAL, "utf8");
    expect(content).toContain("onboardingCredentials");
  });

  it("BDCPartnerPortal.tsx is registered in App.tsx", () => {
    const appContent = fs.readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8");
    expect(appContent).toContain("BDCPartnerPortal");
    expect(appContent).toContain("/partners/bdc");
  });

  it("BDC portal nav link exists in DashboardLayout", () => {
    const layout = fs.readFileSync(
      path.join(ROOT, "client/src/components/DashboardLayout.tsx"),
      "utf8"
    );
    expect(layout).toContain("/partners/bdc");
  });
});

// ─── 5. go-bdc-connector Service ─────────────────────────────────────────────
describe("go-bdc-connector Service", () => {
  it("go-bdc-connector main.go exists", () => {
    expect(fs.existsSync(path.join(ROOT, "services/go-bdc-connector/main.go"))).toBe(true);
  });

  it("go-bdc-connector has /health endpoint", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "services/go-bdc-connector/main.go"),
      "utf8"
    );
    expect(content).toContain("/health");
  });

  it("go-bdc-connector integrates with Kafka", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "services/go-bdc-connector/main.go"),
      "utf8"
    );
    expect(content).toContain("kafka");
  });

  it("go-bdc-connector integrates with Redis", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "services/go-bdc-connector/main.go"),
      "utf8"
    );
    expect(content).toContain("redis");
  });

  it("go-bdc-connector integrates with TigerBeetle", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "services/go-bdc-connector/main.go"),
      "utf8"
    );
    expect(content).toContain("TigerBeetle");
  });

  it("go-bdc-connector has Dockerfile", () => {
    expect(fs.existsSync(path.join(ROOT, "services/go-bdc-connector/Dockerfile"))).toBe(true);
  });

  it("go-bdc-connector is in docker-compose.cbn-compliance.yml", () => {
    const content = fs.readFileSync(
      path.join(ROOT, "docker-compose.cbn-compliance.yml"),
      "utf8"
    );
    expect(content).toContain("go-bdc-connector");
  });
});

// ─── 6. Compliance Email Integration ─────────────────────────────────────────
describe("Compliance Export Email", () => {
  it("generateComplianceExport sends notifyOwner with report details", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("generateComplianceExport"));
    expect(block.slice(0, 3000)).toContain("notifyOwner");
  });

  it("generateComplianceExport includes 24-hour CBN window in email", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("generateComplianceExport"));
    expect(block.slice(0, 3000)).toContain("24");
  });

  it("generateComplianceExport uses createAuditLog for compliance tracking", () => {
    const content = fs.readFileSync(CBN_ROUTER, "utf8");
    const block = content.slice(content.indexOf("generateComplianceExport"));
    expect(block.slice(0, 4000)).toContain("createAuditLog");
  });
});
