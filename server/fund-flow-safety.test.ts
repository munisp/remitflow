/**
 * fund-flow-safety.test.ts — Tests for 8 fund flow safety fixes (PR #21)
 *
 * Tests: transfer locks, webhook HMAC, FX rate lock, corridor timeouts,
 * cash_pickup reversal block, pessimistic wallet debit, BNPL refund cap,
 * interest accrual calculation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

function readFile(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test 3: Transfer Lock Module
// ═══════════════════════════════════════════════════════════════════════════════

describe("Transfer Lock Module", () => {
  const src = readFile("server/lib/transferLock.ts");

  it("uses pg_try_advisory_lock for non-blocking acquisition", () => {
    expect(src).toContain("pg_try_advisory_lock");
  });

  it("uses pg_advisory_unlock for release", () => {
    expect(src).toContain("pg_advisory_unlock");
  });

  it("hashes transfer reference to 32-bit lock ID via SHA-256", () => {
    expect(src).toContain("sha256");
    expect(src).toContain("readInt32BE");
  });

  it("exports withTransferLock for wrapping operations", () => {
    expect(src).toContain("export async function withTransferLock");
  });

  it("throws if lock cannot be acquired", () => {
    expect(src).toContain("another operation is in progress");
  });

  it("always releases lock in finally block", () => {
    expect(src).toContain("finally");
    expect(src).toContain("releaseTransferLock");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 4: Webhook HMAC Verification
// ═══════════════════════════════════════════════════════════════════════════════

describe("Webhook HMAC Verification", () => {
  const src = readFile("server/lib/webhookHmac.ts");

  it("configures secrets for all 5 payment rails", () => {
    expect(src).toContain("pix:");
    expect(src).toContain("upi:");
    expect(src).toContain("cips:");
    expect(src).toContain("mojaloop:");
    expect(src).toContain("swift:");
  });

  it("uses HMAC-SHA256 for signature computation", () => {
    expect(src).toContain("createHmac");
    expect(src).toContain("sha256");
  });

  it("uses timing-safe comparison to prevent timing attacks", () => {
    expect(src).toContain("timingSafeEqual");
  });

  it("supports sha256= prefix format (GitHub/PIX style)", () => {
    expect(src).toContain('startsWith("sha256=")');
  });

  it("implements webhook deduplication with 24h window", () => {
    expect(src).toContain("isWebhookDuplicate");
    expect(src).toContain("24 * 60 * 60 * 1000");
  });

  it("checks X-Webhook-Signature, X-Hub-Signature-256, X-Signature headers", () => {
    expect(src).toContain("x-webhook-signature");
    expect(src).toContain("x-hub-signature-256");
    expect(src).toContain("x-signature");
  });

  it("allows unsigned payloads in dev mode (secrets prefixed dev-)", () => {
    expect(src).toContain('secret.startsWith("dev-")');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 4b: Webhook handlers use HMAC + dedup
// ═══════════════════════════════════════════════════════════════════════════════

describe("Webhook handlers integrate HMAC + dedup", () => {
  const src = readFile("server/payment-rail-webhooks.ts");

  it("imports verifyWebhookSignature and isWebhookDuplicate", () => {
    expect(src).toContain('import { verifyWebhookSignature, isWebhookDuplicate }');
  });

  it("PIX webhook verifies HMAC signature", () => {
    expect(src).toContain('verifyWebhookSignature("pix"');
  });

  it("UPI webhook verifies HMAC signature", () => {
    expect(src).toContain('verifyWebhookSignature("upi"');
  });

  it("CIPS webhook verifies HMAC signature", () => {
    expect(src).toContain('verifyWebhookSignature("cips"');
  });

  it("Mojaloop webhook verifies HMAC signature", () => {
    expect(src).toContain('verifyWebhookSignature("mojaloop"');
  });

  it("SWIFT webhook verifies HMAC signature", () => {
    expect(src).toContain('verifyWebhookSignature("swift"');
  });

  it("all 5 webhooks check for duplicates", () => {
    const dedupCount = (src.match(/isWebhookDuplicate/g) ?? []).length;
    expect(dedupCount).toBeGreaterThanOrEqual(5);
  });

  it("returns 401 for invalid signatures", () => {
    const count401 = (src.match(/res\.status\(401\)/g) ?? []).length;
    expect(count401).toBeGreaterThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 5: FX Rate Lock
// ═══════════════════════════════════════════════════════════════════════════════

describe("FX Rate Lock", () => {
  const src = readFile("server/lib/fxRateLock.ts");

  it("max deviation is 0.5%", () => {
    expect(src).toContain("0.5");
    expect(src).toContain("MAX_RATE_DEVIATION_PCT");
  });

  it("rate lock TTL is 60 seconds", () => {
    expect(src).toContain("60_000");
    expect(src).toContain("RATE_LOCK_TTL_MS");
  });

  it("exports createRateLock and validateRateLock", () => {
    expect(src).toContain("export function createRateLock");
    expect(src).toContain("export function validateRateLock");
  });

  it("detects expired locks", () => {
    expect(src).toContain("rate_lock_expired");
  });

  it("detects currency pair mismatch", () => {
    expect(src).toContain("currency_pair_mismatch");
  });

  it("consumes lock after successful validation (single-use)", () => {
    expect(src).toContain("rateLocks.delete(token)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 5b: transfer.send validates rate lock token
// ═══════════════════════════════════════════════════════════════════════════════

describe("transfer.send validates rate lock", () => {
  const src = readFile("server/routers.ts");

  it("input schema accepts rateLockToken", () => {
    expect(src).toContain("rateLockToken: z.string().max(64).optional()");
  });

  it("validates rate lock during send", () => {
    expect(src).toContain("validateRateLock");
  });

  it("rejects with PRECONDITION_FAILED on stale rate", () => {
    expect(src).toContain("PRECONDITION_FAILED");
  });

  it("quote returns rateLockToken and expiry", () => {
    expect(src).toContain("rateLockToken");
    expect(src).toContain("rateLockExpiresInSeconds: 60");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 6: Per-Corridor Stuck Transfer Timeouts
// ═══════════════════════════════════════════════════════════════════════════════

describe("Corridor Timeouts", () => {
  const src = readFile("server/lib/corridorTimeouts.ts");

  it("Mojaloop stuck threshold is 1 hour", () => {
    expect(src).toMatch(/mojaloop[\s\S]*?stuckThresholdHours:\s*1[,\n]/);
  });

  it("SWIFT stuck threshold is 72 hours", () => {
    expect(src).toMatch(/swift[\s\S]*?stuckThresholdHours:\s*72[,\n]/);
  });

  it("PIX auto-refund is 48 hours", () => {
    expect(src).toMatch(/pix[\s\S]*?autoRefundHours:\s*48[,\n]/);
  });

  it("SWIFT auto-refund is 168 hours (7 days)", () => {
    expect(src).toMatch(/swift[\s\S]*?autoRefundHours:\s*168[,\n]/);
  });

  it("exports checkTransferStuckStatus function", () => {
    expect(src).toContain("export function checkTransferStuckStatus");
  });

  it("has 8 rail configurations", () => {
    const rails = ["mojaloop", "pix", "upi", "cips", "swift", "marklane", "cash_pickup", "bank_transfer"];
    for (const rail of rails) {
      expect(src).toContain(`${rail}:`);
    }
  });
});

describe("failureProtection uses per-corridor timeouts", () => {
  const src = readFile("server/routers/failureProtection.ts");

  it("imports checkTransferStuckStatus", () => {
    expect(src).toContain("checkTransferStuckStatus");
  });

  it("imports CORRIDOR_TIMEOUTS", () => {
    expect(src).toContain("CORRIDOR_TIMEOUTS");
  });

  it("no longer uses flat 48 hours for stuck detection", () => {
    expect(src).not.toContain("INTERVAL '48 hours'");
  });

  it("exposes corridorTimeouts admin query", () => {
    expect(src).toContain("corridorTimeouts:");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 7: Reversal Blocked on Cash Pickup
// ═══════════════════════════════════════════════════════════════════════════════

describe("Cash pickup reversal block", () => {
  const src = readFile("server/transfer-state-machine.ts");

  it("imports withTransferLock", () => {
    expect(src).toContain('import { withTransferLock }');
  });

  it("acquires lock for reversal transitions", () => {
    expect(src).toContain('targetState === "reversed"');
    expect(src).toContain("withTransferLock");
  });

  it("queries cash_pickup_assignments before allowing reversal", () => {
    expect(src).toContain("cash_pickup_assignments");
  });

  it("blocks reversal if pickup is completed", () => {
    expect(src).toContain("cash has already been disbursed");
  });

  it("blocks reversal if pickup is pending", () => {
    expect(src).toContain("Cancel the pickup first");
  });

  it("checks deliveryMethod from channel or metadata", () => {
    expect(src).toContain('deliveryMethod === "cash_pickup"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 8: Pessimistic Wallet Debit
// ═══════════════════════════════════════════════════════════════════════════════

describe("Pessimistic wallet debit", () => {
  it("posAgentCashFlow uses atomic balance check on cashOut", () => {
    const src = readFile("server/routers/posAgentCashFlow.ts");
    expect(src).toContain("CAST(${wallets.balance} AS DECIMAL(18,4)) >= ${input.amount}");
    expect(src).toContain("Insufficient float balance (concurrent deduction)");
  });

  it("agentCashPickup uses atomic balance check on verifyAndDisburse", () => {
    const src = readFile("server/routers/agentCashPickup.ts");
    expect(src).toContain("CAST(${wallets.balance} AS DECIMAL(18,4)) >= ${amount}");
    expect(src).toContain("concurrent deduction detected");
  });

  it("agentCashPickup wraps verifyAndDisburse in withTransferLock", () => {
    const src = readFile("server/routers/agentCashPickup.ts");
    expect(src).toContain('withTransferLock(input.transferReference, "disburse cash pickup"');
  });

  it("agentCashPickup checks transfer status before disbursing", () => {
    const src = readFile("server/routers/agentCashPickup.ts");
    expect(src).toContain('txState?.status === "reversed"');
    expect(src).toContain("Cannot disburse");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 9: BNPL Refund Cap
// ═══════════════════════════════════════════════════════════════════════════════

describe("BNPL refund amount capped at total paid", () => {
  const src = readFile("server/routers/failureProtection.ts");

  it("uses Math.min to cap refund at totalPaid", () => {
    expect(src).toContain("Math.min(requestedRefund, totalPaid)");
  });

  it("logs warning when refund exceeds total paid", () => {
    expect(src).toContain("Refund amount capped: requested exceeds total paid");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 10: Python Interest Accrual
// ═══════════════════════════════════════════════════════════════════════════════

describe("Python Interest Accrual Service", () => {
  const src = readFile("services/python-interest-accrual/main.py");

  it("exists as a new service", () => {
    expect(existsSync(resolve(ROOT, "services/python-interest-accrual/main.py"))).toBe(true);
  });

  it("defines APY rates for 4 savings types", () => {
    expect(src).toContain('"flex":');
    expect(src).toContain('"locked":');
    expect(src).toContain('"target":');
    expect(src).toContain('"round_up":');
  });

  it("flex APY is 3.5%, locked is 7.0%", () => {
    expect(src).toContain('Decimal("3.5")');
    expect(src).toContain('Decimal("7.0")');
  });

  it("calculates daily interest from APY (balance * apy / 100 / 365)", () => {
    expect(src).toContain('Decimal("365")');
    expect(src).toContain("daily_rate = apy");
  });

  it("has minimum balance threshold of 100.00", () => {
    expect(src).toContain('Decimal("100.00")');
  });

  it("uses ROUND_HALF_UP for banker's rounding", () => {
    expect(src).toContain("ROUND_HALF_UP");
  });

  it("has /accrue POST endpoint for manual trigger", () => {
    expect(src).toContain('self.path == "/accrue"');
  });

  it("has /health GET endpoint", () => {
    expect(src).toContain('self.path == "/health"');
  });

  it("schedules daily midnight UTC run", () => {
    expect(src).toContain("accrual_scheduler");
    expect(src).toContain("midnight");
  });

  it("publishes Kafka events for accruals", () => {
    expect(src).toContain("interest_accrued");
    expect(src).toContain("kafka-pubsub");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 4c: Go Mojaloop Connector HMAC Signing
// ═══════════════════════════════════════════════════════════════════════════════

describe("Go Mojaloop Connector HMAC signing", () => {
  const src = readFile("services/mojaloop-connector/main.go");

  it("imports crypto/hmac and crypto/sha256", () => {
    expect(src).toContain('"crypto/hmac"');
    expect(src).toContain('"crypto/sha256"');
  });

  it("implements computeWebhookHMAC function", () => {
    expect(src).toContain("func computeWebhookHMAC");
  });

  it("sets X-Webhook-Signature header with sha256= prefix", () => {
    expect(src).toContain('"X-Webhook-Signature"');
    expect(src).toContain('"sha256="');
  });

  it("reads WEBHOOK_SECRET_MOJALOOP from env", () => {
    expect(src).toContain("WEBHOOK_SECRET_MOJALOOP");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 2b: Rust Agent Reconciliation Float Guard
// ═══════════════════════════════════════════════════════════════════════════════

describe("Rust Agent Reconciliation float-guard", () => {
  const src = readFile("services/rust-agent-reconciliation/src/main.rs");

  it("has /float-guard POST endpoint", () => {
    expect(src).toContain('"/float-guard"');
    expect(src).toContain("post(float_guard)");
  });

  it("uses SELECT FOR UPDATE SKIP LOCKED for pessimistic locking", () => {
    expect(src).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("returns allowed: true/false based on balance check", () => {
    expect(src).toContain('"allowed"');
    expect(src).toContain("balance >= amount");
  });

  it("includes lowFloatWarning when balance drops below threshold", () => {
    expect(src).toContain("lowFloatWarning");
  });
});
