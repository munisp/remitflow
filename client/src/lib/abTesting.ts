/**
 * abTesting.ts — GrowthBook SDK integration for A/B testing
 *
 * Features:
 * - Feature flags with type-safe access
 * - A/B experiment assignment with sticky bucketing
 * - Remote config for UI variations
 * - Event tracking for experiment metrics
 * - Server-side evaluation support
 */

export interface ExperimentConfig {
  apiHost: string;
  clientKey: string;
  enableDevMode: boolean;
}

interface FeatureValue<T = any> {
  value: T;
  source: "defaultValue" | "force" | "experiment";
  experiment?: {
    key: string;
    variationId: number;
  };
}

interface Experiment {
  key: string;
  variations: any[];
  weights?: number[];
  coverage?: number;
  condition?: Record<string, any>;
  hashAttribute?: string;
}

// Feature flag definitions (type-safe)
export interface FeatureFlags {
  "send-flow-v2": boolean;
  "stablecoin-yield-display": boolean;
  "kyc-camera-auto-capture": boolean;
  "dark-mode-default": boolean;
  "instant-settlement-banner": boolean;
  "referral-reward-amount": number;
  "onboarding-variant": "control" | "streamlined" | "guided";
  "fee-display-mode": "upfront" | "breakdown" | "hidden";
  "biometric-login-prompt": boolean;
  "multi-currency-wallet-view": "list" | "grid" | "carousel";
}

const DEFAULT_FLAGS: FeatureFlags = {
  "send-flow-v2": false,
  "stablecoin-yield-display": true,
  "kyc-camera-auto-capture": true,
  "dark-mode-default": false,
  "instant-settlement-banner": false,
  "referral-reward-amount": 5,
  "onboarding-variant": "control",
  "fee-display-mode": "upfront",
  "biometric-login-prompt": true,
  "multi-currency-wallet-view": "list",
};

let growthbook: any = null;
let initialized = false;

export async function initABTesting(config?: Partial<ExperimentConfig>): Promise<void> {
  if (initialized) return;

  const finalConfig: ExperimentConfig = {
    apiHost: process.env.REACT_APP_GROWTHBOOK_API_HOST || "https://cdn.growthbook.io",
    clientKey: process.env.REACT_APP_GROWTHBOOK_CLIENT_KEY || "",
    enableDevMode: process.env.NODE_ENV !== "production",
    ...config,
  };

  if (!finalConfig.clientKey) {
    console.warn("[ABTesting] No GrowthBook client key — using default flags");
    initialized = true;
    return;
  }

  try {
    const { GrowthBook } = await import("@growthbook/growthbook");

    growthbook = new GrowthBook({
      apiHost: finalConfig.apiHost,
      clientKey: finalConfig.clientKey,
      enableDevMode: finalConfig.enableDevMode,
      trackingCallback: (experiment: any, result: any) => {
        trackExperimentView(experiment.key, result.variationId);
      },
    });

    await growthbook.loadFeatures({ autoRefresh: true, timeout: 3000 });
    initialized = true;
  } catch (err) {
    console.error("[ABTesting] Failed to initialize GrowthBook:", err);
    initialized = true; // Fall through to defaults
  }
}

// Set user attributes for targeting
export function setUserAttributes(attrs: {
  id: string;
  country?: string;
  kycTier?: string;
  registrationDate?: string;
  platform?: "web" | "ios" | "android";
  language?: string;
}): void {
  if (!growthbook) return;
  growthbook.setAttributes(attrs);
}

// Get feature flag value (type-safe)
export function getFeature<K extends keyof FeatureFlags>(key: K): FeatureFlags[K] {
  if (!growthbook) return DEFAULT_FLAGS[key];

  const value = growthbook.getFeatureValue(key, DEFAULT_FLAGS[key]);
  return value as FeatureFlags[K];
}

// Check if feature is on (boolean shorthand)
export function isFeatureOn(key: keyof FeatureFlags): boolean {
  if (!growthbook) return !!DEFAULT_FLAGS[key];
  return growthbook.isOn(key);
}

// Run experiment and get variation
export function runExperiment<T>(experimentKey: string, variations: T[]): T {
  if (!growthbook) return variations[0]; // Control

  const result = growthbook.run({
    key: experimentKey,
    variations,
  });

  return result.value;
}

// Track experiment conversion event
export function trackConversion(eventKey: string, value?: number): void {
  if (!growthbook) return;

  // Send to analytics
  const event = {
    event: eventKey,
    value,
    timestamp: new Date().toISOString(),
    experiments: growthbook.getAllResults
      ? Object.fromEntries(
          Array.from(growthbook.getAllResults() as Map<string, any>).map(([key, result]) => [
            key,
            result.variationId,
          ])
        )
      : {},
  };

  // Fire to analytics endpoint
  fetch("/api/trpc/analytics.trackEvent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => {});
}

// Track experiment view (called automatically by GrowthBook)
function trackExperimentView(experimentKey: string, variationId: number): void {
  // Send to analytics backend
  fetch("/api/trpc/analytics.trackExperiment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      experiment: experimentKey,
      variation: variationId,
      timestamp: new Date().toISOString(),
    }),
    keepalive: true,
  }).catch(() => {});
}

// React hook for feature flags (if using React context)
export function useFeatureFlag<K extends keyof FeatureFlags>(key: K): FeatureFlags[K] {
  return getFeature(key);
}

// Cleanup
export function destroyABTesting(): void {
  if (growthbook) {
    growthbook.destroy();
    growthbook = null;
    initialized = false;
  }
}
