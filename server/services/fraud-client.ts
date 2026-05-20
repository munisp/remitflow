/**
 * RemitFlow Fraud ML Client
 * Typed HTTP client for the Python FastAPI fraud scoring service (port 8082)
 */

const FRAUD_BASE = process.env.FRAUD_ML_URL ?? "http://localhost:8082";

export interface FraudScoreRequest {
  transaction_id: string;
  amount_usd: number;
  sender_country?: string;
  receiver_country?: string;
  hour_of_day?: number;
  day_of_week?: number;
  velocity_1h?: number;
  velocity_24h?: number;
  velocity_7d?: number;
  is_new_beneficiary?: boolean;
  device_fingerprint?: string;
  from_currency?: string;
  to_currency?: string;
}

export interface FraudScoreResponse {
  transaction_id: string;
  fraud_score: number;       // 0–1
  risk_level: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
  recommendation: "PASS" | "MONITOR" | "REVIEW" | "BLOCK";
  top_features: Array<{ feature: string; shap_value: number }>;
  model_version: string;
  latency_ms: number;
}

export interface FraudExplainResponse {
  transaction_id: string;
  fraud_score: number;
  base_value: number;
  features: Array<{ feature: string; value: number; shap: number }>;
}

export interface CorridorStat {
  corridor: string;
  avg_amount_usd: number;
  total_volume_usd: number;
  transaction_count: number;
  fraud_rate: number;
  avg_fraud_score: number;
}

export interface UserRiskProfile {
  user_id: string;
  period_days: number;
  transaction_count: number;
  avg_amount_usd: number;
  total_volume_usd: number;
  avg_fraud_score: number;
  risk_tier: "LOW" | "MEDIUM" | "HIGH";
  peak_velocity_1h: number;
  countries_used: string[];
  flagged_transactions: number;
  generated_at: string;
}

async function fraudFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${FRAUD_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Fraud ML service error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const fraudClient = {
  /** Score a transaction for fraud probability */
  score: (req: FraudScoreRequest): Promise<FraudScoreResponse> =>
    fraudFetch<FraudScoreResponse>("/score", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  /** Get full SHAP explanation for a transaction */
  explain: (req: FraudScoreRequest): Promise<FraudExplainResponse> =>
    fraudFetch<FraudExplainResponse>("/explain", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  /** Get corridor-level fraud analytics */
  corridorStats: (): Promise<{ corridors: CorridorStat[]; generated_at: string }> =>
    fraudFetch("/analytics/corridor-stats"),

  /** Get rolling 30-day risk profile for a user */
  userRiskProfile: (userId: string): Promise<UserRiskProfile> =>
    fraudFetch(`/analytics/user-risk-profile/${encodeURIComponent(userId)}`),

  /** Trigger model retraining */
  retrain: (): Promise<{ status: string; model: string; timestamp: string }> =>
    fraudFetch("/retrain", { method: "POST" }),

  /** Health check */
  health: (): Promise<{ status: string }> => fraudFetch("/health"),
};
