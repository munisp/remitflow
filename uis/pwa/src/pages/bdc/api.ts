/**
 * BDC console — typed client wrapper over the PWA tRPC client.
 *
 * The server exposes the `bdc.*` namespace (server/routers/bdc/*, per
 * SPEC-bdc.md §3). The PWA-local AppRouter contract (types/appRouter.ts) does
 * not mirror `bdc` yet (that file is outside F1's editable scope), so this
 * module casts the shared client to a local structural type — the same
 * "pages cast to their own interfaces" convention used by OperationsMap.
 *
 * Money values are decimal strings (numeric(18,2)) — display with 2dp via
 * fmtMoney. Dates are ISO strings. Field names mirror the SPEC §3 contracts.
 */
import { trpcClient } from "../../services/trpc";

// ── Shared constants (SPEC §3.1) ─────────────────────────────────────────────

export const PURPOSE_CODES = [
  "PTA",
  "BTA",
  "SCHOOL_FEES",
  "MEDICAL",
  "EXAM_FEES",
  "SUBSCRIPTION",
  "NONRESIDENT_REPATRIATION",
] as const;
export type PurposeCode = (typeof PURPOSE_CODES)[number];

/** SoF declaration trigger: fxAmount >= $10,000. */
export const SOF_THRESHOLD_USD = 10_000;
/** Cash payment cap: cash only if amount <= $500. */
export const CASH_CAP_USD = 500;
/** Cash disbursement portion of any FX sale must be <= 25%. */
export const CASH_PORTION_MAX_PCT = 25;
/** NFEM weekly entitlement cap ($150k) and liquidation window. */
export const NFEM_WEEKLY_CAP_USD = 150_000;
export const NFEM_LIQUIDATION_HOURS = 24;
/** Position caps (SPEC §2 bdc_operator_profiles defaults). */
export const NOP_CAP_PCT = 30;
export const BORROWING_CAP_PCT = 50;

// ── Display helpers ──────────────────────────────────────────────────────────

/** Format a decimal-string money value with 2dp. */
export function fmtMoney(
  value: string | number | null | undefined,
  currency?: string,
): string {
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) {
    return "—";
  }
  const body = n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${body}` : body;
}

/** Parse a decimal-string money value to a Number for threshold checks. */
export function moneyNum(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Milliseconds remaining until an ISO deadline (negative when elapsed). */
export function msUntil(deadlineAt: string | Date | null | undefined): number {
  if (!deadlineAt) return Number.NaN;
  return new Date(deadlineAt).getTime() - Date.now();
}

export function fmtCountdown(deadlineAt: string | Date | null | undefined): string {
  const ms = msUntil(deadlineAt);
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "EXPIRED";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

/** Extract a human-readable message from a tRPC/server error. */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

// ── Procedure shapes (SPEC §3) ───────────────────────────────────────────────

type Query<I, O> = { query: (input: I) => Promise<O> };
type Mutation<I, O> = { mutate: (input: I) => Promise<O> };

type Json = Record<string, unknown> | unknown[] | unknown;

export interface DenominationItem {
  currency?: string;
  denominationMinor: string;
  noteCount: number;
}

export interface BdcBranch {
  id: number;
  code: string;
  name: string;
  address?: string | null;
  stateCode?: string | null;
  isHeadOffice?: boolean;
  status: string;
  createdAt?: string;
}

export interface BdcQuote {
  id: number;
  branchId?: number | null;
  currency: string;
  side: "buy" | "sell";
  rateMinor: string;
  referenceRateMinor?: string;
  status: string;
  makerId: number;
  checkerId?: number | null;
  publishedAt?: string | null;
  expiresAt?: string | null;
}

export interface BoardRow {
  currency: string;
  buy?: BdcQuote | null;
  sell?: BdcQuote | null;
  publishedAt?: string | null;
  expiresAt?: string | null;
}

export interface BdcTransaction {
  id: number;
  branchId: number;
  txnType: string;
  currency: string;
  fxAmountMinor: string;
  nairaAmountMinor: string;
  rateMinor: string;
  purposeCode?: string | null;
  evidenceRefs?: string[];
  customerId?: number | null;
  paymentLeg?: { method: string; reference: string | null };
  cashPortionMinor?: string;
  idempotencyKey?: string;
  status: string;
  makerId?: number;
  checkerId?: number | null;
  failureReason?: string | null;
  createdAt?: string;
}

export interface EntitlementRow {
  id: number;
  bankCode: string;
  weekStart: string;
  capUsdMinor: string;
  usedUsdMinor: string;
  remainingUsdMinor?: string;
}

export interface NfemBatch {
  id: number;
  entitlementId?: number;
  amountUsdMinor: string;
  rateMinor: string;
  nairaPaidMinor?: string;
  fxbtReference?: string | null;
  status: string;
  purchasedAt?: string | null;
  deadlineAt?: string | null;
  liquidatedAt?: string | null;
}

export interface PositionNow {
  nopUsdMinor: string;
  nopPct: string | number;
  borrowingMinor: string;
  borrowingPct: string | number;
  breaches: string[];
  asOf?: string;
}

export interface StockRow {
  id?: number;
  locationType: string;
  locationId: number;
  currency: string;
  denominationMinor: string;
  noteCount: number;
  version?: number;
  updatedAt?: string;
}

export interface CitManifest {
  id: number;
  fromLocation: Json;
  toLocation: Json;
  items: DenominationItem[];
  custodianAId: number;
  custodianBId?: number | null;
  status: string;
  dispatchedAt?: string | null;
  deliveredAt?: string | null;
}

export interface SofDeclaration {
  id: number;
  customerId: number;
  transactionId?: number | null;
  amountUsdMinor: string;
  sourceDescription?: string | null;
  documentRefs?: string[];
  status: string;
  reviewedBy?: number | null;
  reviewedAt?: string | null;
  createdAt?: string;
}

export interface RegulatoryReturn {
  id: number;
  returnType: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  submittedAt?: string | null;
  ackRef?: string | null;
  ackAt?: string | null;
  errorDetail?: string | null;
}

export interface PayoutQuoteResult {
  nairaAmountMinor: string;
  commissionMinor: string;
  quoteId: string;
  expiresAt: string;
}

export interface BdcClient {
  operator: {
    getProfile: Query<Record<string, never>, Json>;
    upsertProfile: Mutation<Json, Json>;
    registerBranch: Mutation<Json, Json>;
    updateBranchStatus: Mutation<{ branchId: number; status: string; totpCode: string }, Json>;
    listBranches: Query<{ status?: string; stateCode?: string }, BdcBranch[]>;
    registerFranchisee: Mutation<Json, Json>;
    listFranchisees: Query<Record<string, never>, Json[]>;
  };
  rates: {
    setBand: Mutation<{ currency: string; bandBps: number; totpCode: string }, Json>;
    createQuote: Mutation<
      { branchId?: number; currency: string; side: "buy" | "sell"; rateMinor: string },
      BdcQuote
    >;
    publishQuote: Mutation<{ quoteId: number; totpCode: string }, BdcQuote>;
    expireStale: Mutation<Record<string, never>, Json>;
    currentBoard: Query<{ branchId?: number }, BoardRow[] | { rows: BoardRow[] }>;
    crossQuote: Query<{ fromCcy: string; toCcy: string }, Json>;
  };
  sales: {
    buyFx: Mutation<Json, Json>;
    sellFx: Mutation<Json, Json>;
    confirmNairaLeg: Mutation<{ transactionId: number; totpCode: string }, Json>;
    reverseTransaction: Mutation<{ transactionId: number; totpCode: string }, Json>;
    getTransaction: Query<{ id: number }, BdcTransaction>;
    listTransactions: Query<
      {
        branchId?: number;
        txnType?: string;
        status?: string;
        from?: string;
        to?: string;
        cursor?: string;
        limit?: number;
      },
      BdcTransaction[] | { items: BdcTransaction[]; nextCursor?: string | null }
    >;
  };
  sourcing: {
    requestNfemPurchase: Mutation<
      { bankCode: string; amountUsdMinor: string; rateMinor: string; totpCode: string },
      NfemBatch
    >;
    confirmNfemFunding: Mutation<{ batchId: number; totpCode: string }, NfemBatch>;
    markBatchLiquidated: Mutation<{ batchId: number; totpCode: string }, NfemBatch>;
    markBatchReturned: Mutation<{ batchId: number; totpCode: string }, NfemBatch>;
    entitlementStatus: Query<{ bankCode?: string }, EntitlementRow[] | { rows: EntitlementRow[] }>;
    positionNow: Query<Record<string, never>, PositionNow>;
    eodClose: Mutation<{ totpCode: string }, { breaches?: string[] } & Json>;
  };
  vault: {
    getStock: Query<{ locationType: string; locationId: number }, StockRow[] | { rows: StockRow[]; totals?: Json }>;
    adjustStock: Mutation<Json, Json>;
    transferStock: Mutation<
      { from: Json; to: Json; items: DenominationItem[] },
      CitManifest
    >;
    confirmDelivery: Mutation<{ manifestId: number; totpCode: string }, CitManifest>;
    reportCounterfeit: Mutation<Json, Json>;
    insuranceValue: Query<Record<string, never>, Json>;
  };
  compliance: {
    submitSofDeclaration: Mutation<Json, SofDeclaration>;
    reviewSofDeclaration: Mutation<
      { declarationId: number; decision: "approved" | "rejected"; reason?: string; totpCode: string },
      SofDeclaration
    >;
    screenCustomer: Mutation<{ customerId: number }, Json>;
    fileStr: Mutation<{ transactionId: number; reason: string; totpCode: string }, Json>;
    ctrCheck: Query<{ amountUsdMinor: string; currency?: string }, { requiresCtr: boolean; threshold: string }>;
  };
  reporting: {
    buildReturn: Mutation<{ returnType: string; periodStart: string; periodEnd: string }, RegulatoryReturn>;
    submitReturn: Mutation<{ returnId: number; totpCode: string }, RegulatoryReturn>;
    ackReturn: Mutation<{ returnId: number; ackRef: string }, RegulatoryReturn>;
    listReturns: Query<{ status?: string; returnType?: string }, RegulatoryReturn[] | { items: RegulatoryReturn[] }>;
    getReturn: Query<{ id: number }, RegulatoryReturn>;
    retryQuarantined: Mutation<{ returnId: number }, RegulatoryReturn>;
    evidencePack: Query<{ customerId?: number; periodStart?: string; periodEnd?: string }, Json>;
  };
  imto: {
    payoutQuote: Mutation<{ imtoCode: string; reference: string }, PayoutQuoteResult>;
    executePayout: Mutation<{ quoteId: string; totpCode: string }, Json>;
    settlementStatement: Mutation<{ imtoCode: string; periodStart: string; periodEnd: string }, Json>;
    reconcileSettlements: Query<{ imtoCode: string; periodStart?: string; periodEnd?: string }, Json>;
  };
}

/**
 * The bdc namespace on the shared tRPC client. The cast is local to this
 * module; all BDC pages import `bdc` from here so the contract lives in one
 * place (mirrors the types/appRouter.ts drift-risk convention).
 */
export const bdc: BdcClient = (trpcClient as unknown as { bdc: BdcClient }).bdc;

/** Normalize list-shaped responses that may be arrays or { items } / { rows }. */
export function asList<T>(res: T[] | { items?: T[]; rows?: T[] } | null | undefined): T[] {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  return res.items ?? res.rows ?? [];
}
