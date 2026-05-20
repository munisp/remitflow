/**
 * smoke-v152.test.ts
 * Smoke tests for v152: notificationSentAt badge, self-service unlock flow,
 * DB schema columns, tRPC procedures, and /unlock page.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const root = resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf-8");
}

// ── 1. DB schema: unlockToken columns ─────────────────────────────────────────
describe("v152: userLockouts schema columns", () => {
  it("has unlockToken column", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).toContain("unlockToken");
  });

  it("has unlockTokenExpiresAt column", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).toContain("unlockTokenExpiresAt");
  });

  it("has unlockRequestedAt column", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).toContain("unlockRequestedAt");
  });
});

// ── 2. DB helpers: requestSelfUnlock and verifySelfUnlockToken ─────────────────
describe("v152: db.ts self-unlock helpers", () => {
  it("exports requestSelfUnlock", () => {
    const db = read("server/db.ts");
    expect(db).toContain("export async function requestSelfUnlock");
  });

  it("exports verifySelfUnlockToken", () => {
    const db = read("server/db.ts");
    expect(db).toContain("export async function verifySelfUnlockToken");
  });

  it("requestSelfUnlock enforces rate-limit cooldown", () => {
    const db = read("server/db.ts");
    const idx = db.indexOf("requestSelfUnlock");
    const block = db.slice(idx, idx + 1500);
    expect(block).toContain("UNLOCK_REQUEST_COOLDOWN_MS");
  });

  it("requestSelfUnlock generates 32-byte hex token", () => {
    const db = read("server/db.ts");
    const idx = db.indexOf("requestSelfUnlock");
    const block = db.slice(idx, idx + 1500);
    expect(block).toContain("randomBytes(32)");
  });

  it("verifySelfUnlockToken clears lockout on success", () => {
    const db = read("server/db.ts");
    const idx = db.indexOf("verifySelfUnlockToken");
    const block = db.slice(idx, idx + 1500);
    expect(block).toContain("failedAttempts: 0");
  });

  it("verifySelfUnlockToken checks token expiry", () => {
    const db = read("server/db.ts");
    const idx = db.indexOf("verifySelfUnlockToken");
    const block = db.slice(idx, idx + 1500);
    expect(block).toContain("unlockTokenExpiresAt");
  });

  it("requestSelfUnlock sends notifyOwner notification", () => {
    const db = read("server/db.ts");
    const idx = db.indexOf("requestSelfUnlock");
    const block = db.slice(idx, idx + 2000);
    expect(block).toContain("notifyOwner");
  });
});

// ── 3. securityAudit router: new procedures ────────────────────────────────────
describe("v152: securityAudit router procedures", () => {
  it("imports publicProcedure", () => {
    const router = read("server/routers/securityAudit.ts");
    expect(router).toContain("publicProcedure");
  });

  it("imports TRPCError", () => {
    const router = read("server/routers/securityAudit.ts");
    expect(router).toContain("TRPCError");
  });

  it("has requestSelfUnlock procedure", () => {
    const router = read("server/routers/securityAudit.ts");
    expect(router).toContain("requestSelfUnlock: publicProcedure");
  });

  it("has verifySelfUnlock procedure", () => {
    const router = read("server/routers/securityAudit.ts");
    expect(router).toContain("verifySelfUnlock: publicProcedure");
  });

  it("requestSelfUnlock accepts userId input", () => {
    const router = read("server/routers/securityAudit.ts");
    const idx = router.indexOf("requestSelfUnlock: publicProcedure");
    const block = router.slice(idx, idx + 400);
    expect(block).toContain("userId");
  });

  it("verifySelfUnlock accepts token input", () => {
    const router = read("server/routers/securityAudit.ts");
    const idx = router.indexOf("verifySelfUnlock: publicProcedure");
    const block = router.slice(idx, idx + 400);
    expect(block).toContain("token");
  });
});

// ── 4. SelfUnlock page ─────────────────────────────────────────────────────────
describe("v152: SelfUnlock.tsx page", () => {
  it("exists", () => {
    expect(() => read("client/src/pages/SelfUnlock.tsx")).not.toThrow();
  });

  it("calls requestSelfUnlock mutation", () => {
    const page = read("client/src/pages/SelfUnlock.tsx");
    expect(page).toContain("requestSelfUnlock");
  });

  it("calls verifySelfUnlock mutation", () => {
    const page = read("client/src/pages/SelfUnlock.tsx");
    expect(page).toContain("verifySelfUnlock");
  });

  it("auto-verifies token from URL on mount", () => {
    const page = read("client/src/pages/SelfUnlock.tsx");
    expect(page).toContain("getTokenFromUrl");
    expect(page).toContain("useEffect");
  });

  it("shows success state after unlock", () => {
    const page = read("client/src/pages/SelfUnlock.tsx");
    expect(page).toContain("Account Unlocked");
  });

  it("shows email sent confirmation state", () => {
    const page = read("client/src/pages/SelfUnlock.tsx");
    expect(page).toContain("Unlock Email Sent");
  });

  it("shows rate-limit info (1 request per hour)", () => {
    const page = read("client/src/pages/SelfUnlock.tsx");
    expect(page).toContain("1 hour");
  });

  it("has back-to-home navigation", () => {
    const page = read("client/src/pages/SelfUnlock.tsx");
    expect(page).toContain("ArrowLeft");
  });
});

// ── 5. App.tsx: /unlock route registered ──────────────────────────────────────
describe("v152: App.tsx routing", () => {
  it("imports SelfUnlock component", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain("SelfUnlock");
  });

  it("registers /unlock route", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain('path="/unlock"');
  });
});

// ── 6. AdminUsers: notificationSentAt badge ────────────────────────────────────
describe("v152: AdminUsers lockout history modal", () => {
  it("shows notificationSentAt badge", () => {
    const page = read("client/src/pages/AdminUsers.tsx");
    expect(page).toContain("notificationSentAt");
  });

  it("shows Email sent timestamp when notificationSentAt is set", () => {
    const page = read("client/src/pages/AdminUsers.tsx");
    expect(page).toContain("Email sent:");
  });

  it("shows No notification sent badge when locked but not notified", () => {
    const page = read("client/src/pages/AdminUsers.tsx");
    expect(page).toContain("No notification sent");
  });

  it("uses blue color for email-sent badge", () => {
    const page = read("client/src/pages/AdminUsers.tsx");
    expect(page).toContain("text-blue-600");
  });

  it("uses amber color for no-notification badge", () => {
    const page = read("client/src/pages/AdminUsers.tsx");
    expect(page).toContain("text-amber-600");
  });
});
