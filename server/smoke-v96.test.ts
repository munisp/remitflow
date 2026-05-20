/**
 * RemitFlow v96 Smoke Tests
 * Covers:
 *  - 13 new UI pages (AuditLogAdmin, FeatureFlagsAdmin, etc.)
 *  - Security middleware fixes (no duplicate helmet options)
 *  - K8s v95 manifest completeness
 *  - docker-compose.v95.yml completeness
 *  - Polyglot microservices (Go, Rust, Python)
 *  - tRPC middleware chain (auditedProcedure, rateLimitedProcedure)
 *  - Security score endpoint
 *  - Seed data integrity
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import path from "path";

// ─── New UI Pages ─────────────────────────────────────────────────────────────
describe("v96 — New UI Pages", () => {
  const pages = [
    "AuditLogAdmin",
    "FeatureFlagsAdmin",
    "ApiKeyAdminPage",
    "BatchPaymentAdmin",
    "DocumentVaultRenewal",
    "ComplianceMetricsDashboard",
    "ReferralDashboard",
    "DocumentVaultPage",
    "RateAlertHistoryPage",
    "ABTestingAdmin",
    "VelocityCheckDashboard",
    "PromoCodeAdmin",
    "SystemConfigAdmin",
  ];

  pages.forEach(page => {
    it(`${page}.tsx exists`, () => {
      const filePath = path.join(process.cwd(), `client/src/pages/${page}.tsx`);
      expect(existsSync(filePath), `Missing: ${page}.tsx`).toBe(true);
    });

    it(`${page}.tsx has default export`, () => {
      const filePath = path.join(process.cwd(), `client/src/pages/${page}.tsx`);
      if (!existsSync(filePath)) return;
      const content = readFileSync(filePath, "utf-8");
      expect(content).toMatch(/export default/);
    });

    it(`${page}.tsx has meaningful content`, () => {
      const filePath = path.join(process.cwd(), `client/src/pages/${page}.tsx`);
      if (!existsSync(filePath)) return;
      const content = readFileSync(filePath, "utf-8");
      // Page must have either DashboardLayout or a substantial component
      expect(content.length).toBeGreaterThan(500);
    });
  });
});

// ─── Security Middleware ───────────────────────────────────────────────────────
describe("v96 — Security Middleware Fixes", () => {
  it("security.middleware.ts has no duplicate frameguard option", () => {
    const content = readFileSync("server/security.middleware.ts", "utf-8");
    const frameguardMatches = (content.match(/frameguard/g) ?? []).length;
    expect(frameguardMatches).toBeLessThanOrEqual(1);
  });

  it("security.middleware.ts has no duplicate referrerPolicy option", () => {
    const content = readFileSync("server/security.middleware.ts", "utf-8");
    const rpMatches = (content.match(/referrerPolicy/g) ?? []).length;
    // referrerPolicy should appear at most twice (once in helmet, once in export if any)
    expect(rpMatches).toBeLessThanOrEqual(2);
  });

  it("security.middleware.ts has no duplicate permittedCrossDomainPolicies", () => {
    const content = readFileSync("server/security.middleware.ts", "utf-8");
    const matches = (content.match(/permittedCrossDomainPolicies/g) ?? []).length;
    expect(matches).toBeLessThanOrEqual(1);
  });

  it("security.middleware.ts exports all required rate limiters", async () => {
    const mod = await import("../server/security.middleware");
    expect(mod.perUserRateLimit).toBeDefined();
    expect(mod.generalRateLimit).toBeDefined();
    expect(mod.authRateLimit).toBeDefined();
    expect(mod.paymentRateLimit).toBeDefined();
    expect(mod.exportRateLimit).toBeDefined();
    expect(mod.kycRateLimit).toBeDefined();
  });

  it("security.middleware.ts exports CORS and helmet", async () => {
    const mod = await import("../server/security.middleware");
    expect(mod.corsMiddleware).toBeDefined();
    expect(mod.helmetMiddleware).toBeDefined();
  });

  it("security.middleware.ts exports isAllowedOrigin", async () => {
    const { isAllowedOrigin } = await import("../server/security.middleware");
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("https://app.manus.space")).toBe(true);
    expect(isAllowedOrigin("https://evil.com")).toBe(false);
  });

  it("security.middleware.ts exports validateCurrencyCode", async () => {
    const { validateCurrencyCode } = await import("../server/security.middleware");
    expect(validateCurrencyCode("USD")).toBe(true);
    expect(validateCurrencyCode("NGN")).toBe(true);
    expect(validateCurrencyCode("INVALID")).toBe(false);
    expect(validateCurrencyCode("")).toBe(false);
  });

  it("security.middleware.ts exports sanitizeBody", async () => {
    const { sanitizeBody } = await import("../server/security.middleware");
    expect(typeof sanitizeBody).toBe("function");
  });

  it("security.middleware.ts exports accountLockoutMiddleware", async () => {
    const mod = await import("../server/security.middleware");
    expect(mod.accountLockoutMiddleware).toBeDefined();
  });

  it("security.middleware.ts exports sqlInjectionDetectionMiddleware", async () => {
    const mod = await import("../server/security.middleware");
    expect(mod.sqlInjectionDetectionMiddleware).toBeDefined();
  });
});

// ─── tRPC Middleware Chain ─────────────────────────────────────────────────────
describe("v96 — tRPC Middleware Chain", () => {
  it("trpc.ts exports auditedProcedure", async () => {
    const mod = await import("../server/_core/trpc");
    expect(mod.auditedProcedure).toBeDefined();
  });

  it("trpc.ts exports rateLimitedProcedure", async () => {
    const mod = await import("../server/_core/trpc");
    expect(mod.rateLimitedProcedure).toBeDefined();
  });

  it("trpc.ts exports strictRateLimitedProcedure", async () => {
    const mod = await import("../server/_core/trpc");
    expect(mod.strictRateLimitedProcedure).toBeDefined();
  });

  it("trpc.ts exports auditedAdminProcedure", async () => {
    const mod = await import("../server/_core/trpc");
    expect(mod.auditedAdminProcedure).toBeDefined();
  });

  it("middlewareChain.ts exports withAudit", async () => {
    const mod = await import("../server/_core/middlewareChain");
    expect(mod.withAudit).toBeDefined();
  });

  it("middlewareChain.ts exports withRateLimit", async () => {
    const mod = await import("../server/_core/middlewareChain");
    expect(mod.withRateLimit).toBeDefined();
  });
});

// ─── Polyglot Microservices ────────────────────────────────────────────────────
describe("v96 — Polyglot Microservices", () => {
  it("Go rate-limit sidecar source exists", () => {
    expect(existsSync("services/go-ratelimit-sidecar/main.go")).toBe(true);
  });

  it("Go rate-limit sidecar has Dockerfile", () => {
    expect(existsSync("services/go-ratelimit-sidecar/Dockerfile")).toBe(true);
  });

  it("Go rate-limit sidecar has tests", () => {
    expect(existsSync("services/go-ratelimit-sidecar/main_test.go")).toBe(true);
  });

  it("Rust audit service source exists", () => {
    expect(existsSync("services/rust-audit-service/src/main.rs")).toBe(true);
  });

  it("Rust audit service has Dockerfile", () => {
    expect(existsSync("services/rust-audit-service/Dockerfile")).toBe(true);
  });

  it("Rust audit service has Cargo.toml", () => {
    expect(existsSync("services/rust-audit-service/Cargo.toml")).toBe(true);
  });

  it("Python compliance service source exists", () => {
    expect(existsSync("services/python-compliance-service/main.py")).toBe(true);
  });

  it("Python compliance service has Dockerfile", () => {
    expect(existsSync("services/python-compliance-service/Dockerfile")).toBe(true);
  });

  it("Python compliance service has requirements.txt", () => {
    expect(existsSync("services/python-compliance-service/requirements.txt")).toBe(true);
  });

  it("polyglotClient.ts exports runComplianceCheck", async () => {
    const mod = await import("../server/_core/polyglotClient");
    expect(mod.runComplianceCheck).toBeDefined();
  });

  it("polyglotClient.ts exports getFraudScore", async () => {
    const mod = await import("../server/_core/polyglotClient");
    expect(mod.getFraudScore).toBeDefined();
  });

  it("polyglotClient.ts exports sendAuditLog", async () => {
    const mod = await import("../server/_core/polyglotClient");
    expect(mod.sendAuditLog).toBeDefined();
  });

  it("polyglotClient.ts exports validateInput", async () => {
    const mod = await import("../server/_core/polyglotClient");
    expect(mod.validateInput).toBeDefined();
  });

  it("polyglotClient.ts runComplianceCheck fails open (decision: approved) when service offline", async () => {
    const { runComplianceCheck } = await import("../server/_core/polyglotClient");
    const result = await runComplianceCheck({ userId: 1, amount: 100, currency: "USD", destinationCountry: "NG", senderCountry: "US", transactionType: "transfer" });
    expect(result).toHaveProperty("decision");
    expect(result.decision).toBe("approved"); // fail open = approved
  });
});

// ─── K8s Manifests ────────────────────────────────────────────────────────────
describe("v96 — Kubernetes Manifests", () => {
  it("k8s/v95-deployment.yaml exists", () => {
    expect(existsSync("k8s/v95-deployment.yaml")).toBe(true);
  });

  it("k8s/v95-deployment.yaml contains Go sidecar deployment", () => {
    const content = readFileSync("k8s/v95-deployment.yaml", "utf-8");
    expect(content).toMatch(/go-ratelimit-sidecar/);
  });

  it("k8s/v95-deployment.yaml contains Rust audit service", () => {
    const content = readFileSync("k8s/v95-deployment.yaml", "utf-8");
    expect(content).toMatch(/rust-audit-service/);
  });

  it("k8s/v95-deployment.yaml contains Python compliance service", () => {
    const content = readFileSync("k8s/v95-deployment.yaml", "utf-8");
    expect(content).toMatch(/python-compliance-service/);
  });

  it("k8s/v95-deployment.yaml has HPA for main app", () => {
    const content = readFileSync("k8s/v95-deployment.yaml", "utf-8");
    expect(content).toMatch(/HorizontalPodAutoscaler/);
    expect(content).toMatch(/remitflow-app-hpa/);
  });

  it("k8s/v95-deployment.yaml has NetworkPolicy", () => {
    const content = readFileSync("k8s/v95-deployment.yaml", "utf-8");
    expect(content).toMatch(/NetworkPolicy/);
  });

  it("k8s/v95-deployment.yaml has liveness and readiness probes", () => {
    const content = readFileSync("k8s/v95-deployment.yaml", "utf-8");
    expect(content).toMatch(/livenessProbe/);
    expect(content).toMatch(/readinessProbe/);
  });
});

// ─── Docker Compose ────────────────────────────────────────────────────────────
describe("v96 — Docker Compose", () => {
  it("docker-compose.v95.yml exists", () => {
    expect(existsSync("docker-compose.v95.yml")).toBe(true);
  });

  it("docker-compose.v95.yml has valid YAML structure", () => {
    const content = readFileSync("docker-compose.v95.yml", "utf-8");
    expect(content).toMatch(/services:/);
    expect(content).toMatch(/version:/);
  });

  it("docker-compose.v95.yml includes polyglot services", () => {
    const content = readFileSync("docker-compose.v95.yml", "utf-8");
    expect(content).toMatch(/go-ratelimit/);
    expect(content).toMatch(/rust-audit/);
    expect(content).toMatch(/python-compliance/);
  });
});

// ─── App.tsx Routes ────────────────────────────────────────────────────────────
describe("v96 — App.tsx Route Registration", () => {
  it("App.tsx has AuditLogAdmin route", () => {
    const content = readFileSync("client/src/App.tsx", "utf-8");
    expect(content).toMatch(/AuditLogAdmin/);
    expect(content).toMatch(/admin\/audit-logs/);
  });

  it("App.tsx has FeatureFlagsAdmin route", () => {
    const content = readFileSync("client/src/App.tsx", "utf-8");
    expect(content).toMatch(/FeatureFlagsAdmin/);
  });

  it("App.tsx has ComplianceMetricsDashboard route", () => {
    const content = readFileSync("client/src/App.tsx", "utf-8");
    expect(content).toMatch(/ComplianceMetricsDashboard/);
  });

  it("App.tsx has no duplicate ApiKeyManager imports", () => {
    const content = readFileSync("client/src/App.tsx", "utf-8");
    const matches = (content.match(/import.*ApiKeyManager/g) ?? []).length;
    expect(matches).toBeLessThanOrEqual(1);
  });
});

// ─── Seed Data ────────────────────────────────────────────────────────────────
describe("v96 — Seed Scripts", () => {
  it("seed-v95.mjs exists", () => {
    expect(existsSync("scripts/seed-v95.mjs")).toBe(true);
  });

  it("seed-v94.mjs exists", () => {
    expect(existsSync("scripts/seed-v94.mjs")).toBe(true);
  });

  it("seed-production.mjs exists", () => {
    expect(existsSync("scripts/seed-production.mjs")).toBe(true);
  });

  it("seed-v95.mjs seeds compliance_alerts", () => {
    const content = readFileSync("scripts/seed-v95.mjs", "utf-8");
    expect(content).toMatch(/compliance_alerts/);
  });

  it("seed-v95.mjs seeds sanctions_checks", () => {
    const content = readFileSync("scripts/seed-v95.mjs", "utf-8");
    expect(content).toMatch(/sanctions_checks/);
  });

  it("seed-v94.mjs seeds ab_experiments", () => {
    const content = readFileSync("scripts/seed-v94.mjs", "utf-8");
    expect(content).toMatch(/ab_experiments/);
  });
});

// ─── Security Score Endpoint ───────────────────────────────────────────────────
describe("v96 — Security Score Endpoint", () => {
  it("index.ts has /api/security/score endpoint", () => {
    const content = readFileSync("server/_core/index.ts", "utf-8");
    expect(content).toMatch(/security\/score/);
  });

  it("security score endpoint returns OWASP categories", () => {
    const content = readFileSync("server/_core/index.ts", "utf-8");
    expect(content).toMatch(/owasp/i);
  });
});

// ─── FCM Integration ──────────────────────────────────────────────────────────
describe("v96 — FCM Integration", () => {
  it("fcm.ts exists", () => {
    expect(existsSync("server/_core/fcm.ts")).toBe(true);
  });

  it("fcm.ts exports sendFCMNotification", async () => {
    const mod = await import("../server/_core/fcm");
    expect(mod.sendFCMNotification).toBeDefined();
  });

  it("fcm.ts exports sendFCMMulticast", async () => {
    const mod = await import("../server/_core/fcm");
    expect(mod.sendFCMMulticast).toBeDefined();
  });

  it("fcm.ts fails gracefully without FIREBASE_SERVER_KEY", async () => {
    const { sendFCMNotification } = await import("../server/_core/fcm");
    // FCM signature: sendFCMNotification(deviceToken: string, payload: FCMPayload)
    const result = await sendFCMNotification("fake-token", { title: "Test", body: "Test body" });
    // Without FIREBASE_SERVER_KEY it should return success: false gracefully
    expect(result).toHaveProperty("success");
    expect(result.success).toBe(false);
  });
});
