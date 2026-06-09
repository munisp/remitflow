/**
 * Standardized Error Codes — consistent machine-readable codes for all API errors.
 *
 * Middleware-ready: error codes are structured for i18n, monitoring dashboards (Grafana/Datadog),
 * and client-side error mapping. Each code is unique and documented.
 *
 * Usage in routers:
 *   throw apiError("TRANSFER_INSUFFICIENT_BALANCE", { required: 100, available: 50 });
 */
import { TRPCError } from "@trpc/server";

export const ERROR_CODES = {
  // Auth (1xxx)
  AUTH_UNAUTHORIZED: { code: "AUTH_001", httpCode: "UNAUTHORIZED" as const, message: "Authentication required" },
  AUTH_TOKEN_EXPIRED: { code: "AUTH_002", httpCode: "UNAUTHORIZED" as const, message: "Session expired — please log in again" },
  AUTH_FORBIDDEN: { code: "AUTH_003", httpCode: "FORBIDDEN" as const, message: "Insufficient permissions" },
  AUTH_INVALID_CREDENTIALS: { code: "AUTH_004", httpCode: "UNAUTHORIZED" as const, message: "Invalid email or password" },
  AUTH_ACCOUNT_LOCKED: { code: "AUTH_005", httpCode: "FORBIDDEN" as const, message: "Account locked — contact support" },

  // Transfer (2xxx)
  TRANSFER_INSUFFICIENT_BALANCE: { code: "TXN_001", httpCode: "BAD_REQUEST" as const, message: "Insufficient balance" },
  TRANSFER_LIMIT_EXCEEDED: { code: "TXN_002", httpCode: "BAD_REQUEST" as const, message: "Transfer exceeds your tier limit" },
  TRANSFER_INVALID_CORRIDOR: { code: "TXN_003", httpCode: "BAD_REQUEST" as const, message: "Currency corridor not supported" },
  TRANSFER_DUPLICATE: { code: "TXN_004", httpCode: "CONFLICT" as const, message: "Duplicate transfer — idempotency key already used" },
  TRANSFER_COMPLIANCE_BLOCKED: { code: "TXN_005", httpCode: "FORBIDDEN" as const, message: "Transfer blocked by compliance review" },
  TRANSFER_PROVIDER_ERROR: { code: "TXN_006", httpCode: "INTERNAL_SERVER_ERROR" as const, message: "Payment provider error — please retry" },
  TRANSFER_NOT_FOUND: { code: "TXN_007", httpCode: "NOT_FOUND" as const, message: "Transfer not found" },
  TRANSFER_BENEFICIARY_REQUIRED: { code: "TXN_008", httpCode: "BAD_REQUEST" as const, message: "Beneficiary information required" },

  // KYC (3xxx)
  KYC_TIER_INSUFFICIENT: { code: "KYC_001", httpCode: "FORBIDDEN" as const, message: "KYC tier insufficient for this operation" },
  KYC_DOCUMENT_INVALID: { code: "KYC_002", httpCode: "BAD_REQUEST" as const, message: "Invalid KYC document" },
  KYC_VERIFICATION_PENDING: { code: "KYC_003", httpCode: "PRECONDITION_FAILED" as const, message: "KYC verification still pending" },

  // Wallet (4xxx)
  WALLET_NOT_FOUND: { code: "WAL_001", httpCode: "NOT_FOUND" as const, message: "Wallet not found" },
  WALLET_CURRENCY_UNSUPPORTED: { code: "WAL_002", httpCode: "BAD_REQUEST" as const, message: "Currency not supported for wallets" },
  WALLET_FROZEN: { code: "WAL_003", httpCode: "FORBIDDEN" as const, message: "Wallet frozen — contact support" },

  // Beneficiary (5xxx)
  BENEFICIARY_NOT_FOUND: { code: "BEN_001", httpCode: "NOT_FOUND" as const, message: "Beneficiary not found" },
  BENEFICIARY_LIMIT_REACHED: { code: "BEN_002", httpCode: "BAD_REQUEST" as const, message: "Maximum beneficiaries limit reached" },
  BENEFICIARY_DUPLICATE: { code: "BEN_003", httpCode: "CONFLICT" as const, message: "Beneficiary already exists" },

  // FX (6xxx)
  FX_RATE_UNAVAILABLE: { code: "FX_001", httpCode: "SERVICE_UNAVAILABLE" as const, message: "FX rate temporarily unavailable" },
  FX_RATE_EXPIRED: { code: "FX_002", httpCode: "PRECONDITION_FAILED" as const, message: "FX rate expired — request a new quote" },

  // Validation (7xxx)
  VALIDATION_FAILED: { code: "VAL_001", httpCode: "BAD_REQUEST" as const, message: "Input validation failed" },
  VALIDATION_AMOUNT_INVALID: { code: "VAL_002", httpCode: "BAD_REQUEST" as const, message: "Invalid amount" },

  // Rate Limiting (8xxx)
  RATE_LIMIT_EXCEEDED: { code: "RTE_001", httpCode: "TOO_MANY_REQUESTS" as const, message: "Too many requests — please wait" },

  // System (9xxx)
  SYSTEM_DB_UNAVAILABLE: { code: "SYS_001", httpCode: "INTERNAL_SERVER_ERROR" as const, message: "Service temporarily unavailable" },
  SYSTEM_UNEXPECTED: { code: "SYS_999", httpCode: "INTERNAL_SERVER_ERROR" as const, message: "Unexpected error — please retry or contact support" },
} as const;

export type ErrorCodeKey = keyof typeof ERROR_CODES;

/**
 * Create a TRPCError with a standardized error code.
 * The `code` field is the TRPC HTTP code; the machine-readable error code and metadata
 * are embedded in the message as a structured JSON string for client parsing.
 */
export function apiError(
  errorKey: ErrorCodeKey,
  details?: Record<string, unknown>,
): TRPCError {
  const def = ERROR_CODES[errorKey];
  const payload = {
    errorCode: def.code,
    message: def.message,
    ...(details ? { details } : {}),
  };
  return new TRPCError({
    code: def.httpCode,
    message: JSON.stringify(payload),
  });
}

/**
 * Parse a structured error response from a TRPCError message.
 * Returns null if the message is not a structured error.
 */
export function parseApiError(message: string): { errorCode: string; message: string; details?: Record<string, unknown> } | null {
  try {
    const parsed = JSON.parse(message);
    if (parsed.errorCode && parsed.message) return parsed;
    return null;
  } catch {
    return null;
  }
}
