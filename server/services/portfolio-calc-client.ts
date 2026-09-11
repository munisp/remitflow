/**
 * RemitFlow Portfolio Calculator Client
 *
 * Wave 7 (C10): NO portfolio-calc service exists anywhere in services/ — the
 * old target was a phantom. Every method now throws UNAVAILABLE ("service not
 * deployed"); health() honestly reports offline.
 */

const NOT_DEPLOYED = "portfolio-calc service not deployed";

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

function unavailable<T>(method: string): Promise<T> {
  return Promise.reject(new Error(`UNAVAILABLE: ${NOT_DEPLOYED} — portfolioCalcClient.${method} cannot be served`));
}

export const portfolioCalcClient = {
  /** Full portfolio analysis — service not deployed, always throws */
  analyze: (_req: PortfolioRequest): Promise<PortfolioAnalysis> =>
    unavailable("analyze()"),

  /** Calculate returns for a single position — service not deployed, always throws */
  calcReturns: (_req: ReturnCalcRequest): Promise<ReturnCalcResponse> =>
    unavailable("calcReturns()"),

  /** Project DCA outcomes — service not deployed, always throws */
  dcaProjection: (_req: DcaRequest): Promise<DcaResponse> =>
    unavailable("dcaProjection()"),

  /** Health check — honest: the service does not exist, always offline */
  health: (): Promise<{ status: string }> =>
    Promise.resolve({ status: "offline" }),
};
