/**
 * RemitFlow FX Engine Client
 * Typed HTTP client for the Go FX rate microservice (port 8081)
 * Circuit breaker wraps all outbound calls to protect the hot path.
 */
import { circuitBreakers } from "./circuitBreaker";

const FX_BASE = process.env.FX_ENGINE_URL ?? "http://localhost:8081";

export interface FxRate {
  base: string;
  rates: Record<string, number>;
  time: number;
}

export interface FxQuoteRequest {
  from: string;
  to: string;
  amount: number;
  fsp?: "remitflow" | "wise" | "mpesa";
}

export interface FxQuoteResponse {
  from: string;
  to: string;
  sendAmount: number;
  receiveAmount: number;
  fxRate: number;
  fee: number;
  totalCost: number;
  spread: number;
  fsp: string;
  expiresAt: number;
}

export interface FxExecuteRequest {
  from: string;
  to: string;
  amount: number;
  recipientId: string;
  userId: string;
  reference?: string;
  fsp?: string;
}

export interface FxExecuteResponse {
  transactionId: string;
  status: string;
  fxRate: number;
  fee: number;
  receiveAmount: number;
  auditEvent: string;
  timestamp: number;
}

export interface FxCorridor {
  from: string;
  to: string;
  minAmount: number;
  maxAmount: number;
  avgFeeUSD: number;
  speedHours: number;
  popular: boolean;
}

async function fxFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${FX_BASE}${path}`;
  const res = await circuitBreakers.fxProvider.execute(() =>
    fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    })
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`FX service error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const fxClient = {
  /** Fetch live exchange rates for a base currency */
  getRates: (from = "USD"): Promise<FxRate> =>
    fxFetch<FxRate>(`/rates?from=${from}`),

  /** Get a live quote with fee and spread applied */
  getQuote: (req: FxQuoteRequest): Promise<FxQuoteResponse> =>
    fxFetch<FxQuoteResponse>("/quote", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  /** Execute a transfer (lock rate + emit audit event) */
  execute: (req: FxExecuteRequest): Promise<FxExecuteResponse> =>
    fxFetch<FxExecuteResponse>("/execute", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  /** List supported corridors */
  getCorridors: (from?: string, to?: string): Promise<{ corridors: FxCorridor[]; count: number }> => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return fxFetch(`/corridors?${params.toString()}`);
  },

  /** Health check */
  health: (): Promise<{ status: string }> => fxFetch("/health"),
};
