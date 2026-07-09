/**
 * Account Service - Integration with 54link Core Banking Account Service
 * Handles multi-currency account management from core banking system
 */

import { api } from "./api";

// Account Types from core banking
export enum AccountType {
  PRIMARY = "primary",
  SAVINGS = "savings",
  CURRENT = "current",
  MINT = "mint",
}

export enum AccountCurrency {
  USD = "USD",
  EUR = "EUR",
  GBP = "GBP",
  JPY = "JPY",
  AUD = "AUD",
  NGN = "NGN",
  GHS = "GHS",
}

export enum CurrencyLedgerId {
  NGN = 1,
  USD = 2,
  EUR = 3,
  GBP = 4,
  JPY = 5,
  AUD = 6,
  GHS = 7,
}

export const getCurrencyLedgerId = (
  currency: AccountCurrency,
): CurrencyLedgerId => {
  return CurrencyLedgerId[currency as keyof typeof CurrencyLedgerId];
};

export enum AccountStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  SUSPENDED = "suspended",
  DELETED = "deleted",
}

// Account Interfaces
export interface Account {
  id: number;
  name: string;
  account_number: string;
  account_type: AccountType;
  account_currency: AccountCurrency;
  balance: string;
  status: AccountStatus;
  keycloak_id: string;
  tenant_id: string;
  ledger_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAccountRequest {
  name: string;
  account_type?: AccountType;
  account_currency?: AccountCurrency;
}

export interface SetupPinRequest {
  pin: string;
}

export interface VerifyPinRequest {
  pin: string;
}

export interface CheckAccountRequest {
  account_id: string;
  pin: string;
}

export interface AccountResponse {
  message: string;
  account: Account;
}

export interface AccountsResponse {
  message: string;
  account: Account[]; // Note: API returns array in 'account' field
}

// Account Service
export const accountService = {
  /**
   * Create a new account (supports multi-currency)
   */
  async createAccount(data: CreateAccountRequest): Promise<Account> {
    const response = await api.post<AccountResponse>(`/account/account`, data, {
      // Use the requested account currency (if any) to set x-ledger-id
      ledgerCurrency: data.account_currency,
    });
    // Store account data in localStorage after creation
    const account = response.data.account;
    if (account) {
      localStorage.setItem("account", JSON.stringify(account));
      localStorage.setItem("account_id", account.id.toString());
    }
    return account;
  },

  /**
   * Get account by keycloak ID (primary method - matches mobile app)
   * This fetches the user's primary account from core banking
   */
  async getAccountByKeycloakId(): Promise<Account | null> {
    try {
      // Get keycloak_id from storage
      const keycloakId = localStorage.getItem("keycloak_id");
      if (!keycloakId) {
        console.warn("No keycloak_id found in storage");
        return null;
      }

      const response = await api.get<AccountResponse>(
        `/account/account/keycloak/${keycloakId}`,
      );

      const account = response.data.account;
      if (account) {
        // Store account data in localStorage (matching mobile app behavior)
        localStorage.setItem("account", JSON.stringify(account));
        localStorage.setItem("account_id", account.id.toString());
        // Also store in 'user' key for API service lookup
        localStorage.setItem(
          "user",
          JSON.stringify({ account_id: account.id }),
        );
      }

      return account;
    } catch (error) {
      console.error("Failed to fetch account by keycloak ID:", error);
      return null;
    }
  },

  /**
   * Get all accounts for the current user
   * Uses /account/account/user/all which fetches ONLY accounts belonging to the
   * logged-in user (filtered by keycloak_id on the backend).
   * This does NOT return all accounts in the platform/tenant.
   */
  async getAccounts(): Promise<Account[]> {
    const response = await api.get<AccountsResponse>(
      `/account/account/user/all`,
    );
    return response.data.account || [];
  },

  /**
   * Get account by ID
   */
  async getAccountById(accountId: number): Promise<Account> {
    const response = await api.get<AccountResponse>(
      `/account/account/${accountId}`,
    );
    return response.data.account;
  },

  /**
   * Get account by account number
   */
  async getAccountByNumber(accountNumber: string): Promise<Account> {
    const response = await api.get<AccountResponse>(
      `/account/account/account-number/${accountNumber}`,
    );
    return response.data.account;
  },

  /**
   * Validate a recipient account by account number for a specific bank.
   * This overrides the default x-tenant-id with the bank's tenant/name
   * so the lookup is scoped to the selected bank.
   */
  async validateRecipientAccount(
    accountNumber: string,
    bankTenantName: string,
  ): Promise<Account> {
    const response = await api.get<AccountResponse>(
      `/account/account/account-number/${accountNumber}`,
      {
        headers: {
          "x-tenant-id": bankTenantName,
        },
      },
    );
    return response.data.account;
  },

  /**
   * Setup PIN for an account
   */
  async setupPin(accountId: number, data: SetupPinRequest): Promise<void> {
    await api.post<{ message: string }>(
      `/account/account/${accountId}/setup-pin`,
      data,
    );
  },

  /**
   * Verify account PIN
   */
  async verifyPin(accountId: number, data: VerifyPinRequest): Promise<boolean> {
    const response = await api.post<{ message: string; valid: boolean }>(
      `/account/account/${accountId}/verify-pin`,
      data,
    );
    return response.data.valid || false;
  },

  /**
   * Check account with PIN
   */
  async checkAccount(data: CheckAccountRequest): Promise<boolean> {
    const response = await api.post<{ message: string; valid: boolean }>(
      `/account/account/check`,
      data,
    );
    return response.data.valid || false;
  },

  /**
   * Get accounts grouped by currency
   */
  async getAccountsByCurrency(): Promise<Record<string, Account[]>> {
    const accounts = await this.getAccounts();
    return accounts.reduce(
      (acc, account) => {
        const currency = account.account_currency;
        if (!acc[currency]) {
          acc[currency] = [];
        }
        acc[currency].push(account);
        return acc;
      },
      {} as Record<string, Account[]>,
    );
  },

  /**
   * Get primary account for a specific currency
   */
  async getPrimaryAccount(currency: AccountCurrency): Promise<Account | null> {
    const accounts = await this.getAccounts();
    return (
      accounts.find(
        (acc) =>
          acc.account_currency === currency &&
          acc.account_type === AccountType.PRIMARY &&
          acc.status === AccountStatus.ACTIVE,
      ) || null
    );
  },

  /**
   * Get total balance across all accounts (in NGN equivalent)
   */
  async getTotalBalance(exchangeRates: Record<string, number>): Promise<{
    total: number;
    byAccount: Array<{ account: Account; ngnValue: number }>;
  }> {
    const accounts = await this.getAccounts();
    const byAccount = accounts
      .filter((acc) => acc.status === AccountStatus.ACTIVE)
      .map((acc) => {
        const balance = parseFloat(acc.balance) || 0;
        const rate = exchangeRates[acc.account_currency] || 1;
        return {
          account: acc,
          ngnValue: balance * rate,
        };
      });

    const total = byAccount.reduce((sum, item) => sum + item.ngnValue, 0);

    return { total, byAccount };
  },

  /**
   * Get all supported currencies
   */
  getSupportedCurrencies(): Array<{
    code: AccountCurrency;
    name: string;
    symbol: string;
    flag: string;
  }> {
    return [
      {
        code: AccountCurrency.NGN,
        name: "Nigerian Naira",
        symbol: "₦",
        flag: "🇳🇬",
      },
      {
        code: AccountCurrency.USD,
        name: "US Dollar",
        symbol: "$",
        flag: "🇺🇸",
      },
      {
        code: AccountCurrency.EUR,
        name: "Euro",
        symbol: "€",
        flag: "🇪🇺",
      },
      {
        code: AccountCurrency.GBP,
        name: "British Pound",
        symbol: "£",
        flag: "🇬🇧",
      },
      {
        code: AccountCurrency.GHS,
        name: "Ghanaian Cedi",
        symbol: "₵",
        flag: "🇬🇭",
      },
      {
        code: AccountCurrency.JPY,
        name: "Japanese Yen",
        symbol: "¥",
        flag: "🇯🇵",
      },
      {
        code: AccountCurrency.AUD,
        name: "Australian Dollar",
        symbol: "A$",
        flag: "🇦🇺",
      },
    ];
  },

  /**
   * Get currency metadata
   */
  getCurrencyInfo(
    currency: string,
  ): { name: string; symbol: string; flag: string } | null {
    const currencies = this.getSupportedCurrencies();
    return currencies.find((c) => c.code === currency) || null;
  },

  /**
   * Get account ID from storage
   */
  getAccountIdFromStorage(): string | null {
    // Try direct account_id first
    let accountId = localStorage.getItem("account_id");
    if (accountId) return accountId;

    // Fallback: try to get from account object
    const accountJson = localStorage.getItem("account");
    if (accountJson) {
      try {
        const account = JSON.parse(accountJson);
        return account.id?.toString() || null;
      } catch {
        return null;
      }
    }

    return null;
  },
};

export default accountService;
