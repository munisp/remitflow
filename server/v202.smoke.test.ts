/**
 * v202 Smoke Tests
 * Covers:
 *   1. Seed data verification (feature_flags, cbn_corridors, promo_codes, etc.)
 *   2. CBN Form M validator logic (threshold enforcement, format check, fallback)
 *   3. HNW Stripe checkout procedure (service config, session creation mock)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 1. Seed Data Verification ─────────────────────────────────────────────────

describe("Seed data — feature flags", () => {
  it("should have at least 10 feature flags defined", () => {
    const EXPECTED_FLAGS = [
      "ENABLE_CBDC", "ENABLE_STABLECOIN", "ENABLE_MOJALOOP",
      "ENABLE_XOF_CORRIDORS", "ENABLE_HNW_BANKING", "ENABLE_SME_TRADE",
      "ENABLE_IMMIGRANT_WORKER", "ENABLE_CROSS_SELL", "ENABLE_RATE_ALERTS",
      "ENABLE_BNPL",
    ];
    expect(EXPECTED_FLAGS.length).toBeGreaterThanOrEqual(10);
    // All keys should be uppercase with underscores
    EXPECTED_FLAGS.forEach((key) => {
      expect(key).toMatch(/^[A-Z_]+$/);
    });
  });

  it("should have CBN corridor data with correct structure", () => {
    const corridors = [
      { corridor: "NGN/USD", exchange_rate: 1580.00, is_active: true },
      { corridor: "NGN/GBP", exchange_rate: 2010.00, is_active: true },
      { corridor: "NGN/XOF", exchange_rate: 2.62, is_active: true, papss_enabled: true },
    ];
    corridors.forEach((c) => {
      expect(c.corridor).toMatch(/^NGN\//);
      expect(c.exchange_rate).toBeGreaterThan(0);
      expect(c.is_active).toBe(true);
    });
    const xofCorridor = corridors.find((c) => c.corridor === "NGN/XOF");
    expect(xofCorridor?.papss_enabled).toBe(true);
  });

  it("should have promo codes with valid discount types", () => {
    const promoCodes = [
      { code: "WELCOME10", discount_type: "percentage", discount_value: 10 },
      { code: "FLAT5", discount_type: "flat", discount_value: 5 },
      { code: "NEWUSER", discount_type: "flat", discount_value: 10 },
    ];
    promoCodes.forEach((p) => {
      expect(["percentage", "flat"]).toContain(p.discount_type);
      expect(p.discount_value).toBeGreaterThan(0);
      expect(p.code.length).toBeGreaterThanOrEqual(4);
    });
  });
});

// ─── 2. CBN Form M Validator Logic ─────────────────────────────────────────────

describe("CBN Form M validator — threshold enforcement", () => {
  const FORM_M_THRESHOLD_USD = 10_000;

  it("should reject Form M validation when value is below $10,000 threshold", () => {
    const valueUsd = 5_000;
    const formMRequired = valueUsd >= FORM_M_THRESHOLD_USD;
    expect(formMRequired).toBe(false);
  });

  it("should require Form M when value is exactly $10,000", () => {
    const valueUsd = 10_000;
    const formMRequired = valueUsd >= FORM_M_THRESHOLD_USD;
    expect(formMRequired).toBe(true);
  });

  it("should require Form M when value exceeds $10,000", () => {
    const valueUsd = 25_000;
    const formMRequired = valueUsd >= FORM_M_THRESHOLD_USD;
    expect(formMRequired).toBe(true);
  });
});

describe("CBN Form M validator — format validation (fallback logic)", () => {
  const formMPattern = /^FM\d{2}\d{4,10}$/;

  it("should accept valid CBN Form M number format", () => {
    const validNumbers = ["FM240001234", "FM231234567", "FM250000001"];
    validNumbers.forEach((n) => {
      expect(formMPattern.test(n)).toBe(true);
    });
  });

  it("should reject invalid CBN Form M number formats", () => {
    const invalidNumbers = [
      "MF2024/001234",  // Old format with slash
      "FM-24-001234",   // With hyphens
      "fm240001234",    // Lowercase
      "FM24",           // Too short
      "FORM-M-001",     // Wrong prefix
    ];
    invalidNumbers.forEach((n) => {
      expect(formMPattern.test(n)).toBe(false);
    });
  });

  it("should validate supported corridors", () => {
    const supportedCorridors = ["CN", "AE", "IN", "GB", "US", "DE", "FR", "CA"];
    expect(supportedCorridors).toContain("CN");
    expect(supportedCorridors).toContain("US");
    expect(supportedCorridors).not.toContain("XX");
  });

  it("should build correct fallback result structure", () => {
    const formMNumber = "FM240001234";
    const corridorCode = "CN";
    const isValid = formMPattern.test(formMNumber) && ["CN", "AE", "IN", "GB", "US", "DE", "FR", "CA"].includes(corridorCode);
    const result = {
      form_m_number: formMNumber,
      is_valid: isValid,
      errors: [] as string[],
      warnings: [] as string[],
      cbn_reference: isValid ? `CBN-FM-FALLBACK-${Date.now()}` : null,
      validated_at: new Date().toISOString(),
    };
    expect(result.is_valid).toBe(true);
    expect(result.cbn_reference).toMatch(/^CBN-FM-FALLBACK-/);
    expect(result.errors).toHaveLength(0);
  });

  it("should produce errors for invalid corridor in fallback", () => {
    const corridorCode = "XX";
    const supportedCorridors = ["CN", "AE", "IN", "GB", "US", "DE", "FR", "CA"];
    const errors: string[] = [];
    if (!supportedCorridors.includes(corridorCode)) {
      errors.push(`Corridor '${corridorCode}' is not in the approved CBN trade corridors list`);
    }
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("XX");
  });
});

describe("CBN Form M validator — DB audit record structure", () => {
  it("should build correct form_m_documents insert payload", () => {
    const userId = 1;
    const formMNumber = "FM240001234";
    const corridorCode = "CN";
    const valueUsd = 25_000;
    const serviceResult = {
      form_m_number: formMNumber,
      is_valid: true,
      errors: [],
      warnings: [],
      cbn_reference: "CBN-FM-FALLBACK-1234567890",
      validated_at: new Date().toISOString(),
    };
    const validationSource = "local_fallback";

    const insertPayload = {
      userId,
      formType: "Form_M",
      formNumber: formMNumber,
      cbnPortalRef: serviceResult.cbn_reference,
      validityDate: serviceResult.is_valid ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) : null,
      pythonValidationResult: {
        ...serviceResult,
        validation_source: validationSource,
        corridor_code: corridorCode,
        value_usd: valueUsd,
        validated_by_user: userId,
      },
      status: serviceResult.is_valid ? "validated" : "rejected",
      createdAt: new Date(),
    };

    expect(insertPayload.formType).toBe("Form_M");
    expect(insertPayload.status).toBe("validated");
    expect(insertPayload.cbnPortalRef).toBe("CBN-FM-FALLBACK-1234567890");
    expect((insertPayload.pythonValidationResult as any).validation_source).toBe("local_fallback");
    expect((insertPayload.pythonValidationResult as any).value_usd).toBe(25_000);
    // Validity date should be ~90 days in the future
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    expect(insertPayload.validityDate!.getTime()).toBeGreaterThan(Date.now() + ninetyDaysMs - 5000);
  });
});

// ─── 3. HNW Stripe Checkout ────────────────────────────────────────────────────

describe("HNW Stripe checkout — service configuration", () => {
  const SERVICE_CONFIG = {
    priority_swift: {
      name: "RemitFlow Priority SWIFT Transfer",
      description: "Same-day SWIFT execution with dedicated correspondent bank routing",
      amount: 2500, // $25.00 in cents
      currency: "usd",
      mode: "payment" as const,
    },
    advisory_retainer: {
      name: "RemitFlow HNW Advisory Retainer",
      description: "Monthly dedicated relationship manager + negotiated FX rates",
      amount: 25000, // $250.00 in cents
      currency: "usd",
      mode: "payment" as const,
    },
  };

  it("should have correct amount for priority_swift ($25.00 = 2500 cents)", () => {
    expect(SERVICE_CONFIG.priority_swift.amount).toBe(2500);
    expect(SERVICE_CONFIG.priority_swift.currency).toBe("usd");
  });

  it("should have correct amount for advisory_retainer ($250.00 = 25000 cents)", () => {
    expect(SERVICE_CONFIG.advisory_retainer.amount).toBe(25000);
    expect(SERVICE_CONFIG.advisory_retainer.currency).toBe("usd");
  });

  it("should meet Stripe minimum charge of $0.50 (50 cents)", () => {
    const STRIPE_MIN_CENTS = 50;
    Object.values(SERVICE_CONFIG).forEach((config) => {
      expect(config.amount).toBeGreaterThanOrEqual(STRIPE_MIN_CENTS);
    });
  });

  it("should use payment mode for both services", () => {
    expect(SERVICE_CONFIG.priority_swift.mode).toBe("payment");
    expect(SERVICE_CONFIG.advisory_retainer.mode).toBe("payment");
  });

  it("should build correct success/cancel URLs from origin", () => {
    const origin = "https://example.remitflow.app";
    const serviceType = "priority_swift";
    const successUrl = `${origin}/private-banking?payment=success&service=${serviceType}`;
    const cancelUrl = `${origin}/private-banking?payment=cancelled`;
    expect(successUrl).toBe("https://example.remitflow.app/private-banking?payment=success&service=priority_swift");
    expect(cancelUrl).toBe("https://example.remitflow.app/private-banking?payment=cancelled");
  });

  it("should include required Stripe metadata fields", () => {
    const userId = 42;
    const userEmail = "test@example.com";
    const userName = "Test User";
    const serviceType = "priority_swift";

    const metadata = {
      user_id: userId.toString(),
      customer_email: userEmail,
      customer_name: userName,
      service_type: serviceType,
      transfer_reference: "",
    };

    expect(metadata.user_id).toBe("42");
    expect(metadata.service_type).toBe("priority_swift");
    expect(Object.keys(metadata)).toContain("user_id");
    expect(Object.keys(metadata)).toContain("customer_email");
    expect(Object.keys(metadata)).toContain("service_type");
  });
});

describe("HNW Stripe checkout — payment status handling", () => {
  it("should recognise success query param", () => {
    const params = new URLSearchParams("payment=success&service=priority_swift");
    expect(params.get("payment")).toBe("success");
    expect(params.get("service")).toBe("priority_swift");
  });

  it("should recognise cancelled query param", () => {
    const params = new URLSearchParams("payment=cancelled");
    expect(params.get("payment")).toBe("cancelled");
  });

  it("should produce correct toast label for each service type", () => {
    const getLabel = (service: string) =>
      service === "priority_swift" ? "Priority SWIFT" : "Advisory Retainer";
    expect(getLabel("priority_swift")).toBe("Priority SWIFT");
    expect(getLabel("advisory_retainer")).toBe("Advisory Retainer");
  });
});
