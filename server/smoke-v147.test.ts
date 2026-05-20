/**
 * smoke-v147.test.ts
 * Production-readiness sprint v147 — auth lockout wiring, secrets rotation
 * dashboard, geo-block status, user lockout management, SecurityDashboard tabs.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");

function readFile(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

// ─── 1. sdk.ts: lockout wired into authenticateRequest ──────────────────────
describe("v147 – sdk.ts lockout wiring", () => {
  const sdk = readFile("server/_core/sdk.ts");

  it("imports checkDbUserLockout or checkUserLockout from security.attacks", () => {
    // v148 migrated to DB-persisted lockout check
    expect(sdk).toMatch(/checkDbUserLockout|checkUserLockout/);
  });

  it("imports emitSecurityEvent from security.attacks", () => {
    expect(sdk).toMatch(/emitSecurityEvent/);
  });

  it("calls checkDbUserLockout or checkUserLockout with user.id", () => {
    // v148 migrated to DB-persisted lockout check
    expect(sdk).toMatch(/checkDbUserLockout\(user\.id\)|checkUserLockout\(user\.id\)/);
  });

  it("throws ForbiddenError when account is locked", () => {
    expect(sdk).toMatch(/Account temporarily locked/);
  });

  it("emits auth.lockout_enforced SIEM event on lockout", () => {
    expect(sdk).toMatch(/auth\.lockout_enforced/);
  });

  it("fails open on import/DB errors (does not block legitimate users)", () => {
    expect(sdk).toMatch(/Swallow import\/other errors|Swallow import\/DB errors/);
  });
});

// ─── 2. securityAudit router: new procedures ────────────────────────────────
describe("v147 – securityAudit router new procedures", () => {
  const router = readFile("server/routers/securityAudit.ts");

  it("exports secretsRotation procedure", () => {
    expect(router).toMatch(/secretsRotation:/);
  });

  it("exports geoBlockStatus procedure", () => {
    expect(router).toMatch(/geoBlockStatus:/);
  });

  it("exports userLockoutStatus procedure", () => {
    expect(router).toMatch(/userLockoutStatus:/);
  });

  it("exports unlockUser mutation", () => {
    expect(router).toMatch(/unlockUser:/);
  });

  it("secretsRotation calls checkSecretsRotation", () => {
    expect(router).toMatch(/checkSecretsRotation/);
  });

  it("geoBlockStatus includes 14 blocked countries", () => {
    const matches = router.match(/code: "[A-Z]{2}"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(14);
  });

  it("geoBlockStatus includes OFAC SDN countries", () => {
    expect(router).toMatch(/OFAC SDN/);
  });

  it("geoBlockStatus includes FATF Blacklist countries", () => {
    expect(router).toMatch(/FATF Blacklist/);
  });

  it("userLockoutStatus queries DB or filters auth.user_locked events", () => {
    // v148 migrated to DB-persisted lockouts; router now queries getAllUserLockouts
    expect(router).toMatch(/getAllUserLockouts|auth\.user_locked/);
  });

  it("userLockoutStatus uses DB or SIEM for lockout data", () => {
    // v148 migrated to DB-persisted lockouts via getAllUserLockouts
    expect(router).toMatch(/getAllUserLockouts|auth\.lockout_enforced/);
  });

  it("unlockUser calls clearDbUserLockout or clearUserLockout", () => {
    // v148 migrated to DB-persisted clearDbUserLockout
    expect(router).toMatch(/clearDbUserLockout|clearUserLockout/);
  });

  it("unlockUser emits auth.user_unlocked SIEM event", () => {
    expect(router).toMatch(/auth\.user_unlocked/);
  });

  it("unlockUser is adminProcedure (not public)", () => {
    const unlockIdx = router.indexOf("unlockUser:");
    const beforeUnlock = router.slice(Math.max(0, unlockIdx - 5), unlockIdx + 100);
    expect(beforeUnlock).toMatch(/adminProcedure/);
  });
});

// ─── 3. SecurityDashboard.tsx: new tabs ─────────────────────────────────────
describe("v147 – SecurityDashboard new tabs", () => {
  const dashboard = readFile("client/src/pages/SecurityDashboard.tsx");

  it("queries secretsRotation", () => {
    expect(dashboard).toMatch(/trpc\.securityAudit\.secretsRotation\.useQuery/);
  });

  it("queries geoBlockStatus", () => {
    expect(dashboard).toMatch(/trpc\.securityAudit\.geoBlockStatus\.useQuery/);
  });

  it("queries userLockoutStatus", () => {
    expect(dashboard).toMatch(/trpc\.securityAudit\.userLockoutStatus\.useQuery/);
  });

  it("has unlockUser mutation", () => {
    expect(dashboard).toMatch(/trpc\.securityAudit\.unlockUser\.useMutation/);
  });

  it("renders Secrets Rotation tab trigger", () => {
    expect(dashboard).toMatch(/value="secrets"/);
  });

  it("renders Geo-Block tab trigger", () => {
    expect(dashboard).toMatch(/value="geoblock"/);
  });

  it("renders Lockouts tab trigger", () => {
    expect(dashboard).toMatch(/value="lockouts"/);
  });

  it("shows secrets rotation summary (ok/warn/expired)", () => {
    expect(dashboard).toMatch(/secretsRotation\.summary\.ok/);
    expect(dashboard).toMatch(/secretsRotation\.summary\.warn/);
    expect(dashboard).toMatch(/secretsRotation\.summary\.expired/);
  });

  it("shows geo-block country grid", () => {
    expect(dashboard).toMatch(/blockedCountries\.map/);
  });

  it("shows lockout events list with Unlock button", () => {
    expect(dashboard).toMatch(/unlockUserMutation\.mutate/);
  });

  it("tab list has 9 columns for 9 tabs", () => {
    expect(dashboard).toMatch(/grid-cols-9/);
  });
});

// ─── 4. security.attacks.ts: all v146+v147 exports ──────────────────────────
describe("v147 – security.attacks.ts exports", () => {
  const attacks = readFile("server/security.attacks.ts");

  it("exports checkUserLockout", () => {
    expect(attacks).toMatch(/export function checkUserLockout/);
  });

  it("exports clearUserLockout", () => {
    expect(attacks).toMatch(/export function clearUserLockout/);
  });

  it("exports checkSecretsRotation", () => {
    expect(attacks).toMatch(/export function checkSecretsRotation/);
  });

  it("exports emitSecurityEvent", () => {
    expect(attacks).toMatch(/export function emitSecurityEvent/);
  });

  it("exports getSiemBuffer", () => {
    expect(attacks).toMatch(/export function getSiemBuffer/);
  });

  it("exports geoBlockMiddleware", () => {
    expect(attacks).toMatch(/geoBlockMiddleware/);
  });
});

// ─── 5. Integration: securityAudit router is registered in appRouter ────────
describe("v147 – appRouter registration", () => {
  const routers = readFile("server/routers.ts");

  it("securityAudit is registered in appRouter", () => {
    expect(routers).toMatch(/securityAudit:\s*securityAuditRouter/);
  });
});
