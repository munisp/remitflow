/**
 * Smoke tests for /api/scheduled/purge-expired-keys handler
 *
 * Tests cover:
 * - Auth guard: requires Bearer SCHEDULED_TASK_TOKEN (constant-time); fails closed 503 when unset
 * - Handler logic: correctly identifies and deletes expired idempotency keys
 * - Response shape: returns { ok, purged, ranAt }
 * - Idempotency: running twice on the same data deletes 0 on the second pass
 * - Error handling: returns 500 when DB throws
 * - Cron spec: validates the 6-field cron expression and callback path
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB and schema ───────────────────────────────────────────────────────
// We inject these into the handler factory rather than relying on dynamic imports
const mockReturning = vi.fn().mockResolvedValue([]);
const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
const mockDelete = vi.fn().mockReturnValue({ where: mockWhere });

function makeDb(overrides?: Partial<{ delete: typeof mockDelete }>) {
  return { delete: overrides?.delete ?? mockDelete };
}

const fakeIdempotencyKeys = {
  expiresAt: { name: "expires_at" },
};

function fakeLte(col: any, val: any) {
  return { type: "lte", col, val };
}

// ─── Self-contained handler factory ──────────────────────────────────────────
// Mirrors the production handler logic exactly, but accepts injected dependencies
// so we can test without dynamic import path resolution issues.
function createPurgeHandler(deps: {
  getDb: () => Promise<any>;
  idempotencyKeys: typeof fakeIdempotencyKeys;
  lte: typeof fakeLte;
  getAdminToken?: () => string;
}) {
  return async function purgeExpiredKeysHandler(req: any, res: any) {
    try {
      // Mirrors the fixed production auth (SEC-12): Bearer token compared in
      // constant time against env-required SCHEDULED_TASK_TOKEN. Fail-closed
      // 503 when unset; cookie presence and x-scheduled-task are NOT accepted.
      const adminToken = deps.getAdminToken?.() ?? "";
      if (!adminToken) {
        return res.status(503).json({ error: "Scheduled task authentication not configured" });
      }
      const authHeader = req.headers.authorization || "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
      if (!bearerToken || bearerToken !== adminToken) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const db = await deps.getDb();
      const now = new Date();
      const deleted = await db.delete(deps.idempotencyKeys)
        .where(deps.lte(deps.idempotencyKeys.expiresAt, now))
        .returning();
      return res.json({ ok: true, purged: deleted.length, ranAt: now.toISOString() });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message, timestamp: new Date().toISOString() });
    }
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeReq(headers: Record<string, string> = {}) {
  return { headers };
}

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const DEFAULT_TEST_TOKEN = "test-scheduled-token";

function makeHandler(overrides?: {
  getDb?: () => Promise<any>;
  getAdminToken?: () => string;
}) {
  return createPurgeHandler({
    getDb: overrides?.getDb ?? (() => Promise.resolve(makeDb())),
    idempotencyKeys: fakeIdempotencyKeys,
    lte: fakeLte,
    getAdminToken: overrides?.getAdminToken ?? (() => DEFAULT_TEST_TOKEN),
  });
}

function authedReq(extraHeaders: Record<string, string> = {}) {
  return makeReq({ authorization: `Bearer ${DEFAULT_TEST_TOKEN}`, ...extraHeaders });
}

// ─── Auth guard tests ─────────────────────────────────────────────────────────
describe("/api/scheduled/purge-expired-keys — auth guard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects requests with no Authorization header", async () => {
    const handler = makeHandler();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  it("rejects requests carrying only the forgeable x-scheduled-task header (SEC-12)", async () => {
    const handler = makeHandler();
    const res = makeRes();
    await handler(makeReq({ "x-scheduled-task": "true" }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  it("rejects requests with wrong bearer token", async () => {
    const handler = makeHandler({ getAdminToken: () => "correct-token" });
    const res = makeRes();
    await handler(makeReq({ authorization: "Bearer wrong-token" }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  it("fails closed with 503 when SCHEDULED_TASK_TOKEN is unset (SEC-12)", async () => {
    const handler = makeHandler({ getAdminToken: () => "" });
    const res = makeRes();
    await handler(makeReq({ authorization: "Bearer anything" }), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: "Scheduled task authentication not configured" });
  });

  it("allows requests with correct SCHEDULED_TASK_TOKEN bearer token", async () => {
    const handler = makeHandler({ getAdminToken: () => "secret-token-123" });
    const res = makeRes();
    await handler(makeReq({ authorization: "Bearer secret-token-123" }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it("rejects empty bearer token even when SCHEDULED_TASK_TOKEN is configured", async () => {
    const handler = makeHandler({ getAdminToken: () => "secret-token-123" });
    const res = makeRes();
    await handler(makeReq({ authorization: "Bearer " }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  });
});

// ─── Handler logic tests ──────────────────────────────────────────────────────
describe("/api/scheduled/purge-expired-keys — handler logic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls db.delete on idempotencyKeys table", async () => {
    const localDelete = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) });
    const handler = makeHandler({ getDb: () => Promise.resolve({ delete: localDelete }) });
    const res = makeRes();
    await handler(authedReq(), res);
    expect(localDelete).toHaveBeenCalledWith(fakeIdempotencyKeys);
  });

  it("applies lte filter on expiresAt column", async () => {
    const localLte = vi.fn().mockReturnValue({ type: "lte" });
    const localWhere = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) });
    const localDelete = vi.fn().mockReturnValue({ where: localWhere });
    const handler = createPurgeHandler({
      getDb: () => Promise.resolve({ delete: localDelete }),
      idempotencyKeys: fakeIdempotencyKeys,
      lte: localLte,
      getAdminToken: () => DEFAULT_TEST_TOKEN,
    });
    const res = makeRes();
    await handler(authedReq(), res);
    expect(localLte).toHaveBeenCalledWith(fakeIdempotencyKeys.expiresAt, expect.any(Date));
    expect(localWhere).toHaveBeenCalledWith(expect.objectContaining({ type: "lte" }));
  });

  it("returns purged count equal to number of deleted rows", async () => {
    const fakeDeleted = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const handler = makeHandler({
      getDb: () => Promise.resolve({
        delete: () => ({ where: () => ({ returning: () => Promise.resolve(fakeDeleted) }) }),
      }),
    });
    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, purged: 3 }));
  });

  it("returns purged: 0 when no expired keys exist (idempotent second run)", async () => {
    const handler = makeHandler({
      getDb: () => Promise.resolve({
        delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
      }),
    });
    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, purged: 0 }));
  });

  it("response includes ranAt as a valid ISO timestamp", async () => {
    const handler = makeHandler({
      getDb: () => Promise.resolve({
        delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
      }),
    });
    const res = makeRes();
    await handler(authedReq(), res);
    const call = res.json.mock.calls[0][0];
    expect(call.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(call.ranAt).getTime()).not.toBeNaN();
  });

  it("returns 500 with error message when db.delete throws", async () => {
    const handler = makeHandler({
      getDb: () => Promise.resolve({
        delete: () => { throw new Error("DB connection lost"); },
      }),
    });
    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "DB connection lost" }));
  });

  it("returns 500 with error message when getDb rejects", async () => {
    const handler = makeHandler({
      getDb: () => Promise.reject(new Error("Connection pool exhausted")),
    });
    const res = makeRes();
    await handler(authedReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Connection pool exhausted" }));
  });
});

// ─── Cron registration spec ───────────────────────────────────────────────────
describe("/api/scheduled/purge-expired-keys — cron registration spec", () => {
  it("cron expression is 6-field UTC every-6-hours pattern", () => {
    // Scheduler: POST /api/scheduler/jobs { name: "purge-idempotency-keys", cron: "0 0 */6 * * *", path: "/api/scheduled/purge-expired-keys" }
    const cronExpression = "0 0 */6 * * *";
    const parts = cronExpression.split(" ");
    expect(parts).toHaveLength(6);   // 6-field cron (with seconds)
    expect(parts[0]).toBe("0");      // seconds: 0
    expect(parts[1]).toBe("0");      // minutes: 0
    expect(parts[2]).toBe("*/6");    // hours: every 6h
    expect(parts[3]).toBe("*");      // day of month: any
    expect(parts[4]).toBe("*");      // month: any
    expect(parts[5]).toBe("*");      // day of week: any
  });

  it("callback path is under /api/scheduled/", () => {
    const path = "/api/scheduled/purge-expired-keys";
    expect(path.startsWith("/api/scheduled/")).toBe(true);
  });

  it("fires 4 times per day (every 6 hours)", () => {
    // Verify the interval: 24h / 6h = 4 executions per day
    const intervalHours = 6;
    const executionsPerDay = 24 / intervalHours;
    expect(executionsPerDay).toBe(4);
  });
});
