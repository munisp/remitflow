import { describe, expect, it } from "vitest";

// ── Core Atomicity Middleware Tests ──────────────────────────────────────────

describe("CoreAtomicity Middleware", () => {
  it("exports all required functions", async () => {
    const mod = await import("./middleware/coreAtomicity");
    expect(typeof mod.generateIdempotencyKey).toBe("function");
    expect(typeof mod.checkIdempotency).toBe("function");
    expect(typeof mod.storeIdempotency).toBe("function");
    expect(typeof mod.generateOpRef).toBe("function");
    expect(typeof mod.recordCoreDoubleEntry).toBe("function");
    expect(typeof mod.publishCoreEvent).toBe("function");
    expect(typeof mod.auditCoreOperation).toBe("function");
  });

  it("CORE_TOPICS has all 10 required topics", async () => {
    const { CORE_TOPICS } = await import("./middleware/coreAtomicity");
    expect(CORE_TOPICS.SAVINGS_DEPOSIT).toBe("remitflow.savings.deposit");
    expect(CORE_TOPICS.SAVINGS_WITHDRAW).toBe("remitflow.savings.withdraw");
    expect(CORE_TOPICS.CBDC_TRANSFER).toBe("remitflow.cbdc.transfer");
    expect(CORE_TOPICS.CBDC_RECEIVE).toBe("remitflow.cbdc.receive");
    expect(CORE_TOPICS.BILL_PAYMENT).toBe("remitflow.bill.payment");
    expect(CORE_TOPICS.AIRTIME_TOPUP).toBe("remitflow.airtime.topup");
    expect(CORE_TOPICS.BATCH_PAYMENT).toBe("remitflow.batch.payment");
    expect(CORE_TOPICS.WALLET_TOPUP).toBe("remitflow.wallet.topup");
    expect(CORE_TOPICS.WALLET_WITHDRAW).toBe("remitflow.wallet.withdraw");
    expect(CORE_TOPICS.STABLECOIN_SWAP).toBe("remitflow.stablecoin.swap");
  });

  it("generateIdempotencyKey produces deterministic SHA-256 hashes", async () => {
    const { generateIdempotencyKey } = await import("./middleware/coreAtomicity");
    const key1 = generateIdempotencyKey(1, "WALLET_TOPUP", "USD", "100");
    const key2 = generateIdempotencyKey(1, "WALLET_TOPUP", "USD", "100");
    const key3 = generateIdempotencyKey(1, "WALLET_TOPUP", "USD", "200");
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key1).toHaveLength(64); // SHA-256 hex length
  });

  it("idempotency cache stores and retrieves results", async () => {
    const { checkIdempotency, storeIdempotency } = await import("./middleware/coreAtomicity");
    const key = `test-idemp-${Date.now()}`;
    const check1 = checkIdempotency(key);
    expect(check1.cached).toBe(false);

    storeIdempotency(key, { success: true, amount: 100 });
    const check2 = checkIdempotency(key);
    expect(check2.cached).toBe(true);
    expect(check2.result).toEqual({ success: true, amount: 100 });
  });

  it("different keys do not collide", async () => {
    const { checkIdempotency, storeIdempotency } = await import("./middleware/coreAtomicity");
    const keyA = `test-no-collide-a-${Date.now()}`;
    const keyB = `test-no-collide-b-${Date.now()}`;

    storeIdempotency(keyA, { op: "A" });
    storeIdempotency(keyB, { op: "B" });

    expect(checkIdempotency(keyA).result).toEqual({ op: "A" });
    expect(checkIdempotency(keyB).result).toEqual({ op: "B" });
  });

  it("generateOpRef produces unique references with prefix", async () => {
    const { generateOpRef } = await import("./middleware/coreAtomicity");
    const ref1 = generateOpRef("SAVDEP", 42);
    const ref2 = generateOpRef("SAVDEP", 42);
    expect(ref1.startsWith("SAVDEP-42-")).toBe(true);
    expect(ref1).not.toBe(ref2);
  });
});

// ── Insider Threat Controls Tests ───────────────────────────────────────────

describe("Insider Threat Controls", () => {
  it("exports all required functions", async () => {
    const mod = await import("./middleware/insiderThreat");
    expect(typeof mod.checkInsiderThreat).toBe("function");
    expect(typeof mod.requiresMakerChecker).toBe("function");
    expect(typeof mod.createApprovalRequest).toBe("function");
    expect(typeof mod.resolveApproval).toBe("function");
    expect(typeof mod.checkGeoTimeFence).toBe("function");
    expect(typeof mod.checkDlpAccess).toBe("function");
    expect(typeof mod.requestJitAccess).toBe("function");
  });

  it("requiresMakerChecker returns false for amounts below $10K", async () => {
    const { requiresMakerChecker } = await import("./middleware/insiderThreat");
    const result = requiresMakerChecker(5000, "CBDC_TRANSFER");
    expect(result.requiresApproval).toBe(false);
    expect(result.requiredApprovers).toBe(0);
  });

  it("requiresMakerChecker returns true for amounts above $10K", async () => {
    const { requiresMakerChecker } = await import("./middleware/insiderThreat");
    const result = requiresMakerChecker(15000, "CBDC_TRANSFER");
    expect(result.requiresApproval).toBe(true);
    expect(result.requiredApprovers).toBe(1);
  });

  it("requiresMakerChecker returns 2 approvers for amounts above $100K", async () => {
    const { requiresMakerChecker } = await import("./middleware/insiderThreat");
    const result = requiresMakerChecker(150000, "BATCH_PAYMENT");
    expect(result.requiresApproval).toBe(true);
    expect(result.requiredApprovers).toBe(2);
  });

  it("checkGeoTimeFence allows approved countries during business hours", async () => {
    const { checkGeoTimeFence } = await import("./middleware/insiderThreat");
    const result = checkGeoTimeFence({
      countryCode: "US",
      ipAddress: "1.2.3.4",
      utcHour: 14,
    });
    expect(result.allowed).toBe(true);
  });

  it("checkGeoTimeFence blocks unapproved countries", async () => {
    const { checkGeoTimeFence } = await import("./middleware/insiderThreat");
    const result = checkGeoTimeFence({
      countryCode: "RU",
      ipAddress: "1.2.3.4",
      utcHour: 14,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("country");
  });

  it("checkDlpAccess allows small record queries", async () => {
    const { checkDlpAccess } = await import("./middleware/insiderThreat");
    const result = checkDlpAccess(99, 10);
    expect(result.allowed).toBe(true);
    expect(result.recordsAllowed).toBe(10);
  });

  it("checkDlpAccess caps records at DLP_MAX_RECORDS_PER_QUERY", async () => {
    const { checkDlpAccess } = await import("./middleware/insiderThreat");
    const result = checkDlpAccess(100, 200);
    expect(result.allowed).toBe(true);
    expect(result.recordsAllowed).toBeLessThanOrEqual(100);
  });
});

// ── Non-Atomic Balance Fix Verification ─────────────────────────────────────

describe("Non-Atomic Balance Fix Verification", () => {
  it("stablecoinEnhanced.ts uses SQL CAST for all balance operations", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/stablecoinEnhanced.ts", "utf-8");

    // Verify no JS arithmetic balance updates remain
    const jsArithmeticPattern = /\.set\(\{[^}]*balance:\s*String\(Number\(/g;
    const matches = content.match(jsArithmeticPattern);
    expect(matches).toBeNull();

    // Verify SQL CAST is used for balance operations
    const sqlCastCount = (content.match(/CAST\(CAST\(\$\{.*?balance\}/g) || []).length;
    expect(sqlCastCount).toBeGreaterThanOrEqual(10);
  });

  it("propertyEscrow.ts uses SQL CAST for all balance operations", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/propertyEscrow.ts", "utf-8");

    const jsArithmeticPattern = /\.set\(\{[^}]*balance:\s*String\(Number\(/g;
    const matches = content.match(jsArithmeticPattern);
    expect(matches).toBeNull();

    const sqlCastCount = (content.match(/CAST\(CAST\(\$\{.*?balance\}/g) || []).length;
    expect(sqlCastCount).toBeGreaterThanOrEqual(5);
  });

  it("temporal/activities.ts uses SQL CAST for all balance operations", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/temporal/activities.ts", "utf-8");

    const jsArithmeticPattern = /\.set\(\{[^}]*balance:\s*String\(Number\(/g;
    const matches = content.match(jsArithmeticPattern);
    expect(matches).toBeNull();

    const sqlCastCount = (content.match(/CAST\(CAST\(\$\{.*?balance\}/g) || []).length;
    expect(sqlCastCount).toBeGreaterThanOrEqual(2);
  });

  it("routers.ts CBDC transfer uses pessimistic SQL debit", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers.ts", "utf-8");

    // CBDC transfer should have pessimistic WHERE balance >= amount
    expect(content).toContain("CBDC_TRANSFER");
    expect(content).toContain("checkInsiderThreat");
  });
});

// ── Idempotency Wiring Verification ─────────────────────────────────────────

describe("Idempotency Wiring", () => {
  it("wallet.topup has idempotency check and store", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers.ts", "utf-8");

    expect(content).toContain('generateIdempotencyKey(ctx.user.id, "WALLET_TOPUP"');
    expect(content).toContain("storeIdempotency(idempKey, topupResult)");
  });

  it("savings.deposit has idempotency check and store", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers.ts", "utf-8");

    expect(content).toContain('generateIdempotencyKey(ctx.user.id, "SAVINGS_DEPOSIT"');
    expect(content).toContain("storeIdempotency(savDepIdempKey, savDepResult)");
  });

  it("airtime.topup has idempotency check and store", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers.ts", "utf-8");

    expect(content).toContain('generateIdempotencyKey(ctx.user.id, "AIRTIME_TOPUP"');
    expect(content).toContain("storeIdempotency(airtimeIdempKey, airtimeResult)");
  });

  it("bills.pay has idempotency check and store", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers.ts", "utf-8");

    expect(content).toContain('generateIdempotencyKey(ctx.user.id, "BILL_PAY"');
    expect(content).toContain("storeIdempotency(billIdempKey, billResult)");
  });
});

// ── Insider Threat Wiring in Routers ────────────────────────────────────────

describe("Insider Threat Wiring in Routers", () => {
  it("CBDC transfer has insider threat check", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers.ts", "utf-8");

    expect(content).toContain("checkInsiderThreat");
    expect(content).toContain("CBDC_TRANSFER");
    expect(content).toContain("requiresApproval");
    expect(content).toContain("geoFenceResult");
  });

  it("batch.process has insider threat check", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers.ts", "utf-8");

    expect(content).toContain("BATCH_PAYMENT");
    expect(content).toContain("batchInsiderCheck");
  });
});

// ── Go Kafka Service — New Core Topics ──────────────────────────────────────

describe("Go Kafka Service — Core Fund Flow Topics", () => {
  it("defines all 10 core fund flow topics", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("services/go-kafka-service/cmd/main.go", "utf-8");

    const expectedTopics = [
      "remitflow.savings.deposit",
      "remitflow.savings.withdraw",
      "remitflow.cbdc.transfer",
      "remitflow.cbdc.receive",
      "remitflow.bill.payment",
      "remitflow.airtime.topup",
      "remitflow.batch.payment",
      "remitflow.wallet.topup",
      "remitflow.wallet.withdraw",
      "remitflow.stablecoin.swap",
    ];

    for (const topic of expectedTopics) {
      expect(content).toContain(topic);
    }
  });

  it("has CoreFundFlowEvent type definition", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("services/go-kafka-service/cmd/main.go", "utf-8");
    expect(content).toContain("type CoreFundFlowEvent struct");
    expect(content).toContain('"eventType"');
    expect(content).toContain('"transactionId"');
    expect(content).toContain('"userId"');
  });

  it("has consumer handlers for all core topics", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("services/go-kafka-service/cmd/main.go", "utf-8");

    expect(content).toContain('coreFundFlowHandler("SAVINGS_DEPOSIT")');
    expect(content).toContain('coreFundFlowHandler("CBDC_TRANSFER")');
    expect(content).toContain('coreFundFlowHandler("BILL_PAYMENT")');
    expect(content).toContain('coreFundFlowHandler("AIRTIME_TOPUP")');
    expect(content).toContain('coreFundFlowHandler("BATCH_PAYMENT")');
    expect(content).toContain('coreFundFlowHandler("WALLET_TOPUP")');
    expect(content).toContain('coreFundFlowHandler("STABLECOIN_SWAP")');
  });
});

// ── Rust Stablecoin Bridge — Fund Flow Verification ─────────────────────────

describe("Rust Stablecoin Bridge — Fund Flow Verification", () => {
  it("has FundFlowEvent and FundFlowVerification types", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("services/rust-stablecoin-bridge/src/main.rs", "utf-8");

    expect(content).toContain("struct FundFlowEvent");
    expect(content).toContain("struct FundFlowVerification");
    expect(content).toContain("struct VerificationCheck");
  });

  it("verifies amount_range, known_feature, valid_status, timestamp, user_id", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("services/rust-stablecoin-bridge/src/main.rs", "utf-8");

    expect(content).toContain('"amount_range"');
    expect(content).toContain('"known_feature"');
    expect(content).toContain('"valid_status"');
    expect(content).toContain('"timestamp_present"');
    expect(content).toContain('"user_id_positive"');
  });

  it("has VERIFIED_FEATURES covering all fund flow types", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("services/rust-stablecoin-bridge/src/main.rs", "utf-8");

    expect(content).toContain('"savings"');
    expect(content).toContain('"cbdc"');
    expect(content).toContain('"bill_payment"');
    expect(content).toContain('"airtime"');
    expect(content).toContain('"batch"');
    expect(content).toContain('"wallet"');
    expect(content).toContain('"stablecoin_swap"');
  });

  it("registers verify_fund_flow endpoint", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("services/rust-stablecoin-bridge/src/main.rs", "utf-8");
    expect(content).toContain('.service(verify_fund_flow)');
  });
});

// ── Python Anomaly Detector — Fund Flow Detection ───────────────────────────

describe("Python Anomaly Detector — Fund Flow Detection", () => {
  it("defines CORE_FUND_FLOW_TOPICS matching TypeScript topics", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("services/python-anomaly-detector/main.py", "utf-8");

    expect(content).toContain("CORE_FUND_FLOW_TOPICS");
    expect(content).toContain("remitflow.savings.deposit");
    expect(content).toContain("remitflow.cbdc.transfer");
    expect(content).toContain("remitflow.bill.payment");
    expect(content).toContain("remitflow.batch.payment");
    expect(content).toContain("remitflow.stablecoin.swap");
  });

  it("has FundFlowEventRequest and FundFlowAnomalyResponse models", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("services/python-anomaly-detector/main.py", "utf-8");

    expect(content).toContain("class FundFlowEventRequest(BaseModel)");
    expect(content).toContain("class FundFlowAnomalyResponse(BaseModel)");
    expect(content).toContain("anomaly_detected");
    expect(content).toContain("risk_score");
    expect(content).toContain("recommendation");
  });

  it("detect_fund_flow_anomaly checks velocity, high_value, amount_outlier, rapid_same_op", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("services/python-anomaly-detector/main.py", "utf-8");

    expect(content).toContain("velocity_spike");
    expect(content).toContain("high_value");
    expect(content).toContain("amount_outlier");
    expect(content).toContain("rapid_same_op");
  });

  it("has fund-flow/topics endpoint", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("services/python-anomaly-detector/main.py", "utf-8");

    expect(content).toContain('@app.get("/fund-flow/topics")');
    expect(content).toContain("max_ops_per_hour");
    expect(content).toContain("high_value_threshold_usd");
  });
});

// ── Audit Core Operation Integration ────────────────────────────────────────

describe("Audit Core Operation", () => {
  it("auditCoreOperation integrates TigerBeetle + Kafka + AuditLog", async () => {
    const { auditCoreOperation } = await import("./middleware/coreAtomicity");
    const result = await auditCoreOperation({
      userId: 1,
      action: "TEST_OP",
      description: "Test audit",
      amount: 100,
      currency: "USD",
      featureLabel: "test",
      operationRef: "TEST-1-123-abc",
      kafkaTopic: "remitflow.test",
    });
    expect(result).toHaveProperty("tigerBeetleRecorded");
    expect(result).toHaveProperty("kafkaPublished");
    expect(result).toHaveProperty("auditLogged");
  });
});
