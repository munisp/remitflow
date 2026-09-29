/**
 * Domain module: payments — split out of the monolithic services/api.ts
 * (wave14). Re-exported through the services/api.ts barrel; import sites unchanged.
 */
import {
  api,
} from "./core";
import type {
  AirtimeProvider,
  AirtimePurchaseRequest,
  AirtimeTransaction,
  BillCategory,
  BillPaymentRequest,
  BillPaymentTransaction,
  Biller,
  CustomerValidation,
  DataPlan,
} from "./types";

// Airtime Service
export const airtimeService = {
  purchase: (data: AirtimePurchaseRequest) =>
    api.post<AirtimeTransaction>("/airtime/purchase", data, {
      offlineQueue: true,
    }),

  getProviders: (country?: string) =>
    api.get<AirtimeProvider[]>(
      `/airtime/providers${country ? `?country=${country}` : ""}`,
    ),

  getDataPlans: (provider: string) =>
    api.get<DataPlan[]>(`/airtime/data-plans/${provider}`),

  getHistory: () => api.get<AirtimeTransaction[]>("/airtime/history"),
};

// Bill Payment Service
export const billPaymentService = {
  pay: (data: BillPaymentRequest) =>
    api.post<BillPaymentTransaction>("/bills/pay", data, {
      offlineQueue: true,
    }),

  getCategories: () => api.get<BillCategory[]>("/bills/categories"),

  getBillers: (category: string) =>
    api.get<Biller[]>(`/bills/billers/${category}`),

  validateCustomer: (billerId: string, customerId: string) =>
    api.post<CustomerValidation>("/bills/validate", { billerId, customerId }),

  getHistory: () => api.get<BillPaymentTransaction[]>("/bills/history"),
};
