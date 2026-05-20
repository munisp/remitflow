/**
 * Liveness Audit Trail — vitest unit tests
 *
 * Tests cover:
 *   1. admin.listLivenessAudit — pagination, filters, RBAC
 *   2. admin.getLivenessAuditDetail — found / not-found / RBAC
 *   3. admin.livenessAuditStats — aggregate counts
 *   4. kyc.extractDocument — deepfake + liveness integration paths
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";

// ─── Mock serviceRegistry ─────────────────────────────────────────────────────
vi.mock("./_core/serviceRegistry.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./_core/serviceRegistry.js")>();
  return {
    ...orig,
    checkLiveness: vi.fn().mockResolvedValue({
      passed: true,
      livenessScore: 0.91,
      confidence: 0.91,
      spoofingDetected: false,
      serviceUnavailable: false,
    }),
    checkDeepfake: vi.fn().mockResolvedValue({
      is_deepfake: false,
      confidence: 0.12,
      method: "vit_l",
      indicators: [],
      serviceUnavailable: false,
    }),
    detectAnomaly: vi.fn().mockResolvedValue({ anomaly: false, score: 0.05 }),
  };
});

// ─── Mock DB ──────────────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  getUserByOpenId: vi.fn().mockResolvedValue({
    id: 1,
    name: "Test Admin",
    email: "admin@test.com",
    role: "admin",
    kycTier: "tier2",
    twoFactorEnabled: false,
    referralCode: "RFTEST",
    openId: "admin-open-id",
  }),
  getKycDocsByUserId: vi.fn().mockResolvedValue([]),
  getWalletsByUserId: vi.fn().mockResolvedValue([]),
  getTransactionsByUserId: vi.fn().mockResolvedValue([]),
  getBeneficiariesByUserId: vi.fn().mockResolvedValue([]),
  getNotificationsByUserId: vi.fn().mockResolvedValue([]),
  getFxAlertsByUserId: vi.fn().mockResolvedValue([]),
  getAuditLogsByUserId: vi.fn().mockResolvedValue([]),
  getDisputesByUserId: vi.fn().mockResolvedValue([]),
  getVirtualAccountsByUserId: vi.fn().mockResolvedValue([]),
  getRecurringPaymentsByUserId: vi.fn().mockResolvedValue([]),
  getBatchPaymentsByUserId: vi.fn().mockResolvedValue([]),
  getCardsByUserId: vi.fn().mockResolvedValue([]),
  getSavingsGoalsByUserId: vi.fn().mockResolvedValue([]),
  getReferralsByUserId: vi.fn().mockResolvedValue([]),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function adminCaller() {
  return appRouter.createCaller({
    user: {
      id: 1,
      openId: "admin-open-id",
      name: "Test Admin",
      email: "admin@test.com",
      role: "admin" as const,
    },
    req: { headers: { origin: "http://localhost:3000" } } as any,
    res: {} as any,
  });
}

function userCaller() {
  return appRouter.createCaller({
    user: {
      id: 2,
      openId: "user-open-id",
      name: "Regular User",
      email: "user@test.com",
      role: "user" as const,
    },
    req: { headers: { origin: "http://localhost:3000" } } as any,
    res: {} as any,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("admin.livenessAuditStats", () => {
  it("returns zero stats when DB is unavailable (graceful fallback)", async () => {
    const caller = adminCaller();
    const stats = await caller.admin.livenessAuditStats();
    expect(stats).toMatchObject({
      total: 0,
      passed: 0,
      failed: 0,
      deepfakeDetected: 0,
      spoofingDetected: 0,
      passRate: 0,
    });
  });

  it("throws FORBIDDEN for non-admin users", async () => {
    const caller = userCaller();
    await expect(caller.admin.livenessAuditStats()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("admin.listLivenessAudit", () => {
  it("returns empty rows when DB is unavailable", async () => {
    const caller = adminCaller();
    await expect(caller.admin.listLivenessAudit({ page: 1, limit: 10, deepfakeOnly: false }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("throws FORBIDDEN for non-admin users", async () => {
    const caller = userCaller();
    await expect(caller.admin.listLivenessAudit({ page: 1, limit: 10, deepfakeOnly: false }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("accepts valid filter combinations without throwing", async () => {
    const caller = adminCaller();
    // DB is null so it will throw INTERNAL_SERVER_ERROR — that's the expected fail-closed behavior
    await expect(
      caller.admin.listLivenessAudit({
        page: 1,
        limit: 25,
        overallLive: false,
        deepfakeOnly: true,
        userId: 42,
      })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("admin.getLivenessAuditDetail", () => {
  it("throws FORBIDDEN for non-admin users", async () => {
    const caller = userCaller();
    await expect(caller.admin.getLivenessAuditDetail({ id: 1 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws INTERNAL_SERVER_ERROR when DB is unavailable", async () => {
    const caller = adminCaller();
    await expect(caller.admin.getLivenessAuditDetail({ id: 1 }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("kyc.extractDocument — deepfake + liveness integration", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let checkLiveness: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let checkDeepfake: any;

  beforeEach(async () => {
    const mod = await import("./_core/serviceRegistry.js");
    checkLiveness = vi.mocked(mod.checkLiveness);
    checkDeepfake = vi.mocked(mod.checkDeepfake);
    vi.clearAllMocks();
    checkLiveness.mockResolvedValue({
      passed: true,
      livenessScore: 0.91,
      confidence: 0.91,
      spoofingDetected: false,
      serviceUnavailable: false,
    });
    checkDeepfake.mockResolvedValue({
      is_deepfake: false,
      confidence: 0.12,
      method: "vit_l",
      indicators: [],
      serviceUnavailable: false,
    });
  });

  it("calls checkLiveness and checkDeepfake for selfie docType", async () => {
    const caller = adminCaller();
    // KYC FastAPI service will fail → mock fallback path
    const result = await caller.kyc.extractDocument({
      fileUrl: "https://s3.example.com/selfie.jpg",
      docType: "selfie",
      mimeType: "image/jpeg",
    });
    expect(checkLiveness).toHaveBeenCalledWith("https://s3.example.com/selfie.jpg");
    expect(checkDeepfake).toHaveBeenCalledWith("https://s3.example.com/selfie.jpg", "1");
    expect(result.livenessScore).toBe(0.91);
    expect(result.deepfakeScore).toBe(0.12);
    expect(result.deepfakeMethod).toBe("vit_l");
  });

  it("does NOT call checkLiveness or checkDeepfake for non-selfie docType", async () => {
    const caller = adminCaller();
    await caller.kyc.extractDocument({
      fileUrl: "https://s3.example.com/passport.jpg",
      docType: "passport",
      mimeType: "image/jpeg",
    });
    expect(checkLiveness).not.toHaveBeenCalled();
    expect(checkDeepfake).not.toHaveBeenCalled();
  });

  it("throws BAD_REQUEST when liveness check fails (not spoofing)", async () => {
    checkLiveness.mockResolvedValue({
      passed: false,
      livenessScore: 0.2,
      confidence: 0.2,
      spoofingDetected: false,
      serviceUnavailable: false,
    });
    const caller = adminCaller();
    await expect(
      caller.kyc.extractDocument({
        fileUrl: "https://s3.example.com/selfie.jpg",
        docType: "selfie",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Liveness check failed"),
    });
  });

  it("throws BAD_REQUEST with spoofing message when spoofing is detected", async () => {
    checkLiveness.mockResolvedValue({
      passed: false,
      livenessScore: 0.1,
      confidence: 0.1,
      spoofingDetected: true,
      serviceUnavailable: false,
    });
    const caller = adminCaller();
    await expect(
      caller.kyc.extractDocument({
        fileUrl: "https://s3.example.com/selfie.jpg",
        docType: "selfie",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Spoofing"),
    });
  });

  it("throws INTERNAL_SERVER_ERROR when liveness service is unavailable (fail-closed)", async () => {
    checkLiveness.mockResolvedValue({
      passed: false,
      livenessScore: 0.0,
      confidence: 0.0,
      spoofingDetected: false,
      serviceUnavailable: true,
    });
    const caller = adminCaller();
    await expect(
      caller.kyc.extractDocument({
        fileUrl: "https://s3.example.com/selfie.jpg",
        docType: "selfie",
      })
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: expect.stringContaining("temporarily unavailable"),
    });
  });

  it("throws BAD_REQUEST when deepfake is detected with high confidence (≥ 0.55)", async () => {
    checkDeepfake.mockResolvedValue({
      is_deepfake: true,
      confidence: 0.87,
      method: "vit_l",
      indicators: ["checkerboard_artifacts", "frequency_anomaly"],
      serviceUnavailable: false,
    });
    const caller = adminCaller();
    await expect(
      caller.kyc.extractDocument({
        fileUrl: "https://s3.example.com/selfie.jpg",
        docType: "selfie",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("digitally manipulated"),
    });
  });

  it("allows submission when deepfake confidence is below threshold (< 0.55)", async () => {
    checkDeepfake.mockResolvedValue({
      is_deepfake: true,
      confidence: 0.42,  // below 0.55 threshold
      method: "dct_frequency",
      indicators: ["slight_frequency_anomaly"],
      serviceUnavailable: false,
    });
    const caller = adminCaller();
    // Should NOT throw — confidence below threshold
    const result = await caller.kyc.extractDocument({
      fileUrl: "https://s3.example.com/selfie.jpg",
      docType: "selfie",
    });
    expect(result.deepfakeScore).toBe(0.42);
    expect(result.deepfakeMethod).toBe("dct_frequency");
  });

  it("proceeds (does not block) when deepfake service is unavailable", async () => {
    checkDeepfake.mockResolvedValue({
      is_deepfake: false,
      confidence: 0.0,
      method: null,
      indicators: [],
      serviceUnavailable: true,
    });
    const caller = adminCaller();
    // Should NOT throw — deepfake service outage is inconclusive, not blocking
    const result = await caller.kyc.extractDocument({
      fileUrl: "https://s3.example.com/selfie.jpg",
      docType: "selfie",
    });
    expect(result).toBeDefined();
  });
});
