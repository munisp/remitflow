/**
 * RemitFlow Investment ML Client
 *
 * Wave 7 (C10): NO investment-ml service exists anywhere in services/ — the
 * old target was a phantom whose fallback fabricated a constant risk score
 * presented as personalized ML output. Every method now throws UNAVAILABLE
 * ("service not deployed"); health() honestly reports offline.
 */

const NOT_DEPLOYED = "investment-ml service not deployed";

export interface HoldingInput {
  symbol: string;
  asset_type: string;
  quantity: number;
  purchase_price: number;
  current_price: number;
  currency?: string;
  sector?: string;
  country?: string;
}

export interface RecommendRequest {
  user_id: number;
  risk_tolerance?: "conservative" | "moderate" | "aggressive";
  investment_horizon?: "short" | "medium" | "long";
  home_country?: string;
  diaspora_country?: string;
  monthly_budget_usd?: number;
  existing_holdings?: HoldingInput[];
  preferred_sectors?: string[];
  exclude_sectors?: string[];
}

export interface AssetRecommendation {
  symbol: string;
  name: string;
  asset_type: string;
  reason: string;
  confidence_score: number;
  expected_return_1y: number;
  risk_level: string;
  diaspora_relevance: string;
  suggested_allocation_pct: number;
  min_investment_usd: number;
}

export interface RecommendResponse {
  user_id: number;
  recommendations: AssetRecommendation[];
  portfolio_strategy: string;
  diaspora_insight: string;
  generated_at: string;
}

export interface RiskScoreRequest {
  age?: number;
  monthly_income_usd?: number;
  monthly_expenses_usd?: number;
  existing_savings_usd?: number;
  investment_experience?: "beginner" | "intermediate" | "advanced";
  risk_preference?: "conservative" | "moderate" | "aggressive";
  dependents?: number;
  employment_status?: "employed" | "self_employed" | "unemployed" | "retired";
  home_country?: string;
}

export interface RiskScoreResponse {
  risk_score: number;
  risk_label: string;
  recommended_allocation: Record<string, number>;
  max_investment_pct_income: number;
  emergency_fund_months: number;
  key_factors: string[];
  scored_at: string;
}

export interface SentimentRequest {
  symbols: string[];
  include_news?: boolean;
}

export interface AssetSentiment {
  symbol: string;
  sentiment_score: number;
  sentiment_label: string;
  confidence: number;
  bullish_signals: string[];
  bearish_signals: string[];
  diaspora_demand_index: number;
}

export interface SentimentResponse {
  sentiments: AssetSentiment[];
  market_mood: string;
  analyzed_at: string;
}

function unavailable<T>(method: string): Promise<T> {
  return Promise.reject(new Error(`UNAVAILABLE: ${NOT_DEPLOYED} — investmentMlClient.${method} cannot be served`));
}

export const investmentMlClient = {
  /** AI-driven recommendations — service not deployed, always throws */
  recommend: (_req: RecommendRequest): Promise<RecommendResponse> =>
    unavailable("recommend()"),

  /** Risk profile scoring — service not deployed, always throws */
  scoreRisk: (_req: RiskScoreRequest): Promise<RiskScoreResponse> =>
    unavailable("scoreRisk()"),

  /** Sentiment analysis — service not deployed, always throws */
  getSentiment: (_req: SentimentRequest): Promise<SentimentResponse> =>
    unavailable("getSentiment()"),

  /** Health check — honest: the service does not exist, always offline */
  health: (): Promise<{ status: string }> =>
    Promise.resolve({ status: "offline" }),
};
