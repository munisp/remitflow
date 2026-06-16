/**
 * Error Recovery — contextual error messages + retry logic.
 * Maps TRPCError codes to user-friendly messages with recovery actions.
 */
import { TRPCError } from "@trpc/server";

interface ErrorContext {
  code: string;
  userMessage: string;
  recoveryAction: string;
  retryable: boolean;
  retryAfterMs?: number;
}

const ERROR_MAP: Record<string, ErrorContext> = {
  INSUFFICIENT_BALANCE: {
    code: "INSUFFICIENT_BALANCE",
    userMessage: "You don't have enough funds for this transfer",
    recoveryAction: "Top up your wallet or reduce the transfer amount",
    retryable: false,
  },
  KYC_TIER_LIMIT: {
    code: "KYC_TIER_LIMIT",
    userMessage: "This transfer exceeds your daily limit for your current KYC tier",
    recoveryAction: "Upgrade your KYC tier to increase your limits",
    retryable: false,
  },
  RATE_EXPIRED: {
    code: "RATE_EXPIRED",
    userMessage: "The exchange rate has expired",
    recoveryAction: "Refresh to get the latest rate and try again",
    retryable: true,
    retryAfterMs: 0,
  },
  RECIPIENT_NOT_FOUND: {
    code: "RECIPIENT_NOT_FOUND",
    userMessage: "The recipient account could not be found",
    recoveryAction: "Check the recipient's details and try again",
    retryable: false,
  },
  CORRIDOR_UNAVAILABLE: {
    code: "CORRIDOR_UNAVAILABLE",
    userMessage: "This transfer corridor is temporarily unavailable",
    recoveryAction: "Try again in a few minutes or choose an alternative delivery method",
    retryable: true,
    retryAfterMs: 60000,
  },
  VELOCITY_LIMIT: {
    code: "VELOCITY_LIMIT",
    userMessage: "Too many transfers in a short period",
    recoveryAction: "Wait a moment before making another transfer",
    retryable: true,
    retryAfterMs: 30000,
  },
  SANCTIONS_HIT: {
    code: "SANCTIONS_HIT",
    userMessage: "This transfer cannot be processed due to compliance requirements",
    recoveryAction: "Contact support for assistance",
    retryable: false,
  },
  FX_LOCK_ACTIVE: {
    code: "FX_LOCK_ACTIVE",
    userMessage: "Your rate is locked — retry the transfer to use it",
    recoveryAction: "Click 'Retry Transfer' to proceed with your locked rate",
    retryable: true,
    retryAfterMs: 0,
  },
  DUPLICATE_TRANSFER: {
    code: "DUPLICATE_TRANSFER",
    userMessage: "A similar transfer was already submitted",
    recoveryAction: "Check your recent transactions to confirm",
    retryable: false,
  },
  NETWORK_TIMEOUT: {
    code: "NETWORK_TIMEOUT",
    userMessage: "The request timed out",
    recoveryAction: "Check your connection and try again",
    retryable: true,
    retryAfterMs: 3000,
  },
};

export function getErrorContext(errorCode: string): ErrorContext {
  return (
    ERROR_MAP[errorCode] ?? {
      code: errorCode,
      userMessage: "Something went wrong",
      recoveryAction: "Please try again or contact support",
      retryable: true,
      retryAfterMs: 5000,
    }
  );
}

export function createContextualError(
  code: keyof typeof ERROR_MAP,
  details?: Record<string, unknown>
): TRPCError {
  const ctx = getErrorContext(code);
  return new TRPCError({
    code: "BAD_REQUEST",
    message: JSON.stringify({
      errorCode: ctx.code,
      userMessage: ctx.userMessage,
      recoveryAction: ctx.recoveryAction,
      retryable: ctx.retryable,
      retryAfterMs: ctx.retryAfterMs,
      details,
    }),
  });
}

export { ERROR_MAP };
