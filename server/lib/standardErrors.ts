/**
 * Standardized error response shapes.
 * P1 Backend 1.8 — consistent error codes and response shapes.
 */
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
  timestamp: string;
}

export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  KYC_REQUIRED: "KYC_REQUIRED",
  TRANSFER_LIMIT_EXCEEDED: "TRANSFER_LIMIT_EXCEEDED",
  SANCTIONS_HIT: "SANCTIONS_HIT",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  CURRENCY_NOT_SUPPORTED: "CURRENCY_NOT_SUPPORTED",
  CORRIDOR_UNAVAILABLE: "CORRIDOR_UNAVAILABLE",
  BENEFICIARY_VERIFICATION_FAILED: "BENEFICIARY_VERIFICATION_FAILED",
  MFA_REQUIRED: "MFA_REQUIRED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export function formatApiError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  requestId?: string
): ApiError {
  return {
    code,
    message,
    details,
    requestId,
    timestamp: new Date().toISOString(),
  };
}

export function formatZodError(error: ZodError): ApiError {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (!fieldErrors[path]) fieldErrors[path] = [];
    fieldErrors[path].push(issue.message);
  }

  return formatApiError(ERROR_CODES.VALIDATION_ERROR, "Input validation failed", {
    fields: fieldErrors,
  });
}

export function toTrpcError(code: ErrorCode, message: string): TRPCError {
  const codeMap: Record<string, TRPCError["code"]> = {
    VALIDATION_ERROR: "BAD_REQUEST",
    AUTHENTICATION_REQUIRED: "UNAUTHORIZED",
    FORBIDDEN: "FORBIDDEN",
    NOT_FOUND: "NOT_FOUND",
    CONFLICT: "CONFLICT",
    RATE_LIMITED: "TOO_MANY_REQUESTS",
    INSUFFICIENT_BALANCE: "PRECONDITION_FAILED",
    KYC_REQUIRED: "PRECONDITION_FAILED",
    TRANSFER_LIMIT_EXCEEDED: "PRECONDITION_FAILED",
    SANCTIONS_HIT: "FORBIDDEN",
    PAYMENT_FAILED: "INTERNAL_SERVER_ERROR",
    SERVICE_UNAVAILABLE: "INTERNAL_SERVER_ERROR",
    INTERNAL_ERROR: "INTERNAL_SERVER_ERROR",
  };

  return new TRPCError({
    code: codeMap[code] ?? "INTERNAL_SERVER_ERROR",
    message,
  });
}

export function stripStackTrace(error: unknown, isProduction: boolean): Record<string, unknown> {
  if (!isProduction) {
    return error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { error: String(error) };
  }

  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { error: "An unexpected error occurred" };
}
