/**
 * insuranceCoverage.ts — Insurance & Coverage Framework
 *
 * Tracks and manages insurance coverage for platform assets:
 *   - DeFi insurance (Nexus Mutual, Unslashed Finance)
 *   - Traditional custody insurance (Lloyd's, Marsh)
 *   - Operational risk insurance (E&O, cyber liability)
 *   - Coverage gap analysis
 *   - Claims processing
 *
 * This module provides the data model and APIs for the admin dashboard
 * to manage insurance policies and track coverage ratios.
 */

import { logger } from "./logger";
import { getCircuitBreaker, emitFeatureEvent } from "./featurePersistence";

const insuranceBreaker = getCircuitBreaker("insurance-api");
const NEXUS_MUTUAL_URL = process.env.NEXUS_MUTUAL_URL || "https://api.nexusmutual.io/v2";
const NEXUS_MUTUAL_KEY = process.env.NEXUS_MUTUAL_API_KEY || "";

export async function getNexusMutualQuote(contractAddress: string, coverAmount: number, period: number): Promise<{
  premium: number; currency: string; period: number; available: boolean;
}> {
  if (!NEXUS_MUTUAL_KEY || !insuranceBreaker.canRequest()) {
    return { premium: coverAmount * 0.026 * (period / 365), currency: "ETH", period, available: true };
  }

  try {
    const res = await fetch(`${NEXUS_MUTUAL_URL}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${NEXUS_MUTUAL_KEY}` },
      body: JSON.stringify({ contractAddress, coverAmount, period, coverAsset: "ETH" }),
      signal: AbortSignal.timeout(10000),
    });
    insuranceBreaker.recordSuccess();
    if (res.ok) {
      const data = await res.json() as { premium: number; currency: string };
      emitFeatureEvent("feature.insurance", contractAddress, { event: "quote.received", premium: data.premium });
      return { premium: data.premium, currency: data.currency, period, available: true };
    }
    return { premium: coverAmount * 0.026 * (period / 365), currency: "ETH", period, available: true };
  } catch {
    insuranceBreaker.recordFailure();
    return { premium: coverAmount * 0.026 * (period / 365), currency: "ETH", period, available: true };
  }
}

export async function fileClaim(policyId: string, amount: number, description: string): Promise<Claim> {
  const claim: Claim = {
    claimId: `CLM-${Date.now().toString(36)}`,
    policyId,
    incidentDate: new Date().toISOString(),
    filedDate: new Date().toISOString(),
    amount,
    description,
    status: "filed",
    evidence: [],
  };
  emitFeatureEvent("feature.insurance", claim.claimId, { event: "claim.filed", policyId, amount });
  return claim;
}

// ── Types ───────────────────────────────────────────────────────────────────

export type InsuranceProvider =
  | "nexus_mutual"
  | "unslashed_finance"
  | "insurace"
  | "lloyds"
  | "marsh"
  | "aon"
  | "self_insured";

export type CoverageType =
  | "smart_contract"      // Covers smart contract exploits
  | "custody"             // Covers custodial wallet theft/loss
  | "defi_protocol"       // Covers DeFi protocol failures
  | "stablecoin_depeg"    // Covers stablecoin de-peg losses
  | "operational"         // E&O, cyber liability
  | "regulatory_fine"     // Covers regulatory penalties
  | "bridge_exploit";     // Covers cross-chain bridge exploits

export interface InsurancePolicy {
  policyId: string;
  provider: InsuranceProvider;
  coverageType: CoverageType;
  coverageAmount: number;
  deductible: number;
  premiumAnnual: number;
  premiumMonthly: number;
  startDate: string;
  endDate: string;
  status: "active" | "pending" | "expired" | "claimed";
  coveredAssets: string[];
  coveredChains: string[];
  exclusions: string[];
  claimProcess: string;
}

export interface CoverageGap {
  category: string;
  totalExposure: number;
  currentCoverage: number;
  gap: number;
  gapPercent: number;
  recommendation: string;
  estimatedPremium: number;
}

export interface Claim {
  claimId: string;
  policyId: string;
  incidentDate: string;
  filedDate: string;
  amount: number;
  description: string;
  status: "filed" | "under_review" | "approved" | "denied" | "paid";
  evidence: string[];
}

// ── Policy Templates ────────────────────────────────────────────────────────

export function getRecommendedPolicies(totalTvl: number): InsurancePolicy[] {
  return [
    {
      policyId: "POL-SC-001",
      provider: "nexus_mutual",
      coverageType: "smart_contract",
      coverageAmount: Math.min(totalTvl * 0.5, 5_000_000),
      deductible: 10_000,
      premiumAnnual: Math.min(totalTvl * 0.5, 5_000_000) * 0.026,
      premiumMonthly: Math.min(totalTvl * 0.5, 5_000_000) * 0.026 / 12,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 365 * 86400000).toISOString(),
      status: "pending",
      coveredAssets: ["RemitFlowVault", "RemitFlowEscrow", "RemitFlowBridge"],
      coveredChains: ["ethereum", "polygon", "arbitrum", "base"],
      exclusions: ["Admin key compromise", "Governance attack", "Flash loan economic exploit"],
      claimProcess: "File via Nexus Mutual dApp → DAO vote → Payout in NXM/ETH",
    },
    {
      policyId: "POL-CUSTODY-001",
      provider: "lloyds",
      coverageType: "custody",
      coverageAmount: Math.min(totalTvl, 50_000_000),
      deductible: 50_000,
      premiumAnnual: Math.min(totalTvl, 50_000_000) * 0.005,
      premiumMonthly: Math.min(totalTvl, 50_000_000) * 0.005 / 12,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 365 * 86400000).toISOString(),
      status: "pending",
      coveredAssets: ["Fireblocks Vault", "Hot Wallet", "Cold Storage"],
      coveredChains: ["all"],
      exclusions: ["Internal theft (requires separate crime policy)", "War/terrorism", "Nuclear"],
      claimProcess: "File with Lloyd's broker → Adjuster review → Settlement in 30-90 days",
    },
    {
      policyId: "POL-DEPEG-001",
      provider: "unslashed_finance",
      coverageType: "stablecoin_depeg",
      coverageAmount: Math.min(totalTvl * 0.3, 2_000_000),
      deductible: 5_000,
      premiumAnnual: Math.min(totalTvl * 0.3, 2_000_000) * 0.04,
      premiumMonthly: Math.min(totalTvl * 0.3, 2_000_000) * 0.04 / 12,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 365 * 86400000).toISOString(),
      status: "pending",
      coveredAssets: ["USDT", "USDC", "DAI", "BUSD"],
      coveredChains: ["all"],
      exclusions: ["Regulatory seizure of issuer reserves", "Gradual drift < 2%"],
      claimProcess: "Automatic payout if price < $0.95 for > 24 hours (oracle-based)",
    },
    {
      policyId: "POL-BRIDGE-001",
      provider: "nexus_mutual",
      coverageType: "bridge_exploit",
      coverageAmount: Math.min(totalTvl * 0.2, 3_000_000),
      deductible: 25_000,
      premiumAnnual: Math.min(totalTvl * 0.2, 3_000_000) * 0.05,
      premiumMonthly: Math.min(totalTvl * 0.2, 3_000_000) * 0.05 / 12,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 365 * 86400000).toISOString(),
      status: "pending",
      coveredAssets: ["RemitFlowBridge"],
      coveredChains: ["ethereum", "polygon", "arbitrum", "base", "bsc", "optimism"],
      exclusions: ["Validator collusion (majority)"],
      claimProcess: "File via Nexus Mutual → DAO vote → Payout",
    },
    {
      policyId: "POL-OPS-001",
      provider: "marsh",
      coverageType: "operational",
      coverageAmount: 5_000_000,
      deductible: 25_000,
      premiumAnnual: 75_000,
      premiumMonthly: 6_250,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 365 * 86400000).toISOString(),
      status: "pending",
      coveredAssets: ["Platform operations", "API services", "Data breach"],
      coveredChains: ["n/a"],
      exclusions: ["Intentional misconduct", "Known pre-existing issues"],
      claimProcess: "File with Marsh broker → Insurer review → Settlement",
    },
  ];
}

// ── Coverage Gap Analysis ───────────────────────────────────────────────────

export function analyzeCoverageGaps(
  totalTvl: number,
  activePolicies: InsurancePolicy[],
): CoverageGap[] {
  const exposures: Array<{ category: string; exposure: number; covType: CoverageType; recommendation: string; premiumRate: number }> = [
    { category: "Smart Contract Risk", exposure: totalTvl * 0.5, covType: "smart_contract", recommendation: "Nexus Mutual cover for deployed contracts", premiumRate: 0.026 },
    { category: "Custody Risk", exposure: totalTvl, covType: "custody", recommendation: "Lloyd's/Marsh custody insurance via Fireblocks partnership", premiumRate: 0.005 },
    { category: "Stablecoin De-peg", exposure: totalTvl * 0.3, covType: "stablecoin_depeg", recommendation: "Unslashed Finance de-peg cover for USDT/USDC", premiumRate: 0.04 },
    { category: "Bridge Exploit", exposure: totalTvl * 0.2, covType: "bridge_exploit", recommendation: "Nexus Mutual bridge cover + increase validator set", premiumRate: 0.05 },
    { category: "Operational/Cyber", exposure: 5_000_000, covType: "operational", recommendation: "E&O + Cyber liability via Marsh/Aon", premiumRate: 0.015 },
    { category: "Regulatory Fine", exposure: 2_000_000, covType: "regulatory_fine", recommendation: "D&O insurance + regulatory defense fund", premiumRate: 0.02 },
  ];

  return exposures.map(exp => {
    const covered = activePolicies
      .filter(p => p.coverageType === exp.covType && p.status === "active")
      .reduce((sum, p) => sum + p.coverageAmount, 0);

    const gap = Math.max(0, exp.exposure - covered);
    const gapPercent = exp.exposure > 0 ? Math.round((gap / exp.exposure) * 10000) / 100 : 0;

    return {
      category: exp.category,
      totalExposure: exp.exposure,
      currentCoverage: covered,
      gap,
      gapPercent,
      recommendation: gap > 0 ? exp.recommendation : "Fully covered",
      estimatedPremium: gap * exp.premiumRate,
    };
  });
}

export function getTotalPremium(policies: InsurancePolicy[]): {
  annual: number;
  monthly: number;
  asPercentOfTvl: number;
} {
  const annual = policies
    .filter(p => p.status === "active" || p.status === "pending")
    .reduce((sum, p) => sum + p.premiumAnnual, 0);

  const tvl = policies.reduce((max, p) => Math.max(max, p.coverageAmount), 0);

  return {
    annual: Math.round(annual),
    monthly: Math.round(annual / 12),
    asPercentOfTvl: tvl > 0 ? Math.round((annual / tvl) * 10000) / 100 : 0,
  };
}
