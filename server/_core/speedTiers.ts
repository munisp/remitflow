/**
 * W10 / SPEC-wave10 — speed-tiered delivery pricing (shared by AP/AR/payouts).
 * Config via env SPEED_TIER_CONFIG_JSON (per-tier feePct/feeCap/etaMinutes per rail class).
 * ETAs are honest: they describe the rail's real settlement expectation, never a promise.
 */

export interface SpeedTier {
  tier: "standard" | "same_day" | "instant";
  feePct: number;
  feeCap: number;
  etaMinutes: number;
  etaHonest: true;
}

interface TierConfig { feePct: number; feeCap: number; etaMinutes: number; }
interface RailConfig { standard: TierConfig; same_day?: TierConfig; instant?: TierConfig; }

const DEFAULTS: Record<string, RailConfig> = {
  mobile_money: {
    standard: { feePct: 0, feeCap: 0, etaMinutes: 60 * 24 },
    same_day: { feePct: 0.005, feeCap: 50, etaMinutes: 8 * 60 },
    instant: { feePct: 0.01, feeCap: 75, etaMinutes: 15 },
  },
  bank: {
    standard: { feePct: 0, feeCap: 0, etaMinutes: 3 * 60 * 24 },
    same_day: { feePct: 0.01, feeCap: 75, etaMinutes: 12 * 60 },
  },
  mojaloop: {
    standard: { feePct: 0, feeCap: 0, etaMinutes: 30 },
    instant: { feePct: 0.005, feeCap: 25, etaMinutes: 2 },
  },
  stablecoin: {
    standard: { feePct: 0, feeCap: 0, etaMinutes: 10 },
    instant: { feePct: 0.002, feeCap: 10, etaMinutes: 2 },
  },
  swift: {
    standard: { feePct: 0, feeCap: 0, etaMinutes: 4 * 60 * 24 },
    same_day: { feePct: 0.01, feeCap: 95, etaMinutes: 60 * 24 },
  },
};

function loadConfig(): Record<string, RailConfig> {
  const raw = process.env.SPEED_TIER_CONFIG_JSON;
  if (!raw) return DEFAULTS;
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    console.warn("[speedTiers] SPEED_TIER_CONFIG_JSON is invalid JSON — using defaults");
    return DEFAULTS;
  }
}

/** Available tiers for a rail. Unknown rail → standard-only with conservative ETA (fail honest). */
export function quoteSpeedTiers(amount: number, currency: string, rail: string): SpeedTier[] {
  const cfg = loadConfig()[rail] ?? { standard: { feePct: 0, feeCap: 0, etaMinutes: 3 * 60 * 24 } };
  const out: SpeedTier[] = [];
  for (const tier of ["standard", "same_day", "instant"] as const) {
    const t = cfg[tier];
    if (!t) continue;
    out.push({ tier, feePct: t.feePct, feeCap: t.feeCap, etaMinutes: t.etaMinutes, etaHonest: true });
  }
  return out;
}

/**
 * Quantization contract (money, M7): speed-tier fees are quantized to 4
 * decimal places with ROUND_HALF_UP — the same scale as the numeric(18,4)
 * columns the consumers (vendorBills bill fee, embeddedPayouts amount+fee
 * TigerBeetle hold) persist into. Implemented without new deps and without
 * bare float toFixed rounding ambiguity: Math.round((x + Number.EPSILON) *
 * 1e4) / 1e4. Callers MUST render with .toFixed(4) at string/DB boundaries.
 * Non-finite input throws (fail closed — a NaN fee must never reach a ledger).
 */
function quantize4HalfUp(n: number): number {
  if (!Number.isFinite(n)) throw new Error(`speed tier fee is not finite (${n})`);
  return Math.round((n + Number.EPSILON) * 10_000) / 10_000;
}

/** Fee for a chosen tier. Throws on tier unavailable for the rail (fail closed). */
export function speedTierFee(amount: number, rail: string, tier: SpeedTier["tier"]): number {
  const tiers = quoteSpeedTiers(amount, "", rail);
  const t = tiers.find((x) => x.tier === tier);
  if (!t) throw new Error(`speed tier ${tier} unavailable for rail ${rail}`);
  return quantize4HalfUp(Math.min(amount * t.feePct, t.feeCap));
}
