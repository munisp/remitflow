/**
 * Domain module: wallet — split out of the monolithic services/api.ts
 * (wave14). Re-exported through the services/api.ts barrel; import sites unchanged.
 */
import {
  api,
} from "./core";
import type {
  FundWalletRequest,
  Transaction,
  WalletBalance,
  WithdrawRequest,
} from "./types";

// Wallet Service
export const walletService = {
  getBalance: () => api.get<WalletBalance>("/wallet/balance"),

  getBalances: () => api.get<WalletBalance[]>("/wallet/balances"),

  fund: (data: FundWalletRequest) =>
    api.post<Transaction>("/wallet/fund", data, { offlineQueue: true }),

  withdraw: (data: WithdrawRequest) =>
    api.post<Transaction>("/wallet/withdraw", data),

  getTransactions: (currency?: string) =>
    api.get<Transaction[]>(
      `/wallet/transactions${currency ? `?currency=${currency}` : ""}`,
    ),
};
