/**
 * smoke-v197.test.ts
 * Smoke tests for v197 polyglot microservices and outbound revenue capture features.
 * Covers: Go outbound-swift, Rust float-income, Python revenue-analytics,
 *         TypeScript outbound tRPC router, and 6 new frontend pages.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Helper ────────────────────────────────────────────────────────────────
function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}
function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

const ROOT = path.resolve(__dirname, "..");
const SERVICES = path.join(ROOT, "services");
const PAGES = path.join(ROOT, "client/src/pages");
const ROUTERS = path.join(ROOT, "server/routers");

// ─── Go: outbound-swift service ────────────────────────────────────────────
describe("Go outbound-swift microservice", () => {
  const goDir = path.join(SERVICES, "outbound-swift");

  it("go.mod exists with correct module name", () => {
    expect(exists(path.join(goDir, "go.mod"))).toBe(true);
    const mod = read(path.join(goDir, "go.mod"));
    expect(mod).toContain("remitflow/outbound-swift");
  });

  it("main.go defines SubmitRequest struct", () => {
    expect(exists(path.join(goDir, "main.go"))).toBe(true);
    const src = read(path.join(goDir, "main.go"));
    expect(src).toContain("SubmitRequest");
  });

  it("main.go defines fee schedule with segments", () => {
    const src = read(path.join(goDir, "main.go"));
    expect(src).toContain("feeSchedule");
    expect(src).toContain("labor");
    expect(src).toContain("education");
    expect(src).toContain("medical");
  });

  it("main.go has /quote endpoint", () => {
    const src = read(path.join(goDir, "main.go"));
    expect(src).toContain("/quote");
  });

  it("main.go has /submit endpoint", () => {
    const src = read(path.join(goDir, "main.go"));
    expect(src).toContain("/submit");
  });

  it("main.go has /fee-schedule endpoint", () => {
    const src = read(path.join(goDir, "main.go"));
    expect(src).toContain("/fee-schedule");
  });

  it("main.go has SWIFT reference generation", () => {
    const src = read(path.join(goDir, "main.go"));
    expect(src).toContain("SWIFT");
  });

  it("main.go has CBN purpose code field", () => {
    const src = read(path.join(goDir, "main.go"));
    expect(src).toContain("purpose_code");
  });

  it("main_test.go exists with test cases", () => {
    expect(exists(path.join(goDir, "main_test.go"))).toBe(true);
    const tests = read(path.join(goDir, "main_test.go"));
    expect(tests).toContain("func Test");
  });
});

// ─── Rust: float-income engine ─────────────────────────────────────────────
describe("Rust float-income engine", () => {
  const rustDir = path.join(SERVICES, "float-income");

  it("Cargo.toml exists with correct package name", () => {
    expect(exists(path.join(rustDir, "Cargo.toml"))).toBe(true);
    const cargo = read(path.join(rustDir, "Cargo.toml"));
    expect(cargo).toContain("float-income");
  });

  it("src/main.rs defines FloatResult struct", () => {
    expect(exists(path.join(rustDir, "src/main.rs"))).toBe(true);
    const src = read(path.join(rustDir, "src/main.rs"));
    expect(src).toContain("FloatResult");
  });

  it("src/main.rs has project_float function", () => {
    const src = read(path.join(rustDir, "src/main.rs"));
    expect(src).toContain("project_float");
  });

  it("src/main.rs uses CBN MPR rate constant", () => {
    const src = read(path.join(rustDir, "src/main.rs"));
    // CBN_MPR stored as 0.265 or 0.2625 or 26.25 or 26.5
    expect(src.includes("CBN_MPR") || src.includes("0.265") || src.includes("26.25")).toBe(true);
  });

  it("src/main.rs has 48h settlement cycle logic", () => {
    const src = read(path.join(rustDir, "src/main.rs"));
    expect(src.includes("48") || src.includes("settlement")).toBe(true);
  });

  it("src/main.rs has annual_float_income field", () => {
    const src = read(path.join(rustDir, "src/main.rs"));
    expect(src).toContain("annual_float_income");
  });

  it("src/main.rs has test module", () => {
    const src = read(path.join(rustDir, "src/main.rs"));
    expect(src).toContain("#[cfg(test)]");
  });
});

// ─── Python: revenue-analytics service ─────────────────────────────────────
describe("Python revenue-analytics service", () => {
  const pyDir = path.join(SERVICES, "revenue-analytics");

  it("app.py exists", () => {
    expect(exists(path.join(pyDir, "app.py"))).toBe(true);
  });

  it("app.py has /scenario-model endpoint", () => {
    const src = read(path.join(pyDir, "app.py"));
    expect(src).toContain("scenario");
  });

  it("app.py has /cross-sell-score endpoint", () => {
    const src = read(path.join(pyDir, "app.py"));
    expect(src.includes("cross_sell") || src.includes("cross-sell")).toBe(true);
  });

  it("app.py has /formalization-rate endpoint", () => {
    const src = read(path.join(pyDir, "app.py"));
    expect(src.includes("formalization") || src.includes("formaliz")).toBe(true);
  });

  it("app.py handles bear/base/bull scenarios", () => {
    const src = read(path.join(pyDir, "app.py"));
    expect(src).toContain("bear");
    expect(src).toContain("base");
    expect(src).toContain("bull");
  });

  it("app.py has segment mix (labor, education, medical, sme, hnw)", () => {
    const src = read(path.join(pyDir, "app.py"));
    expect(src).toContain("labor");
    expect(src).toContain("education");
    expect(src).toContain("hnw");
  });

  it("test_app.py exists", () => {
    expect(exists(path.join(pyDir, "test_app.py"))).toBe(true);
  });

  it("test_app.py has test functions", () => {
    const tests = read(path.join(pyDir, "test_app.py"));
    expect(tests).toContain("def test_");
  });
});

// ─── TypeScript: outbound tRPC router ──────────────────────────────────────
describe("TypeScript outbound tRPC router", () => {
  const routerPath = path.join(ROUTERS, "outbound.ts");

  it("outbound.ts exists", () => {
    expect(exists(routerPath)).toBe(true);
  });

  it("outbound.ts has swift sub-router", () => {
    const src = read(routerPath);
    expect(src).toContain("swift");
  });

  it("outbound.ts has floatIncome sub-router", () => {
    const src = read(routerPath);
    expect(src.includes("floatIncome") || src.includes("float_income") || src.includes("float-income")).toBe(true);
  });

  it("outbound.ts has analytics sub-router", () => {
    const src = read(routerPath);
    expect(src).toContain("analytics");
  });

  it("outbound.ts has getQuote procedure", () => {
    const src = read(routerPath);
    expect(src).toContain("getQuote");
  });

  it("outbound.ts has submitTransfer procedure", () => {
    const src = read(routerPath);
    expect(src).toContain("submitTransfer");
  });

  it("outbound.ts has getFeeSchedule procedure", () => {
    const src = read(routerPath);
    expect(src).toContain("getFeeSchedule");
  });

  it("outbound.ts has scenarioModel procedure", () => {
    const src = read(routerPath);
    expect(src).toContain("scenarioModel");
  });

  it("outbound.ts has scoreCrossSell procedure", () => {
    const src = read(routerPath);
    expect(src).toContain("scoreCrossSell");
  });

  it("outbound.ts has formalizationRate procedure", () => {
    const src = read(routerPath);
    expect(src).toContain("formalizationRate");
  });

  it("outbound router is wired into appRouter in routers.ts", () => {
    const routersTs = read(path.join(ROOT, "server/routers.ts"));
    expect(routersTs).toContain("outbound");
  });
});

// ─── Frontend: 6 new pages ─────────────────────────────────────────────────
describe("Frontend: SendFromNigeria page", () => {
  const pagePath = path.join(PAGES, "SendFromNigeria.tsx");

  it("SendFromNigeria.tsx exists", () => {
    expect(exists(pagePath)).toBe(true);
  });

  it("uses outbound.swift.getQuote tRPC query", () => {
    const src = read(pagePath);
    expect(src).toContain("getQuote");
  });

  it("uses outbound.swift.submitTransfer tRPC mutation", () => {
    const src = read(pagePath);
    expect(src).toContain("submitTransfer");
  });

  it("has CBN purpose code selector", () => {
    const src = read(pagePath);
    expect(src).toContain("EDU");
    expect(src).toContain("MED");
  });

  it("has SWIFT BIC input field", () => {
    const src = read(pagePath);
    expect(src).toContain("SWIFT");
  });

  it("has multi-step form (form/quote/confirm)", () => {
    const src = read(pagePath);
    expect(src).toContain("quote");
    expect(src).toContain("confirm");
  });
});

describe("Frontend: EducationPayments page", () => {
  const pagePath = path.join(PAGES, "EducationPayments.tsx");

  it("EducationPayments.tsx exists", () => {
    expect(exists(pagePath)).toBe(true);
  });

  it("uses EDU purpose code", () => {
    const src = read(pagePath);
    expect(src).toContain("EDU");
  });

  it("uses cross-sell scoring query", () => {
    const src = read(pagePath);
    expect(src).toContain("scoreCrossSell");
  });

  it("shows live quote from outbound.swift.getQuote", () => {
    const src = read(pagePath);
    expect(src).toContain("getQuote");
  });
});

describe("Frontend: MedicalTourism page", () => {
  const pagePath = path.join(PAGES, "MedicalTourism.tsx");

  it("MedicalTourism.tsx exists", () => {
    expect(exists(pagePath)).toBe(true);
  });

  it("uses MED purpose code", () => {
    const src = read(pagePath);
    expect(src).toContain("MED");
  });

  it("has treatment type selector", () => {
    const src = read(pagePath);
    expect(src).toContain("Cardiac Surgery");
  });

  it("shows required documents list", () => {
    const src = read(pagePath);
    expect(src).toContain("CBN Form M");
  });
});

describe("Frontend: FormalizationDashboard page", () => {
  const pagePath = path.join(PAGES, "FormalizationDashboard.tsx");

  it("FormalizationDashboard.tsx exists", () => {
    expect(exists(pagePath)).toBe(true);
  });

  it("uses formalizationRate tRPC query", () => {
    const src = read(pagePath);
    expect(src).toContain("formalizationRate");
  });

  it("shows migration_rate metric", () => {
    const src = read(pagePath);
    expect(src).toContain("migration_rate");
  });

  it("shows revenue_uplift_usd metric", () => {
    const src = read(pagePath);
    expect(src).toContain("revenue_uplift_usd");
  });

  it("has channel selector (cash/mobile/account)", () => {
    const src = read(pagePath);
    expect(src).toContain("cash");
    expect(src).toContain("mobile");
    expect(src).toContain("account");
  });
});

describe("Frontend: OutboundRevenueModel page", () => {
  const pagePath = path.join(PAGES, "OutboundRevenueModel.tsx");

  it("OutboundRevenueModel.tsx exists", () => {
    expect(exists(pagePath)).toBe(true);
  });

  it("uses scenarioModel tRPC query", () => {
    const src = read(pagePath);
    expect(src).toContain("scenarioModel");
  });

  it("uses floatIncome.project tRPC query", () => {
    const src = read(pagePath);
    expect(src).toContain("project");
  });

  it("shows bear/base/bull scenario selector", () => {
    const src = read(pagePath);
    expect(src).toContain("bear");
    expect(src).toContain("bull");
  });

  it("shows total_revenue_usd column", () => {
    const src = read(pagePath);
    expect(src).toContain("total_revenue_usd");
  });
});

describe("Frontend: RecipientOnboarding page", () => {
  const pagePath = path.join(PAGES, "RecipientOnboarding.tsx");

  it("RecipientOnboarding.tsx exists", () => {
    expect(exists(pagePath)).toBe(true);
  });

  it("has 3-step onboarding flow", () => {
    const src = read(pagePath);
    expect(src).toContain("step===1");
    expect(src).toContain("step===2");
    expect(src).toContain("step===3");
  });

  it("has BVN input field", () => {
    const src = read(pagePath);
    expect(src).toContain("bvn");
  });

  it("has channel selector (cash/mobile/account)", () => {
    const src = read(pagePath);
    expect(src).toContain("cash");
    expect(src).toContain("mobile");
  });

  it("uses cross-sell scoring for recommendations", () => {
    const src = read(pagePath);
    expect(src).toContain("scoreCrossSell");
  });

  it("shows completion state with CheckCircle", () => {
    const src = read(pagePath);
    expect(src).toContain("CheckCircle");
  });
});

// ─── App.tsx route registration ────────────────────────────────────────────
describe("App.tsx route registration for v197 pages", () => {
  const appTsx = read(path.join(ROOT, "client/src/App.tsx"));

  it("registers /send-abroad route", () => {
    expect(appTsx).toContain("/send-abroad");
  });

  it("registers /education-payments route", () => {
    expect(appTsx).toContain("/education-payments");
  });

  it("registers /medical-tourism route", () => {
    expect(appTsx).toContain("/medical-tourism");
  });

  it("registers /formalization route", () => {
    expect(appTsx).toContain("/formalization");
  });

  it("registers /admin/revenue-model route", () => {
    expect(appTsx).toContain("/admin/revenue-model");
  });

  it("registers /recipient-onboarding route", () => {
    expect(appTsx).toContain("/recipient-onboarding");
  });

  it("imports SendFromNigeria lazy component", () => {
    expect(appTsx).toContain("SendFromNigeria");
  });

  it("imports OutboundRevenueModel lazy component", () => {
    expect(appTsx).toContain("OutboundRevenueModel");
  });
});
