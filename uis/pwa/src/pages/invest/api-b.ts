/**
 * W16-C7 (SPEC-wave16, pwa-invest-b) — tRPC client surface for the user-facing
 * investment pages: Real Estate, Startups, Community funds, Property Escrow.
 *
 * Same convention as src/api.ts (W13-MERCHANT / W13-PARTNER): the shared
 * tRPC client is cast to a local structural type because the PWA-local
 * AppRouter contract (types/appRouter.ts) does not mirror these namespaces.
 * CONTRACT SOURCE OF TRUTH: the zod `.input(...)` schemas in
 *   - server/routers/investment.ts     (realEstate, startups — verified routers.json)
 *   - server/routers.ts:6537           (community — inline, 13 procs)
 *   - server/routers/propertyEscrow.ts (propertyEscrow — 19 procs)
 *
 * This file lives in pages/invest/ (not src/api.ts) so wave-16 coders C6/C7
 * have zero file overlap.
 *
 * Honesty / guardrails honored here:
 *  - Money-moving mutations (realEstate.invest, startups.commit,
 *    propertyEscrow.escrowPlan.payDeposit/payInstallment) are TOTP step-up
 *    guarded server-side (requireTotpStepUp, fail-closed). The pages surface
 *    the 2FA prompt; totpCode is forwarded verbatim.
 *  - Admin-only procedures are deliberately ABSENT from these client types:
 *    realEstate.confirmCustody, startups.confirmCustody,
 *    community.approveDisbursement, community.listDisbursementRequests,
 *    propertyEscrow.builderKyb.adminVerify, milestone.reviewEvidence,
 *    milestone.approveMilestone, dispute.resolve. User UI must never call them.
 */
import { trpcClient } from "../../services/trpc";

/** Human-readable error from a tRPC/network failure (same rule as api.ts). */
export function investErrMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

// ── Shared formatting helpers (server returns numerics as strings) ──────────

export function fmtMoney(v: string | number | null | undefined, currency = "USD"): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

export function fmtPct(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

// ── Shared class strings (visual standard: stone/amber, same as consoles) ───

export const inputCls =
  "w-full px-4 py-2.5 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:opacity-50";
export const btnPrimaryCls =
  "px-5 py-2.5 bg-amber-700 text-white rounded-xl text-sm font-medium hover:bg-amber-800 transition-colors disabled:opacity-40";
export const btnSecondaryCls =
  "px-5 py-2.5 bg-white border border-stone-200 text-stone-700 rounded-xl text-sm font-medium hover:bg-stone-50 transition-colors disabled:opacity-40";
export const btnDangerCls =
  "px-5 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-40";

export function statusBadgeCls(status: string | null | undefined): string {
  switch (status) {
    case "active":
    case "open":
    case "approved":
    case "confirmed":
    case "funded":
    case "completed":
    case "verified":
      return "bg-emerald-50 text-emerald-700";
    case "pending":
    case "pending_acquisition":
    case "draft":
    case "voting":
    case "scheduled":
    case "submitted":
    case "evidence_submitted":
      return "bg-amber-50 text-amber-700";
    case "rejected":
    case "cancelled":
    case "defaulted":
    case "failed":
      return "bg-red-50 text-red-600";
    case "disputed":
      return "bg-orange-50 text-orange-700";
    case "refunded":
      return "bg-sky-50 text-sky-700";
    default:
      return "bg-stone-100 text-stone-600";
  }
}

/** Honest, human label for holding statuses (never decorate server values). */
export function holdingStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "pending_acquisition":
      return "pending acquisition — custody not yet confirmed";
    default:
      return status ?? "—";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// realEstate.* — server/routers/investment.ts:638 (6 procs; confirmCustody is
// admin-only and intentionally not exposed here).
// ═══════════════════════════════════════════════════════════════════════════

export interface RealEstateListing {
  id: number;
  title: string;
  description: string;
  propertyType: string;
  location: string;
  city: string;
  state: string;
  totalValueNgn: string;
  totalValueUsd: string;
  minimumInvestmentUsd: string;
  totalShares: number;
  availableShares: number;
  pricePerShareUsd: string;
  expectedAnnualReturnPct: string | null;
  rentalYieldPct: string | null;
  appreciationPct: string | null;
  tenureYears: number | null;
  status: string;
  imageUrls: string[];
  developerName: string | null;
  isFeatured: boolean;
  createdAt: string | Date;
}

export interface RealEstateListingsFilter {
  search?: string;
  propertyType?: string;
  city?: string;
  status?: string;
  isFeatured?: boolean;
  minReturnPct?: number;
  limit?: number;
  offset?: number;
}

export interface RealEstateInvestResult {
  id: number;
  listingId: number;
  sharesOwned: number;
  totalInvestedUsd: string;
  ownershipPct: string;
  status: string;
  verified: boolean;
  fraudScore?: number | null;
  custodyPending: boolean;
  note: string;
}

export interface RealEstateHolding {
  id: number;
  sharesOwned: number;
  totalInvestedUsd: string;
  ownershipPct: string;
  status: string;
  returnsPaidUsd: string | null;
  investedAt: string | Date;
  listingId: number;
  title: string;
  city: string;
  state: string;
  propertyType: string;
  expectedAnnualReturnPct: string | null;
  listingStatus: string;
}

export interface RealEstateRoiProjection {
  investedUsd: string;
  projectedTotalReturnUsd: string;
  rentalIncomeUsd: string;
  capitalGainUsd: string;
  totalValueAtExitUsd: string;
  annualReturnPct: string;
  holdYears: number;
}

export interface RealEstateClient {
  listListings: { query(input?: RealEstateListingsFilter): Promise<RealEstateListing[]> };
  getListing: { query(input: { id: number }): Promise<RealEstateListing> };
  invest: {
    mutate(input: {
      listingId: number;
      sharesCount: number;
      totpCode?: string;
    }): Promise<RealEstateInvestResult>;
  };
  getMyInvestments: { query(): Promise<RealEstateHolding[]> };
  roiCalculator: {
    query(input: {
      listingId: number;
      sharesCount: number;
      holdYears?: number;
    }): Promise<RealEstateRoiProjection>;
  };
}

/** realEstate.* namespace (mounted server/routers.ts:7488 — W16-C7). */
export const realEstateApi: RealEstateClient =
  (trpcClient as unknown as { realEstate: RealEstateClient }).realEstate;

// ═══════════════════════════════════════════════════════════════════════════
// startups.* — server/routers/investment.ts:918 (6 procs; confirmCustody is
// admin-only and intentionally not exposed here).
// ═══════════════════════════════════════════════════════════════════════════

export interface StartupDeal {
  id: number;
  companyName: string;
  tagline: string;
  description: string;
  sector: string;
  stage: string;
  location: string;
  foundedYear: number | null;
  teamSize: number | null;
  targetRaiseUsd: string;
  raisedSoFarUsd: string | null;
  minimumTicketUsd: string;
  valuationUsd: string | null;
  equityOfferedPct: string | null;
  instrumentType: string;
  status: string;
  websiteUrl: string | null;
  pitchDeckUrl: string | null;
  logoUrl: string | null;
  highlights: string[];
  risks: string[];
  metrics: Array<{ label: string; value: string }>;
  closingDate: string | Date | null;
  isFeatured: boolean;
  createdAt: string | Date;
}

export interface StartupDealsFilter {
  search?: string;
  sector?: string;
  stage?: string;
  status?: string;
  isFeatured?: boolean;
  limit?: number;
  offset?: number;
}

export interface StartupCommitResult {
  id: number;
  dealId: number;
  amountUsd: string;
  instrumentType: string;
  equityPct: string | null;
  status: string;
  paymentMethod: string;
  verified: boolean;
  fraudScore?: number | null;
  custodyPending: boolean;
  note: string;
}

export interface StartupInvestment {
  id: number;
  amountUsd: string;
  instrumentType: string;
  equityPct: string | null;
  status: string;
  paymentMethod: string;
  agreementSigned: boolean;
  investedAt: string | Date;
  dealId: number;
  companyName: string;
  sector: string;
  stage: string;
  dealStatus: string;
  logoUrl: string | null;
}

export interface StartupsClient {
  listDeals: { query(input?: StartupDealsFilter): Promise<StartupDeal[]> };
  getDeal: { query(input: { id: number }): Promise<StartupDeal> };
  commit: {
    mutate(input: {
      dealId: number;
      amountUsd: number;
      paymentMethod?: "wallet" | "bank_transfer" | "card";
      notes?: string;
      totpCode?: string;
    }): Promise<StartupCommitResult>;
  };
  getMyInvestments: { query(): Promise<StartupInvestment[]> };
  signAgreement: {
    mutate(input: { investmentId: number }): Promise<StartupInvestment>;
  };
}

/** startups.* namespace (mounted server/routers.ts:7489 — W16-C7). */
export const startupsApi: StartupsClient =
  (trpcClient as unknown as { startups: StartupsClient }).startups;

// ═══════════════════════════════════════════════════════════════════════════
// community.* — inline in server/routers.ts:6537 (13 procs; approveDisbursement
// and listDisbursementRequests are admin-only and intentionally not exposed).
// ═══════════════════════════════════════════════════════════════════════════

export interface CommunityFund {
  id: number;
  createdByUserId: number;
  name: string;
  description: string | null;
  country: string | null;
  theme: string | null;
  totalRaised: string | null;
  goalAmount: string | null;
  currency: string | null;
  contributorCount: number | null;
  beneficiaryCount: number | null;
  sdgGoals: number[];
  status: string;
  imageUrl: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface FundProposal {
  id: number;
  fundId: number;
  submittedByUserId: number;
  title: string;
  description: string | null;
  requestedAmount: string;
  currency: string | null;
  beneficiaryName: string | null;
  beneficiaryCountry: string | null;
  impactDescription: string | null;
  status: string;
  votesFor: number | null;
  votesAgainst: number | null;
  votingDeadline: string | Date | null;
  fundedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface CommunityImpactMetrics {
  fund: CommunityFund;
  fundedProposals: number;
  totalFunded: number;
  beneficiaryCount: number | null;
  sdgGoals: number[];
}

export interface CommunityLeaderboardEntry {
  rank: number;
  userId: number;
  name: string;
  votes?: number;
  total?: number;
  funded?: number;
}

export interface CommunityLeaderboard {
  topVoters: CommunityLeaderboardEntry[];
  topContributors: CommunityLeaderboardEntry[];
  topProposers: CommunityLeaderboardEntry[];
}

export interface MyVote {
  id: number;
  vote: string;
  comment: string | null;
  createdAt: string | Date;
  proposalId: number | null;
  proposalTitle: string | null;
  fundId: number | null;
  fundName: string | null;
}

export interface CommunityClient {
  listFunds: { query(): Promise<CommunityFund[]> };
  createFund: {
    mutate(input: {
      name: string;
      description?: string;
      country?: string;
      theme?: string;
      goalAmount?: number;
      currency?: string;
      sdgGoals?: number[];
    }): Promise<CommunityFund>;
  };
  contribute: {
    mutate(input: {
      fundId: number;
      amount: number;
    }): Promise<{ success: boolean; fundId: number; amount: number }>;
  };
  listProposals: { query(input: { fundId: number }): Promise<FundProposal[]> };
  submitProposal: {
    mutate(input: {
      fundId: number;
      title: string;
      description?: string;
      requestedAmount: number;
      currency?: string;
      beneficiaryName?: string;
      beneficiaryCountry?: string;
      impactDescription?: string;
    }): Promise<FundProposal>;
  };
  vote: {
    mutate(input: {
      proposalId: number;
      vote: "for" | "against";
      comment?: string;
    }): Promise<{ success: boolean; votesFor: number; votesAgainst: number }>;
  };
  liveVotes: {
    query(input: {
      proposalId: number;
    }): Promise<{ votesFor: number; votesAgainst: number; total: number }>;
  };
  getImpactMetrics: {
    query(input: { fundId: number }): Promise<CommunityImpactMetrics | null>;
  };
  requestDisbursement: {
    mutate(input: {
      proposalId: number;
      beneficiaryWalletAddress?: string;
      disbursementMethod?: "wallet" | "bank" | "mobile_money";
      notes?: string;
    }): Promise<{ success: boolean; proposalId: number }>;
  };
  communityLeaderboard: { query(): Promise<CommunityLeaderboard> };
  listMyVotes: { query(): Promise<MyVote[]> };
}

/** community.* namespace (inline server/routers.ts:6537 — W16-C7). */
export const communityApi: CommunityClient =
  (trpcClient as unknown as { community: CommunityClient }).community;

// ═══════════════════════════════════════════════════════════════════════════
// propertyEscrow.* — server/routers/propertyEscrow.ts (19 procs across 4
// sub-routers; admin-only adminVerify/reviewEvidence/approveMilestone/resolve
// are intentionally not exposed in this user UI).
// ═══════════════════════════════════════════════════════════════════════════

export interface EscrowPlan {
  id: number;
  planId: string;
  buyerId: number;
  builderId: number;
  listingId: number;
  totalPriceNgn: string;
  totalPriceUsd: string;
  depositPct: string | null;
  depositPaid: boolean | null;
  paymentCurrency: string | null;
  installmentCount: number;
  installmentAmount: string;
  installmentFrequency: string | null;
  totalPaidUsd: string | null;
  totalReleasedUsd: string | null;
  status: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface EscrowMilestone {
  id: number;
  milestoneId: string;
  escrowPlanId: number;
  sequenceNumber: number;
  name: string;
  description: string | null;
  releasePct: string;
  releaseAmountUsd: string;
  deadline: string | Date;
  verificationType: string | null;
  status: string | null;
  rejectedReason: string | null;
  fundsReleased: boolean | null;
  fundsReleasedAt: string | Date | null;
  createdAt: string | Date;
}

export interface MilestoneEvidence {
  id: number;
  evidenceId: string;
  milestoneId: number;
  evidenceType: string;
  fileUrl: string;
  fileName: string | null;
  description: string | null;
  verified: boolean | null;
  rejectionReason: string | null;
  createdAt: string | Date;
}

export interface EscrowScheduleEntry {
  id: number;
  installmentNumber: number;
  dueDate: string | Date;
  amountUsd: string;
  status: string | null;
  paidAt: string | Date | null;
}

export interface EscrowDispute {
  id: number;
  disputeId: string;
  escrowPlanId: number;
  milestoneId: number | null;
  disputeType: string;
  severity: string;
  description: string;
  status: string;
  cureDeadline: string | Date | null;
  autoRefundDate: string | Date | null;
  createdAt: string | Date;
}

export interface EscrowBuilderProfile {
  id: number;
  companyName: string;
  kybStatus: string;
  email: string | null;
  phone: string | null;
}

export interface EscrowPlanDetail {
  plan: EscrowPlan;
  milestones: EscrowMilestone[];
  schedule: EscrowScheduleEntry[];
  disputes: EscrowDispute[];
  builder: EscrowBuilderProfile | undefined;
  listing: { id: number; title: string; city: string; state: string } | undefined;
}

export interface EscrowTimeline {
  planId: string;
  status: string | null;
  totalPaid: string | null;
  totalReleased: string | null;
  milestones: Array<EscrowMilestone & { evidence: MilestoneEvidence[] }>;
}

export type EscrowDisputeType =
  | "deadline_missed"
  | "quality_issues"
  | "builder_default"
  | "scope_change"
  | "fraud"
  | "communication_failure"
  | "force_majeure"
  | "other";

export type EscrowEvidenceType =
  | "photo"
  | "video"
  | "document"
  | "engineer_report"
  | "surveyor_report"
  | "inspection_report"
  | "receipt"
  | "certificate";

export interface PropertyEscrowClient {
  escrowPlan: {
    listMyPlans: {
      query(input?: {
        role?: "buyer" | "builder";
        limit?: number;
      }): Promise<EscrowPlan[]>;
    };
    get: { query(input: { planId: string }): Promise<EscrowPlanDetail> };
    payDeposit: {
      mutate(input: {
        planId: string;
        totpCode?: string;
      }): Promise<{
        planId: string;
        depositPaid: number;
        status: string;
        nextPaymentDate: string;
        verified: boolean;
      }>;
    };
    payInstallment: {
      mutate(input: {
        planId: string;
        totpCode?: string;
      }): Promise<{
        planId: string;
        installmentNumber: number;
        amountPaid: number;
        totalPaid: number;
        totalRequired: number;
        remainingInstallments: number;
        status: string;
      }>;
    };
  };
  milestone: {
    getTimeline: { query(input: { planId: string }): Promise<EscrowTimeline> };
    submitEvidence: {
      mutate(input: {
        milestoneId: string;
        evidenceType: EscrowEvidenceType;
        fileUrl: string;
        fileName?: string;
        description?: string;
      }): Promise<{ evidenceId: string; milestoneId: string; status: string; message: string }>;
    };
  };
  dispute: {
    raise: {
      mutate(input: {
        planId: string;
        milestoneId?: string;
        disputeType: EscrowDisputeType;
        severity?: "low" | "medium" | "high" | "critical";
        description: string;
        evidenceIds?: string[];
      }): Promise<{
        disputeId: string;
        status: string;
        cureDeadline: string;
        autoRefundDate: string;
        message: string;
      }>;
    };
    requestFullRefund: {
      mutate(input: {
        planId: string;
        reason: string;
      }): Promise<{ planId: string; refundAmount: number; status: string; message: string }>;
    };
  };
}

/** propertyEscrow.* namespace (mounted server/routers.ts:7812 — W16-C7). */
export const propertyEscrowApi: PropertyEscrowClient =
  (trpcClient as unknown as { propertyEscrow: PropertyEscrowClient }).propertyEscrow;
