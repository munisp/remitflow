/**
 * API Service Layer core - error types, token storage, fetch-with-retry,
 * apiRequest transport and the generic api.{get,post,put,patch,delete}
 * helper. Split out of the monolithic 53KB services/api.ts (wave14);
 * services/api.ts is now a barrel re-exporting this and the per-domain
 * modules, so existing import sites are unchanged.
 */

// WISE_API_BASE_URL and WISE_API_TOKEN no longer used for exchange rates;
// rates are now served directly by the 54remit backend.
import { normalizePaymentHubCurrency } from "../../lib/paymentHubCurrency";
import { useOfflineStore } from "../../stores/offlineStore";
import {
    CURRENCIES_LEDGER_MAP,
    getTenantHeadersFromStorage,
} from "../tenant/getTenantHeaders";

// API Configuration. A deployed PWA talks to the same origin by default;
// an explicitly configured gateway or core-banking upstream may override it.
const configuredApiBaseUrl =
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_CORE_BANKING_URL;
const API_BASE_URL = (configuredApiBaseUrl ||
  (typeof window !== "undefined" ? `${window.location.origin}/api` : "/api")).replace(/\/$/, "");

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
export interface RequestConfig {
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
export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

// Auth token management
// SECURITY (CLI-002): the access token is held in module memory ONLY.
// It is never written to localStorage, so XSS payloads, extensions, and
// shared-device storage inspection cannot recover it. After a page reload
// the token is re-obtained via authService.refreshToken() (credential flow,
// refresh token in sessionStorage) or the httpOnly-cookie SSO session.
let authToken: string | null = null;

// One-time purge of tokens persisted by older builds.
try {
  localStorage.removeItem("auth_token");
} catch {
  // Storage unavailable — nothing to purge.
}

export const setAuthToken = (token: string | null) => {
  authToken = token;
};

export const getAuthToken = (): string | null => {
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
export async function apiRequest<T>(
  endpoint: string,
  config: RequestConfig = {},
): Promise<ApiResponse<T>> {
  const {
    method = "GET",
    body,
    headers = {},
    timeout = 30000,
    // PERF+SAFETY (wave14): mutations (POST/PUT/PATCH/DELETE) are NOT
    // retried by default. A retry after a 5xx/network drop can re-execute a
    // non-idempotent transfer server-side (duplicate-transfer risk) when the
    // first attempt actually succeeded. GETs are idempotent and keep 3
    // retries with exponential backoff. Callers may still pass an explicit
    // `retries` for operations they know are idempotent (e.g. server-side
    // idempotency-keyed endpoints).
    retries = method === "GET" ? 3 : 0,
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
// Shared internal helpers (moved from the monolithic api.ts)
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

export const getCurrentKeycloakId = () => localStorage.getItem("keycloak_id");

export const getCurrentUserDetails = async (): Promise<
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
