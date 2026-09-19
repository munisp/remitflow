/**
 * PWA shared API surface for wave-13 onboarding consoles.
 *
 * Convention mirrors pages/bdc/api.ts: the server-side zod `.input(...)`
 * schemas are the contract source of truth; the PWA-local AppRouter type
 * (types/appRouter.ts) does not mirror these namespaces yet, so the shared
 * tRPC client is cast to a local structural type. Blocks are marked per
 * coder (W13-MERCHANT / W13-PARTNER) — append-only, do not reorder.
 */
import { trpcClient } from "./services/trpc";

// ── W13-MERCHANT ─────────────────────────────────────────────────────────────
// Contract source of truth: server/routers/merchantOnboarding.ts (SPEC-wave13
// §4). Verdicts/statuses are honest server values — never decorate them here.

export type MerchantScreeningVerdict = "clear" | "match" | "review" | "error";

export interface MerchantDirectorInput {
  fullName: string;
  isUbo: boolean;
  ownershipPct?: number;
  idDocUrl?: string;
}

export interface MerchantApplyInput {
  businessName: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  registrationNumber: string;
  businessType: string;
  expectedMonthlyVolume: number;
  website?: string;
  directors: MerchantDirectorInput[];
  termsVersion: string;
  termsAccepted: true;
}

export interface MerchantApplyResult {
  alreadyApplied: boolean;
  merchantId: number;
  reviewId?: number;
  status: string;
  screening: {
    business: MerchantScreeningVerdict;
    directors: MerchantScreeningVerdict[];
    providerError: boolean;
  } | null;
  message?: string;
}

export interface MerchantMyStatusNotApplied {
  applied: false;
}

export interface MerchantMyStatusApplied {
  applied: true;
  merchant: {
    id: number;
    businessName: string;
    country: string | null;
    status: string;
    riskRating: string;
    termsVersion: string | null;
    createdAt: string | Date;
  };
  review: {
    id: number;
    status: string;
    rejectionReason: string | null;
    reviewedAt: string | Date | null;
  } | null;
  directors: Array<{
    id: number;
    fullName: string;
    isUbo: boolean;
    screeningVerdict: string | null;
  }>;
}

export type MerchantMyStatus = MerchantMyStatusNotApplied | MerchantMyStatusApplied;

export type MerchantKybReviewStatus =
  | "pending"
  | "documents_requested"
  | "under_review"
  | "approved"
  | "rejected"
  | "suspended";

export interface MerchantKybQueueRow {
  id: number;
  userId: number;
  businessName: string;
  registrationNumber: string | null;
  taxId: string | null;
  country: string;
  industry: string | null;
  website: string | null;
  expectedMonthlyVol: string | null;
  status: MerchantKybReviewStatus | string;
  reviewedBy: number | null;
  reviewedAt: string | Date | null;
  rejectionReason: string | null;
  riskRating: string | null;
  notes: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  merchantId: number | null;
  merchantStatus: string | null;
}

export interface MerchantAdminReviewInput {
  reviewId: number;
  decision: "approved" | "rejected";
  riskRating: "low" | "medium" | "high";
  rejectionReason?: string;
  notes?: string;
  totpCode?: string;
}

export interface MerchantAdminReviewResult {
  reviewId: number;
  merchantId: number;
  status: "approved" | "rejected";
  merchantStatus: "active" | "rejected";
}

interface MerchantOnboardingClient {
  apply: { mutate(input: MerchantApplyInput): Promise<MerchantApplyResult> };
  myStatus: { query(): Promise<MerchantMyStatus> };
  adminList: {
    query(input?: {
      status?: MerchantKybReviewStatus;
      limit?: number;
      offset?: number;
    }): Promise<MerchantKybQueueRow[]>;
  };
  adminReview: { mutate(input: MerchantAdminReviewInput): Promise<MerchantAdminReviewResult> };
}

/** merchantOnboarding.* namespace (registered in server/routers.ts — W13-MERCHANT). */
export const merchantOnboardingApi: MerchantOnboardingClient =
  (trpcClient as unknown as { merchantOnboarding: MerchantOnboardingClient }).merchantOnboarding;

/** Extract a human-readable error from a tRPC/network failure. */
export function merchantApiErrMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * W13-PARTNER — Partner application / agent onboarding client hooks.
 *
 * Typed wrapper over the shared PWA tRPC client (services/trpc.ts), following
 * the pages/bdc/api.ts convention: the PWA-local AppRouter contract
 * (types/appRouter.ts) does not mirror these routers, so the client is cast
 * to a local structural type. CONTRACT SOURCE OF TRUTH: the zod `.input(...)`
 * schemas in server/routers/partnerApplications.ts and
 * server/routers/agentOnboarding.ts (wave-13 hardened).
 *
 * Honesty notes (SPEC-wave13 §5):
 *  - partnerApplications.submit returns a claimToken exactly ONCE — the UI
 *    must display it immediately; it is required to manage the application.
 *  - partnerApplications.checkStatus returns status + timestamps ONLY
 *    (PII stripped server-side).
 *  - approve/reject require a TOTP code (2FA) and fail with CONFLICT if the
 *    application was already decided.
 *  - approve returns emailSent honestly — false means the approval email was
 *    NOT delivered and the invite code must be shared manually.
 */
import { trpcClient } from "./services/trpc";

// ── Shared ───────────────────────────────────────────────────────────────────

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ── partnerApplications (public + applicant) ─────────────────────────────────

export interface PartnerSubmitInput {
  companyName: string;
  brandName: string;
  applicationType?:
    | "fintech_startup"
    | "bank"
    | "mfi"
    | "ngo"
    | "telecom"
    | "aggregator"
    | "enterprise"
    | "other";
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  website?: string;
  country: string;
  registrationNumber?: string;
  taxId?: string;
  businessDescription: string;
  expectedMonthlyVolume?: number;
  targetCorridors?: string[];
  requestedPlan?: "starter" | "growth" | "enterprise" | "white_label";
  hasAmlPolicy?: boolean;
  hasKycProcess?: boolean;
  isRegulated?: boolean;
}

export interface PartnerSubmitResult {
  success: boolean;
  applicationId: number;
  slug: string;
  status: string;
  /** Shown ONCE — store it safely; required to manage the application. */
  claimToken: string;
  message: string;
  trackingUrl: string;
}

export interface PartnerStatusResult {
  slug: string;
  status: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  slaSignedAt: string | null;
  additionalInfoRequested: boolean;
}

// ── partnerApplications (admin console) ──────────────────────────────────────

export interface PartnerApplicationRow {
  id: number;
  company_name: string;
  brand_name: string;
  slug: string;
  status: string;
  contact_email: string;
  contact_name: string;
  country: string;
  requested_plan: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  sla_signed_at: string | null;
  rejection_reason: string | null;
  additional_info_request: string | null;
  business_description: string | null;
  reviewer_name?: string | null;
}

export interface PartnerAdminListResult {
  applications: PartnerApplicationRow[];
  total: number;
  page: number;
  limit: number;
}

export interface PartnerApproveResult {
  success: boolean;
  tenantId: number;
  inviteCode: string;
  /** Honest delivery flag — false means the email was NOT sent. */
  emailSent: boolean;
  emailError?: string;
}

// ── agentOnboarding ──────────────────────────────────────────────────────────

export interface AgentRegistration {
  id: number;
  userId: number;
  agentCode: string;
  businessName: string;
  businessType: string;
  state: string;
  lga: string | null;
  phone: string;
  tier: string;
  status: "pending" | "approved" | "rejected";
  rejectionReason: string | null;
  approvedAt: string | null;
  createdAt: string;
}

// ── Client ───────────────────────────────────────────────────────────────────

interface PartnerClient {
  partnerApplications: {
    submit: { mutate(input: PartnerSubmitInput): Promise<PartnerSubmitResult> };
    checkStatus: {
      query(input: { slug: string }): Promise<PartnerStatusResult>;
    };
    signSla: {
      mutate(input: {
        applicationId: number;
        slaVersion?: string;
        claimToken?: string;
      }): Promise<{ success: boolean; signedAt: string }>;
    };
    provideAdditionalInfo: {
      mutate(input: {
        applicationId: number;
        response: string;
        claimToken?: string;
      }): Promise<{ success: boolean; updatedAt: string }>;
    };
    adminList: {
      query(input: {
        status?:
          | "draft"
          | "submitted"
          | "under_review"
          | "additional_info_required"
          | "approved"
          | "rejected"
          | "suspended"
          | "all";
        page?: number;
        limit?: number;
        search?: string;
      }): Promise<PartnerAdminListResult>;
    };
    adminGetDetail: {
      query(input: { id: number }): Promise<PartnerApplicationRow & { comments: any[] }>;
    };
    startReview: {
      mutate(input: { id: number }): Promise<{ success: boolean }>;
    };
    approve: {
      mutate(input: {
        id: number;
        reviewNotes?: string;
        plan?: "starter" | "growth" | "enterprise" | "white_label";
        totpCode?: string;
      }): Promise<PartnerApproveResult>;
    };
    reject: {
      mutate(input: {
        id: number;
        rejectionReason: string;
        reviewNotes?: string;
        totpCode?: string;
      }): Promise<{ success: boolean }>;
    };
  };
  agentOnboarding: {
    myStatus: { query(): Promise<AgentRegistration | null> };
    reapply: {
      mutate(): Promise<{ success: boolean; id: number; status: string }>;
    };
  };
}

export const partner: PartnerClient = trpcClient as unknown as PartnerClient;
