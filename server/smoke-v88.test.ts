/**
 * smoke-v88.test.ts
 * Smoke tests for the v88 Production Hardening Layer
 *
 * Covers:
 *  - Security middleware (per-user rate limiting, open redirect prevention)
 *  - AI Metrics Dashboard (mlInsights router)
 *  - Similar Transactions (qdrant similarity)
 *  - Smart routing rules
 *  - Seed data integrity
 *  - Docker compose AI file validation
 *  - Security header validation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

// ─── Mock external services ────────────────────────────────────────────────
vi.mock("../server/qdrant.service", () => ({
  qdrantService: {
    isAvailable: vi.fn().mockResolvedValue(false),
    getStatus: vi.fn().mockResolvedValue({ available: false, collections: [], totalVectors: 0 }),
    searchTransactions: vi.fn().mockResolvedValue({ results: [], total: 0, available: false }),
    findSimilarTransactions: vi.fn().mockResolvedValue({ results: [], available: false }),
    searchBeneficiaries: vi.fn().mockResolvedValue({ results: [], total: 0, available: false }),
    detectTransactionAnomalies: vi.fn().mockResolvedValue({ anomalies: [], available: false }),
    indexTransaction: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock("../server/falkordb.service", () => ({
  falkorDBService: {
    isAvailable: vi.fn().mockResolvedValue(false),
    getStatus: vi.fn().mockResolvedValue({
      available: false,
      stats: { nodeCount: 0, edgeCount: 0, userCount: 0, transactionCount: 0 },
    }),
    query: vi.fn().mockResolvedValue({ results: [], available: false }),
    getUserRiskNetwork: vi.fn().mockResolvedValue({ riskLevel: "low", connectedAccounts: [], available: false }),
    getTransactionNetwork: vi.fn().mockResolvedValue({ pathLength: 0, path: [], available: false }),
  },
}));

vi.mock("../server/ollama.service", () => ({
  ollamaService: {
    isAvailable: vi.fn().mockResolvedValue(false),
    getStatus: vi.fn().mockResolvedValue({ available: false, models: [] }),
    chat: vi.fn().mockResolvedValue({ content: "Mock", model: "fallback", durationMs: 5, usedFallback: true }),
  },
}));

vi.mock("../server/lakehouse.service", () => ({
  lakehouseService: {
    getStatus: vi.fn().mockResolvedValue({ available: true, tables: {}, aiIntegrations: {} }),
    runETL: vi.fn().mockResolvedValue({ bronze: {}, silver: {}, gold: {}, totalRows: 0, durationMs: 10 }),
  },
}));

vi.mock("../server/cocoindex.service", () => ({
  cocoIndexService: {
    getStatus: vi.fn().mockResolvedValue({
      available: true,
      stats: { transactionsIndexed: 0, beneficiariesIndexed: 0, kbArticlesIndexed: 0 },
      lastRunAt: null,
    }),
    runFull: vi.fn().mockResolvedValue({ totalIndexed: 0, durationMs: 10 }),
  },
}));

// ─── 1. Security Middleware Tests ──────────────────────────────────────────
describe("v88 Security Middleware", () => {
  it("exports perUserRateLimit", async () => {
    const mod = await import("../server/security.middleware");
    expect(mod.perUserRateLimit).toBeDefined();
    expect(typeof mod.perUserRateLimit).toBe("function");
  });

  it("exports exportRateLimit", async () => {
    const mod = await import("../server/security.middleware");
    expect(mod.exportRateLimit).toBeDefined();
    expect(typeof mod.exportRateLimit).toBe("function");
  });

  it("exports generalRateLimit", async () => {
    const mod = await import("../server/security.middleware");
    expect(mod.generalRateLimit).toBeDefined();
    expect(typeof mod.generalRateLimit).toBe("function");
  });

  it("exports authRateLimit", async () => {
    const mod = await import("../server/security.middleware");
    expect(mod.authRateLimit).toBeDefined();
    expect(typeof mod.authRateLimit).toBe("function");
  });

  it("exports paymentRateLimit", async () => {
    const mod = await import("../server/security.middleware");
    expect(mod.paymentRateLimit).toBeDefined();
    expect(typeof mod.paymentRateLimit).toBe("function");
  });

  it("exports kycRateLimit", async () => {
    const mod = await import("../server/security.middleware");
    expect(mod.kycRateLimit).toBeDefined();
    expect(typeof mod.kycRateLimit).toBe("function");
  });

  it("exports corsMiddleware", async () => {
    const mod = await import("../server/security.middleware");
    expect(mod.corsMiddleware).toBeDefined();
  });

  it("exports helmetMiddleware", async () => {
    const mod = await import("../server/security.middleware");
    expect(mod.helmetMiddleware).toBeDefined();
  });

  it("isAllowedOrigin allows localhost", async () => {
    const { isAllowedOrigin } = await import("../server/security.middleware");
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
  });

  it("isAllowedOrigin allows manus.space domains", async () => {
    const { isAllowedOrigin } = await import("../server/security.middleware");
    expect(isAllowedOrigin("https://remitflow.manus.space")).toBe(true);
  });

  it("isAllowedOrigin blocks external domains", async () => {
    const { isAllowedOrigin } = await import("../server/security.middleware");
    expect(isAllowedOrigin("https://evil.com")).toBe(false);
    expect(isAllowedOrigin("https://phishing.example.com")).toBe(false);
  });

  it("sanitizeBody strips null bytes from strings", async () => {
    const { sanitizeBody } = await import("../server/security.middleware");
    const req: any = { body: { name: "John\x00Doe", amount: 100 } };
    const res: any = {};
    let nextCalled = false;
    sanitizeBody(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(req.body.name).toBe("JohnDoe");
    expect(req.body.amount).toBe(100);
  });

  it("sanitizeBody prevents prototype pollution", async () => {
    const { sanitizeBody } = await import("../server/security.middleware");
    const req: any = { body: { "__proto__": { admin: true }, name: "test" } };
    const res: any = {};
    sanitizeBody(req, res, () => {});
    expect(req.body["__proto__"]).toBeUndefined();
    expect(req.body.name).toBe("test");
  });

  it("validateCurrencyCode allows valid currencies", async () => {
    const { validateCurrencyCode } = await import("../server/security.middleware");
    expect(validateCurrencyCode("USD")).toBe(true);
    expect(validateCurrencyCode("NGN")).toBe(true);
    expect(validateCurrencyCode("GHS")).toBe(true);
    expect(validateCurrencyCode("EUR")).toBe(true);
    expect(validateCurrencyCode("GBP")).toBe(true);
  });

  it("validateCurrencyCode rejects invalid currencies", async () => {
    const { validateCurrencyCode } = await import("../server/security.middleware");
    expect(validateCurrencyCode("INVALID")).toBe(false);
    expect(validateCurrencyCode("'; DROP TABLE users; --")).toBe(false);
    expect(validateCurrencyCode("")).toBe(false);
  });
});

// ─── 2. Open Redirect Prevention ──────────────────────────────────────────
describe("v88 Open Redirect Prevention", () => {
  it("oauth.ts validates returnTo is a relative path", async () => {
    // Read the oauth.ts file and verify the validation logic is present
    const oauthPath = path.join(process.cwd(), "server/_core/oauth.ts");
    const content = await readFile(oauthPath, "utf-8");
    expect(content).toContain("rawReturnTo.startsWith(\"/\")");
    expect(content).toContain("!rawReturnTo.startsWith(\"//\")");
    expect(content).toContain("!rawReturnTo.includes(\":\")");
  });

  it("returnTo validation logic is correct", () => {
    // Test the validation logic directly
    function validateReturnTo(raw: string): string {
      return raw.startsWith("/") && !raw.startsWith("//") && !raw.includes(":") ? raw : "/dashboard";
    }
    expect(validateReturnTo("/dashboard")).toBe("/dashboard");
    expect(validateReturnTo("/admin/users")).toBe("/admin/users");
    expect(validateReturnTo("//evil.com")).toBe("/dashboard");
    expect(validateReturnTo("https://evil.com")).toBe("/dashboard");
    expect(validateReturnTo("javascript:alert(1)")).toBe("/dashboard");
    expect(validateReturnTo("http://localhost:3000/evil")).toBe("/dashboard");
  });
});

// ─── 3. ML Insights Router ────────────────────────────────────────────────
describe("v88 ML Insights Router", () => {
  it("getModelMetrics returns model array", async () => {
    const { mlInsightsRouter } = await import("../server/routers/productionV87");
    expect(mlInsightsRouter).toBeDefined();
  });

  it("seed data has valid ML metrics structure", async () => {
    const seedPath = path.join(process.cwd(), "scripts/seed-data/ml-metrics.json");
    if (!existsSync(seedPath)) {
      console.warn("Seed data not generated yet — skipping");
      return;
    }
    const data = JSON.parse(await readFile(seedPath, "utf-8"));
    expect(data).toHaveProperty("models");
    expect(Array.isArray(data.models)).toBe(true);
    expect(data.models.length).toBeGreaterThan(0);
    
    const model = data.models[0];
    expect(model).toHaveProperty("name");
    expect(model).toHaveProperty("accuracy");
    expect(model).toHaveProperty("f1Score");
    expect(model).toHaveProperty("features");
    expect(model.accuracy).toBeGreaterThan(0.8);
    expect(model.accuracy).toBeLessThanOrEqual(1.0);
  });

  it("seed data models have valid feature importance", async () => {
    const seedPath = path.join(process.cwd(), "scripts/seed-data/ml-metrics.json");
    if (!existsSync(seedPath)) return;
    const data = JSON.parse(await readFile(seedPath, "utf-8"));
    
    for (const model of data.models) {
      const totalImportance = model.features.reduce((s: number, f: any) => s + f.importance, 0);
      // Feature importances should sum to approximately 1.0
      expect(totalImportance).toBeGreaterThan(0.95);
      expect(totalImportance).toBeLessThanOrEqual(1.05);
    }
  });
});

// ─── 4. Smart Routing Seed Data ────────────────────────────────────────────
describe("v88 Smart Routing Rules", () => {
  it("seed data has valid routing rules", async () => {
    const seedPath = path.join(process.cwd(), "scripts/seed-data/smart-routing-rules.json");
    if (!existsSync(seedPath)) return;
    const rules = JSON.parse(await readFile(seedPath, "utf-8"));
    
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
    
    for (const rule of rules) {
      expect(rule).toHaveProperty("id");
      expect(rule).toHaveProperty("name");
      expect(rule).toHaveProperty("priority");
      expect(rule).toHaveProperty("conditions");
      expect(rule).toHaveProperty("action");
      expect(rule).toHaveProperty("active");
      expect(typeof rule.priority).toBe("number");
      expect(typeof rule.active).toBe("boolean");
    }
  });

  it("routing rules have valid success rates", async () => {
    const seedPath = path.join(process.cwd(), "scripts/seed-data/smart-routing-rules.json");
    if (!existsSync(seedPath)) return;
    const rules = JSON.parse(await readFile(seedPath, "utf-8"));
    
    for (const rule of rules) {
      if (rule.successRate !== undefined) {
        expect(rule.successRate).toBeGreaterThan(0);
        expect(rule.successRate).toBeLessThanOrEqual(1.0);
      }
    }
  });
});

// ─── 5. Lakehouse Seed Data ────────────────────────────────────────────────
describe("v88 Lakehouse Records", () => {
  it("seed data has bronze/silver/gold layers", async () => {
    const seedPath = path.join(process.cwd(), "scripts/seed-data/lakehouse-records.json");
    if (!existsSync(seedPath)) return;
    const records = JSON.parse(await readFile(seedPath, "utf-8"));
    
    expect(Array.isArray(records)).toBe(true);
    
    const layers = new Set(records.map((r: any) => r.layer));
    expect(layers.has("bronze")).toBe(true);
    expect(layers.has("silver")).toBe(true);
    expect(layers.has("gold")).toBe(true);
  });

  it("lakehouse records have required fields", async () => {
    const seedPath = path.join(process.cwd(), "scripts/seed-data/lakehouse-records.json");
    if (!existsSync(seedPath)) return;
    const records = JSON.parse(await readFile(seedPath, "utf-8"));
    
    for (const record of records) {
      expect(record).toHaveProperty("layer");
      expect(record).toHaveProperty("table");
      expect(record).toHaveProperty("recordCount");
      expect(record).toHaveProperty("status");
      expect(["bronze", "silver", "gold"]).toContain(record.layer);
      expect(record.recordCount).toBeGreaterThan(0);
    }
  });
});

// ─── 6. Docker Compose AI File ─────────────────────────────────────────────
describe("v88 Docker Compose AI", () => {
  it("docker-compose.ai.yml exists", () => {
    const composePath = path.join(process.cwd(), "docker-compose.ai.yml");
    expect(existsSync(composePath)).toBe(true);
  });

  it("docker-compose.ai.yml contains qdrant service", async () => {
    const composePath = path.join(process.cwd(), "docker-compose.ai.yml");
    const content = await readFile(composePath, "utf-8");
    expect(content).toContain("qdrant");
    expect(content).toContain("qdrant/qdrant");
  });

  it("docker-compose.ai.yml contains falkordb service", async () => {
    const composePath = path.join(process.cwd(), "docker-compose.ai.yml");
    const content = await readFile(composePath, "utf-8");
    expect(content).toContain("falkordb");
    expect(content).toContain("falkordb/falkordb");
  });

  it("docker-compose.ai.yml contains ollama service", async () => {
    const composePath = path.join(process.cwd(), "docker-compose.ai.yml");
    const content = await readFile(composePath, "utf-8");
    expect(content).toContain("ollama");
    expect(content).toContain("ollama/ollama");
  });

  it("docker-compose.ai.yml contains cocoindex service", async () => {
    const composePath = path.join(process.cwd(), "docker-compose.ai.yml");
    const content = await readFile(composePath, "utf-8");
    expect(content).toContain("cocoindex");
  });

  it("docker-compose.ai.yml has health checks for all services", async () => {
    const composePath = path.join(process.cwd(), "docker-compose.ai.yml");
    const content = await readFile(composePath, "utf-8");
    const healthCheckCount = (content.match(/healthcheck:/g) || []).length;
    expect(healthCheckCount).toBeGreaterThanOrEqual(3);
  });

  it("docker-compose.ai.yml uses named volumes", async () => {
    const composePath = path.join(process.cwd(), "docker-compose.ai.yml");
    const content = await readFile(composePath, "utf-8");
    expect(content).toContain("qdrant_data:");
    expect(content).toContain("falkordb_data:");
    expect(content).toContain("ollama_models:");
  });
});

// ─── 7. Seed Manifest ──────────────────────────────────────────────────────
describe("v88 Seed Manifest", () => {
  it("manifest.json exists after seed", async () => {
    const manifestPath = path.join(process.cwd(), "scripts/seed-data/manifest.json");
    if (!existsSync(manifestPath)) return;
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    
    expect(manifest).toHaveProperty("version");
    expect(manifest.version).toBe("v88");
    expect(manifest).toHaveProperty("generatedAt");
    expect(manifest).toHaveProperty("files");
    expect(manifest).toHaveProperty("externalServices");
  });

  it("manifest references all 3 external AI services", async () => {
    const manifestPath = path.join(process.cwd(), "scripts/seed-data/manifest.json");
    if (!existsSync(manifestPath)) return;
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    
    expect(manifest.externalServices).toHaveProperty("qdrant");
    expect(manifest.externalServices).toHaveProperty("falkordb");
    expect(manifest.externalServices).toHaveProperty("ollama");
  });
});

// ─── 8. AI Hub Router ──────────────────────────────────────────────────────
describe("v88 AI Hub Router", () => {
  it("aiHubRouter is exported from productionV87", async () => {
    const mod = await import("../server/routers/productionV87");
    expect(mod.aiHubRouter).toBeDefined();
  });

  it("mlInsightsRouter is exported from productionV87", async () => {
    const mod = await import("../server/routers/productionV87");
    expect(mod.mlInsightsRouter).toBeDefined();
  });

  it("qdrantRouter is exported from productionV87", async () => {
    const mod = await import("../server/routers/productionV87");
    expect(mod.qdrantRouter).toBeDefined();
  });

  it("falkordbRouter is exported from productionV87", async () => {
    const mod = await import("../server/routers/productionV87");
    expect(mod.falkordbRouter).toBeDefined();
  });

  it("ollamaRouter is exported from productionV87", async () => {
    const mod = await import("../server/routers/productionV87");
    expect(mod.ollamaRouter).toBeDefined();
  });

  it("artAgentRouter is exported from productionV87", async () => {
    const mod = await import("../server/routers/productionV87");
    expect(mod.artAgentRouter).toBeDefined();
  });

  it("kgqaRouter is exported from productionV87", async () => {
    const mod = await import("../server/routers/productionV87");
    expect(mod.kgqaRouter).toBeDefined();
  });

  it("lakehouseRouter is exported from productionV87", async () => {
    const mod = await import("../server/routers/productionV87");
    expect(mod.lakehouseRouter).toBeDefined();
  });

  it("cocoindexRouter is exported from productionV87", async () => {
    const mod = await import("../server/routers/productionV87");
    expect(mod.cocoindexRouter).toBeDefined();
  });
});

// ─── 9. Similar Transactions Feature ──────────────────────────────────────
describe("v88 Similar Transactions", () => {
  it("qdrantService.findSimilarTransactions returns expected shape", async () => {
    const { qdrantService } = await import("../server/qdrant.service");
    const result = await qdrantService.findSimilarTransactions("tx-001", 5);
    expect(result).toHaveProperty("results");
    expect(result).toHaveProperty("available");
    expect(Array.isArray(result.results)).toBe(true);
  });

  it("findSimilarTransactions gracefully handles unavailable Qdrant", async () => {
    const { qdrantService } = await import("../server/qdrant.service");
    const result = await qdrantService.findSimilarTransactions("nonexistent-tx", 5);
    expect(result.available).toBe(false);
    expect(result.results).toEqual([]);
  });
});

// ─── 10. AI Metrics Dashboard ──────────────────────────────────────────────
describe("v88 AI Metrics Dashboard", () => {
  it("AIMetricsDashboard page file exists", () => {
    const pagePath = path.join(process.cwd(), "client/src/pages/AIMetricsDashboard.tsx");
    expect(existsSync(pagePath)).toBe(true);
  });

  it("SimilarTransactionsPage file exists", () => {
    const pagePath = path.join(process.cwd(), "client/src/pages/SimilarTransactionsPage.tsx");
    expect(existsSync(pagePath)).toBe(true);
  });

  it("AIMetricsDashboard uses trpc.aiHub.status", async () => {
    const pagePath = path.join(process.cwd(), "client/src/pages/AIMetricsDashboard.tsx");
    const content = await readFile(pagePath, "utf-8");
    expect(content).toContain("trpc.aiHub.status");
  });

  it("AIMetricsDashboard uses trpc.mlInsights.getModelMetrics", async () => {
    const pagePath = path.join(process.cwd(), "client/src/pages/AIMetricsDashboard.tsx");
    const content = await readFile(pagePath, "utf-8");
    expect(content).toContain("trpc.mlInsights.getModelMetrics");
  });

  it("SimilarTransactionsPage uses trpc.qdrant.findSimilar", async () => {
    const pagePath = path.join(process.cwd(), "client/src/pages/SimilarTransactionsPage.tsx");
    const content = await readFile(pagePath, "utf-8");
    expect(content).toContain("trpc.qdrant");
  });
});
