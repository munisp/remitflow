/**
 * API Service Layer - Production-ready API client with error handling,
 * retry logic, and offline support integration
 */

// WISE_API_BASE_URL and WISE_API_TOKEN no longer used for exchange rates;
// rates are now served directly by the 54remit backend.
import { normalizePaymentHubCurrency } from "../lib/paymentHubCurrency";
import { useOfflineStore } from "../stores/offlineStore";
import {
    CURRENCIES_LEDGER_MAP,
    getTenantHeadersFromStorage,
} from "./tenant/getTenantHeaders";

// API Configuration
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_CORE_BANKING_URL ||
  "https://54remit.upi.dev";

// Error types
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NetworkError extends Error {
  constructor(
    message: string = "Network error. Please check your connection.",
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

// Request configuration
interface RequestConfig {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
  offlineQueue?: boolean;
  /**
   * Optional currency code (e.g. "NGN", "USD") used to override
   * the x-ledger-id header for this request using CURRENCIES_LEDGER_MAP.
   */
  ledgerCurrency?: string;
}

// Response wrapper
interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

// Auth token management
let authToken: string | null = null;

export const setAuthToken = (token: string | null) => {
  authToken = token;
  if (token) {
    localStorage.setItem("auth_token", token);
  } else {
    localStorage.removeItem("auth_token");
  }
};

export const getAuthToken = (): string | null => {
  if (!authToken) {
    authToken = localStorage.getItem("auth_token");
  }
  return authToken;
};

// Retry with exponential backoff
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number = 3,
  delay: number = 1000,
): Promise<Response> {
  try {
    const response = await fetch(url, options);
    if (response.status >= 500 && retries > 0) {
      await sleep(delay);
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
    return response;
  } catch (error) {
    if (retries > 0 && error instanceof TypeError) {
      await sleep(delay);
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
    throw error;
  }
}

// Main API request function
async function apiRequest<T>(
  endpoint: string,
  config: RequestConfig = {},
): Promise<ApiResponse<T>> {
  const {
    method = "GET",
    body,
    headers = {},
    timeout = 30000,
    retries = 3,
    offlineQueue = false,
    ledgerCurrency,
  } = config;

  const url = `${API_BASE_URL}${endpoint}`;
  const token = getAuthToken();

  // Get tenant headers from tenant config
  const tenantHeaders = getTenantHeadersFromStorage();

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...tenantHeaders, // Add tenant headers (x-tenant-id, x-keycloak-realm, etc.)
    ...headers, // Allow overriding with custom headers
  };

  // If a specific ledgerCurrency is provided, override x-ledger-id
  // using the shared CURRENCIES_LEDGER_MAP.
  if (ledgerCurrency) {
    const ledgerId = CURRENCIES_LEDGER_MAP[ledgerCurrency];
    if (ledgerId) {
      requestHeaders["x-ledger-id"] = ledgerId;
    }
  }

  if (token) {
    requestHeaders["Authorization"] = `Bearer ${token}`;
  }

  // Add x-keycloak-id from logged-in user (not from tenant config)
  // This is the keycloak ID of the authenticated user, extracted from login response
  if (!requestHeaders["x-keycloak-id"]) {
    const keycloakId = localStorage.getItem("keycloak_id");
    if (keycloakId) {
      requestHeaders["x-keycloak-id"] = keycloakId;
    } else if (import.meta.env.DEV) {
      console.warn(
        "⚠️ Missing x-keycloak-id header - user may not be properly authenticated",
      );
    }
  }

  const requestOptions: RequestInit = {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined,
  };

  // Check if offline and should queue
  const offlineStore = useOfflineStore.getState();
  if (!offlineStore.isOnline && offlineQueue && method !== "GET") {
    // Queue the request for later
    const transactionType = endpoint.includes("transfer")
      ? "transfer"
      : endpoint.includes("airtime")
        ? "airtime"
        : endpoint.includes("bill")
          ? "bill_payment"
          : "transfer";

    offlineStore.addPendingTransaction({
      type: transactionType,
      data: { endpoint, method, body },
    });

    throw new NetworkError(
      "You are offline. This transaction has been queued and will be processed when you reconnect.",
    );
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  requestOptions.signal = controller.signal;

  try {
    const response = await fetchWithRetry(url, requestOptions, retries);
    clearTimeout(timeoutId);

    const contentType = response.headers.get("content-type");
    let data: T;

    if (contentType?.includes("application/json")) {
      data = await response.json();
    } else {
      data = (await response.text()) as unknown as T;
    }

    if (!response.ok) {
      const errorData = data as Record<string, unknown>;
      throw new ApiError(
        response.status,
        (errorData.code as string) || "UNKNOWN_ERROR",
        (errorData.message as string) || "An error occurred",
        errorData.details as Record<string, unknown>,
      );
    }

    return { data, status: response.status, headers: response.headers };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof TypeError || (error as Error).name === "AbortError") {
      throw new NetworkError();
    }

    throw error;
  }
}

// API Methods
export const api = {
  get: <T>(endpoint: string, config?: Omit<RequestConfig, "method" | "body">) =>
    apiRequest<T>(endpoint, { ...config, method: "GET" }),

  post: <T>(
    endpoint: string,
    body?: unknown,
    config?: Omit<RequestConfig, "method" | "body">,
  ) => apiRequest<T>(endpoint, { ...config, method: "POST", body }),

  put: <T>(
    endpoint: string,
    body?: unknown,
    config?: Omit<RequestConfig, "method" | "body">,
  ) => apiRequest<T>(endpoint, { ...config, method: "PUT", body }),

  patch: <T>(
    endpoint: string,
    body?: unknown,
    config?: Omit<RequestConfig, "method" | "body">,
  ) => apiRequest<T>(endpoint, { ...config, method: "PATCH", body }),

  delete: <T>(
    endpoint: string,
    config?: Omit<RequestConfig, "method" | "body">,
  ) => apiRequest<T>(endpoint, { ...config, method: "DELETE" }),
};

// ============================================
// Domain-specific API services
// ============================================

interface UserDetailsApiUser {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  status?: string;
  kyc_verification_status?: string;
  created_at?: string;
}

interface UserDetailsApiResponse {
  message?: string;
  user?: UserDetailsApiUser;
}

const getCurrentKeycloakId = () => localStorage.getItem("keycloak_id");

const getCurrentUserDetails = async (): Promise<
  ApiResponse<UserDetailsApiUser>
> => {
  const keycloakId = getCurrentKeycloakId();

  if (keycloakId) {
    const response = await api.get<UserDetailsApiResponse>(
      `/user/user?keycloak=${encodeURIComponent(keycloakId)}`,
    );

    const userData = response.data?.user;
    if (userData) {
      return {
        ...response,
        data: userData,
      };
    }
  }

  // Fallback for older environments where keycloak_id may not be set yet
  const fallback = await api.get<UserDetailsApiResponse | UserDetailsApiUser>(
    "/user/user/profile",
  );

  const fallbackData =
    "user" in (fallback.data as UserDetailsApiResponse)
      ? ((fallback.data as UserDetailsApiResponse).user as UserDetailsApiUser)
      : (fallback.data as UserDetailsApiUser);

  return {
    ...fallback,
    data: fallbackData,
  };
};

// Auth API (deprecated - use authService.ts instead)
// Kept for backward compatibility with existing code
export const authApiLegacy = {
  login: (email: string, password: string) =>
    api.post<{ token: string; user: User }>("/auth/auth/login", {
      email,
      password,
    }),

  register: (data: RegisterData) =>
    api.post<{ token: string; user: User }>("/auth/auth/register", data),

  requestOtp: (email: string) =>
    api.post<{ message: string }>("/auth/auth/request-otp", { email }),

  verifyOtp: (email: string, otp: string) =>
    api.post<{ token: string; user: User }>("/auth/auth/verify-otp", {
      email,
      otp,
    }),

  logout: () => api.post<void>("/auth/auth/logout"),

  refreshToken: () => api.post<{ token: string }>("/auth/auth/refresh"),

  getProfile: () => api.get<User>("/user/user/profile"),
};

// Transaction Service
export const transactionService = {
  transfer: (data: TransferRequest) => {
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
        idValue: data.sourceAccountId || "0805529423",
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

// Note: wiseApiRequest removed; backend now handles exchange rates directly.

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

// KYC Service
export const kycService = {
  getProfile: () => api.get<KYCProfile>("/kyc/profile"),

  updateProfile: (data: Partial<KYCProfile>) =>
    api.put<KYCProfile>("/kyc/profile", data),

  uploadDocument: (type: string, file: File) => {
    const formData = new FormData();
    formData.append("type", type);
    formData.append("file", file);
    return api.post<KYCDocument>("/kyc/documents", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  getDocuments: () => api.get<KYCDocument[]>("/kyc/documents"),

  verifyBvn: (bvn: string) =>
    api.post<BVNVerification>("/kyc/verify-bvn", { bvn }),

  getLimits: () => api.get<KYCLimits>("/kyc/limits"),

  requestTierUpgrade: (tier: string) =>
    api.post<KYCUpgradeRequest>("/kyc/upgrade", { tier }),
};

// Property Transaction KYC Service
export const propertyKycService = {
  // Party Management
  createParty: (data: CreatePartyRequest) =>
    api.post<Party>("/property-kyc/parties", data),

  getParty: (partyId: string) =>
    api.get<Party>(`/property-kyc/parties/${partyId}`),

  verifyParty: (partyId: string, verifiedBy: string) =>
    api.put<Party>(`/property-kyc/parties/${partyId}/verify`, {
      verified_by: verifiedBy,
    }),

  // Transaction Management
  createTransaction: (data: CreatePropertyTransactionRequest) =>
    api.post<PropertyTransaction>("/property-kyc/transactions", data),

  getTransaction: (transactionId: string) =>
    api.get<PropertyTransaction>(`/property-kyc/transactions/${transactionId}`),

  addSeller: (transactionId: string, sellerId: string) =>
    api.post<PropertyTransaction>(
      `/property-kyc/transactions/${transactionId}/add-seller`,
      { seller_id: sellerId },
    ),

  // Source of Funds
  submitSourceOfFunds: (transactionId: string, data: SourceOfFundsRequest) =>
    api.post<SourceOfFunds>(
      `/property-kyc/transactions/${transactionId}/source-of-funds`,
      data,
    ),

  verifySourceOfFunds: (sofId: string, verifiedBy: string) =>
    api.put<SourceOfFunds>(`/property-kyc/source-of-funds/${sofId}/verify`, {
      verified_by: verifiedBy,
    }),

  // Bank Statements
  uploadBankStatement: (transactionId: string, data: BankStatementRequest) =>
    api.post<BankStatement>(
      `/property-kyc/transactions/${transactionId}/bank-statements`,
      data,
    ),

  validateBankStatements: (transactionId: string) =>
    api.get<BankStatementValidation>(
      `/property-kyc/transactions/${transactionId}/bank-statements/validate`,
    ),

  // Income Documents
  uploadIncomeDocument: (transactionId: string, data: IncomeDocumentRequest) =>
    api.post<IncomeDocument>(
      `/property-kyc/transactions/${transactionId}/income-documents`,
      data,
    ),

  verifyIncomeDocument: (docId: string, verifiedBy: string) =>
    api.put<IncomeDocument>(`/property-kyc/income-documents/${docId}/verify`, {
      verified_by: verifiedBy,
    }),

  // Purchase Agreement
  uploadPurchaseAgreement: (
    transactionId: string,
    data: PurchaseAgreementRequest,
  ) =>
    api.post<PurchaseAgreement>(
      `/property-kyc/transactions/${transactionId}/purchase-agreement`,
      data,
    ),

  validatePurchaseAgreement: (agreementId: string) =>
    api.post<PurchaseAgreementValidation>(
      `/property-kyc/purchase-agreements/${agreementId}/validate`,
    ),

  verifyPurchaseAgreement: (agreementId: string, verifiedBy: string) =>
    api.put<PurchaseAgreement>(
      `/property-kyc/purchase-agreements/${agreementId}/verify`,
      { verified_by: verifiedBy },
    ),

  // Transaction Flow
  getChecklist: (transactionId: string) =>
    api.get<PropertyTransactionChecklist>(
      `/property-kyc/transactions/${transactionId}/checklist`,
    ),

  submitForReview: (transactionId: string) =>
    api.post<PropertyTransaction>(
      `/property-kyc/transactions/${transactionId}/submit-for-review`,
    ),

  approveTransaction: (
    transactionId: string,
    reviewerId: string,
    notes?: string,
  ) =>
    api.put<PropertyTransaction>(
      `/property-kyc/transactions/${transactionId}/approve`,
      { reviewer_id: reviewerId, notes },
    ),

  rejectTransaction: (
    transactionId: string,
    reviewerId: string,
    reason: string,
  ) =>
    api.put<PropertyTransaction>(
      `/property-kyc/transactions/${transactionId}/reject`,
      { reviewer_id: reviewerId, reason },
    ),

  // Flow Documentation
  getFlowDocumentation: () =>
    api.get<FlowDocumentation>("/property-kyc/flow-documentation"),
};

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

// Referral Service
export const referralService = {
  getReferralCode: () =>
    api.get<{ code: string; link: string }>("/referrals/code"),

  getReferrals: () => api.get<Referral[]>("/referrals"),

  getRewards: () => api.get<ReferralReward[]>("/referrals/rewards"),

  claimReward: (rewardId: string) =>
    api.post<ReferralReward>(`/referrals/rewards/${rewardId}/claim`),
};

// Savings Service
export const savingsService = {
  createGoal: (data: CreateSavingsGoalRequest) =>
    api.post<SavingsGoal>("/savings/api/v1/savings", data),

  getGoals: () =>
    api.get<SavingsGoal[] | { goals: SavingsGoal[] }>(
      "/savings/api/v1/savings",
    ),

  getGoal: (id: string) => api.get<SavingsGoal>(`/savings/goals/${id}`),

  contribute: (goalId: string, amount: number) =>
    api.post<SavingsContribution>(`/savings/goals/${goalId}/contribute`, {
      amount,
    }),

  withdraw: (goalId: string, amount: number) =>
    api.post<SavingsWithdrawal>(`/savings/goals/${goalId}/withdraw`, {
      amount,
    }),
};

// Notification Service
export const notificationService = {
  getAll: (params?: { page?: number; limit?: number; unreadOnly?: boolean }) =>
    api.get<{ notifications: Notification[]; total: number; unread: number }>(
      `/notifications?${new URLSearchParams(params as Record<string, string>).toString()}`,
    ),

  markRead: (id: string) => api.put<Notification>(`/notifications/${id}/read`),

  markAllRead: () => api.put<{ updated: number }>("/notifications/read-all"),

  getPreferences: () =>
    api.get<NotificationPreferences>("/notifications/preferences"),

  updatePreferences: (data: Partial<NotificationPreferences>) =>
    api.put<NotificationPreferences>("/notifications/preferences", data),

  delete: (id: string) => api.delete<void>(`/notifications/${id}`),
};

// Settings Service
export const settingsService = {
  getPreferences: async () => {
    const userRes = await getCurrentUserDetails();
    const user = userRes.data;

    const mapped: UserPreferences = {
      language: "en",
      currency: "NGN",
      theme: "light",
      biometricAuth: false,
      twoFactorAuth: false,
      transactionNotifications: user.status === "active",
      marketingEmails: false,
      autoLogoutMinutes: 15,
    };

    return {
      ...userRes,
      data: mapped,
    };
  },

  updatePreferences: (data: Partial<UserPreferences>) =>
    api.put<UserPreferences>("/settings/preferences", data),

  getSecuritySettings: () => api.get<SecuritySettings>("/settings/security"),

  updateSecuritySettings: (data: Partial<SecuritySettings>) =>
    api.put<SecuritySettings>("/settings/security", data),
};

// Support Service
export const supportService = {
  createTicket: (data: CreateSupportTicketRequest) =>
    api.post<SupportTicket>("/support/tickets", data),

  getTickets: () => api.get<SupportTicket[]>("/support/tickets"),

  getTicket: (id: string) => api.get<SupportTicket>(`/support/tickets/${id}`),

  addMessage: (ticketId: string, message: string) =>
    api.post<SupportMessage>(`/support/tickets/${ticketId}/messages`, {
      message,
    }),

  getFaqs: () => api.get<FAQ[]>("/support/faqs"),
};

// Profile Service
export const profileService = {
  getProfile: async () => {
    const userRes = await getCurrentUserDetails();
    const user = userRes.data;

    const mapped: UserProfile = {
      id: user.id,
      email: user.email,
      firstName: user.first_name || "",
      lastName: user.last_name || "",
      phone: user.phone_number || "",
      kycTier:
        user.kyc_verification_status?.toLowerCase() === "verified" ? 2 : 1,
      createdAt: user.created_at || new Date().toISOString(),
    };

    return {
      ...userRes,
      data: mapped,
    };
  },

  updateProfile: (data: Partial<UserProfile>) =>
    api.put<UserProfile>("/profile", data),

  uploadAvatar: (file: File) => {
    const formData = new FormData();
    formData.append("avatar", file);
    return api.post<{ avatarUrl: string }>("/profile/avatar", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ message: string }>("/profile/change-password", {
      currentPassword,
      newPassword,
    }),

  getLinkedAccounts: () => api.get<LinkedAccount[]>("/profile/linked-accounts"),

  linkAccount: (data: LinkAccountRequest) =>
    api.post<LinkedAccount>("/profile/linked-accounts", data),

  unlinkAccount: (id: string) =>
    api.delete<void>(`/profile/linked-accounts/${id}`),
};

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

// Dispute Service
export const disputeService = {
  getAll: (params?: { status?: string; page?: number }) =>
    api.get<{ disputes: Dispute[]; total: number }>(
      `/disputes?${new URLSearchParams(params as Record<string, string>).toString()}`,
    ),

  getById: (id: string) => api.get<Dispute>(`/disputes/${id}`),

  create: (data: CreateDisputeRequest) => api.post<Dispute>("/disputes", data),

  addMessage: (id: string, message: string) =>
    api.post<DisputeMessage>(`/disputes/${id}/messages`, { message }),

  cancel: (id: string) => api.post<Dispute>(`/disputes/${id}/cancel`),
};

// Audit Log Service
export const auditLogService = {
  getAll: (params?: {
    page?: number;
    limit?: number;
    action?: string;
    startDate?: string;
    endDate?: string;
  }) =>
    api.get<{ logs: AuditLog[]; total: number }>(
      `/audit-logs?${new URLSearchParams(params as Record<string, string>).toString()}`,
    ),

  export: (
    format: "csv" | "json",
    params?: { startDate?: string; endDate?: string },
  ) =>
    api.get<Blob>(
      `/audit-logs/export?format=${format}&${new URLSearchParams(params as Record<string, string>).toString()}`,
    ),
};

// Security Service
export const securityService = {
  getSettings: () => api.get<SecuritySettings>("/security/settings"),

  updateSettings: (data: Partial<SecuritySettings>) =>
    api.put<SecuritySettings>("/security/settings", data),

  enableTwoFactor: () =>
    api.post<{ qrCode: string; secret: string }>("/security/2fa/enable"),

  verifyTwoFactor: (code: string) =>
    api.post<{ verified: boolean }>("/security/2fa/verify", { code }),

  disableTwoFactor: (code: string) =>
    api.post<void>("/security/2fa/disable", { code }),

  changePin: (currentPin: string, newPin: string) =>
    api.post<void>("/security/pin/change", { currentPin, newPin }),

  getLoginHistory: () =>
    api.get<LoginHistoryEntry[]>("/security/login-history"),

  getSecurityScore: () =>
    api.get<{ score: number; recommendations: SecurityRecommendation[] }>(
      "/security/score",
    ),

  revokeDevice: (deviceId: string) =>
    api.delete<void>(`/security/devices/${deviceId}`),
};

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

// ============================================
// Type Definitions
// ============================================

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  kycTier: string;
  createdAt: string;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

export interface Transaction {
  id: string;
  type: string;
  amount: number;
  currency: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  reference: string;
  description?: string;
  recipient?: string;
  sender?: string;
  fee?: number;
  exchangeRate?: number;
  createdAt: string;
  completedAt?: string;
}

export interface TransferRequest {
  recipientType: "phone" | "email" | "bank";
  recipient: string;
  recipientName: string;
  amount: number;
  currency: string;
  destinationCurrency: string;
  note?: string;
  deliveryMethod: string;
  rateLockId?: string;
  sourceAccountId?: string;
  senderName?: string;
  switchName?: string;
  destination?: string;
  pin?: string;
}

export interface WalletBalance {
  currency: string;
  available: number;
  pending: number;
  total: number;
}

export interface FundWalletRequest {
  amount: number;
  currency: string;
  paymentMethod: string;
}

export interface WithdrawRequest {
  amount: number;
  currency: string;
  bankCode: string;
  accountNumber: string;
}

export interface ExchangeRate {
  from: string;
  to: string;
  rate: number;
  inverseRate: number;
  provider: string;
  lastUpdated: string;
  validUntil: string;
}

// Raw exchange rate shape as returned by the 54remit backend
interface BackendExchangeRate {
  id: number;
  tenant_id: string;
  base_currency: string;
  quote_currency: string;
  rate: number;
  created_at: string;
  updated_at: string;
}

export interface RateLock {
  id: string;
  from: string;
  to: string;
  rate: number;
  amount: number;
  lockedAt: string;
  expiresAt: string;
}

export interface ExchangeRateHistory {
  date: string;
  rate: number;
  high: number;
  low: number;
}

export interface AirtimePurchaseRequest {
  phone: string;
  amount: number;
  provider: string;
  type: "airtime" | "data";
  planId?: string;
}

export interface AirtimeTransaction {
  id: string;
  phone: string;
  amount: number;
  provider: string;
  type: string;
  status: string;
  createdAt: string;
}

export interface AirtimeProvider {
  id: string;
  name: string;
  logo: string;
  country: string;
}

export interface DataPlan {
  id: string;
  name: string;
  amount: number;
  data: string;
  validity: string;
}

export interface BillPaymentRequest {
  category: string;
  billerId: string;
  customerId: string;
  amount: number;
  customerName?: string;
}

export interface BillPaymentTransaction {
  id: string;
  category: string;
  biller: string;
  customerId: string;
  amount: number;
  status: string;
  createdAt: string;
}

export interface BillCategory {
  id: string;
  name: string;
  icon: string;
}

export interface Biller {
  id: string;
  name: string;
  logo: string;
  category: string;
}

export interface CustomerValidation {
  valid: boolean;
  customerName: string;
  customerId: string;
  minimumAmount?: number;
  maximumAmount?: number;
}

export interface KYCProfile {
  id: string;
  userId: string;
  currentTier: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  phone?: string;
  phoneVerified: boolean;
  email?: string;
  emailVerified: boolean;
  bvn?: string;
  bvnVerified: boolean;
  address?: string;
  idDocumentStatus: string;
  selfieStatus: string;
  addressProofStatus: string;
}

export interface KYCDocument {
  id: string;
  type: string;
  status: string;
  uploadedAt: string;
  verifiedAt?: string;
}

export interface BVNVerification {
  valid: boolean;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
}

export interface KYCLimits {
  tier: string;
  dailyLimit: number;
  monthlyLimit: number;
  singleTransactionLimit: number;
}

export interface KYCUpgradeRequest {
  id: string;
  requestedTier: string;
  status: string;
  createdAt: string;
}

// Property Transaction KYC Types
export interface Party {
  id: string;
  role: "buyer" | "seller" | "agent" | "lawyer" | "escrow";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  idType: string;
  idNumber: string;
  bvn?: string;
  nin?: string;
  kycStatus: string;
  createdAt: string;
}

export interface CreatePartyRequest {
  role: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  state: string;
  country: string;
  idType: string;
  idNumber: string;
  idIssuingCountry: string;
  idIssueDate: string;
  idExpiryDate: string;
  bvn?: string;
  nin?: string;
}

export interface PropertyTransaction {
  id: string;
  referenceNumber: string;
  propertyType: string;
  propertyAddress: string;
  purchasePrice: number;
  currency: string;
  buyerId: string;
  sellerId?: string;
  buyerKycComplete: boolean;
  sellerKycComplete: boolean;
  sourceOfFundsVerified: boolean;
  bankStatementsVerified: boolean;
  incomeVerified: boolean;
  purchaseAgreementVerified: boolean;
  status: string;
  riskScore: number;
  createdAt: string;
}

export interface CreatePropertyTransactionRequest {
  propertyType: string;
  propertyAddress: string;
  purchasePrice: number;
  currency?: string;
  buyerId: string;
}

export interface SourceOfFunds {
  id: string;
  transactionId: string;
  primarySource: string;
  secondarySource?: string;
  employerName?: string;
  businessName?: string;
  status: string;
}

export interface SourceOfFundsRequest {
  primarySource: string;
  secondarySource?: string;
  employerName?: string;
  businessName?: string;
  annualIncome?: number;
  additionalDetails?: string;
}

export interface BankStatement {
  id: string;
  transactionId: string;
  bankName: string;
  accountNumber: string;
  statementStartDate: string;
  statementEndDate: string;
  status: string;
}

export interface BankStatementRequest {
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
  statementStartDate: string;
  statementEndDate: string;
  documentUrl: string;
}

export interface BankStatementValidation {
  valid: boolean;
  message: string;
  coverageDays: number;
  requiredDays: number;
}

export interface IncomeDocument {
  id: string;
  transactionId: string;
  documentType: string;
  status: string;
}

export interface IncomeDocumentRequest {
  documentType: string;
  documentUrl: string;
  issuerName?: string;
  documentDate?: string;
  amount?: number;
}

export interface PurchaseAgreement {
  id: string;
  transactionId: string;
  buyerName: string;
  sellerName: string;
  propertyAddress: string;
  purchasePrice: number;
  buyerInfoMatchesKyc: boolean;
  sellerInfoMatchesKyc: boolean;
  status: string;
}

export interface PurchaseAgreementRequest {
  documentUrl: string;
  buyerName: string;
  buyerAddress: string;
  sellerName: string;
  sellerAddress: string;
  propertyAddress: string;
  propertyDescription: string;
  propertyType: string;
  purchasePrice: number;
  completionDate?: string;
}

export interface PurchaseAgreementValidation {
  buyerMatch: { matches: boolean; kycName: string; agreementName: string };
  sellerMatch: { matches: boolean; kycName: string; agreementName: string };
  priceMatch: {
    matches: boolean;
    transactionPrice: number;
    agreementPrice: number;
  };
  allValid: boolean;
}

export interface PropertyTransactionChecklist {
  transactionId: string;
  requirements: {
    name: string;
    status: "pending" | "in_progress" | "completed" | "failed";
    description: string;
  }[];
  overallProgress: number;
  canSubmitForReview: boolean;
}

export interface FlowDocumentation {
  steps: {
    step: number;
    name: string;
    description: string;
    endpoint: string;
  }[];
}

export interface VirtualAccount {
  id: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  currency: string;
  status: string;
  createdAt: string;
}

export interface CreateVirtualAccountRequest {
  currency: string;
  bankPreference?: string;
}

export interface VirtualCard {
  id: string;
  cardNumber: string;
  expiryDate: string;
  cvv: string;
  cardType: string;
  currency: string;
  balance: number;
  limit: number;
  status: "active" | "frozen" | "expired";
  createdAt: string;
}

export interface CreateCardRequest {
  cardType: string;
  currency: string;
  initialFunding?: number;
}

export interface CardTransaction {
  id: string;
  cardId: string;
  amount: number;
  currency: string;
  merchant: string;
  status: string;
  createdAt: string;
}

export interface Referral {
  id: string;
  referredEmail: string;
  status: string;
  rewardEarned: number;
  createdAt: string;
}

export interface ReferralReward {
  id: string;
  amount: number;
  currency: string;
  status: "pending" | "available" | "claimed";
  source: string;
  createdAt: string;
}

export interface SavingsGoal {
  id?: string;
  goal_id?: string;
  name: string;
  targetAmount?: number;
  target_amount?: number;
  currentAmount?: number;
  current_amount?: number;
  currency?: string;
  stablecoin?: string;
  targetDate?: string;
  target_date?: string;
  status:
    | "active"
    | "completed"
    | "withdrawn"
    | "ACTIVE"
    | "COMPLETED"
    | "WITHDRAWN";
  interestRate?: number;
  createdAt?: string;
  created_at?: string;
}

export interface CreateSavingsGoalRequest {
  name: string;
  target_amount: number;
  target_date: string;
  enable_auto_save: boolean;
  currency?: string;
}

export interface SavingsContribution {
  id: string;
  goalId: string;
  amount: number;
  createdAt: string;
}

export interface SavingsWithdrawal {
  id: string;
  goalId: string;
  amount: number;
  penalty?: number;
  createdAt: string;
}

// Notification types
export interface Notification {
  id: string;
  type: "transaction" | "security" | "promotion" | "system" | "kyc";
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  actionUrl?: string;
}

export interface NotificationPreferences {
  email: boolean;
  push: boolean;
  sms: boolean;
  transactionAlerts: boolean;
  securityAlerts: boolean;
  promotionalAlerts: boolean;
}

// Settings types
export interface UserPreferences {
  language: string;
  currency: string;
  theme: "light" | "dark" | "system";
  biometricAuth: boolean;
  twoFactorAuth: boolean;
  transactionNotifications: boolean;
  marketingEmails: boolean;
  autoLogoutMinutes: number;
}

export interface SecuritySettings {
  twoFactorEnabled: boolean;
  biometricEnabled: boolean;
  loginNotifications: boolean;
  transactionPin: boolean;
  trustedDevices: { id: string; name: string; lastUsed: string }[];
}

// Support types
export interface CreateSupportTicketRequest {
  subject: string;
  category: string;
  message: string;
  priority?: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  category: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority: string;
  createdAt: string;
  updatedAt: string;
  messages: SupportMessage[];
}

export interface SupportMessage {
  id: string;
  sender: "user" | "agent";
  message: string;
  createdAt: string;
}

export interface FAQ {
  id: string;
  question: string;
  answer: string;
  category: string;
}

// Profile types
export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  dateOfBirth?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  avatarUrl?: string;
  kycTier: number;
  createdAt: string;
}

export interface LinkedAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  bankCode: string;
  isDefault: boolean;
}

export interface LinkAccountRequest {
  bankCode: string;
  accountNumber: string;
}

// Bank directory types
export interface Bank {
  logo: string;
  tenant_id: string;
  created_at: string;
  status: string;
  updated_at: string;
  code: number;
  ledger_id: string;
  deleted_at: string | null;
  name: string;
}

export interface BankListResponse {
  message: string;
  banks: Bank[];
}

// Dashboard types
export interface DashboardSummary {
  balance: { currency: string; amount: number }[];
  recentTransactions: Transaction[];
  exchangeRates: ExchangeRate[];
  stats: {
    totalSent: number;
    totalReceived: number;
    transactionCount: number;
  };
}

// Beneficiary types
export interface Beneficiary {
  id: string;
  name: string;
  accountNumber: string;
  bankName: string;
  bankCode: string;
  phoneNumber?: string;
  email?: string;
  isFavorite: boolean;
  lastUsed?: string;
  totalTransactions: number;
}

export interface CreateBeneficiaryRequest {
  name: string;
  accountNumber: string;
  bankName: string;
  bankCode: string;
  phoneNumber?: string;
  email?: string;
}

// Dispute types
export interface Dispute {
  id: string;
  transactionId: string;
  transactionRef: string;
  type: string;
  reason: string;
  amount: number;
  currency: string;
  status: "open" | "under_review" | "resolved" | "rejected" | "closed";
  resolution?: string;
  createdAt: string;
  updatedAt: string;
  messages: DisputeMessage[];
}

export interface CreateDisputeRequest {
  transactionId: string;
  type: string;
  reason: string;
  description: string;
}

export interface DisputeMessage {
  id: string;
  sender: "user" | "support";
  message: string;
  createdAt: string;
}

// Audit Log types
export interface AuditLog {
  id: string;
  action: string;
  resource: string;
  details: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
}

// Security types
export interface LoginHistoryEntry {
  id: string;
  ipAddress: string;
  device: string;
  location: string;
  timestamp: string;
  success: boolean;
}

export interface SecurityRecommendation {
  id: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  action: string;
  completed: boolean;
}

// Batch Payment types
export interface BatchPayment {
  id: string;
  name: string;
  totalAmount: number;
  currency: string;
  recipientCount: number;
  status: "draft" | "pending" | "processing" | "completed" | "failed";
  payments: BatchPaymentItem[];
  createdAt: string;
  scheduledAt?: string;
}

export interface BatchPaymentItem {
  recipientName: string;
  accountNumber: string;
  bankCode: string;
  amount: number;
  status: string;
  reference?: string;
}

export interface CreateBatchPaymentRequest {
  name: string;
  currency: string;
  payments: Omit<BatchPaymentItem, "status" | "reference">[];
  scheduledAt?: string;
}

// Stablecoin types
export interface StablecoinBalance {
  coin: string;
  symbol: string;
  balance: number;
  usdValue: number;
}

export interface StablecoinTransaction {
  id: string;
  type: "buy" | "sell" | "send" | "receive" | "convert";
  coin: string;
  amount: number;
  usdValue: number;
  status: string;
  createdAt: string;
}

export interface StablecoinRate {
  coin: string;
  usdRate: number;
  ngnRate: number;
  change24h: number;
}

// FX Alert types
export interface FXAlert {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  targetRate: number;
  currentRate: number;
  direction: "above" | "below";
  status: "active" | "triggered" | "expired";
  createdAt: string;
}

export interface CreateFXAlertRequest {
  fromCurrency: string;
  toCurrency: string;
  targetRate: number;
  direction: "above" | "below";
}

export interface FXReward {
  id: string;
  type: string;
  description: string;
  amount: number;
  currency: string;
  status: "available" | "claimed" | "expired";
  expiresAt: string;
}

// Account Health types
export interface AccountHealth {
  score: number;
  maxScore: number;
  level: "excellent" | "good" | "fair" | "needs_improvement";
  categories: {
    name: string;
    score: number;
    maxScore: number;
    status: string;
  }[];
}

export interface HealthRecommendation {
  id: string;
  title: string;
  description: string;
  impact: number;
  category: string;
  actionUrl?: string;
}

// Payment Performance types
export interface PaymentPerformanceMetrics {
  totalVolume: number;
  totalCount: number;
  successRate: number;
  averageProcessingTime: number;
  volumeByDay: { date: string; amount: number; count: number }[];
  volumeByCurrency: { currency: string; amount: number; count: number }[];
  volumeByType: { type: string; amount: number; count: number }[];
}

export interface PaymentInsight {
  id: string;
  title: string;
  description: string;
  type: "positive" | "neutral" | "negative";
  metric: string;
  value: number;
  change: number;
}

// Export account service for multi-currency account management from core banking
export {
    AccountCurrency,
    accountService,
    AccountStatus,
    AccountType,
    CurrencyLedgerId,
    getCurrencyLedgerId,
    type Account,
    type AccountResponse,
    type AccountsResponse,
    type CheckAccountRequest,
    type CreateAccountRequest,
    type SetupPinRequest,
    type VerifyPinRequest
} from "./accountService";

// Export transaction service for transaction history
export {
    transactionServiceCore,
    type Transaction as CoreTransaction,
    type GetTransactionsParams,
    type TransactionHistory
} from "./transactionService";

// Export card service for card management
export {
    cardService,
    CardStatus,
    CardType,
    type Card,
    type CardResponse,
    type CardsResponse,
    type IssueCardRequest,
    type SetCardPinRequest
} from "./cardService";

export default api;
