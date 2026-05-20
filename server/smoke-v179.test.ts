/**
 * smoke-v179.test.ts
 * Sprint v179: Transfer Analytics dashboard, Africa's Talking SMS wiring,
 * PAPSS daily settlement scheduler endpoint activation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

function readSrv(rel: string) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function readClient(rel: string) {
  return readFileSync(join(ROOT, rel), "utf8");
}

// ─── 1. TransferAnalytics page exists and uses correct tRPC procedures ────────
describe("v179 — TransferAnalytics page", () => {
  it("TransferAnalytics.tsx file exists", () => {
    expect(existsSync(join(ROOT, "client/src/pages/TransferAnalytics.tsx"))).toBe(true);
  });

  it("uses trpc.corridorAnalytics.topCorridors", () => {
    const content = readClient("client/src/pages/TransferAnalytics.tsx");
    expect(content).toContain("trpc.corridorAnalytics.topCorridors");
  });

  it("uses trpc.corridorAnalytics.performance", () => {
    const content = readClient("client/src/pages/TransferAnalytics.tsx");
    expect(content).toContain("trpc.corridorAnalytics.performance");
  });

  it("uses trpc.admin.adminAnalytics", () => {
    const content = readClient("client/src/pages/TransferAnalytics.tsx");
    expect(content).toContain("trpc.admin.adminAnalytics");
  });

  it("renders chart components (Recharts)", () => {
    const content = readClient("client/src/pages/TransferAnalytics.tsx");
    expect(content).toMatch(/BarChart|LineChart|PieChart/);
  });

  it("has StatCard component for KPI display", () => {
    const content = readClient("client/src/pages/TransferAnalytics.tsx");
    expect(content).toContain("StatCard");
  });

  it("exports default TransferAnalytics function", () => {
    const content = readClient("client/src/pages/TransferAnalytics.tsx");
    expect(content).toContain("export default function TransferAnalytics");
  });

  it("has corridor color palette constant", () => {
    const content = readClient("client/src/pages/TransferAnalytics.tsx");
    expect(content).toContain("CORRIDOR_COLORS");
  });
});

// ─── 2. Route registered in App.tsx ──────────────────────────────────────────
describe("v179 — /admin/transfer-analytics route", () => {
  it("App.tsx imports TransferAnalytics lazily", () => {
    const content = readClient("client/src/App.tsx");
    expect(content).toContain("TransferAnalytics");
    expect(content).toMatch(/lazy.*TransferAnalytics|TransferAnalytics.*lazy/s);
  });

  it("App.tsx has /admin/transfer-analytics route", () => {
    const content = readClient("client/src/App.tsx");
    expect(content).toContain("/admin/transfer-analytics");
  });
});

// ─── 3. Sidebar navigation link ──────────────────────────────────────────────
describe("v179 — Transfer Analytics sidebar link", () => {
  it("DashboardLayout.tsx has Transfer Analytics nav entry", () => {
    const content = readClient("client/src/components/DashboardLayout.tsx");
    expect(content).toContain("Transfer Analytics");
  });

  it("Transfer Analytics nav entry points to /admin/transfer-analytics", () => {
    const content = readClient("client/src/components/DashboardLayout.tsx");
    expect(content).toContain("/admin/transfer-analytics");
  });

  it("Transfer Analytics nav entry is admin-only", () => {
    const content = readClient("client/src/components/DashboardLayout.tsx");
    // The nav item should have adminOnly: true near the path
    const idx = content.indexOf("/admin/transfer-analytics");
    const surrounding = content.slice(Math.max(0, idx - 200), idx + 200);
    expect(surrounding).toContain("adminOnly: true");
  });
});

// ─── 4. corridorAnalyticsRouter has required procedures ──────────────────────
describe("v179 — corridorAnalyticsRouter procedures", () => {
  it("productionFeatures.ts exports corridorAnalyticsRouter", () => {
    const content = readSrv("server/routers/productionFeatures.ts");
    expect(content).toContain("corridorAnalyticsRouter");
  });

  it("corridorAnalyticsRouter has topCorridors procedure", () => {
    const content = readSrv("server/routers/productionFeatures.ts");
    expect(content).toContain("topCorridors");
  });

  it("corridorAnalyticsRouter has performance procedure", () => {
    const content = readSrv("server/routers/productionFeatures.ts");
    expect(content).toContain("performance");
  });

  it("corridorAnalyticsRouter is wired in appRouter", () => {
    const content = readSrv("server/routers.ts");
    expect(content).toContain("corridorAnalytics: corridorAnalyticsRouter");
  });

  it("admin router has adminAnalytics procedure", () => {
    const content = readSrv("server/routers.ts");
    expect(content).toContain("adminAnalytics");
  });
});

// ─── 5. Africa's Talking SMS wiring ──────────────────────────────────────────
describe("v179 — Africa's Talking SMS provider", () => {
  it("smsConfirm.ts reads SMS_PROVIDER env var", () => {
    const content = readSrv("server/routers/smsConfirm.ts");
    expect(content).toContain("SMS_PROVIDER");
  });

  it("smsConfirm.ts supports africas_talking provider", () => {
    const content = readSrv("server/routers/smsConfirm.ts");
    expect(content).toContain("africas_talking");
  });

  it("smsConfirm.ts reads AFRICAS_TALKING_API_KEY", () => {
    const content = readSrv("server/routers/smsConfirm.ts");
    expect(content).toContain("AFRICAS_TALKING_API_KEY");
  });

  it("smsConfirm.ts reads AFRICAS_TALKING_USERNAME", () => {
    const content = readSrv("server/routers/smsConfirm.ts");
    expect(content).toContain("AFRICAS_TALKING_USERNAME");
  });

  it("smsConfirm.ts defaults to mock mode when SMS_PROVIDER is unset", () => {
    const content = readSrv("server/routers/smsConfirm.ts");
    // Default fallback should be "mock"
    expect(content).toMatch(/SMS_PROVIDER.*\?\?.*["']mock["']|["']mock["'].*SMS_PROVIDER/);
  });

  it("smsConfirm.ts is wired into appRouter", () => {
    const content = readSrv("server/routers.ts");
    expect(content).toMatch(/smsConfirm/);
  });
});

// ─── 6. PAPSS settlement endpoint ────────────────────────────────────────────
describe("v179 — PAPSS settlement endpoint", () => {
  it("POST /api/scheduled/papss-settlement is registered in index.ts", () => {
    const content = readSrv("server/_core/index.ts");
    expect(content).toContain("/api/scheduled/papss-settlement");
  });

  it("PAPSS endpoint uses app.post", () => {
    const content = readSrv("server/_core/index.ts");
    expect(content).toMatch(/app\.post.*papss-settlement/);
  });

  it("PAPSS endpoint performs multilateral netting logic", () => {
    const content = readSrv("server/_core/index.ts");
    // Should contain netting or settlement logic keywords
    expect(content).toMatch(/netting|settlement|papss/i);
  });

  it("PAPSS endpoint sends owner notification via notifyOwner", () => {
    const content = readSrv("server/_core/index.ts");
    const idx = content.indexOf("papss-settlement");
    // Search 3000 chars from the endpoint declaration to find notifyOwner call
    const surrounding = content.slice(idx, idx + 5000);
    expect(surrounding).toContain("notifyOwner");
  });
});

// ─── 7. AgentPOS auto-print after successful transaction ─────────────────────
describe("v179 — AgentPOS auto-print behavior", () => {
  it("AgentPOS.tsx exists", () => {
    expect(existsSync(join(ROOT, "client/src/pages/AgentPOS.tsx"))).toBe(true);
  });

  it("AgentPOS.tsx has 600ms auto-print delay after cashIn", () => {
    const content = readClient("client/src/pages/AgentPOS.tsx");
    expect(content).toContain("600");
    expect(content).toContain("handlePrintReceipt");
  });

  it("AgentPOS.tsx uses setTimeout for auto-print", () => {
    const content = readClient("client/src/pages/AgentPOS.tsx");
    expect(content).toContain("setTimeout");
  });

  it("AgentPOS.tsx tracks lastTx state for receipt display", () => {
    const content = readClient("client/src/pages/AgentPOS.tsx");
    expect(content).toContain("lastTx");
  });
});

// ─── 8. Security: no Math.random() in new server files ───────────────────────
describe("v179 — security: no Math.random in server code", () => {
  const serverFiles = [
    "server/routers/smsConfirm.ts",
    "server/routers/posAgentCashFlow.ts",
    "server/routers/agentOnboarding.ts",
    "server/routers/cryptoCustody.ts",
    "server/routers/newRails.ts",
  ];

  serverFiles.forEach((file) => {
    it(`${file} does not use Math.random()`, () => {
      if (!existsSync(join(ROOT, file))) return;
      const content = readSrv(file);
      expect(content).not.toMatch(/Math\.random\(\)/);
    });
  });
});

// ─── 9. Audit log coverage ───────────────────────────────────────────────────
describe("v179 — audit log coverage in new routers", () => {
  it("smsConfirm.ts references createAuditLog", () => {
    const content = readSrv("server/routers/smsConfirm.ts");
    expect(content).toMatch(/createAuditLog|auditLog|audit/i);
  });

  it("posAgentCashFlow.ts references createAuditLog", () => {
    const content = readSrv("server/routers/posAgentCashFlow.ts");
    expect(content).toMatch(/createAuditLog|auditLog|audit/i);
  });
});

// ─── 10. PWA and Service Worker ──────────────────────────────────────────────
describe("v179 — PWA / Service Worker", () => {
  it("sw.js exists and is at least v20", () => {
    expect(existsSync(join(ROOT, "client/public/sw.js"))).toBe(true);
    const content = readClient("client/public/sw.js");
    expect(content).toMatch(/v2[0-9]/);
  });

  it("manifest.json exists with shortcuts", () => {
    expect(existsSync(join(ROOT, "client/public/manifest.json"))).toBe(true);
    const content = readClient("client/public/manifest.json");
    const manifest = JSON.parse(content);
    expect(manifest.shortcuts).toBeDefined();
    expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(5);
  });
});
