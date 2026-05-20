/**
 * smoke-v143.test.ts
 * Smoke tests for RemitFlow v143 production sprint.
 *
 * Coverage:
 * - Corridor-based payment rail routing (Mojaloop/PIX/UPI) in transfer pipeline
 * - Ghost beneficiary detection (isGhostBeneficiary)
 * - Structuring / smurfing detection (detectStructuring)
 * - Round-tripping velocity detection (detectRoundTripping)
 * - Ransomware upload guard (ransomwareUploadGuard)
 * - DDoS circuit breaker (ddosCircuitBreaker)
 * - Financial amount sanity guard (financialAmountGuard)
 * - python3.11 fix in microservices.ts
 * - docker-compose.yml includes 11 new services
 * - drizzle/seed.ts exists and exports a seed function
 * - transfer-state-machine uses corridor-based routing
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectStructuring,
  isGhostBeneficiary,
  recordBeneficiaryAddition,
  detectRoundTripping,
  ransomwareUploadGuard,
  ddosCircuitBreaker,
  financialAmountGuard,
} from "./security.attacks.js";
import { readFileSync } from "fs";
import { resolve } from "path";

// ─── Helper: create minimal Express mock ─────────────────────────────────────
function mockReqRes(overrides: {
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  path?: string;
  ip?: string;
}) {
  const req = {
    headers: overrides.headers ?? {},
    body: overrides.body ?? {},
    path: overrides.path ?? "/api/trpc/transfer.send",
    ip: overrides.ip ?? "127.0.0.1",
  } as any;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  } as any;
  const next = vi.fn();
  return { req, res, next };
}

// ─── 1. Structuring Detection ─────────────────────────────────────────────────
describe("detectStructuring (v143)", () => {
  it("does not flag a single transfer below threshold", () => {
    const result = detectStructuring(99001, 500);
    expect(result.flagged).toBe(false);
  });

  it("flags after 5 sub-$9K transfers in 1 hour", () => {
    const userId = 99002;
    // Reset by using a fresh userId
    for (let i = 0; i < 4; i++) {
      const r = detectStructuring(userId, 8000);
      expect(r.flagged).toBe(false);
    }
    const final = detectStructuring(userId, 8000);
    expect(final.flagged).toBe(true);
    expect(final.reason).toContain("structuring");
  });

  it("does not flag large single transfer above threshold", () => {
    const result = detectStructuring(99003, 12000);
    expect(result.flagged).toBe(false);
  });
});

// ─── 2. Ghost Beneficiary Detection ──────────────────────────────────────────
describe("isGhostBeneficiary (v143)", () => {
  it("returns false for beneficiary not recently added", () => {
    expect(isGhostBeneficiary(88001, 9001)).toBe(false);
  });

  it("returns true for beneficiary added within 5 minutes", () => {
    recordBeneficiaryAddition(88002, 9002);
    expect(isGhostBeneficiary(88002, 9002)).toBe(true);
  });

  it("returns false for different user/beneficiary combination", () => {
    recordBeneficiaryAddition(88003, 9003);
    expect(isGhostBeneficiary(88003, 9999)).toBe(false);
    expect(isGhostBeneficiary(99999, 9003)).toBe(false);
  });
});

// ─── 3. Round-Tripping Detection ─────────────────────────────────────────────
describe("detectRoundTripping (v143)", () => {
  it("does not flag a user with no transfer history", () => {
    const result = detectRoundTripping(77001);
    expect(result.flagged).toBe(false);
  });

  it("returns an object with flagged and optional reason", () => {
    const result = detectRoundTripping(77002);
    expect(result).toHaveProperty("flagged");
    expect(typeof result.flagged).toBe("boolean");
  });
});

// ─── 4. Ransomware Upload Guard ───────────────────────────────────────────────
describe("ransomwareUploadGuard (v143)", () => {
  it("blocks .exe file uploads", () => {
    const { req, res, next } = mockReqRes({
      headers: { "content-disposition": 'attachment; filename="malware.exe"' },
    });
    ransomwareUploadGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks .sh file uploads", () => {
    const { req, res, next } = mockReqRes({
      headers: { "content-disposition": 'attachment; filename="script.sh"' },
    });
    ransomwareUploadGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks application/x-msdownload MIME type", () => {
    const { req, res, next } = mockReqRes({
      headers: { "content-type": "application/x-msdownload" },
    });
    ransomwareUploadGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows legitimate PDF uploads", () => {
    const { req, res, next } = mockReqRes({
      headers: {
        "content-disposition": 'attachment; filename="document.pdf"',
        "content-type": "application/pdf",
      },
    });
    ransomwareUploadGuard(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows image uploads", () => {
    const { req, res, next } = mockReqRes({
      headers: {
        "content-disposition": 'attachment; filename="photo.jpg"',
        "content-type": "image/jpeg",
      },
    });
    ransomwareUploadGuard(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

// ─── 5. Financial Amount Sanity Guard ────────────────────────────────────────
describe("financialAmountGuard (v143)", () => {
  it("blocks negative amounts", () => {
    const { req, res, next } = mockReqRes({ body: { amount: -100 } });
    financialAmountGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks amounts exceeding MAX_SINGLE_AMOUNT", () => {
    const { req, res, next } = mockReqRes({ body: { amount: 99_000_000 } });
    financialAmountGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("blocks NaN amounts", () => {
    const { req, res, next } = mockReqRes({ body: { amount: NaN } });
    financialAmountGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("blocks Infinity amounts", () => {
    const { req, res, next } = mockReqRes({ body: { amount: Infinity } });
    financialAmountGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("allows valid amounts", () => {
    const { req, res, next } = mockReqRes({ body: { amount: 500, fee: 5 } });
    financialAmountGuard(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("passes through requests with no financial fields", () => {
    const { req, res, next } = mockReqRes({ body: { userId: 123, action: "get" } });
    financialAmountGuard(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

// ─── 6. docker-compose.yml includes new services ─────────────────────────────
describe("docker-compose.yml v143 services", () => {
  const composeContent = readFileSync(resolve(process.cwd(), "docker-compose.yml"), "utf-8");

  const newServices = [
    "go-community-feed",
    "go-ratelimit-sidecar",
    "kafka-processor",
    "ledger-service",
    "mojaloop-connector",
    "python-compliance-service",
    "python-nav-analytics",
    "rate-limiter",
    "risk-engine",
    "rust-audit-service",
    "search-indexer",
  ];

  for (const svc of newServices) {
    it(`includes ${svc} service`, () => {
      expect(composeContent).toContain(svc);
    });
  }
});

// ─── 7. Seed file exists ──────────────────────────────────────────────────────
describe("drizzle/seed.ts (v143)", () => {
  it("seed file exists", () => {
    const seedPath = resolve(process.cwd(), "drizzle/seed.ts");
    const content = readFileSync(seedPath, "utf-8");
    expect(content.length).toBeGreaterThan(100);
  });

  it("seed file has a main/seed entry point", () => {
    const seedPath = resolve(process.cwd(), "drizzle/seed.ts");
    const content = readFileSync(seedPath, "utf-8");
    // seed.ts uses async function main() pattern (called via main().catch)
    expect(content).toMatch(/async function (main|seed)|main\(\)\.catch/);
  });
});

// ─── 8. Transfer-state-machine corridor routing ───────────────────────────────
describe("transfer-state-machine corridor routing (v143)", () => {
  it("transfer-state-machine imports serviceRegistry for corridor routing", () => {
    const smPath = resolve(process.cwd(), "server/transfer-state-machine.ts");
    const content = readFileSync(smPath, "utf-8");
    expect(content).toMatch(/mojaloopTransfer|pixTransfer|upiTransfer/);
  });

  it("transfer-state-machine has corridor routing logic", () => {
    const smPath = resolve(process.cwd(), "server/transfer-state-machine.ts");
    const content = readFileSync(smPath, "utf-8");
    // Should have routing based on currency/country
    expect(content).toMatch(/BRL|INR|mojaloop|pix|upi/i);
  });
});

// ─── 9. Security controls count ──────────────────────────────────────────────
describe("security.attacks.ts v143 controls", () => {
  it("registers 27+ security controls", () => {
    const secPath = resolve(process.cwd(), "server/security.attacks.ts");
    const content = readFileSync(secPath, "utf-8");
    // v146 upgraded from 27 to 32 controls
    expect(content).toMatch(/(27|28|29|30|31|32) controls active/);
  });

  it("exports ransomwareUploadGuard", () => {
    const secPath = resolve(process.cwd(), "server/security.attacks.ts");
    const content = readFileSync(secPath, "utf-8");
    expect(content).toContain("export function ransomwareUploadGuard");
  });

  it("exports ddosCircuitBreaker", () => {
    const secPath = resolve(process.cwd(), "server/security.attacks.ts");
    const content = readFileSync(secPath, "utf-8");
    expect(content).toContain("export function ddosCircuitBreaker");
  });

  it("exports financialAmountGuard", () => {
    const secPath = resolve(process.cwd(), "server/security.attacks.ts");
    const content = readFileSync(secPath, "utf-8");
    expect(content).toContain("export function financialAmountGuard");
  });

  it("exports detectStructuring", () => {
    const secPath = resolve(process.cwd(), "server/security.attacks.ts");
    const content = readFileSync(secPath, "utf-8");
    expect(content).toContain("export function detectStructuring");
  });

  it("exports isGhostBeneficiary", () => {
    const secPath = resolve(process.cwd(), "server/security.attacks.ts");
    const content = readFileSync(secPath, "utf-8");
    expect(content).toContain("export function isGhostBeneficiary");
  });
});

// ─── 10. microservices.ts uses python3.11 ────────────────────────────────────
describe("microservices.ts python3.11 fix (v143)", () => {
  it("uses python3.11 instead of python3 for compliance service", () => {
    const msPath = resolve(process.cwd(), "server/_core/microservices.ts");
    const content = readFileSync(msPath, "utf-8");
    expect(content).toContain("python3.11");
  });
});
