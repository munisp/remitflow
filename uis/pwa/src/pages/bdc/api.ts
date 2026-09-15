/**
 * BDC console — typed client wrapper over the PWA tRPC client.
 *
 * The server exposes the `bdc.*` namespace (server/routers.ts →
 * server/routers/bdc/index.ts: operator, rates, sales, sourcing, vault,
 * compliance, reporting, imto). The PWA-local AppRouter contract
 * (types/appRouter.ts) does not mirror `bdc` yet, so this module casts the
 * shared client to a local structural type — the same "pages cast to their
 * own interfaces" convention used by OperationsMap.
 *
 * CONTRACT SOURCE OF TRUTH: the zod `.input(...)` schemas in
 * server/routers/bdc/*.ts. Every request-body interface below mirrors its
 * router schema exactly — field names, required vs optional, enums.
 *
 * Money values are numeric(18,2) MAJOR units. On the wire they are decimal
 * strings (e.g. "12500.00"); several schemas (sales.buyFx/sellFx,
 * sourcing.requestNfemPurchase) also accept positive numbers. There are NO
 * *Minor fields anywhere in the BDC contract. Display with 2dp via fmtMoney.
 * Dates are ISO strings; reporting period fields are "YYYY-MM-DD".
 *
 * Idempotency: schemas that require `idempotencyKey` (sales.buyFx,
 * sales.sellFx, sourcing.requestNfemPurchase) must be given a fresh
 * `crypto.randomUUID()` per user action (see newIdempotencyKey()).
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

/**
 * Fresh idempotency key for money-moving mutations whose schema requires one
 * (sales.buyFx / sales.sellFx / sourcing.requestNfemPurchase). UUIDv4 is
 * 36 chars — inside the server's min(8)/max(64) bounds. Generate ONCE per
 * user action so a retried submit replays idempotently.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

// ── Display helpers ──────────────────────────────────────────────────────────

/** Format a major-unit money value (decimal string or number) with 2dp. */
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

/** Parse a major-unit money value to a Number for threshold checks. */
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

// ── Procedure shapes ─────────────────────────────────────────────────────────

type Query<I, O> = { query: (input: I) => Promise<O> };
type Mutation<I, O> = { mutate: (input: I) => Promise<O> };

type Json = Record<string, unknown> | unknown[] | unknown;

// ── Shared input atoms (mirror server/routers/bdc/* zod atoms) ──────────────

/** numeric(18,2) major-unit amount — decimal string ("12500.00"). */
type MoneyString = string;
/** Schemas declared as z.union([z.number().positive(), z.string()]) accept either. */
type MoneyInput = number | string;
/** "YYYY-MM-DD" (reporting dateSchema). */
type DateString = string;
/** "YYYY-MM" (imto settlement period). */
type PeriodString = string;

type VaultLocationType = "vault" | "drawer" | "cit";

/** vault.ts locationRefSchema. */
export interface LocationRef {
  locationType: VaultLocationType;
  locationId: number;
}

/**
 * Denomination breakdown row. `currency` is present only where the server
 * schema carries it (vault itemSchema); sales/imto denomination schemas are
 * { denomination, noteCount } only. `denomination` is a MAJOR-unit face value
 * per note (e.g. "100.00") — there is no denominationMinor.
 */
export interface DenominationItem {
  currency?: string;
  denomination: MoneyInput;
  noteCount: number;
}

// ── Response row types (drizzle numeric columns deserialize as strings) ─────

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
  /** naira per 1 unit of `currency`, numeric(18,2) major units. */
  rate: MoneyString;
  referenceRate?: MoneyString | null;
  status: string;
  makerId: number;
  checkerId?: number | null;
  publishedAt?: string | null;
  expiresAt?: string | null;
}

/** rates.currentBoard row: { currency, buy, sell } (rates.ts). */
export interface BoardRow {
  currency: string;
  buy?: BdcQuote | null;
  sell?: BdcQuote | null;
}

export interface BdcTransaction {
  id: number;
  branchId: number;
  txnType: string;
  currency: string;
  /** FX amount, numeric(18,2) major units. */
  fxAmount: MoneyString;
  /** Naira countervalue, numeric(18,2) major units. */
  nairaAmount: MoneyString;
  /** Dealt rate (naira per 1 FX unit), numeric(18,2). */
  rate: MoneyString;
  purposeCode?: string | null;
  evidenceRefs?: string[];
  customerId?: number | null;
  paymentLeg?: { method: string; reference: string | null } & Record<string, unknown>;
  /** Cash portion of the deal, numeric(18,2) major units. */
  cashPortion?: MoneyString;
  idempotencyKey?: string;
  status: string;
  makerId?: number;
  checkerId?: number | null;
  failureReason?: string | null;
  createdAt?: string;
}

/** sourcing.entitlementStatus row (bdc_nfem_entitlements + remainingUsd). */
export interface EntitlementRow {
  id: number;
  bankCode: string | null;
  weekStart: string;
  capUsd: MoneyString;
  usedUsd: MoneyString;
  remainingUsd: MoneyString;
}

/** sourcing.entitlementStatus response envelope. */
export interface EntitlementStatus {
  weekStart: string;
  rows: EntitlementRow[];
}

/** bdc_nfem_purchase_batches row. */
export interface NfemBatch {
  id: number;
  entitlementId?: number | null;
  amountUsd: MoneyString;
  rate: MoneyString;
  nairaPaid?: MoneyString;
  fxbtReference?: string | null;
  status: string;
  purchasedAt?: string | null;
  deadlineAt?: string | null;
  liquidatedAt?: string | null;
}

/** sourcing.positionNow response (major units; server converts internally). */
export interface PositionNow {
  nopUsd: MoneyString;
  nopPct: string | number;
  borrowingUsd: MoneyString;
  borrowingPct: string | number;
  breaches: string[];
  perCurrency?: Json;
  stalenessLabel?: string;
  rateStale?: boolean;
}

/** vault.getStock inventory row. */
export interface StockRow {
  id?: number;
  locationType: string;
  locationId: number;
  currency: string;
  /** Face value per note, numeric(18,2) major units. */
  denomination: MoneyString;
  noteCount: number;
  version?: number;
  updatedAt?: string;
}

/** vault.getStock response envelope. */
export interface StockResponse {
  rows: StockRow[];
  totals: Array<{ currency: string; noteCount: number; totalCents: number }>;
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
  amountUsd: MoneyString;
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

/** compliance.ctrCheck response. */
export interface CtrCheckResult {
  requiresCtr: boolean;
  reason?: "amount_threshold" | "structuring_pattern" | null;
  threshold: string | number;
}

/** imto.payoutQuote response — includes the HMAC-signed quote envelope that
 *  executePayout consumes verbatim. */
export interface PayoutQuoteResult {
  quoteId: string;
  expiresAt: string;
  /** Gross naira value of the FX amount, major units. */
  nairaAmount: MoneyString;
  /** Naira commission deducted from the payout, major units. */
  commission: MoneyString;
  /** Cash to recipient (nairaAmount − commission), major units. */
  payoutAmount: MoneyString;
  rate: MoneyString;
  payeeFspId: string;
  /** Signed quote — pass back to executePayout untouched. */
  quote: { payload: unknown; signature: string };
}

/** sales.buyFx / sellFx / confirmNairaLeg / reverseTransaction result. */
export interface TxnActionResult {
  status: string;
  transactionId?: number;
  declarationId?: number;
  message?: string;
  tbTransferIds?: Json;
}

// ── Client contract (one entry per server procedure) ────────────────────────

export interface BdcClient {
  operator: {
    /** No input. */
    getProfile: Query<Record<string, never>, Json>;
    upsertProfile: Mutation<
      {
        tier?: "tier_1" | "tier_2";
        licenseNo?: string;
        stateCode?: string;
        shareholdersFunds?: MoneyString;
        nopLimitPct?: number;
        borrowingLimitPct?: number;
        weeklyNfemEntitlementUsd?: MoneyString;
        licenseStatus?: "pending" | "aip" | "provisional" | "active" | "suspended";
        paDeadlineAt?: string | Date;
        totpCode?: string;
      },
      Json
    >;
    registerBranch: Mutation<
      {
        code: string;
        name: string;
        address?: string;
        stateCode: string;
        lat: number;
        lng: number;
        isHeadOffice?: boolean;
      },
      Json
    >;
    updateBranchStatus: Mutation<
      { branchId: number; status: "active" | "suspended" | "closed"; totpCode?: string },
      Json
    >;
    listBranches: Query<
      { status?: "pending" | "active" | "suspended" | "closed"; stateCode?: string },
      BdcBranch[]
    >;
    registerFranchisee: Mutation<
      {
        name: string;
        licenseRef?: string;
        stateCode: string;
        lat: number;
        lng: number;
        royaltyBps?: number;
        airportExempt?: boolean;
      },
      Json
    >;
    listFranchisees: Query<
      { status?: "pending" | "active" | "suspended" | "closed"; stateCode?: string },
      Json[]
    >;
  };
  rates: {
    setBand: Mutation<{ currency: string; bandBps: number; totpCode?: string }, Json>;
    createQuote: Mutation<
      { branchId?: number; currency: string; side: "buy" | "sell"; rate: MoneyString },
      BdcQuote
    >;
    publishQuote: Mutation<{ quoteId: number; totpCode?: string }, BdcQuote>;
    /** No input. */
    expireStale: Mutation<Record<string, never>, Json>;
    currentBoard: Query<{ branchId?: number }, BoardRow[]>;
    crossQuote: Query<{ fromCcy: string; toCcy: string }, Json>;
    listBands: Query<{ includeInactive?: boolean }, Json>;
    listQuotes: Query<
      {
        status?: "draft" | "published" | "expired" | "suspended";
        currency?: string;
        cursor?: number;
        limit?: number;
      },
      { items: BdcQuote[]; nextCursor: number | null } | Json
    >;
  };
  sales: {
    buyFx: Mutation<
      {
        branchId: number;
        customerId: number;
        currency: string;
        fxAmount: MoneyInput;
        denominations: Array<{ denomination: MoneyInput; noteCount: number }>;
        paymentMethod: "cash" | "nip_transfer" | "prepaid_card";
        paymentReference?: string | null;
        idempotencyKey: string;
        totpCode?: string;
        sofSourceDescription?: string;
        sofDocumentRefs?: string[];
      },
      TxnActionResult
    >;
    sellFx: Mutation<
      {
        branchId: number;
        customerId: number;
        currency: string;
        fxAmount: MoneyInput;
        purposeCode: string;
        evidenceRefs: string[];
        nipReference: string;
        cashPortion?: MoneyInput;
        disbursementMethod: "prepaid_card" | "domiciliary";
        disbursementReference?: string | null;
        denominations?: Array<{ denomination: MoneyInput; noteCount: number }>;
        idempotencyKey: string;
        totpCode?: string;
      },
      TxnActionResult
    >;
    confirmNairaLeg: Mutation<
      { transactionId: number; confirmationReference?: string; totpCode?: string },
      TxnActionResult
    >;
    reverseTransaction: Mutation<
      { transactionId: number; reason: string; totpCode?: string },
      TxnActionResult
    >;
    getTransaction: Query<{ transactionId: number }, BdcTransaction>;
    listTransactions: Query<
      {
        branchId?: number;
        txnType?: "buy_fx" | "sell_fx" | "imto_payout" | "nfem_purchase" | "nfem_return";
        status?: "pending" | "posted" | "settled" | "failed" | "reversed";
        dateFrom?: string | Date;
        dateTo?: string | Date;
        cursor?: number;
        limit?: number;
      },
      { items: BdcTransaction[]; nextCursor: number | null }
    >;
  };
  sourcing: {
    requestNfemPurchase: Mutation<
      {
        bankCode: string;
        amountUsd: MoneyInput;
        rate: MoneyInput;
        idempotencyKey: string;
        totpCode?: string;
      },
      NfemBatch
    >;
    confirmNfemFunding: Mutation<
      { batchId: number; fxbtReference?: string; totpCode?: string },
      NfemBatch
    >;
    markBatchLiquidated: Mutation<{ batchId: number; totpCode?: string }, NfemBatch>;
    markBatchReturned: Mutation<
      { batchId: number; nairaReturnReference: string; totpCode?: string },
      NfemBatch
    >;
    entitlementStatus: Query<{ bankCode?: string }, EntitlementStatus>;
    positionNow: Query<Record<string, never>, PositionNow>;
    eodClose: Mutation<{ totpCode?: string }, { breaches?: string[] } & Json>;
    listBatches: Query<
      {
        status?: "requested" | "funded" | "selling" | "liquidated" | "returned" | "expired";
        cursor?: number;
        limit?: number;
      },
      { items: NfemBatch[]; nextCursor: number | null } | Json
    >;
  };
  vault: {
    getStock: Query<
      { locationType: VaultLocationType; locationId: number },
      StockResponse
    >;
    adjustStock: Mutation<
      {
        location: LocationRef;
        currency: string;
        denomination: MoneyString;
        noteCount: number;
        expectedVersion?: number;
        reason: string;
        totpCode?: string;
      },
      Json
    >;
    transferStock: Mutation<
      {
        from: LocationRef;
        to: LocationRef;
        items: Array<{ currency: string; denomination: MoneyString; noteCount: number }>;
        custodianBId: number;
        note?: string;
      },
      CitManifest
    >;
    confirmDelivery: Mutation<
      { manifestId: number; recount: DenominationItem[]; totpCode?: string },
      CitManifest
    >;
    reportCounterfeit: Mutation<
      {
        branchId: number;
        location: LocationRef;
        currency: string;
        denomination: MoneyString;
        noteSerial?: string;
        noteCount?: number;
        notes?: string;
      },
      Json
    >;
    /** Input optional ({}) — call with {}. */
    insuranceValue: Query<Record<string, never>, Json>;
  };
  compliance: {
    submitSofDeclaration: Mutation<
      {
        customerId: number;
        transactionId?: number;
        amountUsd: MoneyString;
        sourceDescription: string;
        documentRefs?: string[];
      },
      SofDeclaration
    >;
    reviewSofDeclaration: Mutation<
      {
        declarationId: number;
        decision: "approved" | "rejected";
        reason: string;
        totpCode?: string;
      },
      SofDeclaration
    >;
    screenCustomer: Mutation<{ customerId: number }, Json>;
    fileStr: Mutation<
      {
        transactionId: number;
        suspicionReason: string;
        riskLevel: "low" | "medium" | "high" | "critical";
        narrative: string;
        filingOfficer: string;
        totpCode?: string;
      },
      Json
    >;
    ctrCheck: Query<
      { customerId?: number; amount: MoneyString; currency: string },
      CtrCheckResult
    >;
    listSofDeclarations: Query<
      {
        status?: "submitted" | "approved" | "rejected";
        customerId?: number;
        cursor?: number;
        limit?: number;
      },
      { items: SofDeclaration[]; nextCursor: number | null } | Json
    >;
    listStrs: Query<
      { cursor?: number; limit?: number },
      Json
    >;
  };
  reporting: {
    buildReturn: Mutation<
      {
        returnType: "fifx" | "fina" | "carp" | "trms" | "extranet";
        periodStart: DateString;
        periodEnd: DateString;
      },
      RegulatoryReturn
    >;
    submitReturn: Mutation<{ returnId: number; totpCode?: string }, RegulatoryReturn>;
    ackReturn: Mutation<{ returnId: number; ackRef?: string; error?: string }, RegulatoryReturn>;
    listReturns: Query<
      {
        returnType?: "fifx" | "fina" | "carp" | "trms" | "extranet";
        status?: "draft" | "staged" | "submitted" | "acknowledged" | "quarantined" | "failed";
        limit?: number;
        cursor?: number;
      },
      { items: RegulatoryReturn[]; nextCursor: number | null }
    >;
    getReturn: Query<{ returnId: number }, RegulatoryReturn>;
    retryQuarantined: Mutation<{ returnId: number }, RegulatoryReturn>;
    /** Mutation (not a query) — builds the pack on demand. */
    evidencePack: Mutation<{ returnId: number }, Json>;
  };
  imto: {
    payoutQuote: Mutation<
      { imtoCode: string; reference: string; fxAmount: MoneyString; currency?: string },
      PayoutQuoteResult
    >;
    executePayout: Mutation<
      {
        quote: { payload: unknown; signature: string };
        totpCode?: string;
        branchId: number;
        customerId?: number;
        paymentLeg: {
          method: "cash" | "nip_transfer" | "prepaid_card" | "domiciliary";
          reference: string | null;
        };
        denominations?: Array<{ denomination: MoneyString; noteCount: number }>;
      },
      Json
    >;
    settlementStatement: Mutation<{ imtoCode: string; period: PeriodString }, Json>;
    reconcileSettlements: Query<{ imtoCode: string; period: PeriodString }, Json>;
  };
  // ── Wave-12 sub-routers (SPEC-wave12 §4) ──
  reversals: {
    requestReversal: Mutation<
      { transactionId: number; reason: string; totpCode?: string },
      ReversalRequestResult
    >;
    approveReversal: Mutation<
      { reversalId: number; totpCode?: string },
      ReversalExecutionResult
    >;
    listReversals: Query<
      { status?: ReversalStatus; cursor?: number; limit?: number },
      { items: BdcReversal[]; nextCursor: number | null }
    >;
    getReversal: Query<{ reversalId: number }, BdcReversal>;
  };
  rescreening: {
    runRescreening: Mutation<
      { tenantId?: number; totpCode?: string },
      RescreeningRunStarted
    >;
    listRescreeningResults: Query<
      {
        customerId?: number;
        verdict?: "clear" | "match" | "error";
        blockedOnly?: boolean;
        cursor?: number;
        limit?: number;
      },
      { results: RescreeningResultRow[]; nextCursor: number | null }
    >;
    getCustomerScreeningStatus: Query<{ customerId: number }, CustomerScreeningStatus>;
  };
  offboarding: {
    requestOffboarding: Mutation<
      { tenantId: number; totpCode?: string },
      { offboardingId: number; tenantId: number; status: "requested"; workflowStarted: boolean }
    >;
    getOffboardingStatus: Query<
      { tenantId: number },
      { tenantId: number; offboarding: BdcOffboardingRecord | null; offboarded: boolean }
    >;
    cancelOffboarding: Mutation<
      { tenantId: number; totpCode?: string },
      { tenantId: number; cancelled: true; previousStatus: string }
    >;
  };
  pickup: {
    authorizePickup: Mutation<
      {
        customerId: number;
        agentFullName: string;
        agentIdType: PickupAgentIdType;
        agentIdNumber: string;
        relationship: string;
        /** Major-unit decimal string ("500.00") — server regex ^\d+(\.\d{1,2})?$. */
        maxAmount?: string;
        expiresInHours?: number;
        idempotencyKey: string;
        totpCode?: string;
      },
      PickupAuthorizeResult
    >;
    listAuthorizations: Query<
      { customerId?: number; status?: PickupStatus; limit?: number; cursor?: number },
      { rows: PickupAuthorizationRow[]; nextCursor: number | null }
    >;
    revokeAuthorization: Mutation<
      { authorizationId: number; totpCode?: string },
      { authorizationId: number; status: "revoked" }
    >;
    executeAgentPickup: Mutation<
      {
        authorizationId: number;
        transactionId: number;
        agentIdNumber: string;
        totpCode?: string;
      },
      ExecutePickupResult
    >;
  };
  analytics: {
    runTellerFraudScan: Mutation<
      { tenantId?: number; windowDays?: number; totpCode?: string },
      TellerFraudScanResult
    >;
    listTellerFraudSignals: Query<
      {
        tellerUserId?: number;
        signalType?: TellerFraudSignalType;
        status?: TellerFraudSignalStatus;
        limit?: number;
        cursor?: number;
      },
      { rows: TellerFraudSignalRow[]; nextCursor: number | null }
    >;
    updateSignalStatus: Mutation<
      { signalId: number; status: "reviewing" | "escalated" | "cleared"; totpCode?: string },
      { signalId: number; status: string; unchanged: boolean }
    >;
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

// ── Wave-12 sub-routers (SPEC-wave12 §4, §6.1) ──────────────────────────────
// Contracts verified against server/routers/bdc/{reversals,rescreening,
// offboarding,pickup,analytics}.ts on branch bdc-integration. Structuring
// alerts (bdc_structuring_alerts) are API-only this wave — no router
// procedure exposes them, so no client interface is declared for them.

export type ReversalStatus = "requested" | "approved" | "posted" | "failed" | "rejected";

/** bdc_reversals row (reversals.listReversals / getReversal). */
export interface BdcReversal {
  id: number;
  tenantId: number;
  txnId: number;
  /** 'manual'|'rail_return'|'recall' */
  reversalType: string;
  status: ReversalStatus | string;
  reason: string;
  railReference?: string | null;
  requestedBy: number;
  approvedBy?: number | null;
  tbReversalIds?: Json;
  failureReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** reversals.requestReversal result. */
export interface ReversalRequestResult {
  status: "requested";
  reversalId: number;
  transactionId: number;
}

/** reversals.approveReversal result (executeApprovedReversal outcome). */
export interface ReversalExecutionResult {
  status: "reversed" | "failed" | "already_posted";
  transactionId: number;
  reversalId: number;
  tbTransferIds?: Json;
  failureReason?: string;
}

/** bdc_rescreening_results row. `score` is numeric(5,4) → decimal string. */
export interface RescreeningResultRow {
  id: number;
  tenantId: number;
  customerId: number;
  runId: string;
  verdict: "clear" | "match" | "error" | string;
  score?: string | null;
  matchedLists?: Json;
  blocked: boolean;
  report?: Json;
  createdAt?: string;
}

/** rescreening.runRescreening honest started-state. */
export interface RescreeningRunStarted {
  runId: string;
  status: "started";
  tenantId: number | null;
}

/** rescreening.getCustomerScreeningStatus response. */
export interface CustomerScreeningStatus {
  customerId: number;
  latest: RescreeningResultRow | null;
  blocked: boolean;
}

/** Offboarding blocker entry (blockers jsonb — server/temporal/activities-bdc.ts). */
export interface OffboardingBlocker {
  type: "non_zero_position" | "open_nfem_batches" | "unsettled_imto_payouts" | "open_regulatory_returns" | string;
  count: number;
  detail: string;
  ids?: number[];
}

/** bdc_tenant_offboardings row. Status: requested|in_progress|blocked|completed. */
export interface BdcOffboardingRecord {
  id: number;
  tenantId: number;
  status: "requested" | "in_progress" | "blocked" | "completed" | string;
  blockers: OffboardingBlocker[];
  initiatedBy: number;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type PickupAgentIdType = "nin" | "bvn" | "passport" | "drivers_license" | "voters_card";
export type PickupStatus = "pending" | "used" | "expired" | "revoked";

export const PICKUP_AGENT_ID_TYPES: readonly PickupAgentIdType[] = [
  "nin",
  "bvn",
  "passport",
  "drivers_license",
  "voters_card",
];

/** pickup.authorizePickup result (encrypted agent ID is never returned). */
export interface PickupAuthorizeResult {
  authorizationId: number;
  status: string;
  expiresAt: string;
  customerId: number;
  agentFullName: string;
  agentIdType: string;
  relationship: string;
  maxAmount: MoneyString | null;
}

/**
 * pickup.listAuthorizations row — the server's select deliberately omits
 * agentIdNumberEnc, so it is not part of this interface.
 */
export interface PickupAuthorizationRow {
  id: number;
  customerId: number;
  txnId?: number | null;
  agentFullName: string;
  agentIdType: string;
  relationship: string;
  status: PickupStatus | string;
  maxAmount?: MoneyString | null;
  expiresAt: string;
  usedAt?: string | null;
  usedBy?: number | null;
  createdBy: number;
  createdAt?: string;
}

/** pickup.executeAgentPickup result. */
export interface ExecutePickupResult {
  authorizationId: number;
  transactionId: number;
  status: "used";
  usedAt: string;
  usedBy: number;
  pickupAgent: { name: string; idType: string; relationship: string };
}

export type TellerFraudSignalType =
  | "variance_pattern"
  | "out_of_hours"
  | "reversal_concentration"
  | "counterfeit_concentration";
export type TellerFraudSignalStatus = "open" | "reviewing" | "escalated" | "cleared";

export const TELLER_FRAUD_SIGNAL_TYPES: readonly TellerFraudSignalType[] = [
  "variance_pattern",
  "out_of_hours",
  "reversal_concentration",
  "counterfeit_concentration",
];

/** teller_fraud_signals row. `score` is numeric(6,3) → decimal string. */
export interface TellerFraudSignalRow {
  id: number;
  tenantId: number;
  tellerUserId: number;
  /** "YYYY-MM-DD" window bounds. */
  windowStart: string;
  windowEnd: string;
  signalType: TellerFraudSignalType | string;
  score: string;
  evidence: Json;
  status: TellerFraudSignalStatus | string;
  createdAt?: string;
}

/** analytics.runTellerFraudScan honest service summary. */
export interface TellerFraudScanResult {
  tenantId: number | null;
  signals_written: number;
  window_start: string;
  window_end: string;
  skipped: string[];
}
