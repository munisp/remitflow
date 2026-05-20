/**
 * RemitFlow Investment Feed Client
 * Typed HTTP client for the Go investment price-feed microservice (port 8087)
 */

const INVESTMENT_FEED_BASE = process.env.INVESTMENT_FEED_URL ?? "http://localhost:8087";

export interface AssetPrice {
  symbol: string;
  name: string;
  asset_type: string;
  price: number;
  change_24h: number;
  change_pct_24h: number;
  volume_24h: number;
  market_cap: number;
  currency: string;
  updated_at: string;
}

export interface PriceFeedResponse {
  prices: AssetPrice[];
  count: number;
  timestamp: string;
}

export interface QuoteResponse {
  symbol: string;
  name: string;
  asset_type: string;
  price: number;
  bid: number;
  ask: number;
  spread: number;
  change_24h: number;
  change_pct_24h: number;
  high_24h: number;
  low_24h: number;
  volume_24h: number;
  market_cap: number;
  currency: string;
  timestamp: string;
}

export interface WatchlistResponse {
  symbols: string[];
  prices: AssetPrice[];
  timestamp: string;
}

async function feedFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${INVESTMENT_FEED_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Investment feed error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const investmentFeedClient = {
  /** Get live prices for all assets */
  getPrices: (assetType?: string): Promise<PriceFeedResponse> => {
    const params = assetType ? `?type=${assetType}` : "";
    return feedFetch<PriceFeedResponse>(`/prices${params}`);
  },

  /** Get detailed quote for a single symbol */
  getQuote: (symbol: string): Promise<QuoteResponse> =>
    feedFetch<QuoteResponse>(`/quote?symbol=${encodeURIComponent(symbol)}`),

  /** Get prices for a watchlist of symbols */
  getWatchlist: (symbols: string[]): Promise<WatchlistResponse> =>
    feedFetch<WatchlistResponse>("/watchlist", {
      method: "POST",
      body: JSON.stringify({ symbols }),
    }),

  /** Health check */
  health: (): Promise<{ status: string }> => feedFetch("/health"),
};
