/**
 * W17-C3 — User-facing travel rule / TRISA client wrapper.
 *
 * Server contract (grep-verified against audit/routers.json @ bdc-integration
 * and server source; all static-mounted, no legacy gating):
 *
 * travelRule (server/routers/productionFeatures.ts, mounted routers.ts:7466):
 *   requirements [q]  input { amount: number (positive, ≤10_000_000), fromCurrency,
 *                     toCurrency, toCountry } → { required, threshold, reason,
 *                     requiredFields[], isHighRisk, regulatoryBasis }            (:151)
 *   submit       [m]  input { transactionId?: number, beneficiaryFullName (min 2),
 *                     beneficiaryAddress (min 5), beneficiaryAccountNumber (min 4),
 *                     beneficiaryBankName (min 2), beneficiaryBankCountry (len 2),
 *                     purposeOfTransfer (min 3), sourceOfFunds? }
 *                     → { success, verified, status, message }                   (:180)
 *   myRecords    [q]  input { limit? (default 20), offset? (default 0) }
 *                     → { records: travel_rule_records rows, total }             (:210)
 *   (adminList is ADMIN-only → wired in pages/admin/compliance, not here.)
 *
 * trisa (server/routers/trisaCompliance.ts, mounted routers.ts:7766):
 *   sendVASP      [m] input trisaRecordSchema { transactionId, originatorName
 *                     (1..140), originatorAccount (1..34), originatorAddress?,
 *                     originatorDob?, originatorNationalId?, beneficiaryName
 *                     (1..140), beneficiaryAccount (1..34), beneficiaryAddress?,
 *                     amount (positive, ≤10_000_000), currency (len 3), vaspDid,
 *                     vaspName (1..200), vaspJurisdiction (len 2) }
 *                     → { required, recordId?, status?, envelope?, vaspInfo?,
 *                     message }                                                  (:53)
 *   myRecords     [q] input { page? (min 1, default 1), limit? (1..100, default 20) }
 *                     → { records, total, page }                                 (:184)
 *   pendingReview [q] → { records, total }  (server-enforced admin role)         (:216)
 *   approve       [m] input { recordId, notes? (max 500) }
 *                     → { success, verified, recordId, status, reviewedBy }
 *                     (server-enforced admin role)                               (:244)
 *   vaspDirectory [q] input { query: string (min 1) } → { vasps, total }         (:277)
 *   (receiveVASP handles inbound counterparty envelopes — not a user UI surface.)
 *
 * Honesty note: trisa.myRecords / trisa.pendingReview fall back to static
 * sample rows server-side when the DB table is unavailable (the server marks
 * this with `catch { table may not exist }`). This client renders exactly
 * what the server returns and never invents rows of its own; empty lists and
 * errors surface honestly.
 *
 * TOTP step-up: every mutation below forwards an optional `totpCode` (raw
 * input field consumed pre-zod by the PBAC middleware, server/pbac.ts);
 * the server fails closed with 2FA_REQUIRED when MFA is required. Zod schemas
 * that do not declare `totpCode` strip it harmlessly.
 *
 * The PWA-local AppRouter contract does not declare travelRule/trisa, so this
 * module casts the shared vanilla client to a local structural type — the same
 * convention as pages/bdc/api.ts and pages/admin/kyc-review/api.ts.
 */
import { trpcClient } from "../../services/trpc";

export interface TravelRuleRequirementField {
  field: string;
  label: string;
  required: boolean;
}

export interface TravelRuleRequirements {
  required: boolean;
  threshold: number;
  reason: string | null;
  requiredFields: TravelRuleRequirementField[];
  isHighRisk: boolean;
  regulatoryBasis: string;
}

/** Row shape of travel_rule_records (SELECT * — snake_case columns). */
export interface TravelRuleRecord {
  id: number;
  userId?: number;
  transaction_id?: number | null;
  beneficiary_name?: string;
  beneficiary_address?: string | null;
  beneficiary_account?: string | null;
  beneficiary_bank?: string | null;
  beneficiary_bank_country?: string | null;
  purpose?: string | null;
  source_of_funds?: string | null;
  status?: string;
  submitted_at?: string | Date | null;
  created_at?: string | Date | null;
  [k: string]: unknown;
}

export interface TrisaVaspInfo {
  did: string;
  name: string;
  jurisdiction: string;
  endpoint: string;
  trisa: boolean;
}

export interface TrisaRecord {
  id: string;
  transaction_id?: string;
  transactionId?: string;
  originator_name?: string;
  originatorName?: string;
  beneficiary_name?: string;
  beneficiaryName?: string;
  amount: number;
  currency: string;
  vasp_did?: string;
  vaspDid?: string;
  vasp_name?: string;
  vaspName?: string;
  status: string;
  created_at?: string | Date;
  createdAt?: string | Date;
  [k: string]: unknown;
}

export const travelRuleApi = trpcClient as unknown as {
  travelRule: {
    requirements: {
      query: (i: {
        amount: number;
        fromCurrency: string;
        toCurrency: string;
        toCountry: string;
      }) => Promise<TravelRuleRequirements>;
    };
    submit: {
      mutate: (i: {
        transactionId?: number;
        beneficiaryFullName: string;
        beneficiaryAddress: string;
        beneficiaryAccountNumber: string;
        beneficiaryBankName: string;
        beneficiaryBankCountry: string;
        purposeOfTransfer: string;
        sourceOfFunds?: string;
        totpCode?: string;
      }) => Promise<{ success: boolean; verified: boolean; status: string; message: string }>;
    };
    myRecords: {
      query: (i?: { limit?: number; offset?: number }) => Promise<{
        records: TravelRuleRecord[];
        total: number;
      }>;
    };
  };
  trisa: {
    sendVASP: {
      mutate: (i: {
        transactionId: string;
        originatorName: string;
        originatorAccount: string;
        originatorAddress?: string;
        originatorDob?: string;
        originatorNationalId?: string;
        beneficiaryName: string;
        beneficiaryAccount: string;
        beneficiaryAddress?: string;
        amount: number;
        currency: string;
        vaspDid: string;
        vaspName: string;
        vaspJurisdiction: string;
        totpCode?: string;
      }) => Promise<{
        required: boolean;
        recordId?: string;
        status?: string;
        envelope?: unknown;
        vaspInfo?: unknown;
        message: string;
      }>;
    };
    myRecords: {
      query: (i?: { page?: number; limit?: number }) => Promise<{
        records: TrisaRecord[];
        total: number;
        page: number;
      }>;
    };
    pendingReview: {
      query: () => Promise<{ records: TrisaRecord[]; total: number }>;
    };
    approve: {
      mutate: (i: { recordId: string; notes?: string; totpCode?: string }) => Promise<{
        success: boolean;
        verified: boolean;
        recordId: string;
        status: string;
        reviewedBy: number;
      }>;
    };
    vaspDirectory: {
      query: (i: { query: string }) => Promise<{ vasps: TrisaVaspInfo[]; total: number }>;
    };
  };
};

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
