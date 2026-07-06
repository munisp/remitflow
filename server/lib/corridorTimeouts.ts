/**
 * corridorTimeouts.ts — Per-corridor stuck transfer timeout configuration
 *
 * Different payment rails have vastly different settlement times:
 * - Mojaloop: seconds (ILP protocol)
 * - PIX: seconds to minutes
 * - UPI: seconds to minutes
 * - CIPS: minutes to hours
 * - SWIFT: 1-3 business days
 * - Mark Lane FX: minutes to hours (FX bridge)
 *
 * Using a single timeout for all rails would either auto-refund legitimate
 * SWIFT transfers or let Mojaloop transfers hang indefinitely.
 */

export interface CorridorTimeout {
  /** Payment rail name */
  rail: string;
  /** Hours before marking as "stuck" and alerting ops */
  stuckThresholdHours: number;
  /** Hours before auto-refund (must be >= stuckThresholdHours) */
  autoRefundHours: number;
  /** Human-readable expected settlement time */
  expectedSettlement: string;
}

/** Per-rail timeout configuration */
export const CORRIDOR_TIMEOUTS: Record<string, CorridorTimeout> = {
  mojaloop: {
    rail: "mojaloop",
    stuckThresholdHours: 1,
    autoRefundHours: 24,
    expectedSettlement: "< 30 seconds",
  },
  pix: {
    rail: "pix",
    stuckThresholdHours: 2,
    autoRefundHours: 48,
    expectedSettlement: "< 10 seconds",
  },
  upi: {
    rail: "upi",
    stuckThresholdHours: 2,
    autoRefundHours: 48,
    expectedSettlement: "< 30 seconds",
  },
  cips: {
    rail: "cips",
    stuckThresholdHours: 12,
    autoRefundHours: 72,
    expectedSettlement: "30 minutes - 2 hours",
  },
  swift: {
    rail: "swift",
    stuckThresholdHours: 72,
    autoRefundHours: 168, // 7 calendar days
    expectedSettlement: "1-3 business days",
  },
  marklane: {
    rail: "marklane",
    stuckThresholdHours: 6,
    autoRefundHours: 48,
    expectedSettlement: "15 minutes - 2 hours",
  },
  cash_pickup: {
    rail: "cash_pickup",
    stuckThresholdHours: 48,
    autoRefundHours: 168, // 7 days — agent needs time to reach recipient
    expectedSettlement: "Until agent disbursement (up to 72 hours)",
  },
  bank_transfer: {
    rail: "bank_transfer",
    stuckThresholdHours: 24,
    autoRefundHours: 120, // 5 calendar days
    expectedSettlement: "1-2 business days",
  },
};

/** Default timeout for unknown rails */
const DEFAULT_TIMEOUT: CorridorTimeout = {
  rail: "default",
  stuckThresholdHours: 24,
  autoRefundHours: 168,
  expectedSettlement: "1-5 business days",
};

/**
 * Get the timeout configuration for a given rail.
 * Falls back to the default if the rail is not explicitly configured.
 */
export function getCorridorTimeout(rail: string): CorridorTimeout {
  return CORRIDOR_TIMEOUTS[rail.toLowerCase()] ?? DEFAULT_TIMEOUT;
}

/**
 * Determine if a transfer is stuck based on its rail and the time elapsed.
 * @param rail - The payment rail (e.g., "swift", "mojaloop")
 * @param partnerSentAt - When the transfer entered partner_sent state
 * @returns Object with isStuck, shouldAutoRefund, and hoursElapsed
 */
export function checkTransferStuckStatus(
  rail: string,
  partnerSentAt: Date
): { isStuck: boolean; shouldAutoRefund: boolean; hoursElapsed: number; timeout: CorridorTimeout } {
  const timeout = getCorridorTimeout(rail);
  const hoursElapsed = (Date.now() - partnerSentAt.getTime()) / (1000 * 60 * 60);

  return {
    isStuck: hoursElapsed >= timeout.stuckThresholdHours,
    shouldAutoRefund: hoursElapsed >= timeout.autoRefundHours,
    hoursElapsed: Math.round(hoursElapsed * 10) / 10,
    timeout,
  };
}
