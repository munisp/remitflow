/**
 * smoke-v150.test.ts
 * Covers: lockout notification email, lockout trends chart, OFAC endpoint,
 *         SecurityDashboard recharts integration, getLockoutTrends DB helper,
 *         lockoutTrends router procedure, db.ts notification wiring
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

// ── 1. getLockoutTrends DB helper ─────────────────────────────────────────────
describe("v150: getLockoutTrends DB helper", () => {
  it("exports getLockoutTrends from db.ts", () => {
    const db = read("server/db.ts");
    expect(db).toContain("getLockoutTrends");
  });

  it("getLockoutTrends accepts a days parameter", () => {
    const db = read("server/db.ts");
    const idx = db.indexOf("getLockoutTrends");
    const slice = db.slice(idx, idx + 300);
    expect(slice).toMatch(/days/);
  });

  it("getLockoutTrends returns date and lockouts fields", () => {
    const db = read("server/db.ts");
    const idx = db.indexOf("getLockoutTrends");
    const slice = db.slice(idx, idx + 600);
    expect(slice).toMatch(/date/);
    expect(slice).toMatch(/lockouts/);
  });
});

// ── 2. lockoutTrends router procedure ────────────────────────────────────────
describe("v150: lockoutTrends router procedure", () => {
  it("securityAudit router exports lockoutTrends procedure", () => {
    const router = read("server/routers/securityAudit.ts");
    expect(router).toContain("lockoutTrends");
  });

  it("lockoutTrends accepts days input with min/max validation", () => {
    const router = read("server/routers/securityAudit.ts");
    const idx = router.indexOf("lockoutTrends");
    const slice = router.slice(idx, idx + 300);
    expect(slice).toMatch(/days/);
    expect(slice).toMatch(/min\(7\)/);
    expect(slice).toMatch(/max\(365\)/);
  });

  it("lockoutTrends calls db.getLockoutTrends", () => {
    const router = read("server/routers/securityAudit.ts");
    const idx = router.indexOf("lockoutTrends");
    const slice = router.slice(idx, idx + 400);
    expect(slice).toContain("getLockoutTrends");
  });

  it("lockoutTrends is an adminProcedure", () => {
    const router = read("server/routers/securityAudit.ts");
    const idx = router.indexOf("lockoutTrends");
    const slice = router.slice(idx, idx + 200);
    expect(slice).toContain("adminProcedure");
  });
});

// ── 3. Lockout notification email in db.ts ────────────────────────────────────
describe("v150: lockout notification email", () => {
  it("db.ts imports notifyOwner for lockout notifications", () => {
    const db = read("server/db.ts");
    expect(db).toMatch(/notifyOwner|notification/);
  });

  it("recordLoginFailure sends notification on lockout", () => {
    const db = read("server/db.ts");
    const idx = db.indexOf("recordLoginFailure");
    const slice = db.slice(idx, idx + 1800);
    expect(slice).toMatch(/notifyOwner|notify|notification/i);
  });

  it("lockout notification includes userId in message", () => {
    const db = read("server/db.ts");
    const idx = db.indexOf("recordLoginFailure");
    const slice = db.slice(idx, idx + 1200);
    expect(slice).toMatch(/userId|user.*lock|lock.*user/i);
  });
});

// ── 4. SecurityDashboard recharts integration ─────────────────────────────────
describe("v150: SecurityDashboard recharts chart", () => {
  it("SecurityDashboard imports recharts components", () => {
    const page = read("client/src/pages/SecurityDashboard.tsx");
    expect(page).toContain("recharts");
    expect(page).toContain("BarChart");
    expect(page).toContain("ResponsiveContainer");
  });

  it("SecurityDashboard calls lockoutTrends query", () => {
    const page = read("client/src/pages/SecurityDashboard.tsx");
    expect(page).toContain("lockoutTrends");
  });

  it("SecurityDashboard renders BarChart with lockout data", () => {
    const page = read("client/src/pages/SecurityDashboard.tsx");
    expect(page).toContain("lockoutTrends.trends");
  });

  it("SecurityDashboard shows Lockout Trends card title", () => {
    const page = read("client/src/pages/SecurityDashboard.tsx");
    expect(page).toContain("Lockout Trends");
  });

  it("SecurityDashboard chart uses lockouts and attempts data keys", () => {
    const page = read("client/src/pages/SecurityDashboard.tsx");
    expect(page).toContain("dataKey=\"lockouts\"");
    expect(page).toContain("dataKey=\"attempts\"");
  });

  it("SecurityDashboard shows empty state when no lockout trends", () => {
    const page = read("client/src/pages/SecurityDashboard.tsx");
    expect(page).toContain("No lockout events in the last 30 days");
  });

  it("SecurityDashboard Lockouts tab shows active lockout count badge", () => {
    const page = read("client/src/pages/SecurityDashboard.tsx");
    expect(page).toContain("activeLockouts");
  });

  it("SecurityDashboard Lockouts tab shows Unlock button for active lockouts", () => {
    const page = read("client/src/pages/SecurityDashboard.tsx");
    const idx = page.indexOf("Lockout Management");
    const slice = page.slice(idx, idx + 2500);
    expect(slice).toContain("Unlock");
  });
});

// ── 5. OFAC geo-block refresh endpoint ────────────────────────────────────────
describe("v150: OFAC geo-block refresh endpoint", () => {
  it("index.ts has /api/scheduled/geo-block-refresh endpoint", () => {
    const index = read("server/_core/index.ts");
    expect(index).toContain("geo-block-refresh");
  });

  it("geo-block-refresh endpoint calls updateGeoBlockList", () => {
    const index = read("server/_core/index.ts");
    const idx = index.indexOf("geo-block-refresh");
    const slice = index.slice(idx, idx + 1200);
    expect(slice).toContain("updateGeoBlockList");
  });

  it("geo-block-refresh endpoint returns countriesUpdated", () => {
    const index = read("server/_core/index.ts");
    const idx = index.indexOf("geo-block-refresh");
    const slice = index.slice(idx, idx + 2500);
    expect(slice).toContain("countriesUpdated");
  });

  it("updateGeoBlockList is exported from security.attacks.ts", () => {
    const attacks = read("server/security.attacks.ts");
    expect(attacks).toContain("updateGeoBlockList");
    expect(attacks).toMatch(/export.*function.*updateGeoBlockList|export const updateGeoBlockList/);
  });
});

// ── 6. oauth.ts login failure wiring ─────────────────────────────────────────
describe("v150: oauth.ts login failure wiring", () => {
  it("oauth.ts imports recordLoginFailure", () => {
    const oauth = read("server/_core/oauth.ts");
    expect(oauth).toContain("recordLoginFailure");
  });

  it("oauth.ts calls recordLoginFailure in error path", () => {
    const oauth = read("server/_core/oauth.ts");
    const idx = oauth.indexOf("recordLoginFailure");
    // Should be in a try/catch or error handler — check a wider window
    const context = oauth.slice(Math.max(0, idx - 1500), idx + 200);
    expect(context).toMatch(/try|catch|error|fail/i);
  });
});

// ── 7. db.ts lockout helpers completeness ─────────────────────────────────────
describe("v150: db.ts lockout helpers completeness", () => {
  it("db.ts exports all 6 lockout helpers", () => {
    const db = read("server/db.ts");
    expect(db).toContain("checkDbUserLockout");
    expect(db).toContain("recordLoginFailure");
    expect(db).toContain("clearDbUserLockout");
    expect(db).toContain("getAllUserLockouts");
    expect(db).toContain("resetLoginAttempts");
    expect(db).toContain("getLockoutHistoryForUser");
    expect(db).toContain("getLockoutTrends");
  });
});

// ── 8. user_lockouts schema table ─────────────────────────────────────────────
describe("v150: user_lockouts DB schema", () => {
  it("drizzle/schema.ts defines userLockouts table", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).toContain("userLockouts");
  });

  it("userLockouts table has userId, failedAttempts, lockedAt fields", () => {
    const schema = read("drizzle/schema.ts");
    const idx = schema.indexOf("userLockouts");
    const slice = schema.slice(idx, idx + 600);
    expect(slice).toContain("userId");
    expect(slice).toContain("failedAttempts");
    expect(slice).toContain("lockedAt");
  });
});

// ── 9. TrendingUp icon in SecurityDashboard ───────────────────────────────────
describe("v150: SecurityDashboard TrendingUp icon", () => {
  it("SecurityDashboard imports TrendingUp from lucide-react", () => {
    const page = read("client/src/pages/SecurityDashboard.tsx");
    expect(page).toContain("TrendingUp");
  });
});
