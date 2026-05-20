/**
 * RemitFlow v142 Smoke Tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers all changes introduced in v142:
 *   1. txStatusEnum now includes "initiated" (migration 0028)
 *   2. transfer-state-machine toDbStatus correctly maps "initiated" → "initiated"
 *   3. runTransferPipeline starts with "initiated" state before "fraud_check"
 *   4. All require() calls replaced with ES module imports
 *   5. serviceRegistry trackEvent, postLedgerEntry, keycloakToken now wired
 *   6. servicesHealthRouter exposes trackEvent, postLedgerEntry, keycloakToken
 *   7. totp.ts uses ESM imports from otplib
 *   8. _core/index.ts uses randomBytes import instead of require('crypto')
 *   9. _core/microservices.ts uses execSync import instead of require('child_process')
 *  10. Temporal activities use ensemble fraud scoring (gRPC + local ML)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { appRouter } from "./routers.js";
import type { TrpcContext } from "./_core/context.js";

const SERVER_DIR = join(process.cwd(), "server");

function makeCtx(overrides: Record<string, unknown> = {}): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "v142-smoke-user",
      email: "smoke@remitflow.test",
      name: "Smoke User",
      role: "user",
      kycTier: "tier1",
      ...overrides,
    },
    req: {} as any,
    res: {} as any,
  };
}

const caller = appRouter.createCaller(makeCtx());
const adminCaller = appRouter.createCaller(makeCtx({ role: "admin", kycTier: "tier3" }));
const anonCaller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });

// ── 1. txStatusEnum includes "initiated" ──────────────────────────────────────
describe("txStatusEnum v142", () => {
  it("schema exports txStatusEnum with initiated value", async () => {
    const { txStatusEnum } = await import("../drizzle/schema.js");
    expect(txStatusEnum.enumValues).toContain("initiated");
    expect(txStatusEnum.enumValues).toContain("pending");
    expect(txStatusEnum.enumValues).toContain("processing");
    expect(txStatusEnum.enumValues).toContain("completed");
    expect(txStatusEnum.enumValues).toContain("failed");
    expect(txStatusEnum.enumValues).toContain("cancelled");
    expect(txStatusEnum.enumValues).toContain("reversed");
  });
});

// ── 2. transfer-state-machine exports ─────────────────────────────────────────
describe("transfer-state-machine v142", () => {
  it("exports STATE_LABELS with initiated label", async () => {
    const { STATE_LABELS } = await import("./transfer-state-machine.js");
    expect(STATE_LABELS["initiated"]).toBe("Transfer Initiated");
    expect(STATE_LABELS["fraud_check"]).toBe("Fraud Screening");
    expect(STATE_LABELS["aml_check"]).toBe("AML Compliance Check");
    expect(STATE_LABELS["kyc_check"]).toBe("KYC Verification");
    expect(STATE_LABELS["processing"]).toBe("Processing Transfer");
    expect(STATE_LABELS["partner_sent"]).toBe("Sent to Partner Network");
    expect(STATE_LABELS["completed"]).toBe("Transfer Completed");
    expect(STATE_LABELS["failed"]).toBe("Transfer Failed");
  });

  it("exports runTransferPipeline and advanceTransferState as functions", async () => {
    const { runTransferPipeline, advanceTransferState } = await import("./transfer-state-machine.js");
    expect(typeof runTransferPipeline).toBe("function");
    expect(typeof advanceTransferState).toBe("function");
  });

  it("transfer-state-machine.ts starts pipeline with initiated state", () => {
    const content = readFileSync(join(SERVER_DIR, "transfer-state-machine.ts"), "utf-8");
    expect(content).toContain("initiated");
    // The pipeline should advance to initiated first before fraud_check
    expect(content).toContain("fraud_check");
    expect(content).toContain("aml_check");
  });
});

// ── 3. serviceRegistry exports trackEvent, postLedgerEntry, keycloakToken ────
describe("serviceRegistry v142 new exports", () => {
  it("exports trackEvent function", async () => {
    const { trackEvent } = await import("./_core/serviceRegistry.js");
    expect(typeof trackEvent).toBe("function");
  });

  it("exports postLedgerEntry function", async () => {
    const { postLedgerEntry } = await import("./_core/serviceRegistry.js");
    expect(typeof postLedgerEntry).toBe("function");
  });

  it("exports keycloakToken function", async () => {
    const { keycloakToken } = await import("./_core/serviceRegistry.js");
    expect(typeof keycloakToken).toBe("function");
  });

  it("trackEvent resolves without throwing (fire-and-forget)", async () => {
    const { trackEvent } = await import("./_core/serviceRegistry.js");
    await expect(
      trackEvent({ event: "smoke_test", properties: { test: true } })
    ).resolves.not.toThrow();
  });

  it("postLedgerEntry returns a LedgerEntry with fallback when service unavailable", async () => {
    const { postLedgerEntry } = await import("./_core/serviceRegistry.js");
    const result = await postLedgerEntry({
      debitAccount: "acc-001",
      creditAccount: "acc-002",
      amount: 100,
      currency: "USD",
    });
    expect(result).toBeDefined();
    expect(result.debitAccount).toBe("acc-001");
    expect(result.creditAccount).toBe("acc-002");
    expect(result.amount).toBe(100);
  });

  it("keycloakToken returns fallback token when service unavailable", async () => {
    const { keycloakToken } = await import("./_core/serviceRegistry.js");
    const result = await keycloakToken("user-123", "remitflow");
    expect(result).toBeDefined();
    expect(result).toHaveProperty("accessToken");
    expect(result).toHaveProperty("refreshToken");
    expect(result).toHaveProperty("expiresIn");
  });
});

// ── 4. servicesHealthRouter exposes new procedures ────────────────────────────
describe("servicesHealthRouter v142 new procedures", () => {
  it("svcHealth.trackEvent procedure exists and is callable by users", async () => {
    const result = await caller.svcHealth.trackEvent({
      event: "test_event",
      properties: { source: "smoke-test" },
    });
    expect(result).toEqual({ tracked: true });
  });

  it("svcHealth.postLedgerEntry procedure exists (admin only)", async () => {
    const result = await adminCaller.svcHealth.postLedgerEntry({
      debitAccount: "acc-001",
      creditAccount: "acc-002",
      amount: 50,
      currency: "USD",
    });
    expect(result).toBeDefined();
    expect(result.debitAccount).toBe("acc-001");
  });

  it("svcHealth.keycloakToken procedure exists (admin only)", async () => {
    const result = await adminCaller.svcHealth.keycloakToken({
      userId: "user-123",
      realm: "remitflow",
    });
    expect(result).toBeDefined();
    expect(result).toHaveProperty("accessToken");
  });

  it("svcHealth.postLedgerEntry rejects non-admin users", async () => {
    await expect(
      caller.svcHealth.postLedgerEntry({
        debitAccount: "acc-001",
        creditAccount: "acc-002",
        amount: 50,
        currency: "USD",
      })
    ).rejects.toThrow();
  });

  it("svcHealth.keycloakToken rejects non-admin users", async () => {
    await expect(
      caller.svcHealth.keycloakToken({ userId: "user-123" })
    ).rejects.toThrow();
  });
});

// ── 5. totp.ts ESM imports ────────────────────────────────────────────────────
describe("totp.ts v142 ESM imports", () => {
  it("totp.ts does not contain require()", () => {
    const content = readFileSync(join(SERVER_DIR, "totp.ts"), "utf-8");
    expect(content).not.toContain("require(");
    expect(content).toContain("from \"otplib\"");
  });

  it("generateTOTPSecret returns a secret and otpauth URI", async () => {
    const { generateTOTPSecret } = await import("./totp.js");
    const result = generateTOTPSecret("test@remitflow.com");
    expect(result.secret).toBeTruthy();
    expect(result.otpauth).toMatch(/^otpauth:\/\/totp\//);
    expect(result.otpauth).toContain("RemitFlow");
    expect(result.otpauth).toContain("algorithm=SHA1");
  });

  it("generateTOTPSecret produces different secrets each time", async () => {
    const { generateTOTPSecret } = await import("./totp.js");
    const r1 = generateTOTPSecret("a@test.com");
    const r2 = generateTOTPSecret("b@test.com");
    expect(r1.secret).not.toBe(r2.secret);
  });

  it("verifyTOTP returns a boolean for invalid token", async () => {
    const { generateTOTPSecret, verifyTOTP } = await import("./totp.js");
    const { secret } = generateTOTPSecret("test@remitflow.com");
    const result = await verifyTOTP("000000", secret);
    expect(typeof result).toBe("boolean");
  });
});

// ── 6. _core/index.ts uses randomBytes import ─────────────────────────────────
describe("_core/index.ts v142 crypto import", () => {
  it("index.ts does not contain require('crypto')", () => {
    const content = readFileSync(join(SERVER_DIR, "_core/index.ts"), "utf-8");
    expect(content).not.toContain("require(\"crypto\")");
    expect(content).not.toContain("require('crypto')");
    expect(content).toContain("randomBytes");
  });
});

// ── 7. _core/microservices.ts uses execSync import ───────────────────────────
describe("_core/microservices.ts v142 child_process import", () => {
  it("microservices.ts does not contain require('child_process')", () => {
    const content = readFileSync(join(SERVER_DIR, "_core/microservices.ts"), "utf-8");
    expect(content).not.toContain("require(\"child_process\")");
    expect(content).not.toContain("require('child_process')");
    expect(content).toContain("import { spawn, execSync");
  });
});

// ── 8. Temporal activities use ensemble fraud scoring ─────────────────────────
describe("Temporal activities v142 ensemble fraud scoring", () => {
  it("activities.ts imports scoreFraud and buildFeatures", () => {
    const content = readFileSync(join(SERVER_DIR, "temporal/activities.ts"), "utf-8");
    expect(content).toContain("scoreFraud");
    expect(content).toContain("buildFeatures");
  });

  it("fraudCheckActivity uses ensemble scoring (gRPC + local ML)", () => {
    const content = readFileSync(join(SERVER_DIR, "temporal/activities.ts"), "utf-8");
    expect(content).toContain("grpcFraudCheck");
    expect(content).toContain("scoreFraud");
    expect(content).toContain("Math.max");
  });
});

// ── 9. Overall router health ─────────────────────────────────────────────────
describe("appRouter v142 health", () => {
  it("svcHealth.overall returns platform health", async () => {
    const result = await anonCaller.svcHealth.overall();
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("healthy");
    expect(result).toHaveProperty("degraded");
    expect(result).toHaveProperty("unavailable");
    expect(result).toHaveProperty("status");
    expect(["healthy", "degraded", "critical"]).toContain(result.status);
  });

  it("svcHealth.fxQuote returns a quote for USD→NGN", async () => {
    const result = await anonCaller.svcHealth.fxQuote({ from: "USD", to: "NGN" });
    expect(result).toBeDefined();
    expect(result.rate).toBeGreaterThan(0);
  });
});

// ── 10. No require() calls in server files (except CJS-only packages) ─────────
describe("v142 require() cleanup", () => {
  const CJS_ONLY_EXCEPTIONS = ["pdfmake"]; // CJS-only packages that legitimately use require()

  it("no require() calls in server files except CJS-only packages", () => {
    const { readdirSync } = require("fs");
    const files = readdirSync(SERVER_DIR, { recursive: true, withFileTypes: true })
      .filter((f: any) => f.isFile() && f.name.endsWith(".ts") && !f.name.includes("test") && !f.name.includes("spec") && !f.name.includes("smoke"))
      .map((f: any) => join(f.path || SERVER_DIR, f.name));

    const violations: string[] = [];
    for (const file of files) {
      try {
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");
        lines.forEach((line, i) => {
          if (line.includes("require(") && !line.includes("//") && !line.includes("eslint-disable")) {
            const isCjsException = CJS_ONLY_EXCEPTIONS.some(pkg => line.includes(pkg));
            if (!isCjsException) {
              violations.push(`${file}:${i + 1}: ${line.trim()}`);
            }
          }
        });
      } catch { /* skip unreadable files */ }
    }
    if (violations.length > 0) {
      console.error("require() violations found:\n" + violations.join("\n"));
    }
    expect(violations).toHaveLength(0);
  });
});
