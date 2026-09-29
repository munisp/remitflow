/**
 * Domain module: transfers — split out of the monolithic services/api.ts
 * (wave14). Re-exported through the services/api.ts barrel; import sites unchanged.
 */
import {
  api,
} from "./core";
import type {
  AccountHealth,
  BatchPayment,
  CreateBatchPaymentRequest,
  CreateFXAlertRequest,
  FXAlert,
  FXReward,
  HealthRecommendation,
  PaymentInsight,
  PaymentPerformanceMetrics,
  StablecoinBalance,
  StablecoinRate,
  StablecoinTransaction,
} from "./types";

// Batch Payment Service
export const batchPaymentService = {
  getAll: () => api.get<BatchPayment[]>("/batch-payments"),

  getById: (id: string) => api.get<BatchPayment>(`/batch-payments/${id}`),

  create: (data: CreateBatchPaymentRequest) =>
    api.post<BatchPayment>("/batch-payments", data),

  execute: (id: string) =>
    api.post<BatchPayment>(`/batch-payments/${id}/execute`),

  cancel: (id: string) =>
    api.post<BatchPayment>(`/batch-payments/${id}/cancel`),
};

// Stablecoin Service
export const stablecoinService = {
  getBalances: () => api.get<StablecoinBalance[]>("/stablecoin/balances"),

  buy: (data: { coin: string; amount: number; paymentCurrency: string }) =>
    api.post<StablecoinTransaction>("/stablecoin/buy", data),

  sell: (data: { coin: string; amount: number; receiveCurrency: string }) =>
    api.post<StablecoinTransaction>("/stablecoin/sell", data),

  send: (data: { coin: string; amount: number; address: string }) =>
    api.post<StablecoinTransaction>("/stablecoin/send", data),

  convert: (data: { fromCoin: string; toCoin: string; amount: number }) =>
    api.post<StablecoinTransaction>("/stablecoin/convert", data),

  getHistory: () => api.get<StablecoinTransaction[]>("/stablecoin/history"),

  getRates: () => api.get<StablecoinRate[]>("/stablecoin/rates"),
};

// FX Alert Service
export const fxAlertService = {
  getAll: () => api.get<FXAlert[]>("/fx-alerts"),

  create: (data: CreateFXAlertRequest) => api.post<FXAlert>("/fx-alerts", data),

  delete: (id: string) => api.delete<void>(`/fx-alerts/${id}`),

  getRewards: () => api.get<FXReward[]>("/fx-alerts/rewards"),

  claimReward: (id: string) =>
    api.post<FXReward>(`/fx-alerts/rewards/${id}/claim`),
};

// Account Health Service
export const accountHealthService = {
  getHealth: () => api.get<AccountHealth>("/account/health"),

  getRecommendations: () =>
    api.get<HealthRecommendation[]>("/account/health/recommendations"),

  dismissRecommendation: (id: string) =>
    api.post<void>(`/account/health/recommendations/${id}/dismiss`),
};

// Payment Performance Service
export const paymentPerformanceService = {
  getMetrics: (params?: { period?: string }) =>
    api.get<PaymentPerformanceMetrics>(
      `/payments/performance?${new URLSearchParams(params as Record<string, string>).toString()}`,
    ),

  getInsights: () =>
    api.get<PaymentInsight[]>("/payments/performance/insights"),
};

// Receive Money Service
export const receiveMoneyService = {
  generateQR: (amount?: number, currency?: string) =>
    api.post<{ qrCode: string; paymentId: string }>("/receive/qr", {
      amount,
      currency,
    }),

  createPaymentLink: (data: {
    amount: number;
    currency: string;
    description?: string;
  }) =>
    api.post<{ link: string; paymentId: string }>(
      "/receive/payment-link",
      data,
    ),

  getVirtualAccount: () =>
    api.get<{ bankName: string; accountNumber: string; accountName: string }>(
      "/receive/virtual-account",
    ),
};

// M-Pesa Service
export const mpesaService = {
  getAccount: () =>
    api.get<{
      phoneNumber: string;
      balance: number;
      currency: string;
      name: string;
      tier: string;
    }>("/mpesa/account"),

  getTransactions: () =>
    api.get<
      {
        id: string;
        type: string;
        amount: number;
        currency: string;
        recipient: string;
        status: string;
        date: string;
      }[]
    >("/mpesa/transactions"),

  sendMoney: (data: {
    phoneNumber: string;
    amount: number;
    description?: string;
  }) =>
    api.post<{ transactionId: string; status: string }>("/mpesa/send", data),

  payBill: (data: {
    businessNumber: string;
    accountNumber: string;
    amount: number;
  }) =>
    api.post<{ transactionId: string; status: string }>("/mpesa/paybill", data),

  buyGoods: (data: { tillNumber: string; amount: number }) =>
    api.post<{ transactionId: string; status: string }>(
      "/mpesa/buygoods",
      data,
    ),

  withdraw: (data: { agentNumber: string; amount: number }) =>
    api.post<{ transactionId: string; status: string }>(
      "/mpesa/withdraw",
      data,
    ),
};

// Wise Transfer Service
export const wiseTransferService = {
  getRecipients: () =>
    api.get<
      {
        id: string;
        name: string;
        email: string;
        currency: string;
        accountNumber: string;
        bankCode: string;
        country: string;
      }[]
    >("/wise/recipients"),

  getTransfers: () =>
    api.get<
      {
        id: string;
        recipientName: string;
        amount: number;
        currency: string;
        targetAmount: number;
        targetCurrency: string;
        status: string;
        date: string;
        fee: number;
        rate: number;
      }[]
    >("/wise/transfers"),

  getQuote: (data: {
    sourceCurrency: string;
    targetCurrency: string;
    sourceAmount: number;
  }) =>
    api.post<{
      targetAmount: number;
      rate: number;
      fee: number;
      estimatedDelivery: string;
    }>("/wise/quote", data),

  createTransfer: (data: {
    recipientId: string;
    sourceCurrency: string;
    targetCurrency: string;
    sourceAmount: number;
    reference?: string;
  }) =>
    api.post<{ transferId: string; status: string }>("/wise/transfer", data),

  addRecipient: (data: {
    name: string;
    email: string;
    currency: string;
    accountNumber: string;
    bankCode: string;
    country: string;
  }) => api.post<{ id: string }>("/wise/recipients", data),
};

// Transfer Tracking Service
export const transferTrackingService = {
  getTracking: (transferId: string) =>
    api.get<{
      transfer_id: string;
      tracking_id: string;
      current_state: string;
      progress_percent: number;
      sender_name: string;
      recipient_name: string;
      amount: number;
      currency: string;
      destination_currency: string;
      destination_amount: number;
      corridor: string;
      created_at: string;
      estimated_completion: string;
      events: {
        state: string;
        timestamp: string;
        description: string;
        location?: string;
      }[];
    }>(`/transfers/${transferId}/tracking`),

  updateNotificationPrefs: (
    transferId: string,
    data: { channel: string; enabled: boolean },
  ) => api.put<void>(`/transfers/${transferId}/notifications`, data),
};
