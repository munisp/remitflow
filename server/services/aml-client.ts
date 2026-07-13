/**
 * RemitFlow AML Engine Client
 * Typed HTTP client for the Rust Axum AML rules engine (port 8083)
 */

const AML_BASE = process.env.AML_ENGINE_URL ?? "http://localhost:8083";

export interface AmlScreenRequest {
  transaction_id: string;
  amount_usd: number;
  sender_country?: string;
  receiver_country?: string;
  sender_name?: string;
  receiver_name?: string;
  velocity_1h?: number;
  velocity_24h?: number;
  is_new_beneficiary?: boolean;
  hour_utc?: number;
  is_round_number?: boolean;
}

export interface AmlMatchedRule {
  rule_id: string;
  rule_name: string;
  severity: "low" | "medium" | "high" | "critical";
  detail: string;
}

export interface AmlScreenResponse {
  transaction_id: string;
  decision: "PASS" | "REVIEW" | "BLOCK";
  risk_score: number;
  matched_rules: AmlMatchedRule[];
  screened_at: string;
  screen_id: string;
}

export interface AmlSanctionsRequest {
  name: string;
  country?: string;
}

export interface AmlSanctionsResponse {
  name: string;
  is_match: boolean;
  match_type: string | null;
  confidence: number;
  screened_at: string;
}

export interface AmlPepRequest {
  name: string;
  country?: string;
}

export interface AmlPepResponse {
  name: string;
  is_pep: boolean;
  pep_category: string | null;
  confidence: number;
  screened_at: string;
}

export interface AmlRule {
  id: string;
  name: string;
  description: string;
  category: string;
  severity: string;
  threshold: number | null;
  active: boolean;
}

async function amlFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${AML_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AML service error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const amlClient = {
  /** Run a transaction through the full AML rules engine */
  screen: (req: AmlScreenRequest): Promise<AmlScreenResponse> =>
    amlFetch<AmlScreenResponse>("/screen", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  /** Check a name against the sanctions list */
  sanctionsCheck: (req: AmlSanctionsRequest): Promise<AmlSanctionsResponse> =>
    amlFetch<AmlSanctionsResponse>("/sanctions-check", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  /** Check if a person is a PEP */
  pepCheck: (req: AmlPepRequest): Promise<AmlPepResponse> =>
    amlFetch<AmlPepResponse>("/pep-check", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  /** List all active AML rules */
  listRules: (): Promise<{ rules: AmlRule[]; count: number }> =>
    amlFetch("/rules"),

  /** Health check */
  health: (): Promise<{ status: string }> => amlFetch("/health"),
};
