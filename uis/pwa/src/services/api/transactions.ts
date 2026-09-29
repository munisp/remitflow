/**
 * Domain module: transactions — split out of the monolithic services/api.ts
 * (wave14). Re-exported through the services/api.ts barrel; import sites unchanged.
 */
import { normalizePaymentHubCurrency } from "../../lib/paymentHubCurrency";
import {
  ApiError,
  api,
} from "./core";
import type {
  Transaction,
  TransferRequest,
} from "./types";

// Transaction Service
export const transactionService = {
  transfer: (data: TransferRequest) => {
    if (!data.sourceAccountId) {
      // A transfer must always originate from a real core-banking account;
      // never submit with a fabricated or default account identifier.
      throw new ApiError(
        400,
        "SOURCE_ACCOUNT_REQUIRED",
        "A source account is required to initiate a transfer.",
      );
    }
    const switchName = data.switchName || "mojaloop";
    const transferCurrency = normalizePaymentHubCurrency(
      data.currency,
      data.destinationCurrency,
    );

    // Derive tenant name from stored tenant config when available
    let tenantName: string | undefined;
    try {
      const tenantConfigStr = localStorage.getItem("tenant_config");
      if (tenantConfigStr) {
        const tenantConfig = JSON.parse(tenantConfigStr) as {
          name?: string;
          tenant_id?: string;
        };
        if (tenantConfig) {
          tenantName = tenantConfig.tenant_id || tenantConfig.name;
        }
      }
    } catch {
      // Ignore parse errors and fall back to defaults
    }

    // Default AMS name; can be overridden via env if needed
    const amsName =
      (import.meta.env.VITE_AMS_NAME as string | undefined) || "core_banking";

    const paymentHubPayload = {
      switch_name: switchName,
      amount: Number(data.amount || 0).toFixed(2),
      currency: transferCurrency,
      to: {
        idType: "ACCOUNT_ID",
        idValue: data.recipient,
        displayName: data.recipientName || "Recipient",
      },
      from: {
        idType: "ACCOUNT_ID",
        idValue: data.sourceAccountId,
        displayName: data.senderName || "Sender",
      },
      destination: data.destination,
      note: data.note || "Transfer from remittance UI",
      pin: data.pin,
    };

    return api.post<Transaction>(
      "/payment-hub/api/v1/transfers/initiate",
      paymentHubPayload,
      {
        offlineQueue: true,
        ledgerCurrency: transferCurrency,
        headers: {
          "x-switch-name": switchName,
          "x-ams-name": amsName,
          ...(tenantName ? { "x-tenant-name": tenantName } : {}),
        },
      },
    );
  },

  getHistory: (params?: { page?: number; limit?: number; type?: string }) =>
    api.get<{ transactions: Transaction[]; total: number; page: number }>(
      `/transactions?${new URLSearchParams(params as Record<string, string>).toString()}`,
    ),

  getById: (id: string) => api.get<Transaction>(`/transactions/${id}`),

  cancel: (id: string) => api.post<Transaction>(`/transactions/${id}/cancel`),
};
