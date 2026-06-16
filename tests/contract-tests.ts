/**
 * RemitFlow — Service Contract Tests
 * ────────────────────────────────────
 * Validates API contracts between Node.js app and microservices.
 * Each test verifies the expected request/response schema for inter-service calls.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ─── Schema Definitions (Contracts) ──────────────────────────────────────────

// KYC Engine Contract
const KYCEngineRequestSchema = z.object({
  userId: z.number(),
  level: z.enum(["basic", "standard", "enhanced", "full_edd"]),
  country: z.string().length(2),
  documentType: z.string().optional(),
});

const KYCEngineResponseSchema = z.object({
  status: z.enum(["approved", "rejected", "pending", "manual_review"]),
  riskScore: z.number().min(0).max(100),
  riskCategory: z.enum(["low", "medium", "high", "critical"]),
  tier: z.number().min(1).max(3),
  verificationId: z.string(),
  completedAt: z.string().optional(),
});

// BVN/NIN Verification Contract
const BVNVerificationRequestSchema = z.object({
  bvn: z.string().regex(/^\d{11}$/),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string(),
});

const BVNVerificationResponseSchema = z.object({
  verified: z.boolean(),
  match_score: z.number().min(0).max(100),
  verification_id: z.string(),
  details: z.object({
    first_name_match: z.boolean(),
    last_name_match: z.boolean(),
    dob_match: z.boolean(),
  }),
});

const NINVerificationRequestSchema = z.object({
  nin: z.string().regex(/^\d{11}$/),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});

const NINVerificationResponseSchema = z.object({
  verified: z.boolean(),
  match_score: z.number().min(0).max(100),
  verification_id: z.string(),
});

// Sanctions Screening Contract
const SanctionsRequestSchema = z.object({
  name: z.string().min(1),
  country: z.string().optional(),
  dateOfBirth: z.string().optional(),
});

const SanctionsResponseSchema = z.object({
  clear: z.boolean(),
  matches: z.array(z.object({
    listName: z.string(),
    matchScore: z.number(),
    entityName: z.string(),
    listType: z.enum(["OFAC", "UN", "EU", "HMT", "CBN", "FATF", "Interpol"]),
  })),
  screenedAt: z.string(),
});

// FX Engine Contract
const FXRateRequestSchema = z.object({
  from: z.string().length(3),
  to: z.string().length(3),
  amount: z.number().positive(),
});

const FXRateResponseSchema = z.object({
  rate: z.number().positive(),
  convertedAmount: z.number().positive(),
  spread: z.number(),
  expiresAt: z.string(),
  provider: z.string(),
});

// Transfer Engine Contract
const TransferRequestSchema = z.object({
  senderId: z.number(),
  recipientId: z.number(),
  amount: z.number().positive(),
  currency: z.string().length(3),
  rail: z.string(),
  idempotencyKey: z.string(),
});

const TransferResponseSchema = z.object({
  transactionId: z.string(),
  status: z.enum(["initiated", "pending", "processing", "completed", "failed"]),
  estimatedCompletionTime: z.string().optional(),
  fees: z.object({
    transferFee: z.number(),
    fxFee: z.number().optional(),
    totalFee: z.number(),
  }),
});

// goAML/NFIU Filing Contract
const GoAMLFilingRequestSchema = z.object({
  reportType: z.enum(["STR", "SAR", "CTR"]),
  subjectId: z.number(),
  subjectName: z.string(),
  transactionIds: z.array(z.string()),
  narrative: z.string(),
  filedBy: z.number(),
});

const GoAMLFilingResponseSchema = z.object({
  filingId: z.string(),
  status: z.enum(["submitted", "accepted", "rejected", "pending_review"]),
  referenceNumber: z.string().optional(),
  submittedAt: z.string(),
});

// KYB Engine Contract
const KYBAnalysisRequestSchema = z.object({
  companyId: z.string(),
  rcNumber: z.string(),
  shareholders: z.array(z.object({
    name: z.string(),
    ownershipPercent: z.number(),
    type: z.enum(["individual", "company", "trust", "fund"]),
    country: z.string(),
  })),
});

const KYBAnalysisResponseSchema = z.object({
  riskFlags: z.array(z.string()),
  ubos: z.array(z.object({
    name: z.string(),
    totalVotingRights: z.number(),
    controlBasis: z.string(),
  })),
  shellScore: z.number().min(0).max(1),
  circularOwnership: z.boolean(),
  ownershipDepth: z.number(),
});

// ─── Contract Validation Tests ───────────────────────────────────────────────

describe("KYC Engine Contract", () => {
  it("should accept valid KYC request", () => {
    const req = { userId: 1, level: "standard", country: "NG", documentType: "passport" };
    expect(KYCEngineRequestSchema.safeParse(req).success).toBe(true);
  });

  it("should reject invalid KYC level", () => {
    const req = { userId: 1, level: "super_basic", country: "NG" };
    expect(KYCEngineRequestSchema.safeParse(req).success).toBe(false);
  });

  it("should validate KYC response shape", () => {
    const resp = {
      status: "approved",
      riskScore: 25,
      riskCategory: "low",
      tier: 2,
      verificationId: "kyc-123",
      completedAt: new Date().toISOString(),
    };
    expect(KYCEngineResponseSchema.safeParse(resp).success).toBe(true);
  });

  it("should reject response with out-of-range risk score", () => {
    const resp = { status: "approved", riskScore: 150, riskCategory: "low", tier: 2, verificationId: "x" };
    expect(KYCEngineResponseSchema.safeParse(resp).success).toBe(false);
  });
});

describe("BVN/NIN Verification Contract", () => {
  it("should accept valid BVN request", () => {
    const req = { bvn: "12345678901", firstName: "John", lastName: "Doe", dateOfBirth: "1990-01-01" };
    expect(BVNVerificationRequestSchema.safeParse(req).success).toBe(true);
  });

  it("should reject BVN with wrong length", () => {
    const req = { bvn: "1234", firstName: "John", lastName: "Doe", dateOfBirth: "1990-01-01" };
    expect(BVNVerificationRequestSchema.safeParse(req).success).toBe(false);
  });

  it("should accept valid NIN request", () => {
    const req = { nin: "98765432101", firstName: "Jane", lastName: "Doe" };
    expect(NINVerificationRequestSchema.safeParse(req).success).toBe(true);
  });

  it("should validate BVN response shape", () => {
    const resp = {
      verified: true,
      match_score: 95,
      verification_id: "bvn-abc-123",
      details: { first_name_match: true, last_name_match: true, dob_match: true },
    };
    expect(BVNVerificationResponseSchema.safeParse(resp).success).toBe(true);
  });
});

describe("Sanctions Screening Contract", () => {
  it("should accept valid screening request", () => {
    const req = { name: "John Doe", country: "NG", dateOfBirth: "1990-01-01" };
    expect(SanctionsRequestSchema.safeParse(req).success).toBe(true);
  });

  it("should reject empty name", () => {
    const req = { name: "" };
    expect(SanctionsRequestSchema.safeParse(req).success).toBe(false);
  });

  it("should validate screening response shape", () => {
    const resp = {
      clear: true,
      matches: [],
      screenedAt: new Date().toISOString(),
    };
    expect(SanctionsResponseSchema.safeParse(resp).success).toBe(true);
  });

  it("should validate response with matches", () => {
    const resp = {
      clear: false,
      matches: [{
        listName: "OFAC SDN",
        matchScore: 92,
        entityName: "Test Entity",
        listType: "OFAC",
      }],
      screenedAt: new Date().toISOString(),
    };
    expect(SanctionsResponseSchema.safeParse(resp).success).toBe(true);
  });
});

describe("FX Engine Contract", () => {
  it("should accept valid FX request", () => {
    const req = { from: "NGN", to: "USD", amount: 50000 };
    expect(FXRateRequestSchema.safeParse(req).success).toBe(true);
  });

  it("should reject negative amount", () => {
    const req = { from: "NGN", to: "USD", amount: -100 };
    expect(FXRateRequestSchema.safeParse(req).success).toBe(false);
  });

  it("should validate FX response shape", () => {
    const resp = {
      rate: 1550.25,
      convertedAmount: 32.25,
      spread: 0.015,
      expiresAt: new Date().toISOString(),
      provider: "internal",
    };
    expect(FXRateResponseSchema.safeParse(resp).success).toBe(true);
  });
});

describe("Transfer Engine Contract", () => {
  it("should accept valid transfer request", () => {
    const req = {
      senderId: 1,
      recipientId: 2,
      amount: 1000,
      currency: "NGN",
      rail: "flutterwave",
      idempotencyKey: "idem-123",
    };
    expect(TransferRequestSchema.safeParse(req).success).toBe(true);
  });

  it("should validate transfer response shape", () => {
    const resp = {
      transactionId: "tx-123",
      status: "initiated",
      fees: { transferFee: 50, fxFee: 25, totalFee: 75 },
    };
    expect(TransferResponseSchema.safeParse(resp).success).toBe(true);
  });
});

describe("goAML Filing Contract", () => {
  it("should accept valid STR filing", () => {
    const req = {
      reportType: "STR",
      subjectId: 42,
      subjectName: "Test Subject",
      transactionIds: ["tx-1", "tx-2"],
      narrative: "Suspicious pattern detected",
      filedBy: 10,
    };
    expect(GoAMLFilingRequestSchema.safeParse(req).success).toBe(true);
  });

  it("should validate filing response", () => {
    const resp = {
      filingId: "goaml-123",
      status: "submitted",
      referenceNumber: "NFIU-2024-001",
      submittedAt: new Date().toISOString(),
    };
    expect(GoAMLFilingResponseSchema.safeParse(resp).success).toBe(true);
  });
});

describe("KYB Analysis Contract", () => {
  it("should accept valid KYB request", () => {
    const req = {
      companyId: "comp-123",
      rcNumber: "RC123456",
      shareholders: [
        { name: "John Doe", ownershipPercent: 30, type: "individual", country: "NG" },
        { name: "Holding Corp", ownershipPercent: 70, type: "company", country: "NG" },
      ],
    };
    expect(KYBAnalysisRequestSchema.safeParse(req).success).toBe(true);
  });

  it("should validate KYB response shape", () => {
    const resp = {
      riskFlags: ["potential_shell_company"],
      ubos: [{ name: "John Doe", totalVotingRights: 30, controlBasis: "significant_influence" }],
      shellScore: 0.45,
      circularOwnership: false,
      ownershipDepth: 2,
    };
    expect(KYBAnalysisResponseSchema.safeParse(resp).success).toBe(true);
  });

  it("should reject shell score out of range", () => {
    const resp = {
      riskFlags: [],
      ubos: [],
      shellScore: 1.5,
      circularOwnership: false,
      ownershipDepth: 1,
    };
    expect(KYBAnalysisResponseSchema.safeParse(resp).success).toBe(false);
  });
});
