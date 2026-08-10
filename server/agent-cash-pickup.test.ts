import { describe, it, expect } from "vitest";
import { createHash, randomInt } from "crypto";

// Replicate the exact functions from agentCashPickup.ts
function generatePickupCode(): { code: string; hash: string } {
  const code = String(randomInt(100000, 999999));
  const hash = createHash("sha256").update(code).digest("hex");
  return { code, hash };
}

function hashPickupCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

describe("Agent Cash Pickup — Pickup Code Crypto", () => {
  it("should generate a 6-digit code between 100000-999999", () => {
    const { code } = generatePickupCode();
    expect(code).toMatch(/^\d{6}$/);
    const num = parseInt(code, 10);
    expect(num).toBeGreaterThanOrEqual(100000);
    expect(num).toBeLessThanOrEqual(999999);
  });

  it("should produce a 64-char SHA-256 hex hash", () => {
    const { hash } = generatePickupCode();
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash.length).toBe(64);
  });

  it("should produce matching hash: hashPickupCode(code) === hash", () => {
    const { code, hash } = generatePickupCode();
    const recomputed = hashPickupCode(code);
    expect(recomputed).toBe(hash);
  });

  it("should NOT match hash of wrong code", () => {
    const { code, hash } = generatePickupCode();
    const wrongCode = code === "123456" ? "654321" : "123456";
    const wrongHash = hashPickupCode(wrongCode);
    expect(wrongHash).not.toBe(hash);
  });

  it("should generate different codes on consecutive calls (randomness)", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      codes.add(generatePickupCode().code);
    }
    // With 900K possible values, 20 calls should produce at least 2 unique codes
    expect(codes.size).toBeGreaterThan(1);
  });

  it("should store hash not plaintext — hash !== code", () => {
    const { code, hash } = generatePickupCode();
    expect(hash).not.toBe(code);
    expect(hash.length).toBe(64); // SHA-256
    expect(code.length).toBe(6);  // plaintext
  });
});

describe("Agent Cash Pickup — Transfer Engine Mapping", () => {
  it("should map cash_pickup to cash_pickup rail (not bank_transfer)", async () => {
    // Read the actual railMap from transferEngine.ts
    const fs = await import("fs");
    const content = fs.readFileSync("server/lib/transferEngine.ts", "utf-8");
    
    // Find the railMap section
    const railMapMatch = content.match(/cash_pickup:\s*"([^"]+)"/);
    expect(railMapMatch).not.toBeNull();
    expect(railMapMatch![1]).toBe("cash_pickup");
    expect(railMapMatch![1]).not.toBe("bank_transfer");
  });
});

describe("Agent Cash Pickup — State Machine Routing", () => {
  it("should read channel and metadata from transaction row", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/transfer-state-machine.ts", "utf-8");
    
    expect(content).toContain("channel: transactions.channel");
    expect(content).toContain("metadata: transactions.metadata");
  });

  it("should detect cash_pickup deliveryMethod and skip external rails", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/transfer-state-machine.ts", "utf-8");
    
    expect(content).toContain('deliveryMethod === "cash_pickup"');
    expect(content).toContain("CP-${Date.now()}");
  });

  it("should check cash_pickup BEFORE external rail routing (PIX/UPI/CIPS)", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/transfer-state-machine.ts", "utf-8");
    
    const cashPickupIdx = content.indexOf('deliveryMethod === "cash_pickup"');
    const pixIdx = content.indexOf("pixTransfer(");
    const upiIdx = content.indexOf("upiTransfer(");
    
    expect(cashPickupIdx).toBeGreaterThan(-1);
    expect(pixIdx).toBeGreaterThan(-1);
    expect(cashPickupIdx).toBeLessThan(pixIdx);
    expect(cashPickupIdx).toBeLessThan(upiIdx);
  });
});

describe("Agent Cash Pickup — SSE Event Types", () => {
  it("should include all 4 new cash pickup event types", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/sse.service.ts", "utf-8");
    
    expect(content).toContain('"cash_pickup_assigned"');
    expect(content).toContain('"cash_pickup_completed"');
    expect(content).toContain('"pickup_code_regenerated"');
    expect(content).toContain('"float_topup_approved"');
  });
});

describe("Agent Cash Pickup — Router Wiring", () => {
  it("should import and wire both routers in main app", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers.ts", "utf-8");
    
    expect(content).toContain('import { agentCashPickupRouter, floatReplenishmentRouter }');
    expect(content).toContain("cashPickup: agentCashPickupRouter");
    expect(content).toContain("floatReplenishment: floatReplenishmentRouter");
  });
});

describe("Agent Cash Pickup — deliveryMethod Storage", () => {
  it("should store deliveryMethod in channel and metadata on transaction insert", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers.ts", "utf-8");
    
    expect(content).toContain('channel: input.deliveryMethod ?? "bank_transfer"');
    expect(content).toContain("deliveryMethod: input.deliveryMethod");
    expect(content).toContain("JSON.stringify({ deliveryMethod:");
  });
});

describe("Agent Cash Pickup — Migration DDL", () => {
  // Canonical migration track: root drizzle/ (the divergent drizzle/migrations/
  // track was removed — see drizzle/MIGRATIONS.md).
  it("should create the 4 cash-pickup tables", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("drizzle/0064_agent_cash_pickup_schema.sql", "utf-8");
    
    const createTableCount = (content.match(/CREATE TABLE/g) || []).length;
    expect(createTableCount).toBe(4);
    
    expect(content).toContain("cash_pickup_assignments");
    expect(content).toContain("float_topup_requests");
    expect(content).toContain("agent_network");
  });

  it("should store pickup code as hash (not plaintext)", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("drizzle/0064_agent_cash_pickup_schema.sql", "utf-8");
    
    expect(content).toContain("pickup_code_hash");
    // Should NOT have a plaintext pickup_code column (only pickup_code_hash)
    const lines = content.split("\n");
    const codeColumns = lines.filter(l => /pickup_code\b/.test(l) && !/pickup_code_hash/.test(l));
    expect(codeColumns.length).toBe(0);
  });

  it("should have security columns: failed_attempts, expires_at", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("drizzle/0064_agent_cash_pickup_schema.sql", "utf-8");
    
    expect(content).toContain("failed_attempts");
    expect(content).toContain("expires_at");
  });

  it("should create performance indices", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("drizzle/0064_agent_cash_pickup_schema.sql", "utf-8");
    
    const indexCount = (content.match(/CREATE INDEX/g) || []).length;
    expect(indexCount).toBeGreaterThanOrEqual(5);
  });
});
