export interface CorridorTimeout {
  rail: string;
  stuckThresholdHours: number;
  autoRefundHours: number;
}

export const CORRIDOR_TIMEOUTS: Record<string, CorridorTimeout> = {
  mojaloop: {
    rail: "mojaloop",
    stuckThresholdHours: 1,
    autoRefundHours: 24,
  },
  pix: {
    rail: "pix",
    stuckThresholdHours: 2,
    autoRefundHours: 48,
  },
  upi: {
    rail: "upi",
    stuckThresholdHours: 2,
    autoRefundHours: 24,
  },
  cips: {
    rail: "cips",
    stuckThresholdHours: 4,
    autoRefundHours: 48,
  },
  swift: {
    rail: "swift",
    stuckThresholdHours: 72,
    autoRefundHours: 168,
  },
  marklane: {
    rail: "marklane",
    stuckThresholdHours: 6,
    autoRefundHours: 72,
  },
  cash_pickup: {
    rail: "cash_pickup",
    stuckThresholdHours: 48,
    autoRefundHours: 120,
  },
  bank_transfer: {
    rail: "bank_transfer",
    stuckThresholdHours: 24,
    autoRefundHours: 72,
  },
};

export function checkTransferStuckStatus(
  rail: string,
  updatedAt: Date
): { isStuck: boolean; minutesSinceUpdate: number; shouldAutoRefund: boolean } {
  const now = new Date();
  const diffMs = now.getTime() - updatedAt.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  const config = CORRIDOR_TIMEOUTS[rail] ?? CORRIDOR_TIMEOUTS["bank_transfer"];

  return {
    isStuck: diffHours > config.stuckThresholdHours,
    minutesSinceUpdate: diffMinutes,
    shouldAutoRefund: diffHours > config.autoRefundHours,
  };
}
