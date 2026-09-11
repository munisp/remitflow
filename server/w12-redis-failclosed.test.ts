/**
 * W12-FIX tests (audit F1-3 / F2-9) — Redis fail-closed on money paths.
 *
 * Covers:
 *   - coreAtomicity.getIdempotentResult / setIdempotentResult: production
 *     fails CLOSED (retryable IdempotencyStoreUnavailableError) when Redis is
 *     unavailable or erroring; non-production falls back to in-memory.
 *   - fundFlowHardening coordinated-transaction lock: acquire step DENIES
 *     (step fails, transaction compensates, never completes) when Redis is
 *     unavailable; release uses compare-and-delete on the ownership token.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the Redis facade BEFORE importing the modules under test. The mock
// handle is swappable per-test via the `redisHandle` box; `redisHealth`
// controls the hardened module's isRedisAvailable() signal.
const redisHandle: { current: unknown } = { current: null };
const redisHealth: { current: boolean } = { current: false };

vi.mock("./middleware/redis", async (importOriginal) => {
  const original = await importOriginal<typeof import("./middleware/redis")>();
  return {
    ...original,
    getRedisClient: () => redisHandle.current,
  };
});

vi.mock("./middleware/redisHardened", async (importOriginal) => {
  const original = await importOriginal<typeof import("./middleware/redisHardened")>();
  return {
    ...original,
    isRedisAvailable: () => redisHealth.current,
  };
});

// Temporal is not running in tests — force the inline execution path.
vi.mock("./_core/temporal", () => ({
  getTemporalClient: async () => null,
}));

// Kafka publish is telemetry here — never block the money path under test.
vi.mock("./middleware/kafka", async (importOriginal) => {
  const original = await importOriginal<typeof import("./middleware/kafka")>();
  return {
    ...original,
    publishEvent: async () => ({ offset: "0" }),
  };
});

// middlewareIntegration requires live integration env at module load — stub
// the tigerBeetle handle; these tests never reach ledger writes.
vi.mock("./middleware/middlewareIntegration", () => ({
  tigerBeetle: { createTransfer: async () => ({ id: "tb-mock" }) },
}));

afterEach(() => {
  redisHandle.current = null;
  redisHealth.current = false;
  vi.unstubAllEnvs();
});

describe("coreAtomicity idempotency store — fail-closed on money paths (F2-9)", () => {
  it("getIdempotentResult throws a retryable error in production when Redis is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { getIdempotentResult, IdempotencyStoreUnavailableError } = await import("./middleware/coreAtomicity");
    await expect(getIdempotentResult("k1")).rejects.toBeInstanceOf(IdempotencyStoreUnavailableError);
    await expect(getIdempotentResult("k1")).rejects.toMatchObject({ retryable: true });
  });

  it("setIdempotentResult throws in production when Redis errors", async () => {
    vi.stubEnv("NODE_ENV", "production");
    redisHandle.current = { set: async () => { throw new Error("ECONNREFUSED"); } };
    const { setIdempotentResult, IdempotencyStoreUnavailableError } = await import("./middleware/coreAtomicity");
    await expect(setIdempotentResult("k2", { ok: true })).rejects.toBeInstanceOf(IdempotencyStoreUnavailableError);
  });

  it("falls back to in-memory store outside production (dev convenience)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { getIdempotentResult, setIdempotentResult } = await import("./middleware/coreAtomicity");
    await setIdempotentResult("k3", { ok: true });
    expect(await getIdempotentResult("k3")).toEqual({ ok: true });
  });
});

describe("fundFlowHardening tx-lock — deny-on-unavailable (F1-3)", () => {
  it("acquire step fails the transaction when Redis is unavailable (never proceeds unlocked)", async () => {
    const { createCoordinatedTransaction, executeCoordinatedTransaction } = await import("./_core/fundFlowHardening");
    const tx = createCoordinatedTransaction(42, "cross_border_transfer", 100, "USD");
    const result = await executeCoordinatedTransaction(tx);
    const lockStep = result.steps.find((s) => s.name === "acquire_lock");
    // Operation DENIED: lock step failed with the retryable unavailable error…
    expect(lockStep?.status).toBe("failed");
    expect(lockStep?.error).toMatch(/Redis unavailable/);
    // …and the transaction compensated instead of completing.
    expect(result.status).not.toBe("completed");
    expect(["compensated", "failed"]).toContain(result.status);
    // No money-moving step after the lock may have run.
    expect(result.steps.find((s) => s.name === "debit_sender")?.status).toBe("pending");
  });

  it("acquires with a unique token and releases via compare-and-delete when Redis works", async () => {
    const store = new Map<string, string>();
    const evalCalls: Array<{ key: string; token: string }> = [];
    redisHandle.current = {
      set: async (key: string, value: string, ..._args: unknown[]) => {
        if (store.has(key)) return null; // NX contention
        store.set(key, value);
        return "OK";
      },
      eval: async (_script: string, _n: number, key: string, token: string) => {
        evalCalls.push({ key, token });
        if (store.get(key) === token) { store.delete(key); return 1; }
        return 0;
      },
    };
    const { createCoordinatedTransaction, executeCoordinatedTransaction } = await import("./_core/fundFlowHardening");
    const tx = createCoordinatedTransaction(7, "cross_border_transfer", 50, "USD");
    const result = await executeCoordinatedTransaction(tx);
    // Lock lifecycle completed: acquired (unique token ≠ old constant "1") and released via Lua.
    expect(result.steps.find((s) => s.name === "acquire_lock")?.status).toBe("completed");
    expect(evalCalls.length).toBeGreaterThan(0);
    expect(evalCalls[0].token).not.toBe("1");
    expect(evalCalls[0].token.length).toBeGreaterThan(16);
    // Lock was released (compare-and-delete matched the token).
    expect(store.size).toBe(0);
  });
});

// ── W12-FIX-2: sync checkIdempotency/storeIdempotency + async claimIdempotency ──

describe("coreAtomicity sync idempotency — fail-closed for money callers (W12-FIX-2)", () => {
  it("checkIdempotency throws retryable error in production when Redis is unhealthy", async () => {
    vi.stubEnv("NODE_ENV", "production");
    redisHealth.current = false;
    const { checkIdempotency, IdempotencyStoreUnavailableError } = await import("./middleware/coreAtomicity");
    expect(() => checkIdempotency("m1")).toThrowError(IdempotencyStoreUnavailableError);
    try {
      checkIdempotency("m1");
      expect.unreachable();
    } catch (e) {
      expect((e as { retryable?: boolean }).retryable).toBe(true);
    }
  });

  it("checkIdempotency keeps in-memory fallback outside production (WARN path)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    redisHealth.current = false;
    const { checkIdempotency, storeIdempotency } = await import("./middleware/coreAtomicity");
    storeIdempotency("m2", { ok: 1 });
    expect(checkIdempotency("m2")).toEqual({ cached: true, result: { ok: 1 } });
  });

  it("checkIdempotency works against the in-memory fast path when Redis is healthy in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    redisHealth.current = true;
    redisHandle.current = { set: async () => "OK" };
    const { checkIdempotency, storeIdempotency } = await import("./middleware/coreAtomicity");
    storeIdempotency("m3", { ok: 2 });
    expect(checkIdempotency("m3")).toEqual({ cached: true, result: { ok: 2 } });
  });

  it("storeIdempotency writes the result through to Redis under the claim key (result: prefix, PX TTL)", async () => {
    const writes: Array<{ key: string; value: string; args: unknown[] }> = [];
    redisHandle.current = {
      set: async (key: string, value: string, ...args: unknown[]) => {
        writes.push({ key, value, args });
        return "OK";
      },
    };
    const { storeIdempotency } = await import("./middleware/coreAtomicity");
    storeIdempotency("m4", { ref: "TOP-1" });
    await new Promise((r) => setImmediate(r));
    expect(writes.length).toBe(1);
    expect(writes[0].key).toBe("idempclaim:m4");
    expect(writes[0].value).toBe('result:{"ref":"TOP-1"}');
    expect(writes[0].args[0]).toBe("PX");
  });

  it("storeIdempotency never throws post-commit when Redis is down in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    redisHandle.current = null;
    const { storeIdempotency } = await import("./middleware/coreAtomicity");
    expect(() => storeIdempotency("m5", { ok: 3 })).not.toThrow();
  });
});

describe("coreAtomicity claimIdempotency — authoritative async claim (W12-FIX-2)", () => {
  function makeClaimClient(store: Map<string, string>) {
    return {
      set: async (key: string, value: string, ...args: unknown[]) => {
        if (args.includes("NX") && store.has(key)) return null;
        store.set(key, value);
        return "OK";
      },
      get: async (key: string) => store.get(key) ?? null,
    };
  }

  it("fresh claim → cached:false; after storeIdempotency, replay → cached:true with result", async () => {
    const store = new Map<string, string>();
    redisHandle.current = makeClaimClient(store);
    const { claimIdempotency, storeIdempotency } = await import("./middleware/coreAtomicity");
    const first = await claimIdempotency("c1");
    expect(first.cached).toBe(false);
    expect(store.get("idempclaim:c1")).toMatch(/^pending:/);
    storeIdempotency("c1", { reference: "BILL-9" });
    await new Promise((r) => setImmediate(r));
    const replay = await claimIdempotency("c1");
    expect(replay).toEqual({ cached: true, result: { reference: "BILL-9" } });
  });

  it("in-flight (pending) claim throws retryable IdempotencyConflictError — never double-executes", async () => {
    const store = new Map<string, string>();
    redisHandle.current = makeClaimClient(store);
    const { claimIdempotency, IdempotencyConflictError } = await import("./middleware/coreAtomicity");
    await claimIdempotency("c2"); // first request now in flight (pending marker)
    await expect(claimIdempotency("c2")).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(claimIdempotency("c2")).rejects.toMatchObject({ retryable: true, code: "CONFLICT" });
  });

  it("Redis unavailable in production → retryable IdempotencyStoreUnavailableError (fail-closed)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    redisHandle.current = null;
    const { claimIdempotency, IdempotencyStoreUnavailableError } = await import("./middleware/coreAtomicity");
    await expect(claimIdempotency("c3")).rejects.toBeInstanceOf(IdempotencyStoreUnavailableError);
  });

  it("Redis unavailable outside production → in-memory fallback", async () => {
    vi.stubEnv("NODE_ENV", "test");
    redisHandle.current = null;
    const { claimIdempotency } = await import("./middleware/coreAtomicity");
    const res = await claimIdempotency("c4");
    expect(res.cached).toBe(false);
  });
});
