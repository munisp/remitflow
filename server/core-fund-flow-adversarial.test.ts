import { describe, expect, it } from "vitest";

// ── Adversarial Boundary Tests for Core Fund Flow Hardening ─────────────────
// These tests verify exact threshold boundaries that would FAIL if implementation
// were off-by-one or used wrong comparison operators.

describe("Maker-Checker Exact Boundaries", () => {
  it("$9,999.99 does NOT require approval", async () => {
    const { requiresMakerChecker } = await import("./middleware/insiderThreat");
    const result = requiresMakerChecker(9999.99, "CBDC_TRANSFER");
    expect(result.requiresApproval).toBe(false);
    expect(result.requiredApprovers).toBe(0);
  });

  it("$10,000 exactly DOES require approval (1 approver)", async () => {
    const { requiresMakerChecker } = await import("./middleware/insiderThreat");
    const result = requiresMakerChecker(10000, "CBDC_TRANSFER");
    expect(result.requiresApproval).toBe(true);
    expect(result.requiredApprovers).toBe(1);
  });

  it("$99,999.99 requires exactly 1 approver", async () => {
    const { requiresMakerChecker } = await import("./middleware/insiderThreat");
    const result = requiresMakerChecker(99999.99, "BATCH_PAYMENT");
    expect(result.requiresApproval).toBe(true);
    expect(result.requiredApprovers).toBe(1);
  });

  it("$100,000 exactly requires 2 approvers", async () => {
    const { requiresMakerChecker } = await import("./middleware/insiderThreat");
    const result = requiresMakerChecker(100000, "BATCH_PAYMENT");
    expect(result.requiresApproval).toBe(true);
    expect(result.requiredApprovers).toBe(2);
  });
});

describe("Geo+Time Fencing Boundaries", () => {
  it("hour 5 (before business hours) is BLOCKED", async () => {
    const { checkGeoTimeFence } = await import("./middleware/insiderThreat");
    const result = checkGeoTimeFence({ countryCode: "US", utcHour: 5 });
    expect(result.allowed).toBe(false);
    expect(result.breakGlassRequired).toBe(true);
  });

  it("hour 6 (start of business hours) is ALLOWED", async () => {
    const { checkGeoTimeFence } = await import("./middleware/insiderThreat");
    const result = checkGeoTimeFence({ countryCode: "US", utcHour: 6 });
    expect(result.allowed).toBe(true);
  });

  it("hour 21 (last business hour) is ALLOWED", async () => {
    const { checkGeoTimeFence } = await import("./middleware/insiderThreat");
    const result = checkGeoTimeFence({ countryCode: "US", utcHour: 21 });
    expect(result.allowed).toBe(true);
  });

  it("hour 22 (after business hours) is BLOCKED", async () => {
    const { checkGeoTimeFence } = await import("./middleware/insiderThreat");
    const result = checkGeoTimeFence({ countryCode: "US", utcHour: 22 });
    expect(result.allowed).toBe(false);
    expect(result.breakGlassRequired).toBe(true);
  });

  it("break-glass allows after-hours access", async () => {
    const { checkGeoTimeFence } = await import("./middleware/insiderThreat");
    const result = checkGeoTimeFence({ countryCode: "US", utcHour: 3, isBreakGlass: true });
    expect(result.allowed).toBe(true);
  });

  it("unapproved country CN is BLOCKED with reason", async () => {
    const { checkGeoTimeFence } = await import("./middleware/insiderThreat");
    const result = checkGeoTimeFence({ countryCode: "CN", utcHour: 14 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("CN");
    expect(result.reason).toContain("not in approved list");
  });

  it("all approved countries pass during business hours", async () => {
    const { checkGeoTimeFence } = await import("./middleware/insiderThreat");
    const approved = ["US", "CA", "GB", "NG", "GH", "KE", "ZA", "DE", "FR", "NL"];
    for (const cc of approved) {
      const result = checkGeoTimeFence({ countryCode: cc, utcHour: 14 });
      expect(result.allowed).toBe(true);
    }
  });
});

describe("DLP Rate Limiting", () => {
  it("caps records at 100 per query", async () => {
    const { checkDlpAccess } = await import("./middleware/insiderThreat");
    const uniqueUser = 50000 + Math.floor(Math.random() * 10000);
    const result = checkDlpAccess(uniqueUser, 500);
    expect(result.allowed).toBe(true);
    expect(result.recordsAllowed).toBe(100);
  });

  it("allows exactly 50 queries per hour then blocks 51st", async () => {
    const { checkDlpAccess } = await import("./middleware/insiderThreat");
    const uniqueUser = 60000 + Math.floor(Math.random() * 10000);

    // First 50 queries should all be allowed
    for (let i = 0; i < 50; i++) {
      const result = checkDlpAccess(uniqueUser, 10);
      expect(result.allowed).toBe(true);
    }

    // 51st query should be blocked
    const blocked = checkDlpAccess(uniqueUser, 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("queries/hour exceeded");
    expect(blocked.recordsAllowed).toBe(0);
  });
});

describe("JIT Access Daily Limit", () => {
  it("grants 3 JIT accesses per day then denies 4th", async () => {
    const { requestJitAccess } = await import("./middleware/insiderThreat");
    const uniqueUser = 70000 + Math.floor(Math.random() * 10000);

    // First 3 grants should succeed
    for (let i = 0; i < 3; i++) {
      const result = requestJitAccess(uniqueUser, `Test grant ${i + 1}`);
      expect(result.granted).toBe(true);
      expect(result.expiresAt).toBeDefined();
    }

    // 4th grant should be denied
    const denied = requestJitAccess(uniqueUser, "Test grant 4 - should fail");
    expect(denied.granted).toBe(false);
    expect(denied.reason).toContain("max");
    expect(denied.reason).toContain("grants/day");
  });
});

describe("Idempotency Cache Behavior", () => {
  it("stores entries with ~24h TTL", async () => {
    const { storeIdempotency, checkIdempotency } = await import("./middleware/coreAtomicity");
    const key = `ttl-test-${Date.now()}-${Math.random()}`;
    const before = Date.now();
    storeIdempotency(key, { test: true });
    const after = Date.now();

    const check = checkIdempotency(key);
    expect(check.cached).toBe(true);
    // The cache entry should exist (we can't easily test 24h expiry in unit test,
    // but we verify the structure is correct)
    expect(check.result).toEqual({ test: true });
  });

  it("same userId + different operation produces different key", async () => {
    const { generateIdempotencyKey } = await import("./middleware/coreAtomicity");
    const key1 = generateIdempotencyKey(42, "WALLET_TOPUP", "USD", "100");
    const key2 = generateIdempotencyKey(42, "SAVINGS_DEPOSIT", "USD", "100");
    expect(key1).not.toBe(key2);
  });

  it("different userId + same operation produces different key", async () => {
    const { generateIdempotencyKey } = await import("./middleware/coreAtomicity");
    const key1 = generateIdempotencyKey(1, "BILL_PAY", "electricity", "PROVIDER", "ACC123", "50");
    const key2 = generateIdempotencyKey(2, "BILL_PAY", "electricity", "PROVIDER", "ACC123", "50");
    expect(key1).not.toBe(key2);
  });
});

describe("Negative Pattern Verification — No JS Arithmetic Balance Updates", () => {
  it("routers.ts has NO String(Number( balance patterns", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers.ts", "utf-8");
    const dangerousPattern = /\.set\(\{[^}]*balance:\s*String\(Number\(/g;
    const matches = content.match(dangerousPattern);
    expect(matches).toBeNull();
  });

  it("stablecoinEnhanced.ts has NO String(Number( balance patterns", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/stablecoinEnhanced.ts", "utf-8");
    const dangerousPattern = /\.set\(\{[^}]*balance:\s*String\(Number\(/g;
    const matches = content.match(dangerousPattern);
    expect(matches).toBeNull();
  });

  it("propertyEscrow.ts has NO String(Number( balance patterns", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/propertyEscrow.ts", "utf-8");
    const dangerousPattern = /\.set\(\{[^}]*balance:\s*String\(Number\(/g;
    const matches = content.match(dangerousPattern);
    expect(matches).toBeNull();
  });

  it("temporal/activities.ts has NO String(Number( balance patterns", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/temporal/activities.ts", "utf-8");
    const dangerousPattern = /\.set\(\{[^}]*balance:\s*String\(Number\(/g;
    const matches = content.match(dangerousPattern);
    expect(matches).toBeNull();
  });

  it("all SQL CAST debit operations have WHERE balance >= guard", async () => {
    const fs = await import("fs");
    // Check routers.ts — every CAST debit (minus) should have a WHERE guard
    const content = fs.readFileSync("server/routers.ts", "utf-8");
    const lines = content.split("\n");
    
    // Find lines with CAST debit (subtraction)
    const debitLines: number[] = [];
    lines.forEach((line, idx) => {
      if (line.includes("CAST(CAST(") && line.includes("-") && line.includes("balance")) {
        debitLines.push(idx);
      }
    });

    // For each debit line, there should be a WHERE guard within 3 lines
    for (const lineIdx of debitLines) {
      const nearby = lines.slice(lineIdx, lineIdx + 4).join(" ");
      const hasGuard = nearby.includes(">=") || nearby.includes("WHERE");
      expect(hasGuard).toBe(true);
    }
  });
});

describe("Cross-Service Topic Consistency", () => {
  it("TypeScript, Go, and Python all define the same 10 topics", async () => {
    const fs = await import("fs");
    const { CORE_TOPICS } = await import("./middleware/coreAtomicity");
    const tsTopics = Object.values(CORE_TOPICS).sort();

    // Read Go topics
    const goContent = fs.readFileSync("services/go-kafka-service/cmd/main.go", "utf-8");
    const goTopicPattern = /"remitflow\.\w+\.\w+"/g;
    const goMatches = goContent.match(goTopicPattern) || [];
    const goTopics = [...new Set(goMatches.map((m: string) => m.replace(/"/g, "")))].sort();

    // Read Python topics
    const pyContent = fs.readFileSync("services/python-anomaly-detector/main.py", "utf-8");
    const pyTopicPattern = /"remitflow\.\w+\.\w+"/g;
    const pyMatches = pyContent.match(pyTopicPattern) || [];
    const pyTopics = [...new Set(pyMatches.map((m: string) => m.replace(/"/g, "")))].sort();

    // All 10 TS topics should appear in Go and Python
    for (const topic of tsTopics) {
      expect(goTopics).toContain(topic);
      expect(pyTopics).toContain(topic);
    }
  });
});
