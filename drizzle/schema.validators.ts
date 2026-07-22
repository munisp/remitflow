/**
 * RemitFlow — Drizzle ORM Schema Validators
 * ───────────────────────────────────────────
 * Runtime validators using Zod for all critical tables.
 * Provides type-safe input validation before DB writes.
 *
 * Validators:
 *   - createInsertSchema() wrappers for all tables
 *   - Custom refinements for business rules
 *   - Cross-field validation (e.g., amount > 0)
 *   - Currency code validation
 *   - Phone number format validation
 */
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import {
  users,
  wallets,
  transactions,
  beneficiaries,
  cards,
  savingsGoals,
  kycDocuments,
  notifications,
  recurringPayments,
  batchPayments,
  disputes,
  supportTickets,
  rateLocks,
  directDebitMandates,
  consentRecords,
  idempotencyKeys,
  outboxEvents,
  erasureRequests,
  complianceCases,
  fraudAlerts,
} from "./schema";
import {
  keycloakSessions,
  tigerbeetleAccounts,
  tigerbeetleTransfers,
  permifyAuditLogs,
  apisixRouteLogs,
  daprStateAudit,
  temporalExecutions,
  fluvioOffsets,
  lakehouseSyncJobs,
  openappsecEvents,
  redisCacheAudit,
} from "./schema.integrations";

// ─── Common Refinements ───────────────────────────────────────────────────────
const currencyCodes = ["NGN", "USD", "GBP", "EUR", "KES", "GHS", "ZAR", "CAD", "AUD", "XOF", "XAF", "EGP", "MAD", "TZS", "UGX", "RWF", "ETB", "USDT", "USDC", "BTC", "ETH"] as const;
const CurrencyCode = z.enum(currencyCodes);

const positiveDecimal = z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a positive decimal with up to 2 decimal places");
const phoneNumber = z.string().regex(/^\+?[1-9]\d{7,14}$/, "Must be a valid phone number");
const isoDate = z.string().datetime({ message: "Must be a valid ISO 8601 date" });

// ─── User Validators ──────────────────────────────────────────────────────────
export const insertUserSchema = createInsertSchema(users, {
  email: z.string().email("Must be a valid email address").optional(),
  phone: phoneNumber.optional(),
  name: z.string().min(1).max(128).optional(),
  defaultCurrency: CurrencyCode.optional(),
  openId: z.string().min(1).max(128),
});

export const selectUserSchema = createSelectSchema(users);

// ─── Wallet Validators ────────────────────────────────────────────────────────
export const insertWalletSchema = createInsertSchema(wallets, {
  currency: CurrencyCode,
  balance: positiveDecimal.optional(),
  lockedBalance: positiveDecimal.optional(),
});

// ─── Transaction Validators ───────────────────────────────────────────────────
export const insertTransactionSchema = createInsertSchema(transactions, {
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode.optional(),
  fromAmount: positiveDecimal,
  toAmount: positiveDecimal.optional(),
  fee: positiveDecimal.optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
}).refine(
  (data: { fromAmount: string }) => Number(data.fromAmount) > 0,
  { message: "fromAmount must be greater than 0", path: ["fromAmount"] }
);

// ─── Beneficiary Validators ───────────────────────────────────────────────────
export const insertBeneficiarySchema = createInsertSchema(beneficiaries, {
  name: z.string().min(1).max(128),
  currency: CurrencyCode.optional(),
  phone: phoneNumber.optional(),
  email: z.string().email().optional(),
});

// ─── Savings Goal Validators ──────────────────────────────────────────────────
export const insertSavingsGoalSchema = createInsertSchema(savingsGoals, {
  name: z.string().min(1).max(128),
  targetAmount: positiveDecimal,
  currency: CurrencyCode.optional(),
}).refine(
  (data: { targetAmount: string }) => Number(data.targetAmount) > 0,
  { message: "targetAmount must be greater than 0", path: ["targetAmount"] }
);

// ─── KYC Document Validators ──────────────────────────────────────────────────
export const insertKycDocumentSchema = createInsertSchema(kycDocuments, {
  fileUrl: z.string().url("Must be a valid URL").optional(),
});

// ─── Recurring Payment Validators ─────────────────────────────────────────────
export const insertRecurringPaymentSchema = createInsertSchema(recurringPayments, {
  amount: positiveDecimal,
  currency: CurrencyCode.optional(),
  targetCurrency: CurrencyCode.optional(),
}).refine(
  (data: { amount: string }) => Number(data.amount) > 0,
  { message: "amount must be greater than 0", path: ["amount"] }
);

// ─── Dispute Validators ───────────────────────────────────────────────────────
export const insertDisputeSchema = createInsertSchema(disputes, {
  description: z.string().min(10).max(2000),
});

// ─── Idempotency Key Validators ───────────────────────────────────────────────
export const insertIdempotencyKeySchema = createInsertSchema(idempotencyKeys, {
  key: z.string().min(1).max(200),
  operation: z.string().min(1).max(100),
});

// ─── Outbox Event Validators ──────────────────────────────────────────────────
export const insertOutboxEventSchema = createInsertSchema(outboxEvents, {
  aggregateId: z.string().min(1).max(100),
  aggregateType: z.string().min(1).max(100),
  eventType: z.string().min(1).max(100),
  payload: z.string().min(2), // At minimum "{}"
});

// ─── Compliance Case Validators ───────────────────────────────────────────────
export const insertComplianceCaseSchema = createInsertSchema(complianceCases);

// ─── Integration Table Validators ────────────────────────────────────────────

export const insertKeycloakSessionSchema = createInsertSchema(keycloakSessions, {
  sessionId: z.string().min(1).max(128),
  token: z.string().min(1),
});

export const insertTigerBeetleAccountSchema = createInsertSchema(tigerbeetleAccounts, {
  currency: CurrencyCode,
  status: z.enum(["active", "suspended", "closed"]).optional(),
});

export const insertTigerBeetleTransferSchema = createInsertSchema(tigerbeetleTransfers, {
  status: z.enum(["posted", "voided", "pending"]).optional(),
}).refine(
  (data: { amount: bigint }) => data.amount > BigInt(0),
  { message: "amount must be greater than 0", path: ["amount"] }
);

export const insertPermifyAuditLogSchema = createInsertSchema(permifyAuditLogs, {
  subjectId: z.string().min(1).max(128),
  entityType: z.string().min(1).max(64),
  entityId: z.string().min(1).max(128),
  permission: z.string().min(1).max(64),
});

export const insertTemporalExecutionSchema = createInsertSchema(temporalExecutions, {
  workflowId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
  workflowType: z.string().min(1).max(128),
  status: z.enum(["RUNNING", "COMPLETED", "FAILED", "CANCELLED", "TERMINATED", "CONTINUED_AS_NEW", "TIMED_OUT"]),
});

export const insertFluvioOffsetSchema = createInsertSchema(fluvioOffsets, {
  topic: z.string().min(1).max(128),
  consumerGroup: z.string().min(1).max(128),
});

export const insertLakehouseSyncJobSchema = createInsertSchema(lakehouseSyncJobs, {
  tableName: z.string().min(1).max(128),
  status: z.enum(["idle", "running", "completed", "failed"]),
});

export const insertOpenAppSecEventSchema = createInsertSchema(openappsecEvents, {
  action: z.enum(["block", "detect", "allow"]),
  ipAddress: z.union([z.ipv4(), z.ipv6()]),
  score: z.number().int().min(0).max(100),
});

// ─── Type Exports ─────────────────────────────────────────────────────────────
export type InsertUserInput = z.infer<typeof insertUserSchema>;
export type InsertWalletInput = z.infer<typeof insertWalletSchema>;
export type InsertTransactionInput = z.infer<typeof insertTransactionSchema>;
export type InsertBeneficiaryInput = z.infer<typeof insertBeneficiarySchema>;
export type InsertSavingsGoalInput = z.infer<typeof insertSavingsGoalSchema>;
export type InsertKycDocumentInput = z.infer<typeof insertKycDocumentSchema>;
export type InsertRecurringPaymentInput = z.infer<typeof insertRecurringPaymentSchema>;
export type InsertDisputeInput = z.infer<typeof insertDisputeSchema>;
export type InsertIdempotencyKeyInput = z.infer<typeof insertIdempotencyKeySchema>;
export type InsertOutboxEventInput = z.infer<typeof insertOutboxEventSchema>;
export type InsertComplianceCaseInput = z.infer<typeof insertComplianceCaseSchema>;
export type InsertKeycloakSessionInput = z.infer<typeof insertKeycloakSessionSchema>;
export type InsertTigerBeetleAccountInput = z.infer<typeof insertTigerBeetleAccountSchema>;
export type InsertTigerBeetleTransferInput = z.infer<typeof insertTigerBeetleTransferSchema>;
export type InsertPermifyAuditLogInput = z.infer<typeof insertPermifyAuditLogSchema>;
export type InsertTemporalExecutionInput = z.infer<typeof insertTemporalExecutionSchema>;
export type InsertFluvioOffsetInput = z.infer<typeof insertFluvioOffsetSchema>;
export type InsertLakehouseSyncJobInput = z.infer<typeof insertLakehouseSyncJobSchema>;
export type InsertOpenAppSecEventInput = z.infer<typeof insertOpenAppSecEventSchema>;
