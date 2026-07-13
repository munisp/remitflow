/**
 * RemitFlow Portfolio Calculator Client
 * Typed HTTP client for the Rust portfolio-calc microservice (port 8088)
 */

const PORTFOLIO_CALC_BASE = process.env.PORTFOLIO_CALC_URL ?? "http://localhost:8088";

export interface HoldingInput {
  symbol: string;
  name: string;
  asset_type: string;
  quantity: number;
  purchase_price: number;
  current_price: number;
  currency: string;
  sector?: string;
  country?: string;
}

export interface PortfolioRequest {
  holdings: HoldingInput[];
  base_currency?: string;
  risk_tolerance?: "conservative" | "moderate" | "aggressive";
}

export interface HoldingMetrics {
  symbol: string;
  name: string;
  asset_type: string;
  quantity: number;
  purchase_price: number;
  current_price: number;
  cost_basis: number;
  current_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  weight: number;
  currency: string;
}

export interface AllocationBreakdown {
  by_asset_type: Record<string, number>;
  by_sector: Record<string, number>;
  by_country: Record<string, number>;
  by_currency: Record<string, number>;
}

export interface RiskMetrics {
  concentration_risk: number;
  geographic_diversification: number;
  asset_class_diversification: number;
  estimated_volatility: number;
  risk_score: number;
  risk_label: string;
}

export interface RebalanceSuggestion {
  symbol: string;
  current_weight: number;
  target_weight: number;
  action: "buy" | "sell" | "hold";
  amount_usd: number;
  reason: string;
}

export interface PortfolioAnalysis {
  total_cost_basis: number;
  total_current_value: number;
  total_unrealized_pnl: number;
  total_unrealized_pnl_pct: number;
  holdings_metrics: HoldingMetrics[];
  allocation: AllocationBreakdown;
  risk_metrics: RiskMetrics;
  rebalance_suggestions: RebalanceSuggestion[];
  top_performer: string | null;
  worst_performer: string | null;
  analyzed_at: string;
}

export interface ReturnCalcRequest {
  purchase_price: number;
  current_price: number;
  quantity: number;
  purchase_date_days_ago?: number;
  dividends_received?: number;
}

export interface ReturnCalcResponse {
  cost_basis: number;
  current_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  annualized_return?: number;
  total_return_with_dividends?: number;
}

export interface DcaRequest {
  monthly_amount: number;
  current_price: number;
  months: number;
  expected_annual_return?: number;
}

export interface DcaResponse {
  total_invested: number;
  projected_value: number;
  projected_gain: number;
  projected_gain_pct: number;
  projections: Array<{
    month: number;
    invested: number;
    portfolio_value: number;
    units_held: number;
    avg_cost: number;
  }>;
}

async function calcFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${PORTFOLIO_CALC_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Portfolio calc error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const portfolioCalcClient = {
  /** Full portfolio analysis: P&L, allocation, risk metrics, rebalancing */
  analyze: (req: PortfolioRequest): Promise<PortfolioAnalysis> =>
    calcFetch<PortfolioAnalysis>("/analyze", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  /** Calculate returns for a single position */
  calcReturns: (req: ReturnCalcRequest): Promise<ReturnCalcResponse> =>
    calcFetch<ReturnCalcResponse>("/returns", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  /** Project DCA (Dollar-Cost Averaging) outcomes */
  dcaProjection: (req: DcaRequest): Promise<DcaResponse> =>
    calcFetch<DcaResponse>("/dca", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  /** Health check */
  health: (): Promise<{ status: string }> => calcFetch("/health"),
};
