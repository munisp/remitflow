/**
 * Domain module: dashboard — split out of the monolithic services/api.ts
 * (wave14). Re-exported through the services/api.ts barrel; import sites unchanged.
 */
import {
  api,
} from "./core";
import type {
  Bank,
  BankListResponse,
  Beneficiary,
  CreateBeneficiaryRequest,
  DashboardSummary,
} from "./types";

// Dashboard Service
export const dashboardService = {
  getSummary: () => api.get<DashboardSummary>("/dashboard/summary"),
};

// Bank Directory Service
export const bankService = {
  getBanks: () => api.get<BankListResponse>("/account/bank"),
};

// Beneficiary Service
export const beneficiaryService = {
  getAll: () => api.get<Beneficiary[]>("/beneficiaries"),

  getById: (id: string) => api.get<Beneficiary>(`/beneficiaries/${id}`),

  create: (data: CreateBeneficiaryRequest) =>
    api.post<Beneficiary>("/beneficiaries", data),

  update: (id: string, data: Partial<CreateBeneficiaryRequest>) =>
    api.put<Beneficiary>(`/beneficiaries/${id}`, data),

  delete: (id: string) => api.delete<void>(`/beneficiaries/${id}`),

  toggleFavorite: (id: string, isFavorite: boolean) =>
    api.put<Beneficiary>(`/beneficiaries/${id}/favorite`, { isFavorite }),
};
