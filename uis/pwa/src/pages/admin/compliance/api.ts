/**
 * W17-C3 — Admin compliance console client wrapper.
 *
 * Server contract (grep-verified against audit/routers.json @ bdc-integration
 * and server source; all static-mounted, no legacy gating):
 *
 * complianceV2 (server/routers/complianceRouter.ts, mounted routers.ts:7869):
 *   travelRule.checkThreshold [q]  input { amount, currency, originatorCountry, beneficiaryCountry }
 *                                  → { required, reason, threshold: JurisdictionThreshold | null }   (:74)
 *   travelRule.submit         [m]  input { originator{firstName,lastName,dateOfBirth?,nationalId?,
 *                                  nationalIdType?,country,accountNumber}, beneficiary{firstName,
 *                                  lastName,country,accountNumber}, asset, amount, chain, txHash? }  (:83)
 *   travelRule.getThresholds  [q]  → TRAVEL_RULE_THRESHOLDS                                          (:118)
 *   travelRule.resolveVASP    [q]  input { walletAddress, chain } → VASPInfo | null                  (:120)
 *   reporting.fileCTR         [m]  input { subject{type,firstName?,lastName?,entityName?,country,
 *                                  accountNumbers[]}, transaction{id,date,amount,currency,type,
 *                                  direction}, jurisdiction } → { reportId, queueId, status }       (:128)
 *   reporting.fileSAR         [m]  input { subject{...}, transactions[], indicators[], narrative
 *                                  (min 50), jurisdiction, dateRange{from,to} }
 *                                  → { reportId, queueId, status }                                  (:163)
 *   reporting.detectStructuring [q] input { transactions[], jurisdiction } → SuspiciousIndicator[]   (:205)
 *   reporting.shouldFileCTR   [q]  input { amount, currency, jurisdiction } → boolean                (:219)
 *   reporting.getIndicators   [q]  → SUSPICIOUS_INDICATORS                                           (:227)
 *   reporting.getCTRThresholds [q] → CTR_THRESHOLDS                                                  (:228)
 *   reporting.queueSummary    [q]  → { pending, processing, retry, submitted, deadLetter }           (:230)
 *   reporting.listQueue       [q]  input { status? } → FilingQueueRow[]                              (:236)
 *   reporting.requeueDeadLetter [m ADMIN] input { queueId } → FilingQueueRow                         (:244)
 *   screening.run             [m]  input { name, dateOfBirth?, country?, transactionId? }
 *                                  → ScreeningReport                                                 (:256)
 *   screening.enableMonitoring [m] input { name, country, dateOfBirth?, riskLevel }
 *                                  → MonitoringProfile                                               (:265)
 *   screening.checkEDD        [q]  input { pepMatches[] } → { required, reason, measures[] }         (:274)
 *   screening.getLists        [q]  → SANCTIONS_LISTS                                                 (:286)
 *   dataResidency.getRegion   [q]  input { country } → DataResidencyPolicy                           (:292)
 *   dataResidency.canTransfer [q]  input { fromCountry, toRegion }
 *                                  → { allowed, mechanism?, requiresConsent, documentation }        (:296)
 *   dataResidency.submitDSAR  [m]  input { type, reason? } → DataSubjectRequest                      (:300)
 *   dataResidency.exportData  [q]  input { categories[] } → export payload                           (:313)
 *   dataResidency.validateProcessing [q] input { country, dataCategory, purpose, hasConsent }
 *                                  → legality verdict                                                (:317)
 *   dataResidency.getPolicies [q]  → DATA_RESIDENCY_POLICIES                                         (:326)
 *   dataResidency.getCategories [q] → DATA_CATEGORIES                                                (:327)
 *   audit.record              [m]  input { type, details, jurisdiction?, correlationId? }            (:333)
 *   audit.verifyIntegrity     [q]  input { events[] } → { valid, brokenAt?, verifiedCount }          (:350)
 *   audit.export              [q]  input { format, jurisdiction, dateRange{from,to} }                (:354)
 *   kyc.getTierLimits         [q]  input { tier: 0..3 } → TierLimits                                 (:372)
 *   kyc.checkLimit            [q]  input { tier, amount, dailyTotal, monthlyTotal }
 *                                  → { allowed, reason? }                                            (:376)
 *   kyc.getAllTiers           [q]  → KYC_TIER_LIMITS                                                 (:385)
 *
 * travelRule.adminList [q ADMIN] (server/routers/productionFeatures.ts:224):
 *   input { status?, search?, limit?, offset? } → { records, total }
 *
 * TOTP step-up: PBAC middleware (server/pbac.ts) reads a raw `totpCode` off
 * the wire input when a policy requires MFA and fails closed with
 * 2FA_REQUIRED. Every mutation below forwards an optional `totpCode`; zod
 * schemas that do not declare it strip it harmlessly (same convention as
 * pages/bdc/api.ts and pages/admin/kyc-review/api.ts).
 *
 * The PWA-local AppRouter contract does not declare complianceV2, so this
 * module casts the shared vanilla client to a local structural type.
 */
import { trpcClient } from "../../../services/trpc";

// ── Shared enums / row shapes (mirrors of server lib types) ────────────────

export type Jurisdiction = "CA" | "US" | "GB" | "NG" | "GH" | "KE" | "ZA";
export const JURISDICTIONS: Jurisdiction[] = ["CA", "US", "GB", "NG", "GH", "KE", "ZA"];

export type TxType = "wire" | "crypto" | "cash" | "mobile_money" | "card";
export type TxDirection = "inbound" | "outbound" | "internal";

export interface TransactionDetail {
  id: string;
  date: string;
  amount: number;
  currency: string;
  type: TxType;
  direction: TxDirection;
}

export interface FilingSubject {
  type: "individual" | "entity";
  firstName?: string;
  lastName?: string;
  entityName?: string;
  country: string;
  accountNumbers: string[];
}

export interface FilingQueuedResponse {
  reportId: string;
  queueId: number;
  status: string;
}

export type FilingQueueStatus = "pending" | "processing" | "retry" | "submitted" | "dead_letter";

export interface QueueSummary {
  pending: number;
  processing: number;
  retry: number;
  submitted: number;
  deadLetter: number;
}

/** Mirrors FilingQueueRow at server/services/regulatoryFilingQueue.ts:11. */
export interface FilingQueueRow {
  id: number;
  report_id: string;
  tenant_id: number;
  requested_by: number;
  report_type: "SAR" | "STR" | "CTR" | "LCTR";
  jurisdiction: Jurisdiction;
  payload: unknown;
  status: FilingQueueStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | Date;
  lock_token: string | null;
  locked_until: string | Date | null;
  last_attempt_at: string | Date | null;
  submitted_at: string | Date | null;
  provider_reference: string | null;
  last_http_status: number | null;
  last_error: string | null;
  requeued_by: number | null;
  requeued_at: string | Date | null;
}

export interface SuspiciousIndicator {
  code: string;
  name: string;
  description: string;
  severity?: string;
  [k: string]: unknown;
}

export interface JurisdictionThreshold {
  country: string;
  currency: string;
  threshold: number;
  regulator: string;
  notes: string;
}

// ── Screening ──────────────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical" | "prohibited";

export interface PepMatchInput {
  name: string;
  position: string;
  country: string;
  level:
    | "head_of_state"
    | "senior_official"
    | "legislature"
    | "judiciary"
    | "military"
    | "state_enterprise"
    | "family_member"
    | "close_associate";
  source: string;
}

export interface EddVerdict {
  required: boolean;
  reason: string;
  measures: string[];
}

export interface SanctionsListInfo {
  id: string;
  name: string;
  regulator: string;
  updateFrequency: string;
}

// ── Data residency ─────────────────────────────────────────────────────────

export type DataRegion =
  | "eu-west"
  | "us-east"
  | "ca-central"
  | "ng-lagos"
  | "za-johannesburg"
  | "ke-nairobi"
  | "gb-london";

export const DATA_REGIONS: DataRegion[] = [
  "eu-west",
  "us-east",
  "ca-central",
  "ng-lagos",
  "za-johannesburg",
  "ke-nairobi",
  "gb-london",
];

export interface DataResidencyPolicy {
  region: DataRegion;
  regulation: string;
  countries: string[];
  encryptionKeyId: string;
  retentionYears: number;
  crossBorderAllowed: boolean;
  crossBorderMechanism?: "SCC" | "BCR" | "adequacy_decision" | "consent" | "derogation";
}

export interface DataCategory {
  name: string;
  description: string;
  legalBasis: string;
  retentionPeriod: string;
  encryptionRequired: boolean;
  crossBorderRestricted: boolean;
}

export type DsarType = "access" | "erasure" | "rectification" | "portability" | "restriction" | "objection";

export interface CanTransferVerdict {
  allowed: boolean;
  mechanism?: string;
  requiresConsent: boolean;
  documentation: string;
}

// ── KYC tiers ──────────────────────────────────────────────────────────────

export interface TierLimits {
  tier: number;
  dailyLimit: number;
  monthlyLimit: number;
  singleTransactionLimit: number;
  maxBalance: number;
  currency: string;
  features: string[];
}

// ── travelRule.adminList rows (productionFeatures.ts:224 — SELECT trr.*) ───

export interface TravelRuleAdminRecord {
  id: number;
  userId: number;
  transaction_id: number | null;
  beneficiary_name: string;
  beneficiary_address: string | null;
  beneficiary_account: string | null;
  beneficiary_bank: string | null;
  beneficiary_bank_country: string | null;
  purpose: string | null;
  source_of_funds: string | null;
  status: string;
  submitted_at: string | Date | null;
  created_at: string | Date | null;
  user_name: string | null;
  user_email: string | null;
  [k: string]: unknown;
}

export type TravelRuleAdminStatus = "submitted" | "verified" | "rejected" | "pending";

// ── Structural client ──────────────────────────────────────────────────────

export const complianceApi = trpcClient as unknown as {
  complianceV2: {
    travelRule: {
      checkThreshold: {
        query: (i: {
          amount: number;
          currency: string;
          originatorCountry: string;
          beneficiaryCountry: string;
        }) => Promise<{ required: boolean; reason: string; threshold: JurisdictionThreshold | null }>;
      };
      submit: {
        mutate: (i: {
          originator: {
            firstName: string;
            lastName: string;
            dateOfBirth?: string;
            nationalId?: string;
            nationalIdType?: string;
            country: string;
            accountNumber: string;
          };
          beneficiary: {
            firstName: string;
            lastName: string;
            country: string;
            accountNumber: string;
          };
          asset: string;
          amount: string;
          chain: string;
          txHash?: string;
          totpCode?: string;
        }) => Promise<unknown>;
      };
      getThresholds: { query: () => Promise<JurisdictionThreshold[]> };
      resolveVASP: {
        query: (i: { walletAddress: string; chain: string }) => Promise<unknown | null>;
      };
    };
    reporting: {
      fileCTR: {
        mutate: (i: {
          subject: FilingSubject;
          transaction: TransactionDetail;
          jurisdiction: Jurisdiction;
          totpCode?: string;
        }) => Promise<FilingQueuedResponse>;
      };
      fileSAR: {
        mutate: (i: {
          subject: FilingSubject;
          transactions: TransactionDetail[];
          indicators: string[];
          narrative: string;
          jurisdiction: Jurisdiction;
          dateRange: { from: string; to: string };
          totpCode?: string;
        }) => Promise<FilingQueuedResponse>;
      };
      detectStructuring: {
        query: (i: {
          transactions: TransactionDetail[];
          jurisdiction: Jurisdiction;
        }) => Promise<SuspiciousIndicator[]>;
      };
      shouldFileCTR: {
        query: (i: { amount: number; currency: string; jurisdiction: Jurisdiction }) => Promise<boolean>;
      };
      getIndicators: { query: () => Promise<SuspiciousIndicator[]> };
      getCTRThresholds: { query: () => Promise<Record<string, { amount: number; currency: string }>> };
      queueSummary: { query: () => Promise<QueueSummary> };
      listQueue: {
        query: (i: { status?: FilingQueueStatus }) => Promise<FilingQueueRow[]>;
      };
      requeueDeadLetter: {
        mutate: (i: { queueId: number; totpCode?: string }) => Promise<FilingQueueRow>;
      };
    };
    screening: {
      run: {
        mutate: (i: {
          name: string;
          dateOfBirth?: string;
          country?: string;
          transactionId?: string;
          totpCode?: string;
        }) => Promise<unknown>;
      };
      enableMonitoring: {
        mutate: (i: {
          name: string;
          country: string;
          dateOfBirth?: string;
          riskLevel: RiskLevel;
          totpCode?: string;
        }) => Promise<unknown>;
      };
      checkEDD: {
        query: (i: { pepMatches: PepMatchInput[] }) => Promise<EddVerdict>;
      };
      getLists: { query: () => Promise<SanctionsListInfo[]> };
    };
    dataResidency: {
      getRegion: { query: (i: { country: string }) => Promise<DataResidencyPolicy> };
      canTransfer: {
        query: (i: { fromCountry: string; toRegion: DataRegion }) => Promise<CanTransferVerdict>;
      };
      submitDSAR: {
        mutate: (i: { type: DsarType; reason?: string; totpCode?: string }) => Promise<unknown>;
      };
      exportData: { query: (i: { categories: string[] }) => Promise<unknown> };
      validateProcessing: {
        query: (i: {
          country: string;
          dataCategory: string;
          purpose: string;
          hasConsent: boolean;
        }) => Promise<unknown>;
      };
      getPolicies: { query: () => Promise<DataResidencyPolicy[]> };
      getCategories: { query: () => Promise<DataCategory[]> };
    };
    audit: {
      record: {
        mutate: (i: {
          type: string;
          details: Record<string, unknown>;
          jurisdiction?: string;
          correlationId?: string;
          totpCode?: string;
        }) => Promise<unknown>;
      };
      verifyIntegrity: {
        query: (i: { events: unknown[] }) => Promise<{
          valid: boolean;
          brokenAt?: string;
          verifiedCount: number;
        }>;
      };
      export: {
        query: (i: {
          format: "json" | "csv" | "xml";
          jurisdiction: string;
          dateRange: { from: string; to: string };
        }) => Promise<unknown>;
      };
    };
    kyc: {
      getTierLimits: { query: (i: { tier: number }) => Promise<TierLimits> };
      checkLimit: {
        query: (i: {
          tier: number;
          amount: number;
          dailyTotal: number;
          monthlyTotal: number;
        }) => Promise<{ allowed: boolean; reason?: string }>;
      };
      getAllTiers: { query: () => Promise<TierLimits[]> };
    };
  };
  travelRule: {
    adminList: {
      query: (i: {
        status?: TravelRuleAdminStatus;
        search?: string;
        limit?: number;
        offset?: number;
      }) => Promise<{ records: TravelRuleAdminRecord[]; total: number }>;
    };
  };
};

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
