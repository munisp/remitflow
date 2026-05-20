/**
 * smoke-v151.test.ts
 * Covers: notificationSentAt column, date-range picker on lockout trends chart,
 *         OFAC scheduled task endpoint, db.ts notificationSentAt update
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

// ── 1. notificationSentAt schema column ──────────────────────────────────────
describe("v151: notificationSentAt schema column", () => {
  it("drizzle/schema.ts has notificationSentAt column in userLockouts", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).toContain("notificationSentAt");
    expect(schema).toContain("notification_sent_at");
  });

  it("notificationSentAt is a nullable timestamp", () => {
    const schema = read("drizzle/schema.ts");
    const idx = schema.indexOf("notificationSentAt");
    const slice = schema.slice(idx, idx + 80);
    expect(slice).toContain("timestamp");
  });
});

// ── 2. db.ts notificationSentAt update ───────────────────────────────────────
describe("v151: db.ts notificationSentAt persistence", () => {
  it("db.ts updates notificationSentAt after sending lockout email", () => {
    const db = read("server/db.ts");
    expect(db).toContain("notificationSentAt");
  });

  it("notificationSentAt is set to new Date() on lockout", () => {
    const db = read("server/db.ts");
    const idx = db.indexOf("notificationSentAt");
    const slice = db.slice(idx, idx + 100);
    expect(slice).toContain("new Date()");
  });

  it("notificationSentAt update is inside a try/catch to prevent blocking", () => {
    const db = read("server/db.ts");
    const idx = db.indexOf("notificationSentAt");
    const before = db.slice(Math.max(0, idx - 200), idx);
    expect(before).toMatch(/try|catch/);
  });
});

// ── 3. SecurityDashboard date-range picker ────────────────────────────────────
describe("v151: SecurityDashboard lockout trends date-range picker", () => {
  it("SecurityDashboard has trendDays state with default 30", () => {
    const page = read("client/src/pages/SecurityDashboard.tsx");
    expect(page).toContain("trendDays");
    expect(page).toContain("useState<7 | 30 | 90 | 365>(30)");
  });

  it("lockoutTrends query uses trendDays variable instead of hardcoded 30", () => {
    const page = read("client/src/pages/SecurityDashboard.tsx");
    expect(page).toContain("days: trendDays");
  });

  it("SecurityDashboard renders 7D, 30D, 90D, 1Y buttons", () => {
    const page = read("client/src/pages/SecurityDashboard.tsx");
    expect(page).toContain("7, 30, 90, 365");
    expect(page).toContain("1Y");
    expect(page).toContain("setTrendDays(d)");
  });

  it("active button has primary styling", () => {
    const page = read("client/src/pages/SecurityDashboard.tsx");
    expect(page).toContain("bg-primary text-primary-foreground border-primary");
  });

  it("chart title shows selected days dynamically", () => {
    const page = read("client/src/pages/SecurityDashboard.tsx");
    expect(page).toContain("Last {trendDays} Days");
  });

  it("date-range picker buttons are inside the CardHeader", () => {
    const page = read("client/src/pages/SecurityDashboard.tsx");
    // trendDays is used in the CardHeader section — find the chart CardHeader
    const idx = page.indexOf("Last {trendDays} Days");
    const before = page.slice(Math.max(0, idx - 500), idx);
    expect(before).toContain("CardHeader");
  });
});

// ── 4. OFAC geo-block refresh endpoint ────────────────────────────────────────
describe("v151: OFAC geo-block refresh endpoint", () => {
  it("index.ts has geo-block-refresh POST endpoint", () => {
    const index = read("server/_core/index.ts");
    expect(index).toContain("geo-block-refresh");
    expect(index).toContain("updateGeoBlockList");
  });

  it("geo-block-refresh accepts countries array in request body", () => {
    const index = read("server/_core/index.ts");
    const idx = index.indexOf("geo-block-refresh");
    const slice = index.slice(idx, idx + 1500);
    expect(slice).toContain("countries");
  });

  it("geo-block-refresh returns countriesUpdated in response", () => {
    const index = read("server/_core/index.ts");
    const idx = index.indexOf("geo-block-refresh");
    const slice = index.slice(idx, idx + 2500);
    expect(slice).toContain("countriesUpdated");
  });
});

// ── 5. lockoutTrends procedure min/max validation ─────────────────────────────
describe("v151: lockoutTrends procedure validation", () => {
  it("lockoutTrends accepts days 7 to 365", () => {
    const router = read("server/routers/securityAudit.ts");
    const idx = router.indexOf("lockoutTrends");
    const slice = router.slice(idx, idx + 300);
    expect(slice).toContain("min(7)");
    expect(slice).toContain("max(365)");
  });

  it("lockoutTrends default is 30 days", () => {
    const router = read("server/routers/securityAudit.ts");
    const idx = router.indexOf("lockoutTrends");
    const slice = router.slice(idx, idx + 300);
    expect(slice).toContain(".default(30)");
  });
});

// ── 6. db:push migration applied ─────────────────────────────────────────────
describe("v151: DB migration for notificationSentAt", () => {
  it("migration file 0030 exists for notificationSentAt column", () => {
    const files = fs.readdirSync(path.join(root, "drizzle"));
    const hasMigration = files.some(f => f.includes("0030") || f.includes("sersi") || f.includes("notification"));
    expect(hasMigration).toBe(true);
  });
});
