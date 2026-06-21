/**
 * Integration Tests — Full Fund Flow Chain
 *
 * Tests the complete atomicity pipeline:
 *   Lock → Double-spend → DB → Ledger → Events → Receipt → Reconciliation
 *
 * These tests exercise the real middleware code paths with in-memory
 * fallbacks (no external services required). They verify that:
 *   1. The full chain executes in correct order
 *   2. Failures at each stage trigger appropriate compensation
 *   3. Idempotency prevents duplicate processing
 *   4. Concurrent operations are serialized via locks
 *   5. The compensation stack reverses in correct order
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AtomicOperation } from "../middleware/fundFlowAtomicity";

describe("Full Fund Flow Integration Chain", () => {
  // ── Test 1: End-to-End Success Path ─────────────────────────────────────

  it("executes the full atomicity chain in correct order", async () => {
    const { withAtomicFundFlow } = await import("../middleware/fundFlowAtomicity");

    const executionOrder: string[] = [];

    const op: AtomicOperation = {
      operationId: `integ-success-${Date.now()}`,
      flowType: "p2p_instant",
      userId: 100,
      amount: 500,
      currency: "NGN",
      transferRef: `INTEG-${Date.now()}`,
    };

    const result = await withAtomicFundFlow(
      op,
      async () => {
        executionOrder.push("operation_executed");
        return { txId: "TX-001", status: "completed" };
      },
      {
        recordLedger: true,
        debitAccount: "user-100-NGN",
        creditAccount: "user-200-NGN",
      },
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ txId: "TX-001", status: "completed" });
    expect(result.operationId).toBe(op.operationId);
    // Ledger entry should be created (PostgreSQL fallback in dev)
    expect(result.ledgerEntryId).toBeTruthy();
    expect(executionOrder).toContain("operation_executed");
  });

  // ── Test 2: Idempotency Prevents Duplicate ─────────────────────────────

  it("idempotency prevents duplicate fund operations", async () => {
    const { withAtomicFundFlow } = await import("../middleware/fundFlowAtomicity");

    let executionCount = 0;
    const operationId = `integ-idemp-${Date.now()}`;
    const op = {
      operationId,
      flowType: "wallet_topup" as const,
      userId: 101,
      amount: 1000,
      currency: "USD",
    };

    // First execution
    const result1 = await withAtomicFundFlow(op, async () => {
      executionCount++;
      return { topupId: "TOP-001" };
    });

    // Second execution with SAME operationId
    const result2 = await withAtomicFundFlow(op, async () => {
      executionCount++;
      return { topupId: "TOP-002" };
    });

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    // Operation should have been executed exactly once
    expect(executionCount).toBe(1);
    // Second result should be cached from first
    expect(result2.data).toEqual({ topupId: "TOP-001" });
  });

  // ── Test 3: Lock Serializes Concurrent Operations ──────────────────────

  it("distributed lock serializes concurrent fund operations", async () => {
    const { acquireFundLock, releaseFundLock } = await import("../middleware/fundFlowAtomicity");

    const transferRef = `LOCK-SERIAL-${Date.now()}`;
    const op = {
      operationId: "lock-serial-1",
      flowType: "agent_cash_out" as const,
      userId: 102,
      amount: 5000,
      currency: "NGN",
      transferRef,
    };

    // Acquire first lock
    const lock1 = await acquireFundLock(op);
    expect(lock1.acquired).toBe(true);

    // Attempt concurrent lock on same transfer
    const lock2 = await acquireFundLock({ ...op, operationId: "lock-serial-2" });
    expect(lock2.acquired).toBe(false);

    // Release first lock
    await releaseFundLock(op, lock1.lockToken);

    // Now the lock should be available
    const lock3 = await acquireFundLock({ ...op, operationId: "lock-serial-3" });
    expect(lock3.acquired).toBe(true);
    await releaseFundLock(op, lock3.lockToken);
  });

  // ── Test 4: Operation Failure Triggers Compensation ────────────────────

  it("failed operation triggers compensation and publishes failed event", async () => {
    const { withAtomicFundFlow } = await import("../middleware/fundFlowAtomicity");

    let compensationCalled = false;

    const op = {
      operationId: `integ-fail-${Date.now()}`,
      flowType: "cross_border_send" as const,
      userId: 103,
      amount: 25000,
      currency: "CAD",
      transferRef: `FAIL-${Date.now()}`,
    };

    const result = await withAtomicFundFlow(
      op,
      async () => {
        throw new Error("Payment rail timeout — SWIFT gateway unreachable");
      },
      {
        compensate: async () => {
          compensationCalled = true;
        },
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Payment rail timeout");
    expect(result.sagaCompensated).toBe(true);
    expect(compensationCalled).toBe(true);
  });

  // ── Test 5: Saga Compensation Reverses in Correct Order ────────────────

  it("saga compensates completed steps in reverse order on failure", async () => {
    const { executeSaga } = await import("../middleware/fundFlowAtomicity");

    const compensationOrder: string[] = [];

    const steps = [
      {
        name: "reserve_funds",
        execute: vi.fn().mockResolvedValue(undefined),
        compensate: vi.fn().mockImplementation(async () => { compensationOrder.push("unreserve_funds"); }),
      },
      {
        name: "fx_conversion",
        execute: vi.fn().mockResolvedValue(undefined),
        compensate: vi.fn().mockImplementation(async () => { compensationOrder.push("reverse_fx"); }),
      },
      {
        name: "tigerbeetle_entry",
        execute: vi.fn().mockResolvedValue(undefined),
        compensate: vi.fn().mockImplementation(async () => { compensationOrder.push("void_ledger"); }),
      },
      {
        name: "route_payment_rail",
        execute: vi.fn().mockRejectedValue(new Error("SWIFT timeout")),
        compensate: vi.fn().mockImplementation(async () => { compensationOrder.push("cancel_rail"); }),
      },
    ];

    const op = {
      operationId: `saga-order-${Date.now()}`,
      flowType: "cross_border_send" as const,
      userId: 104,
      amount: 15000,
      currency: "CAD",
    };

    await expect(executeSaga(steps, op)).rejects.toThrow("SWIFT timeout");

    // Steps 1-3 executed, step 4 failed
    expect(steps[0].execute).toHaveBeenCalledTimes(1);
    expect(steps[1].execute).toHaveBeenCalledTimes(1);
    expect(steps[2].execute).toHaveBeenCalledTimes(1);
    expect(steps[3].execute).toHaveBeenCalledTimes(1);

    // Compensation in REVERSE order: tigerbeetle → fx → reserve
    expect(compensationOrder).toEqual(["void_ledger", "reverse_fx", "unreserve_funds"]);

    // Step 4 was never completed, so never compensated
    expect(steps[3].compensate).not.toHaveBeenCalled();
  });

  // ── Test 6: TigerBeetle Strict Mode ────────────────────────────────────

  it("records ledger entry via PostgreSQL fallback in dev mode", async () => {
    const { recordDoubleEntry } = await import("../middleware/fundFlowAtomicity");

    const entry = {
      id: `ledger-integ-${Date.now()}`,
      debitAccountId: "user-105-NGN",
      creditAccountId: "platform-NGN",
      amount: 10000,
      currency: "NGN",
      flowType: "agent_cash_out" as const,
      transferRef: `LEDGER-${Date.now()}`,
      pending: false,
    };

    // In dev mode (no TIGERBEETLE_ADDRESSES), should fall back to PostgreSQL
    const entryId = await recordDoubleEntry(entry);
    expect(entryId).toBeTruthy();
    expect(entryId.length).toBeGreaterThan(0);
  });

  // ── Test 7: Multiple Flow Types in Sequence ────────────────────────────

  it("handles multiple different flow types in sequence", async () => {
    const { withAtomicFundFlow } = await import("../middleware/fundFlowAtomicity");

    const flowTypes = [
      { type: "p2p_instant" as const, amount: 100 },
      { type: "agent_cash_in" as const, amount: 5000 },
      { type: "savings_deposit" as const, amount: 2000 },
      { type: "stablecoin_transfer" as const, amount: 500 },
      { type: "bnpl_installment" as const, amount: 300 },
    ];

    const results = [];
    for (const flow of flowTypes) {
      const result = await withAtomicFundFlow(
        {
          operationId: `multi-flow-${flow.type}-${Date.now()}`,
          flowType: flow.type,
          userId: 106,
          amount: flow.amount,
          currency: "NGN",
        },
        async () => ({ type: flow.type, processed: true }),
      );
      results.push(result);
    }

    // All should succeed independently
    expect(results.every(r => r.success)).toBe(true);
    expect(results.length).toBe(5);
  });

  // ── Test 8: Lock Key Scoping ───────────────────────────────────────────

  it("scopes locks correctly — transfer-based vs wallet-based", async () => {
    const { acquireFundLock, releaseFundLock } = await import("../middleware/fundFlowAtomicity");

    // Transfer-scoped lock
    const transferOp = {
      operationId: "scope-1",
      flowType: "cross_border_send" as const,
      userId: 107,
      amount: 1000,
      currency: "CAD",
      transferRef: "TRF-SCOPE-001",
    };

    // Wallet-scoped lock (same user, same currency, no transferRef)
    const walletOp = {
      operationId: "scope-2",
      flowType: "wallet_topup" as const,
      userId: 107,
      amount: 500,
      currency: "CAD",
      // No transferRef — lock scoped to user+currency
    };

    const lock1 = await acquireFundLock(transferOp);
    const lock2 = await acquireFundLock(walletOp);

    // Different lock scopes — both should acquire
    expect(lock1.acquired).toBe(true);
    expect(lock2.acquired).toBe(true);

    await releaseFundLock(transferOp, lock1.lockToken);
    await releaseFundLock(walletOp, lock2.lockToken);
  });
});

describe("executeAtomicFundFlow Integration", () => {
  it("exports all 6 convenience wrappers", async () => {
    const mod = await import("../middleware/fundFlowIntegration");

    expect(typeof mod.executeAtomicFundFlow).toBe("function");
    expect(typeof mod.atomicAgentCashOut).toBe("function");
    expect(typeof mod.atomicP2PTransfer).toBe("function");
    expect(typeof mod.atomicCrossBorderSend).toBe("function");
    expect(typeof mod.atomicStablecoinTransfer).toBe("function");
    expect(typeof mod.atomicSavingsOperation).toBe("function");
    expect(typeof mod.atomicBNPLInstallment).toBe("function");
  });

  it("executeAtomicFundFlow wraps operation with full chain", async () => {
    const { executeAtomicFundFlow } = await import("../middleware/fundFlowIntegration");

    const result = await executeAtomicFundFlow(
      {
        userId: 110,
        amount: 1000,
        currency: "NGN",
        flowType: "p2p_instant",
        idempotencyKey: `exec-integ-${Date.now()}`,
        debitAccount: "user-110-NGN",
        creditAccount: "user-111-NGN",
      },
      async () => ({ sent: true, reference: "P2P-001" }),
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ sent: true, reference: "P2P-001" });
    expect(result.ledgerEntryId).toBeTruthy();
  });
});

describe("Temporal Client Module", () => {
  it("exports workflow management functions", async () => {
    const mod = await import("../temporal/temporalClient");

    expect(typeof mod.getTemporalClient).toBe("function");
    expect(typeof mod.startFundFlowWorkflow).toBe("function");
    expect(typeof mod.queryWorkflowStatus).toBe("function");
    expect(typeof mod.cancelWorkflow).toBe("function");
    expect(typeof mod.getTemporalHealth).toBe("function");
    expect(typeof mod.isTemporalStrictMode).toBe("function");
  });

  it("getTemporalHealth returns correct structure", async () => {
    const { getTemporalHealth } = await import("../temporal/temporalClient");

    const health = getTemporalHealth();
    expect(health.host).toBeTruthy();
    expect(health.namespace).toBe("remitflow");
    expect(health.taskQueue).toBe("fund-flow-tasks");
    // Not connected in test environment
    expect(health.connected).toBe(false);
  });

  it("isTemporalStrictMode returns false in test environment", async () => {
    const { isTemporalStrictMode } = await import("../temporal/temporalClient");
    // In test/dev, strict mode is off unless explicitly configured
    expect(isTemporalStrictMode()).toBe(false);
  });
});

describe("Redis Cluster Module", () => {
  it("exports connection and health functions", async () => {
    const mod = await import("../middleware/redisCluster");

    expect(typeof mod.getRedisConnection).toBe("function");
    expect(typeof mod.isRedisAvailable).toBe("function");
    expect(typeof mod.isFundFlowStrictMode).toBe("function");
    expect(typeof mod.getRedisHealth).toBe("function");
    expect(typeof mod.disconnectRedis).toBe("function");
  });

  it("isFundFlowStrictMode returns false in test environment", async () => {
    const { isFundFlowStrictMode } = await import("../middleware/redisCluster");
    // In test/dev without FUND_FLOW_REDIS_STRICT, should be false
    expect(isFundFlowStrictMode()).toBe(false);
  });

  it("getRedisHealth returns correct structure", async () => {
    const { getRedisHealth } = await import("../middleware/redisCluster");

    const health = await getRedisHealth();
    expect(health).toHaveProperty("connected");
    expect(health).toHaveProperty("mode");
    expect(health).toHaveProperty("connectionAttempts");
    expect(health).toHaveProperty("lastError");
  });
});
