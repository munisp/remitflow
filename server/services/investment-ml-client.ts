/**
 * RemitFlow Investment ML Client
 * Typed HTTP client for the Python investment ML recommendation engine (port 8089)
 */

const INVESTMENT_ML_BASE = process.env.INVESTMENT_ML_URL ?? "http://localhost:8089";

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

async function mlFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${INVESTMENT_ML_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Investment ML error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const investmentMlClient = {
  /** Get AI-driven investment recommendations for a user */
  recommend: (req: RecommendRequest): Promise<RecommendResponse> =>
    mlFetch<RecommendResponse>("/recommend", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  /** Score a user's investment risk profile */
  scoreRisk: (req: RiskScoreRequest): Promise<RiskScoreResponse> =>
    mlFetch<RiskScoreResponse>("/score-risk", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  /** Get sentiment analysis for a list of symbols */
  getSentiment: (req: SentimentRequest): Promise<SentimentResponse> =>
    mlFetch<SentimentResponse>("/sentiment", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  /** Health check */
  health: (): Promise<{ status: string }> => mlFetch("/health"),
};
