/**
 * Domain module: accounts — split out of the monolithic services/api.ts
 * (wave14). Re-exported through the services/api.ts barrel; import sites unchanged.
 */
import {
  api,
} from "./core";
import type {
  CardTransaction,
  CreateCardRequest,
  CreateVirtualAccountRequest,
  Transaction,
  VirtualAccount,
  VirtualCard,
} from "./types";

// Virtual Account Service
export const virtualAccountService = {
  create: (data: CreateVirtualAccountRequest) =>
    api.post<VirtualAccount>("/virtual-accounts", data),

  getAccounts: () => api.get<VirtualAccount[]>("/virtual-accounts"),

  getById: (id: string) => api.get<VirtualAccount>(`/virtual-accounts/${id}`),

  getTransactions: (accountId: string) =>
    api.get<Transaction[]>(`/virtual-accounts/${accountId}/transactions`),
};

// Virtual Card Service (Remittance Banking)
export const virtualCardService = {
  create: (data: CreateCardRequest) => api.post<VirtualCard>("/cards", data),

  getCards: () => api.get<VirtualCard[]>("/cards"),

  getById: (id: string) => api.get<VirtualCard>(`/cards/${id}`),

  freeze: (id: string) => api.post<VirtualCard>(`/cards/${id}/freeze`),

  unfreeze: (id: string) => api.post<VirtualCard>(`/cards/${id}/unfreeze`),

  setLimit: (id: string, limit: number) =>
    api.put<VirtualCard>(`/cards/${id}/limit`, { limit }),

  getTransactions: (cardId: string) =>
    api.get<CardTransaction[]>(`/cards/${cardId}/transactions`),
};
