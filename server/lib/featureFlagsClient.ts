/**
 * Centralized feature flags client — P2 Frontend 3.14
 * Replaces 91 scattered feature flag references with unified system.
 */
import { BoundedCache, registerCache } from "./boundedCache";

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

const flagOverrides = new BoundedCache<string, FlagValue>({
  maxSize: 500,
  defaultTtlMs: 3_600_000, // 1 hour (admin-set, rarely changes)
  name: "feature-flag-overrides",
});
registerCache(flagOverrides as unknown as BoundedCache<unknown, unknown>);
const userFlagCache = new BoundedCache<string, Map<string, FlagValue>>({
  maxSize: 10_000,
  defaultTtlMs: 300_000, // 5 minutes per user
  name: "user-feature-flags",
});
registerCache(userFlagCache as unknown as BoundedCache<unknown, unknown>);

export function isEnabled(flag: string, userId?: number): boolean {
  const override = flagOverrides.get(flag);
  if (override !== undefined) {
    return Boolean(override);
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
  const override = flagOverrides.get(flag);
  if (override !== undefined) return override;
  return FLAG_DEFAULTS[flag] ?? defaultValue ?? false;
}

export function setFlag(flag: string, value: FlagValue): void {
  flagOverrides.set(flag, value);
}

export function setUserFlag(userId: number, flag: string, value: FlagValue): void {
  const key = String(userId);
  let userFlags = userFlagCache.get(key);
  if (!userFlags) {
    userFlags = new Map();
  }
  userFlags.set(flag, value);
  userFlagCache.set(key, userFlags);
}

export function getAllFlags(): Record<string, FlagValue> {
  const result: Record<string, FlagValue> = { ...FLAG_DEFAULTS };
  for (const [key, value] of flagOverrides.entries()) {
    result[key] = value;
  }
  return result;
}

export function resetFlags(): void {
  flagOverrides.clear();
  userFlagCache.clear();
}
