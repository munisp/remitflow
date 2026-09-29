/**
 * Investment surfaces (part A) — typed client wrapper over the PWA tRPC client.
 *
 * Consumed server namespaces (verified against server/routers/diasporaBond.ts
 * and server/routers/investment.ts on branch bdc-integration, and against
 * audit/routers.json — all pairs mounted as static registrations):
 *
 *   diasporaBond.*  — 13 procedures in the router. The 11 user-facing ones are
 *     wired here; `adminConfirmPayment` and `processUpcomingCoupons` are
 *     adminProcedure-gated and deliberately NOT exposed in the user UI.
 *   ngxStocks.*     — 12 procedures in the router. The 10 user-facing ones are
 *     wired here; `brokerWebhook` (deliberately NOT_IMPLEMENTED server-side —
 *     broker fill ingestion is reconciled manually by operations) and
 *     `ingestPrices` (auditedAdminProcedure) are NOT exposed in the user UI.
 *
 * The PWA-local AppRouter contract (types/appRouter.ts) does not mirror these
 * namespaces yet, so this module casts the shared client to a local structural
 * type — the same "pages cast to their own interfaces" convention used by
 * pages/bdc/api.ts and OperationsMap.
 *
 * CONTRACT SOURCE OF TRUTH: the zod `.input(...)` schemas in the server
 * routers. Every request-body interface below mirrors its router schema
 * exactly — field names, required vs optional, enums.
 *
 * Money values are numeric(18,2) MAJOR units and arrive on the wire as decimal
 * strings (e.g. "12500.00"). NGX quantities/prices are unsigned-decimal
 * strings per the placeOrder zod regexes (^\d+(\.\d{1,4})?$).
 */
import { trpcClient } from "../../services/trpc";

// ── Procedure shapes ─────────────────────────────────────────────────────────

type Query<I, O> = { query: (input: I) => Promise<O> };
type QueryNoInput<O> = { query: (input?: undefined) => Promise<O> };
type Mutation<I, O> = { mutate: (input: I) => Promise<O> };

// ── diasporaBond.* ───────────────────────────────────────────────────────────

export type BondStatus = "open" | "closed" | "matured" | "all";

/** Row shape of the diaspora_bonds table (numeric columns arrive as strings). */
export interface BondRow {
  id: number;
  isin: string | null;
  name: string;
  issuer: string;
  bondType: string;
  currency: string | null;
  faceValue: string;
  minSubscription: string | null;
  maxSubscription: string | null;
  couponRate: string;
  couponFrequency: string | null;
  issueDate: string;
  maturityDate: string;
  offerOpenDate: string;
  offerCloseDate: string;
  targetRaise: string | null;
  raisedAmount: string | null;
  totalUnits: number | null;
  availableUnits: number | null;
  status: string | null;
  ratingAgency: string | null;
  creditRating: string | null;
  prospectusUrl: string | null;
  description: string | null;
  eligibleCountries: string[] | null;
  isTaxExempt: boolean | null;
  yieldToMaturity: string | null;
}

export interface BondPricing {
  cleanPrice: number;
  dirtyPrice: number;
  accruedInterest: number;
  yieldToMaturity: number;
  modifiedDuration: number;
  macaulayDuration: number;
  dv01: number;
  convexity: number;
}

export interface BondDetail extends BondRow {
  pricing: BondPricing;
  fillPercentage: number;
  nextCouponDate: string;
  annualCouponUsd: number;
}

export interface SubscriptionQuote {
  bond: { id: number; name: string; issuer: string; couponRate: string };
  amountUsd: number;
  units: number;
  pricing: BondPricing;
  couponPerPeriod: number;
  annualCoupon: number;
  yearsToMaturity: number;
  totalCouponsEstimate: number;
  totalReturnEstimate: number;
  platformFee: number;
  nextCouponDate: string;
  maturityDate: string;
}

export interface BondSubscriptionRow {
  id: number;
  userId: number;
  bondId: number;
  subscriptionRef: string;
  units: number;
  faceValue: string;
  purchasePrice: string;
  totalPaid: string;
  currency: string | null;
  status: string | null;
  totalCouponsReceived: string | null;
  yieldAtPurchase: string | null;
  purchasedAt: string;
  maturedAt: string | null;
  createdAt: string;
}

export interface SubscribeResult {
  subscription: BondSubscriptionRow;
  bond: { id: number; name: string; issuer: string };
  quote: {
    amountUsd: number;
    units: number;
    couponPerPeriod: number;
    platformFee: number;
    nextCouponDate: string;
  };
  verified: boolean;
  fraudScore: number | null;
}

export interface MySubscriptionItem {
  subscription: BondSubscriptionRow;
  bond: BondRow | null;
  currentValue: number;
  pnl: number;
  pnlPct?: number;
  pricing?: BondPricing;
}

export interface MySubscriptions {
  subscriptions: MySubscriptionItem[];
  summary: {
    totalInvested: number;
    totalCurrentValue: number;
    totalPnl: number;
    totalPnlPct: number;
    activeCount: number;
    maturedCount: number;
  };
}

export interface CouponPayment {
  id: number;
  subscriptionId: number;
  bondId: number;
  couponNumber: number;
  periodStart: string;
  periodEnd: string;
  scheduledDate: string;
  paidDate: string | null;
  grossAmount: string;
  withholdingTax: string | null;
  netAmount: string;
  currency: string | null;
  status: string | null;
}

export interface CouponHistory {
  subscription: BondSubscriptionRow;
  coupons: CouponPayment[];
  totalReceived: number;
}

export interface SecondaryOrder {
  id: number;
  subscriptionId: number;
  sellerId: number;
  buyerId: number | null;
  bondId: number;
  orderType: string | null;
  units: number;
  askPrice: string;
  totalValue: string | null;
  currency: string | null;
  status: string | null;
  expiresAt: string | null;
  createdAt: string;
  bondName?: string;
  issuerName?: string;
  couponRate?: string;
}

export interface SellOrderResult {
  order: SecondaryOrder;
  fairValue: number;
  premiumDiscount: number;
  buyerPaidFee: number;
  netProceeds: number;
}

export interface FillOrderResult {
  newSubscription: BondSubscriptionRow;
  totalCost: number;
  platformFee: number;
  sellerProceeds: number;
  unitsAcquired: number;
  verified: boolean;
  fraudScore: number | null;
}

export interface RedemptionResult {
  subscriptionId: number;
  principalUsd: number;
  penalty: number;
  penaltyRate: number;
  redemptionAmount: number;
  creditedToWallet: boolean;
}

export interface DiasporaBondClient {
  listBonds: Query<
    {
      status?: BondStatus;
      issuingCountry?: string;
      minYield?: number;
      maxTenor?: number;
    },
    BondRow[]
  >;
  getBond: Query<{ id: number }, BondDetail>;
  getSubscriptionQuote: Query<
    { bondId: number; amountUsd: number },
    SubscriptionQuote
  >;
  subscribe: Mutation<
    {
      bondId: number;
      amountUsd: number;
      paymentSource?: "wallet" | "bank_transfer" | "card";
      acceptedTerms: boolean;
      totpCode?: string;
    },
    SubscribeResult
  >;
  confirmPayment: Mutation<
    { subscriptionId: number; paymentReference: string; totpCode?: string },
    unknown
  >;
  getMySubscriptions: QueryNoInput<MySubscriptions>;
  getCouponHistory: Query<{ subscriptionId: number }, CouponHistory>;
  listSecondaryOrders: Query<
    { bondId?: number; side?: "buy" | "sell" | "all" },
    SecondaryOrder[]
  >;
  createSellOrder: Mutation<
    {
      subscriptionId: number;
      unitsToSell: number;
      askPriceUsd: number;
      expiresInDays?: number;
    },
    SellOrderResult
  >;
  fillBuyOrder: Mutation<
    { orderId: number; unitsToFill?: number; totpCode?: string },
    FillOrderResult
  >;
  requestEarlyRedemption: Mutation<
    { subscriptionId: number; reason?: string; totpCode?: string },
    RedemptionResult
  >;
}

// ── ngxStocks.* ──────────────────────────────────────────────────────────────

export interface NgxStockRow {
  id: number;
  ticker: string;
  name: string;
  sector: string;
  exchange: string;
  currentPriceNgn: string;
  previousCloseNgn: string | null;
  changePercent: string | null;
  marketCapNgn: string | null;
  peRatio: string | null;
  dividendYield: string | null;
  week52High: string | null;
  week52Low: string | null;
  description: string | null;
  isActive: boolean;
  lastUpdated: string;
  /** G3 honesty fields added by the server's withPriceHonesty() wrapper. */
  priceStale: boolean;
  priceSource: "seed" | "feed";
}

export interface WatchlistItem {
  id: number;
  stockId: number;
  alertPriceNgn: string | null;
  notes: string | null;
  createdAt: string;
  ticker: string;
  name: string;
  sector: string;
  currentPriceNgn: string;
  changePercent: string | null;
}

export type NgxOrderType = "buy" | "sell" | "limit_buy" | "limit_sell";
export type NgxBroker = "Bamboo" | "Trove" | "Chaka" | "Stanbic" | "GTB";

export interface NgxOrderResult {
  id: number;
  stockId: number;
  orderType: string;
  status: string;
  quantityUnits: string;
  pricePerUnitNgn: string;
  totalAmountNgn: string;
  totalAmountUsd: string | null;
  brokerName: string | null;
  brokerReference: string | null;
  createdAt: string;
  verified: boolean;
  fraudScore: number | null;
  idempotent?: boolean;
  brokerStatus?: "submitted" | "queued_for_ops";
  brokerMessage?: string;
}

export interface NgxOrderRow {
  id: number;
  orderType: string;
  status: string;
  quantityUnits: string;
  pricePerUnitNgn: string;
  totalAmountNgn: string;
  totalAmountUsd: string | null;
  brokerName: string | null;
  executedAt: string | null;
  createdAt: string;
  ticker: string;
  stockName: string;
}

export interface CancelOrderResult {
  id: number;
  status: string;
  refunded: boolean;
}

export interface NgxStocksClient {
  list: Query<
    { search?: string; sector?: string; limit?: number; offset?: number },
    NgxStockRow[]
  >;
  getById: Query<{ id: number }, NgxStockRow>;
  getByTicker: Query<{ ticker: string }, NgxStockRow>;
  sectors: QueryNoInput<string[]>;
  getWatchlist: QueryNoInput<WatchlistItem[]>;
  addToWatchlist: Mutation<
    { stockId: number; alertPriceNgn?: string; notes?: string },
    WatchlistItem
  >;
  removeFromWatchlist: Mutation<{ watchlistId: number }, { success: boolean }>;
  placeOrder: Mutation<
    {
      stockId: number;
      orderType: NgxOrderType;
      quantityUnits: string;
      pricePerUnitNgn: string;
      brokerName?: NgxBroker;
      notes?: string;
      idempotencyKey?: string;
      totpCode?: string;
    },
    NgxOrderResult
  >;
  getOrders: Query<
    { status?: string; limit?: number; offset?: number },
    NgxOrderRow[]
  >;
  cancelOrder: Mutation<{ orderId: number }, CancelOrderResult>;
}

// ── Client handles ───────────────────────────────────────────────────────────

/**
 * The diasporaBond / ngxStocks namespaces on the shared tRPC client. The cast
 * is local to this module and mirrors the server routers exactly.
 */
export const diasporaBond: DiasporaBondClient = (
  trpcClient as unknown as { diasporaBond: DiasporaBondClient }
).diasporaBond;

export const ngxStocks: NgxStocksClient = (
  trpcClient as unknown as { ngxStocks: NgxStocksClient }
).ngxStocks;

/** Fresh idempotency key per order attempt (server bounds: max 90 chars). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
