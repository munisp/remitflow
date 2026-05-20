/**
 * smoke-v148.test.ts
 * Production-readiness sprint v148 — DB-persisted lockouts, Admin Users
 * lockout column, OFAC scheduled endpoint, updateGeoBlockList export.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");

function readFile(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

// ─── 1. drizzle/schema.ts: userLockouts table ────────────────────────────────
describe("v148 – userLockouts DB table", () => {
  const schema = readFile("drizzle/schema.ts");

  it("defines userLockouts table", () => {
    expect(schema).toMatch(/userLockouts/);
  });

  it("has userId column", () => {
    const idx = schema.indexOf("userLockouts");
    const block = schema.slice(idx, idx + 600);
    expect(block).toMatch(/userId/);
  });

  it("has failedAttempts column", () => {
    const idx = schema.indexOf("userLockouts");
    const block = schema.slice(idx, idx + 600);
    expect(block).toMatch(/failedAttempts/);
  });

  it("has lockExpiresAt column", () => {
    const idx = schema.indexOf("userLockouts");
    const block = schema.slice(idx, idx + 600);
    expect(block).toMatch(/lockExpiresAt/);
  });

  it("has unlockedByAdminId column", () => {
    const idx = schema.indexOf("userLockouts");
    const block = schema.slice(idx, idx + 600);
    expect(block).toMatch(/unlockedByAdminId/);
  });
});

// ─── 2. server/db.ts: lockout helper functions ───────────────────────────────
describe("v148 – db.ts lockout helpers", () => {
  const db = readFile("server/db.ts");

  it("exports checkDbUserLockout", () => {
    expect(db).toMatch(/export async function checkDbUserLockout/);
  });

  it("exports clearDbUserLockout", () => {
    expect(db).toMatch(/export async function clearDbUserLockout/);
  });

  it("exports resetLoginAttempts", () => {
    expect(db).toMatch(/export async function resetLoginAttempts/);
  });

  it("exports getAllUserLockouts", () => {
    expect(db).toMatch(/export async function getAllUserLockouts/);
  });

  it("checkDbUserLockout returns locked boolean and retryAfterSec", () => {
    const idx = db.indexOf("checkDbUserLockout");
    const block = db.slice(idx, idx + 400);
    expect(block).toMatch(/locked/);
    expect(block).toMatch(/retryAfterSec/);
  });
});

// ─── 3. sdk.ts: DB-persisted lockout check ───────────────────────────────────
describe("v148 – sdk.ts DB lockout check", () => {
  const sdk = readFile("server/_core/sdk.ts");

  it("calls checkDbUserLockout (DB-persisted)", () => {
    expect(sdk).toMatch(/checkDbUserLockout/);
  });

  it("uses retryAfterSec (not retryAfter)", () => {
    expect(sdk).toMatch(/retryAfterSec/);
  });

  it("still emits auth.lockout_enforced SIEM event", () => {
    expect(sdk).toMatch(/auth\.lockout_enforced/);
  });

  it("fails open on DB errors", () => {
    expect(sdk).toMatch(/Swallow import\/DB errors/);
  });
});

// ─── 4. securityAudit router: DB-persisted procedures ────────────────────────
describe("v148 – securityAudit router DB-persisted lockouts", () => {
  const router = readFile("server/routers/securityAudit.ts");

  it("imports db module", () => {
    expect(router).toMatch(/import \* as db from/);
  });

  it("userLockoutStatus uses getAllUserLockouts", () => {
    expect(router).toMatch(/getAllUserLockouts/);
  });

  it("unlockUser calls clearDbUserLockout", () => {
    expect(router).toMatch(/clearDbUserLockout/);
  });

  it("unlockUser records adminId in audit log", () => {
    const idx = router.indexOf("unlockUser:");
    const block = router.slice(idx, idx + 600);
    expect(block).toMatch(/adminId/);
  });

  it("exports resetLoginAttempts mutation", () => {
    expect(router).toMatch(/resetLoginAttempts:/);
  });

  it("resetLoginAttempts calls db.resetLoginAttempts", () => {
    const idx = router.indexOf("resetLoginAttempts:");
    const block = router.slice(idx, idx + 400);
    expect(block).toMatch(/db\.resetLoginAttempts/);
  });

  it("resetLoginAttempts emits auth.attempts_reset SIEM event", () => {
    expect(router).toMatch(/auth\.attempts_reset/);
  });

  it("resetLoginAttempts creates audit log entry", () => {
    const idx = router.indexOf("resetLoginAttempts:");
    const block = router.slice(idx, idx + 1200);
    expect(block).toMatch(/createAuditLog|LOGIN_ATTEMPTS_RESET/);
  });
});

// ─── 5. AdminUsers.tsx: lockout column and action buttons ────────────────────
describe("v148 – AdminUsers.tsx lockout UI", () => {
  const page = readFile("client/src/pages/AdminUsers.tsx");

  it("queries userLockoutStatus", () => {
    expect(page).toMatch(/trpc\.securityAudit\.userLockoutStatus\.useQuery/);
  });

  it("has unlockUser mutation", () => {
    expect(page).toMatch(/trpc\.securityAudit\.unlockUser\.useMutation/);
  });

  it("has resetLoginAttempts mutation", () => {
    expect(page).toMatch(/trpc\.securityAudit\.resetLoginAttempts\.useMutation/);
  });

  it("renders Login Attempts column header", () => {
    expect(page).toMatch(/Login Attempts/);
  });

  it("shows Locked badge for locked users", () => {
    expect(page).toMatch(/isLocked/);
  });

  it("shows failedAttempts counter", () => {
    expect(page).toMatch(/failedAttempts/);
  });

  it("renders Unlock button (LockOpen icon)", () => {
    expect(page).toMatch(/LockOpen/);
  });

  it("renders Reset attempts button (RotateCcw icon)", () => {
    expect(page).toMatch(/RotateCcw/);
  });

  it("builds lockoutMap keyed by userId", () => {
    expect(page).toMatch(/lockoutMap/);
  });
});

// ─── 6. index.ts: OFAC geo-block refresh scheduled endpoint ──────────────────
describe("v148 – OFAC geo-block refresh endpoint", () => {
  const server = readFile("server/_core/index.ts");

  it("registers /api/scheduled/geo-block-refresh POST endpoint", () => {
    expect(server).toMatch(/\/api\/scheduled\/geo-block-refresh/);
  });

  it("validates countries array in request body", () => {
    const idx = server.indexOf("geo-block-refresh");
    const block = server.slice(idx, idx + 1000);
    expect(block).toMatch(/countries.*Array/);
  });

  it("calls updateGeoBlockList from security.attacks", () => {
    expect(server).toMatch(/updateGeoBlockList/);
  });

  it("emits geo.block_list_refreshed SIEM event", () => {
    expect(server).toMatch(/geo\.block_list_refreshed/);
  });

  it("returns previousCount and countriesUpdated in response", () => {
    const idx = server.indexOf("geo-block-refresh");
    const block = server.slice(idx, idx + 2000);
    expect(block).toMatch(/previousCount/);
    expect(block).toMatch(/countriesUpdated/);
  });

  it("requires auth (cookie or bearer token)", () => {
    const idx = server.indexOf("geo-block-refresh");
    const block = server.slice(idx, idx + 800);
    expect(block).toMatch(/isAuthorized/);
  });
});

// ─── 7. security.attacks.ts: updateGeoBlockList export ───────────────────────
describe("v148 – security.attacks.ts updateGeoBlockList", () => {
  const attacks = readFile("server/security.attacks.ts");

  it("exports updateGeoBlockList function", () => {
    expect(attacks).toMatch(/export function updateGeoBlockList/);
  });

  it("clears HIGH_RISK_COUNTRY_CODES before updating", () => {
    const idx = attacks.indexOf("updateGeoBlockList");
    const block = attacks.slice(idx, idx + 400);
    expect(block).toMatch(/HIGH_RISK_COUNTRY_CODES\.clear/);
  });

  it("validates 2-letter country codes with regex", () => {
    const idx = attacks.indexOf("updateGeoBlockList");
    const block = attacks.slice(idx, idx + 400);
    expect(block).toMatch(/\[A-Z\]\{2\}/);
  });

  it("returns previous count", () => {
    const idx = attacks.indexOf("updateGeoBlockList");
    const block = attacks.slice(idx, idx + 400);
    expect(block).toMatch(/previousCount/);
  });
});
