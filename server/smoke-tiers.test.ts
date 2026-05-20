/**
 * Smoke tests for Tier 1, 2 & 3 features:
 *  Tier 1: ExpenseManagement, ContractorPayments, MerchantKYBReview, PayrollTaxFiling
 *  Tier 2: BusinessSavings, BondSecondaryMarket, LetterOfCredit, InvoiceFinancing, PayrollRun
 *  Tier 3: EmbeddedPayrollAPI, DiasporaMortgage, BusinessCreditScoring, ESGReporting
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function exists(relPath: string): boolean {
  return existsSync(join(ROOT, relPath));
}

function read(relPath: string): string {
  try {
    return readFileSync(join(ROOT, relPath), "utf8");
  } catch {
    return "";
  }
}

// ── Tier 1 — Business Finance ─────────────────────────────────────────────────
describe("Tier 1 — Business Finance frontend pages", () => {
  const pages = [
    "ExpenseManagement",
    "ContractorPayments",
    "MerchantKYBReview",
    "PayrollTaxFiling",
  ];
  pages.forEach((page) => {
    it(`has ${page}.tsx page`, () =>
      expect(exists(`client/src/pages/${page}.tsx`)).toBe(true));
  });
});

describe("Tier 1 — ExpenseManagement page content", () => {
  const content = read("client/src/pages/ExpenseManagement.tsx");
  it("imports trpc", () => expect(content).toContain("trpc"));
  it("uses expenseManagement router", () => expect(content).toContain("expenseManagement"));
  it("has submitReport mutation", () => expect(content).toContain("submitReport"));
  it("has approveReport mutation", () => expect(content).toContain("approveReport"));
  it("renders expense list", () => expect(content).toContain("listReports"));
});

describe("Tier 1 — ContractorPayments page content", () => {
  const content = read("client/src/pages/ContractorPayments.tsx");
  it("imports trpc", () => expect(content).toContain("trpc"));
  it("uses contractorPayments router", () => expect(content).toContain("contractorPayments"));
  it("has submitInvoice mutation", () => expect(content).toContain("submitInvoice"));
  it("has listInvoices query", () => expect(content).toContain("listInvoices"));
});

describe("Tier 1 — MerchantKYBReview page content", () => {
  const content = read("client/src/pages/MerchantKYBReview.tsx");
  it("imports trpc", () => expect(content).toContain("trpc"));
  it("uses merchantKybReview router", () => expect(content).toContain("merchantKybReview"));
  it("has submit mutation", () => expect(content).toContain("submit"));
  it("has adminList query", () => expect(content).toContain("adminList"));
  it("has approve action", () => expect(content).toContain("Approve"));
});

describe("Tier 1 — PayrollTaxFiling page content", () => {
  const content = read("client/src/pages/PayrollTaxFiling.tsx");
  it("imports trpc", () => expect(content).toContain("trpc"));
  it("uses payrollTaxFiling router", () => expect(content).toContain("payrollTaxFiling"));
  it("has calculate mutation", () => expect(content).toContain("calculate"));
  it("has list query", () => expect(content).toContain("list"));
});

// ── Tier 2 — Trade Finance ────────────────────────────────────────────────────
describe("Tier 2 — Trade Finance frontend pages", () => {
  const pages = [
    "BusinessSavings",
    "BondSecondaryMarket",
    "LetterOfCredit",
    "InvoiceFinancing",
    "PayrollRun",
  ];
  pages.forEach((page) => {
    it(`has ${page}.tsx page`, () =>
      expect(exists(`client/src/pages/${page}.tsx`)).toBe(true));
  });
});

describe("Tier 2 — BusinessSavings page content", () => {
  const content = read("client/src/pages/BusinessSavings.tsx");
  it("imports trpc", () => expect(content).toContain("trpc"));
  it("uses businessSavings router", () => expect(content).toContain("businessSavings"));
  it("has openAccount mutation", () => expect(content).toContain("openAccount"));
  it("has list query", () => expect(content).toContain("list"));
});

describe("Tier 2 — BondSecondaryMarket page content", () => {
  const content = read("client/src/pages/BondSecondaryMarket.tsx");
  it("imports trpc", () => expect(content).toContain("trpc"));
  it("uses bondSecondaryMarket router", () => expect(content).toContain("bondSecondaryMarket"));
  it("has buy mutation", () => expect(content).toContain("buy"));
  it("has list query", () => expect(content).toContain("list"));
});

describe("Tier 2 — LetterOfCredit page content", () => {
  const content = read("client/src/pages/LetterOfCredit.tsx");
  it("imports trpc", () => expect(content).toContain("trpc"));
  it("uses letterOfCredit router", () => expect(content).toContain("letterOfCredit"));
  it("has open mutation", () => expect(content).toContain("open"));
  it("has list query", () => expect(content).toContain("list"));
});

describe("Tier 2 — InvoiceFinancing page content", () => {
  const content = read("client/src/pages/InvoiceFinancing.tsx");
  it("imports trpc", () => expect(content).toContain("trpc"));
  it("uses invoiceFinancing router", () => expect(content).toContain("invoiceFinancing"));
  it("has applyForFinancing mutation", () => expect(content).toContain("applyForFinancing"));
  it("has list query", () => expect(content).toContain("list"));
});

describe("Tier 2 — PayrollRun page content", () => {
  const content = read("client/src/pages/PayrollRun.tsx");
  it("imports trpc", () => expect(content).toContain("trpc"));
  it("uses globalPayroll router", () => expect(content).toContain("globalPayroll"));
  it("has createRun mutation", () => expect(content).toContain("createRun"));
  it("has listRuns query", () => expect(content).toContain("listRuns"));
  it("has approveRun mutation", () => expect(content).toContain("approveRun"));
  it("has disburseRun mutation", () => expect(content).toContain("disburseRun"));
});

// ── Tier 3 — Advanced Products ────────────────────────────────────────────────
describe("Tier 3 — Advanced Products frontend pages", () => {
  const pages = [
    "EmbeddedPayrollAPI",
    "DiasporaMortgage",
    "BusinessCreditScoring",
    "ESGReporting",
  ];
  pages.forEach((page) => {
    it(`has ${page}.tsx page`, () =>
      expect(exists(`client/src/pages/${page}.tsx`)).toBe(true));
  });
});

describe("Tier 3 — EmbeddedPayrollAPI page content", () => {
  const content = read("client/src/pages/EmbeddedPayrollAPI.tsx");
  it("imports trpc", () => expect(content).toContain("trpc"));
  it("uses embeddedPayrollApi router", () => expect(content).toContain("embeddedPayrollApi"));
  it("has issueApiKey mutation", () => expect(content).toContain("issueApiKey"));
  it("has revokeApiKey mutation", () => expect(content).toContain("revokeApiKey"));
  it("has triggerPayrollRun mutation", () => expect(content).toContain("triggerPayrollRun"));
  it("has listApiKeys query", () => expect(content).toContain("listApiKeys"));
  it("has listRequests query", () => expect(content).toContain("listRequests"));
});

describe("Tier 3 — DiasporaMortgage page content", () => {
  const content = read("client/src/pages/DiasporaMortgage.tsx");
  it("imports trpc", () => expect(content).toContain("trpc"));
  it("uses diasporaMortgage router", () => expect(content).toContain("diasporaMortgage"));
  it("has submitApplication mutation", () => expect(content).toContain("submitApplication"));
  it("has list query", () => expect(content).toContain("list"));
  it("has LTV field", () => expect(content).toContain("ltvRatioPct"));
  it("has propertyCountry field", () => expect(content).toContain("propertyCountry"));
});

describe("Tier 3 — BusinessCreditScoring page content", () => {
  const content = read("client/src/pages/BusinessCreditScoring.tsx");
  it("imports trpc", () => expect(content).toContain("trpc"));
  it("uses businessCreditScoring router", () => expect(content).toContain("businessCreditScoring"));
  it("has requestScore mutation", () => expect(content).toContain("requestScore"));
  it("has applyForCredit mutation", () => expect(content).toContain("applyForCredit"));
  it("has getScore query", () => expect(content).toContain("getScore"));
  it("has listApplications query", () => expect(content).toContain("listApplications"));
  it("shows credit grade", () => expect(content).toContain("grade"));
});

describe("Tier 3 — ESGReporting page content", () => {
  const content = read("client/src/pages/ESGReporting.tsx");
  it("imports trpc", () => expect(content).toContain("trpc"));
  it("uses esgReporting router", () => expect(content).toContain("esgReporting"));
  it("has generate mutation", () => expect(content).toContain("generate"));
  it("has list query", () => expect(content).toContain("list"));
  it("shows carbon footprint", () => expect(content).toContain("carbonFootprint"));
  it("shows ESG score", () => expect(content).toContain("esgScore"));
  it("shows governance metrics", () => expect(content).toContain("Governance"));
});

// ── App.tsx routing ───────────────────────────────────────────────────────────
describe("App.tsx routes for all 13 tier pages", () => {
  const appContent = read("client/src/App.tsx");
  const routes = [
    "/expense-management",
    "/contractor-payments",
    "/merchant-kyb",
    "/payroll-tax",
    "/business-savings",
    "/bond-market",
    "/letter-of-credit",
    "/invoice-financing",
    "/payroll-run",
    "/embedded-payroll-api",
    "/diaspora-mortgage",
    "/credit-scoring",
    "/esg-reporting",
  ];
  routes.forEach((route) => {
    it(`has route ${route}`, () => expect(appContent).toContain(route));
  });
});

// ── DashboardLayout sidebar nav groups ────────────────────────────────────────
describe("DashboardLayout sidebar nav groups", () => {
  const layoutContent = read("client/src/components/DashboardLayout.tsx");
  it("has Business Finance nav group", () => expect(layoutContent).toContain("Business Finance"));
  it("has Trade Finance nav group", () => expect(layoutContent).toContain("Trade Finance"));
  it("has Advanced Products nav group", () => expect(layoutContent).toContain("Advanced Products"));
  it("has Expense Management nav item", () => expect(layoutContent).toContain("Expense Management"));
  it("has Contractor Payments nav item", () => expect(layoutContent).toContain("Contractor Payments"));
  it("has Merchant KYB Review nav item", () => expect(layoutContent).toContain("Merchant KYB Review"));
  it("has Payroll & Tax Filing nav item", () => expect(layoutContent).toContain("Payroll & Tax Filing"));
  it("has Business Savings nav item", () => expect(layoutContent).toContain("Business Savings"));
  it("has Bond Secondary Market nav item", () => expect(layoutContent).toContain("Bond Secondary Market"));
  it("has Letter of Credit nav item", () => expect(layoutContent).toContain("Letter of Credit"));
  it("has Invoice Financing nav item", () => expect(layoutContent).toContain("Invoice Financing"));
  it("has Payroll Run nav item", () => expect(layoutContent).toContain("Payroll Run"));
  it("has Embedded Payroll API nav item", () => expect(layoutContent).toContain("Embedded Payroll API"));
  it("has Diaspora Mortgage nav item", () => expect(layoutContent).toContain("Diaspora Mortgage"));
  it("has Credit Scoring nav item", () => expect(layoutContent).toContain("Credit Scoring"));
  it("has ESG Reporting nav item", () => expect(layoutContent).toContain("ESG Reporting"));
});

// ── Backend routers wired ─────────────────────────────────────────────────────
describe("Backend routers wired in routers.ts", () => {
  const routersContent = read("server/routers.ts");
  it("imports tier1 routers", () => expect(routersContent).toContain("tier1"));
  it("imports tier2 routers", () => expect(routersContent).toContain("tier2"));
  it("imports tier3 routers", () => expect(routersContent).toContain("tier3"));
  it("has expenseManagement router key", () => expect(routersContent).toContain("expenseManagement"));
  it("has contractorPayments router key", () => expect(routersContent).toContain("contractorPayments"));
  it("has merchantKybReview router key", () => expect(routersContent).toContain("merchantKybReview"));
  it("has payrollTaxFiling router key", () => expect(routersContent).toContain("payrollTaxFiling"));
  it("has businessSavings router key", () => expect(routersContent).toContain("businessSavings"));
  it("has bondSecondaryMarket router key", () => expect(routersContent).toContain("bondSecondaryMarket"));
  it("has letterOfCredit router key", () => expect(routersContent).toContain("letterOfCredit"));
  it("has invoiceFinancing router key", () => expect(routersContent).toContain("invoiceFinancing"));
  it("has embeddedPayrollApi router key", () => expect(routersContent).toContain("embeddedPayrollApi"));
  it("has diasporaMortgage router key", () => expect(routersContent).toContain("diasporaMortgage"));
  it("has businessCreditScoring router key", () => expect(routersContent).toContain("businessCreditScoring"));
  it("has esgReporting router key", () => expect(routersContent).toContain("esgReporting"));
});

// ── Tier router files exist ───────────────────────────────────────────────────
describe("Tier router files exist", () => {
  it("has tier1.ts router", () => expect(exists("server/routers/tier1.ts")).toBe(true));
  it("has tier2.ts router", () => expect(exists("server/routers/tier2.ts")).toBe(true));
  it("has tier3.ts router", () => expect(exists("server/routers/tier3.ts")).toBe(true));
});

// ── Tier 1 router procedures ──────────────────────────────────────────────────
describe("Tier 1 router procedures", () => {
  const tier1 = read("server/routers/tier1.ts");
  it("has expenseRouter (expense management)", () => expect(tier1).toContain("expenseRouter"));
  it("has contractorRouter (contractor payments)", () => expect(tier1).toContain("contractorRouter"));
  it("has merchantKybRouter (merchant KYB)", () => expect(tier1).toContain("merchantKybRouter"));
  it("expense management has submitReport", () => expect(tier1).toContain("submitReport"));
  it("expense management has approveReport", () => expect(tier1).toContain("approveReport"));
  it("contractor payments has submitInvoice", () => expect(tier1).toContain("submitInvoice"));
  it("contractor payments has listInvoices", () => expect(tier1).toContain("listInvoices"));
  it("merchant KYB has submit", () => expect(tier1).toContain("submit"));
  it("merchant KYB has adminReview", () => expect(tier1).toContain("adminReview"));
});

// ── Tier 2 router procedures ─────────────────────────────────────────────
describe("Tier 2 — Trade Finance router procedures", () => {
  const tier2 = read("server/routers/tier2.ts");
  it("has businessSavingsRouter", () => expect(tier2).toContain("businessSavingsRouter"));
  it("has letterOfCreditRouter", () => expect(tier2).toContain("letterOfCreditRouter"));
  it("has invoiceFinancingRouter", () => expect(tier2).toContain("invoiceFinancingRouter"));
  it("has payrollTaxFilingRouter", () => expect(tier2).toContain("payrollTaxFilingRouter"));
  it("business savings has openAccount", () => expect(tier2).toContain("openAccount"));
  it("letter of credit has open", () => expect(tier2).toContain("open"));
  it("invoice financing has applyForFinancing", () => expect(tier2).toContain("applyForFinancing"));
});

describe("Tier 1 — Bond Secondary Market router procedures", () => {
  const tier1 = read("server/routers/tier1.ts");
  it("has bondSecondaryBuyerRouter", () => expect(tier1).toContain("bondSecondaryBuyerRouter"));
  it("bond market has buy", () => expect(tier1).toContain("buy"));
  it("bond market has listOpenOrders", () => expect(tier1).toContain("listOpenOrders"));
  it("bond market has getPricing", () => expect(tier1).toContain("getPricing"));
});

// ── Tier 3 router procedures ──────────────────────────────────────────────────
describe("Tier 3 router procedures", () => {
  const tier3 = read("server/routers/tier3.ts");
  it("has embeddedPayrollApiRouter", () => expect(tier3).toContain("embeddedPayrollApiRouter"));
  it("has diasporaMortgageRouter", () => expect(tier3).toContain("diasporaMortgageRouter"));
  it("has businessCreditScoringRouter", () => expect(tier3).toContain("businessCreditScoringRouter"));
  it("has esgReportingRouter", () => expect(tier3).toContain("esgReportingRouter"));
  it("embedded payroll has issueApiKey", () => expect(tier3).toContain("issueApiKey"));
  it("embedded payroll has revokeApiKey", () => expect(tier3).toContain("revokeApiKey"));
  it("embedded payroll has triggerPayrollRun", () => expect(tier3).toContain("triggerPayrollRun"));
  it("diaspora mortgage has submitApplication", () => expect(tier3).toContain("submitApplication"));
  it("credit scoring has requestScore", () => expect(tier3).toContain("requestScore"));
  it("credit scoring has applyForCredit", () => expect(tier3).toContain("applyForCredit"));
  it("ESG reporting has generate", () => expect(tier3).toContain("generate"));
});
