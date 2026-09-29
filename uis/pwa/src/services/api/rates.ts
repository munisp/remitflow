/**
 * Domain module: rates — split out of the monolithic services/api.ts
 * (wave14). Re-exported through the services/api.ts barrel; import sites unchanged.
 */
import {
  ApiError,
  ApiResponse,
  api,
} from "./core";
import type {
  BackendExchangeRate,
  ExchangeRate,
  ExchangeRateHistory,
  RateLock,
} from "./types";

// Exchange Rate Service
export const exchangeRateService = {
  getRates: async (from?: string, to?: string) => {
    const res = await api.get<BackendExchangeRate[]>(
      `/exchange-rates/exchange-rates${from ? `?from=${from}` : ""}${to ? `&to=${to}` : ""}`,
    );

    const normalized: ExchangeRate[] = res.data.map((raw) => {
      const rateValue = raw.rate;

      return {
        from: raw.base_currency,
        to: raw.quote_currency,
        rate: rateValue,
        inverseRate: rateValue > 0 ? 1 / rateValue : 0,
        provider: "54remit",
        lastUpdated: raw.updated_at || raw.created_at,
        validUntil: new Date(Date.now() + 60000).toISOString(),
      };
    });

    return {
      data: normalized,
      status: res.status,
      headers: res.headers,
    };
  },

  getRate: async (
    from: string,
    to: string,
  ): Promise<ApiResponse<ExchangeRate>> => {
    // Use 54remit exchange rates API, scoped by tenant via headers
    const res = await api.get<BackendExchangeRate[]>(
      `/exchange-rates/exchange-rates?from=${from}&to=${to}`,
    );

    const raw = res.data[0];

    if (!raw) {
      throw new ApiError(
        404,
        "RATE_NOT_FOUND",
        "Exchange rate not found for selected currency pair",
      );
    }

    const rateValue = raw.rate;

    const normalized: ExchangeRate = {
      from: raw.base_currency || from,
      to: raw.quote_currency || to,
      rate: rateValue,
      inverseRate: rateValue > 0 ? 1 / rateValue : 0,
      provider: "54remit",
      lastUpdated: raw.updated_at || raw.created_at,
      validUntil: new Date(Date.now() + 60000).toISOString(),
    };

    return {
      data: normalized,
      status: res.status,
      headers: res.headers,
    };
  },

  lockRate: (from: string, to: string, amount: number) =>
    api.post<RateLock>("/exchange-rates/lock", { from, to, amount }),

  unlockRate: (lockId: string) =>
    api.delete<void>(`/exchange-rates/lock/${lockId}`),

  getHistory: (from: string, to: string, days?: number) =>
    api.get<ExchangeRateHistory[]>(
      `/exchange-rates/history/${from}/${to}?days=${days || 30}`,
    ),
};
