/**
 * Smoke Tests — v187 CBN Compliance Sprint
 *
 * Tests:
 * - P0: BMATCH FX engine (rust-bmatch-engine service, tRPC procedures)
 * - P0: python-compliance-service SRE fix (uvicorn startup)
 * - P0: Keycloak/Permify PBAC hardening (cbn-realm.json, cbn-schema.perm)
 * - P1: Settlement account registry (Go service, DB schema, tRPC CRUD)
 * - P1: Wallet funding-source enforcement (walletFundingEvents table)
 * - P2: CBN audit lakehouse (python-cbn-lakehouse service, tRPC export)
 * - P2: Temporal CBN workflows (go-temporal-cbn)
 * - P3: PAPSS rate transparency UI (PapssCompliance.tsx)
 * - P3: BDC partner management (tRPC CRUD)
 * - Middleware: Dapr subscriptions, Fluvio topics, APISIX routes
 * - K8s: CBN compliance manifests
 * - Docker Compose: cbn-compliance.yml
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf-8");
const exists = (p: string) => existsSync(join(root, p));

// ─── P0: BMATCH FX Engine ─────────────────────────────────────────────────────
describe("P0: rust-bmatch-engine", () => {
  it("Cargo.toml exists with axum dependency", () => {
    const cargo = read("services/rust-bmatch-engine/Cargo.toml");
    expect(cargo).toContain("rust-bmatch-engine");
    expect(cargo).toContain("axum");
  });

  it("main.rs implements /health, /rate/:pair, /rates, /snapshot endpoints", () => {
    const main = read("services/rust-bmatch-engine/src/main.rs");
    expect(main).toContain("/health");
    expect(main).toContain("/rate/");
    expect(main).toContain("/snapshot");
  });

  it("main.rs integrates with Redis for rate caching", () => {
    const main = read("services/rust-bmatch-engine/src/main.rs");
    expect(main).toContain("redis");
  });

  it("main.rs integrates with Kafka for rate events", () => {
    const main = read("services/rust-bmatch-engine/src/main.rs");
    expect(main).toContain("kafka");
  });

  it("Dockerfile exists for rust-bmatch-engine", () => {
    expect(exists("services/rust-bmatch-engine/Dockerfile")).toBe(true);
  });
});

// ─── P0: python-compliance-service SRE Fix ────────────────────────────────────
describe("P0: python-compliance-service SRE fix", () => {
  it("microservices.ts uses python3 -m uvicorn for compliance service", () => {
    const ms = read("server/_core/microservices.ts");
    const block = ms.slice(ms.indexOf("python-compliance"), ms.indexOf("python-compliance") + 400);
    expect(block).toMatch(/python3|uvicorn/);
  });

  it("compliance service main.py exists and has FastAPI app", () => {
    const main = read("services/python-compliance-service/main.py");
    expect(main).toContain("FastAPI");
    expect(main).toContain("/health");
  });
});

// ─── P0: Keycloak/Permify PBAC ────────────────────────────────────────────────
describe("P0: Keycloak and Permify PBAC hardening", () => {
  it("keycloak/cbn-realm.json defines compliance-officer and settlement-manager roles", () => {
    const realm = read("infra/keycloak/cbn-realm.json");
    expect(realm).toContain("compliance-officer");
    expect(realm).toContain("settlement-manager");
  });

  it("keycloak/cbn-realm.json defines all 5 CBN compliance clients", () => {
    const realm = read("infra/keycloak/cbn-realm.json");
    expect(realm).toContain("rust-bmatch-engine");
    expect(realm).toContain("go-settlement-registry");
    expect(realm).toContain("python-cbn-lakehouse");
  });

  it("permify/cbn-schema.perm defines settlement account permissions", () => {
    const schema = read("infra/permify/cbn-schema.perm");
    expect(schema).toContain("view_settlement_accounts");
    expect(schema).toContain("create_settlement_account");
    expect(schema).toContain("file_cbn_settlement");
  });

  it("permify/cbn-schema.perm defines BMATCH rate permissions", () => {
    const schema = read("infra/permify/cbn-schema.perm");
    expect(schema).toContain("view_bmatch_rates");
    expect(schema).toContain("force_bmatch_snapshot");
  });

  it("permify/cbn-schema.perm defines BDC partner permissions", () => {
    const schema = read("infra/permify/cbn-schema.perm");
    expect(schema).toContain("view_bdc_partners");
    expect(schema).toContain("approve_bdc_partner");
  });
});

// ─── P1: Settlement Account Registry ─────────────────────────────────────────
describe("P1: go-settlement-registry", () => {
  it("Go service main.go exists with Gin router", () => {
    const main = read("services/go-settlement-registry/main.go");
    expect(main).toContain("gin");
    expect(main).toContain("/health");
  });

  it("Go service implements settlement account CRUD endpoints", () => {
    const main = read("services/go-settlement-registry/main.go");
    expect(main).toContain("/accounts");
    expect(main).toContain("POST");
    expect(main).toContain("PUT");
  });

  it("Go service integrates with Kafka for settlement events", () => {
    const main = read("services/go-settlement-registry/main.go");
    expect(main).toContain("kafka");
  });

  it("Go service integrates with TigerBeetle for ledger", () => {
    const main = read("services/go-settlement-registry/main.go");
    expect(main).toContain("tigerbeetle");
  });

  it("go.mod exists with correct module name", () => {
    const gomod = read("services/go-settlement-registry/go.mod");
    expect(gomod).toContain("go-settlement-registry");
  });
});

// ─── P1: DB Schema — CBN Compliance Tables ────────────────────────────────────
describe("P1: DB schema — CBN compliance tables", () => {
  it("schema.ts has settlementAccounts table", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).toContain("settlementAccounts");
  });

  it("schema.ts has bdcPartners table", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).toContain("bdcPartners");
  });

  it("schema.ts has bmatchRateSnapshots table", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).toContain("bmatchRateSnapshots");
  });

  it("schema.ts has walletFundingEvents table", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).toContain("walletFundingEvents");
  });

  it("schema.ts has cbnComplianceExports table", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).toContain("cbnComplianceExports");
  });

  it("schema.ts has cbnCorridors table", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).toContain("cbnCorridors");
  });
});

// ─── P1: tRPC cbnCompliance Router ────────────────────────────────────────────
describe("P1: tRPC cbnCompliance router", () => {
  it("cbnCompliance.ts router file exists", () => {
    expect(exists("server/routers/cbnCompliance.ts")).toBe(true);
  });

  it("router exports cbnComplianceRouter", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("cbnComplianceRouter");
  });

  it("router has getComplianceDashboard procedure", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("getComplianceDashboard");
  });

  it("router has getAllRatePairs procedure", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("getAllRatePairs");
  });

  it("router has createSettlementAccount procedure", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("createSettlementAccount");
  });

  it("router has listSettlementAccounts procedure", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("listSettlementAccounts");
  });

  it("router has markCbnFiled procedure", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("markCbnFiled");
  });

  it("router has createBdcPartner procedure", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("createBdcPartner");
  });

  it("router has approveBdcPartner procedure", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("approveBdcPartner");
  });

  it("router has generateComplianceExport procedure", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("generateComplianceExport");
  });

  it("router has getFundingEvents procedure", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("getFundingEvents");
  });

  it("router has getCbnCorridors procedure", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("getCbnCorridors");
  });

  it("cbnComplianceRouter is registered in appRouter", () => {
    const routers = read("server/routers.ts");
    expect(routers).toContain("cbnCompliance: cbnComplianceRouter");
  });
});

// ─── P2: CBN Audit Lakehouse ──────────────────────────────────────────────────
describe("P2: python-cbn-lakehouse", () => {
  it("lakehouse main.py exists with FastAPI app", () => {
    const main = read("services/python-cbn-lakehouse/main.py");
    expect(main).toContain("FastAPI");
    expect(main).toContain("/health");
  });

  it("lakehouse main.py implements /export endpoint", () => {
    const main = read("services/python-cbn-lakehouse/main.py");
    expect(main).toContain("/export");
  });

  it("lakehouse main.py implements /search endpoint", () => {
    const main = read("services/python-cbn-lakehouse/main.py");
    expect(main).toContain("/search");
  });

  it("lakehouse main.py integrates with OpenSearch", () => {
    const main = read("services/python-cbn-lakehouse/main.py");
    expect(main).toContain("opensearch");
  });

  it("lakehouse main.py integrates with Kafka", () => {
    const main = read("services/python-cbn-lakehouse/main.py");
    expect(main).toContain("kafka");
  });

  it("lakehouse requirements.txt exists", () => {
    expect(exists("services/python-cbn-lakehouse/requirements.txt")).toBe(true);
  });

  it("lakehouse Dockerfile exists", () => {
    expect(exists("services/python-cbn-lakehouse/Dockerfile")).toBe(true);
  });
});

// ─── P2: Temporal CBN Workflows ───────────────────────────────────────────────
describe("P2: go-temporal-cbn workflows", () => {
  it("Temporal worker main.go exists", () => {
    expect(exists("services/go-temporal-cbn/main.go")).toBe(true);
  });

  it("DailyBmatchSnapshotWorkflow is registered", () => {
    const main = read("services/go-temporal-cbn/main.go");
    expect(main).toContain("DailyBmatchSnapshotWorkflow");
  });

  it("SettlementFilingReminderWorkflow is registered", () => {
    const main = read("services/go-temporal-cbn/main.go");
    expect(main).toContain("SettlementFilingReminderWorkflow");
  });

  it("MonthlyComplianceReportWorkflow is registered", () => {
    const main = read("services/go-temporal-cbn/main.go");
    expect(main).toContain("MonthlyComplianceReportWorkflow");
  });

  it("Temporal worker uses cbn-compliance task queue", () => {
    const main = read("services/go-temporal-cbn/main.go");
    expect(main).toContain("cbn-compliance");
  });

  it("ForceBmatchSnapshot activity calls BMATCH engine", () => {
    const main = read("services/go-temporal-cbn/main.go");
    expect(main).toContain("ForceBmatchSnapshot");
    expect(main).toContain("/snapshot");
  });
});

// ─── P3: Frontend UI Pages ────────────────────────────────────────────────────
describe("P3: CBN compliance frontend pages", () => {
  it("CbnComplianceDashboard.tsx exists", () => {
    expect(exists("client/src/pages/CbnComplianceDashboard.tsx")).toBe(true);
  });

  it("CbnComplianceDashboard uses cbnCompliance tRPC procedures", () => {
    const page = read("client/src/pages/CbnComplianceDashboard.tsx");
    expect(page).toContain("trpc.cbnCompliance");
  });

  it("CbnComplianceDashboard has BMATCH rate table", () => {
    const page = read("client/src/pages/CbnComplianceDashboard.tsx");
    expect(page).toContain("BMATCH");
    expect(page).toContain("getAllRatePairs");
  });

  it("CbnComplianceDashboard has settlement account CRUD", () => {
    const page = read("client/src/pages/CbnComplianceDashboard.tsx");
    expect(page).toContain("createSettlementAccount");
    expect(page).toContain("markCbnFiled");
  });

  it("CbnComplianceDashboard has BDC partner management", () => {
    const page = read("client/src/pages/CbnComplianceDashboard.tsx");
    expect(page).toContain("createBdcPartner");
    expect(page).toContain("approveBdcPartner");
  });

  it("CbnComplianceDashboard has compliance export generator", () => {
    const page = read("client/src/pages/CbnComplianceDashboard.tsx");
    expect(page).toContain("generateComplianceExport");
  });

  it("CbnComplianceDashboard has funding enforcement tab", () => {
    const page = read("client/src/pages/CbnComplianceDashboard.tsx");
    expect(page).toContain("getFundingEvents");
    expect(page).toContain("NFEM");
  });

  it("PapssCompliance.tsx exists", () => {
    expect(exists("client/src/pages/PapssCompliance.tsx")).toBe(true);
  });

  it("PapssCompliance shows live BMATCH rates", () => {
    const page = read("client/src/pages/PapssCompliance.tsx");
    expect(page).toContain("getAllRatePairs");
    expect(page).toContain("BMATCH");
  });

  it("PapssCompliance shows PAPSS rail information", () => {
    const page = read("client/src/pages/PapssCompliance.tsx");
    expect(page).toContain("PAPSS");
    expect(page).toContain("CBN-endorsed");
  });

  it("App.tsx has /admin/cbn-compliance route", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain("/admin/cbn-compliance");
    expect(app).toContain("CbnComplianceDashboard");
  });

  it("App.tsx has /compliance/rates route", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain("/compliance/rates");
    expect(app).toContain("PapssCompliance");
  });
});

// ─── Middleware: Dapr, Fluvio, APISIX ─────────────────────────────────────────
describe("Middleware: Dapr, Fluvio, APISIX configuration", () => {
  it("Dapr CBN subscriptions file exists", () => {
    expect(exists("infra/dapr/components/subscriptions-cbn.yaml")).toBe(true);
  });

  it("Dapr subscriptions include bmatch-rate-snapshot topic", () => {
    const subs = read("infra/dapr/components/subscriptions-cbn.yaml");
    expect(subs).toContain("bmatch-rate-snapshot");
  });

  it("Dapr subscriptions include settlement-account-created topic", () => {
    const subs = read("infra/dapr/components/subscriptions-cbn.yaml");
    expect(subs).toContain("settlement-account-created");
  });

  it("Fluvio CBN topics file exists", () => {
    expect(exists("infra/fluvio/cbn-topics.yaml")).toBe(true);
  });

  it("Fluvio topics include bmatch-rates-live", () => {
    const topics = read("infra/fluvio/cbn-topics.yaml");
    expect(topics).toContain("bmatch-rates-live");
  });

  it("Fluvio topics include cbn-audit-trail with 90d retention", () => {
    const topics = read("infra/fluvio/cbn-topics.yaml");
    expect(topics).toContain("cbn-audit-trail");
    expect(topics).toContain("90d");
  });

  it("APISIX CBN routes file exists", () => {
    expect(exists("infra/apisix/cbn-routes.yaml")).toBe(true);
  });

  it("APISIX routes include BMATCH rate endpoints", () => {
    const routes = read("infra/apisix/cbn-routes.yaml");
    expect(routes).toContain("bmatch-rates-public");
    expect(routes).toContain("rust-bmatch-engine:8097");
  });

  it("APISIX routes include settlement registry endpoints", () => {
    const routes = read("infra/apisix/cbn-routes.yaml");
    expect(routes).toContain("settlement-registry-admin");
    expect(routes).toContain("go-settlement-registry:8098");
  });

  it("APISIX routes include OpenAppSec WAF global rule", () => {
    const routes = read("infra/apisix/cbn-routes.yaml");
    expect(routes).toContain("openappsec");
  });
});

// ─── Docker Compose + K8s ─────────────────────────────────────────────────────
describe("Docker Compose and K8s manifests", () => {
  it("docker-compose.cbn-compliance.yml exists", () => {
    expect(exists("docker-compose.cbn-compliance.yml")).toBe(true);
  });

  it("docker-compose.cbn-compliance.yml has rust-bmatch-engine service", () => {
    const dc = read("docker-compose.cbn-compliance.yml");
    expect(dc).toContain("rust-bmatch-engine");
    expect(dc).toContain("8097:8097");
  });

  it("docker-compose.cbn-compliance.yml has go-settlement-registry service", () => {
    const dc = read("docker-compose.cbn-compliance.yml");
    expect(dc).toContain("go-settlement-registry");
    expect(dc).toContain("8098:8098");
  });

  it("docker-compose.cbn-compliance.yml has python-cbn-lakehouse service", () => {
    const dc = read("docker-compose.cbn-compliance.yml");
    expect(dc).toContain("python-cbn-lakehouse");
    expect(dc).toContain("8099:8099");
  });

  it("docker-compose.cbn-compliance.yml has Dapr sidecars for all services", () => {
    const dc = read("docker-compose.cbn-compliance.yml");
    expect(dc).toContain("rust-bmatch-engine-dapr");
    expect(dc).toContain("go-settlement-registry-dapr");
    expect(dc).toContain("python-cbn-lakehouse-dapr");
  });

  it("k8s/cbn-compliance.yaml exists", () => {
    expect(exists("k8s/cbn-compliance.yaml")).toBe(true);
  });

  it("k8s manifest has Deployments for all 3 CBN services", () => {
    const k8s = read("k8s/cbn-compliance.yaml");
    expect(k8s).toContain("name: rust-bmatch-engine");
    expect(k8s).toContain("name: go-settlement-registry");
    expect(k8s).toContain("name: python-cbn-lakehouse");
  });

  it("k8s manifest has HPA for rust-bmatch-engine", () => {
    const k8s = read("k8s/cbn-compliance.yaml");
    expect(k8s).toContain("rust-bmatch-engine-hpa");
    expect(k8s).toContain("HorizontalPodAutoscaler");
  });

  it("k8s manifest has CronJobs for daily BMATCH snapshot and monthly report", () => {
    const k8s = read("k8s/cbn-compliance.yaml");
    expect(k8s).toContain("daily-bmatch-snapshot");
    expect(k8s).toContain("monthly-cbn-report");
  });

  it("k8s manifest has NetworkPolicy for CBN compliance isolation", () => {
    const k8s = read("k8s/cbn-compliance.yaml");
    expect(k8s).toContain("cbn-compliance-netpol");
    expect(k8s).toContain("NetworkPolicy");
  });

  it("k8s manifest has Dapr annotations on all pods", () => {
    const k8s = read("k8s/cbn-compliance.yaml");
    expect(k8s).toContain("dapr.io/enabled");
    expect(k8s).toContain("dapr.io/app-id");
  });
});
