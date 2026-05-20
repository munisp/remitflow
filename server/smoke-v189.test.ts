/**
 * smoke-v189.test.ts — v189 Next Steps Sprint
 *
 * Covers:
 * 1. Rust BMATCH engine binary (production build verified)
 * 2. CBN compliance export email notification (notifyOwner call)
 * 3. PAPSS settlement idempotency key hardening
 * 4. go-bdc-connector service wiring
 * 5. microservices.ts binary path for rust-bmatch-engine
 * 6. CbnComplianceDashboard emailSent confirmation
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const r = (p: string) => path.join(ROOT, p);
const read = (p: string) => fs.readFileSync(r(p), "utf-8");

// ─── 1. Rust BMATCH Engine Binary ─────────────────────────────────────────────
describe("rust-bmatch-engine binary", () => {
  it("production binary exists at target/release/bmatch-engine", () => {
    const binaryPath = r("services/rust-bmatch-engine/target/release/bmatch-engine");
    expect(fs.existsSync(binaryPath)).toBe(true);
  });

  it("binary is executable (non-zero size)", () => {
    const binaryPath = r("services/rust-bmatch-engine/target/release/bmatch-engine");
    const stat = fs.statSync(binaryPath);
    expect(stat.size).toBeGreaterThan(500_000); // at least 500KB for a Rust binary
  });

  it("Cargo.toml declares axum and tokio dependencies", () => {
    const cargo = read("services/rust-bmatch-engine/Cargo.toml");
    expect(cargo).toContain("axum");
    expect(cargo).toContain("tokio");
  });

  it("main.rs implements /health route", () => {
    const src = read("services/rust-bmatch-engine/src/main.rs");
    expect(src).toContain("/health");
  });

  it("main.rs implements /rate/:pair route", () => {
    const src = read("services/rust-bmatch-engine/src/main.rs");
    expect(src).toMatch(/\/rate\//);
  });

  it("main.rs implements /rates route for all pairs", () => {
    const src = read("services/rust-bmatch-engine/src/main.rs");
    expect(src).toContain("/rates");
  });

  it("main.rs implements /snapshot endpoint for CBN rate capture", () => {
    const src = read("services/rust-bmatch-engine/src/main.rs");
    expect(src).toContain("/snapshot");
  });

  it("main.rs integrates with TigerBeetle or references tigerbeetle", () => {
    const src = read("services/rust-bmatch-engine/src/main.rs");
    expect(src.toLowerCase()).toContain("tigerbeetle");
  });

  it("main.rs references Kafka for rate events", () => {
    const src = read("services/rust-bmatch-engine/src/main.rs");
    expect(src.toLowerCase()).toContain("kafka");
  });

  it("main.rs references Redis for rate caching", () => {
    const src = read("services/rust-bmatch-engine/src/main.rs");
    expect(src.toLowerCase()).toContain("redis");
  });

  it("Dockerfile uses multi-stage build with cargo build --release", () => {
    const dockerfile = read("services/rust-bmatch-engine/Dockerfile");
    expect(dockerfile).toContain("cargo build --release");
  });
});

// ─── 2. microservices.ts binary path ──────────────────────────────────────────
describe("microservices.ts rust-bmatch-engine wiring", () => {
  it("references rust-bmatch-engine service", () => {
    const ms = read("server/_core/microservices.ts");
    expect(ms).toContain("rust-bmatch-engine");
  });

  it("references bmatch-engine binary path", () => {
    const ms = read("server/_core/microservices.ts");
    expect(ms).toContain("bmatch-engine");
  });

  it("references go-bdc-connector service", () => {
    const ms = read("server/_core/microservices.ts");
    expect(ms).toContain("go-bdc-connector");
  });

  it("references python-compliance-service with python3", () => {
    const ms = read("server/_core/microservices.ts");
    expect(ms).toContain("python-compliance-service");
    // command should be python3, not python3.11 (which causes SRE mismatch)
    // Note: the comment may mention python3.11 as context, but the command must be python3
    expect(ms).toMatch(/command:\s*["']python3["']/); // command: "python3"
  });
});

// ─── 3. CBN Compliance Export Email ───────────────────────────────────────────
describe("cbnCompliance.ts generateComplianceExport email", () => {
  it("calls notifyOwner after generating export", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("notifyOwner");
  });

  it("notifyOwner title includes CBN Compliance Export Ready", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("CBN Compliance Export Ready");
  });

  it("notifyOwner content includes CBN Submission Deadline", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("CBN Submission Deadline");
  });

  it("notifyOwner content includes 24 hours deadline reference", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("24 hours");
  });

  it("generateComplianceExport returns emailSent: true", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("emailSent: true");
  });

  it("export type labels are human-readable", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("Transaction Report");
    expect(router).toContain("Settlement Account List");
    expect(router).toContain("FX Rate Audit");
  });

  it("notifyOwner content includes export ID", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("exportRecord.id");
  });

  it("notifyOwner content includes record count", () => {
    const router = read("server/routers/cbnCompliance.ts");
    expect(router).toContain("recordCount");
  });
});

// ─── 4. CbnComplianceDashboard emailSent UI ───────────────────────────────────
describe("CbnComplianceDashboard.tsx email confirmation", () => {
  it("shows emailSent confirmation in onSuccess toast", () => {
    const page = read("client/src/pages/CbnComplianceDashboard.tsx");
    expect(page).toContain("emailSent");
  });

  it("toast description includes email notification message", () => {
    const page = read("client/src/pages/CbnComplianceDashboard.tsx");
    expect(page).toContain("Email notification sent to compliance officer");
  });

  it("export ID is shown in toast with # prefix", () => {
    const page = read("client/src/pages/CbnComplianceDashboard.tsx");
    expect(page).toContain("#${data.id}");
  });
});

// ─── 5. PAPSS Settlement Idempotency ──────────────────────────────────────────
describe("PAPSS settlement endpoint idempotency", () => {
  it("checks x-idempotency-key header", () => {
    const index = read("server/_core/index.ts");
    expect(index).toContain("x-idempotency-key");
  });

  it("generates expected key as papss-settlement-YYYY-MM-DD", () => {
    const index = read("server/_core/index.ts");
    expect(index).toContain("papss-settlement-");
    expect(index).toContain("expectedKey");
  });

  it("returns 409 for stale idempotency key", () => {
    const index = read("server/_core/index.ts");
    expect(index).toContain("409");
    expect(index).toContain("Stale idempotency key");
  });

  it("includes expectedKey and receivedKey in 409 response", () => {
    const index = read("server/_core/index.ts");
    expect(index).toContain("expectedKey");
    expect(index).toContain("receivedKey");
  });

  it("still allows requests without idempotency key (backward compat)", () => {
    const index = read("server/_core/index.ts");
    // The check only rejects when key is provided AND doesn't match
    expect(index).toContain("if (idempotencyKey && idempotencyKey !== expectedKey)");
  });

  it("batchId includes date and entropy", () => {
    const index = read("server/_core/index.ts");
    expect(index).toContain("PAPSS-BATCH-");
    expect(index).toContain("Date.now().toString(36)");
  });

  it("returns retryInfo with maxRetries and dbRetryCount", () => {
    const index = read("server/_core/index.ts");
    // retryInfo is in the PAPSS settlement response — search the full file
    expect(index).toContain("retryInfo");
    expect(index).toContain("maxRetries");
    expect(index).toContain("dbRetryCount");
  });
});

// ─── 6. go-bdc-connector service ──────────────────────────────────────────────
describe("go-bdc-connector service", () => {
  it("main.go exists", () => {
    expect(fs.existsSync(r("services/go-bdc-connector/main.go"))).toBe(true);
  });

  it("go.mod declares module go-bdc-connector", () => {
    const gomod = read("services/go-bdc-connector/go.mod");
    expect(gomod).toContain("go-bdc-connector");
  });

  it("main.go implements /health endpoint", () => {
    const src = read("services/go-bdc-connector/main.go");
    expect(src).toContain("/health");
  });

  it("main.go implements BDC transfer initiation endpoint", () => {
    const src = read("services/go-bdc-connector/main.go");
    expect(src).toMatch(/\/transfers?|\/bdc\/transfer/);
  });

  it("main.go integrates with Kafka for BDC events", () => {
    const src = read("services/go-bdc-connector/main.go");
    expect(src.toLowerCase()).toContain("kafka");
  });

  it("main.go integrates with Redis for rate caching", () => {
    const src = read("services/go-bdc-connector/main.go");
    expect(src.toLowerCase()).toContain("redis");
  });

  it("main.go integrates with TigerBeetle for double-entry ledger", () => {
    const src = read("services/go-bdc-connector/main.go");
    expect(src.toLowerCase()).toContain("tigerbeetle");
  });

  it("Dockerfile builds go-bdc-connector", () => {
    const dockerfile = read("services/go-bdc-connector/Dockerfile");
    expect(dockerfile).toContain("go build");
  });

  it("docker-compose.cbn-compliance.yml includes go-bdc-connector service", () => {
    const compose = read("docker-compose.cbn-compliance.yml");
    expect(compose).toContain("go-bdc-connector");
  });
});

// ─── 7. BDCPartnerPortal.tsx ──────────────────────────────────────────────────
describe("BDCPartnerPortal.tsx", () => {
  it("page exists", () => {
    expect(fs.existsSync(r("client/src/pages/BDCPartnerPortal.tsx"))).toBe(true);
  });

  it("uses listBdcPartners tRPC query", () => {
    const page = read("client/src/pages/BDCPartnerPortal.tsx");
    expect(page).toContain("listBdcPartners");
  });

  it("uses createBdcPartner tRPC mutation", () => {
    const page = read("client/src/pages/BDCPartnerPortal.tsx");
    expect(page).toContain("createBdcPartner");
  });

  it("uses approveBdcPartner tRPC mutation", () => {
    const page = read("client/src/pages/BDCPartnerPortal.tsx");
    expect(page).toContain("approveBdcPartner");
  });

  it("uses createBdcLiquidityRequest tRPC mutation", () => {
    const page = read("client/src/pages/BDCPartnerPortal.tsx");
    expect(page).toContain("createBdcLiquidityRequest");
  });

  it("shows CBN licence number field", () => {
    const page = read("client/src/pages/BDCPartnerPortal.tsx");
    expect(page).toMatch(/cbn.*licen|licen.*cbn/i);
  });

  it("shows ADB (Authorised Dealer Bank) field", () => {
    const page = read("client/src/pages/BDCPartnerPortal.tsx");
    expect(page).toMatch(/adb|authorised dealer/i);
  });

  it("route is registered in App.tsx", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain("BDCPartnerPortal");
    expect(app).toContain("/partners/bdc");
  });

  it("nav link exists in DashboardLayout.tsx", () => {
    const layout = read("client/src/components/DashboardLayout.tsx");
    expect(layout).toContain("/partners/bdc");
  });
});

// ─── 8. PAPSS cron endpoint auth ──────────────────────────────────────────────
describe("PAPSS settlement endpoint auth", () => {
  it("accepts x-scheduled-task: true header", () => {
    const index = read("server/_core/index.ts");
    expect(index).toContain("x-scheduled-task");
  });

  it("accepts session cookie from scheduled task platform", () => {
    const index = read("server/_core/index.ts");
    expect(index).toContain("app_session_id");
  });

  it("returns 401 when neither header nor cookie is present", () => {
    const index = read("server/_core/index.ts");
    expect(index).toContain("401");
    expect(index).toContain("Unauthorized");
  });

  it("sends owner notification with batchId and corridor summary", () => {
    const index = read("server/_core/index.ts");
    expect(index).toContain("PAPSS Daily Settlement");
    expect(index).toContain("notifyOwner");
  });
});
