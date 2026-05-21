/**
 * Centralized feature flags client — P2 Frontend 3.14
 * Replaces 91 scattered feature flag references with unified system.
 */

type FlagValue = boolean | string | number;

interface FeatureFlag {
  key: string;
  value: FlagValue;
  description: string;
  enabled: boolean;
  rolloutPercentage: number;
  targetUsers?: number[];
  targetTenants?: string[];
  createdAt: string;
  updatedAt: string;
}

const FLAG_DEFAULTS: Record<string, FlagValue> = {
  "dark-mode": false,
  "new-send-flow": true,
  "ussd-enabled": true,
  "cbdc-enabled": true,
  "stablecoin-enabled": true,
  "biometric-auth": true,
  "push-notifications": true,
  "offline-mode": true,
  "real-fx-rates": false,
  "advanced-analytics": true,
  "chat-support": true,
  "video-kyc": true,
  "agent-network": true,
  "bnpl": false,
  "stock-trading": false,
  "diaspora-bonds": false,
  "referral-program": true,
  "multi-language": true,
  "pwa-install-prompt": true,
  "rate-alerts": true,
  "scheduled-transfers": true,
  "virtual-cards": true,
  "bill-payments": true,
  "airtime-purchase": true,
  "qr-payments": true,
  "batch-payments": false,
  "white-label": false,
  "api-access": false,
};

const flagOverrides = new Map<string, FlagValue>();
const userFlagCache = new Map<string, Map<string, FlagValue>>();

export function isEnabled(flag: string, userId?: number): boolean {
  if (flagOverrides.has(flag)) {
    return Boolean(flagOverrides.get(flag));
  }

  if (userId) {
    const userFlags = userFlagCache.get(String(userId));
    if (userFlags?.has(flag)) {
      return Boolean(userFlags.get(flag));
    }
  }

  return Boolean(FLAG_DEFAULTS[flag] ?? false);
}

export function getFlagValue(flag: string, defaultValue?: FlagValue): FlagValue {
  if (flagOverrides.has(flag)) {
    return flagOverrides.get(flag)!;
  }
  return FLAG_DEFAULTS[flag] ?? defaultValue ?? false;
}

export function setFlag(flag: string, value: FlagValue): void {
  flagOverrides.set(flag, value);
}

export function setUserFlag(userId: number, flag: string, value: FlagValue): void {
  const key = String(userId);
  if (!userFlagCache.has(key)) {
    userFlagCache.set(key, new Map());
  }
  userFlagCache.get(key)!.set(flag, value);
}

export function getAllFlags(): Record<string, FlagValue> {
  const result: Record<string, FlagValue> = { ...FLAG_DEFAULTS };
  flagOverrides.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export function resetFlags(): void {
  flagOverrides.clear();
  userFlagCache.clear();
}
