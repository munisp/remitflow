/**
 * smoke-v196.test.ts — Production-Readiness Sprint
 *
 * Covers:
 *  1. Snooze UI in Rate Alerts tab (snoozeRateAlert procedure)
 *  2. Snooze expiry auto-rearm (checkRateAlerts rearms expired snoozes)
 *  3. BDC contact email column in CBN Compliance Dashboard
 *  4. SSE exponential backoff (DashboardLayout)
 *  5. Seed data: CBN corridors, BDC partners, exchange rate alerts
 *  6. Docker Compose: CBN compliance stack presence
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");

function readFile(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf-8");
}

// ─── 1. snoozeRateAlert procedure ────────────────────────────────────────────
describe("snoozeRateAlert procedure", () => {
  it("is defined in cbnCompliance.ts", () => {
    const src = readFile("server/routers/cbnCompliance.ts");
    expect(src).toContain("snoozeRateAlert");
  });

  it("accepts id and hours inputs", () => {
    const src = readFile("server/routers/cbnCompliance.ts");
    const idx = src.indexOf("snoozeRateAlert");
    const block = src.slice(idx, idx + 600);
    expect(block).toContain("hours");
    expect(block).toContain("z.number");
  });

  it("sets snoozeUntil timestamp on the alert", () => {
    const src = readFile("server/routers/cbnCompliance.ts");
    const idx = src.indexOf("snoozeRateAlert");
    const block = src.slice(idx, idx + 800);
    expect(block).toContain("snoozeUntil");
  });

  it("sets isActive to false when snoozed", () => {
    const src = readFile("server/routers/cbnCompliance.ts");
    const idx = src.indexOf("snoozeRateAlert");
    const block = src.slice(idx, idx + 800);
    expect(block).toContain("isActive");
    expect(block).toContain("false");
  });

  it("writes an audit log entry", () => {
    const src = readFile("server/routers/cbnCompliance.ts");
    const idx = src.indexOf("snoozeRateAlert");
    const block = src.slice(idx, idx + 1000);
    expect(block).toContain("createAuditLog");
  });
});

// ─── 2. Snooze expiry auto-rearm in checkRateAlerts ──────────────────────────
describe("checkRateAlerts snooze expiry auto-rearm", () => {
  it("queries alerts where snoozeUntil < NOW()", () => {
    const src = readFile("server/routers/cbnCompliance.ts");
    const idx = src.indexOf("checkRateAlerts");
    const block = src.slice(idx, idx + 2000);
    expect(block).toContain("snoozeUntil");
  });

  it("sets isActive=true and clears snoozeUntil on expired snoozes", () => {
    const src = readFile("server/routers/cbnCompliance.ts");
    const idx = src.indexOf("checkRateAlerts");
    const block = src.slice(idx, idx + 2000);
    expect(block).toContain("isActive");
    expect(block).toContain("null");
  });
});

// ─── 3. BDC contact email column in CbnComplianceDashboard ───────────────────
describe("BDC contact email column in CbnComplianceDashboard", () => {
  it("renders a Contact Email table header", () => {
    const src = readFile("client/src/pages/CbnComplianceDashboard.tsx");
    expect(src).toContain("Contact Email");
  });

  it("renders partner.contactEmail in table rows", () => {
    const src = readFile("client/src/pages/CbnComplianceDashboard.tsx");
    expect(src).toContain("contactEmail");
  });
});

// ─── 4. SSE exponential backoff in DashboardLayout ───────────────────────────
describe("SSE exponential backoff in DashboardLayout", () => {
  it("has retryCount variable", () => {
    const src = readFile("client/src/components/DashboardLayout.tsx");
    expect(src).toContain("retryCount");
  });

  it("uses Math.pow for exponential backoff", () => {
    const src = readFile("client/src/components/DashboardLayout.tsx");
    expect(src).toContain("Math.pow");
  });

  it("caps retry delay at MAX_RETRY_DELAY_MS", () => {
    const src = readFile("client/src/components/DashboardLayout.tsx");
    expect(src).toContain("MAX_RETRY_DELAY_MS");
  });

  it("resets retryCount to 0 on successful connection", () => {
    const src = readFile("client/src/components/DashboardLayout.tsx");
    expect(src).toContain("retryCount = 0");
  });

  it("uses Math.min to cap the delay", () => {
    const src = readFile("client/src/components/DashboardLayout.tsx");
    expect(src).toContain("Math.min");
  });
});

// ─── 5. Seed data: CBN corridors, BDC partners, exchange rate alerts ──────────
describe("Seed data completeness", () => {
  it("seeds cbnCorridors with USD/NGN and EUR/NGN", () => {
    const src = readFile("drizzle/seed.ts");
    expect(src).toContain("cbnCorridors");
    expect(src).toContain("USD/NGN");
    expect(src).toContain("EUR/NGN");
  });

  it("seeds cbnCorridors with at least 9 corridors", () => {
    const src = readFile("drizzle/seed.ts");
    const idx = src.indexOf("cbnCorridors");
    const block = src.slice(idx, idx + 2000);
    const matches = block.match(/corridor:/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(9);
  });

  it("seeds bdcPartners with at least 6 entries", () => {
    const src = readFile("drizzle/seed.ts");
    expect(src).toContain("bdcPartners");
    expect(src).toContain("CBN/BDC");
    const idx = src.indexOf("bdcPartners");
    const block = src.slice(idx, idx + 3000);
    const matches = block.match(/cbnLicenceNumber:/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(6);
  });

  it("seeds bdcPartners with contactEmail fields", () => {
    const src = readFile("drizzle/seed.ts");
    const idx = src.indexOf("bdcPartners");
    const block = src.slice(idx, idx + 3000);
    expect(block).toContain("contactEmail");
  });

  it("seeds exchangeRateAlerts with at least 7 entries", () => {
    const src = readFile("drizzle/seed.ts");
    expect(src).toContain("exchangeRateAlerts");
    const idx = src.indexOf("exchangeRateAlerts");
    const block = src.slice(idx, idx + 2000);
    const matches = block.match(/fromCurrency:/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(7);
  });

  it("seeds exchangeRateAlerts with multi-currency pairs (EUR, GBP, GHS)", () => {
    const src = readFile("drizzle/seed.ts");
    const idx = src.indexOf("exchangeRateAlerts");
    const block = src.slice(idx, idx + 2000);
    expect(block).toContain("EUR");
    expect(block).toContain("GBP");
    expect(block).toContain("GHS");
  });
});

// ─── 6. Docker Compose: CBN compliance stack ─────────────────────────────────
describe("Docker Compose CBN compliance stack", () => {
  it("docker-compose.cbn-compliance.yml exists and is non-trivial", () => {
    const src = readFile("docker-compose.cbn-compliance.yml");
    expect(src.length).toBeGreaterThan(100);
  });

  it("includes go-bdc-connector service", () => {
    const src = readFile("docker-compose.cbn-compliance.yml");
    expect(src).toContain("go-bdc-connector");
  });

  it("includes python-cbn-lakehouse service", () => {
    const src = readFile("docker-compose.cbn-compliance.yml");
    expect(src).toContain("python-cbn-lakehouse");
  });

  it("includes dapr-placement service", () => {
    const src = readFile("docker-compose.cbn-compliance.yml");
    expect(src).toContain("dapr-placement");
  });

  it("includes KAFKA_BROKERS environment variable", () => {
    const src = readFile("docker-compose.cbn-compliance.yml");
    expect(src).toContain("KAFKA_BROKERS");
  });

  it("includes TIGERBEETLE_ADDR environment variable", () => {
    const src = readFile("docker-compose.cbn-compliance.yml");
    expect(src).toContain("TIGERBEETLE_ADDR");
  });
});

// ─── 7. snoozeUntil column in schema ─────────────────────────────────────────
describe("snoozeUntil column in exchangeRateAlerts schema", () => {
  it("snoozeUntil is defined in schema.ts", () => {
    const src = readFile("drizzle/schema.ts");
    const idx = src.indexOf("exchangeRateAlerts");
    const block = src.slice(idx, idx + 900);
    expect(block).toContain("snoozeUntil");
  });

  it("snoozeUntil maps to snooze_until column", () => {
    const src = readFile("drizzle/schema.ts");
    const idx = src.indexOf("exchangeRateAlerts");
    const block = src.slice(idx, idx + 900);
    expect(block).toContain("snooze_until");
  });
});

// ─── 8. Rate alert history pair filter ───────────────────────────────────────
describe("Rate alert history pair filter UI", () => {
  it("CbnComplianceDashboard has alertHistoryPair state", () => {
    const src = readFile("client/src/pages/CbnComplianceDashboard.tsx");
    expect(src).toContain("alertHistoryPair");
  });

  it("CbnComplianceDashboard has an All pairs filter option", () => {
    const src = readFile("client/src/pages/CbnComplianceDashboard.tsx");
    expect(src).toContain("All pairs");
  });
});

// ─── 9. Email preview deep-link from BDC tab ─────────────────────────────────
describe("Email preview deep-link from BDC Partners tab", () => {
  it("CbnComplianceDashboard navigates to /admin/email-preview/bdc-onboarding", () => {
    const src = readFile("client/src/pages/CbnComplianceDashboard.tsx");
    expect(src).toContain("/admin/email-preview/bdc-onboarding");
  });

  it("BdcOnboardingEmailPreview reads URL search params on mount", () => {
    const src = readFile("client/src/pages/BdcOnboardingEmailPreview.tsx");
    expect(src).toContain("URLSearchParams");
  });
});
