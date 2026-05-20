/**
 * smoke-v149.test.ts
 * Smoke tests for v149: DB-persisted login failure recording, lockout history,
 * OFAC scheduled endpoint, oauth.ts login failure wiring, Admin Users modal.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

// ─── 1. db.ts: getLockoutHistoryForUser ──────────────────────────────────────
describe("v149: db.ts getLockoutHistoryForUser", () => {
  it("exports getLockoutHistoryForUser function", () => {
    const src = read("server/db.ts");
    expect(src).toContain("export async function getLockoutHistoryForUser");
  });

  it("queries userLockouts table filtered by userId", () => {
    const src = read("server/db.ts");
    const fnStart = src.indexOf("export async function getLockoutHistoryForUser");
    const fnSlice = src.slice(fnStart, fnStart + 300);
    expect(fnSlice).toContain("userLockouts");
    expect(fnSlice).toContain("userId");
  });

  it("orders results by updatedAt descending", () => {
    const src = read("server/db.ts");
    const fnStart = src.indexOf("export async function getLockoutHistoryForUser");
    const fnSlice = src.slice(fnStart, fnStart + 300);
    expect(fnSlice).toContain("updatedAt");
  });
});

// ─── 2. securityAudit router: lockoutHistory procedure ───────────────────────
describe("v149: securityAuditRouter lockoutHistory", () => {
  it("defines lockoutHistory procedure", () => {
    const src = read("server/routers/securityAudit.ts");
    expect(src).toContain("lockoutHistory:");
  });

  it("uses adminProcedure for lockoutHistory", () => {
    const src = read("server/routers/securityAudit.ts");
    const idx = src.indexOf("lockoutHistory:");
    const slice = src.slice(idx, idx + 200);
    expect(slice).toContain("adminProcedure");
  });

  it("accepts userId input for lockoutHistory", () => {
    const src = read("server/routers/securityAudit.ts");
    const idx = src.indexOf("lockoutHistory:");
    const slice = src.slice(idx, idx + 300);
    expect(slice).toContain("userId");
    expect(slice).toContain("z.number");
  });

  it("calls getLockoutHistoryForUser from db", () => {
    const src = read("server/routers/securityAudit.ts");
    const idx = src.indexOf("lockoutHistory:");
    const slice = src.slice(idx, idx + 400);
    expect(slice).toContain("getLockoutHistoryForUser");
  });

  it("returns failedAttempts, lockedAt, lockExpiresAt, unlockedAt fields", () => {
    const src = read("server/routers/securityAudit.ts");
    const idx = src.indexOf("lockoutHistory:");
    const slice = src.slice(idx, idx + 600);
    expect(slice).toContain("failedAttempts");
    expect(slice).toContain("lockedAt");
    expect(slice).toContain("lockExpiresAt");
    expect(slice).toContain("unlockedAt");
  });

  it("returns unlockedByAdminId field for tamper-evident record", () => {
    const src = read("server/routers/securityAudit.ts");
    const idx = src.indexOf("lockoutHistory:");
    const slice = src.slice(idx, idx + 600);
    expect(slice).toContain("unlockedByAdminId");
  });
});

// ─── 3. oauth.ts: login failure wiring ───────────────────────────────────────
describe("v149: oauth.ts login failure wiring", () => {
  it("imports db module in oauth.ts", () => {
    const src = read("server/_core/oauth.ts");
    expect(src).toContain("db");
  });

  it("calls recordLoginFailure on OAuth callback error", () => {
    const src = read("server/_core/oauth.ts");
    expect(src).toContain("recordLoginFailure");
  });

  it("extracts openId from error object for failure tracking", () => {
    const src = read("server/_core/oauth.ts");
    expect(src).toContain("openId");
    expect(src).toContain("failedOpenId");
  });

  it("wraps failure recording in try/catch to avoid blocking error response", () => {
    const src = read("server/_core/oauth.ts");
    const idx = src.indexOf("recordLoginFailure");
    const surroundingSlice = src.slice(Math.max(0, idx - 500), idx + 500);
    expect(surroundingSlice).toContain("try");
    expect(surroundingSlice).toContain("swallow");
  });

  it("calls getUserByOpenId to resolve userId before recording failure", () => {
    const src = read("server/_core/oauth.ts");
    expect(src).toContain("getUserByOpenId");
  });
});

// ─── 4. OFAC endpoint: /api/scheduled/geo-block-refresh ─────────────────────
describe("v149: OFAC geo-block refresh endpoint", () => {
  it("defines /api/scheduled/geo-block-refresh route in index.ts", () => {
    const src = read("server/_core/index.ts");
    expect(src).toContain("geo-block-refresh");
  });

  it("accepts POST method for geo-block-refresh", () => {
    const src = read("server/_core/index.ts");
    const idx = src.indexOf("geo-block-refresh");
    const slice = src.slice(Math.max(0, idx - 100), idx + 200);
    expect(slice.toLowerCase()).toContain("post");
  });

  it("calls updateGeoBlockList with provided countries", () => {
    const src = read("server/_core/index.ts");
    expect(src).toContain("updateGeoBlockList");
  });

  it("returns countriesUpdated count in response", () => {
    const src = read("server/_core/index.ts");
    const idx = src.indexOf("geo-block-refresh");
    const slice = src.slice(idx, idx + 2000);
    expect(slice).toContain("countriesUpdated");
  });

  it("exports updateGeoBlockList from security.attacks.ts", () => {
    const src = read("server/security.attacks.ts");
    expect(src).toContain("export function updateGeoBlockList");
  });

  it("updateGeoBlockList updates the HIGH_RISK_COUNTRY_CODES set", () => {
    const src = read("server/security.attacks.ts");
    const idx = src.indexOf("export function updateGeoBlockList");
    const slice = src.slice(idx, idx + 400);
    expect(slice).toContain("HIGH_RISK_COUNTRY_CODES");
  });
});

// ─── 5. AdminUsers.tsx: lockout history modal ────────────────────────────────
describe("v149: AdminUsers.tsx lockout history modal", () => {
  it("imports useState for lockoutHistoryUserId", () => {
    const src = read("client/src/pages/AdminUsers.tsx");
    expect(src).toContain("lockoutHistoryUserId");
  });

  it("calls trpc.securityAudit.lockoutHistory.useQuery", () => {
    const src = read("client/src/pages/AdminUsers.tsx");
    expect(src).toContain("securityAudit.lockoutHistory.useQuery");
  });

  it("renders lockout history Dialog component", () => {
    const src = read("client/src/pages/AdminUsers.tsx");
    expect(src).toContain("Lockout History");
  });

  it("shows failedAttempts in history modal", () => {
    const src = read("client/src/pages/AdminUsers.tsx");
    expect(src).toContain("failedAttempts");
  });

  it("shows lockedAt and unlockedAt timestamps in history modal", () => {
    const src = read("client/src/pages/AdminUsers.tsx");
    expect(src).toContain("lockedAt");
    expect(src).toContain("unlockedAt");
  });

  it("shows unlockedByAdminId for tamper-evident audit trail", () => {
    const src = read("client/src/pages/AdminUsers.tsx");
    expect(src).toContain("unlockedByAdminId");
  });

  it("renders Clock icon button to open lockout history", () => {
    const src = read("client/src/pages/AdminUsers.tsx");
    expect(src).toContain("setLockoutHistoryUserId");
    expect(src).toContain("setLockoutHistoryUserName");
  });

  it("shows empty state when no lockout history exists", () => {
    const src = read("client/src/pages/AdminUsers.tsx");
    expect(src).toContain("No lockout history");
  });

  it("shows loading state while fetching lockout history", () => {
    const src = read("client/src/pages/AdminUsers.tsx");
    expect(src).toContain("lockoutHistoryLoading");
  });
});

// ─── 6. Schema: userLockouts table completeness ───────────────────────────────
describe("v149: userLockouts schema completeness", () => {
  it("userLockouts table has unlockedByAdminId column", () => {
    const src = read("drizzle/schema.ts");
    expect(src).toContain("unlockedByAdminId");
  });

  it("userLockouts table has unlockedAt column", () => {
    const src = read("drizzle/schema.ts");
    expect(src).toContain("unlockedAt");
  });

  it("userLockouts table has lockExpiresAt column", () => {
    const src = read("drizzle/schema.ts");
    expect(src).toContain("lockExpiresAt");
  });

  it("userLockouts table has failedAttempts column", () => {
    const src = read("drizzle/schema.ts");
    expect(src).toContain("failedAttempts");
  });
});
