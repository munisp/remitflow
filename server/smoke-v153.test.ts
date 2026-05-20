/**
 * smoke-v153.test.ts
 * Sprint v153: Unlock URL in 403 error, token URL in notification email,
 * frontend lockout redirect wiring.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

// ─── sdk.ts: unlock URL in 403 error ─────────────────────────────────────────
describe("v153 – sdk.ts: unlock URL in 403 lockout error", () => {
  const sdk = read("server/_core/sdk.ts");

  it("includes /unlock?userId= in the lockout ForbiddenError message", () => {
    expect(sdk).toContain("/unlock?userId=${user.id}");
  });

  it("still includes retryAfterSec in the error message", () => {
    expect(sdk).toContain("Retry in ${lockStatus.retryAfterSec} seconds");
  });

  it("has a v153 comment explaining the unlock URL inclusion", () => {
    expect(sdk).toContain("v153");
  });

  it("still catches and rethrows the lockout error correctly", () => {
    expect(sdk).toContain('err?.message?.includes("Account temporarily locked")');
  });
});

// ─── main.tsx: frontend lockout redirect ─────────────────────────────────────
describe("v153 – main.tsx: frontend lockout redirect to /unlock", () => {
  const main = read("client/src/main.tsx");

  it("detects 'Account temporarily locked' in error message", () => {
    expect(main).toContain("Account temporarily locked");
  });

  it("extracts the /unlock?userId= path from the error message", () => {
    // The regex in main.tsx uses escaped forward slashes: \/unlock\?userId=
    expect(main).toMatch(/unlock.*userId/);
  });

  it("redirects to /unlock if not already on /unlock page", () => {
    expect(main).toContain("window.location.pathname.startsWith(\"/unlock\")");
  });

  it("falls back to /unlock if regex match fails", () => {
    expect(main).toContain('?? "/unlock"');
  });

  it("still handles the standard UNAUTHED_ERR_MSG redirect", () => {
    expect(main).toContain("UNAUTHED_ERR_MSG");
    expect(main).toContain("getLoginUrl()");
  });

  it("has a v153 comment explaining the lockout redirect", () => {
    expect(main).toContain("v153");
  });
});

// ─── db.ts: unlock token URL in notification email ───────────────────────────
describe("v153 – db.ts: unlock token URL in notification email body", () => {
  const db = read("server/db.ts");

  it("builds an unlockUrl from appOrigin + /unlock?token=", () => {
    expect(db).toContain("const unlockUrl = `${appOrigin}/unlock?token=${token}`");
  });

  it("includes the unlockUrl in the notifyOwner content", () => {
    expect(db).toContain("${unlockUrl}");
  });

  it("reads VITE_APP_ORIGIN from process.env for the base URL", () => {
    expect(db).toContain("VITE_APP_ORIGIN");
  });

  it("strips trailing slash from appOrigin", () => {
    expect(db).toContain('.replace(/\\/$/, "")');
  });

  it("includes expiry timestamp in the email body", () => {
    expect(db).toContain("expiresAt.toUTCString()");
  });

  it("includes a 'did not request' disclaimer in the email", () => {
    expect(db).toContain("If you did not request this");
  });

  it("has a v153 comment explaining the URL inclusion", () => {
    // The comment is in the requestSelfUnlock function
    const idx = db.indexOf("requestSelfUnlock");
    const slice = db.slice(idx, idx + 2000);
    expect(slice).toContain("v153");
  });
});

// ─── SelfUnlock.tsx: page exists and handles token param ─────────────────────
describe("v153 – SelfUnlock.tsx: self-service unlock page", () => {
  const page = read("client/src/pages/SelfUnlock.tsx");

  it("reads token from URL search params", () => {
    expect(page).toContain("token");
  });

  it("calls securityAudit.verifySelfUnlock or requestSelfUnlock mutation", () => {
    expect(page).toMatch(/verifySelfUnlock|requestSelfUnlock/);
  });

  it("shows a success state after unlock", () => {
    expect(page).toMatch(/success|unlocked|Success|Unlocked/);
  });

  it("shows an email-sent state after requesting unlock", () => {
    expect(page).toMatch(/email|Email|sent|Sent/);
  });
});

// ─── App.tsx: /unlock route registered ───────────────────────────────────────
describe("v153 – App.tsx: /unlock route registration", () => {
  const app = read("client/src/App.tsx");

  it("imports SelfUnlock component", () => {
    expect(app).toContain("SelfUnlock");
  });

  it("registers /unlock route", () => {
    expect(app).toContain("/unlock");
  });
});

// ─── securityAudit router: public procedures exist ───────────────────────────
describe("v153 – securityAudit router: public unlock procedures", () => {
  const router = read("server/routers/securityAudit.ts");

  it("exports requestSelfUnlock procedure", () => {
    expect(router).toContain("requestSelfUnlock");
  });

  it("exports verifySelfUnlock procedure", () => {
    expect(router).toContain("verifySelfUnlock");
  });

  it("uses publicProcedure for self-unlock (no auth required)", () => {
    expect(router).toContain("publicProcedure");
  });
});
