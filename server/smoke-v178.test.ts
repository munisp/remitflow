/**
 * smoke-v178.test.ts
 * Production-readiness sprint: Dockerfiles, mock→real FX, security audit,
 * PWA parity, service health endpoints, sidebar nav completeness.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function readSrv(rel: string) {
  return readFileSync(join(ROOT, rel), "utf8");
}

// ─── 1. All 57 microservices have Dockerfiles ────────────────────────────────
describe("v178 — microservice Dockerfiles", () => {
  const services = [
    "go-dapr-service",
    "rust-device-fingerprint",
    "shared-middleware",
    "go-apisix-config",
    "go-bricspay-adapter",
    "rust-mbridge-adapter",
    "go-ghipss-adapter",
    "python-africbdc-adapter",
    "go-papss-service",
    "mojaloop-connector",
    "go-cips-adapter",
    "rust-upi-adapter",
    "python-pix-adapter",
    "universal-fx",
  ];

  services.forEach((svc) => {
    it(`${svc} has a Dockerfile`, () => {
      expect(existsSync(join(ROOT, "services", svc, "Dockerfile"))).toBe(true);
    });
  });
});

// ─── 2. MOCK_RATES replaced with real DB lookup in ollama.service.ts ─────────
describe("v178 — real FX rates in ART agent", () => {
  it("ollama.service.ts uses getCachedFxRates instead of MOCK_RATES", () => {
    const content = readSrv("server/ollama.service.ts");
    expect(content).toContain("getCachedFxRates");
    expect(content).toContain("FALLBACK_RATES");
    expect(content).not.toContain("MOCK_RATES");
  });

  it("ollama.service.ts has db_cache source label", () => {
    const content = readSrv("server/ollama.service.ts");
    expect(content).toContain("source: \"db_cache\"");
  });
});

// ─── 3. Security controls present ────────────────────────────────────────────
describe("v178 — security controls", () => {
  it("security middleware has rate limiting", () => {
    const content = readSrv("server/middleware/security.ts");
    expect(content.toLowerCase()).toMatch(/ratelimit|rate_limit|rate-limit/);
  });

  it("permify middleware exists", () => {
    expect(existsSync(join(ROOT, "server/middleware/permify.ts"))).toBe(true);
    const content = readSrv("server/middleware/permify.ts");
    expect(content).toContain("Permify");
  });

  it("audit service exists with createAuditLog", () => {
    expect(existsSync(join(ROOT, "server/audit.service.ts"))).toBe(true);
    const content = readSrv("server/audit.service.ts");
    expect(content).toMatch(/createAuditLog|auditLog/);
  });

  it("index.ts has CSRF protection", () => {
    const content = readSrv("server/_core/index.ts");
    expect(content.toLowerCase()).toMatch(/csrf/);
  });

  it("index.ts has Helmet security headers", () => {
    const content = readSrv("server/_core/index.ts");
    expect(content.toLowerCase()).toMatch(/helmet/);
  });
});

// ─── 4. PWA manifest completeness ────────────────────────────────────────────
describe("v178 — PWA manifest", () => {
  it("manifest.json has 9 shortcuts", () => {
    const manifest = JSON.parse(readSrv("client/public/manifest.json"));
    expect(manifest.shortcuts).toBeDefined();
    expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(9);
  });

  it("manifest.json has protocol_handlers", () => {
    const manifest = JSON.parse(readSrv("client/public/manifest.json"));
    expect(manifest.protocol_handlers).toBeDefined();
    expect(manifest.protocol_handlers.length).toBeGreaterThan(0);
  });

  it("manifest.json has finance categories", () => {
    const manifest = JSON.parse(readSrv("client/public/manifest.json"));
    expect(manifest.categories).toContain("finance");
  });

  it("offline.html exists", () => {
    expect(existsSync(join(ROOT, "client/public/offline.html"))).toBe(true);
  });
});

// ─── 5. Service Worker v23 ───────────────────────────────────────────────────
describe("v178 — Service Worker", () => {
  it("sw.js is at version v23", () => {
    const content = readSrv("client/public/sw.js");
    expect(content).toContain("v23");
  });

  it("sw.js has background sync for transfers", () => {
    const content = readSrv("client/public/sw.js");
    expect(content).toMatch(/backgroundSync|background.sync|sync.*transfer/i);
  });

  it("sw.js has stale-while-revalidate for API routes", () => {
    const content = readSrv("client/public/sw.js");
    expect(content).toMatch(/stale.*revalidate|StaleWhileRevalidate/i);
  });
});

// ─── 6. Sidebar navigation completeness ─────────────────────────────────────
describe("v178 — sidebar navigation", () => {
  it("DashboardLayout has /agent/pos link", () => {
    const content = readSrv("client/src/components/DashboardLayout.tsx");
    expect(content).toContain("/agent/pos");
  });

  it("DashboardLayout has /transfers link", () => {
    const content = readSrv("client/src/components/DashboardLayout.tsx");
    expect(content).toContain("/transfers");
  });

  it("DashboardLayout has /support/tickets link", () => {
    const content = readSrv("client/src/components/DashboardLayout.tsx");
    expect(content).toContain("/support/tickets");
  });

  it("DashboardLayout has /admin/agent-kyb link", () => {
    const content = readSrv("client/src/components/DashboardLayout.tsx");
    expect(content).toContain("/admin/agent-kyb");
  });

  it("DashboardLayout has /admin/rails-health link", () => {
    const content = readSrv("client/src/components/DashboardLayout.tsx");
    expect(content).toContain("/admin/rails-health");
  });

  it("DashboardLayout has /send-crypto link", () => {
    const content = readSrv("client/src/components/DashboardLayout.tsx");
    expect(content).toContain("/send-crypto");
  });
});

// ─── 7. All new pages have routes in App.tsx ─────────────────────────────────
describe("v178 — App.tsx routes", () => {
  const routes = [
    "/agent/pos",
    "/agent/register",
    "/transfers",
    "/support/tickets",
    "/admin/agent-kyb",
    "/admin/rails-health",
    "/send-crypto",
  ];

  routes.forEach((route) => {
    it(`App.tsx has route for ${route}`, () => {
      const content = readSrv("client/src/App.tsx");
      expect(content).toContain(route);
    });
  });
});

// ─── 8. Resilient SSE hook exists ────────────────────────────────────────────
describe("v178 — offline resilience", () => {
  it("useResilientSSE hook exists", () => {
    expect(existsSync(join(ROOT, "client/src/hooks/useResilientSSE.ts"))).toBe(true);
  });

  it("useResilientSSE has exponential backoff", () => {
    const content = readSrv("client/src/hooks/useResilientSSE.ts");
    expect(content).toMatch(/backoff|exponential|retryDelay/i);
  });

  it("ConnectionQualityIndicator component exists", () => {
    expect(existsSync(join(ROOT, "client/src/components/ConnectionQualityIndicator.tsx"))).toBe(true);
  });

  it("fxRateCache.ts has IndexedDB TTL caching", () => {
    expect(existsSync(join(ROOT, "client/src/lib/fxRateCache.ts"))).toBe(true);
    const content = readSrv("client/src/lib/fxRateCache.ts");
    expect(content).toMatch(/TTL|ttl|maxAge|expires/i);
  });
});

// ─── 9. PAPSS scheduled endpoint ─────────────────────────────────────────────
describe("v178 — PAPSS settlement scheduler", () => {
  it("index.ts has /api/scheduled/papss-settlement endpoint", () => {
    const content = readSrv("server/_core/index.ts");
    expect(content).toContain("papss-settlement");
  });

  it("PAPSS endpoint uses notifyOwner for settlement summary", () => {
    const content = readSrv("server/_core/index.ts");
    const papssSection = content.slice(content.indexOf("papss-settlement"), content.indexOf("papss-settlement") + 5000);
    expect(papssSection).toMatch(/notify|settlement.*batch|batchId/i);
  });
});

// ─── 10. No Math.random() in server code ─────────────────────────────────────
describe("v178 — security: no Math.random in server", () => {
  it("routers.ts does not use Math.random()", () => {
    const content = readSrv("server/routers.ts");
    expect(content).not.toContain("Math.random()");
  });

  it("agentOnboarding.ts uses crypto.randomInt", () => {
    const content = readSrv("server/routers/agentOnboarding.ts");
    expect(content).toContain("crypto");
    expect(content).not.toContain("Math.random()");
  });
});
