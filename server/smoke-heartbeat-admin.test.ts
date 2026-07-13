/**
 * Smoke tests for the 4 heartbeat admin tRPC procedures (v24)
 * Verifies heartbeatList, heartbeatLogs, heartbeatPause, heartbeatResume
 * are exported from the system router, require admin role, and handle errors correctly.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { TRPCError } from "@trpc/server";

// ─── Mock child_process ───────────────────────────────────────────────────────
const mockExecSync = vi.fn();
const mockExecFileSync = vi.fn();
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execSync: mockExecSync,
    execFileSync: mockExecFileSync,
  };
});

// ─── Mock DB ───────────────────────────────────────────────────────
// The select chain for receiveRateStatus returns an array directly (no .limit())
const mockSelectResult: any[] = [];
vi.mock("../server/db.js", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: () => ({
      from: () => ({
        where: () => mockSelectResult, // direct array for receiveRateStatus
        limit: () => Promise.resolve([]),
      }),
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  }),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  getWalletsByUserId: vi.fn().mockResolvedValue([]),
}));

// ─── Mock all service dependencies ───────────────────────────────────────────
vi.mock("../server/email.service.js", () => ({ sendEmail: vi.fn() }));
vi.mock("../server/notifications.service.js", () => ({ sendNotification: vi.fn() }));
vi.mock("../server/sse.service.js", () => ({ broadcastAdminEvent: vi.fn(), broadcastUserEvent: vi.fn() }));
vi.mock("../server/audit.service.js", () => ({ logAdminAction: vi.fn() }));
vi.mock("../server/fraud.service.js", () => ({ checkFraud: vi.fn(), checkVelocity: vi.fn() }));
vi.mock("../server/fx-rates.service.js", () => ({ fetchLiveRates: vi.fn() }));
vi.mock("../server/temporal/client.js", () => ({ startTransferWorkflow: vi.fn(), startKYCWorkflow: vi.fn() }));
vi.mock("../server/middleware/kafka.js", () => ({
  publishPaymentInitiated: vi.fn(), publishTransactionEvent: vi.fn(),
  publishKYCEvent: vi.fn(), publishRiskScoreEvent: vi.fn(), publishAuditEvent: vi.fn(),
}));
vi.mock("../server/grpc-client.js", () => ({
  fraudCheck: vi.fn(), fxGetRate: vi.fn(), fxGetQuote: vi.fn(),
  ledgerTransfer: vi.fn(), kycSubmitDocument: vi.fn(), kycGetStatus: vi.fn(), checkGRPCHealth: vi.fn(),
}));
vi.mock("../server/_core/polyglotClient.js", () => ({
  runComplianceCheck: vi.fn(), getFraudScore: vi.fn(), screenSanctions: vi.fn(),
  sendAuditLog: vi.fn(), checkRateLimit: vi.fn(),
}));
vi.mock("../server/_core/serviceRegistry.js", () => ({ detectAnomaly: vi.fn() }));
vi.mock("../server/payment-rails.service.js", () => ({ initiateRailTransfer: vi.fn(), lookupRailRecipient: vi.fn() }));
vi.mock("../server/transfer-state-machine.js", () => ({ runTransferPipeline: vi.fn() }));
vi.mock("../server/security.attacks.js", () => ({
  detectStructuring: vi.fn(), isGhostBeneficiary: vi.fn(), detectRoundTripping: vi.fn(),
}));
vi.mock("../server/fraud-detection.service.js", () => ({ scoreFraud: vi.fn(), buildFeatures: vi.fn() }));
vi.mock("../server/mojaloop.service.js", () => ({ initiateMojaloopTransfer: vi.fn() }));
vi.mock("../server/storage.js", () => ({ storagePut: vi.fn() }));

// ─── Helper: build a minimal admin caller context ─────────────────────────────
function makeAdminCtx() {
  return {
    user: { id: 1, openId: "admin-open-id", name: "Admin", email: "admin@test.com", role: "admin" as const },
    req: { headers: { origin: "http://localhost:3000" } } as any,
    res: {} as any,
  };
}

function makeUserCtx() {
  return {
    user: { id: 2, openId: "user-open-id", name: "User", email: "user@test.com", role: "user" as const },
    req: { headers: { origin: "http://localhost:3000" } } as any,
    res: {} as any,
  };
}

// ─── Import the appRouter after all mocks are set up ─────────────────────────
let appRouter: any;
beforeAll(async () => {
  const mod = await import("../server/routers.js");
  appRouter = mod.appRouter;
}, 30_000);

describe("Heartbeat Admin Procedures — Structure", () => {
  it("system router exports heartbeatList", () => {
    expect(appRouter._def.procedures["system.heartbeatList"]).toBeDefined();
  });

  it("system router exports heartbeatLogs", () => {
    expect(appRouter._def.procedures["system.heartbeatLogs"]).toBeDefined();
  });

  it("system router exports heartbeatPause", () => {
    expect(appRouter._def.procedures["system.heartbeatPause"]).toBeDefined();
  });

  it("system router exports heartbeatResume", () => {
    expect(appRouter._def.procedures["system.heartbeatResume"]).toBeDefined();
  });

  it("heartbeatList is a query procedure", () => {
    const proc = appRouter._def.procedures["system.heartbeatList"];
    expect(proc._def.type).toBe("query");
  });

  it("heartbeatLogs is a query procedure", () => {
    const proc = appRouter._def.procedures["system.heartbeatLogs"];
    expect(proc._def.type).toBe("query");
  });

  it("heartbeatPause is a mutation procedure", () => {
    const proc = appRouter._def.procedures["system.heartbeatPause"];
    expect(proc._def.type).toBe("mutation");
  });

  it("heartbeatResume is a mutation procedure", () => {
    const proc = appRouter._def.procedures["system.heartbeatResume"];
    expect(proc._def.type).toBe("mutation");
  });
});

describe("Heartbeat Admin Procedures — Auth Guard (non-admin rejected)", () => {
  it("heartbeatList rejects non-admin callers", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(caller.system.heartbeatList()).rejects.toThrow();
  });

  it("heartbeatLogs rejects non-admin callers", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(caller.system.heartbeatLogs({ taskUid: "test-uid" })).rejects.toThrow();
  });

  it("heartbeatPause rejects non-admin callers", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(caller.system.heartbeatPause({ taskUid: "test-uid" })).rejects.toThrow();
  });

  it("heartbeatResume rejects non-admin callers", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(caller.system.heartbeatResume({ taskUid: "test-uid" })).rejects.toThrow();
  });
});

describe("Heartbeat Admin Procedures — Success Paths", () => {
  it("heartbeatList returns jobs array on success", async () => {
    mockExecSync.mockReturnValueOnce(JSON.stringify({
      jobs: [
        { task_uid: "abc123", name: "purge-idempotency-keys", cron: "0 0 */6 * * *", path: "/api/scheduled/purge-expired-keys", enabled: true, next_execution_at: "2026-05-14T00:00:00Z" },
      ],
      total: 1,
    }));
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.system.heartbeatList();
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].name).toBe("purge-idempotency-keys");
    expect(result.total).toBe(1);
  });

  it("heartbeatList returns empty jobs array when no jobs exist", async () => {
    mockExecSync.mockReturnValueOnce(JSON.stringify({ jobs: [], total: 0 }));
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.system.heartbeatList();
    expect(result.jobs).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("heartbeatLogs returns logs array for a valid taskUid", async () => {
    mockExecFileSync.mockReturnValueOnce(JSON.stringify({
      logs: [
        { execution_id: "exec-1", started_at: "2026-05-14T00:00:00Z", finished_at: "2026-05-14T00:00:01Z", status: "success", http_status: 200, duration_ms: 1234 },
      ],
      total: 1,
    }));
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.system.heartbeatLogs({ taskUid: "abc123" });
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].status).toBe("success");
    expect(result.total).toBe(1);
  });

  it("heartbeatPause returns success: true on success", async () => {
    mockExecFileSync.mockReturnValueOnce("");
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.system.heartbeatPause({ taskUid: "abc123" });
    expect(result.success).toBe(true);
  });

  it("heartbeatResume returns success: true on success", async () => {
    mockExecFileSync.mockReturnValueOnce("");
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.system.heartbeatResume({ taskUid: "abc123" });
    expect(result.success).toBe(true);
  });
});

describe("Heartbeat Admin Procedures — Error Handling", () => {
  it("heartbeatList throws INTERNAL_SERVER_ERROR when CLI fails", async () => {
    mockExecSync.mockImplementationOnce(() => { throw new Error("CLI not found"); });
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.system.heartbeatList()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("heartbeatList throws INTERNAL_SERVER_ERROR when CLI returns invalid JSON", async () => {
    mockExecSync.mockReturnValueOnce("not-valid-json");
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.system.heartbeatList()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("heartbeatLogs throws INTERNAL_SERVER_ERROR when CLI fails", async () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error("Task not found"); });
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.system.heartbeatLogs({ taskUid: "nonexistent" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("heartbeatPause throws INTERNAL_SERVER_ERROR when CLI fails", async () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error("Cannot pause"); });
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.system.heartbeatPause({ taskUid: "abc123" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("heartbeatResume throws INTERNAL_SERVER_ERROR when CLI fails", async () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error("Cannot resume"); });
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.system.heartbeatResume({ taskUid: "abc123" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("heartbeatLogs rejects empty taskUid", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.system.heartbeatLogs({ taskUid: "" })).rejects.toThrow();
  });

  it("heartbeatPause rejects empty taskUid", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.system.heartbeatPause({ taskUid: "" })).rejects.toThrow();
  });

  it("heartbeatResume rejects empty taskUid", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(caller.system.heartbeatResume({ taskUid: "" })).rejects.toThrow();
  });
});

describe("Heartbeat Admin Procedures — cbdc.receiveRateStatus", () => {
  it("system router exports cbdc.receiveRateStatus as a query", () => {
    const proc = appRouter._def.procedures["cbdc.receiveRateStatus"];
    expect(proc).toBeDefined();
    expect(proc._def.type).toBe("query");
  });

  it("cbdc.receiveRateStatus returns rate status with used, remaining, limit, resetsAt", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.cbdc.receiveRateStatus();
    expect(result).toHaveProperty("used");
    expect(result).toHaveProperty("remaining");
    expect(result).toHaveProperty("limit");
    expect(result).toHaveProperty("resetsAt");
    expect(result.limit).toBe(10);
    expect(result.remaining).toBeGreaterThanOrEqual(0);
    expect(result.used).toBeGreaterThanOrEqual(0);
    expect(result.used + result.remaining).toBeLessThanOrEqual(result.limit);
  });
});
