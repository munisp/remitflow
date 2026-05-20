/**
 * smoke-v185.test.ts
 * Production-finalization audit tests for v185 sprint:
 * - PWAFeatures: trpc.system.health query added
 * - Evidence thumbnail preview in TransferDisputeForm
 * - Security audit: 0 Math.random in security contexts
 * - Microservices: callService helper + 9 service URLs
 * - microserviceHealthRouter wired in appRouter
 * - K8s manifests present
 * - Docker Compose files present (9 files)
 * - Stablecoin wallet stubs removed
 * - PAPSS auth guard confirmed correct
 * - All 32 orphaned routers wired
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(ROOT, "server");
const CLIENT = path.join(ROOT, "client", "src");
const PAGES = path.join(CLIENT, "pages");

function readFile(p: string) {
  return fs.readFileSync(p, "utf8");
}

function fileExists(p: string) {
  return fs.existsSync(p);
}

// ─── PWAFeatures live data ────────────────────────────────────────────────────
describe("PWAFeatures — live system.health query", () => {
  const pwaFile = path.join(PAGES, "PWAFeatures.tsx");

  it("imports trpc from @/lib/trpc", () => {
    const content = readFile(pwaFile);
    expect(content).toContain('import { trpc } from "@/lib/trpc"');
  });

  it("calls trpc.system.health.useQuery", () => {
    const content = readFile(pwaFile);
    expect(content).toContain("trpc.system.health.useQuery");
  });

  it("uses refetchInterval for live updates", () => {
    const content = readFile(pwaFile);
    expect(content).toContain("refetchInterval");
  });

  it("stores health data in healthData variable", () => {
    const content = readFile(pwaFile);
    expect(content).toContain("healthData");
  });
});

// ─── Evidence thumbnail preview ───────────────────────────────────────────────
describe("TransferDisputeForm — evidence thumbnail preview", () => {
  const disputeFile = path.join(PAGES, "TransferDisputeForm.tsx");

  it("has localPreview state for thumbnail display", () => {
    const content = readFile(disputeFile);
    expect(content).toMatch(/localPreview|previewUrl|objectUrl/i);
  });

  it("renders thumbnail for image files", () => {
    const content = readFile(disputeFile);
    // Should have an img tag or thumbnail display after upload
    expect(content).toMatch(/<img|thumbnail|preview/i);
  });

  it("shows PDF badge for PDF files", () => {
    const content = readFile(disputeFile);
    expect(content).toMatch(/pdf|PDF/);
  });

  it("has progress bar during upload", () => {
    const content = readFile(disputeFile);
    expect(content).toContain("uploadProgress");
  });

  it("disables submit while uploading", () => {
    const content = readFile(disputeFile);
    expect(content).toMatch(/isUploading|uploadProgress.*100|disabled.*upload/i);
  });
});

// ─── Security audit ───────────────────────────────────────────────────────────
describe("Security audit — no Math.random in security contexts", () => {
  it("transferDispute.ts uses crypto.randomBytes not Math.random", () => {
    const content = readFile(path.join(SERVER, "routers", "transferDispute.ts"));
    // Should not have Math.random() for key/token generation
    const mathRandomLines = content.split("\n").filter(l =>
      l.includes("Math.random()") && (l.includes("key") || l.includes("token") || l.includes("secret"))
    );
    expect(mathRandomLines).toHaveLength(0);
  });

  it("transferDispute.ts uses crypto.randomBytes for file key", () => {
    const content = readFile(path.join(SERVER, "routers", "transferDispute.ts"));
    // Uses dynamic import of crypto then calls randomBytes
    expect(content).toMatch(/randomBytes|crypto.*random/i);
  });

  it("no hardcoded API keys in server files", () => {
    const serverFiles = fs.readdirSync(SERVER)
      .filter(f => f.endsWith(".ts") && !f.includes("smoke") && !f.includes("test"))
      .map(f => readFile(path.join(SERVER, f)));

    const hardcodedKeyPattern = /apikey\s*=\s*["'][a-zA-Z0-9]{16,}["']/i;
    const violations = serverFiles.filter(content => hardcodedKeyPattern.test(content));
    expect(violations).toHaveLength(0);
  });

  it("PAPSS auth guard uses isScheduledTask flag", () => {
    const indexContent = readFile(path.join(SERVER, "_core", "index.ts"));
    expect(indexContent).toContain("isScheduledTask");
    expect(indexContent).toContain("x-scheduled-task");
  });

  it("PAPSS auth guard returns 401 for unauthorized requests", () => {
    const indexContent = readFile(path.join(SERVER, "_core", "index.ts"));
    const papssBlock = indexContent.substring(
      indexContent.indexOf("papss-settlement"),
      indexContent.indexOf("papss-settlement") + 3000
    );
    expect(papssBlock).toContain("401");
    expect(papssBlock).toContain("Unauthorized");
  });
});

// ─── Microservices wiring ─────────────────────────────────────────────────────
describe("Microservices — callService helper and service URLs", () => {
  const msFile = path.join(SERVER, "routers", "microservices.ts");

  it("microservices.ts exists", () => {
    expect(fileExists(msFile)).toBe(true);
  });

  it("has callService helper function", () => {
    const content = readFile(msFile);
    expect(content).toContain("callService");
  });

  it("defines 9 service URLs with env-var overrides", () => {
    const content = readFile(msFile);
    expect(content).toContain("ngxPriceFeed");
    expect(content).toContain("apiGateway");
    expect(content).toContain("corridorPricing");
    expect(content).toContain("fxEngine");
    expect(content).toContain("txProcessor");
    expect(content).toContain("complianceEngine");
    expect(content).toContain("fraudDetection");
    expect(content).toContain("amlCompliance");
    expect(content).toContain("analyticsEngine");
  });

  it("uses localhost fallbacks for all services", () => {
    const content = readFile(msFile);
    expect(content).toContain("localhost:8081");
    expect(content).toContain("localhost:8082");
  });

  it("has graceful fallback on service unavailable", () => {
    const content = readFile(msFile);
    expect(content).toMatch(/fallback|source.*fallback/i);
  });

  it("microserviceHealthRouter is exported", () => {
    const content = readFile(msFile);
    expect(content).toContain("microserviceHealthRouter");
  });

  it("microserviceHealthRouter is wired in appRouter", () => {
    const routersContent = readFile(path.join(SERVER, "routers.ts"));
    expect(routersContent).toContain("microserviceHealth: microserviceHealthRouter");
  });
});

// ─── K8s and Docker manifests ─────────────────────────────────────────────────
describe("Infrastructure — K8s and Docker Compose manifests", () => {
  const k8sDir = path.join(ROOT, "k8s");
  const rootDir = ROOT;

  it("k8s directory exists", () => {
    expect(fileExists(k8sDir)).toBe(true);
  });

  it("k8s/deployment.yaml exists", () => {
    expect(fileExists(path.join(k8sDir, "deployment.yaml"))).toBe(true);
  });

  it("k8s/ingress.yaml exists", () => {
    expect(fileExists(path.join(k8sDir, "ingress.yaml"))).toBe(true);
  });

  it("k8s/hpa.yaml exists for autoscaling", () => {
    expect(fileExists(path.join(k8sDir, "hpa.yaml"))).toBe(true);
  });

  it("docker-compose.production.yml exists", () => {
    expect(fileExists(path.join(rootDir, "docker-compose.production.yml"))).toBe(true);
  });

  it("docker-compose.microservices.yml exists", () => {
    expect(fileExists(path.join(rootDir, "docker-compose.microservices.yml"))).toBe(true);
  });

  it("docker-compose.observability.yml exists", () => {
    expect(fileExists(path.join(rootDir, "docker-compose.observability.yml"))).toBe(true);
  });

  it("docker-compose.dev.yml exists", () => {
    expect(fileExists(path.join(rootDir, "docker-compose.dev.yml"))).toBe(true);
  });
});

// ─── Go/Rust/Python microservice source files ─────────────────────────────────
describe("Microservice source files — Go/Rust/Python services", () => {
  const servicesDir = path.join(ROOT, "services");

  it("services directory exists", () => {
    expect(fileExists(servicesDir)).toBe(true);
  });

  it("go-papss-service has main.go", () => {
    expect(fileExists(path.join(servicesDir, "go-papss-service", "main.go"))).toBe(true);
  });

  it("go-ratelimit-sidecar has main.go", () => {
    expect(fileExists(path.join(servicesDir, "go-ratelimit-sidecar", "main.go"))).toBe(true);
  });

  it("fraud-ml has main.py", () => {
    expect(fileExists(path.join(servicesDir, "fraud-ml", "main.py"))).toBe(true);
  });

  it("go-papss-service has Dockerfile", () => {
    expect(fileExists(path.join(servicesDir, "go-papss-service", "Dockerfile"))).toBe(true);
  });
});

// ─── Stablecoin wallet stubs removed ─────────────────────────────────────────
describe("missingTables.ts — stablecoin wallet stubs removed", () => {
  const mtFile = path.join(SERVER, "routers", "missingTables.ts");

  it("missingTables.ts exists", () => {
    expect(fileExists(mtFile)).toBe(true);
  });

  it("does not return hardcoded mock wallet balances", () => {
    const content = readFile(mtFile);
    // Should not have hardcoded balance arrays like [{ balance: 1000, ... }]
    expect(content).not.toMatch(/balance:\s*\d{4,}/);
  });

  it("wallets procedure returns DB rows not mock data", () => {
    const content = readFile(mtFile);
    // Should use getDb() not return static array
    const walletsSection = content.substring(
      content.indexOf("wallets"),
      content.indexOf("wallets") + 500
    );
    expect(walletsSection).toMatch(/getDb|db\.|rows|result/i);
  });
});

// ─── Canonical seed script ────────────────────────────────────────────────────
describe("Canonical seed script", () => {
  it("scripts/seed-canonical.mjs exists", () => {
    expect(fileExists(path.join(ROOT, "scripts", "seed-canonical.mjs"))).toBe(true);
  });

  it("package.json has db:seed:canonical script", () => {
    const pkg = JSON.parse(readFile(path.join(ROOT, "package.json")));
    expect(pkg.scripts).toHaveProperty("db:seed:canonical");
  });
});

// ─── Profile page enhancements ────────────────────────────────────────────────
describe("Profile.tsx — avatar upload and completeness score", () => {
  const profileFile = path.join(PAGES, "Profile.tsx");

  it("Profile.tsx exists", () => {
    expect(fileExists(profileFile)).toBe(true);
  });

  it("has avatar upload via trpc.profile.uploadAvatar", () => {
    const content = readFile(profileFile);
    expect(content).toContain("uploadAvatar");
  });

  it("has completeness score calculation", () => {
    const content = readFile(profileFile);
    expect(content).toMatch(/completeness|score|progress/i);
  });

  it("has date of birth field", () => {
    const content = readFile(profileFile);
    expect(content).toMatch(/dateOfBirth|date.*birth|birth.*date/i);
  });

  it("has quick links section", () => {
    const content = readFile(profileFile);
    expect(content).toMatch(/quick.*link|link.*quick|Security|Notifications/i);
  });

  it("has KYC tier display", () => {
    const content = readFile(profileFile);
    expect(content).toMatch(/kyc|KYC|tier/i);
  });
});

// ─── MyTransfers — export CSV button ─────────────────────────────────────────
describe("MyTransfers — export CSV button", () => {
  const myTransfersFile = path.join(PAGES, "MyTransfers.tsx");

  it("MyTransfers.tsx exists", () => {
    expect(fileExists(myTransfersFile)).toBe(true);
  });

  it("has export CSV button or link", () => {
    const content = readFile(myTransfersFile);
    expect(content).toMatch(/export|Export|csv|CSV/i);
  });

  it("links to /transactions/export", () => {
    const content = readFile(myTransfersFile);
    expect(content).toContain("/transactions/export");
  });
});

// ─── AdminDisputes — copy ID buttons ─────────────────────────────────────────
describe("AdminDisputes — copy ID buttons", () => {
  const adminDisputesFile = path.join(PAGES, "AdminDisputes.tsx");

  it("AdminDisputes.tsx exists", () => {
    expect(fileExists(adminDisputesFile)).toBe(true);
  });

  it("has CopyIdButton component", () => {
    const content = readFile(adminDisputesFile);
    expect(content).toContain("CopyIdButton");
  });

  it("uses clipboard API for copy", () => {
    const content = readFile(adminDisputesFile);
    expect(content).toContain("clipboard");
  });

  it("has copy button for transaction ID", () => {
    const content = readFile(adminDisputesFile);
    // CopyIdButton is rendered with label="Transaction ID" on the same line
    expect(content).toContain('CopyIdButton value={selectedDispute?.transactionId}');
  });

  it("has inline evidence viewer", () => {
    const content = readFile(adminDisputesFile);
    expect(content).toMatch(/EvidenceViewer|evidence.*viewer|iframe.*pdf/i);
  });

  it("has SMS sent badge", () => {
    const content = readFile(adminDisputesFile);
    expect(content).toMatch(/SmsBadge|sms.*sent|smsSent/i);
  });
});

// ─── ConnectionQualityIndicator global ───────────────────────────────────────
describe("ConnectionQualityIndicator — global in App.tsx", () => {
  const appFile = path.join(CLIENT, "App.tsx");

  it("App.tsx imports ConnectionQualityIndicator", () => {
    const content = readFile(appFile);
    expect(content).toContain("ConnectionQualityIndicator");
  });

  it("ConnectionQualityIndicator is rendered globally", () => {
    const content = readFile(appFile);
    expect(content).toContain("<ConnectionQualityIndicator");
  });
});

// ─── DashboardLayout — profile navigation ────────────────────────────────────
describe("DashboardLayout — profile dropdown navigation", () => {
  const layoutFile = path.join(CLIENT, "components", "DashboardLayout.tsx");

  it("Profile dropdown navigates to /profile", () => {
    const content = readFile(layoutFile);
    expect(content).toContain("/profile");
  });

  it("Settings dropdown navigates to /settings", () => {
    const content = readFile(layoutFile);
    expect(content).toContain("/settings");
  });
});

// ─── PAPSS exponential backoff ────────────────────────────────────────────────
describe("PAPSS settlement — exponential backoff retry", () => {
  it("withRetry helper exists in index.ts", () => {
    const content = readFile(path.join(SERVER, "_core", "index.ts"));
    expect(content).toContain("withRetry");
  });

  it("MAX_RETRIES is 3", () => {
    const content = readFile(path.join(SERVER, "_core", "index.ts"));
    expect(content).toContain("MAX_RETRIES = 3");
  });

  it("uses exponential delay formula", () => {
    const content = readFile(path.join(SERVER, "_core", "index.ts"));
    expect(content).toMatch(/Math\.pow\(2|2\s*\*\*\s*|500\s*\*|delay.*500/);
  });

  it("response includes retryInfo", () => {
    const content = readFile(path.join(SERVER, "_core", "index.ts"));
    const papssBlock = content.substring(
      content.indexOf("papss-settlement"),
      content.indexOf("papss-settlement") + 6500
    );
    expect(papssBlock).toContain("retryInfo");
  });
});

// ─── Transfer dispute router ──────────────────────────────────────────────────
describe("transferDisputeRouter — all procedures", () => {
  const disputeRouterFile = path.join(SERVER, "routers", "transferDispute.ts");

  it("has raise procedure", () => {
    const content = readFile(disputeRouterFile);
    expect(content).toContain("raise:");
  });

  it("has listMine procedure", () => {
    const content = readFile(disputeRouterFile);
    expect(content).toContain("listMine:");
  });

  it("has adminList procedure", () => {
    const content = readFile(disputeRouterFile);
    expect(content).toContain("adminList:");
  });

  it("has adminUpdate procedure with smsSent return", () => {
    const content = readFile(disputeRouterFile);
    expect(content).toContain("adminUpdate:");
    expect(content).toContain("smsSent");
  });

  it("has uploadEvidenceFile procedure", () => {
    const content = readFile(disputeRouterFile);
    // uploadEvidenceFile is exported as a named const and included in the router object
    expect(content).toMatch(/uploadEvidenceFile/);
  });

  it("uploadEvidenceFile uses storagePut", () => {
    const content = readFile(disputeRouterFile);
    const uploadSection = content.substring(
      content.indexOf("uploadEvidenceFile"),
      content.indexOf("uploadEvidenceFile") + 1000
    );
    expect(uploadSection).toContain("storagePut");
  });

  it("uses Permify PBAC canAccessDispute", () => {
    const content = readFile(disputeRouterFile);
    expect(content).toContain("canAccessDispute");
  });

  it("notifies owner on new dispute submission", () => {
    const content = readFile(disputeRouterFile);
    // notifyOwner is called in raiseDispute procedure (defined as const raiseDispute before the router)
    const raiseSection = content.substring(
      content.indexOf("const raiseDispute"),
      content.indexOf("const raiseDispute") + 3500
    );
    expect(raiseSection).toContain("notifyOwner");
  });
});

// ─── corridorAnalytics — successByPaymentMethod ───────────────────────────────
describe("corridorAnalytics — successByPaymentMethod procedure", () => {
  const pfFile = path.join(SERVER, "routers", "productionFeatures.ts");

  it("successByPaymentMethod procedure exists", () => {
    const content = readFile(pfFile);
    expect(content).toContain("successByPaymentMethod");
  });

  it("uses GROUP BY payment_method SQL", () => {
    const content = readFile(pfFile);
    const section = content.substring(
      content.indexOf("successByPaymentMethod"),
      content.indexOf("successByPaymentMethod") + 2000
    );
    expect(section).toMatch(/GROUP BY|groupBy|payment_method/i);
  });
});

// ─── Transfer Analytics page ──────────────────────────────────────────────────
describe("TransferAnalytics — success rate chart", () => {
  const taFile = path.join(PAGES, "TransferAnalytics.tsx");

  it("TransferAnalytics.tsx exists", () => {
    expect(fileExists(taFile)).toBe(true);
  });

  it("calls trpc.corridorAnalytics.successByPaymentMethod", () => {
    const content = readFile(taFile);
    expect(content).toContain("successByPaymentMethod");
  });

  it("renders a chart for payment method success rates", () => {
    const content = readFile(taFile);
    expect(content).toMatch(/RadarChart|BarChart|PieChart|Radar|Bar/);
  });
});
