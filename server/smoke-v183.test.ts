/**
 * smoke-v183.test.ts — v183 Sprint Verification
 *
 * Covers:
 *  1. AdminDisputes — CopyIdButton component (Copy + Check icons, clipboard API)
 *  2. AdminDisputes — CopyIdButton on Transaction ID in Details tab
 *  3. AdminDisputes — CopyIdButton on Dispute ID in dialog title
 *  4. Stablecoin wallet stubs removed — balances/wallets return real DB rows only
 *  5. productionV87 — mock data fallback message replaced with offline message
 *  6. seed-canonical.mjs — canonical seed script exists and references seed-v134
 *  7. package.json — db:seed:canonical script added
 *  8. transferDispute — Permify PBAC import and canAccessDispute call
 *  9. transferDispute — grantTransactionAccess called on raise
 * 10. security.middleware — rate limiters applied to auth, transfer, kyc routes
 * 11. security.middleware — amplificationGuard returns 401 (not stub data)
 * 12. ConnectionQualityIndicator — globally rendered in App.tsx
 * 13. PAPSS endpoint — x-scheduled-task header auth
 * 14. AdminDisputes — EvidenceViewer component (iframe for PDF, img for image)
 * 15. AdminDisputes — SmsBadge component with sent/not-sent states
 * 16. AdminDisputes — Tabs (Details / Evidence / Resolve)
 * 17. transferDispute — adminUpdate returns smsSent flag
 * 18. transferDispute — sendDisputeSms called on status change
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");

function readServer(file: string) {
  return readFileSync(path.join(root, "server", file), "utf-8");
}
function readClient(file: string) {
  return readFileSync(path.join(root, "client", "src", file), "utf-8");
}
function readRoot(file: string) {
  return readFileSync(path.join(root, file), "utf-8");
}

// ─── 1-3. AdminDisputes CopyIdButton ─────────────────────────────────────────
describe("AdminDisputes — CopyIdButton", () => {
  const page = readClient("pages/AdminDisputes.tsx");

  it("imports Copy and Check icons from lucide-react", () => {
    expect(page).toContain("Copy,");
    expect(page).toContain("Check,");
  });

  it("defines CopyIdButton component", () => {
    expect(page).toContain("function CopyIdButton");
  });

  it("uses navigator.clipboard.writeText", () => {
    expect(page).toContain("navigator.clipboard.writeText");
  });

  it("shows Check icon when copied=true", () => {
    expect(page).toContain("copied ? <Check");
  });

  it("shows Copy icon when copied=false", () => {
    expect(page).toContain(": <Copy");
  });

  it("shows success toast on copy", () => {
    expect(page).toContain("toast.success");
    expect(page).toContain("copied to clipboard");
  });

  it("resets copied state after 2000ms", () => {
    expect(page).toContain("setTimeout(() => setCopied(false), 2000)");
  });

  it("renders CopyIdButton next to Transaction ID in Details tab", () => {
    expect(page).toContain('label="Transaction ID"');
  });

  it("renders CopyIdButton next to Dispute ID in dialog title", () => {
    expect(page).toContain('label="Dispute ID"');
  });

  it("CopyIdButton handles null/undefined value gracefully", () => {
    expect(page).toContain("if (!value && value !== 0) return null");
  });
});

// ─── 4. Stablecoin wallet stubs removed ──────────────────────────────────────
describe("missingTables — stablecoin wallet stubs removed", () => {
  const mt = readServer("routers/missingTables.ts");

  it("does not return hardcoded USDT stub", () => {
    expect(mt).not.toContain('"USDT", balance: "0.00", network: "ERC-20"');
  });

  it("does not return hardcoded USDC stub", () => {
    expect(mt).not.toContain('"USDC", balance: "0.00", network: "ERC-20"');
  });

  it("returns real DB rows only with comment", () => {
    expect(mt).toContain("Return real DB rows only");
  });

  it("balances procedure still queries stablecoinWallets table", () => {
    expect(mt).toContain("from(stablecoinWallets)");
  });
});

// ─── 5. productionV87 mock data message replaced ─────────────────────────────
describe("productionV87 — mock data fallback message", () => {
  const v87 = readServer("routers/productionV87.ts");

  it("does not contain 'return mock data' message", () => {
    expect(v87).not.toContain("graph queries return mock data");
  });

  it("contains accurate offline message", () => {
    expect(v87).toContain("graph queries unavailable (service offline)");
  });
});

// ─── 6-7. Canonical seed script ──────────────────────────────────────────────
describe("seed-canonical.mjs", () => {
  it("canonical seed script exists", () => {
    expect(existsSync(path.join(root, "scripts", "seed-canonical.mjs"))).toBe(true);
  });

  it("references seed-v134.mjs", () => {
    const seed = readFileSync(path.join(root, "scripts", "seed-canonical.mjs"), "utf-8");
    expect(seed).toContain("seed-v134.mjs");
  });

  it("package.json has db:seed:canonical script", () => {
    const pkg = JSON.parse(readRoot("package.json"));
    expect(pkg.scripts["db:seed:canonical"]).toBe("node scripts/seed-canonical.mjs");
  });
});

// ─── 8-9. Permify PBAC in transferDispute ────────────────────────────────────
describe("transferDispute — Permify PBAC", () => {
  const td = readServer("routers/transferDispute.ts");

  it("imports canAccessDispute from permify", () => {
    expect(td).toContain("canAccessDispute");
    expect(td).toContain("permify");
  });

  it("imports grantTransactionAccess from permify", () => {
    expect(td).toContain("grantTransactionAccess");
  });

  it("calls grantTransactionAccess on raise", () => {
    expect(td).toContain("grantTransactionAccess(String(ctx.user.id)");
  });

  it("calls canAccessDispute on raise", () => {
    expect(td).toContain("canAccessDispute(String(ctx.user.id)");
  });
});

// ─── 10-11. Security middleware rate limiting ─────────────────────────────────
describe("security.middleware — rate limiting", () => {
  const sm = readServer("security.middleware.ts");
  const sa = readServer("security.attacks.ts");

  it("applies generalRateLimit to /api/ routes", () => {
    expect(sm).toContain('app.use("/api/", generalRateLimit)');
  });

  it("applies authRateLimit to /api/oauth/ routes", () => {
    expect(sm).toContain('app.use("/api/oauth/", authRateLimit)');
  });

  it("applies paymentRateLimit to transfer.send", () => {
    expect(sm).toContain('app.use("/api/trpc/transfer.send", paymentRateLimit)');
  });

  it("applies kycRateLimit to kyc.uploadDocument", () => {
    expect(sm).toContain('app.use("/api/trpc/kyc.uploadDocument", kycRateLimit)');
  });

  it("amplificationGuard returns 401 for unauthenticated heavy requests", () => {
    expect(sa).toContain("Authentication required for this endpoint");
    expect(sa).toContain("res.status(401)");
  });

  it("amplificationGuard does NOT return stub data", () => {
    const guardSection = sa.slice(sa.indexOf("amplificationGuard"), sa.indexOf("amplificationGuard") + 500);
    expect(guardSection).not.toContain("stub data");
  });
});

// ─── 12. ConnectionQualityIndicator global ────────────────────────────────────
describe("App.tsx — ConnectionQualityIndicator global", () => {
  const app = readClient("App.tsx");

  it("imports ConnectionQualityIndicator", () => {
    expect(app).toContain("ConnectionQualityIndicator");
  });

  it("renders ConnectionQualityIndicator globally", () => {
    // Should appear in the JSX render section
    const renderSection = app.slice(app.lastIndexOf("return ("));
    expect(renderSection).toContain("ConnectionQualityIndicator");
  });
});

// ─── 13. PAPSS x-scheduled-task auth ─────────────────────────────────────────
describe("PAPSS endpoint — x-scheduled-task auth", () => {
  const idx = readFileSync(path.join(root, "server/_core/index.ts"), "utf-8");
  const papssBlock = idx.slice(
    Math.max(0, idx.indexOf("papss-settlement") - 200),
    idx.indexOf("papss-settlement") + 3000
  );

  it("checks x-scheduled-task header", () => {
    expect(papssBlock).toContain("x-scheduled-task");
  });

  it("sets isScheduledTask flag", () => {
    expect(papssBlock).toContain("isScheduledTask");
  });
});

// ─── 14-16. AdminDisputes evidence viewer and tabs ───────────────────────────
describe("AdminDisputes — EvidenceViewer and Tabs", () => {
  const page = readClient("pages/AdminDisputes.tsx");

  it("defines EvidenceViewer component", () => {
    expect(page).toContain("function EvidenceViewer");
  });

  it("renders iframe for PDF evidence", () => {
    expect(page).toContain("<iframe");
    expect(page).toContain("Dispute Evidence PDF");
  });

  it("renders img for image evidence", () => {
    expect(page).toContain("<img");
    expect(page).toContain("Dispute Evidence");
  });

  it("has three tabs: Details, Evidence, Resolve", () => {
    expect(page).toContain('"details"');
    expect(page).toContain('"evidence"');
    expect(page).toContain('"resolve"');
  });

  it("shows evidence badge count when evidenceUrl exists", () => {
    expect(page).toContain("selectedDispute?.evidenceUrl");
    expect(page).toContain("Badge");
  });
});

// ─── 17-18. transferDispute adminUpdate smsSent ───────────────────────────────
describe("transferDispute — adminUpdate smsSent", () => {
  const td = readServer("routers/transferDispute.ts");

  it("adminUpdate returns smsSent flag", () => {
    expect(td).toContain("smsSent");
  });

  it("calls sendDisputeSms or smsConfirm on status change", () => {
    const hasSms = td.includes("sendDisputeSms") || td.includes("smsConfirm") || td.includes("sendSms");
    expect(hasSms).toBe(true);
  });

  it("SmsBadge component in AdminDisputes shows SMS status", () => {
    const page = readClient("pages/AdminDisputes.tsx");
    expect(page).toContain("SmsBadge");
    expect(page).toContain("SMS sent to user");
    expect(page).toContain("SMS not sent");
  });
});
